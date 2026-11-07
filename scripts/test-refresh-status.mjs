import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {REFRESH_ATTEMPT_WINDOW_MS,recordedTime,refreshTextForDisplay,summarizeRefreshStatus} from '../lib/refresh-status.ts';
import {FINANCE_CONFIG} from '../lib/finance-config.ts';

const started='2026-11-01T12:00:00Z',start=Date.parse(started),importedAt='2026-10-31T12:00:00Z';
const run={id:'synthetic-run',status:'running',startedAt:started,start:'2026-09-01',end:'2026-11-01',baseSyncedAt:importedAt};
const schedule={id:'synthetic-schedule',enabled:true,timezone:'America/Los_Angeles',hour:7,verifiedAt:'2026-10-25T12:00:00Z'};
const state={lastRun:run,schedule},before=structuredClone(state);
assert.equal(summarizeRefreshStatus(state,importedAt,start+1000).attempt,'running');
assert.equal(summarizeRefreshStatus(state,importedAt,start+REFRESH_ATTEMPT_WINDOW_MS).attempt,'unfinished');
const stale=summarizeRefreshStatus(state,importedAt,start+3*REFRESH_ATTEMPT_WINDOW_MS);
assert.equal(stale.compactLabel,'Saved snapshot');assert.equal(stale.latestFailure,false);
for(const startedAt of ['bad-date','',undefined,'2026-11-02T12:00:00Z'])assert.equal(summarizeRefreshStatus({lastRun:{...run,startedAt}},importedAt,start).attempt,'timing-unknown');
assert.equal(recordedTime('invalid'),null);assert.equal(recordedTime(undefined),null);
const failure={lastRun:{...run,status:'failed',finishedAt:'2026-11-01T13:00:00Z',error:'Source returned USD 123.45 for Synthetic $ 88.00 merchant with 350.00credit'}};
assert.equal(summarizeRefreshStatus(failure,importedAt,start+1000).latestFailure,true);
assert.equal(summarizeRefreshStatus(failure,'2026-11-02T12:00:00Z',start+2*86400000).latestFailure,false,'A later saved snapshot separates an old failed attempt from current data');
assert.equal(summarizeRefreshStatus({lastRun:{...failure.lastRun,finishedAt:undefined}},'2026-11-02T12:00:00Z',start).latestFailure,true,'Missing failure finish time cannot prove that failure predates a later save');
assert.equal(summarizeRefreshStatus({schedule},importedAt,start+100*86400000).compactLabel,'Saved snapshot','Saved schedule configuration alone cannot create a live overdue alert');
assert.deepEqual(state,before);assert.equal(state.lastRun.status,'running','No stored lifecycle status is changed by presentation');
assert.equal(refreshTextForDisplay('USD 123.45 · $88.00 · 90 USD',true),'•••• · •••• · ••••');
assert.equal(refreshTextForDisplay('−$12.50 · -USD 88.00 · +US$90.25 · −12.50 USD · $−4.25 · −25.00 refund',true),'•••• · •••• · •••• · •••• · •••• · •••• refund','Monetary direction signs are masked with their amounts');
assert.equal(refreshTextForDisplay('−$12.50 · -USD 88.00',false),'−$12.50 · -USD 88.00');
assert.equal(refreshTextForDisplay('Synthetic merchant 7 USD 9,876.54',true),'Synthetic merchant ••••');
assert.equal(refreshTextForDisplay('Synthetic merchant 7 USD 9,876.54 · 12.34 USD',true),'Synthetic merchant •••• · ••••');
assert.equal(refreshTextForDisplay('Wire 9,876.54 USD 7 Nov',true),'Wire •••• Nov');
assert.equal(refreshTextForDisplay('Wire 9,876.54USD · $.50 · 1,234.56 dollars',true),'Wire •••• · •••• · ••••');
assert.equal(refreshTextForDisplay('1,250.00 USD 11/03',true),'••••/03');
assert.equal(refreshTextForDisplay('Source $88.00',false),'Source $88.00');
for(const noun of ['credit','debit','refund','payment','fee','CREDITS','fees']) {
 for(const gap of ['',' ']) assert.equal(refreshTextForDisplay(`Synthetic 350.00${gap}${noun}`,true),`Synthetic ••••${gap}${noun}`);
}
assert.equal(refreshTextForDisplay('USD 123.45 · $ 88.00 · US$ -90.00 · +1,234.56 refund',true),'•••• · •••• · •••• · •••• refund');
const nonmonetary='Account 1234 · reference ABC350.00 credit · date 2026-10-25 · 2026.10.25 credit · version 350.00';
assert.equal(refreshTextForDisplay(nonmonetary,true),nonmonetary,'Unrelated numbers, identifiers and dates are preserved');
assert.equal(refreshTextForDisplay('Synthetic 350.00 credit · USD 123.45 · $ 88.00',false),'Synthetic 350.00 credit · USD 123.45 · $ 88.00');

