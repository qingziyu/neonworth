import type { summarizePeriod, Transaction } from './finance';
import type { netWorthForPeriod } from './net-worth';

function memoizeReport<Result>(capacity:number){
 const entries:Array<{key:readonly unknown[];value:Result}>=[];
 return (key:readonly unknown[],compute:()=>Result):Result=>{
  const index=entries.findIndex(entry=>entry.key.length===key.length&&entry.key.every((part,i)=>Object.is(part,key[i])));
  if(index>=0){
   const [entry]=entries.splice(index,1);
   entries.push(entry);
   return entry.value;
  }
  // A failed calculation must not evict the last successful canonical model.
  const value=compute();
  entries.push({key:[...key],value});
  if(entries.length>capacity)entries.shift();
  return value;
 };
}

/**
 * Ephemeral models for one mounted Home only: instantiate with useMemo keyed
 * by the immutable data identity. Replacing source/corrections discards all
 * entries. Keys use Object.is identity, so callers include every model input.
 * Inactive reports skip calls without clearing entries. Nothing is persisted
 * or shared between Home instances; only successful canonical results remain.
 */
export function createReportModelCache(){
 return {
  summary:memoizeReport<ReturnType<typeof summarizePeriod>>(2),
  netWorth:memoizeReport<ReturnType<typeof netWorthForPeriod>>(2),
  ledger:memoizeReport<Transaction[]>(1),
 };
}
