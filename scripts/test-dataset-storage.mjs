// Uses synthetic data and an isolated SQLite-backed D1 adapter; no network or preview data.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks } from 'node:module';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MAX_RECORD_BYTES, MAX_DATASET_BYTES, DATASET_CHUNK_CODE_UNITS, MAX_DATASET_CHUNKS, DATASET_STORAGE_KIND, assertRecordSize, assertDatasetSize, datasetChunkKeys, parseDatasetRecord, packDataset, unpackDataset } from '../lib/dataset-storage.ts';

// Existing application modules use bundler-style extensionless TS imports.
registerHooks({resolve(specifier,context,nextResolve){try{return nextResolve(specifier,context);}catch(error){if(error.code==='ERR_MODULE_NOT_FOUND'&&specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier))return nextResolve(specifier+'.ts',context);throw error;}}});

const revision='11111111-2222-4333-8444-555555555555';
const base={version:1,syncedAt:'2026-10-25T12:00:00Z',asOf:'2026-10-25',dateRange:{start:'2025-10-01',end:'2026-10-25'},coverage:{},accounts:[{id:'bank',name:'Checking',institution:'Test',type:'depository',subtype:'checking',mask:'1234',balance:0,netBalance:0,balanceDate:null,balanceAgeKnown:false,syncStatus:'synced'},{id:'plan',name:'Work 401(k)',institution:'Test',type:'investment',subtype:'401k',mask:'5678',balance:100,netBalance:100,balanceDate:null,balanceAgeKnown:false,syncStatus:'synced'}],transactions:[{id:'posted',date:'2026-10-01',merchant:'Shop',accountId:'bank',amount:20,category:'Shopping',flow:'expense',confidence:'HIGH',exceptional:false,note:'',pending:false,review:false}],netWorthHistory:[],recurring:[],notes:[],retirementEvidence:{version:1,scope:{start:'2025-10-01',end:'2026-10-25',sourceReadAt:null,isCompleteForQuery:null,freshness:'unknown',description:'Synthetic test'},accountScopes:[{accountId:'plan',firstRecordDate:'2026-10-01',lastRecordDate:'2026-10-01',recordCount:1,coverageComplete:null,freshness:'unknown'}],records:[{id:'contribution',accountId:'plan',date:'2026-10-01',description:'Employee contribution',amount:-100,type:'cash',subtype:'contribution',currency:'USD'}],notes:[]}};
const encodeLength=value=>new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value)).byteLength;
assert.deepEqual(await unpackDataset(parseDatasetRecord(JSON.stringify(base))),base,'legacy dataset round trip');
assert.equal(datasetChunkKeys(base),null);
const textPrefix=JSON.stringify({...base,text:''}).indexOf('"text":"')+'"text":"'.length;
const unicode={...base,text:'x'.repeat(DATASET_CHUNK_CODE_UNITS-textPrefix-1)+'😀'+String.raw`\"`+'\n\t\r'+'猫'.repeat(100000)};
const packed=await packDataset(unicode,revision);
const parts=new Map(packed.records.map(row=>[row.key,row.value]));
assert.deepEqual(await unpackDataset(packed.manifest,parts),unicode,'Unicode, escapes and a split surrogate pair round trip');
assert.ok(JSON.parse(packed.records[0].value).charCodeAt(DATASET_CHUNK_CODE_UNITS-1)>=0xd800);
assert.ok(packed.records.every(row=>encodeLength(row.value)<=MAX_RECORD_BYTES));
assert.equal(packed.manifest.utf8Bytes,encodeLength(JSON.stringify(unicode)));
assert.deepEqual(await packDataset(unicode,revision),packed,'deterministic packing for fixed content/revision');
assert.equal((await packDataset(unicode,'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')).manifest.sha256,packed.manifest.sha256);
const missing=new Map(parts);missing.delete(packed.manifest.keys.at(-1));
await assert.rejects(unpackDataset(packed.manifest,missing),/incomplete or corrupt/);
const sameLength=new Map(parts);const first=packed.records[0];sameLength.set(first.key,first.value.replace('"x','"y'));
// Change one same-length character in the serialized payload; integrity must not rely on length alone.
const firstText=JSON.parse(first.value),position=firstText.indexOf('xxx');sameLength.set(first.key,JSON.stringify(firstText.slice(0,position)+'y'+firstText.slice(position+1)));
await assert.rejects(unpackDataset(packed.manifest,sameLength),/incomplete or corrupt/);
const malformed=new Map(parts);malformed.set(first.key,'{}');await assert.rejects(unpackDataset(packed.manifest,malformed),/incomplete or corrupt/);
assert.throws(()=>datasetChunkKeys({...packed.manifest,keys:['settings',...packed.manifest.keys.slice(1)]}),/incomplete or corrupt/);
assert.throws(()=>datasetChunkKeys({...packed.manifest,keys:[...packed.manifest.keys].reverse()}),/incomplete or corrupt/);
assert.throws(()=>datasetChunkKeys({...packed.manifest,version:2}),/incomplete or corrupt/);
assert.throws(()=>datasetChunkKeys({...packed.manifest,keys:Array(MAX_DATASET_CHUNKS+1).fill('dataset:chunk:x:0')}),/incomplete or corrupt/);
assert.throws(()=>datasetChunkKeys({...packed.manifest,codeUnits:0}),/incomplete or corrupt/);
assert.throws(()=>parseDatasetRecord('{bad JSON'),/incomplete or corrupt/);
assert.throws(()=>assertRecordSize({text:'x'.repeat(MAX_RECORD_BYTES)}),/record exceeds/);
assert.throws(()=>assertRecordSize({text:'界'.repeat(610000)}),/record exceeds/);
assert.throws(()=>assertDatasetSize({...base,text:'x'.repeat(MAX_DATASET_BYTES)}),/7.5 MB/);
await assert.rejects(packDataset({...base,text:'x'.repeat(MAX_DATASET_BYTES)},revision),/7.5 MB/);
assert.throws(()=>datasetChunkKeys({...packed.manifest,utf8Bytes:MAX_DATASET_BYTES+1}),/incomplete or corrupt/);

