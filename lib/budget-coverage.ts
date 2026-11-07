import type { Dataset } from './finance';
import { accountDisplayName } from './classification.ts';
import { isZelleTransaction } from './transaction-policy.ts';

export interface BudgetCoverageWindow {start:string;end:string}
export interface BudgetAccountHistory {
 accountId:string;accountLabel:string;type:string;
 firstRecordDate:string|null;lastRecordDate:string|null;firstExpenseDate:string|null;
 recordCount:number;monthlyCounts:Record<string,number>;
}
export interface BudgetCoverageLimitation {
 code:'before_first_expense'|'first_expense_month'|'no_card_expenses'|'outside_recorded_window'|'source_partial';
 accountId:string|null;accountLabel:string|null;firstRecordDate:string|null;firstExpenseDate:string|null;message:string;
}
export interface BudgetCoverageAssessment {
 start:string;end:string;comparable:boolean;status:'limited'|'observed';
 accounts:BudgetAccountHistory[];limitations:BudgetCoverageLimitation[];
 sourceCoverage:'complete_for_query'|'limited'|'unknown';note:string;
}
const isoDate=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
function monthsIn({start,end}:BudgetCoverageWindow){
 const months:string[]=[];const cursor=new Date(start.slice(0,7)+'-01T12:00:00Z');
 while(cursor.toISOString().slice(0,7)<=end.slice(0,7)&&months.length<1200){months.push(cursor.toISOString().slice(0,7));cursor.setUTCMonth(cursor.getUTCMonth()+1);}
 return months;
}
const object=(value:unknown):Record<string,any>|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:null;
const partial=(coverage:Record<string,any>)=>coverage.is_complete_for_query===false||['partial','in_progress','backfilling','recent_only'].includes(coverage.state)||['unavailable','not_ready','pending'].includes(coverage.availability);
export function scopedSourceCoverage(data:Dataset,window:BudgetCoverageWindow):BudgetCoverageAssessment['sourceCoverage'] {
 // A current query's coverage must not be promoted to all historical months.
 // An unscoped false flag may also describe retained source differences, not
 // proof that every historical month has missing purchases.
 const candidates:Array<{scope:Record<string,any>;coverage:Record<string,any>}>=[];
 const transactions=object(data.coverage.transactions);
 if(transactions){const scope=object(transactions.window)||object(transactions.dateRange);if(scope)candidates.push({scope,coverage:transactions});}
 const refresh=object(data.coverage.refresh),bank=object(refresh?.bankPageCoverage);
 if(refresh&&bank)candidates.push({scope:refresh,coverage:bank});
 let covered=false;
 for(const {scope,coverage}of candidates){
  if(!isoDate(scope.start)||!isoDate(scope.end)||scope.start>scope.end)continue;
  if(scope.start>window.end||scope.end<window.start)continue;
  if(partial(coverage))return 'limited';
  if(scope.start<=window.start&&scope.end>=window.end&&coverage.is_complete_for_query===true&&coverage.availability==='ready')covered=true;
 }
 return covered?'complete_for_query':'unknown';
}

/**
 * Assess comparability of observed card history, not completeness of bank data.
 * First recorded activity is not an account opening date. A period before that
 * evidence, including the first purchase month, is not a reliable benchmark.
 * Later zero-row months stay observed zero; silence alone is not missing data.
 */
export function assessBudgetCoverage(data:Dataset,window:BudgetCoverageWindow):BudgetCoverageAssessment {
 if(!isoDate(window.start)||!isoDate(window.end)||window.start>window.end)throw new Error('Use a valid ordered budget evidence window.');
 const months=monthsIn(window),limitations:BudgetCoverageLimitation[]=[];
 const observed=data.transactions.filter(t=>!t.pending&&t.date<=data.asOf&&t.date>=data.dateRange.start&&t.date<=data.dateRange.end);
 const accounts=data.accounts.filter(a=>['credit','depository'].includes(a.type.toLowerCase())).map(account=>{
  const rows=observed.filter(t=>t.accountId===account.id).sort((a,b)=>a.date.localeCompare(b.date));
  const firstExpense=rows.find(t=>t.flow==='expense'&&t.amount>0&&!isZelleTransaction(t));
  const windowRows=rows.filter(t=>t.date>=window.start&&t.date<=window.end);
  const history:BudgetAccountHistory={accountId:account.id,accountLabel:accountDisplayName(account),type:account.type,firstRecordDate:rows[0]?.date||null,lastRecordDate:rows.at(-1)?.date||null,firstExpenseDate:firstExpense?.date||null,recordCount:windowRows.length,monthlyCounts:Object.fromEntries(months.map(month=>[month,windowRows.filter(t=>t.date.startsWith(month)).length]))};
  if(account.type.toLowerCase()==='credit'){
   const first=history.firstExpenseDate;
   const base={accountId:history.accountId,accountLabel:history.accountLabel,firstRecordDate:history.firstRecordDate,firstExpenseDate:first};
   if(!first)limitations.push({...base,code:'no_card_expenses',message:`${history.accountLabel}: no posted purchase history is recorded. A full spending baseline cannot be established for this card.`});
   else if(window.start.slice(0,7)<=first.slice(0,7)){
    const before=window.end<first;
    limitations.push({...base,code:before?'before_first_expense':'first_expense_month',message:`${history.accountLabel}: the first recorded posted expense is ${first}. This window ${before?'precedes':'includes or precedes'} that first recorded month; earlier activity is unverified. This is not an account opening date or proof of missing purchases.`});
   }
  }
  return history;
 });
 if(window.start<data.dateRange.start||window.end>data.dateRange.end||window.end>data.asOf)limitations.push({code:'outside_recorded_window',accountId:null,accountLabel:null,firstRecordDate:null,firstExpenseDate:null,message:'Part of this window falls outside the saved transaction date range.'});
 const sourceCoverage=scopedSourceCoverage(data,window);
 if(sourceCoverage==='limited')limitations.push({code:'source_partial',accountId:null,accountLabel:null,firstRecordDate:null,firstExpenseDate:null,message:'The source explicitly reports limited transaction coverage for a query that overlaps this window.'});
 const comparable=limitations.length===0;
 return {...window,comparable,status:comparable?'observed':'limited',accounts,limitations,sourceCoverage,note:comparable?'Comparable within the observed card-history window. This does not establish complete bank history; zero means no recorded activity.':'Recorded amounts remain visible, but this window is not suitable for a comparable spending baseline. Earlier card activity is unverified, not assumed to be zero.'};
}
