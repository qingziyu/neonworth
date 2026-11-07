// Real routes/store + transactional SQLite, synthetic records only, no network.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks } from 'node:module';
import { financialReviewFixture } from './test-support/financial-review-fixture.mjs';
import { EMPTY_PLANNING, planningSchema, planningInputSchema } from '../lib/planning.ts';
const copy = value => structuredClone(value);
const sqlite = new DatabaseSync(':memory:');
sqlite.exec('CREATE TABLE finance_records (key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE finance_sync_log (id INTEGER PRIMARY KEY AUTOINCREMENT,imported_at TEXT NOT NULL,as_of TEXT NOT NULL,transaction_count INTEGER NOT NULL,account_count INTEGER NOT NULL);');
let batches = 0, beforeBatch;
const statement = (sql,args=[]) => ({ sql,args,bind(...values){return statement(sql,values)},async first(){return sqlite.prepare(sql).get(...args)||null},async all(){return {results:sqlite.prepare(sql).all(...args)}} });
globalThis.__neonworthPlanningEnv = { DB: { prepare: sql => statement(sql), async batch(statements) {
  batches++; if (beforeBatch) { const callback=beforeBatch;beforeBatch=null;callback(); }
  sqlite.exec('BEGIN'); try { const result=statements.map(item=>({success:true,meta:sqlite.prepare(item.sql).run(...item.args)}));sqlite.exec('COMMIT');return result; } catch(error) { sqlite.exec('ROLLBACK');throw error; }
} } };
const hook=registerHooks({resolve(specifier,context,next){
  if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export const env = globalThis.__neonworthPlanningEnv;',shortCircuit:true};
  if(specifier.startsWith('@/'))return next(new URL('../'+specifier.slice(2)+'.ts',import.meta.url).href,context);
  return next(specifier,context);
}});
const set=(key,value)=>sqlite.prepare('INSERT OR REPLACE INTO finance_records VALUES (?,?,?)').run(key,JSON.stringify(value),'2026-10-29T00:30:00Z');
const rows=()=>sqlite.prepare('SELECT * FROM finance_records ORDER BY key').all();
const otherRows=()=>rows().filter(row=>row.key!=='planning-v1');
try {
  const route=await import('../app/api/planning/route.ts'),store=await import('../lib/store.ts');
  const request=(body,origin='https://neonworth.test')=>new Request('https://neonworth.test/api/planning',{method:'POST',headers:{'Content-Type':'application/json',origin},body:typeof body==='string'?body:JSON.stringify(body)});
  const post=(plan,expectedPlan,origin)=>route.POST(request({plan,expectedPlan},origin));
  let response=await route.GET(); assert.equal(response.status,200);assert.deepEqual(await response.json(),{plan:null});assert.equal(batches,0);assert.deepEqual(rows(),[],'Reading absent planning must not initialize storage');
  assert.match(response.headers.get('cache-control'),/private/);assert.match(response.headers.get('cache-control'),/no-store/);
  response=await post(EMPTY_PLANNING,null);assert.equal(response.status,200,'Unset goals can be saved without source data');assert.deepEqual((await response.json()).plan,EMPTY_PLANNING);
  const fixture=financialReviewFixture();
  // Membership rejection depends on explicit money-movement treatment, not a provider brand.
  Object.assign(fixture.dataset.transactions.find(row=>row.id==='zelle'),{flow:'transfer',category:'Transfer'});
  await store.saveDataset(fixture.dataset);
  for(const [key,value] of Object.entries({'budget-plan-v1':fixture.budget,overrides:fixture.overrides,settings:fixture.settings,'retirement-overrides':fixture.retirementOverrides,'review-preferences':fixture.reviewPreferences,'refresh-status':fixture.refresh}))set(key,value);
  const protectedRows=otherRows();
  response=await post(fixture.planning,EMPTY_PLANNING);assert.equal(response.status,200);assert.deepEqual((await response.json()).plan,fixture.planning);assert.deepEqual(otherRows(),protectedRows,'Planning-only save cannot mutate source/corrections/budget/refresh/settings');
  assert.deepEqual((await (await route.GET()).json()).plan,fixture.planning,'Reload returns exact saved goals and event membership');
  assert.equal((await post(EMPTY_PLANNING,EMPTY_PLANNING)).status,409,'Stale editor cannot overwrite goals or events');
  const futureFire=copy(fixture.planning);Object.assign(futureFire.goals.fire,{targetDate:'2046-06-15',annualContribution:120000,realReturnPct:0});
  response=await post(futureFire,fixture.planning);assert.equal(response.status,200,'Future FIRE dates and explicit zero-return projections save through the real route');
  assert.deepEqual((await (await route.GET()).json()).plan,futureFire);assert.deepEqual(otherRows(),protectedRows);
  assert.equal((await post(fixture.planning,fixture.planning)).status,409,'A stale FIRE editor cannot overwrite the saved future target');
  assert.equal((await post(fixture.planning,futureFire)).status,200,'Legacy FIRE shape remains writable and can remove optional projection inputs');
  const beforeInvalid=rows(),invalidBatches=batches;
  for(const plan of [null,{}, {...fixture.planning,unexpected:true}, {...fixture.planning,version:2}, {...fixture.planning,goals:{...fixture.planning.goals,extra:1}}, {...fixture.planning,goals:{...fixture.planning.goals,savings:{year:2026,targetAmount:-1,basis:'cash'}}}, {...fixture.planning,goals:{...fixture.planning.goals,netWorth:{targetAmount:5,targetDate:'2027-02-29'}}}, {...fixture.planning,goals:{...fixture.planning.goals,fire:{...fixture.planning.goals.fire,valuationDate:'2199-01-01'}}}, {...fixture.planning,events:[...fixture.planning.events,...fixture.planning.events]}, {...fixture.planning,events:[{id:'empty',name:'empty',transactionIds:[]}]}, {...fixture.planning,events:[{id:'bad',name:'x',transactionIds:['__proto__']}]}, {...fixture.planning,events:[{id:'two',name:'two',transactionIds:['event-a','event-a']}]}, {...fixture.planning,events:[{id:'one',name:'one',transactionIds:['event-a']},{id:'two',name:'two',transactionIds:['event-a']}]}, {...fixture.planning,events:[{id:'many',name:'many',transactionIds:Array.from({length:501},(_,i)=>'tx'+i)}]}, {...fixture.planning,events:Array.from({length:101},(_,i)=>({id:'event'+i,name:'event',transactionIds:['tx'+i]}))}]) {
    assert.equal((await post(plan,fixture.planning)).status,400,'Invalid planning is rejected before mutation');
  }
  for(const id of ['missing','rent-06','periodic-fee','pending','zelle','transfer'])assert.equal((await post({...fixture.planning,events:[{id:'new',name:'New event',transactionIds:[id]}]},fixture.planning)).status,400,'New event membership must be eligible in canonical data');
  for(const raw of ['{"plan":{"__proto__":{}},"expectedPlan":null}','{"plan":null,"expectedPlan":null,"constructor":{}}'])assert.equal((await route.POST(request(raw))).status,400);
  assert.throws(()=>planningInputSchema.parse(JSON.parse('{"plan":{"prototype":{}},"expectedPlan":null}')));
  assert.equal((await route.POST(request({plan:fixture.planning}))).status,400);
  assert.equal((await post(fixture.planning,fixture.planning,'https://other.test')).status,400);
  const oversized=new Request('https://neonworth.test/api/planning',{method:'POST',headers:{origin:'https://neonworth.test','content-type':'application/json'},body:' '.repeat(8_000_001)});
  assert.equal((await route.POST(oversized)).status,400,'Streaming body limit applies without Content-Length');
  assert.equal(batches,invalidBatches);assert.deepEqual(rows(),beforeInvalid);
  assert.ok(planningSchema.safeParse({...EMPTY_PLANNING,goals:{...EMPTY_PLANNING.goals,netWorth:{targetAmount:0,targetDate:'2026-12-31'}}}).success,'Explicit zero target is different from unset');
  for(const targetAmount of [0.001,1.999,Number.MAX_SAFE_INTEGER,Infinity])assert.equal(planningSchema.safeParse({...EMPTY_PLANNING,goals:{...EMPTY_PLANNING.goals,netWorth:{targetAmount,targetDate:'2026-12-31'}}}).success,false,'Targets require finite supported cents');
  for(const withdrawalRatePct of [1e-300,Number.MIN_VALUE])assert.equal(planningSchema.safeParse({...fixture.planning,goals:{...fixture.planning.goals,fire:{...fixture.planning.goals.fire,withdrawalRatePct}}}).success,false,'FIRE scenario cannot overflow finite safe cents');
  // Refresh makes one event member disappear: preserve its annotation and allow
  // an unrelated goal/label save, but re-check explicitly edited membership.
  const refreshed=copy(fixture.dataset);refreshed.transactions=refreshed.transactions.filter(row=>row.id!=='event-credit');refreshed.syncedAt='2026-10-29T01:30:00Z';await store.saveDataset(refreshed);
  assert.deepEqual((await (await route.GET()).json()).plan,fixture.planning,'Refresh must preserve planning');
  const retained=copy(fixture.planning);retained.goals.savings.targetAmount+=100;retained.events[0].name='Renamed event';retained.events[0].transactionIds.reverse();
  assert.equal((await post(retained,fixture.planning)).status,200,'Unchanged membership survives source disappearance and reordering');
  const edited=copy(retained);edited.events[0].transactionIds.push('large-purchase');
  assert.equal((await post(edited,retained)).status,400,'Edited membership requires all selected records currently eligible');
  const corrected=copy(retained);corrected.events[0].transactionIds=corrected.events[0].transactionIds.filter(id=>id!=='event-credit');
  assert.equal((await post(corrected,retained)).status,200,'User may explicitly repair an orphan group');
  // Exercise transaction races, not merely the initial expected-plan check.
  const concurrent=copy(corrected);concurrent.goals.savings.targetAmount+=20;
  beforeBatch=()=>set('planning-v1',concurrent);
  assert.equal((await post(EMPTY_PLANNING,corrected)).status,409);assert.deepEqual(await store.readRecord('planning-v1'),concurrent,'Concurrent plan update survives rollback');
  const add=copy(concurrent);add.events.push({id:'equipment',name:'Equipment',transactionIds:['large-purchase']});
  beforeBatch=()=>set('overrides',{'large-purchase':{category:'Housing'}});
  assert.equal((await post(add,concurrent)).status,409);assert.deepEqual(await store.readRecord('planning-v1'),concurrent,'Source correction race aborts planning write atomically');
  set('overrides',{});
  beforeBatch=()=>sqlite.prepare('DELETE FROM finance_records WHERE key=?').run('budget-plan-v1');
  assert.equal((await post(add,concurrent)).status,409);assert.deepEqual(await store.readRecord('planning-v1'),concurrent,'Concurrent source deletion also aborts guarded write');
  set('budget-plan-v1',fixture.budget);
  const backup=JSON.parse(JSON.stringify(concurrent));assert.equal((await post(EMPTY_PLANNING,concurrent)).status,200,'Explicit reset is possible');
  assert.equal((await post(backup,EMPTY_PLANNING)).status,200,'Planning-only backup roundtrip uses the same eligibility/schema/CAS path');
  assert.deepEqual((await (await route.GET()).json()).plan,backup);
  const beforeOutage=rows();beforeBatch=()=>{throw new Error('Synthetic database unavailable; internal details must not escape');};
  response=await post(EMPTY_PLANNING,backup);assert.equal(response.status,500,'A storage outage must not pretend another editor changed planning');
  const outage=await response.json();assert.match(outage.error,/could not confirm.*Reload saved data/);assert.equal(outage.code,'STORAGE_FAILURE');assert.doesNotMatch(outage.error,/another session|Synthetic|internal details/);assert.deepEqual(rows(),beforeOutage);
  const importRoute=await import('../app/api/import/route.ts');
  const independentKeys=['planning-v1','budget-plan-v1','settings','refresh-status'];
  const independentBefore=rows().filter(row=>independentKeys.includes(row.key));
  const imported=copy(refreshed);imported.syncedAt='2026-10-29T02:30:00Z';
  response=await importRoute.POST(new Request('https://neonworth.test/api/import',{method:'POST',headers:{origin:'https://neonworth.test','content-type':'application/json'},body:JSON.stringify({dataset:imported,retirementOverrides:fixture.retirementOverrides,reviewPreferences:fixture.reviewPreferences,transactionOverrides:fixture.overrides})}));
  assert.equal(response.status,200);assert.deepEqual(rows().filter(row=>independentKeys.includes(row.key)),independentBefore,'The actual dataset backup import route preserves planning, budget, legacy settings and refresh records byte-for-byte');
  console.log('Planning storage passed: read-only absence, strict bounds/keys, source eligibility, durable refresh/orphan annotations, whole-record CAS, atomic source races, private response, and backup/reset roundtrip.');
} finally {hook.deregister();delete globalThis.__neonworthPlanningEnv;sqlite.close();}