const dir=await mkdtemp(path.resolve('.sites-runtime/refresh-status-'));
try{
 const source=await readFile('app/refresh-status.tsx','utf8');
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText.replaceAll("'@/lib/refresh-status'",JSON.stringify(pathToFileURL(path.resolve('lib/refresh-status.ts')).href)).replaceAll('"@/lib/finance-config"',JSON.stringify(pathToFileURL(path.resolve('lib/finance-config.ts')).href));
 await writeFile(path.join(dir,'status.mjs'),js);const Component=(await import(pathToFileURL(path.join(dir,'status.mjs')).href)).default;
 const success={...run,status:'succeeded',finishedAt:importedAt,report:{bankRows:12,investmentRows:2,recurringStreams:1,newTransactions:0,removedPending:0,sourceDifferences:[{id:'synthetic-difference',date:'2026-10-01',merchant:'Synthetic $987.65',amount:456.78}]}};
 const historical={...state,lastRun:{...run,startedAt:'2000-01-01T12:00:00Z'},lastSuccess:success};
 const render=props=>renderToStaticMarkup(React.createElement(Component,{state:historical,importedAt,...props}));
 const markup=render({}),primary=markup.split('<details')[0];
 assert.ok(markup.includes(new Date(importedAt).toLocaleString(FINANCE_CONFIG.locale,{timeZone:FINANCE_CONFIG.timeZone,year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'})),'Saved timestamps use the deployment reporting timezone');
 assert.match(primary,/Saved snapshot available/);assert.match(primary,/Unfinished update attempt/);assert.doesNotMatch(primary,/source differences|needs attention|overdue|Checking connected records|refresh-error/);
 assert.match(markup,/<details class="source-note-details refresh-history"><summary>Update history/);assert.doesNotMatch(markup,/<details[^>]* open=/);
 assert.match(markup,/source differences recorded in that update/);assert.match(markup,/Schedule last recorded as enabled/);assert.match(markup,/does not verify whether the external scheduler is currently enabled/);
 const masked=render({hidden:true,state:{...historical,lastRun:failure.lastRun}});assert.doesNotMatch(masked,/\$[\d,]+|USD\s*[\d,]+|987\.65|456\.78|123\.45|88\.00|350\.00/,'Historical descriptors/errors and amounts are masked');
 const compact=render({compact:true,minimal:true});assert.match(compact,/Saved snapshot/);assert.doesNotMatch(compact,/Last saved|Update details|refresh-warning/);
 const failed=render({state:failure,compact:true,minimal:true,onDetails(){}});assert.match(failed,/Last update failed/);assert.match(failed,/Update details/);
 assert.doesNotThrow(()=>render({state:{...historical,lastSuccess:{...success,report:{bankRows:{unexpected:true},sourceDifferences:[null,42,{merchant:'Synthetic',amount:'invalid'}]}}}}),'Malformed historical report values cannot crash current status');

 // Execute the actual effect with controlled state/time boundaries. A visible
 // run expires without another data read, and all listeners/timers are removed.
 const common=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const oldWindow=globalThis.window,oldNow=Date.now;let now=start+1000,clock,cleanup,interval,focus,tickCount=0;
 const values=[];let hookIndex=0,effectStarted=false;
 globalThis.window={setInterval(fn,delay){assert.equal(delay,60000);interval=fn;return 7},clearInterval(id){assert.equal(id,7);interval=null},addEventListener(name,fn){assert.equal(name,'focus');focus=fn},removeEventListener(name,fn){assert.equal(name,'focus');assert.equal(fn,focus);focus=null}};
 Date.now=()=>now;
 try{
  const exports={},jsx=(type,props)=>({type,props});
  new Function('require','exports',common)(name=>name==='react'?{useState(initial){const index=hookIndex++;if(!(index in values))values[index]=typeof initial==='function'?initial():initial;return[values[index],value=>{values[index]=typeof value==='function'?value(values[index]):value;clock=values[2];tickCount++;}]},useEffect(effect){if(!effectStarted){effectStarted=true;cleanup=effect();}}}:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='@/lib/refresh-status'?{recordedTime,refreshTextForDisplay,summarizeRefreshStatus}:name==='@/lib/finance-config'?{FINANCE_CONFIG}:{Check(){},Copy(){},RefreshCw(){},TriangleAlert(){},ChevronDown(){}},exports);
  const renderTree=()=>{hookIndex=0;return exports.default({state,importedAt,compact:true,minimal:true});};
  const text=node=>node==null?'':typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):text(node.props?.children);
  assert.match(text(renderTree()),/Checking connected records/);assert.ok(interval&&focus);
  now=start+REFRESH_ATTEMPT_WINDOW_MS;interval();assert.equal(clock,now);assert.match(text(renderTree()),/Saved snapshot/);
  const prior=tickCount;focus();assert.equal(tickCount,prior+1);cleanup();assert.equal(interval,null);assert.equal(focus,null);
 }finally{globalThis.window=oldWindow;Date.now=oldNow;}
}finally{await rm(dir,{recursive:true,force:true});}
console.log('Refresh status: stale/invalid timing, unchanged source state, recorded-only schedules, historical provenance, monetary privacy, explicit failure and live expiry/cleanup passed.');
