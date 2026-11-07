import assert from 'node:assert/strict';
import { summarizeRsuTaxJournals } from '../lib/rsu-reconciliation.ts';

const record = (id, patch = {}) => ({ id, accountId: 'synthetic-broker', date: '2026-05-18', description: id, type: 'cash', subtype: 'withdrawal', amount: 0, quantity: 0, price: 0, fees: 0, currency: 'USD', ...patch });
const tax = record('tax', { description: 'JOURNALED RSU US Federal Incom (Cash)', amount: 90 });
const medicare = record('medicare', { description: 'JOURNALED RSU Medicare (Cash)', amount: 10 });
const refund = record('refund', { description: 'JOURNALED RSU Refund (Cash)', amount: 5 });
const sale = record('cover-sale', { date: '2026-05-15', ticker: 'EXMPL', description: 'EXAMPLE COMPANY - SHARE SALE (Cash)', type: 'sell', subtype: 'sell', amount: -105, quantity: -4, price: 26.25 });
const receipt = record('receipt', { date: '2026-05-15', ticker: 'EXMPL', description: 'YOU BOUGHT RSU123456 EXMPL', type: 'buy', subtype: 'buy', quantity: 10 });
const source = [tax, medicare, refund, sale, receipt];
const data = rows => ({ version: 1, asOf: '2026-10-25', syncedAt: '2026-10-25T00:00:00Z', dateRange: { start: '2026-01-01', end: '2026-10-25' }, coverage: {}, accounts: [], transactions: [], netWorthHistory: [], recurring: [], notes: [], incomeEvidence: { version: 1, investmentRecords: rows } });
const summarize = rows => summarizeRsuTaxJournals(data(rows), '2026-01-01', '2026-10-25');

const input = data(source), original = structuredClone(input);
const result = summarizeRsuTaxJournals(input, '2026-01-01', '2026-10-25');
assert.deepEqual(input, original, 'source records must not change');
assert.equal(result.total, 100);
assert.equal(result.journalCount, 2);
assert.equal(result.batches.length, 1);
const batch = result.batches[0], match = batch.settlement;
assert.equal(match.status, 'inferred');
assert.equal(match.proceeds, 105);
assert.equal(match.refundAmount, 5);
assert.equal(match.taxAmount, 100);
assert.equal(match.receiptShares, 10);
assert.equal(match.soldShares, 4);
assert.deepEqual(match.saleIds, ['cover-sale']);
assert.deepEqual(match.receiptIds, ['receipt']);
assert.deepEqual(match.taxIds, ['medicare', 'tax']);
assert.equal(match.refundId, 'refund');
assert.match(match.reason, /not an explicit provider link/);
assert.match(match.reason, /do not automatically change/);
assert.deepEqual(batch.entries, [medicare, tax]);
assert.notEqual(batch.entries[0], medicare, 'output source entries are copied');

// A nonmatching discretionary sale on the receipt date does not conceal the
// exact settlement, and arbitrary sums of sale records never create a match.
const extraSale = { ...sale, id: 'other-sale', amount: -40, quantity: -1 };
assert.deepEqual(summarize([...source, extraSale]).batches[0].settlement.saleIds, ['cover-sale']);
assert.equal(summarize([tax, medicare, refund, receipt, { ...sale, amount: -60 }, { ...extraSale, amount: -45 }]).batches[0].settlement, undefined);

