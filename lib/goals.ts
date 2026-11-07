import { financialToday } from './finance-config.ts';
import type { Dataset, NetWorthPoint } from './finance';
import { summarizeIncome } from './income.ts';
import { resolvePeriod, type ResolvedPeriod } from './periods.ts';
import { netWorthForPeriod } from './net-worth.ts';
import { isISODate, summarizeReportingCoverage, type ReportingCoverage } from './reporting-coverage.ts';

export interface SavingsGoal { year: number; targetAmount: number; basis: 'cash' | 'cashAndEquity' }
export interface NetWorthGoal { targetAmount: number; targetDate: string }
export interface FireGoal { annualWithdrawalNeed: number; withdrawalRatePct: number; eligibleAssets: number; valuationDate: string; assetScope: string; targetDate?:string; annualContribution?:number; realReturnPct?:number }
export interface GoalSettings { version: 1; savings: SavingsGoal | null; netWorth: NetWorthGoal | null; fire: FireGoal | null }
export const EMPTY_GOALS: GoalSettings = { version: 1, savings: null, netWorth: null, fire: null };
export interface GoalProgress {
  actual: number | null; target: number | null; remaining: number | null;
  percent: number | null; barPercent: number | null;
  status: 'unset' | 'unavailable' | 'in_progress' | 'met';
}
export interface GoalsSummary {
  year: number; period: ResolvedPeriod; coverage: ReportingCoverage;
  cashIncome: number | null; rsuValue: number | null; spending: number | null;
  cashSurplus: number | null; cashAndEquitySurplus: number | null;
  savings: { goal: SavingsGoal | null; year: number; period: ResolvedPeriod; cashActual: number | null; cashAndEquityActual: number | null; progress: GoalProgress; label: string };
  netWorth: { goal: NetWorthGoal | null; latest: NetWorthPoint | null; baseline: NetWorthPoint | null; goalObservation: NetWorthPoint | null; points: NetWorthPoint[]; change: number | null; changePct: number | null; fullYearBaseline: boolean; observationIssues: string[]; progress: GoalProgress; label: string };
  fire: { goal: FireGoal | null; targetAmount: number | null; progress: GoalProgress; label: string };
}
const money = (value: number) => Math.round(value * 100) / 100;
const validYear = (year: number) => Number.isInteger(year) && year >= 1900 && year <= 2199;

export function goalProgress(actual: number | null, target: number | null): GoalProgress {
  if (target === null) return { actual, target, remaining: null, percent: null, barPercent: null, status: 'unset' };
  if (!Number.isFinite(target) || target < 0) throw new Error('Use a nonnegative finite goal target.');
  if (actual === null || !Number.isFinite(actual)) return { actual: null, target, remaining: null, percent: null, barPercent: null, status: 'unavailable' };
  const percent = target > 0 ? actual / target * 100 : null;
  return { actual, target, remaining: money(target - actual), percent, barPercent: percent === null ? null : Math.max(0, Math.min(100, percent)), status: actual >= target ? 'met' : 'in_progress' };
}

