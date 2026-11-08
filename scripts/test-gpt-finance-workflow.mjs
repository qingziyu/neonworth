// Execute the shipped integration runner against the real MCP/refresh/store code.
// SQLite substitutes only the D1 transport; no financial/source behavior is mocked.
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFile, writeFile, mkdtemp, rm, mkdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import './test-support/register.mjs';
import { runFinanceWorkflow, readCheckpoint, FINANCE_ROLES, SITE_TOOLS } from '../integrations/gpt-finance/runner.ts';
import { collectionPlan, prepareCollection, checkpoint, unwrapResult, assertIndependentPreserved, verifyReadback } from '../integrations/gpt-finance/contract.ts';
import { deriveDataset } from '../lib/classification.ts';
import { summarizeIncome } from '../lib/income.ts';
import { suggestBudgetPlan } from '../lib/budget.ts';
import { EMPTY_PLANNING } from '../lib/planning.ts';

const root=process.cwd(),now=new Date('2026-10-28T16:00:00Z');
mock.timers.enable({apis:['Date'],now});
const capabilities={financeRoles:FINANCE_ROLES,siteTools:SITE_TOOLS,independentReads:true};
const page=items=>[{cursor:null,result:{items,has_more:false,next_cursor:null,coverage:{availability:'ready',is_complete_for_query:true}}}];
const raw=(id,amount,account_id='bank',extra={})=>({transaction_id:id,date:'2026-10-20',account_id,amount,name:'Example source record',pending:false,iso_currency_code:'USD',personal_finance_category:{primary:'shopping',detailed:'shopping_general_merchandise',confidence_level:'HIGH'},...extra});
const income=(id,amount,detailed,account_id='bank',extra={})=>raw(id,amount,account_id,{personal_finance_category:{primary:'income',detailed,confidence_level:'HIGH'},...extra});
const bank=[raw('purchase',20),income('salary',-1000,'income_wages'),income('interest',-2,'income_interest_earned'),income('ambiguous-income',-30,'income_other'),income('low-confidence',-40,'income_salary','bank',{personal_finance_category:{primary:'income',detailed:'income_salary',confidence_level:'LOW'}}),income('pending-income',-50,'income_salary','bank',{pending:true}),income('card-credit',-60,'income_salary','card'),raw('name-only',-70,'bank',{name:'Example Employer payroll',personal_finance_category:{primary:'other',detailed:'other_other',confidence_level:'HIGH'}}),raw('repayment',100,'bank',{name:'Credit card payment',personal_finance_category:{primary:'transfers',detailed:'transfers_credit_card_payment',confidence_level:'HIGH'}}),raw('repayment-credit',-100,'card',{name:'Credit card payment received',transfer_transaction_id:'repayment',transfer_to_account_id:'bank',personal_finance_category:{primary:'transfers',detailed:'transfers_credit_card_payment',confidence_level:'HIGH'}})];
const bundle={
 accounts:{institutions:[{status:'linked',sync_status:'synced',institution:{name:'Example Institution'},account_coverage:{availability:'ready',is_complete_for_query:true},accounts:[['bank','depository','checking',1000],['card','credit','credit card',-100],['broker','investment','brokerage',5000]].map(([account_id,type,subtype,value])=>({account_id,name:`Example ${account_id}`,type,subtype,balances:{current:Math.abs(value),net_balance:value,iso_currency_code:'USD'}}))}]},
 bank:page(bank),inflows:page(bank.filter(row=>!row.pending&&row.amount<0)),
 investments:page([{investment_transaction_id:'sale',account_id:'broker',date:'2026-10-20',name:'Example share sale',type:'sell',subtype:'sell',amount:-500,quantity:-5,price:100,fees:0,ticker_symbol:'EXMPL',iso_currency_code:'USD'}]),recurring:page([]),
 netWorth:{has_net_worth_data:true,currency_code:'USD',account_coverage:{is_complete_for_query:true},current_value:5900,chart_points:[{date:'2026-10-28',net_worth:5900,first_balance_events:[]}]},
};
const empty=checkpoint({version:1,saved:{dataset:null,overrides:{},settings:{},retirementOverrides:{},reviewPreferences:{findingResolutions:{},recurringStatuses:{}},refresh:null},budget:null,planning:null});
const initial={version:1,mode:'initial',window:{start:'2026-01-01',end:'2026-10-28'},bundle};
const first=prepareCollection(empty,initial,now).expectedDataset,derived=deriveDataset(first),inc=summarizeIncome(derived,2026,'2026-10','month');
assert.equal(inc.cashIncome,1002,'Only source-classified salary and interest enter cash income');
assert.equal(inc.rsuSaleProceeds,500,'Share-sale proceeds remain separate asset conversion evidence');
for(const id of ['ambiguous-income','low-confidence','pending-income','card-credit','name-only'])assert.notEqual(derived.transactions.find(row=>row.id===id).flow,'income',id);
assert.equal(derived.transactions.find(row=>row.id==='salary').category,'Payroll');
assert.equal(derived.transactions.find(row=>row.id==='interest').category,'Interest');
assert.equal(deriveDataset(first,{salary:{flow:'review',review:true}}).transactions.find(row=>row.id==='salary').flow,'review','Saved corrections take precedence over source income');
assert.equal(derived.transactions.find(row=>row.id==='repayment').flow,'transfer');
assert.equal(first.transactions.find(row=>row.id==='salary').sourceProviderCategory.detailed,'income_wages');
assert.equal(first.incomeEvidence.investmentCoverage.isComplete,false);
const uppercase=structuredClone(initial);
for(const family of ['bank','inflows'])for(const row of uppercase.bundle[family][0].result.items){const category=row.personal_finance_category;if(category){category.primary=category.primary.toUpperCase();category.detailed=category.detailed.toUpperCase();}}
const uppercaseSource=prepareCollection(empty,uppercase,now).expectedDataset,uppercaseDerived=deriveDataset(uppercaseSource);
assert.equal(summarizeIncome(uppercaseDerived,2026,'2026-10','month').cashIncome,1002,'Explicit uppercase salary and interest categories are supported');
for(const id of ['ambiguous-income','low-confidence','pending-income','card-credit','name-only'])assert.notEqual(uppercaseDerived.transactions.find(row=>row.id===id).flow,'income',`Uppercase labels do not weaken evidence requirements: ${id}`);
assert.equal(uppercaseSource.transactions.find(row=>row.id==='salary').sourceProviderCategory.detailed,'INCOME_WAGES','Provider category evidence retains its original case');
const paginated=structuredClone(initial),all=paginated.bundle.bank[0].result.items;
paginated.bundle.bank=[{cursor:null,result:{...page([])[0].result,items:all.slice(0,4),has_more:true,next_cursor:'synthetic-next'}},{cursor:'synthetic-next',result:{...page([])[0].result,items:all.slice(4)}}];
assert.deepEqual(prepareCollection(empty,paginated,now).expectedDataset,first);
for(const mutate of [b=>b.bank.pop(),b=>{b.bank[0].result.coverage.is_complete_for_query=false;},b=>{b.inflows[0].result.items=[];},b=>{b.bank[0].result.items[0].iso_currency_code='EUR';}]){const bad=structuredClone(paginated);mutate(bad.bundle);assert.throws(()=>prepareCollection(empty,bad,now),/failed validation/);}
assert.throws(()=>collectionPlan(empty,undefined,now),/earliest available/);
assert.deepEqual(unwrapResult({content:[{type:'text',text:'{"value":1}'}]}),{value:1});
assert.throws(()=>unwrapResult({isError:true,content:[{type:'text',text:'private error'}]}),/did not confirm/);
assert.throws(()=>unwrapResult({isError:true,content:[{type:'text',text:JSON.stringify({code:'STORAGE_UNAVAILABLE',error:'Synthetic uncertain storage response'})}]}),error=>error.code==='tool_outcome_uncertain','An explicit storage uncertainty response is not definitive mutation rejection');
assert.throws(()=>unwrapResult({isError:true,content:[{type:'text',text:JSON.stringify({outcome:'rejected',error:'Synthetic validation rejection'})}]}),error=>error.code==='tool_rejected');

