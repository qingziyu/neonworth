import { Check, FileSearch } from 'lucide-react';
import type { Transaction } from '@/lib/finance';
import { reviewDecisionOptions, type ReviewDecision } from '@/lib/transaction-review';

export function TransactionTreatmentSelector({active,required,proposed,options,busy,onChange}:{active:boolean;required:boolean;proposed:ReviewDecision|null;options:{value:ReviewDecision;label:string}[];busy:boolean;onChange:(value:ReviewDecision|'')=>void}){
 if(!active)return null;
 return <label>{required?'Review treatment':'New accounting treatment'}<select disabled={busy} value={proposed||''} onChange={event=>onChange(event.target.value as ReviewDecision|'')}><option value="">Choose a treatment…</option>{options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

export default function TransactionAccountingStatus({transaction}:{transaction:Transaction}){
 const required=transaction.review||transaction.flow==='review';
 const saved=reviewDecisionOptions.find(option=>option.value===transaction.reviewDecision)?.label;
 const label=saved?`Resolved · ${saved}`:transaction.movementClassification?'Reconciled':transaction.refundInference?'Reconciled credit':transaction.pending?'Pending':'Posted';
 return <div className={`review-current${required?'':' resolved'}`}>{required?<FileSearch size={16}/>:<Check size={16}/>}<span><strong>{required?'Accounting decision needed':label}</strong><small>{required?'Choose a treatment below to resolve this record. Saving a note alone does not change its accounting.':transaction.pending?'This record remains outside posted totals until it posts.':'No review needed. This treatment already applies to your reports.'}</small></span></div>;
}
