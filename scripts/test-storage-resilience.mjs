import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks } from 'node:module';
import { readWithStorageRetry, storageErrorCategory, StorageFailure } from '../lib/storage-errors.ts';
import { financialReviewFixture } from './test-support/financial-review-fixture.mjs';
import { packDataset } from '../lib/dataset-storage.ts';
import { secureResponse } from '../lib/security-headers.ts';
import { EMPTY_PLANNING } from '../lib/planning.ts';

const privateError='D1_ERROR: Network connection lost. SELECT value FROM finance_records; private merchant $98765; private-token';
const observedOpaqueError='D1_ERROR: internal error';
const logs=[],delays=[];
const options={log:entry=>logs.push(entry),sleep:async ms=>delays.push(ms),random:()=>0.5,reference:()=> 'synthetic-reference'};
let calls=0;
assert.equal(await readWithStorageRetry('record_read',async()=>{if(++calls===1)throw new Error(privateError);return 'recovered'},options),'recovered');
assert.equal(calls,2);assert.deepEqual(delays,[150]);assert.equal(logs[0].outcome,'recovered_after_retry');
calls=0;delays.length=0;logs.length=0;
await assert.rejects(()=>readWithStorageRetry('dataset_chunks_read',async()=>{calls++;throw new Error(privateError)},options),error=>error instanceof StorageFailure&&error.status===503&&error.reference==='synthetic-reference');
assert.equal(calls,2);assert.deepEqual(delays,[150]);assert.equal(logs.length,1);
assert.doesNotMatch(JSON.stringify(logs),/SELECT|finance_records|merchant|98765|private-token|D1_ERROR/);
calls=0;delays.length=0;
await assert.rejects(()=>readWithStorageRetry('record_read',async()=>{calls++;throw new Error(observedOpaqueError)},options),error=>error.status===503);
assert.equal(calls,1,'The exact observed opaque error is unavailable but never automatically retried');assert.equal(delays.length,0);
for(const message of ['D1_ERROR: no such table: private_table','D1_TYPE_ERROR: private value','D1_ERROR: D1 DB is overloaded. Too many requests queued.','D1_ERROR: Your account has exceeded its free tier daily row read limit.']){
  calls=0;delays.length=0;
  await assert.rejects(()=>readWithStorageRetry('record_read',async()=>{calls++;throw new Error(message)},options),error=>error.status===500);
  assert.equal(calls,1);assert.equal(delays.length,0,'Permanent or load/resource errors must not amplify retries');
}
assert.equal(storageErrorCategory(new Error('D1_ERROR',{cause:new Error('Network connection lost.')})),'transient');
await assert.rejects(()=>readWithStorageRetry('preference_write',async()=>{throw new Error('must not run')},options),/explicit read/);

