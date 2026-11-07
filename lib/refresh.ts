import { FINANCE_CONFIG } from './finance-config.ts';
import { readRecord, readState, saveDataset, compareAndPutRecord } from './store';
import { buildRefresh, refreshWindow, type RefreshState, type RefreshBundle, type RefreshRun } from './refresh-model';
import { summarizePeriod } from './finance';
import { deriveDataset } from './classification';
import { sameDatasetContent } from './dataset-storage';
import { isStorageError, storageErrorMessage, storageFailure, StorageFailure } from './storage-errors';
import { assertCredentialFree } from './credential-boundary';

const current=async()=>(await readRecord('refresh-status')) as RefreshState|null;
async function digest(value:unknown){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function getRefreshContract(){
 const state=await readState();if(!state.dataset)throw new Error('Import the initial reconciled dataset first.');
 return {version:1,endpoint:'/api/refresh',status:state.refresh,window:refreshWindow(state.dataset),instructions:[
  'Use begin_finance_refresh (or POST action begin) first. Use its exact window and runId. Do not generate or normalize finance records yourself.',
  'Read Finances get_linked_accounts. Query ALL bank transactions including transfers and pending; independently query posted inflows (amount lt 0, pending false, include_transfers true). Query ALL investment_transactions for the same dates and recurring_transactions with no filters. Use limit 50 and date order descending for bank/investments; follow each exact returned next_cursor until has_more false. No account, merchant or category filter. Include all linked accounts.',
  'Bundle each query page as {cursor:null for first page or exact input cursor,result:the actual tool result containing items,has_more,next_cursor,coverage}. Do not synthesize coverage. Unwrap MCP content/structuredContent envelopes. Preserve all rows and fields without printing private records.',
  'Get the Finances ledger_net_worth_source widget with lookback_days 365; pass its data object unchanged as netWorth. Existing dated history is retained; never synthesize dated balances.',
  'Call commit_finance_refresh (or POST action commit) with runId and bundle {accounts:unwrapped get_linked_accounts result, bank:pages,inflows:pages,investments:pages,recurring:pages,netWorth:data}. A bundle is bounded at 8 MB. If exceeded, fail the run and report the issue; do not truncate.',
  'Keep existing RSU prices. For any NEW explicit RSU receipt, retrieve a verified USD regular-session closing price on its receipt date from an official market source before commit. Optional bundle.rsuPrices entries use {date,ticker:"actual source ticker",price,basis:"regular-session close",source,currency:"USD",observedAt}. Never guess or use a current/sale price. Missing quotes deliberately make effective-income totals unavailable.',
  'After commit, read get_dashboard_status and get_month_summary for month, ytd and year; verify runId and saved counts. A successful request is not a completed update until read back.',
  'On any source/tool/validation failure call fail_finance_refresh (or POST action fail) with runId and a short plain-language reason; the last successful snapshot stays intact. Never replace the saved dataset with a partial bundle. A timed-out run is visibly stale and can be retried after two hours.',
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
  const built=buildRefresh(state.dataset,state.overrides,run,bundle),derived=deriveDataset(built.dataset,state.overrides,state.reviewPreferences);
  const summaries=Object.fromEntries((['month','ytd','year'] as const).map(mode=>{const s=summarizePeriod(derived,built.dataset.asOf.slice(0,7),mode);return [mode,{income:s.income,spending:s.spending,saved:s.saved,reviewCount:s.reviewCount,classificationReviewCount:s.classificationReviewCount}];}));
  const dataBefore={...state.dataset,syncedAt:'',incomeEvidence:{...state.dataset.incomeEvidence,readAt:''}},dataAfter={...built.dataset,syncedAt:'',incomeEvidence:{...built.dataset.incomeEvidence,readAt:''}};
  const resultRun:RefreshRun={...run,status:'succeeded',finishedAt:built.dataset.syncedAt,report:{...built.report,summaries,transactionCount:built.dataset.transactions.length,accountCount:built.dataset.accounts.length,correctionsPreserved:Object.keys(state.overrides).length,unchangedSource:sameDatasetContent(dataBefore,dataAfter)}};
  await saveDataset(built.dataset,undefined,undefined,undefined,{expectedDataset:state.dataset,expectedOverrides:state.overrides,expectedStatus:status,nextStatus:{...status,lastRun:resultRun,lastSuccess:resultRun}});
  return {success:true,runId,report:resultRun.report};
 }catch(error){
  // A lost response or simultaneous retry can follow a successful atomic commit.
  // Read the durable run before reporting failure; never turn success into failure.
  const confirmed=await current().catch(()=>null);
  if(confirmed?.lastRun?.id===runId&&confirmed.lastRun.status==='succeeded')return {success:true,unchanged:true,runId,report:confirmed.lastRun.report};
  const safeError=isStorageError(error)?storageFailure(error,'snapshot_write'):error;
  await failRefresh(runId,safeError instanceof StorageFailure?storageErrorMessage(safeError,true):safeError instanceof Error?safeError.message:'Update failed.').catch(()=>{});throw safeError;
 }
}
export async function configureRefreshSchedule(input:unknown){
 assertCredentialFree(input);
 const s=input as RefreshState['schedule'];if(!s||typeof s.id!=='string'||!s.id||typeof s.enabled!=='boolean'||s.timezone!==FINANCE_CONFIG.timeZone||!Number.isInteger(s.hour)||s.hour<0||s.hour>23||!Number.isFinite(Date.parse(s.verifiedAt)))throw new Error('Invalid verified refresh schedule.');
 const state=await current();await compareAndPutRecord('refresh-status',state,{...state,schedule:s});return {success:true,schedule:s};
}
