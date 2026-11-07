// Synthetic server render of the actual RecurringReview component; no browser, network or private data.
// A local resolve/load hook transpiles project .ts/.tsx (JSX) and maps the "@/" alias. Static and
// dynamic imports both go through these hooks, so lazy page imports would be handled the same way.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const rootPath = fileURLToPath(root);
const candidates = base => [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const base = fileURLToPath(new URL(specifier.slice(2), root));
      const found = candidates(base).find(path => existsSync(path) && !path.endsWith('/'));
      if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
    }
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      const base = fileURLToPath(new URL(specifier, context.parentURL));
      const found = candidates(base).slice(1).find(path => existsSync(path));
      if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && /\.tsx?$/.test(url)) {
      const path = fileURLToPath(url);
      if (path.startsWith(rootPath) && !path.includes('/node_modules/')) {
        const output = ts.transpileModule(readFileSync(path, 'utf8'), { fileName: path, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, verbatimModuleSyntax: false } }).outputText;
        return { format: 'module', source: output, shortCircuit: true };
      }
    }
    return nextLoad(url, context);
  },
});

const { createElement, isValidElement, Children } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');
const { Bar, BarChart, ResponsiveContainer } = await import('recharts');
const { default: RecurringReview, RecurringHistoryChart } = await import('../app/recurring-review.tsx');
const { summarizeRecurring } = await import('../lib/recurring.ts');

const account = { id: 'checking', name: 'Synthetic checking', institution: 'Example', type: 'depository', subtype: 'checking', mask: '0000', balance: 0, netBalance: 0, balanceDate: null, balanceAgeKnown: false, syncStatus: 'synced' };
const tx = (id, date, amount, extra = {}) => ({ id, date, merchant: id, accountId: 'checking', amount, category: 'Other', flow: 'expense', confidence: 'HIGH', exceptional: false, note: '', pending: false, review: false, ...extra });
const base = {
  version: 1, syncedAt: '2026-10-25T00:00:00Z', asOf: '2026-10-25', dateRange: { start: '2025-10-01', end: '2026-10-25' },
  coverage: { transactions: { is_complete_for_query: true, availability: 'ready', window: { start: '2025-01-01', end: '2027-01-01' } } },
  accounts: [account], netWorthHistory: [], notes: [], recurring: [],
  transactions: [
    ...['2026-03-24', '2026-04-24', '2026-05-24', '2026-06-24'].map((date, i) => tx(`google-${i}`, date, 21.59, { merchant: 'Google One', sourceCategoryDetailed: 'services_digital_other_services' })),
    ...['2026-06-17', '2026-07-17', '2026-08-17'].map((date, i) => tx(`geico-${i}`, date, i === 2 ? 416.62 : 302.79, { merchant: 'GEICO', sourceCategoryDetailed: 'financial_insurance' })),
    tx('geico-refund', '2026-09-09', -82.94, { merchant: 'GEICO', sourceCategoryDetailed: 'financial_insurance' }),
    ...['2026-08-20', '2026-09-20', '2026-10-20'].map((date, i) => tx(`github-${i}`, date, 4.42, { merchant: 'GitHub', sourceCategoryDetailed: 'services_digital_other_services' })),
  ],
};
const period = { start: '2026-01-01', end: '2026-10-25' };
const summary = summarizeRecurring(base, period);
const byName = name => summary.groups.find(g => g.name === name);
const github = byName('GitHub'), geico = byName('GEICO'), google = byName('Google One');
assert.equal(github.status, 'ongoing'); assert.equal(geico.status, 'uncertain'); assert.equal(google.status, 'likely-stopped');

const render = (data, extra = {}) => renderToStaticMarkup(createElement(RecurringReview, { data, month: '2026-10', periodMode: 'ytd', hidden: false, onSetRecurringStatus: async () => {}, onEdit: () => {}, ...extra }));
const anchor = id => `id="recurring-bill-${encodeURIComponent(id)}"`;
const detailsFor = (html, id) => { const start = html.indexOf(anchor(id)); assert.ok(start >= 0, `row ${id} rendered`); const end = html.indexOf('</article>', start); return html.slice(start, end); };

