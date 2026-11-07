import type { Transaction } from './finance';

export const GENERATED_CATEGORY_REVIEW_NOTE='Expense counted using the stored category; review its category.';

/** Category detail alone cannot change the already-counted purchase amount.
 * Retain that uncertainty for optional inspection, rather than repeatedly asking
 * for an accounting decision. Explicit saved flags and custom requests win.
 */
export function reconcileCategoryReview(input:Transaction,patch:Partial<Transaction>={}):Transaction {
 const {categoryReviewOptional,...t}=input;
 const previous=(input as Transaction&{classificationOverrides?:Partial<Transaction>}).classificationOverrides;
 const saved={...previous,...patch};
 const sourceNote=(input as Transaction&{sourceNote?:string}).sourceNote??t.note;
 const generated=sourceNote.trim()===GENERATED_CATEGORY_REVIEW_NOTE&&t.note.trim()===sourceNote.trim();
 if(t.pending||t.flow!=='expense'||t.amount<=0||saved.review===true||saved.flow==='review'||!generated||!t.review&&!categoryReviewOptional)return t;
 if(saved.category!==undefined||saved.review===false||saved.reviewDecision)return {...t,review:false};
 return {...t,review:false,categoryReviewOptional:true};
}

/** Hide superseded generated prompts in the ledger; raw notes stay available
 * in source/export/editor and never become a persisted correction. */
export function transactionNoteForDisplay(t:Transaction):string {
 if(t.review||t.flow==='review')return t.note;
 let note=t.note;
 for(const text of [
  'Unresolved money movement. Excluded from income and spending until its purpose is confirmed.',
  'Unidentified credit; not assumed to be income or a purchase refund.',
  'Income classification is uncertain. Excluded from confirmed cash income until reviewed.',
  GENERATED_CATEGORY_REVIEW_NOTE,
 ])note=note.split(text).join(' ');
 if(t.movementClassification?.kind==='card_repayment')note=note.split('Possible card payment; confirm before including in any economic total.').join(' ');
 return note.replace(/\s+/g,' ').trim();
}
