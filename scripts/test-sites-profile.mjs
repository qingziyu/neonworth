import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { selectBuildProfile } from './build-profile.mjs';
import { registerHooks } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateSitesManifest, inspectSitesModuleGraph } from './sites-profile.mjs';
import { setupSitesInstance } from './setup-sites.mjs';
import { allowedSitesSource, exportSitesSource } from './export-sites.mjs';
import { verifySitesBuildConfiguration, verifySitesBuild } from './verify-sites-build.mjs';
import { rejectSitesRequest } from '../worker/sites-policy.ts';

const paths=['worker/sites.ts','worker/sites-policy.ts'].map(path=>resolve(path));
assert.ok(inspectSitesModuleGraph(paths,process.cwd()));
assert.throws(()=>inspectSitesModuleGraph([...paths,resolve('worker/access.ts')],process.cwd()),/unsupported Worker/);
assert.equal(inspectSitesModuleGraph([resolve('worker/index.ts')],process.cwd()),null);
const valid={project_id:'synthetic-site-id',d1:'DB',r2:null,capabilities:['mcp']};
assert.equal(validateSitesManifest(valid),valid);
for(const change of [{d1:'OTHER'},{r2:'BUCKET'},{static:{directory:'dist'}},{connectors:[]},{plugins:{}},{capabilities:[]},{capabilities:['mcp','other']},{project_id:''}])assert.throws(()=>validateSitesManifest({...valid,...change}),/Sites requires/);
for(const target of ['outputs/private.json','.wrangler/state/data','node_modules/library.js','.git/config','.openai/hosting.json','.env','lib/.env.local','lib/key.pem','../app/page.tsx','app/../secrets'])assert.equal(allowedSitesSource(target),false);
for(const target of ['app/page.tsx','drizzle/0000.sql','profiles/sites/wrangler.jsonc','scripts/test-sites-profile.mjs','pnpm-lock.yaml', 'contracts/dataset.schema.json', '.github/workflows/ci.yml', '.agents/plugins/marketplace.json', 'plugin.json'])assert.equal(allowedSitesSource(target),true);

