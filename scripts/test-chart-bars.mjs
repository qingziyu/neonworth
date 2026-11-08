// Synthetic execution of the production DOM bars plus their actual CSS cascade.
// Pixel paint/responsive browser acceptance remains a separate gate.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {Target} from 'lucide-react';
import {money,labelCategory} from '../lib/finance.ts';
import {goalProgress} from '../lib/goals.ts';
import {summarizeFire} from '../lib/fire.ts';
import {refreshTextForDisplay} from '../lib/refresh-status.ts';

const files=['page','budget','goals','fire-dashboard'];
const sources=Object.fromEntries(await Promise.all(files.map(async name=>[name,await readFile(`app/${name}.tsx`,'utf8')])));
const asts=Object.fromEntries(files.map(name=>[name,ts.createSourceFile(`${name}.tsx`,sources[name],ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)]));
const visit=(node,callback)=>{callback(node);ts.forEachChild(node,child=>visit(child,callback));};
const compile=(node,ast,scope)=>new Function(...Object.keys(scope),ts.transpileModule(`return (${node.getText(ast).replace(/^export (?:default )?/,'')});`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.React}}).outputText)(...Object.values(scope));
const declaration=(file,name)=>asts[file].statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);
const elements=node=>React.isValidElement(node)?[node,...React.Children.toArray(node.props.children).flatMap(elements)]:[];
const trackNames=['category-track','budget-progress','budget-envelope-track','goal-progress-track','fire-progress'],samples=new Map();
const rememberTrack=track=>{for(const name of trackNames)if(String(track.props.className??'').split(' ').includes(name))samples.set(name,track);return track;};
const withClass=(tree,name)=>elements(tree).filter(node=>String(node.props.className??'').split(' ').includes(name)).map(rememberTrack);
const width=track=>React.Children.toArray(track.props.children)[0].props.style.width;
const percent=(track,expected)=>{assert.match(width(track),/^-?[\d.e+-]+%$/);assert.ok(Math.abs(Number.parseFloat(width(track))-expected)<1e-12,`${width(track)} should represent ${expected}%`);};

const GoalProgressView=compile(declaration('goals','GoalProgressView'),asts.goals,{React,money,Target});
for(const [actual,expected] of [[-10,0],[0,0],[.01,.01],[27.5,27.5],[100,100],[160,100]]){
 const tree=GoalProgressView({progress:goalProgress(actual,100),hidden:false}),tracks=withClass(tree,'goal-progress-track');
 assert.equal(tracks.length,1);percent(tracks[0],expected);assert.equal(tracks[0].props['aria-valuenow'],Number.parseFloat(width(tracks[0])));
 const markup=renderToStaticMarkup(tree);assert.ok(markup.includes(`${actual.toFixed(1)}%`),'Signed/over-target text remains distinct from capped geometry');
 if(actual>100)assert.match(markup,/60 above target/);
}
for(const progress of [goalProgress(null,100),goalProgress(10,null),goalProgress(0,0)])assert.equal(withClass(GoalProgressView({progress,hidden:false}),'goal-progress-track').length,0,'Unknown/unset/no-scale progress is not invented');
const hiddenGoal=renderToStaticMarkup(GoalProgressView({progress:goalProgress(43210,100000),hidden:true}));assert.doesNotMatch(hiddenGoal,/aria-valuenow|width:|43,210|100,000/);