// Active services are listed first, ahead of ambiguous ones (GEICO's insurance kind sorted first before this change).
{
  const html = render(base);
  assert.ok(html.indexOf(anchor(github.id)) < html.indexOf(anchor(geico.id)), 'supported ongoing service precedes an uncertain one');
  assert.ok(html.indexOf(anchor(github.id)) < html.indexOf(anchor(google.id)), 'supported ongoing service precedes a likely-stopped one');
  const row = detailsFor(html, github.id);
  assert.match(row, /Last charge Oct 20 · [^<]+ · (high|medium) confidence/, 'last charge, cadence and confidence shown');
  assert.match(row, /Active · no action needed/);
  assert.doesNotMatch(html, /check the next statement/i, 'ongoing rows no longer ask to check every statement');
}
// Manual correction is optional and collapsed for a supported active service.
{
  const row = detailsFor(render(base, { focusGroupId: github.id }), github.id);
  assert.match(row, /<details class="recurring-status-correction">/, 'collapsed disclosure (no open attribute)');
  assert.match(row, /Correct this status \(optional\)/);
  assert.match(row, /No confirmation is needed/);
  assert.match(row, /Mark ongoing/); assert.doesNotMatch(row, /Confirm ongoing/, 'no repeated confirmation invitation');
  assert.match(row, /Mark stopped/); assert.match(row, /Use detection/);
  assert.match(row, /does not cancel a service/);
  assert.ok(row.indexOf('recurring-save-feedback') > row.indexOf('</details>'), 'save feedback region sits outside the disclosure so errors remain visible');
}
// Uncertain service status remains visible but its planning editor is optional and collapsed.
for (const group of [geico, google]) {
  const row = detailsFor(render(base, { focusGroupId: group.id }), group.id);
  assert.match(row, /<details class="recurring-status-correction">/, `${group.name}: optional editor is collapsed`);
  assert.match(row, /Add service status \(optional\)/); assert.match(row, /Mark ongoing/);
  assert.match(row, /Historical payments and spending totals are unchanged/);
  assert.doesNotMatch(row, /Needs confirmation|Confirm ongoing/);
}
// A saved stopped status contradicted by a later charge stays visible without demanding a history edit.
{
  const conflicted = { ...base, reviewPreferences: { findingResolutions: {}, recurringStatuses: { [github.id]: { status: 'stopped', effectiveDate: '2026-09-25', updatedAt: '2026-10-25T00:00:00Z' } } } };
  const row = detailsFor(render(conflicted, { focusGroupId: github.id }), github.id);
  assert.match(row, /Later charge after stopped date/); assert.match(row, /Optional: update your planning status/);
  assert.doesNotMatch(row, /<details class="recurring-status-correction" open=/);
  // A user-confirmed ongoing status is shown as confirmed, not re-requested.
  const confirmed = { ...base, reviewPreferences: { findingResolutions: {}, recurringStatuses: { [github.id]: { status: 'ongoing', effectiveDate: '2026-10-01', updatedAt: '2026-10-25T00:00:00Z' } } } };
  const confirmedRow = detailsFor(render(confirmed, { focusGroupId: github.id }), github.id);
  assert.match(confirmedRow, /Active · you confirmed/); assert.doesNotMatch(confirmedRow, /open=""/);
  assert.match(confirmedRow,/Your saved choice is applied/);
  assert.doesNotMatch(confirmedRow,/already infers this status/,'saved choices are not mislabeled as inferred');
}
// Hidden amounts are masked everywhere in the view, including expanded rows.
{
  const html = render(base, { hidden: true, focusGroupId: geico.id });
  assert.doesNotMatch(html, /\$\s?\d/, 'no dollar amounts when hidden');
  assert.match(html, /••••/);
  assert.match(html,/Show amounts to view this chart/);
}
// Original recurring source descriptions use the same monetary-prose mask.
{
  const privateData = { ...base, transactions: base.transactions.map(t => t.id === 'github-2' ? { ...t, sourceName: 'GitHub USD 981.23 · $ 88.00 · 350.00credit · account 1234 · 2026-10-20' } : t) };
  const row = detailsFor(render(privateData, { hidden: true, focusGroupId: github.id }), github.id);
  assert.doesNotMatch(row, /981\.23|88\.00|350\.00/);
  assert.match(row, /account 1234 · 2026-10-20/, 'Amounts-only privacy preserves nonmonetary source context');
}
// Inspect the actual element tree: hidden mode must not instantiate a chart or
// pass its private series to Recharts. Server markup alone cannot prove that.
{
  const elements=node=>isValidElement(node)?[node,...Children.toArray(node.props.children).flatMap(elements)]:[];
  const trend=[{label:'Oct',housing:1234.56,subscriptions:98.76}];
  const privateTree=RecurringHistoryChart({trend,hidden:true});
  assert.equal(elements(privateTree).some(node=>[ResponsiveContainer,BarChart,Bar].includes(node.type)),false);
  assert.doesNotMatch(renderToStaticMarkup(privateTree),/1234|98\.76|<svg|aria-valuenow/);
  const visible=elements(RecurringHistoryChart({trend,hidden:false}));
  assert.equal(visible.find(node=>node.type===BarChart).props.data,trend,'recorded series is passed unchanged when shown');
  const bars=visible.filter(node=>node.type===Bar);assert.ok(bars.length>0);
  assert.ok(bars.every(node=>node.props.isAnimationActive===false),'data geometry is stable');
}
// Without a status callback, no correction controls are offered.
{
  const row = detailsFor(render(base, { focusGroupId: geico.id, onSetRecurringStatus: undefined }), geico.id);
  assert.doesNotMatch(row, /recurring-status-correction/);
}
// Source links distinguish a settled payment from an explicit current flag.
{
  const sourceBefore = JSON.stringify(base), summaryBefore = JSON.stringify(summarizeRecurring(base, period));
  const settled = detailsFor(render(base, { focusGroupId: github.id }), github.id);
  assert.match(settled, /View transaction/);
  assert.doesNotMatch(settled, /Review transaction|<th>Review<\/th>/);
  const flagged = { ...base, transactions: base.transactions.map(t => t.id === 'github-2' ? { ...t, review: true, note: 'Check this possible duplicate.' } : t) };
  const flaggedRow = detailsFor(render(flagged, { focusGroupId: github.id }), github.id);
  assert.match(flaggedRow, /Review transaction/, 'An explicit source flag keeps its review action');
  assert.match(flaggedRow, /View transaction/, 'Other payments in the series stay settled');
  assert.equal(JSON.stringify(base), sourceBefore, 'Opening service details does not mutate source records');
  assert.equal(JSON.stringify(summarizeRecurring(base, period)), summaryBefore, 'UI affordances leave complete recurring results unchanged');
}
console.log('Recurring review render passed: active-first ordering, last charge/cadence/confidence, optional collapsed correction, optional uncertainty/conflict controls, accurate source actions, feedback outside disclosure, masked values.');
