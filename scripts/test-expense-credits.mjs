// Entirely invented synthetic values, dates, merchants and IDs. No source-record history.
import assert from 'node:assert/strict';
import { REFUND_INFERENCE_WINDOW_DAYS, resolveExpenseCredits } from '../lib/expense-credits.ts';

const account = (id, name, extra = {}) => ({ id, type: 'credit', subtype: 'credit card', name, institution: 'Example Issuer', mask: '0000', balance: 0, netBalance: 0, balanceDate: null, balanceAgeKnown: false, syncStatus: 'synced', ...extra });
const tx = (id, date, amount, merchant, extra = {}) => ({ id, date, amount, merchant, category: 'Shopping', accountId: 'card-a', flow: 'expense', confidence: 'HIGH', exceptional: false, note: '', pending: false, review: false, ...extra });
const dataset = () => ({
  version: 1, asOf: '2031-06-30', syncedAt: '2031-07-01T00:00:00Z', dateRange: { start: '2031-01-01', end: '2031-06-30' },
  accounts: [account('card-a', 'Synthetic Card A'), account('card-b', 'Synthetic Card B'), account('plat', 'Amex Platinum', { institution: 'American Express', officialName: 'Amex Platinum' })],
  transactions: [
    // Approved descriptor patterns: broad purpose, never a specific purchase.
    tx('d-digital', '2031-02-01', -11.11, 'Platinum Digital Entertainment Credit', { category: 'Entertainment' }),
    tx('d-resy', '2031-02-02', -22.22, 'Restaurant statement', { sourceName: 'PLATINUM RESY CREDIT', category: 'Dining & coffee' }),
    tx('d-lulu', '2031-02-03', -33.33, 'Platinum Lululemon Credit'),
    tx('d-clear', '2031-02-04', -44.44, 'AMEX CLEAR PLUS CREDIT', { category: 'Travel' }),
    tx('d-saks', '2031-02-05', -55.55, 'PLATINUM SAKS CREDIT'),
    tx('oura-hardware', '2031-02-01', 300, 'Oura Ring Inc', { category: 'Shopping' }),
    tx('d-oura', '2031-02-06', -66.66, 'Platinum Oura Ring Credit'),
    tx('d-fee', '2031-02-07', -77.77, 'ADJUST MEMBERSHIP FEE', { category: 'Financial & insurance' }),
    tx('d-points', '2031-02-08', -88.88, 'Points for Amex Trvl', { category: 'Travel' }),
    tx('d-hotel', '2031-02-09', -99.99, 'Platinum Hotel Credit', { category: 'Travel' }),
    tx('d-air', '2031-02-10', -12.34, 'amex airline fee reimbursement', { category: 'Travel' }),
    // Full refund, blank note, no refund word.
    tx('r-charge', '2031-03-01', 84.2, 'Example Outfitters'), tx('r-credit', '2031-03-20', -84.2, 'Example Outfitters'),
    tx('s-charge', '2031-03-20', 9.5, 'Example Cafe Supply'), tx('s-credit', '2031-03-20', -9.5, 'Example Cafe Supply'),
    // Wrong account / wrong merchant / prior credit before a future charge.
    tx('w-charge', '2031-03-02', 45, 'Example Kitchenware'), tx('w-credit', '2031-03-10', -45, 'Example Kitchenware', { accountId: 'card-b' }),
    tx('m-charge', '2031-03-03', 19.99, 'Example Bookshop'), tx('m-credit', '2031-03-05', -19.99, 'Example Toystore'),
    tx('f-credit', '2031-03-01', -60, 'Example Lamps'), tx('f-charge', '2031-03-05', 60, 'Example Lamps'),
    // Two candidate purchases; competing credits; partial; over-capacity.
    tx('t-charge-1', '2031-03-01', 120, 'Example Shoes'), tx('t-charge-2', '2031-03-08', 120, 'Example Shoes'), tx('t-credit', '2031-03-15', -120, 'Example Shoes'),
    tx('c-charge', '2031-03-01', 30, 'Example Games'), tx('c-credit-1', '2031-03-04', -30, 'Example Games'), tx('c-credit-2', '2031-03-06', -30, 'Example Games'),
    tx('p-charge', '2031-03-01', 100, 'Example Furniture'), tx('p-credit', '2031-03-09', -40, 'Example Furniture'),
    tx('o-charge', '2031-03-01', 20, 'Example Garden'), tx('o-credit', '2031-03-09', -50, 'Example Garden'),
    // 90-day inclusive boundary versus 91 days.
    tx('n-charge', '2031-01-02', 75, 'Example Audio'), tx('n-credit', '2031-04-02', -75, 'Example Audio'),
    tx('n2-charge', '2031-01-01', 75, 'Example Camera'), tx('n2-credit', '2031-04-02', -75, 'Example Camera'),
    // Protected manual decisions.
    tx('pr-charge', '2031-03-01', 50, 'Example Tickets'), tx('pr-credit', '2031-03-02', -50, 'Example Tickets', { classificationOverrides: { category: 'Travel' } }),
    tx('rd-charge', '2031-03-01', 70, 'Example Sports'), tx('rd-credit', '2031-03-02', -70, 'Example Sports', { reviewDecision: 'reimbursement' }),
    // Generic reward and a note that tries to allocate.
    tx('g-credit', '2031-03-11', -25, 'Rewards statement credit'),
    tx('note-charge', '2031-03-01', 33, 'Example Pottery'), tx('note-credit', '2031-03-02', -33, 'Example Candles', { note: 'refund of note-charge from Example Pottery; link to note-charge' }),
    // Reused IDs.
    tx('dup-credit', '2031-03-12', -15, 'Example Rugs'), tx('dup-credit', '2031-03-13', -15, 'Example Rugs'),
    tx('dc-charge', '2031-03-01', 25, 'Example Frames'), tx('dc-charge', '2031-03-02', 25, 'Example Frames'), tx('dc-credit', '2031-03-05', -25, 'Example Frames'),
    // Reused credit ID whose duplicate rows carry DIFFERENT descriptors (benefit vs merchant).
    tx('dd-credit', '2031-03-14', -18, 'Platinum Hotel Credit', { category: 'Travel' }), tx('dd-credit', '2031-03-14', -18, 'Example Lanterns'),
    // Full refund plus a competing partial credit against one lone prior charge (over-capacity).
    tx('fp-charge', '2031-04-01', 1100.01, 'Example Atlas Goods'), tx('fp-full', '2031-04-20', -1100.01, 'Example Atlas Goods'), tx('fp-part', '2031-05-01', -100, 'Example Atlas Goods'),
    // Control: a lone full refund on another merchant with no competing credit is still inferred.
    tx('fo-charge', '2031-04-01', 1100.01, 'Example Beacon Goods'), tx('fo-full', '2031-04-20', -1100.01, 'Example Beacon Goods'),
    // Oura membership charge must never be the target of the hardware benefit.
    tx('oura-membership', '2031-02-02', 5.99, 'Ouraring', { category: 'Services' }),
    // Not posted expense credits: excluded from the result.
    tx('pending-credit', '2031-03-01', -5, 'Example Pending', { pending: true }),
    tx('income-credit', '2031-03-01', -5000, 'Example Employer', { flow: 'income', category: 'Payroll' }),
    tx('transfer-credit', '2031-03-01', -500, 'Example Transfer', { flow: 'transfer', category: 'Transfers' }),
    tx('review-credit', '2031-03-01', -500, 'Example Unknown', { flow: 'review', category: 'Unresolved' }),
    tx('zelle-credit', '2031-03-01', -40, 'Zelle from example person', {reviewDecision:'zelle'}),
    tx('after-end', '2031-07-02', -10, 'Example Outfitters'),
    // Conservative Walmart+ benefit pattern: three distinct monthly same-day exact pairs on Amex Platinum.
    ...['01', '02', '03'].flatMap(m => [tx(`wm-c${m}`, `2031-${m}-10`, 12.95, 'Walmart+', { accountId: 'plat', category: 'Services' }), tx(`wm-r${m}`, `2031-${m}-10`, -12.95, 'Walmart', { accountId: 'plat', category: 'Shopping' })]),
  ],
  coverage: {}, netWorthHistory: [], recurring: [], notes: ['Synthetic resolver fixture'],
});

