"use client";

import { clientFetch as fetch, CLIENT_READ_ONLY, ALLOW_IMPORT } from "@/lib/client-transport";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import type { GoalSettings } from "@/lib/goals";
import type { ReviewEvent } from "@/lib/year-review";
import { EMPTY_PLANNING, planningSchema, type PlanningState } from "@/lib/planning";

async function readPlan(signal?:AbortSignal):Promise<PlanningState|null>{
  const response=await fetch("/api/planning",{cache:"no-store",signal});
  const payload=await response.json() as {plan?:unknown;error?:string};
  if(!response.ok)throw new Error(payload.error||"Saved planning could not be loaded.");
  return payload.plan===null?null:planningSchema.parse(payload.plan) as PlanningState;
}
export function usePlanningState(){
  const [stored,setStored]=useState<PlanningState|null>(null),[ready,setReady]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
  const active=useRef(false);
  const reload=useCallback(async()=>{if(active.current)return;try{setError("");const plan=await readPlan();setStored(plan);setReady(true);setMessage("Saved planning loaded. Review any open draft before saving.")}catch(cause){setError(cause instanceof Error?cause.message:"Planning could not be loaded.")}},[]);
  useEffect(()=>{const controller=new AbortController();readPlan(controller.signal).then(plan=>{setStored(plan);setReady(true)}).catch(cause=>{if(cause.name!=="AbortError")setError("Saved planning could not be loaded.")});return()=>controller.abort()},[]);
  const value=ready?(stored??EMPTY_PLANNING):null;
  const save=async(plan:PlanningState)=>{
    if(active.current)throw new Error("Wait for the current save to finish.");
    if(!ready)throw new Error("Load saved planning before saving.");
    active.current=true;setBusy(true);setError("");setMessage("");
    try{
      const validation=planningSchema.safeParse(plan);
      if(!validation.success)throw new Error(validation.error.issues[0]?.message||"Enter valid planning values.");
      const valid=validation.data as PlanningState;
      const response=await fetch("/api/planning",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({plan:valid,expectedPlan:stored})});
      const payload=await response.json() as {plan?:unknown;error?:string};
      if(response.status===409)throw new Error("Planning changed in another view. Reload saved planning, review your draft, then save again.");
      if(!response.ok)throw new Error(payload.error||"Planning could not be saved.");
      const committed=planningSchema.parse(payload.plan) as PlanningState;
      const readback=await readPlan();
      if(JSON.stringify(readback)!==JSON.stringify(committed))throw new Error("The saved result changed before verification. Reload saved planning before continuing.");
      setStored(readback);setMessage("Planning saved and verified.");
    }catch(cause){const detail=cause instanceof Error?cause.message:"Planning could not be saved.";setError(detail);throw new Error(detail)}finally{active.current=false;setBusy(false)}
  };
  return {value,busy,error,message,reload,save,
    saveGoal:(group:keyof Omit<GoalSettings,"version">,goal:GoalSettings[keyof Omit<GoalSettings,"version">])=>save({...value!,goals:{...value!.goals,[group]:goal}}),
    saveEvents:(events:ReviewEvent[])=>save({...value!,events}),
  };
}

export function PlanningBackup({plan,hidden,busy,onImport}:{plan:PlanningState;hidden:boolean;busy:boolean;onImport:(plan:PlanningState)=>Promise<void>}){
  const file=useRef<HTMLInputElement>(null),[pending,setPending]=useState<PlanningState|null>(null),[error,setError]=useState("");
  useEffect(()=>{if(hidden)setPending(null)},[hidden]);
  const download=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(plan)],{type:"application/json"}));const anchor=document.createElement("a");anchor.href=url;anchor.download="neonworth-planning.json";anchor.click();URL.revokeObjectURL(url)};
  const load=async(input:File|undefined)=>{if(!ALLOW_IMPORT||!input)return;setError("");try{if(input.size>1800000)throw new Error("Use a planning backup at most 1.8 MB.");setPending(planningSchema.parse(JSON.parse(await input.text())) as PlanningState)}catch{setError("This file is not a valid Neonworth planning backup.")}finally{if(file.current)file.current.value=""}};
  const confirm=async()=>{if(!pending)return;try{await onImport(pending);setPending(null)}catch(cause){setError(cause instanceof Error?cause.message:"Import could not be saved.")}};
  return <details className="panel compact-disclosure"><summary>Planning backup & restore</summary><div><p>This backup contains goals and named events only, including amounts you entered. Financial records, transaction corrections, budget plans and refresh settings are not included.</p><div className="planning-form-actions"><button className="button light" onClick={download} disabled={hidden||busy}><Download size={14}/> Export planning</button><button className="button light" onClick={()=>file.current?.click()} disabled={!ALLOW_IMPORT||hidden||busy}><Upload size={14}/> Import planning</button><input disabled={!ALLOW_IMPORT} ref={file} type="file" accept="application/json,.json" hidden onChange={event=>void load(event.target.files?.[0])}/></div>{hidden&&<p>Show amounts to export or restore planning.</p>}{pending&&!hidden&&<div className="planning-import-confirm"><strong>Replace saved planning?</strong><p>The selected file has {Object.values(pending.goals).filter(value=>value&&typeof value==="object").length} set goals and {pending.events.length} named events. This replaces your current goals and events after validation against the saved ledger.</p><button className="button primary" onClick={confirm} disabled={CLIENT_READ_ONLY||busy}>Replace with this planning backup</button><button className="button light" onClick={()=>setPending(null)} disabled={busy}>Cancel</button></div>}{error&&<p role="alert" className="planning-error">{error}</p>}</div></details>;
}
