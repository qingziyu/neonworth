import { z } from 'zod';
import { EMPTY_GOALS, type GoalSettings } from './goals';
import type { ReviewEvent } from './year-review';
import { isISODate } from './reporting-coverage';
import { assertRecordSize } from './dataset-storage';
import { validateFireGoal } from './fire';

export interface PlanningState { version: 1; goals: GoalSettings; events: ReviewEvent[] }
export const EMPTY_PLANNING: PlanningState = { version: 1, goals: EMPTY_GOALS, events: [] };
export const PLANNING_RECORD_KEY = 'planning-v1';
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
const id = z.string().min(1).max(200).refine(value => !forbidden.has(value) && !!value.trim(), 'Invalid record identifier.');
const amount = z.number().finite().min(0).max(1_000_000_000_000).refine(value => Math.round(value * 100) / 100 === value, 'Enter a dollar amount with at most two decimal places.');
const date = z.string().refine(value => isISODate(value) && Number(value.slice(0, 4)) >= 1900 && Number(value.slice(0, 4)) <= 2199, 'Use a valid calendar date between 1900 and 2199.');
const text = (max: number) => z.string().max(max).refine(value => !!value.trim(), 'Enter a nonempty label.');
const goals = z.object({
  version: z.literal(1),
  savings: z.object({ year: z.number().int().min(1900).max(2199), targetAmount: amount, basis: z.enum(['cash', 'cashAndEquity']) }).strict().nullable(),
  netWorth: z.object({ targetAmount: amount, targetDate: date }).strict().nullable(),
  fire: z.object({ annualWithdrawalNeed: amount, withdrawalRatePct: z.number().finite().gt(0).max(100), eligibleAssets: amount, valuationDate: date, assetScope: text(500), targetDate:date.optional(), annualContribution:amount.optional(), realReturnPct:z.number().finite().min(-20).max(20).optional() }).strict().refine(value => {
    const target = value.annualWithdrawalNeed / (value.withdrawalRatePct / 100);
    return Number.isFinite(target) && target <= Number.MAX_SAFE_INTEGER / 100;
  }, 'These assumptions exceed the supported scenario amount.').superRefine((value,ctx)=>{try{validateFireGoal(value);}catch(error){ctx.addIssue({code:'custom',message:error instanceof Error?error.message:'Invalid FIRE assumptions.'});}}).nullable(),
}).strict();
const event = z.object({ id, name: text(200), transactionIds: z.array(id).min(1).max(500), notes: z.string().max(2000).optional() }).strict();

// Zod may discard special object keys; reject them before parsing any level.
function rejectUnsafeKeys(input: unknown, ctx: z.RefinementCtx) {
  const stack: unknown[] = [input];
  let nodes = 0;
  while (stack.length) {
    const value = stack.pop();
    if (++nodes > 120_000) { ctx.addIssue({ code: 'custom', message: 'Planning input is too complex.' }); return z.NEVER; }
    if (value && typeof value === 'object') {
      if (Object.keys(value).some(key => forbidden.has(key))) { ctx.addIssue({ code: 'custom', message: 'Invalid object key.' }); return z.NEVER; }
      stack.push(...Object.values(value));
    }
  }
  return input;
}
export const planningSchema = z.preprocess(rejectUnsafeKeys, z.object({ version: z.literal(1), goals, events: z.array(event).max(100) }).strict().superRefine((value, ctx) => {
  const ids = new Set<string>(), members = new Set<string>();
  for (const event of value.events) {
    if (ids.has(event.id)) ctx.addIssue({ code: 'custom', message: 'Event identifiers must be unique.' });
    ids.add(event.id);
    for (const id of event.transactionIds) {
      if (members.has(id)) ctx.addIssue({ code: 'custom', message: 'A source record can belong to only one event, once.' });
      members.add(id);
    }
  }
  try { assertRecordSize(value); } catch { ctx.addIssue({ code: 'custom', message: 'Saved planning exceeds the supported size.' }); }
}));
export const planningInputSchema = z.preprocess(rejectUnsafeKeys, z.object({ plan: planningSchema, expectedPlan: planningSchema.nullable() }).strict());

/** Membership is a set: renaming/reordering a retained event never revalidates vanished source rows. */
export function editedEvents(previous: PlanningState | null, next: PlanningState): ReviewEvent[] {
  const old = new Map(previous?.events.map(event => [event.id, event]) ?? []);
  return next.events.filter(event => {
    const before = old.get(event.id);
    return !before || before.transactionIds.length !== event.transactionIds.length || before.transactionIds.some(id => !event.transactionIds.includes(id));
  });
}
