import assert from 'node:assert/strict';
import { summarizeIncome } from '../lib/income.ts';
import { applyIncomePolicy } from '../lib/periods.ts';
const account=(id,type='depository',subtype=type==='depository'?'checking':'')=>({id,name:id,institution:'Test bank',type,subtype,mask:'',balance:0,netBalance:0,balanceDate:null,balanceAgeKnown:false,syncStatus:'synced'});
const tx=(id,amount,flow,sourceCategoryDetailed,extra={})=>({id,date:'2026-05-15',merchant:id,accountId:'checking',amount,category:'Income',flow,confidence:'HIGH',exceptional:false,note:'',pending:false,review:false,sourceCategoryDetailed,sourceName:sourceCategoryDetailed==='income_salary'?'Example Employer Payroll':undefined,...extra});
const inv=(id,extra)=>({id,date:'2026-05-15',accountId:'brokerage',description:id,type:'cash',subtype:'deposit',amount:0,quantity:0,price:0,fees:0,currency:'USD',...extra});
const data={version:1,syncedAt:'2026-10-25T12:00:00Z',asOf:'2026-10-25',dateRange:{start:'2026-01-01',end:'2026-10-25'},coverage:{},accounts:[account('checking'),account('savings','depository','savings'),account('card','credit','credit card'),account('brokerage','investment')],transactions:[
 tx('salary-a',-1000,'income','income_salary'),tx('salary-b',-500,'income','income_salary',{date:'2026-06-15'}),tx('interest',-5,'income','income_interest_earned'),
 tx('transfer',-1000,'transfer','transfers_other_transfer_in',{merchant:'Own transfer'}),tx('uncertain',-1000,'review','transfers_other_transfer_in',{merchant:'Example Employer',accountId:'savings',confidence:'LOW',review:true}),
 tx('expense',200,'expense','shopping'),tx('refund',-20,'expense','shopping'),tx('pending',-500,'income','income_salary',{pending:true})
],netWorthHistory:[],recurring:[],notes:[],incomeEvidence:{version:1,asOf:'2026-10-25',readAt:'2026-10-25T12:00:00Z',bankCoverage:{},investmentCoverage:{isComplete:false,freshness:'unknown',note:'Incomplete'},bankInflowCount:0,bankInflowTotal:0,pendingInflowCount:0,accountHistory:[],notes:[],sources:[],investmentRecords:[
 inv('vest',{description:'YOU BOUGHT RSU####',ticker:'EXMPL',type:'buy',subtype:'buy',quantity:10}),
 inv('sale',{ticker:'EXMPL',type:'sell',subtype:'sell',amount:-2500,quantity:-10,price:250}),
 inv('div',{type:'cash',subtype:'dividend',amount:-10}),
 inv('tax',{description:'JOURNALED RSU Medicare',type:'cash',subtype:'withdrawal',amount:50}),
 inv('journal',{description:'JOURNALED JNL VS A/C TYPES',amount:-2000}),
 inv('hsa',{description:'CO CONTR CURRENT YR EMPLOYER CUR YR',amount:-40}),
]}};
let s=summarizeIncome(data,2026,'2026-10');
assert.equal(s.cashIncome,1505);assert.equal(s.payroll,1500);assert.equal(s.bankInterest,5);assert.equal(s.nonIncomeCredits,0);assert.equal(s.events.find(e=>e.id==='interest').includedInCashIncome,true);
assert.equal(s.spending,180);assert.equal(s.cashSaved,1325);assert.equal(s.investmentDistributions,10);
assert.equal(s.rsuShares,10);assert.equal(s.rsuVestValue,null);assert.equal(s.totalCompensation,null);assert.equal(s.equityInclusiveSavings,null);assert.equal(s.rsuWithholding,null);
assert.equal(s.rsuSaleProceeds,2500);assert.equal(s.reviewAmount,1000);assert.equal(s.confirmedPlusLikely,1505);
assert.equal(s.events.some(e=>e.id==='transfer'),false);assert.equal(s.events.some(e=>e.id==='pending'),false);assert.equal(s.events.find(e=>e.id==='investment:vest').amount,null);
assert.equal(s.events.find(e=>e.id==='investment:sale').includedInCashIncome,false);assert.equal(s.events.find(e=>e.id==='investment:hsa').includedInCashIncome,false);
assert.equal(s.monthly.reduce((a,m)=>a+m.cashIncome,0),s.cashIncome);assert.equal(s.monthly.reduce((a,m)=>a+m.saved,0),s.cashSaved);
s=summarizeIncome(data,2026,'2026-06','month');assert.equal(s.cashIncome,500);assert.equal(s.payroll,500);assert.equal(s.rsuShares,0);
s=summarizeIncome({...data,transactions:[],incomeEvidence:undefined},2026,'2026-10');assert.equal(s.cashIncome,0);assert.equal(s.savingsRate,null);assert.equal(s.rsuVestValue,null);assert.equal(s.complete,false);
assert.throws(()=>summarizeIncome(data,2026,'2026-13'));
console.log('Income tests passed: source income, transfers, refunds, pending, RSU shares/value gaps, sale proceeds, investment distributions, contributions, monthly/YTD reconciliation.');
// Any explicitly classified cash receipt is included; merchant identity is not a rule.
const generic={...data,transactions:[tx('freelance',-200,'income','income_other',{merchant:'Example Client'}),tx('interest',-5,'income','income_interest_earned'),tx('unresolved',-100,'review','other',{merchant:'Example Employer',review:true}),tx('rail',-20,'income','income_other',{merchant:'Zelle from Example Client'}),tx('refund',-10,'expense','shopping',{merchant:'Example Store'})]};
const untouched=structuredClone(generic),classified=applyIncomePolicy(generic),generalSummary=summarizeIncome(generic,2026,'2026-10');
assert.equal(generalSummary.cashIncome,225);assert.equal(generalSummary.reviewAmount,100);assert.equal(generalSummary.spending,-10);
assert.deepEqual(generic,untouched);assert.deepEqual(applyIncomePolicy(classified),classified);
const corrected=applyIncomePolicy(generic,{unresolved:{reviewDecision:'cash_income'}});assert.equal(summarizeIncome(corrected,2026,'2026-10').cashIncome,325);
assert.equal(applyIncomePolicy(generic,{freelance:{flow:'transfer'}}).transactions.find(t=>t.id==='freelance').flow,'transfer');
const unknownRsu={...data,transactions:[],incomeEvidence:{...data.incomeEvidence,investmentRecords:[inv('unknown-rsu',{description:'RSU cash journal',type:'cash',subtype:'withdrawal',amount:75})]}};
let unknownSummary=summarizeIncome(unknownRsu,2026,'2026-10');
assert.equal(unknownSummary.events[0].kind,'review');assert.equal(unknownSummary.events[0].status,'review');assert.equal(unknownSummary.rsuWithholding,null);
const numericRsu={...data,transactions:[],incomeEvidence:{...data.incomeEvidence,investmentRecords:[inv('numeric-vest',{description:'YOU BOUGHT RSU123456',ticker:'EXMPL',type:'buy',subtype:'buy',quantity:10})]}};
assert.equal(summarizeIncome(numericRsu,2026,'2026-10').rsuShares,10);
console.log('RSU evidence tests passed: numeric award references recognized; unlabeled withdrawals never assumed withholding.');
const receiptQuote={date:'2026-05-15',ticker:'EXMPL',price:100,basis:'regular-session close',source:'Verified test source',currency:'USD'};
const pricedData={...data,incomeEvidence:{...data.incomeEvidence,rsuPrices:[receiptQuote]}};
let pricedSummary=summarizeIncome(pricedData,2026,'2026-10');
assert.equal(pricedSummary.rsuReceiptValue,1000);assert.equal(pricedSummary.rsuVestValue,1000);assert.equal(pricedSummary.effectiveIncome,2505);assert.equal(pricedSummary.knownRsuWithholding,50);assert.equal(pricedSummary.effectiveSurplusBeforeRsuWithholding,2325);assert.equal(pricedSummary.effectiveSavings,2325);assert.equal(pricedSummary.rsuSaleProceeds,2500);assert.equal(pricedSummary.totalCompensation,null);assert.equal(pricedSummary.withholdingCoverageComplete,false);
assert.equal(pricedSummary.events.find(e=>e.id==='investment:vest').amount,1000);assert.equal(pricedSummary.events.find(e=>e.id==='investment:vest').includedInEffectiveIncome,true);
const alreadyExpensed={...pricedData,transactions:[...pricedData.transactions,tx('tax-expense',50,'expense','financial',{sourceInvestmentTransactionId:'tax'})]};
let dedupSummary=summarizeIncome(alreadyExpensed,2026,'2026-10');assert.equal(dedupSummary.additionalRecordedRsuWithholding,0);assert.equal(dedupSummary.effectiveSavings,2275);
const potentialDuplicate={...pricedData,transactions:[...pricedData.transactions,tx('possible-tax-expense',50,'expense','financial')]};
assert.equal(summarizeIncome(potentialDuplicate,2026,'2026-10').effectiveSurplusAfterRecordedWithholding,null);
const wrongDateQuote={...pricedData,incomeEvidence:{...pricedData.incomeEvidence,rsuPrices:[{...receiptQuote,date:'2026-05-16'}]}};
assert.equal(summarizeIncome(wrongDateQuote,2026,'2026-10').rsuReceiptValue,null);
console.log('Receipt-date model tests passed: exact price/date valuation, sales excluded, partial withholding, duplicate-safe taxes, missing date stays unavailable.');

