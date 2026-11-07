// Execute the production layout/provider/wrapper with synthetic browser events.
// This establishes ownership and policy lifecycle, not browser paint or routing.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import React from 'react';
import ts from 'typescript';
import {bindWorkspaceMotionPolicy} from '../lib/workspace-motion-policy.ts';
import {DEFAULT_WORKSPACE_PREFERENCES,WORKSPACE_PREFERENCES_KEY,WORKSPACE_REPORTS,parseStoredWorkspacePreferences,readWorkspacePreferences,validateWorkspacePreferences,writeWorkspacePreferences} from '../lib/workspace-preferences.ts';

const sources=Object.fromEntries(await Promise.all(['layout','page','workspace-preferences','workspace-background'].map(async name=>[name,await readFile(`app/${name}.tsx`,'utf8')])));
const asts=Object.fromEntries(Object.entries(sources).map(([name,text])=>[name,ts.createSourceFile(`${name}.tsx`,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)]));
const declaration=(file,name)=>asts[file].statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);
const compile=(file,name,scope)=>{
 const node=declaration(file,name);assert.ok(node,`${name} is the real production declaration`);
 const output=ts.transpileModule(`const actual=${node.getText(asts[file]).replace(/^export (?:default )?/,'')};`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.React}}).outputText;
 return new Function(...Object.keys(scope),output+';return actual;')(...Object.values(scope));
};

class Events {
 listeners=new Map();
 addEventListener(type,callback){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(callback);}
 removeEventListener(type,callback){this.listeners.get(type)?.delete(callback);}
 emit(type,event){for(const callback of [...(this.listeners.get(type)??[])])callback(event);}
 count(type){return this.listeners.get(type)?.size??0;}
}

// A bounded hook runner executes the actual provider and its effect closures.
// React reconciliation/paint remain part of the separate browser acceptance.
function environment({storedMotion='expressive',blockedStorage=false}={}){
 const initial={version:2,density:'compact',motion:storedMotion,pinnedReports:['goals','income']};
 const values=new Map([[WORKSPACE_PREFERENCES_KEY,JSON.stringify(initial)],['neonworth-hide','true']]);
 const writes=[];let reads=0,queries=0;
 const storage={getItem(key){reads++;return values.get(key)??null;},setItem(key,value){writes.push([key,value]);values.set(key,value);}};
 const view=new Events(),document=new Events(),media=new Events();document.hidden=false;media.matches=true;
 Object.defineProperty(view,'localStorage',{get(){if(blockedStorage)throw new Error('Synthetic storage unavailable');return storage;}});
 view.matchMedia=query=>{assert.equal(query,'(prefers-reduced-motion: no-preference) and (forced-colors: none)');queries++;return media;};
 const cells=[];let cursor=0,pending=[],context;
 const same=(left,right)=>left&&right&&left.length===right.length&&left.every((item,index)=>Object.is(item,right[index]));
 const hooks={
  useState(initialValue){const index=cursor++;if(!(index in cells))cells[index]=typeof initialValue==='function'?initialValue():initialValue;return[cells[index],value=>{cells[index]=typeof value==='function'?value(cells[index]):value;}];},
  useMemo(callback,deps){const index=cursor++;if(!cells[index]||!same(cells[index].deps,deps))cells[index]={value:callback(),deps};return cells[index].value;},
  useCallback(callback,deps){return hooks.useMemo(()=>callback,deps);},
  useEffect(callback,deps){const index=cursor++;if(!cells[index]||!same(cells[index].deps,deps)){const old=cells[index];cells[index]={deps};pending.push(()=>{old?.cleanup?.();cells[index].cleanup=callback();});}},
 };
 const PreferenceContext={Provider:()=>null};
 const Provider=compile('workspace-preferences','WorkspacePreferencesProvider',{React,...hooks,WorkspacePreferencesContext:PreferenceContext,window:view,document,bindWorkspaceMotionPolicy,DEFAULT_WORKSPACE_PREFERENCES,WORKSPACE_PREFERENCES_KEY,parseStoredWorkspacePreferences,readWorkspacePreferences,validateWorkspacePreferences,writeWorkspacePreferences});
 const readPreferences=compile('workspace-preferences','useWorkspacePreferences',{useContext:value=>{assert.equal(value,PreferenceContext);return context;},WorkspacePreferencesContext:PreferenceContext});
 const useMotion=compile('workspace-preferences','useWorkspaceMotion',{useWorkspacePreferences:readPreferences});
 const Backdrop=()=>null;
 const Background=compile('workspace-background','WorkspaceBackground',{React,useWorkspaceMotion:useMotion,TerminalRainBackdrop:Backdrop});
 const render=children=>{cursor=0;const tree=Provider({children});assert.equal(tree.type,PreferenceContext.Provider);assert.equal(tree.props.children,children);context=tree.props.value;return tree;};
 const flush=()=>{const work=pending;pending=[];work.forEach(callback=>callback());};
 const cleanup=()=>{for(const cell of cells)cell?.cleanup?.();};
 return {initial,view,document,media,storage,values,writes,render,flush,cleanup,useMotion,Background,Backdrop,context:()=>context,reads:()=>reads,queries:()=>queries};
}

