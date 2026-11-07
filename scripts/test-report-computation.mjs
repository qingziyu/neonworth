// Execute actual page declarations, including useMemo dependencies, against
// synthetic data. Call counts are a deterministic computation gate; they do not
// establish browser load/navigation latency or visual acceptance.
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import './test-support/register.mjs';
import { financialReviewFixture } from './test-support/financial-review-fixture.mjs';
import { deriveDataset, transactionDisplayName, transactionPurpose, accountDisplayName } from '../lib/classification.ts';
import { summarizePeriod } from '../lib/finance.ts';
import { resolvePeriod } from '../lib/periods.ts';
import { netWorthForPeriod } from '../lib/net-worth.ts';
import { serializeCsv } from '../lib/csv.ts';
import { createReportModelCache } from '../lib/report-model-cache.ts';

const source = await readFile('app/page.tsx', 'utf8');
const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map(), functions = new Map();
let overviewNetWorth, initialReadEffect;
const walk = node => {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) declarations.set(node.name.text, node.initializer);
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node);
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0]?.getText(ast).includes('setNavigationReady(true)')) initialReadEffect = node.arguments[0];
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'PersonalOverview') {
    overviewNetWorth = node.attributes.properties.find(attr => ts.isJsxAttribute(attr) && attr.name.getText(ast) === 'netWorth')?.initializer?.expression;
  }
  ts.forEachChild(node, walk);
};
walk(ast);
const transpile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const compiled = new Map();
function expression(node, environment) {
  assert.ok(node, 'The actual page expression must exist');
  const keys = Object.keys(environment), key = `${node.pos}:${keys.join(',')}`;
  if (!compiled.has(key)) compiled.set(key, new Function(...keys, transpile(`return (${node.getText(ast)});`)));
  return compiled.get(key)(...Object.values(environment));
}
function pageComputations() {
  const cache = new Map();
  return (environment, names) => {
    const state = { ...environment };
    for (const name of names) {
      const useMemo = (calculate, dependencies) => {
        const prior = cache.get(name);
        if (prior && prior.dependencies.length === dependencies.length && dependencies.every((item, index) => Object.is(item, prior.dependencies[index]))) return prior.value;
        const value = calculate(); cache.set(name, { dependencies, value }); return value;
      };
      state[name] = expression(declarations.get(name), { ...state, useMemo });
    }
    return state;
  };
}
const data = deriveDataset(financialReviewFixture().dataset), original = structuredClone(data);
const period = resolvePeriod(data, '2026-10', 'month');
const calls = { summary: 0, net: 0, factories: 0 };
const base = {
  data, month: '2026-10', periodMode: 'month', period, routine: false, nwAllHistory: false,
  resolvePeriod,
  createReportModelCache: () => { calls.factories++; return createReportModelCache(); },
  summarizePeriod: (...args) => { calls.summary++; return summarizePeriod(...args); },
  netWorthForPeriod: (...args) => { calls.net++; return netWorthForPeriod(...args); },
};
const names = ['reportModels', 'excludeOneOffs', 'needsSummary', 'summary', 'totalSummary', 'period', 'netView', 'latestNetPoint'];
// latestNetPoint is one declaration within a multi-declaration statement.
const run = pageComputations();
let overview;
for (const section of ['Overview', 'Goals', 'Overview', 'Year in Review', 'Accounts & data', 'Net worth', 'Overview', 'Spending', 'Cash flow']) {
  const before = { ...calls }, result = run({ ...base, section }, names);
  if (['Overview', 'Spending', 'Cash flow'].includes(section)) {
    assert.deepEqual(result.summary, summarizePeriod(data, base.month, base.periodMode));
    assert.equal(result.totalSummary, result.summary, 'Unfiltered totals reuse the same canonical summary');
  } else {
    assert.equal(result.summary, null); assert.equal(result.totalSummary, null);
    assert.equal(calls.summary, before.summary, `${section} does not run the unused period summarizer`);
  }
  if (['Overview', 'Net worth'].includes(section)) {
    assert.deepEqual(result.netView, netWorthForPeriod(data, period, false));
    assert.equal(result.latestNetPoint.date, '2026-10-29', 'Independent observation dates retain the canonical rule');
    if (section === 'Overview') {
      overview = result;
      assert.deepEqual(expression(overviewNetWorth, result), { value: 125000, date: '2026-10-29' }, 'Overview receives its real dated balance, not a gated-out unavailable state');
    }
  } else {
    assert.equal(result.netView, null);
    assert.equal(calls.net, before.net, `${section} does not run an unused net-worth calculation`);
  }
}
assert.deepEqual(calls, { summary: 1, net: 1, factories: 1 }, 'Overview → Goals → Overview and other warm returns reuse models instead of only skipping inactive work');
const spending = run({ ...base, section: 'Spending', routine: true }, names);
assert.deepEqual(spending.summary, summarizePeriod(data, base.month, base.periodMode, true));
assert.deepEqual(spending.totalSummary, summarizePeriod(data, base.month, base.periodMode, false), 'Tagged one-off exclusion does not alter full spending');
const routineCounts = { ...calls };
run({ ...base, section: 'Goals' }, names);
const warmRoutine = run({ ...base, section: 'Spending', routine: true }, names);
assert.equal(warmRoutine.summary, spending.summary); assert.equal(warmRoutine.totalSummary, spending.totalSummary);
assert.deepEqual(calls, routineCounts, 'Both full and routine models survive leaving and returning');
const unchanged = { ...calls };
run({ ...base, section: 'Spending', routine: true, hidden: true }, names);
assert.deepEqual(calls, unchanged, 'Privacy-only rerenders reuse financial calculations');
const historicalPeriod = resolvePeriod(data, '2026-07', 'month');
const historical = run({ ...base, section: 'Overview', month: '2026-07', period: historicalPeriod }, names);
assert.deepEqual(expression(overviewNetWorth, historical), { value: 105000, date: '2026-07-01' }, 'Historical navigation does not substitute a later balance');
const year = run({ ...base, section: 'Overview', periodMode: 'ytd' }, names);
assert.deepEqual(year.summary, summarizePeriod(data, base.month, 'ytd'));
assert.deepEqual(year.netView, netWorthForPeriod(data, resolvePeriod(data, base.month, 'ytd'), false));
const beforeHistory = calls.net;
const allHistory = run({ ...base, section: 'Net worth', nwAllHistory: true }, names);
assert.equal(calls.net, beforeHistory + 1);
assert.deepEqual(allHistory.netView, netWorthForPeriod(data, period, true), 'All-history basis is a distinct model input');
for (const change of ['source', 'correction']) {
  const nextSource = financialReviewFixture().dataset;
  if (change === 'source') nextSource.transactions.find(record => record.id === 'rent-10').amount += 50;
  const replacement = deriveDataset(nextSource, change === 'correction' ? { 'rent-10': { category: 'Shopping' } } : {});
  const before = { ...calls };
  const refreshed = run({ ...base, section: 'Overview', data: replacement }, names);
  assert.equal(calls.factories, before.factories + 1, `${change} replacement recreates the real Home cache owner`);
  assert.equal(calls.summary, before.summary + 1); assert.equal(calls.net, before.net + 1);
  assert.notEqual(refreshed.reportModels, overview.reportModels);
  assert.notEqual(refreshed.summary, overview.summary);
  assert.deepEqual(refreshed.summary, summarizePeriod(replacement, base.month, base.periodMode));
}

