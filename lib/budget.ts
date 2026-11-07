import { FINANCE_CONFIG } from './finance-config.ts';
import { z } from 'zod';
import { safeRecord } from './validation-record';
import { assessBudgetCoverage, type BudgetCoverageAssessment } from './budget-coverage.ts';
import type { Dataset, Transaction } from './finance';
import { accountDisplayName, canonicalMerchant, type DerivedTransaction } from './classification.ts';
import { summarizeRecurring, type BillGroup } from './recurring.ts';
import { applyIncomePolicy, resolvePeriod, type PeriodMode, type ResolvedPeriod } from './periods.ts';
import { isZelleTransaction, isAppleCardSpendingProxy } from './transaction-policy.ts';
import { REFUND_INFERENCE_WINDOW_DAYS, resolveExpenseCredits, type ExpenseCreditAttribution } from './expense-credits.ts';

export const BUDGET_MONTHLY = [
 {id:'housing',label:'Rent & housing',description:'Posted rent and housing charges; utilities billed with rent stay here.'},
 {id:'utilities',label:'Utilities, internet & phone',description:'Electricity, broadband, mobile and other household utilities; irregular billing stays routine.'},
 {id:'groceries',label:'Groceries',description:'Food and household purchases identified as groceries.'},
 {id:'dining',label:'Dining & coffee',description:'Everyday meals, delivery, coffee and drinks; explicit trip-location spending moves to travel.'},
 {id:'transport',label:'Local transport & auto insurance',description:'Fuel, local rides, parking, tolls and insurance with observed monthly charges.'},
 {id:'care',label:'Health & fitness',description:'Medical care, therapy, pharmacy, optical care and fitness. Grooming, spa and cosmetics use the annual personal-care allowance.'},
 {id:'digital',label:'Digital & monthly subscriptions',description:'Digital purchases and monthly media/software memberships. Explicitly enabled card-payment proxies also belong here. Supported annual subscriptions use periodic fixed bills.'},
 {id:'other',label:'Household services & fees',description:'Cleaning, other household services, bank/service fees and unallocated everyday expenses. These remain counted even if their purpose is uncertain.'},
 {id:'buffer',label:'Shared breathing room',description:'Unassigned room under the overall cap. It absorbs variation rather than encouraging another purchase.'},
] as const;
export const BUDGET_ANNUAL = [
 {id:'travel',label:'Travel & trip spending',description:'Flights, stays, travel services, and purchases with explicit destination evidence. Clothing and gadgets stay in shopping.'},
 {id:'shopping',label:'Clothing, shopping & equipment',description:'Clothing, electronics, hobbies and other retail. Broad retail labels do not identify each purchased item.'},
 {id:'annual_bills',label:'Periodic fixed bills',description:'Annual card fees and supported annual or semiannual insurance/subscriptions. These are routine commitments funded separately from the monthly living ceiling; small bank fees stay monthly.'},
 {id:'gifts',label:'Gifts & donations',description:'Occasional gifts and charitable contributions.'},
 {id:'experiences',label:'Events & leisure',description:'Tickets, attractions and leisure outings; ongoing media subscriptions stay monthly.'},
 {id:'learning',label:'Learning & education',description:'Courses, interview preparation and education purchases.'},
 {id:'occasional_care',label:'Personal care & grooming',description:'Spa, haircuts, beauty treatments, cosmetics and fragrance, including recurring grooming services. Annual is the allowance period, not a claim that billing is annual.'},
] as const;
type MonthlyId=typeof BUDGET_MONTHLY[number]['id'];
type AnnualId=typeof BUDGET_ANNUAL[number]['id'];
export interface AnnualBudgetSchedule {annual:Record<string,number>;clothingOnly?:boolean}
export function budgetAnnualDefinitions(clothingOnly=false):Array<{id:string;label:string;description:string}> {
 if(!clothingOnly)return [...BUDGET_ANNUAL];
 return BUDGET_ANNUAL.flatMap(category=>category.id==='shopping'?[
  {id:'shopping',label:'Clothing',description:'Clothing, footwear and accessories supported by the source category or a clothing-specific merchant; related credits offset purchases.'},
  {id:'other_shopping',label:'Other shopping & equipment',description:'Electronics, household goods and other retail, including purchases whose clothing purpose is not established. These stay visible with no annual allowance.'},
 ]:[category]);
}
export function resolveAnnualPlan(plan:BudgetPlan,year:number):{annual:Record<string,number>;clothingOnly:boolean;effectiveYear:number|null} {
 const applicable=Object.keys(plan.annualSchedules||{}).map(Number).filter(value=>value<=year).sort((a,b)=>b-a)[0];
 const schedule=applicable===undefined?undefined:plan.annualSchedules![String(applicable)];
 return {annual:schedule?.annual||plan.annual,clothingOnly:schedule?.clothingOnly===true,effectiveYear:applicable??null};
}
export interface BudgetPlan {version:1;monthlyCap:number;monthly:Record<string,number>;annual:Record<string,number>;annualSchedules?:Record<string,AnnualBudgetSchedule>;baselineAsOf:string;createdAt:string;recommendation?:{method:'history_cash_constrained';observedAnnualSpending:number;cashIncomeBaseline:number|null;annualCashRoom:number|null;travelShoppingReduction:number}}
const amount=z.number().finite().min(0).max(1_000_000).refine(n=>Math.abs(n*100-Math.round(n*100))<0.000001,'Use dollars and cents.');
const annualAmountsSchema=safeRecord(z.string(),amount).superRefine((values,ctx)=>{const keys=Object.keys(values);if(keys.length!==BUDGET_ANNUAL.length||BUDGET_ANNUAL.some(category=>!keys.includes(category.id)))ctx.addIssue({code:'custom',message:'Use every supported annual category exactly once.'});});
const annualSchedulesSchema=safeRecord(z.string().regex(/^(19|20|21)\d{2}$/,'Use a four-digit effective year between 1900 and 2199.'),z.object({annual:annualAmountsSchema,clothingOnly:z.boolean().optional()}).strict()).refine(value=>Object.keys(value).length<=50,'Too many annual budget changes.');
export const budgetPlanSchema=z.object({version:z.literal(1),monthlyCap:amount,monthly:safeRecord(z.string(),amount),annual:annualAmountsSchema,annualSchedules:annualSchedulesSchema.optional(),baselineAsOf:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>{const d=new Date(s+'T12:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s}),createdAt:z.string().datetime(),recommendation:z.object({method:z.literal('history_cash_constrained'),observedAnnualSpending:z.number().finite(),cashIncomeBaseline:z.number().finite().nullable(),annualCashRoom:z.number().finite().nullable(),travelShoppingReduction:amount}).strict().optional()}).strict().superRefine((p,ctx)=>{
 for(const [name,defs] of [['monthly',BUDGET_MONTHLY],['annual',BUDGET_ANNUAL]] as const){const keys=Object.keys(p[name]);if(keys.length!==defs.length||defs.some(d=>!keys.includes(d.id)))ctx.addIssue({code:'custom',path:[name],message:'Use every supported budget category exactly once.'});}
 if(Math.round(Object.values(p.monthly).reduce((a,b)=>a+b,0)*100)!==Math.round(p.monthlyCap*100))ctx.addIssue({code:'custom',path:['monthly'],message:'Monthly guides, including shared breathing room, must total the chosen monthly ceiling.'});
});
const round=(n:number)=>Math.round(n*100)/100;
const sum=(rows:Transaction[])=>rows.reduce((n,t)=>n+Math.round(t.amount*100),0)/100;
const endOfMonth=(month:string)=>{const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m,0,12)).toISOString().slice(0,10)};
const monthShift=(month:string,shift:number)=>{const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m-1+shift,1,12)).toISOString().slice(0,7)};
const normalized=(s:string)=>(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
function completeMonths(data:Dataset,anchor:string,count:number){const available:string[]=[];for(let i=count;i>=1;i--){const month=monthShift(anchor,i*-1);if(`${month}-01`>=data.dateRange.start&&endOfMonth(month)<=data.asOf&&endOfMonth(month)<=data.dateRange.end)available.push(month);}return available;}
export interface BudgetClassification {bucket:'monthly'|'annual'|'exceptional';id:string;reason:string}
interface Context {annualIds:Set<string>;monthlyInsurance:Set<string>;clothingOnly?:boolean;monthlyIds?:Set<string>;recurringById?:Map<string,BillGroup>;matchedBenefitIds?:Set<string>;credits?:Map<string,ExpenseCreditAttribution>;purchaseById?:Map<string,Transaction>}
function hasProtectedClassification(t:Transaction){const patch=(t as Partial<DerivedTransaction>).classificationOverrides;return !!patch&&['category','flow','exceptional'].some(key=>Object.prototype.hasOwnProperty.call(patch,key));}
function recurringEvidence(data:Dataset,end:string){
 // Notes are preserved in the ledger, but are not commands or proof of cadence here.
 const noteFree={...data,transactions:data.transactions.map(t=>({...t,note:''}))};
 return summarizeRecurring(noteFree,{start:data.dateRange.start,end}).groups;
}
function classificationContext(data:Dataset,asOf:string,clothingOnly=false):Context {
 const annualIds=new Set<string>(),monthlyIds=new Set<string>(),recurringById=new Map<string,BillGroup>();
 for(const r of data.recurring){if(/^(ANNUALLY|SEMI_ANNUALLY|YEARLY)$/i.test(String(r.frequency||''))&&Array.isArray(r.transaction_ids))for(const id of r.transaction_ids)if(typeof id==='string')annualIds.add(id);}
 const groups=recurringEvidence(data,asOf);
 for(const group of groups)for(const t of group.transactions){
  recurringById.set(t.id,group);
  if(group.frequency==='MONTHLY'){monthlyIds.add(t.id);annualIds.delete(t.id);}
  else if(/^(ANNUALLY|SEMI_ANNUALLY|YEARLY)$/.test(group.frequency))annualIds.add(t.id);
 }
 const monthlyInsurance=new Set<string>(),byMerchant=new Map<string,string[]>();
 // Retain historical cadence so silence cannot move earlier monthly costs.
 for(const t of data.transactions){if(t.pending||t.amount<=0||t.flow!=='expense'||t.date>asOf)continue;const n=normalized((t as Partial<DerivedTransaction>).canonicalMerchant||t.merchant);if(!/geico|insurance|lemonade/.test(n))continue;byMerchant.set(n,[...(byMerchant.get(n)||[]),t.date]);}
 for(const [merchant,dates] of byMerchant){const days=[...new Set(dates)].sort();if(days.some((d,i)=>i>1&&[i-1,i].every(j=>{const delta=(Date.parse(days[j])-Date.parse(days[j-1]))/86400000;return delta>=20&&delta<=40})))monthlyInsurance.add(merchant);}
 // One shared credit attribution (also consumable by Recurring) replaces the
 // former budget-only Walmart+ heuristic; the conservative rule is unchanged.
 const credits=new Map(resolveExpenseCredits(data,asOf).map(credit=>[credit.creditId,credit]));
 const matchedBenefitIds=new Set([...credits.values()].filter(c=>c.kind==='card_benefit'&&c.status==='inferred_purchase'&&c.serviceMerchant==='Walmart+').map(c=>c.creditId));
 const purchaseById=new Map<string,Transaction>();for(const t of data.transactions)if(!purchaseById.has(t.id))purchaseById.set(t.id,t);
 return {annualIds,monthlyInsurance,monthlyIds,recurringById,matchedBenefitIds,credits,purchaseById,clothingOnly};
}
function clothingEvidence(t:Transaction):boolean {
 // Source purchase semantics and clothing-specific identities are evidence.
 // User notes, a generic marketplace, or a department-store name alone are not.
 if(/(?:^|[_ ])(?:clothing|apparel|footwear|shoes)(?:[_ ]|$)/i.test(t.sourceCategoryDetailed||''))return true;
 if(['Clothing','Clothing & accessories','Apparel'].includes(t.category))return true;
 const merchant=normalized((t as Partial<DerivedTransaction>).canonicalMerchant||t.merchant);
 return /^(?:lululemon|platinum lululemon credit|skims|goat|uniqlo|zara|h m|hm|abercrombie(?: and fitch)?|aritzia|everlane|nike|adidas)$/.test(merchant);
}
/** Budget grouping is separate from the saved ledger category and never changes source accounting. */
export function classifyBudget(t:Transaction,context:Context={annualIds:new Set(),monthlyInsurance:new Set()}):BudgetClassification|null {
 if(t.pending||t.flow!=='expense'||isZelleTransaction(t))return null;
 const d=t as Partial<DerivedTransaction>,category=t.category,merchant=normalized(d.canonicalMerchant||t.merchant),name=normalized(`${t.merchant} ${t.sourceName||''}`),detail=t.sourceCategoryDetailed||'';
 const group=(bucket:BudgetClassification['bucket'],id:string,reason:string)=>({bucket,id,reason});
 const geo=d.geographicContext;
 const explicitTrip=geo?.basis==='trip_context'; // Explicit saved trip context only; merchant country does not prove travel.
 if(t.exceptional||category==='Tax settlement')return group('exceptional','exceptional','Explicit one-off expense, kept outside monthly living and annual allowances.');
 if(isAppleCardSpendingProxy(t)||category==='Digital spending')return group('monthly','digital','Digital spending classified explicitly or by an enabled payment proxy, counted once.');
 if(context.matchedBenefitIds?.has(t.id))return group('monthly','digital','Inferred Walmart+ benefit credit: a unique same-day, exact-amount membership charge on the same Amex Platinum account, supported by at least three distinct monthly pairs. Unmatched expense credits retain their original retail budget category; this is not a provider-linked pair.');
 const credit=t.amount<0&&!hasProtectedClassification(t)?context.credits?.get(t.id):undefined;
 if(credit?.status==='inferred_purchase'&&credit.kind==='purchase_refund'&&credit.purchaseId){
  // An inferred refund follows its single matched purchase's budget group; the
  // source row, sign, date and ledger category are unchanged.
  const purchase=context.purchaseById?.get(credit.purchaseId);
  const base=purchase&&purchase.amount>0?classifyBudget(purchase,context):null;
  if(base)return group(base.bucket,base.id,`Inferred refund of a ${purchase!.date} purchase: same account, same merchant, exact amount within ${REFUND_INFERENCE_WINDOW_DAYS} days. Not provider-confirmed. ${base.reason}`);
 }
 if(credit?.status==='category_only'&&credit.purpose&&(credit.kind==='card_benefit'||credit.kind==='fee_adjustment')){
  const note=' Category-level purpose from the statement descriptor; no specific purchase is identified and no future benefit is assumed.';
  switch(credit.purpose){
   case 'digital':return group('monthly','digital',credit.reason+note);
   case 'dining':return group('monthly','dining',credit.reason+note);
   case 'clothing':return group('annual','shopping',credit.reason+note);
   case 'retail':return group('annual',context.clothingOnly?'other_shopping':'shopping',credit.reason+note);
   case 'travel':return group('annual','travel',credit.reason+note);
   case 'periodic_fixed':return group('annual','annual_bills',credit.reason+note);
  }
 }
 if(category==='Housing'&&/home_improvement|furniture|garden/.test(detail))return group('annual',context.clothingOnly?'other_shopping':'shopping','Source describes household or gardening materials, not rent. Retail stays visible outside the clothing allowance.');
 if(category==='Housing')return group('monthly','housing','Rent and housing remain in the monthly living ceiling.');
 if(category==='Bills & utilities')return group('monthly','utilities','Essential household utilities remain monthly living costs even when bills arrive irregularly.');
 if(/laundry_dry_cleaning/.test(detail)&&['Health & personal care','Services'].includes(category))return group('monthly','other','The detailed source identifies laundry/dry cleaning, a household service rather than medical care or grooming.');
 if(category==='Travel'&&/^(clear|clear plus|amex clear plus credit|clear plus credit)$/.test(merchant))return group('annual','annual_bills','CLEAR membership and its explicitly named statement credit are periodic fixed costs; net actual charges remain separate from the travel allowance.');
 const grooming=/hair_beauty|personal_care|cosmetic|beauty/.test(detail)||/barber|hair salon|beauty|cosmetics|spa/.test(name);
 if(grooming&&['Health & personal care','Services','Shopping','Personal care','Beauty'].includes(category))return group('annual','occasional_care','Grooming, spa or beauty purpose belongs to the annual personal-care allowance, including monthly memberships. Medical care and fitness are separate.');
 const digital=canonicalMerchant(t)==='Walmart+'||/kindle unlimited|amazon kindle|openai|chatgpt|anthropic|github|google one|cloudflare|amazon web services|nordvpn|walmart plus|walmart membership|spotify|new york times|prime video|digital entertainment credit|netflix|hulu|disney|apple tv|momentum plus|dropbox|amazon prime|hinge/.test(name)||/subscription|digital_media|software/.test(detail);
 const isAnnual=context.annualIds.has(t.id)&&!context.monthlyIds?.has(t.id);
 if(digital&&['Services','Entertainment','Shopping'].includes(category))return isAnnual?group('annual','annual_bills','Digital membership with supported annual or semiannual billing; funded as a periodic fixed bill.'):group('monthly','digital','Digital purchase or monthly service. Observed monthly cadence takes precedence over a conflicting annual provider label.');
 if(/shopping_convenience_stores/.test(detail))return explicitTrip?group('annual','travel',`Convenience-store purchase with destination evidence: ${geo!.label}. Individual goods are not identified.`):group('monthly','groceries','Source identifies a convenience store, an everyday consumables category rather than annual clothing/equipment. Individual goods are not identified.');
 if(category==='Shopping'||context.clothingOnly&&['Clothing','Clothing & accessories','Apparel'].includes(category)) {
  if(!context.clothingOnly)return group('annual','shopping','Retail spending is planned across the year, including clothing and equipment.');
  return clothingEvidence(t)?group('annual','shopping','Source clothing category or clothing-specific merchant supports the clothing allowance.'):group('annual','other_shopping','Clothing purpose is not established. This retail expense remains counted outside the clothing allowance.');
 }
 if(category==='Travel')return group('annual','travel','Saved travel category.');
 if(explicitTrip&&['Dining & coffee','Groceries','Transport','Entertainment','Other'].includes(category))return group('annual','travel',`Destination evidence: ${geo!.label}. ${geo!.reason}`);
 if(d.merchantServiceQualifier==='card_fee'||canonicalMerchant(t)==='Card membership fee')return group('annual','annual_bills','Card membership fees and attributable adjustments, identified by card. Net spending is actual charges less recorded adjustments, not a quoted annual renewal price.');
 if(category==='Gifts & donations')return group('annual','gifts','Gift or donation; annual discretionary allowance.');
 if(category==='Education')return group('annual','learning','Learning purpose uses its annual discretionary allowance, regardless of billing cadence.');
 if(category==='Groceries')return group('monthly','groceries','Routine groceries.');
 if(category==='Dining & coffee')return group('monthly','dining','Everyday dining without explicit destination evidence.');
 if(category==='Transport')return group('monthly','transport','Local transport without explicit trip context.');
 if(category==='Financial & insurance'){
  if(/visa.*consular|consular.*fee/.test(name)||explicitTrip&&/foreign exchange|foreign transaction/.test(name))return group('annual','travel','Visa/consular or destination-specific currency fee tied to travel; not an annual fixed bill.');
  if(/monthly service fee|atm.*fee|(?:service|maintenance|overdraft|insufficient funds|returned (?:item|check)|wire|check).*fee|fee.*(?:atm|wire|check)/.test(name)&&!/annual (?:account|maintenance|service) fee/.test(name))return group('monthly','other','Bank service, ATM, wire or check fee belongs to monthly living costs. Its explicit purpose takes precedence over a conflicting annual provider label.');
  if(isAnnual)return group('annual','annual_bills','Insurance or bill with supported annual/semiannual cadence; actual refunds offset the same periodic category.');
  if(context.monthlyInsurance.has(merchant)||/insurance/.test(detail)&&context.monthlyIds?.has(t.id))return group('monthly','transport','Insurance with observed monthly payments remains in monthly living costs; silence does not change prior payments.');
  return group('monthly','other','Bank/service/ATM fees or insurance without established periodic billing remain visible in monthly living costs. No annual obligation is invented.');
 }
 if(category==='Health & personal care')return group('monthly','care','Medical, pharmacy, therapy, optical or fitness costs remain monthly living expenses. Identified grooming/spa/beauty is budgeted separately.');
 if(category==='Services')return isAnnual?group('annual','annual_bills','Source-supported periodic service bill; annual funding does not make it discretionary.'):group('monthly','other','Household or other non-digital service. Service is not assumed to mean software or subscription.');
 if(category==='Entertainment')return group('annual','experiences','Tickets and occasional leisure experiences; ongoing digital media is separated above.');
 return group('monthly','other','Unallocated posted spending remains inside the monthly living ceiling; no expense disappears.');
}
export interface BudgetRow {id:string;label:string;description:string;actual:number;baseline:number|null;median:number|null;limit:number;remaining:number;ids:string[];baselineIds:string[];monthActual:number;monthRemaining:number;monthIds:string[]}
export interface AnnualBudgetRow extends BudgetRow {actualYtd:number;remainingAnnual:number;pastYear:number;baselineAnnual:number|null;ytdIds:string[];pastYearIds:string[]}
export interface BudgetTotals {routine:number;annual:number;exceptional:number;total:number}
export interface BudgetCategoryHistory {month:string;monthly:Record<string,number>;annual:Record<string,number>;monthlyIds:Record<string,string[]>;annualIds:Record<string,string[]>;exceptional:number;exceptionalIds:string[];total:number;coverage:BudgetCoverageAssessment}
export interface BudgetSummary {
 coverage:BudgetCoverageAssessment;baselineCoverage:BudgetCoverageAssessment;categoryHistory:BudgetCategoryHistory[];
 period:ResolvedPeriod;monthlyRows:BudgetRow[];annualRows:AnnualBudgetRow[];monthlyTotal:number;annualTotal:number;exceptionalTotal:number;totalSpending:number;unresolvedOutflows:number;
 baselineMonths:string[];annualBaselineMonths:string[];history:Array<BudgetTotals&{month:string;cap:number;partial:boolean}>;
 fixedAnnualAllowance:number;discretionaryAnnualAllowance:number;routineFundingGuide:number;assignments:BudgetAssignment[];annualEffectiveYear:number|null;annualClothingOnly:boolean;monthlyCap:number;monthlyBaseline:number|null;annualAllowance:number;annualFundingGuide:number;cashIncomeBaseline:number|null;
 selectedMonth:{actual:number;remaining:number;period:ResolvedPeriod;coverage:BudgetCoverageAssessment};yearToDate:BudgetTotals;pastYear:BudgetTotals;exceptionalIds:string[];monthlyIds:string[];annualIds:string[];warnings:string[];
}
function rowsAndGroups(data:Dataset,end:string,clothingOnly=false){const context=classificationContext(data,data.asOf,clothingOnly),rows=data.transactions.filter(t=>t.date<=end&&t.date>=data.dateRange.start).map(t=>({t,g:classifyBudget(t,context)})).filter((x):x is {t:Transaction;g:BudgetClassification}=>x.g!==null);return rows;}
export function suggestBudgetPlan(input:Dataset,monthlyCap=FINANCE_CONFIG.suggestedMonthlyBudget):BudgetPlan {
 const data=applyIncomePolicy(input),annualMonths=completeMonths(data,data.asOf.slice(0,7),12),rows=rowsAndGroups(data,data.asOf).filter(x=>annualMonths.includes(x.t.date.slice(0,7))),baseMonths=completeMonths(data,data.asOf.slice(0,7),3);
 const annual=Object.fromEntries(BUDGET_ANNUAL.map(c=>[c.id,Math.ceil(Math.max(0,sum(rows.filter(x=>x.g.bucket==='annual'&&x.g.id===c.id).map(x=>x.t)))/100)*100]));
 const cashRows=data.transactions.filter(t=>!t.pending&&t.flow==='income'&&!isZelleTransaction(t)&&baseMonths.includes(t.date.slice(0,7)));
 const cashIncomeBaseline=baseMonths.length===3?round(-sum(cashRows)/baseMonths.length):null,annualCashRoom=cashIncomeBaseline===null?null:Math.max(0,round((cashIncomeBaseline-monthlyCap)*12));
 const flexible=annual.travel+annual.shopping,other=Object.entries(annual).filter(([id])=>!['travel','shopping'].includes(id)).reduce((n,[,value])=>n+value,0);
 let travelShoppingReduction=0;
 if(annualCashRoom!==null&&other+flexible>annualCashRoom&&flexible>0){const room=Math.max(0,annualCashRoom-other),factor=Math.min(1,room/flexible);annual.travel=Math.floor(annual.travel*factor/100)*100;annual.shopping=Math.floor(annual.shopping*factor/100)*100;travelShoppingReduction=round(flexible-annual.travel-annual.shopping);}
 return {version:1,monthlyCap,monthly:Object.fromEntries(BUDGET_MONTHLY.map(category=>[category.id,category.id==='buffer'?monthlyCap:0])),annual,baselineAsOf:data.asOf,createdAt:new Date().toISOString(),recommendation:{method:'history_cash_constrained',observedAnnualSpending:sum(rows.filter(x=>x.g.bucket==='annual').map(x=>x.t)),cashIncomeBaseline,annualCashRoom,travelShoppingReduction}};
}
export function summarizeBudget(input:Dataset,month:string,mode:PeriodMode,plan:BudgetPlan):BudgetSummary {
 const data=applyIncomePolicy(input),period=resolvePeriod(data,month,mode),monthPeriod=resolvePeriod(data,month,'month'),ytd=resolvePeriod(data,month,'ytd'),past=resolvePeriod(data,month,'year');
 const annualPlan=resolveAnnualPlan(plan,Number(month.slice(0,4))),annualDefinitions=budgetAnnualDefinitions(annualPlan.clothingOnly);
 const anchor=data.asOf.slice(0,7),baselineCandidates=completeMonths(data,anchor,3),annualBaselineMonths=completeMonths(data,anchor,12),all=rowsAndGroups(data,data.asOf,annualPlan.clothingOnly);
 const safeCoverage=(p:{start:string;end:string})=>assessBudgetCoverage(data,{start:p.start,end:p.end<p.start?p.start:p.end});
 const coverage=safeCoverage(period),monthCoverage=safeCoverage(monthPeriod),baselineCoverage=safeCoverage({start:baselineCandidates.length?baselineCandidates[0]+'-01':data.asOf,end:baselineCandidates.length?endOfMonth(baselineCandidates.at(-1)!):data.asOf});
 const baselineMonths=baselineCandidates.length===3&&baselineCoverage.comparable?baselineCandidates:[];
 const inPeriod=(t:Transaction,p:ResolvedPeriod)=>!p.empty&&t.date>=p.start&&t.date<=p.end;
 const actualRows=all.filter(x=>inPeriod(x.t,period)),baseRows=all.filter(x=>baselineMonths.includes(x.t.date.slice(0,7))),annualBase=all.filter(x=>annualBaselineMonths.includes(x.t.date.slice(0,7)));
 const totals=(p:ResolvedPeriod):BudgetTotals=>{const r=all.filter(x=>inPeriod(x.t,p));return {routine:sum(r.filter(x=>x.g.bucket==='monthly').map(x=>x.t)),annual:sum(r.filter(x=>x.g.bucket==='annual').map(x=>x.t)),exceptional:sum(r.filter(x=>x.g.bucket==='exceptional').map(x=>x.t)),total:sum(r.map(x=>x.t))}};
 const periodWeight=mode==='month'?1:period.monthKeys.reduce((n,m)=>{if(mode==='ytd')return n+1;const start=period.start>`${m}-01`?Number(period.start.slice(8)):1,end=period.end<endOfMonth(m)?Number(period.end.slice(8)):Number(endOfMonth(m).slice(8));return n+(end-start+1)/Number(endOfMonth(m).slice(8));},0);
 const row=(c:{id:string;label:string;description:string},bucket:'monthly'|'annual'):BudgetRow=>{
  const subset=actualRows.filter(x=>x.g.bucket===bucket&&x.g.id===c.id),baseline=baseRows.filter(x=>x.g.bucket===bucket&&x.g.id===c.id),mr=all.filter(x=>x.g.bucket===bucket&&x.g.id===c.id&&inPeriod(x.t,monthPeriod));
  const values=baselineMonths.map(m=>sum(baseline.filter(x=>x.t.date.startsWith(m)).map(x=>x.t))).sort((a,b)=>a-b),median=values.length?values.length%2?values[Math.floor(values.length/2)]:round((values[values.length/2-1]+values[values.length/2])/2):null;
  const actual=sum(subset.map(x=>x.t)),limit=bucket==='monthly'?round(plan.monthly[c.id]*periodWeight):(annualPlan.annual[c.id]??0),monthActual=sum(mr.map(x=>x.t));
  return {...c,actual,baseline:baselineMonths.length?round(sum(baseline.map(x=>x.t))/baselineMonths.length):null,median,limit,remaining:round(limit-actual),ids:subset.map(x=>x.t.id),baselineIds:baseline.map(x=>x.t.id),monthActual,monthRemaining:round((bucket==='monthly'?plan.monthly[c.id]:(annualPlan.annual[c.id]??0))-monthActual),monthIds:mr.map(x=>x.t.id)};
 };
 const monthlyRows=BUDGET_MONTHLY.map(c=>row(c,'monthly')),annualRows=annualDefinitions.map(c=>{const yr=all.filter(x=>x.g.bucket==='annual'&&x.g.id===c.id&&inPeriod(x.t,ytd)),pr=all.filter(x=>x.g.bucket==='annual'&&x.g.id===c.id&&inPeriod(x.t,past)),actualYtd=sum(yr.map(x=>x.t));return {...row(c,'annual'),actualYtd,remainingAnnual:round((annualPlan.annual[c.id]??0)-actualYtd),pastYear:sum(pr.map(x=>x.t)),baselineAnnual:annualBaselineMonths.length?sum(annualBase.filter(x=>x.g.bucket==='annual'&&x.g.id===c.id).map(x=>x.t)):null,ytdIds:yr.map(x=>x.t.id),pastYearIds:pr.map(x=>x.t.id)}});
 const selected=totals(period),monthly=totals(monthPeriod),annualAllowance=round(Object.values(annualPlan.annual).reduce((n,v)=>n+v,0));
 const history=period.monthKeys.map(m=>{const p={...period,start:period.start>`${m}-01`?period.start:`${m}-01`,end:period.end<endOfMonth(m)?period.end:endOfMonth(m)};return {month:m,...totals(p),cap:plan.monthlyCap,partial:p.start!==`${m}-01`||p.end!==endOfMonth(m)}});
 const categoryHistory=period.monthKeys.map(m=>{const start=period.start>m+'-01'?period.start:m+'-01',end=period.end<endOfMonth(m)?period.end:endOfMonth(m),rows=all.filter(x=>x.t.date>=start&&x.t.date<=end);const grouped=(bucket:'monthly'|'annual',defs:ReadonlyArray<{id:string}>)=>Object.fromEntries(defs.map(c=>[c.id,rows.filter(x=>x.g.bucket===bucket&&x.g.id===c.id)]));const monthly=grouped('monthly',BUDGET_MONTHLY),annual=grouped('annual',annualDefinitions);return {month:m,monthly:Object.fromEntries(Object.entries(monthly).map(([k,r])=>[k,sum(r.map(x=>x.t))])),annual:Object.fromEntries(Object.entries(annual).map(([k,r])=>[k,sum(r.map(x=>x.t))])),monthlyIds:Object.fromEntries(Object.entries(monthly).map(([k,r])=>[k,r.map(x=>x.t.id)])),annualIds:Object.fromEntries(Object.entries(annual).map(([k,r])=>[k,r.map(x=>x.t.id)])),exceptional:sum(rows.filter(x=>x.g.bucket==='exceptional').map(x=>x.t)),exceptionalIds:rows.filter(x=>x.g.bucket==='exceptional').map(x=>x.t.id),total:sum(rows.map(x=>x.t)),coverage:safeCoverage({start,end})};});
 const cashRows=data.transactions.filter(t=>!t.pending&&t.flow==='income'&&!isZelleTransaction(t)&&baselineMonths.includes(t.date.slice(0,7)));
 const warnings=['Monthly living excludes the separately funded periodic fixed bills. Include their annual allowance divided by 12 when assessing total routine funding.','Budget remaining is room in a plan, not a bank balance or guaranteed cash available.','Annual allowances use the most recent saved effective-year plan for the selected year. Routine guides use the current saved monthly plan.'];
 if(annualPlan.clothingOnly)warnings.push('Historical comparison spending uses the selected year’s clothing-only grouping. Other shopping remains counted with a zero allowance.');
 if(baselineMonths.length<3)warnings.push(`Only ${baselineMonths.length} complete calendar months are available for the routine baseline.`);
 if(annualBaselineMonths.length<12)warnings.push(`Annual suggestions use ${annualBaselineMonths.length} available complete months without annualizing missing months; treat them as provisional.`);
 warnings.push('Complete calendar months mean date-window coverage; bank-feed completeness and balance freshness are not established.');
 const flagged=actualRows.filter(x=>x.t.review);if(flagged.length)warnings.push(`${flagged.length} categorized expenses carry source review flags and remain counted.`);
 return {coverage,baselineCoverage,categoryHistory,period,monthlyRows,annualRows,monthlyTotal:selected.routine,annualTotal:selected.annual,exceptionalTotal:selected.exceptional,totalSpending:selected.total,unresolvedOutflows:sum(data.transactions.filter(t=>t.flow==='review'&&t.amount>0&&!t.pending&&!isZelleTransaction(t)&&inPeriod(t,period))),baselineMonths,annualBaselineMonths,history,fixedAnnualAllowance:annualPlan.annual.annual_bills,discretionaryAnnualAllowance:round(annualAllowance-annualPlan.annual.annual_bills),routineFundingGuide:round(plan.monthlyCap+annualPlan.annual.annual_bills/12),assignments:summarizeBudgetAssignments(data,month,mode,plan),annualEffectiveYear:annualPlan.effectiveYear,annualClothingOnly:annualPlan.clothingOnly,monthlyCap:plan.monthlyCap,monthlyBaseline:baselineMonths.length?round(sum(baseRows.filter(x=>x.g.bucket==='monthly').map(x=>x.t))/baselineMonths.length):null,annualAllowance,annualFundingGuide:round(annualAllowance/12),cashIncomeBaseline:baselineMonths.length?round(-sum(cashRows)/baselineMonths.length):null,selectedMonth:{actual:monthly.routine,remaining:round(plan.monthlyCap-monthly.routine),period:monthPeriod,coverage:monthCoverage},yearToDate:totals(ytd),pastYear:totals(past),exceptionalIds:actualRows.filter(x=>x.g.bucket==='exceptional').map(x=>x.t.id),monthlyIds:actualRows.filter(x=>x.g.bucket==='monthly').map(x=>x.t.id),annualIds:actualRows.filter(x=>x.g.bucket==='annual').map(x=>x.t.id),warnings};
}

/**
 * date = the credit's posting date; purchaseDate = the inferred purchase's posting date (or null).
 * A credit+purchase evidence link must use a scope containing BOTH dates; see creditEvidenceScope.
 */
export interface BudgetCreditEvidence {id:string;date:string;kind:ExpenseCreditAttribution['kind'];status:ExpenseCreditAttribution['status'];serviceMerchant:string|null;purchaseId:string|null;purchaseDate:string|null;candidatePurchaseIds:string[];reason:string}
/**
 * Explicit, wider evidence scope for a credit-and-inferred-purchase link: the
 * existing past-year mode anchored to the credit's posting month. It always
 * contains the permitted same-day..90-day prior pair. Ordinary category links
 * keep their own selected scope; this never changes source accounting.
 */
export function creditEvidenceScope(evidence:Pick<BudgetCreditEvidence,'id'|'date'|'purchaseId'>,mode:PeriodMode,anchorMonth:string):{ids:string[];mode:PeriodMode;anchorMonth:string;widened:boolean}{
 if(!evidence.purchaseId)return {ids:[evidence.id],mode,anchorMonth,widened:false};
 return {ids:[evidence.id,evidence.purchaseId],mode:'year',anchorMonth:evidence.date.slice(0,7),widened:true};
}
/** gross = positive charges; credits = magnitude of negative rows; net = gross − credits (cents). */
export interface BudgetAssignment {key:string;name:string;bucket:BudgetClassification['bucket'];categoryId:string;categoryLabel:string;reason:string;net:number;gross:number;credits:number;count:number;first:string;last:string;ids:string[];chargeIds:string[];creditIds:string[];creditEvidence:BudgetCreditEvidence[];cadence:string;status:string}
export function summarizeBudgetAssignments(input:Dataset,month:string,mode:PeriodMode,plan:BudgetPlan):BudgetAssignment[] {
 const data=applyIncomePolicy(input),period=resolvePeriod(data,month,mode),annual=resolveAnnualPlan(plan,Number(month.slice(0,4))),context=classificationContext(data,data.asOf,annual.clothingOnly);
 const labels=new Map([...BUDGET_MONTHLY,...budgetAnnualDefinitions(annual.clothingOnly),{id:'exceptional',label:'Exceptional costs'}].map(c=>[c.id,c.label])),accounts=new Map(data.accounts.map(a=>[a.id,a]));
 const groups=new Map<string,BudgetAssignment&{netCents:number;grossCents:number;creditCents:number}>();
 for(const t of data.transactions){if(period.empty||t.date<period.start||t.date>period.end)continue;const classified=classifyBudget(t,context);if(!classified)continue;
  const account=accounts.get(t.accountId),merchant=canonicalMerchant(t),fee=(t as Partial<DerivedTransaction>).merchantServiceQualifier==='card_fee'||merchant==='Card membership fee';
  const name=context.matchedBenefitIds?.has(t.id)?'Walmart+ · inferred benefit credit':fee?`${account?accountDisplayName(account):'Card account'} · membership fees & adjustments`:merchant;
  const key=[classified.bucket,classified.id,name,t.accountId].join('|'),recurring=context.recurringById?.get(t.id);
  let entry=groups.get(key);
  if(!entry){entry={key,name:fee?name:`${name}${account?' · '+accountDisplayName(account):''}`,bucket:classified.bucket,categoryId:classified.id,categoryLabel:labels.get(classified.id)||classified.id,reason:classified.reason,net:0,gross:0,credits:0,netCents:0,grossCents:0,creditCents:0,count:0,first:t.date,last:t.date,ids:[],chargeIds:[],creditIds:[],creditEvidence:[],cadence:recurring?.cadence||'Not established',status:recurring?.statusLabel||'No recurring commitment established'};groups.set(key,entry);}
  const value=Math.round(t.amount*100);
  entry.netCents+=value;entry.count++;entry.ids.push(t.id);entry.first=entry.first<t.date?entry.first:t.date;entry.last=entry.last>t.date?entry.last:t.date;
  if(value<0){
   entry.creditCents+=-value;entry.creditIds.push(t.id);
   const credit=context.credits?.get(t.id);
   const purchaseDate=credit?.purchaseId?context.purchaseById?.get(credit.purchaseId)?.date??null:null;
   entry.creditEvidence.push(credit?{id:t.id,date:t.date,kind:credit.kind,status:credit.status,serviceMerchant:credit.serviceMerchant,purchaseId:credit.purchaseId,purchaseDate,candidatePurchaseIds:[...credit.candidatePurchaseIds],reason:credit.reason}:{id:t.id,date:t.date,kind:'unclassified',status:'unallocated',serviceMerchant:null,purchaseId:null,purchaseDate:null,candidatePurchaseIds:[],reason:'Recorded credit kept in its category; no purchase link is established.'});
  }else{entry.grossCents+=value;entry.chargeIds.push(t.id);}
 }
 return [...groups.values()].map(({netCents,grossCents,creditCents,...entry})=>({...entry,net:netCents/100,gross:grossCents/100,credits:creditCents/100})).sort((a,b)=>Math.abs(b.net)-Math.abs(a.net)||a.name.localeCompare(b.name)||a.key.localeCompare(b.key));
}
export interface BudgetCategoryDetail {
 bucket:BudgetClassification['bucket'];categoryId:string;categoryLabel:string;mode:PeriodMode;anchorMonth:string;
 period:{start:string;end:string;empty:boolean;partial:boolean;coverageClipped:boolean};
 gross:number;credits:number;net:number;count:number;chargeCount:number;creditCount:number;
 ids:string[];assignments:BudgetAssignment[];creditStatusCounts:Partial<Record<ExpenseCreditAttribution['status'],number>>;
}
/**
 * Category drilldown built only from summarizeBudgetAssignments for the same
 * month/mode anchor, so IDs and signed totals match the budget rows exactly.
 * An empty result means no classified records in available data, not zero spending.
 */
export function summarizeBudgetCategoryDetail(input:Dataset,month:string,mode:PeriodMode,plan:BudgetPlan,bucket:BudgetClassification['bucket'],categoryId:string):BudgetCategoryDetail {
 const data=applyIncomePolicy(input),period=resolvePeriod(data,month,mode),annual=resolveAnnualPlan(plan,Number(month.slice(0,4)));
 const label=[...BUDGET_MONTHLY,...budgetAnnualDefinitions(annual.clothingOnly),{id:'exceptional',label:'Exceptional costs'}].find(c=>c.id===categoryId)?.label||categoryId;
 const assignments=summarizeBudgetAssignments(input,month,mode,plan).filter(a=>a.bucket===bucket&&a.categoryId===categoryId);
 const total=(pick:(a:BudgetAssignment)=>number)=>assignments.reduce((n,a)=>n+Math.round(pick(a)*100),0);
 const grossCents=total(a=>a.gross),creditCents=total(a=>a.credits),statusCounts:Partial<Record<ExpenseCreditAttribution['status'],number>>={};
 for(const a of assignments)for(const e of a.creditEvidence)statusCounts[e.status]=(statusCounts[e.status]||0)+1;
 return {bucket,categoryId,categoryLabel:label,mode,anchorMonth:month,period:{start:period.start,end:period.end,empty:period.empty,partial:period.partial,coverageClipped:period.coverageClipped},gross:grossCents/100,credits:creditCents/100,net:(grossCents-creditCents)/100,count:assignments.reduce((n,a)=>n+a.count,0),chargeCount:assignments.reduce((n,a)=>n+a.chargeIds.length,0),creditCount:assignments.reduce((n,a)=>n+a.creditIds.length,0),ids:assignments.flatMap(a=>a.ids).sort(),assignments,creditStatusCounts:statusCounts};
}
export interface BudgetCommitmentConflict {categoryId:string;categoryLabel:string;annualAllowance:number;observedAnnualCommitment:number;excess:number;merchants:Array<{name:string;monthlyEquivalent:number;annualEquivalent:number;ids:string[];status:string;cadence:string}>;basis:string}
export function summarizeBudgetCommitments(input:Dataset,plan:BudgetPlan,year:number):BudgetCommitmentConflict[] {
 const data=applyIncomePolicy(input),annual=resolveAnnualPlan(plan,year),context=classificationContext(data,data.asOf,annual.clothingOnly),byCategory=new Map<string,BudgetCommitmentConflict>();
 const labels=new Map(budgetAnnualDefinitions(annual.clothingOnly).map(c=>[c.id,c.label]));
 for(const group of recurringEvidence(data,data.asOf)){
  if(group.status!=='ongoing'||group.monthlyEquivalent===null||group.monthlyEquivalent<=0||!['subscription','service','bill'].includes(group.recurrenceType))continue;
  const positive=group.transactions.filter(t=>t.amount>0&&!t.pending&&t.date<=data.asOf).sort((a,b)=>b.date.localeCompare(a.date));
  if(!positive.length)continue;const classified=classifyBudget(positive[0],context);if(!classified||classified.bucket!=='annual')continue;
  let category=byCategory.get(classified.id);if(!category){category={categoryId:classified.id,categoryLabel:labels.get(classified.id)||classified.id,annualAllowance:annual.annual[classified.id]||0,observedAnnualCommitment:0,excess:0,merchants:[],basis:'Current supported recurring estimates × 12, if continued. This is a planning scenario, not a future bill or future spending record; stopped and uncertain services are excluded.'};byCategory.set(classified.id,category);}
  const annualEquivalent=round(group.monthlyEquivalent*12);category.observedAnnualCommitment=round(category.observedAnnualCommitment+annualEquivalent);category.merchants.push({name:group.displayName,monthlyEquivalent:group.monthlyEquivalent,annualEquivalent,ids:group.transactions.map(t=>t.id),status:group.statusLabel,cadence:group.cadence});
 }
 return [...byCategory.values()].map(category=>({...category,excess:round(category.observedAnnualCommitment-category.annualAllowance)})).filter(category=>category.excess>0).sort((a,b)=>b.excess-a.excess);
}
