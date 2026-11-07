// Actual controller and masthead, synthetic DOM/WAAPI only. Browser paint,
// font geometry and perceived brightness remain separate acceptance gates.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

class Events {
 listeners=new Map();
 addEventListener(type,callback){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(callback);}
 removeEventListener(type,callback){this.listeners.get(type)?.delete(callback);}
 emit(type){for(const callback of this.listeners.get(type)||[])callback();}
 count(){return [...this.listeners.values()].reduce((sum,list)=>sum+list.size,0);}
}
function fixture(){
 const document=new Events(),motion=new Events(),colors=new Events(),observers=[],animations=[];
 motion.matches=true;colors.matches=true;document.hidden=false;
 const fail=()=>assert.fail('Entry lighting must not schedule timers, RAF or network work');
 const view={matchMedia(query){if(query==='(prefers-reduced-motion: no-preference)')return motion;if(query==='(forced-colors: none)')return colors;assert.fail('Unexpected policy');},setTimeout:fail,setInterval:fail,requestAnimationFrame:fail,fetch:fail};
 document.defaultView=view;
 const root={ownerDocument:document,style:{},animate:()=>assert.fail('The wrapper/heading must never animate')};
 const surface=name=>({style:{},animate(keyframes,options){const animation={name,keyframes,options,cancelled:false,onfinish:null,cancel(){this.cancelled=true;}};animations.push(animation);return animation;}});
 const tube=surface('tube'),spill=surface('spill');
 view.IntersectionObserver=class {
  constructor(callback,options){this.callback=callback;this.options=options;observers.push(this);}
  observe(target){assert.equal(target,root);this.target=target;}
  disconnect(){this.disconnected=true;}
 };
 const entry=(patch={})=>({target:root,isIntersecting:true,intersectionRatio:1,boundingClientRect:{top:100,left:20,width:600,height:230},intersectionRect:{top:100,left:20,width:600,height:230},...patch});
 const deliver=(patch={},observer=observers.at(-1))=>observer?.callback([entry(patch)]);
 const count=()=>document.count()+motion.count()+colors.count();
 return {document,motion,colors,view,root,tube,spill,observers,animations,entry,deliver,count};
}

