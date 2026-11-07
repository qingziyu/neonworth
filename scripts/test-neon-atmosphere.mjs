// Actual motion-control callbacks with synthetic browser preferences only.
// Layout assertions establish source structure, not rendered mobile acceptance.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Pause,Play} from 'lucide-react';
import {validateWorkspacePreferences,writeWorkspacePreferences,WORKSPACE_PREFERENCES_KEY} from '../lib/workspace-preferences.ts';

const transpile=code=>ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.React}}).outputText;
const astFor=(name,source)=>ts.createSourceFile(name,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const compile=(node,ast,scope)=>new Function(...Object.keys(scope),transpile(`const actual=${node.getText(ast).replace(/^export /,'')};`)+ ';return actual;')(...Object.values(scope));
const controlSource=await readFile('app/workspace-motion-control.tsx','utf8');
const controlAst=astFor('workspace-motion-control.tsx',controlSource);
const controlNode=controlAst.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='WorkspaceMotionControl');
assert.ok(controlNode,'Exercise the exported production control');
const preferencesSource=await readFile('app/workspace-preferences.tsx','utf8');
const preferencesAst=astFor('workspace-preferences.tsx',preferencesSource);
const provider=preferencesAst.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='WorkspacePreferencesProvider');
let saveNode;
const visit=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(preferencesAst)==='savePreferences')saveNode=node.initializer.arguments[0];ts.forEachChild(node,visit);};visit(provider);
assert.ok(saveNode,'Use the real provider save callback, including persistence failure');
const elements=node=>React.isValidElement(node)?[node,...React.Children.toArray(node.props.children).flatMap(elements)]:[];
const textOf=node=>typeof node==='string'?node:React.isValidElement(node)?React.Children.toArray(node.props.children).map(textOf).join(''):'';

function fixture({motion='expressive',storageFailure=false}={}){
 const original=Object.freeze({version:2,density:'compact',motion,pinnedReports:Object.freeze(['goals','transactions','net-worth'])});
 const state={preferences:original,persistence:'available'};
 const stored=new Map([['neonworth-hide','true'],['unrelated-key','untouched']]),writes=[];
 const storage={setItem(key,value){writes.push([key,value]);if(storageFailure)throw new Error('Synthetic denied storage');stored.set(key,value);}};
 const savePreferences=compile(saveNode,preferencesAst,{window:{get localStorage(){return storage;}},validateWorkspacePreferences,writeWorkspacePreferences,setPreferences:value=>{state.preferences=value;},setPersistence:value=>{state.persistence=value;}});
 const cells=[];let cursor=0;
 const useState=initial=>{const index=cursor++;if(!(index in cells))cells[index]=initial;return[cells[index],value=>{cells[index]=typeof value==='function'?value(cells[index]):value;}];};
 const Control=compile(controlNode,controlAst,{React,Pause,Play,useId:()=>':synthetic-motion:',useState,useWorkspacePreferences:()=>({preferences:state.preferences,savePreferences})});
 const render=(props={ready:true,allowed:true})=>{cursor=0;return Control(props);};
 const button=tree=>elements(tree).find(node=>node.type==='button');
 return {state,original,stored,writes,render,button};
}

const running=fixture();
let tree=running.render(),button=running.button(tree);
assert.equal(button.props.type,'button');assert.equal(button.props.disabled,false);assert.notEqual(button.props['aria-disabled'],true);assert.equal(textOf(button),'Pause motion');
assert.equal(button.props['aria-pressed'],undefined,'Changing action labels use ordinary native button semantics');
assert.equal(elements(tree).filter(node=>node.type==='button').length,1,'One native tab stop controls motion');
assert.equal(running.writes.length,0,'Rendering never persists preferences');
const described=elements(tree).find(node=>node.props.id===button.props['aria-describedby']);assert.ok(described);assert.match(textOf(described),/decorative motion across the workspace/);
button.props.onClick();tree=running.render();
assert.equal(textOf(running.button(tree)),'Resume motion');
assert.deepEqual(running.state.preferences,{...running.original,motion:'quiet'});
assert.equal(running.state.persistence,'saved');assert.equal(running.writes.length,1);
assert.equal(running.writes[0][0],WORKSPACE_PREFERENCES_KEY);assert.deepEqual(JSON.parse(running.writes[0][1]),running.state.preferences);
running.button(tree).props.onClick();tree=running.render();
assert.equal(textOf(running.button(tree)),'Pause motion');assert.deepEqual(running.state.preferences,running.original);assert.equal(running.writes.length,2);
assert.equal(running.stored.get('neonworth-hide'),'true');assert.equal(running.stored.get('unrelated-key'),'untouched');
assert.equal(running.original.motion,'expressive','Toggling never mutates the context snapshot');
assert.deepEqual(running.state.preferences.pinnedReports,['goals','transactions','net-worth']);assert.equal(running.state.preferences.density,'compact');
assert.equal(textOf(elements(tree).find(node=>node.props.role==='status')),'','Normal saves add no repetitive live announcement');

for(const motion of ['quiet','expressive'])for(const props of [{ready:false,allowed:false},{ready:false,allowed:true},{ready:true,allowed:false}]){
 const env=fixture({motion}),rendered=env.render(props),control=env.button(rendered);
 assert.equal(control.props.disabled,!props.ready,'Only initialization uses native disabled; policy changes retain the keyboard focus target');
 assert.equal(control.props['aria-disabled']===true,props.ready&&!props.allowed);assert.equal(textOf(control),props.ready?'Motion off':'Motion loading');
 control.props.onClick();assert.equal(env.writes.length,0,'Even a synthetic blocked callback cannot save');assert.equal(env.state.preferences,env.original);
 const explanation=elements(rendered).find(node=>node.props.id===control.props['aria-describedby']);
 assert.match(textOf(explanation),props.ready?/system or browser preference keeps decorative motion off/:/Loading your display preference/);
}

