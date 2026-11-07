import assert from 'node:assert/strict';
import {resolvePeriod,applyIncomePolicy} from '../lib/periods.ts';
import {summarizePeriod} from '../lib/finance.ts';
import {summarizeIncome} from '../lib/income.ts';
import {summarizeMovements} from '../lib/movements.ts';
import {summarizeRetirement} from '../lib/retirement.ts';
import {observedComparisonStart} from '../lib/reporting-coverage.ts';
const a=(id,type='depository',name=id,subtype='')=>({id,type,name,subtype,institution:'Test',mask:id,balance:0,netBalance:0,balanceDate:null,balanceAgeKnown:false,syncStatus:'synced'});
const tx=(id,date,amount,extra={})=>({id,date,amount,merchant:'Example Employer',sourceName:'Example Employer Payroll',sourceCategoryDetailed:'income_salary',accountId:'bank',category:'Income',flow:'income',confidence:'HIGH',note:'',pending:false,review:false,exceptional:false,...extra});
const inv=(id,date,extra={})=>({id,date,accountId:'broker',description:id,type:'cash',subtype:'deposit',amount:0,quantity:0,price:0,fees:0,currency:'USD',...extra});
const data={version:1,syncedAt:'2026-10-25T12:00:00Z',asOf:'2026-10-25',dateRange:{start:'2025-10-01',end:'2026-10-25'},coverage:{},accounts:[a('bank','depository','Checking','checking'),a('savings','depository','Savings','savings'),a('card','credit','Card','credit card'),a('broker','investment'),a('plan','investment','Test 401(K) PLAN','401k')],transactions:[
 tx('before','2025-10-25',-100),tx('boundary','2025-10-26',-200),tx('salary','2026-10-10',-500),
 tx('zelle','2026-10-10',-1000,{reviewDecision:'zelle',merchant:'Zelle from someone',sourceName:'Zelle from someone',note:'User-confirmed Example Employer payroll',category:'Payroll'}),
 tx('interest','2026-10-10',-5,{merchant:'Interest payment',sourceName:'Interest payment',sourceCategoryDetailed:'income_interest_earned'}),
 tx('other','2026-10-10',-20,{merchant:'Other employer',sourceName:'Other payroll',sourceCategoryDetailed:'income_salary'}),
 tx('refund','2026-10-10',-30,{accountId:'card',flow:'expense',category:'Shopping',sourceCategoryDetailed:'shopping_online_marketplaces',sourceName:'Example Employer Refund'}),
 tx('spend','2026-10-10',1000,{flow:'expense',category:'Shopping',merchant:'Shop',sourceName:'Shop',sourceCategoryDetailed:'shopping'}),
 tx('overlap','2026-10-11',-100),
 tx('checking-refund','2026-10-10',-40,{flow:'expense',sourceCategoryDetailed:'shopping_online_marketplaces',sourceName:'Example Employer reimbursement'}),
 tx('checking-transfer','2026-10-10',-60,{flow:'transfer',sourceCategoryDetailed:'transfers_other_transfer_in',sourceName:'Example Employer Payment'}),
 tx('checking-review','2026-10-10',-70,{flow:'review',review:true,sourceCategoryDetailed:'other',sourceName:'Example Employer Payment'}),
 tx('savings-review','2026-10-10',-80,{accountId:'savings',flow:'review',review:true,confidence:'LOW',sourceCategoryDetailed:'transfers_other_transfer_in',sourceName:'Example Employer'}),
 tx('out','2025-10-25',100,{flow:'transfer',transferTransactionId:'in',merchant:'Transfer',sourceName:'Transfer',category:'Transfers'}),
 tx('in','2025-10-26',-100,{flow:'transfer',transferTransactionId:'out',accountId:'savings',merchant:'Transfer',sourceName:'Transfer',category:'Transfers'})
],netWorthHistory:[],recurring:[],notes:[],incomeEvidence:{version:1,asOf:'2026-10-25',readAt:'2026-10-25T12:00:00Z',bankCoverage:{},investmentCoverage:{isComplete:false,freshness:'unknown',note:'Unknown'},bankInflowCount:0,bankInflowTotal:0,pendingInflowCount:0,accountHistory:[],notes:[],sources:[],rsuPrices:[{date:'2026-10-12',ticker:'EXMPL',price:100,basis:'regular-session close',source:'Test verified price',currency:'USD'}],investmentRecords:[inv('vest','2026-10-12',{description:'YOU BOUGHT RSU1234',ticker:'EXMPL',quantity:2,type:'buy',subtype:'buy'}),inv('sale','2026-10-12',{ticker:'EXMPL',type:'sell',subtype:'sell',amount:-400,quantity:-2}),inv('refund-journal','2026-10-11',{description:'JOURNALED RSU Refund',type:'cash',subtype:'withdrawal',amount:100})]},retirementEvidence:{version:1,scope:{start:'2025-10-01',end:'2026-10-25',sourceReadAt:null,isCompleteForQuery:null,freshness:'unknown',description:'Test'},accountScopes:[{accountId:'plan',firstRecordDate:'2025-10-25',lastRecordDate:'2026-10-25',recordCount:3,coverageComplete:null,freshness:'unknown'}],records:[['r-before','2025-10-25',-10],['r-start','2025-10-26',-20],['r-end','2026-10-25',-30]].map(([id,date,amount])=>({id,date,amount,accountId:'plan',description:'Fund contribution',type:'cash',subtype:'contribution',currency:'USD'})),notes:[]}};
let p=resolvePeriod(data,'2026-10','year');assert.equal(p.start,'2025-10-26');assert.equal(p.end,'2026-10-25');assert.equal(p.monthKeys.length,13);
assert.equal(resolvePeriod(data,'2026-10','ytd').start,'2026-01-01');assert.equal(resolvePeriod(data,'2026-10','month').start,'2026-10-01');
const leap=resolvePeriod({...data,asOf:'2024-02-29',dateRange:{start:'2020-01-01',end:'2024-02-29'}},'2024-02','year');assert.equal(leap.start,'2023-03-01');assert.equal(leap.end,'2024-02-29');
assert.equal(resolvePeriod(data,'2027-01','ytd').empty,true);assert.equal(resolvePeriod(data,'2026-12','month').empty,true);
const clipped=resolvePeriod({...data,dateRange:{start:'2026-04-01',end:'2026-10-25'}},'2026-10','year');assert.equal(clipped.start,'2026-04-01');assert.equal(clipped.coverageClipped,true);
const policy=applyIncomePolicy(data,{zelle:{flow:'income',category:'Payroll'},salary:{flow:'income',note:'User-confirmed Example Employer payroll'}});
assert.equal(policy.transactions.find(t=>t.id==='zelle').flow,'transfer');assert.equal(policy.transactions.find(t=>t.id==='zelle').dashboardScope,'zelle');assert.equal(policy.transactions.find(t=>t.id==='zelle').incomePolicyExcluded,true);
assert.equal(policy.transactions.find(t=>t.id==='refund').flow,'expense');assert.equal(policy.transactions.find(t=>t.id==='out').flow,'transfer');
assert.equal(policy.transactions.find(t=>t.id==='overlap').flow,'income');assert.equal(data.transactions.find(t=>t.id==='overlap').flow,'income');
assert.deepEqual(applyIncomePolicy(policy),policy);
const confirmed=applyIncomePolicy(data,{overlap:{flow:'income',category:'Payroll',note:'User-confirmed Example Employer split payroll'}});assert.equal(confirmed.transactions.find(t=>t.id==='overlap').flow,'income');
for(const [id,expected] of [['checking-refund','expense'],['checking-transfer','transfer'],['checking-review','review'],['overlap','income']])assert.equal(policy.transactions.find(t=>t.id===id).flow,expected);
assert.equal(policy.transactions.find(t=>t.id==='savings-review').flow,'review');
for(const flow of ['expense','transfer','review'])assert.equal(applyIncomePolicy(policy,{salary:{flow}}).transactions.find(t=>t.id==='salary').flow,flow);
assert.equal(policy.transactions.find(t=>t.id==='checking-refund').sourceCategoryDetailed,'shopping_online_marketplaces');
for(const mode of ['month','ytd','year']){
 const range=resolvePeriod(data,'2026-10',mode),i=summarizeIncome(data,2026,'2026-10',mode),m=summarizeMovements(data,'2026-10',mode),r=summarizeRetirement(data,'2026-10',undefined,{},mode),o=summarizePeriod(data,'2026-10',mode);
 for(const x of [i.period,m.period,o.period])assert.deepEqual([x.start,x.end],[range.start,range.end]);assert.deepEqual([r.start,r.end],[range.start,range.end]);
 assert.equal(i.cashIncome,i.payroll+i.bankInterest);assert.equal(i.employerCashIncome,i.cashIncome);assert.equal(o.income,i.effectiveIncome);assert.equal(o.saved,i.effectiveSurplusBeforeRsuWithholding);assert.equal(o.spending,i.spending);
 assert.equal(o.categories.reduce((n,c)=>n+c.value,0),o.spending);assert.equal(i.monthly.reduce((n,x)=>n+x.cashIncome,0),i.cashIncome);assert.equal(i.monthly.reduce((n,x)=>n+x.spending,0),i.spending);
 assert.equal(i.events.some(e=>e.id==='zelle'),false);assert.equal(i.events.find(e=>e.id==='interest').includedInCashIncome,true);assert.equal(i.events.find(e=>e.id==='other').includedInCashIncome,true);
 assert.equal(i.reviewAmount,150);assert.equal(i.potentialRsuRefundOverlap,0);assert.equal(i.potentialRsuRefundOverlapCount,0);assert.equal(i.nonIncomeCredits,0);
 assert.equal(m.rows.some(x=>x.sourceIds.includes('interest')||x.sourceIds.includes('other')),false);
}
const month=summarizePeriod(data,'2026-10','month');assert.equal(month.cashPayroll,625);assert.equal(month.rsuValue,200);assert.equal(month.income,825);assert.equal(month.spending,930);assert.equal(month.saved,-105);
const year=summarizePeriod(data,'2026-10','year');assert.equal(year.cashPayroll,825);assert.equal(year.income,1025);assert.equal(year.saved,95);assert.equal(year.trend[0].label,'Oct 25');assert.equal(year.trend.at(-1).label,'Oct 26');
const movement=summarizeMovements(data,'2026-10','year');assert.equal(movement.totals.uniqueAmount,60);assert.equal(movement.totals.incoming,160);assert.equal(movement.totals.outgoing,0);assert.equal(movement.totals.relatedOutsidePeriodCount,1);
assert.equal(summarizeRetirement(data,'2026-10',undefined,{},'year').grossContributions,50);
const pending=structuredClone(data);pending.transactions.push(tx('pending','2026-10-25',-100,{pending:true}));assert.equal(summarizePeriod(pending,'2026-10','month').income,825);
console.log('PASS: shared month/YTD/exact past-year windows; leap day; clipping; cross-boundary pairs; Example Employer checking credits including reimbursements; Zelle hard exclusion after overrides; other credits not income or fake movements; explicit payroll corrections; checking RSU journal overlap remains income; immutable/idempotent policy; all four summaries and monthly/category arithmetic reconcile.');

