// Synthetic: no HTTP, no source records, no storage writes.
// 1) Unit tests for lib/saved-state-coordinator.ts.
// 2) Integrated controller harness that executes Home's ACTUAL load, saveReviewPreference
//    and saveEdit closures (extracted from app/page.tsx) against the real coordinator,
//    with deferred reads and scripted write responses.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import { createSavedStateCoordinator } from '../lib/saved-state-coordinator.ts';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

// ---------- 1. Coordinator unit tests ----------
{
  const c = createSavedStateCoordinator();
  // Newest read wins; older success is superseded.
  const a = c.beginRead(), da = deferred(); const pa = c.readLatest(a, () => da.promise);
  const b = c.beginRead(), db = deferred(); const pb = c.readLatest(b, () => db.promise);
  db.resolve('new'); assert.deepEqual(await pb, { kind: 'commit', value: 'new' });
  da.resolve('old'); assert.equal((await pa).kind, 'superseded', 'older read cannot commit after a newer read started');
  assert.equal(c.isLatestRead(a), false); assert.equal(c.isLatestRead(b), true);
}
{
  const c = createSavedStateCoordinator();
  // Stale failure is swallowed; latest failure is rethrown.
  const a = c.beginRead(), da = deferred(); const pa = c.readLatest(a, () => da.promise);
  const b = c.beginRead(), db = deferred(); const pb = c.readLatest(b, () => db.promise);
  db.resolve('ok'); await pb; da.reject(new Error('stale failure'));
  assert.equal((await pa).kind, 'superseded', 'a stale failure cannot replace a current success');
  const d = c.beginRead();
  await assert.rejects(c.readLatest(d, async () => { throw new Error('current failure'); }), /current failure/);
}
{
  const c = createSavedStateCoordinator(2);
  // A mutation settling during a read forces a bounded re-read; the fetcher (a read) is re-run, never a write.
  let calls = 0; const ticket = c.beginRead();
  const outcome = await c.readLatest(ticket, async () => { calls++; if (calls === 1) c.mutationSettled(); return `v${calls}`; });
  assert.deepEqual(outcome, { kind: 'commit', value: 'v2' }); assert.equal(calls, 2);
  // Continuous mutations: give up without committing after 1 + maxRereads attempts.
  calls = 0; const t2 = c.beginRead();
  const unsettled = await c.readLatest(t2, async () => { calls++; c.mutationSettled(); return calls; });
  assert.equal(unsettled.kind, 'unsettled'); assert.equal(calls, 3);
  assert.equal(c.isCurrentRead(t2),false,'the final attempted snapshot remains stale');
  const finish=c.beginMutation();
  assert.equal(c.isLatestRead(t2),true,'a field mutation does not supersede the latest failed full reload');
  finish();
  assert.equal(c.isLatestRead(t2),true,'a completed field mutation still is not a successful full readback');
}
console.log('Coordinator unit tests passed: newest read wins, stale failures ignored, bounded re-read after settled writes, unsettled never commits.');

// A write can invalidate a rejection just as it invalidates a successful stale
// response. Only a subsequent post-write read may report a current error.
{
  const coordinator = createSavedStateCoordinator();
  const pending = deferred(); let calls = 0;
  const read = coordinator.readLatest(coordinator.beginRead(), () => ++calls === 1 ? pending.promise : Promise.resolve('confirmed current state'));
  coordinator.mutationSettled(); pending.reject(new Error('stale read failed'));
  assert.deepEqual(await read, {kind:'commit',value:'confirmed current state'});
  assert.equal(calls,2,'an invalidated rejection triggers only one bounded reconciliation GET');
}

// ---------- 2. Integrated harness over actual page closures ----------
const source = await fs.readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function extract(name) {
  let found;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) found = `const actual=${node.initializer.getText(ast)};`;
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = `${node.getText(ast)}\nconst actual=${name};`;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  if (!found) throw new Error(`Missing actual ${name} in app/page.tsx`);
  return ts.transpileModule(found, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
}
const bind = (name, scope) => new Function(...Object.keys(scope), `${extract(name)}\nreturn actual;`)(...Object.values(scope));
const enqueueReviewPreferenceSave = bind('enqueueReviewPreferenceSave', {});
const changedTransactionPatch = bind('changedTransactionPatch', {});

