// Synthetic UI and canonical-save coverage; no network or private records.
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {spendingCategoryChoices,transactionCategoryOptions,transactionCategoryEditorState} from '../lib/transaction-categories.ts';
import {canonicalTransactionReviewPatch,resolveTransactionReview} from '../lib/transaction-review.ts';
import {deriveDataset} from '../lib/classification.ts';

const account={id:'checking',name:'Synthetic checking',institution:'Synthetic',type:'depository',subtype:'checking',mask:'',balance:1000,netBalance:1000,balanceDate:null,balanceAgeKnown:false,syncStatus:'synced'};
const row={id:'synthetic-expense',date:'2026-10-20',amount:120,merchant:'Synthetic merchant',sourceName:'Synthetic merchant',accountId:account.id,category:'Legacy / custom category',flow:'expense',review:false,note:'Original context USD 350.00',pending:false,exceptional:false,confidence:'HIGH'};
const dataset=transactions=>({version:1,asOf:'2026-10-25',syncedAt:'2026-10-25T20:00:00Z',dateRange:{start:'2026-10-01',end:'2026-10-25'},accounts:[account],transactions,recurring:[],netWorthHistory:[],notes:[],coverage:{}});
const state=(transaction,value=transaction.category,preview=null)=>transactionCategoryEditorState(transaction,account,value,transaction.flow,preview);
assert.equal(spendingCategoryChoices.length,new Set(spendingCategoryChoices).size);
for(const category of ['Housing','Groceries','Dining & coffee','Travel','Education','Digital spending','Other'])assert.ok(spendingCategoryChoices.includes(category));
const options=transactionCategoryOptions(row.category,'Travel');
assert.ok(options.some(option=>option.value===row.category),'The exact saved category remains available after selecting another option');
assert.ok(transactionCategoryOptions('shopping','Shopping').some(option=>option.value==='shopping'),'Legacy spelling is not silently normalized');

