import { FINANCE_CONFIG, type FinanceConfig } from './finance-config.ts';
import type { Dataset, Transaction } from './finance';
import { resolveTransactionReview } from './transaction-review.ts';
import { reconcileCategoryReview } from './history-reconciliation.ts';
import { reconcileUnclassifiedCredits } from './expense-credits.ts';
import { applyUserTransactionPolicyWithContext, createTransactionPolicyContext, isZelleTransaction, isAppleCardSpendingProxy, isAppleCardPayment } from './transaction-policy.ts';
export type PeriodMode='month'|'ytd'|'year';
export interface ResolvedPeriod {mode:PeriodMode;month:string;start:string;end:string;requestedStart:string;requestedEnd:string;label:string;monthKeys:string[];coverageClipped:boolean;partial:boolean;empty:boolean}
const iso=(d:Date)=>d.toISOString().slice(0,10);
const dateLabel=(d:string)=>new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
export function shiftCalendarYear(date:string,years:number):string {const d=new Date(`${date}T12:00:00Z`),y=d.getUTCFullYear()+years,m=d.getUTCMonth(),day=Math.min(d.getUTCDate(),new Date(Date.UTC(y,m+1,0)).getUTCDate());return iso(new Date(Date.UTC(y,m,day,12)));}
export function resolvePeriod(data:Pick<Dataset,'asOf'|'dateRange'>,month:string,mode:PeriodMode='month'):ResolvedPeriod {
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||!['month','ytd','year'].includes(mode))throw new Error('A valid month and month/ytd/year period are required.');
 const [year,m]=month.split('-').map(Number),monthEnd=iso(new Date(Date.UTC(year,m,0,12)));
 const requestedEnd=monthEnd<data.asOf?monthEnd:data.asOf;
 let requestedStart=mode==='month'?`${month}-01`:`${year}-01-01`;
 if(mode==='year'){const d=new Date(`${shiftCalendarYear(requestedEnd,-1)}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+1);requestedStart=iso(d);}
 const start=requestedStart<data.dateRange.start?data.dateRange.start:requestedStart;
 const end=requestedEnd>data.dateRange.end?data.dateRange.end:requestedEnd;
 const empty=start>end,monthKeys:string[]=[];let cursor=new Date(`${start.slice(0,7)}-01T12:00:00Z`);
 while(!empty&&iso(cursor).slice(0,7)<=end.slice(0,7)&&monthKeys.length<600){monthKeys.push(iso(cursor).slice(0,7));cursor.setUTCMonth(cursor.getUTCMonth()+1);}
 const prefix=mode==='year'?'Past year':mode==='ytd'?'Year to date':new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-US',{month:'long',year:'numeric',timeZone:'UTC'});
 return {mode,month,start,end,requestedStart,requestedEnd,label:`${prefix} · ${dateLabel(requestedStart)}–${dateLabel(requestedEnd)}`,monthKeys,coverageClipped:start!==requestedStart||end!==requestedEnd,partial:requestedEnd<monthEnd,empty};
}
/** Explicit source/user income is retained for every employer and purpose.
 * Optional checking-credit name rules are deployment configuration, not defaults.
 */
export function applyIncomePolicy(data:Dataset,overrides:Record<string,Partial<Transaction>>={},config:FinanceConfig=FINANCE_CONFIG):Dataset {
 const accounts=new Map(data.accounts.map(account=>[account.id,account]));
 const policyContext=createTransactionPolicyContext(data,config);
 const transactions=data.transactions.map(source=>{
  const patch=overrides[source.id]||(source as Transaction&{classificationOverrides?:Partial<Transaction>}).classificationOverrides||{};
  let t=applyUserTransactionPolicyWithContext({...source,...patch},patch,policyContext);
  if(t.pending)return t; // Existing pending source flags remain; editors cannot create a posted treatment yet.
  const resolved=resolveTransactionReview(t,accounts.get(t.accountId));
  if(resolved)return reconcileCategoryReview({...t,...resolved},patch);
  if(isZelleTransaction(t)||isAppleCardSpendingProxy(t))return t;
  if(patch.flow==='review'&&patch.review===true&&!t.reviewDecision)return {...t,flow:'review' as const,review:true,incomePolicyExcluded:false,incomePolicyReason:''};
  const account=accounts.get(t.accountId),names=`${t.sourceName||''} ${t.merchant}`.toLocaleLowerCase();
  const explicitlyEdited=Object.hasOwn(patch,'flow')||Object.hasOwn(patch,'review');
  if(!explicitlyEdited&&t.amount<0&&!t.pending&&account?.type==='depository'&&account.subtype==='checking'&&config.checkingIncomeNames.some(name=>name.trim()&&names.includes(name.toLocaleLowerCase())))t={...t,flow:'income',category:'Cash income',review:false,incomePolicyExcluded:false,incomePolicyReason:'Explicit configured checking-credit rule.'};
  if(t.flow==='income'&&!t.pending&&t.amount<0)t={...t,incomePolicyExcluded:false,incomePolicyReason:''};
  return reconcileCategoryReview(t,patch);
 });
 return reconcileUnclassifiedCredits({...data,transactions},overrides);
}
