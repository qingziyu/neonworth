"use client";

import { clientFetch as fetch } from "@/lib/client-transport";

import { useEffect, useMemo, useState } from "react";
import { budgetPlanSchema, summarizeBudget, type BudgetPlan } from "@/lib/budget";
import { money, type Dataset } from "@/lib/finance";
import type { PeriodMode } from "@/lib/periods";
import "./spending-composition.css";

/** Same contract as Budget's onTransactions: exact source IDs, the period mode and its anchor month. */
export type SpendingCompositionOpen = (ids: string[], mode?: PeriodMode, anchorMonth?: string) => void;

const cents = (value: number) => Math.round(value * 100);

export default function SpendingComposition({ data, month, periodMode, hidden, onTransactions }: {
  data: Dataset; month: string; periodMode: PeriodMode; hidden: boolean; onTransactions?: SpendingCompositionOpen;
}) {
  const [plan, setPlan] = useState<BudgetPlan | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/budget", { cache: "no-store", signal: controller.signal }).then(async response => {
      const result = await response.json() as {plan?: unknown};
      if (response.ok && result.plan) setPlan(budgetPlanSchema.parse(result.plan) as BudgetPlan);
    }).catch(() => {});
    return () => controller.abort();
  }, []);
  const summary = useMemo(() => plan ? summarizeBudget(data, month, periodMode, plan) : null, [data, month, periodMode, plan]);
  if (!summary) return null;
  // Partitions reuse the budget rows' own IDs and signed totals; credits are
  // already inside each row's net and are never added or subtracted again.
  const fixedRows = summary.annualRows.filter(row => row.id === "annual_bills");
  const choiceRows = summary.annualRows.filter(row => row.id !== "annual_bills");
  const fixed = fixedRows.reduce((total, row) => total + cents(row.actual), 0) / 100;
  const categories = (rows: Array<{ id: string; label: string; actual: number; ids: string[] }>) => rows.filter(row => row.ids.length).map(row => ({ id: row.id, label: row.label, value: row.actual, ids: row.ids }));
  const values = [
    { key: "monthly", label: "Monthly living", value: summary.monthlyTotal, detail: "Routine", ids: summary.monthlyIds, categories: categories(summary.monthlyRows) },
    { key: "fixed", label: "Periodic fixed bills", value: fixed, detail: "Routine · paid unevenly", ids: fixedRows.flatMap(row => row.ids), categories: categories(fixedRows) },
    { key: "choices", label: "Annual choices", value: (cents(summary.annualTotal) - cents(fixed)) / 100, detail: "Discretionary allowances", ids: choiceRows.flatMap(row => row.ids), categories: categories(choiceRows) },
    { key: "exceptional", label: "Exceptional", value: summary.exceptionalTotal, detail: "Separate funding", ids: summary.exceptionalIds, categories: [] as Array<{ id: string; label: string; value: number; ids: string[] }> },
  ];
  const amount = (value: number) => hidden ? "••••" : money(value, 0);
  const open = (ids: string[]) => { if (ids.length && onTransactions) onTransactions(ids, periodMode, month); };
  const withBreakdown = values.filter(item => item.categories.length);
  return <section className="spending-composition" aria-label="Recorded spending by budget purpose">
    <div className="composition-label">Recorded spending by budget purpose <span>Same dates · refunds included</span></div>
    {/* Labels and amounts open the same exact canonical IDs, period mode and anchor month. ARIA text carries counts only, never amounts. */}
    <dl>{values.map((item, index) => { const actionable = !!onTransactions && item.ids.length > 0, aria = `Open ${item.ids.length} source ${item.ids.length === 1 ? "record" : "records"} for ${item.label}`; return <div key={item.key} className={`purpose-${index}`}><dt>{actionable
      ? <button type="button" className="composition-label-open" onClick={() => open(item.ids)} aria-label={aria}><i aria-hidden="true"/>{item.label}</button>
      : <><i aria-hidden="true"/>{item.label}</>}</dt><dd>{actionable
      ? <button type="button" className="composition-open" onClick={() => open(item.ids)} aria-label={aria}>{amount(item.value)}</button>
      : amount(item.value)}</dd><small>{item.detail}</small></div>; })}</dl>
    {withBreakdown.length > 0 && <details className="composition-breakdown"><summary>Category breakdown</summary>
      {withBreakdown.map(item => <div key={item.key} className="composition-breakdown-group"><h3>{item.label}</h3><ul>{item.categories.map(category => { const aria = `Open ${category.ids.length} source ${category.ids.length === 1 ? "record" : "records"} for ${category.label}`; return <li key={category.id}>{onTransactions
        ? <><button type="button" className="composition-label-open" onClick={() => open(category.ids)} aria-label={aria}>{category.label}</button><button type="button" className="composition-open" onClick={() => open(category.ids)} aria-label={aria}>{amount(category.value)}</button></>
        : <><span>{category.label}</span><span>{amount(category.value)}</span></>}</li>; })}</ul></div>)}
      <p className="composition-note">Net of recorded credits. Categories without classified records in these dates are omitted; that does not establish zero spending.</p>
    </details>}
  </section>;
}
