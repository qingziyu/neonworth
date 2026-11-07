import assert from 'node:assert/strict';
import { MAJOR_SPEND_THRESHOLD, MAJOR_SPEND_THRESHOLD_CENTS, exceedsMajorSpendThreshold, summarizeYearReview, validateReviewEvents } from '../lib/year-review.ts';
import { financialReviewFixture } from './test-support/financial-review-fixture.mjs';

const fixture = financialReviewFixture(), { budget: plan } = fixture, events = fixture.planning.events, before = JSON.stringify(fixture);
// Local synthetic threshold cases: the shared fixture amounts stay unchanged for unrelated tests.
const data = structuredClone(fixture.dataset);
data.transactions.find(row => row.id === 'threshold-exact').amount = 1000;
data.transactions.find(row => row.id === 'threshold-above').amount = 1000.01;
const shopping = (id, date, amount, extra = {}) => ({ id, date, amount, category: 'Shopping', merchant: `Synthetic ${id}`, accountId: 'old-card', flow: 'expense', confidence: 'HIGH', exceptional: false, note: '', pending: false, review: false, ...extra });
data.transactions.push(shopping('threshold-below', '2026-07-05', 999.99));

assert.equal(MAJOR_SPEND_THRESHOLD_CENTS, 100000); assert.equal(MAJOR_SPEND_THRESHOLD, 1000);
assert.equal(exceedsMajorSpendThreshold(1000), false); assert.equal(exceedsMajorSpendThreshold(1000.01), true); assert.equal(exceedsMajorSpendThreshold(999.99), false);
const report = summarizeYearReview(data, plan, 2026, events);
assert.equal(report.threshold, 1000); assert.match(report.thresholdLabel, /over \$1,000/); assert.doesNotMatch(report.thresholdLabel, /1,500/);
assert.equal(report.period.requestedStart, '2026-01-01'); assert.equal(report.period.end, '2026-10-28');
const ids = report.purchases.map(row => row.id);
assert.ok(ids.includes('threshold-above'), '1000.01 qualifies'); assert.ok(!ids.includes('threshold-exact'), 'exactly 1000 is excluded'); assert.ok(!ids.includes('threshold-below'), '999.99 is excluded');
assert.ok(report.eligibleTransactions.some(row => row.id === 'threshold-below'), 'Below-threshold nonroutine rows stay eligible for explicit events');
for (const id of ['periodic-fee', 'rent-06', 'pending', 'transfer', 'zelle', 'apple', 'old-year-purchase']) assert.ok(!report.eligibleTransactions.some(row => row.id === id), id + ' cannot become nonroutine year spending');
assert.deepEqual(ids.sort(), ['exceptional', 'large-purchase', 'threshold-above'].sort());
assert.equal(report.events[0].net, 1700); assert.equal(report.events[0].gross, 1800); assert.equal(report.events[0].credits, 100); assert.equal(report.events[0].qualifies, true);
assert.equal(report.union.total, 6900.02); assert.equal(report.union.count, 4);
assert.equal(new Set(report.union.ids).size, report.union.ids.length);
assert.equal(report.purchaseView.reduce((n, row) => n + Math.round(row.amount * 100), 0), Math.round(report.union.total * 100));
assert.deepEqual(report.unmatchedCredits.map(row => row.id), ['unmatched-credit'], 'Same merchant credit is not linked automatically');
const unmatched = report.unmatchedCredits[0];
assert.equal(unmatched.credit?.status, 'category_only', 'A partial same-merchant credit offsets its category only');
assert.equal(unmatched.credit?.purchaseId, null);
assert.doesNotThrow(() => validateReviewEvents(data, plan, events));
const overlap = [...events, { id: 'overlap', name: 'Overlapping event', transactionIds: ['event-a'] }];
assert.throws(() => validateReviewEvents(data, plan, overlap));
const ambiguous = summarizeYearReview(data, plan, 2026, overlap); assert.equal(ambiguous.events.length, 0); assert.equal(ambiguous.eventIssues.length, 2);
assert.equal(ambiguous.union.ids.length, new Set(ambiguous.union.ids).size);
assert.throws(() => validateReviewEvents(data, plan, [{ id: 'dupe', name: 'Duplicate', transactionIds: ['event-a', 'event-a'] }]));
assert.throws(() => validateReviewEvents(data, plan, [{ id: 'fixed', name: 'Fixed bill', transactionIds: ['periodic-fee'] }]));
assert.throws(() => validateReviewEvents(data, plan, [{ id: 'missing', name: 'Missing', transactionIds: ['no-such-row'] }]));
const cross = [{ id: 'cross', name: 'Cross-year explicit event', transactionIds: ['old-year-purchase', 'event-a', 'event-b', 'event-c', 'event-credit'] }];
assert.equal(summarizeYearReview(data, plan, 2025, cross).events[0].net, 2000);
assert.equal(summarizeYearReview(data, plan, 2026, cross).events[0].net, 1700);
assert.equal(summarizeYearReview(data, plan, 2026, cross).events[0].outsideYearCount, 1);
const groupedLarge = summarizeYearReview(data, plan, 2026, [{ id: 'large', name: 'Explicit large purchase and credit', transactionIds: ['large-purchase', 'unmatched-credit'] }]);
assert.ok(!groupedLarge.purchases.some(row => row.id === 'large-purchase')); assert.equal(groupedLarge.events[0].net, 2350.01);
assert.equal(groupedLarge.purchaseView.filter(row => row.id === 'large-purchase').length, 1);
// Event boundaries: 1000 does not qualify; 1000.01 does; the row is counted once.
const below = summarizeYearReview(data, plan, 2026, [{ id: 'small', name: 'Exactly threshold', transactionIds: ['threshold-exact'] }]);
assert.equal(below.events[0].qualifies, false);
const aboveEvent = summarizeYearReview(data, plan, 2026, [{ id: 'above', name: 'Just above threshold', transactionIds: ['threshold-above'] }]);
assert.equal(aboveEvent.events[0].qualifies, true); assert.ok(!aboveEvent.purchases.some(row => row.id === 'threshold-above'));
assert.equal(aboveEvent.purchaseView.filter(row => row.id === 'threshold-above').length, 1, 'An event member cannot also be a standalone purchase');
// Below-threshold members together form a qualifying event (integer-cent sums).
const members = structuredClone(data); members.transactions.push(shopping('member-x', '2026-06-10', 600), shopping('member-y', '2026-06-11', 400.01), shopping('member-z', '2026-06-12', 400));
const formed = summarizeYearReview(members, plan, 2026, [{ id: 'formed', name: 'Small purchases together', transactionIds: ['member-x', 'member-y'] }]);
assert.equal(formed.events[0].gross, 1000.01); assert.equal(formed.events[0].qualifies, true);
assert.ok(!formed.purchases.some(row => row.id === 'member-x' || row.id === 'member-y'));
assert.equal(summarizeYearReview(members, plan, 2026, [{ id: 'flat', name: 'Exactly 1000 together', transactionIds: ['member-x', 'member-z'] }]).events[0].qualifies, false);
// Fractional cents round to integer cents before comparison.
const fractional = structuredClone(data); fractional.transactions.push(shopping('frac-low', '2026-06-20', 1000.004), shopping('frac-high', '2026-06-21', 1000.006));
const fractionalIds = summarizeYearReview(fractional, plan, 2026, events).purchases.map(row => row.id);
assert.ok(!fractionalIds.includes('frac-low')); assert.ok(fractionalIds.includes('frac-high'));
const reducedTrip = structuredClone(data); reducedTrip.transactions.find(row => row.id === 'event-credit').amount = -500;
const reducedReport = summarizeYearReview(reducedTrip, plan, 2026, events);
assert.equal(reducedReport.events[0].gross, 1800); assert.equal(reducedReport.events[0].net, 1300);
assert.equal(reducedReport.events[0].qualifies, true, 'Attributed credits do not erase a major event');
assert.equal(reducedReport.union.total, 6500.02);
const refunded = structuredClone(data), template = data.transactions.find(row => row.id === 'large-purchase');
refunded.transactions.push({ ...template, id: 'refunded-purchase', date: '2026-09-02', amount: 1600 }, { ...template, id: 'explicit-refund', date: '2026-09-03', amount: -200, note: '' });
const refundEvent = [{ id: 'refund-event', name: 'Explicitly refunded purchase', transactionIds: ['refunded-purchase', 'explicit-refund'] }];
const partlyRefunded = summarizeYearReview(refunded, plan, 2026, refundEvent);
assert.equal(partlyRefunded.events[0].qualifies, true); assert.equal(partlyRefunded.events[0].net, 1400);
assert.ok(!partlyRefunded.purchases.some(row => row.id === 'refunded-purchase'));
refunded.transactions.find(row => row.id === 'explicit-refund').amount = -1600;
const fullyRefunded = summarizeYearReview(refunded, plan, 2026, refundEvent);
assert.equal(fullyRefunded.events[0].qualifies, true); assert.equal(fullyRefunded.events[0].net, 0);
assert.equal(fullyRefunded.events[0].gross, 1600); assert.equal(fullyRefunded.events[0].credits, 1600);
assert.equal(fullyRefunded.union.eventCount, 1); assert.ok(fullyRefunded.union.ids.includes('refunded-purchase'));
assert.ok(fullyRefunded.union.ids.includes('explicit-refund'));
assert.equal(fullyRefunded.purchaseView.reduce((total, row) => total + Math.round(row.amount * 100), 0), Math.round(fullyRefunded.union.total * 100));
assert.equal(fullyRefunded.thresholdBasis, 'gross_charges');
// A unique same-year inferred refund of a qualifying standalone purchase is attached to it
// (gross, inferred credit and net together); no event is created and saved events are unchanged.
const eventsBefore = JSON.stringify(events);
const ungroupedRefund = summarizeYearReview(refunded, plan, 2026, events);
const inferred = ungroupedRefund.eligibleTransactions.find(row => row.id === 'explicit-refund');
assert.equal(inferred.credit?.status, 'inferred_purchase'); assert.equal(inferred.credit?.purchaseId, 'refunded-purchase');
assert.equal(ungroupedRefund.events.length, 1); assert.deepEqual(ungroupedRefund.events[0].ids.sort(), [...events[0].transactionIds].sort());
assert.ok(ungroupedRefund.purchases.some(row => row.id === 'refunded-purchase'), 'A fully refunded major purchase stays visible as a standalone charge');
assert.ok(!ungroupedRefund.unmatchedCredits.some(row => row.id === 'explicit-refund'), 'The attached refund is no longer an undifferentiated ungrouped credit');
const refundedItem = ungroupedRefund.standalone.find(item => item.purchase.id === 'refunded-purchase');
assert.deepEqual(refundedItem.ids, ['refunded-purchase', 'explicit-refund']);
assert.equal(Math.round(refundedItem.gross * 100), 160000); assert.equal(Math.round(refundedItem.inferredCredits * 100), 160000); assert.equal(Math.round(refundedItem.net * 100), 0);
assert.equal(Math.round(ungroupedRefund.union.total * 100), Math.round(report.union.total * 100), 'Fully refunded standalone: +1600 gross −1600 inferred = unchanged union total');
assert.ok(ungroupedRefund.union.ids.includes('refunded-purchase') && ungroupedRefund.union.ids.includes('explicit-refund'));
assert.equal(ungroupedRefund.purchaseView.find(row => row.id === 'explicit-refund').attachedToPurchaseId, 'refunded-purchase');
assert.equal(JSON.stringify(events), eventsBefore, 'Saved events are not mutated');
const proxy = structuredClone(data);
Object.assign(proxy.transactions.find(row => row.id === 'apple'), { amount: 2500, exceptional: true });
const proxyReport = summarizeYearReview(proxy, plan, 2026, events);
assert.ok(!proxyReport.eligibleTransactions.some(row => row.id === 'apple'), 'A payment proxy cannot become an itemized major purchase through exceptional classification');
assert.equal(proxyReport.union.total, report.union.total);
assert.throws(() => validateReviewEvents(proxy, plan, [{ id: 'proxy-event', name: 'Invalid aggregate proxy event', transactionIds: ['apple'] }]));
const unresolved = structuredClone(data);
for (const [id, amount, extra] of [['unknown-outflow', 2000, {}], ['unknown-inflow', -2000, {}], ['unknown-exact', 1000, {}], ['unknown-above', 1000.01, {}], ['unknown-neg-exact', -1000, {}], ['unknown-neg-above', -1000.01, {}], ['unknown-pending', 2000, { pending: true }], ['unknown-zelle', 2000, { merchant: 'Zelle unresolved activity' }]]) {
  unresolved.transactions.push({ ...template, id, date: '2026-08-09', amount, merchant: 'Unresolved source activity', category: 'Unresolved', flow: 'review', review: true, classificationOverrides: { flow: 'review', review: true }, ...extra });
}
unresolved.transactions.find(row => row.id === 'large-purchase').review = true;
const unresolvedReport = summarizeYearReview(unresolved, plan, 2026, events);
assert.deepEqual(unresolvedReport.unclassifiedLargeActivity.map(row => row.id).sort(), ['unknown-above', 'unknown-inflow', 'unknown-neg-above', 'unknown-outflow', 'unknown-zelle']);
assert.equal(unresolvedReport.union.total, report.union.total, 'Unresolved flow stays outside spending; an already-counted expense review flag does not become uncounted activity');
assert.equal(unresolvedReport.recordedNonroutineTotal, report.recordedNonroutineTotal);
assert.equal(summarizeYearReview(unresolved, plan, 2025, events).unclassifiedLargeActivity.length, 0);
const future = summarizeYearReview(data, plan, 2027, events); assert.equal(future.period.empty, true); assert.equal(future.union.total, 0); assert.equal(future.union.count, 0);

