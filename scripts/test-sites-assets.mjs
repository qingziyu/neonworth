import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SITES_ASSET_PREFIX, sitesAssetPath } from '../profiles/sites/asset-paths.mjs';
import { prepareSitesAssets, verifySitesAssets } from './prepare-sites-assets.mjs';

assert.equal(sitesAssetPath(`${SITES_ASSET_PREFIX}/_next/static/lazy-abc.js`),'/_next/static/lazy-abc.js');
assert.equal(sitesAssetPath(`${SITES_ASSET_PREFIX}/_next/static/nested/style.css`),'/_next/static/nested/style.css');
for(const path of ['/api/data','/_next/static/app.js',`${SITES_ASSET_PREFIX}/_next/static/`,`${SITES_ASSET_PREFIX}/_next/static/../api`,`${SITES_ASSET_PREFIX}/_next/static/a//b`,`${SITES_ASSET_PREFIX}/_next/static/%2e%2e/b`,`${SITES_ASSET_PREFIX}/_next/static/a\\b`,`${SITES_ASSET_PREFIX}/_next/static/a?b`])assert.equal(sitesAssetPath(path),null);

const temporary=mkdtempSync(join(tmpdir(),'neonworth-sites-assets-'));
function fixture(name){
  const root=join(temporary,name),client=join(root,'dist/client'),source=join(client,SITES_ASSET_PREFIX,'_next/static');
  mkdirSync(source,{recursive:true});mkdirSync(join(client,'.vite'));
  const manifest={app:{file:'__neonworth_assets/_next/static/app.js',css:['__neonworth_assets/_next/static/app.css'],dynamicImports:['lazy']},lazy:{file:'__neonworth_assets/_next/static/lazy.js'}};
  writeFileSync(join(client,'.vite/manifest.json'),JSON.stringify(manifest));
  writeFileSync(join(source,'app.js'),'import("./lazy.js");');writeFileSync(join(source,'lazy.js'),'export default "synthetic";');writeFileSync(join(source,'app.css'),':root{color:cyan}');
  return{root,client,source,manifest};
}
try{
  const {root,client,source,manifest}=fixture('valid');
  assert.throws(()=>verifySitesAssets(root),/namespace/);
  prepareSitesAssets(root);verifySitesAssets(root);
  assert.equal(existsSync(source),false);assert.equal(existsSync(join(client,SITES_ASSET_PREFIX)),false);
  assert.equal(readFileSync(join(client,'_next/static/app.js'),'utf8'),'import("./lazy.js");');
  assert.deepEqual(JSON.parse(readFileSync(join(client,'.vite/manifest.json'),'utf8')),manifest,'Runtime metadata keeps Worker URLs while packaged file paths change');
  mkdirSync(join(client,SITES_ASSET_PREFIX));assert.throws(()=>verifySitesAssets(root),/namespace/);rmSync(join(client,SITES_ASSET_PREFIX),{recursive:true});
  const bad=structuredClone(manifest);bad.app.file='_next/static/app.js';writeFileSync(join(client,'.vite/manifest.json'),JSON.stringify(bad));assert.throws(()=>verifySitesAssets(root),/Worker asset namespace/);
  const collision=fixture('collision');mkdirSync(join(collision.client,'_next/static'),{recursive:true});assert.throws(()=>prepareSitesAssets(collision.root),/conflicting/);assert.equal(existsSync(join(collision.source,'app.js')),true);
  const extra=fixture('extra');writeFileSync(join(extra.client,SITES_ASSET_PREFIX,'unexpected'),'wrong namespace');assert.throws(()=>prepareSitesAssets(extra.root),/conflicting/);assert.equal(existsSync(join(extra.source,'app.js')),true);
  const link=fixture('symlink');symlinkSync(join(link.source,'app.js'),join(link.source,'linked.js'));assert.throws(()=>prepareSitesAssets(link.root),/regular files/);assert.equal(existsSync(join(link.source,'app.js')),true);
  const missing=fixture('missing');rmSync(join(missing.source,'lazy.js'));assert.throws(()=>prepareSitesAssets(missing.root),/ENOENT/);
}finally{rmSync(temporary,{recursive:true,force:true})}
console.log('Sites assets: exact namespace mapping, immutable client URLs, post-build relocation, metadata/file checks and collision/symlink/malformed-path rejection passed.');
