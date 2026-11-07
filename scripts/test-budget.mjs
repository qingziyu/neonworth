import assert from 'node:assert/strict';
import { classifyBudget, suggestBudgetPlan, summarizeBudget, budgetPlanSchema, BUDGET_MONTHLY, BUDGET_ANNUAL, resolveAnnualPlan, budgetAnnualDefinitions, summarizeBudgetAssignments, summarizeBudgetCommitments } from '../lib/budget.ts';

const tx=(id,amount,category,date='2026-10-10',extra={})=>({id,amount,category,date,merchant:id,accountId:'checking',flow:'expense',pending:false,exceptional:false,review:false,note:'',confidence:'HIGH',...extra});
const fixture={version:1,asOf:'2026-10-27',syncedAt:'2026-10-28T00:00:00Z',dateRange:{start:'2025-10-01',end:'2026-10-27'},coverage:{},accounts:[{id:'checking',name:'Checking',institution:'Test',type:'depository',subtype:'checking',mask:'1234',balance:1,netBalance:1,balanceDate:null,balanceAgeKnown:false,syncStatus:'synced'}],netWorthHistory:[],notes:[],recurring:[{frequency:'ANNUALLY',transaction_ids:['annual-phone','annual-rent','annual-service']}],transactions:[
 tx('july-food',100,'Dining & coffee','2026-07-05'),tx('sep-food',300,'Dining & coffee','2026-09-05'),
 tx('annual-rent',3500,'Housing'),tx('annual-phone',200,'Bills & utilities'),tx('meal',100,'Dining & coffee'),
 tx('annual-service',100,'Services'),tx('shirt',500,'Shopping'),tx('shirt-refund',-100,'Shopping'),
 tx('card-fee',350,'Financial & insurance','2026-10-10',{merchant:'Card membership fee',merchantServiceQualifier:'card_fee'}),
 tx('card-fee-credit',-50,'Financial & insurance','2026-10-10',{merchant:'Card membership fee',merchantServiceQualifier:'credit'}),
 tx('trip-meal',50,'Dining & coffee','2026-10-10',{geographicContext:{country:'JP',label:'Explicit synthetic trip',basis:'trip_context',reason:'Source location'}}),
 tx('trip-shirt',80,'Shopping','2026-10-10',{geographicContext:{country:'JP',label:'Explicit synthetic trip',basis:'trip_context',reason:'Source location'}}),
 tx('tax',1000,'Tax settlement'),tx('exception',30,'Dining & coffee','2026-10-10',{exceptional:true}),
 tx('unknown',10,'Unknown category'),tx('retained',30,'Services','2026-10-10',{sourceMissingSince:'2026-10-12'}),
 tx('zelle',500,'Dining & coffee','2026-10-10',{merchant:'Zelle payment',reviewDecision:'zelle'}),tx('pending',200,'Groceries','2026-10-10',{pending:true}),
 tx('repayment',500,'Transfers','2026-10-10',{flow:'transfer',merchant:'Chase payment'}),
 tx('review',20,'Other','2026-10-10',{flow:'review',review:true}),
 tx('apple',80,'Transfers','2026-10-10',{flow:'transfer',merchant:'Apple Card',sourceName:'Apple Card Payment'}),
 tx('july-pay',-9000,'Payroll','2026-07-30',{flow:'income',merchant:'Example Employer payroll'}),tx('aug-pay',-9000,'Payroll','2026-08-30',{flow:'income',merchant:'Example Employer payroll'}),tx('sep-reimbursement',-100,'Income','2026-09-30',{flow:'income',merchant:'Example Employer reimbursement'}),
 tx('historic-trip',501,'Travel','2026-03-03'),
 ]};
