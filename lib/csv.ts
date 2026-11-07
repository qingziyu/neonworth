export type CsvCell = string | number | boolean | null | undefined;

// Spreadsheet imports may trim whitespace/control characters or normalize
// fullwidth formula markers. Inspect a normalized copy; retain the original
// source text after a visible export-only marker. Unlike spreadsheet escape
// apostrophes, this marker remains text if Excel saves and reopens the CSV.
// Numeric values remain numeric, including debits.
export function encodeCsvCell(value: CsvCell): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('CSV numeric cells must be finite.');
    return String(value);
  }
  let text = String(value ?? '');
  const normalized = text.normalize('NFKC');
  // Leading apostrophes can be consumed as spreadsheet text escapes too.
  const prefix = normalized.match(/^[\p{White_Space}\p{Cc}\p{Cf}']*/u)?.[0] ?? '';
  if (/^[=+\-@]/.test(normalized.slice(prefix.length)) || /[\p{Cc}\p{Cf}]/u.test(prefix)) {
    text = `[text] ${text}`;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

export function serializeCsv(rows: readonly (readonly CsvCell[])[]): string {
  return rows.map(row => row.map(encodeCsvCell).join(',')).join('\r\n');
}
