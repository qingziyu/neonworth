// Synthetic canonical report models only; no browser storage or finance I/O.
import assert from 'node:assert/strict';
import './test-support/register.mjs';
import {financialReviewFixture} from './test-support/financial-review-fixture.mjs';
import {deriveDataset} from '../lib/classification.ts';
import {summarizePeriod} from '../lib/finance.ts';
import {resolvePeriod} from '../lib/periods.ts';
import {netWorthForPeriod} from '../lib/net-worth.ts';
import {createReportModelCache} from '../lib/report-model-cache.ts';

const data=deriveDataset(financialReviewFixture().dataset),original=structuredClone(data);
const period=resolvePeriod(data,'2026-10','month');
const models=createReportModelCache(),counts={summary:0,netWorth:0,ledger:0};
const summary=()=>{counts.summary++;return summarizePeriod(data,'2026-10','month');};
const netWorth=()=>{counts.netWorth++;return netWorthForPeriod(data,period);};
const ledger=()=>{counts.ledger++;return data.transactions.filter(row=>!row.pending).sort((a,b)=>b.date.localeCompare(a.date));};
const results={
 summary:models.summary(['2026-10','month',false],summary),
 netWorth:models.netWorth([period,false],netWorth),
 ledger:models.ledger([data.transactions,false],ledger),
};
assert.deepEqual(results.summary,summarizePeriod(data,'2026-10','month'));
assert.deepEqual(results.netWorth,netWorthForPeriod(data,period));
assert.deepEqual(results.ledger,ledger());counts.ledger--;
assert.ok(results.ledger.every(row=>data.transactions.includes(row)),'Canonical ledger rows retain source identities');
// Navigation away performs no lookup. The next active lookup reuses exactly
// the retained canonical object, not a reconstructed or partial report.
assert.equal(models.summary(['2026-10','month',false],summary),results.summary);
assert.equal(models.netWorth([period,false],netWorth),results.netWorth);
assert.equal(models.ledger([data.transactions,false],ledger),results.ledger);
assert.deepEqual(counts,{summary:1,netWorth:1,ledger:1});
const routine=models.summary(['2026-10','month',true],()=>summarizePeriod(data,'2026-10','month',true));
assert.deepEqual(routine,summarizePeriod(data,'2026-10','month',true));
assert.equal(models.summary(['2026-10','month',false],summary),results.summary,'Full and routine summaries coexist');
const allHistory=models.netWorth([period,true],()=>netWorthForPeriod(data,period,true));
assert.deepEqual(allHistory,netWorthForPeriod(data,period,true));
assert.equal(models.netWorth([period,false],netWorth),results.netWorth,'Selected and all-history observations coexist');

for(const [name,capacity,calculate] of [['summary',2,summary],['netWorth',2,netWorth],['ledger',1,ledger]]){
 const cache=createReportModelCache()[name],values=[];
 for(let i=0;i<capacity;i++)values.push(cache([i],calculate));
 assert.throws(()=>cache(['failed'],()=>{throw new Error('synthetic calculation failed');}),/synthetic calculation failed/);
 for(let i=0;i<capacity;i++)assert.equal(cache([i],()=>assert.fail('A failed calculation evicted a successful model')),values[i]);
 // Touch the oldest entry: successful use determines eviction order.
 assert.equal(cache([0],calculate),values[0]);
 cache(['new'],calculate);
 if(capacity===2)assert.equal(cache([0],()=>assert.fail('Most recently used model was evicted')),values[0]);
 const evicted=capacity===1?0:1;
 assert.notEqual(cache([evicted],calculate),values[evicted],`${name} retains at most ${capacity} model(s)`);
}

const identityCache=createReportModelCache();
assert.notEqual(identityCache.netWorth([{...period},false],netWorth),identityCache.netWorth([{...period},false],netWorth),'Equal-content object keys do not alias different identities');
const key=[period,false],retained=identityCache.netWorth(key,netWorth);
key[1]=true;
assert.equal(identityCache.netWorth([period,false],()=>assert.fail('Caller mutation changed a retained key')),retained);
assert.notEqual(identityCache.netWorth([period],netWorth),retained,'Different key arities cannot alias');
const otherHome=createReportModelCache();
assert.notEqual(otherHome.summary(['2026-10','month',false],summary),results.summary,'Separate Home factories never share model state');
// The page creates a fresh factory when its immutable data identity changes.
// Confirm that a corrected source cannot inherit the previous model.
const changed=structuredClone(data),expense=changed.transactions.find(row=>row.flow==='expense'&&!row.pending&&row.date.startsWith('2026-10'));
assert.ok(expense);expense.amount+=17;
const refreshed=createReportModelCache().summary(['2026-10','month',false],()=>summarizePeriod(changed,'2026-10','month'));
assert.deepEqual(refreshed,summarizePeriod(changed,'2026-10','month'));
assert.notEqual(refreshed.spending,results.summary.spending);
assert.deepEqual(data,original,'Caching never mutates financial inputs');
console.log('Report model cache: exact canonical results, bounded LRU retention, warm reuse, identity keys, failure preservation, isolated instances and corrected-source refresh passed.');