const suggested=suggestBudgetPlan(fixture,8000);
assert.equal(suggested.annual.travel,0,'Flexible travel allowance is reduced when observed cash income does not cover routine cap');
assert.equal(suggested.recommendation.travelShoppingReduction,600);
const plan={...suggested,annual:{...suggested.annual,travel:600}};
assert.equal(budgetPlanSchema.safeParse(plan).success,true);
assert.equal(Object.values(plan.monthly).reduce((a,b)=>a+b,0),8000);
assert.equal(plan.annual.travel,600,'User may explicitly set an annual allowance above the starter recommendation');
const summary=summarizeBudget(fixture,'2026-10','month',plan);
assert.deepEqual(summary.baselineMonths,['2026-07','2026-08','2026-09']);
assert.equal(summary.monthlyRows.find(r=>r.id==='dining').baseline,133.33,'Zero-spend completed August participates in mean, current month does not');
assert.equal(summary.monthlyRows.find(r=>r.id==='dining').median,100);
assert.equal(summary.monthlyRows.find(r=>r.id==='utilities').actual,200,'Annual provider cadence does not remove utilities from routine goal');
assert.equal(summary.monthlyRows.find(r=>r.id==='housing').actual,3500,'Rent always remains routine');
assert.equal(summary.annualRows.find(r=>r.id==='shopping').actual,480,'Shopping includes trip retail and signed refunds');
assert.equal(summary.annualRows.find(r=>r.id==='travel').actual,50,'Explicit trip dining moves to travel without source reclassification');
assert.equal(summary.annualRows.find(r=>r.id==='annual_bills').actual,400,'Card fee credits offset fees; annual service remains annual');
assert.equal(summary.exceptionalTotal,1030);
assert.equal(summary.monthlyRows.find(r=>r.id==='digital').actual,0,'Card repayments are not digital spending unless explicitly configured');
assert.equal(summary.monthlyTotal,3840);
assert.equal(summary.annualTotal,930);
assert.equal(summary.totalSpending,5800);
assert.equal(Math.round((summary.monthlyTotal+summary.annualTotal+summary.exceptionalTotal)*100),Math.round(summary.totalSpending*100),'Every posted expense reconciles exactly once');
assert.equal(summary.unresolvedOutflows,20,'Unresolved movements shown separately without pretending they are expenses');
assert.equal(summary.cashIncomeBaseline,6033.33,'Cash affordability includes Example Employer reimbursement and excludes shares');
assert.equal(summary.monthlyRows.find(r=>r.id==='other').actual,40,'Unexpected categories and retained non-digital service charges cannot disappear');
assert.equal(summary.annualRows.find(r=>r.id==='travel').remainingAnnual,49,'Remaining annual allowance uses calendar YTD, not this month alone');
assert.equal(classifyBudget(fixture.transactions.find(t=>t.id==='zelle')),null);
assert.equal(classifyBudget(fixture.transactions.find(t=>t.id==='pending')),null);
assert.equal(classifyBudget(fixture.transactions.find(t=>t.id==='repayment')),null);
assert.equal(classifyBudget(tx('note-only',123,'Groceries','2026-10-10',{note:'Move this to travel'})).id,'groceries','Notes are never classification commands');
assert.equal(classifyBudget(tx('online-foreign',123,'Groceries','2026-10-10',{sourcePaymentChannel:'online',geographicContext:{country:'JP',label:'Foreign merchant',basis:'source_location',reason:'Merchant location'}})).id,'groceries','Online foreign merchant location alone does not establish a trip');
const saved=JSON.stringify(plan);
const future={...fixture,asOf:'2026-11-20',dateRange:{...fixture.dateRange,end:'2026-11-20'}};
const updated=summarizeBudget(future,'2026-11','month',plan);
assert.deepEqual(updated.baselineMonths,['2026-08','2026-09','2026-10'],'Baseline rolls forward even when saved targets are unchanged');
assert.equal(JSON.stringify(plan),saved,'Summaries never mutate saved targets');
assert.equal(budgetPlanSchema.safeParse({...plan,monthly:{...plan.monthly,dining:1101}}).success,false);
assert.equal(budgetPlanSchema.safeParse({...plan,annual:{...plan.annual,extra:1}}).success,false);
assert.equal(budgetPlanSchema.safeParse({...plan,annual:{...plan.annual,travel:Infinity}}).success,false);
assert.equal(budgetPlanSchema.safeParse({...plan,baselineAsOf:'2026-99-99'}).success,false);
assert.equal(budgetPlanSchema.safeParse({...plan,baselineAsOf:'2026-02-30'}).success,false);
assert.equal(budgetPlanSchema.safeParse({...plan,monthlyCap:7000}).success,false);
const partial={...fixture,dateRange:{start:'2026-08-15',end:'2026-10-27'}};
const partialSummary=summarizeBudget(partial,'2026-10','year',suggestBudgetPlan(partial));
assert.deepEqual(partialSummary.baselineMonths,[],'Fewer than three comparable calendar windows cannot establish the planning baseline');
assert.equal(partialSummary.monthlyBaseline,null);
const historicalSummary=summarizeBudget(fixture,'2026-04','month',plan);
assert.deepEqual(historicalSummary.baselineMonths,summary.baselineMonths,'Changing the history selection never rebases the current planning average');
assert.equal(historicalSummary.monthlyRows.find(r=>r.id==='dining').baseline,133.33);
const allHistory=summarizeBudget(fixture,'2026-10','year',plan);
for(const h of allHistory.categoryHistory){
 assert.equal(Math.round((Object.values(h.monthly).reduce((n,v)=>n+v,0)+Object.values(h.annual).reduce((n,v)=>n+v,0)+h.exceptional)*100),Math.round(h.total*100),'Every category history column reconciles');
 const ids=[...Object.values(h.monthlyIds).flat(),...Object.values(h.annualIds).flat(),...h.exceptionalIds];
 assert.equal(new Set(ids).size,ids.length,'Each history record appears once');
}
assert.ok(partialSummary.warnings.some(w=>w.includes('provisional')));
assert.ok(summary.monthlyRows.length===BUDGET_MONTHLY.length&&summary.annualRows.length===BUDGET_ANNUAL.length);
const insurance={...fixture,transactions:[tx('g1',300,'Financial & insurance','2026-06-05',{merchant:'GEICO'}),tx('g2',300,'Financial & insurance','2026-07-05',{merchant:'GEICO'}),tx('g3',300,'Financial & insurance','2026-08-05',{merchant:'GEICO'}),tx('g4',300,'Financial & insurance','2026-10-05',{merchant:'GEICO'})]};
assert.equal(summarizeBudget(insurance,'2026-10','month',plan).monthlyRows.find(r=>r.id==='transport').actual,300,'Observed monthly insurance is routine, not hidden in annual costs');
assert.equal(summarizeBudget(insurance,'2026-06','month',plan).monthlyRows.find(r=>r.id==='transport').actual,300,'Historical months use the same known insurance cadence as the current dashboard');
assert.equal(summarizeBudgetAssignments(insurance,'2026-06','month',plan)[0].categoryId,'transport','Historical audit and summary use the same known cadence');
const insuranceLater={...insurance,asOf:'2027-06-20',dateRange:{...insurance.dateRange,end:'2027-06-20'}};
const insuranceLaterSummary=summarizeBudget(insuranceLater,'2027-06','year',plan);
assert.equal(insuranceLaterSummary.monthlyRows.find(r=>r.id==='transport').actual,900,'Earlier observed monthly payments remain routine after a long period of silence');
assert.equal(insuranceLaterSummary.annualRows.find(r=>r.id==='annual_bills').actual,0,'Elapsed time alone never recategorizes historical insurance payments');
const annualInsurance={...insurance,recurring:[{frequency:'ANNUALLY',transaction_ids:['g4']}]};
assert.equal(summarizeBudget(annualInsurance,'2026-10','month',plan).annualRows.find(r=>r.id==='annual_bills').actual,300,'Explicit annual source evidence retains priority over historical monthly merchant cadence');
console.log('Budget tests passed: exact expense reconciliation, policy exclusions, signed refunds, baseline windows, calendar annual allowance, immutable targets, insurance cadence and validation.');

