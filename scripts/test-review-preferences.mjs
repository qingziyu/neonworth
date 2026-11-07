// Synthetic preferences and an isolated SQLite D1 adapter; no production data.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks } from 'node:module';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { emptyReviewPreferences, reviewPreferencesSchema, validateReviewPreference, validateReviewPreferences, mergeReviewPreferences } from '../lib/review-preferences.ts';
registerHooks({resolve(specifier,context,nextResolve){try{return nextResolve(specifier,context);}catch(error){if(error.code==='ERR_MODULE_NOT_FOUND'&&specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier))return nextResolve(specifier+'.ts',context);throw error;}}});
const {deriveDataset}=await import('../lib/classification.ts');
const {summarizeRecurring}=await import('../lib/recurring.ts');
const now='2026-10-26T12:00:00Z';
const account={id:'bank',name:'Checking',institution:'Test',type:'depository',subtype:'checking',mask:'1234',balance:0,netBalance:0,balanceDate:null,balanceAgeKnown:false,syncStatus:'synced'};
const tx=(id,date)=>({id,date,merchant:'OpenAI',sourceName:'OpenAI',sourceCategoryDetailed:'services_software',accountId:'bank',amount:20,category:'Subscriptions',flow:'expense',confidence:'HIGH',exceptional:false,note:'',pending:false,review:false});
const base={version:1,syncedAt:'2026-10-25T12:00:00Z',asOf:'2026-10-25',dateRange:{start:'2026-01-01',end:'2026-10-25'},coverage:{},accounts:[account],transactions:[tx('aug','2026-08-01'),tx('sep','2026-09-01'),tx('oct','2026-10-01')],netWorthHistory:[],recurring:[],notes:[]};
const groupId=summarizeRecurring(deriveDataset(base),{start:base.dateRange.start,end:base.asOf}).groups.find(g=>g.name==='OpenAI').id;
const ids=new Set([groupId]),findingId=`service:${groupId}`;
const reviewed=(evidenceKey='evidence:v1',updatedAt=now)=>({state:'reviewed',evidenceKey,updatedAt});
assert.deepEqual(reviewPreferencesSchema.parse({}),emptyReviewPreferences());
const marked=validateReviewPreference({type:'review-resolution',id:findingId,state:'reviewed',evidenceKey:'evidence:v1'},base,ids,now);
assert.deepEqual(marked.patch,{findingResolutions:{[findingId]:reviewed()}});
assert.deepEqual(validateReviewPreference({type:'review-resolution',id:findingId,state:'open'},base,ids,now).patch,{findingResolutions:{[findingId]:null}});
assert.deepEqual(validateReviewPreference({type:'recurring-status',id:groupId,status:'detected'},base,ids,now).patch,{recurringStatuses:{[groupId]:null}});
for(const input of [
 {type:'review-resolution',id:findingId,state:'reviewed'},
 {type:'review-resolution',id:findingId,state:'reviewed',evidenceKey:''},
 {type:'review-resolution',id:'<script>alert(1)</script>',state:'open'},
 {type:'review-resolution',id:'x'.repeat(301),state:'open'},
 {type:'review-resolution',id:'similar:'+('x'.repeat(994)),state:'open'},
 {type:'review-resolution',id:'__proto__',state:'open'},
 {type:'review-resolution',id:findingId,state:'reviewed',evidenceKey:'ok',updatedAt:now},
 {type:'recurring-status',id:groupId,status:'ongoing'},
 {type:'recurring-status',id:'x'.repeat(301),status:'detected'},
 {type:'recurring-status',id:'unknown',status:'ongoing',effectiveDate:'2026-10-25'},
 {type:'recurring-status',id:groupId,status:'stopped',effectiveDate:'2026-02-30'},
 {type:'recurring-status',id:groupId,status:'stopped',effectiveDate:'2026-10-26'},
 {type:'recurring-status',id:groupId,status:'detected',effectiveDate:'2026-10-26'},
])assert.throws(()=>validateReviewPreference(input,base,ids,now));
assert.throws(()=>validateReviewPreference({type:'review-resolution',id:findingId,state:'open'},null,ids,now));
assert.ok(validateReviewPreference({type:'review-resolution',id:'similar:'+('x'.repeat(990)),state:'open'},base,ids,now));
const restored={findingResolutions:{[findingId]:reviewed()},recurringStatuses:{[groupId]:{status:'stopped',effectiveDate:'2026-10-25',updatedAt:now}}};
assert.deepEqual(validateReviewPreferences(restored,base,ids,now),restored,'review timestamp may follow the financial snapshot');
assert.throws(()=>validateReviewPreferences({...restored,findingResolutions:{[findingId]:reviewed('v2','2026-10-27T00:00:00Z')}},base,ids,now),/future/);
assert.throws(()=>validateReviewPreferences({...restored,recurringStatuses:{[groupId]:{...restored.recurringStatuses[groupId],effectiveDate:'2026-10-26'}}},base,ids,now),/reporting date/);
assert.throws(()=>validateReviewPreferences({...restored,recurringStatuses:{fake:restored.recurringStatuses[groupId]}},base,ids,now),/not found/);
assert.throws(()=>reviewPreferencesSchema.parse({findingResolutions:JSON.parse('{"__proto__":{"state":"reviewed","evidenceKey":"x","updatedAt":"2026-10-26T12:00:00Z"}}')}));
const overCount={findingResolutions:Object.fromEntries(Array.from({length:2001},(_,i)=>[`finding:${i}`,reviewed()])),recurringStatuses:{}};
assert.throws(()=>reviewPreferencesSchema.parse(overCount),/Too many/);
const overBytes={findingResolutions:Object.fromEntries(Array.from({length:1000},(_,i)=>[`similar:${i}:${'x'.repeat(900)}`,reviewed('y'.repeat(1000))])),recurringStatuses:{}};
assert.throws(()=>reviewPreferencesSchema.parse(overBytes),/supported size/);
assert.deepEqual(mergeReviewPreferences(restored,{findingResolutions:{[findingId]:null}}),{findingResolutions:{},recurringStatuses:restored.recurringStatuses});

