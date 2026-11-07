// D1 already retries read-only queries internally. Add at most one application
// retry, and only at the two explicitly read-only SELECT call sites in store.ts.
export type StorageReadOperation = 'record_read' | 'dataset_chunks_read';
export type StorageOperation = StorageReadOperation | 'record_decode' | 'dataset_decode' | 'record_write' | 'snapshot_write' | 'preference_write' | 'storage_binding' | 'storage';
export type StorageCategory = 'transient' | 'failure';
type StorageLog = {event:'neonworth_storage';operation:StorageOperation;category:StorageCategory;reference:string;attempts:number;outcome:'failed'|'recovered_after_retry'};
type RetryOptions = {sleep?:(ms:number)=>Promise<void>;random?:()=>number;log?:(entry:StorageLog)=>void;reference?:()=>string};
const messages = (error:unknown):string[] => {
  const result:string[]=[],seen=new Set<unknown>();let current=error;
  for(let depth=0;depth<4&&current&&typeof current==='object'&&!seen.has(current);depth++){
    seen.add(current);const value=current as {message?:unknown;cause?:unknown};
    if(typeof value.message==='string')result.push(value.message);
    current=value.cause;
  }
  return result;
};
export function isStorageError(error:unknown):boolean {
  return error instanceof StorageFailure || messages(error).some(message=>/\bD1_(?:ERROR|EXEC_ERROR|TYPE_ERROR|COLUMN_NOTFOUND)\b|\bD1 DB\b|\bSQLITE_[A-Z_]+\b/.test(message));
}
export function storageErrorCategory(error:unknown):StorageCategory {
  if(error instanceof StorageFailure)return error.category;
  return isRetryableStorageRead(error)||messages(error).some(message=>/^(?:D1_ERROR:\s*)?internal error(?:[.;:]|$)/i.test(message))?'transient':'failure';
}
function isRetryableStorageRead(error:unknown):boolean {
  // D1 already retries reads internally. An opaque internal error is unavailable
  // (503), but does not establish a retryable subtype. Never retry load/resource,
  // quota, syntax or type errors. Only these documented reset/network errors do.
  return messages(error).some(message=>/^(?:D1_ERROR:\s*)?(?:D1 DB reset because its code was updated\.|Internal error (?:while starting up|in) D1 DB storage caused object to be reset\.|Network connection lost\.|Replica disconnected from primary\.|Cannot resolve D1 DB due to transient issue on remote node\.)/i.test(message));
}
const logDefault=(entry:StorageLog)=>console.error(JSON.stringify(entry));
const newReference=()=>crypto.randomUUID();
export class StorageFailure extends Error {
  readonly code:string;readonly status:503|500;readonly retryAfter:string|undefined;
  readonly category:StorageCategory;readonly operation:StorageOperation;readonly reference:string;
  constructor(category:StorageCategory,operation:StorageOperation,reference:string){
    super(operation.endsWith('_write')?'Storage could not confirm the change. Reload saved data before trying again.':category==='transient'?'Saved storage is temporarily unavailable. Try again shortly.':'Saved storage is unavailable. Please try again later.');
    this.name='StorageFailure';this.category=category;this.operation=operation;this.reference=reference;this.status=category==='transient'?503:500;
    this.code=category==='transient'?'STORAGE_UNAVAILABLE':'STORAGE_FAILURE';this.retryAfter=category==='transient'?'2':undefined;
  }
}
export function storageErrorMessage(failure:StorageFailure,mutation=false):string {
  return mutation?'Storage could not confirm the change. Reload saved data before trying again.':failure.message;
}
export function storageFailure(error:unknown,operation:StorageOperation,attempts=1,options:Pick<RetryOptions,'log'|'reference'>={}):StorageFailure {
  if(error instanceof StorageFailure)return error;
  const failure=new StorageFailure(storageErrorCategory(error),operation,(options.reference??newReference)());
  (options.log??logDefault)({event:'neonworth_storage',operation,category:failure.category,reference:failure.reference,attempts,outcome:'failed'});
  return failure;
}
export async function readWithStorageRetry<T>(operation:StorageReadOperation,read:()=>Promise<T>,options:RetryOptions={}):Promise<T>{
  if(operation!=='record_read'&&operation!=='dataset_chunks_read')throw new Error('Storage retries require an explicit read operation.');
  const reference=(options.reference??newReference)(),log=options.log??logDefault;
  for(let attempt=1;attempt<=2;attempt++){
    try{
      const value=await read();
      if(attempt===2)log({event:'neonworth_storage',operation,category:'transient',reference,attempts:attempt,outcome:'recovered_after_retry'});
      return value;
    }catch(error){
      if(attempt===1&&isRetryableStorageRead(error)){
        const sample=(options.random??Math.random)();
        const jitter=Number.isFinite(sample)?Math.max(0,Math.min(1,sample)):0;
        await (options.sleep??(ms=>new Promise(resolve=>setTimeout(resolve,ms))))(100+Math.round(jitter*100));
        continue;
      }
      throw storageFailure(error,operation,attempt,{log,reference:()=>reference});
    }
  }
  throw new Error('Unreachable storage retry state.');
}
/** Execute a mutation exactly once. Its outcome may be uncertain after a failure. */
export async function writeWithStorageErrors<T>(operation:'preference_write',write:()=>Promise<T>):Promise<T>{
  try{return await write();}catch(error){throw storageFailure(error,operation);}
}
