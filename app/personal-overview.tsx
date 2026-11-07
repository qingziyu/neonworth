"use client";
import { PointerLight } from "./workspace-effects";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRight, ArrowUpRight, Check, ChevronDown, ChevronLeft, ChevronRight, Files, ListChecks, ReceiptText, Target, Wallet } from "lucide-react";
import { money, type Dataset, type Transaction, type summarizePeriod } from "@/lib/finance";
import type { PeriodMode } from "@/lib/periods";
import { summarizeDataHealth } from "@/lib/data-health";
import { summarizeReview } from "@/lib/review";
import { accountDisplayName, transactionDisplayName } from "@/lib/classification";
import { refreshTextForDisplay } from "@/lib/refresh-status";

export interface PersonalOverviewProps {
  motionEnabled?: boolean;
  data: Dataset;
  month: string;
  periodMode: PeriodMode;
  hidden: boolean;
  summary: Pick<ReturnType<typeof summarizePeriod>, "spending" | "cashSaved" | "appleCardPaymentCount">;
  periodLabel: string;
  budget: ReactNode;
  chart: ReactNode;
  chartLegend?: ReactNode;
  categories: ReactNode;
  reconciliation: ReactNode;
  netWorth: { value: number; date: string } | null;
  onEdit: (transaction: Transaction) => void;
  onReview: (findingId?: string) => void;
  onData: () => void;
  onGoals: () => void;
  onNetWorth: () => void;
  onBills: () => void;
  onIncome: () => void;
  onSpending: () => void;
}

