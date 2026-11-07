import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Execute the actual destination selector and click handler. Real focus, Tab,
// Escape and responsive geometry remain explicit browser acceptance gates.
const source = await readFile(new URL('../app/workspace-navigation.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('workspace-navigation.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const selector = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'filterWorkspaceDestinations');
const transpile = code => ts.transpileModule(code, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const filter = new Function(`${transpile(selector.getText(ast)).replace(/^export /m,'')}\nreturn filterWorkspaceDestinations;`)();
const destinations = [
  {name:'Goals',label:'Goals & FIRE',description:'Annual withdrawals and target dates',group:'Your finances',href:'/goals'},
  {name:'Transactions',label:'Transactions',description:'Source records and accounting decisions',group:'Activity & review',href:'/?view=transactions'},
];
assert.deepEqual(filter(destinations,' FIRE  target '),[destinations[0]]);
assert.deepEqual(filter(destinations,'review records'),[destinations[1]]);
assert.deepEqual(filter(destinations,'not present'),[]);
assert.deepEqual(filter(destinations,''),destinations);
let click;
const walk = node => {
  if(ts.isJsxOpeningElement(node) && node.tagName.getText(ast)==='a'){
    click=node.attributes.properties.find(attribute=>ts.isJsxAttribute(attribute)&&attribute.name.getText(ast)==='onClick')?.initializer?.expression;
  }
  ts.forEachChild(node,walk);
};
walk(ast);assert.ok(click,'real anchor click handler exists');
const calls=[];
const handle=new Function('onDismiss','onSelect','destination',`${transpile(`const click = (${click.getText(ast)});`)}\nreturn click;`)(()=>calls.push('close'),name=>calls.push(name),destinations[0]);
for(const modifier of ['metaKey','ctrlKey','shiftKey','altKey']){
  handle({button:0,[modifier]:true,preventDefault(){calls.push('prevent')}});
  assert.deepEqual(calls,[],`${modifier} retains browser-native navigation`);
}
handle({button:1,preventDefault(){calls.push('prevent')}});assert.deepEqual(calls,[],'middle click remains native');
handle({button:0,preventDefault(){calls.push('prevent')}});
assert.deepEqual(calls,['prevent','close','Goals'],'normal navigation closes the modal before changing the view');
console.log('Workspace search and native navigation semantics passed; browser focus checks pending.');
