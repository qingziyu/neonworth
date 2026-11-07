import assert from 'node:assert/strict';
import { encodeCsvCell, serializeCsv } from '../lib/csv.ts';

// Parse CSV independently to test separators/quotes/newlines, rather than just
// comparing the encoder's own escaping expression with itself.
function parseCsv(input) {
  const rows = [], row = [];
  let cell = '', quoted = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === '"') {
      if (quoted && input[index + 1] === '"') { cell += '"'; index++; }
      else quoted = !quoted;
    } else if (!quoted && char === ',') { row.push(cell); cell = ''; }
    else if (!quoted && char === '\r' && input[index + 1] === '\n') {
      row.push(cell); rows.push([...row]); row.length = 0; cell = ''; index++;
    } else cell += char;
  }
  assert.equal(quoted, false, 'Every quoted field closes.');
  row.push(cell); rows.push(row);
  return rows;
}

const formulas = [
  '=1+1', '+SUM(1,2)', '-2+3', '@SUM(1,2)',
  '＝1+1', '＋SUM(1,2)', '－2+3', '＠SUM(1,2)',
  ' \t=1+1', '\r\n+1', '\u0000\u001f-1', '\u007f@SUM(1,2)',
  '\u00a0\u3000＝1+1', '\ufeff=1+1', '\u200b\u2066@SUM(1,2)',
  "'=1+1", " '' ＋SUM(1,2)", '＇＝1+1',
  '\tordinary text', '\rfirst line', '\nfirst line',
];
for (const value of formulas) {
  const exported = parseCsv(encodeCsvCell(value))[0][0];
  assert.equal(exported, `[text] ${value}`, 'Untrusted formula/control prefix has a visible text marker.');
  assert.equal(exported.replace(/^['\s]+/u, '')[0], '[', 'Removing spreadsheet escape/whitespace cannot expose a formula marker.');
}
for (const value of ['Acme', '  ordinary text', '2026-10-28', 'note = not a formula', '日本語', "'already text"]) {
  assert.equal(parseCsv(encodeCsvCell(value))[0][0], value, 'Benign source labels remain unchanged.');
}
const injection = 'Merchant",=HYPERLINK("https://invalid.test"),"\r\n+1';
const rows = [['Merchant', 'Cash flow USD', 'Note'], [injection, -123.45, '=1+1'], ['Credit', 42, 'line one\nline two']];
const snapshot = JSON.stringify(rows);
const parsed = parseCsv(serializeCsv(rows));
assert.equal(parsed.length, 3, 'Embedded CRLF cannot create an extra transaction.');
assert.ok(parsed.every(row => row.length === 3), 'Quotes/separators cannot create a formula cell.');
assert.equal(parsed[1][0], injection);
assert.equal(parsed[1][2], '[text] =1+1');
assert.equal(parsed[2][2], 'line one\nline two');
assert.equal(encodeCsvCell(-123.45), '-123.45', 'A numeric debit remains a number without a text marker.');
assert.equal(encodeCsvCell(42), '42');
assert.equal(encodeCsvCell(0), '0');
assert.equal(encodeCsvCell('-123.45'), '"[text] -123.45"', 'A numeric-looking untrusted string is still text.');
assert.deepEqual(parseCsv(serializeCsv([[null, undefined, false, true]])), [['', '', 'false', 'true']]);
for (const value of [NaN, Infinity, -Infinity]) assert.throws(() => encodeCsvCell(value), /finite/);
assert.equal(JSON.stringify(rows), snapshot, 'CSV protection never rewrites saved source records.');
console.log('CSV export blocks formula and separator injection while preserving numeric amounts and original source values.');