const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE finance_records(key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE finance_sync_log(id INTEGER PRIMARY KEY AUTOINCREMENT,imported_at TEXT NOT NULL,as_of TEXT NOT NULL,transaction_count INTEGER NOT NULL,account_count INTEGER NOT NULL)');
let rollback=false,deferBatch=false,deferredBatch=null;
const statement=(sql,args=[])=>({sql,args,bind(...values){return statement(sql,values)},async first(){return db.prepare(sql).get(...args)||null},async all(){return {results:db.prepare(sql).all(...args)}}});
const binding={prepare:sql=>statement(sql),async batch(ops){if(deferBatch){deferBatch=false;deferredBatch=ops;throw new Error('D1_ERROR: Network connection lost.');}db.exec('BEGIN');try{const out=ops.map((op,i)=>{if(rollback&&i===ops.length-1)throw new Error('synthetic rollback');return {success:true,meta:db.prepare(op.sql).run(...op.args)}});db.exec('COMMIT');return out}catch(error){db.exec('ROLLBACK');throw error}finally{rollback=false}}};
const temp=await mkdtemp('/private/tmp/neonworth-finance-workflow-');
try{
 globalThis.__neonworthWorkflowEnv={DB:binding};
 const paths=new Map(['store','refresh','planning-store'].map(name=>[name,path.join(temp,`${name}.ts`)]));
 const url=p=>pathToFileURL(p).href;
 const rewrite=source=>source.replace("import { env } from 'cloudflare:workers';",'const env = globalThis.__neonworthWorkflowEnv;').replace(/from '(?:\.\/|@\/lib\/)([^']+)'/g,(_,name)=>`from '${url(paths.get(name)||path.join(root,'lib',name.endsWith('.ts')?name:name+'.ts'))}'`).replace("from 'zod'",`from '${url(path.join(root,'node_modules/zod/index.js'))}'`);
 for(const [name,out]of paths)await writeFile(out,rewrite(await readFile(`lib/${name}.ts`,'utf8')));
 for(const [name,src]of [['mcp','app/mcp/route.ts'],['budget','app/api/budget/route.ts'],['planning','app/api/planning/route.ts'],['import','app/api/import/route.ts']])await writeFile(path.join(temp,`${name}.ts`),rewrite(await readFile(src,'utf8')));
 const mcp=await import(url(path.join(temp,'mcp.ts'))),budget=await import(url(path.join(temp,'budget.ts'))),planning=await import(url(path.join(temp,'planning.ts'))),store=await import(url(paths.get('store')));
 const importRoute=await import(url(path.join(temp,'import.ts')));
 let uncertain=false,uncertainInitial=false,importCalls=0,commitCalls=0;
 const io={async call(name,args){if(name==='import_finance_dataset')importCalls++;if(name==='commit_finance_refresh')commitCalls++;const response=await mcp.POST(new Request('https://neonworth.test/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}));const result=await response.json();if(uncertain&&name==='commit_finance_refresh'||uncertainInitial&&name==='import_finance_dataset'){uncertain=false;uncertainInitial=false;throw new Error('lost acknowledgment')}return result.result;},async read(route){return (await (route==='/api/budget'?budget.GET():planning.GET())).json();}};
 const execute=extra=>runFinanceWorkflow({io,capabilities,initialStart:'2026-01-01',now:()=>now,collect:async()=>structuredClone(bundle),...extra});
 const importContract=unwrapResult(await io.call('get_import_contract',{}));
 assert.equal(importContract.refresh,null,'Import discovery works before any dataset exists');
 assert.equal(importContract.capabilities.initialOnly,true,'The first-import atomic guard must be discoverable before collecting');
 assert.deepEqual((await store.readState()).settings,{},'An empty install has no invented savings target');
 assert.deepEqual(unwrapResult(await io.call('get_saved_dataset',{})).settings,{},'MCP checkpoints expose unset settings as unset');
 const emptyNativeCheckpoint=unwrapResult(await io.call('get_workflow_checkpoint',{}));assert.equal(emptyNativeCheckpoint.hasDataset,false);assert.equal(emptyNativeCheckpoint.sourceHash,null);assert.match(emptyNativeCheckpoint.independentHash,/^[a-f0-9]{64}$/);assert.equal(db.prepare('SELECT count(*) n FROM finance_records').get().n,0,'Native checkpoint discovery does not create targets or plans');
 for(const invalid of [null,'true',1]){
  await assert.rejects(store.saveDataset(first,undefined,undefined,undefined,undefined,invalid),/must be a boolean/);
  const response=await importRoute.POST(new Request('https://neonworth.test/api/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dataset:first,initialOnly:invalid})}));assert.equal(response.status,400);
 }
 await assert.rejects(store.saveDataset(first,{},undefined,undefined,undefined,true),/without restored independent records/);
 const competition=await Promise.allSettled([store.saveDataset(first,undefined,undefined,undefined,undefined,true),store.saveDataset({...first,notes:['Other invented initial writer']},undefined,undefined,undefined,undefined,true)]);
 assert.equal(competition.filter(item=>item.status==='fulfilled').length,1,'Exactly one competing initial import can populate the destination');
 assert.equal(db.prepare('SELECT count(*) n FROM finance_sync_log').get().n,1);
 await assert.rejects(store.saveDataset(first,undefined,undefined,undefined,undefined,true),/empty destination/);
 db.exec('DELETE FROM finance_records; DELETE FROM finance_sync_log;');uncertainInitial=true;
 const initialBefore=await readCheckpoint(io);
 const result=await execute();assert.equal(result.evidence.verified,true);assert.equal(importCalls,1,'Lost initial acknowledgment is verified without repeating import');assert.equal(commitCalls,0);
 assert.deepEqual(result.checkpoint.saved.dataset,first,'The actual initial import stores the same validated source dataset');
 assert.deepEqual(result.checkpoint.saved.settings,{},'Importing source records does not create a financial target');
 const initialReadback={collection:initial,receipt:{success:true},status:unwrapResult(await io.call('get_dashboard_status',{})),summaries:{}};
 for(const mode of ['month','ytd','year'])initialReadback.summaries[mode]=unwrapResult(await io.call('get_month_summary',{month:'2026-10',periodMode:mode}));
 const put=(key,value)=>db.prepare('INSERT INTO finance_records VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value),now.toISOString());
 put('overrides',{purchase:{note:'Synthetic correction',category:'Groceries'}});await store.updatePreference({type:'settings',patch:{savingsTarget:17}});put('review-preferences',{findingResolutions:{'synthetic-finding':{state:'reviewed',evidenceKey:'synthetic-evidence',updatedAt:now.toISOString()}},recurringStatuses:{}});put('retirement-overrides',{});put('budget-plan-v1',suggestBudgetPlan(first,4000));put('planning-v1',EMPTY_PLANNING);
 assert.deepEqual(unwrapResult(await io.call('get_saved_dataset',{})).settings,{savingsTarget:17},'Explicitly saved settings round-trip without defaults replacing them');
 const before=await readCheckpoint(io);uncertain=true;
 const refreshed=await execute();assert.equal(refreshed.evidence.verified,true);assert.equal(commitCalls,1,'A lost acknowledgment is read back, not replayed');assertIndependentPreserved(before,refreshed.checkpoint);
 const twice=await execute();assert.equal(twice.evidence.verified,true);assert.equal(twice.checkpoint.saved.refresh.lastRun.report.newTransactions,0);assert.equal(twice.checkpoint.saved.refresh.lastRun.report.unchangedSource,true);
 const delayedBefore=await readCheckpoint(io);let delayedCommit,delayedFailures=0;
 const delayedIO={...io,async call(name,args){if(name==='commit_finance_refresh'){delayedCommit=structuredClone(args);return {isError:true,content:[{type:'text',text:'Synthetic unclassified gateway error while the original request remains queued'}]};}if(name==='fail_finance_refresh')delayedFailures++;return io.call(name,args);}};
 await assert.rejects(execute({io:delayedIO}),error=>error.code==='write_unverified');
 const inFlight=await readCheckpoint(io);assert.equal(inFlight.saved.refresh.lastRun.status,'running');assert.equal(delayedFailures,0,'Uncertain in-flight writes must never be changed to failed');
 const delayedReceipt=unwrapResult(await io.call('commit_finance_refresh',delayedCommit)),delayedAfter=await readCheckpoint(io),delayedStatus=unwrapResult(await io.call('get_dashboard_status',{})),delayedSummaries={};
 for(const mode of ['month','ytd','year'])delayedSummaries[mode]=unwrapResult(await io.call('get_month_summary',{month:'2026-10',periodMode:mode}));
 const delayedCollection={version:1,mode:'refresh',runId:delayedCommit.runId,window:{start:inFlight.saved.refresh.lastRun.start,end:inFlight.saved.refresh.lastRun.end},bundle:delayedCommit.bundle};
 assert.equal((await verifyReadback(delayedBefore,delayedAfter,delayedCollection,delayedReceipt,delayedStatus,delayedSummaries,now)).verified,true,'Later durable readback recovers a delayed commit without re-collecting or replaying it');
 let committedBeforeReadError=false,postCommitFailures=0;
 const unreadableIO={...io,async call(name,args){if(name==='get_saved_dataset'&&committedBeforeReadError)throw new Error('Synthetic read transport unavailable');if(name==='fail_finance_refresh')postCommitFailures++;const value=await io.call(name,args);if(name==='commit_finance_refresh')committedBeforeReadError=true;return value;}};
 await assert.rejects(execute({io:unreadableIO}),error=>error.code==='write_unverified');assert.equal(postCommitFailures,0);assert.equal((await readCheckpoint(io)).saved.refresh.lastRun.status,'succeeded','A failed verification transport cannot fail an accepted write');
 const serverBefore=await readCheckpoint(io),serverProof=unwrapResult(await io.call('get_workflow_checkpoint',{})),commitsBeforeDeferred=commitCalls;let serverOutcome;
 const serverUncertainIO={...io,async call(name,args){const response=await io.call(name,args);if(name==='commit_finance_refresh')serverOutcome=JSON.parse(response.content[0].text).outcome;return response;}};
 await assert.rejects(execute({io:serverUncertainIO,collect:async()=>{deferBatch=true;return structuredClone(bundle);}}),error=>error.code==='write_unverified');
 const serverInFlight=await readCheckpoint(io);assert.equal(serverOutcome,'unconfirmed');assert.equal(serverInFlight.saved.refresh.lastRun.status,'running');assert.deepEqual(serverInFlight.saved.dataset,serverBefore.saved.dataset);assert.equal(commitCalls,commitsBeforeDeferred+1);
 // Complete the original queued storage batch, without a second application
 // mutation. Its unchanged-status guard would fail if catch closed the run.
 assert.ok(deferredBatch);await binding.batch(deferredBatch);deferredBatch=null;
 const serverRecovered=unwrapResult(await io.call('verify_finance_refresh',{runId:serverInFlight.saved.refresh.lastRun.id,expectedIndependentHash:serverProof.independentHash}));assert.equal(serverRecovered.verified,true);assert.equal(commitCalls,commitsBeforeDeferred+1,'Later storage success is verified without replaying the source mutation');
 const countBefore=db.prepare('SELECT count(*) n FROM finance_sync_log').get().n;
 await assert.rejects(execute({collect:async()=>{const bad=structuredClone(bundle);bad.bank[0].result.has_more=true;bad.bank[0].result.next_cursor='missing';return bad;}}),/failed validation/);
 assert.equal(db.prepare('SELECT count(*) n FROM finance_sync_log').get().n,countBefore);
 const failed=await readCheckpoint(io);assert.equal(failed.saved.refresh.lastRun.status,'failed');assert.deepEqual(failed.saved.dataset,twice.checkpoint.saved.dataset);assertIndependentPreserved(twice.checkpoint,failed);
 let collects=0;await io.call('begin_finance_refresh',{});
 await assert.rejects(execute({collect:async()=>{collects++;return bundle;}}),/already running/);assert.equal(collects,0);assert.equal((await readCheckpoint(io)).saved.refresh.lastRun.status,'running','The runner never fails another writer');
 const running=(await readCheckpoint(io)).saved.refresh.lastRun.id;await io.call('fail_finance_refresh',{runId:running,error:'Synthetic owner cleanup'});
 await assert.rejects(execute({capabilities:{...capabilities,financeRoles:[]}}),error=>error.code==='capability_unavailable');
 const preRace=await readCheckpoint(io);
 await assert.rejects(execute({collect:async()=>{const changed=structuredClone(preRace.saved.dataset);changed.transactions.find(t=>t.id==='purchase').amount=21;await store.saveDataset(changed);return structuredClone(bundle);}}),error=>error.code==='write_rejected'&&/explicitly rejected/.test(error.message));
 assert.equal((await readCheckpoint(io)).saved.dataset.transactions.find(t=>t.id==='purchase').amount,21,'Refresh cannot overwrite a concurrent source update');
 const preRollback=await readCheckpoint(io);
 // Force failure only during commit, after the begin status write.
 await assert.rejects(execute({collect:async()=>{const current=structuredClone(bundle);current.bank[0].result.items.find(row=>row.transaction_id==='purchase').amount=21;rollback=true;return current;}}),error=>error.code==='write_unverified');
 assert.deepEqual((await readCheckpoint(io)).saved.dataset,preRollback.saved.dataset);
 assert.equal((await readCheckpoint(io)).saved.refresh.lastRun.status,'running','Unconfirmed storage does not cause either client or server to fail the owned run');
 mock.timers.tick(2*60*60*1000+1); // A fresh attempt is permitted only after the normal lease timeout.
 let malformedCollections=0;
 await assert.rejects(execute({collect:async()=>{malformedCollections++;const invalid=structuredClone(bundle);invalid.accounts.institutions[0].accounts.push({account_id:'malformed-new'});return invalid;}}),error=>error.code==='source_validation');
 assert.equal(malformedCollections,1,'Malformed new-account records fail validation before requesting a backfill');
 const backfillWindows=[];let nativeBundle;
 const backfilled=await execute({collect:async plan=>{
  backfillWindows.push(plan.window);
  const next=structuredClone(bundle);next.bank[0].result.items.find(row=>row.transaction_id==='purchase').amount=21;
  next.accounts.institutions[0].accounts.push({account_id:'new-bank',name:'Example additional account',type:'depository',subtype:'checking',balances:{current:100,net_balance:100,iso_currency_code:'USD'}});
  next.netWorth.current_value=6000;next.netWorth.chart_points[0].net_worth=6000;
  if(plan.fullHistory)next.bank[0].result.items.push(raw('new-account-history',10,'new-bank',{date:'2026-01-15'}));
  nativeBundle=structuredClone(next);return next;
 }});
 assert.equal(backfillWindows.length,2,'New linked accounts trigger one bounded recollection, not an endless retry loop');
 assert.equal(backfillWindows[1].start,'2026-01-01');assert.ok(backfillWindows[0].start>'2026-01-01');
 assert.equal(backfilled.checkpoint.saved.dataset.accounts.length,4);
 assert.ok(backfilled.checkpoint.saved.dataset.transactions.some(row=>row.id==='new-account-history'));
 assertIndependentPreserved(preRollback,backfilled.checkpoint);
 const changedPlan=structuredClone(backfilled.checkpoint);changedPlan.planning={...EMPTY_PLANNING,goals:{...EMPTY_PLANNING.goals,savings:{year:2026,targetAmount:100,basis:'cash'}}};
 assert.throws(()=>assertIndependentPreserved(backfilled.checkpoint,changedPlan),/Budget, planning or recorded scheduling changed/,'Upgrade/update verification cannot silently accept independent-record loss or replacement');
 let scopedCollects=0;
 const badWindowIO={...io,async call(name,args){const result=await io.call(name,args);if(name==='begin_finance_refresh'){const begin=unwrapResult(result);return {...begin,window:{...begin.window,start:'1900-01-01'}};}return result;}};
 await assert.rejects(execute({io:badWindowIO,collect:async()=>{scopedCollects++;return bundle;}}),/independently computed scope/);assert.equal(scopedCollects,0);
 // A scheduled agent needs only the actual native MCP surface for this path.
 // No runner callback, CLI, HTTP plan read or filesystem bridge is used here.
 const nativeBefore=unwrapResult(await io.call('get_workflow_checkpoint',{}));
 const nativeContract=unwrapResult(await io.call('get_refresh_contract',{}));assert.equal(nativeContract.workflow.version,1);assert.equal(nativeContract.workflow.verifyTool,'verify_finance_refresh');
 const nativeBegin=unwrapResult(await io.call('begin_finance_refresh',{fullHistory:true}));assert.equal(nativeBegin.alreadyRunning,false);
 const nativeReceipt=unwrapResult(await io.call('commit_finance_refresh',{runId:nativeBegin.runId,bundle:nativeBundle}));assert.equal(nativeReceipt.success,true);assert.match(nativeReceipt.report.sourceHash,/^[a-f0-9]{64}$/);
 const nativeVerifyArgs={runId:nativeBegin.runId,expectedIndependentHash:nativeBefore.independentHash},beforeVerifyWrites=db.prepare('SELECT total_changes() n').get().n;
 const nativeEvidence=unwrapResult(await io.call('verify_finance_refresh',nativeVerifyArgs));assert.equal(nativeEvidence.verified,true);assert.equal(nativeEvidence.sourceHash,nativeReceipt.report.sourceHash);assert.deepEqual(Object.keys(nativeEvidence.summaryHashes),['month','ytd','year']);assert.ok(JSON.stringify(nativeEvidence).length<2000);assert.equal(Object.hasOwn(nativeEvidence,'dataset'),false);assert.equal(Object.hasOwn(nativeEvidence,'summaries'),false);
 assert.equal(db.prepare('SELECT total_changes() n').get().n,beforeVerifyWrites,'Native verification is read-only');
 const nativeOriginal=await readCheckpoint(io),nativeStatus=structuredClone(nativeOriginal.saved.refresh);
 const rejectNative=async args=>assert.rejects(async()=>unwrapResult(await io.call('verify_finance_refresh',args)),/did not confirm/);
 await rejectNative({...nativeVerifyArgs,runId:'other-run'});await rejectNative({...nativeVerifyArgs,expectedIndependentHash:'0'.repeat(64)});
 for(const mutate of [s=>{s.lastRun.status='running';},s=>{s.lastRun.report.sourceHash='0'.repeat(64);},s=>{delete s.lastRun.report.sourceHash;},s=>{s.lastRun.report.summaries.month.spending+=1;}]){const changed=structuredClone(nativeStatus);mutate(changed);put('refresh-status',changed);await rejectNative(nativeVerifyArgs);put('refresh-status',nativeStatus);}
 const sourceChanged=structuredClone(nativeOriginal.saved.dataset);sourceChanged.notes.push('Synthetic source change after commit');await store.saveDataset(sourceChanged);await rejectNative(nativeVerifyArgs);await store.saveDataset(nativeOriginal.saved.dataset);
 put('planning-v1',changedPlan.planning);await rejectNative(nativeVerifyArgs);put('planning-v1',nativeOriginal.planning);
 put('refresh-status',{...nativeStatus,schedule:{id:'synthetic-new-schedule',enabled:true,timezone:'UTC',hour:5,verifiedAt:now.toISOString()}});await rejectNative(nativeVerifyArgs);put('refresh-status',nativeStatus);
 assert.equal(unwrapResult(await io.call('verify_finance_refresh',nativeVerifyArgs)).verified,true,'Unchanged original records remain independently verifiable');
 const privateDir=path.join(temp,'private');await mkdir(privateDir,{mode:0o700});const checkpointFile=path.join(privateDir,'empty.json');await writeFile(checkpointFile,JSON.stringify(initialBefore),{mode:0o600});
 const output=path.join(privateDir,'plan.json'),cli=['--import','./integrations/gpt-finance/register.mjs','integrations/gpt-finance/cli.mjs'];
 const command=spawnSync(process.execPath,[...cli,'plan',checkpointFile,output,'2026-01-01'],{cwd:root,encoding:'utf8'});assert.equal(command.status,0,command.stderr);assert.equal((await stat(output)).mode&0o777,0o600);
 assert.notEqual(spawnSync(process.execPath,[...cli,'plan',checkpointFile,output,'2026-01-01'],{cwd:root,encoding:'utf8'}).status,0,'Sensitive output is never overwritten');
 assert.notEqual(spawnSync(process.execPath,[...cli,'plan',checkpointFile,path.join(root,'outputs','forbidden-finance-plan.json'),'2026-01-01'],{cwd:root,encoding:'utf8'}).status,0,'Sensitive artifacts cannot enter the checkout');
 const cliInput=async(name,value)=>{const file=path.join(privateDir,name);await writeFile(file,JSON.stringify(value),{mode:0o600});return file;};
 const cliRun=(...args)=>spawnSync(process.execPath,[...cli,...args],{cwd:root,encoding:'utf8'});
 const initialFile=await cliInput('collection.json',initial),payloadFile=path.join(privateDir,'payload.json');
 const prepareCommand=cliRun('prepare',checkpointFile,initialFile,payloadFile);assert.equal(prepareCommand.status,0,prepareCommand.stderr);
 const preparedPayload=JSON.parse(await readFile(payloadFile,'utf8'));assert.equal(preparedPayload.initialOnly,true);assert.equal(preparedPayload.dataset.transactions.length,first.transactions.length);assert.equal(preparedPayload.dataset.asOf,first.asOf);
 const afterFile=await cliInput('after.json',result.checkpoint),readbackFile=await cliInput('readback.json',initialReadback),evidenceFile=path.join(privateDir,'evidence.json');
 const verifyCommand=cliRun('verify',checkpointFile,afterFile,readbackFile,evidenceFile);assert.equal(verifyCommand.status,0,verifyCommand.stderr);
 const evidence=JSON.parse(await readFile(evidenceFile,'utf8'));assert.equal(evidence.verified,true);assert.match(evidence.sourceHash,/^[a-f0-9]{64}$/);assert.equal(Object.hasOwn(evidence,'dataset'),false);
 const wrongSummary=structuredClone(initialReadback);wrongSummary.summaries.month.income+=1;
 const wrongFile=await cliInput('wrong-summary.json',wrongSummary);assert.notEqual(cliRun('verify',checkpointFile,afterFile,wrongFile,path.join(privateDir,'wrong-evidence.json')).status,0,'CLI readback cannot claim success for wrong financial arithmetic');
 const fullHistoryFile=path.join(privateDir,'full-history-plan.json'),fullCommand=cliRun('plan',afterFile,fullHistoryFile,'--full-history');assert.equal(fullCommand.status,0,fullCommand.stderr);assert.equal(JSON.parse(await readFile(fullHistoryFile,'utf8')).window.start,first.dateRange.start);
 const blockerFile=path.join(privateDir,'blocker.json'),blockedCommand=cliRun('blocked','finance_tools',blockerFile);assert.equal(blockedCommand.status,0,blockedCommand.stderr);
 const blocker=JSON.parse(await readFile(blockerFile,'utf8'));assert.equal(blocker.operationCompleted,false);assert.equal(blocker.financeAuthorization,'already-authorized');assert.equal(blocker.verification,'not-run');
 console.log('GPT Finance workflow: actual empty import/refresh/readback, explicit-source income, ambiguous credits, pagination, preservation, idempotence, lost acknowledgment, run ownership, CAS, rollback and private offline artifacts passed. No native Finance or hosted instance was accessed.');
}finally{delete globalThis.__neonworthWorkflowEnv;db.close();mock.timers.reset();await rm(temp,{recursive:true,force:true});}