// Real routes + store against synthetic SQLite. Faults occur at the D1 read
// boundary, so routing, storage wrapping and error-response behavior are tested.
const sqlite=new DatabaseSync(':memory:');
sqlite.exec('CREATE TABLE finance_records (key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE finance_sync_log (id INTEGER PRIMARY KEY AUTOINCREMENT,imported_at TEXT NOT NULL,as_of TEXT NOT NULL,transaction_count INTEGER NOT NULL,account_count INTEGER NOT NULL);');
const fixture=financialReviewFixture();
for(const [key,value]of Object.entries({dataset:fixture.dataset,overrides:{},settings:fixture.settings,'retirement-overrides':{},'review-preferences':fixture.reviewPreferences,'refresh-status':null,'budget-plan-v1':fixture.budget}))sqlite.prepare('INSERT INTO finance_records VALUES (?,?,?)').run(key,JSON.stringify(value),'2026-10-29T00:00:00Z');
let fault=null,batches=0,batchFault=null,loseAcknowledgment=false;const reads=new Map();
const countRead=key=>{reads.set(key,(reads.get(key)||0)+1);if(fault?.key===key&&(fault.persistent||reads.get(key)===1))throw new Error(fault.message)};
const statement=(sql,args=[])=>({sql,args,bind(...next){return statement(sql,next)},async first(){countRead(args[0]);return sqlite.prepare(sql).get(...args)||null},async all(){countRead('chunks');return {results:sqlite.prepare(sql).all(...args)}}});
globalThis.__neonworthResilienceEnv={DB:{prepare:sql=>statement(sql),async batch(statements){batches++;if(batchFault)throw new Error(batchFault);sqlite.exec('BEGIN');try{const results=statements.map(row=>({success:true,meta:sqlite.prepare(row.sql).run(...row.args)}));sqlite.exec('COMMIT');if(loseAcknowledgment){loseAcknowledgment=false;throw new Error(privateError)}return results}catch(error){try{sqlite.exec('ROLLBACK')}catch{/* Commit may already be durable. */}throw error}}}};
const hook=registerHooks({resolve(specifier,context,next){if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export const env=globalThis.__neonworthResilienceEnv;',shortCircuit:true};if(specifier.startsWith('@/'))return next(new URL('../'+specifier.slice(2)+'.ts',import.meta.url).href,context);return next(specifier,context)}});
const originalConsoleError=console.error;console.error=entry=>logs.push(entry);
const rows=()=>sqlite.prepare('SELECT * FROM finance_records ORDER BY key').all();
try{
  const store=await import('../lib/store.ts');
  const endpoints=[['data','dataset'],['status','dataset'],['budget','budget-plan-v1'],['refresh','dataset'],['planning','planning-v1']];
  const before=rows();
  for(const [name,key]of endpoints){
    const route=await import(`../app/api/${name}/route.ts`);
    fault={key,message:privateError,persistent:false};reads.clear();
    let response=await route.GET(new Request(`https://neonworth.test/api/${name}`));
    assert.equal(response.status,200,`${name} recovers from one transient read error`);assert.equal(reads.get(key),2);assert.ok(await response.json());
    fault={key,message:privateError,persistent:true};reads.clear();
    response=await route.GET(new Request(`https://neonworth.test/api/${name}`));
    assert.equal(response.status,503,`${name} reports persistent storage unavailability`);assert.equal(reads.get(key),2);
    assert.equal(response.headers.get('retry-after'),'2');assert.match(response.headers.get('cache-control'),/private, no-store/);
    const body=await response.json();assert.equal(body.code,'STORAGE_UNAVAILABLE');assert.match(body.reference,/^[\da-f-]{36}$/);
    assert.doesNotMatch(JSON.stringify(body),/SELECT|finance_records|merchant|98765|private-token|D1_ERROR/);
    fault={key,message:observedOpaqueError,persistent:true};reads.clear();
    response=secureResponse(await route.GET(new Request(`https://neonworth.test/api/${name}`)),"default-src 'none'",'https://neonworth.test');
    assert.equal(response.status,503);assert.equal(reads.get(key),1);assert.equal(response.headers.get('retry-after'),'2');assert.match(response.headers.get('cache-control'),/private, no-store/);
  }
  fault={key:'budget-plan-v1',message:'D1_ERROR: no such table: private_table',persistent:true};reads.clear();
  const budget=await import('../app/api/budget/route.ts');const failed=await budget.GET();
  assert.equal(failed.status,500);assert.equal(reads.get('budget-plan-v1'),1);assert.equal(failed.headers.get('retry-after'),null);assert.doesNotMatch(await failed.text(),/private_table/);
  assert.equal(batches,0);assert.deepEqual(rows(),before,'Reads and read failures never initialize or mutate storage');
  const mcp=await import('../app/mcp/route.ts');
  const rpc=(name,args={})=>mcp.POST(new Request('https://neonworth.test/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:7,method:'tools/call',params:{name,arguments:args}})}));
  fault={key:'dataset',message:observedOpaqueError,persistent:true};reads.clear();
  let mcpResponse=await rpc('get_dashboard_status'),payload=await mcpResponse.json();
  assert.equal(mcpResponse.status,200);assert.equal(mcpResponse.headers.get('retry-after'),null);assert.equal(payload.result.isError,true);assert.equal(reads.get('dataset'),1);
  assert.equal(JSON.parse(payload.result.content[0].text).code,'STORAGE_UNAVAILABLE');assert.doesNotMatch(JSON.stringify(payload),/D1_ERROR|internal error/);
  fault=null;batchFault=privateError;
  const previousBatches=batches;
  await assert.rejects(()=>store.updatePreference({type:'settings',patch:{savingsTarget:20}}),error=>error instanceof StorageFailure&&/Reload saved data/.test(error.message));
  assert.equal(batches,previousBatches+1,'Preference writes never retry even on recognized transient errors');
  await assert.rejects(()=>store.compareAndPutRecord('test',null,{synthetic:true}),StorageFailure);
  assert.equal(batches,previousBatches+2,'CAS batches never retry');assert.deepEqual(rows(),before);
  mcpResponse=await rpc('begin_finance_refresh');payload=await mcpResponse.json();
  assert.equal(mcpResponse.status,200);assert.equal(mcpResponse.headers.get('retry-after'),null);assert.equal(payload.result.isError,true);
  assert.match(JSON.parse(payload.result.content[0].text).error,/could not confirm.*Reload saved data/);assert.equal(batches,previousBatches+3);assert.deepEqual(rows(),before);
  const preferences=await import('../app/api/preferences/route.ts');
  const post=await preferences.POST(new Request('https://neonworth.test/api/preferences',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'settings',patch:{savingsTarget:20}})}));
  assert.equal(post.status,503);assert.equal(post.headers.get('retry-after'),null,'Failed REST mutations must not advertise an automatic retry');assert.match((await post.json()).error,/could not confirm.*Reload saved data/);assert.equal(batches,previousBatches+4);assert.deepEqual(rows(),before);
  batchFault=null;
  loseAcknowledgment=true;const savedBatches=batches;
  const uncertain=await preferences.POST(new Request('https://neonworth.test/api/preferences',{method:'POST',body:JSON.stringify({type:'settings',patch:{savingsTarget:19}})}));
  assert.equal(uncertain.status,503);assert.equal(uncertain.headers.get('retry-after'),null,'A potentially durable write must not invite a transport retry');assert.match((await uncertain.json()).error,/could not confirm.*Reload saved data/);assert.equal(batches,savedBatches+1,'A lost write response never replays its batch');
  assert.equal(JSON.parse(sqlite.prepare("SELECT value FROM finance_records WHERE key='settings'").get().value).savingsTarget,19,'The change may be durable despite a failed response');
  assert.equal(store.errorResponse(new store.RecordConflict('Reload the latest saved state.')).status,409);
  assert.equal(store.errorResponse(new Error('Cross-origin writes are not allowed.')).status,400);
  const invalid=await preferences.POST(new Request('https://neonworth.test/api/preferences',{method:'POST',body:JSON.stringify({type:'settings',patch:{savingsTarget:-1}})}));assert.equal(invalid.status,400,'Invalid client input remains a client error');
  sqlite.prepare("UPDATE finance_records SET value=? WHERE key='budget-plan-v1'").run('private merchant $98765 invalid JSON');
  const decodeError=await budget.GET();assert.equal(decodeError.status,500);assert.doesNotMatch(await decodeError.text(),/merchant|98765/);
  const data=await import('../app/api/data/route.ts');
  const put=(key,value)=>sqlite.prepare('INSERT OR REPLACE INTO finance_records VALUES(?,?,?)').run(key,JSON.stringify(value),'2026-10-29T00:00:00Z');
  put('planning-v1',{version:1,'private-token':'private merchant'});
  const planning=await import('../app/api/planning/route.ts');
  for(const response of [await planning.GET(),await planning.POST(new Request('https://neonworth.test/api/planning',{method:'POST',body:JSON.stringify({plan:EMPTY_PLANNING,expectedPlan:null})}))]){
    assert.equal(response.status,500,'Invalid stored planning is not an invalid client request');assert.doesNotMatch(await response.text(),/merchant|private-token/);
  }
  for(const value of [false,{findingResolutions:{'private-token':{state:'private merchant'}}}]){
    put('review-preferences',value);const response=await data.GET();assert.equal(response.status,500,'Invalid saved preferences cannot look like bad client input or empty state');assert.doesNotMatch(await response.text(),/merchant|private-token/);
  }
  put('review-preferences',fixture.reviewPreferences);
  put('dataset',{kind:'versionedneonworthchunks',keys:['private-token']});assert.equal((await data.GET()).status,500,'A malformed saved manifest is a storage error');
  const packed=await packDataset(fixture.dataset);put('dataset',packed.manifest);for(const record of packed.records)sqlite.prepare('INSERT OR REPLACE INTO finance_records VALUES(?,?,?)').run(record.key,record.value,'2026-10-29T00:00:00Z');
  fault={key:'chunks',message:privateError,persistent:false};reads.clear();assert.equal((await data.GET()).status,200);assert.equal(reads.get('chunks'),2,'The actual chunk SELECT gets exactly one bounded retry');
  fault=null;sqlite.prepare('UPDATE finance_records SET value=? WHERE key=?').run('"private merchant malformed chunk"',packed.records[0].key);
  const chunkFailure=await data.GET();assert.equal(chunkFailure.status,500);assert.doesNotMatch(await chunkFailure.text(),/merchant|chunk/);
  assert.doesNotMatch(JSON.stringify(logs),/SELECT|finance_records|merchant|98765|private-token|private_table|D1_ERROR/,'Only fixed operation/category/reference metadata can reach logs');
  console.log('Storage resilience: documented SELECT retry only; opaque outage no retry; API/MCP privacy, stored corruption500, preserved cache/retry headers, unchanged records, validation/CAS semantics and no mutation retries verified.');
}finally{console.error=originalConsoleError;hook.deregister();delete globalThis.__neonworthResilienceEnv;sqlite.close()}
