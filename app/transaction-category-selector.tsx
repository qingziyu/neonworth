import type { Account, Transaction } from '@/lib/finance';
import { transactionCategoryEditorState } from '@/lib/transaction-categories';
import { refreshTextForDisplay } from '@/lib/refresh-status';

export default function TransactionCategorySelector({transaction,account,value,flow,preview=null,hidden,busy,onChange}:{transaction:Transaction;account?:Account;value:string;flow:Transaction['flow'];preview?:Transaction|null;hidden:boolean;busy:boolean;onChange:(value:string)=>void}) {
 const state=transactionCategoryEditorState(transaction,account,value,flow,preview);
 return <div className="transaction-category-field">
  {state.editable&&!hidden?<label>Category<select value={state.displayedCategory} disabled={busy} aria-describedby="transaction-category-help" onChange={event=>{
   const next=event.target.value;
   if(!busy&&state.options.some(option=>option.value===next&&!option.disabled))onChange(next);
  }}>{state.options.map(option=><option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}</select></label>:<div><span className="small-note">Category</span><p>{refreshTextForDisplay(state.displayedCategory,hidden)}</p></div>}
  <p className="small-note" id="transaction-category-help">{hidden&&state.editable?'Show amounts to change the category. ':''}{state.explanation}</p>
 </div>;
}