// An explicit matrix covers each ledger mode, AND-combined filters and signed
// refunds. These are synthetic already-derived records, not reclassification.
const seed = data.transactions.find(row => row.flow === 'expense' && !row.pending);
const row = (id, day, extra = {}) => ({ ...seed, id, date: `2026-10-${String(day).padStart(2, '0')}`, accountId: 'old-card', category: 'Dining', merchant: id, sourceName: id, note: '', amount: 10, flow: 'expense', pending: false, exceptional: false, review: false, incomePolicyExcluded: false, categoryReviewOptional: false, ...extra });
const records = [row('meal', 1, { amount: 12.34 }), row('refund', 2, { amount: -2.34 }), row('pending', 3, { pending: true }), row('one-off', 4, { exceptional: true }), row('payroll', 5, { accountId: 'checking', flow: 'income', amount: -4000 }), row('payment', 6, { flow: 'transfer' }), row('credit', 7, { flow: 'transfer', incomePolicyExcluded: true }), row('flag', 8, { review: true }), row('unknown', 9, { flow: 'review' }), row('optional', 10, { categoryReviewOptional: true })];
const accountsById = new Map(data.accounts.map(account => [account.id, account]));
const accountName = id => { const account = accountsById.get(id); return account ? `${accountDisplayName(account)}${account.mask ? ` · •••• ${account.mask}` : ''}` : 'Unlisted account'; };
const ledgerBase = { section: 'Transactions', periodTransactions: records, data, evidenceIdSet: null, includePending: false, ledgerRoutine: false, account: 'all', flow: 'all', category: 'all', search: '', accountsById, transactionDisplayName, transactionPurpose, accountName, createReportModelCache };
const ledgerRun = pageComputations();
const ledgerNames = ['reportModels', 'ledger'];
const cases = [
  [{}, ['optional', 'unknown', 'flag', 'credit', 'payment', 'payroll', 'one-off', 'refund', 'meal']],
  [{ flow: 'expense' }, ['optional', 'flag', 'one-off', 'refund', 'meal']],
  [{ flow: 'expense', ledgerRoutine: true }, ['optional', 'flag', 'refund', 'meal']],
  [{ flow: 'income' }, ['payroll']], [{ flow: 'transfer' }, ['payment']],
  [{ flow: 'non-income' }, ['credit']], [{ flow: 'needs-review' }, ['unknown', 'flag']],
  [{ flow: 'category-detail' }, ['optional']], [{ flow: 'review' }, ['unknown']],
  [{ includePending: true, search: 'pending' }, ['pending']],
  [{ evidenceIdSet: new Set(['meal', 'refund', 'payroll']), flow: 'expense', category: 'Dining', account: 'old-card' }, ['refund', 'meal']],
  [{ account: 'checking' }, ['payroll']], [{ category: 'Absent' }, []],
];
let exportLedger;
for (const [filters, ids] of cases) {
  const result = ledgerRun({ ...ledgerBase, ...filters }, ledgerNames).ledger;
  assert.deepEqual(result.map(record => record.id), ids);
  result.forEach(record => assert.equal(record, records.find(item => item.id === record.id), 'Ledger and editor retain canonical record identity'));
  if (filters.evidenceIdSet) exportLedger = result;
}
const doNotTraverse = new Proxy(records, { get(target, key, receiver) { if (key === 'filter' || key === 'sort') throw new Error('Inactive report scanned ledger records'); return Reflect.get(target, key, receiver); } });
for (const section of ['Overview', 'Goals', 'Year in Review', 'Accounts & data', 'Net worth']) assert.deepEqual(ledgerRun({ ...ledgerBase, section, periodTransactions: doNotTraverse }, ledgerNames).ledger, []);
let scans = 0;
const countedRecords = new Proxy(records, { get(target, key, receiver) { if (key === 'filter') return callback => { scans++; return target.filter(callback); }; return Reflect.get(target, key, receiver); } });
const warmLedgerRun = pageComputations(), warmLedgerInput = { ...ledgerBase, periodTransactions: countedRecords };
const firstLedger = warmLedgerRun(warmLedgerInput, ledgerNames);
for (const section of ['Goals', 'Overview', 'Year in Review', 'Accounts & data']) assert.deepEqual(warmLedgerRun({ ...warmLedgerInput, section }, ledgerNames).ledger, []);
const returnedLedger = warmLedgerRun(warmLedgerInput, ledgerNames);
assert.equal(scans, 1, 'Warm transaction return does not filter or sort again');
assert.equal(returnedLedger.ledger, firstLedger.ledger, 'The exact ledger result and its source-row identities survive warm navigation');
const filterChanged = warmLedgerRun({ ...warmLedgerInput, flow: 'income' }, ledgerNames);
assert.equal(scans, 2); assert.deepEqual(filterChanged.ledger.map(record => record.id), ['payroll']);
warmLedgerRun({ ...warmLedgerInput, data: { ...data } }, ledgerNames);
assert.equal(scans, 3, 'A new snapshot invalidates the ledger even if test row identities were retained');
const correctedRecords = records.map(record => record.id === 'meal' ? { ...record, category: 'Travel' } : record);
const correctedLedger = warmLedgerRun({ ...warmLedgerInput, data: { ...data }, periodTransactions: correctedRecords, category: 'Travel' }, ledgerNames);
assert.equal(correctedLedger.ledger[0], correctedRecords[0]); assert.equal(correctedLedger.ledger.length, 1);
const otherPeriod = warmLedgerRun({ ...warmLedgerInput, periodTransactions: [records[1]] }, ledgerNames);
assert.deepEqual(otherPeriod.ledger, [records[1]], 'A changed period result cannot reuse the prior ledger');
const accountSearch = pageComputations(), searchInput = { ...ledgerBase, search: 'RenamedAccountCanary' };
assert.deepEqual(accountSearch(searchInput, ledgerNames).ledger, []);
const renamedAccounts = new Map(accountsById);
renamedAccounts.set('old-card', { ...accountsById.get('old-card'), name: 'RenamedAccountCanary' });
const renamed = accountSearch({ ...searchInput, accountsById: renamedAccounts, accountName: id => renamedAccounts.get(id)?.name || '' }, ledgerNames);
assert.equal(renamed.ledger.length, 8, 'Changed account-label evidence invalidates a cached text-search result');
const cash = pageComputations();
assert.deepEqual(cash({ ...ledgerBase, section: 'Cash flow' }, ['amazonCashRows']).amazonCashRows.map(record => record.id), ['payroll']);
for (const section of ['Goals', 'Year in Review', 'Accounts & data']) assert.deepEqual(cash({ ...ledgerBase, section, periodTransactions: doNotTraverse }, ['amazonCashRows']).amazonCashRows, []);
const trend = pageComputations();
const trendBase = { section: 'Spending', periodTrend: [{ month: '2026-10', spending: 40, label: 'Oct 26' }], periodTransactions: records, spendCat: 'all', routine: false, sumAmounts: expression(declarations.get('sumAmounts'), {}) };
assert.equal(trend(trendBase, ['categoryTrend']).categoryTrend[0].value, 40);
assert.equal(trend({ ...trendBase, spendCat: 'Dining' }, ['categoryTrend']).categoryTrend[0].value, 40, 'Category trend retains posted expense/refund arithmetic');
assert.equal(trend({ ...trendBase, spendCat: 'Dining', routine: true }, ['categoryTrend']).categoryTrend[0].value, 30, 'Category trend excludes the tagged expense only when selected');
for (const section of ['Overview', 'Goals', 'Year in Review', 'Accounts & data']) assert.deepEqual(trend({ ...trendBase, section, spendCat: 'Dining', periodTransactions: doNotTraverse }, ['categoryTrend']).categoryTrend, []);
const exceptional = pageComputations();
assert.equal(exceptional(trendBase, ['exceptionalAmount']).exceptionalAmount, 10);
for (const section of ['Overview', 'Goals', 'Year in Review', 'Accounts & data']) assert.equal(exceptional({ ...trendBase, section, periodTransactions: doNotTraverse }, ['exceptionalAmount']).exceptionalAmount, 0);
const exportCode = transpile(`${functions.get('accountLedgerLabel').getText(ast)}\n${functions.get('transactionExportRows').getText(ast)}\nreturn transactionExportRows;`);
const exportRows = new Function('accountDisplayName', 'transactionDisplayName', 'transactionPurpose', exportCode)(accountDisplayName, transactionDisplayName, transactionPurpose);
const exported = exportRows(exportLedger, data.accounts);
assert.equal(exported.length, 3);
assert.deepEqual(exported.slice(1).map(values => [values[0], values[4], values[8]]), [['2026-10-02', 'refund', 2.34], ['2026-10-01', 'meal', -12.34]], 'CSV uses exact filtered order and signed cash amounts');
assert.equal(serializeCsv(exported), serializeCsv(exportRows([records[1], records[0]], data.accounts)));
assert.equal(serializeCsv(exportRows(returnedLedger.ledger, data.accounts)), serializeCsv(exportRows(firstLedger.ledger, data.accounts)), 'Warm navigation preserves exact CSV output');
assert.deepEqual(data, original, 'Memo gates and presentation leave the source untouched');

