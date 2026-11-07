"use client";

import { useState } from "react";
import { ArrowRight, ChevronDown } from "lucide-react";
import type { Dataset } from "@/lib/finance";
import type { RefreshState } from "@/lib/refresh-model";
import { summarizeReportingCoverage } from "@/lib/reporting-coverage";
import RefreshStatus from "./refresh-status";

const date = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export default function ReportContext({ data, period, refresh, hidden, onData, showRefresh=true }: {
  data: Dataset; period?: { start: string; end: string }; refresh?: RefreshState | null;
  hidden: boolean; onData: () => void; showRefresh?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const coverage = summarizeReportingCoverage(data, period);
  const comparisonMonth = coverage.comparisonStart ? new Date(coverage.comparisonStart+"T12:00:00Z").toLocaleDateString("en-US",{month:"short",year:"numeric",timeZone:"UTC"}) : null;
  return <section className="report-context" aria-label="Source status and coverage">
    <div className="report-context-line">
      <div className="coverage-summary"><span>Recorded through {date(coverage.recorded.end)}</span><span>{comparisonMonth ? `Spending comparisons from ${comparisonMonth}` : "Spending comparison window unknown"}</span>{coverage.sourceCoverage==="limited"&&<span className="coverage-limited">Known source limits</span>}</div>
      {showRefresh&&<RefreshStatus state={refresh} importedAt={data.syncedAt} compact minimal hidden={hidden} onDetails={onData}/>}
      <button className="coverage-trigger" aria-expanded={open} aria-controls="coverage-details" onClick={() => setOpen(value => !value)}>Coverage & definitions <ChevronDown size={14}/></button>
    </div>
    {open && <div id="coverage-details" className="coverage-details">
      <div className="coverage-heading"><h2>What these numbers cover</h2><span>Saved source through {date(data.asOf)}</span></div>
      <dl className="coverage-domains">
        <div><dt>Spending & comparisons</dt><dd>Recorded transactions span {date(coverage.recorded.start)}–{date(coverage.recorded.end)}. {coverage.comparisonStart ? `Comparable recorded card spending starts ${date(coverage.comparisonStart)}; the date uses the first full saved month and the latest card’s first recorded purchase. ` : "A common comparison window has not been established. "}{coverage.explanation} A known source gap overrides this date. Missing history is not zero spending.</dd></div>
        <div><dt>Income & equity</dt><dd>Classified cash deposits include reimbursements. Explicit RSU receipts use verified receipt-date value without inferring tax basis. Transfers, purchase refunds and sale proceeds are not new income. Investment distributions are shown separately. Payment rails do not determine purpose.</dd></div>
        <div><dt>Surplus</dt><dd>Cash-only surplus subtracts net spending from Cash income. Tracking surplus also includes recorded RSU receipts; RSU tax settlement journals are not deducted again. Neither is an account balance or verified amount available to spend.</dd></div>
        <div><dt>Net worth & balances</dt><dd>{coverage.netWorth.start && coverage.netWorth.end ? `Net-worth observations run from ${date(coverage.netWorth.start)} to ${date(coverage.netWorth.end)}. ` : "No net-worth history is recorded. "}Earlier balances are not reconstructed. {coverage.balances.dated} of {coverage.balances.total} institution balances have source dates; a successful refresh does not establish their age. Changes include flows and coverage changes, not investment return alone.</dd></div>
        <div><dt>Retirement</dt><dd>Contributions require source evidence. Unsupported months remain unknown; account balances and contribution records can have different dates.</dd></div>
        {period&&<div><dt>This report</dt><dd>{period.start<=period.end?`${date(period.start)}–${date(period.end)}. Partial periods contain only available posted records.`:"No recorded period is available within these dates."} Pending activity and excluded movements remain in their dedicated views.</dd></div>}
      </dl>
      <button className="text-link" onClick={onData}>Accounts, update history & source notes <ArrowRight size={14}/></button>
    </div>}
  </section>;
}
