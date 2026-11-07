import { FINANCE_CONFIG, allowedRsuTicker } from './finance-config.ts';
import { applyIncomePolicy, resolvePeriod, type PeriodMode, type ResolvedPeriod } from './periods.ts';
import type { Dataset, Transaction } from './finance';
import { isZelleTransaction, isAppleCardSpendingProxy } from './transaction-policy.ts';

export type IncomeKind = 'payroll'|'interest'|'dividend'|'other'|'rsu_receipt'|'rsu_sale'|'rsu_withholding'|'review';
export interface InvestmentIncomeRecord {
 id:string; date:string; accountId:string; description:string; type:string; subtype:string;
 amount:number; quantity:number; price:number; fees:number; ticker?:string; currency:string;
}
export interface IncomeAccountHistory {accountId:string; firstDate:string; lastDate:string; recordCount:number}
export interface RsuPrice {date:string;ticker:string;price:number;basis:'regular-session close';source:string;currency:string;contractId?:number;barTime?:string;observedAt?:string}
export interface RsuReceiptValuation {id:string;date:string;accountId:string;quantity:number;price:number;value:number;priceBasis:string;priceSource:string;observedAt?:string;sourceTransactionId:string}
export interface IncomeEvidence {
 version:1; asOf:string; readAt:string; bankCoverage:Record<string,unknown>;
 investmentCoverage:{isComplete:false; freshness:'unknown'; note:string};
 bankInflowCount:number; bankInflowTotal:number; pendingInflowCount:number;
 investmentRecords:InvestmentIncomeRecord[]; accountHistory:IncomeAccountHistory[]; rsuPrices?:RsuPrice[];
 notes:string[]; sources:Array<{label:string;url:string}>;
}
export interface IncomeEvent {
 id:string; date:string; accountId:string; description:string; kind:IncomeKind; amount:number|null; quantity?:number;
 sourceType:'bank'|'investment'; sourceTransactionId?:string; evidence:string; note:string;
 status:'confirmed'|'review'|'excluded'; includedInCashIncome:boolean; includedInEffectiveIncome?:boolean; ticker?:string; unitPrice?:number; priceBasis?:string; priceSource?:string;
}
export interface IncomeAccountSummary {
 accountId:string; accountLabel:string; cashIncome:number; employerCashIncome:number; payroll:number; eventCount:number; rsuReceiptValue:number|null; effectiveIncome:number|null;
 investmentFirstDate:string|null; investmentLastDate:string|null; coverageNote:string;
}
export interface IncomeSummary {
 year:number; month:string; scope:PeriodMode; period:ResolvedPeriod; nonIncomeCredits:number; start:string; end:string; asOf:string; readAt:string;
 // payroll is a compatibility alias; employerCashIncome also includes checking reimbursements.
 cashIncome:number; employerCashIncome:number; payroll:number; bankInterest:number; otherCashIncome:number; investmentDistributions:number;
 appleCardSpending:number; appleCardPaymentCount:number; spending:number; cashSaved:number; savingsRate:number|null; confirmedPlusLikely:number; likelyIncome:number; reviewAmount:number;
 rsuShares:number; rsuVestValue:number|null; rsuWithholding:number|null; totalCompensation:number|null; equityInclusiveSavings:number|null;
 rsuSaleProceeds:number; events:IncomeEvent[]; rsuReceiptValue:number|null; rsuReceiptValuations:RsuReceiptValuation[]; unpricedRsuReceiptCount:number; effectiveIncome:number|null; knownRsuWithholding:number; additionalRecordedRsuWithholding:number; withholdingCoverageComplete:false; effectiveSurplusBeforeRsuWithholding:number|null; effectiveSurplusAfterRecordedWithholding:number|null; effectiveSavings:number|null; effectiveSavingsRate:number|null; effectiveSavingsNotes:string[]; rsuReceiptShareBasis:'recorded received shares; tax basis unknown'; rsuTaxJournalsTreatment:'settlement history only; no second deduction'; potentialRsuRefundOverlap:number; potentialRsuRefundOverlapCount:number;
 monthly:Array<{month:string;label:string;payroll:number;employerCashIncome:number;interest:number;dividends:number;other:number;cashIncome:number;spending:number;saved:number;rsu:number|null;effectiveIncome:number|null;knownRsuWithholding:number;appleCardSpending:number;appleCardPaymentCount:number;effectiveSurplusBeforeRsuWithholding:number|null;effectiveSurplusAfterRecordedWithholding:number|null}>;
 accounts:IncomeAccountSummary[]; coverageNotes:string[]; notes:string[]; sources:Array<{label:string;url:string}>; complete:false;
}
export const RSU_RECEIPT_POLICY = 'RSU receipt valuation uses recorded received shares × verified receipt-date price. It does not establish gross or after-tax compensation, tax basis, or withheld shares. Tax journals are separate source evidence; no automatic gross-up or withholding deduction is applied.';
export function currentIncomeNotes(notes:string[]):string[]{
 return notes.map(note=>/before (?:any )?(?:separate|additional)(?: recorded)? RSU (?:debits|withhold)/i.test(note)?RSU_RECEIPT_POLICY:note);
}
const cents=(n:number)=>Math.round(n*100);
const sum=(values:number[])=>values.reduce((s,n)=>s+cents(n),0)/100;
const endOfMonth=(m:string)=>{const [y,mo]=m.split('-').map(Number);return new Date(Date.UTC(y,mo,0)).toISOString().slice(0,10)};
const rsuReceipt=(r:InvestmentIncomeRecord)=>(!r.ticker||allowedRsuTicker(r.ticker))&&/\bRSU(?:\b|[0-9#])/i.test(r.description)&&r.quantity>0&&r.type==='buy';
const descriptions:Record<IncomeKind,string>={payroll:'Provider-classified salary deposit',interest:'Provider-classified bank interest',dividend:'Brokerage cash dividend/distribution',other:'Classified operating cash credit',rsu_receipt:'Explicit RSU-related stock receipt',rsu_sale:'Share sale; asset conversion',rsu_withholding:'Explicit RSU-related cash withholding record',review:'Purpose requires confirmation'};
function bankEvent(t:Transaction,data:Dataset):IncomeEvent|null {
 if(isZelleTransaction(t)||t.pending||t.amount>=0)return null;
 const account=data.accounts.find(a=>a.id===t.accountId);
 if(account?.type.toLowerCase()!=='depository')return null;
 const source=t.sourceCategoryDetailed||'';
 const kind:IncomeKind=t.flow==='review'?'review':t.reviewDecision==='interest'||source==='income_interest_earned'||t.category==='Interest'?'interest':/payroll|salary/i.test(t.category)||source==='income_salary'?'payroll':'other';
 const included=t.flow==='income'&&!t.incomePolicyExcluded;
 if(!included&&t.flow!=='review'&&!t.incomePolicyExcluded)return null;
 const status:IncomeEvent['status']=included?'confirmed':t.flow==='review'?'review':'excluded';
 return {id:t.id,date:t.date,accountId:t.accountId,description:t.sourceName||t.merchant,kind,amount:-t.amount,sourceType:'bank',sourceTransactionId:t.id,evidence:`${included?'Classified cash income':'Unresolved or explicitly excluded credit'} · original source ${source||t.category} · confidence ${t.confidence}`,note:t.note,status,includedInCashIncome:included,includedInEffectiveIncome:included};
}
function investmentEvent(r:InvestmentIncomeRecord,prices:RsuPrice[]=[]):IncomeEvent|null {
 if(r.currency!==FINANCE_CONFIG.currency)return null;
 const base={id:`investment:${r.id}`,date:r.date,accountId:r.accountId,description:r.description,sourceType:'investment' as const,sourceTransactionId:r.id,includedInCashIncome:false};
 if(rsuReceipt(r)){
  const quote=prices.find(p=>p.date===r.date&&p.ticker===r.ticker&&p.currency===FINANCE_CONFIG.currency&&p.price>0);
  const value=quote?cents(quote.price*r.quantity)/100:null;
  return {...base,kind:'rsu_receipt',amount:value,quantity:r.quantity,status:'confirmed',includedInEffectiveIncome:value!==null,ticker:r.ticker,unitPrice:quote?.price,priceBasis:quote?.basis,priceSource:quote?.source,evidence:quote?`Receipt-date effective income · ${quote.source} · ${quote.basis}`:'Explicit RSU share receipt; receipt-date price unavailable.',note:quote?'Recorded shares credited × verified receipt-date regular-session closing price. This is a receipt valuation, not verified gross or after-tax compensation. Later share sales are excluded from new income.':'The feed’s cash amount and price do not value this equity receipt. A verified receipt-date market price is required for the selected effective-income model.'};
 }
 if(allowedRsuTicker(r.ticker)&&r.type==='sell')return {...base,kind:'rsu_sale',amount:Math.abs(r.amount),quantity:Math.abs(r.quantity),status:'excluded',evidence:`Source type sell, ticker ${r.ticker}.`,note:'Recorded share-sale proceeds are asset monetization, not a new paycheck. The feed does not establish which sold lots came from RSUs; capital gains and tax basis are not computed.'};
 if(/\bRSU(?:\b|[0-9#])/i.test(r.description)&&r.type==='cash'&&r.subtype==='withdrawal'){
  if(/refund/i.test(r.description))return {...base,kind:'other',amount:Math.abs(r.amount),status:'excluded',evidence:'Explicit RSU refund journal.',note:'This brokerage refund journal is not additional income. Cash credits follow their own source classification and explicit corrections; equal dates and amounts do not establish a linked duplicate.'};
  if(!/tax|withhold|medicare|social security|federal incom|\bWA (?:MLI|FLI)\b/i.test(r.description))return {...base,kind:'review',amount:Math.abs(r.amount),status:'review',evidence:'RSU-related withdrawal without an explicit tax or withholding label.',note:'This cash movement is not assumed to be tax withholding. Reconcile its purpose before interpreting compensation or tax totals.'};
  return {...base,kind:'rsu_withholding',amount:Math.abs(r.amount),status:'excluded',evidence:'Source explicitly labels RSU tax/withholding cash movement.',note:'Recorded RSU tax journal. Retained as separate settlement evidence; its relationship to received shares is not assumed and it does not automatically alter receipt valuation or tracking surplus.'};
 }
 if(r.type==='cash'&&/CREDIT INT|DEBIT INT|INTEREST/i.test(r.description)&&r.subtype!=='dividend')return {...base,kind:'other',amount:Math.abs(r.amount),status:'excluded',evidence:`Interest-related description conflicts with source subtype ${r.subtype}.`,note:'The cash direction and income treatment are not established. Excluded from confirmed income until the brokerage record is reconciled.'};
 if(r.type==='cash'&&r.subtype==='deposit'&&/PAYROLL|SALARY/i.test(r.description))return {...base,kind:'other',amount:Math.abs(r.amount),status:'excluded',evidence:'Cash deposit with a payroll-related description; no salary category or user confirmation is supplied.',note:'Possible brokerage payroll credit; do not silently count a generic deposit or own-account movement as compensation.'};
 if(r.type==='cash'&&r.subtype==='dividend'&&r.amount<0)return {...base,kind:'dividend',amount:-r.amount,status:'confirmed',evidence:'Source type cash / subtype dividend with credited amount.',note:'Retained inside an investment or tax-advantaged account. Reported separately from operating cash income and the operating cash savings rate; not assumed spendable cash.'};
 if(r.type==='cash'&&r.subtype==='deposit'&&/EMPLOYER CUR YR/i.test(r.description))return {...base,kind:'other',amount:Math.abs(r.amount),status:'excluded',evidence:'Explicit employer HSA contribution.',note:'Non-operating account contribution; separate from take-home payroll. Do not add gross compensation to the net-cash savings denominator.'};
 return null;
}
export function summarizeIncome(data:Dataset,year:number,month:string,scope:PeriodMode='ytd',routine=false):IncomeSummary {
 data=applyIncomePolicy(data);
 if(!Number.isInteger(year)||year<1900||year>2200||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error('Invalid income period.');
 const evidence=data.incomeEvidence;
 const period=resolvePeriod(data,scope==='ytd'&&year!==Number(month.slice(0,4))?`${year}-12`:month,scope);
 const {start,end}=period;
 const within=(date:string)=>date>=start&&date<=end;
 const allBank=data.transactions.map(t=>bankEvent(t,data)).filter((r):r is IncomeEvent=>r!==null);
 const allInvestment=(evidence?.investmentRecords||[]).map(r=>investmentEvent(r,evidence?.rsuPrices||[])).filter((r):r is IncomeEvent=>r!==null);
 const events=[...allBank,...allInvestment].filter(e=>within(e.date)).sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
 const counted=events.filter(e=>e.includedInCashIncome&&e.status==='confirmed');
 const payroll=sum(counted.filter(e=>e.kind==='payroll').map(e=>e.amount||0));
 const bankInterest=sum(events.filter(e=>e.sourceType==='bank'&&e.kind==='interest').map(e=>e.amount||0));
 const otherCashIncome=sum(counted.filter(e=>e.kind==='other').map(e=>e.amount||0));
 const cashIncome=sum(counted.map(e=>e.amount||0));
 const spending=sum(data.transactions.filter(t=>!t.pending&&t.flow==='expense'&&(!routine||!t.exceptional)&&within(t.date)).map(t=>t.amount));
 const appleCardPayments=data.transactions.filter(t=>!t.pending&&t.flow==='expense'&&isAppleCardSpendingProxy(t)&&(!routine||!t.exceptional)&&within(t.date));
 const appleCardSpending=sum(appleCardPayments.map(t=>t.amount)),appleCardPaymentCount=appleCardPayments.length;
 const cashSaved=sum([cashIncome,-spending]);
 const investmentDistributions=sum(events.filter(e=>e.kind==='dividend').map(e=>e.amount||0));
 const reviewAmount=sum(events.filter(e=>e.sourceType==='bank'&&e.status==='review').map(e=>e.amount||0));
 const nonIncomeCredits=sum(events.filter(e=>e.sourceType==='bank'&&e.status==='excluded').map(e=>e.amount||0));
 const rsuShares=events.filter(e=>e.kind==='rsu_receipt').reduce((s,e)=>s+(e.quantity||0),0);
 const rsuSaleProceeds=sum(events.filter(e=>e.kind==='rsu_sale').map(e=>e.amount||0));
 const receipts=events.filter(e=>e.kind==='rsu_receipt');
 const rsuReceiptValuations:RsuReceiptValuation[]=receipts.filter(e=>e.amount!==null&&e.unitPrice!==undefined).map(e=>({id:e.id,date:e.date,accountId:e.accountId,quantity:e.quantity||0,price:e.unitPrice!,value:e.amount!,priceBasis:e.priceBasis||'regular-session close',priceSource:e.priceSource||'Unspecified source',observedAt:evidence?.rsuPrices?.find(p=>p.date===e.date&&p.ticker===e.ticker)?.observedAt,sourceTransactionId:e.sourceTransactionId!}));
 const unpricedRsuReceiptCount=receipts.filter(e=>e.amount===null).length;
 const rsuReceiptValue=!evidence||unpricedRsuReceiptCount?null:sum(receipts.map(e=>e.amount||0));
 const effectiveIncome=rsuReceiptValue===null?null:sum([cashIncome,rsuReceiptValue]);
 const taxEvents=events.filter(e=>e.kind==='rsu_withholding');
 const knownRsuWithholding=sum(taxEvents.map(e=>e.amount||0));
 // Journal amounts do not establish the tax basis of received shares.
 const additionalRecordedRsuWithholding=0;
 // Compatibility alias: the tracking surplus uses recorded receipt valuations without tax assumptions.
 const effectiveSurplusBeforeRsuWithholding=effectiveIncome===null?null:sum([effectiveIncome,-spending]);
 // Retired deduction model. Null prevents API consumers from using the former
 // second-withholding result as an alternative savings total.
 const effectiveSurplusAfterRecordedWithholding=null;
 const effectiveSavings=effectiveSurplusBeforeRsuWithholding;
 const effectiveSavingsRate=effectiveIncome!==null&&effectiveIncome>=1&&effectiveSavings!==null?effectiveSavings/effectiveIncome*100:null;
 const refundJournals=(evidence?.investmentRecords||[]).filter(r=>/\bRSU(?:\b|[0-9#])/i.test(r.description)&&/refund/i.test(r.description)&&r.type==='cash'&&r.subtype==='withdrawal'&&within(r.date));
 const possibleOverlapBankIds=new Set(events.filter(e=>e.sourceType==='bank'&&e.kind==='review'&&/may overlap.*RSU|possible.*RSU|RSU.*overlap/i.test(e.note)&&refundJournals.some(r=>r.date===e.date&&cents(Math.abs(r.amount))===cents(e.amount||0))).map(e=>e.id));
 const potentialRsuRefundOverlapCount=possibleOverlapBankIds.size;
 const potentialRsuRefundOverlap=sum(events.filter(e=>possibleOverlapBankIds.has(e.id)).map(e=>e.amount||0));
 const overlapWarning=potentialRsuRefundOverlapCount?`${potentialRsuRefundOverlapCount} cash credits totaling $${potentialRsuRefundOverlap.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} may overlap RSU refund journals. Matching date and amount is not proof of a duplicate. These credits are excluded from the conservative income baseline pending reconciliation; source descriptions and amounts remain unchanged.`:'';
 const effectiveSavingsNotes=[RSU_RECEIPT_POLICY,
  'Cash-plus-equity tracking income combines explicitly classified cash income and verified RSU receipt valuations. It is not taxable income, after-tax compensation or a bank balance.',
  'Share sales are asset conversions. Investment distributions and tax journals remain separately visible; neither is silently added to operating cash income.',
  ...(overlapWarning?[overlapWarning]:[]),
 ];
 const monthly=[];
 for(const m of period.monthKeys){
  const inMonth=(date:string)=>date.startsWith(m)&&within(date);
  const b=allBank.filter(e=>inMonth(e.date)&&e.includedInCashIncome&&e.status==='confirmed');
  const inc=sum(b.map(e=>e.amount||0));const spend=sum(data.transactions.filter(t=>!t.pending&&t.flow==='expense'&&(!routine||!t.exceptional)&&inMonth(t.date)).map(t=>t.amount));
  const mr=allInvestment.filter(e=>e.kind==='rsu_receipt'&&inMonth(e.date));const priced=!evidence||mr.some(e=>e.amount===null)?null:sum(mr.map(e=>e.amount||0));const mi=priced===null?null:sum([inc,priced]);const mt=allInvestment.filter(e=>e.kind==='rsu_withholding'&&inMonth(e.date));const mtax=sum(mt.map(e=>e.amount||0));const ms=mi===null?null:sum([mi,-spend]);
  monthly.push({appleCardSpending:sum(appleCardPayments.filter(t=>inMonth(t.date)).map(t=>t.amount)),appleCardPaymentCount:appleCardPayments.filter(t=>inMonth(t.date)).length,rsu:priced,effectiveIncome:mi,knownRsuWithholding:mtax,effectiveSurplusBeforeRsuWithholding:ms,effectiveSurplusAfterRecordedWithholding:null,month:m,label:new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-US',{month:'short',year:period.monthKeys[0]?.slice(0,4)!==period.monthKeys.at(-1)?.slice(0,4)?'2-digit':undefined,timeZone:'UTC'}),payroll:sum(b.filter(e=>e.kind==='payroll').map(e=>e.amount||0)),employerCashIncome:inc,interest:sum(b.filter(e=>e.kind==='interest').map(e=>e.amount||0)),other:sum(b.filter(e=>e.kind==='other').map(e=>e.amount||0)),dividends:sum(allInvestment.filter(e=>e.kind==='dividend'&&inMonth(e.date)).map(e=>e.amount||0)),cashIncome:inc,spending:spend,saved:sum([inc,-spend])});
 }
 const accounts=data.accounts.map(a=>{
  const rows=events.filter(e=>e.accountId===a.id);const hist=evidence?.accountHistory.find(h=>h.accountId===a.id);const ar=rows.filter(e=>e.kind==='rsu_receipt');const av=ar.some(e=>e.amount===null)?null:sum(ar.map(e=>e.amount||0));const ac=sum(rows.filter(e=>e.includedInCashIncome).map(e=>e.amount||0));
  return {rsuReceiptValue:av,effectiveIncome:av===null?null:sum([ac,av]),accountId:a.id,accountLabel:`${a.institution} · ${a.name}${a.mask?` · ${a.mask}`:''}`,cashIncome:sum(rows.filter(e=>e.includedInCashIncome).map(e=>e.amount||0)),employerCashIncome:ac,payroll:sum(rows.filter(e=>e.kind==='payroll'&&e.includedInCashIncome).map(e=>e.amount||0)),eventCount:rows.length,investmentFirstDate:hist?.firstDate||null,investmentLastDate:hist?.lastDate||null,coverageNote:a.type==='investment'?(hist?`Recorded investment activity ${hist.firstDate}–${hist.lastDate}; completeness and source freshness unknown.`:'No investment rows returned for the requested scope; this is not proof of no income.'):'Bank transaction query reports complete returned scope; source freshness remains unknown.'};
 });
 const coverageNotes=[...(overlapWarning?[overlapWarning]:[]),`Reporting snapshot ${data.asOf}; retrieved ${evidence?.readAt||data.syncedAt}. Only the listed accounts are covered.`,
  'Bank inflows are classified from source evidence and explicit corrections. Pending credits are excluded.',
  evidence?.investmentCoverage.note||'Brokerage income evidence has not been loaded. Equity-inclusive income is unavailable.',
  'Observed investment dates show evidence availability, not complete brokerage history.',
 ];
 const notes=[RSU_RECEIPT_POLICY,'Cash income includes explicitly classified posted receipts from any employer or source. Transfers, purchase refunds and stock-sale proceeds are not new income.','Investment distributions are shown separately from operating cash income; retirement contributions and employer match are not added to its denominator.',...(evidence?.notes||[])];
 return {year,month,scope,period,nonIncomeCredits,start,end,asOf:data.asOf,readAt:evidence?.readAt||data.syncedAt,cashIncome,appleCardSpending,appleCardPaymentCount,employerCashIncome:cashIncome,payroll,bankInterest,otherCashIncome,investmentDistributions,spending,cashSaved,savingsRate:cashIncome>=1?cashSaved/cashIncome*100:null,confirmedPlusLikely:cashIncome,likelyIncome:0,reviewAmount,rsuShares,rsuVestValue:rsuReceiptValue,rsuWithholding:null,totalCompensation:null,equityInclusiveSavings:effectiveSavings,rsuReceiptValue,rsuReceiptValuations,unpricedRsuReceiptCount,effectiveIncome,knownRsuWithholding,additionalRecordedRsuWithholding,withholdingCoverageComplete:false,effectiveSurplusBeforeRsuWithholding,effectiveSurplusAfterRecordedWithholding,effectiveSavings,effectiveSavingsRate,effectiveSavingsNotes,rsuReceiptShareBasis:'recorded received shares; tax basis unknown',rsuTaxJournalsTreatment:'settlement history only; no second deduction',potentialRsuRefundOverlap,potentialRsuRefundOverlapCount,rsuSaleProceeds,events,monthly,accounts,coverageNotes,notes,sources:evidence?.sources||[],complete:false};
}
