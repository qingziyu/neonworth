import { z } from 'zod';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { datasetSchema } from '../lib/store-validation.ts';

// Input-mode preserves the source schema before the derived-data transform.
// Zod refinements (cross-record/date/financial constraints) still require the CLI.
const schema = z.toJSONSchema(datasetSchema, { io: 'input', unrepresentable: 'any' });
schema.title = 'Neonworth source dataset v1';
schema.description = 'Structural interchange schema. Run npm run import:validate for the authoritative cross-record, financial, size and credential checks.';
const output = new URL('../contracts/dataset-v1.schema.json', import.meta.url);
const text = JSON.stringify(schema, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (await readFile(output, 'utf8') !== text) throw new Error('Dataset schema is stale. Run npm run contracts:generate.');
} else {
  await mkdir(new URL('../contracts/', import.meta.url), { recursive: true });
  await writeFile(output, text);
}
