import assert from 'node:assert/strict';
import { createDatasetIndex, createDatasetLookup } from '../lib/dataset-index.ts';

const first={id:'card',name:'First source account'},duplicate={id:'card',name:'Duplicate'};
const transactions=Array.from({length:20_000},(_,index)=>({
 id:`row-${index}`,date:`${2000+index%25}-${String(index%12+1).padStart(2,'0')}-${String(index%28+1).padStart(2,'0')}`,
 category:`Category ${index%8}`,accountId:'card',amount:index/100,
}));
transactions.splice(40,0,{...transactions[9],date:'2024-02-29'});
const data={accounts:[first,duplicate],transactions},before=JSON.stringify(data),index=createDatasetIndex(data);
assert.equal(index.accountsById.get('card'),first,'First match retains Array.find semantics');
assert.equal(index.transactionsById.get('row-9'),transactions[9]);
const lookup=createDatasetLookup(data);
assert.deepEqual(lookup.accountsById,index.accountsById);assert.deepEqual(lookup.transactionsById,index.transactionsById);
assert.deepEqual(index.categoryNames,[...new Set(transactions.map(row=>row.category))].sort());
for(const [start,end] of [['2024-02-01','2024-02-29'],['2004-12-01','2006-01-10'],['2020-01-01','2019-01-01'],['1900-01-01','2199-12-31'],['2024-02-29','2024-02-29']]){
 const expected=transactions.filter(row=>row.date>=start&&row.date<=end),actual=index.transactionsInRange(start,end);
 assert.deepEqual(actual,expected,'Range keeps inclusive dates, duplicates and source order');
 actual.forEach((row,i)=>assert.equal(row,expected[i],'Index returns original rows'));
 actual.reverse();assert.deepEqual(index.transactionsInRange(start,end),expected,'A consumer sort cannot mutate the index');
}
assert.equal(JSON.stringify(data),before,'Index construction/queries do not change source');
data.transactions=[...transactions,{...transactions[0],id:'fresh',date:'2026-10-30'}];
const fresh=createDatasetIndex(data);assert.equal(fresh.transactionsById.has('fresh'),true);assert.equal(index.transactionsById.has('fresh'),false,'No global identity cache or leakage between snapshots');
console.log('Dataset index: 20,001 synthetic records preserve first-match lookups, duplicates, source order, exact date bounds and input immutability.');
