import assert from 'node:assert/strict';
import { summarizeReportingCoverage, observedComparisonStart, isReportingWindowComparable, createReportingWindowComparator } from '../lib/reporting-coverage.ts';
import { summarizePeriod } from '../lib/finance.ts';
import { summarizeBudget } from '../lib/budget.ts';
import { financialReviewFixture } from './test-support/financial-review-fixture.mjs';

const fixture = financialReviewFixture(), data = fixture.dataset, before = JSON.stringify(data);
assert.equal(observedComparisonStart(data), '2026-06-01');
assert.equal(observedComparisonStart({...data,transactions:[...data.transactions].reverse()}), '2026-06-01', 'Comparison baseline does not depend on source row order');
for (const window of [{start:'2026-10-01',end:'2026-09-30'},{start:'invalid',end:'2026-10-28'},{start:'2026-02-30',end:'2026-10-28'},{start:'2026-06-01',end:'2026-13-01'},{start:'2027-01-01',end:'2027-01-31'}]) {
  assert.equal(isReportingWindowComparable(data, window), false, 'Invalid, inverted or future windows are unavailable comparisons, not exceptions');
  assert.equal(createReportingWindowComparator(data)(window), false);
  assert.equal(summarizeReportingCoverage(data, window).comparisonEligible, false);
}
for (const patch of [{dateRange:{start:'2026-11-01',end:'2026-12-01'}},{dateRange:{start:'2026-10-01',end:'2026-09-01'}},{dateRange:{start:'invalid',end:'2026-10-28'}},{asOf:'2026-02-30'}]) {
  assert.equal(observedComparisonStart({...data,...patch}), null, 'Invalid or wholly future saved ranges cannot establish a comparison start');
}
for (const month of ['2026-11', '2027-01']) {
  const futureSummary = summarizePeriod(data, month, 'month');
  assert.equal(futureSummary.period.empty, true);
  assert.ok(!futureSummary.insights.some(insight => /Recorded spending (?:up|down)|recent baseline/.test(insight.title)));
}
const mutable = structuredClone(data);
assert.equal(observedComparisonStart(mutable), '2026-06-01');
mutable.transactions.find(row => row.id === 'first-later').date = '2026-04-21';
assert.equal(observedComparisonStart(mutable), '2026-05-01', 'New calculations observe corrected source rows; no stale object-identity cache');
mutable.transactions.find(row => row.id === 'first-later').date = '2026-10-28';
assert.equal(observedComparisonStart(mutable), null, 'The first full comparison month can still be in the future');
const june = summarizeReportingCoverage(data, { start: '2026-06-01', end: '2026-06-30' });
assert.equal(june.comparisonEligible, true); assert.equal(june.sourceCoverage, 'unknown');
assert.equal(summarizeReportingCoverage(data, { start: '2026-05-01', end: '2026-05-31' }).comparisonEligible, false);
assert.equal(summarizeReportingCoverage(data, { start: '2026-09-01', end: '2026-09-30' }).sourceCoverage, 'complete_for_query');
assert.deepEqual(june.netWorth, { start: '2026-06-21', end: '2026-10-29', count: 5 });
assert.deepEqual(june.balances, { dated: 0, total: 4 });
const limited = structuredClone(data); limited.coverage.refresh.bankPageCoverage.is_complete_for_query = false;
assert.equal(summarizeReportingCoverage(limited, { start: '2026-09-01', end: '2026-09-30' }).comparisonEligible, false);
assert.equal(summarizeReportingCoverage(limited, { start: '2026-06-01', end: '2026-06-30' }).comparisonEligible, true);
const missing = structuredClone(data); missing.transactions = missing.transactions.filter(row => row.id !== 'first-later');
missing.transactions.push({ ...data.transactions[0], id: 'repayment', accountId: 'later-card', flow: 'transfer', date: '2026-04-01' }, { ...data.transactions[0], id: 'pending-first', accountId: 'later-card', pending: true, date: '2026-04-02' }, { ...data.transactions[0], id: 'refund-first', accountId: 'later-card', amount: -10, date: '2026-04-03' });
missing.transactions.push({ ...data.transactions[0], id: 'zelle-first', accountId: 'later-card', merchant: 'Zelle payment', reviewDecision:'zelle', date: '2026-04-01' });
assert.equal(observedComparisonStart(missing), null);
const midMonth = structuredClone(data); midMonth.accounts = midMonth.accounts.filter(a => a.type !== 'credit'); midMonth.dateRange.start = '2026-06-15';
assert.equal(observedComparisonStart(midMonth), '2026-07-01');
assert.equal(summarizeReportingCoverage(midMonth, { start: '2026-06-15', end: '2026-06-30' }).comparisonEligible, false, 'The first full saved month applies even without linked credit accounts');
const unscoped = structuredClone(data); unscoped.coverage = { transactions: { is_complete_for_query: true } };
assert.equal(summarizeReportingCoverage(unscoped, { start: '2026-04-01', end: '2026-04-30' }).comparisonEligible, false, 'An unscoped complete flag cannot certify earlier card history');
unscoped.transactions.push({ ...data.transactions[0], id: 'april-expense', date: '2026-04-10', amount: 400 });
assert.equal(summarizePeriod(unscoped, '2026-05', 'month').insights.some(insight => /spending (?:up|down)/i.test(insight.title)), false, 'Finance comparisons use the same first-card-history boundary as budget');
assert.ok(summarizePeriod(data, '2026-09', 'month').insights.some(insight => /Recorded spending (?:up|down)/.test(insight.title)), 'Observed comparable windows can describe recorded spending without certifying completeness');
assert.equal(summarizePeriod(limited, '2026-09', 'month').insights.some(insight => /spending (?:up|down)/i.test(insight.title)), false, 'A scoped source limitation suppresses affected comparison claims');
const amounts = s => [s.spending, s.cashPayroll, s.rsuValue, s.saved, s.cashSaved, s.categories, s.trend];
assert.deepEqual(amounts(summarizePeriod(data, '2026-10', 'ytd')), amounts(summarizePeriod(limited, '2026-10', 'ytd')), 'Coverage changes comparison eligibility, never recorded money totals');
for (const mode of ['month','ytd','year']) {
  const budget = summarizeBudget(data, '2026-10', mode, fixture.budget), summary = summarizePeriod(data, '2026-10', mode);
  assert.equal(Math.round((budget.monthlyTotal + budget.annualTotal + budget.exceptionalTotal) * 100), Math.round(summary.spending * 100), 'Budget purpose partitions equal full recorded spending, including refunds and the Apple payment proxy');
  assert.equal(budget.selectedMonth.remaining, Math.round((fixture.budget.monthlyCap - budget.selectedMonth.actual) * 100) / 100);
  if (mode === 'month') assert.equal(budget.monthlyTotal, budget.selectedMonth.actual, 'Overview month actual and Budget selected-month actual use the same resolved window');
}
assert.equal(JSON.stringify(data), before);
console.log('Reporting coverage: invalid/future window guards, observed start, fresh calculations, independent metric dates, scoped limitations and unchanged amounts verified.');
