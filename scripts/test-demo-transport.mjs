import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { datasetSchema } from '../lib/store-validation.ts';
import { budgetPlanSchema } from '../lib/budget.ts';
import { planningSchema } from '../lib/planning.ts';
import { deriveDataset } from '../lib/classification.ts';
import { summarizePeriod } from '../lib/finance.ts';
import { summarizeIncome } from '../lib/income.ts';
import { summarizeFire } from '../lib/fire.ts';
import { netWorthForPeriod } from '../lib/net-worth.ts';
import { resolvePeriod } from '../lib/periods.ts';
import { summarizeYearReview, validateReviewEvents } from '../lib/year-review.ts';
import { DEMO_MARKER } from './demo-data.mjs';

const originalFetch = globalThis.fetch;
const { createDemoTransport, clientFetch, CLIENT_READ_ONLY, DEMO_MODE, ALLOW_IMPORT, DEMO_AS_OF } = await import('../demo/transport.ts');
assert.equal(globalThis.fetch, originalFetch, 'The demo never replaces global fetch');
assert.equal(CLIENT_READ_ONLY, true); assert.equal(DEMO_MODE, true); assert.equal(ALLOW_IMPORT, false);
const request = createDemoTransport('https://demo.example');
const read = async path => { const response = await request(path); assert.equal(response.status, 200); return response.json(); };
const saved = await read('/api/data'), data = datasetSchema.parse(saved.dataset);
const budget = budgetPlanSchema.parse((await read('/api/budget')).plan);
const planning = planningSchema.parse((await read('/api/planning')).plan);
assert.equal(data.asOf, DEMO_AS_OF); assert.equal(data.asOf, '2026-11-07');
assert.ok(data.notes.includes(DEMO_MARKER));
assert.ok(data.accounts.every(account => account.id.startsWith('demo-') && account.institution === 'Example Institution'));
assert.deepEqual(data.netWorthHistory.at(-1), { date: DEMO_AS_OF, value: 257483.62, events: [] });
assert.equal(planning.goals.fire.eligibleAssets, data.accounts.find(account => account.id === 'demo-investments').netBalance);
for (const [month, mode, firstDate, dayCount] of [
  ['2026-10', 'month', '2026-10-01', 31],
  ['2026-10', 'ytd', '2026-01-01', 304],
  ['2026-10', 'year', '2025-12-01', 335],
  ['2026-11', 'month', '2026-11-01', 7],
]) {
  const { points } = netWorthForPeriod(data, resolvePeriod(data, month, mode));
  const start = Date.parse(firstDate);
  const expectedDates = Array.from({ length: dayCount }, (_, i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10));
  assert.deepEqual(points.map(point => point.date), expectedDates, `${month} ${mode} has one observation per covered day`);
  assert.ok(points.at(-1).value > points[0].value, `${month} ${mode} gains overall`);
  assert.ok(points.some((point, i) => i > 0 && point.value < points[i - 1].value), `${month} ${mode} includes a drawdown`);
}
assert.deepEqual(saved.overrides, {}); assert.deepEqual(saved.settings, {}); assert.equal(saved.refresh, null);
assert.deepEqual(saved.reviewPreferences, { findingResolutions: {}, recurringStatuses: {} });
const derived = deriveDataset(data);
const october = summarizePeriod(derived, '2026-10', 'month');
assert.equal(october.cashPayroll, 5212, 'Payroll and bank interest remain cash income');
assert.equal(october.income, null, 'An equity-inclusive total cannot imply complete investment evidence');
assert.equal(october.spending, 2293, 'Card repayment legs must not inflate October spending');
assert.equal(derived.transactions.find(row => row.id === 'demo-review').flow, 'review', 'The example remains unresolved without evidence');
assert.equal(summarizeIncome(derived, 2026, '2026-10', 'month').rsuReceiptValue, null, 'The demo does not invent missing investment coverage');
assert.equal(Object.values(budget.monthly).reduce((sum, amount) => sum + amount, 0), 4000);
assert.equal(summarizeFire(planning.goals.fire).target, 1200000, 'Example FIRE target follows the explicit withdrawal need and rate');
assert.equal(summarizeFire(planning.goals.fire).projectionStatus, 'ready');
validateReviewEvents(derived, budget, planning.events);
assert.equal(summarizeYearReview(derived, budget, 2026, planning.events).events.length, 1, 'The sample event uses supported source membership');
const baseline = JSON.stringify(await read('/api/data'));
saved.dataset.transactions[0].amount = 999999; saved.overrides.changed = {};
assert.equal(JSON.stringify(await read('/api/data')), baseline, 'Caller mutation cannot change the next read');
assert.deepEqual(await (await clientFetch('/api/data')).json(), await read('/api/data'), 'Every demo instance starts from the same invented fixture');

