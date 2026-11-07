import type { Dataset } from './finance';
import { summarizeBudgetAssignments, type BudgetPlan, type BudgetClassification } from './budget.ts';
import { applyIncomePolicy, resolvePeriod, type ResolvedPeriod } from './periods.ts';
import { summarizeReportingCoverage, type ReportingCoverage } from './reporting-coverage.ts';
import { isAppleCardSpendingProxy, isZelleTransaction } from './transaction-policy.ts';
import { REFUND_INFERENCE_WINDOW_DAYS, resolveExpenseCredits, type ExpenseCreditAttribution } from './expense-credits.ts';

/** Single domain threshold: strictly greater than $1,000.00, compared in integer cents. */
export const MAJOR_SPEND_THRESHOLD_CENTS = 100_000;
export const MAJOR_SPEND_THRESHOLD = MAJOR_SPEND_THRESHOLD_CENTS / 100;
export const MAJOR_SPEND_THRESHOLD_LABEL = 'Charges over $1,000; refunds and credits shown separately';
export const exceedsMajorSpendThreshold = (amount: number) => Math.round(amount * 100) > MAJOR_SPEND_THRESHOLD_CENTS;
/** Plain-language label for every attached or disclosed inferred refund. */
export const INFERRED_REFUND_LABEL = 'inferred; not provider-confirmed';

/** Membership is explicitly confirmed when saved; source prose is not authority. */
export interface ReviewEvent { id: string; name: string; transactionIds: string[]; notes?: string }
export interface ReviewTransaction {
  id: string; date: string; merchant: string; accountId: string; amount: number;
  categoryId: string; categoryLabel: string; bucket: BudgetClassification['bucket']; reason: string;
  /** Read-only shared-resolver attribution for negative rows; never changes event membership. */
  credit?: Pick<ExpenseCreditAttribution, 'kind' | 'status' | 'purpose' | 'purchaseId' | 'candidatePurchaseIds' | 'serviceMerchant' | 'reason'>;
}
export interface ReviewEventIssue { eventId: string; code: 'invalid_event' | 'duplicate_event' | 'duplicate_membership' | 'missing_or_ineligible_member'; message: string }
export interface UnclassifiedLargeActivity {
  id: string; date: string; merchant: string; accountId: string; amount: number; reason: string;
}
/**
 * How one shared-resolver inferred refund (kind purchase_refund, status
 * inferred_purchase) relates to this calendar year's major-spend union.
 * Only 'attached' changes a total; every other code is read-only evidence.
 */
export type InferredRefundCode =
  | 'attached' | 'credit_in_saved_event' | 'purchase_in_saved_event' | 'event_needs_review'
  | 'other_year' | 'below_threshold';
export interface InferredRefundEvidence {
  creditId: string; purchaseId: string; creditDate: string; purchaseDate: string;
  creditAmount: number; purchaseAmount: number; creditInYear: boolean; purchaseInYear: boolean;
  /** Valid saved events only; explicit membership always wins. */
  creditEventId: string | null; purchaseEventId: string | null;
  code: InferredRefundCode; message: string; label: typeof INFERRED_REFUND_LABEL;
}
/** A qualifying standalone charge with any uniquely inferred same-year refunds attached. */
export interface YearReviewStandalone {
  purchase: ReviewTransaction; credits: ReviewTransaction[]; ids: string[];
  gross: number; inferredCredits: number; net: number;
  /** Related inferred refunds that are NOT subtracted here (other year / saved event). */
  evidenceOnly: InferredRefundEvidence[];
}
export type YearReviewCreditGroupKey =
  | 'purpose_travel' | 'purpose_digital' | 'purpose_dining' | 'purpose_clothing' | 'purpose_retail' | 'purpose_periodic_fixed'
  | 'partial_merchant' | 'inferred_refund_outside_union' | 'rewards' | 'manual' | 'ambiguous' | 'unallocated';
