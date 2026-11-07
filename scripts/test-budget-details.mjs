// Synthetic only: shared fixture plus locally invented rows; the fixture itself is not modified.
import assert from 'node:assert/strict';
import { BUDGET_MONTHLY, budgetAnnualDefinitions, creditEvidenceScope, summarizeBudget, summarizeBudgetAssignments, summarizeBudgetCategoryDetail } from '../lib/budget.ts';
import { applyIncomePolicy, resolvePeriod } from '../lib/periods.ts';
import { isZelleTransaction } from '../lib/transaction-policy.ts';
import { financialReviewFixture } from './test-support/financial-review-fixture.mjs';

const fixture = financialReviewFixture(), plan = fixture.budget, before = JSON.stringify(fixture);
const tx = (id, date, amount, merchant, category, extra = {}) => ({ id, date, amount, merchant, category, accountId: 'later-card', flow: 'expense', confidence: 'HIGH', exceptional: false, note: '', pending: false, review: false, ...extra });
const build = () => {
  const data = structuredClone(fixture.dataset);
  data.transactions.push(
    tx('bd-resy', '2026-10-10', -20, 'Platinum Resy Credit', 'Dining & coffee'),
    tx('bd-hotel', '2026-10-14', -50, 'Platinum Hotel Credit', 'Travel'),
    tx('bd-clear', '2026-10-15', -30, 'AMEX CLEAR PLUS CREDIT', 'Other'),
    tx('bd-points', '2026-10-16', -15, 'Points for Amex Trvl', 'Travel'),
    tx('bd-kitchen', '2026-10-02', 80, 'Example Kitchen Store', 'Shopping'),
    tx('bd-kitchen-back', '2026-10-12', -80, 'Example Kitchen Store', 'Shopping'),
    tx('bd-protected', '2026-10-13', -12, 'Platinum Resy Credit', 'Other', { classificationOverrides: { category: 'Other' } }),
    // Prior-month purchase with a current-month inferred refund (evidence link must show both).
    tx('bd-lamp', '2026-09-20', 60, 'Example Lamp Shop', 'Shopping'),
    tx('bd-lamp-back', '2026-10-05', -60, 'Example Lamp Shop', 'Shopping'),
  );
  return data;
};
const data = build(), cents = value => Math.round(value * 100);
const month = '2026-10';

for (const mode of ['month', 'ytd', 'year']) {
  const summary = summarizeBudget(data, month, mode, plan), assignments = summarizeBudgetAssignments(data, month, mode, plan);
  const assigned = assignments.flatMap(a => a.ids);
  assert.equal(new Set(assigned).size, assigned.length, `${mode}: every expense record appears once across assignments`);
  const policy = applyIncomePolicy(data), period = resolvePeriod(policy, month, mode);
  const expected = policy.transactions.filter(t => !t.pending && t.flow === 'expense' && !isZelleTransaction(t) && !period.empty && t.date >= period.start && t.date <= period.end);
  assert.deepEqual([...assigned].sort(), expected.map(t => t.id).sort(), `${mode}: assignments cover exactly the posted expense rows`);
  assert.deepEqual([...assigned].sort(), [...summary.monthlyIds, ...summary.annualIds, ...summary.exceptionalIds].sort());
  for (const a of assignments) {
    assert.equal(cents(a.gross) - cents(a.credits), cents(a.net), `${a.key}: gross - credits = net`);
    assert.deepEqual([...a.chargeIds, ...a.creditIds].sort(), [...a.ids].sort());
    assert.equal(a.creditEvidence.length, a.creditIds.length, 'Every credit stays visible with evidence');
  }
  const rowsTotal = [...summary.monthlyRows, ...summary.annualRows].reduce((n, row) => n + cents(row.actual), 0) + cents(summary.exceptionalTotal);
  assert.equal(rowsTotal, cents(summary.totalSpending), `${mode}: categories reconcile to total spending`);
  assert.equal(expected.reduce((n, t) => n + cents(t.amount), 0), cents(summary.totalSpending), `${mode}: signed accounting unchanged`);
  assert.equal(assignments.reduce((n, a) => n + cents(a.net), 0), cents(summary.totalSpending));
}

