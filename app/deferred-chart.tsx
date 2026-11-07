"use client";

import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';

/** Native, one-shot observation; no scroll handler, idle timer or offscreen scan. */
export function observeChartViewport(element:Element,activate:()=>void,Observer:typeof IntersectionObserver|undefined=globalThis.IntersectionObserver) {
 if(!Observer){activate();return()=>{};}
 let listening=true;
 const observer=new Observer(entries=>{
  if(!listening||!entries.some(entry=>entry.target===element&&entry.isIntersecting))return;
  listening=false;
  observer.disconnect();
  activate();
 },{rootMargin:'160px 0px',threshold:0});
 observer.observe(element);
 return()=>{listening=false;observer.disconnect();};
}

function ChartPlaceholder({name,className,loading=false}:{name:string;className:string;loading?:boolean}) {
 return <div className={className} style={{display:'grid',placeItems:'center',fontSize:12,color:'var(--muted)'}} role="status"><span>{loading?`Loading ${name}…`:`${name} loads as you scroll`}</span></div>;
}

/** Wrap the existing chart error boundary inside this privacy/viewport gate. */
export default function DeferredChart({hidden,name,className='chart',children}:{hidden:boolean;name:string;className?:string;children:ReactNode}) {
 const placeholder=useRef<HTMLDivElement>(null);
 const [active,setActive]=useState(false);
 useEffect(()=>{
  if(hidden||active||!placeholder.current)return;
  return observeChartViewport(placeholder.current,()=>setActive(true));
 },[hidden,active]);
 // This branch removes the chart, loading state and error boundary immediately.
 // It never stores or renders an outgoing copy of the previous financial props.
 if(hidden)return <div className="chart-private">Show amounts to view this chart.</div>;
 if(!active)return <div ref={placeholder}><ChartPlaceholder name={name} className={className}/></div>;
 return <Suspense fallback={<ChartPlaceholder name={name} className={className} loading/>}>{children}</Suspense>;
}