export interface YearReviewCreditGroup {
  key: YearReviewCreditGroupKey; label: string; description: string;
  rows: ReviewTransaction[]; ids: string[]; count: number; /** Signed (credits are negative). */ total: number;
}
export interface YearReviewEvent {
  id: string; name: string; notes?: string; rows: ReviewTransaction[]; ids: string[];
  start: string | null; end: string | null; gross: number; credits: number; net: number;
  qualifies: boolean; outsideYearCount: number;
  /** Inferred refunds of this event's members that the event does not include. Read-only; never counted here. */
  potentialInferredRefunds: InferredRefundEvidence[];
}
export type YearReviewPurchaseViewRow = ReviewTransaction & { eventId: string | null; eventName: string | null; attachedToPurchaseId: string | null };
export interface YearReviewSummary {
  year: number; period: ResolvedPeriod; coverage: ReportingCoverage; threshold: number;
  thresholdBasis: 'gross_charges'; thresholdLabel: string;
  eligibleTransactions: ReviewTransaction[];
  /** Qualifying standalone positive charges (gross > threshold), unchanged meaning. */
  purchases: ReviewTransaction[];
  standalone: YearReviewStandalone[];
  purchaseView: YearReviewPurchaseViewRow[];
  events: YearReviewEvent[]; eventIssues: ReviewEventIssue[];
  /** Ungrouped, unattached in-year credits. Partitioned exactly by creditGroups. */
  unmatchedCredits: ReviewTransaction[];
  creditGroups: YearReviewCreditGroup[];
  inferredRefunds: InferredRefundEvidence[];
  unclassifiedLargeActivity: UnclassifiedLargeActivity[];
  union: { ids: string[]; total: number; count: number; purchaseCount: number; eventCount: number; standaloneGross: number; attachedInferredCredits: number; eventNet: number };
  recordedNonroutineTotal: number;
}
const cents = (value: number) => Math.round(value * 100);
const sum = (rows: Array<{ amount: number }>) => rows.reduce((total, row) => total + cents(row.amount), 0) / 100;
const thresholdCents = MAJOR_SPEND_THRESHOLD_CENTS;

const CREDIT_GROUPS: Record<YearReviewCreditGroupKey, { label: string; description: string }> = {
  purpose_travel: { label: 'Travel benefit credits', description: 'The statement descriptor establishes a travel purpose only. No trip, stay or flight is identified, and no future benefit is assumed.' },
  purpose_digital: { label: 'Digital benefit credits', description: 'Category-level digital purpose only. No specific subscription or purchase is identified.' },
  purpose_dining: { label: 'Dining benefit credits', description: 'Category-level dining purpose only. No specific restaurant purchase is identified.' },
  purpose_clothing: { label: 'Clothing benefit credits', description: 'Category-level clothing purpose only. No specific purchase is identified.' },
  purpose_retail: { label: 'Retail & hardware benefit credits', description: 'Department-store or hardware benefit. It does not identify a purchase, establish clothing, or offset any membership.' },
  purpose_periodic_fixed: { label: 'Membership & card-fee credits', description: 'Membership or card-fee purpose only. No specific charge or renewal price is identified.' },
  partial_merchant: { label: 'Partial merchant credits', description: 'Smaller than earlier same-account, same-merchant charges. They offset their category only and are never spread across purchases.' },
  inferred_refund_outside_union: { label: 'Inferred refunds outside major spending', description: 'Each matches one earlier purchase, but that purchase is below the threshold, in another calendar year, or in a saved event. These credits are not subtracted from major spending.' },
  rewards: { label: 'Rewards, points & general statement credits', description: 'Not purchase refunds. They stay in their recorded category.' },
  manual: { label: 'Your saved decisions', description: 'Your saved category, flow or review decision is kept. No automatic purpose or purchase link replaces it.' },
  ambiguous: { label: 'Ambiguous credits', description: 'Several possible purchases, competing credits or a reused source ID. None is chosen.' },
  unallocated: { label: 'Credits not linked to a purchase', description: 'No supported purpose or unique purchase. Amount and date alone are not used to link them.' },
};
const CREDIT_GROUP_ORDER = Object.keys(CREDIT_GROUPS) as YearReviewCreditGroupKey[];

function creditGroupKey(row: ReviewTransaction): YearReviewCreditGroupKey {
  const c = row.credit;
  if (!c) return 'unallocated';
  if (c.status === 'manual') return 'manual';
  if (c.status === 'ambiguous') return 'ambiguous';
  if (c.status === 'inferred_purchase' && c.kind === 'purchase_refund') return 'inferred_refund_outside_union';
  if ((c.kind === 'card_benefit' || c.kind === 'fee_adjustment') && c.purpose) return `purpose_${c.purpose}` as YearReviewCreditGroupKey;
  if (c.kind === 'general_statement_credit') return 'rewards';
  if (c.status === 'category_only') return 'partial_merchant';
  return 'unallocated';
}

