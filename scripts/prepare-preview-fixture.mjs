// Generates synthetic local-preview files only. Does not connect to any database.
// Run: node --experimental-strip-types --import ./scripts/test-support/register.mjs scripts/prepare-preview-fixture.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { financialReviewFixture } from './test-support/financial-review-fixture.mjs';
import { datasetSchema } from '../lib/store-validation.ts';
import { budgetPlanSchema } from '../lib/budget.ts';
import { planningSchema } from '../lib/planning.ts';

if (process.argv.length > 2) throw new Error('This synthetic-only generator accepts no input files, URLs or database options.');
const root = new URL('../', import.meta.url), output = new URL('outputs/', root);
const fixture = financialReviewFixture();
const template = fixture.dataset.transactions.find(row => row.id === 'large-purchase');
fixture.dataset.transactions.push(
  { ...template, id: 'qa-reconciled-payment', date: '2026-10-27', amount: 900, accountId:'checking', merchant:'Chase Credit Card Payment', sourceName:'Chase Credit Card Payment', sourceCategoryDetailed:'transfers_credit_card_payment', confidence:'HIGH', flow:'review', review:true, note:'Possible card payment; confirm before including in any economic total.' },
  { ...template, id: 'qa-optional-category', date: '2026-10-27', amount: 45, merchant:'Synthetic unitemized purchase', category:'Other', confidence:'LOW', review:true, note:'Expense counted using the stored category; review its category.' },
  { ...template, id: 'qa-current-review', date: '2026-10-26', amount: -125, accountId:'checking', merchant:'Unresolved synthetic credit', category:'Other', flow:'review', review:true, note:'Synthetic unresolved source credit.' },
  { ...template, id: 'qa-review-outflow', date: '2026-09-11', amount: 2500, merchant: 'Unresolved synthetic activity', flow: 'review', review: true },
  { ...template, id: 'qa-review-inflow', date: '2026-09-12', amount: -2200, merchant: 'Unresolved synthetic credit', flow: 'review', review: true },
  { ...template, id: 'qa-refunded-purchase', date: '2026-09-13', amount: 1600, merchant: 'Fully refunded synthetic purchase' },
  { ...template, id: 'qa-confirmed-refund', date: '2026-09-14', amount: -1600, merchant: 'Explicit synthetic refund' },
);
Object.assign(fixture.dataset.transactions.find(row=>row.id==='rent-10'),{sourceMissingSince:'2026-10-28'});
fixture.dataset.notes.push('Historical import: 12 transactions require review.');
fixture.refresh={lastRun:{id:'synthetic-unfinished',status:'running',startedAt:'2026-10-29T00:00:00Z',start:'2026-09-01',end:'2026-10-28'},lastSuccess:{id:'synthetic-success',status:'succeeded',startedAt:'2026-10-28T23:00:00Z',finishedAt:'2026-10-29T00:30:00Z',start:'2026-09-01',end:'2026-10-28',report:{sourceDifferences:[{id:'obsolete',date:'2026-09-01',merchant:'Historical merchant $9,876.54',amount:9876.54}],bankRows:40,investmentRows:2,recurringStreams:0}},schedule:{id:'synthetic-schedule',enabled:true,timezone:'America/Los_Angeles',hour:7,verifiedAt:'2026-10-27T00:00:00Z'}};
fixture.planning.events.push({ id: 'qa-refunded-event', name: 'Synthetic refunded event', transactionIds: ['qa-refunded-purchase', 'qa-confirmed-refund'], notes: 'Fully refunded major purchase remains visible with zero net cost.' });
Object.assign(fixture.dataset.transactions.find(row => row.id === 'apple'), { amount: 2500, exceptional: true });
datasetSchema.parse(fixture.dataset);
budgetPlanSchema.parse(fixture.budget);
planningSchema.parse(fixture.planning);
const records = value => ({
  dataset: value.dataset, overrides: value.overrides, settings: value.settings,
  'retirement-overrides': value.retirementOverrides, 'review-preferences': value.reviewPreferences,
  'refresh-status': value.refresh, 'budget-plan-v1': value.budget, 'planning-v1': value.planning,
});
const sqlString = value => `'${String(value).replaceAll("'", "''")}'`;
const timestamp = '2026-10-29T00:30:00Z';
// The guard refuses to overwrite a non-synthetic local dataset. D1/Wrangler is
// deliberately not invoked here; the caller must explicitly use --local.
const guard = "INSERT INTO finance_records (key,value,updated_at) SELECT NULL,'','' WHERE EXISTS (SELECT 1 FROM finance_records AS saved WHERE saved.key='dataset' AND (json_valid(saved.value)=0 OR NOT EXISTS (SELECT 1 FROM json_each(saved.value,'$.notes') AS note WHERE note.value='Synthetic QA fixture only')));";
const sql = value => ['-- SYNTHETIC LOCAL PREVIEW ONLY. Apply the existing migration first; use wrangler --local with the dedicated preview persistence directory.', guard, ...Object.entries(records(value)).map(([key, record]) => `INSERT INTO finance_records (key,value,updated_at) VALUES (${sqlString(key)},${sqlString(JSON.stringify(record))},${sqlString(timestamp)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;`), ''].join('\n');
await mkdir(output, { recursive: true });
await writeFile(new URL('financial-review-synthetic.json', output), JSON.stringify(fixture, null, 2) + '\n', { mode: 0o600 });
const missingPrice = structuredClone(fixture); missingPrice.dataset.incomeEvidence.rsuPrices = [];
await writeFile(new URL('financial-review-synthetic-missing-rsu.json', output), JSON.stringify(missingPrice, null, 2) + '\n', { mode: 0o600 });
await writeFile(new URL('financial-review-synthetic.sql', output), sql(fixture), { mode: 0o600 });
await writeFile(new URL('financial-review-synthetic-missing-rsu.sql', output), sql(missingPrice), { mode: 0o600 });
console.log(`Synthetic-only fixture ready: ${fileURLToPath(new URL('financial-review-synthetic.sql', output))}`);
console.log('Apply with: npx wrangler d1 execute DB --local --persist-to .wrangler/financial-review-synthetic --config dist/server/wrangler.json --file outputs/financial-review-synthetic.sql');