for(const storedMotion of ['quiet','expressive']){
 const env=environment({storedMotion});env.render(null);
 assert.deepEqual(env.useMotion(),{ready:false,allowed:false,enabled:false});
 assert.equal(env.Background().props.enabled,false,'SSR/initial hydration never flashes saved Quiet');
 assert.equal(env.queries(),0,'Server render never touches native APIs');
 env.flush();env.render(null);
 assert.equal(env.queries(),1);assert.equal(env.media.count('change'),1);assert.equal(env.document.count('visibilitychange'),1);assert.equal(env.view.count('storage'),1);
 const initialReads=env.reads();
 for(const report of WORKSPACE_REPORTS){
  env.render(React.createElement('main',{'data-synthetic-report':report.id},'Synthetic report'));
  const pagePolicy=env.useMotion(),background=env.Background();
  assert.equal(background.type,env.Backdrop);assert.equal(background.key,null);
  assert.deepEqual(Object.keys(background.props),['enabled'],'The backdrop receives no report, date, amount, privacy or draft state');
  assert.equal(background.props.enabled,pagePolicy.enabled);assert.equal(pagePolicy.enabled,storedMotion==='expressive');
  env.flush();
 }
 assert.equal(env.queries(),1,'Report consumers never create a native policy subscription');assert.equal(env.reads(),initialReads,'Report changes never reload display preferences');assert.equal(env.writes.length,0);
 const next={...env.context().preferences,motion:'expressive'};env.context().savePreferences(next);env.render(null);
 assert.equal(env.Background().props.enabled,true);
 env.document.hidden=true;env.document.emit('visibilitychange');env.render(null);assert.equal(env.Background().props.enabled,false);
 env.document.hidden=false;env.document.emit('visibilitychange');env.render(null);assert.equal(env.Background().props.enabled,true);
 env.media.matches=false;env.media.emit('change');env.render(null);assert.equal(env.Background().props.enabled,false,'Reduced motion/forced colors update page and backdrop together');assert.equal(env.useMotion().allowed,false);
 env.media.matches=true;env.media.emit('change');env.render(null);
 env.context().savePreferences({...next,motion:'quiet'});env.render(null);assert.equal(env.Background().props.enabled,false);
 env.media.emit('change');env.render(null);assert.equal(env.Background().props.enabled,false,'Native notifications cannot override Quiet');
 env.view.emit('storage',{key:WORKSPACE_PREFERENCES_KEY,newValue:JSON.stringify(next),storageArea:env.storage});env.render(null);assert.equal(env.Background().props.enabled,true,'Cross-tab settings reach the persistent layer');
 assert.equal(env.values.get('neonworth-hide'),'true');assert.deepEqual(JSON.parse(env.writes.at(-1)[1]),{...next,motion:'quiet'});
 assert.equal(env.queries(),1);env.cleanup();assert.equal(env.media.count('change'),0);assert.equal(env.document.count('visibilitychange'),0);assert.equal(env.view.count('storage'),0);
}
const blocked=environment({blockedStorage:true});blocked.render(null);blocked.flush();blocked.render(null);assert.equal(blocked.context().persistence,'session');assert.equal(blocked.Background().props.enabled,true);
assert.equal(blocked.context().savePreferences({...DEFAULT_WORKSPACE_PREFERENCES,motion:'quiet'}),false);blocked.render(null);assert.equal(blocked.Background().props.enabled,false,'Pause works even when storage is blocked');blocked.cleanup();

