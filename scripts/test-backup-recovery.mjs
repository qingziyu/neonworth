// Actual store logic against isolated SQLite; never production or preview state.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks } from 'node:module';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { datasetSchema, transactionOverridesSchema, validateTransactionOverrides } from '../lib/store-validation.ts';
import { deriveDataset } from '../lib/classification.ts';
registerHooks({resolve(specifier,context,nextResolve){try{return nextResolve(specifier,context);}catch(error){if(error.code==='ERR_MODULE_NOT_FOUND'&&specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier))return nextResolve(specifier+'.ts',context);throw error;}}});

const account=(id,type='depository')=>({id,name:type==='credit'?'Platinum Card®':'Checking',officialName:type==='credit'?'Platinum Card®':null,institution:type==='credit'?'American Express':'Test',type,subtype:type==='credit'?'credit card':'checking',mask:'1234',balance:100,netBalance:100,balanceDate:null,balanceAgeKnown:false,syncStatus:'synced'});
const tx=(id,amount,extra={})=>({id,date:'2026-10-01',merchant:'Merchant',sourceName:'Original source description',accountId:'bank',amount,category:'Shopping',flow:'expense',confidence:'HIGH',exceptional:false,note:'',pending:false,review:false,...extra});
const base={version:1,syncedAt:'2026-10-25T12:00:00Z',asOf:'2026-10-25',dateRange:{start:'2026-01-01',end:'2026-10-25'},coverage:{transactions:{is_complete_for_query:true,freshness:'unknown'},sourceFreshness:'unknown',periods:[]},accounts:[account('bank'),account('card','credit')],transactions:[tx('fee',895,{accountId:'card',merchant:'RENEWAL MEMBERSHIP FEE',sourceName:'Renewal Membership Fee',category:'Other',confidence:'LOW',sourceCategoryDetailed:'other_other'}),tx('purchase',30)],netWorthHistory:[{date:'2026-10-25',value:200,events:[{account_name:'Card',impact:10}]}],recurring:[{stream_id:'service',account_id:'card',flow_type:'outflow',description:'Membership fee',first_date:'2025-01-01T00:00:00Z',last_date:'2026-10-01',predicted_next_date:'2027-10-01',predicted_next_dates:['2027-10-01'],frequency:'ANNUALLY',average_amount:895,last_amount:895,is_active:true,transaction_ids:['older-unavailable-source-id','fee'],personal_finance_category:{primary:'financial',detailed:'financial_other_bank_fees',confidence_level:'HIGH'}}],notes:[]};
const corrections={fee:{category:'Financial & insurance',note:'My saved fee context',review:false},purchase:{category:'Health & personal care',flow:'expense',exceptional:true,note:'Confirmed purchase purpose',review:false}};
assert.ok(datasetSchema.safeParse(base).success,'Actual nullable/missing provider metadata and older recurring source IDs are accepted');
assert.deepEqual(validateTransactionOverrides(corrections,base),corrections);
for(const input of [null,[],{fee:{}},{missing:{note:'unknown row'}},{fee:{amount:1}},{fee:{flow:'income'}},{fee:{category:42}},JSON.parse('{"__proto__":{"note":"bad"}}')])assert.throws(()=>validateTransactionOverrides(input,base));
assert.throws(()=>transactionOverridesSchema.parse({fee:{note:'x'.repeat(5001)}}));
const malformed=[
 {coverage:null},{coverage:[]},{coverage:{transactions:{is_complete_for_query:'yes'}}},
 {recurring:[null]},{recurring:['service']},{recurring:[{transaction_ids:[null]}]},
 {recurring:[{transaction_ids:'fee'}]},{recurring:[{last_amount:'895'}]},
 {recurring:[{last_amount:Infinity}]},{recurring:[{is_active:'true'}]},
 {recurring:[{personal_finance_category:[]} ]},{recurring:[{personal_finance_category:{primary:42}}]},
 {recurring:[{first_date:'2026-02-30'}]},{recurring:[{predicted_next_dates:['not-a-date']}]},
 {accounts:[account('bank'),{...account('card','credit'),officialName:42}]},
 {transactions:[{...base.transactions[0],sourceCategory:42},base.transactions[1]]},
 {transactions:[{...base.transactions[0],categoryReason:{}},base.transactions[1]]},
 {transactions:[{...base.transactions[0],sourceFlow:{}},base.transactions[1]]},
 {transactions:[{...base.transactions[0],classificationOverrides:{amount:0}},base.transactions[1]]},
 {transactions:[{...base.transactions[0],classificationOverrides:{flow:'income'}},base.transactions[1]]},
 {transactions:[{...base.transactions[0],sourceFlow:'income'},base.transactions[1]]},
 {netWorthHistory:[{date:'2026-10-25',value:200,events:[null]}]},
 {netWorthHistory:[{date:'2026-10-25',value:200,events:[{impact:'ten'}]}]},
];
for(const patch of malformed)assert.equal(datasetSchema.safeParse({...base,...patch}).success,false,JSON.stringify(patch));

