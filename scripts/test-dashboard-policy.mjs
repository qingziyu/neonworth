import assert from 'node:assert/strict';
import { applyIncomePolicy, resolvePeriod } from '../lib/periods.ts';
import { deriveDataset, transactionDescription } from '../lib/classification.ts';
import { summarizeIncome } from '../lib/income.ts';
import { summarizePeriod } from '../lib/finance.ts';
import { summarizeMovements } from '../lib/movements.ts';
import { summarizeRecurring } from '../lib/recurring.ts';
import { summarizeReview } from '../lib/review.ts';
import { datasetSchema } from '../lib/store-validation.ts';
import { isZelleTransaction, isAppleCardSpendingProxy } from '../lib/transaction-policy.ts';

const account=(id,type='depository',name=id)=>({id,name,institution:'Test',type,subtype:type==='depository'?'checking':'credit card',mask:'1234',balance:0,netBalance:0,balanceDate:null,balanceAgeKnown:false,syncStatus:'synced'});
const tx=(id,amount,patch={})=>({id,amount,date:'2026-08-10',merchant:id,sourceName:id,accountId:'checking',category:'Transfers',flow:'transfer',confidence:'VERY_HIGH',pending:false,review:false,exceptional:false,note:'',...patch});
const data={version:1,asOf:'2026-10-25',syncedAt:'2026-10-26T00:00:00Z',dateRange:{start:'2025-10-01',end:'2026-10-25'},coverage:{transactions:{is_complete_for_query:true}},accounts:[account('checking'),account('card','credit')],transactions:[
 tx('zelle-in',-500,{merchant:'Zelle from Person',flow:'income',category:'Payroll',review:true}),
 tx('zelle-out',100,{sourceName:'Zelle to Person',flow:'expense',category:'Dining & coffee',review:true}),
 tx('zelle-refund',-20,{sourceName:'Zelle from Person',flow:'expense',category:'Dining & coffee',note:'User-confirmed meal split'}),
 tx('zelle-pending',30,{sourceName:'Zelle to Person',pending:true,flow:'expense',category:'Shopping'}),
 tx('apple-a',12.34,{merchant:'Apple Card',sourceName:'Apple Card Payment',sourceCategoryDetailed:'transfers_credit_card_payment',review:true}),
 tx('apple-b',3.21,{merchant:'Apple Card',sourceName:'Apple Card Payment',sourceCategoryDetailed:'transfers_credit_card_payment'}),
 tx('apple-pending',99,{merchant:'Apple Card',sourceName:'Apple Card Payment',pending:true}),
 tx('apple-retail',50,{merchant:'Apple Store',sourceName:'Apple Store',accountId:'card',flow:'expense',category:'Shopping'}),
 tx('apple-cash',-10,{merchant:'APPLE CASH BANK XFER',sourceName:'Apple Cash Transfer'}),
 tx('ordinary-repayment',100,{merchant:'Credit Card Payment',sourceName:'Credit Card Payment',sourceCategoryDetailed:'transfers_credit_card_payment'}),
 tx('salary',-200,{merchant:'Example Employer',sourceName:'Example Employer Payroll',flow:'income',category:'Payroll',sourceCategoryDetailed:'income_salary'}),
],netWorthHistory:[],recurring:[{description:'Zelle to Person',merchant_name:'Zelle',flow_type:'outflow',is_active:true,frequency:'MONTHLY',first_date:'2026-01-01',last_date:'2026-08-10',transaction_ids:['zelle-out']}],notes:[]};
const original=structuredClone(data),derived=deriveDataset(data);
assert.deepEqual(datasetSchema.parse(data),data,'Validation never persists derived policy labels into raw source');
assert.deepEqual(data,original);assert.deepEqual(deriveDataset(derived),derived);
for(const mode of ['month','ytd','year']){
 const income=summarizeIncome(derived,2026,'2026-08',mode),summary=summarizePeriod(derived,'2026-08',mode),movements=summarizeMovements(derived,'2026-08',mode);
 assert.equal(income.cashIncome,700,'Explicitly classified income includes receipts over any payment rail');
 assert.equal(income.spending,130,'Rail expense/refund plus retail purchase counted once; card repayments excluded');
 assert.equal(income.appleCardSpending,0);assert.equal(income.appleCardPaymentCount,0);
 assert.equal(summary.spending,130);assert.equal(movements.zelle.rows.length,0,'No blanket isolation is enabled');
 assert.ok(movements.rows.some(row=>row.sourceIds.includes('apple-a')));
}
const apple=derived.transactions.find(t=>t.id==='apple-a');assert.equal(apple.flow,'transfer');assert.equal(apple.spendingProxy,undefined);
assert.equal(isAppleCardSpendingProxy(derived.transactions.find(t=>t.id==='apple-retail')),false);
assert.equal(isAppleCardSpendingProxy(derived.transactions.find(t=>t.id==='apple-cash')),false);
// A saved, explicit exclusion applies consistently across reports and does not alter source rows.
const excluded=deriveDataset({...data,transactions:data.transactions.map(t=>t.id.startsWith('zelle')?{...t,reviewDecision:'zelle'}:t)});
const ordinary={...excluded,transactions:excluded.transactions.filter(t=>!isZelleTransaction(t))};
for(const mode of ['month','ytd','year']){
 assert.deepEqual(summarizeIncome(excluded,2026,'2026-08',mode),summarizeIncome(ordinary,2026,'2026-08',mode));
 assert.deepEqual(summarizePeriod(excluded,'2026-08',mode),summarizePeriod(ordinary,'2026-08',mode));
 assert.deepEqual(summarizeReview(excluded,'2026-08',mode),summarizeReview(ordinary,'2026-08',mode));
 const movement=summarizeMovements(excluded,'2026-08',mode);
 assert.equal(movement.zelle.totals.sent,100);assert.equal(movement.zelle.totals.received,520);assert.equal(movement.zelle.totals.pendingSent,30);
 const bills=summarizeRecurring(excluded,resolvePeriod(excluded,'2026-08',mode));
 assert.ok([...bills.groups,...bills.repeatPurchases].every(group=>group.transactions.every(t=>!isZelleTransaction(t))));
}
const corrected=deriveDataset(data,{'zelle-out':{flow:'expense',category:'Dining & coffee',review:false}});
assert.equal(corrected.transactions.find(t=>t.id==='zelle-out').flow,'expense','A known rail does not override saved expense treatment');
const assetFromCard={...data,transactions:[tx('asset',60,{accountId:'card',merchant:'Synthetic Asset Dealer',category:'Vehicle asset purchase',flow:'transfer'})]};
assert.equal(summarizeMovements(assetFromCard,'2026-08','month').rows[0].kind,'Asset/debt movement','A card account alone does not reclassify an explicit asset conversion');
console.log('Generic dashboard policy passed: payment-rail neutrality, classified cash income, card repayments, explicit exclusions across domains, saved corrections and immutable source.');
