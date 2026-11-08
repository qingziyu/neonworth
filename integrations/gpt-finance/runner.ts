import { collectionPlan, checkpoint, prepareCollection, verifyReadback, same, unwrapResult, WorkflowError, type Checkpoint, type Collection } from './contract.ts';
import type { RefreshBundle } from '../../lib/refresh-model.ts';

export const FINANCE_ROLES=['accounts','bank','inflows','investments','recurring','netWorth'] as const;
export const SITE_TOOLS=['get_saved_dataset','get_dashboard_status','get_import_contract','get_refresh_contract','begin_finance_refresh','commit_finance_refresh','fail_finance_refresh','import_finance_dataset','get_month_summary'] as const;
export type SiteIO={call:(name:typeof SITE_TOOLS[number],args:Record<string,unknown>)=>Promise<unknown>;read:(path:'/api/budget'|'/api/planning')=>Promise<unknown>};
export type Capabilities={financeRoles:readonly string[];siteTools:readonly string[];independentReads:boolean};
export function preflightCapabilities(capabilities:Capabilities){
 if(!capabilities.independentReads||FINANCE_ROLES.some(role=>!capabilities.financeRoles.includes(role))||SITE_TOOLS.some(name=>!capabilities.siteTools.includes(name)))throw new WorkflowError('capability_unavailable','Finance is already authorized, but this runtime lacks required callable reads or destination verification tools. Continue in a compatible runtime; do not repeat bank setup.');
}
const call=async(io:SiteIO,name:typeof SITE_TOOLS[number],args:Record<string,unknown>={})=>unwrapResult(await io.call(name,args));
async function readOnce(io:SiteIO):Promise<Checkpoint>{
 const saved=await call(io,'get_saved_dataset'),budget=unwrapResult(await io.read('/api/budget')),planning=unwrapResult(await io.read('/api/planning'));
 return checkpoint({version:1,saved,budget:budget?.plan,planning:planning?.plan});
}
/** Stable double-read evidence, not a globally atomic database backup. */
export async function readCheckpoint(io:SiteIO):Promise<Checkpoint>{
 const first=await readOnce(io),second=await readOnce(io);
 if(!same(first,second))throw new WorkflowError('checkpoint_changed','Saved state changed during backup readback. Read a stable checkpoint before continuing.');
 return second;
}
async function closeOwnedFailure(io:SiteIO,runId:string){
 const status=await call(io,'get_dashboard_status');
 if(status.refresh?.lastRun?.id!==runId||status.refresh.lastRun.status!=='running')return;
 await call(io,'fail_finance_refresh',{runId,error:'The source collection or verification did not complete. The last successful snapshot is retained.'});
}
export type WorkflowOptions={io:SiteIO;capabilities:Capabilities;collect:(plan:ReturnType<typeof collectionPlan>&{runId?:string})=>Promise<RefreshBundle>;initialStart?:string;fullHistory?:boolean;now?:()=>Date};
type WriteState='not-started'|'uncertain'|'accepted'|'rejected';
const mayCloseRun=(state:WriteState)=>state==='not-started'||state==='rejected';
/** Native tool invocation is injected by the authorized host. This runner has no
 * fetch, secret handling, connector grant, scheduler or deployment capability. */
