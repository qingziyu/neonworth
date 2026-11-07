import assert from 'node:assert/strict';
import { summarizeMovements } from '../lib/movements.ts';
import { isZelleTransaction } from '../lib/transaction-policy.ts';

const account=(id,type='depository')=>({id,name:id,institution:'Test bank',type,subtype:'checking',mask:'1234',balance:0,netBalance:0,balanceDate:null,balanceAgeKnown:false,syncStatus:'synced'});
const tx=(id,amount,extra={})=>({id,date:'2026-10-05',merchant:id,accountId:'checking',amount,category:'Transfers',flow:'transfer',confidence:'HIGH',exceptional:false,note:'',pending:false,review:false,...extra});
const dataset=transactions=>({version:1,syncedAt:'2026-10-25T12:00:00Z',asOf:'2026-10-25',dateRange:{start:'2025-10-01',end:'2026-10-25'},coverage:{},accounts:[account('checking'),account('savings'),account('card','credit')],transactions,netWorthHistory:[],recurring:[],notes:[]});
const ordinary=[tx('ordinary-out',100,{transferTransactionId:'ordinary-in'}),tx('ordinary-in',-100,{accountId:'savings',transferTransactionId:'ordinary-out'}),tx('ordinary-pending',20,{pending:true}),tx('ordinary-review',70,{flow:'review',review:true})];
const zelle=[
 tx('zelle-sent',50,{merchant:'Zelle payment to SOMEONE 123456',sourceName:'Zelle to Someone',flow:'expense',review:true}),
 tx('zelle-received',-80,{merchant:'Zelle payment from FRIEND',sourceName:'Zelle from Friend',flow:'income',review:true}),
 tx('zelle-link-out',100,{merchant:'Zelle to Self',transferTransactionId:'zelle-link-in',transferAccountId:'savings'}),
 tx('zelle-link-in',-100,{merchant:'Zelle from Self',accountId:'savings',transferTransactionId:'zelle-link-out',transferAccountId:'checking'}),
 tx('zelle-pending-sent',7,{merchant:'Zelle to Someone',pending:true,flow:'review',review:true}),
 tx('zelle-pending-received',-9,{merchant:'Zelle from Friend',pending:true}),
 tx('old-zelle',-22,{merchant:'Zelle from Old friend',date:'2025-10-25'}),
 tx('boundary-zelle',-11,{merchant:'Zelle from Boundary friend',date:'2025-10-26'}),
 tx('september-zelle',35,{merchant:'Zelle to September friend',date:'2026-09-30'}),
 tx('future-zelle',-999,{merchant:'Zelle from Future friend',date:'2026-10-26'}),
];
zelle.forEach(row=>row.reviewDecision='zelle');
const data=dataset([...ordinary,...zelle]),before=structuredClone(data);
for(const mode of ['month','ytd','year']){
 const result=summarizeMovements(data,'2026-10',mode),baseline=summarizeMovements(dataset(ordinary),'2026-10',mode);
 assert.deepEqual(result.totals,baseline.totals,'Zelle cannot change ordinary movement metrics, pending counts or review queue');
 assert.deepEqual(result.byKind,baseline.byKind);assert.deepEqual(result.trend,baseline.trend);
 assert.ok(result.rows.every(row=>row.sourceIds.every(id=>!zelle.some(transaction=>transaction.id===id))));
 assert.ok(result.zelle.rows.every(row=>row.date>=result.period.start&&row.date<=result.period.end));
 assert.equal(result.zelle.rows.filter(row=>row.pending).length,2);
 assert.equal(result.zelle.totals.pendingCount,2);assert.equal(result.zelle.totals.pendingSent,7);assert.equal(result.zelle.totals.pendingReceived,9);
 assert.equal(result.zelle.rows.find(row=>row.id==='zelle-sent').counterparty,'Someone');
 assert.equal(result.zelle.rows.find(row=>row.id==='zelle-sent').direction,'sent');
 assert.equal(result.zelle.rows.find(row=>row.id==='zelle-received').direction,'received');
 assert.equal(result.zelle.rows.filter(row=>row.id.startsWith('zelle-link')).length,2,'even explicit Zelle source links retain separate source rows in the isolated ledger');
 assert.equal(result.zelle.trend.reduce((total,row)=>total+Math.round(row.sent*100),0),Math.round(result.zelle.totals.sent*100));
 assert.equal(result.zelle.trend.reduce((total,row)=>total+Math.round(row.received*100),0),Math.round(result.zelle.totals.received*100));
 assert.equal(result.zelle.totals.netReceived,Math.round((result.zelle.totals.received-result.zelle.totals.sent)*100)/100);
 assert.equal(result.zelle.rows.some(row=>row.id==='future-zelle'),false);
}
const month=summarizeMovements(data,'2026-10','month');
assert.equal(month.zelle.totals.sent,150);assert.equal(month.zelle.totals.received,180);assert.equal(month.zelle.totals.netReceived,30);assert.equal(month.zelle.totals.postedCount,4);
const year=summarizeMovements(data,'2026-10','year');
assert.equal(year.zelle.rows.some(row=>row.id==='old-zelle'),false);assert.equal(year.zelle.rows.some(row=>row.id==='boundary-zelle'),true);
assert.deepEqual(data,before,'source amounts, dates, descriptions and links remain unchanged');
const only=summarizeMovements(dataset(zelle),'2026-10');
assert.equal(only.totals.uniqueAmount,0);assert.equal(only.totals.reviewCount,0);assert.equal(only.totals.pendingCount,0);assert.equal(only.rows.length,0);
const empty=summarizeMovements(dataset(ordinary),'2026-10');assert.equal(empty.zelle.rows.length,0);assert.equal(empty.zelle.totals.sent,0);assert.equal(empty.zelle.totals.received,0);
assert.equal(isZelleTransaction(tx('Zellement',1)),false,'a similarly spelled merchant is not the Zelle rail');

console.log('Zelle isolation passed: dedicated source rows, sent/received/net, all signs and old flows, independent monthly/YTD/past-year totals, pending separation, exact boundaries, no pairing or source mutation.');
