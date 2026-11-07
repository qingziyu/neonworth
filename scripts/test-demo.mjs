import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { datasetSchema } from '../lib/store-validation.ts';
import { createDemoDataset, DEMO_MARKER } from './demo-data.mjs';

for (const day of ['2026-01-01', '2026-02-28', '2028-02-29', '2026-12-31']) {
  const data = datasetSchema.parse(createDemoDataset(day));
  assert.ok(data.notes.includes(DEMO_MARKER));
  assert.ok(data.transactions.every(row => row.date <= day && row.date >= data.dateRange.start));
  assert.equal(new Set(data.transactions.map(row => row.id)).size, data.transactions.length);
  assert.equal(data.netWorthHistory.at(-1).value, data.accounts.reduce((sum, account) => sum + account.netBalance, 0));
}
const result = spawnSync(process.execPath, ['--import', './scripts/test-support/register.mjs', 'scripts/generate-demo.mjs'], { encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr);
const sql = readFileSync('outputs/demo.sql', 'utf8');
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE finance_records (key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL,updated_at TEXT NOT NULL)');
db.exec(sql);
const before = db.prepare('SELECT value FROM finance_records WHERE key=?').get('dataset').value;
db.exec(sql);
assert.equal(db.prepare('SELECT value FROM finance_records WHERE key=?').get('dataset').value, before);
db.prepare('UPDATE finance_records SET value=? WHERE key=?').run('{"notes":["private source"]}', 'dataset');
assert.throws(() => db.exec(sql), /NOT NULL/);
db.exec('ROLLBACK');
assert.equal(db.prepare('SELECT value FROM finance_records WHERE key=?').get('dataset').value, '{"notes":["private source"]}');
db.close();
console.log('Synthetic demo validates across calendar boundaries and refuses to overwrite non-demo records.');