function eligibility(data: Dataset, plan: BudgetPlan, credits: Map<string, ExpenseCreditAttribution> = new Map(resolveExpenseCredits(data).map(credit => [credit.creditId, credit]))): Map<string, ReviewTransaction> {
  const source = new Map(data.transactions.map(row => [row.id, row]));
  const result = new Map<string, ReviewTransaction>();
  for (const year of [...new Set(data.transactions.map(row => row.date.slice(0, 4)))]) {
    for (const assignment of summarizeBudgetAssignments(data, `${year}-12`, 'ytd', plan)) {
      if (assignment.bucket !== 'exceptional' && (assignment.bucket !== 'annual' || assignment.categoryId === 'annual_bills')) continue;
      for (const id of assignment.ids) {
        const row = source.get(id)!;
        // A card repayment proxy estimates aggregate spending by payment date;
        // it cannot establish an itemized purchase or confirmed event member.
        if (isAppleCardSpendingProxy(row)) continue;
        const credit = row.amount < 0 ? credits.get(id) : undefined;
        result.set(id, { id, date: row.date, merchant: row.merchant, accountId: row.accountId, amount: row.amount, categoryId: assignment.categoryId, categoryLabel: assignment.categoryLabel, bucket: assignment.bucket, reason: assignment.reason, ...(credit ? { credit: { kind: credit.kind, status: credit.status, purpose: credit.purpose, purchaseId: credit.purchaseId, candidatePurchaseIds: [...credit.candidatePurchaseIds], serviceMerchant: credit.serviceMerchant, reason: credit.reason } } : {}) });
      }
    }
  }
  return result;
}

function findIssues(events: ReviewEvent[], eligible: Map<string, ReviewTransaction>): ReviewEventIssue[] {
  const issues: ReviewEventIssue[] = [], eventIds = new Map<string, number>(), owners = new Map<string, string[]>();
  for (const event of events) {
    eventIds.set(event.id, (eventIds.get(event.id) ?? 0) + 1);
    if (!event.id || !event.name?.trim() || !Array.isArray(event.transactionIds) || !event.transactionIds.length) {
      issues.push({ eventId: event.id, code: 'invalid_event', message: 'An event needs a name and explicitly selected source records.' });
      continue;
    }
    for (const id of event.transactionIds) {
      owners.set(id, [...owners.get(id) ?? [], event.id]);
      if (!eligible.has(id)) issues.push({ eventId: event.id, code: 'missing_or_ineligible_member', message: 'An event member is missing or is not a posted nonroutine expense or credit.' });
    }
  }
  for (const [eventId, count] of eventIds) if (count > 1) issues.push({ eventId, code: 'duplicate_event', message: 'Event identifiers must be unique.' });
  for (const members of owners.values()) if (members.length > 1) for (const eventId of new Set(members)) issues.push({ eventId, code: 'duplicate_membership', message: 'A source record can belong to only one event, once.' });
  return issues.filter((issue, index) => issues.findIndex(other => other.eventId === issue.eventId && other.code === issue.code) === index);
}

/** Use before accepting a preference write; failures do not change source rows. */
export function validateReviewEvents(data: Dataset, plan: BudgetPlan, events: ReviewEvent[]): void {
  if (findIssues(events, eligibility(applyIncomePolicy(data), plan)).length) throw new Error('Events contain invalid, overlapping, missing or ineligible source records.');
}