await mkdir('.sites-runtime',{recursive:true});
const directory=await mkdtemp(path.resolve('.sites-runtime/neon-entry-'));
try{
 const source=await readFile('app/neon-entry.tsx','utf8');
 const transpile=code=>ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 await writeFile(path.join(directory,'neon-entry.mjs'),transpile(source));
 const {bindNeonEntry,NeonEntryLight}=await import(pathToFileURL(path.join(directory,'neon-entry.mjs')).href);
 const bind=(env,memory={key:'overview',played:false},enabled=true,entryKey='overview')=>bindNeonEntry({root:env.root,tube:env.tube,spill:env.spill,entryKey,enabled,memory});
 const pristine=env=>{assert.deepEqual(env.root.style,{});assert.deepEqual(env.tube.style,{});assert.deepEqual(env.spill.style,{});};

 const first=fixture(),memory={key:'overview',played:false},dispose=bind(first,memory);
 assert.equal(first.animations.length,0,'Static markup is unchanged until a fresh visibility observation');
 assert.equal(first.count(),3);assert.deepEqual(first.observers[0].options.threshold,[0,0.25,0.5,0.75,1]);
 for(const patch of [
  {isIntersecting:false},{intersectionRatio:0.249},
  {boundingClientRect:{top:100,width:0,height:230}},
  {boundingClientRect:{top:100,width:600,height:0}},
  {intersectionRect:{top:100,width:0,height:230}},
  {intersectionRect:{top:100,width:600,height:0}},
  {intersectionRect:{top:102,width:600,height:180}},
 ])first.deliver(patch);
 assert.equal(first.animations.length,0,'A clipped top edge or less than one-quarter visibility leaves the ornament static');
 first.observers[0].callback([first.entry(),first.entry({isIntersecting:false})]);
 assert.equal(first.animations.length,0,'Latest matching observation determines visibility');
 first.observers[0].callback([first.entry({isIntersecting:false}),first.entry({intersectionRatio:0.25,intersectionRect:{top:101,width:600,height:58}}),{target:{},isIntersecting:false}]);
 assert.equal(first.animations.length,2);assert.equal(memory.played,true);
 assert.deepEqual(first.animations.map(item=>[item.name,item.options.duration,item.options.fill]),[['tube',560,'none'],['spill',800,'none']]);
 for(const animation of first.animations){assert.ok((animation.options.iterations??1)===1);assert.ok(animation.options.duration<=900);assert.equal(animation.options.delay??0,0);}
 first.deliver();assert.equal(first.animations.length,2,'Repeated observer notifications never replay');
 const finishers=first.animations.map(animation=>animation.onfinish);
 finishers[0]();assert.equal(first.count(),3,'Both independent ornaments must finish before normal teardown');
 finishers[1]();assert.equal(first.count(),0);assert.ok(first.animations.every(animation=>animation.cancelled));
 assert.ok(first.observers.every(observer=>observer.disconnected));
 dispose();dispose();first.deliver();assert.equal(first.animations.length,2);pristine(first);

 for(const reason of ['hidden','motion','colors','offscreen','clipped']){
  const env=fixture(),retained={key:'overview',played:false},cleanup=bind(env,retained);env.deliver();
  const staleFinish=env.animations[1].onfinish,staleObserver=env.observers[0];
  if(reason==='hidden'){env.document.hidden=true;env.document.emit('visibilitychange');}
  if(reason==='motion'||reason==='colors'){env[reason].matches=false;env[reason].emit('change');}
  if(reason==='offscreen')env.deliver({isIntersecting:false});
  if(reason==='clipped')env.deliver({intersectionRect:{top:104,width:600,height:226}});
  assert.ok(env.animations.every(animation=>animation.cancelled),reason);assert.equal(env.count(),0);assert.equal(retained.played,true);
  env.document.hidden=false;env.motion.matches=true;env.colors.matches=true;
  env.document.emit('visibilitychange');env.motion.emit('change');staleObserver.callback([env.entry()]);staleFinish();
  const sameEntry=bind(env,retained);env.deliver();assert.equal(env.animations.length,2,`${reason}: restoration or rebinding cannot replay a played entry`);
  sameEntry();cleanup();pristine(env);
 }

 // Hidden or blocked before playback: throw away the old IO generation and
 // wait for a new visibility reading instead of trusting stale geometry.
 const waiting=fixture(),waitingMemory={key:'overview',played:false},stopWaiting=bind(waiting,waitingMemory);
 const obsolete=waiting.observers[0];waiting.document.hidden=true;waiting.document.emit('visibilitychange');
 assert.equal(obsolete.disconnected,true);obsolete.callback([waiting.entry()]);assert.equal(waiting.animations.length,0);
 waiting.document.hidden=false;waiting.document.emit('visibilitychange');
 assert.equal(waiting.observers.length,2);obsolete.callback([waiting.entry()]);assert.equal(waiting.animations.length,0);
 waiting.deliver({intersectionRect:{top:110,width:600,height:200}});assert.equal(waiting.animations.length,0);
 waiting.deliver();assert.equal(waiting.animations.length,2);stopWaiting();assert.equal(waiting.count(),0);
 for(const blocked of ['motion','colors','hidden']){
  const env=fixture();if(blocked==='hidden')env.document.hidden=true;else env[blocked].matches=false;
  const close=bind(env);assert.equal(env.observers.length,0);assert.equal(env.animations.length,0);
  if(blocked==='hidden'){env.document.hidden=false;env.document.emit('visibilitychange');}else{env[blocked].matches=true;env[blocked].emit('change');}
  assert.equal(env.animations.length,0);env.deliver();assert.equal(env.animations.length,2,'First allowed entry requires fresh IO');close();
 }

 // Every partial registration/creation failure must release work already made.
 for(const capability of ['view','mediaMissing','mediaThrows','secondMediaThrows','motionAdd','colorsRemove','documentRemove','documentAddThrows','observerMissing','observerThrows','observeThrows','tubeMissing','spillMissing','tubeThrows','spillThrows']){
  const env=fixture(),retained={key:'overview',played:false};
  if(capability==='view')env.document.defaultView=null;
  if(capability==='mediaMissing')delete env.view.matchMedia;
  if(capability==='mediaThrows')env.view.matchMedia=()=>{throw new Error('synthetic media failure');};
  if(capability==='secondMediaThrows'){const original=env.view.matchMedia;env.view.matchMedia=query=>{if(query.includes('forced-colors'))throw new Error('synthetic second policy failure');return original(query);};}
  if(capability==='motionAdd')env.motion.addEventListener=undefined;
  if(capability==='colorsRemove')env.colors.removeEventListener=undefined;
  if(capability==='documentRemove')env.document.removeEventListener=undefined;
  if(capability==='documentAddThrows')env.document.addEventListener=()=>{throw new Error('synthetic registration failure');};
  if(capability==='observerMissing')delete env.view.IntersectionObserver;
  if(capability==='observerThrows')env.view.IntersectionObserver=class{constructor(){throw new Error('synthetic observer failure');}};
  if(capability==='observeThrows'){const Observer=env.view.IntersectionObserver;env.view.IntersectionObserver=class extends Observer{observe(){throw new Error('synthetic observe failure');}};}
  if(capability==='tubeMissing')delete env.tube.animate;
  if(capability==='spillMissing')delete env.spill.animate;
  if(capability==='tubeThrows')env.tube.animate=()=>{throw new Error('synthetic tube failure');};
  if(capability==='spillThrows')env.spill.animate=()=>{throw new Error('synthetic spill failure');};
  const close=bind(env,retained);env.deliver();
  assert.equal(env.count(),0,`${capability}: no partial listener registration survives`);
  assert.ok(env.animations.every(animation=>animation.cancelled),`${capability}: partial animation is cancelled`);
  assert.ok(env.observers.every(observer=>observer.disconnected),`${capability}: observer is disconnected`);
  const attempts=env.animations.length;env.deliver();assert.equal(env.animations.length,attempts,'Disposed callbacks never retry a failed binding');
  assert.equal(retained.played,false,'A failed pair does not claim a completed/started entry');close();close();pristine(env);
 }

 const strict=fixture(),strictMemory={key:'overview',played:false};
 const firstMount=bind(strict,strictMemory);firstMount();assert.equal(strictMemory.played,false);
 const secondMount=bind(strict,strictMemory);strict.observers[0].callback([strict.entry()]);assert.equal(strict.animations.length,0);
 strict.deliver();assert.equal(strict.animations.length,2,'StrictMode cleanup before asynchronous IO does not spend entry');secondMount();

 // Invoke the component's actual effect with its declared dependency list.
 // Privacy/date/data rerenders cannot subscribe or reset its remembered entry.
 const ast=ts.createSourceFile('neon-entry.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let effect,props;
 const walk=node=>{if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect')effect=node;if(ts.isTypeAliasDeclaration(node)&&node.name.text==='NeonEntryLightProps')props=node;ts.forEachChild(node,walk);};walk(ast);
 assert.ok(effect&&props);assert.deepEqual(props.type.members.map(member=>member.name.getText(ast)),['entryKey','enabled']);
 assert.equal(effect.arguments[1].getText(ast),'[entryKey, enabled]');
 const lifecycle=fixture(),memoryRef={current:{key:'overview',played:false}};
 const runEffect=new Function('rootRef','tubeRef','spillRef','memoryRef','entryKey','enabled','bindNeonEntry',transpile(`return (${effect.arguments[0].getText(ast)})();`));
 let last,cleanup,bindingCount=0;
 const render=({entryKey='overview',enabled=true,...ignored}={})=>{
  const deps=[entryKey,enabled];if(last&&deps.every((part,index)=>Object.is(part,last[index])))return;
  cleanup?.();last=deps;bindingCount++;
  cleanup=runEffect({current:lifecycle.root},{current:lifecycle.tube},{current:lifecycle.spill},memoryRef,entryKey,enabled,bindNeonEntry);
 };
 render({enabled:false});assert.equal(lifecycle.count(),0);assert.equal(lifecycle.observers.length,0);
 render();lifecycle.deliver();assert.equal(lifecycle.animations.length,2);
 render({hidden:true,date:'2026-10',data:{synthetic:true}});assert.equal(bindingCount,2);
 render({enabled:false});render();lifecycle.deliver();assert.equal(lifecycle.animations.length,2,'Quiet re-enable preserves played entry');
 render({entryKey:'goals',enabled:false});assert.equal(memoryRef.current.key,'goals');assert.equal(memoryRef.current.played,false);
 render({entryKey:'overview'});lifecycle.deliver();assert.equal(lifecycle.animations.length,4,'A → disabled B → A is a fresh route entry');
 cleanup();assert.equal(lifecycle.count(),0);assert.ok(lifecycle.animations.every(animation=>animation.cancelled));

 for(const enabled of [false,true]){
  const markup=renderToStaticMarkup(React.createElement(NeonEntryLight,{entryKey:'SYNTHETIC_KEY_DO_NOT_EMIT',enabled}));
  assert.equal((markup.match(/<span/g)||[]).length,3);assert.equal((markup.match(/aria-hidden="true"/g)||[]).length,3);
  assert.doesNotMatch(markup,/SYNTHETIC_KEY|tabindex|role=|aria-label|<button|<a\b|progress|loading/i);
 }
 // Real masthead integration: a full static native heading, with the two
 // isolated ornaments receiving only fixed variant/key/policy props.
 await writeFile(path.join(directory,'ambient-motion.mjs'),transpile(await readFile('app/ambient-motion.ts','utf8')));
 for(const name of ['workspace-scene','report-masthead']){
  let js=transpile(await readFile(`app/${name}.tsx`,'utf8'));
  js=js.replace(/(['"])\.\/(neon-entry|workspace-scene|ambient-motion)\1/g,(_,quote,module)=>`'./${module}.mjs'`);
  await writeFile(path.join(directory,`${name}.mjs`),js);
 }
 const {ReportMasthead}=await import(pathToFileURL(path.join(directory,'report-masthead.mjs')).href);
 for(const motif of ['overview','analysis','planning','records','terminal']){
  const reportProps={index:'05',family:'Synthetic family',title:'Your future, in focus',description:'Synthetic description',motif};
  const quiet=renderToStaticMarkup(React.createElement(ReportMasthead,{...reportProps,motionEnabled:false}));
  const expressive=renderToStaticMarkup(React.createElement(ReportMasthead,{...reportProps,motionEnabled:true}));
  assert.equal(expressive,quiet,'Initial and Quiet content is identical, complete and static');
  assert.equal((quiet.match(/<h1\b/g)||[]).length,1);assert.match(quiet,/<h1 class="report-masthead__title">Your future, in focus<\/h1>/);
  assert.doesNotMatch(quiet,/expressive-title|aria-busy|role="(?:progressbar|status)"/);
  assert.match(quiet,/class="neon-entry" aria-hidden="true"/);assert.match(quiet,new RegExp(`workspace-scene--${motif}`));
 }
 console.log('Neon entry passed: bounded two-layer timing, top-edge visibility, current IO generations, first activation/route memory, no same-entry replay, failure cleanup, real hook dependencies and static accessible mastheads. Browser paint remains separate.');
}finally{await rm(directory,{recursive:true,force:true});}