let dateNode;visit(asts['fire-dashboard'],node=>{if(ts.isVariableDeclaration(node)&&node.name.getText()==='date')dateNode=node.initializer;});
const FireDashboard=compile(declaration('fire-dashboard','FireDashboard'),asts['fire-dashboard'],{React,money,summarizeFire,date:compile(dateNode,asts['fire-dashboard'],{}),ReportArt:()=>null});
const fireGoal={annualWithdrawalNeed:80000,withdrawalRatePct:4,eligibleAssets:0,valuationDate:'2026-10-31',assetScope:'Synthetic investable assets'};
for(const [assets,expected] of [[0,0],[1,.00005],[500000,25],[2000000,100],[3000000,100]]){
 const tree=FireDashboard({goal:{...fireGoal,eligibleAssets:assets},hidden:false,edit:null}),track=withClass(tree,'fire-progress')[0];
 assert.ok(track);assert.ok(Math.abs(Number.parseFloat(width(track))-expected)<1e-12);assert.equal(track.props['aria-valuenow'],Number.parseFloat(width(track)));
 if(assets===3000000)assert.match(renderToStaticMarkup(tree),/150\.0% funded · target met on entered assets/);
}
assert.equal(withClass(FireDashboard({goal:null,hidden:false,edit:null}),'fire-progress').length,0);
assert.equal(withClass(FireDashboard({goal:{...fireGoal,annualWithdrawalNeed:0},hidden:false,edit:null}),'fire-progress').length,0);
const hiddenFire=renderToStaticMarkup(FireDashboard({goal:{...fireGoal,eligibleAssets:864200},hidden:true,edit:null}));assert.doesNotMatch(hiddenFire,/aria-valuenow|width:|864,200|43\.2%/);

// Compile the exact track JSX, including original width/overrun expressions.
// There is no duplicate calculation in a test-only component.
const budgetTracks=[];
visit(asts.budget,node=>{
 if(!ts.isJsxElement(node))return;
 const name=node.openingElement.attributes.properties.find(attr=>ts.isJsxAttribute(attr)&&attr.name.text==='className')?.initializer;
 if(name&&(name.text==='budget-progress'||name.getText(asts.budget).includes('budget-envelope-track')))budgetTracks.push(node);
});
assert.equal(budgetTracks.length,3,'All existing Budget DOM bars are exercised');
const budgetTree=(index,scope)=>rememberTrack(compile(budgetTracks[index],asts.budget,{React,...scope}));
for(const [actual,expected] of [[-10,0],[0,0],[.01,.01],[25,25],[100,100],[160,100]]){
 const monthly={hidden:false,plan:{monthlyCap:4000},summary:{selectedMonth:{actual:actual*40}}};
 percent(budgetTree(0,monthly),expected);
 assert.equal(width(budgetTree(0,{...monthly,hidden:true})),'0%');
 const annual={hidden:false,annualUsed:actual,summary:{annualAllowance:100}};
 percent(budgetTree(1,annual),expected);assert.equal(width(budgetTree(1,{...annual,hidden:true})),'0%');
 const row={limit:100,actualYtd:actual,remainingAnnual:100-actual},envelope=budgetTree(2,{hidden:false,row});
 percent(envelope,expected);assert.equal(envelope.props.className.includes('is-over'),actual>100);
 assert.equal(width(budgetTree(2,{hidden:true,row})),'0%');
}
assert.equal(width(budgetTree(1,{hidden:false,annualUsed:100,summary:{annualAllowance:0}})),'0%','Annual zero allowance retains its current no-scale rule');
for(const [actual,expected] of [[-10,0],[0,0],[10,100]])assert.equal(width(budgetTree(2,{hidden:false,row:{limit:0,actualYtd:actual,remainingAnnual:-actual}})),`${expected}%`,'Zero-envelope spending keeps its established cap rule');

const home=declaration('page','Home');assert.ok(home);
const variables=new Map();visit(home,node=>{if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name))variables.set(node.name.text,node.initializer);});
const palette=['var(--chart-category-1)','var(--chart-category-2)','var(--chart-category-3)','var(--chart-category-4)'];
for(const hidden of [false,true]){
 const clicks=[],categories=[{name:'Dining',value:100},{name:'Travel',value:25.25},{name:'Other',value:0},{name:'Services',value:-10}];
 const fmt=compile(variables.get('fmt'),asts.page,{hidden,money});
 const maskText=compile(variables.get('maskText'),asts.page,{hidden,refreshTextForDisplay});
 const card=compile(variables.get('catCard'),asts.page,{React,categories,hidden,palette,drill:name=>clicks.push(name),labelCategory,fmt,maskText,summary:{spending:115.25},Empty:()=>null});
 const tree=card(),tracks=withClass(tree,'category-track');assert.equal(tracks.length,4);
 assert.deepEqual(tracks.map(width),hidden?['0%','0%','0%','0%']:['100%','25.25%','0%','0%']);
 assert.deepEqual(tracks.map(track=>React.Children.toArray(track.props.children)[0].props.style.background),palette);
 withClass(tree,'category-row')[1].props.onClick();assert.deepEqual(clicks,['Travel'],'The existing category drilldown remains usable');
 if(hidden)assert.doesNotMatch(renderToStaticMarkup(tree),/\$[\d,]|25\.25%|100%/);
}