export function summarizeYearReview(input: Dataset, plan: BudgetPlan, year: number, savedEvents: ReviewEvent[] = []): YearReviewSummary {
  if (!Number.isInteger(year) || year < 1900 || year > 2199) throw new Error('Use a valid calendar year.');
  const data = applyIncomePolicy(input), period = resolvePeriod(data, `${year}-12`, 'ytd');
  // One shared resolver result; Year in Review never runs a second matching heuristic.
  const resolved = new Map(resolveExpenseCredits(data).map(credit => [credit.creditId, credit]));
  const all = eligibility(data, plan, resolved), eventIssues = findIssues(savedEvents, all);
  const invalid = new Set(eventIssues.map(issue => issue.eventId));
  const inYear = (row: { date: string }) => !period.empty && row.date >= period.start && row.date <= period.end;
  const eligibleTransactions = [...all.values()].filter(inYear).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const validEvents = savedEvents.filter(event => !invalid.has(event.id));
  const grouped = new Set(validEvents.flatMap(event => event.transactionIds));
  const ownerEvent = new Map<string, string>();
  for (const event of validEvents) for (const id of event.transactionIds) ownerEvent.set(id, event.id);
  // Rows referenced by a saved event that needs review are not auto-netted either.
  const underReview = new Set(savedEvents.filter(event => invalid.has(event.id) && Array.isArray(event.transactionIds)).flatMap(event => event.transactionIds));
  const purchases = eligibleTransactions.filter(row => !grouped.has(row.id) && cents(row.amount) > thresholdCents).sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));
  const standaloneIds = new Set(purchases.map(row => row.id));

  // Classify every shared-resolver inferred refund touching this year.
  const inferredRefunds: InferredRefundEvidence[] = [];
  for (const credit of [...resolved.values()].sort((a, b) => a.creditId.localeCompare(b.creditId))) {
    if (credit.kind !== 'purchase_refund' || credit.status !== 'inferred_purchase' || !credit.purchaseId) continue;
    const creditRow = all.get(credit.creditId), purchaseRow = all.get(credit.purchaseId);
    // Only nonroutine (eligible) rows belong in Year in Review at all.
    if (!creditRow || !purchaseRow) continue;
    const creditInYear = inYear(creditRow), purchaseInYear = inYear(purchaseRow);
    if (!creditInYear && !purchaseInYear) continue;
    const creditEventId = ownerEvent.get(credit.creditId) ?? null, purchaseEventId = ownerEvent.get(credit.purchaseId) ?? null;
    if (creditEventId && creditEventId === purchaseEventId) continue; // Explicitly grouped together already.
    let code: InferredRefundCode, message: string;
    if (creditEventId) { code = 'credit_in_saved_event'; message = 'This credit is a member of a confirmed event, so it is counted there and never used again against another purchase.'; }
    else if (purchaseEventId) { code = 'purchase_in_saved_event'; message = 'The matched purchase belongs to a confirmed event that does not include this credit. Shown as evidence only: the event’s members, credits and net are unchanged. Use Edit on that event if the credit belongs there.'; }
    else if (underReview.has(credit.creditId) || underReview.has(credit.purchaseId)) { code = 'event_needs_review'; message = 'A saved event that needs review references one of these records, so the credit is not attached automatically.'; }
    else if (!creditInYear || !purchaseInYear) { const other = creditInYear ? purchaseRow : creditRow; code = 'other_year'; message = `The matched ${creditInYear ? 'purchase' : 'refund'} posted in ${other.date.slice(0, 4)}. Each record stays in its own posting year; no credit is subtracted from another year’s major total.`; }
    else if (!standaloneIds.has(credit.purchaseId)) { code = 'below_threshold'; message = 'The matched purchase is not over the major-spend threshold, so neither record enters major spending.'; }
    else { code = 'attached'; message = `Attached to this standalone purchase: same account, same merchant, exact amount, the only earlier charge within ${REFUND_INFERENCE_WINDOW_DAYS} days, and no competing credit. Not provider-confirmed.`; }
    inferredRefunds.push({ creditId: credit.creditId, purchaseId: credit.purchaseId, creditDate: creditRow.date, purchaseDate: purchaseRow.date, creditAmount: creditRow.amount, purchaseAmount: purchaseRow.amount, creditInYear, purchaseInYear, creditEventId, purchaseEventId, code, message, label: INFERRED_REFUND_LABEL });
  }
  const attached = new Set(inferredRefunds.filter(e => e.code === 'attached').map(e => e.creditId));
  const standalone: YearReviewStandalone[] = purchases.map(purchase => {
    const credits = inferredRefunds.filter(e => e.code === 'attached' && e.purchaseId === purchase.id).map(e => all.get(e.creditId)!).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const grossCents = cents(purchase.amount), creditCents = credits.reduce((n, row) => n - cents(row.amount), 0);
    return { purchase, credits, ids: [purchase.id, ...credits.map(row => row.id)], gross: grossCents / 100, inferredCredits: creditCents / 100, net: (grossCents - creditCents) / 100, evidenceOnly: inferredRefunds.filter(e => e.code !== 'attached' && e.purchaseId === purchase.id) };
  });

  const events = validEvents.map(event => {
    const rows = event.transactionIds.map(id => all.get(id)!).filter(inYear).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const net = sum(rows), gross = sum(rows.filter(row => row.amount > 0));
    // A confirmed refund changes net cost, not the fact that a major purchase
    // occurred. Use the same positive-charge threshold for rows and events.
    return { id: event.id, name: event.name, ...(event.notes !== undefined ? { notes: event.notes } : {}), rows, ids: rows.map(row => row.id), start: rows[0]?.date ?? null, end: rows.at(-1)?.date ?? null, gross, credits: Math.abs(sum(rows.filter(row => row.amount < 0))), net, qualifies: cents(gross) > thresholdCents, outsideYearCount: event.transactionIds.length - rows.length,
      potentialInferredRefunds: inferredRefunds.filter(e => e.purchaseEventId === event.id && e.creditEventId !== event.id) };
  }).sort((a, b) => b.net - a.net || a.id.localeCompare(b.id));
  const qualifyingEvents = events.filter(event => event.qualifies);
  const purchaseView: YearReviewPurchaseViewRow[] = [
    ...standalone.flatMap(item => [
      { ...item.purchase, eventId: null, eventName: null, attachedToPurchaseId: null },
      ...item.credits.map(row => ({ ...row, eventId: null, eventName: null, attachedToPurchaseId: item.purchase.id })),
    ]),
    ...qualifyingEvents.flatMap(event => event.rows.map(row => ({ ...row, eventId: event.id, eventName: event.name, attachedToPurchaseId: null }))),
  ].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const unmatchedCredits = eligibleTransactions.filter(row => row.amount < 0 && !grouped.has(row.id) && !attached.has(row.id));
  const creditGroups: YearReviewCreditGroup[] = CREDIT_GROUP_ORDER.map(key => {
    const rows = unmatchedCredits.filter(row => creditGroupKey(row) === key);
    return { key, ...CREDIT_GROUPS[key], rows, ids: rows.map(row => row.id), count: rows.length, total: sum(rows) };
  }).filter(group => group.count > 0);
  const standaloneGrossCents = standalone.reduce((n, item) => n + cents(item.gross), 0);
  const attachedCents = standalone.reduce((n, item) => n + cents(item.inferredCredits), 0);
  const eventNetCents = qualifyingEvents.reduce((n, event) => n + cents(event.net), 0);
  return {
    year, period, coverage: summarizeReportingCoverage(data, period.empty ? undefined : period), threshold: thresholdCents / 100,
    thresholdBasis: 'gross_charges', thresholdLabel: MAJOR_SPEND_THRESHOLD_LABEL,
    eligibleTransactions, purchases, standalone, purchaseView, events, eventIssues, creditGroups, inferredRefunds,
    // An expense that merely carries a review flag is already counted by the
    // canonical spending model. Only unresolved flow belongs in this section.
    unclassifiedLargeActivity: data.transactions.filter(row => inYear(row) && !row.pending && row.flow === 'review' && !isZelleTransaction(row) && Math.abs(cents(row.amount)) > thresholdCents)
      .map(row => ({ id: row.id, date: row.date, merchant: row.merchant, accountId: row.accountId, amount: row.amount, reason: 'Unresolved activity: not included in spending or major-event totals until its flow is classified.' }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount) || a.id.localeCompare(b.id)),
    unmatchedCredits,
    // total = standalone gross − attached inferred credits + qualifying confirmed-event net (integer cents).
    union: { ids: purchaseView.map(row => row.id).sort(), total: (standaloneGrossCents - attachedCents + eventNetCents) / 100, count: purchases.length + qualifyingEvents.length, purchaseCount: purchases.length, eventCount: qualifyingEvents.length, standaloneGross: standaloneGrossCents / 100, attachedInferredCredits: attachedCents / 100, eventNet: eventNetCents / 100 },
    recordedNonroutineTotal: sum(eligibleTransactions),
  };
}
