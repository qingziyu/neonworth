// Public-code loading and native viewport behavior; synthetic, no network.
import assert from 'node:assert/strict';
import {readFile,mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createCodeModule} from '../app/report-modules.ts';

let importCalls=0,release;
const moduleValue={default:()=>null};
const code=createCodeModule(()=>{importCalls++;return new Promise(resolve=>{release=resolve;});});
assert.equal(importCalls,0,'Declaring a module does not preload it');
const intent=code.load(),render=code.load();
assert.equal(intent,render,'Intent and rendering share one pending module request');
await Promise.resolve();assert.equal(importCalls,1);release(moduleValue);
assert.equal(await intent,moduleValue);assert.equal(await code.load(),moduleValue);assert.equal(importCalls,1);
let attempts=0;
const flaky=createCodeModule(async()=>{attempts++;if(attempts===1)throw new Error('Synthetic failed preload');return moduleValue;});
await assert.rejects(flaky.load(),/Synthetic failed preload/);
assert.equal(attempts,1,'A rejected module never retries itself');
assert.equal(await flaky.load(),moduleValue,'A later explicit request can retry after a failed speculative load');
assert.equal(attempts,2);

await mkdir('.sites-runtime',{recursive:true});
const dir=await mkdtemp(path.resolve('.sites-runtime/report-loading-'));
try{
 const source=await readFile('app/deferred-chart.tsx','utf8');
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 await writeFile(path.join(dir,'deferred.mjs'),js);
 const {default:DeferredChart,observeChartViewport}=await import(pathToFileURL(path.join(dir,'deferred.mjs')).href);
 let observer,activations=0;const target={};
 class Observer{
  constructor(callback,options){this.callback=callback;this.options=options;observer=this;}
  observe(element){this.target=element;}
  disconnect(){this.disconnected=true;}
 }
 const cleanup=observeChartViewport(target,()=>activations++,Observer);
 assert.deepEqual(observer.options,{rootMargin:'160px 0px',threshold:0});assert.equal(observer.target,target);
 observer.callback([{target,isIntersecting:false},{target:{},isIntersecting:true}]);assert.equal(activations,0);
 observer.callback([{target,isIntersecting:true}]);assert.equal(activations,1);assert.equal(observer.disconnected,true);
 observer.callback([{target,isIntersecting:true}]);assert.equal(activations,1,'Scroll updates cannot reinitialize an activated chart');cleanup();
 const cancelled=observeChartViewport(target,()=>activations++,Observer);cancelled();
 observer.callback([{target,isIntersecting:true}]);assert.equal(activations,1,'Unmount/privacy cleanup rejects a queued observer callback');
 observeChartViewport(target,()=>activations++,undefined);assert.equal(activations,2,'A missing observer falls back to immediate rendering');
 let childLoads=0;
 const FinancialChild=React.lazy(async()=>{childLoads++;return{default:()=>React.createElement('svg',{'data-value':'350.25'})};});
 for(const hidden of [false,true]){
  const markup=renderToStaticMarkup(React.createElement(DeferredChart,{hidden,name:'Spending trend chart',className:'chart tall'},React.createElement(FinancialChild)));
  assert.doesNotMatch(markup,/<svg|350\.25/);
  if(hidden){assert.match(markup,/Show amounts to view this chart/);assert.doesNotMatch(markup,/loads as you scroll|Loading Spending/);}
  else{assert.match(markup,/class="chart tall"/);assert.match(markup,/Spending trend chart loads as you scroll/);assert.match(markup,/role="status"/);}
 }
 assert.equal(childLoads,0,'Offscreen/hidden initial rendering does not request the financial chart module');
 // Execute the real destination registry against instrumented public modules.
 // The separate render suite imports the real report graph with fetch trapped.
 const registrySource=await readFile('app/report-modules.ts','utf8');
 let registryJs=ts.transpileModule(registrySource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const targets=new Set();
 registryJs=registryJs.replace(/import\((['"])\.\/([^'"]+)\1\)/g,(_,quote,target)=>{
  targets.add(target);return `import('./probe-${target}.mjs')`;
 });
 globalThis.__neonworthReportImportProbe=[];
 try{
  for(const target of targets)await writeFile(path.join(dir,`probe-${target}.mjs`),`globalThis.__neonworthReportImportProbe.push(${JSON.stringify(target)});export default function Component(){return null;}export const IncomeSpendingChart=Component,SpendingTrendChart=Component,NetWorthChart=Component;`);
  await writeFile(path.join(dir,'registry.mjs'),registryJs);
  const registry=await import(pathToFileURL(path.join(dir,'registry.mjs')).href);
  assert.deepEqual(globalThis.__neonworthReportImportProbe,[],'Registry construction does not sweep reports');
  assert.equal(await registry.preloadReport('Year in Review'),true);
  assert.deepEqual(globalThis.__neonworthReportImportProbe,['year-in-review-view'],'One destination starts only its report loader');
  await registry.preloadReport('Spending');
  assert.deepEqual(new Set(globalThis.__neonworthReportImportProbe),new Set(['year-in-review-view','dashboard-charts','spending-composition']));
  await registry.preloadReport('Net worth');await registry.preloadReport('Year in Review');
  assert.equal(globalThis.__neonworthReportImportProbe.length,3,'Repeated intent reuses already loaded modules');
  await registry.preloadReport('Transactions');
  assert.equal(globalThis.__neonworthReportImportProbe.length,3,'Eager destinations do not preload unrelated reports');
 }finally{delete globalThis.__neonworthReportImportProbe;}
}finally{await rm(dir,{recursive:true,force:true});}
console.log('Report loading: shared public-code request, explicit retry after rejected preload, one-shot viewport threshold/cleanup, stable placeholders and hidden child removal passed. Browser timing/scroll acceptance is separate.');
