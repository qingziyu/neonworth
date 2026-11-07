import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const rootPath = fileURLToPath(root);
let tabInjections = 0;
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
        const transformer = context => source => {
          const visit = node => {
            if (path.endsWith('/app/money-movements.tsx') && ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.name.elements[0]?.name?.getText(source) === 'tab' && node.initializer && ts.isCallExpression(node.initializer)) {
              tabInjections++;
              return context.factory.updateVariableDeclaration(node, node.name, node.exclamationToken, node.type, context.factory.updateCallExpression(node.initializer, node.initializer.expression, node.initializer.typeArguments, [context.factory.createPropertyAccessExpression(context.factory.createIdentifier('globalThis'), '__movementTab')]));
            }
            return ts.visitEachChild(node, visit, context);
          };
          return ts.visitNode(source, visit);
        };
        const output = ts.transpileModule(readFileSync(path, 'utf8'), { fileName: path, transformers: { before: [transformer] }, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, verbatimModuleSyntax: false } }).outputText;
        return { format: 'module', source: output, shortCircuit: true };
      }
    }
    return nextLoad(url, context);
  },
});

// Synthetic renders of the actual views; only the movement tab's initial state is injected.
// Source actions are invoked directly. Browser geometry and keyboard behavior are separate gates.
const { createElement, isValidElement, Children } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');
const { default: MoneyMovements } = await import('../app/money-movements.tsx');
const { default: Income } = await import('../app/income.tsx');
const { summarizeIncome } = await import('../lib/income.ts');
const { summarizeMovements } = await import('../lib/movements.ts');
assert.equal(tabInjections, 1, 'Only the selected movement tab is supplied by the harness');
const account = (id, type = 'depository', subtype = 'checking') => ({ id, name: `Synthetic ${id}`, institution: 'Example', type, subtype, mask: '0000', balance: 0, netBalance: 0, balanceDate: null, balanceAgeKnown: false, syncStatus: 'synced' });
const tx = (id, amount, extra = {}) => ({ id, date: '2026-10-15', merchant: id, accountId: 'checking', amount, category: 'Other', flow: 'transfer', confidence: 'HIGH', exceptional: false, note: '', pending: false, review: false, ...extra });
const staleNote = 'Unidentified credit; not assumed to be income or a purchase refund.';
const data = {
  version: 1, syncedAt: '2026-10-25T00:00:00Z', asOf: '2026-10-25', dateRange: { start: '2026-01-01', end: '2026-10-25' },
  coverage: {}, accounts: [account('checking'), account('savings', 'depository', 'savings'), account('card', 'credit', 'credit card')], netWorthHistory: [], notes: [], recurring: [],
  transactions: [
    tx('repayment', 1000, { merchant: 'Card payment $ 1000 · USD 981.23 · 350.00credit', category: 'Card payment', sourceCategoryDetailed: 'transfers_credit_card_payment', transferTransactionId: 'card-credit' }),
    tx('card-credit', -1000, { merchant: 'Payment received', accountId: 'card', category: 'Card payment', transferTransactionId: 'repayment' }),
    tx('unresolved', 200, { merchant: 'Unexplained 350.00 credit', flow: 'review', review: true, note: 'Check this disputed payment.' }),
    tx('payroll', -5000, { merchant: 'Example Employer payroll', flow: 'income', category: 'Payroll', sourceCategoryDetailed: 'income_salary' }),
    tx('settled-interest', -7, { merchant: 'Interest credit', sourceCategoryDetailed: 'income_interest_earned', incomePolicyExcluded: true, note: `Statement reference $777.77. ${staleNote}` }),
    tx('flagged-credit', -250, { merchant: 'Amazon USD 981.23 · $ 1000 · 350.00 credit', accountId: 'savings', flow: 'review', review: true, note: 'Keep this disputed-credit evidence.' }),
  ],
};
const elements = node => isValidElement(node) ? [node, ...Children.toArray(node.props.children).flatMap(elements)] : [];
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : isValidElement(node) ? Children.toArray(node.props.children).map(text).join('') : '';
function probe(Component, props) {
  let tree;
  function Probe() { tree = Component(props); return tree; }
  const markup = renderToStaticMarkup(createElement(Probe));
  return { markup, elements: elements(tree) };
}
const inputBefore = JSON.stringify(data);
for (const periodMode of ['month', 'ytd', 'year']) {
  const incomeBefore = JSON.stringify(summarizeIncome(data, 2026, '2026-10', periodMode));
  const movementBefore = JSON.stringify(summarizeMovements(data, '2026-10', periodMode));
  const calls = [], props = { data, month: '2026-10', periodMode, hidden: true, onEdit: t => calls.push(t) };
  globalThis.__movementTab = 'excluded';
  const settled = probe(MoneyMovements, props);
  const sourceButtons = settled.elements.filter(e => e.type === 'button' && e.props['aria-label']?.endsWith('source transaction'));
  assert.ok(sourceButtons.length >= 2);
  assert.ok(sourceButtons.every(e => text(e) === 'View transaction'), 'Classified movements have inspection actions');
  assert.doesNotMatch(settled.markup, /Review transaction|Review row|\$\s*[\d,]|777\.77|981\.23|350\.00/);
  sourceButtons.find(e => e.props['aria-label'].includes('Card payment')).props.onClick();
  assert.equal(calls.at(-1), data.transactions.find(t => t.id === 'repayment'), 'Source action opens the original canonical row');
  globalThis.__movementTab = 'review';
  const unresolved = probe(MoneyMovements, props);
  const reviewButton = unresolved.elements.find(e => e.type === 'button' && e.props['aria-label'] === 'Review Unexplained •••• credit source transaction');
  assert.ok(reviewButton); assert.equal(text(reviewButton), 'Review transaction');
  assert.doesNotMatch(unresolved.markup, /350\.00/, 'Unresolved amount prose is masked in source rows and accessible labels');
  reviewButton.props.onClick(); assert.equal(calls.at(-1), data.transactions.find(t => t.id === 'unresolved'));
  const income = probe(Income, props);
  const incomeButtons = income.elements.filter(e => e.type === 'button' && /^(View|Review) transaction$/.test(text(e)));
  assert.equal(incomeButtons.filter(e => text(e) === 'View transaction').length, 2, 'Payroll and settled credit remain view-only');
  assert.equal(incomeButtons.filter(e => text(e) === 'Review transaction').length, 1, 'Actual unresolved credit retains its review action');
  incomeButtons.find(e => text(e) === 'Review transaction').props.onClick();
  assert.equal(calls.at(-1), data.transactions.find(t => t.id === 'flagged-credit'));
  assert.doesNotMatch(income.markup, /Unidentified credit; not assumed|\$\s*[\d,]|777\.77|981\.23|350\.00/);
  assert.match(income.markup, /Statement reference ••••/, 'Custom source context survives display cleanup');
  assert.match(income.markup, /Keep this disputed-credit evidence/, 'True review evidence remains visible');
  assert.equal(JSON.stringify(summarizeIncome(data, 2026, '2026-10', periodMode)), incomeBefore, 'Income results remain unchanged after opening details');
  assert.equal(JSON.stringify(summarizeMovements(data, '2026-10', periodMode)), movementBefore, 'Movement results remain unchanged after opening details');
}
assert.equal(JSON.stringify(data), inputBefore, 'No source transaction or note is rewritten by display cleanup');
delete globalThis.__movementTab;
console.log('Sitewide source action renders passed: settled versus flagged actions, exact canonical callbacks, current note display, amount masking and unchanged source/financial summaries across all periods.');
