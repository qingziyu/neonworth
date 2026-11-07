"use client";

import { clientFetch as fetch } from "@/lib/client-transport";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { budgetPlanSchema, summarizeBudget, type BudgetPlan } from "@/lib/budget";
import { isReportingWindowComparable } from "@/lib/reporting-coverage";
import { money, monthLabel, type Dataset } from "@/lib/finance";

type BudgetState = "loading" | "ready" | "error";
export function OverviewBudgetCard({month,hidden,onOpen,state,hasPlan,comparable,remaining}:{month:string;hidden:boolean;onOpen:()=>void;state:BudgetState;hasPlan:boolean;comparable:boolean;remaining:number|null}) {
  const available=state==="ready"&&hasPlan&&comparable&&remaining!==null;
  const label=available?(remaining<0?"Over monthly living budget":"Monthly living left"):"Monthly living budget";
  const fmt=(value:number)=>hidden?"••••":money(value,0);
  return <section className="metric overview-budget">
    <div className="metric-label">{label} · {monthLabel(month)}</div>
    <strong>{state==="loading"?"Loading…":state==="error"?"Unavailable":!hasPlan?"Not set":!available?"Not comparable":fmt(Math.abs(remaining))}</strong>
    <small>{state==="error"?"Open Budget to retry the saved plan":!hasPlan?"Open Budget to review your plan":!available?"Recorded history cannot establish a full comparison":remaining<0?"Over the monthly ceiling":"Ceiling less recorded monthly living"}</small>
    <button className="text-link" onClick={onOpen}>View budget <ArrowRight size={13}/></button>
  </section>;
}

export default function OverviewBudget({ data, month, hidden, onOpen }: {
  data: Dataset; month: string; hidden: boolean; onOpen: () => void;
}) {
  const [plan, setPlan] = useState<BudgetPlan | null>(null);
  const [state, setState] = useState<BudgetState>("loading");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/budget", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const value = await response.json() as {plan: unknown};
        if (!response.ok) throw new Error("Budget unavailable");
        setPlan(value.plan === null ? null : budgetPlanSchema.parse(value.plan) as BudgetPlan);
        setState("ready");
      }).catch(error => { if (error.name !== "AbortError") setState("error"); });
    return () => controller.abort();
  }, []);
  const summary = useMemo(() => plan ? summarizeBudget(data, month, "month", plan) : null, [data, month, plan]);
  const comparable = summary ? isReportingWindowComparable(data, summary.selectedMonth.period) : false;
  const remaining = summary?.selectedMonth.remaining ?? null;
  return <OverviewBudgetCard month={month} hidden={hidden} onOpen={onOpen} state={state} hasPlan={!!plan} comparable={comparable} remaining={remaining}/>;
}
