// One client policy for complete, validated saved-state reads. No React, network
// or storage dependency. Writes are never retried by this coordinator.
export type ReadTicket = number;
export type ReadOutcome<T> =
 | {kind:"commit";value:T}
 | {kind:"superseded"}
 | {kind:"unsettled"};

export interface SavedStateCoordinator {
 beginRead():ReadTicket;
 isLatestRead(ticket:ReadTicket):boolean;
 /** Recheck immediately before a caller commits state or displays an error. */
 isCurrentRead(ticket:ReadTicket):boolean;
 /** Keep UI busy for the newest read or any pending write, not superseded reads. */
 isBusy():boolean;
 /** End this idempotent network-write token BEFORE awaiting a readback. */
 beginMutation():()=>void;
 /** Invalidate reads after a child-owned write (for example Retirement) settles. */
 mutationSettled():void;
 readLatest<T>(ticket:ReadTicket,fetcher:()=>Promise<T>):Promise<ReadOutcome<T>>;
}
export const DEFAULT_MAX_REREADS=2;

export function createSavedStateCoordinator(maxRereads=DEFAULT_MAX_REREADS):SavedStateCoordinator {
 let readGeneration=0,mutationGeneration=0,pendingMutations=0;
 let latestReadRevision=0;
 let pendingRead:ReadTicket|null=null;
 const waiters=new Set<()=>void>();
 const wake=()=>{for(const resolve of waiters)resolve();waiters.clear()};
 const isLatestRead=(ticket:ReadTicket)=>ticket===readGeneration;
 return {
  beginRead(){pendingRead=++readGeneration;latestReadRevision=mutationGeneration;wake();return readGeneration},
  isLatestRead,
  isCurrentRead:ticket=>isLatestRead(ticket)&&latestReadRevision===mutationGeneration&&pendingMutations===0,
  isBusy:()=>pendingRead!==null||pendingMutations>0,
  beginMutation(){
   pendingMutations++;mutationGeneration++;
   let ended=false;
   return ()=>{if(ended)return;ended=true;pendingMutations--;mutationGeneration++;wake()};
  },
  mutationSettled(){mutationGeneration++;wake()},
  async readLatest<T>(ticket:ReadTicket,fetcher:()=>Promise<T>):Promise<ReadOutcome<T>>{
   try{
    for(let attempt=0;attempt<=maxRereads;attempt++){
     // An in-flight write may already be durable even if its response has not
     // arrived. Wait for it to settle rather than briefly committing old state.
     while(pendingMutations>0&&isLatestRead(ticket))await new Promise<void>(resolve=>waiters.add(resolve));
     if(!isLatestRead(ticket))return {kind:"superseded"};
     const before=mutationGeneration;
     latestReadRevision=before;
     let value:T;
     try{value=await fetcher()}
     catch(error){
      if(!isLatestRead(ticket))return {kind:"superseded"};
      if(before!==mutationGeneration)continue;
      throw error;
     }
     if(!isLatestRead(ticket))return {kind:"superseded"};
     if(before===mutationGeneration)return {kind:"commit",value};
     // Both successes and errors spanning a write are stale. Reconcile with a
     // bounded GET; never merge fields from that stale snapshot or retry a POST.
    }
    return {kind:"unsettled"};
   }finally{if(isLatestRead(ticket))pendingRead=null}
  },
 };
}
