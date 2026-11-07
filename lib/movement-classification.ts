import type { Dataset, Transaction } from './finance';
import { createDatasetLookup, type DatasetLookup } from './dataset-index.ts';

type MovementEvidence=NonNullable<Transaction['movementClassification']>;
type SavedPatch=Partial<Pick<Transaction,'category'|'flow'|'review'>>;
const normalize=(value:string)=>value.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
const names=(t:Transaction)=>[t.sourceName||'',t.merchant].map(normalize).filter(Boolean);
const generatedReview=(t:Transaction)=>{
 const source=(t as Transaction&{sourceNote?:string}).sourceNote??t.note;
 return !source.trim()||/Unresolved money movement\. Excluded from income and spending until its purpose is confirmed\.|Unidentified credit; not assumed to be income or a purchase refund\.|Income classification is uncertain\. Excluded from confirmed cash income until reviewed\./i.test(source);
};
function savedDecisions(t:Transaction,patch:Partial<Transaction>):SavedPatch {
 const previous=(t as Transaction&{classificationOverrides?:Partial<Transaction>}).classificationOverrides;
 const result:SavedPatch={};
 for(const source of [previous,patch])if(source&&typeof source==='object'){
  if(typeof source.category==='string'&&source.category)result.category=source.category;
  if(['expense','income','transfer','review'].includes(String(source.flow)))result.flow=source.flow;
  if(typeof source.review==='boolean')result.review=source.review;
 }
 return result;
}
function isGenericCardPayment(t:Transaction):boolean {
 return names(t).some(name=>/^(?:(?:credit card|card|mobile|automatic) )?payment(?: (?:received|thank you))?$/.test(name));
}
function namedCardPayment(t:Transaction):boolean {
 return names(t).some(name=>/\b(?:credit card|card)\s+(?:auto\s*pay|payment|pmt)\b|\b(?:american express|amex|discover|capital one|citi(?:bank)?|chase)\b.*\b(?:ach\s+)?(?:auto\s*pay|payment|pmt)\b/.test(name));
}
type DatedId={id:string;date:string};
type TimedId={id:string;time:number};
export interface MovementClassificationDiagnostics {indexedRows:number;supportLookups:number;counterpartCandidatesVisited:number}
export interface MovementClassificationContext {
 index:DatasetLookup;
 repaymentPeersByAccount:ReadonlyMap<string,readonly DatedId[]>;
 repaymentPeerDatesByAccount:ReadonlyMap<string,ReadonlyMap<string,string>>;
 namedCounterpartsByInstitutionAndCents:ReadonlyMap<string,readonly TimedId[]>;
 diagnostics?:MovementClassificationDiagnostics;
}
const counterpartKey=(institution:string,cents:number)=>JSON.stringify([institution,cents]);
const lowerBoundTime=(rows:readonly TimedId[],target:number)=>{let low=0,high=rows.length;while(low<high){const middle=(low+high)>>>1;if(rows[middle].time<target)low=middle+1;else high=middle;}return low;};
const upperBoundDate=(rows:readonly DatedId[],target:string)=>{let low=0,high=rows.length;while(low<high){const middle=(low+high)>>>1;if(rows[middle].date<=target)low=middle+1;else high=middle;}return low;};

