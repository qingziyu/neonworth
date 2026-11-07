"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Settings2 } from 'lucide-react';
import { FinanceDialog, FinanceDialogClose, FinanceDialogDescription, FinanceDialogTitle } from '@/components/finance-dialog';
import { DEFAULT_WORKSPACE_PREFERENCES, MAX_PINNED_REPORTS, WORKSPACE_PREFERENCES_KEY, WORKSPACE_REPORTS, isWorkspaceReportId, parseStoredWorkspacePreferences, readWorkspacePreferences, validateWorkspacePreferences, writeWorkspacePreferences, type WorkspaceDensity, type WorkspaceMotion, type WorkspacePreferences, type WorkspaceReportId } from '@/lib/workspace-preferences';
import { bindWorkspaceMotionPolicy } from '@/lib/workspace-motion-policy';
import './workspace-preferences.css';

type PreferenceContext={preferences:WorkspacePreferences;ready:boolean;persistence:'available'|'saved'|'session';motionPolicy:{ready:boolean;allowed:boolean};savePreferences:(value:WorkspacePreferences)=>boolean};
const WorkspacePreferencesContext=createContext<PreferenceContext|null>(null);

/** One layout-mounted owner for display choices only. No report data or drafts. */
export function WorkspacePreferencesProvider({children}:{children:ReactNode}) {
 const [preferences,setPreferences]=useState<WorkspacePreferences>(()=>({...DEFAULT_WORKSPACE_PREFERENCES,pinnedReports:[]}));
 const [ready,setReady]=useState(false);
 const [persistence,setPersistence]=useState<PreferenceContext['persistence']>('available');
 const [motionPolicy,setMotionPolicy]=useState({ready:false,allowed:false});
 useEffect(()=>{
  const stored=readWorkspacePreferences(()=>window.localStorage);
  setPreferences(stored.preferences);setPersistence(stored.available?'available':'session');setReady(true);
  const changed=(event:StorageEvent)=>{
   if(event.key!==WORKSPACE_PREFERENCES_KEY&&event.key!==null)return;
   try{if(event.storageArea!==window.localStorage)return;}catch{return;}
   if(event.key===WORKSPACE_PREFERENCES_KEY&&event.newValue===null){
    const fallback=readWorkspacePreferences(()=>window.localStorage);
    setPreferences(fallback.preferences);setPersistence(fallback.available?'available':'session');
   }else{
    const next=parseStoredWorkspacePreferences(event.key===null?null:event.newValue);
    if(next){setPreferences(next);setPersistence('available');}
   }
  };
  window.addEventListener('storage',changed);
  return()=>window.removeEventListener('storage',changed);
 },[]);
 // The layout background and page effects share one native policy subscription.
 useEffect(()=>bindWorkspaceMotionPolicy(window,document,allowed=>setMotionPolicy({ready:true,allowed})),[]);
 const savePreferences=useCallback((value:WorkspacePreferences)=>{
  const next=validateWorkspacePreferences(value);
  if(!next)throw new Error('Choose supported display settings and up to three distinct reports.');
  const persisted=writeWorkspacePreferences(()=>window.localStorage,next);
  setPreferences(next);setPersistence(persisted?'saved':'session');return persisted;
 },[]);
 const value=useMemo(()=>({preferences,ready,persistence,motionPolicy,savePreferences}),[preferences,ready,persistence,motionPolicy,savePreferences]);
 return <WorkspacePreferencesContext.Provider value={value}>{children}</WorkspacePreferencesContext.Provider>;
}

export function useWorkspacePreferences() {
 const context=useContext(WorkspacePreferencesContext);
 if(!context)throw new Error('Workspace display preferences require their layout provider.');
 return context;
}

/** Read the layout-owned policy; consumers add no native listeners. */
export function useWorkspaceMotion(){
 const {preferences,ready,motionPolicy}=useWorkspacePreferences();
 return {ready:ready&&motionPolicy.ready,allowed:motionPolicy.ready&&motionPolicy.allowed,enabled:ready&&motionPolicy.ready&&preferences.motion==='expressive'&&motionPolicy.allowed};
}

