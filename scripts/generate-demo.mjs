import { mkdir, writeFile } from 'node:fs/promises';
import { datasetSchema } from '../lib/store-validation.ts';
import { assertCredentialFree } from '../lib/credential-boundary.ts';
import { createDemoDataset, DEMO_MARKER } from './demo-data.mjs';

if (process.argv.length > 2) throw new Error('This synthetic-only generator accepts no input or network options.');
const dataset = datasetSchema.parse(createDemoDataset());
assertCredentialFree(dataset);
const output = new URL('../outputs/', import.meta.url);
await mkdir(output, { recursive: true });
const sqlString = value => `'${String(value).replaceAll("'", "''")}'`;
// The complete transaction rolls back if the existing snapshot is not this demo.
// Independent records are not overwritten: seeding is for a new local instance.
const sql = [
  '-- SYNTHETIC DATA. Local development only.',
  'BEGIN TRANSACTION;',
  `INSERT INTO finance_records (key,value,updated_at) SELECT NULL,'','' WHERE EXISTS (SELECT 1 FROM finance_records AS saved WHERE saved.key='dataset' AND (json_valid(saved.value)=0 OR NOT EXISTS (SELECT 1 FROM json_each(saved.value,'$.notes') AS note WHERE note.value=${sqlString(DEMO_MARKER)}))) OR EXISTS (SELECT 1 FROM finance_records WHERE key<>'dataset');`,
  `INSERT INTO finance_records (key,value,updated_at) VALUES ('dataset',${sqlString(JSON.stringify(dataset))},${sqlString(dataset.syncedAt)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;`,
  'COMMIT;', '',
].join('\n');
await writeFile(new URL('demo.json', output), JSON.stringify({ dataset }, null, 2) + '\n');
await writeFile(new URL('demo.sql', output), sql);
console.log(`Generated ${dataset.transactions.length} invented transactions in outputs/demo.json and outputs/demo.sql.`);
