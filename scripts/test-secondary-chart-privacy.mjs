// Entirely synthetic; no browser, network, credentials or private fixtures.
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

// Capture the real returned component tree while React supplies its normal server
// hook dispatcher. Returning null prevents Recharts SSR from hiding whether the
// private subtree was instantiated. No chart, data builder or hook is mocked.
const { createElement, isValidElement, Children } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');
const { Bar, BarChart, ResponsiveContainer } = await import('recharts');
const { default: Income } = await import('../app/income.tsx');
const { default: Retirement } = await import('../app/retirement.tsx');
const { default: MoneyMovements, ZelleView } = await import('../app/money-movements.tsx');
const { summarizeMovements } = await import('../lib/movements.ts');

const account=(id,type,subtype,balance=0)=>({id,name:`Synthetic ${id}`,institution:'Example',type,subtype,mask:'0000',balance,netBalance:balance,balanceDate:null,balanceAgeKnown:false,syncStatus:'synced'});
const tx=(id,amount,extra={})=>({id,date:'2026-10-05',merchant:id,accountId:'checking',amount,category:'Transfers',flow:'transfer',confidence:'HIGH',exceptional:false,note:'',pending:false,review:false,...extra});
const data={
  version:1,syncedAt:'2026-10-25T12:00:00Z',asOf:'2026-10-25',dateRange:{start:'2026-01-01',end:'2026-10-25'},coverage:{},
  accounts:[account('checking','depository','checking'),account('card','credit','credit card'),account('plan','investment','401k',7654.32)],
  transactions:[
    tx('payroll',-3234.56,{merchant:'Example Employer payroll',sourceName:'Example Employer payroll',category:'Income',flow:'income',sourceCategoryDetailed:'income_salary'}),
    tx('payment',1765.43,{transferTransactionId:'repayment'}),
    tx('repayment',-1765.43,{accountId:'card',transferTransactionId:'payment'}),
    tx('zelle-out',983.17,{merchant:'Zelle to Synthetic Person',reviewDecision:'zelle'}),
  ],netWorthHistory:[],recurring:[],notes:[],
  retirementEvidence:{version:1,scope:{start:'2026-01-01',end:'2026-10-25',sourceReadAt:null,isCompleteForQuery:null,freshness:'unknown',description:'Synthetic only'},accountScopes:[],records:[{id:'contribution',accountId:'plan',date:'2026-10-05',description:'Employee contribution',amount:-642.38,type:'cash',subtype:'contribution',currency:'USD'}],notes:[]},
};
const original=JSON.stringify(data);
function capture(Component,props){
  let captured;
  function Capture(){captured=Component(props);return null;}
  renderToStaticMarkup(createElement(Capture));
  assert.ok(isValidElement(captured));return captured;
}
const elements=node=>isValidElement(node)?[node,...Children.toArray(node.props.children).flatMap(elements)]:[];
const charts=tree=>elements(tree).filter(node=>node.type===BarChart);
let boundaries=0;
for(const periodMode of ['month','ytd','year']){
  const common={data,month:'2026-10',periodMode,overrides:{},onEdit:()=>{}};
  const cases=[
    ['income',Income,common,1,['employerCashIncome','rsu']],
    ['retirement',Retirement,common,2,['value','value']],
    ['excluded movements',MoneyMovements,common,1,['cardRepayments','internalTransfers','investmentMovements','other']],
    ['Zelle',ZelleView,{data,summary:summarizeMovements(data,'2026-10',periodMode).zelle,onEdit:()=>{},rangeLabel:'Synthetic period'},1,['sent','received']],
  ];
  for(const [name,Component,props,count,keys] of cases){
    const visible=capture(Component,{...props,hidden:false});
    const shown=elements(visible),visibleCharts=charts(visible);
    assert.equal(visibleCharts.length,count,`${name}: nonempty visible chart mounted`);
    assert.equal(shown.filter(node=>node.type===ResponsiveContainer).length,count);
    const bars=shown.filter(node=>node.type===Bar);
    assert.deepEqual(bars.map(node=>node.props.dataKey),keys,`${name}: original series keys preserved`);
    assert.ok(bars.every(node=>node.props.isAnimationActive===false),`${name}: no value geometry animation`);
    assert.ok(visibleCharts.every(node=>Array.isArray(node.props.data)&&node.props.data.length>0));
    assert.ok(visibleCharts.some(node=>node.props.data.some(row=>Object.values(row).some(value=>typeof value==='number'&&value!==0))),`${name}: test uses real nonzero financial series`);
    const privateTree=capture(Component,{...props,hidden:true});
    const privateElements=elements(privateTree);
    assert.equal(privateElements.some(node=>[ResponsiveContainer,BarChart,Bar].includes(node.type)),false,`${name}: hidden mode does not mount any chart or financial series`);
    const placeholders=privateElements.filter(node=>node.type==='div'&&node.props.className==='chart-private');
    assert.equal(placeholders.length,count,`${name}: each chart replaced by explicit privacy message`);
    for(const placeholder of placeholders){
      assert.deepEqual(Object.keys(placeholder.props).sort(),['children','className']);
      assert.equal(placeholder.props.children,'Show amounts to view this chart.');
      assert.doesNotMatch(renderToStaticMarkup(placeholder),/<svg|aria-value|data-|\d/);
    }
    const markup=renderToStaticMarkup(privateTree);
    assert.doesNotMatch(markup,/\$\s?\d|3234\.56|3,234\.56|7654\.32|7,654\.32|1765\.43|1,765\.43|983\.17|642\.38|aria-valuenow|aria-valuetext/,
      `${name}: no synthetic monetary values or financial ARIA values in hidden markup`);
    // Toggling back restores the same financial data and visible dimensions.
    const restored=charts(capture(Component,{...props,hidden:false}));
    const settings=node=>Object.fromEntries(Object.entries(node.props).filter(([key])=>key!=='children'));
    assert.deepEqual(restored.map(settings),visibleCharts.map(settings));
    boundaries+=count;
  }
}
assert.equal(JSON.stringify(data),original,'privacy rendering never mutates source records');
console.log(`Secondary chart privacy passed: ${boundaries} real chart boundaries across month/YTD/year, no hidden chart/data/ARIA subtree, unchanged restored series and dimensions, and no geometry animation.`);
