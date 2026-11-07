import type { Dataset, Transaction } from './finance';
import { money } from './finance.ts';
import { summarizeIncome } from './income.ts';
import { isZelleTransaction } from './transaction-policy.ts';
import { applyIncomePolicy, resolvePeriod, type PeriodMode, type ResolvedPeriod } from './periods.ts';
import { applyMerchantIntelligence, canonicalMerchant, merchantKey, accountDisplayName, transactionDisplayName } from './classification.ts';
import { summarizeRecurring, type BillGroup } from './recurring.ts';
import { summarizeCardFees, WALMART_PLUS_REFERENCE } from './card-reference.ts';
import { resolveExpenseCredits } from './expense-credits.ts';
import { scopedSourceCoverage } from './budget-coverage.ts';

export type ReviewKind = 'service-discovery'|'service-status'|'variable-charge'|'renewal'|'similar-charge'|'card-benefits'|'card-fee-reconciliation'|'benefit-candidate'|'category-context'|'category-growth'|'one-off'|'cash-funding'|'purpose';
export type ReviewConfidence = 'high'|'medium'|'candidate';
export interface ReviewEvidence {transactionId?:string;sourceType?:'bank'|'investment'|'provider';date:string;label:string;amount:number;detail:string;inPeriod:boolean}
export interface ReviewStat {label:string;value:number;format?:'money'|'count'|'percent'}
export interface ReviewFinding {
 id:string;kind:ReviewKind;tone:'watch'|'good'|'info';priority:number;confidence:ReviewConfidence;
 title:string;summary:string;why:string;action:string;amount:number|null;amountLabel:string;
 transactionIds:string[];evidence:ReviewEvidence[];stats:ReviewStat[];merchant?:string;category?:string;
 recurringGroupId?:string;destination:'transactions'|'recurring'|'income';comparison?:{start:string;end:string;label:string};
 evidenceKey:string;isReviewed:boolean;newEvidenceSinceReview:boolean;queue:'action'|'context';
 evidenceFacts?:Record<string,string|number|null>;
 sources?:Array<{label:string;url:string;checkedAt:string}>;
}
type FindingDraft=Omit<ReviewFinding,'evidenceKey'|'isReviewed'|'newEvidenceSinceReview'|'queue'>;
export interface ReviewSummary {
 period:ResolvedPeriod;findings:ReviewFinding[];overviewFindings:ReviewFinding[];
 openFindings:ReviewFinding[];contextFindings:ReviewFinding[];reviewedFindings:ReviewFinding[];
 accountingReviewTransactionIds:string[];
 counts:{high:number;medium:number;candidate:number};reviewedTransactions:number;totalSpend:number;
 recurringBlindspots:number;categoryInterpretations:number;summary:string;notes:string[];
}
export const reviewKindLabels:Record<ReviewKind,string>={
 'service-discovery':'Recurring services','variable-charge':'Charge changes',renewal:'Renewal planning',
 'similar-charge':'Similar charges','card-benefits':'Card fees & credits','category-context':'Category reasoning',
 'category-growth':'Spending changes','one-off':'One-off costs','cash-funding':'Income & cash timing',purpose:'Purpose to confirm',
 'service-status':'Service activity',
 'card-fee-reconciliation':'Card fee reconciliation','benefit-candidate':'Membership credit evidence',
};
const cents=(n:number)=>Math.round(n*100);
const total=(rows:Transaction[],fn:(t:Transaction)=>number=t=>t.amount)=>rows.reduce((n,t)=>n+cents(fn(t)),0)/100;
const rounded=(n:number)=>Math.round(n*100)/100;
const unique=<T,>(values:T[])=>[...new Set(values)];
const dateLabel=(d:string)=>new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
const shortMonth=(m:string)=>new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-US',{month:'short',year:'numeric',timeZone:'UTC'});
const monthEnd=(m:string)=>new Date(Date.UTC(Number(m.slice(0,4)),Number(m.slice(5,7)),0)).toISOString().slice(0,10);
const shiftMonth=(m:string,n:number)=>{const d=new Date(`${m}-15T12:00:00Z`);d.setUTCMonth(d.getUTCMonth()+n);return d.toISOString().slice(0,7)};
const fee=(t:Transaction)=>canonicalMerchant(t)==='Card membership fee';
const benefit=(t:Transaction)=>t.amount<0&&t.flow==='expense'&&!fee(t)&&/\b(?:statement credit|digital entertainment credit|resy credit|lululemon credit|oura ring credit|clear (?:plus )?credit|uber (?:cash|credit)|walmart credit|airline fee credit|hotel credit|saks.*credit|amex.*credit|platinum.*credit)\b/i.test(`${t.sourceName||''} ${t.merchant}`);
type InterpretedTransaction=Transaction&{canonicalMerchant?:string;merchantKey?:string;sourceCategory?:string;originalCategory?:string;categoryBasis?:string;categoryReason?:string;categoryConfidence?:string;cardContext?:string|null};
type SmartBill=BillGroup&{recurrenceType?:string;confidence?:ReviewConfidence;evidenceReasons?:string[];inferredOutsideProvider?:boolean;extraDetectedCount?:number;distinctMonths?:number;priceMin?:number|null;priceMax?:number|null;intervalMin?:number|null;intervalMax?:number|null;aliases?:string[];status?:string;statusLabel?:string;statusReason?:string;expectedNextDate?:string|null};
// Ordinary price/usage changes, service activity and cash timing explain the
// recorded history. They do not require an acknowledgment to make it usable.
// Possible duplicate spending can affect totals, so retain that separate check.
const actionKinds=new Set<ReviewKind>(['similar-charge']);
function fingerprint(value:string){let a=2166136261,b=5381;for(let i=0;i<value.length;i++){const c=value.charCodeAt(i);a=Math.imul(a^c,16777619)>>>0;b=(Math.imul(b,33)^c)>>>0;}return `review-v2-${a.toString(16).padStart(8,'0')}${b.toString(16).padStart(8,'0')}`;}
/** Unchanged source evidence stays reviewed when the clock advances. */
export function reviewEvidenceKey(finding:FindingDraft,transactions:Map<string,Transaction>):string {
 const rows=finding.transactionIds.map(id=>transactions.get(id)).filter((t):t is Transaction=>!!t).map(t=>[t.id,t.date,cents(t.amount),t.flow,t.category]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
 const context=finding.evidence.map(e=>[e.sourceType||'bank',e.transactionId||'',e.date,cents(e.amount),e.label,e.detail]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 return fingerprint(JSON.stringify({kind:finding.kind,rows,context,amount:finding.amount,stats:finding.stats,title:finding.title,facts:finding.evidenceFacts||{}}));
}

/** Review facts never change amounts, delete rows, infer cancellation, or predict affordability. */
export function summarizeReview(input:Dataset,month:string,mode:PeriodMode='ytd'):ReviewSummary {
 const data=applyIncomePolicy(applyMerchantIntelligence(input)),period=resolvePeriod(data,month,mode);
 const within=(t:Transaction)=>t.date>=period.start&&t.date<=period.end;
 const historical=data.transactions.filter(t=>!isZelleTransaction(t)&&!t.pending&&t.date<=period.end),selected=historical.filter(within);
 const expenses=selected.filter(t=>t.flow==='expense'),income=summarizeIncome(data,Number(month.slice(0,4)),month,mode);
 const accounts=new Map(data.accounts.map(a=>[a.id,a]));
 const name=(t:Transaction)=>canonicalMerchant(t)||t.merchant;
 const evidence=(rows:Transaction[],limit=14):ReviewEvidence[]=>[...rows].sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id)).slice(0,limit).map(t=>({transactionId:t.id,sourceType:'bank',date:t.date,label:transactionDisplayName(t,accounts.get(t.accountId)),amount:t.amount,detail:`Original payee: ${t.sourceName||t.merchant} · ${accounts.has(t.accountId)?accountDisplayName(accounts.get(t.accountId)!):'Source account'}${accounts.get(t.accountId)?.mask?` · •••• ${accounts.get(t.accountId)!.mask}`:''} · ${t.category}`,inPeriod:within(t)}));
 const findings:FindingDraft[]=[];
 const add=(f:FindingDraft)=>{f.transactionIds=unique(f.transactionIds.filter(id=>selected.some(t=>t.id===id)));findings.push(f)};
 const recurring=summarizeRecurring(data,period);
 const smartGroups=recurring.groups as SmartBill[];
 for(const g of smartGroups){
  if(!['likely-stopped','uncertain'].includes(g.status||'')||g.positiveCount<2||g.recurrenceType==='replenishment')continue;
  add({id:`status:${g.id}`,kind:'service-status',tone:'info',priority:g.status==='likely-stopped'?81:75,confidence:g.status==='likely-stopped'?'medium':'candidate',title:`${g.displayName||g.name}: confirm whether it is still active`,summary:`${g.statusLabel||'Activity needs confirmation'}. Last positive charge: ${g.lastSeen?`${money(g.lastAmount||0,2)} on ${dateLabel(g.lastSeen)}`:'not available'}. ${g.count?`${g.count} source records appear in the selected dates.`:'No matching posted charge appears in the selected dates.'}`,why:`${g.statusReason||'The observed charge history does not establish the service’s current activity.'} An absence of recorded charges is not confirmation of cancellation, an unpaid bill, or payment elsewhere.`,action:'Review the service history, then confirm ongoing or stopped status if you know it. That decision changes the planning view without deleting past costs.',amount:g.net,amountLabel:'Actual net cost in selected dates',transactionIds:g.periodTransactions.map(t=>t.id),evidence:evidence(g.transactions,8),stats:[],merchant:g.name,recurringGroupId:g.id,destination:'recurring',evidenceFacts:{activity:g.status||'uncertain',lastPositiveDate:g.lastSeen,expectedNextDate:g.expectedNextDate||null}});
 }
 const linkedIds=(g:SmartBill)=>new Set(data.recurring.filter(r=>typeof r.stream_id==='string'&&g.providerStreamIds.includes(r.stream_id)).flatMap(r=>Array.isArray(r.transaction_ids)?r.transaction_ids.filter((id):id is string=>typeof id==='string'):[]));
 const extraCharges=(g:SmartBill)=>{const linked=linkedIds(g);return g.periodTransactions.filter(t=>t.amount>0&&!linked.has(t.id));};
 const discovered=smartGroups.filter(g=>extraCharges(g).length>0&&g.recurrenceType!=='replenishment'&&g.recurrenceType!=='repeat-purchase'&&unique(g.transactions.filter(t=>t.amount>0).map(t=>t.date.slice(0,7))).length>=2);
 for(const g of discovered){
  const positive=g.transactions.filter(t=>t.amount>0),cycles=unique(positive.map(t=>t.date.slice(0,7))).length;
  const missing=extraCharges(g),amount=total(g.periodTransactions),hasProvider=g.providerStreamIds.length>0;
  const isKnownService=['subscription','service'].includes(g.recurrenceType||'')||/amazon web services|openai|github|oura|transform|fitness|broadband|spotify|dropbox/i.test(g.name);
  const subscriptionLike=g.recurrenceType==='subscription'||/amazon web services|openai|github|oura|transform|fitness|broadband|spotify|dropbox/i.test(g.name);
  if(!isKnownService&&cycles<3)continue;
  add({id:`service:${g.id}`,kind:'service-discovery',tone:hasProvider||!subscriptionLike?'info':'watch',priority:(hasProvider?65:subscriptionLike?80:isKnownService?68:61)+Math.min(5,Math.log10(Math.max(amount,1))),confidence:g.confidence||'medium',title:hasProvider?`${g.name}: newer charges beyond provider links`:`${g.name}: a recurring series to review`,summary:`${money(amount,2)} net in this period. ${missing.length} posted charge${missing.length===1?' is':'s are'} outside the provider’s linked records; ${cycles} calendar months contain positive charges in the available history through ${dateLabel(period.end)}.`,why:hasProvider?'The provider recognizes this service, but additional source charges are not included in its recurring-stream links. The complete posted series is grouped here without treating predictions as payments.':'The bank’s recurring stream list does not capture this series. Merchant identity, repeated dates and observed charge amounts support reviewing the pattern. This does not establish a fixed subscription or future obligation.',action:'Check what the service is for, how its charges are set, and whether you still use it. Review the original rows before changing its treatment.',amount,amountLabel:'Selected-period net cost',transactionIds:g.periodTransactions.map(t=>t.id),evidence:evidence(g.transactions,12),stats:[{label:'Recorded payment months',value:cycles,format:'count'},{label:'Charges beyond provider links',value:missing.length,format:'count'}],merchant:g.name,recurringGroupId:g.id,destination:'recurring'});
 }
 // Variable billing and price changes are observations, never a claimed plan-price change.
 for(const g of smartGroups){
  // One card account can contain primary-card, additional-card and partial fee
  // components. Their succession does not establish a comparable price series.
  if(g.transactions.some(t=>fee(t)))continue;
  const positive=g.transactions.filter(t=>t.amount>0).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
  const last=positive.at(-1),prior=positive.at(-2);if(!last||!prior||!within(last))continue;
  const currentPositive=positive.filter(within),amounts=currentPositive.map(t=>t.amount),min=Math.min(...amounts),max=Math.max(...amounts),delta=rounded(last.amount-prior.amount);
  const variable=currentPositive.length>=3&&max-min>=20&&max>=Math.max(10,min)*1.5;
  const increased=delta>=5&&delta/Math.max(prior.amount,1)>=0.05;
  if(!variable&&!increased)continue;
  const providerCadences=unique(data.recurring.filter(r=>typeof r.stream_id==='string'&&g.providerStreamIds.includes(r.stream_id)).map(r=>String(r.frequency||'')).filter(Boolean)),mixedCadence=providerCadences.length>1;
  const price=variable?`Recorded charges range from ${money(min,2)} to ${money(max,2)}.`:`The latest charge is ${money(delta,2)} (${(delta/prior.amount*100).toFixed(1)}%) above the preceding recorded charge.`;
  const discoveryIndex=findings.findIndex(f=>f.id===`service:${g.id}`),discovery=discoveryIndex>=0?findings.splice(discoveryIndex,1)[0]:undefined;
  const displayName=g.displayName||g.name;
  add({id:`change:${g.id}`,kind:'variable-charge',tone:mixedCadence?'info':'watch',priority:mixedCadence?65:variable?84:72,confidence:'high',title:mixedCadence?`${displayName}: multiple billing cadences`:variable?`${displayName}: review variable charges`:`${displayName}: latest charge increased`,summary:`${price} Latest: ${money(last.amount,2)} on ${dateLabel(last.date)}; preceding: ${money(prior.amount,2)} on ${dateLabel(prior.date)}.`,why:`${mixedCadence?`The provider labels multiple billing frequencies (${providerCadences.map(v=>v.toLowerCase().replaceAll('_',' ')).join(', ')}) for this merchant. Combining annual and shorter billing amounts does not establish a price increase. `:''}Differences can reflect usage, billing cycles, taxes, add-ons or a price change. The transactions alone do not identify which explanation applies.${discovery?' Additional matching charges are also outside the provider’s recurring links; the full posted series is included.':''}`,action:'Compare the two invoices or payment details. Keep the full recorded expense until the cause is confirmed.',amount:total(g.periodTransactions),amountLabel:'Selected-period net cost',transactionIds:g.periodTransactions.map(t=>t.id),evidence:evidence([last,prior,...currentPositive.filter(t=>t.id!==last.id&&t.id!==prior.id)].slice(0,8)),stats:[{label:'Latest charge',value:last.amount},{label:'Preceding charge',value:prior.amount},{label:'Difference',value:delta}],merchant:g.name,recurringGroupId:g.id,destination:'recurring'});
 }
 const serviceInventory=smartGroups.filter(g=>['service','subscription'].includes(g.recurrenceType||'')&&g.periodTransactions.some(t=>t.amount>0)&&unique(g.transactions.filter(t=>t.amount>0).map(t=>t.date.slice(0,7))).length>=2&&g.confidence!=='candidate'&&!/membership fee/i.test(g.name));
 if(serviceInventory.length>=2){
  const rows=serviceInventory.flatMap(g=>g.periodTransactions),latest=serviceInventory.flatMap(g=>g.transactions.filter(t=>t.amount>0).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,1));
  add({id:'service-inventory',kind:'service-discovery',tone:'info',priority:66,confidence:'high',title:`${serviceInventory.length} repeated service series, in one review`,summary:`${money(total(rows),2)} net in the selected dates across ${serviceInventory.map(g=>g.name).slice(0,6).join(', ')}${serviceInventory.length>6?' and other recorded services':''}.`,why:`Provider-recognized and additionally inferred services are reviewed together. Examples of latest observed charges: ${serviceInventory.filter(g=>/amazon web|github|oura|openai|transform/i.test(g.name)).map(g=>`${g.name} ${money(g.lastAmount||0,2)}`).join('; ')}. These are observed charges, not an annualized commitment or current plan price.`,action:'Review the consolidated payment series for each service, including aliases, irregular charges, original categories and source coverage.',amount:total(rows),amountLabel:'Selected-period net service spending',transactionIds:rows.map(t=>t.id),evidence:evidence(latest,16),stats:[{label:'Repeated service series',value:serviceInventory.length,format:'count'},{label:'Posted source records',value:rows.length,format:'count'}],destination:'recurring'});
 }
 // Exact account/date/value similarity is a review candidate, not proof of duplicate spending.
 const similar=new Map<string,Transaction[]>();
 for(const t of expenses.filter(t=>t.amount>=20)){
  const raw=t.merchant.toLowerCase().replace(/[^a-z0-9]/g,'');
  const key=`${t.accountId}|${t.date}|${cents(t.amount)}|${raw||merchantKey(t)}`;
  similar.set(key,[...(similar.get(key)||[]),t]);
 }
 for(const rows of similar.values())if(rows.length>=2){
  const first=rows[0],amount=total(rows);
  add({id:`similar:${[...rows.map(t=>t.id)].sort().join(':')}`,kind:'similar-charge',tone:'watch',priority:94+Math.min(4,Math.log10(amount)),confidence:'candidate',title:`Check ${rows.length} similar ${name(first)} charges`,summary:`${rows.length} distinct source records show ${money(first.amount,2)} on ${dateLabel(first.date)} in the same account (${money(amount,2)} counted in total).`,why:'Same merchant label, account, date and amount can also represent separate legitimate purchases. Distinct source IDs and descriptions are preserved; no row has been removed or subtracted.',action:'Compare the receipts and posted statement entries. If both are valid, keep both; if one is a duplicate, save a deliberate correction after confirming it.',amount,amountLabel:'Still counted in spending',transactionIds:rows.map(t=>t.id),evidence:evidence(rows),stats:[{label:'Similar source records',value:rows.length,format:'count'},{label:'Each recorded amount',value:first.amount}],merchant:name(first),destination:'transactions'});
 }
 // Posted fee components and a published standard annual fee are different facts.
 for(const card of summarizeCardFees(data,period)){
  if(!card.components.length)continue;
  const rows=card.components.map(component=>component.transaction),reference=card.reference;
  const group=smartGroups.find(g=>g.accountIds.length===1&&g.accountIds[0]===card.accountId&&g.transactions.some(fee));
  const referenceText=reference?`The published standard annual fee is ${money(reference.annualFee,2)}${reference.additionalAnnualFee===null?'':`, with ${money(reference.additionalAnnualFee,2)} published for an additional card`}, checked ${dateLabel(reference.checkedAt)}.`:'The linked account does not establish a unique card product, so no published annual fee is assigned.';
  const componentKey=fingerprint(JSON.stringify(rows.map(t=>[t.id,t.date,cents(t.amount),t.sourceName||t.merchant]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))));
  add({id:`card-fees:${card.accountId}`,kind:'card-fee-reconciliation',tone:'info',priority:78,confidence:'high',title:`${card.productName}: recorded fees versus standard terms`,summary:`${money(card.paid,2)} in posted fee charges minus ${money(card.refunds,2)} in fee adjustments = ${money(card.net,2)} net in the selected dates. ${referenceText}`,why:`The statement descriptors identify fee-related activity, but a latest charge, a sum of components, or a refund does not establish your recurring annual fee. Primary-card, additional-card, upgrade, partial-period or reversal treatment cannot be assigned without the statement’s explanation. ${reference?'The issuer reference is current published product information, not proof of your account’s billing terms or the terms applying to an earlier transaction. '+reference.note:'The source amounts remain recorded exactly; a similar fee amount is not evidence of a particular Chase card product.'}`,action:'Review each dated fee component and the original statement before assigning its purpose. Use the published fee as a reference, never as a replacement for actual spending.',amount:card.net,amountLabel:'Recorded net fees in selected dates',transactionIds:rows.filter(within).map(t=>t.id),evidence:evidence(rows,12).map(row=>({...row,detail:`${row.detail} · Fee component, not assumed annual renewal`})),stats:[{label:'Recorded fee charges',value:card.paid},{label:'Recorded fee adjustments',value:card.refunds},{label:'Recorded net fees',value:card.net},...(reference?[{label:'Published standard annual fee · reference',value:reference.annualFee}]:[])],recurringGroupId:group?.id,destination:group?'recurring':'transactions',evidenceFacts:{referenceFee:reference?.annualFee??null,referenceAdditionalFee:reference?.additionalAnnualFee??null,referenceUrl:reference?.sourceUrl??null,referenceNote:reference?.note??null,componentKey},sources:reference?reference.sourceUrls.map(url=>({label:url.endsWith('.pdf')?'Issuer cardmember agreement':'Issuer published product terms',url,checkedAt:reference.checkedAt})):undefined});
 }
 // Canonical supported membership offsets are explanations, not a repeated
 // confirmation task. Budget and recurring consume this same resolver; no
 // independent date/amount matching rule lives in the review queue.
 const creditAttributions=resolveExpenseCredits(data,period.end),historicalById=new Map(historical.map(t=>[t.id,t]));
 for(const account of data.accounts.filter(a=>a.type==='credit')){
  const pairs=creditAttributions.filter(credit=>credit.kind==='card_benefit'&&credit.status==='inferred_purchase'&&credit.serviceMerchant==='Walmart+'&&credit.purchaseId).flatMap(attribution=>{
   const credit=historicalById.get(attribution.creditId),charge=historicalById.get(attribution.purchaseId!);
   return credit&&charge&&credit.accountId===account.id?[{credit,charge,attribution}]:[];
  });
  const periodPairs=pairs.filter(pair=>within(pair.charge)&&within(pair.credit));if(!periodPairs.length)continue;
  const rows=unique(periodPairs.flatMap(pair=>[pair.charge,pair.credit])),gross=total(periodPairs.map(pair=>pair.charge)),credits=total(periodPairs.map(pair=>pair.credit),t=>-t.amount);
  const group=smartGroups.find(g=>merchantKey(g.name)==='walmartplus'&&g.accountIds.includes(account.id));
  add({id:`walmart-benefit:${account.id}`,kind:'benefit-candidate',tone:'info',priority:79,confidence:'medium',title:`${accountDisplayName(account)}: inferred Walmart+ membership offsets`,summary:`${periodPairs.length} recorded membership charge/credit pairs show ${money(gross,2)} in charges and ${money(credits,2)} in historical offsets in the selected dates. Budget and recurring views use this supported service attribution. It is inferred, not provider-confirmed; source records and saved corrections remain unchanged.`,why:`${unique(periodPairs.map(pair=>pair.attribution.reason)).join(' ')} The issuer publishes a monthly Walmart+ credit up to ${money(WALMART_PLUS_REFERENCE.monthlyFeeBeforeTax,2)} plus applicable taxes. Public terms checked ${dateLabel(WALMART_PLUS_REFERENCE.checkedAt)} describe the product benefit, not your enrollment, eligibility or historical billing terms.`,action:'Open the recorded charges and credits to inspect this inference. If your statement identifies a different purchase purpose, save a correction. Historical offsets do not promise a future discount.',amount:credits,amountLabel:'Inferred posted membership offsets · not confirmed',transactionIds:rows.map(t=>t.id),evidence:evidence(rows,16),stats:[{label:'Recorded membership charges',value:gross},{label:'Inferred historical offsets',value:credits},{label:'Paired monthly cycles',value:unique(periodPairs.map(pair=>pair.charge.date.slice(0,7))).length,format:'count'}],merchant:'Walmart+',recurringGroupId:group?.id,destination:group?'recurring':'transactions',evidenceFacts:{attribution:'inferred_service_offset',benefitSourceUrl:WALMART_PLUS_REFERENCE.sourceUrl,monthlyBenefitReference:WALMART_PLUS_REFERENCE.monthlyFeeBeforeTax,matchBasis:'shared expense-credit resolver'},sources:[...new Set([WALMART_PLUS_REFERENCE.sourceUrl,...WALMART_PLUS_REFERENCE.sourceUrls])].map(url=>({label:'Published Walmart+ membership credit terms',url,checkedAt:WALMART_PLUS_REFERENCE.checkedAt}))});
 }
 // Card identity supplies account context. Only explicit benefit descriptions enter this comparison.
 for(const account of data.accounts.filter(a=>a.type==='credit')){
  const rows=expenses.filter(t=>t.accountId===account.id),fees=rows.filter(fee),credits=rows.filter(benefit);
  const gross=total(fees.filter(t=>t.amount>0)),adjustments=total(fees.filter(t=>t.amount<0),t=>-t.amount),creditAmount=total(credits,t=>-t.amount);
  if(gross<50||credits.length===0)continue;
  add({id:`benefits:${account.id}`,kind:'card-benefits',tone:'info',priority:81,confidence:'high',title:`${accountDisplayName(account)}: fees and posted credits`,summary:`${money(gross,2)} in membership-fee charges${adjustments?`, ${money(adjustments,2)} in fee adjustments`:''}, alongside ${money(creditAmount,2)} in explicitly named card-benefit credits during the selected dates.`,why:'These are separate facts from this account. Benefits already reduce the spending categories where the credits were posted. They are not deducted from membership fees a second time, and this is not an annual card-value or eligibility calculation.',action:'Review which recorded benefits offset purchases you would otherwise make, alongside the fee and your actual card use.',amount:gross,amountLabel:'Gross membership-fee charges',transactionIds:[...fees,...credits].map(t=>t.id),evidence:evidence([...fees,...credits],18),stats:[{label:'Gross membership fees',value:gross},{label:'Fee adjustments',value:adjustments},{label:'Explicit benefit credits',value:creditAmount}],destination:'transactions'});
 }
 // Forward-looking dates remain provider estimates, and historical amounts never become future bills.
 const horizon=new Date(`${period.end}T12:00:00Z`);horizon.setUTCDate(horizon.getUTCDate()+90);const horizonEnd=horizon.toISOString().slice(0,10);
 const renewals=period.end===data.asOf?data.recurring.filter(r=>r.flow_type==='outflow'&&!/\bzelle\b/i.test(`${r.description||''} ${r.merchant_name||''}`)&&r.frequency==='ANNUALLY'&&r.is_active!==false&&typeof r.predicted_next_date==='string'&&r.predicted_next_date>period.end&&r.predicted_next_date<=horizonEnd&&typeof r.last_date==='string'&&r.last_date.slice(0,10)<=period.end&&typeof r.first_date==='string'&&r.first_date.slice(0,10)<=period.end):[];
 for(const r of renewals){
  const ids=Array.isArray(r.transaction_ids)?r.transaction_ids.filter((id):id is string=>typeof id==='string'):[];
  const rows=historical.filter(t=>ids.includes(t.id)&&t.flow==='expense'),last=rows.filter(t=>t.amount>0).sort((a,b)=>b.date.localeCompare(a.date))[0];
  const amount=last?.amount??(typeof r.last_amount==='number'?r.last_amount:null);if(amount===null||amount<=0)continue;
  const account=typeof r.account_id==='string'?accounts.get(r.account_id):undefined,sourceLabel=String(r.description||r.merchant_name||'Annual service'),label=/membership.*fee|fee.*membership/i.test(sourceLabel)&&account?`${accountDisplayName(account)} membership fee`:sourceLabel;
  const group=smartGroups.find(g=>typeof r.stream_id==='string'&&g.providerStreamIds.includes(r.stream_id));
  if(canonicalMerchant(sourceLabel)==='Card membership fee'||group?.transactions.some(fee))continue;
  add({id:`renewal:${r.stream_id||sourceLabel}:${r.account_id||''}`,kind:'renewal',tone:'info',priority:71+Math.min(5,Math.log10(amount)),confidence:'medium',title:`Review the next ${label} renewal`,summary:`The provider estimates ${dateLabel(String(r.predicted_next_date))}. The last available charge was ${money(amount,2)}${last?` on ${dateLabel(last.date)}`:''}${account?` in ${accountDisplayName(account)}`:''}.`,why:'The date is a provider prediction that may be out of date, not a confirmed invoice or proof the service is still active. The historical amount is a reference, not the amount of a future bill.',action:'Check the renewal terms and current price before the estimated date. No cancellation or new expense has been assumed.',amount,amountLabel:'Last recorded charge · reference only',transactionIds:rows.filter(within).map(t=>t.id),evidence:rows.length?evidence(rows):[{sourceType:'provider',date:String(r.last_date).slice(0,10),label:sourceLabel,amount,detail:'Provider recurring summary · original ledger row unavailable',inPeriod:String(r.last_date).slice(0,10)>=period.start}],stats:[],recurringGroupId:group?.id,destination:'recurring',evidenceFacts:{predictedDate:String(r.predicted_next_date),lastDate:String(r.last_date).slice(0,10),sourceLabel}});
 }
 // Source-backed category interpretation is a visible audit trail, not an unexplained rewrite.
 const interpreted=expenses.filter(t=>{const x=t as InterpretedTransaction;return !!x.categoryReason&&!!x.sourceCategory&&x.sourceCategory!==t.category&&['merchant_identity','card_context','source_semantic'].includes(x.categoryBasis||'')});
 const interpretationGroups=new Map<string,Transaction[]>();for(const t of interpreted){const key=fee(t)?`${merchantKey(t)}:${t.accountId}`:merchantKey(t);interpretationGroups.set(key,[...(interpretationGroups.get(key)||[]),t]);}
 for(const [key,rows] of interpretationGroups){
  const first=rows[0] as InterpretedTransaction,amount=total(rows),confidence=rows.every(t=>(t as InterpretedTransaction).categoryConfidence==='HIGH')?'high':'medium';
  add({id:`category:${key}`,kind:'category-context',tone:'info',priority:58+Math.min(8,Math.log10(Math.max(Math.abs(amount),1))*2),confidence,title:`Why ${fee(first)?transactionDisplayName(first,accounts.get(first.accountId)):name(first)} is classified as ${first.category}`,summary:`${rows.length} posted record${rows.length===1?'':'s'}, ${money(amount,2)} net, use ${first.category} in this period. Original source categor${rows.length===1?'y':'ies'}: ${unique(rows.map(t=>(t as InterpretedTransaction).sourceCategory||'Unspecified')).join(', ')}.`,why:unique(rows.map(t=>(t as InterpretedTransaction).categoryReason||'')).slice(0,3).join(' '),action:'Read the original payee and the interpretation reason. Keep a saved correction when your purchase purpose differs from the source evidence.',amount,amountLabel:'Selected-period net amount',transactionIds:rows.map(t=>t.id),evidence:evidence(rows),stats:[],merchant:name(first),category:first.category,destination:'transactions'});
 }
 // Compare like-for-like routine windows, never a partial month against a full month.
 const complete=(start:string,end:string)=>start<=end&&start>=data.dateRange.start&&end<=data.dateRange.end&&end<=period.end&&scopedSourceCoverage(data,{start,end})==='complete_for_query';
 let recentStart='',recentEnd='',priorStart='',priorEnd='',comparisonLabel='';
 if(mode==='month'){
  const prev=shiftMonth(month,-1),day=Number(period.end.slice(8)),partial=period.end<monthEnd(month);
  recentStart=period.start;recentEnd=period.end;priorStart=`${prev}-01`;priorEnd=partial?`${prev}-${String(Math.min(day,Number(monthEnd(prev).slice(8)))).padStart(2,'0')}`:monthEnd(prev);
  comparisonLabel=partial?'matching elapsed calendar days':'complete calendar months';
 }else{
  const latest=period.end===monthEnd(period.end.slice(0,7))?period.end.slice(0,7):shiftMonth(period.end.slice(0,7),-1);
  recentStart=`${shiftMonth(latest,-2)}-01`;recentEnd=monthEnd(latest);priorStart=`${shiftMonth(latest,-5)}-01`;priorEnd=monthEnd(shiftMonth(latest,-3));comparisonLabel='two adjacent three-month windows';
 }
 if(complete(recentStart,recentEnd)&&complete(priorStart,priorEnd)&&(mode==='month'||priorStart>=period.start)){
  const recent=historical.filter(t=>t.flow==='expense'&&!t.exceptional&&t.date>=recentStart&&t.date<=recentEnd),prior=historical.filter(t=>t.flow==='expense'&&!t.exceptional&&t.date>=priorStart&&t.date<=priorEnd);
  const categories=unique(recent.map(t=>t.category));
  const changes=categories.map(category=>{const now=recent.filter(t=>t.category===category),before=prior.filter(t=>t.category===category);return {category,rows:now,current:total(now),previous:total(before)}}).map(x=>({...x,delta:rounded(x.current-x.previous)})).filter(x=>x.previous>=100&&x.delta>=150&&x.current>=x.previous*1.25).sort((a,b)=>b.delta-a.delta).slice(0,3);
  for(const c of changes){const merchants=new Map<string,number>();for(const t of c.rows)merchants.set(name(t),rounded((merchants.get(name(t))||0)+t.amount));const drivers=[...merchants].sort((a,b)=>b[1]-a[1]).slice(0,3);
   add({id:`growth:${c.category}`,kind:'category-growth',tone:'watch',priority:76+Math.min(7,Math.log10(c.delta)),confidence:'high',title:`Routine ${c.category} spending increased`,summary:`${money(c.current,2)} during ${dateLabel(recentStart)}–${dateLabel(recentEnd)}, compared with ${money(c.previous,2)} during ${dateLabel(priorStart)}–${dateLabel(priorEnd)}: ${money(c.delta,2)} higher (${(c.delta/c.previous*100).toFixed(0)}%).`,why:`The comparison uses ${comparisonLabel} and excludes only explicitly tagged one-offs. Recent spending drivers: ${drivers.map(([label,value])=>`${label} ${money(value,2)}`).join('; ')}. A category is a spending-purpose grouping, not proof that every purchase was discretionary.`,action:'Review the actual purchases behind the increase and decide which are continuing costs.',amount:c.delta,amountLabel:'Increase in routine spending',transactionIds:c.rows.filter(within).map(t=>t.id),evidence:evidence([...c.rows].sort((a,b)=>b.amount-a.amount).slice(0,10)),stats:[{label:'Recent routine spending',value:c.current},{label:'Earlier routine spending',value:c.previous},{label:'Increase',value:c.delta}],category:c.category,destination:'transactions',comparison:{start:priorStart,end:priorEnd,label:'Earlier comparison window'}});
  }
 }
 const oneoffs=expenses.filter(t=>t.exceptional),oneoffAmount=total(oneoffs);
 if(oneoffAmount>=100){add({id:'oneoffs',kind:'one-off',tone:'info',priority:68,confidence:'high',title:'Separate one-off costs from your ongoing baseline',summary:`${money(oneoffAmount,2)} in explicitly tagged one-off expenses is included in the selected period’s ${money(total(expenses),2)} net spending.`,why:'This distinction uses saved transaction context, including explicitly tagged exceptional costs. It does not erase real spending or assume other purchases are exceptional.',action:'Keep total spending for the cash review; use the routine view when evaluating the costs likely to continue.',amount:oneoffAmount,amountLabel:'One-offs included in total spending',transactionIds:oneoffs.map(t=>t.id),evidence:evidence(oneoffs,12),stats:[{label:'Total net spending',value:total(expenses)},{label:'Tagged one-offs',value:oneoffAmount},{label:'Routine net spending',value:rounded(total(expenses)-oneoffAmount)}],destination:'transactions'});}
 const cashGap=rounded(income.spending-income.cashIncome);
 if(cashGap>=500){
  const partial=mode==='month'&&period.partial;
  const sales=income.events.filter(e=>e.kind==='rsu_sale'),saleEvidence:ReviewEvidence[]=sales.slice(0,8).map(e=>({transactionId:e.sourceTransactionId,sourceType:'investment',date:e.date,label:e.description,amount:e.amount||0,detail:`Share-sale proceeds · ${accounts.has(e.accountId)?accountDisplayName(accounts.get(e.accountId)!):'Investment account'} · separate from income`,inPeriod:true}));
  const fundingSourceKey=fingerprint(JSON.stringify([...selected.filter(t=>t.flow==='expense'||t.flow==='income').map(t=>[t.id,t.date,cents(t.amount),t.category,t.sourceName||t.merchant]),...sales.map(e=>[e.sourceTransactionId,e.date,cents(e.amount||0),e.kind,e.description])].sort((a,b)=>String(a[0]).localeCompare(String(b[0])))));
  add({id:'cash-funding',kind:'cash-funding',tone:'info',priority:partial?70:76,confidence:'high',title:partial?'Check income timing and recorded asset sales':'Review the cash behind equity income',summary:`Spending exceeds Cash income by ${money(cashGap,2)} in these dates. The investment records separately show ${money(income.rsuSaleProceeds,2)} of Share-sale proceeds; received RSUs are ${income.rsuReceiptValue===null?'unpriced':money(income.rsuReceiptValue,2)} of equity income.`,why:`The recorded sale proceeds show an additional cash-producing event, not new income and not proof that those proceeds paid these purchases. Bank transfer links and account dates are needed to trace that funding. Neither this bridge nor the cash-only gap is an account balance or an affordability verdict.${partial?' This is a partial month; no month-end paycheck is assumed or ruled out.':''}`,action:'Compare the cash income, stock-sale records and brokerage-to-bank movements. Keep sale proceeds separate from income so received equity is counted once.',amount:cashGap,amountLabel:'Spending above Cash income',transactionIds:expenses.filter(t=>t.amount>0).sort((a,b)=>b.amount-a.amount).slice(0,15).map(t=>t.id),evidence:[...saleEvidence,...evidence(expenses.filter(t=>t.amount>0).sort((a,b)=>b.amount-a.amount).slice(0,4))],stats:[{label:'Cash income',value:income.cashIncome},{label:'Net spending',value:income.spending},{label:'Recorded Share-sale proceeds',value:income.rsuSaleProceeds}],destination:'income',evidenceFacts:{saleRecordCount:sales.length,saleValue:income.rsuSaleProceeds,fundingSourceKey}});
 }
 const unresolved=expenses.filter(t=>{const x=t as InterpretedTransaction;return !t.exceptional&&(t.review||t.categoryReviewOptional||x.categoryBasis==='unresolved')&&['Other','Services','Shopping','Health & personal care'].includes(t.category)&&['LOW','UNKNOWN'].includes(x.categoryConfidence||t.confidence)}).sort((a,b)=>b.amount-a.amount);
 if(unresolved.length){add({id:'purpose',kind:'purpose',tone:'info',priority:54,confidence:'candidate',title:'Optional purchase-category detail',summary:`${unresolved.length} expense records totaling ${money(total(unresolved),2)} have weak purpose evidence. Largest examples: ${unique(unresolved.slice(0,4).map(name)).join(', ')}.`,why:'A generic merchant name or merchant-wide spending pattern does not prove the purpose of a particular purchase. These expenses remain counted. Category detail is optional and does not change their recorded total.',action:'Use the receipt or your own context to save a category. The review does not guess a narrower purpose from the merchant name.',amount:total(unresolved),amountLabel:'Expenses still counted',transactionIds:unresolved.map(t=>t.id),evidence:evidence(unresolved.slice(0,12)),stats:[],destination:'transactions'});}
 findings.sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id));
 const transactionIndex=new Map(data.transactions.map(t=>[t.id,t]));
 const evaluated:ReviewFinding[]=findings.map(f=>{const evidenceKey=reviewEvidenceKey(f,transactionIndex),resolution=data.reviewPreferences?.findingResolutions?.[f.id],isReviewed=resolution?.state==='reviewed'&&resolution.evidenceKey===evidenceKey;return {...f,evidenceKey,isReviewed,newEvidenceSinceReview:resolution?.state==='reviewed'&&!isReviewed,queue:actionKinds.has(f.kind)?'action':'context'};});
 const openFindings=evaluated.filter(f=>f.queue==='action'&&!f.isReviewed),contextFindings=evaluated.filter(f=>f.queue==='context'&&!f.isReviewed),reviewedFindings=evaluated.filter(f=>f.isReviewed);
 // A finding acknowledgment cannot resolve transaction accounting. Keep the
 // exact flagged rows visible separately, using the same posted/date scope.
 const accountingReviewTransactionIds=unique(selected.filter(t=>t.review||t.flow==='review').map(t=>t.id));
 const overviewFindings:ReviewFinding[]=[],seenKinds=new Set<ReviewKind>();for(const finding of openFindings){if(seenKinds.has(finding.kind))continue;overviewFindings.push(finding);seenKinds.add(finding.kind);if(overviewFindings.length===3)break;}
 const counts={high:evaluated.filter(f=>f.confidence==='high').length,medium:evaluated.filter(f=>f.confidence==='medium').length,candidate:evaluated.filter(f=>f.confidence==='candidate').length};
 return {period,findings:evaluated,overviewFindings,openFindings,contextFindings,reviewedFindings,accountingReviewTransactionIds,counts,reviewedTransactions:selected.length,totalSpend:total(expenses),recurringBlindspots:discovered.length,categoryInterpretations:interpreted.length,summary:`${accountingReviewTransactionIds.length} flagged transactions · ${openFindings.length} duplicate checks · ${contextFindings.length} optional insights · ${reviewedFindings.length} saved acknowledgments.`,notes:[
  'Amounts in a review card describe its evidence; the cards overlap and must not be added together as a new spending total.',
  'Selected-period totals and transaction drilldowns use the shared exact date window. Earlier source rows are shown only as comparison evidence, and nothing after the selected end date enters historical analysis.',
  'Repeated purchases are not automatically fixed subscriptions. Similar charges are candidates for checking, not deductions. Provider renewal dates and historical prices are planning references only.',
  'Service activity, charge variation, renewal estimates, spending changes and cash timing are optional insights. They never require an acknowledgment, even when new evidence appears.',
  'Flagged transactions require an accounting treatment or an explicit flag change in Transactions. Marking a duplicate check reviewed only acknowledges its evidence; it does not resolve transaction flags or change spending. Existing acknowledgments are retained, and new evidence can reopen a duplicate check.',
  'No purchase is cancelled, no financial action is taken, and no transaction amount is changed by this review.',
 ]};
}