export function WorkspacePreferencesFields({density,motion,pins,onDensity,onMotion,onPin}:{density:WorkspaceDensity;motion:WorkspaceMotion;pins:Array<WorkspaceReportId|''>;onDensity:(value:WorkspaceDensity)=>void;onMotion:(value:WorkspaceMotion)=>void;onPin:(index:number,value:WorkspaceReportId|'')=>void}) {
 return <div className="workspace-preferences-controls">
  <label>Layout density<select value={density} onChange={event=>{if(event.target.value==='comfortable'||event.target.value==='compact')onDensity(event.target.value);}}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label>
  <div><label>Motion<select value={motion} aria-describedby="workspace-motion-description" onChange={event=>{if(event.target.value==='expressive'||event.target.value==='quiet')onMotion(event.target.value);}}><option value="expressive">Expressive</option><option value="quiet">Quiet</option></select></label><p id="workspace-motion-description" className="workspace-preferences-hint">Expressive adds continuous digital rain, ambient artwork, reactive light and brief transitions. Pause motion in any page header, or choose Quiet to keep the design still. Your system’s reduced-motion setting always takes priority.</p></div>
  <fieldset><legend>Pinned reports</legend><p>Choose up to three reports, in the order you want them.</p>
   {pins.map((pin,index)=><label key={index}>Shortcut {index+1}<select value={pin} onChange={event=>{const value=event.target.value;if(value!==''&&(!isWorkspaceReportId(value)||pins.some((other,position)=>position!==index&&other===value)))return;onPin(index,value);}}><option value="">No pinned report</option>{WORKSPACE_REPORTS.map(report=><option key={report.id} value={report.id} disabled={pins.some((other,position)=>position!==index&&other===report.id)}>{report.label}</option>)}</select></label>)}
  </fieldset>
 </div>;
}

/** Existing Radix adapter handles focus and dismissal. Changes apply on Save. */
export function WorkspacePreferencesControl({container}:{container:Element|null}) {
 const {preferences,ready,persistence,savePreferences}=useWorkspacePreferences();
 const opener=useRef<HTMLButtonElement>(null);
 const [open,setOpen]=useState(false),[density,setDensity]=useState<WorkspaceDensity>('comfortable');
 const [motion,setMotion]=useState<WorkspaceMotion>('expressive');
 const [pins,setPins]=useState<Array<WorkspaceReportId|''>>(['','','']);
 const [feedback,setFeedback]=useState('');
 const begin=()=>{setDensity(preferences.density);setMotion(preferences.motion);setPins(Array.from({length:MAX_PINNED_REPORTS},(_,index)=>preferences.pinnedReports[index]??''));setFeedback('');setOpen(true);};
 const save=()=>{
  try{
   const persisted=savePreferences({version:2,density,motion,pinnedReports:pins.filter(isWorkspaceReportId)});
   setFeedback(persisted?'Display preferences saved in this browser.':'Applied in this tab. Browser storage is unavailable, so these choices may reset when you reopen the site.');
   if(persisted)setOpen(false);
  }catch{setFeedback('Choose supported display settings and up to three distinct reports.');}
 };
 return <>
  <button ref={opener} type="button" className="button light workspace-preferences-trigger" aria-label="Personalize workspace" title="Display preferences" disabled={!ready} onClick={begin}><Settings2 size={17}/><span>Personalize</span></button>
  {!open&&feedback&&<span className="workspace-preferences-announcement" role="status">{feedback}</span>}
  <FinanceDialog open={open} busy={false} onDismiss={()=>{setOpen(false);setFeedback('');}} container={container} getReturnFocus={()=>opener.current} getFallbackFocus={()=>document.getElementById('main-content')} className="modal workspace-preferences-dialog">
   <FinanceDialogTitle asChild><h2>Make this workspace yours</h2></FinanceDialogTitle>
   <FinanceDialogDescription asChild><p>Choose your layout, motion and quick links. These display choices are saved in this browser and do not change your finances.</p></FinanceDialogDescription>
   <WorkspacePreferencesFields density={density} motion={motion} pins={pins} onDensity={setDensity} onMotion={setMotion} onPin={(index,value)=>setPins(current=>current.map((item,position)=>position===index?value:item))}/>
   {persistence==='session'&&!feedback&&<p className="workspace-preferences-feedback" role="status">Browser storage is unavailable. Your choices can still apply in this tab.</p>}
   {feedback&&<p className="workspace-preferences-feedback" role="status">{feedback}</p>}
   <div className="workspace-preferences-actions"><button type="button" className="button light" onClick={()=>{setDensity('comfortable');setMotion('expressive');setPins(['','','']);setFeedback('Default choices selected. Save to apply them.');}}>Reset choices</button><FinanceDialogClose asChild><button type="button" className="button light">Cancel</button></FinanceDialogClose><button type="button" className="button primary" onClick={save}>Save display preferences</button></div>
  </FinanceDialog>
 </>;
}