export function createMovementClassificationContext(data:Dataset,index=createDatasetLookup(data),diagnostics?:MovementClassificationDiagnostics):MovementClassificationContext {
 const peerDatesByAccount=new Map<string,Map<string,string>>(),namedCounterpartsByInstitutionAndCents=new Map<string,TimedId[]>();
 for(const row of data.transactions){
  if(row.amount<0&&row.flow==='transfer'&&!row.review&&!row.pending&&row.sourceCategoryDetailed==='transfers_credit_card_payment'){
   const ids=peerDatesByAccount.get(row.accountId)||new Map<string,string>(),prior=ids.get(row.id);
   if(prior===undefined||row.date<prior)ids.set(row.id,row.date);peerDatesByAccount.set(row.accountId,ids);
  }
  const other=index.accountsById.get(row.accountId),time=Date.parse(row.date);
  if(other?.type==='depository'&&row.flow==='transfer'&&!row.review&&!row.pending&&row.amount>0&&row.sourceCategoryDetailed==='transfers_credit_card_payment'&&Number.isFinite(time)&&names(row).some(name=>/\b(?:gold|robinhood|credit) card payment\b/.test(name))){
   const key=counterpartKey(other.institution,Math.round(row.amount*100)),matches=namedCounterpartsByInstitutionAndCents.get(key)||[];
   matches.push({id:row.id,time});namedCounterpartsByInstitutionAndCents.set(key,matches);
  }
 }
 const repaymentPeersByAccount=new Map<string,readonly DatedId[]>();
 for(const [accountId,ids] of peerDatesByAccount)repaymentPeersByAccount.set(accountId,[...ids].map(([id,date])=>({id,date})).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id)));
 for(const matches of namedCounterpartsByInstitutionAndCents.values())matches.sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id));
 if(diagnostics)diagnostics.indexedRows+=data.transactions.length;
 return {index,repaymentPeersByAccount,repaymentPeerDatesByAccount:peerDatesByAccount,namedCounterpartsByInstitutionAndCents,diagnostics};
}
function cardPaymentSupport(t:Transaction,context:MovementClassificationContext):{count:number;namedCounterpart:boolean} {
 context.diagnostics&&(context.diagnostics.supportLookups+=1);
 const account=context.index.accountsById.get(t.accountId),peers=context.repaymentPeersByAccount.get(t.accountId)||[];
 let count=upperBoundDate(peers,t.date);
 const ownDate=context.repaymentPeerDatesByAccount.get(t.accountId)?.get(t.id);if(ownDate!==undefined&&ownDate<=t.date)count--;
 const time=Date.parse(t.date);if(!account||!Number.isFinite(time))return {count,namedCounterpart:false};
 const matches=context.namedCounterpartsByInstitutionAndCents.get(counterpartKey(account.institution,Math.round(-t.amount*100)))||[];
 const start=lowerBoundTime(matches,time-3*86_400_000);let namedCounterpart=false;
 for(let index=start;index<matches.length&&matches[index].time<=time;index++){
  context.diagnostics&&(context.diagnostics.counterpartCandidatesVisited+=1);
  if(matches[index].id!==t.id){namedCounterpart=true;break;}
 }
 return {count,namedCounterpart};
}

/** Recognize recorded cash mechanics without inventing economic purpose or pairing. */
export function classifyKnownMovement(input:Transaction,data:Dataset,patch:Partial<Transaction>={}):Transaction {
 return classifyKnownMovementWithContext(input,patch,createMovementClassificationContext(data));
}

