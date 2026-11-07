import type { Dataset, Transaction } from './finance';
import { accountDisplayName, canonicalMerchant, type DerivedTransaction } from './classification.ts';
import { isAppleCardSpendingProxy, isZelleTransaction } from './transaction-policy.ts';

/**
 * Shared, pure attribution of posted negative expense rows ("credits").
 *
 * Evidence boundary: a negative card row may be a purchase return, an issuer
 * benefit, a fee adjustment, a reward/points redemption or a correction. A
 * statement descriptor can establish a broad PURPOSE without identifying one
 * purchase. A purchase association is only ever INFERRED here (never
 * provider-confirmed) and requires same account + same canonical merchant +
 * exact cents + a unique prior charge within the inference window.
 *
 * The attribution resolver never mutates its input or changes flow/sign/amount/date,
 * never reads note prose as an instruction, and never edits saved events. The
 * separate reconciliation helper below may derive expense flow for unresolved
 * credits only when this resolver supplies an exclusive supported purchase.
 * It must not import budget or recurring (avoids a dependency cycle).
 */
export type ExpenseCreditKind = 'purchase_refund' | 'card_benefit' | 'fee_adjustment' | 'general_statement_credit' | 'unclassified';
export type ExpenseCreditStatus = 'inferred_purchase' | 'category_only' | 'ambiguous' | 'unallocated' | 'manual';
export type ExpenseCreditPurpose = 'digital' | 'dining' | 'clothing' | 'retail' | 'travel' | 'periodic_fixed' | null;
export interface ExpenseCreditAttribution {
  creditId: string;
  kind: ExpenseCreditKind;
  status: ExpenseCreditStatus;
  purpose: ExpenseCreditPurpose;
  serviceMerchant: string | null;
  purchaseId: string | null;
  candidatePurchaseIds: string[];
  confidence: 'high' | 'medium' | 'unknown';
  reason: string;
}

/** Inference policy only; not a statement about refund rights or issuer posting times. */
export const REFUND_INFERENCE_WINDOW_DAYS = 90;