// Effective-year allowances preserve the prior year's plan and carry forward.
const annual2027={travel:5000,shopping:1000,annual_bills:2300,gifts:0,experiences:0,learning:0,occasional_care:1000};
const scheduled={...plan,annualSchedules:{'2027':{annual:annual2027,clothingOnly:true}}};
assert.equal(budgetPlanSchema.safeParse(scheduled).success,true);
assert.deepEqual(resolveAnnualPlan(scheduled,2026),{annual:plan.annual,clothingOnly:false,effectiveYear:null});
assert.deepEqual(resolveAnnualPlan(scheduled,2027),{annual:annual2027,clothingOnly:true,effectiveYear:2027});
assert.deepEqual(resolveAnnualPlan(scheduled,2028),resolveAnnualPlan(scheduled,2027));
assert.equal(budgetAnnualDefinitions(true).find(row=>row.id==='shopping').label,'Clothing');
assert.ok(budgetAnnualDefinitions(true).some(row=>row.id==='other_shopping'));
for(const invalid of [
 {...scheduled,annualSchedules:{'27':{annual:annual2027}}},
 {...scheduled,annualSchedules:{'2027':{annual:{...annual2027,travel:-1}}}},
 {...scheduled,annualSchedules:{'2027':{annual:{...annual2027,shopping:NaN}}}},
 {...scheduled,annualSchedules:{'2027':{annual:{...annual2027,other_shopping:0}}}},
 {...scheduled,annualSchedules:{'2027':{annual:annual2027,clothingOnly:'yes'}}},
 {...scheduled,annualSchedules:{'2027':{annual:annual2027,unexpected:true}}},
])assert.equal(budgetPlanSchema.safeParse(invalid).success,false);
const clothingContext={annualIds:new Set(),monthlyInsurance:new Set(),clothingOnly:true};
const retailRows=[
 tx('apparel',150,'Shopping','2027-01-05',{merchant:'Example Apparel',sourceCategoryDetailed:'shopping_clothing'}),
 tx('generic-clothing-source',70,'Shopping','2027-01-06',{merchant:'Amazon',sourceCategoryDetailed:'general_merchandise_clothing_and_accessories'}),
 tx('clothing-credit',-25,'Shopping','2027-01-07',{merchant:'Platinum Lululemon Credit'}),
 tx('generic-amazon',80,'Shopping','2027-01-08',{merchant:'Amazon',note:'This is clothing, move to clothing budget'}),
 tx('generic-target',40,'Shopping','2027-01-09',{merchant:'Target'}),
 tx('generic-nordstrom',45,'Shopping','2027-01-09',{merchant:'Nordstrom'}),
 tx('generic-saks-credit',-15,'Shopping','2027-01-09',{merchant:'PLATINUM SAKS CREDIT'}),
 tx('computer',1000,'Shopping','2027-01-09',{merchant:'Apple Store'}),
 tx('gift-zero',20,'Gifts & donations','2027-01-09'),
 tx('annual-fee-2027',350,'Financial & insurance','2027-01-10',{merchant:'Card membership fee'}),
 tx('routine-2027',100,'Dining & coffee','2027-01-10'),
];
for(const id of ['apparel','generic-clothing-source','clothing-credit'])assert.equal(classifyBudget(retailRows.find(row=>row.id===id),clothingContext).id,'shopping');
for(const id of ['generic-amazon','generic-target','generic-nordstrom','generic-saks-credit','computer'])assert.equal(classifyBudget(retailRows.find(row=>row.id===id),clothingContext).id,'other_shopping');
assert.equal(classifyBudget(retailRows[0]).id,'shopping','Legacy broad-shopping plan is unchanged');
const data2027={...fixture,asOf:'2027-01-20',dateRange:{...fixture.dateRange,end:'2027-01-20'},transactions:[...fixture.transactions,...retailRows]};
const before2027=summarizeBudget(data2027,'2026-10','month',scheduled);
assert.equal(before2027.annualAllowance,summary.annualAllowance);
assert.deepEqual(before2027.annualRows,summarizeBudget(data2027,'2026-10','month',plan).annualRows,'2027 schedule does not change2026 actuals, categorization or limits');
const report2027=summarizeBudget(data2027,'2027-01','ytd',scheduled);
assert.equal(report2027.annualAllowance,9300);
assert.equal(report2027.annualFundingGuide,775);
assert.equal(report2027.annualEffectiveYear,2027);
assert.equal(report2027.annualClothingOnly,true);
assert.equal(report2027.annualRows.find(row=>row.id==='shopping').actual,195,'Clothing credits net in the clothing allowance');
assert.equal(report2027.annualRows.find(row=>row.id==='shopping').limit,1000);
assert.equal(report2027.annualRows.find(row=>row.id==='other_shopping').actual,1150,'Unbudgeted shopping remains fully counted');
assert.equal(report2027.annualRows.find(row=>row.id==='other_shopping').limit,0);
assert.equal(report2027.annualRows.find(row=>row.id==='other_shopping').remainingAnnual,-1150);
assert.equal(report2027.annualRows.find(row=>row.id==='gifts').remainingAnnual,-20,'Zero allowance does not hide actual expenses');
assert.equal(report2027.annualRows.find(row=>row.id==='annual_bills').limit,2300);
assert.equal(report2027.totalSpending,1815);
assert.equal(report2027.monthlyTotal+report2027.annualTotal+report2027.exceptionalTotal,1815);
assert.equal(report2027.monthlyCap,8000);
assert.deepEqual(scheduled.monthly,plan.monthly);
assert.equal(Object.values(scheduled.annual).reduce((n,x)=>n+x,0),summary.annualAllowance,'Resolver never mutates legacy saved allowances');
console.log('Effective-year budget tests passed:2026 preserved;2027 schedule;2028 carry-forward; clothing evidence; signed credits; zero-allowance reconciliation.');


