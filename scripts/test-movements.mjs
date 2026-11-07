import assert from 'node:assert/strict';
import { summarizeMovements } from '../lib/movements.ts';

const account=(id,type='depository')=>({id,name:id,institution:'Test bank',type,subtype:'',mask:'',balance:0,netBalance:0,balanceDate:null,balanceAgeKnown:false,syncStatus:'synced'});
const tx=(id,amount,extra={})=>({id,date:'2026-10-05',merchant:id,accountId:'checking',amount,category:'Transfers',flow:'transfer',confidence:'HIGH',exceptional:false,note:'',pending:false,review:false,...extra});
const dataset=transactions=>({version:1,syncedAt:'2026-10-25T12:00:00Z',asOf:'2026-10-25',dateRange:{start:'2026-09-01',end:'2026-10-25'},coverage:{},accounts:[account('checking'),account('savings'),account('card','credit'),account('brokerage','investment')],transactions,netWorthHistory:[],recurring:[],notes:[]});
const paired=dataset([
 tx('funding',100,{transferTransactionId:'repayment',sourceCategoryDetailed:'transfers_investment_retirement_transfer_out'}),
 tx('repayment',-100,{accountId:'card',transferTransactionId:'funding'}),
 tx('purchase',100,{accountId:'card',flow:'expense'}),
 tx('refund',-20,{accountId:'card',flow:'expense',transferTransactionId:'funding'}),
]);
let result=summarizeMovements(paired,'2026-10');
assert.equal(result.rows.length,1);assert.equal(result.totals.uniqueAmount,100);assert.equal(result.totals.uniqueCount,1);
assert.equal(result.totals.outgoing,100);assert.equal(result.totals.incoming,100);
assert.equal(result.rows[0].kind,'Card repayment');assert.equal(result.rows[0].matchStatus,'paired');assert.equal(result.totals.cardRepayments,100);
assert.deepEqual(new Set(result.rows[0].sourceIds),new Set(['funding','repayment']));
assert.equal(result.rows[0].sourceAccountId,'checking');assert.equal(result.rows[0].destinationAccountId,'card');
// Equal amounts/dates without explicit provider pairing never merge.
result=summarizeMovements(dataset([tx('out',100),tx('in',-100,{accountId:'savings'})]),'2026-10');
assert.equal(result.rows.length,2);assert.equal(result.totals.uniqueAmount,200);assert.equal(result.totals.pairedCount,0);
// One-sided provider references are enough only when a real opposite/equal counterpart is present.
result=summarizeMovements(dataset([tx('out',100,{transferTransactionId:'in'}),tx('in',-100,{accountId:'savings'})]),'2026-10');
assert.equal(result.rows.length,1);assert.equal(result.rows[0].matchStatus,'paired');
result=summarizeMovements(dataset([tx('out',100,{transferTransactionId:'in'}),tx('in',-99,{accountId:'savings'})]),'2026-10');
assert.equal(result.rows.length,2);assert.equal(result.totals.pairedCount,0);
// Cross-month evidence stays in the row; unique movement value uses the debit date exactly once.
const boundary=dataset([tx('sep-debit',500,{date:'2026-09-30',transferTransactionId:'oct-credit'}),tx('oct-credit',-500,{date:'2026-10-01',accountId:'savings',transferTransactionId:'sep-debit'})]);
const sep=summarizeMovements(boundary,'2026-09'),oct=summarizeMovements(boundary,'2026-10');
assert.equal(sep.totals.uniqueAmount,500);assert.equal(sep.totals.outgoing,500);assert.equal(sep.totals.incoming,0);
assert.equal(oct.totals.uniqueAmount,0);assert.equal(oct.totals.outgoing,0);assert.equal(oct.totals.incoming,500);
assert.equal(oct.rows.length,1);assert.equal(oct.rows[0].outsidePeriod,true);assert.equal(oct.rows[0].countedInPeriod,false);
assert.equal(oct.rows[0].anchorDate,'2026-09-30');assert.equal(oct.rows[0].legs.find(l=>l.id==='sep-debit').inPeriod,false);
assert.equal(oct.trend.reduce((n,m)=>n+m.uniqueAmount,0),0);
assert.equal(summarizeMovements(boundary,'2026-10','year').totals.uniqueAmount,500);
// A reported account link alone does not verify a Zelle destination or cause source classification changes.
const linked=tx('zelle',25,{merchant:'Zelle to another person',reviewDecision:'zelle',transferAccountId:'savings',sourceCategoryDetailed:'transfers_other_transfer_out'});
result=summarizeMovements(dataset([linked]),'2026-10');
assert.equal(result.rows.length,0);assert.equal(result.totals.uniqueAmount,0);
assert.equal(result.zelle.rows.length,1);assert.equal(result.zelle.totals.sent,25);assert.equal(result.zelle.rows[0].counterparty,'another person');assert.equal(linked.flow,'transfer');
// Pending and unresolved purpose have separate counts/values; category-only expense review is not a movement.
result=summarizeMovements(dataset([tx('pending',40,{pending:true}),tx('unresolved',-70,{flow:'review',review:true}),tx('expense-review',12,{flow:'expense',review:true})]),'2026-10');
assert.equal(result.totals.uniqueAmount,0);assert.equal(result.totals.outgoing,0);assert.equal(result.totals.incoming,0);
assert.equal(result.totals.reviewAmount,70);assert.equal(result.totals.reviewCount,1);assert.equal(result.totals.pendingAmount,40);assert.equal(result.totals.pendingCount,1);assert.equal(result.rows.length,2);
// Missing counterparts and unknown endpoints remain single-sided.
result=summarizeMovements(dataset([tx('missing',10,{transferTransactionId:'not-loaded'})]),'2026-10');
assert.equal(result.rows[0].matchStatus,'single-sided');assert.match(result.rows[0].reason,/do not form a valid/);assert.equal(result.rows[0].destinationAccountId,null);
// Ambiguous fan-in references do not pick an arbitrary equal-value match.
result=summarizeMovements(dataset([tx('one',10,{transferTransactionId:'target'}),tx('two',10,{transferTransactionId:'target'}),tx('target',-10,{accountId:'savings'})]),'2026-10');
assert.equal(result.rows.length,3);assert.equal(result.totals.pairedCount,0);
// Zero activity and income-only periods yield empty movement reports.
result=summarizeMovements(dataset([tx('salary',-1000,{flow:'income'})]),'2026-10');
assert.equal(result.rows.length,0);assert.equal(result.totals.uniqueAmount,0);assert.equal(result.totals.uniqueCount,0);
assert.throws(()=>summarizeMovements(dataset([]),'2026-13'));
console.log('PASS: explicit-only pairing; equal cents/opposite sign; card endpoint priority; gross vs unique; cross-month anchoring and outside-period evidence; link-only warnings; review/pending separation; refunds/income excluded; ambiguity, missing counterpart and zero activity.');