const temporary=mkdtempSync(join(tmpdir(),'neonworth-sites-contract-'));
const git=(root,args)=>{const result=spawnSync('git',['-C',root,'-c','core.hooksPath=/dev/null',...args],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout};
try {
  const source=join(temporary,'source');mkdirSync(source);
  for(const [file,content] of Object.entries({'package.json':'{}','vite.sites.config.ts':'export default {};','worker/sites.ts':'export default {};','profiles/sites/hosting.example.json':JSON.stringify({d1:'DB',r2:null,capabilities:['mcp']}),'.gitignore':'/.openai/\n/node_modules/\n','app/page.tsx':'synthetic source','outputs/private.json':'not exported','.env':'not exported'})){
    mkdirSync(resolve(source,file,'..'),{recursive:true});writeFileSync(join(source,file),content);
  }
  git(source,['init','--quiet']);git(source,['add','.']);git(source,['-c','user.name=Synthetic Test','-c','user.email=synthetic@example.invalid','-c','commit.gpgsign=false','commit','--quiet','-m','synthetic source']);
  const destination=join(temporary,'instance');
  const result=exportSitesSource(source,destination);
  assert.match(result.revision,/^[a-f0-9]{40}$/);assert.equal(result.initialized,true);
  assert.equal(readFileSync(join(destination,'app/page.tsx'),'utf8'),'synthetic source');
  for(const excluded of ['.git','.env','outputs/private.json'])assert.equal(existsSync(join(destination,excluded)),false);
  assert.doesNotMatch(readFileSync(join(destination,'.gitignore'),'utf8'),/\.openai/);
  assert.deepEqual(JSON.parse(readFileSync(join(destination,'.openai/hosting.json'),'utf8')),{d1:'DB',r2:null,capabilities:['mcp']});
  assert.throws(()=>setupSitesInstance(destination),/already exists/);
  assert.throws(()=>exportSitesSource(source,destination),/new or empty/);
  assert.throws(()=>exportSitesSource(source,temporary),/must not contain/);
  assert.throws(()=>exportSitesSource(source,join(source,'instance')),/must not contain/);
  assert.throws(()=>exportSitesSource(source,join(source,'..foo','instance')),/must not contain/);
  assert.throws(()=>selectBuildProfile(destination),/explicit Sites build/);assert.equal(selectBuildProfile(destination,'sites'),'sites');
  git(source,['update-index','--assume-unchanged','app/page.tsx']);writeFileSync(join(source,'app/page.tsx'),'unreviewed working bytes');
  const immutable=join(temporary,'immutable');exportSitesSource(source,immutable);assert.equal(readFileSync(join(immutable,'app/page.tsx'),'utf8'),'synthetic source');
  git(source,['update-index','--no-assume-unchanged','app/page.tsx']);git(source,['checkout','--','app/page.tsx']);
  writeFileSync(join(source,'app/page.tsx'),'dirty');assert.throws(()=>exportSitesSource(source,join(temporary,'dirty-instance')),/Commit and review/);
  git(source,['checkout','--','app/page.tsx']);
  symlinkSync(join(source,'app/page.tsx'),join(source,'app/symlink.ts'));git(source,['add','app/symlink.ts']);git(source,['-c','user.name=Synthetic Test','-c','user.email=synthetic@example.invalid','-c','commit.gpgsign=false','commit','--quiet','-m','synthetic link']);
  assert.throws(()=>exportSitesSource(source,join(temporary,'linked-instance')),/never symlinks/);

  const built=join(temporary,'built');mkdirSync(join(built,'.openai'),{recursive:true});mkdirSync(join(built,'dist/.openai/drizzle/meta'),{recursive:true});mkdirSync(join(built,'dist/server'),{recursive:true});
  mkdirSync(join(built,'dist/client/.vite'),{recursive:true});mkdirSync(join(built,'dist/client/_next/static'),{recursive:true});
  writeFileSync(join(built,'dist/client/.vite/manifest.json'),JSON.stringify({app:{file:'__neonworth_assets/_next/static/app.js',css:['__neonworth_assets/_next/static/app.css']}}));
  writeFileSync(join(built,'dist/client/_next/static/app.js'),'synthetic JS');writeFileSync(join(built,'dist/client/_next/static/app.css'),'synthetic CSS');
  const config={main:'index.js',assets:{binding:'ASSETS',run_worker_first:true,directory:'../client'},vars:{SITES_LOCAL_DEV:'false'},workers_dev:false,preview_urls:false,d1_databases:[{binding:'DB'}]};
  const saved=structuredClone(config);assert.doesNotThrow(()=>verifySitesBuildConfiguration(config));assert.deepEqual(config,saved);
  for(const changed of [{assets:{binding:'ASSETS',run_worker_first:false}},{vars:{SITES_LOCAL_DEV:'true'}},{vars:{SITES_LOCAL_DEV:'false',SOURCE_SECRET:'synthetic'}},{workers_dev:true},{preview_urls:true},{services:[{binding:'CONNECTORS'}]},{r2_buckets:[{binding:'BUCKET'}]},{d1_databases:[{binding:'OTHER'}]},{routes:['example.invalid/*']},{kv_namespaces:[{binding:'OTHER'}]},{ai:{binding:'AI'}},{durable_objects:{bindings:[{name:'OTHER'}]}},{main:'wrong.js'}])assert.throws(()=>verifySitesBuildConfiguration({...config,...changed}),/unexpected bindings/);
  for(const file of ['.openai/hosting.json','dist/.openai/hosting.json'])writeFileSync(join(built,file),JSON.stringify(valid));
  writeFileSync(join(built,'dist/server/wrangler.json'),JSON.stringify(config));writeFileSync(join(built,'dist/server/index.js'),'export default {fetch(){}}');writeFileSync(join(built,'dist/.openai/drizzle/meta/_journal.json'),'{}');
  writeFileSync(join(built,'dist/server/sites-profile-proof.json'),JSON.stringify({version:1,profile:'sites-owner-private',entry:'index.js',modules:['worker/sites.ts','worker/sites-policy.ts'],sha256:createHash('sha256').update(readFileSync(join(built,'dist/server/index.js'))).digest('hex')}));
  verifySitesBuild(built);
  writeFileSync(join(built,'dist/server/index.js'),'wrong Worker entry');assert.throws(()=>verifySitesBuild(built),/verification failed/);
  writeFileSync(join(built,'dist/server/index.js'),'export default {fetch(){}}');
  git(built,['init','--quiet']);assert.throws(()=>verifySitesBuild(built),/verification failed/,'An existing private Git root must track its manifest');
  git(built,['add','.openai/hosting.json']);verifySitesBuild(built);
  writeFileSync(join(built,'dist/.openai/hosting.json'),JSON.stringify({...valid,project_id:'different-instance'}));assert.throws(()=>verifySitesBuild(built),/verification failed/);
} finally {rmSync(temporary,{recursive:true,force:true})}

for(const headers of [{origin:'https://other.invalid'},{'sec-fetch-site':'cross-site'},{origin:'null'},{host:'other.invalid'}]){
  const request=new Request('https://synthetic.example/api/import',{method:'POST',headers:{...headers,'oai-authenticated-user-id':'forged-owner','oai-sites-authorization':'Bearer synthetic'}});
  assert.equal(rejectSitesRequest(request)?.status,403,'Identity/bearer strings cannot bypass the same-origin boundary');
}
assert.equal(rejectSitesRequest(new Request('http://127.0.0.1:5173/api/data'))?.status,403);
assert.equal(rejectSitesRequest(new Request('http://127.0.0.1:5173/api/data'),true),null);
assert.equal(rejectSitesRequest(new Request('http://remote.invalid/api/data'),true)?.status,403);

// These are requests already admitted by a simulated private Sites Dispatch,
// not proof of platform authentication. Service access intentionally has no
// visitor identity after Dispatch validates/consumes its service credential.
let appCalls=0, assetCalls=0, captured;
const original=globalThis.__sitesSyntheticHandler;
globalThis.__sitesSyntheticHandler={fetch:async(request,env,ctx)=>{appCalls++;captured={request,env,ctx};return Response.json({body:await request.text()})}};
const hook=registerHooks({resolve(specifier,context,next){return specifier==='vinext/server/fetch-handler'?{url:'data:text/javascript,export default globalThis.__sitesSyntheticHandler;',shortCircuit:true}:next(specifier,context)}});
try {
  const {default:worker}=await import('../worker/sites.ts');
  const assetRequests=[];
  const db={},assets={fetch:async request=>{assetCalls++;assetRequests.push(request);assert.equal(request.headers.get('authorization'),null);assert.equal(request.headers.get('oai-authenticated-user-id'),null);return new Response('asset',{headers:{'cache-control':'public, max-age=31536000'}})}};
  const env={DB:db,ASSETS:assets,BUCKET:{},SOURCE_SECRET:'synthetic-secret',get CONNECTORS(){throw new Error('Grant must not be read')}};
  const ctx={waitUntil(){},passThroughOnException(){},abort(){},props:{CONNECTORS:{invoke(){throw new Error('must not invoke')}}},exports:{private:true}};
  for(const headers of [{},{authorization:'Bearer synthetic','oai-sites-authorization':'Bearer synthetic','oai-authenticated-user-id':'synthetic-owner',cookie:'session=synthetic','cf-access-jwt-assertion':'synthetic'}]){
    const response=await worker.fetch(new Request('https://synthetic.example/mcp',{method:'POST',headers,body:'{"jsonrpc":"2.0","id":1,"method":"server/discover"}'}),env,ctx);
    assert.equal(response.status,200);assert.match((await response.json()).body,/server\/discover/);
    assert.deepEqual(captured.env,{DB:db,ASSETS:assets});assert.deepEqual(captured.ctx.props,{});assert.deepEqual(captured.ctx.exports,{});
    for(const key of ['authorization','cookie','cf-access-jwt-assertion','oai-sites-authorization','oai-authenticated-user-id'])assert.equal(captured.request.headers.get(key),null);
    assert.match(response.headers.get('cache-control'),/private, no-store/);
  }
  const denied=await worker.fetch(new Request('https://synthetic.example/api/import',{method:'POST',headers:{origin:'https://other.invalid'},body:'synthetic'}),env,ctx);assert.equal(denied.status,403);assert.equal(appCalls,2);
  const staticResponse=await worker.fetch(new Request('https://synthetic.example/_next/static/app.js',{headers:{authorization:'Bearer synthetic','oai-authenticated-user-id':'synthetic'}}),env,ctx);assert.equal(await staticResponse.text(),'asset');assert.equal(assetCalls,1);assert.equal(appCalls,2);
  for(const method of ['GET','HEAD']){
    const response=await worker.fetch(new Request('https://synthetic.example/__neonworth_assets/_next/static/lazy.js?v=1',{method,headers:{authorization:'Bearer synthetic',cookie:'synthetic','oai-sites-authorization':'Bearer synthetic'}}),env,ctx);
    assert.equal(response.status,200);assert.equal(assetRequests.at(-1).url,'https://synthetic.example/_next/static/lazy.js?v=1');assert.equal(assetRequests.at(-1).method,method);
    for(const key of ['authorization','cookie','oai-sites-authorization'])assert.equal(assetRequests.at(-1).headers.get(key),null);
    assert.equal(response.headers.get('cache-control'),'private, no-store, max-age=0');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.ok(response.headers.get('content-security-policy'));assert.ok(response.headers.get('strict-transport-security'));
  }
  for(const path of ['/__neonworth_assets','/__neonworth_assets/api/data','/__neonworth_assets/_next/static/','/__neonworth_assets/_next/static/%2fapp.js','/__neonworth_assets/_next/static/a//app.js'])assert.equal((await worker.fetch(new Request('https://synthetic.example'+path),env,ctx)).status,404);
  assert.equal((await worker.fetch(new Request('https://synthetic.example/__neonworth_assets/_next/static/lazy.js',{method:'POST'}),env,ctx)).status,404);
  assert.equal(assetCalls,3);assert.equal(appCalls,2,'Malformed/mutation asset requests never reach application or asset handlers');
} finally {hook.deregister();globalThis.__sitesSyntheticHandler=original}
console.log('Sites profile: isolated tracked-source export, manifest/binding/build mutations, no-overwrite setup, post-Dispatch request/body isolation, fixed origin denial and credential-free asset/app forwarding passed. Native audience/authentication requires live verification.');