// Exercise actual store.ts logic without touching a browser, production data, or the preview DB.
const sqlite=new DatabaseSync(':memory:');
sqlite.exec('CREATE TABLE finance_records (key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE finance_sync_log (id INTEGER PRIMARY KEY AUTOINCREMENT,imported_at TEXT NOT NULL,as_of TEXT NOT NULL,transaction_count INTEGER NOT NULL,account_count INTEGER NOT NULL);');
let batches=0,failAfter=-1,beforeBatch=null;
const statement=(sql,args=[])=>({sql,args,bind(...values){return statement(sql,values)},async first(){return sqlite.prepare(sql).get(...args)||null},async all(){return {results:sqlite.prepare(sql).all(...args)}}});
const d1={prepare:sql=>statement(sql),async batch(statements){batches++;if(beforeBatch){const callback=beforeBatch;beforeBatch=null;callback();}sqlite.exec('BEGIN');try{const results=[];for(let index=0;index<statements.length;index++){if(index===failAfter)throw new Error('Synthetic failed batch');const item=statements[index];results.push({success:true,meta:sqlite.prepare(item.sql).run(...item.args)});}sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}finally{failAfter=-1;}}};
const temp=await mkdtemp(join(tmpdir(),'neonworth-storage-test-'));
try {
  globalThis.__neonworthChunkTestEnv={DB:d1};
  const root=fileURLToPath(new URL('../',import.meta.url));
  let source=await readFile(new URL('../lib/store.ts',import.meta.url),'utf8');
  source=source.replace("import { env } from 'cloudflare:workers';","const env = globalThis.__neonworthChunkTestEnv;");
  source=source.replace(/from '(\.\/[^']+)'/g,(_,relative)=>`from '${pathToFileURL(join(root,'lib',relative+'.ts')).href}'`);
  // zod remains a package import: resolve it through this checkout rather than a temporary directory.
  source=source.replace("from 'zod'",`from '${pathToFileURL(join(root,'node_modules/zod/index.js')).href}'`);
  const testModule=join(temp,'store-test.ts');await writeFile(testModule,source);
  const store=await import(pathToFileURL(testModule).href);
  const set=(key,value)=>sqlite.prepare('INSERT OR REPLACE INTO finance_records VALUES (?,?,?)').run(key,JSON.stringify(value),'2026-10-25T12:00:00Z');
  const get=key=>JSON.parse(sqlite.prepare('SELECT value FROM finance_records WHERE key=?').get(key).value);
  const chunkCount=()=>Number(sqlite.prepare("SELECT count(*) n FROM finance_records WHERE key GLOB 'dataset:chunk:*'").get().n);
  set('dataset',base);set('settings',{savingsTarget:35});set('overrides',{posted:{note:'Saved personal correction'}});set('retirement-overrides',{});
  assert.deepEqual((await store.readState()).dataset,base,'store reads legacy row');
  assert.equal((await store.saveDataset(base)).unchanged,true);assert.equal(batches,0,'identical legacy snapshot writes nothing');
  const small={...base,syncedAt:'2026-10-25T12:01:00Z',notes:['Small update']};
  await store.saveDataset(small);assert.equal(get('dataset').kind,undefined);assert.equal(chunkCount(),0);
  const large={...small,syncedAt:'2026-10-25T13:00:00Z',extraPayload:'a'.repeat(2_100_000)};
  const restored={contribution:{taxTreatment:'unknown',contributor:'unknown',note:'Synthetic statement tag'}};
  const initialBatches=batches;await store.saveDataset(large,restored);assert.equal(batches,initialBatches+1,'dataset and annotations share one transaction');
  assert.equal(get('dataset').kind,DATASET_STORAGE_KIND);assert.ok(chunkCount()>1);assert.deepEqual((await store.readState()).dataset,large);assert.deepEqual((await store.readState()).retirementOverrides,restored);
  const afterLarge=batches;assert.equal((await store.saveDataset(large)).unchanged,true);assert.equal(batches,afterLarge,'identical chunked snapshot writes nothing');
  await store.updatePreference({type:'transaction',id:'posted',patch:{note:'Correction after chunking'}});await store.updatePreference({type:'settings',patch:{savingsTarget:40}});
  assert.equal((await store.readState()).overrides.posted.note,'Correction after chunking');assert.equal((await store.readState()).settings.savingsTarget,40);
  const snapshot=sqlite.prepare('SELECT * FROM finance_records ORDER BY key').all(),logCount=()=>Number(sqlite.prepare('SELECT count(*) n FROM finance_sync_log').get().n),beforeFailureLog=logCount();
  failAfter=3;await assert.rejects(store.saveDataset({...large,syncedAt:'2026-10-25T14:00:00Z',extraPayload:'b'.repeat(2_100_000)},{contribution:{note:'Must roll back'}}),error=>error.code==='STORAGE_FAILURE'&&error.status===500&&error.operation==='snapshot_write');
  assert.deepEqual(sqlite.prepare('SELECT * FROM finance_records ORDER BY key').all(),snapshot,'failed batch rolls back chunks, pointer and annotations');assert.equal(logCount(),beforeFailureLog);
  const activeManifest=get('dataset'),corruptKey=activeManifest.keys[0],originalChunk=sqlite.prepare('SELECT value FROM finance_records WHERE key=?').get(corruptKey).value;
  sqlite.prepare('DELETE FROM finance_records WHERE key=?').run(corruptKey);await assert.rejects(store.readState(),error=>error.code==='STORAGE_FAILURE'&&error.status===500&&error.operation==='dataset_decode');sqlite.prepare('INSERT INTO finance_records VALUES (?,?,?)').run(corruptKey,originalChunk,'2026-10-25T13:00:00Z');
  const backToSmall={...base,syncedAt:'2026-10-25T15:00:00Z',notes:['Back to small']};await store.saveDataset(backToSmall);
  assert.equal(get('dataset').kind,undefined);assert.equal(chunkCount(),0,'small update removes obsolete revisions');assert.deepEqual((await store.readState()).retirementOverrides,restored);assert.equal((await store.readState()).settings.savingsTarget,40);
  const beforeStale=batches;await assert.rejects(store.saveDataset(large),/older than/);assert.equal(batches,beforeStale);
  const concurrent={...backToSmall,syncedAt:'2026-10-25T17:00:00Z',notes:['Concurrent newer writer']};beforeBatch=()=>set('dataset',concurrent);
  await assert.rejects(store.saveDataset({...large,syncedAt:'2026-10-25T16:00:00Z'}),/changed during this update/);assert.deepEqual((await store.readState()).dataset,concurrent);assert.equal(chunkCount(),0,'stale concurrent writer leaves no abandoned chunks');
} finally {delete globalThis.__neonworthChunkTestEnv;sqlite.close();await rm(temp,{recursive:true,force:true});}
console.log('Dataset storage passed: legacy/chunked round trips, Unicode/integrity/limits, idempotence, atomic rollback, annotations, cleanup and concurrent-write guard.');
