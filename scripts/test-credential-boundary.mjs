// Only synthetic canaries: no credentials, live requests or private records.
import assert from 'node:assert/strict';
import { FINANCE_CONFIG } from '../lib/finance-config.ts';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import './test-support/register.mjs';
import { assertCredentialFree, CredentialInputError, CREDENTIAL_INPUT_MESSAGE, CREDENTIAL_INPUT_LIMITS } from '../lib/credential-boundary.ts';
import { EMPTY_PLANNING } from '../lib/planning.ts';

const canary='SYNTHETIC_REJECTED_CONTENT_DO_NOT_ECHO';
const errorCheck=error=>{
 assert.ok(error instanceof CredentialInputError);
 assert.equal(error.message,CREDENTIAL_INPUT_MESSAGE);
 assert.equal(error.code,'UNSAFE_CREDENTIAL_INPUT');
 assert.equal(JSON.stringify(error).includes(canary),false);
 return true;
};
const safe={providerMetadata:{account_id:'opaque-account-4901',request_id:'request-4281',next_cursor:'synthetic-opaque-cursor',progressToken:'progress-1',nextPageToken:'page-2',hash:'abcdef0123456789',confidence_level:'HIGH',details:{nullable:null,active:true,amount:-120.5}},notes:['Password reset fee','A bearer bond is a financial instrument.','{"progressToken":"progress-1","nextPageToken":"page-2"}'],url:'https://quotes.example.test/prices?ticker=EXMPL&date=2026-11-01#evidence',help:'https://help.example.test/faq#password',omitted:undefined};
const before=JSON.stringify(safe);assertCredentialFree(safe);assert.equal(JSON.stringify(safe),before,'Allowed source metadata is not modified');
const shared={evidence:'retained'};assertCredentialFree({first:shared,second:shared});assertCredentialFree(Object.assign(Object.create(null),{source:'retained'}));
for(const key of ['password','access_token','refresh-token','API_KEY','clientSecret','private_key','credentials','Authorization','oai-sites-authorization','x-api-key','plaidAccessToken','brokerage_access_token','providerRefreshToken','plaid_secret','db_password','api_token','github_token','stripe_secret_key','aws_secret_access_key','Ｓｅｃｒｅｔ'])assert.throws(()=>assertCredentialFree({source:[{[key]:canary}]}),errorCheck);
const credentialText=[
 `https://reader:${canary}@source.example.test/data`,
 `1.https://reader:${canary}@source.example.test/data`,
 `https://proxy.example.test/?next=https://reader:${canary}@source.example.test/data`,
 `https://reader:${canary}@source.example.test:PORT/data`,
 `https://${canary}@source.example.test/data`,
 `https://source.example.test/data?access%5Ftoken=${canary}`,
 `https://source.example.test/data#access_token=${canary}`,
 `https://source.example.test/#/result?brokerage_refresh_token=${canary}`,
 `Read https://source.example.test?X-Amz-Signature=${canary} for evidence.`,
 `Authorization: Basic ${canary}`,
 `Bearer ${canary}`,
 `api_key=${canary}`,
 `password: ${canary}`,
 `{"access_token":"${canary}"}`,
 String.raw`{\"access_token\":\"${canary}\"}`,
 JSON.stringify(JSON.stringify({access_token:canary})),
 JSON.stringify(JSON.stringify(JSON.stringify({access_token:canary}))),
 `{'access_token': '${canary}'}`,
 `PLAID_ACCESS_TOKEN=${canary}`,
 `DB_PASSWORD=${canary}`,
 `auth_token=${canary}`,
 `id_token=${canary}`,
 `AWS_SECRET_ACCESS_KEY=${canary}`,
 'Finances access token: expired',
 'Invalid api key: rejected',
 `The synthetic source returned a lengthy response with additional context before password=${canary}`,
 `The synthetic source returned a lengthy response with additional context before api key: ${canary}`,
 `-----BEGIN PRIVATE KEY-----\n${canary}`,
 `-----BEGIN RSA PRIVATE KEY-----\n${canary}`,
 'access-sandbox-00000000-0000-0000-0000-000000000000',
];
for(const text of credentialText){assert.throws(()=>assertCredentialFree({note:text}),errorCheck);assert.throws(()=>assertCredentialFree({providerMetadata:{[text]:true}}),errorCheck);}
const cyclic={};cyclic.self=cyclic;
const sparse=Array(1);sparse.extra='not an index';
let invoked=false;
const getter=Object.defineProperty({},'value',{enumerable:true,get(){invoked=true;throw new Error(canary);}});
const serializer=Object.defineProperty({},'toJSON',{value(){invoked=true;throw new Error(canary);}});
const serializerGetter=Object.defineProperty({},'toJSON',{get(){invoked=true;throw new Error(canary);}});
for(const input of [undefined,NaN,Infinity,1n,()=>{},Symbol('unsupported'),new Date(),cyclic,sparse,[undefined],getter,serializer,serializerGetter,{[Symbol('hidden')]:'unsupported'},new Proxy({},{ownKeys(){throw new Error(canary);}})])assert.throws(()=>assertCredentialFree(input),errorCheck);
assert.equal(invoked,false,'Credential validation does not invoke accessors or serialization hooks');
let deep=null;for(let i=0;i<CREDENTIAL_INPUT_LIMITS.depth+2;i++)deep={next:deep};
for(const input of [deep,'x'.repeat(CREDENTIAL_INPUT_LIMITS.characters+1),Array(CREDENTIAL_INPUT_LIMITS.nodes+1).fill(null)])assert.throws(()=>assertCredentialFree(input),errorCheck);

