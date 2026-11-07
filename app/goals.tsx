"use client";
import { CLIENT_READ_ONLY } from "@/lib/client-transport";

import { financialToday } from "@/lib/finance-config";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartBarSkin } from './chart-bar';
import { ArrowRight, ChevronDown, Pencil, Plus, Target, X } from "lucide-react";
import { money, type Dataset } from "@/lib/finance";
import { summarizeGoals, type GoalSettings, type GoalProgress } from "@/lib/goals";
import { summarizeIncome } from "@/lib/income";
import { PlanningBackup, usePlanningState } from "./planning-client";
import { ReportArt, ReportEmpty } from "./report-art";
import "./goals-surplus.css";
import FireDashboard from "./fire-dashboard";
import { validateFireGoal } from "@/lib/fire";
import { refreshTextForDisplay } from "@/lib/refresh-status";
import "./report-compositions.css";

type GoalKind = "savings" | "netWorth" | "fire";
const displayDate = (value: string) => new Date(value+"T12:00:00Z").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"});
const compactMoney = (value: number) => Math.abs(value)>=1000000 ? `$${(value/1000000).toFixed(1)}m` : Math.abs(value)>=1000 ? `$${Math.round(value/1000)}k` : money(value,0);
const maskText = refreshTextForDisplay;