export async function runFinanceWorkflow(options:WorkflowOptions):Promise<{evidence:Awaited<ReturnType<typeof verifyReadback>>;checkpoint:Checkpoint}> {
 preflightCapabilities(options.capabilities);
 const {io}=options,clock=options.now??(()=>new Date()),before=await readCheckpoint(io),plan=collectionPlan(before,options.initialStart,clock(),options.fullHistory);
 const contract=await call(io,plan.mode==='initial'?'get_import_contract':'get_refresh_contract');
 if(contract?.version!==1||contract.endpoint!==(plan.mode==='initial'?'/api/import':'/api/refresh')||contract.limits?.requestBytes!==8_000_000||plan.mode==='initial'&&contract.capabilities?.initialOnly!==true)throw new WorkflowError('contract_changed','The destination contract differs from the pinned version. Review compatibility before collecting source records.');
 let runId:string|undefined,writeState:WriteState='not-started';
 if(plan.mode==='refresh'){
  const begin=await call(io,'begin_finance_refresh',{fullHistory:!!options.fullHistory});
  if(begin.alreadyRunning===true)throw new WorkflowError('run_busy','Another refresh is already running. Do not collect for, commit or fail that run.');
  if(begin.alreadyRunning!==false||typeof begin.runId!=='string'||!begin.runId)throw new WorkflowError('begin_unverified','A newly owned refresh run could not be established.');
  const status=await call(io,'get_dashboard_status');
  if(status.refresh?.lastRun?.id!==begin.runId||status.refresh.lastRun.status!=='running')throw new WorkflowError('begin_unverified','The newly begun run could not be read back.');
  runId=begin.runId;
  if(!same(begin.window,plan.window)){await closeOwnedFailure(io,runId!);throw new WorkflowError('window_mismatch','The returned source window differs from the independently computed scope.');}
 }
 try{
  const bundle=await options.collect({...plan,...(runId?{runId}:{})});
  const collection:Collection={version:1,mode:plan.mode,window:plan.window,...(runId?{runId}:{}),bundle};
  let prepared;
  try{prepared=prepareCollection(before,collection,clock());}catch(error){
   if(error instanceof WorkflowError&&error.code==='full_history_required'&&plan.mode==='refresh'&&!options.fullHistory){await closeOwnedFailure(io,runId!);return runFinanceWorkflow({...options,fullHistory:true});}
   throw error;
  }
  // Initial import has no refresh lease. Refuse an observed destination change;
  // the server additionally guards the source revision inside its transaction.
  if(plan.mode==='initial'&&!same(before,await readCheckpoint(io)))throw new WorkflowError('initial_changed','The initial destination changed during collection. Do not replace it.');
  let receipt:any=null;
  writeState='uncertain';
  try{
   receipt=await call(io,plan.mode==='initial'?'import_finance_dataset':'commit_finance_refresh',prepared.payload);
   if(receipt?.success===false)throw new WorkflowError('tool_failure','The destination rejected the write.');
   if(receipt?.success===true)writeState='accepted';else receipt=null;
  }catch(error){
   if(error instanceof WorkflowError&&error.code==='tool_failure'){writeState='rejected';throw new WorkflowError('write_rejected','The destination explicitly rejected the write. No successful update is claimed; inspect the saved state before another attempt.');}
   // Transport errors and malformed acknowledgments do not prove rejection.
   // Read back without replaying or failing a possibly in-flight commit.
   receipt=null;
  }
  const after=await readCheckpoint(io),status=await call(io,'get_dashboard_status');
  if(!receipt){
   if(plan.mode==='refresh'&&after.saved.refresh?.lastRun?.id===runId&&after.saved.refresh?.lastRun?.status==='succeeded')receipt={success:true,runId};
   else if(plan.mode==='initial'&&same(after.saved.dataset,prepared.expectedDataset))receipt={success:true};
   else throw new WorkflowError('write_unverified','The write outcome is unverified. Inspect saved state; do not replay the mutation.');
  }
  const summaries:Record<string,any>={};
  for(const mode of ['month','ytd','year'])summaries[mode]=await call(io,'get_month_summary',{month:after.saved.dataset?.asOf.slice(0,7),periodMode:mode});
  const evidence=await verifyReadback(before,after,collection,receipt,status,summaries,clock());
  return {evidence,checkpoint:after};
 }catch(error){
  if(runId&&mayCloseRun(writeState))await closeOwnedFailure(io,runId).catch(()=>{});
  if((writeState==='uncertain'||writeState==='accepted')&&(!(error instanceof WorkflowError)||['tool_failure','tool_outcome_uncertain','tool_shape','checkpoint_shape'].includes(error.code)))throw new WorkflowError('write_unverified','The write outcome or its readback is unverified. Leave the owned run intact and inspect saved state; do not replay the mutation.');
  if(error instanceof WorkflowError)throw error;
  throw new WorkflowError('workflow_incomplete','The native source or destination did not complete the workflow. The last successful snapshot must be verified before retrying.');
 }
}
