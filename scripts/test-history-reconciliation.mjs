import assert from 'node:assert/strict';
import {deriveDataset} from '../lib/classification.ts';
import {applyIncomePolicy} from '../lib/periods.ts';
import {summarizePeriod} from '../lib/finance.ts';
import {summarizeReview} from '../lib/review.ts';
import {transactionNoteForDisplay} from '../lib/history-reconciliation.ts';
const account=(id,type,subtype)=>({id,name:'Synthetic '+id,type,subtype,institution:'Synthetic bank',mask:'0000',balance:0,netBalance:0,balanceDate:null,balanceAgeKnown:false,syncStatus:'ready'});
const row=(id,patch={})=>({id,date:'2026-10-10',merchant:'Synthetic merchant',sourceName:'Synthetic merchant',accountId:'checking',amount:120,category:'Review',flow:'review',review:true,pending:false,confidence:'HIGH',exceptional:false,note:'',...patch});
const data=transactions=>({version:1,asOf:'2026-10-31',syncedAt:'2026-11-01T00:00:00Z',dateRange:{start:'2025-01-01',end:'2026-10-31'},coverage:{},accounts:[account('checking','depository','checking'),account('savings','depository','savings'),account('card','credit','credit card'),account('other-card','credit','credit card')],transactions,netWorthHistory:[],recurring:[],notes:[]});
const mechanics=[];
for(const accountId of ['checking','savings'])for(const sourceName of ['American Express Payment','Chase Credit Card Payment','Capital One Autopay','Credit Card Payment'])mechanics.push(row(accountId+sourceName,{accountId,sourceName,sourceCategoryDetailed:'transfers_credit_card_payment'}));
mechanics.push(row('invest',{sourceName:'Synthetic brokerage',sourceCategoryDetailed:'transfers_investment_retirement_transfer_out'}),row('online',{sourceName:'Online Transfer / Payment',sourceCategoryDetailed:'transfers_other_transfer_out'}));
for(const accountId of ['checking','savings'])mechanics.push(row('interest-'+accountId,{accountId,sourceName:'Interest Earned',amount:-1,sourceCategoryDetailed:'income_interest_earned'}));
const input=data(mechanics),snapshot=structuredClone(input),derived=deriveDataset(input);
assert.ok(derived.transactions.every(t=>!t.review&&t.flow===(t.id.startsWith('interest-')?'income':'transfer')));
assert.equal(summarizePeriod(derived,'2026-10','month').spending,0);assert.equal(summarizePeriod(derived,'2026-10','month').cashSaved,2);
assert.ok(derived.transactions.every(t=>!t.transferTransactionId&&!t.transferAccountId),'No ownership or provider pairs invented');
assert.deepEqual(input,snapshot);assert.deepEqual(deriveDataset(derived),derived);assert.deepEqual(applyIncomePolicy(derived),derived);
for(const patch of [{confidence:'LOW'},{pending:true},{sourceCategoryDetailed:'other_other'}]){const t=deriveDataset(data([row('unsupported',{sourceName:'American Express Payment',sourceCategoryDetailed:'transfers_credit_card_payment',...patch})])).transactions[0];assert.equal(t.review,true);}
for(const patch of [{review:true},{flow:'review'},{category:'Custom purpose'}]){const t=deriveDataset(input,{[mechanics[0].id]:patch}).transactions[0];assert.equal(t.review,true,'Saved decisions survive recognition');}
const category=row('optional',{accountId:'card',flow:'expense',category:'Other',confidence:'LOW',amount:5000,note:'Expense counted using the stored category; review its category.'});
const categories=deriveDataset(data([category]));assert.equal(categories.transactions[0].review,false);assert.equal(categories.transactions[0].categoryReviewOptional,true);assert.equal(categories.transactions[0].category,'Other');assert.equal(summarizePeriod(categories,'2026-10','month').spending,5000);
assert.equal(transactionNoteForDisplay(categories.transactions[0]),'');assert.equal(categories.transactions[0].note,category.note,'Raw notes preserved');
assert.equal(deriveDataset(data([category]),{optional:{review:true}}).transactions[0].review,true);
assert.equal(deriveDataset(data([{...category,note:'Please check whether this is duplicated.'}])).transactions[0].review,true);
assert.equal(deriveDataset(data([category]),{optional:{note:'Please check whether this is duplicated.'}}).transactions[0].review,true,'A saved custom request is not generated category advice');
for(const patch of [{flow:'review'},{flow:'income'},{flow:'transfer'},{pending:true},{amount:-5000},{note:''}]){
 const original={...category,...patch},result=applyIncomePolicy(data([original])).transactions[0];
 assert.equal(result.review,true,'Pending, other flows, credits and unproven blank-note flags are not category-only reconciliation');
}
assert.deepEqual(deriveDataset(categories),categories,'Optional category status is stable on repeated derivation');
assert.ok(!summarizeReview(categories,'2026-10','month').openFindings.some(f=>f.kind==='purpose'),'Category-only detail is context, not required action');
const charge=row('purchase',{accountId:'card',date:'2026-08-01',merchant:'Synthetic Goods',sourceName:'Synthetic Goods',flow:'expense',category:'Shopping',review:false,amount:42});
const credit=row('credit',{accountId:'card',merchant:'Synthetic Goods',sourceName:'Synthetic Goods',amount:-42,sourceCategoryDetailed:'other_other'});
const refundData=data([charge,credit]),refund=deriveDataset(refundData),r=refund.transactions[1];
assert.equal(r.flow,'expense');assert.equal(r.review,false);assert.equal(r.refundInference.purchaseId,charge.id);assert.match(r.refundInference.reason,/Not provider-confirmed/);assert.equal(r.reviewDecision,undefined);assert.equal(r.transferTransactionId,undefined);assert.equal(summarizePeriod(refund,'2026-10','year').spending,0);
assert.deepEqual(deriveDataset(refund),refund);assert.deepEqual(applyIncomePolicy(refund),refund);
assert.equal(applyIncomePolicy(refund,{credit:{review:true}}).transactions[1].review,true,'Direct policy callers retain explicit review flags');
const zelleAfterInference=applyIncomePolicy({...refund,transactions:refund.transactions.map(t=>t.id==='credit'?{...t,merchant:'Zelle',sourceName:'Zelle Payment',reviewDecision:'zelle'}:t)}).transactions[1];assert.equal(zelleAfterInference.flow,'transfer');assert.equal(zelleAfterInference.dashboardScope,'zelle');assert.equal(zelleAfterInference.refundInference,undefined);
assert.equal(deriveDataset(refund,{credit:{flow:'transfer',review:false}}).transactions[1].flow,'transfer','A saved correction replaces the inference');
for(const rows of [[charge,{...charge,id:'second'},credit],[charge,credit,{...credit,id:'competing'}],[charge,credit,{...credit,id:'partial',amount:-10}],[{...charge,accountId:'other-card'},credit],[{...charge,date:'2026-10-11'},credit],[{...charge,date:'2026-06-01'},credit],[charge,{...credit,pending:true}],[charge,{...credit,note:'Check this disputed credit.'}]])assert.equal(deriveDataset(data(rows)).transactions.find(t=>t.id==='credit').flow,'review','Ambiguous, unsupported, competing, future, distant, pending and custom flags remain');
assert.equal(deriveDataset(refundData,{credit:{review:true}}).transactions[1].flow,'review');
const changedIdentity=applyIncomePolicy({...refund,transactions:refund.transactions.map(t=>t.id==='credit'?{...t,accountId:'checking',merchant:'Amazon',sourceName:'Amazon'}:t)}).transactions[1];assert.equal(changedIdentity.flow,'review');assert.equal(changedIdentity.refundInference,undefined,'Changing merchant/account removes unsupported refund inference without inventing income');
const changedBenefit=deriveDataset({...refund,transactions:refund.transactions.map(t=>t.id==='credit'?{...t,merchant:'Platinum Lodging Credit',sourceName:'Platinum Lodging Credit',sourceCategoryDetailed:'travel_lodging'}:t)}).transactions[1];assert.equal(changedBenefit.flow,'expense');assert.equal(changedBenefit.category,'Travel');assert.equal(changedBenefit.refundInference,undefined,'New explicit credit evidence replaces an old inference');
const removed=applyIncomePolicy({...refund,transactions:refund.transactions.filter(t=>t.id!=='purchase')});assert.equal(removed.transactions[0].flow,'review','Lost evidence reopens the inference');assert.equal(removed.transactions[0].refundInference,undefined);
const benefit=deriveDataset(data([row('lodging',{accountId:'card',sourceName:'Platinum Lodging Credit',amount:-90,sourceCategoryDetailed:'travel_lodging'})])).transactions[0];assert.equal(benefit.flow,'expense');assert.equal(benefit.review,false);assert.equal(benefit.category,'Travel');
assert.equal(deriveDataset(data([{...mechanics[0],note:'Unresolved money movement. Excluded from income and spending until its purpose is confirmed. Keep this context.'}])).transactions[0].note.includes('Keep this context.'),true);
console.log('History reconciliation: bank/card payments, savings, investment funding, interest, optional category detail, unique refunds and explicit benefits; saved flags, ambiguity, source immutability, revalidation and accounting totals passed.');
