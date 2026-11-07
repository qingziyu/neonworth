import { FINANCE_CONFIG, type FinanceConfig } from './finance-config.ts';
import type { Dataset, Transaction } from './finance';
import { classifyKnownMovementWithContext, createMovementClassificationContext, type MovementClassificationContext } from './movement-classification.ts';

export const ZELLE_POLICY_REASON='Explicit exclusion: this Zelle record belongs only to Money movements → Zelle because of its saved decision or an enabled isolation policy. It is excluded from income, spending, recurring bills, general review and other dashboard totals. This does not establish that the counterparty is another owned account.';
export const APPLE_CARD_PROXY_REASON='Configured unlinked-card proxy: assign recorded Apple Card checking payments to Digital spending when this explicit policy is enabled. Count each recorded checking payment once as Digital spending using its payment date. This is a payment-based proxy, not itemized purchase history or an inferred subscription. Do not also count it as an excluded card repayment.';
export function hasZelleIdentity(t:Pick<Transaction,'merchant'|'sourceName'|'reviewDecision'>):boolean {
 return t.reviewDecision==='zelle'||/\bzelle\b/i.test(`${t.merchant} ${t.sourceName||''}`);
}
/** True only for an explicit/configured exclusion, never merely a payment rail. */
export function isZelleTransaction(t:Pick<Transaction,'merchant'|'sourceName'|'reviewDecision'|'dashboardScope'>):boolean {
 return t.reviewDecision==='zelle'||t.dashboardScope==='zelle'||FINANCE_CONFIG.isolateZelle&&hasZelleIdentity(t);
}
export function isAppleCardPayment(t:Pick<Transaction,'merchant'|'sourceName'>):boolean {
 const names=[t.sourceName||'',t.merchant];
 return names.some(name=>/\bapple\s+card\s+(?:payment|autopay)\b/i.test(name))||names.some(name=>/^apple\s+card$/i.test(name.trim()))&&names.some(name=>/\b(?:payment|autopay)\b/i.test(name));
}
export function isAppleCardSpendingProxy(t:Transaction):boolean {
 return isAppleCardPayment(t)&&t.amount>0&&t.spendingProxy?.kind==='unlinked_apple_card'&&t.spendingProxy.basis==='payment-date';
}
function hasLinkedAppleCard(data:Dataset):boolean {
 return data.accounts.some(a=>a.type.toLowerCase()==='credit'&&/\bapple\s+card\b/i.test(`${a.name} ${a.officialName||''}`));
}
export interface TransactionPolicyContext { movement:MovementClassificationContext; linkedAppleCard:boolean; config:FinanceConfig }
/** One context per policy pass; evidence always comes from the input snapshot. */
export function createTransactionPolicyContext(data:Dataset,config:FinanceConfig=FINANCE_CONFIG):TransactionPolicyContext {
 return {movement:createMovementClassificationContext(data),linkedAppleCard:hasLinkedAppleCard(data),config};
}
/** Authoritative user accounting choices, re-derived after saved row corrections. */
export function applyUserTransactionPolicy(input:Transaction,data:Dataset,patch:Partial<Transaction>={},config:FinanceConfig=FINANCE_CONFIG):Transaction {
 return applyUserTransactionPolicyWithContext(input,patch,createTransactionPolicyContext(data,config));
}
export function applyUserTransactionPolicyWithContext(input:Transaction,patch:Partial<Transaction>,context:TransactionPolicyContext):Transaction {
 // Recompute policy markers from source identity/account evidence; do not trust
 // imported derived markers when linked-account coverage has changed.
 const {dashboardScope,spendingProxy,dashboardPolicyReason,movementClassification,...raw}=input;
 const t:Transaction={...raw};
 const previousPatch=(input as Transaction&{classificationOverrides?:Partial<Transaction>}).classificationOverrides;
 const explicitReview=typeof patch.review==='boolean'?patch.review:typeof previousPatch?.review==='boolean'?previousPatch.review:undefined;
 if(t.reviewDecision==='zelle'||context.config.isolateZelle&&hasZelleIdentity(t))return {...t,flow:'transfer',category:'Zelle movement',review:false,incomePolicyExcluded:true,incomePolicyReason:ZELLE_POLICY_REASON,dashboardScope:'zelle',dashboardPolicyReason:ZELLE_POLICY_REASON};
 const account=context.movement.index.accountsById.get(t.accountId);
 if(context.config.unlinkedAppleCardSpendingProxy&&isAppleCardPayment(t)&&t.amount>0&&account?.type.toLowerCase()==='depository'&&account.subtype.toLowerCase()==='checking'){
  // A verified counterpart in current coverage disables the unlinked-card
  // exception, so future account linking cannot count purchases and repayment.
  const linkedCounterpart=t.transferTransactionId?context.movement.index.transactionsById.get(t.transferTransactionId):undefined;
  if(context.linkedAppleCard||linkedCounterpart)return {...t,flow:'transfer',category:'Transfers',review:false,incomePolicyExcluded:false,incomePolicyReason:'',dashboardPolicyReason:'Apple Card is present in connected coverage or has a recorded counterpart. Its repayment stays outside purchase spending; the unlinked-card proxy is disabled.'};
  return {...t,flow:'expense',category:'Digital spending',review:explicitReview??false,incomePolicyExcluded:false,incomePolicyReason:'',spendingProxy:{kind:'unlinked_apple_card',basis:'payment-date',reason:APPLE_CARD_PROXY_REASON},dashboardPolicyReason:APPLE_CARD_PROXY_REASON};
 }
 // The classifier strips and revalidates prior evidence against source fields.
 // Passing it through preserves recognition across repeated policy passes.
 return classifyKnownMovementWithContext({...t,...(movementClassification?{movementClassification}:{})},patch,context.movement);
}
