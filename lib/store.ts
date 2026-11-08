import { env } from 'cloudflare:workers';
import { z } from 'zod';
import type { Dataset } from './finance';
import { datasetSchema, preferenceSchema, assertRecordSize, MAX_REQUEST_BYTES, MAX_TRANSACTION_OVERRIDES, validateTransactionOverrides } from './store-validation';
import { assertDatasetSize, datasetChunkKeys, packDataset, parseDatasetRecord, unpackDataset, sameDatasetContent, MAX_RECORD_BYTES } from './dataset-storage';
export { datasetSchema, transactionPatchSchema, settingsSchema } from './store-validation';
import { isRetirementPreference, validateRetirementPreference, validateRetirementOverrides } from './retirement-preferences';
import { emptyReviewPreferences, MAX_REVIEW_PREFERENCE_ENTRIES, mergeReviewPreferences, reviewPreferencesSchema, validateReviewPreference, validateReviewPreferences, type ReviewPreferencesPatch } from './review-preferences';
import { deriveDataset } from './classification';
import { summarizeRecurring } from './recurring';
import { canonicalTransactionReviewPatch } from './transaction-review';
import { StorageFailure, isStorageError, readWithStorageRetry, storageErrorMessage, storageFailure, writeWithStorageErrors } from './storage-errors';
import { assertCredentialFree, CredentialInputError, CREDENTIAL_INPUT_MESSAGE } from './credential-boundary';