export function GoalProgressView({progress,hidden}:{progress:GoalProgress;hidden:boolean}) {
  const fmt=(value:number|null)=>value===null?"Unavailable":hidden?"••••":money(value,0);
  if(progress.target===null)return <p className="goal-unset"><Target size={15}/> No target set · your choice</p>;
  return <div className="goal-progress">
    <div><span>Target {fmt(progress.target)}</span><strong>{progress.status==="unavailable"?"No comparable amount":hidden?"Progress hidden":progress.percent===null?(progress.status==="met"?"Target met":"Target set"):`${progress.percent.toFixed(1)}%`}</strong></div>
    {!hidden&&progress.barPercent!==null&&<div className="goal-progress-track" role="progressbar" aria-label="Goal progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.barPercent}><span style={{width:`${progress.barPercent}%`}}/></div>}
    {progress.remaining!==null&&<small>{hidden?"Remaining amount hidden":progress.remaining<0?`${money(Math.abs(progress.remaining),0)} above target`:`${money(progress.remaining,0)} remaining`}</small>}
  </div>;
}

/**
 * Both tracking-surplus measures for ONE explicit year. Values are income less
 * recorded net spending; not bank balances, verified savings, returns or cash
 * available. Received equity is a receipt-date valuation, not cash.
 */
export function SurplusPair({year,scopeLabel,cash,cashAndEquity,tracked,hidden}:{year:number;scopeLabel:string;cash:number|null;cashAndEquity:number|null;tracked:"cash"|"cashAndEquity"|null;hidden:boolean}){
  const value=(amount:number|null,missing:string)=>amount===null?missing:hidden?"••••":amount<0?`${money(amount,0)} deficit`:money(amount,0);
  const equityMissing=cash!==null&&cashAndEquity===null?"Unavailable · a received-share price is missing":"Unavailable";
  const row=(key:"cash"|"cashAndEquity",label:string,note:string,amount:number|null,missing:string)=><div className={`goal-surplus-measure${tracked===key?" is-tracked":""}${!hidden&&amount!==null&&amount<0?" is-deficit":""}`}><dt>{label}{tracked===key&&<span className="goal-surplus-tracks">Tracks your target</span>}</dt><dd>{value(amount,missing)}</dd><small>{note}</small></div>;
  return <dl className="goal-surplus-pair" aria-label={`${scopeLabel} ${year}: two tracking-surplus measures`}>
    {row("cash","Cash-only surplus","Cash income less recorded net spending",cash,"Unavailable")}
    {row("cashAndEquity","Cash + received equity","Adds received RSUs at receipt valuation · not cash",cashAndEquity,equityMissing)}
  </dl>;
}

function TrendTip({active,payload,label}:{active?:boolean;payload?:Array<{name:string;value:number|null;color:string}>;label?:string|number}){
  if(!active||!payload?.length)return null;
  return <div className="chart-tooltip"><strong>{label}</strong>{payload.map((item,index)=><div key={index}><span style={{color:item.color}}>{item.name}</span><b>{item.value===null?"Unavailable":money(item.value,0)}</b></div>)}</div>;
}

export function GoalEditor({kind,settings,onSave,onClose,busy=false}:{kind:GoalKind;settings:GoalSettings;onSave:(kind:GoalKind,value:GoalSettings[GoalKind])=>Promise<void>;onClose:()=>void;busy?:boolean}){
  const first=useRef<HTMLInputElement>(null),[error,setError]=useState("");
  useEffect(()=>{first.current?.focus()},[]);
  const existing=settings[kind];
  const submit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();setError("");const form=new FormData(event.currentTarget);
    const number=(name:string)=>{const raw=String(form.get(name)||"").trim();const value=Number(raw);if(!raw||!Number.isFinite(value)||value<0)throw new Error("Enter a nonnegative amount for every required field.");return value};
    const text=(name:string)=>String(form.get(name)||"").trim();
    const optionalNumber=(name:string)=>text(name)===""?undefined:Number(text(name));
    try{
      const value:GoalSettings[GoalKind]=kind==="savings"?{year:number("year"),targetAmount:number("targetAmount"),basis:text("basis") as "cash"|"cashAndEquity"}:kind==="netWorth"?{targetAmount:number("targetAmount"),targetDate:text("targetDate")}:{annualWithdrawalNeed:number("annualWithdrawalNeed"),withdrawalRatePct:number("withdrawalRatePct"),eligibleAssets:number("eligibleAssets"),valuationDate:text("valuationDate"),assetScope:text("assetScope"),...(text("targetDate")?{targetDate:text("targetDate")}:{}),...(text("annualContribution")?{annualContribution:optionalNumber("annualContribution")}:{}),...(text("realReturnPct")?{realReturnPct:optionalNumber("realReturnPct")}:{} )};
      if(kind==="fire")validateFireGoal(value as NonNullable<GoalSettings["fire"]>,financialToday());
      await onSave(kind,value);onClose();
    }catch(cause){setError(cause instanceof Error?cause.message:"Could not save this goal.")}
  };
  const remove=async()=>{try{setError("");await onSave(kind,null);onClose()}catch(cause){setError(cause instanceof Error?cause.message:"Could not remove this goal.")}};
  return <form className="planning-editor panel" onSubmit={submit} aria-labelledby="goal-editor-title">
    <div className="panel-head"><div><h2 id="goal-editor-title">{kind==="savings"?"Savings target":kind==="netWorth"?"Net-worth target":"FIRE plan & target date"}</h2><p>Only values you enter become saved planning assumptions.</p></div><button type="button" aria-label="Close goal editor" onClick={onClose} disabled={busy}><X size={18}/></button></div>
    <fieldset disabled={busy}><div className="planning-form-grid">
      {kind==="savings"&&<><label>Target amount (USD)<input ref={first} name="targetAmount" type="number" min="0" step="0.01" required defaultValue={settings.savings?.targetAmount??""}/></label><label>Calendar year<input name="year" type="number" min="1900" max="2199" step="1" required defaultValue={settings.savings?.year??new Date().getFullYear()}/></label><label className="wide">Tracking basis<select name="basis" defaultValue={settings.savings?.basis??"cash"}><option value="cash">Cash-only surplus</option><option value="cashAndEquity">Cash + received equity tracking surplus</option></select></label></>}
      {kind==="netWorth"&&<><label>Target net worth (USD)<input ref={first} name="targetAmount" type="number" min="0" step="0.01" required defaultValue={settings.netWorth?.targetAmount??""}/></label><label>Target date<input name="targetDate" type="date" required defaultValue={settings.netWorth?.targetDate??""}/></label></>}
      {kind==="fire"&&<>
        <label>Annual withdrawals (USD, today’s dollars)<input ref={first} name="annualWithdrawalNeed" type="number" min="0" step="0.01" required aria-describedby="fire-withdrawal-help" defaultValue={settings.fire?.annualWithdrawalNeed??""}/><small id="fire-withdrawal-help" className="fire-help">Your requested annual spending, including any taxes and fees paid from withdrawals.</small></label>
        <label>Withdrawal rate (%)<input name="withdrawalRatePct" type="number" min="0.01" max="100" step="0.01" required aria-describedby="fire-rate-help" defaultValue={settings.fire?.withdrawalRatePct??""}/><small id="fire-rate-help" className="fire-help">Your chosen planning rate. Portfolio target = annual withdrawals ÷ this rate.</small></label>
        <label>Current eligible assets (USD)<input name="eligibleAssets" type="number" min="0" step="0.01" required aria-describedby="fire-assets-help" defaultValue={settings.fire?.eligibleAssets??""}/><small id="fire-assets-help" className="fire-help">Cash and investments you intend to draw from. Net worth is not substituted. Enter zero if you are starting from zero.</small></label>
        <label>Current assets valued on<input name="valuationDate" type="date" max={financialToday()} required aria-describedby="fire-valuation-help" defaultValue={settings.fire?.valuationDate??""}/><small id="fire-valuation-help" className="fire-help">The actual date of the asset value above, today or earlier.</small></label>
        <label>Retirement target date<input name="targetDate" type="date" max="2199-12-31" aria-describedby="fire-target-help" defaultValue={settings.fire?.targetDate??""}/><small id="fire-target-help" className="fire-help">Choose a future date. This is separate from the current-asset valuation date.</small></label>
        <label>Annual contributions (USD, today’s dollars)<input name="annualContribution" type="number" min="0" step="0.01" aria-describedby="fire-contribution-help" defaultValue={settings.fire?.annualContribution??""}/><small id="fire-contribution-help" className="fire-help">Optional: how much you plan to add per year, spread across monthly period ends. Zero means no new contributions.</small></label>
        <label>Assumed annual real return (%)<input name="realReturnPct" type="number" min="-20" max="20" step="0.01" aria-describedby="fire-return-help" defaultValue={settings.fire?.realReturnPct??""}/><small id="fire-return-help" className="fire-help">Optional: annual growth after inflation, not a prediction. Enter both return and contributions to see a projection; zero is valid.</small></label>
        <label className="wide">Which assets are included?<textarea name="assetScope" required maxLength={500} rows={2} aria-describedby="fire-scope-help" placeholder="For example: taxable investments, retirement portfolio and cash reserved for retirement" defaultValue={settings.fire?.assetScope??""}/><small id="fire-scope-help" className="fire-help">Exclude your home and unvested equity unless deliberately funding withdrawals from them. Account access restrictions are not modeled.</small></label>
      </>}
    </div></fieldset>
    <p className="small-note">{kind==="savings"?"Surplus is income less recorded spending, not verified savings or a bank-balance change. Received RSUs use their receipt value once.":kind==="netWorth"?"Progress uses the latest valid dated observation on or before the target date. No future balance is forecast.":"Portfolio target = annual withdrawals ÷ chosen rate. No rate is assumed safe. A future-date projection uses only your entered contributions and real return; volatility, taxes, fees and account access restrictions are not modeled. Eligible assets are your inputs, not verified feed balances."}</p>
    {error&&<p className="planning-error" role="alert">{error}</p>}
    <div className="planning-form-actions"><button className="button primary" type="submit" disabled={CLIENT_READ_ONLY||busy}>{busy?"Saving…":kind==="fire"?"Save FIRE plan":"Save target"}</button><button className="button light" type="button" onClick={onClose} disabled={busy}>Cancel</button>{existing&&<button className="text-link danger" type="button" onClick={remove} disabled={busy}>Remove target</button>}</div>
  </form>;
}

