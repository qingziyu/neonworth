import type { Account, Transaction } from './finance';
import { isAppleCardSpendingProxy } from './transaction-policy.ts';
import { resolveTransactionReview } from './transaction-review.ts';

/** Existing reporting categories, not a new accounting taxonomy. */
export const spendingCategoryChoices = [
 'Housing', 'Bills & utilities', 'Groceries', 'Dining & coffee', 'Shopping',
 'Transport', 'Travel', 'Health & personal care', 'Financial & insurance',
 'Entertainment', 'Services', 'Gifts & donations', 'Education', 'Digital spending', 'Other',
] as const;

export function transactionCategoryOptions(savedCategory:string,draftCategory:string,displayedCategory=draftCategory) {
 const options:{value:string;label:string}[]=spendingCategoryChoices.map(value=>({value,label:value}));
 // Preserve the exact saved value, including legacy spelling, and keep it
 // available after another option is chosen so switching back is lossless.
 for(const value of [savedCategory,draftCategory,displayedCategory])if(!options.some(option=>option.value===value))
  options.push({value,label:`${value} (${value===savedCategory?'saved':'current'} category)`});
 return options;
}

export function transactionCategoryEditorState(transaction:Transaction,account:Account|undefined,draftCategory:string,draftFlow:Transaction['flow'],preview:Transaction|null=null) {
 const effective=preview??{...transaction,flow:draftFlow};
 const fixedByPolicy=isAppleCardSpendingProxy(transaction);
 const editable=!fixedByPolicy&&(effective.flow==='expense'||effective.flow==='review');
 // A treatment preview may replace an old placeholder category such as Review.
 // Show exactly what Apply will save without changing the underlying draft.
 const displayedCategory=editable?(preview?.category??draftCategory):effective.category;
 const options=transactionCategoryOptions(transaction.category,draftCategory,displayedCategory).map(option=>{
  let disabled=false;
  if(editable&&effective.reviewDecision&&account){
   try{disabled=resolveTransactionReview({...transaction,category:option.value},account,effective.reviewDecision)?.category!==option.value;}catch{disabled=true;}
  }
  return {...option,disabled,label:disabled?`${option.label} · unavailable for this treatment`:option.label};
 });
 return {
  editable,
  displayedCategory,
  explanation:fixedByPolicy?'Digital spending follows your saved Apple Card payment rule.':editable
   ?'Choose where spending or a refund appears. This does not change its accounting treatment or clear a review flag.'
   :!preview&&!transaction.reviewDecision&&draftFlow!==transaction.flow
    ?'This treatment keeps the current category. Any spending category selected earlier stays in your draft until you switch back; it will not be saved with this treatment.'
    :'This category follows the accounting treatment. Choose a different treatment to change its purpose.',
  options,
 };
}