// Use installed selector parsing and source specificity, exercising both skin
// import orders and real inline feature CSS. No assumed app wrapper/fill tags.
const require=createRequire(import.meta.resolve('vite/package.json')),{parse}=require('postcss'),{transform}=require('lightningcss');
const skin=parse(await readFile('app/chart-bars.css','utf8'));
const appFiles=await readdir('app'),baseCss=['globals.css','cyberpunk.css','workspace.css','workspace-effects.css','experience.css','expressive-dynamics.css','warm-neon.css'];
const originals=await Promise.all([...baseCss,...appFiles.filter(name=>name.endsWith('.css')&&name!=='chart-bars.css'&&!baseCss.includes(name)).sort()].map(async name=>parse(await readFile(`app/${name}`,'utf8'),{from:name})));
for(const file of appFiles.filter(name=>name.endsWith('.tsx'))){
 const source=await readFile(`app/${file}`,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 visit(ast,node=>{if(ts.isNoSubstitutionTemplateLiteral(node)&&/^\s*[.#][\w-]+[^{}]*\{/.test(node.text))originals.push(parse(node.text,{from:`${file}:inline`}));});
}
const cache=new Map();
function selectors(text){if(!cache.has(text))transform({filename:'bar-selector.css',code:Buffer.from(`${text}{color:red}`),visitor:{Rule(rule){if(rule.type==='style')cache.set(text,rule.value.selectors);}}});return cache.get(text);}
const specificity=selector=>selector.reduce((score,item)=>score+(item.type==='id'?10000:item.type==='class'||item.type==='attribute'?100:item.type==='type'||item.type==='pseudo-element'?1:item.type==='pseudo-class'?(item.kind==='where'?0:item.selectors?Math.max(...item.selectors.map(specificity)):100):0),0);
function matches(selector,node){
 if(!node)return false;
 const pseudo=selector.findLastIndex(item=>item.type==='pseudo-element');
 if(node.pseudo)return pseudo===selector.length-1&&selector[pseudo].kind===node.pseudo&&matches(selector.slice(0,pseudo),{...node,pseudo:undefined});
 if(pseudo>=0)return false;
 const at=selector.findLastIndex(item=>item.type==='combinator');
 if(at>=0){if(!matches(selector.slice(at+1),node))return false;if(selector[at].value==='child')return matches(selector.slice(0,at),node.parent);if(selector[at].value==='descendant')for(let p=node.parent;p;p=p.parent)if(matches(selector.slice(0,at),p))return true;return false;}
 return selector.every(item=>item.type==='class'?node.classes.includes(item.name):item.type==='type'?node.tag===item.name:item.type==='attribute'?Object.hasOwn(node.attrs,item.name)&&(!item.operation||item.operation.operator==='equal'&&node.attrs[item.name]===item.operation.value):item.type==='universal'?true:item.type==='pseudo-class'?(item.kind==='is'||item.kind==='where'?item.selectors.some(part=>matches(part,node)):item.kind==='not'?item.selectors.every(part=>!matches(part,node)):item.kind==='root'?!node.parent:false):false);
}
function applicable(rule,width,mode){
 for(let p=rule.parent;p;p=p.parent)if(p.type==='atrule'){
  if(p.name.includes('keyframes'))return false;
  if(p.name==='media'){
   if(/prefers-reduced-motion:\s*reduce\b/.test(p.params)&&mode!=='reduced'||/prefers-reduced-motion:\s*no-preference/.test(p.params)&&mode==='reduced')return false;
   if(/\bprint\b/.test(p.params)&&mode!=='print'||/\bscreen\b/.test(p.params)&&mode==='print'||/forced-colors:\s*none/.test(p.params)&&mode==='forced'||/forced-colors:\s*active/.test(p.params)&&mode!=='forced')return false;
   for(const [,bound,size] of p.params.matchAll(/(min|max)-width:\s*(\d+)px/g))if(bound==='min'?width<Number(size):width>Number(size))return false;
  }
 }return true;
}
function style(node,width=1440,mode='normal',withSkin=true,skinLast=false){
 const result={},priority={};let order=0;
 for(const css of withSkin?(skinLast?[...originals,skin]:[skin,...originals]):originals)css.walkRules(rule=>{
  order++;if(!applicable(rule,width,mode))return;
  const hit=selectors(rule.selector).filter(selector=>matches(selector,node));if(!hit.length)return;
  const rank=Math.max(...hit.map(specificity));
  for(const decl of rule.nodes.filter(node=>node.type==='decl')){const next=(decl.important?1e9:0)+rank*10000+order;if(next>=(priority[decl.prop]??-1)){result[decl.prop]=decl.value;priority[decl.prop]=next;}}
 });return {...result,...(!node.pseudo?node.inline:{})};
}
const node=(classes,parent,tag='div',inline={})=>({classes:classes.split(' '),parent,tag,inline,attrs:{}});
let shellElement;visit(home,child=>{if(ts.isJsxOpeningElement(child)&&child.attributes.properties.some(attr=>ts.isJsxAttribute(attr)&&attr.name.text==='ref'&&attr.initializer?.getText(asts.page)==='{setDialogHost}'))shellElement=child;});
assert.ok(shellElement,'Locate the actual dialog-host application shell');
const shellAttribute=name=>shellElement.attributes.properties.find(attr=>ts.isJsxAttribute(attr)&&attr.name.text===name).initializer.expression;
const shell=node(compile(shellAttribute('className'),asts.page,{hidden:false}),null,shellElement.tagName.getText(asts.page));
shell.attrs['data-motion']=compile(shellAttribute('data-motion'),asts.page,{motion:{enabled:true}});
const trackNode=(classes,parent)=>{const sample=samples.get(classes.split(' ')[0]);assert.ok(sample);return node(classes,parent,sample.type);};
const budget=node('budget-page',shell),fire=node('fire-dashboard',shell);
const cases=[
 [trackNode('category-track',shell),'var(--chart-category-4)',5],
 [trackNode('budget-progress',node('budget-hero',budget)),'var(--chart-cash)',7],
 [trackNode('budget-progress',node('budget-hero is-over',budget)),'var(--danger)',7],
 [trackNode('budget-progress',node('budget-hero annual',budget)),'var(--chart-equity)',7],
 [trackNode('budget-progress',node('budget-hero annual is-over',budget)),'var(--danger)',7],
 [trackNode('budget-envelope-track',budget),'var(--chart-equity)',5],
 [trackNode('budget-envelope-track is-over',budget),'var(--danger)',5],
 [trackNode('goal-progress-track',shell),'var(--accent)',7],
 [trackNode('fire-progress',fire),'var(--accent)',6],
];
function shadowLayers(value){
 let depth=0,start=0;const layers=[];
 for(let i=0;i<value.length;i++){if(value[i]==='(')depth++;else if(value[i]===')')depth--;else if(value[i]===','&&depth===0){layers.push(value.slice(start,i).trim());start=i+1;}assert.ok(depth>=0);}
 assert.equal(depth,0);layers.push(value.slice(start).trim());return layers;
}
assert.equal(shadowLayers('inset 0 1px color-mix(in srgb, white 20%, transparent), 0 0 5px cyan').length,2);
for(const skinLast of [false,true])for(const width of [320,390,810,820,1440])for(const [track,color,height] of cases){
 const trackStyle=style(track,width,'normal',true,skinLast);assert.equal(trackStyle.height,`${height}px`);assert.equal(trackStyle.height,style(track,width,'normal',false).height);
 assert.equal(trackStyle.background,'var(--paper)');assert.equal(trackStyle['border-radius'],'1px');
 for(const fillWidth of ['0%','0.01%','25.25%','100%']){
  const sampleFill=React.Children.toArray(samples.get(track.classes[0]).props.children)[0];assert.equal(sampleFill.type,'span','Actual report fill tag must match the shared skin');
  const fill=node(sampleFill.props.className??'',track,sampleFill.type,{width:fillWidth,...(track.classes.includes('category-track')?{background:color}:{})}),fillStyle=style(fill,width,'normal',true,skinLast),before=style(fill,width,'normal',false);
  assert.equal(fillStyle.width,fillWidth);assert.equal(fillStyle.background,color,'Category/cash/equity/over-budget roles survive late feature styles');
  for(const property of ['width','height','min-width','max-width','padding','padding-left','padding-right','border','border-width','display','top','right','bottom','left','inset','transform','transition','animation','filter'])assert.equal(fillStyle[property],before[property],`${property} must not alter measured geometry or introduce motion`);
  assert.equal(before.display,'block');assert.equal(before.height,'100%');assert.ok(!before.position||before.position==='static','Current fills do not depend on absolute positioning');assert.equal(fillStyle.position,'relative');
  assert.equal(fillStyle.overflow,'hidden');assert.ok(shadowLayers(fillStyle['box-shadow']).every(layer=>/^inset\s/.test(layer)),'Every shadow layer stays inside the exact fill, including zero width');
  const pseudo={...fill,pseudo:'after'};
  assert.deepEqual(style(pseudo,width,'normal',false),{},'No existing feature ::after declarations can merge into the striation');
  const pseudoStyle=style(pseudo,width,'normal',true,skinLast);assert.equal(pseudoStyle.position,'absolute');assert.equal(pseudoStyle.inset,'0');assert.equal(pseudoStyle['pointer-events'],'none');
  for(const property of ['width','min-width','height','min-height','top','right','bottom','left','transform','transition','animation','filter'])assert.equal(pseudoStyle[property],undefined,'The pseudo-element remains bounded by its exact parent box');
 }
 for(const mode of ['print','forced'])assert.deepEqual(style(track,width,mode),style(track,width,mode,false),'The skin cannot change print or forced-color tracks');
}
shell.classes.push('amounts-hidden');assert.equal(style(cases[0][0]).visibility,'hidden');shell.classes.pop();
const detail=node('chart-bar__detail',shell,'g');assert.equal(style(detail).visibility,'inherit');assert.equal(style(detail,1440,'print').visibility,undefined);assert.equal(style(detail,1440,'forced').visibility,undefined);
const svg=node('',shell,'svg',{visibility:'hidden'}),hiddenDetail=node('chart-bar__detail',svg,'g');
const effectiveVisibility=target=>{const declared=style(target).visibility;return !declared||declared==='inherit'?(target.parent?effectiveVisibility(target.parent):'visible'):declared;};
assert.equal(effectiveVisibility(hiddenDetail),'hidden','A CSS-hidden SVG ancestor cannot expose decorative details');svg.inline.visibility='visible';assert.equal(effectiveVisibility(hiddenDetail),'visible');
assert.equal(style(node('chart-bar__edge',detail,'path')).fill,'none','CSS enforces a transparent edge interior over the semantic base');
skin.walkRules(rule=>{let guarded=false;for(let p=rule.parent;p;p=p.parent)if(p.type==='atrule'&&p.name==='media'&&p.params==='screen and (forced-colors: none)')guarded=true;assert.ok(guarded,'Every skin selector preserves print/forced-color defaults');});
skin.walkDecls(decl=>{assert.ok(!/^(?:width|height|min-width|max-width|padding(?:-.+)?|transform|transition|animation|filter|outline(?:-.+)?)$/.test(decl.prop),'Shared styling cannot override data geometry, add an exterior cap or animate financial bars');});
console.log('Chart bars: actual category/Budget/goal/FIRE geometry, signed/zero/fractional/over-target text, privacy/ARIA and drilldown behavior passed; late-feature CSS preserves heights, proportional fills, status roles and print/forced colors. Browser paint remains pending.');
