import { FINANCE_CONFIG } from './finance-config.ts';
import { readRecord, readState, saveDataset, compareAndPutRecord } from './store';
import { buildRefresh, refreshWindow, type RefreshState, type RefreshBundle, type RefreshRun } from './refresh-model';
import { summarizePeriod } from './finance';
import { deriveDataset } from './classification';
import { sameDatasetContent } from './dataset-storage';
import { isStorageError, storageFailure, StorageFailure } from './storage-errors';
import { assertCredentialFree } from './credential-boundary';
import { budgetPlanSchema } from './budget';
import { planningSchema, PLANNING_RECORD_KEY } from './planning';

const current=async()=>(await readRecord('refresh-status')) as RefreshState|null;
async function digest(value:unknown){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');}
function periodSummaries(state:Awaited<ReturnType<typeof readState>>){
 if(!state.dataset)throw new Error('No saved dataset.');
 const derived=deriveDataset(state.dataset,state.overrides,state.reviewPreferences);
 return Object.fromEntries((['month','ytd','year'] as const).map(mode=>{const s=summarizePeriod(derived,state.dataset!.asOf.slice(0,7),mode);return [mode,{income:s.income,spending:s.spending,saved:s.saved,reviewCount:s.reviewCount,classificationReviewCount:s.classificationReviewCount}];}));
}
async function workflowState(){
 const [saved,budget,planning]=await Promise.all([readState(),readRecord('budget-plan-v1'),readRecord(PLANNING_RECORD_KEY)]);
 try{if(budget!==null)budgetPlanSchema.parse(budget);if(planning!==null)planningSchema.parse(planning);}catch(error){throw storageFailure(error,'record_decode');}
 const state={saved,budget,planning};assertCredentialFree(state);return state;
}
async function stableWorkflowState(){
 const before=await workflowState(),after=await workflowState();
 if(!sameDatasetContent(before,after))throw new Error('Saved state changed during workflow readback. Repeat the read without writing.');
 return after;
}
function independentRecords(state:Awaited<ReturnType<typeof workflowState>>){
 const {saved,budget,planning}=state;
 return {overrides:saved.overrides,settings:saved.settings,retirementOverrides:saved.retirementOverrides,reviewPreferences:saved.reviewPreferences,budget,planning,schedule:saved.refresh?.schedule??null};
}
/** Bounded read-only native proof. This is stable-state evidence, not a backup. */
export async function getWorkflowCheckpoint(){
 const state=await stableWorkflowState(),dataset=state.saved.dataset;
 return {version:1,checkedAt:new Date().toISOString(),hasDataset:!!dataset,asOf:dataset?.asOf??null,syncedAt:dataset?.syncedAt??null,accounts:dataset?.accounts.length??0,transactions:dataset?.transactions.length??0,sourceHash:dataset?await digest(dataset):null,independentHash:await digest(independentRecords(state))};
}
export async function verifyFinanceRefresh(runId:unknown,expectedIndependentHash:unknown){
 assertCredentialFree({runId,expectedIndependentHash});
 if(typeof runId!=='string'||!runId||runId.length>200||typeof expectedIndependentHash!=='string'||!/^[a-f0-9]{64}$/.test(expectedIndependentHash))throw new Error('A valid owned run ID and checkpoint independent hash are required.');
 const state=await stableWorkflowState(),dataset=state.saved.dataset,run=state.saved.refresh?.lastRun as RefreshRun|undefined;
 if(!dataset||run?.id!==runId||run.status!=='succeeded')throw new Error('The owned refresh run is not currently verified as succeeded.');
 const sourceHash=await digest(dataset),independentHash=await digest(independentRecords(state));
 if(independentHash!==expectedIndependentHash)throw new Error('Independent saved records changed. Preserve those edits and reconcile them before declaring this update verified.');
 if(run.report?.sourceHash!==sourceHash||run.report?.transactionCount!==dataset.transactions.length||run.report?.accountCount!==dataset.accounts.length||run.end!==dataset.asOf||run.finishedAt!==dataset.syncedAt)throw new Error('The saved source no longer matches the committed refresh proof.');
 const summaries=periodSummaries(state.saved);
 if(!sameDatasetContent(summaries,run.report.summaries))throw new Error('The saved period summaries no longer match the committed refresh proof.');
 const summaryHashes=Object.fromEntries(await Promise.all(Object.entries(summaries).map(async([mode,summary])=>[mode,await digest(summary)])));
 return {version:1,verified:true,runId,verifiedAt:new Date().toISOString(),checkedThrough:dataset.asOf,accounts:dataset.accounts.length,transactions:dataset.transactions.length,sourceHash,independentHash,summaryHashes,periods:['month','ytd','year'],bankFreshness:'unknown',investmentCompleteness:'unknown'};
}
export async function getRefreshContract(){
 const state=await readState();if(!state.dataset)throw new Error('Import the initial reconciled dataset first.');
 return {version:1,endpoint:'/api/refresh',workflow:{version:1,checkpointTool:'get_workflow_checkpoint',verifyTool:'verify_finance_refresh',hashAlgorithm:'SHA-256',nativeOnly:true,verificationReadOnly:true},status:state.refresh,window:refreshWindow(state.dataset),instructions:[
  'Use begin_finance_refresh (or POST action begin) first. Use its exact window and runId. Do not generate or normalize finance records yourself.',
  'Read Finances get_linked_accounts. Query ALL bank transactions including transfers and pending; independently query posted inflows (amount lt 0, pending false, include_transfers true). Query ALL investment_transactions for the same dates and recurring_transactions with no filters. Use limit 50 and date order descending for bank/investments; follow each exact returned next_cursor until has_more false. No account, merchant or category filter. Include all linked accounts.',
  'Bundle each query page as {cursor:null for first page or exact input cursor,result:the actual tool result containing items,has_more,next_cursor,coverage}. Do not synthesize coverage. Unwrap MCP content/structuredContent envelopes. Preserve all rows and fields without printing private records.',
  'Get the Finances ledger_net_worth_source widget with lookback_days 365; pass its data object unchanged as netWorth. Existing dated history is retained; never synthesize dated balances.',
  'Call commit_finance_refresh (or POST action commit) with runId and bundle {accounts:unwrapped get_linked_accounts result, bank:pages,inflows:pages,investments:pages,recurring:pages,netWorth:data}. A bundle is bounded at 8 MB. If exceeded, fail the run and report the issue; do not truncate.',
  'Keep existing RSU prices. For any NEW explicit RSU receipt, retrieve a verified USD regular-session closing price on its receipt date from an official market source before commit. Optional bundle.rsuPrices entries use {date,ticker:"actual source ticker",price,basis:"regular-session close",source,currency:"USD",observedAt}. Never guess or use a current/sale price. Missing quotes deliberately make effective-income totals unavailable.',
  'Before beginning, retain get_workflow_checkpoint.independentHash. After commit, call verify_finance_refresh with runId and expectedIndependentHash; it checks the committed source hash, counts, preserved independent records and all three canonical period summaries without returning raw records. Also read get_dashboard_status and get_month_summary for month, ytd and year. A successful request is not a completed update until read back.',
  'On a definitive source/validation failure before publication, close only your owned running attempt with fail_finance_refresh. An uncertain write acknowledgment or failed readback does not prove rejection: leave the run intact, inspect its durable status, and verify when the same run has succeeded. Never fail or replay a possibly in-flight or succeeded commit, replace data with a partial bundle, or overwrite another writer.',
  'Preserve source classifications and explicit corrections. Cash income is not employer-restricted; a payment rail alone does not determine purpose. Share sales are asset conversions. RSU receipts require verified date/ticker prices; tax basis stays unknown. Existing review decisions and planning records must not be overwritten.',
  'Use an explicitly authorized external updater for this deployment. Financial-provider credentials stay outside the application. Never republish application code for a data refresh.',
 ],actions:{begin:{action:'begin'},commit:{action:'commit',runId:'returned id',bundle:'raw source bundle above'},fail:{action:'fail',runId:'returned id',error:'plain-language explanation'}},limits:{requestBytes:8_000_000},policy:{bankFreshness:'Provider unknown stays unknown',investmentCoverage:'Pagination exhaustion does not establish full brokerage history',periods:['month','ytd','year']}};
}
export async function beginRefresh(fullHistory=false){
 const state=await readState(),status=await current();if(!state.dataset)throw new Error('No saved dataset.');
 if(status?.lastRun?.status==='running'&&Date.now()-Date.parse(status.lastRun.startedAt)<2*60*60*1000) return {runId:status.lastRun.id,window:{start:status.lastRun.start,end:status.lastRun.end},alreadyRunning:true};
 const window=refreshWindow(state.dataset);if(fullHistory)window.start=state.dataset.dateRange.start;
 const run:RefreshRun&{baseHash:string}={id:crypto.randomUUID(),status:'running',startedAt:new Date().toISOString(),...window,baseSyncedAt:state.dataset.syncedAt,baseHash:await digest(state.dataset)};
 await compareAndPutRecord('refresh-status',status,{...status,lastRun:run});
 return {runId:run.id,window:{start:run.start,end:run.end},alreadyRunning:false};
}
export async function failRefresh(runId:string,error:string){
 assertCredentialFree({runId});
 const reason=safeRefreshFailureReason(error);
 const state=await current();if(state?.lastRun?.id!==runId)throw new Error('Refresh run does not match.');if(state.lastRun.status==='succeeded')return {success:true,alreadyCommitted:true};
 const next={...state,lastRun:{...state.lastRun,status:'failed' as const,finishedAt:new Date().toISOString(),error:reason}};
 await compareAndPutRecord('refresh-status',state,next);return {success:true,lastGoodDataPreserved:true};
}
export const OMITTED_REFRESH_FAILURE='The source update failed. Its failure details contained unsupported data or credential material and were omitted.';
export function safeRefreshFailureReason(error:unknown):string {
 if(typeof error!=='string')throw new Error('A refresh failure requires a plain-language message.');
 try{assertCredentialFree(error);return error.slice(0,1500);}catch{return OMITTED_REFRESH_FAILURE;}
}
export async function commitRefresh(runId:string,bundle:RefreshBundle){
 assertCredentialFree({runId,bundle});
 const status=await current(),run=status?.lastRun as RefreshRun&{baseHash?:string};if(run?.id!==runId)throw new Error('Refresh run does not match.');
 if(run.status==='succeeded')return {success:true,unchanged:true,runId,report:run.report};
 if(run.status!=='running')throw new Error('This refresh is closed. Begin a new run.');
 try{
  const state=await readState();if(!state.dataset||await digest(state.dataset)!==run.baseHash)throw new Error('The source snapshot changed during retrieval. Start a new update.');
  const built=buildRefresh(state.dataset,state.overrides,run,bundle);
  const summaries=periodSummaries({...state,dataset:built.dataset});
  const dataBefore={...state.dataset,syncedAt:'',incomeEvidence:{...state.dataset.incomeEvidence,readAt:''}},dataAfter={...built.dataset,syncedAt:'',incomeEvidence:{...built.dataset.incomeEvidence,readAt:''}};
  const resultRun:RefreshRun={...run,status:'succeeded',finishedAt:built.dataset.syncedAt,report:{...built.report,summaries,sourceHash:await digest(built.dataset),transactionCount:built.dataset.transactions.length,accountCount:built.dataset.accounts.length,correctionsPreserved:Object.keys(state.overrides).length,unchangedSource:sameDatasetContent(dataBefore,dataAfter)}};
  await saveDataset(built.dataset,undefined,undefined,undefined,{expectedDataset:state.dataset,expectedOverrides:state.overrides,expectedStatus:status,nextStatus:{...status,lastRun:resultRun,lastSuccess:resultRun}});
  return {success:true,runId,report:resultRun.report};
 }catch(error){
  // A lost response or simultaneous retry can follow a successful atomic commit.
  // Read the durable run before reporting failure; never turn success into failure.
  const confirmed=await current().catch(()=>null);
  if(confirmed?.lastRun?.id===runId&&confirmed.lastRun.status==='succeeded')return {success:true,unchanged:true,runId,report:confirmed.lastRun.report};
  const safeError=isStorageError(error)?storageFailure(error,'snapshot_write'):error;
  // An unconfirmed storage write may still publish. Changing its running lease
  // here would make that original atomic batch fail its own status guard.
  // Leave it intact for durable readback or the normal stale-run timeout.
  if(!(safeError instanceof StorageFailure))await failRefresh(runId,safeError instanceof Error?safeError.message:'Update failed.').catch(()=>{});
  throw safeError;
 }
}
export async function configureRefreshSchedule(input:unknown){
 assertCredentialFree(input);
 const s=input as RefreshState['schedule'];if(!s||typeof s.id!=='string'||!s.id||typeof s.enabled!=='boolean'||s.timezone!==FINANCE_CONFIG.timeZone||!Number.isInteger(s.hour)||s.hour<0||s.hour>23||!Number.isFinite(Date.parse(s.verifiedAt)))throw new Error('Invalid verified refresh schedule.');
 const state=await current();await compareAndPutRecord('refresh-status',state,{...state,schedule:s});return {success:true,schedule:s};
}
