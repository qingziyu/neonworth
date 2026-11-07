import type { Dataset, Recurring, Transaction } from './finance';
import { isZelleTransaction } from './transaction-policy.ts';
import { accountDisplayName, canonicalMerchant, merchantKey } from './classification.ts';
import { scopedSourceCoverage } from './budget-coverage.ts';
import { resolveExpenseCredits } from './expense-credits.ts';

// Missing billing cycles can support "likely stopped" only when the source
// reports ready, complete coverage for the exact window from the last recorded
// charge to the status date. An unscoped current-query flag, unknown coverage or
// any overlapping partial coverage cannot certify that charges are absent.
// Positive recent activity is evaluated independently and is never weakened here.
export function absenceWindowCovered(data:Dataset,lastChargeDate:string|null|undefined,statusAsOf:string):boolean {
 if(!lastChargeDate)return false;
 const start=lastChargeDate.slice(0,10),end=statusAsOf.slice(0,10);
 if(start>end)return false;
 return scopedSourceCoverage(data,{start,end})==='complete_for_query';
}

export type BillKind='housing'|'internet'|'electricity'|'utilities'|'insurance'|'subscriptions'|'other';
export interface BillPeriod {start:string;end:string;label?:string}
export interface BillHistory {month:string;paid:number;refunds:number;net:number;count:number;completeMonth:boolean}
export type RecurringLifecycleStatus='ongoing'|'stopped'|'likely-stopped'|'uncertain'|'not-applicable';
export interface RecurringLifecycle {status:RecurringLifecycleStatus;statusLabel:string;statusReason:string;statusAsOf:string;statusConfidence:'high'|'medium'|'low';expectedNextDate:string|null;expectedNextConfidence:'high'|'medium'|'low'|null;inferredStatus:Exclude<RecurringLifecycleStatus,'stopped'>;inferredStatusReason:string;statusSource:'inferred'|'user-confirmed'|'user-conflict';statusEffectiveDate:string|null}
export interface BillGroup extends RecurringLifecycle {
 id:string;name:string;displayName:string;kind:BillKind;accountIds:string[];transactions:Transaction[];periodTransactions:Transaction[];
 evidence:'provider'|'categorized'|'inferred'|'user-confirmed';recurrenceType:'subscription'|'service'|'bill'|'replenishment'|'repeat-purchase';confidence:'high'|'medium'|'candidate';evidenceReasons:string[];inferredOutsideProvider:boolean;extraDetectedCount:number;distinctMonths:number;positiveCount:number;priceMin:number|null;priceMax:number|null;intervalMin:number|null;intervalMax:number|null;benefitCredits:number;otherCredits:number;aliases:string[];providerStreamIds:string[];providerActive:boolean|null;frequency:string;cadence:string;
 paid:number;refunds:number;net:number;count:number;lastSeen:string|null;lastAmount:number|null;previousAmount:number|null;amountChange:number|null;
 monthlyAverage:number|null;averageMonths:string[];monthlyEquivalent:number|null;equivalentBasis:string;
 missingMonths:string[];history:BillHistory[];notes:string[];
}
export interface BillAlert {id:string;tone:'watch'|'info';title:string;detail:string;groupId?:string}
export interface RecurringSummary {
 start:string;end:string;lifecycleCounts:{ongoing:number;stopped:number;likelyStopped:number;uncertain:number;notApplicable:number};groups:BillGroup[];repeatPurchases:BillGroup[];inferredGroupCount:number;subscriptionGross:number;subscriptionNet:number;benefitCredits:number;unallocatedBenefitCredits:number;paid:number;refunds:number;net:number;household:number;otherBills:number;
 transactionCount:number;monthlyAverage:number|null;averageMonths:string[];monthlyEquivalent:number|null;estimateGroupCount:number;
 kinds:Array<{kind:BillKind;label:string;value:number;groups:number}>;history:BillHistory[];alerts:BillAlert[];
 unmatchedHouseholdRows:Transaction[];sourceComplete:boolean;providerStreamCount:number;notes:string[];
}
export const billKindLabels:Record<BillKind,string>={housing:'Rent & housing',internet:'Internet & phone',electricity:'Electricity & gas',utilities:'Other utilities',insurance:'Insurance',subscriptions:'Memberships & subscriptions',other:'Other detected bills'};
const cent=(n:number)=>Math.round(n*100),round=(n:number)=>Math.round(n*100)/100;
const sum=(rows:Transaction[],fn:(t:Transaction)=>number)=>rows.reduce((n,t)=>n+cent(fn(t)),0)/100;
const clean=(s:unknown)=>String(s||'').trim();
const normalized=(s:unknown)=>clean(s).toLowerCase().replace(/[^a-z0-9]/g,'');
const month=(d:string)=>d.slice(0,7);
const lastDay=(m:string)=>new Date(Date.UTC(Number(m.slice(0,4)),Number(m.slice(5,7)),0)).toISOString().slice(0,10);
function nextMonth(m:string){const d=new Date(`${m}-15T12:00:00Z`);d.setUTCMonth(d.getUTCMonth()+1);return d.toISOString().slice(0,7)}
function monthKeys(start:string,end:string){const result:string[]=[];for(let m=month(start);m<=month(end)&&result.length<600;m=nextMonth(m))result.push(m);return result}
const primary=(r:Recurring)=>clean((r.personal_finance_category as Record<string,unknown>|undefined)?.primary||r.personal_finance_category_primary).toLowerCase();
const detailed=(r:Recurring)=>clean((r.personal_finance_category as Record<string,unknown>|undefined)?.detailed||r.personal_finance_category_detailed).toLowerCase();
function isRepayment(t:Transaction){return /credit_card_payment|payment_credit_card/.test(t.sourceCategoryDetailed||'')||/\b(?:credit card|apple card)\s+(?:payment|autopay)|\bchase credit crd autopay\b/i.test(`${t.merchant} ${t.sourceName||''}`)}
function householdKind(t:Transaction):BillKind|null {
 const detail=(t.sourceCategoryDetailed||'').toLowerCase(),category=t.category.toLowerCase().replace(/[^a-z]/g,''),description=`${t.merchant} ${t.sourceName||''} ${t.note||''}`;
 if(/housing_(rent|mortgage)|housingrent|housingmortgage/.test(detail)||((category==='housing'||category==='rent')&&!/home_improvement|furniture|garden/.test(detail)&&(/rent|bilt|flats|apartment|lease/i.test(description)||/^transfers_/.test(detail)||category==='rent')))return 'housing';
 if(/internet|cable|telephone|phone|mobile/.test(detail)||((category==='billsutilities'||category==='utilities')&&/astound|broadband|comcast|xfinity|centurylink|quantum fiber|\bt[ -]?mobile\b|verizon|at&t/i.test(description)))return 'internet';
 if(/gas_electricity|electricity|electric_util/.test(detail)||((category==='billsutilities'||category==='utilities')&&/city light|electric|pse energy|puget sound energy/i.test(description)))return 'electricity';
 if(category==='billsutilities'||category==='utilities'||/^bills_utilities_/.test(detail))return 'utilities';
 return null;
}
function providerKind(r:Recurring):BillKind {
 const text=`${r.description||''} ${r.merchant_name||''}`,detail=detailed(r);
 if(/housing_(rent|mortgage)/.test(detail))return 'housing';
 if(/internet|cable|telephone|phone/.test(detail))return 'internet';
 if(/gas_electricity|electricity/.test(detail))return 'electricity';
 if(primary(r)==='bills_utilities')return 'utilities';
 if(/insurance/.test(detail)||/insurance/i.test(text))return 'insurance';
 if(String(r.recurring_transaction_type||'').toUpperCase()==='SUBSCRIPTION'||/membership|subscription|spotify|dropbox|new york times|google one|prime|leetcode|github|chatgpt|oura|momentum/i.test(text))return 'subscriptions';
 return 'other';
}
function eligibleProvider(r:Recurring){return !/\bzelle\b/i.test(`${r.description||''} ${r.merchant_name||''}`)&&r.flow_type==='outflow'&&primary(r)!=='transfers'&&!/transfers_|credit_card_payment/.test(detailed(r))&&!/\b(?:credit card|apple card)\s+(?:payment|autopay)|\bchase credit crd autopay\b/i.test(`${r.description||''} ${r.merchant_name||''}`)}
function frequencyLabel(f:string){const map:Record<string,string>={WEEKLY:'Weekly',BIWEEKLY:'Every two weeks',SEMI_MONTHLY:'Twice monthly',MONTHLY:'Monthly',QUARTERLY:'Quarterly',SEMI_ANNUALLY:'Every six months',ANNUALLY:'Annual'};return map[f]||'Cadence not established'}
function monthlyFactor(f:string):number|null {const map:Record<string,number>={WEEKLY:52/12,BIWEEKLY:26/12,SEMI_MONTHLY:2,MONTHLY:1,QUARTERLY:1/3,SEMI_ANNUALLY:1/6,ANNUALLY:1/12};return map[f]??null}
function observedCadence(rows:Transaction[]){const dates=[...new Set(rows.filter(t=>t.amount>0).map(t=>t.date))].sort();if(dates.length<2)return 'Only one observed payment';const gaps=dates.slice(1).map((d,i)=>Math.round((Date.parse(d)-Date.parse(dates[i]))/86400000));const sorted=[...gaps].sort((a,b)=>a-b),median=sorted[Math.floor(sorted.length/2)];return `Observed intervals ${Math.min(...gaps)}–${Math.max(...gaps)} days · median ${median}`}
function matchesProvider(t:Transaction,r:Recurring){if(r.account_id&&r.account_id!==t.accountId)return false;const names=[r.merchant_name,r.description].map(normalized).filter(Boolean);return [t.merchant,t.sourceName].map(normalized).some(n=>!!n&&names.includes(n))}
function history(rows:Transaction[],start:string,end:string,availableStart:string,availableEnd:string):BillHistory[]{return monthKeys(start,end).map(m=>{const tx=rows.filter(t=>month(t.date)===m&&t.date>=start&&t.date<=end),paid=sum(tx,t=>Math.max(0,t.amount)),refunds=sum(tx,t=>Math.max(0,-t.amount));return {month:m,paid,refunds,net:round(paid-refunds),count:tx.length,completeMonth:`${m}-01`>=start&&`${m}-01`>=availableStart&&lastDay(m)<=end&&lastDay(m)<=availableEnd}})}
type GroupSeed={name:string;kind:BillKind;rows:Transaction[];providers:Recurring[];type:BillGroup['recurrenceType'];key:string};
function semanticType(t:Transaction):{type:BillGroup['recurrenceType'];kind:BillKind;known:boolean} {
 const text=`${t.merchant} ${t.sourceName||''} ${t.note||''}`,detail=t.sourceCategoryDetailed||'',name=merchantKey(t);
 if(genericCardFee(canonicalMerchant(t)))return {type:'bill',kind:'subscriptions',known:true};
 // Exact-counterparty beauty evidence resolves purpose, not an ongoing bill.
 if(/oura/.test(name)&&/shopping_electronics|shopping_clothing/.test(detail))return {type:'repeat-purchase',kind:'other',known:false};
 if(/goodtogo|toll|ezpass|sunpass/.test(name)||/transportation_tolls/.test(detail))return {type:'replenishment',kind:'other',known:true};
 if(/insurance/.test(detail)||/geico|lemonade insurance|progressive|allstate|state farm/i.test(text))return {type:'bill',kind:'insurance',known:true};
 if(/^(?:amazonwebservices|aws)$|cloudflare|digitalocean|googlecloud|microsoftazure/.test(name))return {type:'service',kind:'subscriptions',known:true};
 if(/openai|chatgpt|github|spotify|dropbox|googleone|ouraring|^oura$|walmartplus|amazonprime|primevideo|leetcode|momentumplus|netflix|adobe|icloud|youtube|duolingo/.test(name)||/subscription|membership/i.test(text)&&!/annual membership fee|renewal membership fee/i.test(text))return {type:'subscription',kind:'subscriptions',known:true};
 if(/sephora|le labo|glossier|deciem|charlotte tilbury|jones road/i.test(text))return {type:'repeat-purchase',kind:'other',known:false};
 if(/barber|\bfitness\b|\bgym\b|\bmassage\b|\bsalon\b|\bspa\b/i.test(text)||/health_wellness_(hair_beauty|fitness)/.test(detail))return {type:'service',kind:'subscriptions',known:false};
 if(/^services_/.test(detail)||t.category.toLowerCase()==='services')return {type:'service',kind:'subscriptions',known:false};
 return {type:'repeat-purchase',kind:'other',known:false};
}
function explicitBenefit(t:Transaction){return t.amount<0&&/statement credit|platinum .*credit|amex .*credit|clear plus credit|digital entertainment credit|walmart(?:\s*\+|\s+plus|\s+membership).*credit/i.test(`${t.merchant} ${t.sourceName||''}`)}
function genericCardFee(name:string){return /^(?:card )?membership fee$|renewal membership fee|annual membership fee|membership renewal fee/i.test(name)}
function billMerchant(input:string|Transaction){const name=canonicalMerchant(input);return genericCardFee(name)?'Card membership fee':name}
function periodValue(rows:Transaction[],start:string,end:string){return sum(rows.filter(t=>t.date>=start&&t.date<=end),t=>t.amount)}
function calendarNext(date:string,months:number){const d=new Date(`${date}T12:00:00Z`),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months);d.setUTCDate(Math.min(day,new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate()));return d.toISOString().slice(0,10)}
function lifecycle(data:Dataset,end:string,id:string,g:GroupSeed,positive:Transaction[],regularMonthly:boolean,userConfirmed:boolean,sourceComplete:boolean,feeAmbiguous:boolean):RecurringLifecycle {
 const last=positive[0]||null,age=last?Math.round((Date.parse(end)-Date.parse(last.date))/86400000):Infinity,currentMetadata=end===data.asOf.slice(0,10);
 const providerFreq=currentMetadata?[...new Set(g.providers.map(r=>clean(r.frequency)).filter(Boolean))]:[];
 const uniqueDates=[...new Set(positive.map(t=>t.date))].sort(),gaps=uniqueDates.slice(1).map((d,i)=>Math.round((Date.parse(d)-Date.parse(uniqueDates[i]))/86400000)),sortedGaps=[...gaps].sort((a,b)=>a-b),median=sortedGaps.length?sortedGaps[Math.floor(sortedGaps.length/2)]:null;
 const cycles=new Set(positive.map(t=>month(t.date))).size;
 const monthlyConfirmed=userConfirmed&&/monthly/i.test(positive.map(t=>t.note).join(' '));
 const nominalMonthly=regularMonthly||monthlyConfirmed||providerFreq.length===1&&providerFreq[0]==='MONTHLY'&&cycles>=3;
 const explicitAnnual=positive.some(t=>/\bannual(?:ly)?\b|\byearly\b|12[ -]?month/i.test(`${t.merchant} ${t.sourceName||''}`));
 const observedAnnual=gaps.length>0&&gaps.every(n=>n>=300&&n<=430);
 const annual=!nominalMonthly&&(explicitAnnual||observedAnnual||providerFreq.length===1&&providerFreq[0]==='ANNUALLY');
 const cadenceWindows:Record<string,{days:number;months?:number;grace:number}>={WEEKLY:{days:7,grace:3},BIWEEKLY:{days:14,grace:5},SEMI_MONTHLY:{days:15,grace:5},QUARTERLY:{days:91.3125,months:3,grace:15},SEMI_ANNUALLY:{days:182.625,months:6,grace:21}};
 const periodicFrequency=currentMetadata&&g.providers.length===1&&providerFreq.length===1?providerFreq[0]:null,periodicWindow=periodicFrequency?cadenceWindows[periodicFrequency]:undefined;
 let status:Exclude<RecurringLifecycleStatus,'stopped'>='uncertain',reason='The available charges do not establish whether this cost is still ongoing.',confidence:RecurringLifecycle['statusConfidence']='low',expected:string|null=null,expectedConfidence:RecurringLifecycle['expectedNextConfidence']=null;
 if(g.type==='repeat-purchase'){status='not-applicable';reason='Repeat purchases are spending behavior, not a continuing subscription or commitment.';confidence='high';}
 else if(!last){reason='A provider stream exists, but no dated posted charge is available to establish activity at this reporting date.';}
 else if(feeAmbiguous){
  const feeAccountIds=[...new Set([...g.rows.map(t=>t.accountId),...g.providers.map(r=>clean(r.account_id)).filter(Boolean)])],cardId=feeAccountIds.length===1?feeAccountIds[0]:null;
  const cutoff=new Date(`${end}T12:00:00Z`);cutoff.setUTCDate(cutoff.getUTCDate()-60);const from=cutoff.toISOString().slice(0,10);
  const recent=cardId?data.transactions.filter(t=>t.accountId===cardId&&!t.pending&&t.flow==='expense'&&t.amount>0&&t.date>=from&&t.date<=end&&!isRepayment(t)&&!genericCardFee(canonicalMerchant(t))&&!/^transfers_|financial_.*(?:fees|interest)/.test(t.sourceCategoryDetailed||'')&&!/\bfee\b|\binterest\b/i.test(`${t.merchant} ${t.sourceName||''}`)).sort((a,b)=>b.date.localeCompare(a.date))[0]:undefined;
  if(recent){status='ongoing';reason=`A purchase or bill was posted to this same card on ${recent.date}, supporting ongoing card use. Multiple fee components, differing amounts or adjustments still prevent estimating a single future membership fee or renewal schedule.`;confidence='medium';}
  else{reason=`The latest fee was posted ${last.date}; no recent non-fee purchase is recorded on this exact card to support ongoing use. Multiple fee components or adjustments do not establish a single future renewal amount or schedule.`;confidence='medium';}
 }
 else if(g.type==='replenishment'){
  if(age<=Math.max(60,(median||30)*1.5)){status='ongoing';reason=`A usage-based replenishment was recorded ${last.date}. This supports recent use, not a subscription or scheduled future payment.`;confidence=positive.length>=2?'high':'medium';}
  else{reason=`No replenishment since ${last.date}; usage-driven gaps do not establish that the service stopped.`;confidence='medium';}
 }
 else if(annual){
  expected=calendarNext(last.date,12);expectedConfidence=explicitAnnual?'medium':'low';const dueAge=Math.round((Date.parse(end)-Date.parse(expected))/86400000);
  if(dueAge<=30){status='ongoing';reason=`The last annual-cycle charge was ${last.date}; the next comparable renewal would be around ${expected}. Absence of monthly charges is expected. Renewal and continued service are not confirmed.`;confidence='medium';}
  else if(sourceComplete&&positive.length>=2&&gaps.some(n=>n>=300&&n<=430)&&dueAge>60){status='likely-stopped';reason=`No annual renewal is recorded more than 60 days after the observed renewal window around ${expected}. Likely stopped in the available records; cancellation is not confirmed.`;confidence='medium';}
  else{reason=`The annual renewal window around ${expected} has passed without a matching posted charge. Confirm renewal, a card change or cancellation; sparse annual history does not prove the service ended.`;confidence='medium';}
 }
 else if(nominalMonthly){
  const interval=regularMonthly?(median||30.5):30.5,grace=10,missed=Math.max(0,Math.floor((age-grace)/interval));
  if(regularMonthly||monthlyConfirmed){expected=calendarNext(last.date,1);expectedConfidence=regularMonthly?'medium':'low';}
  else if(currentMetadata&&g.providers.length===1&&clean(g.providers[0].last_date).slice(0,10)===last.date&&g.providers[0].predicted_next_date){expected=clean(g.providers[0].predicted_next_date);expectedConfidence='low';}
  if(age<=interval+grace){status='ongoing';reason=`A recurring charge was recorded ${last.date}, within the observed monthly window. Recent ledger activity takes precedence over an older or inactive provider stream.`;confidence=cycles>=3?'high':'medium';}
  else if(missed>=2&&cycles>=3&&sourceComplete){status='likely-stopped';reason=`No posted charge since ${last.date} (${age} days); at least ${missed} expected monthly cycles have passed including a 10-day timing allowance. Likely stopped in available records, not a confirmed cancellation.`;confidence='medium';}
  else{reason=`No posted charge since ${last.date} (${age} days), beyond the monthly timing window. A pause, policy/product change, payment-method change or missing source record needs confirmation; no cancellation is assumed.`;confidence='medium';}
 }
 else if(periodicWindow&&periodicFrequency){
  if(periodicWindow.months)expected=calendarNext(last.date,periodicWindow.months);
  else{const next=new Date(`${last.date}T12:00:00Z`);next.setUTCDate(next.getUTCDate()+periodicWindow.days);expected=next.toISOString().slice(0,10);}
  expectedConfidence='low';const overdueDays=Math.round((Date.parse(end)-Date.parse(expected))/86400000),missed=Math.max(0,Math.floor((age-periodicWindow.grace)/periodicWindow.days));
  const observedSupport=gaps.length>=2&&gaps.every(n=>n>=periodicWindow.days*.7&&n<=periodicWindow.days*1.3);
  if(overdueDays<=periodicWindow.grace){status='ongoing';reason=`The source labels this ${frequencyLabel(periodicFrequency).toLowerCase()}; the last posted charge was ${last.date}, within its estimated cycle through ${expected} plus a ${periodicWindow.grace}-day timing allowance. This is an estimated billing window, not a confirmed renewal or unpaid bill.`;confidence='medium';}
  else if(sourceComplete&&observedSupport&&positive.length>=3&&missed>=2&&['subscription','service'].includes(g.type)){status='likely-stopped';reason=`No posted charge since ${last.date}; at least ${missed} supported ${frequencyLabel(periodicFrequency).toLowerCase()} cycles have passed including timing allowances. Likely stopped in available records, not a confirmed cancellation.`;confidence='medium';}
  else{reason=`No posted charge since ${last.date}, beyond the estimated ${frequencyLabel(periodicFrequency).toLowerCase()} window around ${expected}. Irregular timing, missing records or a service change needs confirmation; no cancellation or unpaid bill is assumed.`;confidence='medium';}
 }
 else if(positive.length>=2||userConfirmed){
  if(age<=45){status='ongoing';reason=`Recent service/bill activity was recorded ${last.date}. The cadence is variable or combines multiple plans, so no single next payment date is inferred.`;confidence=cycles>=3?'high':'medium';}
  else{reason=`Last charge ${last.date}; observed intervals are ${gaps.length?`${Math.min(...gaps)}–${Math.max(...gaps)} days`:'not established'}. Irregular or sparse billing cannot establish that the service stopped.`;confidence='medium';}
 }
 else{reason=`Only one posted charge is available (${last.date}). Merchant identity suggests a possible recurring service, but continued billing and schedule need confirmation.`;confidence='low';}
 if(!currentMetadata&&g.providers.length)reason+=' Current provider active flags and predictions are not used to reconstruct this historical status.';
 const inferredStatus=status,inferredStatusReason=reason;
 const preferences=(data as Dataset&{reviewPreferences?:{recurringStatuses?:Record<string,{status:'ongoing'|'stopped';effectiveDate:string;updatedAt:string}>}}).reviewPreferences;
 const manual=preferences?.recurringStatuses?.[id];
 let source:RecurringLifecycle['statusSource']='inferred',effectiveDate:string|null=null,finalStatus:RecurringLifecycleStatus=status,label=status==='ongoing'?'Ongoing':status==='likely-stopped'?'Likely stopped':status==='not-applicable'?'Repeat purchase':'Needs confirmation';
 if(manual&&manual.effectiveDate<=end&&g.type!=='repeat-purchase'){
  effectiveDate=manual.effectiveDate;source='user-confirmed';confidence='high';
  if(manual.status==='stopped'){
   const renewed=positive.filter(t=>t.date>manual.effectiveDate);
   if(renewed.length){finalStatus='uncertain';label='Needs confirmation';source='user-conflict';reason=`You marked this stopped effective ${manual.effectiveDate}, but ${renewed.length} later posted charge${renewed.length===1?' was':'s were'} recorded, most recently ${renewed[0].date}. Review a renewal, reactivation or incorrect charge.`;confidence='medium';}
   else{finalStatus='stopped';label='Stopped · you confirmed';reason=`You confirmed this cost stopped effective ${manual.effectiveDate}. Historical charges remain in actual spending.`;}
   expected=null;expectedConfidence=null;
  }else{finalStatus='ongoing';label='Ongoing · you confirmed';reason=`You confirmed this cost is ongoing effective ${manual.effectiveDate}. Recorded prices and any renewal date remain estimates.`;if(expected&&expected<end){expected=null;expectedConfidence=null;}}
 }
 if(!currentMetadata){expected=null;expectedConfidence=null;}
 return {status:finalStatus,statusLabel:label,statusReason:reason,statusAsOf:end,statusConfidence:confidence,expectedNextDate:expected,expectedNextConfidence:expectedConfidence,inferredStatus,inferredStatusReason,statusSource:source,statusEffectiveDate:effectiveDate};
}
export function summarizeRecurring(data:Dataset,period:BillPeriod):RecurringSummary {
 const start=period.start,end=period.end<data.asOf?period.end:data.asOf;
 const providers=data.recurring.filter(eligibleProvider).filter(r=>!r.first_date||clean(r.first_date).slice(0,10)<=end);
 const rows=data.transactions.filter(t=>!isZelleTransaction(t)&&!t.pending&&t.flow==='expense'&&!isRepayment(t)&&t.date<=end);
 const groups=new Map<string,GroupSeed>(),used=new Set<string>();
 const groupKey=(name:string,kind:BillKind,accountId?:string,segment='service')=>kind==='housing'?`housing:${accountId||'unknown'}`:`merchant:${merchantKey(name)}:${segment}${genericCardFee(name)?`:${accountId||'unknown'}`:''}`;
 const add=(id:string,name:string,kind:BillKind,type:BillGroup['recurrenceType'],t?:Transaction,r?:Recurring)=>{let g=groups.get(id);if(!g){g={name,kind,rows:[],providers:[],type,key:id};groups.set(id,g)}if(t&&!used.has(t.id)){g.rows.push(t);used.add(t.id)}if(r&&!g.providers.includes(r))g.providers.push(r);return g};
 const providerIds=new Map<Recurring,string>();
 for(const r of providers){const kind=providerKind(r),name=kind==='housing'?'Rent charges':billMerchant(clean(r.description||r.merchant_name)),type=kind==='housing'||['internet','electricity','utilities','insurance'].includes(kind)?'bill':/amazon web services/i.test(name)?'service':kind==='subscriptions'?'subscription':'service',id=groupKey(name,kind,clean(r.account_id));providerIds.set(r,id);add(id,name,kind,type,undefined,r)}
 const direct=new Map<string,Recurring[]>();for(const r of providers)for(const id of Array.isArray(r.transaction_ids)?r.transaction_ids:[]){if(typeof id==='string')direct.set(id,[...(direct.get(id)||[]),r])}
 for(const t of rows){const linked=direct.get(t.id);if(linked?.length){const r=linked[0],g=groups.get(providerIds.get(r)!)!;add(g.key,g.name,g.kind,g.type,t);continue}const k=householdKind(t);if(k){const name=k==='housing'?'Rent charges':billMerchant(t),id=groupKey(name,k,t.accountId);add(id,name,k,'bill',t);continue}const sem=semanticType(t),name=billMerchant(t),id=groupKey(name,sem.kind,t.accountId,sem.type==='repeat-purchase'?'purchase':'service');add(id,name,sem.kind,sem.type,t)}
 // Reuse the same evidence model as Budget. Only supported named service
 // attribution moves a posted credit into a unique same-account bill history;
 // broad benefits, manual choices and ambiguous credits are not reassigned.
 const creditEvidence=new Map(resolveExpenseCredits(data,end).map(credit=>[credit.creditId,credit]));
 const supportedCredit=(id:string)=>{const credit=creditEvidence.get(id);return credit&&(credit.status==='category_only'||credit.status==='inferred_purchase')?credit:null};
 const isBenefitCredit=(t:Transaction)=>explicitBenefit(t)||supportedCredit(t.id)?.kind==='card_benefit';
 for(const g of groups.values())for(const t of [...g.rows]){
  const credit=supportedCredit(t.id);if(!credit?.serviceMerchant)continue;
  const target=merchantKey(credit.serviceMerchant);
  const candidates=[...groups.values()].filter(other=>merchantKey(other.name)===target&&other.type!=='repeat-purchase'&&other.type!=='replenishment'&&other.rows.some(row=>row.amount>0&&row.accountId===t.accountId));
  if(candidates.length!==1||candidates[0]===g)continue;
  g.rows=g.rows.filter(row=>row.id!==t.id);candidates[0].rows.push(t);
 }
 const completeMonths=monthKeys(data.dateRange.start,end).filter(m=>`${m}-01`>=data.dateRange.start&&lastDay(m)<=end).slice(-3);
 // Summary-level note only: scoped to the displayed window, never an unscoped query flag.
 const sourceComplete=scopedSourceCoverage(data,{start:start.slice(0,10),end:end.slice(0,10)})==='complete_for_query';
 const result:BillGroup[]=[],repeatPurchases:BillGroup[]=[];
 for(const [id,g] of groups){
  const all=[...g.rows].sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id)),selected=all.filter(t=>t.date>=start&&t.date<=end),positive=all.filter(t=>t.amount>0),cycles=[...new Set(positive.map(t=>month(t.date)))].sort(),sem=positive[0]?semanticType(positive[0]):null;
  const categoryEvidence=['housing','internet','electricity','utilities'].includes(g.kind),hasProvider=!!g.providers.length;
  const userConfirmed=positive.some(t=>/user(?:'s|[- ]confirmed).*?(?:subscription|recurring commitment|membership)|confirmed monthly|monthly spa subscription/i.test(t.note));
  if(userConfirmed)g.type='subscription';
  if(g.type==='repeat-purchase'&&(!positive.length||positive.length<3||cycles.length<2))continue;
  if(!hasProvider&&!categoryEvidence&&!userConfirmed&&g.type!=='repeat-purchase'&&cycles.length<2&&!sem?.known)continue;
  if(!all.length&&!hasProvider)continue;
  // Keep inactive/historical series visible so lifecycle filters can show them.
  const paid=sum(selected,t=>Math.max(t.amount,0)),refunds=sum(selected,t=>Math.max(-t.amount,0));
  const benefitCredits=sum(selected.filter(isBenefitCredit),t=>-t.amount),otherCredits=round(refunds-benefitCredits);
  const providerFrequencies=[...new Set(g.providers.map(r=>clean(r.frequency)).filter(Boolean))];
  const uniqueDates=[...new Set(positive.map(t=>t.date))].sort(),gaps=uniqueDates.slice(1).map((d,i)=>Math.round((Date.parse(d)-Date.parse(uniqueDates[i]))/86400000));
  const intervalMin=gaps.length?Math.min(...gaps):null,intervalMax=gaps.length?Math.max(...gaps):null;
  const regularMonthly=cycles.length>=3&&positive.length/cycles.length<=1.35&&gaps.length>=2&&gaps.every(n=>n>=25&&n<=36);
  const observedMonthly=categoryEvidence&&g.kind==='housing'&&cycles.length>=3||regularMonthly;
  const variable=!!gaps.length&&(!regularMonthly&&gaps.some(n=>n<25||n>36)||positive.length/cycles.length>1.35);
  const providerCadenceConflict=regularMonthly&&providerFrequencies.some(f=>f!=='MONTHLY');
  const frequency=userConfirmed&&/monthly/i.test(positive.map(t=>t.note).join(' '))?'MONTHLY':observedMonthly?'MONTHLY':providerFrequencies.length===1?providerFrequencies[0]:providerFrequencies.length>1?'MIXED':'';
  const active=hasProvider&&end===data.asOf.slice(0,10)?g.providers.some(r=>r.is_active===true)?true:g.providers.every(r=>r.is_active===false)?false:null:null;
  const last=positive[0]||null,prior=positive[1]||null;
  const average=completeMonths.length?sum(all.filter(t=>completeMonths.includes(month(t.date))),t=>t.amount)/completeMonths.length:null;
  const averageWithoutBenefits=completeMonths.length?sum(all.filter(t=>completeMonths.includes(month(t.date))&&!isBenefitCredit(t)),t=>t.amount)/completeMonths.length:null;
  const priceMin=positive.length?Math.min(...positive.map(t=>t.amount)):null,priceMax=positive.length?Math.max(...positive.map(t=>t.amount)):null;
  const linkedIds=new Set(g.providers.flatMap(r=>Array.isArray(r.transaction_ids)?r.transaction_ids.filter((v):v is string=>typeof v==='string'):[]));
  const extra=positive.filter(t=>!linkedIds.has(t.id)).length;
  const evidence:BillGroup['evidence']=userConfirmed?'user-confirmed':hasProvider?'provider':categoryEvidence?'categorized':'inferred';
  const confidence:BillGroup['confidence']=userConfirmed||categoryEvidence||hasProvider&&positive.length>=2?'high':cycles.length>=3?'high':cycles.length>=2?'medium':'candidate';
  const evidenceReasons=[`Observed history through ${end}: ${positive.length} posted charge${positive.length===1?'':'s'} across ${cycles.length} distinct month${cycles.length===1?'':'s'}.`];
  if(userConfirmed)evidenceReasons.unshift('Your saved note explicitly confirms the subscription/recurring commitment.');
  if(hasProvider)evidenceReasons.push(`${g.providers.length} provider-detected stream${g.providers.length===1?'':'s'} reconciled with the ledger.`);
  if(extra&&hasProvider)evidenceReasons.push(`${extra} additional posted charge${extra===1?' was':'s were'} found outside the provider’s linked transaction IDs, using the same canonical service identity.`);
  if(!hasProvider&&!categoryEvidence)evidenceReasons.push(g.type==='repeat-purchase'?'Frequency is repeat purchasing, not evidence of a subscription or fixed commitment.':`${sem?.known?'Recognized service/bill merchant':'Service-category history'} plus repeated cycles supports an inferred recurring cost; a fixed schedule is not required.`);
  if(g.type==='replenishment')evidenceReasons.push('Toll/account replenishment follows usage; this is not a subscription.');
  if(g.type==='service'&&/barber/i.test(g.name))evidenceReasons.push('Repeated grooming service with variable cadence; no membership contract is inferred.');
  const accounts=[...new Set([...all.map(t=>t.accountId),...g.providers.map(r=>clean(r.account_id)).filter(Boolean)])];
  const feeGroup=genericCardFee(g.name),feeAmounts=new Set(positive.map(t=>cent(t.amount))),feeAmbiguous=feeGroup&&(g.providers.length>1||all.some(t=>t.amount<0)||positive.length>=2&&feeAmounts.size>1&&gaps.some(n=>n<300));
  const activity=lifecycle(data,end,id,g,positive,regularMonthly,userConfirmed,absenceWindowCovered(data,last?.date,end),feeAmbiguous);
  if(accounts.length>1)evidenceReasons.push(`Merchant aliases reconciled across ${accounts.length} payment accounts; account changes do not split the service history.`);
  const supportedMonthly=regularMonthly||userConfirmed&&frequency==='MONTHLY'||hasProvider&&end===data.asOf.slice(0,10)&&providerFrequencies.length===1&&frequency==='MONTHLY';
  // A missing matched membership cycle is not a zero-price month. Require
  // repeated single-charge cycles and a supported current monthly cadence;
  // variable usage and mixed-plan histories retain their separate cost basis.
  const knownVariableService=/^(?:OpenAI|Amazon Web Services|Cloudflare)$/i.test(g.name);
  const stableFixedMonthly=g.type==='subscription'&&!feeGroup&&!knownVariableService&&supportedMonthly&&cycles.length>=3&&positive.length===cycles.length&&last!==null&&prior!==null&&cent(last.amount)===cent(prior.amount);
  let equivalent:number|null=null,equivalentBasis='Not estimated: cadence or ongoing commitment is insufficiently established';
  const age=last?Math.round((Date.parse(end)-Date.parse(last.date))/86400000):Infinity;
  if(g.type!=='repeat-purchase'&&g.type!=='replenishment'&&activity.status==='ongoing'&&!feeAmbiguous){
   if(userConfirmed&&frequency==='MONTHLY'&&last){equivalent=last.amount;equivalentBasis='User-confirmed monthly subscription · last recorded charge';}
   else if(g.kind==='housing'&&cycles.length>=3&&average!==null){equivalent=round(average);equivalentBasis=`Actual rent averaged across ${completeMonths.length} complete calendar months`;}
   else if(stableFixedMonthly&&last&&age<=60){equivalent=last.amount;equivalentBasis='Supported monthly membership · latest repeated charge; missing matched cycles are not assumed free';}
   else if(regularMonthly&&last&&age<=60&&!variable){equivalent=last.amount;equivalentBasis='Regular observed monthly service/bill · latest posted charge';}
   else if(variable&&['subscription','service'].includes(g.type)&&cycles.length>=3&&completeMonths.length===3&&completeMonths.filter(m=>positive.some(t=>month(t.date)===m)).length>=2&&age<=60&&averageWithoutBenefits!==null){equivalent=round(averageWithoutBenefits);equivalentBasis='Variable service: recorded cost averaged across three complete months, without projecting statement benefits';}
   else if(hasProvider&&end===data.asOf.slice(0,10)&&providerFrequencies.length===1&&frequency!=='MONTHLY'){
    const estimates=g.providers.map(r=>{const ids=new Set(Array.isArray(r.transaction_ids)?r.transaction_ids:[]),observed=positive.find(t=>ids.has(t.id)),amount=observed?.amount??(clean(r.last_date).slice(0,10)<=end?Number(r.last_amount??r.average_amount):NaN),factor=monthlyFactor(clean(r.frequency));return Number.isFinite(amount)&&factor!==null&&r.is_active!==false?amount*factor:null});if(estimates.every(v=>v!==null)){equivalent=round(estimates.reduce<number>((n,v)=>n+(v||0),0));equivalentBasis='Provider cadence normalized from last available source charges';}
   }else if(hasProvider&&end===data.asOf.slice(0,10)&&g.providers.length===1&&last&&!variable&&monthlyFactor(frequency)!==null&&age<=60){equivalent=round(last.amount*monthlyFactor(frequency)!);equivalentBasis='Provider cadence applied to latest matched charge';}
  }
  const historyStart=start>data.dateRange.start?start:data.dateRange.start,groupHistory=history(all,historyStart,end,data.dateRange.start,data.dateRange.end),first=positive.at(-1)?.date;
  const expectedMonthly=(userConfirmed||regularMonthly||stableFixedMonthly||categoryEvidence&&frequency==='MONTHLY')&&g.type!=='replenishment'&&g.type!=='repeat-purchase';
  const missingMonths=expectedMonthly&&first?groupHistory.filter(h=>h.completeMonth&&h.month>=month(first)&&!all.some(t=>t.amount>0&&month(t.date)===h.month)).map(h=>h.month):[];
  const cadence=providerCadenceConflict?'Monthly observed · provider cadence differs':g.type==='replenishment'?'Usage-based replenishment':g.type==='repeat-purchase'?'Repeat discretionary purchases':variable?`${frequency&&frequency!=='MIXED'?frequencyLabel(frequency)+' provider pattern · ':''}Variable / skipped cycles`:frequency?`${frequencyLabel(frequency)}${hasProvider?' · provider label':userConfirmed?' · user-confirmed':' · observed history'}`:cycles.length>=2?'Recurring service · cadence varies':'Possible recurring service · one observed cycle';
  const notes:string[]=[];
  if(categoryEvidence&&!hasProvider)notes.push(g.kind==='housing'?'Categorized rent charges grouped across recorded payee names on this account.':'Categorized household bill evidence.');
  if(providerCadenceConflict)notes.push(`Observed intervals support monthly charges, while the provider labels ${providerFrequencies.map(frequencyLabel).join(' / ')}. The ledger pattern takes precedence; no future schedule is promised.`);
  if(hasProvider)notes.push('Provider detection is evidence of recurrence; its active status does not confirm a currently unpaid bill.');
  if(g.providers.some(r=>r.last_date&&last&&clean(r.last_date).slice(0,10)<last.date))notes.push('Newer canonical-merchant charges were found after the provider stream’s last-seen date.');
  if(missingMonths.length)notes.push('A missing historical cycle is a review signal, not proof that a bill is unpaid or cancelled.');
  if(stableFixedMonthly&&missingMonths.length)notes.push('The planning estimate uses the latest repeated monthly membership charge. Months without a matched charge remain a coverage/linking gap, rather than reducing the ongoing price to zero.');
  if(active===false)notes.push('The provider marks this stream inactive; cancellation is not independently verified.');
  if(g.type==='subscription'&&priceMin!==null&&priceMax!==null&&priceMax>priceMin*1.3)notes.push('Charge amounts vary materially; plan changes, usage or multiple products can explain this. A price increase is not asserted.');
  if(/oura/i.test(g.name))notes.push('Hardware purchases and hardware statement credits are kept separate from Oura service/membership charges.');
  if(benefitCredits)notes.push('Historical credit totals include named issuer/service credits and supported statement-benefit associations. These credits do not reduce the estimated future charge.');
  for(const t of selected){const credit=supportedCredit(t.id);if(credit?.serviceMerchant&&credit.kind==='card_benefit'&&!evidenceReasons.includes(credit.reason))evidenceReasons.push(credit.reason)}
  const feeAccount=accounts.length===1?data.accounts.find(a=>a.id===accounts[0]):undefined;
  const row:BillGroup={id,name:g.name,displayName:feeGroup&&accounts.length===1?`${feeAccount?accountDisplayName(feeAccount):'Unlisted card'} · membership fee`:g.kind==='housing'?'Rent':g.name,kind:g.kind,...activity,accountIds:accounts,transactions:all,periodTransactions:selected,evidence,recurrenceType:g.type,confidence,evidenceReasons,inferredOutsideProvider:extra>0,extraDetectedCount:extra,distinctMonths:cycles.length,positiveCount:positive.length,priceMin,priceMax,intervalMin,intervalMax,benefitCredits,otherCredits,aliases:[...new Set(positive.map(t=>t.merchant))],providerStreamIds:g.providers.map(r=>clean(r.stream_id)).filter(Boolean),providerActive:active,frequency,cadence,paid,refunds,net:round(paid-refunds),count:selected.length,lastSeen:last?.date||g.providers.map(r=>clean(r.last_date).slice(0,10)).filter(d=>!!d&&d<=end).sort().at(-1)||null,lastAmount:last?.amount??null,previousAmount:prior?.amount??null,amountChange:last&&prior?round(last.amount-prior.amount):null,monthlyAverage:average===null?null:round(average),averageMonths:completeMonths,monthlyEquivalent:equivalent,equivalentBasis,missingMonths,history:groupHistory,notes};
  (g.type==='repeat-purchase'?repeatPurchases:result).push(row);
 }
 result.sort((a,b)=>{const order:Record<BillKind,number>={housing:0,internet:1,electricity:2,utilities:3,insurance:4,subscriptions:5,other:6};return order[a.kind]-order[b.kind]||b.net-a.net||a.name.localeCompare(b.name)});
 repeatPurchases.sort((a,b)=>b.net-a.net||b.positiveCount-a.positiveCount);
 const allGrouped=result.flatMap(g=>g.periodTransactions),paid=sum(allGrouped,t=>Math.max(t.amount,0)),refunds=sum(allGrouped,t=>Math.max(-t.amount,0)),net=round(paid-refunds);
 const household=round(result.filter(g=>['housing','internet','electricity','utilities'].includes(g.kind)).reduce((n,g)=>n+g.net,0));
 const baselineRows=result.flatMap(g=>g.transactions).filter(t=>completeMonths.includes(month(t.date))),monthlyAverage=completeMonths.length?round(sum(baselineRows,t=>t.amount)/completeMonths.length):null;
 const estimated=result.filter(g=>g.monthlyEquivalent!==null),monthlyEquivalent=estimated.length?round(estimated.reduce((n,g)=>n+(g.monthlyEquivalent||0),0)):null;
 const subscriptions=result.filter(g=>g.recurrenceType==='subscription'),subscriptionGross=round(subscriptions.reduce((n,g)=>n+g.paid,0)),subscriptionNet=round(subscriptions.reduce((n,g)=>n+g.net,0)),benefitCredits=sum(allGrouped.filter(isBenefitCredit),t=>-t.amount);
 const allocatedIds=new Set(allGrouped.map(t=>t.id)),unallocatedBenefitCredits=sum(rows.filter(t=>t.date>=start&&t.date<=end&&isBenefitCredit(t)&&!allocatedIds.has(t.id)),t=>-t.amount);
 const alerts:BillAlert[]=[];
 for(const g of result){if(!genericCardFee(g.name)&&g.amountChange!==null&&g.amountChange>0.009&&g.lastSeen&&g.lastSeen>=start&&g.lastSeen<=end)alerts.push({id:`change:${g.id}`,tone:'watch',title:`${g.name}: latest charge increased`,detail:`The last posted charge is higher by ${round(g.amountChange).toFixed(2)} USD${g.previousAmount?` (${(g.amountChange/g.previousAmount*100).toFixed(1)}%)`:''}. Compare the service/product and usage before treating this as a price increase.`,groupId:g.id});if(g.missingMonths.length)alerts.push({id:`gap:${g.id}`,tone:'info',title:`${g.name}: review historical gaps`,detail:`No recorded monthly charge in ${g.missingMonths.join(', ')}. Records alone do not establish an unpaid bill, cancellation, or absence of payment elsewhere.`,groupId:g.id})}
 const absentKinds=(['housing','internet','electricity','utilities'] as BillKind[]).filter(k=>!result.some(g=>g.kind===k&&g.periodTransactions.length));if(absentKinds.length)alerts.push({id:'household-gaps',tone:'info',title:'Some household bills are not itemized in this window',detail:`${absentKinds.map(k=>billKindLabels[k]).join(', ')}: no separately matched posted charge. Costs may be bundled into rent or outside linked records.`});
 const lifecycleCounts={ongoing:result.filter(g=>g.status==='ongoing').length,stopped:result.filter(g=>g.status==='stopped').length,likelyStopped:result.filter(g=>g.status==='likely-stopped').length,uncertain:result.filter(g=>g.status==='uncertain').length,notApplicable:repeatPurchases.length+result.filter(g=>g.status==='not-applicable').length};
 return {start,end,lifecycleCounts,groups:result,repeatPurchases,inferredGroupCount:result.filter(g=>g.evidence==='inferred'||g.inferredOutsideProvider).length,subscriptionGross,subscriptionNet,benefitCredits,unallocatedBenefitCredits,paid,refunds,net,household,otherBills:round(net-household),transactionCount:allGrouped.length,monthlyAverage,averageMonths:completeMonths,monthlyEquivalent,estimateGroupCount:estimated.length,kinds:(Object.keys(billKindLabels) as BillKind[]).map(kind=>({kind,label:billKindLabels[kind],value:round(result.filter(g=>g.kind===kind).reduce((n,g)=>n+g.net,0)),groups:result.filter(g=>g.kind===kind).length})),history:history(allGrouped,start,end,data.dateRange.start,data.dateRange.end),alerts,unmatchedHouseholdRows:[],sourceComplete,providerStreamCount:providers.length,notes:[
  'Ongoing, likely stopped and needs-confirmation labels are point-in-time inferences from the available dated ledger. Likely stopped does not mean cancellation is verified. Annual cycles, variable bills and replenishments use different rules; current provider metadata never establishes historical status.',
  'Confirmed lifecycle decisions apply only from their effective date. A new charge after a confirmed stop creates a review conflict. Actual historical spending is never removed by a status decision.',
  'Recurring costs are identified from confirmed user notes, provider streams, household categories and repeated canonical-service activity. Variable prices, skipped cycles and account changes do not prevent a recurring-service inference.',
  'Actual paid totals use each posted expense source ID once, less categorized refunds and named benefits. Transfers, card repayments, payroll and investment funding are excluded.',
  'Retail, groceries, rides and parking can be repeat purchases without being subscriptions. Those merchant histories are shown separately and excluded from bill totals and commitment estimates.',
  'Merchant aliases are consolidated by identity, not equal amounts. Generic card membership fees remain separate for each card. Original merchant names and source records stay visible.',
  `Historical monthly baseline uses ${completeMonths.length} complete calendar months${completeMonths.length?`: ${completeMonths.join(', ')}`:''}; it describes recorded cash costs, not a guaranteed future payment.`,
  'Planning estimates require a supported cadence or a recent multi-month service cost basis. Variable usage services may use a three-month observed rate. Replenishments, ordinary repeat purchases and sparse uncertain schedules are not assigned a monthly commitment.',
  'Named service credits and the shared conservative Walmart+ benefit pattern can offset historical service costs. Inferred pairs are not provider-confirmed. Broad entertainment and hardware benefits remain unallocated to subscriptions; a single date/amount coincidence does not establish a service link. Historical benefits are not projected as future discounts.',
  sourceComplete?'The source reports complete, ready transaction coverage for these dates. Classification and uncaptured accounts can still need review.':'Based on available records; missing activity is not verified zero spending.',
  'Likely stopped requires source coverage that is reported complete and ready for the whole span from the last charge to the status date. Unknown or partial coverage keeps a missing charge as needing confirmation; recent recorded charges support ongoing status on their own.',
 ]};
}
