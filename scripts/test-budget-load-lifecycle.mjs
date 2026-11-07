// Execute Budget's actual initial read effect; no HTTP or private fixtures.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {budgetPlanSchema} from '../lib/budget.ts';
const source=await readFile('app/budget.tsx','utf8');
const ast=ts.createSourceFile('budget.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let getter,effect;
function visit(node){
 if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='getPlan')getter=node.initializer;
 if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect'&&node.arguments[0]?.getText(ast).includes('getPlan(controller.signal)'))effect=node.arguments[0];
 ts.forEachChild(node,visit);
}
visit(ast);assert.ok(getter&&effect,'Budget has one cancellable initial read');
const bind=(node,scope)=>new Function(...Object.keys(scope),ts.transpileModule(`const actual=${node.getText(ast)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText+';return actual;')(...Object.values(scope));
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const updates=[];let initialSignal;
const getPlan=bind(getter,{budgetPlanSchema,fetch:async(url,options)=>{
 assert.equal(url,'/api/budget');assert.equal(options.cache,'no-store');initialSignal=options.signal;
 return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true}));
}});
const mount=bind(effect,{AbortController,getPlan,setStored:value=>updates.push(['stored',value]),setError:value=>updates.push(['error',value]),setLoaded:value=>updates.push(['loaded',value])});
const cleanup=mount();assert.equal(initialSignal.aborted,false);cleanup();assert.equal(initialSignal.aborted,true);await tick();
assert.deepEqual(updates,[],'Leaving Budget cancels the initial GET without later errors or state changes');
let directOptions;
const read=bind(getter,{budgetPlanSchema,fetch:async(url,options)=>{directOptions=options;return Response.json({plan:null});}});
assert.equal(await read(),null);assert.deepEqual(directOptions,{cache:'no-store'},'Explicit reload/save readback retains the original uncancelled request contract');
const successful=bind(effect,{AbortController,getPlan:read,setStored:value=>updates.push(['stored',value]),setError:value=>updates.push(['error',value]),setLoaded:value=>updates.push(['loaded',value])});
const finish=successful();await tick();assert.deepEqual(updates,[['stored',null],['error',''],['loaded',true]]);finish();
console.log('Budget initial load: actual GET is aborted on unmount; stale completion stays inert; reload/save readback stays unchanged.');