const data = dataset(), before = JSON.stringify(data);
const result = resolveExpenseCredits(data), byId = new Map(result.map(row => [row.creditId, row]));
const get = id => { const row = byId.get(id); assert.ok(row, `missing attribution for ${id}`); return row; };
const expect = (id, fields) => { const row = get(id); for (const [key, value] of Object.entries(fields)) assert.deepEqual(row[key], value, `${id}.${key}`); };

assert.equal(REFUND_INFERENCE_WINDOW_DAYS, 90);
assert.deepEqual(result.map(row => row.creditId), [...result.map(row => row.creditId)].sort(), 'Deterministic credit-ID order');
assert.equal(new Set(result.map(row => row.creditId)).size, result.length, 'One record per credit ID');
for (const id of ['pending-credit', 'income-credit', 'transfer-credit', 'review-credit', 'zelle-credit', 'after-end', 'r-charge', 'oura-hardware']) assert.ok(!byId.has(id), `${id} is not a posted expense credit through the end date`);

// Descriptor mappings.
expect('d-digital', { kind: 'card_benefit', status: 'category_only', purpose: 'digital', serviceMerchant: null, purchaseId: null, candidatePurchaseIds: [] });
expect('d-resy', { kind: 'card_benefit', status: 'category_only', purpose: 'dining', purchaseId: null });
expect('d-lulu', { kind: 'card_benefit', status: 'category_only', purpose: 'clothing', purchaseId: null });
expect('d-clear', { kind: 'card_benefit', status: 'category_only', purpose: 'periodic_fixed', serviceMerchant: 'CLEAR', purchaseId: null });
expect('d-saks', { kind: 'card_benefit', status: 'category_only', purpose: 'retail', purchaseId: null });
expect('d-oura', { kind: 'card_benefit', status: 'category_only', purpose: 'retail', serviceMerchant: null, purchaseId: null, candidatePurchaseIds: [] });
expect('d-fee', { kind: 'fee_adjustment', status: 'category_only', purpose: 'periodic_fixed', purchaseId: null });
expect('d-points', { kind: 'general_statement_credit', status: 'unallocated', purpose: null, purchaseId: null });
expect('d-hotel', { kind: 'card_benefit', status: 'category_only', purpose: 'travel', purchaseId: null });
expect('d-air', { kind: 'card_benefit', status: 'category_only', purpose: 'travel', purchaseId: null });

