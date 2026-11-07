import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Dialog } from 'radix-ui';
import { Area, AreaChart, Bar, BarChart, YAxis } from 'recharts';

// ResponsiveContainer cannot measure a browser viewport during server render.
const warn = console.warn;
console.warn = (...args) => { if (!String(args[0]).startsWith('The width(')) warn(...args); };

// Render real report components for each shared period. This catches runtime
// integration failures that the accounting tests and type checker cannot catch.
const root = path.resolve(import.meta.dirname, '..');
const output = await fs.mkdtemp(path.join(root, '.sites-runtime', 'render-review-'));
const emitted = new Set();
async function compile(relative) {
  const sourceFile = path.join(root, relative);
  const outputFile = path.join(output, relative.replace(/\.tsx?$/, '.mjs'));
  if (emitted.has(relative)) return outputFile;
  emitted.add(relative);
  let code = ts.transpileModule(await fs.readFile(sourceFile, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
    fileName: relative,
  }).outputText;
  const dependencies = [];
  const rewriteSpecifier = specifier => {
    const target = specifier.startsWith('@/') ? specifier.slice(2) : path.join(path.dirname(relative), specifier);
    const base = target.replace(/\.tsx?$/, '');
    dependencies.push(base);
    let rewritten = path.relative(path.dirname(relative), base + '.mjs').replaceAll(path.sep, '/');
    if (!rewritten.startsWith('.')) rewritten = './' + rewritten;
    return rewritten;
  };
  code = code.replace(/from\s+(['"])(@\/[^'"]+|\.{1,2}\/[^'"]+)\1/g, (match, quote, specifier) => `from ${quote}${rewriteSpecifier(specifier)}${quote}`);
  code = code.replace(/import\(\s*(['"])(@\/[^'"]+|\.{1,2}\/[^'"]+)\1\s*\)/g, (match, quote, specifier) => `import(${quote}${rewriteSpecifier(specifier)}${quote})`);
  // Exercise the internal identities actually used by the ledger and editor
  // without adding unsupported named exports to a Next.js page module.
  if(relative === 'app/page.tsx') code += '\nexport { TransactionIdentity, TransactionNoteField, changedTransactionPatch, ImportConfirmation, transactionExportRows, enqueueReviewPreferenceSave, backupPayload, SurplusBridge, readSavedDashboard, DashboardDataState, ReportViewBoundary };\n';
  if(relative === 'app/recurring-review.tsx') code += '\nexport { CardFeeReview, BillRow };\n';
  if(relative === 'app/intelligent-review.tsx') code += '\nexport { Finding, AccountingReview };\n';
  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  await fs.writeFile(outputFile, code);
  for (const base of dependencies) {
    const relativeFile = await fs.access(path.join(root, base + '.ts')).then(() => base + '.ts', () => base + '.tsx');
    await compile(relativeFile);
  }
  return outputFile;
}

