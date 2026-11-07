"use client";

import { FINANCE_CONFIG } from "@/lib/finance-config";
import { useEffect, useState } from 'react';
import { Check, ChevronDown, Copy, RefreshCw, TriangleAlert } from 'lucide-react';
import type { RefreshState } from '@/lib/refresh-model';
import { recordedTime, refreshTextForDisplay, summarizeRefreshStatus } from '@/lib/refresh-status';

const time=(stamp:unknown)=>recordedTime(stamp)!==null?new Date(stamp as string).toLocaleString(FINANCE_CONFIG.locale,{timeZone:FINANCE_CONFIG.timeZone,year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}):'Not recorded';
export default function RefreshStatus({state,importedAt,compact=false,minimal=false,hidden=false,onDetails}:{state:RefreshState|null|undefined;importedAt:string;compact?:boolean;minimal?:boolean;hidden?:boolean;onDetails?:()=>void}){
 const [copied,setCopied]=useState(false),[copyFailed,setCopyFailed]=useState(false),[now,setNow]=useState(()=>Date.now());
 const run=state?.lastRun,success=state?.lastSuccess;
 // An open tab must age an unfinished attempt without changing the saved record.
 useEffect(()=>{
  if(run?.status!=='running')return;
  const tick=()=>setNow(Date.now());tick();
  const interval=window.setInterval(tick,60_000);
  window.addEventListener('focus',tick);
  return()=>{window.clearInterval(interval);window.removeEventListener('focus',tick);};
 },[run?.id,run?.status,run?.startedAt]);
 const status=summarizeRefreshStatus(state,importedAt,now),detailedCompact=!minimal||status.latestFailure;
 const mask=(text:unknown)=>refreshTextForDisplay(text,hidden);
 const amount=(n:unknown)=>hidden?'••••':typeof n==='number'&&Number.isFinite(n)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n):'Amount unavailable';
 const count=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:'Unknown';
 const report=success?.report;
 const differences=Array.isArray(report?.sourceDifferences)?report.sourceDifferences.filter((row:unknown)=>row&&typeof row==='object'):[];
 const copy=async()=>{try{await navigator.clipboard.writeText('Use my authorized external data adapter to prepare a complete source snapshot for Neonworth. Validate it against dataset v1, preserve stable IDs, source evidence and corrections, and verify saved readback only if an import is authorized. Do not send bank credentials to Neonworth.');setCopied(true);setCopyFailed(false);}catch{setCopyFailed(true);}};
 if(compact)return <div className={`refresh-strip ${status.latestFailure?'refresh-warning':''}`} role="status"><span>{status.latestFailure?<TriangleAlert size={14}/>:<Check size={14}/>}<strong>{status.compactLabel}</strong>{detailedCompact&&<span>Last saved {time(importedAt)}</span>}</span>{detailedCompact&&onDetails&&<button onClick={onDetails}>Update details <RefreshCw size={13}/></button>}</div>;
 return <section className="panel refresh-panel"><div className="eyebrow">SAVED DATA & UPDATES</div><div className="panel-head"><h2>{status.latestFailure?'Last update failed':'Saved snapshot available'}</h2></div>
  <p>Your reports use the saved snapshot. Update attempts and their earlier reports are recorded separately; they do not create new transaction-review tasks. Reload saved data reads the latest saved result.</p>
  <dl className="refresh-facts"><div><dt>Snapshot saved</dt><dd>{time(importedAt)}</dd></div><div><dt>Last recorded attempt</dt><dd>{status.attemptLabel}</dd></div><div><dt>Last successful update</dt><dd>{time(success?.finishedAt)}</dd></div><div><dt>Bank balance source age</dt><dd>Unknown unless dated by the bank</dd></div></dl>
  {status.latestFailure&&<p className="refresh-error" role="alert">{mask(run?.error)||'The last recorded update failed.'} The saved snapshot and your corrections remain available.</p>}
  {status.attempt==='running'&&!status.newerSnapshot&&<p className="small-note">An update attempt began {time(run?.startedAt)}. Completion has not yet been recorded; this does not change the saved figures.</p>}
  {status.attempt==='unfinished'&&<p className="small-note">This attempt is still marked running, but no completion was recorded within its two-hour window. It is shown as unfinished, not as an active check or a financial-review request.</p>}
  {status.attempt==='timing-unknown'&&<p className="small-note">The saved attempt has an invalid or future start time, so its running state cannot be verified. No success or failure is inferred.</p>}
  {status.newerSnapshot&&run?.status!=='succeeded'&&<p className="small-note">A newer snapshot was saved after this attempt’s recorded time. Its old status remains in update history; no outcome is inferred from that later save.</p>}
  <details className="source-note-details refresh-history"><summary>Update history <ChevronDown size={13}/></summary>
   <p className="small-note">Historical update evidence. These entries describe the attempt when it ran, and are not a current review list. Current source health is evaluated separately from the saved records.</p>
   <dl className="refresh-facts"><div><dt>Attempt started</dt><dd>{time(run?.startedAt)}</dd></div><div><dt>Attempt finished</dt><dd>{time(run?.finishedAt)}</dd></div><div><dt>Recorded run status</dt><dd>{run?.status||'Not recorded'}</dd></div><div><dt>Last successful query through</dt><dd>{mask(success?.end)||'Not recorded'}</dd></div></dl>
   {run?.error&&<p className="small-note">Recorded error: {mask(run.error)}</p>}
   {state?.schedule?<p className="small-note">Schedule last recorded as {state.schedule.enabled?'enabled':'disabled'}{` · ${state.schedule.hour}:00 ${state.schedule.timezone}`}. Configuration recorded {time(state.schedule.verifiedAt)}. This saved configuration does not verify whether the external scheduler is currently enabled.</p>:<p className="small-note">No schedule configuration is recorded in this snapshot.</p>}
   {report&&<p className="small-note">Last successful report: {count(report.bankRows)} bank records · {count(report.investmentRows)} investment records · {count(report.recurringStreams)} recurring streams. {count(report.newTransactions)} new transaction IDs; {count(report.removedPending)} pending records replaced or no longer returned. Brokerage history completeness remains unknown.</p>}
   {differences.length>0&&<div className="refresh-history-differences"><strong>{differences.length} source differences recorded in that update</strong><p className="small-note">These are retained report details, not present-day deletion instructions or confirmation requests. Their existence does not remove source rows or change totals.</p><ul>{differences.map((row:Record<string,unknown>,index:number)=><li key={typeof row.id==='string'?row.id:index}>{mask(row.date)} · {mask(row.merchant)} · {amount(row.amount)}</li>)}</ul></div>}
  </details>
  <button className="button light" onClick={copy}>{copied?<Check size={15}/>:<Copy size={15}/>} {copied?'Update request copied':'Copy update request'}</button><p className="small-note">Use this brief with your own external adapter or coding agent. No bank connection or scheduler is included. {copyFailed?'Copy this text: “Prepare and validate a Neonworth dataset v1 snapshot with my authorized external adapter.”':''}</p>
  <style>{`.refresh-history{margin:18px 0;padding-top:14px;border-top:1px solid var(--border)}.refresh-history>summary{display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;font-size:13px;color:var(--muted)}.refresh-history>p,.refresh-history-differences{margin-top:14px}.refresh-history-differences{font-size:12px;line-height:1.8;color:var(--muted)}.refresh-history-differences strong{color:var(--ink)}.refresh-history-differences ul{margin:12px 0;padding-left:20px}.refresh-history-differences li{overflow-wrap:anywhere}.refresh-panel .refresh-facts>div{min-width:0}.refresh-panel .refresh-facts dd{overflow-wrap:anywhere}.refresh-panel>p,.refresh-history>p{overflow-wrap:anywhere}`}</style>
 </section>;
}