// Actual Home initialization must continue when privacy storage is blocked.
const initialization = [], listeners = new Map();
const initialCleanup = expression(initialReadEffect, {
  load: initial => initialization.push(['load', initial]),
  localStorage: { getItem() { throw new DOMException('Synthetic blocked storage', 'SecurityError'); } },
  setHidden: value => initialization.push(['hidden', value]),
  readNavigation: () => ({ section: 'Transactions', month: '2026-07', mode: 'year' }),
  setSection: value => initialization.push(['section', value]), setMonth: value => initialization.push(['month', value]),
  setPeriodMode: value => initialization.push(['mode', value]), setMobile: value => initialization.push(['mobile', value]),
  setNavigationOpen: value => initialization.push(['navigation', value]), setNavigationReady: value => initialization.push(['ready', value]),
  window: { addEventListener: (name, listener) => listeners.set(name, listener), removeEventListener: (name, listener) => { assert.equal(listeners.get(name), listener); listeners.delete(name); } },
})();
assert.deepEqual(initialization, [['load', true], ['section', 'Transactions'], ['month', '2026-07'], ['mode', 'year'], ['mobile', false], ['navigation', false], ['ready', true]]);
assert.equal(listeners.has('popstate'), true); initialCleanup(); assert.equal(listeners.size, 0);

