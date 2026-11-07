import { FINANCE_CONFIG } from './finance-config.ts';
import { compareAndPutRecord, readRecord, readRecordRevision, readState, RecordConflict } from './store';
import { editedEvents, PLANNING_RECORD_KEY, planningSchema, type PlanningState } from './planning';
import { sameDatasetContent } from './dataset-storage';
import { deriveDataset } from './classification';
import { budgetPlanSchema } from './budget';
import { validateReviewEvents } from './year-review';
import { storageFailure } from './storage-errors';
import { validateFireGoal } from './fire';
import { assertCredentialFree } from './credential-boundary';

export class PlanningConflict extends Error {}
export class PlanningInputError extends Error {}
export async function readPlanning(): Promise<PlanningState | null> {
  const saved = await readRecord(PLANNING_RECORD_KEY);
  if(saved===null)return null;
  try{return planningSchema.parse(saved);}catch(error){throw storageFailure(error,'record_decode');}
}
export async function savePlanning(next: PlanningState, expected: PlanningState | null): Promise<PlanningState> {
  assertCredentialFree(next);
  const previous = await readPlanning();
  if (!sameDatasetContent(previous, expected)) throw new PlanningConflict('Your planning changed in another session. Reload it before editing again.');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: FINANCE_CONFIG.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  if (next.goals.fire && next.goals.fire.valuationDate > today) throw new PlanningInputError('The eligible-asset valuation date cannot be in the future.');
  if(next.goals.fire)try{validateFireGoal(next.goals.fire,today);}catch(error){throw new PlanningInputError(error instanceof Error?error.message:'Invalid FIRE assumptions.');}
  const changed = editedEvents(previous, next);
  const guards: Array<{ key: string; value: string | null }> = [];
  if (changed.length) {
    // Capture revisions before reading dependent views, then guard them in the
    // same transaction as the preference write. Refresh/correction/budget races
    // fail instead of accepting membership against a stale classification.
    for (const key of ['dataset', 'overrides', 'review-preferences', 'budget-plan-v1']) guards.push({ key, value: await readRecordRevision(key) });
    const state = await readState(), budget = await readRecord('budget-plan-v1');
    if (!state.dataset || !budget) throw new PlanningInputError('Saved financial data and a budget plan are required to confirm event membership.');
    const data=deriveDataset(state.dataset, state.overrides, state.reviewPreferences), plan=budgetPlanSchema.parse(budget);
    try { validateReviewEvents(data, plan, changed); }
    catch { throw new PlanningInputError('Events contain invalid, overlapping, missing or ineligible source records.'); }
  }
  try { await compareAndPutRecord(PLANNING_RECORD_KEY, previous, next, guards); }
  catch(error) { if(error instanceof RecordConflict)throw new PlanningConflict('Planning or its source records changed while saving. Reload before trying again.');throw error; }
  const saved = await readPlanning();
  if (!sameDatasetContent(saved, next)) throw new PlanningConflict('Planning changed while saving. Reload to check the saved values.');
  return saved!;
}