// Execute the server layout's actual JSX for every existing destination. The
// background is an unkeyed sibling preceding route children, never their owner.
const Provider=()=>null,Background=()=>null;
const Layout=compile('layout','RootLayout',{React,WorkspacePreferencesProvider:Provider,WorkspaceBackground:Background});
assert.notEqual(asts.layout.statements[0]?.expression?.text,'use client','RootLayout remains a server component');
for(const report of WORKSPACE_REPORTS){
 const child=React.createElement('main',{key:report.id},report.label),tree=Layout({children:child});
 const body=React.Children.toArray(tree.props.children).find(node=>node.type==='body');
 assert.ok(body);assert.equal(body.props.children.type,Provider);assert.equal(body.props.children.key,null);
 const [background,content]=body.props.children.props.children;
 assert.equal(background.type,Background);assert.equal(background.key,null);assert.equal(content,child);
 assert.deepEqual(background.props,{},'No route key/props can restart the layout background');
}
assert.doesNotMatch(sources.page,/TerminalRainBackdrop|data-atmosphere=/,'No report-specific rain owner remains');
for(const route of ['goals','year-in-review']){
 const source=await readFile(`app/${route}/page.tsx`,'utf8');assert.match(source,/import Dashboard from "\.\.\/page"/);assert.doesNotMatch(source,/WorkspacePreferencesProvider|WorkspaceBackground|TerminalRainBackdrop/);
}
assert.ok(/<ReportMasthead\b/.test(sources.page)&&/<ReportArt\b/.test(sources.page),'Existing masthead and report illustrations remain mounted');

