import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { deriveDataset } from '../lib/classification.ts';
import { applyIncomePolicy } from '../lib/periods.ts';
import { summarizePeriod } from '../lib/finance.ts';
import { summarizeMovements } from '../lib/movements.ts';
import { createDatasetIndex } from '../lib/dataset-index.ts';
import { createMovementClassificationContext, classifyKnownMovementWithContext, createMovementReviewContext, movementReviewReasonWithContext } from '../lib/movement-classification.ts';

const account=(id,type='credit',institution='Synthetic Bank')=>({id,type,institution,name:`Synthetic ${id}`,subtype:type==='credit'?'credit card':'checking',mask:'0000',balance:0,netBalance:0,balanceDate:null,balanceAgeKnown:false,syncStatus:'ready'});
const tx=(id,extra={})=>({id,date:'2026-10-10',merchant:'Payment',accountId:'card',amount:-50,category:'Other',flow:'review',confidence:'LOW',exceptional:false,note:'',pending:false,review:true,...extra});
function fixture(size=240){
 const accounts=[account('card'),account('bank','depository'),account('other','credit','Elsewhere')];
 const transactions=Array.from({length:size},(_,i)=>tx(`row-${i}`,{
  date:`${2025+Math.floor(i/120)%2}-${String(i%12+1).padStart(2,'0')}-${String(i%28+1).padStart(2,'0')}`,
  ...(i%5===0?{flow:'transfer',review:false,sourceCategoryDetailed:'transfers_credit_card_payment',confidence:'HIGH'}:{}),
  ...(i%7===0?{accountId:'bank',amount:50,flow:'transfer',review:false,merchant:'Credit Card Payment',sourceCategoryDetailed:'transfers_credit_card_payment'}:{}),
  ...(i%11===0?{accountId:'other',merchant:'Synthetic Goods',amount:50.005,flow:'expense',review:false,category:'Shopping'}:{}),
  ...(i%13===0?{merchant:'Synthetic Goods',accountId:'other',amount:-50.005}:{}),
  ...(i%17===0?{pending:true}:{}),
 }));
 transactions.push(
  tx('duplicate-peer',{date:'2026-09-01',flow:'transfer',review:false,sourceCategoryDetailed:'transfers_credit_card_payment'}),
  tx('duplicate-peer',{date:'2026-10-02',flow:'transfer',review:false,sourceCategoryDetailed:'transfers_credit_card_payment'}),
  tx('same-day-peer',{flow:'transfer',review:false,sourceCategoryDetailed:'transfers_credit_card_payment'}),
  tx('future-peer',{date:'2026-10-31',flow:'transfer',review:false,sourceCategoryDetailed:'transfers_credit_card_payment'}),
  tx('explicit-category',{classificationOverrides:{category:'My category'}}),
  tx('explicit-flow',{classificationOverrides:{flow:'review'}}),
  tx('explicit-review',{classificationOverrides:{review:true}}),
  tx('note-review',{note:'Keep this source flagged.'}),
  tx('apple',{merchant:'Apple Card payment',accountId:'bank',amount:100,flow:'transfer',review:false}),
  tx('apple-linked',{merchant:'Apple Card payment',accountId:'bank',amount:100,transferTransactionId:'row-0'}),
  tx('amazon',{merchant:'Amazon',accountId:'bank',amount:-2000,flow:'transfer'}),
  tx('zelle',{merchant:'Zelle payment',accountId:'bank',amount:70}),
  tx('refund',{merchant:'Synthetic Item',amount:-88}),
  tx('refund-charge',{merchant:'Synthetic Item',amount:88,flow:'expense',review:false,date:'2026-09-10'}),
  tx('refund-future',{merchant:'Synthetic Item',amount:88,flow:'expense',review:false,date:'2026-10-11'}),
 );
 return {version:1,syncedAt:'2026-10-30T00:00:00Z',asOf:'2026-10-30',dateRange:{start:'2025-01-01',end:'2026-10-30'},coverage:{},accounts,transactions,netWorthHistory:[],recurring:[],notes:[]};
}
const cases=[fixture(),fixture(),fixture(),fixture()];
cases[1].transactions.reverse();
cases[2].accounts.push({...cases[2].accounts[0],type:'depository',name:'Duplicate last account'});
cases[2].transactions.push({...cases[2].transactions.find(row=>row.id==='refund-charge'),id:'ambiguous'});
cases[3].accounts.push(account('apple-card','credit'));
cases[3].accounts.at(-1).name='Apple Card';
const overrides={ 'row-1':{review:true},'row-2':{flow:'expense',category:'Explicit'},'row-3':{flow:'review',review:true},'row-4':{note:'Saved source note'},'amazon':{flow:'transfer'} };
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function outputs(api,data){
 const derived=api.deriveDataset(data,overrides);
 return {derived,policy:api.applyIncomePolicy(data,overrides),periods:['month','ytd','year'].map(mode=>api.summarizePeriod(derived,'2026-10',mode)),movements:['month','ytd','year'].map(mode=>api.summarizeMovements(derived,'2026-10',mode))};
}
if(process.argv.includes('--record-current-golden')){console.log(JSON.stringify(cases.map(data=>hash(outputs({deriveDataset,applyIncomePolicy,summarizePeriod,summarizeMovements},data)))));process.exit(0);}
// Synthetic result snapshots are reviewed alongside independent arithmetic,
// correction/source invariants and deterministic scan bounds below.
if(process.argv.includes('--summarize-candidate')){
 console.log(JSON.stringify(cases.map(data=>{const result=outputs({deriveDataset,applyIncomePolicy,summarizePeriod,summarizeMovements},data);return {flows:Object.fromEntries(['income','expense','transfer','review'].map(flow=>[flow,result.derived.transactions.filter(t=>t.flow===flow).length])),periods:result.periods.map(p=>({spending:p.spending,cashIncome:p.cashPayroll,review:p.classificationReviewCount})),movements:result.movements.map(p=>({unique:p.totals.uniqueAmount,review:p.totals.reviewAmount,pending:p.totals.pendingAmount}))};})));process.exit(0);
}
// Reviewed copy-only refresh: exclusion explanations now describe explicit
// choices and optional policies. Reversing those strings reproduced every
// previous snapshot hash; financial values, classifications and evidence agree.
const expected=['dae224e1c0070abd9d5881b0b96949c909358263735c755de0373fb33e46b30f','5cda5f1438e42e9a43c21d6309edc0241b93acd173ae71e3e09f8be59304590e','9eb3c7187f19ebb479b9242742adb783ca6cfbd63fdfa8c4a93fe7ce770ba1bb','6ce8e347c7f0daace97ff57c60c00b0fbec770cbade0cdc44100d1b894562658'];

