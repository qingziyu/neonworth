/** A ledger drill must use a real option, even when the calendar report ends in December. */
export function yearReviewEvidenceMonth(year: number, availableMonths: string[], asOf: string): string {
  const ceiling = [`${year}-12`, asOf.slice(0, 7)].sort()[0];
  const sorted = [...availableMonths].sort();
  return sorted.filter(month => month <= ceiling).at(-1) ?? sorted[0] ?? asOf.slice(0, 7);
}
