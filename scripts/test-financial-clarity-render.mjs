import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { financialReviewFixture } from './test-support/financial-review-fixture.mjs';
import { summarizeGoals } from '../lib/goals.ts';
import { money } from '../lib/finance.ts';
import { summarizeBudget, summarizeBudgetCategoryDetail } from '../lib/budget.ts';
import { summarizeYearReview } from '../lib/year-review.ts';
import { resolvePeriod } from '../lib/periods.ts';

// Render the real components and invoke their actual source-drilldown callbacks.
// SSR cannot run fetch effects or keyboard events: only SpendingComposition's
// initial plan is injected, representing a successful synthetic GET /api/budget.
// Browser focus, Enter/Space and geometry remain separate acceptance checks.
const root = path.resolve(import.meta.dirname, '..');
const output = await fs.mkdtemp(path.join(root, '.sites-runtime', 'financial-clarity-'));
const emitted = new Set();
let planInjections = 0;
async function compile(relative) {
  const target = path.join(output, relative.replace(/\.tsx?$/, '.mjs'));
  if (emitted.has(relative)) return target;
  emitted.add(relative);
  const transformer = context => source => {
    const visit = node => {
      if (relative === 'app/spending-composition.tsx' && ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.name.elements[0]?.name?.getText(source) === 'plan' && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(source) === 'useState') {
        planInjections++;
        return context.factory.updateVariableDeclaration(node, node.name, node.exclamationToken, node.type,
          context.factory.updateCallExpression(node.initializer, node.initializer.expression, node.initializer.typeArguments, [context.factory.createPropertyAccessExpression(context.factory.createIdentifier('globalThis'), '__financialClarityPlan')]));
      }
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(source, visit);
  };
  let code = ts.transpileModule(await fs.readFile(path.join(root, relative), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
    fileName: relative, transformers: { before: [transformer] },
  }).outputText;
  const dependencies = [];
  code = code.replace(/from\s+(['"])(@\/[^'"]+|\.{1,2}\/[^'"]+)\1/g, (_, quote, specifier) => {
    const base = (specifier.startsWith('@/') ? specifier.slice(2) : path.join(path.dirname(relative), specifier)).replace(/\.tsx?$/, '');
    dependencies.push(base);
    let rewrite = path.relative(path.dirname(relative), base + '.mjs').replaceAll(path.sep, '/');
    if (!rewrite.startsWith('.')) rewrite = './' + rewrite;
    return `from ${quote}${rewrite}${quote}`;
  });
  if (relative === 'app/budget.tsx') code += '\nexport { CategoryDetail };\n';
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, code);
  for (const base of dependencies) await compile(await fs.access(path.join(root, base + '.ts')).then(() => base + '.ts', () => base + '.tsx'));
  return target;
}
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));
const elements = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(elements)] : [];
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : React.isValidElement(node) ? React.Children.toArray(node.props.children).map(text).join('') : '';
function probe(component, props) {
  let tree;
  function Probe() { tree = component(props); return tree; }
  return { markup: render(Probe, {}), elements: () => elements(tree) };
}
const warn = console.warn;
console.warn = (...args) => { if (!String(args[0]).startsWith('The width(')) warn(...args); };
try {
  const fixture = financialReviewFixture(), data = structuredClone(fixture.dataset), plan = fixture.budget;
  const sourceBefore = JSON.stringify(fixture);
  const row = (id, date, amount, extra = {}) => ({ ...data.transactions.find(t => t.id === 'large-purchase'), id, date, amount, merchant: 'Synthetic $1234.56 equipment', accountId: 'old-card', note: 'Synthetic private note $9876.54', ...extra });
  data.transactions.push(row('detail-charge', '2026-09-03', 1234.56), row('detail-credit', '2026-10-03', -1234.56), row('detail-benefit', '2026-10-04', -31.29, { merchant: 'Platinum Hotel Credit', category: 'Travel' }));
  const goals = await import(pathToFileURL(await compile('app/goals.tsx')));
  const budget = await import(pathToFileURL(await compile('app/budget.tsx')));
  const yearReview = await import(pathToFileURL(await compile('app/year-in-review-view.tsx')));
  const composition = (await import(pathToFileURL(await compile('app/spending-composition.tsx')))).default;
  assert.equal(planInjections, 1, 'Only the loaded synthetic plan state is injected');

  const pairProps = { year: 2026, scopeLabel: 'Goal year', cash: -1234.56, cashAndEquity: 765.44, tracked: 'cash', hidden: false };
  const pair = render(goals.SurplusPair, pairProps);
  assert.match(pair, /Cash-only surplus/); assert.match(pair, /Cash \+ received equity/);
  assert.ok(pair.includes(`${money(-1234.56, 0)} deficit`)); assert.ok(pair.includes(money(765.44, 0)));
  assert.equal((pair.match(/Tracks your target/g) || []).length, 1, 'One saved target basis is distinguished from the second measure');
  assert.match(pair, /receipt valuation · not cash/);
  const missingPair = render(goals.SurplusPair, { ...pairProps, cashAndEquity: null });
  assert.ok(missingPair.includes(money(-1234.56, 0))); assert.match(missingPair, /Unavailable · a received-share price is missing/);
  const hiddenPair = render(goals.SurplusPair, { ...pairProps, hidden: true });
  assert.equal((hiddenPair.match(/<dd>••••<\/dd>/g) || []).length, 2);
  assert.doesNotMatch(hiddenPair, /\$|1234|765|aria-valuenow|width:|is-deficit/);
  const futurePair = render(goals.SurplusPair, { ...pairProps, year: 2027, cash: null, cashAndEquity: null });
  assert.equal((futurePair.match(/<dd>Unavailable<\/dd>/g) || []).length, 2, 'An empty future year does not imply zero surplus');

  const oldSettings = { ...fixture.planning.goals, savings: { year: 2025, targetAmount: 5000, basis: 'cash' } };
  const summary = summarizeGoals(data, oldSettings, 2026, '2026-10-29');
  const goalsMarkup = render(goals.GoalsContent, { data, settings: oldSettings, hidden: false, onSave: async () => {}, onIncome() {}, onNetWorth() {}, onRetirement() {} });
  const pairs = [...goalsMarkup.matchAll(/<dl class="goal-surplus-pair"[^>]*aria-label="([^"]+)"[^>]*>([\s\S]*?)<\/dl>/g)];
  assert.equal(pairs.length, 2);
  assert.match(pairs[0][1], /Goal year 2025/); assert.match(pairs[1][1], /Trend year 2026/);
  assert.ok(pairs[0][2].includes(money(summary.savings.cashActual, 0)), 'Goal pair uses the goal year actual');
  assert.ok(pairs[1][2].includes(money(summary.cashSurplus, 0)), 'Trend pair uses its separate selected year actual');

  for (const mode of ['month', 'ytd', 'year']) {
    const calls = [], expected = summarizeBudgetCategoryDetail(data, '2026-10', mode, plan, 'annual', 'shopping');
    const props = { id: `test-${mode}`, data, plan, month: '2026-10', mode, bucket: 'annual', categoryId: 'shopping', hidden: false, fmt: (value, digits = 0) => money(value, digits), onOpen: (...args) => calls.push(args) };
    const detail = probe(budget.CategoryDetail, props);
    assert.match(detail.markup, /role="region"/); assert.match(detail.markup, /Charges less credits/);
    for (const value of [expected.gross, expected.credits, expected.net]) assert.ok(detail.markup.includes(money(value, 2)), `The ${mode} detail shows exact-cent totals`);
    const all = detail.elements().find(e => e.type === 'button' && /^Open all /.test(text(e)));
    assert.ok(all); all.props.onClick();
    assert.deepEqual(calls[0], [expected.ids, mode, '2026-10'], 'All-source callback retains exact canonical category IDs and its stated period');
    const paired = detail.elements().find(e => e.type === 'button' && /Credit \+ inferred purchase/.test(text(e)));
    assert.ok(paired); paired.props.onClick();
    const pairCall = calls.at(-1), pairWindow = resolvePeriod(data, pairCall[2], pairCall[1]);
    assert.deepEqual([...pairCall[0]].sort(), ['detail-charge', 'detail-credit']);
    for (const id of pairCall[0]) { const source = data.transactions.find(row => row.id === id); assert.ok(source.date >= pairWindow.start && source.date <= pairWindow.end, 'Actual pair callback includes both dates, even from month detail'); }
    const hidden = render(budget.CategoryDetail, { ...props, hidden: true, fmt: () => '••••' });
    assert.doesNotMatch(hidden, /\$[\d,]|9876|1234|aria-valuenow|width:/, 'Hidden category detail removes monetary source text and numeric displays');
    assert.match(hidden, /Synthetic •••• equipment/);
  }
  const monthlyBudget = render(budget.default, { data, month: '2026-10', periodMode: 'month', hidden: false, onTransactions() {} });
  assert.match(monthlyBudget, /<button[^>]*class="budget-category-button budget-category-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="budget-detail-monthly-housing"/);

  globalThis.__financialClarityPlan = plan;
  const compositionCalls = [], compositionSummary = summarizeBudget(data, '2026-10', 'ytd', plan);
  const composed = probe(composition, { data, month: '2026-10', periodMode: 'ytd', hidden: false, onTransactions: (...args) => compositionCalls.push(args) });
  const fixed = composed.elements().find(e => e.type === 'button' && /source records? for Periodic fixed bills$/.test(e.props['aria-label'] || ''));
  assert.ok(fixed); fixed.props.onClick();
  assert.deepEqual(compositionCalls[0], [compositionSummary.annualRows.find(r => r.id === 'annual_bills').ids, 'ytd', '2026-10']);
  assert.ok(composed.elements().some(e => e.type === 'button' && text(e) === 'Periodic fixed bills'), 'The category name itself is keyboard-actionable');
  const hiddenComposition = render(composition, { data, month: '2026-10', periodMode: 'ytd', hidden: true, onTransactions() {} });
  assert.doesNotMatch(hiddenComposition, /\$[\d,]|aria-valuenow|width:/);

  const reviewData = structuredClone(data);
  reviewData.accounts.find(row => row.id === 'old-card').name = 'Synthetic card $7654.32';
  const year = summarizeYearReview(reviewData, plan, 2026, []), standalone = year.standalone.find(item => item.purchase.id === 'detail-charge');
  assert.ok(standalone); assert.equal(standalone.net, 0); assert.equal(standalone.credits.length, 1);
  const refundCalls = [], refundProps = { items: [standalone], data: reviewData, hidden: false, year: 2026, onTransactions: (...args) => refundCalls.push(args) };
  const refundPanel = probe(yearReview.StandaloneRefundPanel, refundProps);
  assert.match(refundPanel.markup, /inferred; not provider-confirmed/); assert.match(refundPanel.markup, /fully refunded/);
  assert.ok(refundPanel.markup.includes(money(1234.56, 2))); assert.ok(refundPanel.markup.includes(money(-1234.56, 2))); assert.ok(refundPanel.markup.includes(money(0, 2)));
  const refundOpen = refundPanel.elements().find(e => e.type === 'button' && /Open purchase \+ refund/.test(text(e)));
  assert.ok(refundOpen); refundOpen.props.onClick(); assert.deepEqual(refundCalls[0], [['detail-charge', 'detail-credit'], 2026]);
  const hiddenRefund = render(yearReview.StandaloneRefundPanel, { ...refundProps, hidden: true });
  assert.doesNotMatch(hiddenRefund, /\$[\d,]|1234|7654|fully refunded|net is zero|aria-valuenow|width:/, 'Hidden refund panel masks source dollar text as well as monetary values and zero-net claims');
  const hiddenRefundRows = render(yearReview.YearReviewRows, { rows: [standalone.purchase, ...standalone.credits], data: reviewData, hidden: true, onTransactions() {} });
  assert.doesNotMatch(hiddenRefundRows, /\$[\d,]|1234|7654/);
  const crossYearData = structuredClone(reviewData);
  crossYearData.transactions.find(row => row.id === 'detail-charge').date = '2025-12-20';
  crossYearData.transactions.find(row => row.id === 'detail-credit').date = '2026-01-05';
  const crossYear = summarizeYearReview(crossYearData, plan, 2026, []).inferredRefunds.filter(row => row.creditId === 'detail-credit');
  assert.equal(crossYear[0].code, 'other_year');
  const crossCalls = [], evidence = probe(yearReview.InferredRefundEvidenceList, { entries: crossYear, data: crossYearData, hidden: true, label: 'Synthetic cross-year evidence', onTransactions: (...args) => crossCalls.push(args) });
  for (const button of evidence.elements().filter(e => e.type === 'button')) button.props.onClick();
  assert.deepEqual(crossCalls, [[['detail-charge'], 2025], [['detail-credit'], 2026]], 'Cross-year evidence links retain each source record in its own posting year');
  assert.doesNotMatch(evidence.markup, /\$[\d,]|1234|aria-valuenow|width:/);
  assert.equal(JSON.stringify(fixture), sourceBefore, 'All render probes leave canonical synthetic input unchanged');
  console.log('Financial clarity render: paired surplus scope/missing/sign/privacy, actual category detail cents and exact-scope callbacks, semantic controls and composition drilldown verified. Browser keyboard/geometry remain separate.');
} finally {
  console.warn = warn;
  delete globalThis.__financialClarityPlan;
  await fs.rm(output, { recursive: true, force: true });
}