const sqlite=new DatabaseSync(':memory:');
sqlite.exec('CREATE TABLE finance_records (key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE finance_sync_log (id INTEGER PRIMARY KEY AUTOINCREMENT,imported_at TEXT NOT NULL,as_of TEXT NOT NULL,transaction_count INTEGER NOT NULL,account_count INTEGER NOT NULL);');
let batches=0,beforeBatch=null,failLast=false;
const statement=(sql,args=[])=>({sql,args,bind(...values){return statement(sql,values)},async first(){return sqlite.prepare(sql).get(...args)||null},async all(){return {results:sqlite.prepare(sql).all(...args)}}});
const d1={prepare:sql=>statement(sql),async batch(statements){batches++;if(beforeBatch){const callback=beforeBatch;beforeBatch=null;callback();}sqlite.exec('BEGIN');try{const results=[];for(let index=0;index<statements.length;index++){if(failLast&&index===statements.length-1)throw new Error('Synthetic final-operation failure');const item=statements[index];results.push({success:true,meta:sqlite.prepare(item.sql).run(...item.args)});}sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}finally{failLast=false;}}};
const temp=await mkdtemp(join(tmpdir(),'neonworth-backup-recovery-'));
try {
 globalThis.__neonworthBackupRecoveryEnv={DB:d1};
 const root=fileURLToPath(new URL('../',import.meta.url));
 let source=await readFile(new URL('../lib/store.ts',import.meta.url),'utf8');
 source=source.replace("import { env } from 'cloudflare:workers';","const env = globalThis.__neonworthBackupRecoveryEnv;");
 source=source.replace(/from '(\.\/[^']+)'/g,(_,relative)=>`from '${pathToFileURL(join(root,'lib',relative+'.ts')).href}'`);
 source=source.replace("from 'zod'",`from '${pathToFileURL(join(root,'node_modules/zod/index.js')).href}'`);
 const testModule=join(temp,'store-test.ts');await writeFile(testModule,source);
 const store=await import(pathToFileURL(testModule).href);
 const rows=()=>sqlite.prepare('SELECT * FROM finance_records ORDER BY key').all();
 const logs=()=>sqlite.prepare('SELECT * FROM finance_sync_log ORDER BY id').all();
 const set=(key,value)=>sqlite.prepare('INSERT OR REPLACE INTO finance_records VALUES (?,?,?)').run(key,JSON.stringify(value),'2026-10-25T12:00:00Z');
 // A new datastore must receive the correction map, rather than merely the
 // visible derived category carried inside an exported transaction object.
 const original=JSON.stringify(base),result=await store.saveDataset(base,undefined,undefined,corrections);
 assert.equal(result.transactionCorrections,2);assert.equal(JSON.stringify(base),original);
 let state=await store.readState();assert.deepEqual(state.overrides,corrections);
 assert.deepEqual(state.dataset,base,'Raw source is stored separately from corrections');
 let derived=deriveDataset(state.dataset,state.overrides);assert.equal(derived.transactions.find(t=>t.id==='purchase').category,'Health & personal care');assert.equal(derived.transactions.find(t=>t.id==='purchase').exceptional,true);
 const noOp=batches;assert.equal((await store.saveDataset(base,undefined,undefined,corrections)).unchanged,true);assert.equal(batches,noOp);
 // A routine raw Finances refresh must retain all fields of the restored map.
 const refresh={...base,asOf:'2026-10-26',syncedAt:'2026-10-26T12:00:00Z',dateRange:{...base.dateRange,end:'2026-10-26'},transactions:[...base.transactions,tx('new-charge',40,{date:'2026-10-26'})]};
 await store.saveDataset(refresh);state=await store.readState();assert.deepEqual(state.overrides,corrections);
 derived=deriveDataset(state.dataset,state.overrides);const corrected=derived.transactions.find(t=>t.id==='purchase');
 assert.equal(corrected.category,'Health & personal care');assert.equal(corrected.note,'Confirmed purchase purpose');assert.equal(corrected.exceptional,true);assert.equal(corrected.amount,30);
 assert.equal(state.dataset.transactions.find(t=>t.id==='purchase').category,'Shopping');
 // Source, annotation maps and import log commit or roll back as one operation.
 const snapshot=rows(),beforeLogs=logs();failLast=true;
 await assert.rejects(store.saveDataset({...refresh,syncedAt:'2026-10-26T13:00:00Z',notes:['Must roll back']},undefined,undefined,{fee:{note:'Must roll back'}}),error=>error.code==='STORAGE_FAILURE'&&error.status===500&&error.operation==='snapshot_write'&&!/Synthetic/.test(error.message));
 assert.deepEqual(rows(),snapshot);assert.deepEqual(logs(),beforeLogs);
 // Every invalid runtime-required shape is rejected before any write.
 const beforeInvalid=rows(),invalidLogs=logs(),invalidBatches=batches;
 for(const patch of malformed)await assert.rejects(store.saveDataset({...refresh,...patch,syncedAt:'2026-10-26T14:00:00Z'}));
 await assert.rejects(store.saveDataset(refresh,undefined,undefined,{missing:{note:'Not a source ID'}}));
 await assert.rejects(store.saveDataset(refresh,undefined,undefined,{fee:{flow:'income'}}));
 assert.equal(batches,invalidBatches);assert.deepEqual(rows(),beforeInvalid);assert.deepEqual(logs(),invalidLogs);
 // A sibling edit made after import validation survives the atomic merge.
 beforeBatch=()=>set('overrides',{...corrections,'new-charge':{note:'Concurrent source correction'}});
 await store.saveDataset(refresh,undefined,undefined,{fee:{note:'Restored new note'}});
 state=await store.readState();assert.equal(state.overrides['new-charge'].note,'Concurrent source correction');assert.equal(state.overrides.fee.note,'Restored new note');assert.equal(state.overrides.fee.category,'Financial & insurance');
 // An over-limit concurrent correction cannot make the override row invalid.
 const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).byteLength;
 const note='x'.repeat(5000),makeMap=n=>Object.fromEntries(Array.from({length:n},(_,i)=>[`past-${i}`,{note}]));
 let count=1;while(bytes(makeMap(count+1))<=1_800_000)count++;
 const full=makeMap(count);set('overrides',makeMap(count-1));beforeBatch=()=>set('overrides',full);
 await assert.rejects(store.saveDataset(refresh,undefined,undefined,{fee:{note}}),error=>error.code==='STORAGE_FAILURE'&&error.status===500&&error.operation==='snapshot_write'&&!/UNIQUE|constraint/i.test(error.message));
 assert.deepEqual((await store.readState()).overrides,full,'Concurrent map retained and rejected write rolled back');
 const compactMap=n=>Object.fromEntries(Array.from({length:n},(_,i)=>[`h${i}`,{review:true}]));
 const fullCount=compactMap(50000);assert.ok(bytes(fullCount)<1_800_000);
 set('overrides',compactMap(49999));beforeBatch=()=>set('overrides',fullCount);
 await assert.rejects(store.saveDataset(refresh,undefined,undefined,{fee:{review:false}}),error=>error.code==='STORAGE_FAILURE'&&error.status===500&&error.operation==='snapshot_write'&&!/UNIQUE|constraint/i.test(error.message));
 assert.equal(Object.keys((await store.readState()).overrides).length,50000,'Concurrent 50,000th correction is preserved; attempted 50,001st rolls back');
} finally {delete globalThis.__neonworthBackupRecoveryEnv;sqlite.close();await rm(temp,{recursive:true,force:true});}
console.log('Backup recovery passed: fresh-store corrections survive raw refresh, source/corrections stay separate, atomic rollback and sibling merges, concurrent count/byte bounds, runtime-shape rejection before writes, nullable provider metadata and unavailable older recurring IDs.');
