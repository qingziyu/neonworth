import { FINANCE_CONFIG } from './finance-config.ts';
import { applyIncomePolicy, resolvePeriod, shiftCalendarYear, type PeriodMode, type ResolvedPeriod } from './periods.ts';
import { summarizeIncome } from './income.ts';
import { isZelleTransaction, isAppleCardSpendingProxy } from './transaction-policy.ts';
import { createReportingWindowComparator } from './reporting-coverage.ts';
export { applyIncomePolicy } from './periods.ts';
export type Flow = 'expense' | 'income' | 'transfer' | 'review';
export interface Account {
  id: string; name: string; institution: string; type: string; subtype: string; mask: string;
  officialName?: string;
  balance: number; netBalance: number; balanceDate: string | null; balanceAgeKnown: boolean; syncStatus: string;
}
export interface Transaction {
  id: string; date: string; merchant: string; accountId: string; amount: number;
  category: string; flow: Flow; confidence: string; exceptional: boolean; note: string;
  pending: boolean; review: boolean;
  /** Derived optional category uncertainty; purchase amount is already counted. */
  categoryReviewOptional?: boolean;
  /** Read-only inference; no saved correction or provider link is invented. */
  refundInference?: {purchaseId:string;reason:string};
  reviewDecision?: import('./transaction-review').ReviewDecision|null; reviewDecisionReason?:string;
  sourceCategoryDetailed?: string | null; sourceName?: string;
  transferAccountId?: string | null; transferTransactionId?: string | null;
  incomePolicyExcluded?: boolean; incomePolicyReason?: string;
  dashboardScope?: 'zelle'; dashboardPolicyReason?: string;
  movementClassification?: {kind:'card_repayment'|'bank_deposit'|'cash_withdrawal'|'transfer';label:string;reason:string;confidence:'HIGH'|'MEDIUM'};
  spendingProxy?: {kind:'unlinked_apple_card';basis:'payment-date';reason:string};
  sourceLocation?: {city?:string;region?:string;country?:string}; sourcePaymentChannel?:string;
}
export interface NetWorthPoint { date: string; value: number; events: Array<{account_name?: string; impact?: number; [key:string]: unknown}> }
export interface Recurring {
  stream_id?: string; account_id?: string; description?: string; merchant_name?: string;
  flow_type?: string; frequency?: string; average_amount?: number; last_amount?: number;
  predicted_next_date?: string; is_active?: boolean; [key: string]: unknown;
}
export interface Dataset {
  version: 1; syncedAt: string; asOf: string; dateRange: {start: string; end: string};
  coverage: Record<string, unknown>; incomeEvidence?: import('./income').IncomeEvidence; retirementEvidence?: import('./retirement').RetirementEvidence; accounts: Account[]; transactions: Transaction[];
  /** Derived review decisions; stored separately from immutable source snapshots. */
  reviewPreferences?: import('./review-preferences').ReviewPreferences;
  netWorthHistory: NetWorthPoint[]; recurring: Recurring[]; notes: string[];
}
export interface Metrics { income: number; spending: number; saved: number; rate: number | null }
export interface Insight { tone: 'good' | 'watch' | 'info'; title: string; detail: string; category?: string }
export interface Summary extends Metrics {
  exceptional: number; reviewAmount: number; reviewCount: number; reviewInflows: number; reviewOutflows: number;
  categories: Array<{name: string; value: number}>; previous: Metrics;
  trend: Array<Metrics & {month: string; label: string; partial: boolean}>;
  insights: Insight[]; partial: boolean; comparisonLabel: string; coverageNote: string;
}
const cents = (n: number) => Math.round(n * 100);
const sum = (rows: Transaction[], fn: (t:Transaction)=>number) => rows.reduce((n,t)=>n+cents(fn(t)),0)/100;
export function money(value: number, digits = 0): string {
  return new Intl.NumberFormat(FINANCE_CONFIG.locale, {style:'currency',currency:FINANCE_CONFIG.currency,minimumFractionDigits:digits,maximumFractionDigits:digits}).format(value);
}
export function monthLabel(month: string, short = false): string {
  return new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-US',{month:short?'short':'long',year:short?undefined:'numeric',timeZone:'UTC'});
}
export function labelCategory(category:string): string {
  const labels: Record<string,string>={dining_drinks:'Dining & coffee',groceries:'Groceries',shopping:'Shopping',transportation:'Transport',travel:'Travel',housing:'Housing',bills_utilities:'Bills & utilities',health_wellness:'Health & personal care',financial:'Financial & insurance',entertainment:'Entertainment',gifts_donations:'Gifts & donations',services:'Services',education:'Education',income:'Income',other:'Other',transfers:'Transfers'};
  return labels[category] || category;
}
export function months(data:Dataset):string[] {
  const first=data.dateRange.start.slice(0,7),last=data.dateRange.end.slice(0,7);
  if(!/^\d{4}-\d{2}$/.test(first)||!/^\d{4}-\d{2}$/.test(last)) return [];
  const result:string[]=[];let date=new Date(`${first}-01T12:00:00Z`);
  while(date.toISOString().slice(0,7)<=last && result.length<600){result.push(date.toISOString().slice(0,7));date.setUTCMonth(date.getUTCMonth()+1);}
  return result;
}
function previousMonth(month:string){const d=new Date(`${month}-15T12:00:00Z`);d.setUTCMonth(d.getUTCMonth()-1);return d.toISOString().slice(0,7);}
function lastDay(month:string){const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m,0)).getUTCDate();}
function metrics(rows:Transaction[],excludeExceptional:boolean):Metrics {
  const income=sum(rows.filter(t=>t.flow==='income'),t=>-t.amount);
  const spending=sum(rows.filter(t=>t.flow==='expense'&&(!excludeExceptional||!t.exceptional)),t=>t.amount);
  const saved=(cents(income)-cents(spending))/100;
  return {income,spending,saved,rate:income>=1?100*saved/income:null};
}
export function summarize(data:Dataset,month:string,excludeExceptional=false):Summary {
  data=applyIncomePolicy(data);
  const asOf=data.asOf.slice(0,10), currentMonth=asOf.slice(0,7);
  const day=Number(asOf.slice(8,10));
  const partial=month===currentMonth && day<lastDay(month);
  const selected=data.transactions.filter(t=>!isZelleTransaction(t)&&!t.pending && t.date.slice(0,7)===month && (!partial||Number(t.date.slice(8,10))<=day));
  const priorMonth=previousMonth(month);
  const previousRows=data.transactions.filter(t=>!isZelleTransaction(t)&&!t.pending && t.date.slice(0,7)===priorMonth && (!partial||Number(t.date.slice(8,10))<=Math.min(day,lastDay(priorMonth))));
  const result=metrics(selected,excludeExceptional), previous=metrics(previousRows,excludeExceptional);
  const expenses=selected.filter(t=>t.flow==='expense'&&(!excludeExceptional||!t.exceptional));
  const categoryCents=new Map<string,number>();
  expenses.forEach(t=>categoryCents.set(t.category,(categoryCents.get(t.category)||0)+cents(t.amount)));
  const categories=[...categoryCents].map(([name,value])=>({name,value:value/100})).filter(x=>x.value!==0).sort((a,b)=>b.value-a.value);
  const reviews=selected.filter(t=>t.flow==='review'||t.review);
  const reviewAmount=sum(reviews,t=>Math.abs(t.amount));
  const reviewInflows=sum(reviews.filter(t=>t.flow==='review'&&t.amount<0),t=>-t.amount);
  const reviewOutflows=sum(reviews.filter(t=>t.flow==='review'&&t.amount>0),t=>t.amount);
  const exceptional=sum(selected.filter(t=>t.flow==='expense'&&t.exceptional),t=>t.amount);
  const comparisonLabel=partial?`vs ${monthLabel(priorMonth,true)} 1–${Math.min(day,lastDay(priorMonth))}`:`vs ${monthLabel(priorMonth)}`;
  const trend=months(data).filter(m=>m<=month).slice(-12).map(m=>({month:m,label:monthLabel(m,true),...metrics(data.transactions.filter(t=>!t.pending&&t.date.slice(0,7)===m&&t.date<=asOf),excludeExceptional),partial:m===currentMonth&&day<lastDay(m)}));
  const insights:Insight[]=[];
  if(reviews.length) insights.push({tone:'watch',title:`${reviews.length} transactions need a closer look`,detail:`${money(reviewAmount)} in flagged activity. Unresolved movements are excluded from income and spending; low-confidence expense categories remain counted.`});
  if(result.income<1) insights.push({tone:'info',title:'No Cash income in the available records',detail:`Classified cash income is ${money(result.income,2)}. The ratio is unavailable below $1 of income. No future deposit is assumed.`});
  if(exceptional!==0) insights.push({tone:'info',title:`${money(exceptional)} in exceptional expenses`,detail:'These cash costs are included in total spending. Switch to routine to exclude explicitly tagged one-offs.'});
  if(previous.spending>0){
    const delta=result.spending-previous.spending;
    if(Math.abs(delta)>=100)insights.push({tone:delta>0?'watch':'good',title:`Spending ${delta>0?'up':'down'} ${money(Math.abs(delta))}`,detail:`${Math.abs(delta/previous.spending*100).toFixed(0)}% ${delta>0?'higher':'lower'} ${comparisonLabel}. ${partial?'Both periods use the same elapsed calendar days.':'Both are full calendar months.'} This comparison uses classified posted expenses.`});
  }
  const historyMonths=months(data).filter(m=>m<month).slice(-3);
  if(historyMonths.length===3){
    const baseline=new Map<string,number>();
    data.transactions.filter(t=>!t.pending&&t.flow==='expense'&&(!excludeExceptional||!t.exceptional)&&historyMonths.includes(t.date.slice(0,7))&&(!partial||Number(t.date.slice(8,10))<=Math.min(day,lastDay(t.date.slice(0,7))))).forEach(t=>baseline.set(t.category,(baseline.get(t.category)||0)+cents(t.amount)));
    const spikes=categories.map(c=>({...c,average:(baseline.get(c.name)||0)/300})).filter(c=>c.average>=50&&c.value-c.average>=150&&c.value>=c.average*1.35).sort((a,b)=>(b.value-b.average)-(a.value-a.average));
    const spike=spikes[0];
    if(spike)insights.push({tone:'watch',title:`${spike.name} above your recent baseline`,detail:`${money(spike.value)} vs ${money(spike.average)} average across the previous three ${partial?'matching month-to-date windows':'complete months'} (${((spike.value/spike.average-1)*100).toFixed(0)}% higher). Review the category transactions.`,category:spike.name});
  }
  const fees=expenses.filter(t=>t.amount>0&&/\bfee\b|interest charge/i.test(t.merchant+' '+t.note));
  if(fees.length)insights.push({tone:'watch',title:`${money(sum(fees,t=>t.amount))} in fee-labelled charges`,detail:`${fees.length} posted charges contain a fee or interest label. Check annual memberships and avoidable charges in the ledger.`,category:fees[0].category});
  if(result.saved>0 && result.income>=1)insights.push({tone:'good',title:`${money(result.saved)} classified cash surplus`,detail:`${result.rate?.toFixed(1)}% of classified cash income remains after ${excludeExceptional?'routine':'total'} consumption spending. This excludes transfers, investment activity and RSU vesting.`});
  if(!data.accounts.some(a=>a.balanceAgeKnown))insights.push({tone:'info',title:'Balance freshness needs verification',detail:'The provider did not supply dated balance snapshots. These balances are recorded values; they do not establish cash available or a safe-to-spend amount.'});
  const sourceComplete=(data.coverage.transactions as {is_complete_for_query?:boolean}|undefined)?.is_complete_for_query===true;
  const coverageNote=`${sourceComplete?'Available synced records':'Based on the available records'} · USD · posted only · source freshness unknown${partial?' · month to date':''}`;
  return {...result,exceptional,reviewAmount,reviewCount:reviews.length,reviewInflows,reviewOutflows,categories,previous,trend,insights,partial,comparisonLabel,coverageNote};
}