const HISTORY_PAGE_SIZE = 6;
const dateLabel = (date: string) => new Date(`${date.slice(0,10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const countLabel = (count: number, singular: string, plural = `${singular}s`) => `${count} ${count === 1 ? singular : plural}`;

/** Presentation pagination only; callers provide the canonical accounting rows.
 * Opening a row passes that exact record, without a period-filtered ledger hop. */
export function AccountingHistoryRecords({ rows, data, hidden, page, onPage, onEdit }: {
  rows: Transaction[]; data: Dataset; hidden: boolean; page: number;
  onPage: (page: number) => void; onEdit: (transaction: Transaction) => void;
}) {
  const pages = Math.max(1, Math.ceil(rows.length / HISTORY_PAGE_SIZE));
  const current = Math.max(0, Math.min(page, pages - 1));
  const shown = rows.slice(current * HISTORY_PAGE_SIZE, (current + 1) * HISTORY_PAGE_SIZE);
  return <div className="workspace-history">
    <ul className="workspace-history-list">
      {shown.map(transaction => {
        const account = data.accounts.find(item => item.id === transaction.accountId);
        const name = refreshTextForDisplay(transactionDisplayName(transaction, account), hidden);
        return <li key={transaction.id}><button type="button" className="workspace-history-record" onClick={() => onEdit(transaction)} aria-label={`Open accounting record: ${name}, ${dateLabel(transaction.date)}`}>
          <span className="workspace-history-identity"><strong>{name}</strong><small>{dateLabel(transaction.date)} · {refreshTextForDisplay(account ? accountDisplayName(account) : "Source account", hidden)}</small></span>
          <span className="workspace-history-value">{hidden ? "••••" : money(transaction.amount, 2)}<ArrowUpRight size={14} aria-hidden="true" /></span>
        </button></li>;
      })}
    </ul>
    {pages > 1 && <div className="workspace-history-pagination" aria-label="Accounting history pages">
      <span aria-live="polite">{current * HISTORY_PAGE_SIZE + 1}–{Math.min((current + 1) * HISTORY_PAGE_SIZE, rows.length)} of {rows.length}</span>
      <div><button type="button" aria-label="Previous accounting records" disabled={current === 0} onClick={() => onPage(current - 1)}><ChevronLeft size={17} aria-hidden="true" /></button><button type="button" aria-label="Next accounting records" disabled={current === pages - 1} onClick={() => onPage(current + 1)}><ChevronRight size={17} aria-hidden="true" /></button></div>
    </div>}
  </div>;
}

export default function PersonalOverview(props: PersonalOverviewProps) {
  const { motionEnabled = false, data, month, periodMode, hidden, summary, periodLabel, budget, chart, chartLegend, categories, reconciliation, netWorth, onEdit, onReview, onData, onGoals, onNetWorth, onBills, onIncome, onSpending } = props;
  const health = useMemo(() => summarizeDataHealth(data), [data]);
  const review = useMemo(() => summarizeReview(data, month, periodMode), [data, month, periodMode]);
  const history = useMemo(() => [...health.accounting].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)), [health]);
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [month, periodMode]);
  const selectedCount = review.accountingReviewTransactionIds.length;
  const duplicateChecks = review.openFindings.filter(finding => finding.kind === "similar-charge");
  const fmt = (amount: number) => hidden ? "••••" : money(amount, 0);
  const selectedLabel = periodMode === "month" ? "Selected month" : periodMode === "ytd" ? "Year to date" : "Past year";

  return <div className="personal-overview">
    <section className="workspace-summary" aria-labelledby="workspace-summary-title">
      <div className="workspace-summary-main">
        <div className="workspace-summary-heading"><h2 id="workspace-summary-title">Your period, at a glance</h2><span>{periodLabel}</span></div>
        <div className="workspace-summary-figures">
          <div className="workspace-spending"><span>Net spending</span><strong>{fmt(summary.spending)}</strong><p>{summary.appleCardPaymentCount > 0 ? "Posted purchases and Apple Card proxy, less refunds" : "Posted purchases, less refunds"}</p></div>
          <div className="workspace-cash"><span>Cash-only surplus</span><strong>{fmt(summary.cashSaved)}</strong><p>Cash income − net spending</p></div>
        </div>
      </div>
      <div className="workspace-summary-budget">{budget}</div>
    </section>

    <section className="workspace-attention workspace-card" aria-labelledby="workspace-attention-title">
      <div className="workspace-card-heading"><h2 id="workspace-attention-title">Attention</h2><ListChecks size={21} aria-hidden="true" /></div>
      <p className="workspace-attention-intro">Accounting records</p>
      <div className="workspace-attention-counts">
        <div><strong>{selectedCount}</strong><span>{selectedLabel}</span></div>
        <div className={history.length ? "workspace-count-open" : ""}><strong>{history.length}</strong><span>Saved history</span></div>
      </div>
      {selectedCount === 0 && history.length > 0 && <p className="workspace-attention-scope">Saved history still has accounting records to resolve.</p>}
      {history.length > 0 && <details className="workspace-accounting-disclosure">
        <summary><span>Inspect {countLabel(history.length, "accounting record")}</span><ChevronDown size={17} aria-hidden="true" /></summary>
        <p>Saved history · {dateLabel(health.start)}–{dateLabel(health.end)}. Open a record directly to inspect its evidence or apply a decision.</p>
        <AccountingHistoryRecords rows={history} data={data} hidden={hidden} page={page} onPage={setPage} onEdit={onEdit} />
      </details>}
      {duplicateChecks.length > 0 && <button type="button" className="workspace-attention-check" onClick={() => onReview(duplicateChecks[0].id)}><Files size={17} aria-hidden="true" /><span><strong>{countLabel(duplicateChecks.length, "duplicate check")}</strong><small>Selected period · separate from accounting flags</small></span><ArrowRight size={15} aria-hidden="true" /></button>}
      {health.possibleReplacements.length > 0 && <button type="button" className="workspace-attention-check" onClick={onData}><Files size={17} aria-hidden="true" /><span><strong>{countLabel(health.possibleReplacements.length, "possible source replacement")}</strong><small>Saved history · inspect retained and matching records</small></span><ArrowRight size={15} aria-hidden="true" /></button>}
      {history.length === 0 && <div className="workspace-attention-clear"><Check size={17} aria-hidden="true" /><span>No unresolved accounting records in saved history.</span></div>}
      <div className="workspace-attention-footer"><button type="button" className="workspace-link" onClick={() => onReview(review.contextFindings[0]?.id)}>Optional insights · {review.contextFindings.length} <ArrowRight size={14} aria-hidden="true" /></button><button type="button" className="workspace-link workspace-link-muted" onClick={onData}>Full audit <ArrowRight size={14} aria-hidden="true" /></button></div>
    </section>

    <section className="workspace-flow workspace-card" aria-labelledby="workspace-flow-title">
      <div className="workspace-card-heading"><div><span className="workspace-kicker">Money in, money out</span><h2 id="workspace-flow-title">Income & spending</h2></div>{chartLegend}</div>
      <div className="workspace-chart-slot">{chart}</div>
      <div className="workspace-card-footer"><p>Monthly buckets within the selected dates</p><button type="button" className="workspace-link" onClick={onIncome}>Income evidence <ArrowRight size={14} aria-hidden="true" /></button></div>
    </section>

    <section className="workspace-categories workspace-card" aria-labelledby="workspace-categories-title">
      <div className="workspace-card-heading"><div><span className="workspace-kicker">Follow the details</span><h2 id="workspace-categories-title">Where your spending went</h2></div><button type="button" className="workspace-link" onClick={onSpending}>View all <ArrowRight size={14} aria-hidden="true" /></button></div>
      {categories}
      <p className="workspace-category-hint">Open a category to see its source transactions.</p>
    </section>

    <section className="workspace-planning" aria-label="Planning and recorded position">
      <PointerLight className="workspace-fire-surface" tone="violet" enabled={motionEnabled}><button type="button" className="workspace-fire-link" onClick={onGoals}>
        <span className="workspace-action-sheen" aria-hidden="true"/>
        <span className="workspace-plan-icon"><Target size={22} aria-hidden="true" /></span>
        <span className="workspace-fire-copy"><span className="workspace-kicker">A longer view</span><strong>Your FIRE plan</strong><span>Open your withdrawal plan, eligible assets and future target date.</span><span className="workspace-plan-action">Open FIRE dashboard <ArrowRight size={15} aria-hidden="true" /></span></span>
      </button></PointerLight>
      <button type="button" className="workspace-position-link" onClick={onNetWorth}><Wallet size={19} aria-hidden="true" /><span><span>Recorded net worth</span><strong>{netWorth ? fmt(netWorth.value) : "Not available"}</strong><small>{netWorth ? `Recorded ${dateLabel(netWorth.date)}` : "No dated snapshot on or before this period’s end"}</small></span><ArrowUpRight size={17} aria-hidden="true" /></button>
      <button type="button" className="workspace-bills-link" onClick={onBills}><ReceiptText size={19} aria-hidden="true" /><span><strong>Bills & commitments</strong><small>Recorded charges and saved service decisions</small></span><ArrowRight size={17} aria-hidden="true" /></button>
    </section>

    <div className="workspace-reconciliation">{reconciliation}</div>
  </div>;
}