const policyTransition=fixture();
const allowedButton=policyTransition.button(policyTransition.render());
const blockedButton=policyTransition.button(policyTransition.render({ready:true,allowed:false}));
assert.equal(blockedButton.type,allowedButton.type);assert.equal(blockedButton.key,allowedButton.key);
assert.equal(blockedButton.props.disabled,false);assert.equal(blockedButton.props.tabIndex,undefined,'Policy blocking does not remove the native button from keyboard navigation');
assert.equal(blockedButton.props['aria-disabled'],true);blockedButton.props.onClick();assert.equal(policyTransition.writes.length,0);
const restoredButton=policyTransition.button(policyTransition.render());assert.notEqual(restoredButton.props['aria-disabled'],true);assert.equal(textOf(restoredButton),'Pause motion');
restoredButton.props.onClick();assert.equal(policyTransition.state.preferences.motion,'quiet','Restored policy enables the existing control again');

const quiet=fixture({motion:'quiet'});tree=quiet.render();assert.equal(textOf(quiet.button(tree)),'Resume motion');
quiet.button(tree).props.onClick();assert.equal(quiet.state.preferences.motion,'expressive');
const denied=fixture({storageFailure:true});tree=denied.render();denied.button(tree).props.onClick();tree=denied.render();
assert.equal(denied.state.preferences.motion,'quiet');assert.equal(denied.state.persistence,'session');assert.equal(textOf(denied.button(tree)),'Resume motion');
assert.match(textOf(elements(tree).find(node=>node.props.role==='status')),/applied in this tab.*storage is unavailable/);
assert.equal(denied.stored.has(WORKSPACE_PREFERENCES_KEY),false);assert.equal(denied.stored.get('neonworth-hide'),'true');
denied.button(tree).props.onClick();assert.equal(denied.state.preferences.motion,'expressive','Session-only motion remains reversible');

// Use real React hooks for SSR; no window, effects or DOM APIs are needed.
const SSRControl=compile(controlNode,controlAst,{React,Pause,Play,useId:React.useId,useState:React.useState,useWorkspacePreferences:()=>({preferences:running.original,savePreferences:()=>assert.fail('SSR cannot save')})});
const initial=renderToStaticMarkup(React.createElement(SSRControl,{ready:false,allowed:false}));
assert.match(initial,/disabled=""/);assert.match(initial,/Motion loading/);assert.doesNotMatch(initial,/autofocus|aria-pressed|tabindex="-1"/i);
const pair=renderToStaticMarkup(React.createElement(React.Fragment,null,React.createElement(SSRControl,{ready:true,allowed:true}),React.createElement(SSRControl,{ready:true,allowed:false})));
const ids=[...pair.matchAll(/aria-describedby="([^"]+)"/g)].map(match=>match[1]);assert.equal(new Set(ids).size,2,'Accessible descriptions stay unique across simultaneous mounts');
const blockedMarkup=renderToStaticMarkup(React.createElement(SSRControl,{ready:true,allowed:false}));
assert.match(blockedMarkup,/aria-disabled="true"/);assert.doesNotMatch(blockedMarkup,/<button[^>]*\sdisabled(?:=|\s|>)/,'Policy blocking stays announced without native focus removal');

await mkdir('.sites-runtime',{recursive:true});
const directory=await mkdtemp(path.resolve('.sites-runtime/neon-atmosphere-'));
try{
 for(const name of ['ambient-motion','workspace-scene','neon-entry','report-masthead']){
  const extension=name==='ambient-motion'?'ts':'tsx';
  let js=transpile(await readFile(`app/${name}.${extension}`,'utf8'));
  js=js.replace(/(['"])\.\/(ambient-motion|workspace-scene|neon-entry)\1/g,(_,quote,module)=>`'./${module}.mjs'`);
  // Classic JSX output uses a runtime React binding for every actual module.
  await writeFile(path.join(directory,`${name}.mjs`),`import React from 'react';\n${js}`);
 }
 const {ReportMasthead}=await import(pathToFileURL(path.join(directory,'report-masthead.mjs')).href);
 for(const motif of ['overview','analysis','planning','records','terminal']){
  const props={index:'05',family:'Synthetic family',title:'Your future, in focus',description:'Synthetic description',motif,motionEnabled:false};
  const bare=renderToStaticMarkup(React.createElement(ReportMasthead,props));
  const decorated=renderToStaticMarkup(React.createElement(ReportMasthead,{...props,motionControl:React.createElement(SSRControl,{ready:true,allowed:true})}));
  assert.equal((bare.match(/<h1\b/g)||[]).length,1);assert.match(bare,/>Your future, in focus<\/h1>/);assert.doesNotMatch(bare,/workspace-motion-control/,'The shared masthead remains provider-independent without an optional control');
  assert.equal((decorated.match(/workspace-motion-control"/g)||[]).length,1);
  assert.ok(decorated.indexOf('Synthetic description')<decorated.indexOf('class="workspace-motion-control"'),'Pause control follows report copy in DOM reading order');
  assert.match(decorated,/<\/div><\/div><div class="workspace-motion-control"/,'Control is a flow sibling after the body, not a child over title/art');
  assert.equal((decorated.match(/<h1\b/g)||[]).length,1);assert.doesNotMatch(decorated,/aria-busy|role="progressbar"/);
 }
}finally{await rm(directory,{recursive:true,force:true});}

console.log('Neon atmosphere control passed: actual pause/resume plus provider saves, retained display/privacy choices, initialization/system blocking, session-only fallback, native accessible SSR and provider-independent masthead placement. Browser geometry remains pending.');
