import { datasetSchema, assertDatasetSize, MAX_REQUEST_BYTES } from '../../lib/store-validation.ts';
import { budgetPlanSchema } from '../../lib/budget.ts';
import { planningSchema } from '../../lib/planning.ts';
import { assertCredentialFree } from '../../lib/credential-boundary.ts';
import { buildRefresh, FullHistoryRequired, refreshWindow, localToday, type RefreshBundle, type RefreshRun, type RefreshState } from '../../lib/refresh-model.ts';
import { sameDatasetContent } from '../../lib/dataset-storage.ts';
import { deriveDataset } from '../../lib/classification.ts';
import { summarizePeriod, type Dataset, type Transaction } from '../../lib/finance.ts';
import type { ReviewPreferences } from '../../lib/review-preferences.ts';
import type { RetirementOverrideMap } from '../../lib/retirement.ts';

export const WORKFLOW_VERSION = 1;
export type SavedState = {dataset:Dataset|null;overrides:Record<string,Partial<Transaction>>;settings:Record<string,unknown>;retirementOverrides:RetirementOverrideMap;reviewPreferences:ReviewPreferences;refresh?:RefreshState|null};
export type Checkpoint = {version:1;saved:SavedState;budget:unknown|null;planning:unknown|null};
export type Collection = {version:1;mode:'initial'|'refresh';window:{start:string;end:string};runId?:string;bundle:RefreshBundle};
export class WorkflowError extends Error {code:string;constructor(code:string,message:string){super(message);this.code=code;this.name='WorkflowError';}}
function fail(code:string,message:string):never{throw new WorkflowError(code,message);}
const object=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const date=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(`${value}T12:00:00Z`))&&new Date(`${value}T12:00:00Z`).toISOString().slice(0,10)===value;
export const same=(a:unknown,b:unknown)=>sameDatasetContent(a,b);
export function bounded(value:unknown){assertCredentialFree(value);if(new TextEncoder().encode(JSON.stringify(value)).length>MAX_REQUEST_BYTES)fail('size_limit','The complete request exceeds the supported limit. Do not truncate it.');}
/** Tool envelopes are data. Only a single actual JSON result is accepted. */
export function unwrapResult(value:unknown):any {
 if(!object(value))return value;
 if(value.isError===true||value.error){
  let detail=value.structuredContent??value;
  if(!detail.code&&Array.isArray(value.content)&&value.content.length===1&&value.content[0]?.type==='text'){try{detail=JSON.parse(value.content[0].text);}catch{/* An unstructured error is not a storage outcome code. */}}
  if(detail?.code==='STORAGE_UNAVAILABLE'||detail?.code==='STORAGE_FAILURE')fail('tool_outcome_uncertain','Storage could not confirm the operation. Inspect durable saved state without replaying a mutation.');
  fail('tool_failure','The tool did not confirm a successful result.');
 }
 if('structuredContent' in value)return unwrapResult(value.structuredContent);
 if(Array.isArray(value.content)){
  const text=value.content.filter((item:any)=>item?.type==='text'&&typeof item.text==='string');
  if(text.length!==1)fail('tool_shape','A single structured JSON tool result is required.');
  try{return unwrapResult(JSON.parse(text[0].text));}catch(error){if(error instanceof WorkflowError)throw error;fail('tool_shape','The tool result is not valid JSON.');}
 }
 return value;
}
export function checkpoint(input:unknown):Checkpoint {
 assertCredentialFree(input);
 if(!object(input)||input.version!==1||!object(input.saved))fail('checkpoint_shape','A version 1 saved-state checkpoint is required.');
 const saved=input.saved;
 if(!Object.hasOwn(saved,'dataset')||saved.dataset!==null&&!datasetSchema.safeParse(saved.dataset).success)fail('checkpoint_shape','Saved source data could not be validated.');
 for(const key of ['overrides','settings','retirementOverrides','reviewPreferences'])if(!object(saved[key]))fail('checkpoint_shape','Independent saved records are missing.');
 if(!object(saved.reviewPreferences.findingResolutions)||!object(saved.reviewPreferences.recurringStatuses))fail('checkpoint_shape','Review preferences are incomplete.');
 if(!Object.hasOwn(input,'budget')||!Object.hasOwn(input,'planning')||input.budget!==null&&!budgetPlanSchema.safeParse(input.budget).success||input.planning!==null&&!planningSchema.safeParse(input.planning).success)fail('checkpoint_shape','Budget and planning readback are required, including explicit null states.');
 return structuredClone(input) as Checkpoint;
}
export function collectionPlan(before:Checkpoint,initialStart?:string,now=new Date(),fullHistory=false){
 const saved=checkpoint(before),dataset=saved.saved.dataset;
 let window;
 if(dataset){window=refreshWindow(dataset,now);if(fullHistory)window.start=dataset.dateRange.start;}
 else{const end=localToday(now);if(!date(initialStart)||initialStart>end)fail('initial_scope','Choose the authorized earliest available source date for the initial import.');window={start:initialStart,end};}
 return {version:1 as const,mode:dataset?'refresh' as const:'initial' as const,window,fullHistory,manifest:'integrations/gpt-finance/manifest-v1.json',capabilityPremise:'Finance is already connected and authorized. Missing callable tools are a runtime capability blocker.',limits:{requestBytes:MAX_REQUEST_BYTES}};
}
function emptyDataset(window:{start:string;end:string},now:Date):Dataset {
 return {version:1,asOf:window.end,syncedAt:now.toISOString(),dateRange:{...window},accounts:[],transactions:[],recurring:[],netWorthHistory:[],coverage:{},notes:['Imported from native GPT Finance source records. Source coverage and freshness remain explicit.'],incomeEvidence:{version:1,asOf:window.end,readAt:now.toISOString(),bankCoverage:{},investmentCoverage:{isComplete:false,freshness:'unknown',note:'Exhausted pages do not establish complete brokerage history.'},bankInflowCount:0,bankInflowTotal:0,pendingInflowCount:0,investmentRecords:[],accountHistory:[],rsuPrices:[],notes:[],sources:[]}};
}
export function prepareCollection(before:Checkpoint,input:Collection,now=new Date()){
 const saved=checkpoint(before);bounded(input);
 if(!object(input)||input.version!==1||!['initial','refresh'].includes(input.mode)||!object(input.window)||!date(input.window.start)||!date(input.window.end)||input.window.start>input.window.end||input.window.end>localToday(now))fail('collection_shape','Use a version 1 collection with a valid nonfuture source window.');
 if((input.mode==='initial')!==!saved.saved.dataset)fail('wrong_mode','Initial import is allowed only for an empty destination.');
 if(input.mode==='refresh'&&(typeof input.runId!=='string'||!input.runId||input.window.start<saved.saved.dataset!.dateRange.start))fail('owned_run_required','A refresh requires its owned run ID and retained-history scope.');
 const run:RefreshRun={id:input.runId||'initial-local-validation',status:'running',startedAt:now.toISOString(),...input.window,baseSyncedAt:saved.saved.dataset?.syncedAt||now.toISOString()};
 let result;
 try{result=buildRefresh(saved.saved.dataset??emptyDataset(input.window,now),saved.saved.overrides,run,input.bundle,now);}catch(error){if(error instanceof FullHistoryRequired)fail('full_history_required','Validated new accounts require one full retained-history collection.');fail('source_validation','Source pages, evidence, scope, currency or reconciliation failed validation. The saved snapshot must remain intact.');}
 assertDatasetSize(result.dataset);
 const payload=input.mode==='initial'?{dataset:result.dataset,initialOnly:true}:{runId:input.runId!,bundle:input.bundle};
 bounded(payload);
 // Validate the supported complete envelopes, not only the financial payload.
 bounded(input.mode==='initial'?payload:{action:'commit',...payload});
 bounded({jsonrpc:'2.0',id:'workflow',method:'tools/call',params:{name:input.mode==='initial'?'import_finance_dataset':'commit_finance_refresh',arguments:payload}});
 return {payload,expectedDataset:result.dataset,report:result.report};
}
export function assertIndependentPreserved(before:Checkpoint,after:Checkpoint){
 for(const key of ['overrides','settings','retirementOverrides','reviewPreferences'] as const)if(!same(before.saved[key],after.saved[key]))fail('preservation_unverified','An independent saved record changed during the operation. Do not overwrite it; verification requires reconciliation.');
 if(!same(before.budget,after.budget)||!same(before.planning,after.planning)||!same(before.saved.refresh?.schedule??null,after.saved.refresh?.schedule??null))fail('preservation_unverified','Budget, planning or recorded scheduling changed. Verify that independent edit before declaring the update complete.');
}
export function expectedSummaries(saved:SavedState){
 if(!saved.dataset)fail('readback_missing','No saved dataset was returned.');
 const derived=deriveDataset(saved.dataset,saved.overrides,saved.reviewPreferences),month=saved.dataset.asOf.slice(0,7);
 return Object.fromEntries((['month','ytd','year'] as const).map(mode=>{const s=summarizePeriod(derived,month,mode);return [mode,{income:s.income,spending:s.spending,saved:s.saved,reviewCount:s.reviewCount,classificationReviewCount:s.classificationReviewCount}];}));
}
export async function contentHash(value:unknown){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));return [...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');}
export async function verifyReadback(before:Checkpoint,after:Checkpoint,collection:Collection,receipt:any,status:any,summaries:Record<string,any>,now=new Date()){
 before=checkpoint(before);after=checkpoint(after);assertIndependentPreserved(before,after);
 if(!after.saved.dataset||receipt?.success!==true)fail('readback_missing','A successful receipt and saved dataset are required.');
 const prepared=prepareCollection(before,collection,new Date(after.saved.dataset.syncedAt));
 if(!same(prepared.expectedDataset,after.saved.dataset))fail('readback_mismatch','The saved dataset differs from the validated source merge.');
 if(status?.asOf!==after.saved.dataset.asOf||status?.syncedAt!==after.saved.dataset.syncedAt||status?.accounts!==after.saved.dataset.accounts.length||status?.transactions!==after.saved.dataset.transactions.length)fail('status_mismatch','Saved status and source counts disagree.');
 if(collection.mode==='refresh'){
  const run=after.saved.refresh?.lastRun;
  if(run?.id!==collection.runId||run?.status!=='succeeded'||status.refresh?.lastRun?.id!==collection.runId||status.refresh?.lastRun?.status!=='succeeded'||receipt.runId!==collection.runId)fail('run_unverified','The owned refresh run has not been read back as succeeded.');
  if(run.report?.transactionCount!==after.saved.dataset.transactions.length||run.report?.accountCount!==after.saved.dataset.accounts.length)fail('run_unverified','The persisted refresh report counts disagree.');
 }
 const expected=expectedSummaries(after.saved);
 for(const mode of ['month','ytd','year']){
  const actual=summaries[mode];if(!actual||!same(Object.fromEntries(Object.keys(expected[mode]).map(key=>[key,actual[key]])),expected[mode]))fail('summary_mismatch','A saved period summary could not be verified.');
 }
 return {version:1,verified:true,mode:collection.mode,checkedThrough:after.saved.dataset.asOf,verifiedAt:now.toISOString(),accounts:after.saved.dataset.accounts.length,transactions:after.saved.dataset.transactions.length,sourceHash:await contentHash(after.saved.dataset),independentHash:await contentHash({overrides:after.saved.overrides,settings:after.saved.settings,retirementOverrides:after.saved.retirementOverrides,reviewPreferences:after.saved.reviewPreferences,budget:after.budget,planning:after.planning}),periods:['month','ytd','year'],bankFreshness:'unknown',investmentCompleteness:'unknown'};
}
