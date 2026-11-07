// Source/token and bundled-asset checks. Composited browser contrast, font
// loading/fallback geometry and responsive controls remain separate gates.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const {parse}=createRequire(import.meta.resolve('vite/package.json'))('postcss');
const {transform}=createRequire(import.meta.resolve('vite/package.json'))('lightningcss');
const globals=await readFile('app/globals.css','utf8'),warm=await readFile('app/warm-neon.css','utf8'),entry=await readFile('app/neon-entry.css','utf8');
const globalCss=parse(globals),warmCss=parse(warm),entryCss=parse(entry);
const root=globalCss.nodes.find(node=>node.type==='rule'&&node.selector===':root');assert.ok(root);
const tokens=Object.fromEntries(root.nodes.filter(node=>node.type==='decl').map(node=>[node.prop,node.value]));
function rgb(value){
 if(value.startsWith('var('))return rgb(tokens[value.slice(4,-1)]);
 assert.match(value,/^#[\da-f]{6}$/i);return [1,3,5].map(index=>parseInt(value.slice(index,index+2),16));
}
const colors=Object.fromEntries(Object.entries(tokens).filter(([,value])=>/^#[\da-f]{6}$/i.test(value)).map(([name,value])=>[name,rgb(value)]));
const luminance=channels=>channels.map(value=>{value/=255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4;}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
const ratio=(a,b)=>{const [low,high]=[luminance(a),luminance(b)].sort((a,b)=>a-b);return(high+.05)/(low+.05);};
const checks=[];
function check(foreground,background,minimum){
 const result=ratio(colors[foreground],colors[background]);checks.push({foreground,background,result,minimum});
 assert.ok(result>=minimum,`${foreground} on ${background}: ${result.toFixed(2)}:1 < ${minimum}:1`);
}
const surfaces=['--paper','--surface','--surface-muted','--surface-raised','--accent-soft','--spending-soft','--equity-soft','--limited-soft','--limited-head','--structural-soft'];
for(const background of surfaces){for(const foreground of ['--ink','--muted'])check(foreground,background,4.5);check('--accent',background,4.5);}
for(const background of surfaces.slice(0,5)){check('--control-border',background,3);check('--accent-strong',background,4.5);}
for(const status of ['success','warning','danger']){check(`--${status}`,`--${status}-soft`,4.5);check(`--${status}`,'--surface-raised',4.5);}
for(const foreground of ['--chart-cash','--chart-spending','--chart-equity','--chart-limited','--chart-partial',...Array.from({length:8},(_,i)=>`--chart-category-${i+1}`)])for(const background of ['--surface','--surface-raised'])check(foreground,background,3);
check('--accent-ink','--accent',4.5);check('--accent-ink','--accent-strong',4.5);
check('--structural-strong','--structural-soft',4.5);check('--structural','--surface',4.5);check('--structural-border','--structural-soft',3);check('--structural-border','--surface',3);
assert.equal(tokens['--success'],'#7ee2b0');assert.equal(tokens['--warning'],'#ffcf77');assert.equal(tokens['--danger'],'#ff9baf','Status meanings remain independently colored');
assert.notEqual(tokens['--accent'],tokens['--chart-cash']);assert.equal(tokens['--chart-cash'],'#45e2f0');assert.equal(tokens['--chart-spending'],'#ffbf69');
for(const [name,value] of Object.entries(tokens))if(name.startsWith('--chart-')||['--ink','--success','--warning','--danger'].includes(name))assert.notEqual(value,tokens['--decor-magenta'],'Decorative pink is not financial/status ink');
// Resolve the actual declared navigation colors and opaque content surfaces;
// do not substitute a hand-selected test palette for the final source roles.
const rules=css=>{const list=[];css.walkRules(rule=>list.push(rule));return list;};
const findRule=(css,selector)=>{const rule=rules(css).find(rule=>rule.selector===selector);assert.ok(rule,selector);return Object.fromEntries(rule.nodes.filter(node=>node.type==='decl').map(node=>[node.prop,node.value]));};
const headerStyle=findRule(warmCss,'.personal-experience[data-motion] .report-masthead');
assert.equal(headerStyle.background,'var(--surface)');
for(const selector of ['.personal-experience','.personal-experience .sidebar','.personal-experience :is(.workspace-summary, .spending-decision, .budget-control-deck)','.personal-experience[data-motion] .fire-dashboard .fire-target','.personal-experience .workspace-fire-surface']){
 const style=findRule(warmCss,selector);assert.match(style.background,/^var\(--(?:paper|surface)\)$/,'Record surfaces stay opaque and unwashed');
 for(const foreground of ['--ink','--muted'])assert.ok(ratio(colors[foreground],rgb(style.background))>=4.5);
}
const navigationRatios=[];
for(const selector of ['.personal-experience .sidebar :is(nav a.active, .data-nav.active)','.personal-experience .workspace-pins a[aria-current="page"]']){
 const style=findRule(warmCss,selector),contrast=ratio(rgb(style.color),rgb(style.background));navigationRatios.push(contrast);assert.ok(contrast>=4.5);
 assert.ok(ratio(rgb(style['border-color']),rgb(style.background))>=3);
 assert.notEqual(style.background,'var(--accent)','Cool navigation must not overwrite the warm action role');
}
// Composite the peak of each actual neon spill layer over the declared opaque
// header. This conservative source calculation assumes the peaks coincide;
// SVG art and shadow/gradient rasterization still need browser measurement.
const spill=findRule(entryCss,'.personal-experience .neon-entry__spill');
const layers=[...spill.background.matchAll(/color-mix\(in srgb, var\((--[\w-]+)\) ([\d.]+)%, transparent\)/g)].map(match=>({color:colors[match[1]],alpha:Number(match[2])/100}));
assert.equal(layers.length,2);let header=rgb(headerStyle.background);
for(const layer of layers.reverse())header=header.map((channel,i)=>layer.color[i]*layer.alpha+channel*(1-layer.alpha));
const spillRatio=ratio(colors['--muted'],header);assert.ok(ratio(colors['--ink'],header)>=4.5);assert.ok(spillRatio>=4.5,`Secondary text over maximum combined spill is ${spillRatio.toFixed(2)}:1`);
const tube=findRule(entryCss,'.personal-experience .neon-entry__tube');assert.equal(tube.height,'4px');assert.match(tube['background-image'],/--decor-cyan/);assert.match(tube['background-image'],/--decor-ember/);
assert.match(entry,/@media \(forced-colors: active\), print/);assert.equal(findRule(entryCss,'.personal-experience .neon-entry')['pointer-events'],'none');

// All new presentation selectors are guarded; the existing print and native
// forced-color mappings retain authority over this final imported stylesheet.
const unguardedRules=[];
warmCss.walkRules(rule=>{
 const guards=[];for(let owner=rule.parent;owner;owner=owner.parent)if(owner.type==='atrule'&&owner.name==='media')guards.push(owner.params);
 if(!guards.includes('screen and (forced-colors: none)'))unguardedRules.push(rule.selector);
});
assert.deepEqual(unguardedRules,[],'Every warm presentation rule, including nested responsive rules, must retain the screen/forced-color guard');
const forced=[];globalCss.walkAtRules('media',rule=>{if(rule.params==='screen and (forced-colors:active)')forced.push(rule);});assert.equal(forced.length,1);
assert.match(forced[0].toString(),/--chart-cash:LinkText/);assert.match(forced[0].toString(),/--chart-equity:CanvasText/);
const print=[];globalCss.walkAtRules('media',rule=>{if(rule.params==='print')print.push(rule);});assert.ok(print.some(rule=>/--paper:#fff;/.test(rule.toString())&&/--ink:#111827;/.test(rule.toString())));
const beforePrint=globals.split('/* Print:')[0];assert.doesNotMatch(beforePrint,/#(?:0b1224|13213a|45e2f0[\da-f]{2}|020815[\da-f]{2}|02050c[\da-f]{2})\b/i,'Embedded former navy/cyan decoration must use roles');
warmCss.walkDecls(declaration=>{
 assert.ok(!['animation','transition','transform','filter'].includes(declaration.prop),'Palette/font integration adds no motion or geometric effect');
 if(declaration.prop==='text-shadow')assert.equal(declaration.value,'none','No glow on financial values');
});
const financial=warmCss.nodes.find(node=>node.type==='atrule'&&node.name==='media').nodes.find(node=>node.type==='rule'&&node.selector.includes('.txn-amount'));
assert.ok(financial);const financialStyle=Object.fromEntries(financial.nodes.filter(node=>node.type==='decl').map(node=>[node.prop,node.value]));
assert.equal(financialStyle['font-family'],'var(--font-system)');assert.equal(financialStyle['font-variant-numeric'],'lining-nums tabular-nums');assert.equal(financialStyle['text-shadow'],'none');
assert.equal(tokens['--font-display'],'var(--font-system)','Print/forced-color typography retains the system fallback');

// Resolve a bounded set of real report selectors with the installed CSS
// parser. Feature styles deliberately come LAST to model lazy CSS arrival.
// This is a source-cascade check, not a browser layout/paint substitute.
const selectorCache=new Map();
function selectors(text){
 if(!selectorCache.has(text))transform({filename:'structural-selector.css',code:Buffer.from(`${text}{color:red}`),visitor:{Rule(rule){if(rule.type==='style')selectorCache.set(text,rule.value.selectors);}}});
 return selectorCache.get(text);
}
function specificity(selector){return selector.reduce((score,item)=>score+(item.type==='id'?10000:item.type==='class'||item.type==='attribute'?100:item.type==='type'||item.type==='pseudo-element'?1:item.type==='pseudo-class'?(item.kind==='where'?0:item.selectors?Math.max(...item.selectors.map(specificity)):100):0),0);}
function matches(selector,node){
 if(!node)return false;
 const index=selector.findLastIndex(item=>item.type==='combinator');
 if(index>=0){
  if(!matches(selector.slice(index+1),node))return false;
  if(selector[index].value==='child')return matches(selector.slice(0,index),node.parent);
  if(selector[index].value==='descendant'){for(let parent=node.parent;parent;parent=parent.parent)if(matches(selector.slice(0,index),parent))return true;}
  return false;
 }
 return selector.every(item=>{
  if(item.type==='class')return node.classes.includes(item.name);
  if(item.type==='type')return item.name===node.tag;
  if(item.type==='universal')return true;
  if(item.type==='attribute')return Object.hasOwn(node.attrs,item.name)&&(!item.operation||item.operation.operator==='equal'&&node.attrs[item.name]===item.operation.value);
  if(item.type==='pseudo-class'){
   if(item.kind==='is'||item.kind==='where')return item.selectors.some(selector=>matches(selector,node));
   if(item.kind==='not')return item.selectors.every(selector=>!matches(selector,node));
   if(item.kind==='first-child')return node.index===0;
   if(item.kind==='root')return !node.parent;
  }
  return false;
 });
}
const cascadeSources=[globalCss,parse(await readFile('app/workspace.css','utf8')),parse(await readFile('app/experience.css','utf8')),warmCss,...await Promise.all(['app/budget.css','app/fire-dashboard.css','app/report-compositions.css'].map(async file=>parse(await readFile(file,'utf8'))))];
function applicable(rule,width){
 for(let parent=rule.parent;parent;parent=parent.parent){
  if(parent.type!=='atrule')continue;
  if(parent.name.includes('keyframes'))return false;
  if(parent.name==='media'){
   if(/print|forced-colors:\s*active/.test(parent.params))return false;
   for(const [,bound,size] of parent.params.matchAll(/(min|max)-width:\s*(\d+)px/g))if(bound==='min'?width<Number(size):width>Number(size))return false;
  }
 }
 return true;
}
function style(node,width=1440){
 const result={},priorities={};let order=0;
 for(const css of cascadeSources)css.walkRules(rule=>{
  order++;if(!applicable(rule,width))return;
  const matching=selectors(rule.selector).filter(selector=>matches(selector,node));if(!matching.length)return;
  const rank=Math.max(...matching.map(specificity));
  for(const declaration of rule.nodes.filter(node=>node.type==='decl')){
   const priority=(declaration.important?1e8:0)+rank*10000+order;
   if(priority>=(priorities[declaration.prop]??-1)){result[declaration.prop]=declaration.value;priorities[declaration.prop]=priority;}
  }
 });
 return result;
}
const node=(classes,parent,tag='div',attrs={})=>({classes:classes.split(' '),parent,tag,attrs,index:0});
const shell=node('app unified-dashboard personal-workspace personal-experience',null,'div',{'data-motion':'expressive','data-density':'comfortable'});
const overview=node('personal-overview',shell),budget=node('budget-page',shell),goals=node('goals-view',shell);
const goalGrid=node('goal-card-grid',goals),budgetGrid=node('budget-main-grid',budget),dataGrid=node('data-top-grid',shell),yearMetrics=node('year-review-metrics',shell);
const neutralInsets=[node('workspace-summary-budget',overview),node('budget-upcoming-total',budget),node('budget-bridge-total',budget),node('budget-all-in',node('budget-funding-lanes',budget)),node('',yearMetrics,'section')];
for(const target of neutralInsets){const value=style(target);assert.equal(value.background,'var(--surface-muted)');assert.equal(value['border-color'],'var(--border)');}
for(const target of [node('panel goal-card',goalGrid,'section'),node('panel budget-next',budgetGrid,'section'),node('panel data-status',dataGrid,'section'),node('fire-dashboard panel',goals,'section')]){
 assert.equal(style(target)['border-radius'],'var(--workspace-radius)','Ordinary cards share a radius even when their feature stylesheet arrives later');
}
for(const target of [node('panel goal-card',goalGrid),node('panel budget-next',budgetGrid),node('panel data-status',dataGrid)])assert.equal(style(target)['margin-bottom'],'0','Grid children cannot double their owning grid gap');
assert.equal(style(shell)['--workspace-radius'],'16px');assert.equal(style(shell)['--workspace-inset-radius'],'8px');
for(const width of [390,810,1440]){
 for(const grid of [overview,node('workspace-planning',overview),goalGrid,budgetGrid,dataGrid])assert.equal(style(grid,width).gap,'var(--workspace-gap)');
 assert.equal(style(shell,width)['--workspace-gap'],width<=600?'16px':'24px');
}
shell.attrs['data-density']='compact';assert.equal(style(shell)['--workspace-gap'],'16px');shell.attrs['data-density']='comfortable';
const normalHero=style(node('budget-hero annual',budget));assert.equal(normalHero.background,'var(--surface)');assert.equal(normalHero['border-color'],'var(--border)');
const overHero=style(node('budget-hero annual is-over',budget));assert.equal(overHero.background,'var(--danger-soft)');assert.equal(overHero['border-color'],'var(--danger-border)','The final neutral budget rule must not obscure over-budget status');
assert.equal(style(node('budget-coverage-notice is-limited',budget)).background,'var(--warning-soft)');
assert.equal(style(node('budget-message is-error',budget)).background,'var(--danger-soft)');
assert.equal(style(node('budget-message is-success',budget)).background,'var(--success-soft)');
assert.equal(style(node('budget-history-limited',node('budget-category-history',budget),'td')).background,'var(--limited-soft)');
for(const [name,background] of [['budget-lane-fixed','var(--spending-soft)'],['budget-lane-choices','var(--equity-soft)']])assert.equal(style(node(name,node('budget-funding-lanes',budget))).background,background);

const fontFaces=[];warmCss.walkAtRules('font-face',rule=>fontFaces.push(rule));assert.equal(fontFaces.length,1);
const fontFace=Object.fromEntries(fontFaces[0].nodes.filter(node=>node.type==='decl').map(node=>[node.prop,node.value]));
assert.equal(fontFace['font-display'],'swap');assert.equal(fontFace['font-weight'],'300 700');
assert.equal(fontFace.src,'url("/fonts/space-grotesk-variable.woff2") format("woff2")');assert.doesNotMatch(warm,/https?:|@import/);
const font=await readFile('public/fonts/space-grotesk-variable.woff2');assert.equal(font.length,49256);assert.equal(font.subarray(0,4).toString(),'wOF2');
const sha=createHash('sha256').update(font).digest('hex');assert.equal(sha,'8e085aa438094f11487a836652edd5c054fa6a96f63fc7c282105ee3a4b08c07');
const license=await readFile('public/fonts/OFL-space-grotesk.txt','utf8'),provenance=await readFile('public/fonts/README.md','utf8');
assert.match(license,/Copyright 2020 The Space Grotesk Project Authors/);assert.match(license,/SIL OPEN FONT LICENSE Version 1\.1/);assert.match(provenance,/03507d024a01282884232081fc6011c09ff4e849/);assert.ok(provenance.includes(sha));
const textMinimum=Math.min(...checks.filter(check=>check.minimum===4.5).map(check=>check.result)),controlMinimum=Math.min(...checks.filter(check=>check.foreground==='--control-border').map(check=>check.result));
console.log(`Neon finish: ${checks.length} opaque contrast pairs passed; minimum text ${textMinimum.toFixed(2)}:1, control border ${controlMinimum.toFixed(2)}:1; actual nav roles ${Math.min(...navigationRatios).toFixed(2)}:1, maximum combined spill ${spillRatio.toFixed(2)}:1. Report surface/corner/gap cascade, compact/mobile spacing, over-budget/coverage/lane status preservation, font and print/forced-color checks passed. Browser compositing/fallback geometry remain separate.`);
