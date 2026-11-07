// Execute Home's actual import callback with a synthetic fixture and deferred fetch.
// Covers uncertain writes and retained confirmation state; not browser/file-picker E2E.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { financialReviewFixture } from './test-support/financial-review-fixture.mjs';
import { createSavedStateCoordinator } from '../lib/saved-state-coordinator.ts';

const source = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = [];
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'importData') callbacks.push(node.initializer);
  ts.forEachChild(node, visit);
}
visit(tree);
assert.equal(callbacks.length, 1, 'Home has exactly one importData callback');
assert.ok(callbacks[0], 'The actual import callback has an implementation');
const code = ts.transpileModule('const callback = ' + callbacks[0].getText(tree) + ';', {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

for (const failure of ['uncertain503', 'transportFailure']) {
  const { dataset } = financialReviewFixture();
  const state = { busy: false, feedback: 'old feedback', confirmation: dataset, calls: 0, loads: 0, metadataClears: 0, messages: [] };
  let release;
  const deferred = new Promise((resolve, reject) => { release = failure === 'uncertain503' ? resolve : reject; });
  const message = 'This import could not be confirmed. Reload saved data before manually trying again.';
  const bindings = {
    savedState: createSavedStateCoordinator(),
    confirmImport: dataset, importRetirementOverrides: null, importReviewPreferences: null, importTransactionOverrides: null, importSettings: null,
    setBusy: value => { state.busy = value; }, setImportFeedback: value => { state.feedback = value; },
    setConfirmImport: value => { state.confirmation = value; },
    setImportSettings: () => { state.metadataClears++; }, setImportRetirementOverrides: () => { state.metadataClears++; },
    setImportReviewPreferences: () => { state.metadataClears++; }, setImportTransactionOverrides: () => { state.metadataClears++; },
    load: async () => { state.loads++; }, tell: value => state.messages.push(value),
    fetch: (url, options) => {
      state.calls++;
      assert.equal(url, '/api/import'); assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), { dataset });
      return deferred;
    },
  };
  const callback = new Function(...Object.keys(bindings), code + '\nreturn callback;')(...Object.values(bindings));
  const result = callback();
  assert.equal(state.busy, true, `${failure}: pending import marks the dialog busy`);
  assert.equal(state.feedback, '', `${failure}: pending import clears stale feedback`);
  assert.equal(state.confirmation, dataset, `${failure}: pending confirmation retains the dataset`);
  assert.equal(state.calls, 1, `${failure}: exactly one import starts`);
  release(failure === 'uncertain503' ? Response.json({ error: message }, { status: 503 }) : new Error(message));
  await result;
  assert.equal(state.busy, false, `${failure}: failure releases the busy controls`);
  assert.equal(state.feedback, message, `${failure}: failure appears inside the dialog`);
  assert.equal(state.confirmation, dataset, `${failure}: failure retains the open confirmation and its dataset`);
  assert.equal(state.calls, 1, `${failure}: uncertain mutation is never automatically repeated`);
  assert.equal(state.loads, 0, `${failure}: failure does not enter the success reload path`);
  assert.equal(state.metadataClears, 0, `${failure}: pending import metadata is retained`);
  assert.deepEqual(state.messages, [message], `${failure}: failure is reported without a success toast`);
}
console.log('Import lifecycle passed: pending state, retained confirmation and feedback, busy cleanup, and no retry for uncertain503/transport failure.');
