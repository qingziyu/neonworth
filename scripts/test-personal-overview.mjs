// Synthetic presentation and exact-record action checks; no live data/network.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import './test-support/register.mjs';
import { financialReviewFixture } from './test-support/financial-review-fixture.mjs';
import { deriveDataset } from '../lib/classification.ts';
import { summarizePeriod } from '../lib/finance.ts';
import { resolvePeriod } from '../lib/periods.ts';
import { summarizeDataHealth } from '../lib/data-health.ts';
import { summarizeReview } from '../lib/review.ts';

const root=path.resolve(import.meta.dirname,'..');
await mkdir(path.join(root,'.sites-runtime'),{recursive:true});
const temp=await mkdtemp(path.join(root,'.sites-runtime','personal-overview-'));
const source=financialReviewFixture().dataset;
source.accounts.find(a=>a.id==='old-card').name='Synthetic card USD 12,345.67';
const seed=source.transactions.find(t=>t.id==='large-purchase');
source.transactions.push(...Array.from({length:8},(_,i)=>({...seed,id:`history-flag-${i}`,date:`2025-10-${String(i+10).padStart(2,'0')}`,merchant:`Synthetic flagged merchant ${String.fromCharCode(65+i)} USD 9,876.54`,sourceName:`Synthetic flagged merchant ${String.fromCharCode(65+i)} USD 9,876.54`,amount:321.09+i,review:true,note:'Explicit synthetic review request; preserve it.'})));
source.notes.push('Old importer: 200 transactions require review.');
const data=deriveDataset(source),before=structuredClone(data),noop=()=>{};
const slot=name=>React.createElement('div',{'data-slot':name},`${name} preserved`);
const props=(dataset=data,month='2026-10',periodMode='month',hidden=false)=>({
 data:dataset,month,periodMode,hidden,summary:summarizePeriod(dataset,month,periodMode),periodLabel:resolvePeriod(dataset,month,periodMode).label,
 budget:slot('budget'),chart:slot('chart'),chartLegend:slot('legend'),categories:slot('categories'),reconciliation:slot('reconciliation'),
 netWorth:{value:98765.43,date:'2026-10-28'},onEdit:noop,onReview:noop,onData:noop,onGoals:noop,onNetWorth:noop,onBills:noop,onIncome:noop,onSpending:noop,
});
const elements=node=>React.isValidElement(node)?[node,...React.Children.toArray(node.props.children).flatMap(elements)]:[];
const capture=(Component,properties)=>{let tree;function Capture(){tree=Component(properties);return null;}renderToStaticMarkup(React.createElement(Capture));return tree;};
try{
 let js=ts.transpileModule(await readFile(path.join(root,'app/personal-overview.tsx'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 js=js.replace(/(['"])@\/([^'"]+)\1/g,(_,quote,specifier)=>JSON.stringify(pathToFileURL(path.join(root,specifier+'.ts')).href));
 const effects=ts.transpileModule(await readFile(path.join(root,'app/workspace-effects.tsx'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 await writeFile(path.join(temp,'workspace-effects.mjs'),effects);
 js=js.replace(/(['"])\.\/workspace-effects\1/g,'"./workspace-effects.mjs"');
 const modulePath=path.join(temp,'personal-overview.mjs');await writeFile(modulePath,js);
 const {default:Overview,AccountingHistoryRecords}=await import(pathToFileURL(modulePath));
 const render=properties=>renderToStaticMarkup(React.createElement(Overview,properties));
 const health=summarizeDataHealth(data),review=summarizeReview(data,'2026-10','month');
 assert.equal(health.accounting.length,8);assert.equal(review.accountingReviewTransactionIds.length,0);
 const visible=render(props());
 assert.equal(props().summary.appleCardPaymentCount,0);
 assert.match(visible,/Posted purchases, less refunds/);
 assert.doesNotMatch(visible,/Apple Card proxy/,'Ordinary spending does not claim that an opt-in payment proxy was applied');
 const proxyProps=props();proxyProps.summary={...proxyProps.summary,appleCardPaymentCount:1};
 assert.match(render(proxyProps),/Posted purchases and Apple Card proxy, less refunds/,'The canonical selected-period count discloses a proxy only when one is included');
 assert.match(visible,/<strong>0<\/strong><span>Selected month<\/span>/);
 assert.match(visible,/<strong>8<\/strong><span>Saved history<\/span>/,'Selected-period zero cannot conceal older canonical flags');
 assert.match(visible,/Saved history still has accounting records to resolve/);
 assert.equal((visible.match(/class="workspace-history-record"/g)||[]).length,6,'Collapsed history mounts only a bounded page');
 assert.doesNotMatch(visible,/200 transactions require review|Mark reviewed|All clear|Earlier records/,'Stale prose and acknowledgments never become attention tasks');
 assert.doesNotMatch(visible,/<details[^>]*\bopen(?:\s|=|>)/,'Accounting evidence starts as a deliberate disclosure');
 for(const name of ['budget','chart','legend','categories','reconciliation'])assert.equal((visible.match(new RegExp(`data-slot="${name}"`,'g'))||[]).length,1,'Canonical presentation slots are retained once');
 const order=['workspace-summary','workspace-attention workspace-card','workspace-flow workspace-card','workspace-categories workspace-card','workspace-planning','workspace-reconciliation'].map(name=>visible.indexOf(`class="${name}"`));
 assert.ok(order.every((position,index)=>position>=0&&(index===0||position>order[index-1])),'DOM order follows summary, attention, chart, categories and planning');
 const hidden=render(props(data,'2026-10','month',true));
 assert.doesNotMatch(hidden,/\$\s*[\d,]|9,876\.54|12,345\.67|98,765|aria-valuenow|progressbar/,'Amounts and monetary merchant/account text do not remain in markup or ARIA');
 assert.match(hidden,/Saved history/);assert.match(hidden,/Synthetic flagged merchant/,'Amounts-only privacy keeps source identity context');
 assert.match(hidden,/Your FIRE plan/);assert.doesNotMatch(hidden,/80,000|2,000,000|4%|saved progress|eligible assets of/i,'FIRE navigation makes no assumption or saved-progress claim');
 for(const mode of ['month','ytd','year']){
  const expected=summarizeReview(data,'2026-10',mode),markup=render(props(data,'2026-10',mode));
  assert.match(markup,new RegExp(`<strong>${expected.accountingReviewTransactionIds.length}<\\/strong><span>${mode==='month'?'Selected month':mode==='ytd'?'Year to date':'Past year'}<\\/span>`));
 }
 const historical=render(props(data,'2025-10'));
 assert.match(historical,/<strong>8<\/strong><span>Selected month<\/span>/);assert.doesNotMatch(historical,/outside the selected dates|Earlier records|still has accounting records to resolve/,'All flags inside the period do not imply unseen older flags');
 const laterOnly={...data,transactions:data.transactions.filter(t=>t.review).map(t=>({...t,date:'2026-10-12'}))};
 const earlierWindow=render(props(laterOnly,'2026-09'));
 assert.match(earlierWindow,/<strong>0<\/strong><span>Selected month<\/span>/);assert.match(earlierWindow,/<strong>8<\/strong><span>Saved history<\/span>/);assert.doesNotMatch(earlierWindow,/Earlier records/,'A historical month may have later flagged history');

 let selected=null,requestedPage=null;
 const tree=capture(Overview,{...props(),onEdit:row=>{selected=row;}});
 const historyNode=elements(tree).find(node=>node.type===AccountingHistoryRecords);assert.ok(historyNode);
 const first=AccountingHistoryRecords({...historyNode.props,onPage:page=>{requestedPage=page;}});
 const firstRows=elements(first).filter(node=>node.type==='button'&&node.props.className==='workspace-history-record');
 firstRows[0].props.onClick();assert.equal(selected,historyNode.props.rows[0],'History opens the exact canonical record, without current-period ledger filtering');
 assert.equal(selected.date.slice(0,7),'2025-10');
 elements(first).find(node=>node.props['aria-label']==='Next accounting records').props.onClick();assert.equal(requestedPage,1);
 const second=AccountingHistoryRecords({...historyNode.props,page:requestedPage,onPage:page=>{requestedPage=page;}});
 const secondRows=elements(second).filter(node=>node.type==='button'&&node.props.className==='workspace-history-record');
 assert.equal(secondRows.length,2);secondRows[0].props.onClick();assert.equal(selected,historyNode.props.rows[6]);
 assert.equal(elements(second).find(node=>node.props['aria-label']==='Next accounting records').props.disabled,true);
 elements(second).find(node=>node.props['aria-label']==='Previous accounting records').props.onClick();assert.equal(requestedPage,0);
 const clamped=AccountingHistoryRecords({...historyNode.props,page:999});
 assert.equal(elements(clamped).filter(node=>node.props.className==='workspace-history-record').length,2,'A shrinking history cannot strand pagination on a blank page');

 const duplicateSource={...source,transactions:[
  {...seed,id:'retained',date:'2026-10-12',merchant:'Synthetic identical purchase',sourceName:'Synthetic identical purchase',amount:432.10,review:false,sourceMissingSince:'2026-10-27'},
  {...seed,id:'replacement',date:'2026-10-12',merchant:'Synthetic identical purchase',sourceName:'Synthetic identical purchase',amount:432.10,review:false,sourceMissingSince:null},
 ]};
 const duplicates=deriveDataset(duplicateSource),duplicateReport=summarizeReview(duplicates,'2026-10','month'),duplicateHealth=summarizeDataHealth(duplicates);
 assert.equal(duplicateReport.openFindings.length,1);assert.equal(duplicateHealth.possibleReplacements.length,1);assert.equal(duplicateHealth.accounting.length,0);
 let finding=null,auditOpened=false;
 const duplicateProps={...props(duplicates),onReview:id=>{finding=id;},onData:()=>{auditOpened=true;}};
 const duplicateMarkup=render(duplicateProps);assert.match(duplicateMarkup,/1 duplicate check/);assert.match(duplicateMarkup,/1 possible source replacement/);assert.doesNotMatch(duplicateMarkup,/2 (?:tasks|reviews|decisions)/,'Overlapping checks never become a fabricated combined count');
 const duplicateTree=capture(Overview,duplicateProps),checks=elements(duplicateTree).filter(node=>node.props.className==='workspace-attention-check');
 checks[0].props.onClick();assert.equal(finding,duplicateReport.openFindings[0].id);checks[1].props.onClick();assert.equal(auditOpened,true);
 let goalsOpened=false;elements(capture(Overview,{...props(),onGoals:()=>{goalsOpened=true;}})).find(node=>node.props.className==='workspace-fire-link').props.onClick();assert.equal(goalsOpened,true);
 const adjacentCurrency={...data,transactions:data.transactions.map(t=>t.review?{...t,merchant:'Synthetic flagged merchant 7 USD 9,876.54',sourceName:'Synthetic flagged merchant 7 USD 9,876.54'}:t)};
 assert.doesNotMatch(render(props(adjacentCurrency,'2026-10','month',true)),/9,876\.54/,'A number before a currency prefix cannot consume the prefix and leave its amount in visible text or ARIA');
 assert.deepEqual(data,before,'Presentation and action preparation never mutate source data or saved classifications');
}finally{await rm(temp,{recursive:true,force:true});}
console.log('Personal Overview passed: canonical period/history counts, exact historical editor actions, bounded pagination, separate duplicate/replacement checks, privacy, navigation and source-preserving slots.');
