import assert from 'node:assert/strict';
import { classifyKnownMovement, movementReviewReason } from '../lib/movement-classification.ts';
import { deriveDataset } from '../lib/classification.ts';
import { summarizeMovements } from '../lib/movements.ts';

const account=(id,type='depository',institution='Test')=>({id,name:id,institution,type,subtype:type==='credit'?'credit card':'checking',mask:'1234',balance:0,netBalance:0,balanceDate:null,balanceAgeKnown:false,syncStatus:'synced'});
const transaction=(id,amount,extra={})=>({id,date:'2026-07-30',merchant:id,sourceName:id,accountId:'checking',amount,category:'Transfers',flow:'review',confidence:'HIGH',exceptional:false,note:'Unresolved money movement. Excluded from income and spending until its purpose is confirmed.',pending:false,review:true,...extra});
const dataset=transactions=>({version:1,asOf:'2026-10-25',syncedAt:'2026-10-26T00:00:00Z',dateRange:{start:'2025-10-01',end:'2026-10-25'},coverage:{},accounts:[account('checking'),{...account('savings'),subtype:'savings'},account('card','credit'),account('other-card','credit','Elsewhere')],transactions,netWorthHistory:[],recurring:[],notes:[]});
const payment=transaction('payment',-3000,{accountId:'card',merchant:'Payment',sourceName:'Payment',category:'Other',sourceCategoryDetailed:'other_other'});
const peer=(id,date)=>transaction(id,-100,{accountId:'card',date,sourceName:'Credit Card Payment',merchant:'Credit Card Payment',sourceCategoryDetailed:'transfers_credit_card_payment',flow:'transfer',review:false});
const sources=[payment,peer('past-1','2026-06-20'),peer('past-2','2026-07-01'),
 transaction('deposit',-75.5,{sourceName:'Remote Online Deposit',sourceCategoryDetailed:'transfers_deposit',confidence:'VERY_HIGH'}),
 transaction('withdrawal',420,{sourceName:'ATM Withdrawal',sourceCategoryDetailed:'transfers_withdrawal',confidence:'VERY_HIGH'}),
 transaction('atm-fee',5,{sourceName:'ATM Withdrawal Fee',sourceCategoryDetailed:'financial_atm_fees',category:'Financial & insurance',flow:'expense',review:false}),
 transaction('online-transfer',1000,{sourceName:'Online Transfer Out',sourceCategoryDetailed:'transfers_other_transfer_out',confidence:'MEDIUM'}),
 transaction('person-transfer',-40,{sourceName:'Haipeng example',sourceCategoryDetailed:'transfers_other_transfer_in',confidence:'MEDIUM'}),
 transaction('paypal',-60.56,{sourceName:'PayPal Transfer',sourceCategoryDetailed:'transfers_other_transfer_in',confidence:'MEDIUM'}),
 transaction('amazon-savings',-1001,{accountId:'savings',sourceName:'Amazon',merchant:'Amazon',sourceCategoryDetailed:'transfers_other_transfer_in',confidence:'LOW'}),
 transaction('amazon-savings-high',-10,{accountId:'savings',sourceName:'Amazon',merchant:'Amazon',sourceCategoryDetailed:'transfers_other_transfer_in',confidence:'HIGH'}),
 transaction('unknown-person',-36,{sourceName:'Jingwen Xu',sourceCategoryDetailed:'other_other',confidence:'LOW'}),
 transaction('cashapp',50,{sourceName:'Cash App to Example Merchant A',sourceCategoryDetailed:'transfers_other_transfer_out',confidence:'MEDIUM'}),
 transaction('car-check',54900.09,{sourceName:'Cash Withdrawal',sourceCategoryDetailed:'transfers_withdrawal',category:'Vehicle asset purchase',flow:'transfer',review:false,note:'Vehicle asset purchase — cash movement, excluded from consumption spending.'}),
];
const data=dataset(sources),before=structuredClone(data),classified={...data,transactions:data.transactions.map(t=>classifyKnownMovement(t,data))};
assert.deepEqual(data,before,'mechanical classification never changes source records');
const find=id=>classified.transactions.find(t=>t.id===id);
for(const id of ['payment','deposit','withdrawal','online-transfer','person-transfer','paypal']){assert.equal(find(id).flow,'transfer');assert.equal(find(id).review,false);assert.ok(find(id).movementClassification);}
for(const id of ['amazon-savings','amazon-savings-high','unknown-person','cashapp']){assert.equal(find(id).flow,'review');assert.equal(find(id).review,true);assert.equal(find(id).movementClassification,undefined);}
assert.equal(find('payment').movementClassification.kind,'card_repayment');
assert.equal(find('payment').transferTransactionId,undefined,'corroboration does not invent a provider-linked pair');
assert.equal(find('deposit').movementClassification.kind,'bank_deposit');
assert.equal(find('withdrawal').movementClassification.kind,'cash_withdrawal');
assert.equal(find('atm-fee').flow,'expense');assert.equal(find('atm-fee').amount,5);
assert.equal(find('car-check').category,'Vehicle asset purchase');assert.equal(find('car-check').movementClassification,undefined);
for(const t of sources)for(const field of ['id','amount','date','accountId','merchant','sourceName','sourceCategoryDetailed','transferAccountId','transferTransactionId'])assert.deepEqual(find(t.id)[field],t[field],`immutable ${field}`);
const onePeer=dataset([payment,peer('only-peer','2026-07-01')]);assert.equal(classifyKnownMovement(payment,onePeer).movementClassification,undefined);
const futurePeers=dataset([payment,peer('future-1','2026-08-01'),peer('future-2','2026-08-02')]);assert.equal(classifyKnownMovement(payment,futurePeers).movementClassification,undefined,'future repayments cannot establish a historical classification');
const otherAccountPeers=dataset([payment,...[peer('other-1','2026-06-20'),peer('other-2','2026-07-01')].map(t=>({...t,accountId:'other-card'}))]);assert.equal(classifyKnownMovement(payment,otherAccountPeers).movementClassification,undefined);
const named=transaction('named-card-debit',3000,{accountId:'savings',sourceName:'Gold Card Payment',sourceCategoryDetailed:'transfers_credit_card_payment',flow:'transfer',review:false});
assert.equal(classifyKnownMovement(payment,dataset([payment,named])).movementClassification.kind,'card_repayment');
assert.equal(classifyKnownMovement(payment,dataset([payment,{...named,sourceName:'Transfer',merchant:'Transfer',sourceCategoryDetailed:'transfers_other_transfer_out'}])).movementClassification,undefined,'same cents/date without a relevant payment semantic is not evidence');
const explicitFlow={...payment,flow:'review',classificationOverrides:{flow:'review'}};assert.deepEqual(classifyKnownMovement(explicitFlow,data),explicitFlow);
const explicitCategory={...payment,category:'Custom',classificationOverrides:{category:'Custom'}};assert.deepEqual(classifyKnownMovement(explicitCategory,data),explicitCategory);
const explicitReview=classifyKnownMovement(payment,data,{review:true});assert.equal(explicitReview.review,true);assert.equal(explicitReview.flow,'review');
const pendingDeposit=transaction('pending-deposit',-22,{sourceName:'Deposit',sourceCategoryDetailed:'transfers_deposit',pending:true});assert.equal(classifyKnownMovement(pendingDeposit,dataset([pendingDeposit])).movementClassification,undefined,'pending bank activity waits for its posted source classification');
const customFlag=transaction('custom-deposit',-22,{sourceName:'Deposit',sourceCategoryDetailed:'transfers_deposit',note:'Please check this deposit for me.'});assert.equal(classifyKnownMovement(customFlag,dataset([customFlag])).review,true,'an unexplained custom review flag is not silently cleared');
const amexDebit=transaction('issuer-ach',127.4,{merchant:'American Express',sourceName:'AMERICAN EXPRESS ACH PMT A7170 WEB ID:9493560001',sourceCategoryDetailed:'transfers_credit_card_payment',confidence:'VERY_HIGH',note:''}),amexData=dataset([amexDebit]),amexBefore=structuredClone(amexData);
for(const confidence of ['MEDIUM','HIGH','VERY_HIGH']){const input={...amexDebit,confidence},resolved=classifyKnownMovement(input,dataset([input]));assert.equal(resolved.flow,'transfer');assert.equal(resolved.category,'Card repayment');assert.equal(resolved.review,false);assert.equal(resolved.movementClassification.kind,'card_repayment');assert.equal(resolved.movementClassification.label,'American Express card repayment');assert.equal(resolved.transferAccountId,undefined);assert.equal(resolved.transferTransactionId,undefined);assert.equal(resolved.amount,127.4);assert.match(resolved.movementClassification.reason,/specific American Express card is not established/);}
for(const patch of [{pending:true},{confidence:'LOW'},{sourceCategoryDetailed:'other_other'},{amount:-127.4},{accountId:'card'},{sourceName:'AMERICAN EXPRESS TRAVEL PURCHASE'},{classificationOverrides:{flow:'review'}},{classificationOverrides:{category:'Custom'}}]){const input={...amexDebit,...patch};assert.equal(classifyKnownMovement(input,dataset([input])).movementClassification,undefined,'Only a posted, source-supported issuer repayment on a bank account is recognized automatically.');}
const amexSavedReview=classifyKnownMovement(amexDebit,amexData,{review:true});assert.equal(amexSavedReview.review,true);assert.equal(amexSavedReview.flow,'review');
const amexCustomNote={...amexDebit,note:'Keep this item flagged.'};assert.equal(classifyKnownMovement(amexCustomNote,dataset([amexCustomNote])).review,true);
const amexDerived=deriveDataset(amexData),amexMovement=summarizeMovements(amexDerived,'2026-07','month');assert.equal(amexMovement.totals.cardRepayments,127.4);assert.equal(amexMovement.totals.reviewCount,0);assert.equal(amexMovement.totals.pairedCount,0);assert.ok(amexDerived.transactions.every(row=>row.flow!=='expense'&&row.flow!=='income'));
assert.deepEqual(amexData,amexBefore,'Issuer repayment recognition preserves raw source evidence.');assert.deepEqual(deriveDataset(amexDerived),amexDerived);
// Browser-discovered legacy prompt: known repayment evidence must clear this
// generated request without treating the phrase itself as repayment evidence.
const legacyPrompt='Possible card payment; confirm before including in any economic total.';
const legacyPayment=transaction('qa-reconciled-payment',300,{merchant:'Credit Card Payment',sourceName:'Credit Card Payment',sourceCategoryDetailed:'transfers_credit_card_payment',note:legacyPrompt});
for(const patch of [{},{accountId:'savings'},{accountId:'card',amount:-300}]){
 const input={...legacyPayment,...patch},raw=dataset([input]),snapshot=structuredClone(raw),resolved=deriveDataset(raw),row=resolved.transactions[0];
 assert.equal(row.flow,'transfer');assert.equal(row.review,false);assert.equal(row.movementClassification.kind,'card_repayment');assert.equal(row.note,legacyPrompt,'Original generated note stays in source evidence.');
 assert.equal(summarizeMovements(resolved,'2026-07','month').totals.reviewCount,0);
 assert.deepEqual(raw,snapshot);assert.deepEqual(deriveDataset(resolved),resolved);
 for(const saved of [{review:true},{flow:'review'},{category:'Custom repayment'}]){
  const kept=deriveDataset(raw,{[input.id]:saved}).transactions[0];assert.equal(kept.review,true,'Saved review, flow and category decisions remain authoritative.');assert.equal(kept.flow,'review');
 }
 const annotated=deriveDataset(raw,{[input.id]:{note:'Please check whether this payment was duplicated.'}}).transactions[0];assert.equal(annotated.review,true);assert.equal(annotated.note,'Please check whether this payment was duplicated.','A saved custom review note survives the old source prompt.');
}
for(const extra of [{note:legacyPrompt+' Please check whether this payment was duplicated.'},{note:'Please confirm this card payment.'},{sourceNote:legacyPrompt,note:'Keep this item flagged.'}]){
 const input={...legacyPayment,...extra},resolved=classifyKnownMovement(input,dataset([input]));assert.equal(resolved.review,true,'Custom source/saved note context is not the exact legacy prompt.');assert.equal(resolved.flow,'review');
}
const unsupportedLegacy={...legacyPayment,sourceCategoryDetailed:'other_other',confidence:'LOW'};
assert.equal(classifyKnownMovement(unsupportedLegacy,dataset([unsupportedLegacy])).review,true,'The prompt alone never supplies repayment evidence.');
const legacyOnDeposit={...legacyPayment,amount:-300,sourceName:'Remote Online Deposit',sourceCategoryDetailed:'transfers_deposit'};
assert.equal(classifyKnownMovement(legacyOnDeposit,dataset([legacyOnDeposit])).review,true,'The legacy repayment prompt cannot clear a different kind of movement.');
const refund=transaction('merchant-credit',-50.7,{accountId:'card',merchant:'Amazon',sourceName:'Amazon Marketplace Payment',date:'2026-05-14',sourceCategoryDetailed:'income_other_income'});
const purchase=transaction('original-purchase',50.7,{accountId:'card',merchant:'Amazon',sourceName:'Amazon',date:'2026-05-11',category:'Shopping',flow:'expense',review:false});
const refundSource=dataset([refund,purchase]);
assert.match(movementReviewReason(refund,refundSource),/Possible merchant refund/);assert.match(movementReviewReason(refund,refundSource),/2026-05-11/);assert.match(movementReviewReason(refund,refundSource),/no automatic spending offset/);
for(const invalid of [{...purchase,date:'2026-05-15'},{...purchase,accountId:'other-card'},{...purchase,date:'2026-04-01'}])assert.doesNotMatch(movementReviewReason(refund,dataset([refund,invalid])),/Possible merchant refund/,'future, different-account or distant purchases cannot support a candidate');
assert.doesNotMatch(movementReviewReason(refund,dataset([refund,purchase,{...purchase,id:'ambiguous-purchase'}])),/Possible merchant refund/,'duplicate plausible purchases prevent unique candidate selection');
assert.match(movementReviewReason(sources.find(t=>t.id==='amazon-savings'),data),/counterparty descriptor alone/);
assert.match(movementReviewReason(sources.find(t=>t.id==='unknown-person'),data),/counterparty descriptor alone/);
const movements=summarizeMovements(classified,'2026-07','month');
const withdrawal=movements.rows.find(row=>row.sourceIds.includes('withdrawal')),deposit=movements.rows.find(row=>row.sourceIds.includes('deposit'));
assert.equal(withdrawal.kind,'Cash withdrawal');assert.equal(withdrawal.destination,'Cash (untracked)');assert.equal(withdrawal.destinationAccountId,null);assert.equal(deposit.kind,'Bank deposit');assert.equal(deposit.source,'Source not provided');assert.equal(deposit.sourceAccountId,null);
assert.equal(movements.totals.cashWithdrawals,420);assert.equal(movements.totals.bankDeposits,75.5);
assert.equal(movements.totals.pairedCount,0);
assert.equal(Math.round(movements.byKind.filter(row=>row.kind!=='Review').reduce((n,row)=>n+row.amount,0)*100),Math.round(movements.totals.uniqueAmount*100));
assert.deepEqual(classified.transactions.map(t=>classifyKnownMovement(t,classified)),classified.transactions,'evidence derivation is idempotent');

console.log('Movement evidence passed: standard payment/deposit/withdrawal/transfer mechanics, unknown purpose boundaries, explicit corrections, no fabricated pairing, historical evidence cutoff, fee/asset preservation and source/idempotence invariants.');