function db() {
  if (!env.DB) throw storageFailure(new Error('Missing database binding'),'storage_binding');
  return env.DB;
}
async function rawRecord(key:string) {
  return readWithStorageRetry('record_read',()=>db().prepare('SELECT value FROM finance_records WHERE key = ?').bind(key).first<{value:string}>());
}
function parseRecordValue(value:string):any {
  try{return JSON.parse(value);}catch(error){throw storageFailure(error,'record_decode');}
}
async function loadDataset():Promise<{dataset:Dataset|null;recordValue:string|null}> {
  for(let attempt=0;attempt<2;attempt++) {
    const row=await rawRecord('dataset');
    if(!row)return {dataset:null,recordValue:null};
    let saved;
    try{saved=parseDatasetRecord(row.value);}catch(error){throw storageFailure(error,'dataset_decode');}
    const keys=datasetChunkKeys(saved);
    if(keys===null)return {dataset:saved as Dataset,recordValue:row.value};
    const found=await readWithStorageRetry('dataset_chunks_read',()=>db().prepare(`SELECT key,value FROM finance_records WHERE key IN (${keys.map(()=>'?').join(',')})`).bind(...keys).all<{key:string;value:string}>());
    try {
      return {dataset:await unpackDataset(saved,new Map(found.results.map(chunk=>[chunk.key,chunk.value]))) as Dataset,recordValue:row.value};
    } catch(error) {
      // A concurrent atomic import can remove the old revision after our first read.
      // Retry only when the pointer changed; persistent corruption never becomes an empty state.
      if(attempt===0&&(await rawRecord('dataset'))?.value!==row.value)continue;
      throw storageFailure(error,'dataset_decode');
    }
  }
  throw new Error('Dashboard data changed while loading. Reload to read the latest snapshot.');
}
export async function readRecord(key:string) { return read(key); }
// Opaque stored revision for server-side atomic guards; never sent to clients.
export async function readRecordRevision(key:string):Promise<string|null> { return (await rawRecord(key))?.value ?? null; }
async function read(key:string) {
  if(key==='dataset')return (await loadDataset()).dataset;
  const row=await rawRecord(key);
  return row?parseRecordValue(row.value):null;
}
function putEncoded(key:string,value:string) {
  if(new TextEncoder().encode(value).byteLength>MAX_RECORD_BYTES)throw new Error('A saved dashboard record exceeds the supported size.');
  return db().prepare('INSERT INTO finance_records (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').bind(key,value,new Date().toISOString());
}
function unchangedDatasetGuard(expected:string|null) {
  // Force a key-conflict rollback if another writer changed the source snapshot
  // between validation/history merge and this transaction. No extra schema is needed.
  const statement='INSERT INTO finance_records (key,value,updated_at) SELECT key,value,updated_at FROM finance_records WHERE key=\'dataset\'';
  return expected===null?db().prepare(statement):db().prepare(statement+' AND value <> ?').bind(expected);
}
function put(key:string, value:unknown) {
  assertCredentialFree(value);
  assertRecordSize(value);
  return putEncoded(key,JSON.stringify(value));
}
export class RecordConflict extends Error {}
export async function compareAndPutRecord(key:string,expected:unknown,next:unknown,guards:Array<{key:string;value:string|null}>=[]) {
  assertCredentialFree(next);
  if(guards.length>8||new Set(guards.map(guard=>guard.key)).size!==guards.length||guards.some(guard=>guard.key===key))throw new Error('Invalid guarded record update.');
  const old=await rawRecord(key);
  if(!sameDatasetContent(old?parseRecordValue(old.value):null,expected))throw new RecordConflict('Update state changed. Reload its status before retrying.');
  for(const guard of guards)if(((await rawRecord(guard.key))?.value??null)!==guard.value)throw new RecordConflict('Source records changed. Reload before retrying.');
  const value=put(key,next); // Validate input before the storage-error boundary.
  try { await db().batch([unchangedRecordGuard(key,old?.value??null),...guards.map(guard=>unchangedRecordGuard(guard.key,guard.value)),value]); }
  catch(error) {
    // Only our intentional NULL-key guard represents a transactional conflict.
    // Storage outages and unrelated SQL failures retain their original category.
    if(error instanceof Error && /NOT NULL constraint failed:\s*finance_records\.key/i.test(error.message))throw new RecordConflict('Update state changed. Reload its status before retrying.');
    throw storageFailure(error,'record_write');
  }
}
function unchangedRecordGuard(key:string,expected:string|null) {
  // A deliberately invalid NOT NULL row aborts the entire batch on a mismatch,
  // including a concurrently removed record. No guard rows are ever persisted.
  const sql="INSERT INTO finance_records (key,value,updated_at) SELECT NULL,'','' WHERE ";
  return expected===null
    ?db().prepare(sql+'EXISTS (SELECT 1 FROM finance_records WHERE key = ?)').bind(key)
    :db().prepare(sql+'NOT EXISTS (SELECT 1 FROM finance_records WHERE key = ? AND value = ?)').bind(key,expected);
}
function merge(key:string, value:unknown) {
  assertCredentialFree(value);
  assertRecordSize(value);
  // Merge each correction atomically so independent transaction edits cannot overwrite one another.
  return db().prepare('INSERT INTO finance_records (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=json_patch(finance_records.value,excluded.value),updated_at=excluded.updated_at').bind(key,JSON.stringify(value),new Date().toISOString());
}
function mergeTransactionOverridesStatements(patch:Record<string,unknown>) {
  assertCredentialFree(patch);
  assertRecordSize(patch);
  const encoded=JSON.stringify(patch);
  const guard="INSERT INTO finance_records (key,value,updated_at) SELECT key,value,updated_at FROM finance_records WHERE key='overrides' AND (length(CAST(json_patch(finance_records.value,?) AS BLOB)) > ? OR (SELECT count(*) FROM json_each(json_patch(finance_records.value,?))) > ?)";
  const upsert=db().prepare("INSERT INTO finance_records (key,value,updated_at) VALUES (?,json_patch('{}',?),?) ON CONFLICT(key) DO UPDATE SET value=json_patch(finance_records.value,?),updated_at=excluded.updated_at").bind('overrides',encoded,new Date().toISOString(),encoded);
  return [db().prepare(guard).bind(encoded,MAX_RECORD_BYTES,encoded,MAX_TRANSACTION_OVERRIDES),upsert];
}
function mergedTransactionOverrides(current:Record<string,Record<string,unknown>>,patch:Record<string,Record<string,unknown>>) {
  const result={...current};
  for(const [id,value] of Object.entries(patch)){result[id]={...current[id]};for(const [key,next] of Object.entries(value))if(next===null)delete result[id][key];else result[id][key]=next;}
  assertRecordSize(result);
  if(Object.keys(result).length>MAX_TRANSACTION_OVERRIDES)throw new Error('Too many saved transaction corrections.');
  return result;
}
async function readReviewPreferences() {
  const saved=(await read('review-preferences'))??emptyReviewPreferences();
  try{return reviewPreferencesSchema.parse(saved);}catch(error){throw storageFailure(error,'record_decode');}
}
function recurringIds(dataset:Dataset,overrides:Record<string,Partial<import('./finance').Transaction>>={}) {
  // Infer IDs from source activity, without letting saved stopped/ongoing flags
  // hide a group that the customer needs to update or reset.
  const source={...dataset};delete source.reviewPreferences;
  const derived=deriveDataset(source,overrides,emptyReviewPreferences());
  const recurring=summarizeRecurring(derived,{start:dataset.dateRange.start,end:dataset.asOf});
  return new Set([...recurring.groups,...recurring.repeatPurchases].map(group=>group.id));
}
function mergeReviewPreferencesStatements(patch:ReviewPreferencesPatch) {
  assertCredentialFree(patch);
  assertRecordSize(patch);
  const encoded=JSON.stringify(patch);
  // Recheck the merged bounds inside the same transaction as json_patch. This
  // also enforces the limit when independent preference writes race each other.
  const guard=`INSERT INTO finance_records (key,value,updated_at) SELECT key,value,updated_at FROM finance_records WHERE key='review-preferences' AND (length(CAST(json_patch(finance_records.value,?) AS BLOB)) > ? OR ((SELECT count(*) FROM json_each(json_patch(finance_records.value,?),'$.findingResolutions')) + (SELECT count(*) FROM json_each(json_patch(finance_records.value,?),'$.recurringStatuses'))) > ?)`;
  // Apply tombstones on both paths. Inserting the raw patch would persist null
  // entries on a first reset; reusing excluded.value would lose deletions on an
  // existing record because the insert expression has already applied them.
  const upsert=db().prepare("INSERT INTO finance_records (key,value,updated_at) VALUES (?,json_patch('{}',?),?) ON CONFLICT(key) DO UPDATE SET value=json_patch(finance_records.value,?),updated_at=excluded.updated_at").bind('review-preferences',encoded,new Date().toISOString(),encoded);
  return [db().prepare(guard).bind(encoded,MAX_RECORD_BYTES,encoded,encoded,MAX_REVIEW_PREFERENCE_ENTRIES),upsert];
}
export async function readState() {
  // refresh-status is independent of the other records, so it is read in the same parallel batch.
  const [dataset,overrides,settings,retirementOverrides,reviewPreferences,refresh] = await Promise.all([read('dataset'),read('overrides'),read('settings'),read('retirement-overrides'),readReviewPreferences(),read('refresh-status')]);
  return {dataset:dataset as Dataset|null, overrides:overrides||{}, settings:settings||{}, retirementOverrides:retirementOverrides||{},reviewPreferences,refresh};
}
export async function saveDataset(input:unknown, retirementOverrides?:unknown, reviewPreferences?:unknown, transactionOverrides?:unknown, refreshCommit?:{expectedDataset:Dataset;expectedOverrides:unknown;expectedStatus:unknown;nextStatus:unknown}, initialOnly:unknown=false) {
  if(typeof initialOnly!=='boolean')throw new Error('initialOnly must be a boolean.');
  if(initialOnly&&(retirementOverrides!==undefined||reviewPreferences!==undefined||transactionOverrides!==undefined||refreshCommit!==undefined))throw new Error('Initial-only import accepts source data without restored independent records.');
  assertCredentialFree(input);
  for(const value of [retirementOverrides,reviewPreferences,transactionOverrides,refreshCommit?.nextStatus])if(value!==undefined)assertCredentialFree(value);
  const parsed = datasetSchema.parse(input) as Dataset;
  delete parsed.reviewPreferences;
  const savedTransactionOverrides=(await read('overrides'))||{};
  const restoredTransactionOverrides=transactionOverrides===undefined?undefined:validateTransactionOverrides(transactionOverrides,parsed);
  const combinedTransactionOverrides=restoredTransactionOverrides===undefined?savedTransactionOverrides:mergedTransactionOverrides(savedTransactionOverrides,restoredTransactionOverrides);
  const restoredOverrides = retirementOverrides === undefined ? undefined : validateRetirementOverrides(retirementOverrides, parsed);
  const restoredReviewPreferences=reviewPreferences===undefined?undefined:validateReviewPreferences(reviewPreferences,parsed,recurringIds(parsed,combinedTransactionOverrides));
  const loaded=await loadDataset();
  const existing=loaded.dataset;
  if(initialOnly&&existing!==null)throw new RecordConflict('Initial import requires an empty destination. Read the saved data before continuing.');
  const overrideRecord=refreshCommit?await rawRecord('overrides'):null;
  const statusRecord=refreshCommit?await rawRecord('refresh-status'):null;
  if(refreshCommit&&(!sameDatasetContent(existing,refreshCommit.expectedDataset)||!sameDatasetContent(savedTransactionOverrides,refreshCommit.expectedOverrides)||!sameDatasetContent(overrideRecord?parseRecordValue(overrideRecord.value):{},savedTransactionOverrides)||!sameDatasetContent(statusRecord?parseRecordValue(statusRecord.value):null,refreshCommit.expectedStatus)))throw new RecordConflict('Saved data or corrections changed during refresh. Start a new update from the latest snapshot.');
  if (existing && (parsed.asOf < existing.asOf || Date.parse(parsed.syncedAt) < Date.parse(existing.syncedAt))) {
    throw new Error('This snapshot is older than the saved data. Refresh from Finances instead of replacing newer records.');
  }
  // Preserve dated balance observations, including account-onboarding annotations, across refreshes.
  const history = new Map((existing?.netWorthHistory||[]).map(point => [point.date,point]));
  for (const point of parsed.netWorthHistory) history.set(point.date,point);
  parsed.netWorthHistory = [...history.values()].sort((a,b) => a.date.localeCompare(b.date));
  assertCredentialFree(parsed);
  assertDatasetSize(parsed);
  const datasetText=JSON.stringify(parsed);
  const datasetUnchanged = !!existing && sameDatasetContent(existing,parsed);
  let retirementAnnotationsUnchanged = true,reviewAnnotationsUnchanged=true;
  const transactionAnnotationsUnchanged=restoredTransactionOverrides===undefined||sameDatasetContent(savedTransactionOverrides,combinedTransactionOverrides);
  if (restoredOverrides !== undefined) {
    const savedOverrides = (await read('retirement-overrides')) || {};
    const mergedOverrides = {...savedOverrides};
    for (const [id,patch] of Object.entries(restoredOverrides)) mergedOverrides[id] = {...savedOverrides[id],...patch};
    assertRecordSize(mergedOverrides);
    retirementAnnotationsUnchanged = JSON.stringify(savedOverrides) === JSON.stringify(mergedOverrides);
  }
  if(restoredReviewPreferences!==undefined){const current=await readReviewPreferences();reviewAnnotationsUnchanged=sameDatasetContent(current,mergeReviewPreferences(current,restoredReviewPreferences));}
  const operations:D1PreparedStatement[]=[];
  if(refreshCommit)operations.push(unchangedRecordGuard('refresh-status',statusRecord?.value??null),unchangedRecordGuard('overrides',overrideRecord?.value??null),put('refresh-status',refreshCommit.nextStatus));
  if(!datasetUnchanged) {
    let activeKeys:string[]=[];
    if(new TextEncoder().encode(datasetText).byteLength<=MAX_RECORD_BYTES) {
      // Keep small snapshots compatible with the original single-row format.
      operations.push(putEncoded('dataset',datasetText));
    } else {
      const packed=await packDataset(parsed);
      activeKeys=packed.manifest.keys;
      operations.push(...packed.records.map(chunk=>putEncoded(chunk.key,chunk.value)),put('dataset',packed.manifest));
    }
    // This namespace is server-owned. Delete obsolete and abandoned revisions in
    // the same transaction that installs the new pointer; retain the active keys.
    const cleanup="DELETE FROM finance_records WHERE key GLOB 'dataset:chunk:*'";
    operations.push(activeKeys.length?db().prepare(`${cleanup} AND key NOT IN (${activeKeys.map(()=>'?').join(',')})`).bind(...activeKeys):db().prepare(cleanup));
    operations.push(db().prepare('INSERT INTO finance_sync_log (imported_at,as_of,transaction_count,account_count) VALUES (?,?,?,?)').bind(new Date().toISOString(),parsed.asOf,parsed.transactions.length,parsed.accounts.length));
  }
  if(restoredOverrides!==undefined&&!retirementAnnotationsUnchanged)operations.push(merge('retirement-overrides',restoredOverrides));
  if(restoredReviewPreferences!==undefined&&!reviewAnnotationsUnchanged)operations.push(...mergeReviewPreferencesStatements(restoredReviewPreferences));
  if(restoredTransactionOverrides!==undefined&&!transactionAnnotationsUnchanged)operations.push(...mergeTransactionOverridesStatements(restoredTransactionOverrides));
  if(operations.length) {
    // This same atomic guard covers initialOnly: the empty-source read above
    // cannot be invalidated by another initial writer before publication.
    try {await db().batch([unchangedDatasetGuard(loaded.recordValue),...operations]);}
    catch(error) {
      if(error instanceof Error&&/NOT NULL constraint failed:\s*finance_records\.key/i.test(error.message))throw new RecordConflict('Saved data or corrections changed during this update. Reload before retrying.');
      if(error instanceof Error&&/UNIQUE constraint failed:\s*finance_records\.key/i.test(error.message)&&(await rawRecord('dataset'))?.value!==(loaded.recordValue??undefined))throw new RecordConflict('The saved dataset changed during this update. Reload the latest data and retry.');
      throw storageFailure(error,'snapshot_write');
    }
  }
  return {success:true,unchanged:datasetUnchanged&&retirementAnnotationsUnchanged&&reviewAnnotationsUnchanged&&transactionAnnotationsUnchanged,asOf:parsed.asOf,transactions:parsed.transactions.length,accounts:parsed.accounts.length,retirementClassifications:restoredOverrides?Object.keys(restoredOverrides).length:0,transactionCorrections:restoredTransactionOverrides?Object.keys(restoredTransactionOverrides).length:0};
}
export async function updatePreference(input:unknown) {
  assertCredentialFree(input);
  if (isRetirementPreference(input)) {
    const dataset = await read('dataset') as Dataset|null;
    const value = validateRetirementPreference(input, dataset);
    const savedOverrides = (await read('retirement-overrides')) || {};
    assertRecordSize({...savedOverrides,[value.id]:{...savedOverrides[value.id],...value.patch}});
    const statements=[merge('retirement-overrides',Object.fromEntries([[value.id,value.patch]]))];
    await writeWithStorageErrors('preference_write',()=>db().batch(statements));
    return {success:true};
  }
  const value = preferenceSchema.parse(input);
  if(value.type==='review-resolution'||value.type==='recurring-status') {
    const dataset=await read('dataset') as Dataset|null;
    const knownIds=dataset&&value.type==='recurring-status'?recurringIds(dataset,(await read('overrides'))||{}):new Set<string>();
    const {patch}=validateReviewPreference(value,dataset,knownIds);
    mergeReviewPreferences(await readReviewPreferences(),patch); // Validate merged count/byte bounds before any write.
    const statements=mergeReviewPreferencesStatements(patch);
    await writeWithStorageErrors('preference_write',()=>db().batch(statements));
    return {success:true,reviewPreferences:await readReviewPreferences()};
  }
  if (value.type === 'transaction') {
    const dataset = await read('dataset') as Dataset|null;
    const transaction = dataset?.transactions.find(item => item.id === value.id);
    if (!transaction) throw new Error('Transaction not found.');
    if (value.patch.flow === 'income' && transaction.amount > 0) throw new Error('An outflow cannot be classified as income.');
    const savedOverrides=(await read('overrides'))||{};
    const patch=canonicalTransactionReviewPatch(transaction,dataset?.accounts.find(account=>account.id===transaction.accountId),value.patch,savedOverrides[value.id]||{});
    mergedTransactionOverrides(savedOverrides,{[value.id]:patch});
    const statements=mergeTransactionOverridesStatements(Object.fromEntries([[value.id,patch]]));
    await writeWithStorageErrors('preference_write',()=>db().batch(statements));
    const overrides=(await read('overrides'))||{};
    return {success:true,override:overrides[value.id]||{},overrides};
  } else {
    assertRecordSize({...((await read('settings'))||{}),...value.patch});
    const statements=[merge('settings',value.patch)];
    await writeWithStorageErrors('preference_write',()=>db().batch(statements));
  }
  return {success:true};
}
export function json(value:unknown,status=200) {
  return Response.json(value,{status,headers:{'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff','Vary':'Cookie'}});
}
export function checkOrigin(request:Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new Error('Cross-origin writes are not allowed.');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (!origin && fetchSite && !['same-origin','none'].includes(fetchSite)) throw new Error('Cross-origin writes are not allowed.');
}
// Parsing alone is used only where a route must retain a safe protocol ID,
// sanitize a refresh failure reason, or compare a non-persisted old plan.
// Those callers must validate all proposed data before dispatching a write.
export async function parseBoundedJSON(request:Request):Promise<any> {
  const length = Number(request.headers.get('content-length')||0);
  if (length > MAX_REQUEST_BYTES) throw new Error('Request is too large.');
  if (!request.body) throw new Error('A JSON body is required.');
  const reader = request.body.getReader();
  const chunks:Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REQUEST_BYTES) {await reader.cancel(); throw new Error('Request is too large.');}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk,offset); offset += chunk.byteLength;}
  let value:unknown;
  try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new Error('The request must contain valid JSON.');}
  return value;
}
export async function boundedJSON(request:Request) {
  const value=await parseBoundedJSON(request);
  assertCredentialFree(value);
  return value;
}
export function errorResponse(error:unknown,mutation=false) {
  if(error instanceof CredentialInputError)return json({error:CREDENTIAL_INPUT_MESSAGE,code:error.code},400);
  if(error instanceof StorageFailure||isStorageError(error)){
    const failure=error instanceof StorageFailure?error:storageFailure(error,'storage');
    const response=json({error:storageErrorMessage(failure,mutation),code:failure.code,reference:failure.reference},failure.status);
    // An uncertain mutation may already be durable. Only reads advertise a
    // retry delay; writes require saved-state inspection before a manual retry.
    if(failure.retryAfter&&!mutation)response.headers.set('Retry-After',failure.retryAfter);
    return response;
  }
  if(error instanceof RecordConflict)return json({error:error.message},409);
  return json({error:error instanceof z.ZodError ? 'The imported data has an invalid format.' : error instanceof Error ? error.message : 'The request could not be completed.'},400);
}