// Structural guards: shared code loaders/lazies remain module-level so parent
// renders never reset mounted report state; snapshot derivation stays memoized.
{
  const lazyCalls = [];
  const visit = (node, depth) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'lazy') lazyCalls.push({ depth, text: node.getText(ast) });
    const inFunction = ts.isFunctionLike(node) && !(ts.isArrowFunction(node) && ts.isCallExpression(node.parent) && ts.isIdentifier(node.parent.expression) && node.parent.expression.text === 'lazy');
    ts.forEachChild(node, child => visit(child, depth + (inFunction ? 1 : 0)));
  };
  visit(ast, 0);
  const modulesSource=await fs.readFile(new URL('../app/report-modules.ts',import.meta.url),'utf8');
  const modulesAst=ts.createSourceFile('report-modules.ts',modulesSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  // The visitor uses the node's own source for these declarations.
  const moduleLazies=[];
  function visitModules(node,depth=0){
    if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='lazy')moduleLazies.push({depth,node});
    ts.forEachChild(node,child=>visitModules(child,depth+(ts.isFunctionLike(node)?1:0)));
  }
  visitModules(modulesAst);
  const declarations=modulesAst.statements.filter(ts.isVariableStatement).flatMap(statement=>statement.declarationList.declarations);
  for(const [component,loader,view] of [['MoneyMovements','movements','money-movements'],['Budget','budget','budget'],['Goals','goals','goals'],['YearInReview','yearReview','year-in-review-view'],['SpendingComposition','spending','spending-composition'],['Income','income','income'],['AppleCardSpending','apple','apple-card-spending'],['Retirement','retirement','retirement'],['RecurringReview','recurring','recurring-review']]){
    const declaration=declarations.find(node=>node.name.getText(modulesAst)===component);
    assert.ok(declaration&&ts.isCallExpression(declaration.initializer)&&declaration.initializer.expression.getText(modulesAst)==='lazy',`${component} is a stable module-level lazy report`);
    assert.equal(declaration.initializer.arguments[0].getText(modulesAst),`${loader}.load`,`${component} shares its loader with intent preload`);
    const code=declarations.find(node=>node.name.getText(modulesAst)===loader);
    let importsExpected=false;
    function findImport(node){if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword&&node.arguments[0]?.text===`./${view}`)importsExpected=true;ts.forEachChild(node,findImport);}
    findImport(code);assert.ok(importsExpected,`${component} retains its real report import`);
  }
  assert.ok(moduleLazies.every(call=>call.depth===0),'no report lazy identity is created inside a component or loader');
  assert.ok(lazyCalls.every(call => call.depth === 0), 'no lazy() declared inside a component');
  for (const [section, component] of [['Goals', 'Goals'], ['Year in Review', 'YearInReview'], ['Budget', 'Budget'], ['Income', 'Income'], ['Recurring bills', 'RecurringReview'], ['Money movements', 'MoneyMovements'], ['Retirement', 'Retirement']])
    assert.ok(source.includes(`section==="${section}"&&<ReportView name="${section}"><${component} `), `${section} still routes to ${component} inside a Suspense/error boundary`);
  assert.ok(!/summarizeIncome\(/.test(source), 'unused incomeSummary computation removed');
  assert.match(source, /deriveDataset\(saved\.dataset,saved\.overrides\)\:null,\[saved\.dataset,saved\.overrides\]/, 'full derivation reruns only for dataset/override changes');
}