/** Context-aware path used when a complete snapshot is classified in one pass. */
export function classifyKnownMovementWithContext(input:Transaction,patch:Partial<Transaction>,context:MovementClassificationContext):Transaction {
 const {movementClassification,...source}=input;
 const t:Transaction={...source};
 const decisions=savedDecisions(input,patch);
 // A deliberate saved treatment or category stays authoritative. The global
 // Zelle/Apple rules are applied by the caller before this narrower inference.
 if(t.pending||decisions.flow!==undefined||decisions.category!==undefined||!['review','transfer'].includes(t.flow))return t;
 // A known asset/debt/retirement movement has a stronger saved economic purpose
 // than its cash-rail descriptor (for example a vehicle's secured check).
 if(/asset|debt|loan|vehicle|retirement/i.test(t.category))return t;
 if(/\bzelle\b/i.test(`${t.sourceName||''} ${t.merchant}`)||t.spendingProxy)return t;
 const account=context.index.accountsById.get(t.accountId),detail=t.sourceCategoryDetailed||'',confidence=t.confidence.toUpperCase();
 const high=confidence==='HIGH'||confidence==='VERY_HIGH',medium=high||confidence==='MEDIUM';
 let evidence:MovementEvidence|undefined;
 if(account?.type==='credit'&&t.amount<0&&isGenericCardPayment(t)){
  const support=cardPaymentSupport(t,context);
  if(detail==='transfers_credit_card_payment'&&medium||support.count>=2||support.namedCounterpart){
   evidence={kind:'card_repayment',label:'Card repayment',confidence:detail==='transfers_credit_card_payment'&&high?'HIGH':'MEDIUM',reason:`The receiving account is a credit card and the statement explicitly labels this record as a payment.${support.count?` ${support.count} earlier or same-day source-classified repayments corroborate this account's payment descriptor.`:''}${support.namedCounterpart?' A same-institution cash account also records an explicitly named card-payment debit for this amount.':''} This resolves repayment treatment without inferring a provider-linked pair. The funding account is not assumed; income and purchase spending are unchanged.`};
  }
 }else if((t.review||t.flow==='review'||movementClassification!==undefined)&&account?.type==='credit'&&t.amount<0&&detail==='transfers_credit_card_payment'&&medium&&namedCardPayment(t)){
  evidence={kind:'card_repayment',label:'Card repayment',confidence:high?'HIGH':'MEDIUM',reason:'The receiving account is a credit card, the statement names a card payment, and the provider classifies it as a credit-card repayment. This resolves repayment treatment without assuming a funding account or inventing a linked pair. Purchases remain counted separately.'};
 }else if(account?.type==='depository'&&t.amount>0&&detail==='transfers_credit_card_payment'&&medium&&names(t).some(name=>/^(?:american express|amex) ach (?:pmt|payment)(?:\s|$)/.test(name))){
  evidence={kind:'card_repayment',label:'American Express card repayment',confidence:high?'HIGH':'MEDIUM',reason:'The bank statement explicitly identifies an American Express ACH payment and the provider classifies it as a credit-card repayment. This posted bank debit is a repayment, separate from purchase spending and income. The specific American Express card is not established; no receiving account or provider-linked pair is inferred.'};
 }else if((t.review||t.flow==='review'||movementClassification!==undefined)&&account?.type==='depository'&&t.amount>0&&detail==='transfers_credit_card_payment'&&medium&&namedCardPayment(t)){
  evidence={kind:'card_repayment',label:'Card repayment',confidence:high?'HIGH':'MEDIUM',reason:'The bank statement names a card or issuer payment and the provider classifies this posted debit as a credit-card repayment. Paying down a card moves cash against debt; purchase spending and income do not change. The exact receiving card is not assumed and no provider-linked pair is invented.'};
 }else if((t.review||t.flow==='review'||movementClassification!==undefined)&&account?.type==='depository'&&t.amount>0&&detail==='transfers_investment_retirement_transfer_out'&&medium){
  evidence={kind:'transfer',label:'Investment funding',confidence:high?'HIGH':'MEDIUM',reason:'The provider explicitly classifies this posted bank debit as investment or retirement funding. Moving cash into investments is separate from purchase spending and new income. The receiving account, ownership, tax treatment and contribution eligibility are not inferred.'};
 }else if((t.review||t.flow==='review'||movementClassification!==undefined)&&account?.type==='depository'&&t.amount<0&&detail==='income_interest_earned'&&high){
  const reason='The provider explicitly identifies posted bank interest. It is cash income; no owned-account transfer is inferred.';
  return {...t,flow:decisions.review===true?'review':'income',category:'Interest',review:decisions.review??(generatedReview(t)?false:t.review),incomePolicyExcluded:false,incomePolicyReason:reason};
 }else if(account?.type==='depository'&&t.amount<0&&detail==='transfers_deposit'&&high){
  evidence={kind:'bank_deposit',label:'Bank deposit',confidence:'HIGH',reason:'The source explicitly classifies a posted bank deposit. Deposit mechanics are known; the payer and economic purpose are not supplied. It stays outside the confirmed-income and spending model without being called an owned-account transfer.'};
 }else if(account?.type==='depository'&&t.amount>0&&detail==='transfers_withdrawal'&&high){
  evidence={kind:'cash_withdrawal',label:'Cash withdrawal',confidence:'HIGH',reason:'The source explicitly classifies a cash withdrawal. The recorded bank outflow moves value into untracked cash; no subsequent cash purchase, wallet balance or income is inferred. Any separately recorded ATM fee remains a spending expense.'};
 }else if(account?.type==='depository'&&medium&&t.amount>0&&detail==='transfers_other_transfer_out'&&names(t).some(name=>/^online transfer(?: out| payment)?$/.test(name)||/^online transfer\s*\/\s*payment(?::\s*debit)?$/.test(name))){
  evidence={kind:'transfer',label:'Bank transfer sent',confidence:high?'HIGH':'MEDIUM',reason:'The statement explicitly names an online transfer and the provider categorizes the debit as a transfer out. The receiving endpoint and ownership are not supplied; those missing details do not change the known transfer mechanics. No counterpart is paired or invented.'};
 }else if(account?.type==='depository'&&t.amount<0&&detail==='transfers_other_transfer_in'&&medium&&!/\bamazon\b/i.test(`${t.sourceName||''} ${t.merchant}`)){
  evidence={kind:'transfer',label:'Transfer received',confidence:high?'HIGH':'MEDIUM',reason:'The provider categorizes this bank credit as a received transfer with supported source confidence. Its counterparty name is retained, but no payroll, refund, owned-account relationship or expense reimbursement is inferred. It stays outside the confirmed-income and spending model.'};
 }
 if(!evidence)return t;
 // This legacy prompt is superseded only after repayment evidence is proven.
 // Exact source/current-note agreement keeps custom or saved note context from
 // being mistaken for generated boilerplate; explicit decisions still win.
 const sourceNote=(t as Transaction&{sourceNote?:string}).sourceNote??t.note;
 const legacyCardPrompt=evidence.kind==='card_repayment'&&sourceNote.trim()==='Possible card payment; confirm before including in any economic total.'&&t.note.trim()===sourceNote.trim();
 const review=decisions.review??(generatedReview(t)||legacyCardPrompt?false:t.review);
 return {...t,flow:t.flow==='review'&&review?'review':'transfer',category:evidence.kind==='card_repayment'?'Card repayment':evidence.kind==='bank_deposit'?'Bank deposit':evidence.kind==='cash_withdrawal'?'Cash withdrawal':'Transfers',review,incomePolicyExcluded:false,incomePolicyReason:'',movementClassification:evidence};
}

/** Specific evidence gaps, rather than an undifferentiated "review required" label. */
export function movementReviewReason(t:Transaction,data:Dataset):string {
 return movementReviewReasonWithContext(t,createMovementReviewContext(data));
}
type TimedPurchase=TimedId&{transaction:Transaction};
type PurchaseBucket={rows:TimedPurchase[];byId:Map<string,TimedId[]>};
export interface MovementReviewContext {accountsById:DatasetLookup['accountsById'];purchases:ReadonlyMap<string,PurchaseBucket>}
const reviewMerchant=(merchant:string)=>normalize(merchant).replace(/[^a-z0-9]/g,'');
const purchaseKey=(accountId:string,merchant:string,cents:number)=>JSON.stringify([accountId,merchant,cents]);
const upperBoundTime=(rows:readonly TimedId[],target:number)=>{let low=0,high=rows.length;while(low<high){const middle=(low+high)>>>1;if(rows[middle].time<=target)low=middle+1;else high=middle;}return low;};
/** Source evidence only, scoped to this summary. Rebuild after a saved read/correction. */
export function createMovementReviewContext(data:Dataset):MovementReviewContext {
 const accountsById=new Map<string,Dataset['accounts'][number]>(),purchases=new Map<string,PurchaseBucket>();
 for(const account of data.accounts)if(!accountsById.has(account.id))accountsById.set(account.id,account);
 for(const transaction of data.transactions){
  if(transaction.pending||transaction.flow!=='expense'||transaction.amount<=0)continue;
  const time=Date.parse(transaction.date);if(!Number.isFinite(time))continue;
  const key=purchaseKey(transaction.accountId,reviewMerchant(transaction.merchant),Math.round(transaction.amount*100));
  const bucket=purchases.get(key)||{rows:[],byId:new Map<string,TimedId[]>()},row={id:transaction.id,time,transaction};
  bucket.rows.push(row);const own=bucket.byId.get(row.id)||[];own.push(row);bucket.byId.set(row.id,own);purchases.set(key,bucket);
 }
 for(const bucket of purchases.values()){
  bucket.rows.sort((a,b)=>a.time-b.time);
  for(const own of bucket.byId.values())own.sort((a,b)=>a.time-b.time);
 }
 return {accountsById,purchases};
}
export function movementReviewReasonWithContext(t:Transaction,context:MovementReviewContext):string {
 const account=context.accountsById.get(t.accountId),source=t.sourceName||t.merchant;
 const semantic=t.sourceCategoryDetailed||'not supplied',confidence=t.confidence||'unknown';
 const amount=`$${Math.abs(t.amount).toFixed(2)}`;
 const saved=(t as Transaction&{classificationOverrides?:Partial<Transaction>}).classificationOverrides;
 if(saved?.review===true||saved?.flow==='review')return `You explicitly kept this source record flagged for review. Its original descriptor is ${source}; provider category ${semantic}, confidence ${confidence}. Automatic movement recognition preserves your saved review decision.`;
 if(t.amount<0&&account?.type==='credit'){
  const merchant=reviewMerchant(t.merchant);
  const usefulMerchant=merchant&&!['payment','credit','refund','unknown','other'].includes(merchant);
  const time=Date.parse(t.date),bucket=usefulMerchant&&Number.isFinite(time)?context.purchases.get(purchaseKey(t.accountId,merchant,Math.round(-t.amount*100))):undefined;
  const rows=bucket?.rows||[],own=bucket?.byId.get(t.id)||[],start=lowerBoundTime(rows,time-30*86_400_000),end=upperBoundTime(rows,time);
  const count=end-start-(upperBoundTime(own,time)-lowerBoundTime(own,time-30*86_400_000));
  if(count===1){const purchase=rows.slice(start,end).find(row=>row.id!==t.id)!.transaction;return `Possible merchant refund: this ${amount} credit from ${source} matches one recorded ${purchase.merchant} purchase for ${amount} in the same card account on ${purchase.date} (purchase source ID ${purchase.id}). Merchant, account and exact amount support this candidate, but the provider does not explicitly link the records. The credit's original category is ${semantic}, confidence ${confidence}. It is not treated as card repayment or new income, and no automatic spending offset is applied.`;}
  if(count>1)return `This ${amount} merchant credit has ${count} same-merchant, same-amount purchases in this card account within the preceding 30 days, so no unique purchase relationship is established. Original category ${semantic}, confidence ${confidence}. A refund, benefit or repayment cannot be selected from amount coincidence; no automatic expense offset is applied.`;
  return `This ${amount} credit posted to a credit-card account, with descriptor ${source}. The original category is ${semantic}, confidence ${confidence}; the source does not establish a repayment, merchant refund or benefit. It is excluded from new income and is not automatically used to reduce spending.`;
 }
 if(t.amount<0&&account?.type==='depository')return `The source records a ${amount} bank credit labelled ${source}, category ${semantic}, confidence ${confidence}. It does not identify confirmed income, a supported transfer mechanism, or the purchase being reimbursed. The counterparty descriptor alone cannot establish those purposes; it remains outside confirmed income and spending.`;
 return `The source records ${amount} leaving the account as ${source}, category ${semantic}, confidence ${confidence}. The available evidence does not establish a purchase, cash withdrawal or owned-account transfer, so its accounting treatment remains unassigned.`;
}
