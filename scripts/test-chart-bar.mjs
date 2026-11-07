// Real Recharts Rectangle output and real component trees, with synthetic data.
// These checks do not claim browser paint/contrast or pointer interaction QA.
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import ts from 'typescript';
const root=fileURLToPath(new URL('../',import.meta.url));
const candidates=base=>[base,`${base}.ts`,`${base}.tsx`,`${base}/index.ts`,`${base}/index.tsx`];
registerHooks({
 resolve(specifier,context,nextResolve){
  if(specifier.endsWith('.css'))return {url:'data:text/javascript,export%20default%20%7B%7D',shortCircuit:true};
  if(specifier.startsWith('@/')||specifier.startsWith('.')&&context.parentURL?.startsWith('file:')){
   const base=specifier.startsWith('@/')?path.join(root,specifier.slice(2)):fileURLToPath(new URL(specifier,context.parentURL));
   const found=candidates(base).find(file=>existsSync(file)&&/\.[cm]?[jt]sx?$/.test(file));
   if(found)return {url:pathToFileURL(found).href,shortCircuit:true};
  }
  return nextResolve(specifier,context);
 },
 load(url,context,nextLoad){
  if(url.startsWith('file:')&&/\.tsx?$/.test(url)){
   const file=fileURLToPath(url);
   if(file.startsWith(root)&&!file.includes('/node_modules/'))return {format:'module',source:ts.transpileModule(readFileSync(file,'utf8'),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText,shortCircuit:true};
  }
  return nextLoad(url,context);
 }
});
globalThis.fetch=async()=>{throw Error('No network in synthetic bar checks');};
const React=await import('react'),{renderToStaticMarkup}=await import('react-dom/server');
const {Rectangle,Bar,BarChart,Cell,ResponsiveContainer}=await import('recharts');
const {ChartBarSkin}=await import('../app/chart-bar.tsx');
const attrs=text=>Object.fromEntries([...text.matchAll(/([\w-]+)="([^"]*)"/g)].map(([,key,value])=>[key,value]));
const paths=html=>[...html.matchAll(/<path\b([^>]*)>/g)].map(([,text])=>attrs(text));
const svgContents=element=>renderToStaticMarkup(React.createElement('svg',null,element)).replace(/^<svg[^>]*>|<\/svg>$/g,'');
const skin=props=>svgContents(React.createElement(ChartBarSkin,props));
const native=props=>svgContents(React.createElement(Rectangle,{...props,isAnimationActive:false,isUpdateAnimationActive:false}));
const geometryCases=[];
for(const width of [27,-27])for(const height of [68,-68])for(const horizontal of [false,true])for(const radius of [undefined,4,[4,4,0,0],[0,4,4,0]])geometryCases.push({x:12.345,y:-8.125,width,height,horizontal,radius});
for(const geometry of geometryCases)for(const fill of ['var(--chart-cash)','var(--chart-limited)','var(--warning)','url(#synthetic-spending-hatch)']){
 const props={...geometry,fill},markup=skin({...props,payload:{note:'PRIVATE_RECORD_CANARY',amount:123456.78},name:'PRIVATE_NAME_CANARY',dataKey:'PRIVATE_KEY_CANARY'});
 const rendered=paths(markup),base=rendered.find(item=>item.class?.split(' ').includes('chart-bar__base')),expected=paths(native(props))[0];
 for(const key of ['d','x','y','width','height','radius','fill'])assert.equal(base[key],expected[key],`Native ${key} is unchanged for signed geometry`);
 const clip=markup.match(/<clipPath id="([^"]+)">([\s\S]*?)<\/clipPath>/);assert.ok(clip);assert.equal(paths(clip[2])[0].d,expected.d,'The exact native path also bounds every highlight/stroke');assert.equal(paths(clip[2])[0].stroke,'none');
 const detail=attrs(markup.match(/<g\b([^>]*class="chart-bar__detail"[^>]*)>/)[1]);assert.equal(detail['clip-path'],`url(#${clip[1]})`);assert.equal(detail.visibility,'hidden');assert.equal(detail['aria-hidden'],'true');assert.equal(detail['pointer-events'],'none');
 const edge=rendered.find(item=>item.class?.split(' ').includes('chart-bar__edge'));assert.equal(edge.d,expected.d);assert.equal(edge.fill,'none');assert.equal(edge['stroke-width'],'2');
 const lines=[...markup.matchAll(/<line\b([^>]*)>/g)].map(([,text])=>attrs(text));assert.equal(lines.length,2);
 const cap=lines.find(item=>item.class==='chart-bar__cap');
 const end=geometry.horizontal?geometry.x+geometry.width-Math.sign(geometry.width)*.75:geometry.y+Math.sign(geometry.height)*.75;
 assert.equal(Number(cap[geometry.horizontal?'x1':'y1']),end);assert.equal(Number(cap[geometry.horizontal?'x2':'y2']),end,'Tip lighting follows the signed endpoint, including negative bars');
 const left=Math.min(geometry.x,geometry.x+geometry.width),right=Math.max(geometry.x,geometry.x+geometry.width),top=Math.min(geometry.y,geometry.y+geometry.height),bottom=Math.max(geometry.y,geometry.y+geometry.height);
 for(const line of lines)for(const key of ['x1','x2','y1','y2'])assert.ok(Number(line[key])>=(key[0]==='x'?left:top)&&Number(line[key])<=(key[0]==='x'?right:bottom),'Every detail coordinate stays inside the original signed rectangle');
 assert.doesNotMatch(markup,/PRIVATE_|123456|<filter|<animate|transform=|tabindex|aria-value/,'No payload echo, geometry animation, focus changes or new numeric ARIA');
}
for(const fillOpacity of [0,.25,1]){
 const props={x:10,y:20,width:24,height:-60,radius:[4,4,0,0],fill:'var(--chart-cash)',fillOpacity,opacity:.6};
 const markup=skin(props),base=paths(markup).find(item=>item.class?.includes('chart-bar__base'));
 assert.equal(base['fill-opacity'],paths(native(props))[0]['fill-opacity']);
 const detail=attrs(markup.match(/<g\b([^>]*class="chart-bar__detail"[^>]*)>/)[1]);assert.equal(Number(detail.opacity),fillOpacity,'Decorative light cannot make a transparent fill visible');
 assert.match(markup,/^<g class="chart-bar" opacity="0.6">/);
}
for(const [width,height] of [[.25,60],[24,.25],[-.25,-60],[24,-.25],[2.99,3],[3,-2.99]]){
 const props={x:2,y:4,width,height,fill:'url(#tiny-hatch)',radius:[4,4,0,0]},markup=skin(props);
 assert.equal(paths(markup).length,1);assert.equal(paths(markup)[0].d,paths(native(props))[0].d);assert.equal(paths(markup)[0].fill,'url(#tiny-hatch)');assert.doesNotMatch(markup,/<defs|<clipPath|chart-bar__detail|<line/,'Tiny nonzero marks have no minimum-size decoration');
}
for(const horizontal of [false,true])for(const widthSign of [-1,1])for(const heightSign of [-1,1])for(const size of [3,5,5.99,6])for(const narrowAxis of ['width','height']){
 const props={x:10,y:20,width:24*widthSign,height:60*heightSign,horizontal,fill:'var(--chart-equity)',radius:[4,4,0,0],[narrowAxis]:size*(narrowAxis==='width'?widthSign:heightSign)},markup=skin(props);
 const base=paths(markup).find(item=>item.class?.includes('chart-bar__base')),expected=paths(native(props))[0];
 assert.equal(base.d,expected.d);assert.equal(base.fill,expected.fill,'The original semantic fill and geometry survive the detail threshold');
 if(size<6){assert.equal(paths(markup).length,1);assert.doesNotMatch(markup,/<defs|<clipPath|chart-bar__detail|<line/,'Three-to-five-pixel bars keep their full fill in both orientations and signs');}
 else{assert.match(markup,/class="chart-bar__detail"/,'Details begin at exactly six pixels');assert.equal(paths(markup).length,3);}
}
for(const patch of [{width:0},{height:0},{width:-0},{x:NaN},{y:Infinity},{width:NaN},{height:-Infinity},{x:undefined}])assert.equal(skin({x:1,y:2,width:20,height:40,...patch}),'','Zero/nonfinite geometry cannot produce a mark or orphan definition');
const siblings=renderToStaticMarkup(React.createElement('svg',null,...Array.from({length:12},(_,index)=>React.createElement(ChartBarSkin,{key:index,x:index*30,y:10,width:20,height:index%2?-50:50,fill:'var(--chart-cash)'}))));
const ids=[...siblings.matchAll(/<clipPath id="([^"]+)"/g)].map(match=>match[1]);assert.equal(ids.length,12);assert.equal(new Set(ids).size,12);for(const id of ids)assert.ok(siblings.includes(`clip-path="url(#${id})"`));
assert.equal(siblings,renderToStaticMarkup(React.createElement('svg',null,...Array.from({length:12},(_,index)=>React.createElement(ChartBarSkin,{key:index,x:index*30,y:10,width:20,height:index%2?-50:50,fill:'var(--chart-cash)'})))),'SSR IDs are deterministic for the same tree');
// Stacked adjacent segments keep their exact common endpoint; no visual gap or
// extra cap height is introduced even when the upper segment is negative.
for(const segments of [[{y:100,height:40},{y:60,height:40}],[{y:100,height:-40},{y:140,height:-40}]])for(const segment of segments){const props={x:12,width:24,...segment,fill:'var(--chart-equity)'};assert.equal(paths(skin(props))[0].d,paths(native(props))[0].d);}

// Capture actual report trees with the normal React hook dispatcher. Recharts
// need not measure a browser viewport to expose its real data/series contract.
const {financialReviewFixture}=await import('./test-support/financial-review-fixture.mjs');
const fixture=financialReviewFixture(),data=fixture.dataset;
data.accounts.push({id:'plan',name:'Synthetic plan',institution:'Example',type:'investment',subtype:'401k',mask:'0000',balance:7654.32,netBalance:7654.32,balanceDate:null,balanceAgeKnown:false,syncStatus:'synced'});
data.retirementEvidence={version:1,scope:{start:'2026-01-01',end:'2026-10-28',sourceReadAt:null,isCompleteForQuery:null,freshness:'unknown',description:'Synthetic only'},accountScopes:[],records:[{id:'contribution',accountId:'plan',date:'2026-10-05',description:'Employee contribution',amount:-642.38,type:'cash',subtype:'contribution',currency:'USD'}],notes:[]};
const original=JSON.stringify(data),noop=()=>{};
const {IncomeSpendingChart,SpendingTrendChart}=await import('../app/dashboard-charts.tsx');
const {default:Income}=await import('../app/income.tsx');
const {default:Retirement}=await import('../app/retirement.tsx');
const {default:MoneyMovements,ZelleView}=await import('../app/money-movements.tsx');
const {default:Budget}=await import('../app/budget.tsx');
const {GoalsContent}=await import('../app/goals.tsx');
const {RecurringHistoryChart}=await import('../app/recurring-review.tsx');
const {summarizeMovements}=await import('../lib/movements.ts');
const {billKindLabels}=await import('../lib/recurring.ts');
const common={data,month:'2026-10',periodMode:'ytd',overrides:{},onEdit:noop,onTransactions:noop};
const trend=[{label:'Oct',income:2400,cashIncome:2000,spending:-1250.75}],recurringTrend=[{label:'Oct',...Object.fromEntries(Object.keys(billKindLabels).map((key,index)=>[key,index*100]))}];
const cases=[
 ['overview',IncomeSpendingChart,{trend},['income','spending']],
 ['cashflow',IncomeSpendingChart,{trend,cash:true},['cashIncome','spending']],
 ['spending',SpendingTrendChart,{trend:[{label:'Oct',value:-1250.75}],category:'Travel'},['value']],
 ['income',Income,common,['employerCashIncome','rsu']],
 ['movements',MoneyMovements,common,['cardRepayments','internalTransfers','investmentMovements','other']],
 ['zelle',ZelleView,{data,summary:summarizeMovements(data,'2026-10','ytd').zelle,onEdit:noop,rangeLabel:'Synthetic'},['sent','received']],
 ['retirement',Retirement,common,['value','value']],
 ['budget',Budget,common,['routine']],
 ['goals',GoalsContent,{data,settings:fixture.planning.goals,onSave:async()=>{},onIncome:noop,onNetWorth:noop,onRetirement:noop},['employerCashIncome','rsu']],
 ['recurring',RecurringHistoryChart,{trend:recurringTrend},Object.keys(billKindLabels)],
];
const elements=node=>React.isValidElement(node)?[node,...React.Children.toArray(node.props.children).flatMap(elements)]:[];
function capture(Component,props){let result;function Capture(){result=Component(props);return null;}renderToStaticMarkup(React.createElement(Capture));return result;}
let actualBars=0;
for(const [name,Component,props,keys] of cases){
 const shown=elements(capture(Component,{...props,hidden:false})),bars=shown.filter(node=>node.type===Bar),charts=shown.filter(node=>node.type===BarChart);
 assert.deepEqual(bars.map(node=>node.props.dataKey),keys,`${name}: canonical series unchanged`);actualBars+=bars.length;
 for(const bar of bars){assert.equal(bar.props.shape.type,ChartBarSkin);assert.equal(bar.props.isAnimationActive,false);assert.equal(bar.props.minPointSize,undefined);assert.equal(bar.props.activeBar,undefined,'Existing outer Recharts active/event defaults remain untouched');}
 const stack=name==='income'?'income':name==='movements'?'movement':name==='recurring'?'bills':undefined;assert.ok(bars.every(bar=>bar.props.stackId===stack));
 if(name==='retirement'){assert.equal(bars[0].props.shape.props.horizontal,true);assert.deepEqual(bars[0].props.radius,[0,4,4,0]);assert.equal(charts[0].props.layout,'vertical');assert.equal(bars[0].props.maxBarSize,25);assert.ok(shown.filter(node=>node.type===Cell).length>0);}
 else assert.ok(bars.every(bar=>bar.props.shape.props.horizontal===undefined));
 if(['overview','cashflow'].includes(name)){assert.equal(charts[0].props.data,trend);assert.equal(bars[0].props.fill,'var(--chart-cash)');assert.match(bars[1].props.fill,/^url\(#spending-bars-/);assert.ok(shown.some(node=>node.type==='defs'));assert.ok(bars.every(bar=>bar.props.maxBarSize===27));}
 if(name==='budget'){assert.equal(bars[0].props.maxBarSize,42);assert.deepEqual(bars[0].props.radius,[4,4,0,0]);assert.ok(shown.filter(node=>node.type===Cell).every(node=>['var(--chart-limited)','var(--warning)','var(--chart-partial)','var(--accent)'].includes(node.props.fill)));}
 const hidden=elements(capture(Component,{...props,hidden:true}));assert.equal(hidden.some(node=>[Bar,BarChart,ResponsiveContainer,ChartBarSkin].includes(node.type)),false,`${name}: privacy omits financial chart/shape subtree`);
 const restored=elements(capture(Component,{...props,hidden:false})).filter(node=>node.type===BarChart);assert.deepEqual(restored.map(node=>node.props.data),charts.map(node=>node.props.data),`${name}: restoring visibility retains exact financial rows`);
}
assert.equal(JSON.stringify(data),original,'Bar rendering never mutates synthetic source records');

// All source Bar declarations use the skin, but it must remain confined to lazy
// chart consumers. An eager legend import must not pull in the chart engine.
const consumerFiles=['dashboard-charts','income','money-movements','retirement','goals','budget','recurring-review'].map(name=>`app/${name}.tsx`);
let declarations=0,horizontal=0;
for(const relative of consumerFiles){const code=readFileSync(path.join(root,relative),'utf8'),ast=ts.createSourceFile(relative,code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const visit=node=>{
 if((ts.isJsxSelfClosingElement(node)||ts.isJsxOpeningElement(node))&&node.tagName.getText(ast)==='Bar'){
  declarations++;const shape=node.attributes.properties.find(attr=>ts.isJsxAttribute(attr)&&attr.name.getText(ast)==='shape');assert.ok(shape);assert.match(shape.getText(ast),/^shape=\{<ChartBarSkin(?: horizontal)? \/>\}$/);if(shape.getText(ast).includes(' horizontal'))horizontal++;
 }
 ts.forEachChild(node,visit);
};visit(ast);}
assert.equal(declarations,17);assert.equal(horizontal,1);
const visited=new Set();
function visitStatic(relative){
 if(visited.has(relative))return;visited.add(relative);const code=readFileSync(path.join(root,relative),'utf8'),ast=ts.createSourceFile(relative,code,ts.ScriptTarget.Latest,true,relative.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 for(const node of ast.statements){if(!ts.isImportDeclaration(node)||!ts.isStringLiteral(node.moduleSpecifier))continue;const clause=node.importClause;if(clause?.isTypeOnly)continue;if(clause&&!clause.name&&clause.namedBindings&&ts.isNamedImports(clause.namedBindings)&&clause.namedBindings.elements.every(item=>item.isTypeOnly))continue;
  const specifier=node.moduleSpecifier.text;if(!specifier.startsWith('.')&&!specifier.startsWith('@/'))continue;if(specifier.endsWith('.css'))continue;
  const base=specifier.startsWith('@/')?specifier.slice(2):path.normalize(path.join(path.dirname(relative),specifier));const target=candidates(base).find(candidate=>/\.tsx?$/.test(candidate)&&existsSync(path.join(root,candidate)));if(target)visitStatic(target);
 }
}
visitStatic('app/page.tsx');visitStatic('app/layout.tsx');assert.equal(visited.has('app/chart-bar.tsx'),false,'Chart skin remains outside the eager root graph');
console.log(`Chart bar passed: ${geometryCases.length*4} exact native signed/path/fill comparisons; 64 six-pixel detail-boundary cases; clipped endpoint details, tiny/zero/nonfinite and opacity behavior, unique deterministic SSR IDs, no payload echo, ${actualBars} real chart bars across ten chart views, hidden/restored source parity and lazy-only imports. Browser paint/interaction remain separate.`);
