// Entirely synthetic: these are not the user's accounts, transactions or goals.
import { suggestBudgetPlan } from '../../lib/budget.ts';

export function financialReviewFixture() {
  const account = (id, type, subtype) => ({ id, type, subtype, name: `Synthetic ${id}`, institution: 'Example Bank', mask: '0000', balance: 1000, netBalance: type === 'credit' ? -1000 : 1000, balanceDate: null, balanceAgeKnown: false, syncStatus: 'synced' });
  const tx = (id, date, amount, category, extra = {}) => ({ id, date, amount, category, merchant: id, accountId: 'old-card', flow: 'expense', confidence: 'HIGH', exceptional: false, note: 'Synthetic regression example', pending: false, review: false, ...extra });
  const dataset = {
    version: 1, asOf: '2026-10-28', syncedAt: '2026-10-29T00:30:00Z', dateRange: { start: '2025-10-01', end: '2026-10-28' },
    accounts: [account('checking', 'depository', 'checking'), account('old-card', 'credit', 'credit card'), account('later-card', 'credit', 'credit card'), account('investments', 'investment', 'brokerage')],
    transactions: [
      tx('first-old', '2025-10-07', 10, 'Dining & coffee'),
      tx('old-year-purchase', '2025-12-20', 2000, 'Shopping'),
      tx('first-later', '2026-05-21', 10, 'Dining & coffee', { accountId: 'later-card' }),
      ...Array.from({ length: 10 }, (_, i) => tx(`pay-${i}`, `2026-${String(i + 1).padStart(2, '0')}-15`, -8000, 'Payroll', { merchant: 'Example Employer payroll', sourceName: 'Example Employer payroll', accountId: 'checking', flow: 'income', sourceCategoryDetailed: 'income_salary' })),
      ...['06', '07', '08', '09', '10'].map(month => tx(`rent-${month}`, `2026-${month}-05`, 2000, 'Housing', { merchant: 'Synthetic rent' })),
      tx('large-purchase', '2026-07-02', 2400.01, 'Shopping', { merchant: 'Example equipment' }),
      tx('threshold-exact', '2026-07-03', 1500, 'Shopping'),
      tx('threshold-above', '2026-07-04', 1500.01, 'Shopping'),
      tx('event-a', '2026-08-01', 600, 'Travel'), tx('event-b', '2026-08-02', 600, 'Travel'), tx('event-c', '2026-08-03', 600, 'Travel'),
      tx('event-credit', '2026-08-04', -100, 'Travel'),
      tx('unmatched-credit', '2026-08-04', -50, 'Shopping', { merchant: 'Example equipment' }),
      tx('periodic-fee', '2026-08-05', 1800, 'Financial & insurance', { merchant: 'Card membership fee' }),
      tx('exceptional', '2026-09-01', 1800, 'Tax settlement', { exceptional: true }),
      tx('pending', '2026-10-28', 9000, 'Shopping', { pending: true }),
      tx('transfer', '2026-10-01', 7000, 'Transfers', { flow: 'transfer' }),
      tx('zelle', '2026-10-01', 9000, 'Shopping', { merchant: 'Zelle to synthetic person', reviewDecision:'zelle' }),
      tx('apple', '2026-10-03', 40, 'Transfers', { accountId: 'checking', flow: 'transfer', merchant: 'Apple Card payment' }),
    ],
    coverage: { transactions: { is_complete_for_query: false, availability: 'ready', state: 'full_history', freshness: 'unknown' }, refresh: { start: '2026-08-29', end: '2026-10-28', bankPageCoverage: { availability: 'ready', is_complete_for_query: true } } },
    netWorthHistory: [
      { date: '2026-06-21', value: 100000, events: [{ account_name: 'Synthetic investment account', impact: 10000 }] },
      { date: '2026-07-01', value: 105000, events: [] }, { date: '2026-09-30', value: 120000, events: [] },
      { date: '2026-10-28', value: 124000, events: [] }, { date: '2026-10-29', value: 125000, events: [] },
    ], recurring: [], notes: ['Synthetic QA fixture only'],
    incomeEvidence: {
      version: 1, asOf: '2026-10-28', readAt: '2026-10-29T00:30:00Z', bankCoverage: {}, investmentCoverage: { isComplete: false, freshness: 'unknown', note: 'Synthetic evidence; completeness unknown' }, bankInflowCount: 10, bankInflowTotal: 80000, pendingInflowCount: 0,
      investmentRecords: [
        { id: 'synthetic-rsu', accountId: 'investments', date: '2026-05-15', description: 'EXMPL RSU receipt', amount: 0, quantity: 2, price: 0, fees: 0, ticker: 'EXMPL', type: 'buy', subtype: 'buy', currency: 'USD' },
        { id: 'synthetic-rsu-tax', accountId: 'investments', date: '2026-05-15', description: 'RSU federal income tax', amount: 100, quantity: 0, price: 0, fees: 0, ticker: 'EXMPL', type: 'cash', subtype: 'withdrawal', currency: 'USD' },
      ], accountHistory: [], rsuPrices: [{ date: '2026-05-15', ticker: 'EXMPL', price: 200, basis: 'regular-session close', source: 'Synthetic test quote', currency: 'USD' }], notes: [], sources: [],
    },
  };
  const plan = suggestBudgetPlan(dataset);
  const planning = { version: 1, goals: { version: 1, savings: { year: 2026, targetAmount: 50000, basis: 'cashAndEquity' }, netWorth: { targetAmount: 150000, targetDate: '2026-12-31' }, fire: { annualWithdrawalNeed: 40000, withdrawalRatePct: 4, eligibleAssets: 0, valuationDate: '2026-10-29', assetScope: 'Synthetic user-selected investable portfolio' } }, events: [{ id: 'synthetic-event', name: 'Synthetic trip', transactionIds: ['event-a', 'event-b', 'event-c', 'event-credit'], notes: 'Explicit test membership, not a merchant inference.' }] };
  return { dataset, overrides: {}, settings: { savingsTarget: 25 }, retirementOverrides: {}, reviewPreferences: { findingResolutions: {}, recurringStatuses: {} }, refresh: null, budget: plan, planning };
}