for (const route of ['/api/data', '/api/budget', '/api/planning', '/api/preferences', '/api/import', '/api/refresh']) {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = await request(route, { method, body: '{"credential":"never parsed or persisted"}' });
    assert.equal(response.status, 403); assert.match((await response.json()).error, /Saving and importing are disabled/);
  }
}
for (const path of ['https://outside.example/api/data', '//outside.example/api/data', 'https://user:password@demo.example/api/data', 'file:///api/data', '/api/import', '/api/preferences', '/api/unknown', '/api/data?source=private', '/api/data#private', '/api/%64ata']) {
  const response = await request(path);
  assert.equal(response.status, 404, `${path} must fail closed without network fallback`);
  assert.deepEqual(await response.json(), { error: 'This request is not available in the synthetic demo.' });
}
assert.equal(JSON.stringify(await read('/api/data')), baseline, 'Rejected writes and imports cannot change any records');
assert.deepEqual((await read('/api/planning')).plan, planning, 'Rejected planning writes preserve the sample assumptions');
const absolute = await request(new URL('https://demo.example/api/data'));
assert.equal(absolute.status, 200);
const head = await request(new Request('https://demo.example/api/data', { method: 'HEAD' }));
assert.equal(head.status, 200); assert.equal(await head.text(), '');
assert.equal(head.headers.get('Cache-Control'), 'no-store');
assert.equal((await request('/api/import', { method: 'HEAD' })).status, 404);
const status = await read('/api/status');
assert.equal(status.automaticBankSync, false); assert.equal(status.updateMode, 'synthetic-demo'); assert.equal(status.refresh, null);
assert.equal(status.transactions, data.transactions.length);
assert.equal(typeof (await read('/api/app-version')).version, 'string');
const alreadyAborted = new AbortController(); alreadyAborted.abort();
await assert.rejects(request('/api/data', { signal: alreadyAborted.signal }), { name: 'AbortError' });
const canceled = new AbortController(), pending = request('/api/data', { signal: canceled.signal }); canceled.abort();
await assert.rejects(pending, { name: 'AbortError' });
const requestAbort = new AbortController(), canceledRequest = new Request('https://demo.example/api/data', { signal: requestAbort.signal }); requestAbort.abort();
await assert.rejects(request(canceledRequest), { name: 'AbortError' });
assert.equal((await request(canceledRequest, { signal: null })).status, 200, 'An explicit RequestInit signal takes precedence');
assert.equal(globalThis.fetch, originalFetch);
const source = await readFile('demo/transport.ts', 'utf8');
assert.doesNotMatch(source, /(?:from\s+['"][^'"]*(?:\/store['"]|planning-store|cloudflare|node:)|(?:globalThis|window)\.fetch\s*\(|localStorage|sessionStorage)/, 'The demo transport must have no server, storage or network fallback dependency');
console.log('Public demo: synthetic financial arithmetic, valid plans/events, isolated responses, read-only imports/saves, closed URLs and abort semantics passed.');