const api={deriveDataset,applyIncomePolicy,summarizePeriod,summarizeMovements};
for(const [i,data] of cases.entries()){
 const before=JSON.stringify(data),result=outputs(api,data);
 assert.deepEqual(result.periods.map(period=>period.cashPayroll),[0,0,0],'A merchant name cannot convert source transfers to cash income');
 assert.deepEqual(result.periods.map(period=>period.spending),i===2?[138.01,664.08,764.1]:[50.01,488.08,588.1],'Ambiguous refund evidence cannot offset expenses');
 assert.equal(result.derived.transactions.filter(row=>row.flow==='review').length,i===2?37:36);
 assert.equal(hash(result),expected[i],`Complete derivation, explanations and month/YTD/year summaries match reconciliation baseline case ${i}`);assert.equal(JSON.stringify(data),before);
}
// Deterministic scan budget: building once visits N source rows; each eligible
// card repayment uses an indexed lookup. No per-row whole-history traversal.
// Timing and heap deltas are informational process observations (GC may make
// a delta negative); no hardware-dependent timing threshold gates correctness.
const timings=[];
for(const size of [1000,5000,10000]){
 const data=fixture(0);data.transactions=Array.from({length:size},(_,i)=>tx(`scale-${i}`,i%2?{}:{flow:'transfer',review:false,sourceCategoryDetailed:'transfers_credit_card_payment'}));
 const diagnostics={indexedRows:0,supportLookups:0,counterpartCandidatesVisited:0};
 const sourceBytes=Buffer.byteLength(JSON.stringify(data));assert.ok(sourceBytes<=7_500_000);
 const heapBefore=process.memoryUsage().heapUsed,start=performance.now(),context=createMovementClassificationContext(data,undefined,diagnostics);
 const actual=data.transactions.map(row=>classifyKnownMovementWithContext(row,{},context));
 const indexedMilliseconds=Math.round(performance.now()-start),deriveStart=performance.now();
 const derived=deriveDataset(data);assert.equal(derived.transactions.length,size);
 timings.push({rows:size,sourceBytes,indexedMilliseconds,deriveMilliseconds:Math.round(performance.now()-deriveStart),heapDeltaBytes:process.memoryUsage().heapUsed-heapBefore});
 assert.equal(actual.length,size);assert.equal(diagnostics.indexedRows,size);assert.equal(diagnostics.supportLookups,size);assert.equal(diagnostics.counterpartCandidatesVisited,0);
 assert.ok(actual.every(row=>row.movementClassification?.kind==='card_repayment'));
 // Exercise the production entry point too: rebuilding a context for every row
 // would exceed this budget even if the context API itself still passes above.
 let sourceRowReads=0;
 const tracked=new Proxy(data.transactions,{get(target,key,receiver){if(typeof key==='string'&&/^(0|[1-9]\d*)$/.test(key))sourceRowReads++;return Reflect.get(target,key,receiver);}});
 assert.equal(applyIncomePolicy({...data,transactions:tracked}).transactions.length,size);
 assert.ok(sourceRowReads<=3*size,`Policy pass must read source rows at most three times (${sourceRowReads} for ${size})`);
}
// Same-merchant/amount review candidates are counted by bounded date lookups,
// retaining duplicate records as ambiguity, and excluding every self-ID match.
const data=fixture(0),refund=tx('self',{merchant:'Synthetic Item',amount:-88});
data.transactions=[refund,...Array.from({length:5000},(_,i)=>tx(`charge-${i}`,{merchant:'Synthetic Item',amount:88,flow:'expense',review:false})),tx('self',{merchant:'Synthetic Item',amount:88,flow:'expense',review:false})];
assert.match(movementReviewReasonWithContext(refund,createMovementReviewContext(data)),/5000 same-merchant/);
const refreshed={...data,transactions:[refund]};assert.doesNotMatch(movementReviewReasonWithContext(refund,createMovementReviewContext(refreshed)),/same-merchant|Possible merchant refund/);
console.log('Movement index: complete reconciliation snapshots (four synthetic histories, all reporting scopes), duplicate/manual/source invariants, fresh contexts and deterministic scan bounds passed.',JSON.stringify(timings));
// Opt-in capacity observation: run with node --expose-gc and --benchmark. GC
// stabilizes retained-heap deltas; phase samples are not an exact transient peak.
// This is a local synthetic workload, not an HTTP/Workers or storage capacity gate.
if(process.argv.includes('--benchmark')){
 assert.equal(typeof global.gc,'function','Use node --expose-gc for retained-heap observations');
 const samples=[];
 for(const size of [1000,5000,10000]){
  global.gc();const heapBefore=process.memoryUsage().heapUsed,start=performance.now();
  const source=fixture(size),sourceBytes=Buffer.byteLength(JSON.stringify(source));assert.ok(sourceBytes<=7_500_000);
  const derived=deriveDataset(source),index=createDatasetIndex(derived);let sampledPeakHeap=process.memoryUsage().heapUsed;
  const period=summarizePeriod(derived,'2026-10','year');sampledPeakHeap=Math.max(sampledPeakHeap,process.memoryUsage().heapUsed);
  const movements=summarizeMovements(derived,'2026-10','year');sampledPeakHeap=Math.max(sampledPeakHeap,process.memoryUsage().heapUsed);
  const totalMilliseconds=Math.round(performance.now()-start);global.gc();
  samples.push({rows:source.transactions.length,sourceBytes,totalMilliseconds,retainedHeapDeltaBytes:process.memoryUsage().heapUsed-heapBefore,sampledHeapIncreaseBytes:sampledPeakHeap-heapBefore,processPeakRssKiB:process.resourceUsage().maxRSS});
  // Keep source, derived data, indexes and visible summaries alive through the
  // retained sample, like a dashboard holding the current immutable snapshot.
  assert.equal(index.transactionsById.size,new Set(source.transactions.map(row=>row.id)).size);assert.ok(period&&movements);
 }
 console.log('Synthetic mixed-history dashboard capacity observations:',JSON.stringify(samples));
}
