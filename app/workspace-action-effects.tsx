"use client";

import { useEffect, useRef } from 'react';

// Independently authored, bounded activation rays; concept reference:
// https://reactbits.dev/animations/click-spark
const actions='.workspace-fire-link,.signal-action,.budget-tabs button,.review-view-toolbar button,.fire-heading .text-link';
const sheenActions='.workspace-fire-link,.signal-action';
const policyQuery='(prefers-reduced-motion: no-preference) and (forced-colors: none)';

export function bindActionBurst(container:HTMLElement,burst:HTMLElement) {
 const document=container.ownerDocument,view=document.defaultView;
 if(typeof view?.matchMedia!=='function')return()=>{};
 let policy:MediaQueryList;
 try{policy=view.matchMedia(policyQuery);}catch{return()=>{};}
 if(typeof policy?.addEventListener!=='function'||typeof policy?.removeEventListener!=='function')return()=>{};
 const rays=Array.from(burst.children).slice(0,6) as HTMLElement[];
 let animations:Animation[]=[],alive=true;
 let observer:IntersectionObserver|undefined;
 const IntersectionObserverClass=(view as Window&{IntersectionObserver?:typeof IntersectionObserver}).IntersectionObserver;
 const cancel=()=>{for(const animation of animations)animation.cancel();animations=[];burst.style.visibility='hidden';observer?.disconnect();observer=undefined;};
 const activate=(event:MouseEvent)=>{
  if(!alive||!policy.matches||container.ownerDocument.hidden||event.button!==0||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey)return;
  const target=event.target as Element|null;
  const action=target?.closest?.(actions) as HTMLElement|null;
  if(!action||!container.contains(action)||action.matches(':disabled,[aria-disabled="true"]')||action.closest('[inert]'))return;
  const rect=action.getBoundingClientRect();
  if(rect.width<=0||rect.height<=0||rect.bottom<=0||rect.right<=0||view.innerWidth>0&&rect.left>=view.innerWidth||view.innerHeight>0&&rect.top>=view.innerHeight||!rays.length||!rays.every(ray=>typeof ray.animate==='function'))return;
  cancel();
  const pointer=event.detail>0&&Number.isFinite(event.clientX)&&Number.isFinite(event.clientY);
  const x=pointer?Math.max(rect.left,Math.min(rect.right,event.clientX)):rect.left+rect.width/2;
  const y=pointer?Math.max(rect.top,Math.min(rect.bottom,event.clientY)):rect.top+rect.height/2;
  burst.style.left=`${x}px`;burst.style.top=`${y}px`;burst.style.visibility='visible';
  try{
   rays.forEach((ray,index)=>animations.push(ray.animate([
    {transform:`rotate(${index*60}deg) translateX(7px) scaleX(.3)`,opacity:0},
    {transform:`rotate(${index*60}deg) translateX(26px) scaleX(1)`,opacity:.9,offset:.22},
    {transform:`rotate(${index*60}deg) translateX(64px) scaleX(.2)`,opacity:0},
   ],{duration:420,easing:'cubic-bezier(.16,1,.3,1)',iterations:1})));
  }catch{cancel();return;}
  // Only the current batch can hide itself after rapid successive activation.
  const batch=animations;
  animations.at(-1)!.onfinish=()=>{if(animations===batch)cancel();};
  if(IntersectionObserverClass){
   try{
    observer=new IntersectionObserverClass(entries=>{
     if(!alive||animations!==batch)return;
     const latest=entries.filter(entry=>entry.target===action).at(-1);
     if(!action.isConnected||!container.contains(action)||latest&&!latest.isIntersecting)cancel();
    });
    observer.observe(action);
   }catch{cancel();}
  }
 };
 const visibility=()=>{if(container.ownerDocument.hidden)cancel();};
 container.addEventListener('click',activate,true);
 policy.addEventListener('change',cancel);
 document.addEventListener('visibilitychange',visibility);
 // Fixed rays must not stay behind when their action moves. This also works
 // without IntersectionObserver, and schedules no follow-up work.
 document.addEventListener('scroll',cancel,true);
 view.addEventListener('resize',cancel);
 return()=>{alive=false;cancel();container.removeEventListener('click',activate,true);policy.removeEventListener('change',cancel);document.removeEventListener('visibilitychange',visibility);document.removeEventListener('scroll',cancel,true);view.removeEventListener('resize',cancel);};
}

