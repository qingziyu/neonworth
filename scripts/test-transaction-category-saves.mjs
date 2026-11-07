// Execute the actual editor preview and save callback against canonical raw-source
// writes and derived readback. Synthetic data only; no HTTP or database access.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {createSavedStateCoordinator} from '../lib/saved-state-coordinator.ts';
import {deriveDataset} from '../lib/classification.ts';
import {canonicalTransactionReviewPatch,resolveTransactionReview} from '../lib/transaction-review.ts';
import {transactionCategoryEditorState} from '../lib/transaction-categories.ts';
import {summarize} from '../lib/finance.ts';

const page=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('page.tsx',page,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function bind(name,scope){
 let code;
 function visit(node){
  if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text===name)code=`const actual=${node.initializer.getText(ast)};`;
  if(ts.isFunctionDeclaration(node)&&node.name?.text===name)code=`${node.getText(ast)}\nconst actual=${name};`;
  ts.forEachChild(node,visit);
 }
 visit(ast);assert.ok(code,`The actual ${name} still exists`);
 const js=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 return new Function(...Object.keys(scope),`${js}\nreturn actual;`)(...Object.values(scope));
}
const account={id:'checking',name:'Synthetic checking',institution:'Synthetic',type:'depository',subtype:'checking',mask:'',balance:1000,netBalance:1000,balanceDate:null,balanceAgeKnown:false,syncStatus:'synced'};
const row={id:'synthetic',date:'2026-10-20',amount:20,merchant:'Synthetic merchant',sourceName:'Synthetic merchant',accountId:account.id,category:'Shopping',flow:'expense',review:false,note:'Original source note USD 350.00',pending:false,exceptional:false,confidence:'MEDIUM'};
function editor(source,override={},readbackTransform=value=>value){
 const dataset={version:1,asOf:'2026-10-25',syncedAt:'2026-10-25T20:00:00Z',dateRange:{start:'2026-10-01',end:'2026-10-25'},accounts:[account],transactions:[source],recurring:[],netWorthHistory:[],notes:[],coverage:{}};
 let durable={dataset,overrides:{[source.id]:override},settings:{},retirementOverrides:{},reviewPreferences:{findingResolutions:{},recurringStatuses:{}},refresh:null};
 const edit=deriveDataset(dataset,durable.overrides).transactions[0];
 const draft={category:edit.category,flow:edit.flow,note:override.note??source.note,review:edit.review,exceptional:edit.exceptional};
 const state={saved:structuredClone(durable),edit,draft,writes:[],notices:[],busy:false};
 const savedState=createSavedStateCoordinator();
 const preview=decision=>bind('reviewPreview',{edit,draft,editAccount:account,proposedReview:decision,resolveTransactionReview,useMemo:fn=>fn()});
 async function save(mode,decision=null){
  const reviewPreview=preview(decision);
  const callback=bind('saveEdit',{
   edit,draft,proposedReview:decision,reviewPreview,savedState,deriveDataset,
   changedTransactionPatch:bind('changedTransactionPatch',{}),
   savedTransactionNote:bind('savedTransactionNote',{saved:state.saved}),
   setEditFeedback(){},setError(){},setReviewChoice(){},
   setBusy:value=>{state.busy=value;},setSaved:value=>{state.saved=value;},setEdit:value=>{state.edit=value;},setDraft:value=>{state.draft=value;},
   tell:value=>state.notices.push(value),reviewDecisionLabel:value=>value,
   fetch:async(url,options)=>{
    assert.equal(url,'/api/preferences');assert.equal(options.method,'POST');
    const body=JSON.parse(options.body);state.writes.push(body);
    const patch=canonicalTransactionReviewPatch(source,account,body.patch,durable.overrides[source.id]);
    durable={...durable,overrides:{...durable.overrides,[source.id]:{...durable.overrides[source.id],...patch}}};
    return Response.json({success:true,override:durable.overrides[source.id]});
   },
   readSavedDashboard:async()=>readbackTransform(structuredClone(durable)),
  });
  await callback(mode);
  return deriveDataset(state.saved.dataset,state.saved.overrides).transactions[0];
 }
 return {state,edit,draft,preview,save};
}

const inferred=editor({...row,merchant:'OpenAI',sourceName:'OpenAI',category:'Other'}, {review:true});
assert.equal(inferred.edit.category,'Services','The fixture genuinely differs between raw and derived category');
const displayed=inferred.preview('expense');
assert.equal(displayed.category,'Services');
const inferredSaved=await inferred.save('apply','expense');

