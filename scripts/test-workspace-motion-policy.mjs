// Native policy/controller and actual hook tests; visual motion needs Chrome.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {bindWorkspaceMotionPolicy} from '../lib/workspace-motion-policy.ts';

function environment(){
 const mediaListeners=new Set(),visibilityListeners=new Set();
 const policy={matches:true,addEventListener(type,fn){assert.equal(type,'change');mediaListeners.add(fn);},removeEventListener(type,fn){assert.equal(type,'change');mediaListeners.delete(fn);}};
 const document={hidden:false,addEventListener(type,fn){assert.equal(type,'visibilitychange');visibilityListeners.add(fn);},removeEventListener(type,fn){assert.equal(type,'visibilitychange');visibilityListeners.delete(fn);}};
 const window={matchMedia(query){assert.equal(query,'(prefers-reduced-motion: no-preference) and (forced-colors: none)');return policy;}};
 return {window,document,policy,mediaListeners,visibilityListeners,media:()=>[...mediaListeners].forEach(fn=>fn()),visibility:()=>[...visibilityListeners].forEach(fn=>fn())};
}
const env=environment(),changes=[];
const dispose=bindWorkspaceMotionPolicy(env.window,env.document,value=>changes.push(value));
assert.deepEqual(changes,[true]);assert.equal(env.mediaListeners.size,1);assert.equal(env.visibilityListeners.size,1);
env.media();env.visibility();assert.deepEqual(changes,[true],'Repeated equivalent events cause no React state update');
env.policy.matches=false;env.media();assert.deepEqual(changes,[true,false],'Reduced motion or forced colors disables immediately');
env.document.hidden=true;env.visibility();env.policy.matches=true;env.media();assert.deepEqual(changes,[true,false],'A hidden tab stays disabled even when media permits motion');
env.document.hidden=false;env.visibility();assert.deepEqual(changes,[true,false,true]);
const stale=[...env.mediaListeners][0];dispose();assert.equal(env.mediaListeners.size,0);assert.equal(env.visibilityListeners.size,0);
env.policy.matches=false;stale();assert.deepEqual(changes,[true,false,true],'Disposed callbacks cannot update a later mount');
for(const window of [{},{matchMedia(){throw new Error('unavailable');}},{matchMedia(){return {matches:true};}}]){
 const blocked=[];bindWorkspaceMotionPolicy(window,env.document,value=>blocked.push(value))();assert.deepEqual(blocked,[false]);
}

// Run the real consumer hook. The provider owns lifecycle (covered in the
// background integration suite), so reading it must not create subscriptions.
const source=await readFile('app/workspace-preferences.tsx','utf8');
const ast=ts.createSourceFile('workspace-preferences.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const hook=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='useWorkspaceMotion');assert.ok(hook);
const js=ts.transpileModule(`const actual=${hook.getText(ast).replace(/^export /,'')};`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
let context={ready:false,preferences:{motion:'expressive'},motionPolicy:{ready:false,allowed:false}};
const scope={useWorkspacePreferences:()=>context};
const useMotion=new Function(...Object.keys(scope),js+';return actual;')(...Object.values(scope));
assert.deepEqual(useMotion(),{ready:false,allowed:false,enabled:false});
context.motionPolicy={ready:true,allowed:true};
assert.deepEqual(useMotion(),{ready:false,allowed:true,enabled:false},'Media readiness alone never starts motion before saved Quiet can load');
context={...context,ready:true,preferences:{motion:'quiet'}};assert.deepEqual(useMotion(),{ready:true,allowed:true,enabled:false},'Quiet preserves policy availability so Resume is usable');
context.preferences={motion:'expressive'};assert.deepEqual(useMotion(),{ready:true,allowed:true,enabled:true});
context.motionPolicy={ready:true,allowed:false};assert.deepEqual(useMotion(),{ready:true,allowed:false,enabled:false});
context.motionPolicy={ready:true,allowed:true};assert.equal(useMotion().enabled,true);
context.preferences={motion:'quiet'};assert.equal(useMotion().enabled,false,'Saved Quiet wins immediately, without a media event');
console.log('Workspace motion policy: initialization gate, Expressive/Quiet, native reduced-motion/forced-color policy, visibility, event deduplication, unavailable API fallback and listener cleanup passed.');
