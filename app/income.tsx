"use client";

import { refreshTextForDisplay } from "@/lib/refresh-status";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, FileSearch, Layers3, Search, Wallet } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartBarSkin } from './chart-bar';
import { money, type Dataset, type Transaction } from "@/lib/finance";
import { summarizeIncome, type IncomeEvent } from "@/lib/income";
import { resolvePeriod, type PeriodMode } from "@/lib/periods";
import { transactionNoteForDisplay } from "@/lib/history-reconciliation";
import RsuWithholding from "./rsu-withholding";

type Props = { data: Dataset; month: string; periodMode: PeriodMode; hidden: boolean; onEdit: (transaction: Transaction) => void };
const dateLabel = (date: string) => new Date(`${date.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const shortMoney = (value: number) => Math.abs(value) >= 1000 ? `$${(value / 1000).toFixed(Math.abs(value) >= 10000 ? 0 : 1)}k` : `$${Math.round(value)}`;
const eventLabels: Record<IncomeEvent["kind"], string> = { payroll: "Cash income", interest: "Bank interest", dividend: "Investment distribution", other: "Other credit / contribution", rsu_receipt: "Received RSUs", rsu_sale: "Stock-sale proceeds", rsu_withholding: "Settled RSU tax journal · no second deduction", review: "Credit to review" };

function IncomeTooltip({ active, payload, label, hidden }: any) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip"><strong>{label}</strong>{payload.filter((item: any) => item.value !== 0 && item.value !== null).map((item: any) => <div key={item.dataKey}><span style={{ color: item.color }}>{item.name}</span><b>{hidden ? "••••" : money(Number(item.value), 2)}</b></div>)}</div>;
}

export default function Income({ data, month, periodMode, hidden, onEdit }: Props) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const period = useMemo(() => resolvePeriod(data, month, periodMode), [data, month, periodMode]);
  const summary = useMemo(() => summarizeIncome(data, Number(month.slice(0, 4)), month, periodMode), [data, month, periodMode]);
  const fmt = (amount: number | null, digits = 0) => amount === null ? "—" : hidden ? "••••" : money(amount, digits);
  const mask = (text: string) => refreshTextForDisplay(text, hidden);
  const accountName = (id: string) => { const account = data.accounts.find(item => item.id === id); const officialName = account ? (account as typeof account & {officialName?:string|null}).officialName : null; return mask(account ? `${account.institution} · ${officialName || account.name}${account.mask ? ` · ${account.mask}` : ""}` : "Source account"); };
  const transactionIndex = useMemo(() => new Map(data.transactions.map(item => [item.id, item])), [data]);
  const incomeEvents = useMemo(() => summary.events.filter(event => event.includedInCashIncome || event.kind === "rsu_receipt").sort((a, b) => b.date.localeCompare(a.date)), [summary]);
  const otherEvents = useMemo(() => summary.events.filter(event => !event.includedInCashIncome && event.kind !== "rsu_receipt").sort((a, b) => b.date.localeCompare(a.date)), [summary]);
  const rows = useMemo(() => incomeEvents.filter(event => !search || `${event.description} ${accountName(event.accountId)} ${eventLabels[event.kind]}`.toLowerCase().includes(search.toLowerCase())), [incomeEvents, search, data.accounts]);
  const sourceAccounts = summary.accounts.filter(account => account.employerCashIncome > 0 || (account.rsuReceiptValue ?? 0) > 0);
  const chartRows = summary.monthly.map(row => ({ ...row, label: periodMode === "year" ? new Date(`${row.month}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }) : row.label }));
  const surplus = summary.effectiveSavings;
  const ratio = summary.effectiveIncome && surplus !== null ? surplus / summary.effectiveIncome * 100 : null;
  useEffect(() => setPage(0), [month, periodMode, search]);

  return <div className="income-page financial-review">
    <div className="financial-section-intro"><div><div className="eyebrow">INCOME · {period.label.toUpperCase()}</div><h2>Cash income & received RSUs</h2><p>{dateLabel(summary.start)} – {dateLabel(summary.end)}. Explicitly classified posted bank receipts count as cash income. Recorded shares use verified receipt-date prices; later sales stay separate.</p></div></div>
    <div className="income-metric-grid">
      {[
        { label: "Income", value: fmt(summary.effectiveIncome), note: "Cash income + recorded RSU receipts", icon: ArrowDownLeft },
        { label: "Spending", value: fmt(summary.spending), note: "Recorded expenses and purchase refunds", icon: ArrowUpRight },
        { label: "Tracking surplus", value: fmt(surplus), note: "Cash + recorded RSU receipts − net spending", icon: Wallet },
        { label: "Tracking surplus ratio", value: hidden ? "••••" : ratio === null ? "—" : `${ratio.toFixed(1)}%`, note: "Uses recorded received RSU shares", icon: Layers3 },
      ].map(metric => <section className="income-metric" key={metric.label}><span className="income-metric-label">{metric.label}<metric.icon size={17} /></span><strong>{metric.value}</strong><small>{metric.note}</small></section>)}
    </div>
    <p className="financial-model-note">Equity valuation uses recorded received shares × verified receipt-date price. Gross or after-tax compensation is not inferred; tax journals remain separate. This tracking surplus includes received equity and is not available bank cash. {summary.unpricedRsuReceiptCount > 0 ? `${summary.unpricedRsuReceiptCount} share receipt${summary.unpricedRsuReceiptCount === 1 ? " is" : "s are"} missing a receipt-date price. ` : ""}Investment history may be incomplete.</p>
    <RsuWithholding data={data} summary={summary} hidden={hidden}/>

    <div className="income-main-grid">
      <section className="panel"><div className="panel-head"><div><div className="eyebrow">MONTHLY HISTORY</div><h2>Income over time</h2></div></div>
        {hidden ? <div className="chart-private">Show amounts to view this chart.</div> : <div className="income-source-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartRows} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}><CartesianGrid vertical={false} stroke="var(--chart-grid)" /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "var(--muted)" }} /><YAxis tickFormatter={hidden ? () => "•••" : shortMoney} axisLine={false} tickLine={false} width={58} tick={{ fontSize: 11, fill: "var(--muted)" }} /><Tooltip content={<IncomeTooltip hidden={hidden} />} /><Bar shape={<ChartBarSkin />} isAnimationActive={false} name="Cash income" dataKey="employerCashIncome" stackId="income" fill="var(--chart-cash)" maxBarSize={30} /><Bar shape={<ChartBarSkin />} isAnimationActive={false} name="Received RSUs" dataKey="rsu" stackId="income" fill="var(--chart-equity)" maxBarSize={30} radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div>}
        <div className="income-chart-legend"><span><i style={{ background: "var(--chart-cash)" }} />Cash income</span><span><i style={{ background: "var(--chart-equity)" }} />Received RSUs</span></div><p className="panel-note">Available records only. A gap does not establish zero income.</p>
      </section>
      <section className="panel"><div className="eyebrow">TWO INCOME SOURCES</div><h2>What counts as income</h2><div className="financial-source-totals"><div><span>Cash income<small>Posted bank receipts classified as income</small></span><strong>{fmt(summary.employerCashIncome, 2)}</strong></div><div><span>Received RSUs<small>{hidden ? "••••" : summary.rsuShares.toLocaleString("en-US", { maximumFractionDigits: 4 })} recorded shares × receipt-date close</small></span><strong>{fmt(summary.rsuReceiptValue, 2)}</strong></div></div><div className="financial-source-accounts">{sourceAccounts.map(account => <div key={account.accountId}><span>{mask(account.accountLabel)}</span><strong>{fmt(account.effectiveIncome, 2)}</strong></div>)}</div><div className="financial-cash-comparison"><span>Cash surplus<small>Cash income minus net spending</small></span><strong>{fmt(summary.cashSaved, 2)}</strong></div><p className="panel-note">Transfers, refunds, unclassified credits and stock-sale proceeds are excluded from income. Payment rails alone do not determine classification.</p></section>
    </div>

    <section className="panel income-ledger" id="income-ledger"><div className="panel-head"><div><div className="eyebrow">CHECKING DEPOSITS & SHARE RECEIPTS</div><h2>Income history</h2></div><span className="pill">{incomeEvents.length} records</span></div><div className="income-ledger-filters"><label className="search-box"><Search size={16} /><input aria-label="Search income history" placeholder="Search income or receiving account…" value={search} onChange={event => setSearch(event.target.value)} /></label></div><div className="table-wrap"><table><thead><tr><th>Date</th><th>Source / receiving account</th><th>Income type</th><th className="align-right">Income value</th><th>Details</th></tr></thead><tbody>{rows.slice(page * 15, page * 15 + 15).map(event => {
      const original = transactionIndex.get(event.sourceTransactionId || event.id);
      return <tr key={event.id}><td>{dateLabel(event.date)}</td><td><strong>{mask(event.description)}</strong><small>{accountName(event.accountId)}</small></td><td>{eventLabels[event.kind]}</td><td className="align-right txn-amount">{fmt(event.amount, 2)}{event.quantity !== undefined && <small>{hidden ? "••••" : event.quantity.toLocaleString("en-US", { maximumFractionDigits: 4 })} shares</small>}</td><td><details className="financial-record-detail"><summary>Source evidence</summary><p>{mask(event.evidence)}</p>{event.unitPrice !== undefined && <p>{fmt(event.unitPrice, 2)} per share · {event.priceBasis}<br />{event.priceSource}</p>}{original && <button className="button light" onClick={() => onEdit(original)}><FileSearch size={12} />{original.review || original.flow === "review" ? "Review transaction" : "View transaction"}</button>}</details></td></tr>;
    })}</tbody></table>{!rows.length && <div className="empty"><FileSearch size={25} /><h3>No income records in this window</h3><p>Use the shared period selector to review another window.</p></div>}</div><div className="pagination"><span>{rows.length ? `${page * 15 + 1}–${Math.min(page * 15 + 15, rows.length)} of ${rows.length}` : "0 records"}</span><div><button disabled={page === 0} onClick={() => setPage(value => value - 1)}><ChevronLeft size={14} />Previous</button><button disabled={(page + 1) * 15 >= rows.length} onClick={() => setPage(value => value + 1)}>Next<ChevronRight size={14} /></button></div></div></section>

    <details className="panel financial-disclosure" id="income-other-credits"><summary><span><strong>Other credits & stock sales</strong><small>Separate from income · {otherEvents.length} source records</small></span><span className="financial-disclosure-value">Stock sales {fmt(summary.rsuSaleProceeds)}</span></summary><div className="financial-disclosure-body"><p className="panel-note">These source records stay separate from Classified cash deposits and received RSU income. Checking reimbursements are already included in the headline.</p><div className="financial-separate-totals"><div><span>Other bank credits · excluded</span><strong>{fmt(summary.nonIncomeCredits, 2)}</strong></div><div><span>Stock-sale proceeds · excluded</span><strong>{fmt(summary.rsuSaleProceeds, 2)}</strong></div></div><div className="table-wrap"><table><thead><tr><th>Date</th><th>Source / account</th><th>Record type</th><th className="align-right">Recorded amount</th><th>Details</th></tr></thead><tbody>{otherEvents.map(event => { const original = event.sourceType === "bank" ? transactionIndex.get(event.sourceTransactionId || event.id) : undefined; return <tr key={event.id}><td>{dateLabel(event.date)}</td><td><strong>{mask(event.description)}</strong><small>{accountName(event.accountId)}</small></td><td>{eventLabels[event.kind]}</td><td className="align-right">{fmt(event.amount, 2)}</td><td><details className="financial-record-detail"><summary>{event.status === "review" ? "Review credit" : "Source evidence"}</summary><p>{mask(event.evidence)}</p><p>{mask(original ? transactionNoteForDisplay({ ...original, note: event.note }) : event.note)}</p>{original && <button className="button light" onClick={() => onEdit(original)}><FileSearch size={12} />{original.review || original.flow === "review" ? "Review transaction" : "View transaction"}</button>}</details></td></tr>; })}</tbody></table></div></div></details>
    <details className="panel financial-disclosure"><summary><span><strong>Coverage & valuation details</strong><small>Source history and receipt-date pricing</small></span></summary><div className="financial-disclosure-body"><p>Received RSU income uses received shares × the verified regular-session closing price on the receipt date. It is a tracking convention; it does not establish tax-reporting compensation.</p><div className="table-wrap"><table><thead><tr><th>Receipt date</th><th className="align-right">Shares</th><th className="align-right">Close</th><th className="align-right">Receipt value</th><th>Price source</th></tr></thead><tbody>{summary.rsuReceiptValuations.map(receipt => <tr key={receipt.id}><td>{dateLabel(receipt.date)}</td><td className="align-right">{hidden ? "••••" : receipt.quantity}</td><td className="align-right">{fmt(receipt.price, 2)}</td><td className="align-right">{fmt(receipt.value, 2)}</td><td>{receipt.priceBasis}<small>{receipt.priceSource}</small></td></tr>)}</tbody></table></div><div className="financial-coverage-notes">{summary.coverageNotes.map((note, index) => <p key={index}>{mask(note)}</p>)}</div></div></details>
  </div>;
}