// ---- Supported refund attribution in the major-spend union (entirely synthetic rows) ----
const attribution = () => {
  const d = structuredClone(data);
  d.transactions.push(
    // A: unique full refund, blank note, no refund word → attached; fully refunded still qualifies by gross.
    shopping('yr-a-charge', '2026-03-10', 1250.5, { merchant: 'Example Atlas Store' }), shopping('yr-a-credit', '2026-04-01', -1250.5, { merchant: 'Example Atlas Store' }),
    // B: full + competing partial credit against one lone charge → neither attached; charge stays gross.
    shopping('yr-b-charge', '2026-05-01', 1100.01, { merchant: 'Example Birch Outfitters' }), shopping('yr-b-full', '2026-05-20', -1100.01, { merchant: 'Example Birch Outfitters' }), shopping('yr-b-part', '2026-05-25', -100, { merchant: 'Example Birch Outfitters' }),
    // C/D: exact-threshold and below-threshold charges with unique refunds → evidence only.
    shopping('yr-c-charge', '2026-06-01', 1000, { merchant: 'Example Cedar Goods' }), shopping('yr-c-credit', '2026-06-05', -1000, { merchant: 'Example Cedar Goods' }),
    shopping('yr-d-charge', '2026-06-10', 999.99, { merchant: 'Example Dune Supply' }), shopping('yr-d-credit', '2026-06-12', -999.99, { merchant: 'Example Dune Supply' }),
    // E: two candidate purchases → ambiguous.
    shopping('yr-e-charge-1', '2026-07-01', 1300, { merchant: 'Example Elm Audio' }), shopping('yr-e-charge-2', '2026-07-05', 1300, { merchant: 'Example Elm Audio' }), shopping('yr-e-credit', '2026-07-10', -1300, { merchant: 'Example Elm Audio' }),
    // F: protected manual correction → manual, never attached.
    shopping('yr-f-charge', '2026-07-01', 1400, { merchant: 'Example Fern Tools' }), shopping('yr-f-credit', '2026-07-03', -1400, { merchant: 'Example Fern Tools', classificationOverrides: { category: 'Shopping' } }),
    // G: same amount and merchant on a different account → not linked.
    shopping('yr-g-charge', '2026-07-01', 1500, { merchant: 'Example Grove Lighting' }), shopping('yr-g-credit', '2026-07-08', -1500, { merchant: 'Example Grove Lighting', accountId: 'later-card' }),
    // H: cross-year pair → each stays in its posting year; disclosure only.
    shopping('yr-h-charge', '2025-12-15', 1700, { merchant: 'Example Harbor Rugs' }), shopping('yr-h-credit', '2026-01-10', -1700, { merchant: 'Example Harbor Rugs' }),
    // I: the refund is already in a different valid event → counted there only.
    shopping('yr-i-charge', '2026-08-01', 1800, { merchant: 'Example Iris Rentals' }), shopping('yr-i-credit', '2026-08-10', -1800, { merchant: 'Example Iris Rentals' }), shopping('yr-i-member', '2026-08-12', 300, { merchant: 'Example Juniper Crafts' }),
    // J: purchase in a saved event; its unselected inferred refund is read-only evidence.
    shopping('yr-j-charge', '2026-09-01', 2100, { merchant: 'Example Jasper Gear' }), shopping('yr-j-credit', '2026-09-15', -2100, { merchant: 'Example Jasper Gear' }),
    // Purpose benefit and generic rewards credits.
    shopping('yr-hotel', '2026-08-20', -75, { merchant: 'Platinum Hotel Credit', category: 'Travel' }),
    shopping('yr-points', '2026-08-21', -40, { merchant: 'Points for Amex Trvl', category: 'Travel' }),
  );
  return d;
};
const attrData = attribution(), attrDataBefore = JSON.stringify(attrData);
const attrEvents = [...structuredClone(events), { id: 'yr-other', name: 'Other explicit event', transactionIds: ['yr-i-credit', 'yr-i-member'] }, { id: 'yr-j-event', name: 'Purchase-only event', transactionIds: ['yr-j-charge'] }];
const attrEventsBefore = JSON.stringify(attrEvents);
assert.doesNotThrow(() => validateReviewEvents(attrData, plan, attrEvents));
const yr = summarizeYearReview(attrData, plan, 2026, attrEvents);
const c = value => Math.round(value * 100);
const item = id => yr.standalone.find(entry => entry.purchase.id === id);
assert.deepEqual(yr.purchases.map(row => row.id).sort(), ['exceptional', 'large-purchase', 'threshold-above', 'yr-a-charge', 'yr-b-charge', 'yr-e-charge-1', 'yr-e-charge-2', 'yr-f-charge', 'yr-g-charge', 'yr-i-charge'].sort());
// A: attached; zero net; gross qualifies.
assert.deepEqual(item('yr-a-charge').ids, ['yr-a-charge', 'yr-a-credit']);
assert.deepEqual([c(item('yr-a-charge').gross), c(item('yr-a-charge').inferredCredits), c(item('yr-a-charge').net)], [125050, 125050, 0]);
// B, E, F, G: no credit lowers these selected major purchases.
for (const id of ['yr-b-charge', 'yr-e-charge-1', 'yr-e-charge-2', 'yr-f-charge', 'yr-g-charge', 'yr-i-charge']) { assert.deepEqual(item(id).credits, [], `${id} has no attached credit`); assert.equal(c(item(id).net), c(item(id).gross)); }
// I: event membership wins; the credit is not reused against the standalone purchase.
assert.deepEqual(item('yr-i-charge').evidenceOnly.map(e => [e.creditId, e.code, e.creditEventId]), [['yr-i-credit', 'credit_in_saved_event', 'yr-other']]);
const other = yr.events.find(event => event.id === 'yr-other');
assert.deepEqual(other.ids, ['yr-i-credit', 'yr-i-member']); assert.equal(c(other.net), -150000); assert.equal(other.qualifies, false);
// J: purchase-only event keeps its members and net; the refund is read-only evidence.
const jEvent = yr.events.find(event => event.id === 'yr-j-event');
assert.deepEqual(jEvent.ids, ['yr-j-charge']); assert.equal(c(jEvent.gross), 210000); assert.equal(c(jEvent.net), 210000); assert.equal(c(jEvent.credits), 0); assert.equal(jEvent.qualifies, true);
assert.deepEqual(jEvent.potentialInferredRefunds.map(e => [e.creditId, e.purchaseId, e.code, c(e.creditAmount)]), [['yr-j-credit', 'yr-j-charge', 'purchase_in_saved_event', -210000]]);
assert.ok(yr.eligibleTransactions.some(row => row.id === 'yr-j-credit'), 'The user may still select it explicitly in the event editor');
// Evidence codes for every inferred refund touching 2026, in credit-ID order.
assert.deepEqual(yr.inferredRefunds.map(e => [e.creditId, e.purchaseId, e.code]), [
  ['yr-a-credit', 'yr-a-charge', 'attached'], ['yr-c-credit', 'yr-c-charge', 'below_threshold'], ['yr-d-credit', 'yr-d-charge', 'below_threshold'],
  ['yr-h-credit', 'yr-h-charge', 'other_year'], ['yr-i-credit', 'yr-i-charge', 'credit_in_saved_event'], ['yr-j-credit', 'yr-j-charge', 'purchase_in_saved_event'],
]);
for (const e of yr.inferredRefunds) assert.equal(e.label, 'inferred; not provider-confirmed');
// Unique union: standalone gross − attached inferred credits + qualifying confirmed-event net.
assert.equal(c(yr.union.standaloneGross), 1485053); assert.equal(c(yr.union.attachedInferredCredits), 125050); assert.equal(c(yr.union.eventNet), 380000);
assert.equal(c(yr.union.total), 1740003);
const expectedUnion = ['exceptional', 'large-purchase', 'threshold-above', 'yr-a-charge', 'yr-a-credit', 'yr-b-charge', 'yr-e-charge-1', 'yr-e-charge-2', 'yr-f-charge', 'yr-g-charge', 'yr-i-charge', 'event-a', 'event-b', 'event-c', 'event-credit', 'yr-j-charge'].sort();
assert.deepEqual(yr.union.ids, expectedUnion); assert.equal(new Set(yr.union.ids).size, yr.union.ids.length, 'No duplicate IDs');
for (const id of ['yr-b-full', 'yr-b-part', 'yr-c-charge', 'yr-c-credit', 'yr-d-charge', 'yr-d-credit', 'yr-e-credit', 'yr-f-credit', 'yr-g-credit', 'yr-h-charge', 'yr-h-credit', 'yr-i-credit', 'yr-i-member', 'yr-j-credit', 'yr-hotel', 'yr-points']) assert.ok(!yr.union.ids.includes(id), `${id} is outside the major union`);
// Purchase view and event view expose the same unique set and total.
assert.equal(yr.purchaseView.reduce((n, row) => n + c(row.amount), 0), c(yr.union.total));
assert.deepEqual(yr.purchaseView.map(row => row.id).sort(), expectedUnion);
const eventViewIds = [...yr.standalone.flatMap(entry => entry.ids), ...yr.events.filter(event => event.qualifies).flatMap(event => event.ids)].sort();
assert.deepEqual(eventViewIds, expectedUnion);
assert.equal(yr.standalone.reduce((n, entry) => n + c(entry.net), 0) + yr.events.filter(event => event.qualifies).reduce((n, event) => n + c(event.net), 0), c(yr.union.total));
// Remaining credits are organized truthfully, partition unmatchedCredits exactly, with signed totals.
const groups = Object.fromEntries(yr.creditGroups.map(group => [group.key, [[...group.ids].sort(), c(group.total)]]));
assert.deepEqual(yr.creditGroups.map(group => group.key), ['purpose_travel', 'partial_merchant', 'inferred_refund_outside_union', 'rewards', 'manual', 'ambiguous', 'unallocated']);
assert.deepEqual(groups, {
  purpose_travel: [['yr-hotel'], -7500],
  partial_merchant: [['unmatched-credit', 'yr-b-part'], -15000],
  inferred_refund_outside_union: [['yr-c-credit', 'yr-d-credit', 'yr-h-credit', 'yr-j-credit'], -579999],
  rewards: [['yr-points'], -4000],
  manual: [['yr-f-credit'], -140000],
  ambiguous: [['yr-b-full', 'yr-e-credit'], -240001],
  unallocated: [['yr-g-credit'], -150000],
});
assert.deepEqual(yr.creditGroups.flatMap(group => group.ids).sort(), yr.unmatchedCredits.map(row => row.id).sort());
assert.match(yr.creditGroups.find(group => group.key === 'purpose_travel').description, /No trip, stay or flight is identified/);
// Historical selection: the 2025 charge keeps its full gross; the 2026 refund is disclosure only.
const y2025 = summarizeYearReview(attrData, plan, 2025, attrEvents);
const h = y2025.standalone.find(entry => entry.purchase.id === 'yr-h-charge');
assert.deepEqual(h.credits, []); assert.equal(c(h.net), 170000);
assert.deepEqual(h.evidenceOnly.map(e => [e.creditId, e.code, e.creditInYear, e.purchaseInYear]), [['yr-h-credit', 'other_year', false, true]]);
assert.deepEqual(y2025.union.ids, ['old-year-purchase', 'yr-h-charge']); assert.equal(c(y2025.union.total), 370000);
assert.ok(!y2025.unmatchedCredits.some(row => row.id === 'yr-h-credit'));
// Determinism under row-order reversal; no mutation of source rows or saved events.
const reversedAttr = attribution(); reversedAttr.transactions.reverse();
const yrReversed = summarizeYearReview(reversedAttr, plan, 2026, attrEvents);
assert.deepEqual(yrReversed.union, yr.union); assert.deepEqual(yrReversed.inferredRefunds, yr.inferredRefunds);
assert.deepEqual(yrReversed.creditGroups.map(group => [group.key, [...group.ids].sort(), c(group.total)]), yr.creditGroups.map(group => [group.key, [...group.ids].sort(), c(group.total)]));
assert.equal(JSON.stringify(attrData), attrDataBefore); assert.equal(JSON.stringify(attrEvents), attrEventsBefore);
// An invalid saved event referencing the pair blocks automatic attachment (needs review).
const reviewEvents = [...attrEvents, { id: 'yr-bad', name: 'Overlapping event', transactionIds: ['yr-a-credit', 'event-a'] }];
const needsReview = summarizeYearReview(attrData, plan, 2026, reviewEvents);
assert.equal(needsReview.inferredRefunds.find(e => e.creditId === 'yr-a-credit').code, 'event_needs_review');
assert.deepEqual(needsReview.standalone.find(entry => entry.purchase.id === 'yr-a-charge').credits, []);

assert.equal(JSON.stringify(fixture), before);
console.log('Year review: strict >$1,000 integer-cent thresholds (standalone, event, unresolved ±), full/partial refunds, shared-resolver refund attachment to same-year standalone purchases, event precedence and read-only event evidence, cross-year disclosure, purpose-grouped credits, canonical exclusions, cross-year events and nonduplicated net totals verified.');
