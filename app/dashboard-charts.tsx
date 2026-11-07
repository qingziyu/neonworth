"use client";

import { useId } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartBarSkin } from './chart-bar';
import { money, labelCategory, type summarizePeriod } from '@/lib/finance';
import { SpendingHatch } from './chart-primitives';

const currency=(value:number)=>money(value,0);
const short=(value:number)=>Math.abs(value)>=1000?`$${(value/1000).toFixed(Math.abs(value)>=10000?0:1)}k`:`$${Math.round(value)}`;
const prettyDate=(value:string)=>new Date(`${value.slice(0,10)}T12:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
function ChartTip({active,payload,label,hidden}:any) {
 if(!active||!payload?.length)return null;
 return <div className="chart-tooltip"><strong>{label}</strong>{payload.filter((entry:any)=>entry.value!==null).map((entry:any,index:number)=><div key={index}><span style={{color:entry.dataKey==='spending'?'var(--chart-spending)':entry.color}}>{entry.name}</span><b>{hidden?'••••':currency(Number(entry.value))}</b></div>)}</div>;
}

// These components receive the existing calculated series without recalculating,
// sorting, sampling, or retaining financial data outside React props.
export function IncomeSpendingChart({trend,hidden,cash=false}:{trend:ReturnType<typeof summarizePeriod>['trend'];hidden:boolean;cash?:boolean}) {
 const patternId=`spending-bars-${useId()}`;
 return hidden?<div className="chart-private">Show amounts to view this chart.</div>:<div className="chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={trend} barGap={4} margin={{top:10,right:5,left:0,bottom:0}}><defs><SpendingHatch id={patternId}/></defs><CartesianGrid vertical={false} stroke="var(--chart-grid)"/><XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={14} tick={{fill:'var(--muted)',fontSize:11}}/><YAxis tickFormatter={short} axisLine={false} tickLine={false} tick={{fill:'var(--muted)',fontSize:11}} width={58}/><Tooltip content={<ChartTip hidden={hidden}/>}/><Bar shape={<ChartBarSkin />} isAnimationActive={false} name={cash?'Cash income':'Cash income + received RSUs'} dataKey={cash?'cashIncome':'income'} fill="var(--chart-cash)" radius={[4,4,0,0]} maxBarSize={27}/><Bar shape={<ChartBarSkin />} isAnimationActive={false} name="Net spending" dataKey="spending" fill={`url(#${patternId})`} radius={[4,4,0,0]} maxBarSize={27}/></BarChart></ResponsiveContainer></div>;
}

export function SpendingTrendChart({trend,category,hidden}:{trend:Array<{label:string;value:number}>;category:string;hidden:boolean}) {
 return hidden?<div className="chart-private">Show amounts to view this chart.</div>:<div className="chart tall"><ResponsiveContainer width="100%" height="100%"><BarChart data={trend}><CartesianGrid vertical={false} stroke="var(--chart-grid)"/><XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={12} tick={{fontSize:11,fill:'var(--muted)'}}/><YAxis tickFormatter={short} axisLine={false} tickLine={false} tick={{fontSize:11,fill:'var(--muted)'}} width={58}/><Tooltip content={<ChartTip hidden={hidden}/>}/><Bar shape={<ChartBarSkin />} isAnimationActive={false} name={category==='all'?'Net spending':labelCategory(category)} dataKey="value" fill="var(--chart-spending)" radius={[4,4,0,0]} maxBarSize={29}/></BarChart></ResponsiveContainer></div>;
}

export function NetWorthChart({points,hidden}:{points:Array<{date:string;value:number}>;hidden:boolean}) {
 return hidden?<div className="chart-private">Show amounts to view this chart.</div>:<div className="chart networth-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={points} margin={{left:0,right:10,top:20,bottom:10}}><defs><linearGradient id="wealthFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-cash)" stopOpacity={0.35}/><stop offset="100%" stopColor="var(--chart-cash)" stopOpacity={0.02}/></linearGradient></defs><CartesianGrid vertical={false} stroke="var(--chart-grid)"/><XAxis dataKey="date" axisLine={false} tickLine={false} minTickGap={55} tickFormatter={value=>prettyDate(value)} tick={{fontSize:11,fill:'var(--muted)'}}/><YAxis domain={[0,'auto']} tickFormatter={short} tick={{fontSize:11,fill:'var(--muted)'}} axisLine={false} tickLine={false} width={65}/><Tooltip content={<ChartTip hidden={hidden}/>}/><Area isAnimationActive={false} name="Recorded net worth" dataKey="value" type="linear" stroke="var(--chart-cash)" strokeWidth={2.2} fill="url(#wealthFill)"/></AreaChart></ResponsiveContainer></div>;
}