export interface PeriodSummary {
 period:ResolvedPeriod;income:number|null;effectiveIncome:number|null;cashPayroll:number;rsuValue:number|null;appleCardSpending:number;appleCardPaymentCount:number;
 spending:number;saved:number|null;cashSaved:number;rate:number|null;exceptional:number;
 reviewCount:number;reviewAmount:number;classificationReviewCount:number;classificationReviewAmount:number;
 categories:Array<{name:string;value:number}>;trend:Array<{month:string;label:string;income:number|null;spending:number;saved:number|null;partial:boolean;cashIncome:number;rsuValue:number|null;appleCardSpending:number;appleCardPaymentCount:number}>;
 insights:Insight[];coverageNote:string;partial:boolean;
}
export function summarizePeriod(data:Dataset,month:string,mode:PeriodMode='month',routine=false):PeriodSummary {
 data=applyIncomePolicy(data);const period=resolvePeriod(data,month,mode),inc=summarizeIncome(data,Number(month.slice(0,4)),month,mode,routine);
 const rows=data.transactions.filter(t=>!isZelleTransaction(t)&&!t.pending&&t.date>=period.start&&t.date<=period.end),expenses=rows.filter(t=>t.flow==='expense'&&(!routine||!t.exceptional));
 const categoryCents=new Map<string,number>();expenses.forEach(t=>categoryCents.set(t.category,(categoryCents.get(t.category)||0)+cents(t.amount)));
 const categories=[...categoryCents].map(([name,value])=>({name,value:value/100})).filter(c=>c.value!==0).sort((a,b)=>b.value-a.value);
 const exceptional=sum(rows.filter(t=>t.flow==='expense'&&t.exceptional),t=>t.amount);
 const reviews=inc.events.filter(e=>e.sourceType==='bank'&&e.status==='review');
 const classificationReviews=rows.filter(t=>t.review||t.flow==='review');
 const sourceComplete=(data.coverage.transactions as {is_complete_for_query?:boolean}|undefined)?.is_complete_for_query===true;
 const expenseTotal=(start:string,end:string,onlyRoutine:boolean)=>sum(data.transactions.filter(t=>!t.pending&&t.flow==='expense'&&(!onlyRoutine||!t.exceptional)&&t.date>=start&&t.date<=end),t=>t.amount);
 const monthEnd=(m:string)=>`${m}-${String(lastDay(m)).padStart(2,'0')}`;
 const comparableWindow=createReportingWindowComparator(data);
 const covered=(start:string,end:string)=>comparableWindow({start,end});
 const insights:Insight[]=[];
 if(inc.potentialRsuRefundOverlapCount)insights.push({tone:'watch',title:`${money(inc.potentialRsuRefundOverlap)} excluded pending reconciliation`,detail:`${inc.potentialRsuRefundOverlapCount} cash credits have the same posting date and amount as RSU refund journals. This is not proof of duplication. They remain outside the conservative income baseline.`});
 if(inc.spending>inc.cashIncome)insights.push({tone:'watch',title:`Spending exceeds recorded Cash income by ${money(inc.spending-inc.cashIncome)}`,detail:`${money(inc.spending)} in ${routine?'routine':'total'} spending vs ${money(inc.cashIncome)} in classified cash income, over this reporting window. RSU receipt value is equity, not additional bank cash. This comparison does not establish available cash or affordability.`});
 if(mode==='month'&&period.start===`${month}-01`){
  const prior=previousMonth(month),partial=period.end<monthEnd(month),day=Number(period.end.slice(8));
  const priorStart=`${prior}-01`,priorEnd=partial?`${prior}-${String(Math.min(day,lastDay(prior))).padStart(2,'0')}`:monthEnd(prior);
  if(covered(period.start,period.end)&&covered(priorStart,priorEnd)){
   const prev=expenseTotal(priorStart,priorEnd,routine),delta=inc.spending-prev;
   if(prev>0&&Math.abs(delta)>=100)insights.push({tone:delta>0?'watch':'good',title:`Recorded spending ${delta>0?'up':'down'} ${money(Math.abs(delta))}`,detail:`${Math.abs(delta/prev*100).toFixed(0)}% ${delta>0?'higher':'lower'} than ${monthLabel(prior)} (${money(prev)}). ${partial?`Both windows use days 1–${day}, with the prior month capped at its final day.`:'Both windows are complete calendar months.'} Uses the same ${routine?'routine':'total'} recorded spending definition; observed comparability does not establish complete bank history.`});
  }
  const baselineMonths:string[]=[];let cursor=month;for(let n=0;n<3;n++){cursor=previousMonth(cursor);baselineMonths.push(cursor);}
  const windows=baselineMonths.map(m=>({start:`${m}-01`,end:partial?`${m}-${String(Math.min(day,lastDay(m))).padStart(2,'0')}`:monthEnd(m)}));
  if(covered(period.start,period.end)&&windows.every(w=>covered(w.start,w.end))){
   const baseline=new Map<string,number>();for(const t of data.transactions){if(t.pending||t.flow!=='expense'||routine&&t.exceptional||!windows.some(w=>t.date>=w.start&&t.date<=w.end))continue;baseline.set(t.category,(baseline.get(t.category)||0)+cents(t.amount));}
   const spike=categories.map(c=>({...c,average:(baseline.get(c.name)||0)/300})).filter(c=>c.average>0&&c.value-c.average>=150&&c.value>=c.average*1.35).sort((a,b)=>(b.value-b.average)-(a.value-a.average))[0];
   if(spike)insights.push({tone:'watch',title:`${spike.name} above your recent baseline`,detail:`${money(spike.value)} vs ${money(spike.average)} average across the prior three ${partial?'matching elapsed-day windows':'complete calendar months'} (${((spike.value/spike.average-1)*100).toFixed(0)}% higher). Same ${routine?'routine':'total'} spending definition.`,category:spike.name});
  }
 }else if(mode==='ytd'||mode==='year'){
  let cursor=period.end.slice(0,7);if(period.end<monthEnd(cursor))cursor=previousMonth(cursor);
  const completeMonths:string[]=[];for(let n=0;n<6;n++){completeMonths.unshift(cursor);cursor=previousMonth(cursor);}
  const olderStart=`${completeMonths[0]}-01`,olderEnd=monthEnd(completeMonths[2]),recentStart=`${completeMonths[3]}-01`,recentEnd=monthEnd(completeMonths[5]);
  if(olderStart>=period.start&&recentEnd<=period.end&&covered(olderStart,recentEnd)){
   const older=expenseTotal(olderStart,olderEnd,true),recent=expenseTotal(recentStart,recentEnd,true),delta=recent-older;
   if(older>0&&Math.abs(delta)>=150)insights.push({tone:delta>0?'watch':'good',title:`Recent routine spending ${delta>0?'up':'down'} ${Math.abs(delta/older*100).toFixed(0)}%`,detail:`${money(recent)} during ${monthLabel(completeMonths[3])}–${monthLabel(completeMonths[5])} vs ${money(older)} during ${monthLabel(completeMonths[0])}–${monthLabel(completeMonths[2])}. These are the latest six complete months within this reporting window; exceptional costs are excluded. This comparison is separate from the selected total.`});
  }
 }
 if(reviews.length>inc.potentialRsuRefundOverlapCount)insights.push({tone:'watch',title:'Cash income credits need confirmation',detail:`${reviews.length} cash credits totaling ${money(inc.reviewAmount)} are outside the employment-income baseline until their purpose is reconciled.`});
 if(inc.unpricedRsuReceiptCount)insights.push({tone:'watch',title:'Receipt-date RSU values are missing',detail:`${inc.unpricedRsuReceiptCount} recorded stock receipts lack a verified price. Effective income and modeled surplus are unavailable rather than estimated.`});
 if(exceptional)insights.push({tone:'info',title:`${money(exceptional)} in exceptional expenses`,detail:routine?'These costs are excluded from this routine-spending view.':'These costs remain in total spending. The routine switch excludes explicitly tagged one-offs.'});
 if(inc.nonIncomeCredits)insights.push({tone:'info',title:`${money(inc.nonIncomeCredits)} in other cash credits`,detail:'Unclassified or explicitly excluded credits remain separate from confirmed cash income and RSU receipt valuations. Zelle is isolated in its own Money movements tab.'});
 if(categories[0])insights.push({tone:'info',title:`${categories[0].name} is the largest spending category`,detail:`${money(categories[0].value)} in net posted expenses over this exact reporting window.`,category:categories[0].name});
 return {period,appleCardSpending:inc.appleCardSpending,appleCardPaymentCount:inc.appleCardPaymentCount,income:inc.effectiveIncome,effectiveIncome:inc.effectiveIncome,cashPayroll:inc.cashIncome,rsuValue:inc.rsuReceiptValue,spending:inc.spending,saved:inc.effectiveSurplusBeforeRsuWithholding,cashSaved:inc.cashSaved,rate:inc.effectiveIncome!==null&&inc.effectiveIncome>=1&&inc.effectiveSurplusBeforeRsuWithholding!==null?inc.effectiveSurplusBeforeRsuWithholding/inc.effectiveIncome*100:null,exceptional,reviewCount:reviews.length,reviewAmount:inc.reviewAmount,classificationReviewCount:classificationReviews.length,classificationReviewAmount:sum(classificationReviews,t=>Math.abs(t.amount)),categories,trend:inc.monthly.map(m=>({month:m.month,label:m.label,income:m.effectiveIncome,spending:m.spending,saved:m.effectiveSurplusBeforeRsuWithholding,partial:m.month===period.start.slice(0,7)&&period.start.slice(8)!=='01'||m.month===period.end.slice(0,7)&&period.end.slice(8)!==String(lastDay(m.month)),cashIncome:m.cashIncome,rsuValue:m.rsu,appleCardSpending:m.appleCardSpending,appleCardPaymentCount:m.appleCardPaymentCount})),insights,coverageNote:`${sourceComplete?'Available synced bank records':'Based on available bank records'} · posted only · source freshness unknown${period.coverageClipped?' · reporting window clipped to available dataset coverage':''}`,partial:period.partial};
}
