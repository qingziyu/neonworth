// Invented examples only. Never derive these values from a real financial export.
export const DEMO_MARKER = 'Neonworth synthetic demo — no real accounts or activity';
export const DEMO_BROKERAGE_BALANCE = 231_576.48;
export function createDemoDataset(today = new Date().toISOString().slice(0, 10)) {
  const end = new Date(`${today}T12:00:00Z`);
  if (!Number.isFinite(end.getTime()) || end.toISOString().slice(0, 10) !== today) throw new Error('Invalid demo date.');
  const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11 + i, 1, 12)).toISOString().slice(0, 7));
  const transactions = [];
  const add = (id, date, merchant, amount, category, flow = 'expense', accountId = 'demo-card', extra = {}) => {
    if (date > today) return;
    transactions.push({ id, date, merchant, sourceName: merchant, amount, category, flow, accountId, confidence: 'HIGH', exceptional: false, pending: false, review: false, note: 'Invented demonstration record.', ...extra });
  };
  for (const [i, month] of months.entries()) {
    add(`pay-${month}`, `${month}-01`, 'Example Employer payroll', -5200, 'Payroll', 'income', 'demo-checking', { sourceCategoryDetailed: 'income_salary' });
    add(`rent-${month}`, `${month}-02`, 'Example Apartment', 1450, 'Housing', 'expense', 'demo-checking');
    add(`food-${month}`, `${month}-04`, 'Example Grocer', 280 + i * 7, 'Groceries');
    add(`dine-${month}`, `${month}-06`, 'Example Cafe', 65 + i * 3, 'Dining & coffee');
    add(`travel-${month}`, `${month}-09`, 'Example Transit', 95, 'Transport');
    add(`media-${month}`, `${month}-11`, 'Example Media', 18, 'Digital spending');
    add(`utilities-${month}`, `${month}-13`, 'Example Utilities', 110 + (i % 3) * 15, 'Housing');
    add(`shopping-${month}`, `${month}-17`, 'Example Store', 80 + (i % 4) * 40, 'Shopping');
    add(`card-payment-${month}`, `${month}-20`, 'Credit card payment', 600, 'Transfers', 'transfer', 'demo-checking', { sourceCategoryDetailed: 'transfers_credit_card_payment' });
    add(`card-credit-${month}`, `${month}-20`, 'Credit card payment received', -600, 'Transfers', 'transfer', 'demo-card', { sourceCategoryDetailed: 'transfers_credit_card_payment', transferTransactionId: `card-payment-${month}`, transferAccountId: 'demo-checking' });
    add(`interest-${month}`, `${month}-22`, 'Example Bank interest', -12, 'Interest', 'income', 'demo-checking', { sourceCategoryDetailed: 'income_interest_earned' });
  }
  add('demo-equipment', `${months[7]}-14`, 'Example Equipment', 1800, 'Shopping');
  add('demo-equipment-refund', `${months[7]}-19`, 'Example Equipment', -120, 'Shopping');
  add('demo-trip-stay', `${months[8]}-12`, 'Example Hotel', 900, 'Travel');
  add('demo-trip-transport', `${months[8]}-13`, 'Example Railway', 350, 'Travel');
  add('demo-review', today, 'Unidentified incoming payment', -75, 'Other', 'review', 'demo-checking', { review: true, confidence: 'LOW', note: 'Synthetic example: choose its accounting treatment after checking evidence.' });
  const account = (id, name, type, subtype, balance) => ({ id, name, institution: 'Example Institution', type, subtype, mask: '0000', balance: Math.abs(balance), netBalance: balance, balanceDate: today, balanceAgeKnown: true, syncStatus: 'synthetic' });
  const accounts = [
    account('demo-checking', 'Demo checking', 'depository', 'checking', 27_194.67),
    account('demo-card', 'Demo credit card', 'credit', 'credit card', -1_287.53),
    account('demo-investments', 'Demo investments', 'investment', 'brokerage', DEMO_BROKERAGE_BALANCE),
  ];
  // Work backward from today's balance. Steady savings and seeded market moves
  // give every demo run the same gains and drawdowns for a given date.
  const netWorthHistory = [];
  const historyStart = new Date(`${months[0]}-01T12:00:00Z`);
  let balanceCents = accounts.reduce((sum, { netBalance }) => sum + Math.round(netBalance * 100), 0);
  let movementSeed = 451;
  for (const date = new Date(end); date >= historyStart; date.setUTCDate(date.getUTCDate() - 1)) {
    netWorthHistory.push({ date: date.toISOString().slice(0, 10), value: balanceCents / 100, events: [] });
    movementSeed = (Math.imul(movementSeed, 1_664_525) + 1_013_904_223) >>> 0;
    const marketMoveCents = movementSeed % 180_001 - 90_000;
    balanceCents -= 10_000 + marketMoveCents;
  }
  return {
    version: 1, asOf: today, syncedAt: `${today}T12:00:00Z`, dateRange: { start: `${months[0]}-01`, end: today },
    accounts,
    transactions,
    netWorthHistory: netWorthHistory.reverse(),
    recurring: [],
    coverage: { transactions: { is_complete_for_query: true, availability: 'ready', state: 'synthetic', freshness: 'synthetic' }, accounts: { is_complete_for_query: true, availability: 'ready', state: 'synthetic', freshness: 'synthetic' } },
    notes: [DEMO_MARKER, 'All names, amounts, account balances and dates are illustrative. No bank connection exists.'],
  };
}
