import { readFile, stat } from 'node:fs/promises';
import { datasetSchema, assertDatasetSize, MAX_REQUEST_BYTES } from '../lib/store-validation.ts';
import { assertCredentialFree } from '../lib/credential-boundary.ts';

try {
  if (process.argv.length !== 3) throw new Error('usage');
  const path = process.argv[2], info = await stat(path);
  if (!info.isFile() || info.size > MAX_REQUEST_BYTES) throw new Error('size');
  const raw = await readFile(path, 'utf8');
  if (Buffer.byteLength(raw) > MAX_REQUEST_BYTES) throw new Error('size');
  const input = JSON.parse(raw);
  assertCredentialFree(input);
  // This offline source-adapter gate cannot reconcile restored decisions with
  // an instance's existing records. Do not falsely certify backup envelopes.
  if (!input || Array.isArray(input) || Object.keys(input).length !== 1 || !Object.hasOwn(input, 'dataset')) throw new Error('source-only envelope');
  const dataset = datasetSchema.parse(input.dataset);
  assertDatasetSize(dataset);
  console.log(`Valid dataset v1: ${dataset.accounts.length} accounts, ${dataset.transactions.length} transactions. No data was saved or sent.`);
} catch {
  console.error('Source validation failed. Use: npm run import:validate -- <local-json-file>. Supply only {dataset}; backup/restore maps require instance-aware verification. Check schema, dates, IDs, amounts, limits and credentials. No input contents were printed.');
  process.exitCode = 1;
}
