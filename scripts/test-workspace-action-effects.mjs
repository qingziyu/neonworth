// Actual controller/component with synthetic native events and WAAPI handles.
// Paint, responsive geometry and real keyboard focus remain Chrome gates.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

class Events{
 listeners=new Map();
 addEventListener(type,callback,capture=false){
  if(!this.listeners.has(type))this.listeners.set(type,new Map());
  this.listeners.get(type).set(callback,capture);
 }
 removeEventListener(type,callback,capture=false){
  assert.equal(this.listeners.get(type)?.get(callback),capture,'Removal preserves listener capture mode');
  this.listeners.get(type)?.delete(callback);
 }
 emit(type,event={}){for(const callback of this.listeners.get(type)?.keys()||[])callback(event);}
 count(){return [...this.listeners.values()].reduce((sum,callbacks)=>sum+callbacks.size,0);}
}
const actionSelector='.workspace-fire-link,.signal-action,.budget-tabs button,.review-view-toolbar button,.fire-heading .text-link';
const sheenSelector='.workspace-fire-link,.signal-action';
function fixture(){
 const container=new Events(),document=new Events(),policy=new Events(),animations=[],sheens=[],observers=[];
 const fail=()=>assert.fail('Action decoration must not schedule timers or animation frames');
 const view=Object.assign(new Events(),{innerWidth:1024,innerHeight:768,matchMedia(query){assert.equal(query,'(prefers-reduced-motion: no-preference) and (forced-colors: none)');return policy;},setTimeout:fail,setInterval:fail,requestAnimationFrame:fail,IntersectionObserver:class{
  targets=new Set();constructor(callback){this.callback=callback;observers.push(this);}observe(target){this.targets.add(target);}disconnect(){this.targets.clear();}
 }});
 policy.matches=true;document.hidden=false;document.defaultView=view;container.ownerDocument=document;
 const action={nodeType:1,isConnected:true,inside:true,disabled:false,inert:false,rect:{left:100,top:200,right:220,bottom:244,width:120,height:44},style:{},getBoundingClientRect(){return this.rect;},matches(selector){assert.equal(selector,':disabled,[aria-disabled="true"]');return this.disabled;},closest(selector){assert.equal(selector,'[inert]');return this.inert?{}:null;}};
 container.contains=node=>node===action&&node.inside;
 const target={nodeType:1,closest(selector){assert.ok(selector===actionSelector||selector===sheenSelector);return (selector===actionSelector?this.selected:this.sheenSelected)?action:null;},selected:true,sheenSelected:true};
 action.contains=node=>node===action||node===target||node.parentAction===action;
 const sheen={style:{},animate(keyframes,options){const animation={keyframes,options,cancelled:false,cancel(){this.cancelled=true;}};sheens.push(animation);return animation;}};
 action.querySelector=selector=>{assert.equal(selector,'.workspace-action-sheen');return action.missingSheen?null:sheen;};
 const burst={style:{},children:Array.from({length:6},()=>({style:{},animate(keyframes,options){
  const animation={keyframes,options,cancelled:false,cancel(){this.cancelled=true;}};
  animations.push(animation);return animation;
 }}))};
 const click=(changes={})=>container.emit('click',{target,button:0,detail:1,clientX:150,clientY:215,preventDefault(){assert.fail('Decoration must not delay native activation');},stopPropagation(){assert.fail('Decoration must not intercept activation');},...changes});
 const enter=(type='pointerover',changes={})=>container.emit(type,{type,target,relatedTarget:null,pointerType:'mouse',...changes});
 return {container,document,policy,view,action,target,burst,animations,click,sheen,sheens,observers,enter};
}

