// Exercise production refresh/store/MCP code using synthetic data and SQLite.
// Hosting authentication has its own signed-JWT and Worker boundary tests;
// these tests cover the application contract without real credentials or data.
import assert from 'node:assert/strict';
import { FINANCE_CONFIG } from '../lib/finance-config.ts';
import { mock } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import './test-support/register.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const now = new Date('2026-10-28T16:00:00Z');
mock.timers.enable({ apis: ['Date'], now });
const { buildRefresh, refreshWindow } = await import('../lib/refresh-model.ts');
const { deriveDataset } = await import('../lib/classification.ts');
const { summarizePeriod } = await import('../lib/finance.ts');
const account = id => ({ id, name: id, institution: 'Synthetic Bank', type: id === 'bank' ? 'depository' : 'investment', subtype: id === 'bank' ? 'checking' : 'brokerage', mask: '', balance: 1000, netBalance: 1000, balanceDate: null, balanceAgeKnown: false, syncStatus: 'synced' });
const tx = (id, extra = {}) => ({ id, date: '2026-10-20', merchant: 'Synthetic shop', sourceName: 'Synthetic shop', accountId: 'bank', amount: 20, category: 'Shopping', flow: 'expense', confidence: 'HIGH', exceptional: false, note: '', pending: false, review: false, ...extra });
const base = {
  version: 1, syncedAt: '2026-10-27T16:00:00Z', asOf: '2026-10-27', dateRange: { start: '2026-01-01', end: '2026-10-27' },
  accounts: [account('bank'), account('broker')], transactions: [tx('purchase'), tx('pending', { pending: true }), tx('missing-posted'), tx('historical', { date: '2026-01-10' })],
  coverage: { transactions: { is_complete_for_query: true } }, recurring: [], notes: [], netWorthHistory: [{ date: '2026-10-27', value: 1900, events: [] }],
  incomeEvidence: { version: 1, asOf: '2026-10-27', readAt: '2026-10-27T16:00:00Z', bankCoverage: {}, investmentCoverage: { isComplete: false, freshness: 'unknown', note: 'Synthetic evidence' }, bankInflowCount: 0, bankInflowTotal: 0, pendingInflowCount: 0, investmentRecords: [], accountHistory: [], notes: [], sources: [], rsuPrices: [{ date: '2026-10-01', ticker: 'EXMPL', price: 200, basis: 'regular-session close', source: 'Synthetic test source', currency: 'USD' }] },
};
const corrections = { purchase: { note: 'Keep my decision', category: 'Health & personal care', review: false } };
const preferences = { findingResolutions: { 'service:synthetic': { state: 'reviewed', evidenceKey: 'synthetic-evidence', updatedAt: base.syncedAt } }, recurringStatuses: {} };
const schedule = { id: 'synthetic-schedule', enabled: true, timezone: FINANCE_CONFIG.timeZone, hour: 7, verifiedAt: base.syncedAt };
const page = items => [{ cursor: null, result: { items, has_more: false, next_cursor: null, coverage: { availability: 'ready', is_complete_for_query: true } } }];
const rawTx = (id, extra = {}) => ({ transaction_id: id, date: '2026-10-20', account_id: 'bank', amount: 20, name: 'Synthetic shop', pending: false, iso_currency_code: 'USD', personal_finance_category: { primary: 'shopping', detailed: 'shopping_general_merchandise', confidence_level: 'HIGH' }, ...extra });
const income = rawTx('salary', { amount: -1000, name: 'Example Employer payroll', date: '2026-10-28', personal_finance_category: { primary: 'income', detailed: 'income_wages', confidence_level: 'HIGH' } });
const bundle = {
  accounts: { institutions: [{ status: 'linked', sync_status: 'synced', institution: { name: 'Synthetic Bank' }, account_coverage: { availability: 'ready', is_complete_for_query: true }, accounts: base.accounts.map(a => ({ account_id: a.id, name: a.name, type: a.type, subtype: a.subtype, balances: { current: 1000, net_balance: 1000, iso_currency_code: 'USD' } })) }] },
  bank: page([rawTx('purchase'), rawTx('posted', { pending_transaction_id: 'pending', date: '2026-10-28' }), income]), inflows: page([income]), investments: page([]), recurring: page([]),
  netWorth: { has_net_worth_data: true, currency_code: 'USD', account_coverage: { is_complete_for_query: true }, current_value: 2000, chart_points: [{ date: '2026-10-28', net_worth: 2000, first_balance_events: [] }] },
};
const run = { id: 'synthetic', status: 'running', startedAt: now.toISOString(), ...refreshWindow(base, now), baseSyncedAt: base.syncedAt };
const before = JSON.stringify({ base, corrections, bundle });
const built = buildRefresh(base, corrections, run, bundle, now);
assert.equal(JSON.stringify({ base, corrections, bundle }), before, 'Refresh normalization cannot mutate its inputs');
assert.equal(built.report.newTransactions, 2);
assert.equal(built.report.removedPending, 1);
assert.equal(built.dataset.transactions.length, 5);
assert.ok(built.dataset.transactions.some(t => t.id === 'historical'));
assert.ok(built.dataset.transactions.some(t => t.id === 'missing-posted' && t.sourceMissingSince), 'Missing posted records remain visible as source differences');
assert.equal(built.dataset.coverage.transactions.is_complete_for_query, false);
assert.deepEqual(built.dataset.incomeEvidence.rsuPrices, base.incomeEvidence.rsuPrices);
assert.equal(buildRefresh(built.dataset, corrections, run, bundle, now).report.newTransactions, 0);
assert.equal(refreshWindow(base, new Date('2026-11-01T16:00:00Z')).start, base.dateRange.start, 'First-of-month refresh backfills history');
// New source-generated category uncertainty must use the same optional path as
// the earlier import format. Existing flags without a known reason stay intact.
const categoryBase=structuredClone(base),categoryBundle=structuredClone(bundle);
categoryBase.transactions.push(tx('existing-blank',{category:'Other',confidence:'LOW',review:true}),tx('existing-custom',{category:'Other',confidence:'LOW',review:true,note:'Check whether this charge is duplicated.'}));
const categorySource=(primary,confidence_level)=>({primary,detailed:primary==='other'?'other_other':'shopping_general_merchandise',confidence_level});
categoryBundle.bank[0].result.items.push(
 rawTx('new-other',{personal_finance_category:categorySource('other','HIGH')}),
 rawTx('new-low',{personal_finance_category:categorySource('shopping','LOW')}),
 rawTx('new-unknown',{personal_finance_category:null}),
 rawTx('new-strong'),
 rawTx('new-pending',{pending:true,personal_finance_category:categorySource('other','LOW')}),
 rawTx('new-transfer',{personal_finance_category:{primary:'transfers',detailed:'transfers_other_transfer_out',confidence_level:'LOW'}}),
 rawTx('existing-blank',{personal_finance_category:categorySource('other','LOW')}),
 rawTx('existing-custom',{personal_finance_category:categorySource('other','LOW')})
);
const categoryBefore=structuredClone({categoryBase,categoryBundle}),categoryBuilt=buildRefresh(categoryBase,{},run,categoryBundle,now);
const categoryDerived=deriveDataset(categoryBuilt.dataset),byId=new Map(categoryDerived.transactions.map(t=>[t.id,t]));
for(const id of ['new-other','new-low','new-unknown']){
 const source=categoryBuilt.dataset.transactions.find(t=>t.id===id),row=byId.get(id);
 assert.equal(source.review,true,'The generated source flag stays auditable');
 assert.equal(source.note,'Expense counted using the stored category; review its category.');
 assert.equal(row.review,false);assert.equal(row.categoryReviewOptional,true);assert.equal(row.flow,'expense');assert.equal(row.amount,20);
 const legacy=deriveDataset({...base,transactions:[tx(id,{category:source.category,confidence:source.confidence,note:'Expense counted using the stored category; review its category.',review:true})]}).transactions[0];
 assert.equal(row.review,legacy.review);assert.equal(row.categoryReviewOptional,legacy.categoryReviewOptional);assert.equal(row.category,legacy.category,'New and prior importer category evidence receive equivalent treatment');
 for(const patch of [{review:true},{flow:'review'},{note:'Check whether this charge is duplicated.'}])assert.equal(deriveDataset(categoryBuilt.dataset,{[id]:patch}).transactions.find(t=>t.id===id).review,true,'Saved review/flow/custom requests remain required');
}
assert.equal(byId.get('new-strong').review,false);assert.equal(byId.get('new-strong').categoryReviewOptional,undefined,'Strong source purpose needs no optional question');
for(const id of ['new-pending','new-transfer','existing-blank','existing-custom'])assert.equal(byId.get(id).review,true,'Pending, unresolved movement and existing unexplained/custom flags stay intact');
const postedCategoryBundle=structuredClone(categoryBundle);postedCategoryBundle.bank[0].result.items.find(t=>t.transaction_id==='new-pending').pending=false;
const postedCategory=deriveDataset(buildRefresh(categoryBuilt.dataset,{},run,postedCategoryBundle,now).dataset).transactions.find(t=>t.id==='new-pending');
assert.equal(postedCategory.pending,false);assert.equal(postedCategory.review,false);assert.equal(postedCategory.categoryReviewOptional,true,'The generated reason survives the pending-to-posted transition');
assert.deepEqual(deriveDataset(categoryDerived),categoryDerived);
const noReview={...categoryDerived,transactions:categoryDerived.transactions.map(t=>({...t,review:false}))};
for(const mode of ['month','ytd','year']){const actual=summarizePeriod(categoryDerived,'2026-10',mode),expected=summarizePeriod(noReview,'2026-10',mode);for(const key of ['spending','income','saved','cashSaved'])assert.equal(actual[key],expected[key],'Category review presentation does not change financial totals');}
assert.deepEqual({categoryBase,categoryBundle},categoryBefore,'Category reconciliation never mutates prior history or source pages');
for (const mutate of [
  b => { b.bank[0].result.has_more = true; b.bank[0].result.next_cursor = 'missing-page'; },
  b => { b.bank[0].result.coverage.is_complete_for_query = false; },
  b => { b.inflows[0].result.items = []; },
  b => { b.bank[0].result.items[0].amount += 1; },
  b => { b.netWorth.current_value += 20; },
  b => { b.rsuPrices = [{ ...base.incomeEvidence.rsuPrices[0], price: 201 }]; },
]) {
  const invalid = structuredClone(bundle); mutate(invalid);
  assert.throws(() => buildRefresh(base, corrections, run, invalid, now));
  assert.equal(JSON.stringify({ base, corrections, bundle }), before);
}