/** Pure, nominal-dollar tracking. No inferred eligible assets or return forecast. */
export function summarizeGoals(data: Dataset, settings: GoalSettings = EMPTY_GOALS, selectedYear = Number(data.asOf.slice(0, 4)), today = financialToday()): GoalsSummary {
  if (!validYear(selectedYear) || settings.savings && !validYear(settings.savings.year)) throw new Error('Use a valid goal year.');
  if (!isISODate(today)) throw new Error('Use a valid current date.');
  if (settings.netWorth && !isISODate(settings.netWorth.targetDate)) throw new Error('Use a valid net-worth target date.');
  const income = summarizeIncome(data, selectedYear, `${selectedYear}-12`, 'ytd');
  const savingsYear = settings.savings?.year ?? selectedYear;
  const savingsIncome = savingsYear === selectedYear ? income : summarizeIncome(data, savingsYear, `${savingsYear}-12`, 'ytd');
  const savingsActual = savingsIncome.period.empty ? null : settings.savings?.basis === 'cashAndEquity' ? savingsIncome.effectiveSavings : savingsIncome.cashSaved;
  const period = resolvePeriod(data, `${selectedYear}-12`, 'ytd');
  // Use the requested calendar boundary, not the transaction-coverage-clipped start.
  const calendar = { start: `${selectedYear}-01-01`, end: period.requestedEnd };
  const unique = new Map<string, NetWorthPoint | null>(), observationIssues: string[] = [];
  for (const point of data.netWorthHistory) {
    if (!isISODate(point.date) || !Number.isFinite(point.value) || point.date > today) { observationIssues.push('An invalid or future-dated observation was excluded.'); continue; }
    if (unique.has(point.date) && unique.get(point.date)?.value !== point.value) { unique.set(point.date, null); observationIssues.push('Conflicting observations for one date were excluded.'); }
    else if (!unique.has(point.date)) unique.set(point.date, point);
  }
  const sorted = { ...data, netWorthHistory: [...unique.values()].filter((point): point is NetWorthPoint => point !== null).sort((a, b) => a.date.localeCompare(b.date)) };
  const view = netWorthForPeriod(sorted, calendar, true);
  const latest = view.latest && view.latest.date >= calendar.start ? view.latest : null;
  const beforeStart = view.points.filter(point => point.date <= calendar.start).at(-1) ?? null;
  const baseline = beforeStart ?? view.points.find(point => point.date >= calendar.start) ?? null;
  const usableBaseline = latest && baseline && baseline.date < latest.date ? baseline : null;
  const change = usableBaseline && latest ? money(latest.value - usableBaseline.value) : null;
  const changePct = change !== null && usableBaseline!.value > 0 ? change / usableBaseline!.value * 100 : null;
  const previousDay = new Date(calendar.start + 'T12:00:00Z'); previousDay.setUTCDate(previousDay.getUTCDate() - 1);
  const fullYearBaseline = !!usableBaseline && [calendar.start, previousDay.toISOString().slice(0, 10)].includes(usableBaseline.date);
  const observationEnd = [today, [data.asOf, data.syncedAt.slice(0, 10)].sort().at(-1)!].sort()[0];
  const goalEnd = settings.netWorth ? [settings.netWorth.targetDate, observationEnd].sort()[0] : observationEnd;
  const goalObservation = sorted.netWorthHistory.filter(point => point.date <= goalEnd).at(-1) ?? null;
  let fireTarget: number | null = null;
  const fire = settings.fire;
  if (fire) {
    if (![fire.annualWithdrawalNeed, fire.eligibleAssets, fire.withdrawalRatePct].every(Number.isFinite) || fire.annualWithdrawalNeed < 0 || fire.eligibleAssets < 0 || fire.withdrawalRatePct <= 0 || fire.withdrawalRatePct > 100 || !isISODate(fire.valuationDate) || fire.valuationDate > today || !fire.assetScope.trim()) throw new Error('Use explicit valid FIRE assumptions, asset scope and a nonfuture valuation date.');
    fireTarget = money(fire.annualWithdrawalNeed / (fire.withdrawalRatePct / 100));
  }
  return {
    year: selectedYear, period, coverage: summarizeReportingCoverage(data, period.empty ? undefined : period),
    cashIncome: period.empty ? null : income.cashIncome, rsuValue: period.empty ? null : income.rsuReceiptValue, spending: period.empty ? null : income.spending, cashSurplus: period.empty ? null : income.cashSaved, cashAndEquitySurplus: period.empty ? null : income.effectiveSavings,
    savings: { goal: settings.savings, year: savingsYear, period: savingsIncome.period, cashActual: savingsIncome.period.empty ? null : savingsIncome.cashSaved, cashAndEquityActual: savingsIncome.period.empty ? null : savingsIncome.effectiveSavings, progress: goalProgress(savingsActual, settings.savings?.targetAmount ?? null), label: settings.savings?.basis === 'cashAndEquity' ? 'Cash + received equity tracking surplus' : 'Cash-only tracking surplus' },
    netWorth: { goal: settings.netWorth, latest, baseline: usableBaseline, goalObservation, points: view.points.filter(point => point.date >= calendar.start), change, changePct, fullYearBaseline, observationIssues: [...new Set(observationIssues)], progress: goalProgress(goalObservation?.value ?? null, settings.netWorth?.targetAmount ?? null), label: usableBaseline && latest ? `Observed change ${usableBaseline.date}–${latest.date}; not investment return` : 'Two dated observations are needed to show change' },
    fire: { goal: fire, targetAmount: fireTarget, progress: goalProgress(fire?.eligibleAssets ?? null, fireTarget), label: fire ? `Scenario using user-provided ${fire.assetScope} as of ${fire.valuationDate}; not verified by the feed or a retirement forecast` : 'Set withdrawal assumptions and eligible assets to model FIRE' },
  };
}
