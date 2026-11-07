// Exercise the real budget route/store against isolated SQLite, never live data.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks } from 'node:module';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
registerHooks({resolve(specifier,context,nextResolve){try{return nextResolve(specifier,context);}catch(error){if(error.code==='ERR_MODULE_NOT_FOUND'&&specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier))return nextResolve(specifier+'.ts',context);throw error;}}});

const fixture={version:1,syncedAt:'2026-10-27T12:00:00Z',asOf:'2026-10-27',dateRange:{start:'2025-10-01',end:'2026-10-27'},coverage:{transactions:{is_complete_for_query:true}},accounts:[{id:'card',name:'Card',institution:'Bank',type:'credit',subtype:'credit card',mask:'1234',balance:100,netBalance:-100,balanceDate:null,balanceAgeKnown:false,syncStatus:'synced'}],transactions:['2026-07-05','2026-08-05','2026-09-05'].map((date,i)=>({id:'rent'+i,date,merchant:'Rent',accountId:'card',amount:3400,category:'Housing',flow:'expense',confidence:'HIGH',exceptional:false,note:'',pending:false,review:false})),netWorthHistory:[],recurring:[],notes:[]};
const sqlite=new DatabaseSync(':memory:');
sqlite.exec('CREATE TABLE finance_records (key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE finance_sync_log (id INTEGER PRIMARY KEY AUTOINCREMENT,imported_at TEXT NOT NULL,as_of TEXT NOT NULL,transaction_count INTEGER NOT NULL,account_count INTEGER NOT NULL);');
let batches=0,beforeBatch=null;
const statement=(sql,args=[])=>({sql,args,bind(...values){return statement(sql,values)},async first(){return sqlite.prepare(sql).get(...args)||null},async all(){return {results:sqlite.prepare(sql).all(...args)}}});
const d1={prepare:sql=>statement(sql),async batch(statements){batches++;if(beforeBatch){const callback=beforeBatch;beforeBatch=null;callback();}sqlite.exec('BEGIN');try{const results=[];for(const item of statements)results.push({success:true,meta:sqlite.prepare(item.sql).run(...item.args)});sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
const temp=await mkdtemp(join(tmpdir(),'neonworth-budget-storage-'));
const root=fileURLToPath(new URL('../',import.meta.url)),fileURL=p=>pathToFileURL(p).href;
const key='budget-plan-v1';
const copy=value=>JSON.parse(JSON.stringify(value));
try {
 globalThis.__neonworthBudgetTestEnv={DB:d1};
 let source=await readFile(new URL('../lib/store.ts',import.meta.url),'utf8');
 source=source.replace("import { env } from 'cloudflare:workers';","const env = globalThis.__neonworthBudgetTestEnv;");
 source=source.replace(/from '(\.\/[^']+)'/g,(_,relative)=>`from '${fileURL(join(root,'lib',relative+'.ts'))}'`);
 source=source.replace("from 'zod'",`from '${fileURL(join(root,'node_modules/zod/index.js'))}'`);
 const storePath=join(temp,'store-test.ts');await writeFile(storePath,source);
 const store=await import(fileURL(storePath));
 let routeSource=await readFile(new URL('../app/api/budget/route.ts',import.meta.url),'utf8');
 routeSource=routeSource.replace("from '@/lib/store'",`from '${fileURL(storePath)}'`).replace(/from '@\/lib\/([^']+)'/g,(_,name)=>`from '${fileURL(join(root,'lib',name+'.ts'))}'`).replace("from 'zod'",`from '${fileURL(join(root,'node_modules/zod/index.js'))}'`);
 const routePath=join(temp,'route-test.ts');await writeFile(routePath,routeSource);
 const route=await import(fileURL(routePath));
 const set=(value)=>sqlite.prepare('INSERT OR REPLACE INTO finance_records VALUES (?,?,?)').run(key,JSON.stringify(value),'2026-10-27T12:00:00Z');
 const post=async(body,origin='https://neonworth.test')=>route.POST(new Request('https://neonworth.test/api/budget',{method:'POST',headers:{'Content-Type':'application/json',origin},body:JSON.stringify(body)}));
 assert.deepEqual(await (await route.GET()).json(),{plan:null});
 assert.equal((await post({action:'initialize'})).status,400,'No initialization without a source snapshot');
 await store.saveDataset(fixture);
 let response=await post({action:'initialize'});assert.equal(response.status,200);const {plan}=await response.json();
 assert.equal(plan.monthlyCap,0);assert.deepEqual(await (await route.GET()).json(),{plan});
 const original=copy(plan),beforeInitialize=batches;
 assert.deepEqual(await (await post({action:'initialize'})).json(),{plan});assert.equal(batches,beforeInitialize,'Repeated initialization must not rebase or rewrite saved targets');
 const monthlyKeys=Object.keys(plan.monthly),annualKeys=Object.keys(plan.annual);
 assert.ok(monthlyKeys.length>1&&annualKeys.length,'Plan includes editable monthly and annual envelopes');
 const changed=copy(plan);changed.monthlyCap=250;changed.monthly[monthlyKeys[0]]=150;changed.monthly[monthlyKeys[1]]=100;changed.annual[annualKeys[0]]+=500;
 response=await post({plan:changed,expectedPlan:original});
 assert.equal(response.status,200);const changedSaved=(await response.json()).plan;assert.deepEqual(changedSaved,changed);assert.deepEqual((await (await route.GET()).json()).plan,changed);
 const stale=await post({plan:original,expectedPlan:original});assert.equal(stale.status,400);assert.match((await stale.json()).error,/changed in another session/);assert.deepEqual((await (await route.GET()).json()).plan,changed,'Stale browser editor cannot overwrite a newer plan');
 assert.equal((await post({plan:changed})).status,400,'Client must supply expected state');
 const baselineRows=sqlite.prepare('SELECT * FROM finance_records ORDER BY key').all(),beforeInvalid=batches;
 for(const invalid of [null,{}, {...changed,monthlyCap:6501}, {...changed,monthly:{...changed.monthly,[monthlyKeys[0]]:-1}}, {...changed,monthly:{...changed.monthly,[monthlyKeys[0]]:changed.monthly[monthlyKeys[0]]+1}}, {...changed,annual:{...changed.annual,[annualKeys[0]]:null}}, {...changed,annual:{...changed.annual,[annualKeys[0]]:Infinity}}, {...changed,annual:{...changed.annual,unexpected:25}}]) {
  assert.equal((await post({plan:invalid,expectedPlan:changed})).status,400);
 }
 assert.equal((await post({plan:changed,expectedPlan:changed},'https://other.test')).status,400,'Cross-origin writes fail');
 assert.equal(batches,beforeInvalid);assert.deepEqual(sqlite.prepare('SELECT * FROM finance_records ORDER BY key').all(),baselineRows,'Invalid plans never modify storage');
 const refreshed={...fixture,asOf:'2026-10-28',dateRange:{...fixture.dateRange,end:'2026-10-28'},syncedAt:'2026-10-28T12:00:00Z'};
 await store.saveDataset(refreshed);assert.deepEqual((await (await route.GET()).json()).plan,changed,'Dataset refresh preserves budget separately');
 assert.deepEqual((await (await post({action:'initialize'})).json()).plan,changed,'New source data does not silently rebase targets');
 const concurrent=copy(changed);concurrent.annual[annualKeys[0]]+=100;
 beforeBatch=()=>set(concurrent);
 await assert.rejects(store.compareAndPutRecord(key,changed,original),store.RecordConflict);
 assert.deepEqual(await store.readRecord(key),concurrent,'Concurrent write survives CAS rollback');
 await assert.rejects(store.compareAndPutRecord(key,changed,original),/changed/i);
 // Effective-year allowances are saved alongside, never instead of, the existing plan.
 const beforeSchedule=copy(concurrent);beforeSchedule.annual.annual_bills=2300;
 assert.equal((await post({plan:beforeSchedule,expectedPlan:concurrent})).status,200);
 const scheduled=copy(beforeSchedule);
 scheduled.annualSchedules={'2027':{annual:{travel:5000,shopping:1000,annual_bills:beforeSchedule.annual.annual_bills,gifts:0,experiences:0,learning:0,occasional_care:1000},clothingOnly:true}};
 response=await post({plan:scheduled,expectedPlan:beforeSchedule});assert.equal(response.status,200);
 assert.deepEqual((await response.json()).plan,scheduled);assert.deepEqual((await (await route.GET()).json()).plan,scheduled);
 assert.deepEqual(scheduled.annual,beforeSchedule.annual,'The 2026 base annual allowances are preserved');
 assert.deepEqual(scheduled.monthly,beforeSchedule.monthly,'Monthly allowances are unchanged');
 const {resolveAnnualPlan}=await import('../lib/budget.ts');
 assert.deepEqual(resolveAnnualPlan(scheduled,2026).annual,beforeSchedule.annual);
 assert.equal(Object.values(resolveAnnualPlan(scheduled,2027).annual).reduce((n,v)=>n+v,0),9300);
 assert.deepEqual(resolveAnnualPlan(scheduled,2028),resolveAnnualPlan(scheduled,2027),'The annual plan continues from 2027 onward');
 const beforeInvalidSchedule=sqlite.prepare('SELECT * FROM finance_records ORDER BY key').all(),scheduleBatches=batches;
 for(const invalidSchedule of [
  {'27':scheduled.annualSchedules['2027']},
  {'2027x':scheduled.annualSchedules['2027']},
  {'2027':{...scheduled.annualSchedules['2027'],annual:{...scheduled.annualSchedules['2027'].annual,unexpected:50}}},
  {'2027':{...scheduled.annualSchedules['2027'],annual:{...scheduled.annualSchedules['2027'].annual,travel:-1}}},
  {'2027':{...scheduled.annualSchedules['2027'],annual:{...scheduled.annualSchedules['2027'].annual,shopping:null}}},
 ]) assert.equal((await post({plan:{...scheduled,annualSchedules:invalidSchedule},expectedPlan:scheduled})).status,400);
 assert.equal(batches,scheduleBatches);assert.deepEqual(sqlite.prepare('SELECT * FROM finance_records ORDER BY key').all(),beforeInvalidSchedule);
 await store.saveDataset({...refreshed,asOf:'2026-10-29',dateRange:{...refreshed.dateRange,end:'2026-10-29'},syncedAt:'2026-10-29T12:00:00Z'});
 assert.deepEqual((await (await route.GET()).json()).plan,scheduled,'Data refresh retains the future annual schedule and current plan');
 assert.deepEqual((await (await post({action:'initialize'})).json()).plan,scheduled,'Initialization cannot overwrite a saved annual schedule');
 const beforeSummary=sqlite.prepare('SELECT * FROM finance_records ORDER BY key').all(),summaryBatches=batches;
 for(const periodMode of ['month','ytd','year']) {
  const summaryResponse=await route.GET(new Request(`https://neonworth.test/api/budget?includeSummary=1&month=2026-09&periodMode=${periodMode}`));
  assert.equal(summaryResponse.status,200);
  const savedSummary=await summaryResponse.json();
  assert.deepEqual(savedSummary.plan,scheduled);
  assert.equal(savedSummary.asOf,'2026-10-29');
  assert.equal(savedSummary.sourceRecordCount,3);
  assert.ok(savedSummary.summary&&savedSummary.commitments['2027']);
 }
 for(const query of ['month=2026-13','month=oops','periodMode=invalid'])assert.equal((await route.GET(new Request(`https://neonworth.test/api/budget?includeSummary=1&${query}`))).status,400);
 assert.equal(batches,summaryBatches);assert.deepEqual(sqlite.prepare('SELECT * FROM finance_records ORDER BY key').all(),beforeSummary,'Summary verification is read-only');
 console.log('Budget persistence passed: initialization once; saved readback; invalid/cross-origin rejection; refresh preservation; stale-editor rejection; concurrent CAS rollback; effective-year annual schedules.');
} finally {delete globalThis.__neonworthBudgetTestEnv;sqlite.close();await rm(temp,{recursive:true,force:true});}