// Comparisons need observed card history and no overlapping scoped source gap;
// an unscoped coverage flag cannot certify or invalidate all past months.
const comparison=structuredClone(data);comparison.dateRange.start='2026-01-01';comparison.coverage={transactions:{availability:'ready',is_complete_for_query:true,window:{start:'2026-01-01',end:'2026-10-25'}}};comparison.transactions=[tx('first-card-purchase','2026-01-15',1,{accountId:'card',flow:'expense',category:'Groceries',merchant:'Grocer',sourceName:'Grocer'})];
assert.equal(observedComparisonStart(comparison),'2026-02-01');
for(const m of ['04','05','06'])comparison.transactions.push(tx('old-'+m,`2026-${m}-15`,100,{flow:'expense',category:'Groceries',merchant:'Grocer',sourceName:'Grocer'}));
for(const m of ['07','08','09'])comparison.transactions.push(tx('new-'+m,`2026-${m}-15`,200,{flow:'expense',category:'Groceries',merchant:'Grocer',sourceName:'Grocer'}));
comparison.transactions.push(tx('oct','2026-10-15',500,{flow:'expense',category:'Groceries',merchant:'Grocer',sourceName:'Grocer'}),tx('oneoff-old','2026-04-15',10000,{flow:'expense',category:'Other',exceptional:true}),tx('oneoff-new','2026-07-15',20000,{flow:'expense',category:'Other',exceptional:true}));
const monthInsights=summarizePeriod(comparison,'2026-10','month').insights;
assert.ok(monthInsights.some(i=>i.title==='Recorded spending up $300'&&i.detail.includes('days 1–25')&&i.detail.includes('does not establish complete bank history')));assert.ok(monthInsights.some(i=>i.title==='Groceries above your recent baseline'));
const laterPriorCharge=structuredClone(comparison);laterPriorCharge.transactions.push(tx('after-elapsed-day','2026-09-26',9000,{flow:'expense',category:'Groceries',merchant:'Grocer',sourceName:'Grocer'}));
assert.ok(summarizePeriod(laterPriorCharge,'2026-10','month').insights.some(i=>i.title==='Recorded spending up $300'),'A prior-month charge after day 25 cannot alter the matching elapsed-day comparison');
const ytdInsights=summarizePeriod(comparison,'2026-10','ytd').insights;assert.ok(ytdInsights.some(i=>i.title==='Recent routine spending up 100%'&&i.detail.includes('$600')&&i.detail.includes('$300')));
const unknownCoverage=structuredClone(comparison);unknownCoverage.coverage={};assert.ok(summarizePeriod(unknownCoverage,'2026-10','month').insights.some(i=>i.title==='Recorded spending up $300'),'Unknown provider completeness does not erase an explicitly observed, qualified comparison');
const missingCardHistory=structuredClone(comparison);missingCardHistory.transactions=missingCardHistory.transactions.filter(row=>row.id!=='first-card-purchase');assert.equal(observedComparisonStart(missingCardHistory),null);assert.ok(!summarizePeriod(missingCardHistory,'2026-10','month').insights.some(i=>i.title.startsWith('Recorded spending')||i.title.includes('recent baseline')),'A complete source query cannot stand in for the missing card purchase baseline');
const scopedGap=structuredClone(comparison);scopedGap.coverage={transactions:{availability:'ready',is_complete_for_query:false,window:{start:'2026-09-01',end:'2026-10-25'}}};assert.ok(!summarizePeriod(scopedGap,'2026-10','month').insights.some(i=>i.title.startsWith('Recorded spending')||i.title.includes('recent baseline')),'Known overlapping incomplete queries suppress comparisons');
scopedGap.coverage.transactions.window={start:'2026-01-01',end:'2026-01-31'};assert.ok(summarizePeriod(scopedGap,'2026-10','month').insights.some(i=>i.title==='Recorded spending up $300'),'A scoped January gap does not invalidate September/October observed windows');
const shortCoverage=structuredClone(comparison);shortCoverage.dateRange.start='2026-06-01';assert.ok(!summarizePeriod(shortCoverage,'2026-10','ytd').insights.some(i=>i.title.includes('Recent routine')));
const explicitRefund=applyIncomePolicy(policy,{interest:{flow:'expense',category:'Refund'}});assert.equal(explicitRefund.transactions.find(t=>t.id==='interest').incomePolicyExcluded,false);
console.log('PASS: observed same-elapsed monthly comparisons; scoped gap guards; missing-card baseline suppression; category spike thresholds; recent-three vs preceding-three complete routine months; exceptional exclusions; insufficient-history comparisons withheld; latest explicit refund classification preserved.');