function harness({ initial }) {
  const state = { saved: structuredClone(initial), busy: false, loading: true, error: '', notices: [], month: '', target: null, edit: null, feedback: '' };
  const reads = []; const writes = [];
  let writeResponder = async () => Response.json({ success: true, reviewPreferences: { findingResolutions: {}, recurringStatuses: {} } });
  const savedState = createSavedStateCoordinator();
  const common = {
    savedState,
    setBusy: v => { state.busy = v; }, setLoading: v => { state.loading = v; }, setError: v => { state.error = v; },
    setMonth: v => { state.month = typeof v === 'function' ? v(state.month) : v; }, setTarget: v => { state.target = v; },
    setSaved: v => { state.saved = typeof v === 'function' ? v(state.saved) : v; },
    tell: m => state.notices.push(m),
    readSavedDashboard: () => { const d = deferred(); reads.push(d); return d.promise; },
    SAVED_DATA_LOAD_ERROR: 'Saved records could not be loaded.',
    fetch: async (url, options) => { writes.push({ url, body: JSON.parse(options.body) }); return writeResponder(url, options); },
  };
  const load = bind('load', { ...common, saved: state.saved });
  const saveReviewPreference = bind('saveReviewPreference', { ...common, reviewSaveQueue: { current: Promise.resolve() }, enqueueReviewPreferenceSave });
  const makeSaveEdit = (edit, draft) => bind('saveEdit', {
    ...common, edit, draft, changedTransactionPatch, savedTransactionNote: t => t.note, proposedReview: null, reviewPreview: null,
    setEditFeedback: v => { state.feedback = v; }, setEdit: v => { state.edit = v; }, setDraft() {}, setReviewChoice() {},
    reviewDecisionLabel: v => String(v),
    deriveDataset: (dataset, overrides) => ({ transactions: dataset.transactions.map(t => ({ ...t, ...overrides[t.id] })) }),
  });
  const makeImport = (dataset, settings=null) => bind('importData', {
    ...common, load, confirmImport:dataset, importSettings:settings,
    importRetirementOverrides:null,importReviewPreferences:null,importTransactionOverrides:null,
    setImportFeedback:value=>{state.importFeedback=value},setConfirmImport:value=>{state.confirmImport=value},
    setImportSettings(){},setImportRetirementOverrides(){},setImportReviewPreferences(){},setImportTransactionOverrides(){},
  });
  return { state, reads, writes, load, saveReviewPreference, makeSaveEdit, makeImport, setWriteResponder: f => { writeResponder = f; }, savedState };
}
const emptyPrefs = () => ({ findingResolutions: {}, recurringStatuses: {} });
const txRow = { id: 'syn-1', date: '2026-10-01', merchant: 'Synthetic', accountId: 'a', amount: 10, category: 'Shopping', flow: 'expense', exceptional: false, note: '', pending: false, review: false };
const snapshot = (extra = {}) => ({ dataset: { asOf: '2026-10-28', transactions: [txRow] }, overrides: {}, settings: {}, retirementOverrides: {}, reviewPreferences: emptyPrefs(), refresh: null, ...extra });
const reviewed = { findingResolutions: { 'synthetic-check': { state: 'reviewed', evidenceKey: 'synthetic-source-v1', updatedAt: '2026-10-30T00:00:00Z' } }, recurringStatuses: {} };

