import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transactionEditorState} from '../lib/transaction-editor.ts';
import {eligibleReviewDecisions} from '../lib/transaction-review.ts';
const account={id:'checking',name:'Synthetic checking',type:'depository',subtype:'checking'};
const row={id:'repayment',date:'2026-10-20',amount:1200,merchant:'Synthetic card payment',sourceName:'Synthetic card payment',accountId:'checking',category:'Card repayment',flow:'transfer',review:false,note:'Transfer to credit card',pending:false,exceptional:false,movementClassification:{kind:'card_repayment',reason:'Synthetic source evidence'}};
const state=(t,note=t.note,choice=null,changing=false)=>transactionEditorState(t,account,note,t.note,choice,changing);
for(const t of [row,{...row,flow:'expense',category:'Other',categoryReviewOptional:true,note:'Expense counted using the stored category; review its category.'},{...row,amount:-50,flow:'expense',refundInference:{purchaseId:'purchase',reason:'Synthetic matched credit'}},{...row,reviewDecision:'transfer'}]){
 const before=structuredClone(t),s=state(t);assert.equal(s.required,false);assert.equal(s.active,false);assert.equal(s.suggestion,null);assert.equal(s.proposed,null);assert.deepEqual(t,before);
 assert.equal(state(t,'Transfer to credit card: newly typed context').active,false,'A note edit alone does not require an accounting change');
}
assert.equal(state({...row,review:true}).required,true,'An explicit flag remains actionable');
assert.equal(state({...row,flow:'review',review:false}).active,true,'Unclassified accounting remains actionable');
assert.equal(state(row,row.note,null,true).proposed,'transfer','Explicitly changing treatment enables the suggestion');
assert.equal(state(row,row.note,'',true).proposed,null,'The user can clear an automatic suggestion');
assert.equal(state({...row,reviewDecision:'transfer'}).directFlowEdit,false,'A saved semantic decision cannot be silently contradicted by a raw flow-only edit');
assert.equal(state({...row,reviewDecision:'transfer'},row.note,'expense',true).proposed,'expense','A deliberate replacement submits a new semantic decision');
const stale={...row,note:'Possible card payment; confirm before including in any economic total.'};
assert.equal(state(stale).displayedNote,'');assert.equal(state(stale).hasHistoricalNote,true);assert.equal(stale.note,'Possible card payment; confirm before including in any economic total.','Raw source note is retained');
assert.equal(state(stale,'My edited context').displayedNote,'My edited context');
assert.equal(state({...stale,review:true}).displayedNote,stale.note,'Unresolved source context stays visible');
const dir=await mkdtemp(path.resolve('.sites-runtime/editor-render-'));
try{
 const source=await readFile('app/transaction-accounting-status.tsx','utf8');
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText.replaceAll("'@/lib/transaction-review'",JSON.stringify(pathToFileURL(path.resolve('lib/transaction-review.ts')).href));
 await writeFile(path.join(dir,'status.mjs'),js);const ui=await import(pathToFileURL(path.join(dir,'status.mjs')).href);
 const render=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));
 assert.match(render(ui.default,{transaction:row}),/Reconciled/);assert.match(render(ui.default,{transaction:row}),/No review needed/);
 assert.match(render(ui.default,{transaction:{...row,review:true}}),/Accounting decision needed/);
 const props={...state(row),options:eligibleReviewDecisions(row,account),busy:false,onChange(){}};
 assert.equal(render(ui.TransactionTreatmentSelector,props),'','Settled transaction renders no review selector');
 assert.match(render(ui.TransactionTreatmentSelector,{...props,...state({...row,review:true})}),/Review treatment/);
 const correction=render(ui.TransactionTreatmentSelector,{...props,...state(row,row.note,null,true),busy:true});assert.match(correction,/New accounting treatment/);assert.match(correction,/disabled/);assert.doesNotMatch(correction,/Review treatment/);
}finally{await rm(dir,{recursive:true,force:true});}
console.log('Transaction editor: resolved rows need no review, explicit corrections and true flags retain treatment controls, raw notes preserved, busy selector disabled.');