// Resolve declared CSS, including real inline feature styles, with the engine
// stylesheet FIRST: late report CSS must not repaint the transparent canvas.
// Synthetic selector trees exercise paint ownership, not browser geometry.
const require=createRequire(import.meta.resolve('vite/package.json'));
const {parse}=require('postcss'),{transform}=require('lightningcss');
const appFiles=await readdir('app'),cssFiles=appFiles.filter(file=>file.endsWith('.css')&&file!=='terminal-rain.css');
const base=['globals.css','cyberpunk.css','workspace.css','workspace-effects.css','experience.css','expressive-dynamics.css','warm-neon.css'];
const cssTrees=await Promise.all(['terminal-rain.css',...base,...cssFiles.filter(file=>!base.includes(file)).sort()].map(async file=>parse(await readFile(`app/${file}`,'utf8'),{from:file})));
let inlineCount=0;
for(const file of appFiles.filter(file=>file.endsWith('.tsx'))){
 const source=await readFile(`app/${file}`,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const visit=node=>{
  if(ts.isNoSubstitutionTemplateLiteral(node)&&/^\s*[.#][\w-]+[^{}]*\{/.test(node.text)){
   cssTrees.push(parse(node.text,{from:`${file}:inline`}));inlineCount++;
  }
  ts.forEachChild(node,visit);
 };visit(ast);
}
assert.ok(inlineCount>=3,'Include actual inline recurring/review/report surfaces');
const parsedSelectors=new Map();
function selectors(selector){
 if(!parsedSelectors.has(selector))transform({filename:'paint-selector.css',code:Buffer.from(`${selector}{color:red}`),visitor:{Rule(rule){if(rule.type==='style')parsedSelectors.set(selector,rule.value.selectors);}}});
 return parsedSelectors.get(selector);
}
const specificity=selector=>selector.reduce((score,item)=>score+(item.type==='id'?10000:item.type==='class'||item.type==='attribute'?100:item.type==='type'||item.type==='pseudo-element'?1:item.type==='pseudo-class'?(item.kind==='where'?0:item.selectors?Math.max(...item.selectors.map(specificity)):100):0),0);
function matches(selector,node){
 if(!node)return false;
 const at=selector.findLastIndex(item=>item.type==='combinator');
 if(at>=0){
  if(!matches(selector.slice(at+1),node))return false;
  if(selector[at].value==='child')return matches(selector.slice(0,at),node.parent);
  if(selector[at].value==='descendant'){for(let parent=node.parent;parent;parent=parent.parent)if(matches(selector.slice(0,at),parent))return true;}
  return false;
 }
 return selector.every(item=>{
  if(item.type==='class')return node.classes.includes(item.name);
  if(item.type==='id')return node.attrs.id===item.name;
  if(item.type==='type')return item.name===node.tag;
  if(item.type==='universal')return true;
  if(item.type==='attribute')return Object.hasOwn(node.attrs,item.name)&&(!item.operation||item.operation.operator==='equal'&&node.attrs[item.name]===item.operation.value);
  if(item.type==='pseudo-class'){
   if(item.kind==='is'||item.kind==='where')return item.selectors.some(part=>matches(part,node));
   if(item.kind==='not')return item.selectors.every(part=>!matches(part,node));
   if(item.kind==='has'){
    const descendants=parent=>(parent.children??[]).flatMap(child=>[child,...descendants(child)]);
    return descendants(node).some(child=>item.selectors.some(part=>matches(part,child)));
   }
   if(item.kind==='root')return !node.parent;
   if(item.kind==='first-child')return node.index===0;
  }
  return false;
 });
}
function mediaApplies(query,width,mode){
 return query.split(',').some(part=>{
  if(/\bprint\b/.test(part)&&mode!=='print'||/\bscreen\b/.test(part)&&mode==='print')return false;
  if(/forced-colors:\s*none/.test(part)&&mode==='forced'||/forced-colors:\s*active/.test(part)&&mode!=='forced')return false;
  for(const [,bound,size] of part.matchAll(/(min|max)-width:\s*(\d+)px/g))if(bound==='min'?width<Number(size):width>Number(size))return false;
  return true;
 });
}
function style(node,width,mode='normal'){
 const values={},priorities={};let order=0;
 for(const css of cssTrees)css.walkRules(rule=>{
  order++;
  for(let parent=rule.parent;parent;parent=parent.parent)if(parent.type==='atrule'&&(parent.name.includes('keyframes')||parent.name==='media'&&!mediaApplies(parent.params,width,mode)))return;
  const matching=selectors(rule.selector).filter(selector=>matches(selector,node));if(!matching.length)return;
  const rank=Math.max(...matching.map(specificity));
  const put=(property,value,important)=>{const priority=(important?1e9:0)+rank*10000+order;if(priority>=(priorities[property]??-1)){values[property]=value;priorities[property]=priority;}};
  for(const declaration of rule.nodes.filter(node=>node.type==='decl')){
   if(declaration.prop==='background'){
    // Reset longhands as the real shorthand does; our asserted opaque surfaces
    // use a solid role. Gradient-only layers do not masquerade as an opaque base.
    const solid=declaration.value.match(/(?:^|,\s*)(var\(--[\w-]+\)|#[\da-f]{3,8}|transparent|Canvas|Highlight)$/i)?.[1]??'transparent';
    put('background-color',solid,declaration.important);put('background-image',/gradient\(/.test(declaration.value)?declaration.value:'none',declaration.important);
   }else put(declaration.prop,declaration.value,declaration.important);
  }
 });
 return values;
}
const node=(classes,parent,tag='div',attrs={},index=0)=>{
 const value={classes:classes.split(' '),parent,tag,attrs,index,children:[]};parent?.children.push(value);return value;
};
const html=node('',null,'html'),body=node('',html,'body'),rain=node('terminal-rain',body);
const app=node('app unified-dashboard personal-workspace personal-experience',body,'div',{'data-motion':'expressive','data-density':'comfortable'});
const workspace=node('workspace',app),main=node('',workspace,'main',{id:'main-content'});
const notFoundBody=node('',html,'body'),notFoundRain=node('terminal-rain',notFoundBody);node('',notFoundBody,'main');
const shellClasses=['app','unified-dashboard','personal-workspace','personal-experience'];
const partialRains=shellClasses.map(missing=>{
 const partialBody=node('',html,'body'),partialRain=node('terminal-rain',partialBody);node(shellClasses.filter(name=>name!==missing).join(' '),partialBody);return partialRain;
});
const reportFixtures={
 overview:['personal-overview',['workspace-summary','workspace-card']],spending:['spending-grid',['panel']],budget:['budget-page',['budget-hero','budget-control-deck']],
 goals:['goals-view',['panel goal-card','panel fire-dashboard']],'year-in-review':['year-review-view',['review-year-masthead','panel']],review:['intelligent-review',['smart-review-card']],
 transactions:['',['ledger-summary','panel ledger-panel']],bills:['recurring-review',['recurring-metric','panel recurring-ledger']],movements:['money-movements',['movement-metric','panel movement-ledger']],
 income:['income-page financial-review',['income-metric','panel income-ledger']],cash:['metric-grid',['metric','panel']],'net-worth':['',['networth-hero','panel']],
 retirement:['retirement-page financial-review',['retirement-metric','panel retirement-account-panel']],data:['data-top-grid',['panel data-status','panel data-health']],
};
assert.deepEqual(Object.keys(reportFixtures).sort(),WORKSPACE_REPORTS.map(report=>report.id).sort());
const rootTokens=style(html,1440);
function opaque(value){
 if(!value)return false;
 if(/^var\(--[\w-]+\)$/.test(value))return opaque(rootTokens[value.slice(4,-1)]);
 return /^#[\da-f]{6}$/i.test(value)||/^#[\da-f]{3}$/i.test(value);
}
for(const width of [320,390,810,820,1440]){
 assert.equal(style(rain,width).position,'fixed');assert.equal(style(rain,width)['z-index'],'0');assert.equal(style(rain,width)['pointer-events'],'none');assert.equal(style(rain,width).display,'block');
 assert.equal(style(notFoundRain,width).display,'none','A real missing-shell/404 tree never exposes the decoration');
 for(const partialRain of partialRains)assert.equal(style(partialRain,width).display,'none','Each required shell class participates in the positive gate');
 assert.equal(style(app,width).position,'relative');assert.equal(style(app,width)['z-index'],'1');
 for(const target of [app,workspace,main]){
  const actual=style(target,width);assert.equal(actual['background-color']??'transparent','transparent');assert.equal(actual['background-image']??'none','none');
  for(const property of ['transform','filter','backdrop-filter','perspective','contain','animation'])assert.ok(!actual[property]||actual[property]==='none',`${property} cannot change a dialog ancestor`);
  assert.ok(!actual.opacity||actual.opacity==='1');
 }
 for(const [report,[outer,cards]] of Object.entries(reportFixtures)){
  const entry=outer?node(outer,main):main;
  assert.equal(style(entry,width)['background-color']??'transparent','transparent',`${report}: exterior remains open to background at ${width}`);
  for(const classes of cards)assert.ok(opaque(style(node(classes,entry),width)['background-color']),`${report}: ${classes} retains a solid financial surface at ${width}`);
 }
 for(const classes of ['sidebar','topbar','report-masthead','modal','toast'])assert.ok(opaque(style(node(classes,app),width)['background-color']),`${classes} stays opaque at ${width}`);
 const modal=style(node('modal-overlay',app),width);assert.equal(modal.position,'fixed');assert.equal(modal['z-index'],'80');
 const sidebar=style(node('sidebar open',app),width);assert.equal(sidebar.position,'fixed');assert.equal(sidebar['z-index'],width<=800?'60':'30');
 assert.equal(style(rain,width,'forced').display,'none');assert.equal(style(rain,width,'print').display,'none');
 for(const absent of [notFoundRain,...partialRains])for(const mode of ['forced','print'])assert.equal(style(absent,width,mode).display,'none');
 assert.notEqual(style(app,width,'forced')['background-color'],'transparent');assert.equal(style(app,width,'print')['background-color'],'#fff');
}
console.log('Workspace background: layout/policy lifecycle passed; actual CSS cascade preserves transparent shell and 14 report surfaces at 320/390/810/820/1440, late feature styles, modal order, missing-shell/404 gate, print and forced colors. Browser stacking/navigation paint remain separate acceptance.');
