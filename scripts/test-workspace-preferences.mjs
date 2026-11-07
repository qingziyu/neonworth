// Synthetic browser-only preferences; no finance endpoints or private records.
import assert from 'node:assert/strict';
import {readFile,mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {DEFAULT_WORKSPACE_PREFERENCES,WORKSPACE_PREFERENCES_KEY,LEGACY_WORKSPACE_PREFERENCES_KEY,WORKSPACE_REPORTS,parseStoredWorkspacePreferences,readWorkspacePreferences,validateWorkspacePreferences,writeWorkspacePreferences} from '../lib/workspace-preferences.ts';

const selected={version:2,density:'compact',motion:'quiet',pinnedReports:['goals','transactions','net-worth']};
const legacy={version:1,density:'compact',pinnedReports:['income','goals']};
const migrated={...legacy,version:2,motion:'expressive'};
assert.deepEqual(parseStoredWorkspacePreferences(JSON.stringify(selected)),selected);
assert.deepEqual(parseStoredWorkspacePreferences(null),DEFAULT_WORKSPACE_PREFERENCES);
assert.equal(new Set(WORKSPACE_REPORTS.map(report=>report.id)).size,14);
assert.equal(WORKSPACE_REPORTS.find(report=>report.id==='goals').href,'/goals');
assert.equal(WORKSPACE_REPORTS.find(report=>report.id==='cash').section,'Cash flow');
for(const value of [null,[],{},legacy, {...selected,version:1},{...selected,version:3},{...selected,density:'dense'},{...selected,density:new String('compact')},{...selected,motion:'always'},{...selected,motion:new String('quiet')},{...selected,motion:undefined},{...selected,pinnedReports:['goals','goals']},{...selected,pinnedReports:['goals','budget','income','data']},{...selected,pinnedReports:['https://example.com']},{...selected,pinnedReports:['Synthetic 350.00 credit']},{...selected,pinnedReports:Array(1)},{...selected,note:'Synthetic USD 350.00'},{...selected,amount:350}])assert.equal(validateWorkspacePreferences(value),null);
for(const value of ['{',JSON.stringify({...selected,credential:'synthetic'}),' '.repeat(1025)])assert.equal(parseStoredWorkspacePreferences(value),null);
const stored=new Map([['neonworth-hide','true'],['unrelated-key','untouched']]),writes=[],reads=[];
const storage={getItem:key=>{reads.push(key);return stored.get(key)??null;},setItem:(key,value)=>{writes.push([key,value]);stored.set(key,value);}};
stored.set(LEGACY_WORKSPACE_PREFERENCES_KEY,JSON.stringify(legacy));
assert.deepEqual(readWorkspacePreferences(()=>storage),{preferences:migrated,available:true});
assert.deepEqual(reads,[WORKSPACE_PREFERENCES_KEY,LEGACY_WORKSPACE_PREFERENCES_KEY]);assert.equal(writes.length,0,'Migration is read-only');reads.length=0;
for(const invalid of ['{',' '.repeat(1025),JSON.stringify({...legacy,note:'Synthetic financial text'}),JSON.stringify({...legacy,version:2}),JSON.stringify({...legacy,density:'dense'}),JSON.stringify({...legacy,pinnedReports:['goals','goals']})]){
 stored.set(LEGACY_WORKSPACE_PREFERENCES_KEY,invalid);
 assert.deepEqual(readWorkspacePreferences(()=>storage).preferences,DEFAULT_WORKSPACE_PREFERENCES);
}
stored.set(LEGACY_WORKSPACE_PREFERENCES_KEY,JSON.stringify(legacy));
stored.set(WORKSPACE_PREFERENCES_KEY,'invalid');reads.length=0;
assert.deepEqual(readWorkspacePreferences(()=>storage).preferences,DEFAULT_WORKSPACE_PREFERENCES,'Invalid present v2 never revives older choices');assert.deepEqual(reads,[WORKSPACE_PREFERENCES_KEY]);reads.length=0;
assert.equal(writeWorkspacePreferences(()=>storage,selected),true);
assert.deepEqual(JSON.parse(writes[0][1]),selected);assert.equal(writes[0][0],WORKSPACE_PREFERENCES_KEY);
assert.equal(stored.get('neonworth-hide'),'true');assert.equal(stored.get('unrelated-key'),'untouched');
assert.deepEqual(readWorkspacePreferences(()=>storage),{preferences:selected,available:true});
assert.deepEqual(reads,[WORKSPACE_PREFERENCES_KEY]);
assert.equal(stored.get(LEGACY_WORKSPACE_PREFERENCES_KEY),JSON.stringify(legacy),'Saving v2 does not write or delete the legacy key');
assert.throws(()=>writeWorkspacePreferences(()=>storage,{...selected,note:'Synthetic secret'}),/supported display settings/);assert.equal(writes.length,1,'Invalid fields are rejected before persistence');
assert.deepEqual(readWorkspacePreferences(()=>{throw new Error('blocked');}),{preferences:DEFAULT_WORKSPACE_PREFERENCES,available:false});
assert.deepEqual(readWorkspacePreferences(()=>({getItem(){throw new Error('blocked read');},setItem(){assert.fail('A read cannot write');}})),{preferences:DEFAULT_WORKSPACE_PREFERENCES,available:false});
assert.equal(writeWorkspacePreferences(()=>{throw new Error('blocked');},selected),false);
assert.equal(writeWorkspacePreferences(()=>({getItem(){return null;},setItem(){throw new Error('quota');}}),selected),false);

// Run the provider's real mount/listener/save closures with native event shapes.
const source=await readFile('app/workspace-preferences.tsx','utf8');
const ast=ts.createSourceFile('workspace-preferences.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const provider=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='WorkspacePreferencesProvider');
let effect,save;
function visit(node){
 if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect'&&node.arguments[0].getText(ast).includes('readWorkspacePreferences'))effect=node.arguments[0];
 if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='savePreferences')save=node.initializer.arguments[0];
 ts.forEachChild(node,visit);
}
visit(provider);assert.ok(effect&&save);
const bind=(node,scope)=>new Function(...Object.keys(scope),ts.transpileModule(`const actual=${node.getText(ast)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText+';return actual;')(...Object.values(scope));
const listeners=new Map(),state={};
const browser={localStorage:storage,addEventListener:(event,callback)=>listeners.set(event,callback),removeEventListener:(event,callback)=>{assert.equal(listeners.get(event),callback);listeners.delete(event);}};
const scope={window:browser,readWorkspacePreferences,parseStoredWorkspacePreferences,WORKSPACE_PREFERENCES_KEY,validateWorkspacePreferences,writeWorkspacePreferences,setPreferences:value=>{state.preferences=value;},setPersistence:value=>{state.persistence=value;},setReady:value=>{state.ready=value;}};
const cleanup=bind(effect,scope)();assert.deepEqual(state,{preferences:selected,persistence:'available',ready:true});
const changed=listeners.get('storage');
changed({key:'neonworth-hide',newValue:'false',storageArea:storage});assert.deepEqual(state.preferences,selected);
stored.set(LEGACY_WORKSPACE_PREFERENCES_KEY,JSON.stringify({version:1,density:'comfortable',pinnedReports:[]}));
changed({key:LEGACY_WORKSPACE_PREFERENCES_KEY,newValue:stored.get(LEGACY_WORKSPACE_PREFERENCES_KEY),storageArea:storage});assert.deepEqual(state.preferences,selected,'Older tabs cannot overwrite v2 choices');
stored.set(LEGACY_WORKSPACE_PREFERENCES_KEY,JSON.stringify(legacy));
changed({key:WORKSPACE_PREFERENCES_KEY,newValue:JSON.stringify(DEFAULT_WORKSPACE_PREFERENCES),storageArea:{}});assert.deepEqual(state.preferences,selected);
changed({key:WORKSPACE_PREFERENCES_KEY,newValue:'invalid JSON',storageArea:storage});assert.deepEqual(state.preferences,selected,'Malformed cross-tab data does not reset safe choices');
stored.delete(WORKSPACE_PREFERENCES_KEY);
changed({key:WORKSPACE_PREFERENCES_KEY,newValue:null,storageArea:storage});assert.deepEqual(state.preferences,migrated,'Removing v2 uses the same legacy fallback as a fresh read');
stored.delete(LEGACY_WORKSPACE_PREFERENCES_KEY);
changed({key:WORKSPACE_PREFERENCES_KEY,newValue:null,storageArea:storage});assert.deepEqual(state.preferences,DEFAULT_WORKSPACE_PREFERENCES);
changed({key:WORKSPACE_PREFERENCES_KEY,newValue:JSON.stringify(selected),storageArea:storage});assert.deepEqual(state.preferences,selected);
changed({key:null,newValue:null,storageArea:storage});assert.deepEqual(state.preferences,DEFAULT_WORKSPACE_PREFERENCES,'A browser storage clear resets display choices only');
const savePreferences=bind(save,scope);assert.equal(savePreferences(selected),true);assert.equal(state.persistence,'saved');
const blocked=bind(save,{...scope,window:{get localStorage(){throw new Error('blocked');}}});
assert.equal(blocked(DEFAULT_WORKSPACE_PREFERENCES),false);assert.deepEqual(state.preferences,DEFAULT_WORKSPACE_PREFERENCES);assert.equal(state.persistence,'session','Blocked persistence still applies a tab-local choice');
assert.equal(stored.get('neonworth-hide'),'true');cleanup();assert.equal(listeners.size,0);

// Invoke the actual dialog's explicit Save callback, not a hand-written save.
const control=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='WorkspacePreferencesControl');
let explicitSave,saveButton;
function findControl(node){
 if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='save')explicitSave=node.initializer;
 if(ts.isJsxOpeningElement(node)&&node.tagName.getText(ast)==='button'&&node.attributes.properties.some(attr=>ts.isJsxAttribute(attr)&&attr.name.getText(ast)==='className'&&attr.initializer?.text==='button primary'))saveButton=node;
 ts.forEachChild(node,findControl);
}
findControl(control);assert.ok(explicitSave&&saveButton);
assert.equal(saveButton.attributes.properties.find(attr=>ts.isJsxAttribute(attr)&&attr.name.getText(ast)==='onClick').initializer.expression.getText(ast),'save');
const submitted=[],dialog={};
bind(explicitSave,{density:'compact',motion:'quiet',pins:['goals','','income'],isWorkspaceReportId:(value)=>WORKSPACE_REPORTS.some(report=>report.id===value),savePreferences:value=>{submitted.push(value);return true;},setFeedback:value=>{dialog.feedback=value;},setOpen:value=>{dialog.open=value;}})();
assert.deepEqual(submitted,[{version:2,density:'compact',motion:'quiet',pinnedReports:['goals','income']}]);assert.equal(dialog.open,false);

// Render and invoke the actual native fields. These handlers change a dialog
// draft only; the provider save closure above owns explicit persistence.
await mkdir('.sites-runtime',{recursive:true});
const dir=await mkdtemp(path.resolve('.sites-runtime/workspace-preferences-'));
try{
 const transpile=code=>ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 await writeFile(path.join(dir,'dialog.mjs'),transpile(await readFile('components/finance-dialog.tsx','utf8')));
 const js=transpile(source).replace(/(['"])@\/components\/finance-dialog\1/g,"'./dialog.mjs'").replace(/(['"])@\/lib\/(workspace-preferences|workspace-motion-policy)\1/g,(_,quote,name)=>JSON.stringify(pathToFileURL(path.resolve(`lib/${name}.ts`)).href));
 await writeFile(path.join(dir,'preferences.mjs'),js);
 const ui=await import(pathToFileURL(path.join(dir,'preferences.mjs')).href);
 const calls=[],props={density:'comfortable',motion:'expressive',pins:['','goals',''],onDensity:value=>calls.push(['density',value]),onMotion:value=>calls.push(['motion',value]),onPin:(index,value)=>calls.push(['pin',index,value])};
 const elements=node=>React.isValidElement(node)?[node,...React.Children.toArray(node.props.children).flatMap(elements)]:[];
 const tree=ui.WorkspacePreferencesFields(props),controls=elements(tree).filter(node=>node.type==='select');
 assert.equal(controls.length,5);assert.deepEqual(calls,[]);
 controls[0].props.onChange({target:{value:'compact'}});controls[0].props.onChange({target:{value:'invalid'}});
 controls[1].props.onChange({target:{value:'quiet'}});controls[1].props.onChange({target:{value:'expressive'}});controls[1].props.onChange({target:{value:'always'}});
 controls[2].props.onChange({target:{value:'income'}});controls[2].props.onChange({target:{value:'goals'}});controls[2].props.onChange({target:{value:'unknown-report'}});
 assert.deepEqual(calls,[['density','compact'],['motion','quiet'],['motion','expressive'],['pin',0,'income']]);
 const markup=renderToStaticMarkup(tree);assert.match(markup,/Layout density/);assert.match(markup,/Expressive/);assert.match(markup,/Quiet/);assert.match(markup,/aria-describedby="workspace-motion-description"/);assert.match(markup,/reduced-motion setting always takes priority/);assert.match(markup,/Shortcut 1/);assert.match(markup,/Shortcut 3/);assert.doesNotMatch(markup,/<input|<textarea|350\.00/);
 const shell=renderToStaticMarkup(React.createElement(ui.WorkspacePreferencesProvider,null,React.createElement(ui.WorkspacePreferencesControl,{container:null})));
 assert.match(shell,/aria-label="Personalize workspace"/);assert.match(shell,/<span>Personalize<\/span>/);assert.match(shell,/disabled=""/,'SSR waits for browser preferences before allowing edits');
}finally{await rm(dir,{recursive:true,force:true});}
console.log('Workspace preferences: strict v2 motion enums, read-only legacy migration, v2 precedence, explicit browser persistence, blocked storage, cross-tab removal/clear, untouched privacy key, actual Save callback, native draft controls and SSR-safe initialization passed.');