try {
  let state;
  {
    const account = (id, subtype = 'checking') => ({id, name:id, institution:'Test', type:subtype==='checking'?'depository':'investment', subtype, mask:'', balance:1000, netBalance:1000, balanceDate:null, balanceAgeKnown:false, syncStatus:'synced'});
    state = {dataset:{version:1, asOf:'2026-10-25', syncedAt:'2026-10-25T20:00:00Z', dateRange:{start:'2025-10-01',end:'2026-10-25'}, accounts:[account('checking'),account('401k','401k')], transactions:[], recurring:[], netWorthHistory:[], notes:[],coverage:{}},overrides:{},retirementOverrides:{}};
  }
  const finance = await import(pathToFileURL(await compile('lib/finance.ts')));
  const classification = await import(pathToFileURL(await compile('lib/classification.ts')));
  const data = classification.deriveDataset(state.dataset || state, state.overrides || {}, state.reviewPreferences || {findingResolutions:{},recurringStatuses:{}});
  const income = await import(pathToFileURL(await compile('lib/income.ts')));
  // Regression: Amazon checking reimbursements count even when the original
  // category is shopping and a separate RSU refund journal has the same value.
  // Savings, Zelle and bank interest do not enter that cash-income definition.
  const account = (id, subtype='checking') => ({id,name:id,institution:'Synthetic',type:subtype==='brokerage'?'investment':'depository',subtype,mask:'',balance:0,netBalance:0,balanceDate:null,balanceAgeKnown:false,syncStatus:'synced'});
  const row = (id, accountId, merchant, amount, flow, detailed) => ({id,date:'2026-10-01',merchant,sourceName:merchant,accountId,amount,category:flow==='expense'?'Shopping':'Income',flow,confidence:'HIGH',exceptional:false,note:id==='amazon-checking'?'Expense reimbursement':'',pending:false,review:false,sourceCategoryDetailed:detailed});
  const fixture = {...data,accounts:[account('checking'),account('savings','savings'),account('broker','brokerage')],transactions:[row('amazon-checking','checking','Amazon reimbursement',-365,'expense','shopping_online_marketplaces'),row('amazon-savings','savings','Amazon credit',-100,'income','income_other_income'),row('zelle','checking','Zelle from someone',-99,'income','income_salary'),row('interest','checking','Interest Payment',-20,'income','income_interest_earned')],incomeEvidence:{version:1,asOf:data.asOf,readAt:data.syncedAt,bankCoverage:{},investmentCoverage:{isComplete:false,freshness:'unknown',note:'Synthetic regression scope'},bankInflowCount:4,bankInflowTotal:369,pendingInflowCount:0,investmentRecords:[{id:'journal',date:'2026-10-01',accountId:'broker',description:'AMZN RSU tax refund',type:'cash',subtype:'withdrawal',amount:365,quantity:0,price:0,fees:0,ticker:'AMZN',currency:'USD'}],accountHistory:[],notes:[],sources:[]}};
  const policyFixture = classification.deriveDataset(fixture);
  const policySummary = income.summarizeIncome(policyFixture,2026,'2026-10','ytd');
  assert.equal(policySummary.employerCashIncome,219,'Classified bank income includes savings receipts, payment-rail receipts and interest');
  assert.equal(policyFixture.transactions.find(t=>t.id==='amazon-checking').flow,'expense');
  for(const id of ['amazon-savings','zelle','interest'])assert.equal(policyFixture.transactions.find(t=>t.id===id).flow,'income',`${id} retains explicit source income`);
  const reports = [
    ['app/income.tsx', /Cash income/],
    ['app/retirement.tsx', /Retirement accounts, together/],
    ['app/money-movements.tsx', /movement/i],
    ['app/recurring-review.tsx', /housing|recurring|bills/i],
    ['app/intelligent-review.tsx', /Required decisions and optional insights/i],
  ];
  let count = 0;
  for (const [file, expected] of reports) {
    const Component = (await import(pathToFileURL(await compile(file)))).default;
    for (const periodMode of ['month','ytd','year']) {
      const markup = renderToStaticMarkup(React.createElement(Component, {data,month:data.asOf.slice(0,7),periodMode,hidden:false,onEdit:()=>{},overrides:state.retirementOverrides||{},onOpenTransactions:()=>{},onOpenRecurring:()=>{},onOpenIncome:()=>{},onResolveFinding:async()=>{}}));
      assert.match(markup, expected, `${file} ${periodMode} is usable`);
      if (file.includes('income')) assert.doesNotMatch(markup,/excluded pending reconciliation with RSU refund journals/i,'checking income has no obsolete journal-exclusion notice');
      if (file.includes('retirement')) assert.doesNotMatch(markup, /Know the tax bucket|Tax treatment unclassified|Classify contribution|Contribution tax split/);
      count++;
    }
    const hiddenMarkup = renderToStaticMarkup(React.createElement(Component, {data,month:data.asOf.slice(0,7),periodMode:'ytd',hidden:true,onEdit:()=>{},overrides:state.retirementOverrides||{},onOpenTransactions:()=>{},onOpenRecurring:()=>{},onOpenIncome:()=>{},onResolveFinding:async()=>{}}));
    const leakedAmount = hiddenMarkup.match(/.{0,100}\$[\d,]+(?:\.\d{2})?.{0,100}/)?.[0] || null;
    assert.equal(leakedAmount, null, `${file} keeps amounts hidden`);
    count++;
  }
  const {TransactionIdentity,TransactionNoteField,changedTransactionPatch,ImportConfirmation,transactionExportRows,enqueueReviewPreferenceSave,backupPayload,SurplusBridge,readSavedDashboard,DashboardDataState,ReportViewBoundary} = await import(pathToFileURL(await compile('app/page.tsx')));
  const {IncomeSpendingChart,SpendingTrendChart,NetWorthChart}=await import(pathToFileURL(await compile('app/dashboard-charts.tsx')));
  const {SpendingLegendSwatch}=await import(pathToFileURL(await compile('app/chart-primitives.tsx')));
  // The actual lazy-view fallback is separate from saved-data/onboarding state.
  const failedView=new ReportViewBoundary({name:'Goals',children:null});
  failedView.state=ReportViewBoundary.getDerivedStateFromError();
  const failedViewMarkup=renderToStaticMarkup(failedView.render());
  assert.match(failedViewMarkup,/role="alert"/);assert.match(failedViewMarkup,/Goals view could not be loaded/);
  assert.match(failedViewMarkup,/Reload page/);assert.doesNotMatch(failedViewMarkup,/first import|Import dataset|records are empty/);
  // Recharts defers bar geometry to mounting. Capture the real chart element
  // tree, render its native definitions, and verify the actual series props;
  // this deliberately does not claim browser geometry or raster contrast.
  const trendFixture=[{month:'2026-10',label:'Oct 26',income:2200,spending:1250.75,saved:949.25,partial:false,cashIncome:2000,rsuValue:200,appleCardSpending:0,appleCardPaymentCount:0}];
  const chartElements=[];
  const elements=node=>React.isValidElement(node)?[node,...React.Children.toArray(node.props.children).flatMap(elements)]:[];
  function ChartProbe({cash=false}){
    const tree=IncomeSpendingChart({trend:trendFixture,hidden:false,cash});
    const children=elements(tree),chart=children.find(element=>element.type===BarChart);
    chartElements.push({cash,chart,bars:children.filter(element=>element.type===Bar)});
    return React.createElement('svg',null,children.find(element=>element.type==='defs'));
  }
  const patterned=renderToStaticMarkup(React.createElement(React.Fragment,null,React.createElement(ChartProbe),React.createElement(SpendingLegendSwatch),React.createElement(ChartProbe,{cash:true}),React.createElement(SpendingLegendSwatch)));
  const patternIds=[...patterned.matchAll(/<pattern[^>]* id="([^"]+)"/g)].map(match=>match[1]);
  assert.equal(patternIds.length,4,'each chart and legend has its own native SVG hatch');
  assert.equal(new Set(patternIds).size,4,'multiple charts and swatches never share pattern IDs');
  for(const {cash,chart,bars} of chartElements){
    assert.equal(chart.props.data,trendFixture,'the exact recorded series reaches Recharts unchanged');
    assert.equal(chart.props.barGap,4);
    assert.equal(bars.length,2,'both financial series remain visible');
    assert.equal(bars[0].props.dataKey,cash?'cashIncome':'income');
    assert.equal(bars[0].props.fill,'var(--chart-cash)','income remains solid green');
    assert.equal(bars[1].props.dataKey,'spending');
    assert.equal(bars[1].props.name,'Net spending');
    const id=bars[1].props.fill.match(/^url\(#(.+)\)$/)?.[1];
    assert.ok(patternIds.includes(id),'the actual spending series references its rendered SVG definition');
    for(const bar of bars){assert.equal(bar.props.isAnimationActive,false);assert.equal(bar.props.maxBarSize,27);assert.deepEqual(bar.props.radius,[4,4,0,0]);}
  }
  for(const id of patternIds.filter(id=>id.startsWith('spending-legend-')))assert.ok(patterned.includes(`fill="url(#${id})"`),'each legend shape references its own pattern');
  assert.equal((patterned.match(/patternUnits="userSpaceOnUse"/g)||[]).length,4,'chart and legend reuse the same texture scale');
  assert.equal((patterned.match(/stroke="var\(--surface\)" stroke-width="1.5"/g)||[]).length,4,'light diagonal hatching distinguishes the warm spending fill');
  for(const cash of [false,true]){
    const privateChart=renderToStaticMarkup(React.createElement(IncomeSpendingChart,{trend:trendFixture,cash,hidden:true}));
    assert.match(privateChart,/Show amounts to view this chart/);
    assert.doesNotMatch(privateChart,/<svg|<pattern|1250\.75|2200|2000/,'amount privacy removes every chart shape and numeric series');
  }
  const spendingSeries=[{label:'Oct 26',value:-1250.75}];
  const spendingElements=elements(SpendingTrendChart({trend:spendingSeries,category:'Travel',hidden:false}));
  assert.equal(spendingElements.find(node=>node.type===BarChart).props.data,spendingSeries,'Spending passes the exact signed series to Recharts');
  const spendingBar=spendingElements.find(node=>node.type===Bar).props;
  assert.equal(spendingBar.dataKey,'value');assert.equal(spendingBar.name,'Travel');assert.equal(spendingBar.isAnimationActive,false);
  assert.equal(spendingBar.maxBarSize,29);assert.deepEqual(spendingBar.radius,[4,4,0,0]);
  const netPoints=[{date:'2026-10-01',value:78123.45},{date:'2026-10-20',value:78987.65}];
  const netElements=elements(NetWorthChart({points:netPoints,hidden:false}));
  assert.equal(netElements.find(node=>node.type===AreaChart).props.data,netPoints,'Net worth retains exact dated observations');
  const netArea=netElements.find(node=>node.type===Area).props;
  assert.equal(netArea.type,'linear');assert.equal(netArea.dataKey,'value');assert.equal(netArea.isAnimationActive,false);
  assert.equal(netArea.strokeWidth,2.2);assert.deepEqual(netElements.find(node=>node.type===YAxis).props.domain,[0,'auto']);
  for(const [Component,props] of [[SpendingTrendChart,{trend:spendingSeries,category:'Travel'}],[NetWorthChart,{points:netPoints}]]){
    const markup=renderToStaticMarkup(React.createElement(Component,{...props,hidden:true}));
    assert.match(markup,/Show amounts to view this chart/);assert.doesNotMatch(markup,/<svg|1250|78123|78987/);
  }
  // Import the real report code without mounting it: speculative code loading
  // must not fetch saved data/planning or trigger a mutation.
  const reportModules=await import(pathToFileURL(await compile('app/report-modules.ts')));
  const priorFetch=globalThis.fetch;let preloadRequests=0;
  globalThis.fetch=async()=>{preloadRequests++;throw new Error('Unexpected request during code preload');};
  try{
    for(const destination of ['Overview','Spending','Budget','Goals','Year in Review','Cash flow','Income','Money movements','Retirement','Recurring bills','Net worth'])
      assert.equal(await reportModules.preloadReport(destination),true,`${destination} code imports successfully`);
    assert.equal(preloadRequests,0,'Code preloading does not run financial/planning reads or writes');
  }finally{globalThis.fetch=priorFetch;}
  // Editor heading mode uses Radix Dialog Title/Description, which need a real Dialog.Root/Content context.
  // The same compiled adapter module (and radix-ui instance) the page imports provides it.
  const {FinanceDialogSurface} = await import(pathToFileURL(await compile('components/finance-dialog.tsx')));
  const inDialog = child => React.createElement(Dialog.Root, {open:true, onOpenChange(){}}, React.createElement(FinanceDialogSurface, {busy:false}, child));
  // A failed read is not evidence of an empty dataset. Error bodies and network
  // internals never become UI copy, and retry keeps the import invitation hidden.
  const originalFetch=globalThis.fetch;
  const dataState=props=>renderToStaticMarkup(React.createElement(DashboardDataState,{loading:false,error:'',hasDataset:false,busy:false,onRetry:()=>{},onImport:()=>{},...props}));
  try{
    let errorBodyRead=false;
    globalThis.fetch=async()=>({ok:false,json:async()=>{errorBodyRead=true;return {error:'D1_ERROR: INTERNAL_SECRET synthetic database failure'}}});
    await assert.rejects(readSavedDashboard(),{message:'Saved records could not be loaded.'});
    assert.equal(errorBodyRead,false,'failed response internals do not need to be read for display');
    const failed=dataState({error:'D1_ERROR: INTERNAL_SECRET synthetic database failure'});
    assert.match(failed,/Saved records could not be loaded/);assert.match(failed,/Try again/);
    assert.doesNotMatch(failed,/first import|Import dataset|D1_ERROR|INTERNAL_SECRET/,'failed initial read offers retry without an empty-data claim or raw error');
    const retry=dataState({loading:true,busy:true});
    assert.match(retry,/Loading your finances/);assert.doesNotMatch(retry,/first import|Import dataset/,'retry does not flash the first-import state');
    globalThis.fetch=async()=>{throw new Error('Synthetic internal connection details')};
    await assert.rejects(readSavedDashboard(),{message:'Saved records could not be loaded.'});
    globalThis.fetch=async()=>({ok:true,json:async()=>({})});
    await assert.rejects(readSavedDashboard(),{message:'Saved records could not be loaded.'},'a malformed successful response is not confirmed empty data');
    const legacyDataset={version:1,asOf:'2026-10-25',syncedAt:'2026-10-25T20:00:00Z',dateRange:{start:'2026-10-01',end:'2026-10-25'},coverage:{transactions:{freshness:null},legacySource:'retained'},accounts:[{...account('checking'),officialName:null,legacyAccountField:'retained'}],transactions:[{...row('legacy-purchase','checking','Synthetic purchase',17,'expense',null),legacyTransactionField:'retained'}],recurring:[{stream_id:null,description:null,merchant_name:null,predicted_next_date:null,legacyStreamField:'retained'}],netWorthHistory:[{date:'2026-10-25',value:1000,events:[{account_name:null,impact:null}]}],notes:[],legacySourceField:{retained:true}};
    globalThis.fetch=async()=>({ok:true,json:async()=>({dataset:legacyDataset})});
    const validLegacy=await readSavedDashboard();
    assert.equal(validLegacy.dataset,legacyDataset,'valid legacy source remains the exact untransformed snapshot');
    assert.deepEqual(JSON.parse(JSON.stringify(validLegacy.dataset)),legacyDataset,'nullable provider fields and unknown source fields are retained');
    assert.ok(finance.months(classification.deriveDataset(validLegacy.dataset)).length,'accepted legacy dates remain usable by the report renderer');
    for(const [label,mutate] of [
      ['sparse dataset',()=>({version:1,accounts:[],transactions:[],netWorthHistory:[]})],
      ['missing asOf',d=>{delete d.asOf;return d}],
      ['missing dateRange',d=>{delete d.dateRange;return d}],
      ['invalid asOf',d=>({...d,asOf:'2026-02-30'})],
      ['invalid range date',d=>({...d,dateRange:{start:'2026-13-01',end:'2026-10-25'}})],
      ['reversed range',d=>({...d,dateRange:{start:'2026-10-25',end:'2026-10-01'}})],
      ['range beyond asOf',d=>({...d,dateRange:{start:'2026-10-01',end:'2026-10-26'}})],
      ['invalid retrieval date',d=>({...d,syncedAt:'not-a-date'})],
      ['invalid transaction date',d=>{d.transactions[0].date='2026-02-30';return d}],
      ['missing renderer string',d=>{delete d.transactions[0].merchant;return d}],
      ['invalid net-worth date',d=>{d.netWorthHistory[0].date='2026-11-31';return d}],
    ]){
      const invalid=mutate(structuredClone(legacyDataset));
      globalThis.fetch=async()=>({ok:true,json:async()=>({dataset:invalid})});
      let displayedSnapshot=validLegacy.dataset;
      await assert.rejects(async()=>{displayedSnapshot=(await readSavedDashboard()).dataset},{message:'Saved records could not be loaded.'},`${label} is rejected before it can replace the displayed snapshot`);
      assert.equal(displayedSnapshot,validLegacy.dataset,`${label} leaves the cached valid snapshot intact`);
    }
    globalThis.fetch=async()=>({ok:true,json:async()=>({dataset:null})});
    const empty=await readSavedDashboard();assert.equal(empty.dataset,null);
    const welcome=dataState({hasDataset:!!empty.dataset});assert.match(welcome,/first import/);assert.match(welcome,/Import dataset/,'a confirmed empty response retains onboarding');
    const cached=dataState({hasDataset:true,error:'D1_ERROR: INTERNAL_SECRET'});
    assert.match(cached,/previously loaded snapshot is still shown/);assert.doesNotMatch(cached,/first import|Import dataset|D1_ERROR|INTERNAL_SECRET/,'a reload error keeps existing reports eligible and masks internals');
    assert.equal(dataState({hasDataset:true,loading:true}),'','background reload does not replace a previously loaded report with a loading/empty panel');
  }finally{globalThis.fetch=originalFetch}
  // A portable backup must retain raw bank data and explicit corrections as
  // separate objects. A derived category alone cannot survive a future refresh.
  const rawSource=state.dataset||state;
  const savedFixture={dataset:rawSource,overrides:{...(state.overrides||{}),'test-explicit':{category:'Confirmed purpose',note:'Retain this correction'}},settings:{savingsTarget:31},retirementOverrides:state.retirementOverrides||{},reviewPreferences:state.reviewPreferences||{findingResolutions:{},recurringStatuses:{}}};
  const backup=backupPayload(savedFixture),encodedBackup=JSON.parse(JSON.stringify(backup));
  assert.equal(backup.dataset,rawSource,'backup uses the exact raw snapshot rather than the derived dashboard');
  assert.deepEqual(encodedBackup.dataset,rawSource,'raw source fields survive backup serialization');
  assert.deepEqual(encodedBackup.transactionOverrides,savedFixture.overrides,'explicit transaction corrections have a portable top-level field');
  assert.deepEqual(encodedBackup.reviewPreferences,savedFixture.reviewPreferences,'review decisions remain separate from source');
  assert.equal(backupPayload({...savedFixture,dataset:null}),null,'an empty dashboard cannot produce a source-less backup');
  // Regression for two different rows saving at once: the database can commit
  // the first write while its full-map response is delayed. A later response
  // must never be replaced by that older snapshot in the visible client state.
  const saveQueue={current:Promise.resolve()};
  let serverPreferences={findingResolutions:{},recurringStatuses:{}};
  let clientPreferences=structuredClone(serverPreferences);
  let releaseFirstResponse;
  const firstResponse=new Promise(resolve=>{releaseFirstResponse=resolve});
  const started=[];
  let firstResolved=false,secondResolved=false;
  const firstSave=enqueueReviewPreferenceSave(saveQueue,async()=>{
    started.push('review');
    serverPreferences.findingResolutions.rent={state:'reviewed',evidenceKey:'source-v1'};
    const responseSnapshot=structuredClone(serverPreferences);
    await firstResponse;
    clientPreferences=responseSnapshot;
  }).then(()=>{firstResolved=true});
  const secondSave=enqueueReviewPreferenceSave(saveQueue,async()=>{
    started.push('service');
    serverPreferences.recurringStatuses.internet={status:'stopped',effectiveDate:'2026-10-25'};
    clientPreferences=structuredClone(serverPreferences);
  }).then(()=>{secondResolved=true});
  await Promise.resolve();
  assert.deepEqual(started,['review'],'a second row waits for the preceding response and client commit');
  assert.equal(firstResolved,false,'the first caller awaits its actual response');
  assert.equal(secondResolved,false,'the queued caller does not resolve before its save');
  releaseFirstResponse();
  await Promise.all([firstSave,secondSave]);
  assert.deepEqual(started,['review','service']);
  assert.ok(clientPreferences.findingResolutions.rent,'later client state retains the first reviewed finding');
  assert.ok(clientPreferences.recurringStatuses.internet,'a delayed older response cannot erase the second service decision');
  // A rejected row still receives its own error, and cannot poison later saves.
  const rowError=new Error('This review decision could not be saved');
  let releaseFailure;
  const failureResponse=new Promise(resolve=>{releaseFailure=resolve});
  const failedSave=enqueueReviewPreferenceSave(saveQueue,async()=>{await failureResponse;throw rowError});
  const receivedError=failedSave.then(()=>null,error=>error);
  let recoveryStarted=false;
  const recoverySave=enqueueReviewPreferenceSave(saveQueue,async()=>{recoveryStarted=true;serverPreferences.findingResolutions.grocery={state:'reviewed',evidenceKey:'source-v2'};clientPreferences=structuredClone(serverPreferences)});
  await Promise.resolve();
  assert.equal(recoveryStarted,false,'a queued save waits for the failed operation to settle');
  releaseFailure();
  assert.equal(await receivedError,rowError,'the rejected operation propagates to the row that initiated it');
  await recoverySave;
  assert.ok(clientPreferences.findingResolutions.grocery,'the queue continues after a failure');
  assert.ok(clientPreferences.recurringStatuses.internet,'recovery retains previously saved service state');
  // Real card-fee labels must contain the linked product identity, while the
  // immutable statement descriptions remain available in the source export.
  const actualFees=data.transactions.filter(transaction=>classification.canonicalMerchant(transaction)==='Card membership fee');
  const amex={...account('amex'),'type':'credit',subtype:'credit card',institution:'American Express',officialName:'Platinum Card®',name:'Platinum Card®',mask:'1234'};
  const delta={...amex,id:'delta',officialName:'Delta SkyMiles® Platinum Card',name:'Delta SkyMiles® Platinum Card',mask:'5678'};
  const syntheticFees=[row('membership','amex','RENEWAL MEMBERSHIP FEE',895,'expense','bank_fees_other_bank_fees'),row('adjustment','delta','ADJUST MEMBERSHIP FEE',-335,'expense','bank_fees_other_bank_fees')];
  const fixtureAccounts=[amex,delta];
  const readableFees=actualFees.length?actualFees:syntheticFees;
  const readableAccounts=actualFees.length?data.accounts:fixtureAccounts;
  const readableById=new Map(readableAccounts.map(account=>[account.id,account]));
  for(const transaction of readableFees){
    const linkedAccount=readableById.get(transaction.accountId);
    const identity=classification.accountDisplayName(linkedAccount);
    const expectedTitle=`${identity} · ${classification.transactionPurpose(transaction)}`;
    assert.equal(classification.transactionDisplayName(transaction,linkedAccount),expectedTitle,'card fee title identifies its linked card');
    for(const heading of [false,true]){
      const wrap=heading?inDialog:element=>element;
      const markup=renderToStaticMarkup(wrap(React.createElement(TransactionIdentity,{transaction,account:linkedAccount,hidden:false,heading})));
      assert.ok(markup.includes(expectedTitle),`readable ${heading?'editor':'ledger'} title includes card and purpose`);
      count++;
      const privateTransaction={...transaction,sourceName:`${transaction.sourceName||transaction.merchant} $895.00`,note:'Private receipt $123.45'};
      const privateMarkup=renderToStaticMarkup(wrap(React.createElement(TransactionIdentity,{transaction:privateTransaction,account:linkedAccount,hidden:true,heading})));
      assert.doesNotMatch(privateMarkup,/\$[\d,]+(?:\.\d+)?/,'transaction title, source tooltip and note keep amounts hidden');
      count++;
    }
    const exportRows=transactionExportRows([transaction],readableAccounts),header=exportRows[0],exported=exportRows[1];
    assert.equal(exported[header.indexOf('Transaction')],expectedTitle);
    assert.equal(exported[header.indexOf('Purpose')],classification.transactionPurpose(transaction));
    assert.equal(exported[header.indexOf('Original merchant')],transaction.merchant);
    assert.equal(exported[header.indexOf('Original source description')],transaction.sourceName||transaction.merchant);
    assert.equal(exported[header.indexOf('Cash flow USD')],-transaction.amount,'readability does not alter signed financial data');
  }
  assert.equal(classification.transactionDisplayName(syntheticFees[0],amex),'Amex Platinum · membership fee');
  assert.equal(classification.transactionDisplayName(syntheticFees[1],delta),'Amex Delta SkyMiles Platinum · fee refund/adjustment');
  const broadChase={...amex,institution:'Chase',officialName:'Ultimate Rewards®',name:'CREDIT CARD'};
  assert.equal(classification.transactionDisplayName(syntheticFees[0],broadChase),'Chase card (Ultimate Rewards) · membership fee','generic source card identity is retained without inventing a product');
  // The ledger and editor identity mask monetary source prose, including before preview truncation.
  const proseTransaction={...row('prose-row','checking','SYNTHETIC USD 981.23 · $ 88.00 · 350.00 credit',350,'review',null),review:true,note:`${'x'.repeat(68)} 350.00credit · account 1234 on 2026-10-20`};
  for(const heading of [false,true]){
    const wrap=heading?inDialog:element=>element;
    const markup=renderToStaticMarkup(wrap(React.createElement(TransactionIdentity,{transaction:proseTransaction,account:account('checking'),hidden:true,heading})));
    assert.doesNotMatch(markup,/981\.23|88\.00|350\.00/,'All source/title/note attributes mask explicit monetary prose before truncation');
    count++;
  }
  // Transaction note while amounts are hidden: the displayed note is masked and read-only, the raw
  // draft is retained, and an unrelated classification save never sends bullets.
  const findElement=(node,type)=>{if(!node||typeof node!=='object')return null;if(Array.isArray(node)){for(const child of node){const found=findElement(child,type);if(found)return found}return null}if(node.type===type)return node;return findElement(node.props?.children,type)};
  const rawNote='Split dinner $1,234.56; Sam owes $20; USD 981.23; $ 88.00; 350.00credit; account 1234 on 2026-10-20';
  const noteProps=(hidden,onChange=()=>{})=>({note:rawNote,hidden,busy:false,onChange});
  const hiddenNote=renderToStaticMarkup(React.createElement(TransactionNoteField,noteProps(true)));
  assert.doesNotMatch(hiddenNote,/\$\s*[\d,]+(?:\.\d+)?|981\.23|88\.00|350\.00/,'hidden note value, placeholder, title and ARIA contain no raw amount');
  assert.match(hiddenNote,/Split dinner ••••; Sam owes ••••/,'only amounts are masked; the rest of the note stays readable');
  assert.match(hiddenNote,/readonly=""/i,'hidden note is read-only');
  assert.match(hiddenNote,/disabled=""/i,'hidden note editing is disabled without changing the raw draft');
  assert.match(hiddenNote,/aria-describedby="edit-note-hidden"/);assert.match(hiddenNote,/Show amounts to edit it/);
  const visibleNote=renderToStaticMarkup(React.createElement(TransactionNoteField,noteProps(false)));
  assert.ok(visibleNote.includes('$1,234.56')&&visibleNote.includes('$20'),'visible note retains its amounts');
  assert.doesNotMatch(visibleNote,/readonly|edit-note-hidden/i,'visible note is editable');
  const noteEdits=[];
  findElement(TransactionNoteField(noteProps(true,value=>noteEdits.push(value))),'textarea').props.onChange({target:{value:'Split dinner ••••; Sam owes ••••'}});
  assert.deepEqual(noteEdits,[],'a hidden note cannot write masked text into the draft');
  findElement(TransactionNoteField(noteProps(false,value=>noteEdits.push(value))),'textarea').props.onChange({target:{value:'Edited $5'}});
  assert.deepEqual(noteEdits,['Edited $5'],'visible note edits reach the draft unchanged');
  const noteTransaction={...row('note-row','checking','Synthetic diner',1234.56,'expense',null),note:rawNote};
  const noteDraft={category:noteTransaction.category,flow:noteTransaction.flow,exceptional:noteTransaction.exceptional,note:rawNote,review:noteTransaction.review};
  // The editor's category input spreads the existing draft, exactly as setDraft({...draft,category}) does.
  const classifiedDraft={...noteDraft,category:'Travel'};
  assert.deepEqual(changedTransactionPatch(classifiedDraft,noteTransaction,rawNote),{category:'Travel'},'unrelated classification save omits the unchanged raw note');
  assert.equal(classifiedDraft.note,rawNote,'the draft keeps the original note while hidden');
  assert.deepEqual(changedTransactionPatch(noteDraft,noteTransaction,rawNote),{},'an untouched draft sends nothing');
  count+=3;
  // Import failure is announced inside the dialog (Radix hides the page toast from assistive technology).
  const importView=props=>renderToStaticMarkup(inDialog(React.createElement(ImportConfirmation,{dataset:data,busy:false,feedback:'',onImport:()=>{},...props})));
  const importIdle=importView();
  assert.doesNotMatch(importIdle,/role="alert"/,'no feedback before an attempt, and no page toast is mirrored');
  const importFailed=importView({feedback:'Import failed.'});
  assert.match(importFailed,/role="alert"[^>]*>Import failed\. Cancel and reload saved data before trying again\.</,'actionable failure message');
  assert.ok(importFailed.indexOf('role="dialog"')>=0&&importFailed.indexOf('role="dialog"')<importFailed.indexOf('role="alert"'),'feedback is inside the dialog content');
  assert.doesNotMatch(importFailed,/<button[^>]*disabled/,'controls are enabled again after a failure');
  assert.equal((importView({busy:true}).match(/<button[^>]*disabled=""/g)||[]).length,2,'Cancel and Import & save are disabled while busy');
  count+=2;
  const review=await import(pathToFileURL(await compile('lib/review.ts')));
  const recurrence=await import(pathToFileURL(await compile('lib/recurring.ts')));
  const periods=await import(pathToFileURL(await compile('lib/periods.ts')));
  const reviewSummary=review.summarizeReview(data,data.asOf.slice(0,7),'ytd');
  const {default:ReviewComponent,Finding,AccountingReview}=await import(pathToFileURL(await compile('app/intelligent-review.tsx')));
  if(reviewSummary.openFindings.length){const markup=renderToStaticMarkup(React.createElement(ReviewComponent,{data,month:data.asOf.slice(0,7),periodMode:'ytd',hidden:false,onResolveFinding:async()=>{}}));assert.match(markup,/Mark reviewed/,'duplicate checks expose a durable review action');assert.match(markup,/Optional insights/,'context is separate from the action queue');count++;}
  const reviewRow=row('optional-evidence','checking','Synthetic service',123.45,'expense','services_digital_other_services');
  const contextFinding={id:'synthetic-context',kind:'variable-charge',tone:'watch',priority:50,confidence:'candidate',title:'Synthetic service: recorded charge change',summary:'The recorded amount is $123.45.',why:'Recorded values can vary without changing their accounting treatment.',action:'Compare the source details if useful.',amount:123.45,amountLabel:'Recorded amount',transactionIds:[reviewRow.id],evidence:[{transactionId:reviewRow.id,date:reviewRow.date,label:'Synthetic service',amount:123.45,detail:'Source record',inPeriod:true}],stats:[],destination:'transactions',evidenceKey:'synthetic-key',isReviewed:false,newEvidenceSinceReview:false,queue:'context'};
  const findingProps={finding:contextFinding,focused:false,hidden:false,onOpen:()=>{},canOpen:true,onEdit:()=>{},onResolve:async()=>{},index:new Map([[reviewRow.id,reviewRow]])};
  for(const isReviewed of [false,true])for(const hidden of [false,true]){
    const markup=renderToStaticMarkup(React.createElement(Finding,{...findingProps,hidden,finding:{...contextFinding,isReviewed,newEvidenceSinceReview:!isReviewed}}));
    assert.match(markup,/Optional insight/);assert.match(markup,/Optional:/);assert.match(markup,/View transaction/);
    assert.doesNotMatch(markup,/Mark reviewed|Reopen|Review row|Needs confirmation|smart-review-card watch/,'Context cannot imply required review or expose an acknowledgment mutation.');
    if(hidden)assert.doesNotMatch(markup,/\$123\.45/,'Optional evidence remains masked.');count++;
  }
  for(const isReviewed of [false,true]){
    const markup=renderToStaticMarkup(React.createElement(Finding,{...findingProps,finding:{...contextFinding,kind:'similar-charge',queue:'action',isReviewed}}));
    assert.match(markup,isReviewed?/Reopen/:/Mark reviewed/,'Duplicate candidates retain their acknowledgment lifecycle.');count++;
  }
  let accountingDrill;const accountingProps={ids:['first-flag','second-flag'],onOpen:value=>{accountingDrill=value}};
  const accountingMarkup=renderToStaticMarkup(React.createElement(AccountingReview,accountingProps));
  assert.match(accountingMarkup,/2 transactions need an accounting decision/);assert.match(accountingMarkup,/Open flagged transactions/);assert.doesNotMatch(accountingMarkup,/Mark reviewed|Reopen/);
  const accountingTree=AccountingReview(accountingProps);React.Children.toArray(accountingTree.props.children).find(child=>React.isValidElement(child)&&child.type==='button').props.onClick();
  assert.deepEqual(accountingDrill,{ids:accountingProps.ids},'Accounting banner opens exactly the unresolved ledger rows, without acknowledgment.');
  assert.equal(renderToStaticMarkup(React.createElement(AccountingReview,{ids:[],onOpen:()=>{}})),'','No banner for already reconciled accounting.');count+=3;
  const finding=reviewSummary.openFindings[0];
  if(finding){
    const preferences={findingResolutions:{[finding.id]:{state:'reviewed',evidenceKey:finding.evidenceKey,updatedAt:data.syncedAt}},recurringStatuses:{}};
    const reviewed=classification.deriveDataset(state.dataset||state,state.overrides||{},preferences);
    const reviewedSummary=review.summarizeReview(reviewed,data.asOf.slice(0,7),'ytd');
    assert.ok(reviewedSummary.reviewedFindings.some(item=>item.id===finding.id),'saved resolution reaches the reviewed queue');
    assert.ok(!reviewedSummary.openFindings.some(item=>item.id===finding.id),'reviewed evidence leaves the action queue');
    assert.ok(!reviewedSummary.overviewFindings.some(item=>item.id===finding.id),'overview does not resurface reviewed evidence');
    const stale=classification.deriveDataset(state.dataset||state,state.overrides||{},{...preferences,findingResolutions:{[finding.id]:{...preferences.findingResolutions[finding.id],evidenceKey:'previous-evidence'}}});
    assert.ok(review.summarizeReview(stale,data.asOf.slice(0,7),'ytd').openFindings.some(item=>item.id===finding.id),'new evidence reopens a previous review decision');
  }
  const period=periods.resolvePeriod(data,data.asOf.slice(0,7),'ytd');
  const cardModule=await import(pathToFileURL(await compile('lib/card-reference.ts')));
  const {CardFeeReview,BillRow}=await import(pathToFileURL(await compile('app/recurring-review.tsx')));
  const cardData={...data,accounts:[amex,delta],transactions:[
    {...row('delta-charge-a','delta','RENEWAL MEMBERSHIP FEE',365,'expense','financial_other_bank_fees'),date:'2025-09-02',sourceName:'Membership Renewal Fee'},
    {...row('delta-charge-b','delta','RENEWAL MEMBERSHIP FEE',180,'expense','financial_other_bank_fees'),date:'2025-10-02',sourceName:'Membership Fee'},
    {...row('delta-credit','delta','ADJUST MEMBERSHIP FEE',-335,'expense','financial_other_bank_fees'),date:'2025-10-02',sourceName:'Membership Fee Adjustment'},
    {...row('platinum-charge','amex','RENEWAL MEMBERSHIP FEE',895,'expense','financial_other_bank_fees'),date:'2026-03-13',sourceName:'Renewal Membership Fee'}
  ],recurring:[]};
  const feePeriod={start:'2025-09-01',end:'2026-10-25'},feeSummaries=cardModule.summarizeCardFees(cardData,feePeriod),deltaFees=feeSummaries.find(card=>card.accountId==='delta');
  assert.equal(deltaFees.reference.annualFee,350,'published product price is independent from the posted component');
  assert.equal(deltaFees.net,210,'fee reconciliation preserves gross charges less exact signed credit');
  const feeMarkup=renderToStaticMarkup(React.createElement(CardFeeReview,{data:cardData,period:feePeriod,hidden:false}));
  assert.match(feeMarkup,/Published standard annual fee/);assert.match(feeMarkup,/\$350\.00/);assert.match(feeMarkup,/\$180\.00/);assert.match(feeMarkup,/not annual price/,'an unexplained posted component cannot read as the annual fee');assert.match(feeMarkup,/Issuer fee reference/,'a public fact has a direct issuer source');
  assert.match(feeMarkup,/Actual net fee activity in this period/);assert.match(feeMarkup,/\$210\.00/);
  assert.doesNotMatch(feeMarkup,/<table/,'fee source components use a compact list rather than clipped columns inside a narrow card');
  for(const id of ['delta-charge-a','delta-charge-b','delta-credit'])assert.ok(feeMarkup.includes(`data-transaction-id="${id}"`),'each source entry keeps its identity for original-transaction details');
  assert.match(feeMarkup,/class="card-fee-component-top"[^]*?\$180\.00/,'each component places its dated amount before the wrapping source explanation');
  assert.match(feeMarkup,/-\$335\.00/,'the fee-credit sign stays visible in the compact reconciliation');
  const ytdFeeMarkup=renderToStaticMarkup(React.createElement(CardFeeReview,{data:cardData,period:{start:'2026-01-01',end:'2026-10-25'},hidden:false}));
  assert.match(ytdFeeMarkup,/Outside this period/,'historical fee components are not silently charged to YTD');
  const feePrivateMarkup=renderToStaticMarkup(React.createElement(CardFeeReview,{data:cardData,period:feePeriod,hidden:true}));assert.doesNotMatch(feePrivateMarkup,/\$[\d,]+(?:\.\d+)?/,'issuer references and source fee evidence respect amount hiding');
  const feeGroup=recurrence.summarizeRecurring(classification.deriveDataset(cardData),feePeriod).groups.find(group=>group.accountIds.includes('delta')&&/membership fee/i.test(group.name));
  assert.ok(feeGroup,'fee source components retain a single exact-card reconciliation group');
  const feeRowMarkup=renderToStaticMarkup(React.createElement(BillRow,{group:feeGroup,data:cardData,hidden:false,expanded:true,onToggle:()=>{}}));
  assert.match(feeRowMarkup,/Published standard annual fee/);assert.match(feeRowMarkup,/Last posted component/);assert.match(feeRowMarkup,/Not used to infer a renewal rate/);assert.doesNotMatch(feeRowMarkup,/Annual cycle/,'mixed fee components cannot inherit an annual-cycle assertion');
  const movements=await import(pathToFileURL(await compile('lib/movements.ts')));
  const AppleCardSpending=(await import(pathToFileURL(await compile('app/apple-card-spending.tsx')))).default;
  const {ZelleView}=(await import(pathToFileURL(await compile('app/money-movements.tsx'))));
  for(const mode of ['month','ytd','year'])for(const hidden of [false,true]){
    const zelleSummary=movements.summarizeMovements(data,data.asOf.slice(0,7),mode).zelle;
    const zelleMarkup=renderToStaticMarkup(React.createElement(ZelleView,{data,summary:zelleSummary,hidden,onEdit:()=>{},rangeLabel:'Selected dates'}));
    assert.match(zelleMarkup,/Explicitly excluded Zelle records/);assert.match(zelleMarkup,/payment rail alone does not create an exclusion/);assert.match(zelleMarkup,/Sent and received/);
    assert.doesNotMatch(zelleMarkup,/Excluded movement value/);
    if(hidden)assert.doesNotMatch(zelleMarkup,/\$[\d,]+(?:\.\d+)?/);
    for(const routine of [false,true]){
      const appleSummary=income.summarizeIncome(data,Number(data.asOf.slice(0,4)),data.asOf.slice(0,7),mode,routine);
      const appleMarkup=renderToStaticMarkup(React.createElement(AppleCardSpending,{data,month:data.asOf.slice(0,7),periodMode:mode,hidden,routine,onEdit:()=>{}}));
      assert.equal(appleMarkup,'','Disabled payment proxy has no misleading empty explanation or spending table');
      count++;
    }
    count++;
  }
  const incomeSummary=income.summarizeIncome(data,Number(data.asOf.slice(0,4)),data.asOf.slice(0,7),'ytd');
  const bridgeMarkup=renderToStaticMarkup(React.createElement(SurplusBridge,{summary:incomeSummary,hidden:false,onOpen:()=>{}}));
  assert.match(bridgeMarkup,/Equity received is valued separately from cash/);assert.match(bridgeMarkup,/Tax basis is unknown/);assert.doesNotMatch(bridgeMarkup,/Less additional|Conditional reference|before RSU withholding/);
  const RsuHistory=(await import(pathToFileURL(await compile('app/rsu-withholding.tsx')))).default;
  const rsuHistoryMarkup=renderToStaticMarkup(React.createElement(RsuHistory,{data,summary:incomeSummary,hidden:false}));
  if(incomeSummary.knownRsuWithholding>0){
    assert.match(rsuHistoryMarkup,/Recorded RSU tax journals/);assert.match(rsuHistoryMarkup,/Separate settlement evidence/);assert.match(rsuHistoryMarkup,/original tax journals/);
    assert.doesNotMatch(rsuHistoryMarkup,/Conditional surplus|If the received-share counts|before withholding/);
    const privateHistory=renderToStaticMarkup(React.createElement(RsuHistory,{data,summary:incomeSummary,hidden:true}));assert.doesNotMatch(privateHistory,/\$[\d,]+(?:\.\d+)?/);
  }
  assert.ok(income.currentIncomeNotes(['Surplus before separate RSU debits.']).every(note=>!note.includes('before separate RSU debits')),'stale stored analytical notes cannot reintroduce the retired deduction');
  const privateBridge=renderToStaticMarkup(React.createElement(SurplusBridge,{summary:incomeSummary,hidden:true,onOpen:()=>{}}));assert.doesNotMatch(privateBridge,/\$[\d,]+(?:\.\d+)?/);
  count+=6;
  const recurringSummary=recurrence.summarizeRecurring(data,period);
  const group=recurringSummary.groups[0];
  if(group){
    const preferences={findingResolutions:{},recurringStatuses:{[group.id]:{status:'stopped',effectiveDate:data.asOf,updatedAt:data.syncedAt}}};
    const stopped=classification.deriveDataset(state.dataset||state,state.overrides||{},preferences);
    const stoppedSummary=recurrence.summarizeRecurring(stopped,period);
    const stoppedGroup=stoppedSummary.groups.find(item=>item.id===group.id);
    assert.equal(stoppedGroup.status,'stopped','saved service status reaches its recurring group');
    assert.equal(stoppedGroup.statusSource,'user-confirmed');
    assert.equal(stoppedSummary.net,recurringSummary.net,'stopping a service never removes historical spending');
    assert.equal(stoppedGroup.net,group.net,'status and recorded group costs remain separate');
    const Recurring=(await import(pathToFileURL(await compile('app/recurring-review.tsx')))).default;
    const markup=renderToStaticMarkup(React.createElement(Recurring,{data:stopped,month:data.asOf.slice(0,7),periodMode:'ytd',hidden:false,onEdit:()=>{},focusGroupId:group.id,onSetRecurringStatus:async()=>{}}));
    assert.match(markup,/Stopped/i,'saved lifecycle state is visible in the recurring experience');
    assert.match(markup,/Confirm ongoing/,'focused service exposes an ongoing confirmation action');
    assert.match(markup,/Mark stopped/,'focused service exposes a stop confirmation action');
    assert.match(markup,/Use detection/,'manual lifecycle state can return to source detection');
    assert.ok(markup.includes(`max="${data.asOf}"`),'service effective date cannot exceed saved source date');
    const privateMarkup=renderToStaticMarkup(React.createElement(Recurring,{data:stopped,month:data.asOf.slice(0,7),periodMode:'ytd',hidden:true,onEdit:()=>{},focusGroupId:group.id,onSetRecurringStatus:async()=>{}}));
    assert.doesNotMatch(privateMarkup,/\$[\d,]+(?:\.\d+)?/,'expanded recurring evidence keeps amounts hidden');
    count+=2;
  }
  const Overview = (await import(pathToFileURL(await compile('app/intelligent-review.tsx')))).IntelligentReviewOverview;
  for(const hidden of [false,true]){const markup=renderToStaticMarkup(React.createElement(Overview,{data,month:data.asOf.slice(0,7),periodMode:'ytd',hidden,onOpenReview:()=>{},onOpenTransactions:()=>{}}));assert.match(markup,/needs your attention/i);if(hidden)assert.doesNotMatch(markup,/\$[\d,]+(?:\.\d{2})?/,'overview review masks amounts');count++;}
  console.log(`Report render checks passed: ${count} period/privacy/readable-card views plus checking reimbursement, review-resolution and recurring-status concurrent-save, portable raw-backup, issuer-fee reconciliation and tax-basis-neutral RSU receipt/settlement-history regressions; unsupported retirement tax controls absent.`);
} finally {
  await fs.rm(output, {recursive:true,force:true});
}