// Refund inference.
expect('r-credit', { kind: 'purchase_refund', status: 'inferred_purchase', purchaseId: 'r-charge', candidatePurchaseIds: ['r-charge'], confidence: 'medium' });
assert.match(get('r-credit').reason, /Inferred/); assert.match(get('r-credit').reason, /Not provider-confirmed/);
expect('s-credit', { status: 'inferred_purchase', purchaseId: 's-charge' });
expect('w-credit', { status: 'unallocated', purchaseId: null, candidatePurchaseIds: [] });
expect('m-credit', { status: 'unallocated', purchaseId: null });
expect('f-credit', { status: 'unallocated', purchaseId: null, candidatePurchaseIds: [] });
expect('t-credit', { status: 'ambiguous', purchaseId: null, candidatePurchaseIds: ['t-charge-1', 't-charge-2'] });
expect('c-credit-1', { status: 'ambiguous', purchaseId: null, candidatePurchaseIds: ['c-charge'] });
expect('c-credit-2', { status: 'ambiguous', purchaseId: null, candidatePurchaseIds: ['c-charge'] });
expect('p-credit', { status: 'category_only', purchaseId: null, candidatePurchaseIds: ['p-charge'] });
expect('o-credit', { status: 'unallocated', purchaseId: null });
expect('n-credit', { status: 'inferred_purchase', purchaseId: 'n-charge' });
expect('n2-credit', { status: 'unallocated', purchaseId: null });
expect('pr-credit', { status: 'manual', purpose: null, purchaseId: null, candidatePurchaseIds: [] });
expect('rd-credit', { status: 'manual', purpose: null, purchaseId: null });
expect('g-credit', { kind: 'general_statement_credit', status: 'unallocated', purpose: null, purchaseId: null });
expect('note-credit', { status: 'unallocated', purchaseId: null, candidatePurchaseIds: [] });
expect('dup-credit', { status: 'ambiguous', purchaseId: null });
expect('dc-credit', { status: 'ambiguous', purchaseId: null });
assert.equal(result.filter(row => row.creditId === 'dup-credit').length, 1);
// Reused ID with different descriptors: conservative, never takes the first row's descriptor.
expect('dd-credit', { kind: 'unclassified', status: 'ambiguous', purpose: null, serviceMerchant: null, purchaseId: null, candidatePurchaseIds: [], confidence: 'unknown' });
assert.equal(result.filter(row => row.creditId === 'dd-credit').length, 1);
for (const order of [[0, 1], [1, 0]]) {
  const swapped = dataset(), rows = swapped.transactions.filter(row => row.id === 'dd-credit'), others = swapped.transactions.filter(row => row.id !== 'dd-credit');
  swapped.transactions = [...order.map(i => rows[i]), ...others];
  assert.deepEqual(new Map(resolveExpenseCredits(swapped).map(row => [row.creditId, row])).get('dd-credit'), get('dd-credit'), 'Duplicate-ID attribution is independent of row order');
}
// Over-capacity: -1100.01 and -100 both plausibly draw on the lone 1100.01 charge, so the full match is not asserted.
expect('fp-full', { kind: 'unclassified', status: 'ambiguous', purchaseId: null, candidatePurchaseIds: ['fp-charge'], confidence: 'unknown' });
expect('fp-part', { status: 'category_only', purchaseId: null, candidatePurchaseIds: ['fp-charge'] });
expect('fo-full', { kind: 'purchase_refund', status: 'inferred_purchase', purchaseId: 'fo-charge', candidatePurchaseIds: ['fo-charge'] });
// Without the partial credit, the same full refund is inferred (the rule is about competition, not amount).
const noPartial = dataset(); noPartial.transactions = noPartial.transactions.filter(row => row.id !== 'fp-part');
assert.equal(new Map(resolveExpenseCredits(noPartial).map(row => [row.creditId, row])).get('fp-full').purchaseId, 'fp-charge');
// Exact evidence takes priority: the smaller refund has its own exact purchase,
// so it must not also consume capacity on a different, larger purchase.
const separatePurchases = { ...dataset(), transactions: [
  tx('price-large', '2031-05-01', 1400.21, 'Example Price Store'),
  tx('price-small', '2031-05-02', 450.07, 'Example Price Store'),
  tx('refund-large', '2031-05-10', -1400.21, 'Example Price Store'),
  tx('refund-small', '2031-05-11', -450.07, 'Example Price Store'),
] };
const separateBefore = JSON.stringify(separatePurchases);
const separate = resolveExpenseCredits(separatePurchases);
assert.deepEqual(separate.map(row => [row.creditId, row.status, row.purchaseId]), [
  ['refund-large', 'inferred_purchase', 'price-large'],
  ['refund-small', 'inferred_purchase', 'price-small'],
], 'Two different-price purchases and their exact refunds remain independently attributable');
// A partial credit with two plausible purchases is not allocated to either.
// It therefore cannot be treated as proven consumption of both purchases.
const ambiguousPartial = { ...separatePurchases, transactions: [
  ...separatePurchases.transactions.filter(row => row.id !== 'refund-small'),
  tx('partial-uncertain', '2031-05-12', -45.13, 'Example Price Store'),
] };
const ambiguousPartialResult = new Map(resolveExpenseCredits(ambiguousPartial).map(row => [row.creditId, row]));
assert.equal(ambiguousPartialResult.get('refund-large').purchaseId, 'price-large');
assert.equal(ambiguousPartialResult.get('partial-uncertain').purchaseId, null);
assert.equal(ambiguousPartialResult.get('partial-uncertain').status, 'category_only');
assert.deepEqual(ambiguousPartialResult.get('partial-uncertain').candidatePurchaseIds, ['price-large', 'price-small']);
for (const sample of [separatePurchases, ambiguousPartial]) {
  assert.deepEqual(resolveExpenseCredits({ ...sample, transactions: [...sample.transactions].reverse() }), resolveExpenseCredits(sample), 'Candidate priority stays independent of row order');
}
assert.equal(JSON.stringify(separatePurchases), separateBefore, 'Candidate competition does not mutate source rows');
// Oura hardware benefit stays retail with no service identity and never targets the membership charge.
for (const row of result) assert.notEqual(row.purchaseId, 'oura-membership');
assert.ok(!get('d-oura').candidatePurchaseIds.includes('oura-membership'));
for (const row of result) if (row.purchaseId) assert.ok(['inferred_purchase'].includes(row.status), 'Only inferred statuses carry a purchase ID');
for (const row of result) assert.doesNotMatch(row.reason, /(?<!not )provider-confirmed/i, 'No attribution claims provider confirmation');

