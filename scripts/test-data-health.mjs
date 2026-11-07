import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {summarizeDataHealth} from '../lib/data-health.ts';
import {financialReviewFixture} from './test-support/financial-review-fixture.mjs';
const d=financialReviewFixture().dataset;
d.notes.push('200 transactions require review.');
const t=d.transactions.find(t=>t.id==='large-purchase');
t.sourceMissingSince='2026-10-27';t.merchant='Synthetic merchant USD 9,876.54 and $ 123.45 and 350.00credit';
const before=structuredClone(d),report=summarizeDataHealth(d);
assert.equal(report.accounting.length,0,'Stale prose creates no accounting task');
assert.equal(report.retained.length,1);assert.equal(report.possibleReplacements.length,0);
assert.deepEqual(d,before,'Audit preserves source fields, amounts, notes and coverage');
const replacementCase=(retainedPatch={},currentPatch={})=>({...d,transactions:[
 {...t,id:'retained-transfer',amount:-Math.abs(t.amount),flow:'transfer',category:'Transfers',review:false,sourceMissingSince:'2026-10-27',...retainedPatch},
 {...t,id:'current-transfer',amount:-Math.abs(t.amount),flow:'transfer',category:'Transfers',review:false,sourceMissingSince:null,...currentPatch},
]});
const transferCase=replacementCase(),transferBefore=structuredClone(transferCase),transferReport=summarizeDataHealth(transferCase);
assert.equal(transferReport.possibleReplacements.length,0,'Reconciled transfer-only matches create no accounting task');
assert.equal(transferReport.neutralReplacements.length,1);assert.equal(transferReport.accounting.length,0);
assert.deepEqual(transferReport.retained[0].candidates.map(t=>t.id),['current-transfer'],'Optional matches remain available as original evidence');
assert.equal(transferReport.neutralReplacements[0],transferReport.retained[0]);
assert.deepEqual(transferCase,transferBefore,'Neither matching nor neutral treatment deduplicates or changes source rows');
for(const [retainedPatch,currentPatch]of [[{review:true},{}],[{},{review:true}],[{flow:'review'},{}],[{},{flow:'review'}],[{flow:'expense'},{}],[{},{flow:'expense'}],[{flow:'income'},{}],[{},{flow:'income'}]]){
 const material=summarizeDataHealth(replacementCase(retainedPatch,currentPatch));
 assert.equal(material.possibleReplacements.length,1,'A counted or explicitly flagged record on either side keeps the replacement actionable');
 assert.equal(material.neutralReplacements.length,0);
}
for(const [retainedPatch,currentPatch]of [[{flow:'income',incomePolicyExcluded:true},{}],[{},{flow:'income',incomePolicyExcluded:true}]]){
 const excluded=summarizeDataHealth(replacementCase(retainedPatch,currentPatch));
 assert.equal(excluded.possibleReplacements.length,0,'Income excluded by the saved policy is not counted income');
 assert.equal(excluded.neutralReplacements.length,1);
}
assert.equal(summarizeDataHealth(replacementCase({flow:'income',incomePolicyExcluded:true,review:true})).possibleReplacements.length,1,'An explicit flag still wins on excluded income');
assert.equal(summarizeDataHealth(replacementCase({flow:'expense',incomePolicyExcluded:true})).possibleReplacements.length,1,'An income-only exclusion does not remove counted expense/refund spending');
const historical={...t,id:'historical-flag',date:'2025-10-08',sourceMissingSince:null,flow:'review',review:true};
d.transactions.push(historical,{...historical,id:'pending',pending:true},{...historical,id:'future',date:'2026-11-02'},{...historical,id:'zelle-flag',merchant:'Zelle from someone',sourceName:'Zelle from someone'});
assert.deepEqual(summarizeDataHealth(d).accounting.map(t=>t.id),['historical-flag','zelle-flag'],'Whole-snapshot scope keeps earlier genuine flags but excludes future, pending and isolated Zelle');
const replacement={...t,id:'replacement',sourceMissingSince:null};d.transactions.push(replacement);
assert.deepEqual(summarizeDataHealth(d).possibleReplacements[0].candidates.map(t=>t.id),['replacement'],'Same source facts with a different ID require investigation, never automatic deletion');
replacement.accountId='later-card';assert.equal(summarizeDataHealth(d).possibleReplacements.length,0,'Amount/date/merchant alone across accounts do not establish a replacement');
replacement.accountId=t.accountId;replacement.date='2026-07-03';assert.equal(summarizeDataHealth(d).possibleReplacements.length,0);
t.sourceMissingSince=null;assert.equal(summarizeDataHealth(d).retained.length,0,'Current source state supersedes historical refresh reports');
t.sourceMissingSince='not-a-date';assert.equal(summarizeDataHealth(d).retained.length,0,'Malformed source markers do not establish a dated omission');
t.sourceMissingSince='2026-10-27';
const dir=await mkdtemp(path.resolve('.sites-runtime/data-health-render-'));
try {
 let js=ts.transpileModule(await readFile('app/data-health.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 js=js.replace(/(['"])@\/([^'"]+)\1/g,(_,q,s)=>JSON.stringify(pathToFileURL(path.resolve(s+'.ts')).href));
 await writeFile(path.join(dir,'data-health.mjs'),js);const {default:DataHealth}=await import(pathToFileURL(path.join(dir,'data-health.mjs')).href);
 const render=hidden=>renderToStaticMarkup(React.createElement(DataHealth,{data:d,hidden,onEdit(){}}));
 const visible=render(false),hidden=render(true);
 assert.match(visible,/1 earlier record retained/);assert.match(visible,/Retention is an audit note, not a confirmation request/);
 assert.match(visible,/2 records with unresolved financial treatment/);assert.doesNotMatch(visible,/200 transactions require review/);
 assert.doesNotMatch(hidden,/9,876\.54|123\.45|350\.00|2,400\.01/,'Merchant and direct monetary amounts stay masked');
 const duplicateOnly=structuredClone(d);duplicateOnly.transactions=duplicateOnly.transactions.filter(t=>!t.review);duplicateOnly.transactions.find(t=>t.id==='replacement').date=t.date;const duplicateMarkup=renderToStaticMarkup(React.createElement(DataHealth,{data:duplicateOnly,hidden:false,onEdit(){}}));assert.match(duplicateMarkup,/possible source replacements/);assert.doesNotMatch(duplicateMarkup,/No unresolved accounting records/,'An unflagged replacement candidate prevents the all-clear');
 assert.match(hidden,/Freshness|freshness/);assert.match(hidden,/completeness remain unknown/);
 assert.doesNotMatch(visible,/<details[^>]*\bopen(?:\s|=|>)/,'Historical evidence and unresolved detail lists start collapsed');
 let archiveJS=ts.transpileModule(await readFile('app/historical-source-notes.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/(['"])@\/([^'"]+)\1/g,(_,q,s)=>JSON.stringify(pathToFileURL(path.resolve(s+'.ts')).href));
 await writeFile(path.join(dir,'archive.mjs'),archiveJS);const {default:Archive}=await import(pathToFileURL(path.join(dir,'archive.mjs')).href);
 const notes=['Old import: USD 9,876.54 and $ 123.45. 12 records required review.'];const original=structuredClone(notes);
 const archived=renderToStaticMarkup(React.createElement(Archive,{notes,hidden:true}));assert.doesNotMatch(archived,/9,876\.54|123\.45/);assert.match(archived,/Historical source context/);assert.match(archived,/earlier rules, counts or source dates/);assert.deepEqual(notes,original);
} finally {await rm(dir,{recursive:true,force:true});}
console.log('Data health: current full-history flags, retained-source reconciliation, replacement candidates, stale prose isolation, immutable records and masked rendering verified.');
