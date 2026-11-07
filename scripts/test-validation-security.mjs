// Synthetic validation inputs only; no network, saved finance data, or datastore.
import assert from 'node:assert/strict';
import { datasetSchema, transactionOverridesSchema } from '../lib/store-validation.ts';
import { budgetPlanSchema, suggestBudgetPlan } from '../lib/budget.ts';
import { reviewPreferencesSchema } from '../lib/review-preferences.ts';
import { validateRetirementOverrides } from '../lib/retirement-preferences.ts';

const base = {
  version: 1, syncedAt: '2026-10-25T12:00:00Z', asOf: '2026-10-25',
  dateRange: { start: '2026-01-01', end: '2026-10-25' }, coverage: {},
  accounts: [], transactions: [], netWorthHistory: [], recurring: [], notes: [],
  incomeEvidence: {
    version: 1, asOf: '2026-10-25', readAt: '2026-10-25T12:00:00Z',
    bankCoverage: { nullValue: null, structured: { complete: false }, arbitraryProviderKey: 'unknown' },
    investmentCoverage: { isComplete: false, freshness: 'unknown', note: 'Synthetic coverage' },
    bankInflowCount: 0, bankInflowTotal: 0, pendingInflowCount: 0,
    investmentRecords: [], accountHistory: [], notes: [], sources: [],
  },
};

assert.deepEqual(datasetSchema.parse(base), base, 'Zod migration preserves provider coverage records and source data');
assert.deepEqual(reviewPreferencesSchema.parse({}), { findingResolutions: {}, recurringStatuses: {} });
assert.deepEqual(validateRetirementOverrides({}, base), {});
const plan = suggestBudgetPlan(base);
assert.deepEqual(budgetPlanSchema.parse(plan), plan, 'Saved monthly and annual amount records retain their values');
assert.equal(budgetPlanSchema.safeParse({ ...plan, monthly: { ...plan.monthly, unexpected: 0 } }).success, false);
assert.equal(transactionOverridesSchema.safeParse(JSON.parse('{"__proto__":{"note":"invalid"}}')).success, false);

// The patched validator rejects oversized collections before visiting elements.
// A malicious small JSON array must not generate one error tree per element.
for (const [field, maximum] of [['accounts', 500], ['transactions', 50_000], ['recurring', 2_000], ['notes', 100]]) {
  let elementReads = 0;
  const oversized = new Array(maximum + 1).fill(null);
  Object.defineProperty(oversized, 0, { get() { elementReads++; return null; } });
  const result = datasetSchema.safeParse({ ...base, [field]: oversized });
  assert.equal(result.success, false, `${field} maximum must be enforced`);
  assert.equal(elementReads, 0, `${field} must reject length before parsing attacker-controlled elements`);
  assert.equal(result.error.issues.length, 1, `${field} must produce one bounded size error`);
  assert.equal(result.error.issues[0].code, 'too_big');
  assert.deepEqual(result.error.issues[0].path, [field]);
}

const nested = datasetSchema.safeParse({
  ...base,
  incomeEvidence: { ...base.incomeEvidence, investmentRecords: new Array(10_001).fill(null) },
});
assert.equal(nested.success, false);
assert.equal(nested.error.issues.length, 1, 'Nested oversized evidence also avoids per-record error expansion');
assert.deepEqual(nested.error.issues[0].path, ['incomeEvidence', 'investmentRecords']);
console.log('Validation security passed: bounded oversized-array errors, provider coverage, saved budget maps, preference defaults, and forbidden keys.');
