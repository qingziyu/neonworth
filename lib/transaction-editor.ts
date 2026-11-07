import type { Account, Transaction } from './finance';
import { transactionNoteForDisplay } from './history-reconciliation.ts';
import { suggestReviewDecision, type ReviewDecision } from './transaction-review.ts';

/** Opening a settled row is inspection, not a new accounting decision. */
export function transactionEditorState(transaction:Transaction|null,account:Account|undefined,note:string,savedNote:string,choice:ReviewDecision|''|null,changingTreatment=false){
 const required=!!transaction&&(transaction.review||transaction.flow==='review');
 const active=!!transaction&&(required||changingTreatment);
 const suggestion=active&&transaction?suggestReviewDecision(note,transaction,account):null;
 const proposed=active?(choice===null?suggestion:choice||null):null;
 // Keep the raw draft untouched unless the person actually edits it. Historical
 // generated instructions belong in source evidence once accounting is settled.
 const displayedNote=transaction&&!required&&note===savedNote?transactionNoteForDisplay({...transaction,note}):note;
 return {required,active,suggestion,proposed,displayedNote,hasHistoricalNote:displayedNote!==note,directFlowEdit:!!transaction&&!active&&!transaction.reviewDecision};
}