// A. The reproduced race: an older full GET completing after a successful review save cannot undo it.
{
  const h = harness({ initial: snapshot() });
  h.setWriteResponder(async () => Response.json({ success: true, reviewPreferences: reviewed }));
  const pendingLoad = h.load(false);
  await h.saveReviewPreference({ type: 'review-resolution', id: 'synthetic-check', state: 'reviewed', evidenceKey: 'synthetic-source-v1' });
  assert.ok(h.state.saved.reviewPreferences.findingResolutions['synthetic-check'], 'confirmed preference applied');
  h.reads[0].resolve(snapshot()); // stale: server answered before the write
  await tick();
  assert.ok(h.state.saved.reviewPreferences.findingResolutions['synthetic-check'], 'older GET does not overwrite the confirmed preference');
  assert.equal(h.reads.length, 2, 'the overlapped read is re-read once (reads only)');
  h.reads[1].resolve(snapshot({ reviewPreferences: reviewed }));
  await pendingLoad;
  assert.ok(h.state.saved.reviewPreferences.findingResolutions['synthetic-check'], 'fresh read commits the durable preference');
  assert.equal(h.writes.length, 1, 'the write is never retried');
  assert.equal(h.state.busy, false); assert.equal(h.state.loading, false); assert.equal(h.state.error, '');
  // F. A clean subsequent explicit reload accepts current server state.
  const next = h.load(false);
  h.reads[2].resolve(snapshot({ reviewPreferences: emptyPrefs(), settings: { savingsTarget: 40 } }));
  await next;
  assert.deepEqual(h.state.saved.reviewPreferences, emptyPrefs(), 'a later explicit reload is accepted, even if it removes a preference');
  assert.equal(h.state.target, 40); assert.ok(h.state.notices.includes('Saved dashboard data reloaded.'));
}
// B. The most recent explicit read wins regardless of completion order.
{
  const h = harness({ initial: snapshot() });
  const first = h.load(false), second = h.load(false);
  h.reads[1].resolve(snapshot({ settings: { savingsTarget: 2 } }));
  await second;
  assert.equal(h.state.saved.settings.savingsTarget, 2); assert.equal(h.state.busy, false);
  h.reads[0].resolve(snapshot({ settings: { savingsTarget: 1 } }));
  await first;
  assert.equal(h.state.saved.settings.savingsTarget, 2, 'older read completing later is ignored');
  assert.equal(h.state.busy, false); assert.equal(h.state.loading, false);
}
// C. A stale failure cannot replace a current success; flags are owned by the newest read.
{
  const h = harness({ initial: snapshot() });
  const first = h.load(false), second = h.load(false);
  h.reads[1].resolve(snapshot({ settings: { savingsTarget: 9 } })); await second;
  h.reads[0].reject(new Error('network')); await first;
  assert.equal(h.state.error, '', 'stale failure is not shown'); assert.equal(h.state.saved.settings.savingsTarget, 9);
}
{
  const h = harness({ initial: snapshot() });
  const first = h.load(false), second = h.load(false);
  h.reads[0].resolve(snapshot({ settings: { savingsTarget: 1 } })); await first;
  assert.equal(h.state.busy, true, 'an older completion does not clear busy while a newer read is pending');
  assert.equal(h.state.saved.settings.savingsTarget, undefined, 'and does not commit');
  h.reads[1].reject(new Error('network')); await second;
  assert.equal(h.state.error, 'Saved records could not be loaded.', 'the newest failure is reported');
  assert.deepEqual(h.state.saved, snapshot(), 'cached snapshot (all separate record fields) preserved on error');
  assert.equal(h.state.busy, false);
}
// D. Failed and uncertain review writes: cached state kept, error surfaced, no automatic retry; overlapping reads re-read.
for (const failure of ['uncertain503', 'transport']) {
  const h = harness({ initial: snapshot({ reviewPreferences: reviewed }) });
  h.setWriteResponder(async () => { if (failure === 'transport') throw new Error('The review change could not be confirmed.'); return Response.json({ error: 'The review change could not be confirmed. Reload saved data to check it.' }, { status: 503 }); });
  const pendingLoad = h.load(false);
  await assert.rejects(h.saveReviewPreference({ type: 'review-resolution', id: 'synthetic-check', state: 'open', evidenceKey: 'synthetic-source-v1' }), /could not be confirmed/);
  assert.deepEqual(h.state.saved.reviewPreferences, reviewed, `${failure}: cached preferences retained, not claimed reverted`);
  assert.equal(h.writes.length, 1, `${failure}: no automatic write retry`);
  h.reads[0].resolve(snapshot({ reviewPreferences: reviewed }));
  await tick();
  assert.equal(h.reads.length, 2, `${failure}: a read overlapping an uncertain write is re-read`);
  h.reads[1].resolve(snapshot()); // server shows the write did apply
  await pendingLoad;
  assert.deepEqual(h.state.saved.reviewPreferences, emptyPrefs(), `${failure}: the post-write read reveals actual server state`);
  assert.equal(h.writes.length, 1);
}
// E. Saved transaction data: an older full GET cannot undo a confirmed transaction correction, and the readback uses the same policy.
{
  const h = harness({ initial: snapshot() });
  h.state.edit = txRow;
  h.setWriteResponder(async () => Response.json({ success: true, override: { category: 'Travel' } }));
  const staleLoad = h.load(false); // explicit reload in flight before the edit
  const saveEdit = h.makeSaveEdit(txRow, { category: 'Travel', flow: 'expense', exceptional: false, note: '', review: false });
  const saving = saveEdit('changes');
  await tick();
  assert.deepEqual(h.writes[0].body, { type: 'transaction', id: 'syn-1', patch: { category: 'Travel' } });
  assert.equal(h.reads.length, 2, 'readback is a new full read');
  h.reads[1].resolve(snapshot({ overrides: { 'syn-1': { category: 'Travel' } } }));
  await saving;
  assert.deepEqual(h.state.saved.overrides, { 'syn-1': { category: 'Travel' } }, 'readback commits the correction');
  assert.equal(h.state.edit, null); assert.ok(h.state.notices.at(-1).startsWith('Changes saved'));
  h.reads[0].resolve(snapshot()); await staleLoad;
  assert.deepEqual(h.state.saved.overrides, { 'syn-1': { category: 'Travel' } }, 'older full GET cannot undo the transaction correction');
  assert.equal(h.writes.length, 1);
}
{
  // Readback failure: the confirmed write is reported as saved-but-unverified; cached state retained; no retry.
  const h = harness({ initial: snapshot() });
  h.state.error='Saved records could not be loaded.';
  h.setWriteResponder(async () => Response.json({ success: true }));
  const saving = h.makeSaveEdit(txRow, { category: 'Travel', flow: 'expense', exceptional: false, note: '', review: false })('changes');
  await tick(); h.reads[0].reject(new Error('network')); await saving;
  assert.deepEqual(h.state.saved, snapshot()); assert.equal(h.writes.length, 1);
  assert.match(h.state.notices.at(-1), /saved, but the reports could not be refreshed/);
  assert.equal(h.state.error,'Saved records could not be loaded.','failed transaction readback cannot clear an unresolved full-load error');
  assert.equal(h.state.busy, false);
}
{
  // A verified current transaction readback refreshes the whole snapshot and
  // therefore resolves a prior full-load failure, unlike a field-only save.
  const h=harness({initial:snapshot()}),failedLoad=h.load(false);
  h.reads[0].reject(new Error('full reload failed'));await failedLoad;
  assert.equal(h.state.error,'Saved records could not be loaded.');
  h.setWriteResponder(async()=>Response.json({success:true}));
  const saving=h.makeSaveEdit(txRow,{category:'Travel',flow:'expense',exceptional:false,note:'',review:false})('changes');
  await tick();
  assert.equal(h.state.error,'Saved records could not be loaded.','POST success alone does not clear a full-load error');
  h.reads[1].resolve(snapshot({overrides:{'syn-1':{category:'Travel'}}}));await saving;
  assert.deepEqual(h.state.saved.overrides,{'syn-1':{category:'Travel'}});
  assert.equal(h.state.error,'','verified full transaction readback clears the prior load failure');
  assert.equal(h.writes.length,1);assert.equal(h.state.busy,false);
}
{
  // Rejected transaction write: nothing committed, no readback, no retry.
  const h = harness({ initial: snapshot() });
  h.setWriteResponder(async () => Response.json({ error: 'Change could not be saved.' }, { status: 400 }));
  await h.makeSaveEdit(txRow, { category: 'Travel', flow: 'expense', exceptional: false, note: '', review: false })('changes');
  assert.equal(h.reads.length, 0); assert.equal(h.writes.length, 1); assert.deepEqual(h.state.saved, snapshot());
  assert.equal(h.state.notices.at(-1), 'Change could not be saved.');
}
// G. Initial load with no cached dataset: a failure is an error, never an empty-records state.
{
  const h = harness({ initial: { dataset: null, overrides: {}, settings: {}, retirementOverrides: {}, reviewPreferences: emptyPrefs() } });
  const p = h.load(true); h.reads[0].reject(new Error('down')); await p;
  assert.equal(h.state.error, 'Saved records could not be loaded.'); assert.equal(h.state.loading, false); assert.equal(h.state.saved.dataset, null);
}
console.log('Saved-state race harness passed: actual load/saveReviewPreference/saveEdit closures; old GET cannot undo review or transaction saves; newest read wins; stale failures ignored; failed/uncertain writes keep cache and never retry; follow-up reload accepted.');