// Exercise the real sparse-patch helper used by Save changes.
const page=await readFile('app/page.tsx','utf8');
const pageAst=ts.createSourceFile('page.tsx',page,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const patchNode=pageAst.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='changedTransactionPatch');
assert.ok(patchNode);
const patchJs=ts.transpileModule(patchNode.getText(pageAst),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const changedTransactionPatch=new Function(`${patchJs};return changedTransactionPatch;`)();
assert.deepEqual(changedTransactionPatch({...row,note:'Dinner with friends'},row,row.note),{note:'Dinner with friends'},'A note edit never infers a category');

for(const [decision,amount] of [['expense',120],['purchase_refund',-75]]){
 const source={...row,amount,category:'Review',flow:'review',review:true};
 const preview={...source,...resolveTransactionReview(source,account,decision)};
 const control=state(source,'Review',preview);
 assert.equal(control.displayedCategory,preview.category,'The visible selection agrees with the category Apply will save');
 assert.equal(control.options.find(option=>option.value==='Review').disabled,true,'An incompatible saved placeholder remains visible but cannot be reselected');
 const draft={category:'Travel',flow:source.flow,note:source.note,review:true,exceptional:false};
 const selectedPreview={...source,...resolveTransactionReview({...source,category:draft.category},account,decision)};
 assert.equal(state(source,draft.category,selectedPreview).displayedCategory,'Travel');
 const patch={...changedTransactionPatch(draft,source,source.note),note:draft.note,reviewDecision:decision,review:false};
 const canonical=canonicalTransactionReviewPatch(source,account,patch);
 const before=structuredClone(source),readback=deriveDataset(dataset([source]),{[source.id]:canonical}).transactions[0];
 assert.equal(readback.category,'Travel');assert.equal(readback.reviewDecision,decision);assert.equal(readback.review,false);
 assert.equal(readback.flow,'expense');assert.equal(readback.amount,amount);assert.equal(readback.note,source.note);assert.deepEqual(source,before);
 const custom='Legacy / custom category';
 const customPatch=canonicalTransactionReviewPatch(source,account,{category:custom,reviewDecision:decision,review:false});
 assert.equal(deriveDataset(dataset([source]),{[source.id]:customPatch}).transactions[0].category,custom,'Explicit custom expense/refund categories survive canonical readback');
}
for(const source of [{...row,review:true,note:'Owner explicitly flagged this expense'},{...row,category:'Review',flow:'review',review:true,note:'Unresolved source purpose'}]){
 const patch=changedTransactionPatch({category:'Travel',flow:source.flow,review:true,note:source.note,exceptional:false},source,source.note);
 assert.deepEqual(patch,{category:'Travel'});
 const canonical=canonicalTransactionReviewPatch(source,account,patch);
 const readback=deriveDataset(dataset([source]),{[source.id]:canonical}).transactions[0];
 assert.equal(readback.review,true,'Changing category alone cannot clear an explicit accounting review');
 assert.equal(readback.flow,source.flow);assert.equal(readback.reviewDecision,undefined);
}
const fixed={...row,flow:'transfer',category:'Transfers',reviewDecision:'transfer'};
assert.equal(state(fixed).editable,false);
const transferPreview={...row,...resolveTransactionReview(row,account,'transfer')};
assert.equal(state(row,'Travel',transferPreview).displayedCategory,'Transfers');
assert.equal(state(row,'Travel').displayedCategory,'Travel','Switching treatment back restores the unmodified category draft');
const apple={...row,merchant:'Apple Card payment',sourceName:'Apple Card payment',category:'Digital spending',spendingProxy:{kind:'unlinked_apple_card',basis:'payment-date'}};
assert.equal(state(apple).editable,false,'The existing Apple payment policy is not presented as an editable category');

// Verify the actual native control and its handlers, not a mirror component.
const dir=await mkdtemp(path.resolve('.sites-runtime/category-render-'));
try{
 const source=await readFile('app/transaction-category-selector.tsx','utf8');
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/(['"])@\/lib\/([^'"]+)\1/g,(_,quote,name)=>JSON.stringify(pathToFileURL(path.resolve(`lib/${name}.ts`)).href));
 await writeFile(path.join(dir,'selector.mjs'),js);
 const Selector=(await import(pathToFileURL(path.join(dir,'selector.mjs')).href)).default;
 const calls=[],props={transaction:row,account,value:row.category,flow:row.flow,hidden:false,busy:false,onChange:value=>calls.push(value)};
 const render=extra=>renderToStaticMarkup(React.createElement(Selector,{...props,...extra}));
 const elements=node=>React.isValidElement(node)?[node,...React.Children.toArray(node.props.children).flatMap(elements)]:[];
 const native=extra=>elements(Selector({...props,...extra})).find(node=>node.type==='select');
 const markup=render({});
 assert.match(markup,/<label>Category<select/);assert.doesNotMatch(markup,/<input|<datalist/);
 assert.match(markup,/<option value="Legacy \/ custom category" selected="">/);
 assert.match(markup,/aria-describedby="transaction-category-help"/);
 assert.deepEqual(calls,[],'Opening the editor does not save or select anything');
 native({}).props.onChange({target:{value:'Travel'}});assert.deepEqual(calls,['Travel'],'A native change updates only the draft callback');
 native({busy:true}).props.onChange({target:{value:'Shopping'}});assert.deepEqual(calls,['Travel']);
 native({}).props.onChange({target:{value:'Unlisted new category'}});assert.deepEqual(calls,['Travel']);
 assert.match(render({busy:true}),/<select[^>]*disabled=""/);
 const unresolved={...row,category:'Review',flow:'review',review:true};
 const expensePreview={...unresolved,...resolveTransactionReview(unresolved,account,'expense')};
 const proposed={transaction:unresolved,value:'Review',flow:'review',preview:expensePreview};
 assert.match(render(proposed),/<option value="Other" selected="">/);
 assert.match(render(proposed),/<option value="Review" disabled="">/);
 native(proposed).props.onChange({target:{value:'Review'}});assert.deepEqual(calls,['Travel']);
 for(const transaction of [fixed,apple,{...row,flow:'income',category:'Amazon employer income'}]){
  const html=render({transaction,flow:transaction.flow,value:transaction.category});
  assert.doesNotMatch(html,/<select/);assert.ok(html.includes(transaction.category));
 }
 const sensitive={...row,category:'Synthetic USD 350.00 / $ 420.00 / 510.00 credit'};
 const hidden=render({transaction:sensitive,value:sensitive.category,hidden:true});
 assert.doesNotMatch(hidden,/350|420|510|<select|<option/);assert.match(hidden,/Synthetic/);assert.match(hidden,/Show amounts to change/);
 assert.equal(sensitive.category,'Synthetic USD 350.00 / $ 420.00 / 510.00 credit','Privacy never rewrites the raw draft');
 assert.match(render({transaction:sensitive,value:sensitive.category}),/350\.00/,'Showing amounts restores the original option');
 // Integration: the real editor mounts the selector outside every disclosure.
 let mounted=0;
 function visit(node,insideDetails=false){
  const detail=ts.isJsxElement(node)&&node.openingElement.tagName.getText(pageAst)==='details';
  if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(pageAst)==='TransactionCategorySelector'){mounted++;assert.equal(insideDetails,false);}
  ts.forEachChild(node,child=>visit(child,insideDetails||detail));
 }
 visit(pageAst);assert.equal(mounted,1);
}finally{await rm(dir,{recursive:true,force:true});}
console.log('Transaction categories: visible native selector, exact legacy options, canonical expense/refund readback, review flags, fixed treatment, privacy and sparse drafts passed. Browser keyboard/responsive checks are separate.');
