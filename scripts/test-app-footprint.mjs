// Pure source/manifest fixtures run in CI before any dist build exists.
import assert from 'node:assert/strict';
import { layoutClientReferences } from './app-footprint-layout.mjs';

const layout = background => `import type { Metadata } from 'next';
import './globals.css';
import { WorkspacePreferencesProvider as Preferences } from './workspace-preferences';
${background ? "import { WorkspaceBackground } from './workspace-background';" : ''}
export default function RootLayout({children}:{children:React.ReactNode}) {
 return <html><body><Preferences>${background ? '<WorkspaceBackground/>' : ''}{children}</Preferences></body></html>;
}`;
const register = (name,id) => `Y(()=>{throw Error(\`Unexpectedly client reference export '${name}' is called on server\`)},\`${id}\`,\`${name}\`)`;
const server = `const a=${register('WorkspacePreferencesProvider','abc123')},b=${register('WorkspaceBackground','def456')},c=${register('LayoutSegmentProvider','fed789')};`;
const groups = {
 abc123:{js:['/preferences.js','/shared.js'],css:['/preferences.css']},
 def456:{js:['/background.js','/shared.js'],css:['/background.css']},
 fed789:{js:['/segments.js','/shared.js'],css:[]},
};
const resolve = overrides => layoutClientReferences({layoutSource:layout(true),serverSource:server,clientReferenceDeps:groups,...overrides});
const roots=resolve();
assert.deepEqual(roots.map(({exportName,referenceId,kind})=>({exportName,referenceId,kind})),[
 {exportName:'WorkspacePreferencesProvider',referenceId:'abc123',kind:'application'},
 {exportName:'WorkspaceBackground',referenceId:'def456',kind:'application'},
 {exportName:'LayoutSegmentProvider',referenceId:'fed789',kind:'framework'},
]);
assert.deepEqual([...new Set(roots.flatMap(root=>root.dependencies.js))],['/preferences.js','/shared.js','/background.js','/segments.js'],'Both independent application and framework groups participate');
assert.deepEqual(resolve({layoutSource:layout(false)}).map(root=>root.exportName),['WorkspacePreferencesProvider','LayoutSegmentProvider'],'The unchanged baseline has no background root, but includes framework layout hydration');
const quoted=server.replaceAll('`','"');assert.deepEqual(resolve({serverSource:quoted}),roots,'Quote style does not change static registrations');
const decoy=`/* ${register('WorkspaceBackground','cccccc')} */ const text=${JSON.stringify(register('WorkspaceBackground','bbbbbb'))};`;
assert.deepEqual(resolve({serverSource:server+decoy}),roots,'Comments and string contents are never executable registration evidence');
assert.deepEqual(resolve({serverSource:server+`;const d=${register('WorkspaceBackground','def456')};`}),roots,'Repeated references to the same module remain unambiguous');
for(const overrides of [
 {layoutSource:layout(true).replace('<WorkspaceBackground/>','<Unknown/>')},
 {layoutSource:layout(true).replace("'./workspace-background'","'./some-other-module'")},
 {layoutSource:layout(true).replace('function RootLayout','function DifferentLayout')},
 {layoutSource:layout(true).replaceAll('Preferences>','section>')},
 {serverSource:server.replace(register('WorkspaceBackground','def456'),'null')},
 {serverSource:server.replace(register('LayoutSegmentProvider','fed789'),'null')},
 {serverSource:server+`;const d=${register('WorkspaceBackground','123def')};`},
 {serverSource:server.replace("export 'WorkspaceBackground'","export 'WrongName'")},
 {serverSource:server.replace('def456','../bad-id')},
 {serverSource:server+' syntax {'},
 {clientReferenceDeps:{...groups,def456:undefined}},
 {clientReferenceDeps:{...groups,fed789:{js:[],css:[]}}},
 {clientReferenceDeps:{...groups,def456:{js:['/background.js']}}},
]) assert.throws(()=>resolve(overrides),error=>error.code==='LAYOUT_GRAPH_UNRESOLVED','Unknown, missing, malformed or ambiguous layout boundaries fail closed');
console.log('App footprint roots: application layout roots, optional baseline background, framework segment hydration, deduplicated module identities, nonexecuted decoys and fail-closed changes passed without build artifacts.');
