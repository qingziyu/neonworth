import type { Dataset } from './finance';
import { assessBudgetCoverage, type BudgetCoverageAssessment, type BudgetCoverageWindow } from './budget-coverage.ts';
import { isZelleTransaction } from './transaction-policy.ts';

export interface ReportingCoverage {
  comparisonStart: string | null;
  comparisonEligible: boolean;
  comparison: BudgetCoverageAssessment | null;
  sourceCoverage: BudgetCoverageAssessment['sourceCoverage'];
  label: string;
  explanation: string;
  recorded: { start: string; end: string; asOf: string };
  netWorth: { start: string | null; end: string | null; count: number };
  balances: { dated: number; total: number };
  investmentCompleteness: 'unknown';
  freshness: 'unknown';
}

export function isISODate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T12:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function nextMonth(date: string): string {
  const d = new Date(date.slice(0, 7) + '-01T12:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}
const validWindow = (window: BudgetCoverageWindow): boolean => isISODate(window.start) && isISODate(window.end) && window.start <= window.end;

/** Observed spending comparability only: never account opening or source completeness. */
export function observedComparisonStart(data: Dataset): string | null {
  if (!validWindow(data.dateRange) || !isISODate(data.asOf) || data.dateRange.start > data.asOf) return null;
  // Only first posted card purchases are needed here. Avoid computing every
  // account's full monthly row counts for each requested comparison window.
  const cards = new Map(data.accounts.filter(account => account.type.toLowerCase() === 'credit').map(account => [account.id, null as string | null]));
  for (const row of data.transactions) {
    const first = cards.get(row.accountId);
    if (first === undefined || first !== null && row.date >= first || row.pending || row.flow !== 'expense' || row.amount <= 0 || row.date < data.dateRange.start || row.date > data.dateRange.end || row.date > data.asOf || !isISODate(row.date) || isZelleTransaction(row)) continue;
    cards.set(row.accountId, row.date);
  }
  if ([...cards.values()].some(date => date === null)) return null;
  const firstFullMonth = data.dateRange.start.endsWith('-01') ? data.dateRange.start : nextMonth(data.dateRange.start);
  const start = [firstFullMonth, ...[...cards.values()].map(date => nextMonth(date!))].sort().at(-1)!;
  return start <= data.asOf && start <= data.dateRange.end ? start : null;
}

/** Reuse only within one calculation; do not cache mutable datasets across calls. */
export function createReportingWindowComparator(data: Dataset): (window: BudgetCoverageWindow) => boolean {
  const start = observedComparisonStart(data);
  return window => validWindow(window) && start !== null && window.start >= start && assessBudgetCoverage(data, window).comparable;
}

export function isReportingWindowComparable(data: Dataset, window: BudgetCoverageWindow): boolean {
  return validWindow(window) && createReportingWindowComparator(data)(window);
}

export function summarizeReportingCoverage(data: Dataset, window?: BudgetCoverageWindow): ReportingCoverage {
  const comparisonStart = observedComparisonStart(data);
  const comparison = window && validWindow(window) ? assessBudgetCoverage(data, window) : null;
  // A dated net-worth observation can be newer than transaction asOf. Preserve
  // its independent date, bounded by the recorded retrieval day.
  const observationEnd = [data.asOf, data.syncedAt.slice(0, 10)].sort().at(-1)!;
  const dates = data.netWorthHistory.map(point => point.date).filter(date => isISODate(date) && date <= observationEnd).sort();
  return {
    comparisonStart,
    comparisonEligible: comparisonStart !== null && !!window && window.start >= comparisonStart && comparison?.comparable === true,
    comparison,
    sourceCoverage: comparison?.sourceCoverage ?? 'unknown',
    label: comparisonStart ? `Spending comparisons from ${comparisonStart}` : 'Spending comparison window not established',
    explanation: 'Earlier recorded amounts remain included. The comparison date describes observed card history, not complete bank or investment history. Source freshness remains unknown.',
    recorded: { start: data.dateRange.start, end: [data.dateRange.end, data.asOf].sort()[0], asOf: data.asOf },
    netWorth: { start: dates[0] ?? null, end: dates.at(-1) ?? null, count: dates.length },
    balances: { dated: data.accounts.filter(account => account.balanceAgeKnown && isISODate(account.balanceDate)).length, total: data.accounts.length },
    investmentCompleteness: 'unknown', freshness: 'unknown',
  };
}
