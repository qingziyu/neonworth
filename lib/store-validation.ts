import { z } from 'zod';
import { safeRecord } from './validation-record';
import type { Dataset } from './finance';
import { reviewPreferenceSchema } from './review-preferences.ts';
import { assertRecordSize } from './dataset-storage.ts';
import { canonicalTransactionReviewPatch, resolveTransactionReview, reviewDecisionValues } from './transaction-review.ts';

export { MAX_RECORD_BYTES, MAX_DATASET_BYTES, assertRecordSize, assertDatasetSize } from './dataset-storage.ts';
export const MAX_REQUEST_BYTES = 8_000_000;
const date = z.string().refine(value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Invalid calendar date.');
const id = z.string().min(1).max(200).refine(value => !['__proto__', 'constructor', 'prototype'].includes(value));
const finite = z.number().finite();
const flow = z.enum(['expense', 'income', 'transfer', 'review']);
const transactionPatchFields={
  category:z.string().min(1).max(100).optional(),flow:flow.optional(),
  exceptional:z.boolean().optional(),note:z.string().max(5000).optional(),review:z.boolean().optional(),reviewDecision:z.enum(reviewDecisionValues).nullable().optional(),
};
const providerText=(max=500)=>z.string().max(max).nullable().optional();
const providerDate=z.string().refine(value=>{
  if(date.safeParse(value).success)return true;
  return /^\d{4}-\d{2}-\d{2}T/.test(value)&&date.safeParse(value.slice(0,10)).success&&Number.isFinite(Date.parse(value));
},'Invalid source date.').nullable().optional();
const providerCategory=z.object({primary:providerText(100),detailed:providerText(200),confidence_level:providerText(100)}).passthrough().nullable().optional();
const coverageEntry=z.object({is_complete_for_query:z.boolean().nullable().optional(),freshness:providerText(100),availability:providerText(100),state:providerText(100)}).passthrough();
const coverageSchema=z.object({transactions:coverageEntry.nullable().optional(),accounts:coverageEntry.nullable().optional()}).catchall(z.unknown());
const recurringSchema=z.object({
  stream_id:id.nullable().optional(),account_id:id.nullable().optional(),
  account_name:providerText(),description:providerText(2000),merchant_name:providerText(),
  flow_type:z.enum(['inflow','outflow']).nullable().optional(),frequency:providerText(100),
  first_date:providerDate,last_date:providerDate,predicted_next_date:providerDate,
  predicted_next_dates:z.array(z.string().refine(value=>date.safeParse(value).success||/^\d{4}-\d{2}-\d{2}T/.test(value)&&date.safeParse(value.slice(0,10)).success&&Number.isFinite(Date.parse(value)),'Invalid predicted date.')).max(1000).nullable().optional(),
  average_amount:finite.nullable().optional(),last_amount:finite.nullable().optional(),
  is_active:z.boolean().nullable().optional(),status:providerText(100),
  transaction_ids:z.array(id).max(50000).nullable().optional(),
  personal_finance_category:providerCategory,
  personal_finance_category_primary:providerText(100),personal_finance_category_detailed:providerText(200),personal_finance_category_confidence_level:providerText(100),
  recurring_transaction_type:providerText(100),iso_currency_code:providerText(20),
}).passthrough();
const transaction = z.object({
  id, date, merchant: z.string().max(500), accountId: id, amount: finite,
  category: z.string().min(1).max(100), flow, confidence: z.string().max(50),
  exceptional: z.boolean(), note: z.string().max(5000), pending: z.boolean(), review: z.boolean(),reviewDecision:z.enum(reviewDecisionValues).nullable().optional(),reviewDecisionReason:z.string().max(5000).optional(),
  sourceCategoryDetailed: z.string().max(200).nullable().optional(), sourceName: z.string().max(500).optional(),
  transferAccountId: id.nullable().optional(), transferTransactionId: id.nullable().optional(),
  incomePolicyExcluded:z.boolean().optional(),incomePolicyReason:z.string().max(5000).optional(),
  dashboardScope:z.literal('zelle').optional(),dashboardPolicyReason:z.string().max(5000).optional(),
  movementClassification:z.object({kind:z.enum(['card_repayment','bank_deposit','cash_withdrawal','transfer']),label:z.string().max(200),reason:z.string().max(5000),confidence:z.enum(['HIGH','MEDIUM'])}).strict().optional(),
  spendingProxy:z.object({kind:z.literal('unlinked_apple_card'),basis:z.literal('payment-date'),reason:z.string().max(5000)}).strict().optional(),
  sourceLocation:z.object({city:z.string().max(200).optional(),region:z.string().max(200).optional(),country:z.string().max(100).optional()}).strict().optional(),sourcePaymentChannel:z.string().max(100).optional(),
  // Older backups can contain derived labels. Validate their runtime types so
  // a malformed passthrough value cannot replace a string source category.
  sourceCategory:z.string().max(100).optional(),originalCategory:z.string().max(100).optional(),
  sourceFlow:flow.optional(),sourceNote:z.string().max(5000).optional(),classificationOverrides:z.object(transactionPatchFields).strict().optional(),
  categoryBasis:z.string().max(100).optional(),categoryReason:z.string().max(10000).optional(),categoryConfidence:z.string().max(100).optional(),
  canonicalMerchant:z.string().max(500).optional(),merchantKey:z.string().max(500).optional(),cardContext:z.string().max(1000).nullable().optional(),
  merchantServiceQualifier:z.string().max(100).optional(),classificationVersion:z.string().max(100).optional(),
  displayName:z.string().max(1000).optional(),displayPurpose:z.string().max(500).optional(),
}).passthrough().superRefine((value, ctx) => {
  if ((value.flow === 'income'||value.sourceFlow==='income'||value.classificationOverrides?.flow==='income') && value.amount > 0) ctx.addIssue({code:'custom', message:'Income must use the source inflow sign.'});
});
const incomeEvidenceSchema = z.object({
  version:z.literal(1),asOf:date,readAt:z.string().datetime(),bankCoverage:z.record(z.string(),z.unknown()),
  investmentCoverage:z.object({isComplete:z.literal(false),freshness:z.literal('unknown'),note:z.string().max(3000)}),
  rsuPrices:z.array(z.object({date,ticker:z.string().max(30),price:z.number().finite().positive(),basis:z.literal('regular-session close'),source:z.string().max(500),currency:z.literal('USD'),contractId:z.number().int().positive().optional(),barTime:z.string().datetime().optional(),observedAt:z.string().datetime().optional()})).max(5000).optional(),
  bankInflowCount:z.number().int().nonnegative(),bankInflowTotal:finite,pendingInflowCount:z.number().int().nonnegative(),
  investmentRecords:z.array(z.object({id,date,accountId:id,description:z.string().max(2000),type:z.string().max(50),subtype:z.string().max(100),amount:finite,quantity:finite,price:finite,fees:finite,ticker:z.string().max(100).optional(),currency:z.string().max(20)})).max(10000),
  accountHistory:z.array(z.object({accountId:id,firstDate:date,lastDate:date,recordCount:z.number().int().nonnegative()})).max(500),
  notes:z.array(z.string().max(10000)).max(100),sources:z.array(z.object({label:z.string().max(300),url:z.string().url().refine(v=>v.startsWith('https://'))})).max(30),
});
const retirementEvidenceSchema=z.object({
  version:z.literal(1),
  scope:z.object({start:date,end:date,sourceReadAt:z.string().datetime().nullable(),isCompleteForQuery:z.boolean().nullable(),freshness:z.string().max(100),description:z.string().max(2000)}),
  accountScopes:z.array(z.object({accountId:id,firstRecordDate:date.nullable(),lastRecordDate:date.nullable(),recordCount:z.number().int().nonnegative(),coverageComplete:z.boolean().nullable(),freshness:z.string().max(100)})).max(500),
  records:z.array(z.object({id,accountId:id,date,description:z.string().max(2000),amount:finite,type:z.string().max(100),subtype:z.string().max(100),currency:z.string().max(20),transactionDatetime:z.string().max(100).nullable().optional(),quantity:finite.optional(),ticker:z.string().max(100).nullable().optional(),cancelId:id.nullable().optional(),counterpartyAccountId:id.nullable().optional(),counterpartRecordId:id.nullable().optional()})).max(10000),
  notes:z.array(z.string().max(10000)).max(100),
});
export const datasetSchema = z.object({
  retirementEvidence:retirementEvidenceSchema.optional(),
  incomeEvidence:incomeEvidenceSchema.optional(),
  version: z.literal(1), syncedAt: z.string().datetime(), asOf: date,
  dateRange: z.object({start:date, end:date}), coverage: coverageSchema,
  accounts: z.array(z.object({
    id, name: z.string().max(500), institution: z.string().max(200),
    type: z.string().max(100), subtype: z.string().max(100), mask: z.string().max(20),officialName:z.string().max(500).nullable().optional(),
    balance: finite, netBalance: finite, balanceDate: date.nullable(),
    balanceAgeKnown: z.boolean(), syncStatus: z.string().max(100),
  }).passthrough()).max(500),
  transactions: z.array(transaction).max(50000),
  netWorthHistory: z.array(z.object({date, value:finite, events:z.array(z.object({account_name:providerText(),impact:finite.nullable().optional()}).passthrough()).max(10000)}).passthrough()).max(10000),
  recurring: z.array(recurringSchema).max(2000),
  notes: z.array(z.string().max(10000)).max(100),
}).passthrough().superRefine((value, ctx) => {
  const fail = (message:string) => ctx.addIssue({code:'custom',message});
  if (value.dateRange.start > value.dateRange.end || value.dateRange.end > value.asOf) fail('Invalid reporting date range.');
  const accountIds = new Set(value.accounts.map(account => account.id));
  const accountsById=new Map(value.accounts.map(account=>[account.id,account]));
  if (accountIds.size !== value.accounts.length) fail('Duplicate account IDs.');
  const transactionIds = new Set(value.transactions.map(item => item.id));
  if (transactionIds.size !== value.transactions.length) fail('Duplicate transaction IDs. Import reconciled records.');
  for (const item of value.transactions) {
    if (!accountIds.has(item.accountId)) fail('A transaction references an unknown account.');
    if (item.date < value.dateRange.start || item.date > value.dateRange.end) fail('Transaction dates fall outside coverage.');
    try{if(item.reviewDecision)resolveTransactionReview(item as import('./finance').Transaction,accountsById.get(item.accountId) as import('./finance').Account,item.reviewDecision);if(item.classificationOverrides?.reviewDecision)resolveTransactionReview({...item,...item.classificationOverrides} as import('./finance').Transaction,accountsById.get(item.accountId) as import('./finance').Account,item.classificationOverrides.reviewDecision);}catch(error){fail(error instanceof Error?error.message:'Invalid transaction review decision.');}
  }
  if(value.incomeEvidence){if(value.incomeEvidence.rsuPrices){const keys=value.incomeEvidence.rsuPrices.map(p=>p.date+'|'+p.ticker);if(new Set(keys).size!==keys.length)fail('Duplicate receipt-date prices.');if(value.incomeEvidence.rsuPrices.some(p=>p.date>value.asOf))fail('Receipt-date price falls after snapshot.');}if(value.incomeEvidence.asOf!==value.asOf)fail('Income evidence scope differs from the dashboard snapshot.');if(value.incomeEvidence.investmentRecords.some(r=>r.date>value.asOf))fail('Income evidence falls after the reporting date.');const recordIds=new Set(value.incomeEvidence.investmentRecords.map(r=>r.id));if(recordIds.size!==value.incomeEvidence.investmentRecords.length)fail('Duplicate investment evidence IDs.');if(value.incomeEvidence.investmentRecords.some(r=>!accountIds.has(r.accountId)))fail('Income evidence references an unknown account.');}
  if(value.retirementEvidence){const e=value.retirementEvidence;if(e.scope.start>e.scope.end||e.scope.end>value.asOf)fail('Invalid retirement evidence scope.');const recordIds=new Set(e.records.map(r=>r.id));if(recordIds.size!==e.records.length)fail('Duplicate retirement source record IDs.');if(e.records.some(r=>!accountIds.has(r.accountId)||r.date<e.scope.start||r.date>e.scope.end))fail('Retirement evidence account/date falls outside its source scope.');if(e.accountScopes.some(s=>!accountIds.has(s.accountId)))fail('Retirement scope references an unknown account.');}
  // Bank coverage uses asOf; independently dated net-worth observations may
  // extend through the recorded UTC retrieval date without widening that scope.
  const netWorthDateLimit=[value.asOf,value.syncedAt.slice(0,10)].sort().at(-1)!;
  if (value.netWorthHistory.some(point => point.date > netWorthDateLimit)) fail('Net-worth dates fall after the reporting and retrieval dates.');
}).transform(value => {
  // Review preferences are a separate durable record, never source dataset data.
  const source={...value};delete source.reviewPreferences;
  // Accounting policies are derived for views; importing must preserve source
  // amounts, categories, flow and review flags for future reconciliation.
  return source as unknown as Dataset;
});
export const transactionPatchSchema = z.object(transactionPatchFields).strict().refine(value => Object.keys(value).length > 0, 'A correction is required.');
export const MAX_TRANSACTION_OVERRIDES=50000;
export const transactionOverridesSchema=safeRecord(id,transactionPatchSchema).superRefine((value,ctx)=>{
  if(Object.keys(value).length>MAX_TRANSACTION_OVERRIDES)ctx.addIssue({code:'custom',message:'Too many saved transaction corrections.'});
  // Import validation occurs before any database operation. SQL rechecks the
  // merged byte bound atomically when another correction arrives concurrently.
  try{assertRecordSize(value);}catch{ctx.addIssue({code:'custom',message:'Saved transaction corrections exceed the supported size.'});}
});
export function validateTransactionOverrides(input:unknown,dataset:Dataset) {
  const patches=transactionOverridesSchema.parse(input),transactions=new Map(dataset.transactions.map(transaction=>[transaction.id,transaction])),accounts=new Map(dataset.accounts.map(account=>[account.id,account]));
  for(const [id,patch] of Object.entries(patches)) {
    const source=transactions.get(id);
    if(!source)throw new Error('A saved transaction correction references an unknown source transaction.');
    if(patch.flow==='income'&&source.amount>0)throw new Error('An outflow cannot be classified as income.');
    patches[id]=canonicalTransactionReviewPatch(source,accounts.get(source.accountId),patch);
  }
  return patches;
}
export const settingsSchema = z.object({savingsTarget:z.number().finite().min(0).max(100).optional()}).strict();
export const preferenceSchema = z.union([
  z.object({type:z.literal('transaction'), id, patch:transactionPatchSchema}).strict(),
  z.object({type:z.literal('settings'), patch:settingsSchema}).strict(),
  reviewPreferenceSchema,
]);