// Render the actual Overview with the prop produced by Home, including privacy.
await mkdir('.sites-runtime', { recursive: true });
const temp = await mkdtemp(path.resolve('.sites-runtime/report-computation-'));
try {
  for (const name of ['workspace-effects', 'personal-overview']) {
    let js = transpile(await readFile(`app/${name}.tsx`, 'utf8'));
    js = js.replace(/(['"])@\/([^'"]+)\1/g, (_, quote, specifier) => JSON.stringify(pathToFileURL(path.resolve(`${specifier}.ts`)).href));
    js = js.replace(/(['"])\.\/workspace-effects\1/g, "'./workspace-effects.mjs'");
    await writeFile(path.join(temp, `${name}.mjs`), js);
  }
  const { default: Overview } = await import(pathToFileURL(path.join(temp, 'personal-overview.mjs')).href);
  const noop = () => {};
  const props = { data, month: base.month, periodMode: base.periodMode, summary: overview.summary, periodLabel: period.label, netWorth: expression(overviewNetWorth, overview), budget: null, chart: null, chartLegend: null, categories: null, reconciliation: null, onEdit: noop, onReview: noop, onData: noop, onGoals: noop, onNetWorth: noop, onBills: noop, onIncome: noop, onSpending: noop };
  const shown = renderToStaticMarkup(React.createElement(Overview, { ...props, hidden: false }));
  assert.match(shown, /125,000/); assert.doesNotMatch(shown, /No dated snapshot/);
  const hidden = renderToStaticMarkup(React.createElement(Overview, { ...props, hidden: true }));
  assert.doesNotMatch(hidden, /125,000|125000|aria-valuenow|progressbar/);
  assert.match(hidden, /Recorded Oct 29, 2026/, 'Amounts-only privacy retains the real observation date');
} finally { await rm(temp, { recursive: true, force: true }); }
console.log('Report computation passed: actual memo/cache ownership, warm report reuse, source/correction/filter/scope invalidation, canonical outputs, exact ledger/CSV, blocked-storage initialization and Overview shown/hidden rendering. Browser timing is a separate gate.');