const direct=editor(row);direct.draft.category='Travel';direct.draft.flow='transfer';
const directDisplay=transactionCategoryEditorState(direct.edit,account,direct.draft.category,direct.draft.flow);
const directSaved=await direct.save('changes');
const inferredDirect=editor({...row,merchant:'OpenAI',sourceName:'OpenAI',category:'Other'});
inferredDirect.draft.category='Travel';inferredDirect.draft.flow='transfer';
const inferredDirectDisplay=transactionCategoryEditorState(inferredDirect.edit,account,inferredDirect.draft.category,inferredDirect.draft.flow);
const inferredDirectSaved=await inferredDirect.save('changes');

const customResults=[];
for(const category of ['Income tax','Transfer fees','Payroll service'])for(const decision of ['expense','purchase_refund']){
 const h=editor({...row,category,amount:decision==='expense'?20:-20},{review:true});
 const preview=h.preview(decision),saved=await h.save('apply',decision);
 const summary=summarize(deriveDataset(h.state.saved.dataset,h.state.saved.overrides),'2026-10');
 assert.equal(saved.flow,'expense');assert.equal(saved.amount,decision==='expense'?20:-20);
 assert.equal(summary.spending,saved.amount);assert.equal(summary.income,0,'A custom category name does not become an income signal');
 assert.equal(summary.categories[0]?.value,saved.amount);
 customResults.push({category,decision,preview:preview.category,saved:saved.category});
}
// Report compact synthetic observations before assertions so every reproduced
// failure is visible, even when an earlier regression stops the script.
console.log(JSON.stringify({inferred:{preview:displayed.category,saved:inferredSaved.category},direct:{displayed:directDisplay.displayedCategory,saved:directSaved.category,patch:direct.state.writes[0].patch},inferredDirect:{displayed:inferredDirectDisplay.displayedCategory,saved:inferredDirectSaved.category},custom:customResults}));
assert.equal(inferredSaved.category,displayed.category,'Apply must persist the exact category shown from the derived row');
assert.equal(inferred.state.writes[0].patch.category,displayed.category,'Apply explicitly carries the accepted preview category to raw-source canonicalization');
assert.equal(inferredSaved.review,false);assert.equal(inferredSaved.amount,row.amount);
assert.equal(inferredSaved.note,row.note);assert.equal(inferred.state.edit,null);
const unexpected=editor({...row,merchant:'OpenAI',sourceName:'OpenAI',category:'Other'},{review:true},value=>({...value,overrides:{...value.overrides,[row.id]:{...value.overrides[row.id],category:'Other'}}}));
await unexpected.save('apply','expense');
assert.equal(unexpected.state.writes.length,1,'A mismatched readback does not retry the write');
assert.notEqual(unexpected.state.edit,null,'A mismatched category does not close the editor as successful');
assert.match(unexpected.state.notices.at(-1),/category differs from the preview/);
assert.equal(directSaved.category,directDisplay.displayedCategory,'An inactive category draft must not be silently saved');
assert.equal(inferredDirectSaved.category,inferredDirectDisplay.displayedCategory,'A direct flow change retains the visible category even when it was derived from source evidence');
assert.deepEqual(direct.state.writes[0].patch,{flow:'transfer',category:'Shopping'});
for(const result of customResults){assert.equal(result.preview,result.category);assert.equal(result.saved,result.category);}

const noteOnly=editor({...row,merchant:'OpenAI',sourceName:'OpenAI',category:'Other'},{review:true});
noteOnly.draft.category='Travel';noteOnly.draft.note='New note, unrelated to category';
const noted=await noteOnly.save('note','expense');
assert.deepEqual(noteOnly.state.writes[0].patch,{note:noteOnly.draft.note},'Save note only remains sparse even with category and treatment drafts');
assert.equal(noted.review,true);assert.equal(noted.category,'Services');
const selected=editor(row);selected.draft.category='Travel';
const selectedSaved=await selected.save('changes');
assert.deepEqual(selected.state.writes[0].patch,{category:'Travel'});assert.equal(selectedSaved.category,'Travel');
const switched=editor(row);switched.draft.category='Travel';switched.draft.flow='transfer';
assert.equal(transactionCategoryEditorState(switched.edit,account,switched.draft.category,'transfer').displayedCategory,'Shopping');
switched.draft.flow='expense';assert.equal((await switched.save('changes')).category,'Travel','Switching back before save preserves the draft');
for(const category of ['Review','Review · unresolved purpose','Income','Payroll','Salary','Amazon employer income','Transfer','Transfers','Zelle movement','Non-income credit · Interest','income_salary']){
 const resolved=resolveTransactionReview({...row,category},account,'expense');
 assert.equal(resolved.category,'Other',`Accounting placeholder ${category} is still excluded from expense categories`);
}
console.log('Actual category preview/save callbacks passed: raw-versus-derived Apply, inactive direct-flow drafts, meaningful custom prefixes, note-only sparse writes, and category readback.');