// Independent synthetic purpose/cadence cases: no retained personal merchant history.
const boundaryRows=[
 ...['06','07','08','09','10'].map(m=>tx(`spa-${m}`,100,'Health & personal care',`2026-${m}-01`,{merchant:'Example Spa',sourceCategoryDetailed:'health_wellness_hair_beauty'})),
 ...['06','07','08','09','10'].map(m=>tx(`gym-${m}`,40,'Health & personal care',`2026-${m}-12`,{merchant:'Example Gym',sourceCategoryDetailed:'health_wellness_fitness'})),
 tx('software',20,'Services','2026-10-02',{sourceCategoryDetailed:'services_software'}),
 tx('vision',60,'Health & personal care','2026-10-03',{sourceCategoryDetailed:'health_wellness_vision_care'}),
 tx('laundry',10,'Health & personal care','2026-10-04',{sourceCategoryDetailed:'health_wellness_laundry_dry_cleaning'}),
 tx('bank-fee',5,'Financial & insurance','2026-10-05',{merchant:'MONTHLY SERVICE FEE'}),
];
const boundary={...fixture,transactions:boundaryRows,recurring:[]},before=JSON.stringify(boundary);
const assignments=summarizeBudgetAssignments(boundary,'2026-10','ytd',plan);
const assignment=id=>assignments.find(row=>row.ids.includes(id));
assert.equal(assignment('spa-10').categoryId,'occasional_care','Monthly spa recurrence does not change grooming purpose');
assert.equal(assignment('gym-10').categoryId,'care','Fitness remains separate from grooming');
assert.equal(assignment('software').categoryId,'digital');
assert.equal(assignment('vision').categoryId,'care');
assert.equal(assignment('laundry').categoryId,'other');
assert.equal(assignment('bank-fee').categoryId,'other');
assert.equal(assignments.reduce((n,row)=>n+row.count,0),boundaryRows.length);
assert.equal(assignments.reduce((n,row)=>n+row.net,0),boundaryRows.reduce((n,row)=>n+row.amount,0));
const commitmentPlan={...scheduled,annualSchedules:{'2027':{annual:{...annual2027,occasional_care:600}}}};
const care=summarizeBudgetCommitments(boundary,commitmentPlan,2027).find(row=>row.categoryId==='occasional_care');
assert.equal(care.observedAnnualCommitment,1200);assert.equal(care.excess,600);
assert.match(care.basis,/if continued/);
assert.equal(JSON.stringify(boundary),before,'Budget suggestions never mutate source records');
const zero=suggestBudgetPlan(fixture);assert.equal(zero.monthlyCap,0);assert.equal(Object.values(zero.monthly).reduce((a,b)=>a+b,0),0,'No personal ceiling is invented');
const custom=suggestBudgetPlan(fixture,4200);assert.equal(budgetPlanSchema.parse(custom).monthlyCap,4200);
assert.equal(summarizeBudget(fixture,'2026-10','month',custom).history[0].cap,4200);
console.log('Configurable budget: explicit cap, balanced categories, source purpose/cadence, immutable annual schedules and synthetic commitments passed.');