const sqlite = new DatabaseSync(':memory:');
sqlite.exec('CREATE TABLE finance_records(key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE finance_sync_log(id INTEGER PRIMARY KEY AUTOINCREMENT,imported_at TEXT NOT NULL,as_of TEXT NOT NULL,transaction_count INTEGER NOT NULL,account_count INTEGER NOT NULL)');
let failLast = false, loseAcknowledgment = false;
const statement = (sql, args = []) => ({ sql, args, bind(...values) { return statement(sql, values); }, async first() { return sqlite.prepare(sql).get(...args) || null; }, async all() { return { results: sqlite.prepare(sql).all(...args) }; } });
const db = { prepare: sql => statement(sql), async batch(ops) {
  sqlite.exec('BEGIN');
  try {
    const results = ops.map((op, index) => { if (failLast && index === ops.length - 1) throw new Error('D1_ERROR: internal error; private synthetic SQL and values'); return { success: true, meta: sqlite.prepare(op.sql).run(...op.args) }; });
    sqlite.exec('COMMIT');
    if (loseAcknowledgment) { loseAcknowledgment = false; throw new Error('Synthetic lost acknowledgment'); }
    return results;
  } catch (error) { try { sqlite.exec('ROLLBACK'); } catch { /* Commit may already be durable. */ } throw error; }
  finally { failLast = false; }
} };
const temp = await mkdtemp(join(tmpdir(), 'neonworth-refresh-contract-'));
const url = p => pathToFileURL(p).href;
try {
  globalThis.__neonworthRefreshContractEnv = { DB: db };
  const modules = new Map([['store', join(temp, 'store.ts')], ['refresh', join(temp, 'refresh.ts')]]);
  const rewrite = source => source
    .replace("import { env } from 'cloudflare:workers';", 'const env = globalThis.__neonworthRefreshContractEnv;')
    .replace(/from '(?:\.\/|@\/lib\/)([^']+)'/g, (_, name) => `from '${url(modules.get(name) || join(root, 'lib', name.endsWith('.ts') ? name : name + '.ts'))}'`)
    .replace("from 'zod'", `from '${url(join(root, 'node_modules/zod/index.js'))}'`);
  for (const [name, output] of modules) await writeFile(output, rewrite(await readFile(join(root, 'lib', name.endsWith('.ts') ? name : name + '.ts'), 'utf8')));
  for (const [name, input] of [['mcp', 'app/mcp/route.ts'], ['api', 'app/api/refresh/route.ts']]) await writeFile(join(temp, name.endsWith('.ts') ? name : name + '.ts'), rewrite(await readFile(join(root, input), 'utf8')));
  const store = await import(url(modules.get('store'))), refresh = await import(url(modules.get('refresh')));
  const mcp = await import(url(join(temp, 'mcp.ts'))), api = await import(url(join(temp, 'api.ts')));
  const seed = () => {
    sqlite.exec('DELETE FROM finance_records; DELETE FROM finance_sync_log;');
    for (const [key, value] of Object.entries({ dataset: base, overrides: corrections, 'review-preferences': preferences, settings: { savingsTarget: 37 }, 'retirement-overrides': {}, 'budget-plan-v1': { savedPlan: 'synthetic sentinel' }, 'refresh-status': { schedule } })) sqlite.prepare('INSERT INTO finance_records VALUES(?,?,?)').run(key, JSON.stringify(value), base.syncedAt);
  };
  const rows = () => sqlite.prepare('SELECT * FROM finance_records ORDER BY key').all();
  const logs = () => sqlite.prepare('SELECT count(*) as n FROM finance_sync_log').get().n;
  const request = (path, body, headers = {}) => new Request(`https://neonworth.test/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const rpc = (method, params, headers) => mcp.POST(request('mcp', { jsonrpc: '2.0', id: 7, method, params }, headers));
  const call = async (name, args = {}) => {
    const response = await rpc('tools/call', { name, arguments: args });
    assert.match(response.headers.get('cache-control'), /private.*no-store/);
    assert.equal(response.headers.get('vary'), 'Cookie');
    const payload = await response.json();
    assert.equal(payload.id, 7);
    assert.equal(payload.result.isError, false, payload.result.content[0].text);
    return JSON.parse(payload.result.content[0].text);
  };
  seed();
  const discovery = await (await rpc('tools/list')).json();
  for (const name of ['get_refresh_contract', 'begin_finance_refresh', 'commit_finance_refresh', 'fail_finance_refresh', 'configure_refresh_schedule', 'get_dashboard_status', 'get_month_summary', 'get_saved_dataset']) assert.ok(discovery.result.tools.some(tool => tool.name === name), `${name} remains discoverable`);
  assert.equal((await call('get_refresh_contract')).endpoint, '/api/refresh');
  let begin = await call('begin_finance_refresh');
  assert.equal((await call('begin_finance_refresh')).runId, begin.runId, 'An active refresh cannot gain a second writer');
  const savedBeforeBadOrigin = rows();
  const blocked = await (await rpc('tools/call', { name: 'fail_finance_refresh', arguments: { runId: begin.runId, error: 'blocked' } }, { origin: 'https://foreign.test' })).json();
  assert.equal(blocked.result.isError, true);
  assert.deepEqual(rows(), savedBeforeBadOrigin);
  assert.equal((await api.POST(request('api/refresh', { action: 'fail', runId: begin.runId, error: 'blocked' }, { 'sec-fetch-site': 'cross-site' }))).status, 400);
  assert.deepEqual(rows(), savedBeforeBadOrigin);
  const commit = await call('commit_finance_refresh', { runId: begin.runId, bundle });
  assert.equal(commit.success, true);
  let state = await store.readState();
  assert.deepEqual(state.overrides, corrections);
  assert.deepEqual(state.reviewPreferences, preferences);
  assert.deepEqual(state.refresh.schedule, schedule, 'Publishing-independent refresh schedule metadata survives source refresh');
  assert.equal(state.settings.savingsTarget, 37);
  assert.deepEqual(await store.readRecord('budget-plan-v1'), { savedPlan: 'synthetic sentinel' });
  assert.equal((await call('get_dashboard_status')).refresh.lastRun.id, begin.runId);
  // Actual high-confidence provider salary evidence is supported without an
  // employer-name rule. Explicit correction still uses the same saved API.
  assert.equal(state.dataset.transactions.find(row => row.id === 'salary').flow, 'income');
  assert.equal(state.dataset.transactions.find(row => row.id === 'salary').category, 'Payroll');
  await call('update_transaction_classification', { id: 'salary', patch: { flow: 'income', category: 'Cash income', review: false } });
  for (const periodMode of ['month', 'ytd', 'year']) assert.equal((await call('get_month_summary', { month: '2026-10', periodMode })).income, 1000);
  const committed = rows(), count = logs();
  await call('commit_finance_refresh', { runId: begin.runId, bundle });
  assert.deepEqual(rows(), committed); assert.equal(logs(), count);
  assert.equal((await refresh.failRefresh(begin.runId, 'Late client error')).alreadyCommitted, true);
  assert.deepEqual(rows(), committed);

  seed(); begin = await refresh.beginRefresh(); loseAcknowledgment = true;
  assert.equal((await refresh.commitRefresh(begin.runId, bundle)).success, true, 'Lost success acknowledgment is safely retried');
  assert.equal((await store.readState()).refresh.lastRun.status, 'succeeded');
  seed(); begin = await refresh.beginRefresh(); failLast = true;
  await assert.rejects(refresh.commitRefresh(begin.runId, bundle), error=>error.code==='STORAGE_UNAVAILABLE'&&error.status===503&&/could not confirm/.test(error.message));
  state = await store.readState(); assert.deepEqual(state.dataset, base); assert.deepEqual(state.overrides, corrections); assert.equal(state.refresh.lastRun.status, 'failed'); assert.equal(logs(), 0);
  assert.match(state.refresh.lastRun.error,/could not confirm.*Reload saved data/);assert.doesNotMatch(state.refresh.lastRun.error,/D1_ERROR|private|SQL|values/,'Saved refresh status must not retain raw storage error details');
  seed(); begin = await refresh.beginRefresh();
  const incomplete = structuredClone(bundle); incomplete.bank[0].result.has_more = true; incomplete.bank[0].result.next_cursor = 'missing-page';
  await assert.rejects(refresh.commitRefresh(begin.runId, incomplete), /pagination/);
  assert.deepEqual((await store.readState()).dataset, base); assert.equal(logs(), 0);
  seed(); begin = await refresh.beginRefresh();
  await store.saveDataset({ ...base, notes: ['A concurrent source update'] });
  await assert.rejects(refresh.commitRefresh(begin.runId, bundle), /snapshot changed/);
  assert.deepEqual((await store.readState()).dataset.notes, ['A concurrent source update']);
  console.log('Synthetic GPT refresh contract passed: discovery and readback, private response caching, cross-origin rejection, retained history/corrections/preferences/budget, pending transitions, complete pagination, atomic rollback, safe retries and concurrent-source protection.');
} finally {
  mock.timers.reset();
  delete globalThis.__neonworthRefreshContractEnv;
  sqlite.close();
  await rm(temp, { recursive: true, force: true });
}
