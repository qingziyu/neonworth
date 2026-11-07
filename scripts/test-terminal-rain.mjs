// Execute the real model, renderer, gate and component effects with synthetic
// Canvas2D/RAF/visibility APIs. Browser frame pacing/paint remain separate.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const {parse}=createRequire(import.meta.resolve('vite/package.json'))('postcss');
const source=await readFile('app/terminal-rain.tsx','utf8');
const transpile=code=>ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
class Events{
 listeners=new Map();
 addEventListener(name,callback){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(callback);}
 removeEventListener(name,callback){this.listeners.get(name)?.delete(callback);}
 emit(name){for(const callback of this.listeners.get(name)||[])callback();}
 count(){return [...this.listeners.values()].reduce((sum,set)=>sum+set.size,0);}
}
function fixture({width=1440,height=900,dpr=2,policy=true,hidden=false,printing=false,context=true}={}){
 const document=new Events(),view=new Events(),media=new Events(),print=new Events(),observers=[],queue=new Map(),callbacks=[],atlases=[];
 let nextId=0,reads=0,rect={width,height,top:0,left:0,right:width,bottom:height},maxPending=0;
 document.hidden=hidden;document.defaultView=view;media.matches=policy;print.matches=printing;
 view.innerWidth=width;view.innerHeight=height;view.devicePixelRatio=dpr;
 view.matchMedia=query=>{if(query==='print')return print;assert.equal(query,'(prefers-reduced-motion: no-preference) and (forced-colors: none)');return media;};
 view.requestAnimationFrame=callback=>{const id=++nextId;queue.set(id,callback);callbacks.push(callback);maxPending=Math.max(maxPending,queue.size);return id;};
 view.cancelAnimationFrame=id=>queue.delete(id);
 for(const name of ['setTimeout','setInterval','fetch'])view[name]=()=>assert.fail(`No ${name} in the renderer`);
 const makeContext=(atlas=false)=>({
  clears:0,draws:[],totalDraws:0,text:[],transforms:[],globalAlpha:1,
  setTransform(...args){this.transforms.push(args);if(this.transforms.length>10)this.transforms.shift();},
  clearRect(){this.clears++;this.draws=[];},
  drawImage(...args){assert.equal(atlas,false);this.totalDraws++;this.draws.push([...args.slice(1),this.globalAlpha]);},
  fillText(...args){assert.equal(atlas,true,'Text rasterization belongs only to the tiny atlas');this.text.push(args);},
  measureText(){assert.fail('No text measurement');},getImageData(){assert.fail('No pixel readback');},
 });
 const output=makeContext(),canvas=Object.assign(new Events(),{ownerDocument:document,dataset:{},width:0,height:0,getContext:()=>context?output:null,
  getBoundingClientRect(){reads++;return rect;}});
 document.createElement=name=>{assert.equal(name,'canvas');const context=makeContext(true),atlas={width:0,height:0,getContext:()=>context,context};atlases.push(atlas);return atlas;};
 const field={ownerDocument:document,getClientRects:()=>rect.width>0&&rect.height>0?[rect]:[],getBoundingClientRect:()=>rect};
 view.IntersectionObserver=class{constructor(callback,options){this.callback=callback;this.options=options;observers.push(this);}observe(target){assert.equal(target,field);}disconnect(){this.disconnected=true;}};
 const entry=patch=>({target:field,isIntersecting:true,intersectionRatio:1,...patch});
 const deliver=(patch={})=>observers.at(-1)?.callback([entry(patch)]);
 const step=time=>{const current=[...queue.values()];queue.clear();for(const callback of current)callback(time);};
 const resize=(width,height,dpr=view.devicePixelRatio)=>{rect={width,height,top:0,left:0,right:width,bottom:height};view.innerWidth=width;view.innerHeight=height;view.devicePixelRatio=dpr;view.emit('resize');};
 return {document,view,media,print,observers,queue,callbacks,atlases,canvas,output,field,entry,deliver,step,resize,
  reads:()=>reads,maxPending:()=>maxPending,listeners:()=>[document,view,media,print,canvas].reduce((sum,target)=>sum+target.count(),0)};
}
await mkdir('.sites-runtime',{recursive:true});
const directory=await mkdtemp(path.resolve('.sites-runtime/terminal-rain-'));
try{
 for(const file of ['ambient-motion','binary-rain-renderer'])await writeFile(path.join(directory,`${file}.mjs`),transpile(await readFile(`app/${file}.ts`,'utf8')));
 await writeFile(path.join(directory,'terminal-rain.mjs'),transpile(source).replace(/(['"])\.\/(ambient-motion|binary-rain-renderer)\1/g,"'./$2.mjs'"));
 const {bindTerminalRain,TerminalRainBackdrop}=await import(pathToFileURL(path.join(directory,'terminal-rain.mjs')).href);
 const {RAIN_LIMITS,binaryRainDimensions,createBinaryRainModel,advanceBinaryRain,createBinaryRainRenderer}=await import(pathToFileURL(path.join(directory,'binary-rain-renderer.mjs')).href);

 const markup=renderToStaticMarkup(React.createElement(TerminalRainBackdrop,{enabled:false}));
 assert.equal(markup,renderToStaticMarkup(React.createElement(TerminalRainBackdrop,{enabled:true})),'SSR is deterministic and independent of motion readiness');
 assert.match(markup,/^<div class="terminal-rain" aria-hidden="true">/);
 assert.equal((markup.match(/<canvas\b/g)||[]).length,1);assert.ok((markup.match(/<[a-z]/g)||[]).length<40);
 const glyphs=[...markup.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map(match=>match[1]);
 assert.equal(glyphs.length,24);assert.deepEqual(new Set(glyphs),new Set(['0','1']));
 assert.equal(markup.replace(/<[^>]*>/g,''),glyphs.join(''));
 assert.doesNotMatch(markup,/<button\b|<a\b|tabindex|aria-label|aria-live|on[a-z]+=/i,'No focus target or announced decorative content');
 const patternId=markup.match(/<pattern id="([^"]+)"/)[1];assert.ok(markup.includes(`fill="url(#${patternId})"`));
 assert.doesNotMatch(markup,/\bviewBox=/,'Static fallback pattern units stay tied to CSS pixels on paused viewport resize');
 assert.match(markup,/patternUnits="userSpaceOnUse"/);

 // Backing dimensions are checked after integer rounding, including huge DPR,
 // tiny/fractional sizes, narrow viewports and hostile unavailable dimensions.
 for(const [w,h] of [[320,844],[390,844],[810,900],[820,900],[1440,900],[1920,1080],[3840,2160],[16384,16384],[.1,16384],[1279.7,899.9]])for(const dpr of [.5,1,1.25,2,5,Infinity,NaN]){
  const size=binaryRainDimensions(w,h,dpr);assert.ok(size);assert.ok(size.scale<=1.5);assert.ok(Number.isInteger(size.pixelWidth)&&Number.isInteger(size.pixelHeight));assert.ok(size.pixelWidth>0&&size.pixelHeight>0);assert.ok(size.pixelWidth*size.pixelHeight<=2_000_000);
 }
 for(const [w,h] of [[0,900],[100,0],[-1,100],[Infinity,100],[100,NaN],[1e9,1e9]])assert.equal(binaryRainDimensions(w,h,2),null);
 const model=createBinaryRainModel(1440,900),same=createBinaryRainModel(1440,900);assert.deepEqual(model,same);
 assert.ok(model.streams.length<=72&&createBinaryRainModel(390,844).streams.length<=32);
 assert.equal(new Set(model.streams.map(stream=>stream.depth)).size,3);assert.ok(new Set(model.streams.map(stream=>stream.length)).size>8);assert.equal(new Set(model.streams.map(stream=>stream.color)).size,2);
 assert.ok(model.streams.every(stream=>stream.length>=8&&stream.length<=24&&stream.glyphs.length===24&&stream.changes.length===24));
 const front=model.streams.filter(stream=>stream.depth===2);assert.ok(front.every(stream=>stream.speed>=150&&stream.speed<=185),'Foreground is 2.4–3× the old fastest 62.5px/s stream');
 const before=model.streams.map(stream=>[...stream.glyphs]);advanceBinaryRain(model,80);advanceBinaryRain(model,80);
 const changed=model.streams.flatMap((stream,i)=>[...stream.glyphs].slice(0,stream.length).map((glyph,j)=>glyph!==before[i][j]));
 assert.ok(changed.some(Boolean)&&changed.some(value=>!value),'Only independently due cells shuffle, not every glyph together');
 assert.ok(model.streams.every(stream=>[...stream.glyphs].every(value=>value===0||value===1)));
 const at30=createBinaryRainModel(1440,900),at60=createBinaryRainModel(1440,900);for(const stream of [...at30.streams,...at60.streams])stream.y=100;
 for(let i=0;i<30;i++)advanceBinaryRain(at30,1000/30);for(let i=0;i<60;i++)advanceBinaryRain(at60,1000/60);
 for(let i=0;i<at30.streams.length;i++)assert.ok(Math.abs(at30.streams[i].y-at60.streams[i].y)<1e-8,'Speed uses elapsed time, not frame count');
 const oldY=at30.streams[0].y;advanceBinaryRain(at30,1e8);assert.ok(at30.streams[0].y-oldY<=at30.streams[0].speed*.08+1e-8,'Large gaps cannot jump streams across the viewport');
 const recirculate=createBinaryRainModel(390,844),stream=recirculate.streams[0];stream.y=844+stream.length*stream.spacing+31;advanceBinaryRain(recirculate,1);assert.ok(stream.y<0&&stream.length>=8&&stream.length<=24);

 const env=fixture(),renderer=createBinaryRainRenderer(env.canvas);assert.ok(renderer);assert.equal(env.canvas.dataset.ready,'true');assert.equal(env.queue.size,0,'Static first frame schedules no motion');
 assert.equal(env.atlases.length,1);assert.ok(env.atlases[0].width*env.atlases[0].height<60_000);
 assert.deepEqual(new Set(env.atlases[0].context.text.map(call=>call[0])),new Set(['0','1']));
 assert.equal(env.output.text.length,0);assert.ok(env.canvas.width*env.canvas.height<=RAIN_LIMITS.pixels);
 renderer.setActive(true);renderer.setActive(true);assert.equal(env.queue.size,1);env.step(0);
 const reads=env.reads(),rasterizations=env.atlases[0].context.text.length,initialPaints=env.output.clears;
 for(let index=1;index<=120;index++)env.step(index*1000/120);
 assert.ok(env.output.clears-initialPaints>=29&&env.output.clears-initialPaints<=30,'A 120Hz display still paints about 30 times per second');
 assert.equal(env.reads(),reads,'No per-frame layout reads');assert.equal(env.atlases[0].context.text.length,rasterizations,'No per-frame font rasterization');assert.equal(env.atlases.length,1);assert.equal(env.maxPending(),1);
 const lastFrame=structuredClone(env.output.draws),lastPaints=env.output.clears,staleFrame=env.callbacks.at(-1);
 renderer.setActive(false);assert.equal(env.queue.size,0);staleFrame(90000);assert.equal(env.output.clears,lastPaints);
 renderer.setActive(true);env.step(90000);assert.deepEqual(env.output.draws,lastFrame,'Resume retains the frame and does not catch up hidden elapsed time');env.step(90034);assert.notDeepEqual(env.output.draws,lastFrame);
 renderer.setActive(false);const stoppedReads=env.reads(),stoppedPaints=env.output.clears;env.resize(390,844);assert.equal(env.reads(),stoppedReads);assert.equal(env.output.clears,stoppedPaints);assert.equal(env.queue.size,0);assert.equal(env.canvas.dataset.ready,undefined,'Paused resize reveals correctly sized static SVG rather than stretching retained canvas');
 renderer.setActive(true);env.step(91000);assert.equal(env.canvas.dataset.ready,'true');assert.ok(env.canvas.width*env.canvas.height<=2_000_000);assert.equal(env.maxPending(),1);
 const sameAtlas=env.atlases.length;env.resize(390,844);env.resize(390,844);env.step(91034);assert.equal(env.atlases.length,sameAtlas,'Equivalent resize never rebuilds atlas');
 env.resize(0,0);env.step(91068);assert.equal(env.canvas.dataset.ready,undefined);assert.equal(env.queue.size,0,'Zero dimensions stop painting until a real resize/activation');
 env.resize(390,844);env.step(91102);assert.equal(env.canvas.dataset.ready,'true','Same-size restoration re-exposes retained pixels after display:none');assert.equal(env.atlases.length,sameAtlas);
 const pendingBeforeDispose=env.callbacks.at(-1);renderer.dispose();renderer.dispose();pendingBeforeDispose(92000);renderer.setActive(true);env.resize(1440,900);assert.equal(env.queue.size,0);assert.equal(env.listeners(),0);assert.equal(env.canvas.dataset.ready,undefined);
 const quietResize=fixture(),quietEngine=createBinaryRainRenderer(quietResize.canvas);quietEngine.setActive(true);quietResize.step(0);quietResize.step(34);quietEngine.setActive(false);
 const quietFrame=structuredClone(quietResize.output.draws),quietReads=quietResize.reads(),quietPaints=quietResize.output.clears;
 for(let index=0;index<3;index++)quietResize.resize(1440,900);
 assert.equal(quietResize.canvas.dataset.ready,undefined);assert.equal(quietResize.reads(),quietReads);assert.equal(quietResize.output.clears,quietPaints);assert.equal(quietResize.queue.size,0,'Repeated Quiet resize schedules no work');
 quietEngine.setActive(true);quietResize.step(120000);assert.equal(quietResize.canvas.dataset.ready,'true');assert.deepEqual(quietResize.output.draws,quietFrame,'Same-dimension resume restores the unchanged model/frame after fallback');quietEngine.dispose();

 // Use the actual shared gate with the actual renderer; no mocked active state.
 for(const reason of ['hidden','policy','offscreen','print-event','print-media']){
  const p=fixture(),engine=createBinaryRainRenderer(p.canvas),unbind=bindTerminalRain(p.field,true,engine);
  assert.equal(p.queue.size,0);p.deliver({intersectionRatio:0});p.deliver({intersectionRatio:.009});assert.equal(p.queue.size,0);p.deliver({intersectionRatio:.01});assert.equal(p.queue.size,1);p.step(0);p.step(34);
  const oldObserver=p.observers.at(-1),oldFrame=p.callbacks.at(-1),painted=p.output.clears;
  if(reason==='hidden'){p.document.hidden=true;p.document.emit('visibilitychange');}
  if(reason==='policy'){p.media.matches=false;p.media.emit('change');}
  if(reason==='offscreen')p.deliver({isIntersecting:false,intersectionRatio:0});
  if(reason==='print-event')p.view.emit('beforeprint');
  if(reason==='print-media'){p.print.matches=true;p.print.emit('change');}
  assert.equal(p.queue.size,0,`${reason} cancels the renderer frame`);oldFrame(10000);assert.equal(p.output.clears,painted);
  p.document.hidden=false;p.media.matches=true;p.print.matches=false;p.document.emit('visibilitychange');p.media.emit('change');p.print.emit('change');p.view.emit('afterprint');
  if(reason!=='offscreen'){oldObserver.callback([p.entry()]);assert.equal(p.queue.size,0,'Stale visibility generations cannot resume work');}
  p.deliver();assert.equal(p.queue.size,1);p.step(10000);assert.equal(p.output.clears,painted,'Reactivation preserves stream phase');unbind();engine.dispose();assert.equal(p.listeners(),0);assert.equal(p.queue.size,0);
 }
 for(const options of [{enabled:false},{hidden:true},{policy:false},{printing:true}]){
  const p=fixture(options),engine=createBinaryRainRenderer(p.canvas),unbind=bindTerminalRain(p.field,options.enabled!==false,engine);p.deliver();assert.equal(p.queue.size,0);assert.equal(p.output.clears,1,'Unavailable motion keeps a static first frame');
  const beforeResize=p.reads();p.resize(390,844);assert.equal(p.canvas.dataset.ready,undefined);assert.equal(p.queue.size,0);assert.equal(p.reads(),beforeResize);assert.equal(p.output.clears,1,'Quiet/reduced/hidden/print resizing reveals fallback without raster work');unbind();engine.dispose();assert.equal(p.listeners(),0);
 }
 const shell=fixture(),shellEngine=createBinaryRainRenderer(shell.canvas),shellUnbind=bindTerminalRain(shell.field,true,shellEngine);shell.deliver();shell.step(0);shell.step(34);const shellFrame=structuredClone(shell.output.draws);
 shell.resize(0,0);shell.deliver();assert.equal(shell.queue.size,0,'A display:none background after shell disappearance cannot remain active even with a queued positive intersection');
 shell.resize(1440,900);shell.deliver();shell.step(120000);assert.equal(shell.canvas.dataset.ready,'true');assert.deepEqual(shell.output.draws,shellFrame,'A returning financial shell resumes the retained field');shellUnbind();shellEngine.dispose();assert.equal(shell.listeners(),0);
 for(const failure of ['context-null','context-throws','atlas-null','atlas-throws','missing-raf','missing-cancel','missing-listener','registration-throws','context-listener-missing','context-registration-throws','draw-throws']){
  const p=fixture();
  if(failure==='context-null')p.canvas.getContext=()=>null;
  if(failure==='context-throws')p.canvas.getContext=()=>{throw Error('Synthetic unsupported context');};
  if(failure==='atlas-null')p.document.createElement=()=>({getContext:()=>null});
  if(failure==='atlas-throws')p.document.createElement=()=>{throw Error('Synthetic unavailable atlas');};
  if(failure==='missing-raf')p.view.requestAnimationFrame=undefined;
  if(failure==='missing-cancel')p.view.cancelAnimationFrame=undefined;
  if(failure==='missing-listener')p.view.removeEventListener=undefined;
  if(failure==='registration-throws')p.view.addEventListener=function(...args){Events.prototype.addEventListener.apply(this,args);throw Error('Synthetic partial registration');};
  if(failure==='context-listener-missing')p.canvas.removeEventListener=undefined;
  if(failure==='context-registration-throws')p.canvas.addEventListener=function(...args){Events.prototype.addEventListener.apply(this,args);throw Error('Synthetic partial context registration');};
  if(failure==='draw-throws')p.output.drawImage=()=>{throw Error('Synthetic draw failure');};
  assert.equal(createBinaryRainRenderer(p.canvas),null,failure);assert.equal(p.queue.size,0);assert.equal(p.listeners(),0);assert.equal(p.canvas.dataset.ready,undefined);
 }
 const lost=fixture(),lostEngine=createBinaryRainRenderer(lost.canvas);lostEngine.setActive(true);lost.step(0);lost.output.drawImage=()=>{throw Error('Synthetic lost context');};lost.step(34);assert.equal(lost.queue.size,0);assert.equal(lost.canvas.dataset.ready,undefined);lost.resize(390,844);lostEngine.setActive(true);assert.equal(lost.queue.size,0);lostEngine.dispose();assert.equal(lost.listeners(),0);
 const silent=fixture(),silentEngine=createBinaryRainRenderer(silent.canvas),oldLost=[...silent.canvas.listeners.get('contextlost')][0];silentEngine.setActive(true);silent.step(0);const silentFrame=silent.callbacks.at(-1);silent.canvas.emit('contextlost');assert.equal(silent.queue.size,0);assert.equal(silent.canvas.dataset.ready,undefined,'A silently lost browser context exposes the static fallback');silentFrame(10000);silentEngine.setActive(true);assert.equal(silent.queue.size,0);silentEngine.dispose();assert.equal(silent.listeners(),0);
 const replacement=createBinaryRainRenderer(silent.canvas);assert.ok(replacement);assert.equal(silent.canvas.dataset.ready,'true');oldLost();assert.equal(silent.canvas.dataset.ready,'true','An old context event cannot hide a replacement renderer');replacement.dispose();assert.equal(silent.listeners(),0);
 const initialZero=fixture({width:0,height:0}),zeroEngine=createBinaryRainRenderer(initialZero.canvas);assert.ok(zeroEngine);assert.equal(initialZero.canvas.dataset.ready,undefined);zeroEngine.setActive(true);initialZero.step(0);assert.equal(initialZero.queue.size,0);initialZero.resize(320,844);initialZero.step(34);assert.equal(initialZero.canvas.dataset.ready,'true');zeroEngine.dispose();

 // Execute the production effects/dependencies. Renderer lifetime is mount-only;
 // toggles rebind policy, not atlas/model. Data, date and report are absent inputs.
 const ast=ts.createSourceFile('terminal-rain.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),effects=[];
 const component=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='TerminalRainBackdrop');
 const walk=node=>{if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect')effects.push(node);ts.forEachChild(node,walk);};walk(component);assert.equal(effects.length,2);
 const evaluate=(node,env)=>new Function(...Object.keys(env),transpile(`return (${node.getText(ast)});`))(...Object.values(env));
 const lifecycle=fixture(),rendererRef={current:null},canvasRef={current:lifecycle.canvas},fieldRef={current:lifecycle.field};let creations=0,disposals=0;
 const factory=canvas=>{creations++;const actual=createBinaryRainRenderer(canvas);return {...actual,dispose(){disposals++;actual.dispose();}};};
 const prior=[],cleanups=[];
 const render=({enabled=true,...ignored}={})=>{const env={enabled,rendererRef,canvasRef,fieldRef,createBinaryRainRenderer:factory,bindTerminalRain};for(let index=0;index<effects.length;index++){
  const deps=evaluate(effects[index].arguments[1],env);if(!prior[index]||deps.some((value,i)=>!Object.is(value,prior[index][i]))){cleanups[index]?.();prior[index]=deps;cleanups[index]=evaluate(effects[index].arguments[0],env)();}
 }};
 render();lifecycle.deliver();lifecycle.step(0);lifecycle.step(34);const beforeRerender=structuredClone(lifecycle.output.draws);
 render({data:{synthetic:true},date:'2027-01',hiddenAmounts:true,report:'Goals'});assert.equal(creations,1);assert.equal(lifecycle.observers.length,1);assert.deepEqual(lifecycle.output.draws,beforeRerender);
 render({enabled:false});assert.equal(lifecycle.queue.size,0);render();assert.equal(creations,1);assert.equal(disposals,0);lifecycle.deliver();lifecycle.step(5000);assert.deepEqual(lifecycle.output.draws,beforeRerender);
 cleanups.forEach(cleanup=>cleanup?.());assert.equal(disposals,1);assert.equal(lifecycle.listeners(),0);assert.equal(lifecycle.queue.size,0);

 const css=parse(await readFile('app/terminal-rain.css','utf8')),rules=[];css.walkRules(rule=>rules.push(rule));
 const declarations=rule=>Object.fromEntries(rule.nodes.filter(node=>node.type==='decl').map(node=>[node.prop,node.value]));
 const media=rule=>{const result=[];for(let node=rule.parent;node;node=node.parent)if(node.type==='atrule'&&node.name==='media')result.push(node.params);return result;};
 const rootRule=rules.find(rule=>rule.selector==='.terminal-rain'&&!media(rule).length);assert.equal(declarations(rootRule).display,'none');
 const visible=rules.find(rule=>rule.selector==='body:has(.app.unified-dashboard.personal-workspace.personal-experience) .terminal-rain');assert.equal(declarations(visible).position,'fixed');assert.equal(declarations(visible).inset,'0');assert.equal(declarations(visible)['pointer-events'],'none');assert.equal(declarations(visible)['z-index'],'0');
 assert.deepEqual(rules.filter(rule=>declarations(rule).display==='block'&&rule.selector.includes('.terminal-rain')&&!rule.selector.includes('__')).map(rule=>rule.selector),[visible.selector],'Only an actual financial app shell can expose the persistent background');
 assert.ok(rules.filter(rule=>rule!==rootRule).every(rule=>media(rule).includes('screen and (forced-colors: none)')));
 const shellRule=rules.find(rule=>rule.selector==='.app.unified-dashboard.personal-workspace.personal-experience');assert.deepEqual(declarations(shellRule),{position:'relative','z-index':'1',background:'transparent'},'Only paint ordering/background change on the app; no transform, opacity or shell animation');
 assert.ok(rules.every(rule=>!rule.nodes.some(node=>node.type==='decl'&&/^(animation|filter|backdrop-filter)(-|$)/.test(node.prop))));
 assert.doesNotMatch(css.toString(),/@font-face|https?:\/\//);
 console.log('Binary rain passed: deterministic binary SSR/atlas, bounded actual pixels and stream model, independent shuffle and elapsed-time speed, 30fps paint cap, one RAF, no frame layout/font work, retained phase across policy/route/privacy rerenders, zero-size restore, stale/partial-failure cleanup and global noninteractive CSS. Browser paint/performance remain separate.');
}finally{await rm(directory,{recursive:true,force:true});}