const root=fileURLToPath(new URL('../',import.meta.url));
// This adversarial input previously made the URL regex quadratic. Run it in a
// bounded child so a future regression fails instead of hanging the suite.
const linear=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',`import {assertCredentialFree} from ${JSON.stringify(pathToFileURL(join(root,'lib/credential-boundary.ts')).href)};assertCredentialFree({note:'a.'.repeat(3_999_990)});assertCredentialFree({note:'https://proxy.example.test/?next='.repeat(200_000)});assertCredentialFree({note:'invalid.1://'.repeat(500_000)});console.log('bounded scan complete');`],{timeout:4000,encoding:'utf8'});
assert.equal(linear.error,undefined,'Near-limit URL-like text must finish within the bounded test deadline');assert.equal(linear.status,0);assert.equal(linear.stdout.trim(),'bounded scan complete');
const base={version:1,syncedAt:'2026-11-01T16:00:00Z',asOf:'2026-11-01',dateRange:{start:'2026-01-01',end:'2026-11-01'},coverage:{transactions:{is_complete_for_query:true}},accounts:[{id:'bank',name:'Synthetic bank',institution:'Synthetic',type:'depository',subtype:'checking',mask:'1234',balance:1000,netBalance:1000,balanceDate:null,balanceAgeKnown:false,syncStatus:'synced'}],transactions:[{id:'purchase',date:'2026-10-30',merchant:'Synthetic shop',sourceName:'Synthetic shop',accountId:'bank',amount:20,category:'Shopping',flow:'expense',confidence:'HIGH',exceptional:false,note:'',pending:false,review:false}],netWorthHistory:[],recurring:[],notes:[],providerMetadata:safe.providerMetadata};
const sqlite=new DatabaseSync(':memory:');
sqlite.exec('CREATE TABLE finance_records(key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE finance_sync_log(id INTEGER PRIMARY KEY AUTOINCREMENT,imported_at TEXT NOT NULL,as_of TEXT NOT NULL,transaction_count INTEGER NOT NULL,account_count INTEGER NOT NULL)');
let batches=0;
const statement=(sql,args=[])=>({sql,args,bind(...values){return statement(sql,values);},async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return {results:sqlite.prepare(sql).all(...args)};}});
const db={prepare:sql=>statement(sql),async batch(ops){batches++;sqlite.exec('BEGIN');try{const results=ops.map(op=>({success:true,meta:sqlite.prepare(op.sql).run(...op.args)}));sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
const temp=await mkdtemp(join(tmpdir(),'neonworth-credential-boundary-'));
const url=path=>pathToFileURL(path).href;
const logs=[],originalError=console.error;
try{
 globalThis.__neonworthCredentialEnv={DB:db};console.error=(...args)=>logs.push(args);
 const modules=new Map(['store','refresh','planning-store'].map(name=>[name,join(temp,`${name}.ts`)]));
 const rewrite=source=>source.replace("import { env } from 'cloudflare:workers';",'const env = globalThis.__neonworthCredentialEnv;').replace(/from '(?:\.\/|@\/lib\/)([^']+)'/g,(_,name)=>`from '${url(modules.get(name)||join(root,'lib',name.endsWith('.ts')?name:name+'.ts'))}'`).replace("from 'zod'",`from '${url(join(root,'node_modules/zod/index.js'))}'`);
 for(const [name,output] of modules)await writeFile(output,rewrite(await readFile(join(root,'lib',name.endsWith('.ts')?name:name+'.ts'),'utf8')));
 for(const [name,input] of [['mcp','app/mcp/route.ts'],['import-api','app/api/import/route.ts'],['preferences-api','app/api/preferences/route.ts'],['refresh-api','app/api/refresh/route.ts'],['planning-api','app/api/planning/route.ts']])await writeFile(join(temp,name.endsWith('.ts')?name:name+'.ts'),rewrite(await readFile(join(root,input),'utf8')));
 const store=await import(url(modules.get('store'))),refresh=await import(url(modules.get('refresh'))),planning=await import(url(modules.get('planning-store')));
 const mcp=await import(url(join(temp,'mcp.ts')));
 const rows=()=>sqlite.prepare('SELECT * FROM finance_records ORDER BY key').all();
 const request=(path,body)=>new Request('https://neonworth.test/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:typeof body==='string'?body:JSON.stringify(body)});
 const noWrite=async operation=>{const saved=rows(),count=batches;await assert.rejects(operation,errorCheck);assert.equal(batches,count,'Rejection precedes any D1 batch');assert.deepEqual(rows(),saved,'Rejection preserves all saved records');};
 await store.saveDataset(base);
 assert.deepEqual((await store.readState()).dataset.providerMetadata,base.providerMetadata,'Unknown legitimate metadata survives import and read');
 for(const operation of [
  ()=>store.saveDataset({...base,providerMetadata:{access_token:canary}}),
  ()=>store.saveDataset({...base,providerMetadata:{[`https://reader:${canary}@source.example.test`]:true}}),
  ()=>store.saveDataset(base,{nested:{client_secret:canary}}),
  ()=>store.saveDataset(base,undefined,{nested:{password:canary}}),
  ()=>store.saveDataset(base,undefined,undefined,{purchase:{note:`Bearer ${canary}`}}),
  ()=>store.compareAndPutRecord('synthetic',null,{nested:{api_key:canary}}),
  ()=>store.updatePreference({type:'transaction',id:'purchase',patch:{note:`password=${canary}`}}),
  ()=>store.updatePreference({type:'transaction',id:'purchase',patch:{note:JSON.stringify(JSON.stringify({access_token:canary}))}}),
  ()=>store.updatePreference({type:'settings',patch:{savingsTarget:30},ignored:{access_token:canary}}),
  ()=>store.updatePreference({type:'retirement',id:'synthetic',patch:{note:`Bearer ${canary}`}}),
  ()=>planning.savePlanning({...EMPTY_PLANNING,events:[{id:'e',name:'Event',transactionIds:['purchase'],notes:`api_key=${canary}`}]},null),
  ()=>refresh.commitRefresh('synthetic-run',{accounts:{provider:{plaidAccessToken:canary}}}),
  ()=>refresh.failRefresh(`Bearer ${canary}`,'Source unavailable'),
  ()=>refresh.configureRefreshSchedule({id:'synthetic-schedule',enabled:true,timezone:FINANCE_CONFIG.timeZone,hour:7,verifiedAt:base.syncedAt,provider:{refresh_token:canary}}),
 ])await noWrite(operation);
 await store.updatePreference({type:'transaction',id:'purchase',patch:{note:'Password reset fee',category:'Shopping'}});
 assert.equal((await store.readState()).overrides.purchase.note,'Password reset fee');
 await planning.savePlanning(EMPTY_PLANNING,null);assert.deepEqual(await planning.readPlanning(),EMPTY_PLANNING);
 await refresh.configureRefreshSchedule({id:'synthetic-schedule',enabled:true,timezone:FINANCE_CONFIG.timeZone,hour:7,verifiedAt:base.syncedAt,providerMetadata:{request_id:'schedule-source'}});
 assert.equal((await store.readRecord('refresh-status')).schedule.providerMetadata.request_id,'schedule-source');
 const begin=await refresh.beginRefresh();await refresh.failRefresh(begin.runId,'The source was temporarily unavailable.');
 assert.equal((await store.readRecord('refresh-status')).lastRun.error,'The source was temporarily unavailable.');
 for(const [module,body] of [
  ['import-api',{dataset:{...base,providerMetadata:{access_token:canary}}}],
  ['preferences-api',{type:'transaction',id:'purchase',patch:{note:`Bearer ${canary}`}}],
  ['refresh-api',{action:'commit',runId:begin.runId,bundle:{note:`password=${canary}`}}],
  ['planning-api',{plan:{...EMPTY_PLANNING,token:canary},expectedPlan:EMPTY_PLANNING}],
 ]){const api=await import(url(join(temp,module+'.ts'))),saved=rows(),count=batches,response=await api.POST(request('api/'+module,body)),text=await response.text();assert.equal(response.status,400);assert.equal(text.includes(canary),false);assert.equal(batches,count);assert.deepEqual(rows(),saved);}
 for(const [body,expectedId] of [
  [{jsonrpc:'2.0',id:7,method:'tools/call',params:{name:'commit_finance_refresh',arguments:{runId:begin.runId,bundle:{note:`Bearer ${canary}`}}}},7],
  [{jsonrpc:'2.0',id:'synthetic-request-7',method:'tools/list',extra:{password:canary}},'synthetic-request-7'],
  [{jsonrpc:'2.0',id:`Bearer ${canary}`,method:'tools/list'},null],
  [`{"id":7,"raw":${canary}}`,null],
 ]){
  const saved=rows(),count=batches,payload=await (await mcp.POST(request('mcp',body))).json();assert.equal(payload.result.isError,true);assert.equal(payload.id,expectedId,'Safe MCP correlation IDs survive rejected arguments');assert.equal(JSON.stringify(payload).includes(canary),false);assert.equal(batches,count);assert.deepEqual(rows(),saved);
 }
 // A rejected failure detail is a special case: close only the matching run
 // with a fixed reason. Never store/echo the original or change source records.
 const financialRows=()=>rows().filter(row=>row.key!=='refresh-status');
 const retained=financialRows();
 for(const transport of ['direct','http','mcp']){
  const active=await refresh.beginRefresh();assert.equal(active.alreadyRunning,false);
  let result;
  if(transport==='direct')result=await refresh.failRefresh(active.runId,`{"access_token":"${canary}"}`);
  else if(transport==='http'){const api=await import(url(join(temp,'refresh-api.ts'))),response=await api.POST(request('api/refresh',{action:'fail',runId:active.runId,error:`PLAID_ACCESS_TOKEN=${canary}`}));assert.equal(response.status,200);result=await response.json();}
  else{const payload=await (await mcp.POST(request('mcp',{jsonrpc:'2.0',id:19,method:'tools/call',params:{name:'fail_finance_refresh',arguments:{runId:active.runId,error:`DB_PASSWORD=${canary}`}}}))).json();assert.equal(payload.id,19);assert.equal(payload.result.isError,false);result=JSON.parse(payload.result.content[0].text);}
  assert.equal(result.success,true);assert.equal(JSON.stringify(result).includes(canary),false);
  const status=await store.readRecord('refresh-status');assert.equal(status.lastRun.status,'failed');assert.equal(status.lastRun.error,refresh.OMITTED_REFRESH_FAILURE);assert.deepEqual(financialRows(),retained);
 }
 const savedStatus=await store.readRecord('refresh-status');
 const beforeWrongRun=rows(),beforeWrongCount=batches;await assert.rejects(()=>refresh.failRefresh('unmatched-run',`password=${canary}`),/Refresh run does not match/);assert.equal(batches,beforeWrongCount);assert.deepEqual(rows(),beforeWrongRun);
 const succeeded={...savedStatus,lastRun:{...savedStatus.lastRun,status:'succeeded'}};
 sqlite.prepare('UPDATE finance_records SET value=? WHERE key=?').run(JSON.stringify(succeeded),'refresh-status');
 const beforeSuccess=rows(),beforeSuccessCount=batches;assert.equal((await refresh.failRefresh(succeeded.lastRun.id,`password=${canary}`)).alreadyCommitted,true);assert.equal(batches,beforeSuccessCount);assert.deepEqual(rows(),beforeSuccess);
 const planningApi=await import(url(join(temp,'planning-api.ts')));
 const rejectedPlan={...EMPTY_PLANNING,events:[{id:'e',name:'Event',transactionIds:['purchase'],notes:`password=${canary}`}]};
 const rejected=await planningApi.POST(request('api/planning',{plan:rejectedPlan,expectedPlan:EMPTY_PLANNING}));assert.equal(rejected.status,400);assert.deepEqual(await rejected.json(),{error:CREDENTIAL_INPUT_MESSAGE,code:'UNSAFE_CREDENTIAL_INPUT'});
 // Expected state is comparison-only: an owner can remove legacy credential
 // text from a plan without copying it into the proposed replacement.
 sqlite.prepare('UPDATE finance_records SET value=? WHERE key=?').run(JSON.stringify(rejectedPlan),'planning-v1');
 const repaired=await planningApi.POST(request('api/planning',{plan:EMPTY_PLANNING,expectedPlan:rejectedPlan}));assert.equal(repaired.status,200);assert.deepEqual((await repaired.json()).plan,EMPTY_PLANNING);assert.deepEqual(await planning.readPlanning(),EMPTY_PLANNING);
 const malformedExpected=await planningApi.POST(request('api/planning',{plan:EMPTY_PLANNING,expectedPlan:{...EMPTY_PLANNING,[`Bearer ${canary}`]:true}}));assert.equal(malformedExpected.status,400);assert.equal((await malformedExpected.text()).includes(canary),false,'Schema errors must not echo keys in comparison-only input');
 const malformed=await store.boundedJSON(request('api/import',`{"raw":${canary}}`)).catch(error=>error);
 assert.equal(malformed.message,'The request must contain valid JSON.');
 const response=store.errorResponse(new CredentialInputError());assert.equal(response.status,400);assert.deepEqual(await response.json(),{error:CREDENTIAL_INPUT_MESSAGE,code:'UNSAFE_CREDENTIAL_INPUT'});
 // Legacy compatibility is explicit: reading does not silently reject, redact
 // or rewrite saved evidence. A subsequent new write is separately validated.
 const legacy={...base,providerMetadata:{token:canary}};
 sqlite.prepare('UPDATE finance_records SET value=? WHERE key=?').run(JSON.stringify(legacy),'dataset');
 assert.deepEqual((await store.readState()).dataset,legacy);
 await noWrite(()=>store.saveDataset(legacy));
 assert.equal(logs.length,0,'Rejected values and parser errors never enter application logs');
}finally{console.error=originalError;delete globalThis.__neonworthCredentialEnv;sqlite.close();await rm(temp,{recursive:true,force:true});}
console.log('Credential boundary: synthetic validation, metadata/read compatibility, bounded traversal, no-write/no-echo HTTP/MCP and all write entry points passed.');
