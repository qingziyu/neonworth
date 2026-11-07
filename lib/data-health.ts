import type { Dataset, Transaction } from './finance';
import { isZelleTransaction } from './transaction-policy.ts';
import { isISODate, summarizeReportingCoverage } from './reporting-coverage.ts';

type SourceTransaction = Transaction & { sourceMissingSince?: string | null };
const identity = (t:Transaction) => (t.sourceName || t.merchant).normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
const key = (t:Transaction) => JSON.stringify([t.accountId,t.date,Math.round(t.amount*100),identity(t)]);
const affectsAccounting = (t:Transaction) => t.review||t.flow==='review'||t.flow==='expense'||t.flow==='income'&&!t.incomePolicyExcluded;

/** Audit the current canonical snapshot. Import prose and old refresh reports
 * are historical evidence, never a source of current accounting tasks. */
export function summarizeDataHealth(data:Dataset) {
 const end=[data.asOf,data.dateRange.end].sort()[0];
 const rows=data.transactions.filter(t=>!t.pending&&isISODate(t.date)&&t.date>=data.dateRange.start&&t.date<=end&&!isZelleTransaction(t)) as SourceTransaction[];
 const current=new Map<string,Transaction[]>();
 for(const t of rows)if(!t.sourceMissingSince){const k=key(t);current.set(k,[...(current.get(k)||[]),t]);}
 const retained=rows.filter(t=>isISODate(t.sourceMissingSince)).map(transaction=>({transaction,candidates:identity(transaction)&&!/^(?:unknown|other|payment|credit|purchase)$/.test(identity(transaction))?(current.get(key(transaction))||[]).filter(t=>t.id!==transaction.id):[]}));
 const accounting=rows.filter(t=>t.review||t.flow==='review');
 const replacements=retained.filter(r=>r.candidates.length);
 // A second unflagged transfer does not change income, spending or recorded
 // balances. Keep its matching evidence without making it an accounting task.
 const possibleReplacements=replacements.filter(r=>affectsAccounting(r.transaction)||r.candidates.some(affectsAccounting));
 const neutralReplacements=replacements.filter(r=>!affectsAccounting(r.transaction)&&!r.candidates.some(affectsAccounting));
 return {start:data.dateRange.start,end,postedCount:rows.length,accounting,retained,possibleReplacements,neutralReplacements,
  automaticallyClassified:rows.filter(t=>!t.review&&t.flow!=='review'&&(t.movementClassification||t.refundInference)).length,
  optionalCategories:rows.filter(t=>t.categoryReviewOptional&&!t.review&&t.flow!=='review').length,
  missingAccounts:data.accounts.filter(a=>a.syncStatus==='Missing from latest feed'),
  coverage:summarizeReportingCoverage(data,{start:data.dateRange.start,end})};
}
