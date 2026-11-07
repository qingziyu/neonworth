/** Dataset bytes live in bounded D1 rows; preferences retain their own records. */
export const MAX_RECORD_BYTES = 1_800_000;
export const MAX_DATASET_BYTES = 7_500_000;
export const DATASET_CHUNK_CODE_UNITS = 200_000;
export const MAX_DATASET_CHUNKS = 40;
export const DATASET_STORAGE_KIND = 'versionedneonworthchunks';
const revisionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const encoder = new TextEncoder();
const corruption = () => new Error('The saved dashboard data is incomplete or corrupt. Reload once; if the error persists, restore a verified backup.');

export interface DatasetManifest {
  kind: typeof DATASET_STORAGE_KIND;
  version: 1;
  revision: string;
  keys: string[];
  codeUnits: number;
  utf8Bytes: number;
  sha256: string;
}
export interface DatasetStorageRecord {key:string;value:string}
export interface PackedDataset {manifest:DatasetManifest;records:DatasetStorageRecord[];serialized:string}

function serialized(value:unknown):string {
  const text = JSON.stringify(value);
  if (typeof text !== 'string') throw new Error('The dashboard data cannot be serialized.');
  return text;
}
export function assertRecordSize(value:unknown) {
  if (encoder.encode(serialized(value)).byteLength > MAX_RECORD_BYTES) throw new Error('A saved dashboard record exceeds the supported size.');
}
export function assertDatasetSize(value:unknown) {
  if (encoder.encode(serialized(value)).byteLength > MAX_DATASET_BYTES) throw new Error('The dataset exceeds the supported 7.5 MB size.');
}
/** JSON object-key order is not a source-data change; array order remains significant. */
export function sameDatasetContent(left:unknown,right:unknown):boolean {
  if(left===right)return true;
  if(typeof left!=='object'||left===null||typeof right!=='object'||right===null||Array.isArray(left)!==Array.isArray(right))return false;
  const a=left as Record<string,unknown>,b=right as Record<string,unknown>,keys=Object.keys(a);
  return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&sameDatasetContent(a[key],b[key]));
}
async function sha256(text:string):Promise<string> {
  const bytes = encoder.encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2,'0')).join('');
}
function chunkKey(revision:string,index:number) {return `dataset:chunk:${revision}:${index}`;}
function isObject(value:unknown):value is Record<string,unknown> {return typeof value==='object'&&value!==null&&!Array.isArray(value);}
function isLegacyDataset(value:unknown):boolean {
  return isObject(value)&&value.version===1&&Array.isArray(value.accounts)&&Array.isArray(value.transactions)&&typeof value.asOf==='string';
}
/** Validate every key before any database read; never follow arbitrary record keys. */
export function datasetChunkKeys(value:unknown):string[]|null {
  if (!isObject(value)||value.kind!==DATASET_STORAGE_KIND) {
    if (isLegacyDataset(value)) return null;
    throw corruption();
  }
  const m=value as unknown as DatasetManifest;
  if (Object.keys(value).some(key=>!['kind','version','revision','keys','codeUnits','utf8Bytes','sha256'].includes(key))||m.version!==1||typeof m.revision!=='string'||!revisionPattern.test(m.revision)||!Array.isArray(m.keys)||m.keys.length<1||m.keys.length>MAX_DATASET_CHUNKS||!Number.isSafeInteger(m.codeUnits)||m.codeUnits<1||m.codeUnits>MAX_DATASET_BYTES||!Number.isSafeInteger(m.utf8Bytes)||m.utf8Bytes<1||m.utf8Bytes>MAX_DATASET_BYTES||typeof m.sha256!=='string'||!/^[0-9a-f]{64}$/.test(m.sha256)||m.keys.length!==Math.ceil(m.codeUnits/DATASET_CHUNK_CODE_UNITS))throw corruption();
  const expected=m.keys.map((_,index)=>chunkKey(m.revision,index));
  if(m.keys.some((key,index)=>typeof key!=='string'||key!==expected[index]))throw corruption();
  return expected;
}
export function parseDatasetRecord(value:string):unknown {
  try {const parsed:unknown=JSON.parse(value);datasetChunkKeys(parsed);return parsed;}catch {throw corruption();}
}
export async function packDataset(value:unknown,revision=crypto.randomUUID()):Promise<PackedDataset> {
  if(!revisionPattern.test(revision))throw new Error('Invalid dataset storage revision.');
  const text=serialized(value),bytes=encoder.encode(text).byteLength;
  if(bytes>MAX_DATASET_BYTES)throw new Error('The dataset exceeds the supported 7.5 MB size.');
  if(!isLegacyDataset(value))throw new Error('The dashboard dataset has an invalid storage shape.');
  const records:DatasetStorageRecord[]=[];
  for(let offset=0;offset<text.length;offset+=DATASET_CHUNK_CODE_UNITS) {
    // JSON encoding each substring preserves even a surrogate pair split at a boundary.
    const part=text.slice(offset,offset+DATASET_CHUNK_CODE_UNITS);
    assertRecordSize(part);
    records.push({key:chunkKey(revision,records.length),value:JSON.stringify(part)});
  }
  if(records.length<1||records.length>MAX_DATASET_CHUNKS)throw new Error('The dataset requires too many storage chunks.');
  const manifest:DatasetManifest={kind:DATASET_STORAGE_KIND,version:1,revision,keys:records.map(row=>row.key),codeUnits:text.length,utf8Bytes:bytes,sha256:await sha256(text)};
  assertRecordSize(manifest);
  return {manifest,records,serialized:text};
}
/** Input chunk values are the raw JSON strings stored in finance_records.value. */
export async function unpackDataset(value:unknown,chunks:ReadonlyMap<string,string>=new Map()):Promise<unknown> {
  const keys=datasetChunkKeys(value);
  if(keys===null)return value;
  const manifest=value as DatasetManifest,parts:string[]=[];
  let length=0;
  for(let index=0;index<keys.length;index++) {
    const raw=chunks.get(keys[index]);
    if(typeof raw!=='string'||encoder.encode(raw).byteLength>MAX_RECORD_BYTES)throw corruption();
    let part:unknown;
    try {part=JSON.parse(raw);}catch {throw corruption();}
    const expectedLength=index===keys.length-1?manifest.codeUnits-index*DATASET_CHUNK_CODE_UNITS:DATASET_CHUNK_CODE_UNITS;
    if(typeof part!=='string'||part.length!==expectedLength||part.length>DATASET_CHUNK_CODE_UNITS)throw corruption();
    length+=part.length;if(length>MAX_DATASET_BYTES)throw corruption();
    parts.push(part);
  }
  const text=parts.join('');
  if(length!==manifest.codeUnits||encoder.encode(text).byteLength!==manifest.utf8Bytes||await sha256(text)!==manifest.sha256)throw corruption();
  try {const parsed:unknown=JSON.parse(text);if(!isLegacyDataset(parsed))throw corruption();return parsed;}catch {throw corruption();}
}