await mkdir('.sites-runtime',{recursive:true});
const dir=await mkdtemp(path.resolve('.sites-runtime/workspace-action-effects-'));
try{
 const source=await readFile('app/workspace-action-effects.tsx','utf8');
 assert.doesNotMatch(source,/\b(?:setTimeout|setInterval|requestAnimationFrame)\s*\(/,'No ambient JS scheduling is introduced');
 await writeFile(path.join(dir,'actions.mjs'),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText);
 const {default:WorkspaceActionEffects,bindActionBurst,bindActionSheen}=await import(pathToFileURL(path.join(dir,'actions.mjs')).href);
 const env=fixture(),dispose=bindActionBurst(env.container,env.burst);
 assert.equal(env.container.count(),1);assert.equal([...env.container.listeners.get('click').values()][0],true);
 assert.equal(env.policy.count(),1);assert.equal(env.document.count(),2);assert.equal(env.view.count(),1);assert.equal(env.animations.length,0,'Mount alone produces no animation');
 env.target.selected=false;env.click();env.target.selected=true;
 env.action.inside=false;env.click();env.action.inside=true;
 env.action.disabled=true;env.click();env.action.disabled=false;
 env.action.inert=true;env.click();env.action.inert=false;
 for(const event of [{button:1},{button:2},{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},{target:null}])env.click(event);
 const rect=env.action.rect;env.action.rect={...rect,width:0};env.click();env.action.rect=rect;
 const animate=env.burst.children[0].animate;env.burst.children[0].animate=undefined;env.click();env.burst.children[0].animate=animate;
 assert.equal(env.animations.length,0,'Only enabled, visible selected actions with native animation capability activate');
 env.click();
 assert.equal(env.animations.length,6);assert.equal(env.burst.style.left,'150px');assert.equal(env.burst.style.top,'215px');assert.equal(env.burst.style.visibility,'visible');
 for(const [index,animation] of env.animations.entries()){
  assert.deepEqual(animation.options,{duration:420,easing:'cubic-bezier(.16,1,.3,1)',iterations:1});
  assert.equal(animation.keyframes.length,3);assert.equal(animation.keyframes[0].opacity,0);assert.equal(animation.keyframes.at(-1).opacity,0);
  assert.match(animation.keyframes.at(-1).transform,new RegExp(`^rotate\\(${index*60}deg\\) translateX\\(64px\\) scaleX\\(\\.2\\)$`));
 }
 const firstBatch=env.animations.slice(),staleFinish=firstBatch.at(-1).onfinish;
 // Native keyboard-generated click has detail=0 and activates the center,
 // independent of the usually zero keyboard client coordinates.
 env.click({detail:0,clientX:0,clientY:0});
 assert.equal(env.burst.style.left,'160px');assert.equal(env.burst.style.top,'222px');assert.equal(env.animations.length,12);
 assert.ok(firstBatch.every(animation=>animation.cancelled),'Rapid activation cancels all prior rays');
 staleFinish();assert.equal(env.burst.style.visibility,'visible','A superseded batch cannot hide the current activation');
 assert.equal(env.observers[0].targets.size,0,'Replacing a burst disconnects its former action observer');
 env.observers[0].callback([{target:env.action,isIntersecting:false}]);assert.equal(env.burst.style.visibility,'visible','A stale observer from a prior burst cannot cancel a new burst on the same action');
 env.observers.at(-1).callback([{target:env.action,isIntersecting:false},{target:env.action,isIntersecting:true}]);assert.equal(env.burst.style.visibility,'visible','The latest matching intersection entry wins within a batch');
 assert.equal(env.animations.filter(animation=>!animation.cancelled).length,6,'At most six rays remain active');
 env.animations.at(-1).onfinish();assert.ok(env.animations.every(animation=>animation.cancelled));assert.equal(env.burst.style.visibility,'hidden','Normal completion hides and releases the current batch');
 assert.equal(env.observers.at(-1).targets.size,0);
 env.click();env.observers.at(-1).callback([{target:env.action,isIntersecting:true},{target:env.action,isIntersecting:false}]);assert.equal(env.burst.style.visibility,'hidden','An offscreen originating action cancels every fixed ray');assert.ok(env.animations.every(animation=>animation.cancelled));
 env.click();env.action.isConnected=false;env.observers.at(-1).callback([{target:env.action,isIntersecting:true}]);assert.equal(env.burst.style.visibility,'hidden','A route-unmounted originating action cancels even if an earlier observation was visible');env.action.isConnected=true;
 env.click();env.document.emit('scroll');assert.equal(env.burst.style.visibility,'hidden','Scrolling cancels viewport-positioned rays immediately');
 env.click();env.view.emit('resize');assert.equal(env.burst.style.visibility,'hidden','Resizing cancels viewport-positioned rays immediately');
 env.click({clientX:-50,clientY:900});assert.equal(env.burst.style.left,'100px');assert.equal(env.burst.style.top,'244px','Pointer origin stays inside the activated action');
 env.policy.matches=false;env.policy.emit('change');assert.ok(env.animations.every(animation=>animation.cancelled));assert.equal(env.burst.style.visibility,'hidden');
 const afterPolicy=env.animations.length;env.click();assert.equal(env.animations.length,afterPolicy,'Reduced-motion/forced-colors policy blocks new bursts');
 env.policy.matches=true;env.policy.emit('change');assert.equal(env.animations.length,afterPolicy,'Policy re-enable does not replay an old activation');
 env.click();env.document.hidden=true;env.document.emit('visibilitychange');assert.ok(env.animations.every(animation=>animation.cancelled));
 const afterHidden=env.animations.length;env.click();assert.equal(env.animations.length,afterHidden);
 env.document.hidden=false;env.document.emit('visibilitychange');assert.equal(env.animations.length,afterHidden,'Returning to the tab does not replay a burst');
 env.click();const lateClick=[...env.container.listeners.get('click').keys()][0],lateFinish=env.animations.at(-1).onfinish;
 dispose();lateClick({button:0,target:env.target});lateFinish();
 assert.equal(env.container.count()+env.policy.count()+env.document.count()+env.view.count(),0);assert.ok(env.animations.every(animation=>animation.cancelled));assert.equal(env.burst.style.visibility,'hidden');assert.ok(env.observers.every(observer=>observer.targets.size===0));
 assert.deepEqual(env.action.style,{},'Action content and hitbox are never styled or animated');
 const unsupported=fixture();delete unsupported.view.matchMedia;
 bindActionBurst(unsupported.container,unsupported.burst)();assert.equal(unsupported.container.count()+unsupported.policy.count()+unsupported.document.count(),0);
 for(const capability of ['mediaThrows','mediaEvents','observer','partialAnimate']){
  const optional=fixture();
  if(capability==='mediaThrows')optional.view.matchMedia=()=>{throw new Error('synthetic media unavailable');};
  if(capability==='mediaEvents')optional.policy.addEventListener=undefined;
  if(capability==='observer')delete optional.view.IntersectionObserver;
  if(capability==='partialAnimate')optional.burst.children[2].animate=()=>{throw new Error('synthetic partial WAAPI failure');};
  const cleanup=bindActionBurst(optional.container,optional.burst);optional.click();
  if(capability==='observer'){
   assert.equal(optional.animations.length,6);optional.document.emit('scroll');assert.ok(optional.animations.every(animation=>animation.cancelled));
   optional.click();optional.view.emit('resize');assert.ok(optional.animations.every(animation=>animation.cancelled),'Missing observer still has direct scroll/resize cancellation');
  }else if(capability==='partialAnimate'){
   assert.equal(optional.animations.length,2);assert.ok(optional.animations.every(animation=>animation.cancelled));assert.equal(optional.burst.style.visibility,'hidden','A later native animation failure cleans up already-started rays');
  }else assert.equal(optional.animations.length,0);
  cleanup();assert.equal(optional.container.count()+optional.policy.count()+optional.document.count()+optional.view.count(),0);
 }

 const s=fixture(),stopSheen=bindActionSheen(s.container);
 assert.equal(s.sheens.length,0,'Mount and a restored enabled prop never start sheen');
 assert.equal(s.container.count(),4);assert.equal(s.policy.count(),1);assert.equal(s.document.count(),1);
 s.enter('pointerover',{pointerType:'touch'});s.enter('pointerover',{pointerType:'pen'});
 s.target.sheenSelected=false;s.enter();s.target.sheenSelected=true;
 s.action.disabled=true;s.enter();s.action.disabled=false;
 s.action.inert=true;s.enter();s.action.inert=false;
 s.action.inside=false;s.enter();s.action.inside=true;
 s.action.missingSheen=true;s.enter();s.action.missingSheen=false;
 const sheenAnimate=s.sheen.animate;s.sheen.animate=undefined;s.enter();s.sheen.animate=sheenAnimate;
 const onscreen=s.action.rect;s.action.rect={...onscreen,top:900,bottom:944};s.enter();s.action.rect=onscreen;
 assert.equal(s.sheens.length,0,'Sheen is limited to visible, enabled selected actions with the dedicated native-capable span');
 s.enter();assert.equal(s.sheens.length,1);
 const firstSheen=s.sheens[0],firstSheenFinish=firstSheen.onfinish;
 assert.deepEqual(firstSheen.options,{duration:620,easing:'cubic-bezier(.2,.6,.2,1)',iterations:1});
 assert.deepEqual(firstSheen.keyframes,[{clipPath:'inset(0 100% 0 0)',opacity:0,offset:0},{opacity:1,offset:.38},{clipPath:'inset(0)',opacity:.7,offset:.7},{clipPath:'inset(0 0 0 100%)',opacity:0,offset:1}]);
 assert.equal(s.observers[0].targets.has(s.action),true);
 const child={nodeType:1,parentAction:s.action};
 s.enter('pointerover',{relatedTarget:child});s.enter('focusin',{relatedTarget:child});s.enter('pointerout',{relatedTarget:child});
 assert.equal(s.sheens.length,1);assert.equal(firstSheen.cancelled,false,'Movement among action children causes no restart or cancellation');
 s.enter('focusin',{relatedTarget:{}});assert.equal(s.sheens.length,2);assert.equal(firstSheen.cancelled,true,'Keyboard focus starts the same bounded sheen and replaces previous work');
 firstSheenFinish();assert.equal(s.sheens[1].cancelled,false,'Old completion cannot cancel a newer activation');
 s.observers[0].callback([{target:s.action,isIntersecting:false}]);assert.equal(s.sheens[1].cancelled,false,'A stale sheen observer cannot cancel a newer activation on the same action');
 s.observers.at(-1).callback([{target:s.action,isIntersecting:false},{target:s.action,isIntersecting:true}]);assert.equal(s.sheens[1].cancelled,false,'Sheen also uses the latest matching entry');
 s.sheens[1].onfinish();assert.equal(s.sheens[1].cancelled,true);assert.equal(s.observers[0].targets.size,0,'Completion releases the current observer target');
 s.enter();s.enter('pointerout');assert.equal(s.sheens.at(-1).cancelled,true,'Leaving the action cancels');
 s.enter('focusin');s.enter('focusout');assert.equal(s.sheens.at(-1).cancelled,true,'Losing keyboard focus cancels');
 s.enter();s.observers.at(-1).callback([{target:s.action,isIntersecting:false}]);assert.equal(s.sheens.at(-1).cancelled,true,'Offscreen transition cancels the active sheen');
 const afterOffscreen=s.sheens.length;s.observers.at(-1).callback([{target:s.action,isIntersecting:true}]);assert.equal(s.sheens.length,afterOffscreen,'Re-entering the viewport never replays');
 s.enter();s.policy.matches=false;s.policy.emit('change');assert.ok(s.sheens.every(animation=>animation.cancelled));
 const beforeRestore=s.sheens.length;s.enter('focusin');assert.equal(s.sheens.length,beforeRestore);
 s.policy.matches=true;s.policy.emit('change');assert.equal(s.sheens.length,beforeRestore,'Restoring motion permission never replays focus/hover sheen');
 s.enter();s.document.hidden=true;s.document.emit('visibilitychange');assert.ok(s.sheens.every(animation=>animation.cancelled));
 const beforeVisible=s.sheens.length;s.enter();s.document.hidden=false;s.document.emit('visibilitychange');assert.equal(s.sheens.length,beforeVisible,'Tab restoration never replays');
 s.enter();const lateEnter=[...s.container.listeners.get('pointerover').keys()][0],lateSheenFinish=s.sheens.at(-1).onfinish;
 stopSheen();lateEnter({type:'pointerover',pointerType:'mouse',target:s.target,relatedTarget:null});lateSheenFinish();
 assert.equal(s.container.count()+s.policy.count()+s.document.count(),0);assert.equal(s.observers[0].targets.size,0);assert.ok(s.sheens.every(animation=>animation.cancelled));assert.deepEqual(s.action.style,{});
 for(const capability of ['media','observer','animateThrows']){
  const optional=fixture();
  if(capability==='media')delete optional.view.matchMedia;
  if(capability==='observer')delete optional.view.IntersectionObserver;
  if(capability==='animateThrows')optional.sheen.animate=()=>{throw new Error('synthetic native API unavailable');};
  const cleanup=bindActionSheen(optional.container);optional.enter();
  assert.equal(optional.sheens.length,capability==='observer'?1:0);cleanup();assert.equal(optional.container.count()+optional.policy.count()+optional.document.count(),0);
 }

 // Actual React output is fixed at six inaccessible decorative rays and adds
 // no controls or data-bearing accessible labels, including Quiet/SSR.
 for(const enabled of [false,true]){
  const markup=renderToStaticMarkup(React.createElement(WorkspaceActionEffects,{container:null,enabled}));
  assert.equal((markup.match(/<span/g)||[]).length,6);assert.match(markup,/aria-hidden="true"/);
  assert.doesNotMatch(markup,/tabindex|role=|<button|<a\b|aria-label/);
 }
 // Exercise the real component effect contract: Quiet does not subscribe;
 // changing enabled/unmount disposes the very controller started by the effect.
 const ast=ts.createSourceFile('workspace-action-effects.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let effect;
 const visit=node=>{if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect')effect=node;ts.forEachChild(node,visit);};visit(ast);assert.ok(effect);
 assert.equal(effect.arguments[1].getText(ast),'[container,enabled]');
 const hook=ts.transpileModule(`return (${effect.arguments[0].getText(ast)});`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const lifecycle=fixture(),run=(enabled,container=lifecycle.container)=>new Function('enabled','container','ref','bindActionBurst','bindActionSheen',hook)(enabled,container,{current:lifecycle.burst},bindActionBurst,bindActionSheen)();
 assert.equal(run(false),undefined);assert.equal(run(true,null),undefined);assert.equal(lifecycle.container.count(),0);
 const cleanup=run(true);lifecycle.click();lifecycle.enter();cleanup();assert.equal(lifecycle.container.count()+lifecycle.document.count()+lifecycle.policy.count()+lifecycle.view.count(),0);assert.ok(lifecycle.animations.every(animation=>animation.cancelled));assert.ok(lifecycle.sheens.every(animation=>animation.cancelled));assert.ok(lifecycle.observers.every(observer=>observer.targets.size===0));
 const beforeRemount=lifecycle.sheens.length,cleanupAgain=run(true);assert.equal(lifecycle.sheens.length,beforeRemount,'Quiet→Expressive rebinding waits for new user input');cleanupAgain();
}finally{await rm(dir,{recursive:true,force:true});}
console.log('Workspace action effects: six finite rays, input-only finite sheen, mouse/keyboard delegation, no child churn, disabled/inert guards, rapid replacement, offscreen/policy/visibility cancellation, no restore replay/scheduling, optional API fallbacks and complete cleanup passed.');