// H. A read rejection after a successful save is also stale; it cannot replace
// the confirmed state or report a current error without a post-write read.
{
  const h=harness({initial:snapshot()});
  h.setWriteResponder(async()=>Response.json({reviewPreferences:reviewed}));
  const reading=h.load(false);
  await h.saveReviewPreference({type:'review-resolution',id:'synthetic-check',state:'reviewed',evidenceKey:'synthetic-source-v1'});
  h.reads[0].reject(new Error('pre-save response failed'));await tick();
  assert.equal(h.state.error,'');assert.equal(h.state.busy,true);
  assert.deepEqual(h.state.saved.reviewPreferences,reviewed);
  assert.equal(h.reads.length,2);
  h.reads[1].resolve(snapshot({reviewPreferences:reviewed}));await reading;
  assert.equal(h.state.error,'');assert.equal(h.writes.length,1);
}
// I. Full reads cannot expose a pre-write snapshot or release controls while a
// write is pending. A read requested during a write waits without issuing GETs.
for(const readFirst of [true,false]){
  const h=harness({initial:snapshot({settings:{savingsTarget:19}})}),write=deferred();
  h.setWriteResponder(()=>write.promise);
  let reading;if(readFirst)reading=h.load(false);
  const saving=h.saveReviewPreference({type:'review-resolution',id:'synthetic-check',state:'reviewed',evidenceKey:'synthetic-source-v1'});
  await tick();if(!readFirst)reading=h.load(false);
  if(readFirst)h.reads[0].resolve(snapshot({settings:{savingsTarget:7}}));
  await tick();
  assert.equal(h.state.busy,true,'a pending write keeps controls busy');
  assert.equal(h.state.saved.settings.savingsTarget,19,'no pre-write read is committed');
  assert.equal(h.reads.length,readFirst?1:0,'no reconciliation fetch before write settles');
  write.resolve(Response.json({reviewPreferences:reviewed}));await saving;await tick();
  assert.equal(h.state.busy,true,'write completion cannot release a pending read');
  assert.equal(h.reads.length,readFirst?2:1);
  h.reads.at(-1).resolve(snapshot({reviewPreferences:reviewed,settings:{savingsTarget:19}}));await reading;
  assert.equal(h.state.busy,false);assert.equal(h.writes.length,1);
}
// J. Import ends its mutation token before readback: success and partial
// settings failure both complete, with exactly one attempt per requested POST.
for(const settingsFailure of [false,true]){
  const h=harness({initial:snapshot()}),imported={asOf:'2026-10-29',transactions:[{...txRow,id:'imported-row'}]};
  h.setWriteResponder(async url=>url==='/api/preferences'?Response.json({error:'settings failed'},{status:400}):Response.json({success:true}));
  const stale=h.load(false);
  const importing=h.makeImport(imported,settingsFailure?{savingsTarget:35}:null)();
  await tick();
  assert.equal(h.reads.length,2,'import readback starts without waiting on its own write');
  assert.equal(h.state.busy,true,'import remains busy through readback');
  h.reads[1].resolve(snapshot({dataset:imported}));await importing;
  assert.equal(h.state.saved.dataset.asOf,'2026-10-29');
  h.reads[0].resolve(snapshot());await stale;
  assert.equal(h.state.saved.dataset.asOf,'2026-10-29','old GET cannot undo an imported snapshot');
  assert.equal(h.writes.length,settingsFailure?2:1,'no import or settings mutation retries');
  assert.equal(h.state.busy,false);
  if(settingsFailure)assert.match(h.state.notices.at(-1),/Dataset imported, but the savings target could not be restored/);
  else assert.equal(h.state.notices.at(-1),'Dataset and available settings imported.');
}
// K. A child-owned retirement save invalidates earlier full reads before its
// returned correction is merged. Exercise the exact JSX callback from Home.
{
  let retirementCallback;
  const visit=node=>{if(ts.isJsxAttribute(node)&&node.name.text==='onClassificationSaved')retirementCallback=node.initializer.expression;ts.forEachChild(node,visit)};visit(ast);
  assert.ok(retirementCallback);
  const code=ts.transpileModule('const callback='+retirementCallback.getText(ast)+';', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  const h=harness({initial:snapshot()}),reading=h.load(false);
  const makeCallback=new Function('savedState','setSaved','CLIENT_READ_ONLY',code+'return callback;');
  assert.equal(makeCallback(h.savedState,()=>assert.fail('A read-only demo must not apply a retirement save'),true),undefined);
  const callback=makeCallback(h.savedState,value=>{h.state.saved=value(h.state.saved)},false);
  callback('retirement-row',{taxTreatment:'pretax'});
  h.reads[0].resolve(snapshot());await tick();
  assert.deepEqual(h.state.saved.retirementOverrides,{'retirement-row':{taxTreatment:'pretax'}});
  h.reads[1].resolve(snapshot({retirementOverrides:h.state.saved.retirementOverrides}));await reading;
}
console.log('Closure races passed: stale rejection, pending-write/read busy ownership, import and partial-restore readback completion, retirement callback invalidation; no POST retries.');

// A field mutation in the result-to-consumer gap rejects a stale commit but
// does not satisfy a failed full reload. The same feedback policy applies to
// both a returned commit and a thrown rejection, with no extra GET or POST.
for(const terminal of ['commit','rejection'])for(const gap of ['pending mutation','settled mutation','child settlement']){
  const initial=snapshot({settings:{savingsTarget:19}}),h=harness({initial}),reading=h.load(false);let finish;
  if(terminal==='commit')h.reads[0].resolve(snapshot({settings:{savingsTarget:7}}));
  else h.reads[0].reject(new Error('read response failed'));
  queueMicrotask(()=>{
    if(gap==='child settlement')h.savedState.mutationSettled();
    else {finish=h.savedState.beginMutation();if(gap==='settled mutation')finish()}
    if(gap!=='pending mutation')h.state.saved={...h.state.saved,reviewPreferences:reviewed};
  });
  await reading;
  assert.equal(h.state.error,'Saved records could not be loaded.',`${terminal}/${gap}: latest full reload did not refresh the snapshot`);
  assert.deepEqual(h.state.saved,gap==='pending mutation'?initial:{...initial,reviewPreferences:reviewed},`${terminal}/${gap}: cached snapshot and confirmed field update are retained`);
  assert.equal(h.state.busy,gap==='pending mutation');assert.equal(h.state.loading,false);
  assert.deepEqual(h.state.notices,[],`${terminal}/${gap}: no silent success or reload-success notice`);
  assert.equal(h.reads.length,1,`${terminal}/${gap}: no extra GET in the consumer`);assert.equal(h.writes.length,0);
  finish?.();
}
// A NEW full read owns terminal feedback for the previous read in that same
// gap. Its subsequent verified success is accepted without an older error.
for(const terminal of ['commit','rejection']){
  const initial=snapshot({settings:{savingsTarget:19}}),h=harness({initial}),reading=h.load(false);let newer;
  if(terminal==='commit')h.reads[0].resolve(snapshot({settings:{savingsTarget:7}}));
  else h.reads[0].reject(new Error('superseded read failed'));
  queueMicrotask(()=>{newer=h.load(false)});
  await reading;
  assert.equal(h.state.error,'',`${terminal}: newer full read owns feedback`);
  assert.deepEqual(h.state.saved,initial,`${terminal}: old outcome cannot commit`);
  assert.equal(h.state.busy,true);assert.equal(h.reads.length,2);
  h.reads[1].resolve(snapshot({settings:{savingsTarget:29}}));await newer;
  assert.equal(h.state.saved.settings.savingsTarget,29);assert.equal(h.state.error,'');assert.equal(h.state.busy,false);
  assert.equal(h.writes.length,0);
}
{
  const h=harness({initial:snapshot()}),reading=h.load(false);let newer;
  for(let attempt=0;attempt<3;attempt++){
    h.savedState.mutationSettled();h.reads[attempt].resolve(snapshot());
    if(attempt<2)await tick();
    else queueMicrotask(()=>{newer=h.load(false)});
  }
  await reading;
  assert.equal(h.state.error,'','superseded unsettled outcome cannot set an error over the newer read');
  assert.equal(h.state.busy,true);assert.equal(h.reads.length,4);
  h.reads[3].resolve(snapshot({settings:{savingsTarget:29}}));await newer;
  assert.equal(h.state.saved.settings.savingsTarget,29);assert.equal(h.state.error,'');
}

// A field-only mutation in the result-to-consumer gap does not satisfy the
// user's failed full reload. Keep terminal feedback unless a newer read takes
// ownership; never use the stale final snapshot as a valid commit.
for(const gap of ['pending mutation','settled mutation','child settlement']){
  const h=harness({initial:snapshot()}),reading=h.load(false);let finish;
  for(let attempt=0;attempt<3;attempt++){
    h.savedState.mutationSettled();h.reads[attempt].resolve(snapshot());
    if(attempt<2)await tick();
    else queueMicrotask(()=>{
      if(gap==='child settlement')h.savedState.mutationSettled();
      else {finish=h.savedState.beginMutation();if(gap==='settled mutation')finish()}
      if(gap!=='pending mutation')h.state.saved={...h.state.saved,reviewPreferences:reviewed};
    });
  }
  await reading;
  assert.equal(h.state.error,'Saved records could not be loaded.',`${gap}: field-only mutation does not resolve the exhausted full reload`);
  assert.equal(h.state.busy,gap==='pending mutation',`${gap}: pending writes retain busy ownership`);
  assert.deepEqual(h.state.saved,snapshot(gap==='pending mutation'?{}:{reviewPreferences:reviewed}),`${gap}: cached/confirmed fields remain intact`);
  assert.equal(h.reads.length,3,`${gap}: no extra reconciliation beyond the bound`);
  assert.equal(h.writes.length,0,`${gap}: the read outcome never retries a mutation`);
  finish?.();
}
// Reconciliation genuinely exhausted its bound, either after settled overlaps
// or with a final write still pending. These outcomes must remain visible.
for(const finalOverlapPending of [false,true]){
  const h=harness({initial:snapshot()}),reading=h.load(false);let finish;
  for(let attempt=0;attempt<3;attempt++){
    if(attempt===2&&finalOverlapPending)finish=h.savedState.beginMutation();
    else h.savedState.mutationSettled();
    h.reads[attempt].resolve(snapshot());
    if(attempt<2)await tick();
  }
  await reading;
  assert.equal(h.state.error,'Saved records could not be loaded.','genuine exhaustion is reported even though its final snapshot was stale');
  assert.equal(h.state.busy,finalOverlapPending,'an existing final overlap retains busy ownership');
  assert.deepEqual(h.state.saved,snapshot(),'exhaustion never commits an unvalidated snapshot');
  assert.equal(h.reads.length,3);assert.equal(h.writes.length,0);
  finish?.();
}
console.log('All load terminal paths passed: only newer full reads supersede feedback; mutation-gap commits/rejections/exhaustion retain cached state and report refresh failure; verified transaction readback clears prior load errors; no added retries.');
