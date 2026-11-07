import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { datasetSchema } from '../lib/store-validation.ts';

const temporary = await mkdtemp(join(tmpdir(), 'neonworth-adapter-'));
const run = (input, output) => spawnSync('python3', ['integrations/csv/convert.py', '--transactions', input,
  '--accounts', 'integrations/csv/accounts.example.json', '--as-of', '2026-01-05', '--output', output], { encoding: 'utf8' });
const validate = path => spawnSync(process.execPath, ['--import', './scripts/test-support/register.mjs', 'scripts/validate-import.mjs', path], { encoding: 'utf8' });
try {
  const output = join(temporary, 'valid.json');
  assert.equal(run('integrations/csv/transactions.example.csv', output).status, 0);
  const envelope = JSON.parse(await readFile(output, 'utf8'));
  const dataset = datasetSchema.parse(envelope.dataset);
  assert.equal(dataset.transactions.length, 4);
  assert.equal(dataset.transactions[2].merchant, 'Example Grocer, Main Street');
  assert.equal(dataset.transactions[0].amount, -3200);
  assert.equal(dataset.transactions[3].flow, 'review');
  assert.equal(dataset.netWorthHistory.length, 0, 'No balances are invented from a transaction export.');
  assert.equal(dataset.coverage.transactions.is_complete_for_query, false);
  assert.equal(validate(output).status, 0);
  assert.notEqual(run('integrations/csv/transactions.example.csv', output).status, 0, 'Never overwrite a file.');
  const csv = await readFile('integrations/csv/transactions.example.csv', 'utf8');
  for (const [name, content] of Object.entries({
    currency: csv.replace('USD', 'EUR'),
    duplicate: csv + csv.split('\n')[1] + '\n',
    precision: csv.replace('65.25', '65.251'),
    wrongSign: csv.replace('-3200.00', '3200.00'),
    date: csv.replace('2026-01-04', '2026-01-06'),
    unknownAccount: csv.replace('example-checking', 'unknown-account'),
    nonfinite: csv.replace('65.25', 'NaN'),
  })) {
    const input = join(temporary, name + '.csv'), invalidOutput = join(temporary, name + '.json');
    await writeFile(input, content);
    assert.notEqual(run(input, invalidOutput).status, 0, name);
    await assert.rejects(stat(invalidOutput));
  }
  const invalid = structuredClone(envelope);
  invalid.dataset.transactions.push({ ...invalid.dataset.transactions[0] });
  const invalidFile = join(temporary, 'duplicate.json');
  await writeFile(invalidFile, JSON.stringify(invalid));
  const result = validate(invalidFile);
  assert.notEqual(result.status, 0);
  assert.ok(!result.stderr.includes(invalid.dataset.transactions[0].merchant), 'Validation never prints source contents.');
  for (const [name, value] of Object.entries({
    tooLarge: { dataset: { ...envelope.dataset, syntheticExtra: 'x'.repeat(7_510_000) } },
    restoreMaps: { ...envelope, retirementOverrides: { invalid: true } },
    extraFields: { ...envelope, unused: 'not accepted silently' },
  })) {
    const file = join(temporary, name + '.json');
    await writeFile(file, JSON.stringify(value));
    assert.notEqual(validate(file).status, 0, name);
  }
  const schema = spawnSync(process.execPath, ['--import', './scripts/test-support/register.mjs', 'scripts/export-schema.mjs', '--check'], { encoding: 'utf8' });
  assert.equal(schema.status, 0, schema.stderr);
} finally { await rm(temporary, { recursive: true, force: true }); }
console.log('Offline CSV adapter and canonical validation reject unsupported currencies, signs, duplicate IDs, invalid dates and invented completeness.');