export function GoalsContent({data,hidden,settings,onSave,busy,onIncome,onNetWorth,onRetirement}:{data:Dataset;hidden:boolean;settings:GoalSettings;onSave:(kind:GoalKind,value:GoalSettings[GoalKind])=>Promise<void>;busy?:boolean;onIncome:()=>void;onNetWorth:()=>void;onRetirement:()=>void}){
  const [year,setYear]=useState(Number(data.asOf.slice(0,4))),[editing,setEditing]=useState<GoalKind|null>(null);
  const summary=useMemo(()=>summarizeGoals(data,settings,year),[data,settings,year]);
  const income=useMemo(()=>summarizeIncome(data,year,`${year}-12`,"ytd"),[data,year]);
  const firstYear=Math.min(Number(data.dateRange.start.slice(0,4)),year),lastYear=Math.max(Number(data.asOf.slice(0,4)),year);
  const years=Array.from({length:lastYear-firstYear+1},(_,index)=>lastYear-index);
  const fmt=(value:number|null)=>value===null?"Unavailable":hidden?"••••":money(value,0);
  const hasSavedTargets=!!(settings.savings||settings.netWorth||settings.fire);
  const editButtons=useRef<Partial<Record<GoalKind,HTMLButtonElement|null>>>({});
  const closeEditor=()=>{const previous=editing;setEditing(null);if(previous)editButtons.current[previous]?.focus()};
  useEffect(()=>{if(hidden)setEditing(null)},[hidden]);
  const editButton=(kind:GoalKind)=><button ref={element=>{editButtons.current[kind]=element}} className="text-link" onClick={()=>setEditing(editing===kind?null:kind)} disabled={CLIENT_READ_ONLY||hidden||busy} aria-expanded={editing===kind}>{settings[kind]?<Pencil size={13}/>:<Plus size={14}/>} {kind==="fire"?(settings.fire?"Edit FIRE plan":"Set assets & target date"):settings[kind]?"Edit target":"Set target"}</button>;
  const amountsHidden=<div className="chart-private">Show amounts to view this chart.</div>;
  return <div className="goals-view">
    <div className="report-toolbar"><div><strong>Your plans, at your pace</strong><span>{hidden?"Show amounts to edit targets.":hasSavedTargets?"Review your targets as your plans change.":"Choose your own targets. Start with the one that matters to you."}</span></div><label>Trend year<select value={year} onChange={event=>setYear(Number(event.target.value))}>{years.map(value=><option key={value}>{value}</option>)}</select></label></div>
    <FireDashboard goal={settings.fire} hidden={hidden} edit={editButton("fire")}/>
    {editing==="fire"&&!hidden&&<GoalEditor key={editing} kind={editing} settings={settings} onSave={onSave} onClose={closeEditor} busy={busy}/>}
    <div className="report-section-heading"><div><span className="report-section-kicker">Your other milestones</span><h2>The targets you choose</h2></div><p>Each target keeps its own year, date and measurement basis.</p></div>
    <div className="goal-card-grid">
      <section className="panel goal-card goal-savings"><div className="goal-card-head"><div className="goal-title"><ReportArt kind="savings" compact/><h2>Savings</h2></div>{editButton("savings")}</div><span className="goal-basis">{settings.savings?"Goal year":"Trend year"} {summary.savings.year} · {summary.savings.goal?.basis==="cashAndEquity"?"Cash + equity tracking surplus":"Cash-only tracking surplus"}</span><strong className="goal-amount">{fmt(summary.savings.progress.actual)}</strong><GoalProgressView progress={summary.savings.progress} hidden={hidden}/>{!settings.savings&&<p className="goal-invitation">Choose a year, an amount, and how you want to track surplus.</p>}<SurplusPair year={summary.savings.year} scopeLabel={settings.savings?"Goal year":"Trend year"} cash={summary.savings.cashActual} cashAndEquity={summary.savings.cashAndEquityActual} tracked={summary.savings.goal?.basis??null} hidden={hidden}/><small>{summary.savings.period.empty?"No recorded period for this goal year.":`Both measures: ${displayDate(summary.savings.period.start)}–${displayDate(summary.savings.period.end)}${summary.savings.period.coverageClipped||summary.savings.period.partial?" · available history only":""}.`} Income less net spending; not verified account savings or cash available.{settings.savings&&summary.savings.year!==summary.year?` The selected trend year (${summary.year}) is shown separately below.`:""}</small></section>
      <section className="panel goal-card goal-netWorth"><div className="goal-card-head"><div className="goal-title"><ReportArt kind="netWorth" compact/><h2>Net worth</h2></div>{editButton("netWorth")}</div><span className="goal-basis">{summary.netWorth.goalObservation?`Observation · ${displayDate(summary.netWorth.goalObservation.date)}`:"No dated observation"}</span><strong className="goal-amount">{fmt(summary.netWorth.progress.actual)}</strong><GoalProgressView progress={summary.netWorth.progress} hidden={hidden}/><small>{settings.netWorth?`Target date · ${displayDate(settings.netWorth.targetDate)}`:"Put a date to your target. You can change it as your plans change."}</small></section>

    </div>
    {editing&&editing!=="fire"&&!hidden&&<GoalEditor key={editing} kind={editing} settings={settings} onSave={onSave} onClose={closeEditor} busy={busy}/>}
    <div className="report-section-heading"><div><span className="report-section-kicker">The evidence behind your plans</span><h2>Recorded history</h2></div><p>Trend year {year} · account observations and received income.</p></div>
    <div className="goals-trend-grid">
      <section className="panel"><div className="panel-head"><div><h2>Net-worth history</h2><p>{summary.netWorth.baseline&&summary.netWorth.latest?`${displayDate(summary.netWorth.baseline.date)}–${displayDate(summary.netWorth.latest.date)} · ${hidden?"••••":money(summary.netWorth.change!,0)} observed change`:"Dated observations in the selected year"}</p></div><button className="text-link" onClick={onNetWorth}>Details <ArrowRight size={13}/></button></div>
        {hidden?amountsHidden:summary.netWorth.points.length?<div className="chart" role="img" aria-label="Recorded net worth by date; observed change is not investment return"><ResponsiveContainer width="100%" height="100%"><AreaChart data={summary.netWorth.points} margin={{left:0,right:10,top:10,bottom:0}}><CartesianGrid vertical={false} stroke="var(--chart-grid)"/><XAxis dataKey="date" tickFormatter={value=>String(value).slice(5)} tick={{fontSize:11}} minTickGap={50}/><YAxis tickFormatter={compactMoney} tick={{fontSize:11}} width={65} domain={["auto","auto"]}/><Tooltip content={<TrendTip/>}/><Area name="Net worth" dataKey="value" stroke="var(--chart-cash)" strokeWidth={2} fill="var(--accent-soft)" isAnimationActive={false}/></AreaChart></ResponsiveContainer></div>:<ReportEmpty kind="netWorth" title="No dated observations in this year">{summary.netWorth.latest?"Try another year to explore the history you have saved.":"This chart needs dated net-worth observations in your saved records."}</ReportEmpty>}
        <p className="chart-note">{summary.netWorth.fullYearBaseline?"Change has a year-opening observation.":"Change uses the dated observations named above; it is not a full calendar-year measure."} Changes include transfers, market movement and coverage changes.</p>
      </section>
      <section className="panel"><div className="panel-head"><div><h2>Cash & received equity</h2><p>{year} · receipt valuation basis</p></div><button className="text-link" onClick={onIncome}>Evidence <ArrowRight size={13}/></button></div>
        {hidden?amountsHidden:summary.period.empty?<ReportEmpty kind="records" title="No recorded period in this year">Choose a year covered by your saved records.</ReportEmpty>:<div className="chart" role="img" aria-label="Monthly cash income and receipt-valued RSUs"><ResponsiveContainer width="100%" height="100%"><BarChart data={income.monthly} margin={{left:0,right:8,top:10,bottom:0}}><CartesianGrid vertical={false} stroke="var(--chart-grid)"/><XAxis dataKey="label" tick={{fontSize:11}} minTickGap={10}/><YAxis tickFormatter={compactMoney} tick={{fontSize:11}} width={58}/><Tooltip content={<TrendTip/>}/><Bar shape={<ChartBarSkin />} name="Cash income" dataKey="employerCashIncome" fill="var(--chart-cash)" radius={[3,3,0,0]} isAnimationActive={false}/><Bar shape={<ChartBarSkin />} name="Received RSUs" dataKey="rsu" fill="var(--chart-equity)" radius={[3,3,0,0]} isAnimationActive={false}/></BarChart></ResponsiveContainer></div>}
        <div className="planning-legend"><span><i style={{background:"var(--chart-cash)"}}/> Cash income {fmt(summary.cashIncome)}</span><span><i style={{background:"var(--chart-equity)"}}/> Received RSUs {fmt(summary.rsuValue)}</span></div>
        <SurplusPair year={summary.year} scopeLabel="Trend year" cash={summary.cashSurplus} cashAndEquity={summary.cashAndEquitySurplus} tracked={settings.savings&&settings.savings.year===summary.year?settings.savings.basis:null} hidden={hidden}/>
        <p className="chart-note">{summary.year} trend-year surplus{summary.period.empty?"":` · ${displayDate(summary.period.start)}–${displayDate(summary.period.end)}${summary.period.coverageClipped||summary.period.partial?" · available history only":""}`}. The chart shows income, not surplus.</p>
      </section>
    </div>
    <details className="panel compact-disclosure"><summary>Goal definitions & source limits <ChevronDown size={15}/></summary><div><p>Cash-only surplus is Cash income less recorded net spending. Cash + equity adds received RSUs at receipt-date value. Receipt value does not establish tax basis; settlement journals are shown separately. Sales and transfers are not new income. Missing equity prices stay unavailable.</p><p>{summary.coverage.explanation} {summary.netWorth.observationIssues.join(" ")}</p><p>{settings.fire?(hidden?"Your saved FIRE scenario is hidden. Show amounts to inspect all assumptions.":`${summary.fire.label}. Annual withdrawals ${money(settings.fire.annualWithdrawalNeed,0)} ÷ ${settings.fire.withdrawalRatePct}% = ${money(summary.fire.targetAmount!,0)} scenario target.`):"Enter your withdrawal need, rate, current eligible assets, valuation date and scope; add a future target date and explicit projection assumptions if wanted."}</p><button className="text-link" onClick={onRetirement}>Retirement contribution evidence <ArrowRight size={13}/></button></div></details>
  </div>;
}

export default function Goals(props:{data:Dataset;hidden:boolean;onIncome:()=>void;onNetWorth:()=>void;onRetirement:()=>void}){
  const planning=usePlanningState();
  if(!planning.value)return <section className="panel planning-state" role="status"><h2>{planning.error?"Goals could not be loaded":"Loading saved goals…"}</h2>{planning.error&&<><p>{planning.error}</p><button className="button light" onClick={planning.reload}>Retry</button></>}</section>;
  return <><div className="planning-save-status" role="status">{planning.message}</div>{planning.error&&<div className="planning-error" role="alert">{planning.error} <button className="text-link" onClick={planning.reload} disabled={planning.busy}>Reload saved planning</button></div>}<GoalsContent {...props} settings={planning.value.goals} busy={planning.busy} onSave={(group,value)=>planning.saveGoal(group,value)}/><PlanningBackup plan={planning.value} hidden={props.hidden} busy={planning.busy} onImport={planning.save}/></>;
}
