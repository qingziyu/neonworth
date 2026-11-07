import type { RefreshState } from './refresh-model';

export const REFRESH_ATTEMPT_WINDOW_MS=2*60*60*1000;
export type RefreshAttemptStatus='none'|'running'|'unfinished'|'timing-unknown'|'succeeded'|'failed';
export function recordedTime(value:unknown):number|null {
 if(typeof value!=='string'||!value.trim())return null;
 const time=Date.parse(value);return Number.isFinite(time)?time:null;
}

/** Presentation only. A stale running record is not proof of failure or success,
 * and saved schedule metadata cannot establish the live scheduler's state. */
export function summarizeRefreshStatus(state:RefreshState|null|undefined,importedAt:string,now=Date.now()){
 const run=state?.lastRun,started=recordedTime(run?.startedAt),finished=recordedTime(run?.finishedAt),saved=recordedTime(importedAt);
 let attempt:RefreshAttemptStatus='none';
 if(run?.status==='running')attempt=started===null||!Number.isFinite(now)||started>now?'timing-unknown':now-started>=REFRESH_ATTEMPT_WINDOW_MS?'unfinished':'running';
 else if(run?.status==='failed'||run?.status==='succeeded')attempt=run.status;
 // A failure with no finish timestamp cannot be dated from its start alone.
 const attemptTime=run?.status==='running'?started:finished;
 const newerSnapshot=attemptTime!==null&&saved!==null&&saved>attemptTime;
 const latestFailure=attempt==='failed'&&!newerSnapshot;
 const labels:Record<RefreshAttemptStatus,string>={none:'No update attempt recorded',running:'Update attempt in progress',unfinished:'Unfinished update attempt','timing-unknown':'Update timing unavailable',succeeded:'Completed update recorded',failed:'Failed update recorded'};
 const compactLabel=latestFailure?'Last update failed':attempt==='running'&&!newerSnapshot?'Checking connected records':'Saved snapshot';
 return {attempt,attemptLabel:labels[attempt],latestFailure,newerSnapshot,compactLabel,scheduleRecorded:!!state?.schedule};
}

/** Monetary prose can occur in externally supplied error/merchant strings. */
export function refreshTextForDisplay(value:unknown,hidden:boolean):string {
 const text=typeof value==='string'?value:'';
 if(!hidden)return text;
 // Find both currency directions in the original text before replacing either.
 // In "7 USD 9,876.54" or "9,876.54 USD 7 Nov", consuming USD in one pass
 // must not expose the other amount. Overlapping monetary spans merge; an
 // ambiguous number immediately beside a currency is conservatively masked.
 const ranges:Array<[number,number]>=[];
 for(const pattern of [
  /(?:[−+-]\s*)?(?:(?<![A-Za-z])(?:USD|US\$)|\$)\s*[−+-]?(?:[\d,]+(?:\.\d+)?|\.\d+)/gi,
  /[−+-]?(?:[\d,]+(?:\.\d+)?|\.\d+)\s*(?:USD\b|dollars?\b)/gi,
  // Require cents and an explicit monetary noun; leave ordinary dates,
  // account numbers, references and unrelated decimals readable.
  /(?<![\w./-])[−+-]?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}(?=\s*(?:credits?|debits?|refunds?|payments?|fees?)\b)/gi,
 ])for(const match of text.matchAll(pattern))ranges.push([match.index,match.index+match[0].length]);
 ranges.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 const merged:Array<[number,number]>=[];
 for(const range of ranges){const last=merged.at(-1);if(last&&range[0]<=last[1])last[1]=Math.max(last[1],range[1]);else merged.push(range)}
 let output='',cursor=0;
 for(const [start,end] of merged){output+=text.slice(cursor,start)+'••••';cursor=end}
 return output+text.slice(cursor);
}