/** Fresh input alone starts a sheen; visibility or policy restoration never does. */
export function bindActionSheen(container:HTMLElement){
 const document=container.ownerDocument,view=document.defaultView;
 if(typeof view?.matchMedia!=='function')return()=>{};
 let policy:MediaQueryList;
 try{policy=view.matchMedia(policyQuery);}catch{return()=>{};}
 if(typeof policy?.addEventListener!=='function'||typeof policy?.removeEventListener!=='function')return()=>{};
 let alive=true,animation:Animation|undefined,current:HTMLElement|null=null;
 let observer:IntersectionObserver|undefined;
 const cancel=()=>{animation?.cancel();animation=undefined;current=null;observer?.disconnect();observer=undefined;};
 const IntersectionObserverClass=(view as Window&{IntersectionObserver?:typeof IntersectionObserver}).IntersectionObserver;
 const within=(action:HTMLElement,target:EventTarget|null)=>!!target&&typeof (target as Node).nodeType==='number'&&action.contains(target as Node);
 const targetAction=(target:EventTarget|null)=>((target as Element|null)?.closest?.(sheenActions) as HTMLElement|null)??null;
 const enter=(event:PointerEvent|FocusEvent)=>{
  if(!alive||!policy.matches||document.hidden||event.type==='pointerover'&&(event as PointerEvent).pointerType!=='mouse')return;
  const action=targetAction(event.target);
  if(!action||!container.contains(action)||within(action,event.relatedTarget)||action.matches(':disabled,[aria-disabled="true"]')||action.closest('[inert]'))return;
  const sheen=action.querySelector<HTMLElement>('.workspace-action-sheen');
  if(!sheen||typeof sheen.animate!=='function')return;
  const rect=action.getBoundingClientRect();
  if(rect.width<=0||rect.height<=0||rect.bottom<=0||rect.right<=0||view.innerWidth>0&&rect.left>=view.innerWidth||view.innerHeight>0&&rect.top>=view.innerHeight)return;
  cancel();current=action;
  try{
   animation=sheen.animate([
    {clipPath:'inset(0 100% 0 0)',opacity:0,offset:0},
    {opacity:1,offset:.38},
    {clipPath:'inset(0)',opacity:.7,offset:.7},
    {clipPath:'inset(0 0 0 100%)',opacity:0,offset:1},
   ],{duration:620,easing:'cubic-bezier(.2,.6,.2,1)',iterations:1});
  }catch{cancel();return;}
  const active=animation;
  active.onfinish=()=>{if(animation===active)cancel();};
  if(IntersectionObserverClass){
   try{
    observer=new IntersectionObserverClass(entries=>{
     if(!alive||animation!==active)return;
     const latest=entries.filter(entry=>entry.target===action).at(-1);
     if(!action.isConnected||!container.contains(action)||latest&&!latest.isIntersecting)cancel();
    });
    observer.observe(action);
   }catch{cancel();}
  }
 };
 const leave=(event:PointerEvent|FocusEvent)=>{if(current&&within(current,event.target)&&!within(current,event.relatedTarget))cancel();};
 const visibility=()=>{if(document.hidden)cancel();};
 container.addEventListener('pointerover',enter);
 container.addEventListener('focusin',enter);
 container.addEventListener('pointerout',leave);
 container.addEventListener('focusout',leave);
 policy.addEventListener('change',cancel);
 document.addEventListener('visibilitychange',visibility);
 return()=>{
  alive=false;cancel();
  container.removeEventListener('pointerover',enter);
  container.removeEventListener('focusin',enter);
  container.removeEventListener('pointerout',leave);
  container.removeEventListener('focusout',leave);
  policy.removeEventListener('change',cancel);
  document.removeEventListener('visibilitychange',visibility);
 };
}

export default function WorkspaceActionEffects({container,enabled}:{container:HTMLElement|null;enabled:boolean}) {
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(enabled&&container&&ref.current){const stopBurst=bindActionBurst(container,ref.current),stopSheen=bindActionSheen(container);return()=>{stopBurst();stopSheen();};}},[container,enabled]);
 return <div ref={ref} className="workspace-action-burst" aria-hidden="true">{Array.from({length:6},(_,index)=><span key={index}/>)}</div>;
}