for (const [label, rows] of [
  ['wrong sale account', source.map(row => row.id === sale.id ? { ...row, accountId: 'other' } : row)],
  ['wrong receipt account', source.map(row => row.id === receipt.id ? { ...row, accountId: 'other' } : row)],
  ['wrong refund account', source.map(row => row.id === refund.id ? { ...row, accountId: 'other' } : row)],
  ['refund missing', source.filter(row => row.id !== refund.id)],
  ['multiple refunds', [...source, { ...refund, id: 'refund-2', amount: 0.01 }]],
  ['multiple exact sales', [...source, { ...sale, id: 'sale-2' }]],
  ['multiple receipt dates', [...source, { ...sale, id: 'sale-2', date: '2026-05-16' }, { ...receipt, id: 'receipt-2', date: '2026-05-16' }]],
  ['multiple receipts on same date', [...source, { ...receipt, id: 'receipt-2' }]],
  ['missing explicit receipt', source.map(row => row.id === receipt.id ? { ...row, description: 'BUY EXMPL' } : row)],
  ['sold quantity exceeds receipt', source.map(row => row.id === sale.id ? { ...row, quantity: -11 } : row)],
  ['one cent mismatch', source.map(row => row.id === sale.id ? { ...row, amount: -105.01 } : row)],
  ['sale after journal batch', source.map(row => [sale.id, receipt.id].includes(row.id) ? { ...row, date: '2026-05-19' } : row)],
  ['sale eight days earlier', source.map(row => [sale.id, receipt.id].includes(row.id) ? { ...row, date: '2026-05-10' } : row)],
  ['nonpositive sale proceeds', source.map(row => row.id === sale.id ? { ...row, amount: 105 } : row)],
  ['nonnegative sale quantity', source.map(row => row.id === sale.id ? { ...row, quantity: 4 } : row)],
  ['nonpositive refund', source.map(row => row.id === refund.id ? { ...row, amount: -5 } : row)],
  ['wrong sale ticker', source.map(row => row.id === sale.id ? { ...row, ticker: 'AAPL' } : row)],
  ['wrong receipt ticker', source.map(row => row.id === receipt.id ? { ...row, ticker: 'AAPL' } : row)],
  ['wrong currency', source.map(row => row.id === sale.id ? { ...row, currency: 'CAD' } : row)],
  ['duplicate source identifier', [...source, { ...sale }]],
]) {
  const failedMatch = summarize(rows);
  assert.equal(failedMatch.total, 100, `${label}: actual tax journals remain visible`);
  assert.equal(failedMatch.batches[0].settlement, undefined, label);
}

const irrelevant = [
  record('unknown-rsu', { description: 'JOURNALED RSU cash', amount: 15 }),
  record('non-rsu-tax', { description: 'JOURNALED US Federal Income', amount: 20 }),
  record('reversed-tax', { description: 'RSU Medicare', amount: -10 }),
  record('zero-tax', { description: 'RSU tax', amount: 0 }),
  record('deposit-tax', { description: 'RSU Federal Income', amount: 50, subtype: 'deposit' }),
  record('foreign-tax', { description: 'RSU Medicare', amount: 50, currency: 'CAD' }),
  record('invalid-date', { description: 'RSU Medicare', date: '2026-02-30', amount: 50 }),
];
assert.equal(summarize([...source, ...irrelevant]).total, 100);
assert.deepEqual(summarize([]).batches, []);
assert.deepEqual(summarizeRsuTaxJournals({ ...data([]), incomeEvidence: undefined }, '2026-01-01', '2026-10-25').batches, []);

// A journal's posting date controls actual-period inclusion. Original sale and
// receipt dates remain available even if earlier than the selected range.
const narrow = summarizeRsuTaxJournals(data(source), '2026-05-18', '2026-05-18');
assert.equal(narrow.total, 100);
assert.equal(narrow.batches[0].settlement.saleDate, '2026-05-15');
assert.equal(summarizeRsuTaxJournals(data(source), '2026-05-01', '2026-05-17').total, 0);
assert.equal(summarizeRsuTaxJournals(data(source), '2026-05-19', '2026-06-01').total, 0);
const laterRefund = source.map(row => row.id === refund.id ? { ...row, date: '2026-05-19' } : row);
assert.equal(summarizeRsuTaxJournals(data(laterRefund), '2026-05-01', '2026-05-18').batches[0].settlement, undefined);
for (const [start, end] of [['2026-02-30', '2026-05-18'], ['2026-05-19', '2026-05-18'], ['not-a-date', '2026-05-18']]) assert.throws(() => summarizeRsuTaxJournals(data(source), start, end), /Invalid RSU journal period/);

// One sale/receipt cannot fund two apparent settlements. Resolve ambiguity over
// all available history through end, including batches outside the chosen start.
const reused = [...source, { ...tax, id: 'tax-later', date: '2026-05-19' }, { ...medicare, id: 'medicare-later', date: '2026-05-19' }, { ...refund, id: 'refund-later', date: '2026-05-19' }];
assert.ok(summarize(reused).batches.every(value => !value.settlement));
assert.equal(summarizeRsuTaxJournals(data(reused), '2026-05-19', '2026-05-19').batches[0].settlement, undefined);
const sevenDays = source.map(row => [sale.id, receipt.id].includes(row.id) ? { ...row, date: '2026-05-11' } : row);
assert.ok(summarize(sevenDays).batches[0].settlement);

console.log('RSU settlement tests: synthetic arithmetic, ticker/account matching, ambiguity, periods, source immutability.');