// Category detail IDs and signed totals equal the budget rows for the same scope.
const monthSummary = summarizeBudget(data, month, 'month', plan), ytdSummary = summarizeBudget(data, month, 'ytd', plan);
for (const category of BUDGET_MONTHLY) {
  const row = monthSummary.monthlyRows.find(r => r.id === category.id), detail = summarizeBudgetCategoryDetail(data, month, 'month', plan, 'monthly', category.id);
  assert.deepEqual(detail.ids, [...row.ids].sort(), `${category.id}: monthly detail IDs`);
  assert.equal(cents(detail.net), cents(row.actual), `${category.id}: monthly detail net`);
  assert.equal(cents(detail.gross) - cents(detail.credits), cents(detail.net));
  assert.equal(detail.mode, 'month'); assert.equal(detail.anchorMonth, month);
  assert.equal(detail.period.start, monthSummary.selectedMonth.period.start); assert.equal(detail.period.end, monthSummary.selectedMonth.period.end);
}
for (const category of budgetAnnualDefinitions(false)) {
  const row = ytdSummary.annualRows.find(r => r.id === category.id), detail = summarizeBudgetCategoryDetail(data, month, 'ytd', plan, 'annual', category.id);
  assert.deepEqual(detail.ids, [...row.ytdIds].sort(), `${category.id}: YTD detail IDs`);
  assert.equal(cents(detail.net), cents(row.actualYtd), `${category.id}: YTD detail net`);
  assert.equal(detail.period.start.slice(0, 4), '2026'); assert.equal(detail.mode, 'ytd');
}
const empty = summarizeBudgetCategoryDetail(data, month, 'ytd', plan, 'annual', 'learning');
assert.equal(empty.count, 0); assert.deepEqual(empty.ids, []); assert.equal(empty.net, 0);

// Credit purposes land in their category without inventing purchases; protected rows keep their decision.
const ytdAssignments = summarizeBudgetAssignments(data, month, 'ytd', plan);
const owner = id => ytdAssignments.find(a => a.ids.includes(id));
assert.equal(owner('bd-resy').categoryId, 'dining');
assert.equal(owner('bd-hotel').categoryId, 'travel');
assert.equal(owner('bd-clear').categoryId, 'annual_bills');
assert.equal(owner('bd-kitchen-back').categoryId, owner('bd-kitchen').categoryId, 'An inferred refund follows its single matched purchase');
assert.equal(owner('bd-kitchen-back').creditEvidence.find(e => e.id === 'bd-kitchen-back').status, 'inferred_purchase');
assert.equal(owner('bd-points').creditEvidence.find(e => e.id === 'bd-points').kind, 'general_statement_credit');
assert.equal(owner('bd-protected').creditEvidence.find(e => e.id === 'bd-protected').status, 'manual');
assert.notEqual(owner('bd-protected').categoryId, 'dining', 'A protected manual category is not replaced by a descriptor purpose');
for (const id of ['bd-resy', 'bd-hotel', 'bd-clear']) assert.equal(owner(id).creditEvidence.find(e => e.id === id).purchaseId, null);

// Credit + inferred purchase evidence uses an explicitly wider existing scope that contains both rows.
const monthAssignments = summarizeBudgetAssignments(data, month, 'month', plan);
const lampOwner = monthAssignments.find(a => a.ids.includes('bd-lamp-back'));
assert.ok(!lampOwner.ids.includes('bd-lamp'), 'The selected-month category scope itself is not widened');
const lampEvidence = lampOwner.creditEvidence.find(e => e.id === 'bd-lamp-back');
assert.deepEqual([lampEvidence.status, lampEvidence.purchaseId, lampEvidence.date, lampEvidence.purchaseDate], ['inferred_purchase', 'bd-lamp', '2026-10-05', '2026-09-20']);
const monthPeriod = resolvePeriod(applyIncomePolicy(data), month, 'month');
assert.ok(lampEvidence.purchaseDate < monthPeriod.start, 'A current-month scope would hide the prior-month purchase');
const lampScope = creditEvidenceScope(lampEvidence, 'month', month);
assert.deepEqual(lampScope, { ids: ['bd-lamp-back', 'bd-lamp'], mode: 'year', anchorMonth: '2026-10', widened: true });
const widened = resolvePeriod(applyIncomePolicy(data), lampScope.anchorMonth, lampScope.mode);
for (const date of [lampEvidence.date, lampEvidence.purchaseDate]) assert.ok(date >= widened.start && date <= widened.end, `${date} is inside the evidence scope`);
const plainCredit = owner('bd-resy').creditEvidence.find(e => e.id === 'bd-resy');
assert.deepEqual(creditEvidenceScope(plainCredit, 'month', month), { ids: ['bd-resy'], mode: 'month', anchorMonth: month, widened: false }, 'Unlinked credits keep the ordinary scope');

// Determinism under row-order reversal; inputs unchanged.
const reversed = build(); reversed.transactions.reverse();
const key = list => list.map(a => [a.key, cents(a.net), [...a.ids].sort()]).sort((a, b) => a[0].localeCompare(b[0]));
assert.deepEqual(key(summarizeBudgetAssignments(reversed, month, 'ytd', plan)), key(ytdAssignments));
assert.equal(JSON.stringify(fixture), before);
assert.deepEqual(data, build(), 'Budget helpers do not mutate their input');
console.log('Budget details: once-only assignments, gross − credits = net, category reconciliation, exact drilldown IDs per scope, credit purposes, manual protection, determinism and immutability verified.');