// Conservative Walmart+ pattern (requires the existing classification helpers to recognize Walmart+ and the Amex Platinum card).
for (const m of ['01', '02', '03']) expect(`wm-r${m}`, { kind: 'card_benefit', status: 'inferred_purchase', purpose: 'digital', serviceMerchant: 'Walmart+', purchaseId: `wm-c${m}` });
const twoMonths = dataset(); twoMonths.transactions = twoMonths.transactions.filter(row => !['wm-c03', 'wm-r03'].includes(row.id));
const twoMonthResult = new Map(resolveExpenseCredits(twoMonths).map(row => [row.creditId, row]));
for (const m of ['01', '02']) { const row = twoMonthResult.get(`wm-r${m}`); assert.notEqual(row.kind, 'card_benefit'); assert.equal(row.purchaseId, null, 'Walmart retail credit never pairs with a Walmart+ membership charge without the pattern'); }

// End-date bound: charges and credits after `end` are not considered.
assert.ok(!new Map(resolveExpenseCredits(data, '2031-03-19').map(row => [row.creditId, row])).has('r-credit'));

// Determinism under row-order reversal, and inputs unchanged.
const reversed = dataset(); reversed.transactions.reverse(); reversed.accounts.reverse();
assert.deepEqual(resolveExpenseCredits(reversed), result);
assert.equal(JSON.stringify(data), before, 'Resolver does not mutate input');
console.log('Expense credits: descriptor purposes without purchases, blank-note same-account refunds, 90-day boundary, wrong account/merchant/future, ambiguous/competing/partial/over-capacity, full+partial over-capacity, manual protection, generic rewards, note immunity, reused IDs (order-independent across differing descriptors), Oura hardware isolation, Walmart+ pattern, determinism and immutability verified.');