const sqlite=new DatabaseSync(':memory:');
sqlite.exec('CREATE TABLE finance_records (key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE finance_sync_log (id INTEGER PRIMARY KEY AUTOINCREMENT,imported_at TEXT NOT NULL,as_of TEXT NOT NULL,transaction_count INTEGER NOT NULL,account_count INTEGER NOT NULL);');
let batches=0,beforeBatch=null,failLast=false,trace=null;
// When `trace` is set, each single-row read records when it starts and when its (delayed) result returns.
const statement=(sql,args=[])=>({sql,args,bind(...values){return statement(sql,values)},async first(){if(trace){const key=String(args[0]);trace.push(`start:${key}`);await new Promise(resolve=>setTimeout(resolve,2));trace.push(`end:${key}`);}return sqlite.prepare(sql).get(...args)||null},async all(){return {results:sqlite.prepare(sql).all(...args)}}});
const d1={prepare:sql=>statement(sql),async batch(statements){batches++;if(beforeBatch){const callback=beforeBatch;beforeBatch=null;callback();}sqlite.exec('BEGIN');try{const results=[];for(let index=0;index<statements.length;index++){if(failLast&&index===statements.length-1)throw new Error('Synthetic final-operation failure');const item=statements[index];results.push({success:true,meta:sqlite.prepare(item.sql).run(...item.args)});}sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}finally{failLast=false;}}};
const temp=await mkdtemp(join(tmpdir(),'neonworth-review-prefs-'));
try {
 globalThis.__neonworthReviewPreferenceEnv={DB:d1};
 const root=fileURLToPath(new URL('../',import.meta.url));
 let source=await readFile(new URL('../lib/store.ts',import.meta.url),'utf8');
 source=source.replace("import { env } from 'cloudflare:workers';","const env = globalThis.__neonworthReviewPreferenceEnv;");
 source=source.replace(/from '(\.\/[^']+)'/g,(_,relative)=>`from '${pathToFileURL(join(root,'lib',relative+'.ts')).href}'`);
 source=source.replace("from 'zod'",`from '${pathToFileURL(join(root,'node_modules/zod/index.js')).href}'`);
 const testModule=join(temp,'store-test.ts');await writeFile(testModule,source);
 const store=await import(pathToFileURL(testModule).href);
 const set=(key,value)=>sqlite.prepare('INSERT OR REPLACE INTO finance_records VALUES (?,?,?)').run(key,JSON.stringify(value),now);
 const get=key=>{const row=sqlite.prepare('SELECT value FROM finance_records WHERE key=?').get(key);return row?JSON.parse(row.value):null};
 set('dataset',base);set('settings',{savingsTarget:35});set('overrides',{oct:{note:'Saved correction'}});set('retirement-overrides',{});
 assert.deepEqual((await store.readState()).reviewPreferences,emptyReviewPreferences());
 // readState schedules all six independent record reads before any of them returns (refresh-status included).
 {
  set('refresh-status',{state:'idle',synthetic:true});
  trace=[];const state=await store.readState();const events=trace;trace=null;
  const firstEnd=events.findIndex(event=>event.startsWith('end:'));
  for(const key of ['dataset','overrides','settings','retirement-overrides','review-preferences','refresh-status']){const started=events.indexOf(`start:${key}`);assert.ok(started>=0&&started<firstEnd,`${key} read starts in the same parallel batch (${events.join(',')})`);}
  assert.deepEqual(state.refresh,{state:'idle',synthetic:true},'refresh-status decoded unchanged');
  sqlite.prepare("DELETE FROM finance_records WHERE key='refresh-status'").run();
  assert.equal((await store.readState()).refresh,null,'missing refresh-status keeps its null default');
 }
 // Either reset may be the first preference operation. Tombstones must be
 // applied on INSERT as well as UPDATE, leaving a readable empty preference row.
 for(const reset of [{type:'review-resolution',id:findingId,state:'open'},{type:'recurring-status',id:groupId,status:'detected'}]) {
   sqlite.prepare("DELETE FROM finance_records WHERE key='review-preferences'").run();
   const before=await store.readState(),sourceRows=sqlite.prepare("SELECT * FROM finance_records WHERE key<>'review-preferences' ORDER BY key").all();
   const cleared=await store.updatePreference(reset),after=await store.readState();
   assert.deepEqual(cleared.reviewPreferences,emptyReviewPreferences());assert.deepEqual(after.reviewPreferences,emptyReviewPreferences());
   assert.ok(!JSON.stringify(get('review-preferences')).includes('null'),'first reset never persists null tombstones');
   assert.deepEqual({...after,reviewPreferences:undefined},{...before,reviewPreferences:undefined},'first reset preserves source fields, corrections and settings');
   assert.deepEqual(sqlite.prepare("SELECT * FROM finance_records WHERE key<>'review-preferences' ORDER BY key").all(),sourceRows,'first reset writes only its separate preference record');
 }
 let result=await store.updatePreference({type:'review-resolution',id:findingId,state:'reviewed',evidenceKey:'fingerprint:original'});
 assert.equal(result.reviewPreferences.findingResolutions[findingId].evidenceKey,'fingerprint:original');
 assert.ok(Number.isFinite(Date.parse(result.reviewPreferences.findingResolutions[findingId].updatedAt)));
 result=await store.updatePreference({type:'recurring-status',id:groupId,status:'stopped',effectiveDate:'2026-09-15'});
 assert.equal(result.reviewPreferences.recurringStatuses[groupId].status,'stopped');assert.ok(result.reviewPreferences.findingResolutions[findingId]);
 result=await store.updatePreference({type:'recurring-status',id:groupId,status:'ongoing',effectiveDate:'2026-10-01'});
 assert.equal(result.reviewPreferences.recurringStatuses[groupId].status,'ongoing');assert.equal(result.reviewPreferences.recurringStatuses[groupId].effectiveDate,'2026-10-01');assert.ok(result.reviewPreferences.findingResolutions[findingId]);
 // Durable saved review → fresh readState → the same client derivation shows the saved decisions.
 {
  const reloaded=await store.readState();
  const model=deriveDataset(reloaded.dataset,reloaded.overrides,reloaded.reviewPreferences);
  const group=summarizeRecurring(model,{start:base.dateRange.start,end:base.asOf}).groups.find(g=>g.id===groupId);
  assert.equal(group.statusSource,'user-confirmed');assert.equal(group.status,'ongoing');assert.equal(group.statusEffectiveDate,'2026-10-01');
  assert.equal(model.reviewPreferences.findingResolutions[findingId].evidenceKey,'fingerprint:original','acknowledged review check survives a reload');
  assert.equal(reloaded.overrides.oct.note,'Saved correction','review writes leave transaction corrections untouched');
  // Attaching preferences to an existing derivation is equivalent to re-deriving (the page reuses its derived base).
  const reused={...deriveDataset(reloaded.dataset,reloaded.overrides),reviewPreferences:reloaded.reviewPreferences};
  assert.deepEqual(reused,model,'preference-only updates need no full re-derivation');
 }
 await store.updatePreference({type:'review-resolution',id:'cash-funding',state:'reviewed',evidenceKey:'cash:v1'});
 result=await store.updatePreference({type:'review-resolution',id:findingId,state:'open'});
 assert.equal(Object.hasOwn(get('review-preferences').findingResolutions,findingId),false,'JSON null deletes only the selected finding');assert.ok(result.reviewPreferences.findingResolutions['cash-funding']);assert.ok(result.reviewPreferences.recurringStatuses[groupId]);
 result=await store.updatePreference({type:'recurring-status',id:groupId,status:'detected'});
 assert.equal(Object.hasOwn(get('review-preferences').recurringStatuses,groupId),false);assert.ok(result.reviewPreferences.findingResolutions['cash-funding']);
 const beforeInvalid=sqlite.prepare('SELECT * FROM finance_records ORDER BY key').all();
 await assert.rejects(store.updatePreference({type:'recurring-status',id:'fake',status:'ongoing',effectiveDate:'2026-10-25'}),/not found/);
 await assert.rejects(store.updatePreference({type:'recurring-status',id:groupId,status:'ongoing',effectiveDate:'2026-10-26'}),/reporting date/);
 assert.deepEqual(sqlite.prepare('SELECT * FROM finance_records ORDER BY key').all(),beforeInvalid);
 // A sibling preference arriving after validation is preserved by atomic json_patch.
 beforeBatch=()=>{const p=get('review-preferences');p.findingResolutions.concurrent=reviewed('concurrent','2026-10-25T12:00:00Z');set('review-preferences',p)};
 await store.updatePreference({type:'review-resolution',id:findingId,state:'reviewed',evidenceKey:'fingerprint:new'});
 assert.ok((await store.readState()).reviewPreferences.findingResolutions.concurrent);assert.equal((await store.readState()).reviewPreferences.findingResolutions[findingId].evidenceKey,'fingerprint:new');
 const past='2026-10-25T12:00:00Z',backupPrefs={findingResolutions:{restored:reviewed('restored',past)},recurringStatuses:{[groupId]:{status:'ongoing',effectiveDate:'2026-08-01',updatedAt:past}}};
 const small={...base,syncedAt:'2026-10-25T13:00:00Z',notes:['Imported source update'],reviewPreferences:{findingResolutions:{forged:reviewed('forged',past)},recurringStatuses:{}}};
 const beforeImport=batches;await store.saveDataset(small,undefined,backupPrefs);assert.equal(batches,beforeImport+1,'source and preferences restore in one transaction');
 const saved=await store.readState();assert.equal(saved.dataset.reviewPreferences,undefined);assert.equal(saved.reviewPreferences.findingResolutions.forged,undefined);assert.ok(saved.reviewPreferences.findingResolutions.restored);assert.ok(saved.reviewPreferences.findingResolutions.concurrent);assert.equal(saved.reviewPreferences.recurringStatuses[groupId].status,'ongoing');
 assert.equal(saved.settings.savingsTarget,35);assert.equal(saved.overrides.oct.note,'Saved correction');assert.deepEqual(saved.retirementOverrides,{});
 const stablePreferences=structuredClone(saved.reviewPreferences),snapshot=sqlite.prepare('SELECT * FROM finance_records ORDER BY key').all();
 failLast=true;await assert.rejects(store.saveDataset({...small,syncedAt:'2026-10-25T14:00:00Z',notes:['Must roll back']},undefined,{findingResolutions:{failed:reviewed('failed',past)},recurringStatuses:{}}),error=>error.code==='STORAGE_FAILURE'&&error.status===500&&error.operation==='snapshot_write'&&!/Synthetic/.test(error.message));
 assert.deepEqual(sqlite.prepare('SELECT * FROM finance_records ORDER BY key').all(),snapshot,'failed preference merge rolls the source import back too');
 const large={...base,syncedAt:'2026-10-25T15:00:00Z',largePayload:'x'.repeat(2_100_000)};
 await store.saveDataset(large);assert.equal(get('dataset').kind,'versionedneonworthchunks');assert.deepEqual((await store.readState()).reviewPreferences,stablePreferences);
 const backToSmall={...base,syncedAt:'2026-10-25T16:00:00Z'};await store.saveDataset(backToSmall);assert.equal(get('dataset').kind,undefined);assert.deepEqual((await store.readState()).reviewPreferences,stablePreferences);
 const noOp=batches;assert.equal((await store.saveDataset(backToSmall,undefined,stablePreferences)).unchanged,true);assert.equal(batches,noOp);
 const beforeBadImport=sqlite.prepare('SELECT * FROM finance_records ORDER BY key').all();
 await assert.rejects(store.saveDataset({...base,syncedAt:'2026-10-25T17:00:00Z'},undefined,{findingResolutions:{},recurringStatuses:{[groupId]:{status:'stopped',effectiveDate:'2026-02-30',updatedAt:past}}}));
 assert.deepEqual(sqlite.prepare('SELECT * FROM finance_records ORDER BY key').all(),beforeBadImport);
 // A count-limit race cannot bypass the guard or lose the concurrently added row.
 const almostFull={findingResolutions:Object.fromEntries(Array.from({length:1999},(_,i)=>[`limit:${i}`,reviewed('v1',past)])),recurringStatuses:{}};set('review-preferences',almostFull);
 beforeBatch=()=>set('review-preferences',{findingResolutions:{...almostFull.findingResolutions,'limit:concurrent':reviewed('v1',past)},recurringStatuses:{}});
 await assert.rejects(store.updatePreference({type:'review-resolution',id:'limit:attempted',state:'reviewed',evidenceKey:'v1'}),error=>error.code==='STORAGE_FAILURE'&&error.status===500&&error.operation==='preference_write'&&!/UNIQUE|constraint/i.test(error.message));
 assert.equal(Object.keys(get('review-preferences').findingResolutions).length,2000);assert.equal(get('review-preferences').findingResolutions['limit:attempted'],undefined);assert.ok(get('review-preferences').findingResolutions['limit:concurrent']);
 // The UTF-8 byte cap also holds when the record grows between validation and write.
 const byteId=i=>`similar:byte:${String(i).padStart(4,'0')}:${'x'.repeat(900)}`,largeRow=reviewed('y'.repeat(1000),past);
 const bytePreferences=n=>({findingResolutions:Object.fromEntries(Array.from({length:n},(_,i)=>[byteId(i),largeRow])),recurringStatuses:{}});
 const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).byteLength;
 let low=0,high=1000;while(low<high){const middle=Math.ceil((low+high)/2);if(bytes(bytePreferences(middle))<=1_800_000)low=middle;else high=middle-1;}
 const fullBytes=bytePreferences(low),almostBytes=bytePreferences(low-1);assert.ok(bytes(fullBytes)<=1_800_000);assert.ok(bytes(bytePreferences(low+1))>1_800_000);
 set('review-preferences',almostBytes);beforeBatch=()=>set('review-preferences',fullBytes);
 await assert.rejects(store.updatePreference({type:'review-resolution',id:byteId(low),state:'reviewed',evidenceKey:'y'.repeat(1000)}),error=>error.code==='STORAGE_FAILURE'&&error.status===500&&error.operation==='preference_write'&&!/UNIQUE|constraint/i.test(error.message));
 assert.equal(Object.keys(get('review-preferences').findingResolutions).length,low);assert.equal(get('review-preferences').findingResolutions[byteId(low)],undefined);assert.ok(bytes(get('review-preferences'))<=1_800_000);
} finally {delete globalThis.__neonworthReviewPreferenceEnv;sqlite.close();await rm(temp,{recursive:true,force:true});}
console.log('Review preferences passed: validated dates/IDs/fingerprints, server timestamps, first-write and existing-row resets, persistence, sibling concurrency, count/byte bounds, atomic backup restore/rollback, source-field isolation and chunk/single snapshot preservation.');