const cents = (value: number) => Math.round(value * 100);
const normalized = (value: string | undefined | null) => (value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const dayNumber = (date: string) => Math.round(Date.parse(`${date}T12:00:00Z`) / 86_400_000);
const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Saved user corrections that automatic attribution must not replace. */
export function hasProtectedExpenseDecision(t: Transaction): boolean {
  const patch = (t as Partial<DerivedTransaction> & { classificationOverrides?: Record<string, unknown> }).classificationOverrides;
  const protectedPatch = !!patch && ['category', 'flow', 'exceptional', 'reviewDecision'].some(key => Object.prototype.hasOwnProperty.call(patch, key));
  return protectedPatch || (t.reviewDecision !== undefined && t.reviewDecision !== null);
}

interface Descriptor {
  pattern: RegExp; kind: ExpenseCreditKind; status: 'category_only' | 'unallocated'; purpose: ExpenseCreditPurpose;
  serviceMerchant: string | null; reason: string;
}
/**
 * Root-approved sanitized descriptor patterns only. Matched case-insensitively
 * against the source merchant and sourceName. No allowance amounts, dates or
 * eligibility assumptions are encoded; no broader alias catalog is invented.
 */
const DESCRIPTORS: Descriptor[] = [
  { pattern: /\bplatinum digital entertainment credit\b/, kind: 'card_benefit', status: 'category_only', purpose: 'digital', serviceMerchant: null, reason: 'Issuer digital-entertainment statement credit. It offsets recorded digital spending; no specific subscription or purchase is identified.' },
  { pattern: /\bplatinum resy credit\b/, kind: 'card_benefit', status: 'category_only', purpose: 'dining', serviceMerchant: null, reason: 'Issuer Resy dining statement credit. It offsets recorded dining; no specific restaurant purchase is identified.' },
  { pattern: /\bplatinum lululemon credit\b/, kind: 'card_benefit', status: 'category_only', purpose: 'clothing', serviceMerchant: null, reason: 'Issuer Lululemon statement credit. It offsets recorded clothing; no specific purchase is identified.' },
  { pattern: /\bamex clear plus credit\b/, kind: 'card_benefit', status: 'category_only', purpose: 'periodic_fixed', serviceMerchant: 'CLEAR', reason: 'Issuer CLEAR membership statement credit. It offsets the periodic fixed category; no specific membership charge is claimed.' },
  { pattern: /\bplatinum saks credit\b/, kind: 'card_benefit', status: 'category_only', purpose: 'retail', serviceMerchant: null, reason: 'Issuer Saks statement credit. A department-store credit offsets retail; it does not establish clothing or a specific purchase.' },
  { pattern: /\bplatinum oura ring credit\b/, kind: 'card_benefit', status: 'category_only', purpose: 'retail', serviceMerchant: null, reason: 'Issuer Oura Ring hardware statement credit. It offsets retail hardware only; it never offsets an Oura membership or implies cancellation.' },
  { pattern: /\badjust membership fee\b/, kind: 'fee_adjustment', status: 'category_only', purpose: 'periodic_fixed', serviceMerchant: null, reason: 'Card membership fee adjustment on this same card. It reduces recorded periodic fixed cost; no renewal price is inferred.' },
  { pattern: /\bpoints for amex trvl\b/, kind: 'general_statement_credit', status: 'unallocated', purpose: null, serviceMerchant: null, reason: 'Points redemption credit. Not a merchant purchase refund; it stays in its recorded category.' },
  { pattern: /\bplatinum hotel credit\b/, kind: 'card_benefit', status: 'category_only', purpose: 'travel', serviceMerchant: null, reason: 'Issuer hotel statement credit. It offsets recorded travel; no particular stay is identified.' },
  { pattern: /\bamex airline fee reimbursement\b/, kind: 'card_benefit', status: 'category_only', purpose: 'travel', serviceMerchant: null, reason: 'Issuer airline-fee statement credit. It offsets recorded travel; no particular flight is identified.' },
];
/** Generic nonpurchase credits remain separately labeled and unallocated. */
const NONPURCHASE = /\b(?:points?|rewards?|cash ?back|statement credit|redemption|autopay|payment|thank you)\b/;
/** Canonical identities too generic to establish a merchant match. */
const GENERIC_IDENTITY = /^(?:|unknown|merchant|credit|refund|return|reversal|adjustment|purchase|card purchase|debit card purchase|pos purchase|statement credit)$/;

function descriptorFor(t: Transaction): Descriptor | null {
  const names = [normalized(t.merchant), normalized(t.sourceName)];
  return DESCRIPTORS.find(d => names.some(name => d.pattern.test(name))) ?? null;
}
function isNonpurchaseCredit(t: Transaction): boolean {
  return [normalized(t.merchant), normalized(t.sourceName)].some(name => NONPURCHASE.test(name));
}
function merchantIdentity(t: Transaction): string | null {
  const derived = (t as Partial<DerivedTransaction>).canonicalMerchant;
  // Keep '+' so a membership identity (e.g. Walmart+) never equals its retail parent.
  const name = (typeof derived === 'string' && derived ? derived : canonicalMerchant(t) || '').toLowerCase().replace(/[^a-z0-9+]+/g, ' ').trim();
  return GENERIC_IDENTITY.test(name) ? null : name;
}
const isWalmartPlus = (t: Transaction) => {
  const derived = (t as Partial<DerivedTransaction>).canonicalMerchant;
  return (typeof derived === 'string' && derived ? derived : canonicalMerchant(t)) === 'Walmart+';
};

/**
 * Existing conservative Walmart+ benefit rule, moved unchanged in scope:
 * unique same-day exact-amount Walmart+ charge on the same Amex Platinum
 * (non-Delta) account, supported by at least three distinct monthly pairs.
 * Returns creditId -> chargeId. Widening awaits approved evidence.
 */
export function matchWalmartBenefitPairs(data: Dataset, end: string = data.asOf): Map<string, string> {
  const matched = new Map<string, string>();
  for (const account of [...data.accounts].sort((a, b) => byId(a.id, b.id))) {
    const card = accountDisplayName(account);
    if (!/amex platinum/i.test(card) || /delta/i.test(card)) continue;
    const rows = data.transactions.filter(t => t.accountId === account.id && t.date <= end && !t.pending && t.flow === 'expense' && !isZelleTransaction(t) && !hasProtectedExpenseDecision(t));
    const charges = rows.filter(t => t.amount > 0 && isWalmartPlus(t));
    const credits = rows.filter(t => t.amount < 0 && /^walmart(?: credit| refund)?$/i.test(t.merchant.trim()));
    const pairs = credits.flatMap(credit => {
      const matching = charges.filter(charge => charge.date === credit.date && cents(charge.amount) === -cents(credit.amount));
      if (matching.length !== 1) return [];
      const competing = credits.filter(other => other.date === credit.date && cents(other.amount) === cents(credit.amount));
      return competing.length === 1 ? [{ credit, charge: matching[0] }] : [];
    });
    if (new Set(pairs.map(pair => pair.credit.date.slice(0, 7))).size >= 3) for (const pair of pairs) matched.set(pair.credit.id, pair.charge.id);
  }
  return matched;
}

/**
 * One attribution per posted negative expense row (deduplicated by ID; a
 * reused ID is reported as ambiguous). Caller supplies policy-applied data
 * (applyIncomePolicy) so flows match the canonical spending model; this
 * helper never promotes income, transfer or unresolved rows into expenses.
 */
export function resolveExpenseCredits(data: Dataset, end: string = data.asOf): ExpenseCreditAttribution[] {
  const idCounts = new Map<string, number>();
  for (const t of data.transactions) idCounts.set(t.id, (idCounts.get(t.id) ?? 0) + 1);
  const posted = (t: Transaction) => !t.pending && t.flow === 'expense' && t.date <= end && !isZelleTransaction(t);
  const creditRows = data.transactions.filter(t => posted(t) && cents(t.amount) < 0);
  const chargeRows = data.transactions.filter(t => posted(t) && cents(t.amount) > 0 && !isAppleCardSpendingProxy(t));
  const walmart = matchWalmartBenefitPairs(data, end);

  const results = new Map<string, ExpenseCreditAttribution>();
  const record = (t: Transaction, value: Omit<ExpenseCreditAttribution, 'creditId'>) => results.set(t.id, { creditId: t.id, ...value, candidatePurchaseIds: [...new Set(value.candidatePurchaseIds)].sort(byId) });
  const pendingInference: Transaction[] = [];

  for (const t of creditRows) {
    if (results.has(t.id)) continue;
    if ((idCounts.get(t.id) ?? 0) > 1) {
      // Order-independent: never pick a descriptor/kind from an arbitrary duplicate row.
      record(t, { kind: 'unclassified', status: 'ambiguous', purpose: null, serviceMerchant: null, purchaseId: null, candidatePurchaseIds: [], confidence: 'unknown', reason: 'This source ID is reused by more than one record, so no kind, purpose or purchase is attributed. Every signed amount stays counted.' });
      continue;
    }
    const descriptor = descriptorFor(t);
    if (hasProtectedExpenseDecision(t)) {
      record(t, { kind: descriptor?.kind ?? 'unclassified', status: 'manual', purpose: null, serviceMerchant: null, purchaseId: null, candidatePurchaseIds: [], confidence: 'high', reason: 'Your saved category, flow, exceptional or review decision is kept. No automatic purpose or purchase link replaces it.' });
      continue;
    }
    if (descriptor) {
      record(t, { kind: descriptor.kind, status: descriptor.status, purpose: descriptor.purpose, serviceMerchant: descriptor.serviceMerchant, purchaseId: null, candidatePurchaseIds: [], confidence: descriptor.status === 'category_only' ? 'high' : 'unknown', reason: descriptor.reason });
      continue;
    }
    const walmartCharge = walmart.get(t.id);
    if (walmartCharge) {
      record(t, { kind: 'card_benefit', status: 'inferred_purchase', purpose: 'digital', serviceMerchant: 'Walmart+', purchaseId: walmartCharge, candidatePurchaseIds: [walmartCharge], confidence: 'medium', reason: 'Inferred Walmart+ benefit credit: a unique same-day, exact-amount membership charge on the same Amex Platinum account, supported by at least three distinct monthly pairs. Not provider-confirmed.' });
      continue;
    }
    if (isNonpurchaseCredit(t)) {
      record(t, { kind: 'general_statement_credit', status: 'unallocated', purpose: null, serviceMerchant: null, purchaseId: null, candidatePurchaseIds: [], confidence: 'unknown', reason: 'Rewards, points or general statement credit. Not a purchase refund; it stays visible in its recorded category.' });
      continue;
    }
    pendingInference.push(t);
  }

  // Exact-cents candidates per credit, and which credits claim each charge.
  const walmartCharges = new Set(walmart.values());
  const evidence = new Map<string, { identity: string | null; exact: Transaction[]; partial: Transaction[]; smaller: Transaction[] }>();
  const claims = new Map<string, Set<string>>();
  for (const credit of pendingInference) {
    const identity = merchantIdentity(credit), creditCents = -cents(credit.amount), creditDay = dayNumber(credit.date);
    const sameMerchant = identity === null ? [] : chargeRows.filter(charge => {
      if (charge.accountId !== credit.accountId || merchantIdentity(charge) !== identity) return false;
      const gap = creditDay - dayNumber(charge.date);
      return gap >= 0 && gap <= REFUND_INFERENCE_WINDOW_DAYS;
    });
    const exact = sameMerchant.filter(charge => cents(charge.amount) === creditCents);
    const partial = sameMerchant.filter(charge => cents(charge.amount) > creditCents);
    evidence.set(credit.id, { identity, exact, partial, smaller: sameMerchant.filter(charge => cents(charge.amount) < creditCents) });
    // Exact evidence takes priority over larger, merely possible purchases.
    // A partial credit blocks a full refund only when it has one plausible
    // prior purchase; ambiguous partials are never allocated across candidates.
    const capacityCandidates = exact.length ? exact : partial.length === 1 ? partial : [];
    for (const charge of capacityCandidates) claims.set(charge.id, new Set([...(claims.get(charge.id) ?? []), credit.id]));
  }
  for (const credit of pendingInference) {
    const { identity, exact, partial, smaller } = evidence.get(credit.id)!;
    const service = isWalmartPlus(credit) ? 'Walmart+' : null;
    const purpose: ExpenseCreditPurpose = service ? 'digital' : null;
    const base = { purpose, serviceMerchant: service, purchaseId: null } as const;
    if (identity === null) {
      record(credit, { ...base, kind: 'unclassified', status: 'unallocated', candidatePurchaseIds: [], confidence: 'unknown', reason: 'No supported merchant identity, so amount and date alone cannot link this credit to a purchase. It stays counted in its recorded category.' });
      continue;
    }
    if (exact.length === 1) {
      const charge = exact[0];
      const competing = (claims.get(charge.id)?.size ?? 0) > 1 || walmartCharges.has(charge.id) || (idCounts.get(charge.id) ?? 0) > 1;
      if (!competing) {
        record(credit, { ...base, kind: 'purchase_refund', status: 'inferred_purchase', purchaseId: charge.id, candidatePurchaseIds: [charge.id], confidence: 'medium', reason: `Inferred refund: same account, same merchant, exact amount, ${dayNumber(credit.date) - dayNumber(charge.date)} days after the only matching charge (${REFUND_INFERENCE_WINDOW_DAYS}-day inference window). Not provider-confirmed.` });
        continue;
      }
      record(credit, { ...base, kind: 'unclassified', status: 'ambiguous', candidatePurchaseIds: [charge.id], confidence: 'unknown', reason: 'Another full or partial credit, a benefit pairing or a reused source ID competes for the same matching charge, and together they would exceed it, so no purchase is chosen. Every signed amount stays counted.' });
      continue;
    }
    if (exact.length > 1) {
      record(credit, { ...base, kind: 'unclassified', status: 'ambiguous', candidatePurchaseIds: exact.map(charge => charge.id), confidence: 'unknown', reason: `${exact.length} prior same-account, same-merchant charges have this exact amount, so no purchase is chosen.` });
      continue;
    }
    if (partial.length) {
      record(credit, { ...base, kind: 'unclassified', status: 'category_only', candidatePurchaseIds: partial.map(charge => charge.id), confidence: 'unknown', reason: 'Partial credit from a merchant with larger prior charges on this account. It offsets its recorded category only; it is not distributed across purchases.' });
      continue;
    }
    record(credit, { ...base, kind: 'unclassified', status: 'unallocated', candidatePurchaseIds: [], confidence: 'unknown', reason: smaller.length ? 'This credit exceeds every eligible prior charge from this merchant on this account. The full signed amount stays counted; no purchase is linked.' : `No prior same-account charge from this merchant within ${REFUND_INFERENCE_WINDOW_DAYS} days. The credit stays counted in its recorded category.` });
  }
  return [...results.values()].sort((a, b) => byId(a.creditId, b.creditId));
}

/** Short, non-numeric UI label shared by Budget and Year in Review. */
export function creditEvidenceLabel(credit: Pick<ExpenseCreditAttribution, 'kind' | 'status' | 'serviceMerchant'>): string {
  if (credit.status === 'manual') return 'Your saved decision is kept';
  if (credit.status === 'inferred_purchase') return credit.kind === 'card_benefit' ? `Inferred ${credit.serviceMerchant ?? 'service'} benefit pairing · not provider-confirmed` : 'Inferred refund of a same-account purchase · not provider-confirmed';
  if (credit.kind === 'general_statement_credit') return 'Rewards or general statement credit · not a purchase refund';
  if (credit.kind === 'fee_adjustment') return 'Card fee adjustment · no specific charge linked';
  if (credit.kind === 'card_benefit') return 'Card benefit credit · purpose only, no specific purchase';
  if (credit.status === 'ambiguous') return 'Several possible purchases · none chosen';
  if (credit.status === 'category_only') return 'Partial credit · offsets its category only';
  return 'Credit not linked to a purchase';
}

/** Reconcile an unclassified card credit only when the existing shared resolver
 * finds one exclusive same-account/merchant/exact-cent prior purchase. Probe all
 * eligible credits together so competing and partial credits block inference.
 * Saved decisions and custom review notes remain authoritative. Revalidate each
 * pass: removing evidence returns an inferred credit to unresolved treatment.
 */
export function reconcileUnclassifiedCredits(data:Dataset,overrides:Record<string,Partial<Transaction>>={}):Dataset {
 const accounts=new Map(data.accounts.map(account=>[account.id,account]));
 const eligible=new Set<string>();
 const transactions=data.transactions.map(input=>{
  const {refundInference,...raw}=input;
  const patch={...(input as Partial<DerivedTransaction>).classificationOverrides,...overrides[input.id]};
  const protectedDecision=hasProtectedExpenseDecision({...input,classificationOverrides:patch} as DerivedTransaction)||patch.review===true||isZelleTransaction(input)||isAppleCardSpendingProxy(input)||(input as Partial<DerivedTransaction>).categoryBasis==='card_context';
  const revalidate=refundInference&&!protectedDecision&&input.amount<0&&['review','expense'].includes(input.flow);
  const t:Transaction=revalidate?{...raw,flow:'review',review:true}:raw;
  const note=((t as Partial<DerivedTransaction>).sourceNote??t.note).trim();
  const generated=!note||/^(?:Unidentified credit; not assumed to be income or a purchase refund\.|Income classification is uncertain\. Excluded from confirmed cash income until reviewed\.|Unresolved money movement\. Excluded from income and spending until its purpose is confirmed\.)$/.test(note);
  if(t.flow==='review'&&t.amount<0&&!t.pending&&t.date<=data.asOf&&accounts.get(t.accountId)?.type==='credit'&&!protectedDecision&&generated&&!isNonpurchaseCredit(t)&&merchantIdentity(t)!==null)eligible.add(t.id);
  return t;
 });
 if(!eligible.size)return {...data,transactions};
 const probe={...data,transactions:transactions.map(t=>eligible.has(t.id)?{...t,flow:'expense' as const,review:false}:t)};
 const attributions=new Map(resolveExpenseCredits(probe).map(row=>[row.creditId,row]));
 const lookup=new Map(transactions.map(t=>[t.id,t]));
 return {...data,transactions:transactions.map(t=>{
  const credit=eligible.has(t.id)?attributions.get(t.id):undefined;
  const purchase=credit?.purchaseId?lookup.get(credit.purchaseId):undefined;
  if(credit?.status!=='inferred_purchase'||!purchase)return t;
  return {...t,flow:'expense' as const,category:purchase.category,review:false,incomePolicyExcluded:false,incomePolicyReason:'',refundInference:{purchaseId:purchase.id,reason:credit.reason}};
 })};
}