// User confirms sell-to-cover: actual received shares are already after tax.
for(const mode of ['month','ytd','year']){
 const afterTax=summarizeIncome(pricedData,2026,'2026-05',mode);
 assert.equal(afterTax.additionalRecordedRsuWithholding,0,'recorded tax journals are never a second deduction');
 assert.equal(afterTax.effectiveSurplusAfterRecordedWithholding,null,'retired deduction model stays unavailable');
 assert.equal(afterTax.rsuReceiptShareBasis,'recorded received shares; tax basis unknown');
 assert.equal(afterTax.rsuTaxJournalsTreatment,'settlement history only; no second deduction');
 assert.equal(afterTax.effectiveSavings,afterTax.effectiveIncome-afterTax.spending);
 assert.ok(afterTax.monthly.every(row=>row.effectiveSurplusAfterRecordedWithholding===null));
}
const noTaxHistory=summarizeIncome({...pricedData,incomeEvidence:{...pricedData.incomeEvidence,investmentRecords:pricedData.incomeEvidence.investmentRecords.filter(r=>r.id!=='tax')}},2026,'2026-10');
assert.equal(noTaxHistory.effectiveSavings,pricedSummary.effectiveSavings,'adding or removing recorded tax journals never changes the received-share surplus');
assert.equal(noTaxHistory.effectiveSavingsRate,pricedSummary.effectiveSavingsRate);
console.log('Received-share valuation regression passed: no gross-up or second deduction in Monthly/YTD/Past year; journal history cannot change surplus or ratio.');
