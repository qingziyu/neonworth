import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import ts from 'typescript';
import { demoBasePath, inferredDemoBase, inspectDemoSource, verifyDemoModuleGraph, verifyDemoPublicAssets, DEMO_PUBLIC_ASSETS } from './demo-build-contract.mjs';
import { clientFetch, CLIENT_READ_ONLY, DEMO_MODE, ALLOW_IMPORT } from '../lib/client-transport.ts';
import { appHref as hostedHref, readAppPath as hostedPath } from '../lib/client-navigation.ts';
import { WORKSPACE_REPORTS } from '../lib/workspace-preferences.ts';

const root = resolve(import.meta.dirname, '..');
const source = path => readFileSync(resolve(root, path), 'utf8');
const tree = path => ts.createSourceFile(path, source(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(ast, predicate) { const hits=[]; const visit=node=>{if(predicate(node))hits.push(node);ts.forEachChild(node,visit)};visit(ast);return hits; }
function evaluate(node, ast, bindings) {
  const code=ts.transpileModule(`const evaluated = ${node.getText(ast)};`, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  return new Function(...Object.keys(bindings), code+'\nreturn evaluated;')(...Object.values(bindings));
}
function callback(ast, name, bindings) {
  const nodes=find(ast,node=>ts.isVariableDeclaration(node)&&node.name.getText(ast)===name);
  assert.equal(nodes.length,1,`Exactly one actual ${name} callback`);
  return evaluate(nodes[0].initializer,ast,bindings);
}
function module(path, bindings={}) {
  const exports={};
  const code=ts.transpileModule(source(path), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  new Function('exports',...Object.keys(bindings),code)(exports,...Object.values(bindings));return exports;
}

// The authenticated application's transport and navigation remain ordinary.
assert.equal(CLIENT_READ_ONLY,false);assert.equal(DEMO_MODE,false);assert.equal(ALLOW_IMPORT,true);
const originalFetch=globalThis.fetch, request=new Request('https://owner.example/api/data'), init={credentials:'same-origin',cache:'no-store'};
let calls=0;
globalThis.fetch=async(input,options)=>{calls++;assert.equal(input,request);assert.equal(options,init);return new Response('unchanged')};
try {assert.equal(await (await clientFetch(request,init)).text(),'unchanged');assert.equal(calls,1)} finally {globalThis.fetch=originalFetch}
assert.equal(hostedHref('/goals?year=2026'),'/goals?year=2026');assert.equal(hostedPath(new URL('https://owner.example/goals')),'/goals');
assert.equal(inferredDemoBase('person/neonworth'),'/neonworth/');
assert.equal(inferredDemoBase('person/person.github.io'),'/');
assert.equal(inferredDemoBase('Person/person.github.io'),'/');
assert.equal(inferredDemoBase('person/other.github.io'),'/other.github.io/');
assert.equal(inferredDemoBase(),'/neonworth/');

const publicFixture=mkdtempSync(join(tmpdir(),'neonworth-demo-assets-'));
try {
  mkdirSync(join(publicFixture,'fonts'));
  for(const path of DEMO_PUBLIC_ASSETS)writeFileSync(join(publicFixture,path),'synthetic asset');
  writeFileSync(join(publicFixture,'_headers'),'production only');
  assert.deepEqual(verifyDemoPublicAssets(publicFixture),DEMO_PUBLIC_ASSETS);
  writeFileSync(join(publicFixture,'private.json'),'synthetic forbidden fixture');
  assert.throws(()=>verifyDemoPublicAssets(publicFixture),/Unexpected public demo asset/);unlinkSync(join(publicFixture,'private.json'));
  mkdirSync(join(publicFixture,'private'));assert.throws(()=>verifyDemoPublicAssets(publicFixture),/Unexpected public demo asset directory/);rmSync(join(publicFixture,'private'),{recursive:true});
  unlinkSync(join(publicFixture,'favicon.svg'));assert.throws(()=>verifyDemoPublicAssets(publicFixture),/required public demo asset/);
  symlinkSync(join(publicFixture,'_headers'),join(publicFixture,'favicon.svg'));assert.throws(()=>verifyDemoPublicAssets(publicFixture),/symbolic links/);
} finally {rmSync(publicFixture,{recursive:true,force:true})}
assert.deepEqual(verifyDemoPublicAssets(resolve(root,'public')),DEMO_PUBLIC_ASSETS,'Only reviewed assets can enter the demo artifact');

const home=tree('app/page.tsx'), planning=tree('app/planning-client.tsx');
const navigationReader=find(home,node=>ts.isFunctionDeclaration(node)&&node.name?.text==='readNavigation')[0];
for(const base of ['/neonworth/','/fork-name/','/']) {
  assert.equal(demoBasePath(base),base);
  const nav=module('demo/navigation.ts',{__NEONWORTH_DEMO_BASE__:base});
  for(const report of WORKSPACE_REPORTS) {
    const href=nav.appHref(report.href), url=new URL(href,'https://example.github.io');
    assert.equal(url.pathname,base,'Every report uses the single static entry, including new-tab links');
    const read=evaluate(navigationReader,home,{window:{location:{href:url.href}},readAppPath:nav.readAppPath,sectionSlugs:Object.fromEntries(WORKSPACE_REPORTS.map(value=>[value.section,value.id]))});
    assert.equal(read().section,report.section,'Actual Home navigation restores the report after a deep-link/reload');
    let pushed, selected;
    callback(home,'goto',{window:{history:{pushState:(_state,_title,path)=>{pushed=path}},scrollTo:()=>{}},sectionHref:section=>nav.appHref(WORKSPACE_REPORTS.find(value=>value.section===section).href),setSection:value=>{selected=value},setEvidenceIds:()=>{},setSelectedFindingId:()=>{},setSelectedRecurringId:()=>{},setMobile:()=>{}})(report.section);
    assert.equal(pushed,href,'Actual goto writes the same reload-safe query destination');assert.equal(selected,report.section);
  }
  const historical=new URL(nav.appHref('/?view=transactions&month=2026-04&period=ytd'),'https://example.github.io');
  const read=evaluate(navigationReader,home,{window:{location:{href:historical.href}},readAppPath:nav.readAppPath,sectionSlugs:Object.fromEntries(WORKSPACE_REPORTS.map(value=>[value.section,value.id]))});
  assert.deepEqual(read(),{section:'Transactions',month:'2026-04',mode:'ytd'});
  assert.equal(new URL(nav.appHref('/year-in-review?year=2025'),'https://example.github.io').searchParams.get('year'),'2025');
  assert.throws(()=>nav.appHref('https://other.example/'),/within the application/);
  assert.throws(()=>nav.appHref('/unknown'),/Unsupported/);
}
for(const invalid of ['neonworth','/neonworth','//neonworth/','/one/two/','/../','/./','/x?y/','/x#y/'])assert.throws(()=>demoBasePath(invalid),/DEMO_BASE_PATH/);

// Invoke actual callbacks, bypassing disabled controls, to prove no user file is
// even read by the public demo. These checks fail if either early guard is removed.
let reads=0, clicks=0;
const file={size:20,text:async()=>{reads++;return '{}'}},event={target:{files:[file],value:'selected'}};
await callback(home,'pickImport',{ALLOW_IMPORT:false})(event);
assert.equal(event.target.value,'');assert.equal(reads,0);
callback(home,'chooseImportFile',{ALLOW_IMPORT:false,importRef:{current:{click(){clicks++}}},importOpener:{current:null}})({});
assert.equal(clicks,0);
await callback(planning,'load',{ALLOW_IMPORT:false})(file);assert.equal(reads,0);
await callback(home,'saveTarget',{CLIENT_READ_ONLY:true});
const retirementHandler=find(home,node=>ts.isJsxAttribute(node)&&node.name.getText(home)==='onClassificationSaved')[0];
assert.equal(evaluate(retirementHandler.initializer.expression,home,{CLIENT_READ_ONLY:true}),undefined);
assert.equal(typeof evaluate(retirementHandler.initializer.expression,home,{CLIENT_READ_ONLY:false}),'function');

// Real PlanningBackup component tree: export remains available; importing does not.
const jsx=(type,props)=>({type,props});
const backup=module('app/planning-client.tsx',{require:name=>name==='react'?{useRef:()=>({current:null}),useState:value=>[value,()=>{}],useEffect:()=>{}}:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='@/lib/client-transport'?{ALLOW_IMPORT:false,CLIENT_READ_ONLY:true}:name==='lucide-react'?{Download:()=>null,Upload:()=>null}:{}});
const rendered=backup.PlanningBackup({plan:{goals:{},events:[]},hidden:false,busy:false,onImport:async()=>{throw new Error('Demo must not import')}});
const nodes=[];const walk=value=>{if(!value||typeof value!=='object')return;if(Array.isArray(value)){value.forEach(walk);return;}nodes.push(value);walk(value.props?.children)};walk(rendered);
assert.equal(nodes.find(node=>node.type==='input'&&node.props.type==='file').props.disabled,true);
const buttons=nodes.filter(node=>node.type==='button');assert.equal(buttons.length,2);assert.equal(buttons[0].props.disabled,false);assert.equal(buttons[1].props.disabled,true);

// The module-graph gate examines actual source, including lazy reports and the
// default AppUpdateNotice polling path, and must reject concrete mutations.
const required=['app/page.tsx','demo/transport.ts'];
const ids=files=>files.map(file=>resolve(root,file));
verifyDemoModuleGraph(ids(required),root,path=>readFileSync(path,'utf8'));
for(const forbidden of ['worker/index.ts','db/schema.ts','app/api/data/route.ts','app/mcp/route.ts','lib/store.ts','lib/refresh.ts','lib/planning-store.ts','lib/client-transport.ts'])assert.throws(()=>verifyDemoModuleGraph(ids([...required,forbidden]),root,()=>''),/Server or hosted transport/);
assert.throws(()=>verifyDemoModuleGraph(ids(['app/page.tsx']),root,path=>readFileSync(path,'utf8')),/synthetic transport/);
for(const unsafe of ['fetch("/api/data")','globalThis.fetch("/api/data")','new WebSocket("wss://example.invalid")','navigator.sendBeacon("/api/import","x")','globalThis["fetch"]("/api/data")','window["fe" + "tch"]("/api/data")','navigator["sendBeacon"]("/api/import","x")','new window.WebSocket("wss://example.invalid")','new window["XMLHttpRequest"]()'])assert.ok(inspectDemoSource(unsafe,'app/unsafe.ts').length);
assert.deepEqual(inspectDemoSource('export const request: typeof globalThis.fetch = syntheticRequest;','demo/example.ts'),[],'Type annotations do not create a network capability');
for(const file of ['demo/transport.ts','demo/future.jsx','scripts/demo-data.mjs','app/future.js'])assert.throws(()=>verifyDemoModuleGraph(ids([...required,file]),root,path=>path===resolve(root,file)?'globalThis["fetch"]("/api/data")':readFileSync(path,'utf8')),/Unadapted network/);
for(const path of ['app/page.tsx','app/budget.tsx','app/planning-client.tsx','app/year-in-review-view.tsx','app/overview-budget.tsx','app/spending-composition.tsx','lib/app-version.ts'])assert.deepEqual(inspectDemoSource(source(path),path),[],path+' must use the explicit adapter');
const version=source('lib/app-version.ts');
assert.ok(inspectDemoSource(version.replace(/^import.*client-transport.*\n/m,''),'lib/app-version.ts').length,'An accidentally restored native app-version poll must fail the build');
assert.throws(()=>verifyDemoModuleGraph(ids([...required,'lib/app-version.ts']),root,path=>path.endsWith('app-version.ts')?version.replace(/^import.*client-transport.*\n/m,''):readFileSync(path,'utf8')),/Unadapted network/);

// Href expression execution catches modifier/new-tab escapes through pinned links.
const hrefs=find(home,node=>ts.isJsxAttribute(node)&&node.name.getText(home)==='href'&&node.initializer&&ts.isJsxExpression(node.initializer));
const pin=hrefs.find(node=>node.initializer.expression?.getText(home).includes('report.href'));
assert.ok(pin);
assert.equal(evaluate(pin.initializer.expression,home,{appHref:module('demo/navigation.ts').appHref,report:{href:'/goals'}}),'/neonworth/?view=goals');
assert.ok(find(home,node=>ts.isJsxExpression(node)&&node.expression?.getText(home)==='workspaceNotice').length,'The demo notice belongs inside the workspace, after the fixed sidebar');
console.log('Demo boundary: hosted passthrough, 14 actual report deep links across three bases, preserved period/year, unread imports, rendered read-only controls and mutation-tested graph/network isolation passed.');
