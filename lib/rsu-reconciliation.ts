import { allowedRsuTicker } from './finance-config.ts';
import type { Dataset } from './finance';
import type { InvestmentIncomeRecord } from './income';

export const RSU_WITHHOLDING_MECHANISM_URL = 'https://www.fidelity.com/stock-plan-services/taxes-and-filing';
export const FIDELITY_RSU_WITHHOLDING_URL = RSU_WITHHOLDING_MECHANISM_URL;

export interface RsuTaxSettlement {
  status: 'inferred';
  receiptDate: string;
  saleDate: string;
  receiptShares: number;
  soldShares: number;
  proceeds: number;
  refundAmount: number;
  taxAmount: number;
  receiptIds: string[];
  saleIds: string[];
  refundId: string;
  taxIds: string[];
  receipt: InvestmentIncomeRecord;
  sale: InvestmentIncomeRecord;
  refund: InvestmentIncomeRecord;
  reason: string;
}

export interface RsuTaxJournalBatch {
  id: string;
  accountId: string;
  date: string;
  total: number;
  entries: InvestmentIncomeRecord[];
  settlement?: RsuTaxSettlement;
}

export interface RsuTaxJournalSummary {
  start: string;
  end: string;
  total: number;
  journalCount: number;
  batches: RsuTaxJournalBatch[];
}

const cents = (amount: number) => Math.round(amount * 100);
const hasRsu = (description: string) => /\bRSU(?:\b|[0-9#])/i.test(description);
const hasTaxLabel = (description: string) => /tax|withhold|medicare|social security|federal incom|\bWA (?:MLI|FLI)\b/i.test(description);
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

function validDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function isTaxJournal(record: InvestmentIncomeRecord): boolean {
  return record.currency === 'USD' && record.type === 'cash' && record.subtype === 'withdrawal'
    && Number.isFinite(record.amount) && record.amount > 0
    && hasRsu(record.description) && hasTaxLabel(record.description) && !/refund/i.test(record.description);
}

function isRefundJournal(record: InvestmentIncomeRecord): boolean {
  return record.currency === 'USD' && record.type === 'cash' && record.subtype === 'withdrawal'
    && Number.isFinite(record.amount) && record.amount > 0
    && hasRsu(record.description) && /refund/i.test(record.description);
}

function isReceipt(record: InvestmentIncomeRecord): boolean {
  return record.currency === 'USD' && allowedRsuTicker(record.ticker) && record.type === 'buy'
    && hasRsu(record.description) && Number.isFinite(record.quantity) && record.quantity > 0;
}

/**
 * Preserve the actual tax journals, then offer a conservative settlement explanation.
 * Exact arithmetic is evidence of a possible historical sell-to-cover settlement,
 * not provider linkage or complete tax/vesting coverage. This helper never changes
 * recorded receipt valuation or deducts these journals a second time.
 */
export function summarizeRsuTaxJournals(data: Dataset, start: string, end: string): RsuTaxJournalSummary {
  if (!validDate(start) || !validDate(end) || start > end) throw new Error('Invalid RSU journal period.');
  // Matching can use an earlier sale, but never evidence later than the reporting end.
  const records = (data.incomeEvidence?.investmentRecords || []).filter(record => validDate(record.date) && record.date <= end);
  const sourceIdCounts = new Map<string, number>();
  for (const record of records) sourceIdCounts.set(record.id, (sourceIdCounts.get(record.id) || 0) + 1);
  const groups = new Map<string, RsuTaxJournalBatch>();
  for (const record of records.filter(isTaxJournal)) {
    const key = `${record.accountId}\u0000${record.date}`;
    const batch = groups.get(key) || { id: `rsu-tax:${record.accountId}:${record.date}`, accountId: record.accountId, date: record.date, total: 0, entries: [] };
    batch.entries.push({ ...record });
    groups.set(key, batch);
  }
  const allBatches = [...groups.values()];
  for (const batch of allBatches) {
    batch.entries.sort((left, right) => left.id.localeCompare(right.id));
    batch.total = batch.entries.reduce((total, record) => total + cents(record.amount), 0) / 100;
    const refunds = records.filter(record => record.accountId === batch.accountId && record.date === batch.date && isRefundJournal(record));
    if (refunds.length !== 1 || batch.entries.some(record => sourceIdCounts.get(record.id) !== 1)) continue;
    const refund = refunds[0];
    const requiredProceeds = cents(batch.total) + cents(refund.amount);
    const candidates = records.filter(record => record.accountId === batch.accountId && record.currency === 'USD'
      && allowedRsuTicker(record.ticker) && record.type === 'sell'
      && Number.isFinite(record.amount) && record.amount < 0
      && Number.isFinite(record.quantity) && record.quantity < 0
      && dayNumber(batch.date) - dayNumber(record.date) >= 0
      && dayNumber(batch.date) - dayNumber(record.date) <= 7
      && cents(-record.amount) === requiredProceeds).flatMap(sale => {
        const receipts = records.filter(record => record.accountId === batch.accountId && record.date === sale.date && record.ticker === sale.ticker && isReceipt(record));
        if (receipts.length !== 1 || -sale.quantity > receipts[0].quantity) return [];
        const receipt = receipts[0];
        if ([sale, receipt, refund].some(record => sourceIdCounts.get(record.id) !== 1)) return [];
        return [{ sale, receipt }];
      });
    // Never choose between multiple plausible sale records or receipt dates.
    if (candidates.length !== 1) continue;
    const { sale, receipt } = candidates[0];
    batch.settlement = {
      status: 'inferred', receiptDate: receipt.date, saleDate: sale.date,
      receiptShares: receipt.quantity, soldShares: -sale.quantity,
      proceeds: -sale.amount, refundAmount: refund.amount, taxAmount: batch.total,
      receiptIds: [receipt.id], saleIds: [sale.id], refundId: refund.id,
      taxIds: batch.entries.map(record => record.id),
      receipt: { ...receipt }, sale: { ...sale }, refund: { ...refund },
      reason: 'Possible historical sell-to-cover settlement: one same-account share sale on an explicit RSU receipt date, within seven days before these journals, exactly equals the recorded tax journals plus one RSU refund journal. This is inferred arithmetic, not an explicit provider link or complete withholding report. Historical settlement context only: these journals do not automatically change recorded receipt valuation.',
    };
  }
  // Check all available prior batches so narrowing the selected period cannot
  // make one sale/receipt appear to fund multiple apparently unique settlements.
  const usedEvidence = new Map<string, number>();
  for (const batch of allBatches) if (batch.settlement) {
    for (const id of [...batch.settlement.saleIds, ...batch.settlement.receiptIds]) usedEvidence.set(id, (usedEvidence.get(id) || 0) + 1);
  }
  for (const batch of allBatches) if (batch.settlement && [...batch.settlement.saleIds, ...batch.settlement.receiptIds].some(id => usedEvidence.get(id)! > 1)) delete batch.settlement;
  const batches = allBatches.filter(batch => batch.date >= start).sort((left, right) => right.date.localeCompare(left.date) || left.accountId.localeCompare(right.accountId));
  return {
    start, end, batches,
    total: batches.reduce((total, batch) => total + cents(batch.total), 0) / 100,
    journalCount: batches.reduce((total, batch) => total + batch.entries.length, 0),
  };
}
