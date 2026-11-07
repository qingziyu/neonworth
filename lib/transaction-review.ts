import { FINANCE_CONFIG } from './finance-config.ts';
import type { Account, Transaction } from './finance';
import { isAppleCardPayment } from './transaction-policy.ts';

export const reviewDecisionValues=['cash_income','purchase_refund','zelle','interest','transfer','expense'] as const;
export type ReviewDecision=typeof reviewDecisionValues[number];
export const reviewDecisionOptions:ReadonlyArray<{value:ReviewDecision;label:string;description:string}>=[
 {value:'cash_income',label:'Cash income',description:'Include this confirmed bank credit in cash income; do not infer gross salary or payroll.'},
 {value:'purchase_refund',label:'Purchase refund',description:'Reduce the relevant expense category by this credited amount.'},
 {value:'zelle',label:'Zelle movement',description:'Show only under Money movements → Zelle, outside income and spending.'},
 {value:'interest',label:'Bank interest',description:'Recognize the credit as interest, as cash income.'},
 {value:'transfer',label:'Transfer / money movement',description:'Exclude from income and purchase spending without inventing an owned counterparty.'},
 {value:'expense',label:'Purchase / expense',description:'Count this debit once as spending in its selected category.'},
];
export function isReviewDecision(value:unknown):value is ReviewDecision{return typeof value==='string'&&(reviewDecisionValues as readonly string[]).includes(value);}
const names=(t:Transaction)=>`${t.merchant} ${t.sourceName||''}`;
const rawZelle=(t:Transaction)=>/\bzelle\b/i.test(names(t));
const protectedApplePayment=(t:Transaction,account?:Account)=>FINANCE_CONFIG.unlinkedAppleCardSpendingProxy&&isAppleCardPayment(t)&&t.amount>0&&account?.type.toLowerCase()==='depository'&&account.subtype.toLowerCase()==='checking';
const nonExpenseCategories=new Set(['review','income','payroll','salary','amazon income','amazon employer income','transfer','transfers','zelle movement','non-income credit']);
// Exclude accounting labels and provider income codes, not ordinary custom
// expense names such as Income tax, Transfer fees or Payroll service.
const meaningfulExpense=(category:string)=>!!category.trim()&&!nonExpenseCategories.has(category.trim().toLowerCase())&&!/^(?:(?:review|non-income credit)\s*·|income_[a-z0-9_]+$)/i.test(category.trim());
function expenseCategory(t:Transaction,refund=false):string {
 if(meaningfulExpense(t.category))return t.category;
 const original=(t as Transaction&{sourceCategory?:string;originalCategory?:string}).sourceCategory||(t as Transaction&{originalCategory?:string}).originalCategory;
 if(original&&meaningfulExpense(original))return original;
 const detail=t.sourceCategoryDetailed||'';
 if(/^shopping_/.test(detail)||refund&&/\b(?:amazon|amzn)\b/i.test(names(t)))return 'Shopping';
 if(/^dining_drinks_/.test(detail))return 'Dining & coffee';
 if(/^travel_/.test(detail))return 'Travel';
 if(/^groceries_/.test(detail))return 'Groceries';
 return 'Other';
}
/** Read-only preview and shared server validation. Notes never execute a decision. */
export function resolveTransactionReview(t:Transaction,account?:Account,decision:ReviewDecision|null|undefined=t.reviewDecision):Partial<Transaction>|null {
 if(decision===null||decision===undefined)return null;
 if(!isReviewDecision(decision))throw new Error('Choose a supported transaction review decision.');
 if(!account)throw new Error('The transaction payment account is unavailable.');
 if(protectedApplePayment(t,account))throw new Error('Apple Card payments already follow your saved payment-proxy and linked-account rule. Save a note without changing their review treatment.');
 if(t.pending)throw new Error('Wait until this transaction posts before applying a review decision.');
 if(FINANCE_CONFIG.isolateZelle&&rawZelle(t)&&decision!=='zelle')throw new Error('Zelle remains outside income and spending under your saved Zelle rule.');
 const depository=account.type.toLowerCase()==='depository',credit=account.type.toLowerCase()==='credit';
 if(decision==='cash_income'&&!(t.amount<0&&depository))throw new Error('Cash income requires a posted credit in a linked bank account.');
 if(decision==='purchase_refund'&&!(t.amount<0&&(credit||depository)))throw new Error('A purchase refund requires a credit in a linked card or bank account.');
 if(decision==='interest'&&!(t.amount<0&&depository))throw new Error('Bank interest requires a credit in a linked bank account.');
 if(decision==='expense'&&!(t.amount>0))throw new Error('An expense decision requires an account debit. Use purchase refund for a credited refund.');
 if(decision==='transfer'&&t.amount===0)throw new Error('A zero-amount record cannot establish a money movement.');
 const reason=decision==='cash_income'?'You confirmed this bank credit as cash income. Account subtype and the original transfer category do not override this row decision; payroll or taxable compensation is not inferred.':decision==='purchase_refund'?'You confirmed this credit as a purchase refund. Its signed amount reduces the selected expense category and is not income.':decision==='zelle'?'You confirmed this record is Zelle. It belongs only to Money movements → Zelle and is excluded from income, spending and general review; no owned counterparty is inferred.':decision==='interest'?'You confirmed this bank credit is interest. It is included in cash income; an owned-account transfer is not inferred.':decision==='transfer'?'You confirmed this record as a money movement, outside income and purchase spending. No unmatched counterparty or ownership relationship is invented.':'You confirmed this debit as an expense. It is counted once as spending in the selected category.';
 const flow=decision==='cash_income'||decision==='interest'?'income':decision==='purchase_refund'||decision==='expense'?'expense':'transfer';
 const category=decision==='cash_income'?'Cash income':decision==='purchase_refund'?expenseCategory(t,true):decision==='expense'?expenseCategory(t):decision==='zelle'?'Zelle movement':decision==='interest'?'Interest':'Transfers';
 return {reviewDecision:decision,reviewDecisionReason:reason,flow,category,review:false,incomePolicyExcluded:decision==='zelle',incomePolicyReason:reason,dashboardScope:decision==='zelle'?'zelle':undefined,dashboardPolicyReason:reason,movementClassification:undefined,spendingProxy:undefined};
}
export function eligibleReviewDecisions(t:Transaction,account?:Account){return reviewDecisionOptions.filter(option=>{try{return !!resolveTransactionReview(t,account,option.value);}catch{return false;}});}
/** Optional editor suggestion only; no save or accounting change occurs here. */
export function suggestReviewDecision(note:string,t:Transaction,account?:Account):ReviewDecision|null {
 const text=note.slice(0,2000).trim().toLowerCase().replace(/[’‘]/g,"'");
 if(/\b(?:not|no|never|cannot|can't|unsure|uncertain|whether|maybe|isn't|wasn't|don't)\b|\bdo not\b|\bnot sure\b|\?/.test(text))return null;
 const candidates=new Set<ReviewDecision>();
 if(/\bzelle\b/.test(text))candidates.add('zelle');
 if(/\b(?:interest|instrest|intrest)\b/.test(text))candidates.add('interest');
 if(/\bcash income\b|\bemployer income\b|\bsalary\b|\bpayroll\b/.test(text))candidates.add('cash_income');
 if(/\brefund\b/.test(text))candidates.add('purchase_refund');
 if(!candidates.size){if(/\btransfer\b|\bown account\b/.test(text))candidates.add('transfer');if(/\bexpense\b|\bpurchase\b/.test(text))candidates.add('expense');}
 if(candidates.size!==1)return null;
 const proposed=[...candidates][0];
 return eligibleReviewDecisions(t,account).some(option=>option.value===proposed)?proposed:null;
}
export type TransactionReviewPatch=Partial<Pick<Transaction,'category'|'flow'|'exceptional'|'note'|'review'|'reviewDecision'>>;
/** Persist scalar choices plus canonical accounting fields, never derived markers. */
export function canonicalTransactionReviewPatch(source:Transaction,account:Account|undefined,patch:TransactionReviewPatch,current:TransactionReviewPatch={}):TransactionReviewPatch {
 if(Object.hasOwn(patch,'reviewDecision')&&protectedApplePayment(source,account))throw new Error('Apple Card payments already follow your saved payment-proxy and linked-account rule. Save a note without changing their review treatment.');
 if(Object.hasOwn(patch,'reviewDecision')&&patch.reviewDecision===null)return {...patch,reviewDecision:null,flow:'review',category:'Review',review:true};
 // A note-only edit neither creates nor replays a semantic choice. Keeping it
 // sparse also prevents a concurrent clear from being resurrected by an old note save.
 if(!Object.hasOwn(patch,'reviewDecision')&&!['category','flow','review'].some(key=>Object.hasOwn(patch,key)))return patch;
 const decision=patch.reviewDecision===undefined?current.reviewDecision??source.reviewDecision:patch.reviewDecision;
 if(!decision)return patch;
 const result=resolveTransactionReview({...source,...current,...patch},account,decision)!;
 return {...patch,...(Object.hasOwn(patch,'reviewDecision')?{reviewDecision:decision}:{}),category:result.category,flow:result.flow,review:false};
}
