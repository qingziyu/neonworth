import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, unlinkSync, symlinkSync, chmodSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { exportSitesSource } from './export-sites.mjs';
import { upgradeSitesSource, SitesUpgradeConflict } from './upgrade-sites.mjs';

const temporary=mkdtempSync(join(tmpdir(),'neonworth-upgrade-'));
const git=(root,args)=>{const r=spawnSync('git',['-C',root,'-c','core.hooksPath=/dev/null',...args],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim()};
const put=(root,path,text)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),text)};
const read=(root,path)=>readFileSync(join(root,path),'utf8');
const commit=root=>{git(root,['add','-A']);git(root,['-c','user.name=Synthetic','-c','user.email=synthetic@example.invalid','-c','commit.gpgsign=false','commit','--quiet','-m','synthetic checkpoint']);return git(root,['rev-parse','HEAD'])};
function fixture(name){
 const source=join(temporary,name+'-source');mkdirSync(source);git(source,['init','--quiet']);
 for(const [path,text] of Object.entries({'package.json':'{}','vite.sites.config.ts':'export default {};','worker/sites.ts':'export default {};','profiles/sites/hosting.example.json':'{"d1":"DB","r2":null,"capabilities":["mcp"]}', '.gitignore':'/.openai/\n/.wrangler/\n/node_modules/\n/private-backups/\n/wrangler.jsonc\n','app/changed.ts':'base','app/deleted.ts':'old','app/custom.ts':'base custom','lib/finance-config.ts':'UTC'}))put(source,path,text);
 const revision=commit(source),instance=join(temporary,name+'-instance');exportSitesSource(source,instance);git(instance,['init','--quiet']);
 put(instance,'.openai/hosting.json','{"project_id":"synthetic-existing-site","d1":"DB","r2":null,"capabilities":["mcp"]}');
 put(instance,'.wrangler/state/db.sqlite','synthetic DB bytes');put(instance,'private-backups/backup.json','synthetic retained backup');put(instance,'wrangler.jsonc','synthetic private config');
 put(instance,'app/custom.ts','private customization');put(instance,'lib/finance-config.ts','America/Los_Angeles');put(instance,'custom-notes.txt','unrelated tracked file');commit(instance);
 return{source,instance,revision,hosting:read(instance,'.openai/hosting.json')};
}
function next(f){put(f.source,'app/changed.ts','new');unlinkSync(join(f.source,'app/deleted.ts'));put(f.source,'app/new/nested.ts','added');put(f.source,'.gitignore','/.openai/\n/.wrangler/\n/node_modules/\n/private-backups/\n/wrangler.jsonc\n/new-cache/\n');return commit(f.source)}
function preserved(f){assert.equal(read(f.instance,'.openai/hosting.json'),f.hosting);assert.equal(read(f.instance,'.wrangler/state/db.sqlite'),'synthetic DB bytes');assert.equal(read(f.instance,'private-backups/backup.json'),'synthetic retained backup');assert.equal(read(f.instance,'wrangler.jsonc'),'synthetic private config');assert.equal(read(f.instance,'lib/finance-config.ts'),'America/Los_Angeles');assert.equal(read(f.instance,'custom-notes.txt'),'unrelated tracked file')}
try{
 const f=fixture('success'),newRevision=next(f);const result=upgradeSitesSource(f.source,f.instance);
 assert.equal(result.from,f.revision);assert.equal(result.to,newRevision);assert.equal(read(f.instance,'app/changed.ts'),'new');assert.equal(existsSync(join(f.instance,'app/deleted.ts')),false);assert.equal(read(f.instance,'app/new/nested.ts'),'added');assert.equal(read(f.instance,'app/custom.ts'),'private customization');
 assert.doesNotMatch(read(f.instance,'.gitignore'),/^\/\.openai\//m);assert.match(read(f.instance,'.gitignore'),/new-cache/);assert.equal(JSON.parse(read(f.instance,'.openai/template.json')).upstreamRevision,newRevision);assert.equal(git(f.instance,['ls-files','.openai/hosting.json']),'.openai/hosting.json');preserved(f);
 commit(f.instance);assert.deepEqual(upgradeSitesSource(f.source,f.instance).changed,[],'Already-current source does not reapply files');

 const conflict=fixture('conflict');put(conflict.instance,'app/changed.ts','local independent edit');commit(conflict.instance);next(conflict);const oldProvenance=read(conflict.instance,'.openai/template.json');
 assert.throws(()=>upgradeSitesSource(conflict.source,conflict.instance),error=>error instanceof SitesUpgradeConflict&&error.paths.join(',')==='app/changed.ts');
 assert.equal(read(conflict.instance,'app/changed.ts'),'local independent edit');assert.equal(read(conflict.instance,'app/deleted.ts'),'old');assert.equal(existsSync(join(conflict.instance,'app/new/nested.ts')),false);assert.equal(read(conflict.instance,'.openai/template.json'),oldProvenance);assert.equal(git(conflict.instance,['status','--porcelain','--untracked-files=no']),'');preserved(conflict);

 const collision=fixture('collision');next(collision);put(collision.instance,'app/new/nested.ts','untracked work');assert.throws(()=>upgradeSitesSource(collision.source,collision.instance),error=>error instanceof SitesUpgradeConflict&&error.paths.includes('app/new/nested.ts'));assert.equal(read(collision.instance,'app/changed.ts'),'base');assert.equal(read(collision.instance,'app/new/nested.ts'),'untracked work');preserved(collision);

 for(const stage of [1,4]){
  const rollback=fixture('rollback'+stage);next(rollback);const before=read(rollback.instance,'.openai/template.json');
  assert.throws(()=>upgradeSitesSource(rollback.source,rollback.instance,{beforeWrite:index=>{if(index===stage)throw Error('synthetic I/O failure')}}),/previous source files and provenance were restored/);
  assert.equal(read(rollback.instance,'app/changed.ts'),'base');assert.equal(read(rollback.instance,'app/deleted.ts'),'old');assert.equal(existsSync(join(rollback.instance,'app/new/nested.ts')),false);assert.equal(read(rollback.instance,'.openai/template.json'),before);assert.equal(git(rollback.instance,['status','--porcelain','--untracked-files=no']),'');preserved(rollback);
 }
 const preRename=fixture('pre-rename');next(preRename);const originalProvenance=read(preRename.instance,'.openai/template.json');let injected=false;
 assert.throws(()=>upgradeSitesSource(preRename.source,preRename.instance,{beforeRename:path=>{if(path==='app/new/nested.ts'){injected=true;assert.equal(existsSync(join(preRename.instance,path)),false);throw Error('synthetic rename failure')}}}),/previous source files and provenance were restored/);
 assert.equal(injected,true,'The failure occurs after staging a new file but before installing it');
 assert.equal(read(preRename.instance,'app/changed.ts'),'base');assert.equal(read(preRename.instance,'app/deleted.ts'),'old');assert.equal(existsSync(join(preRename.instance,'app/new')),false,'Rollback removes the unneeded new directory');assert.equal(read(preRename.instance,'.openai/template.json'),originalProvenance);assert.equal(git(preRename.instance,['status','--porcelain','--untracked-files=no']),'');preserved(preRename);
 const linked=fixture('linked');next(linked);unlinkSync(join(linked.instance,'app/custom.ts'));symlinkSync(join(linked.instance,'app/changed.ts'),join(linked.instance,'app/custom.ts'));commit(linked.instance);assert.throws(()=>upgradeSitesSource(linked.source,linked.instance),/symbolic link/);assert.equal(read(linked.instance,'app/changed.ts'),'base');
 const unknown=fixture('unknown');put(unknown.instance,'.openai/template.json',JSON.stringify({version:1,upstreamRevision:'0'.repeat(40)}));commit(unknown.instance);next(unknown);assert.throws(()=>upgradeSitesSource(unknown.source,unknown.instance),/revision.*unavailable/);assert.equal(read(unknown.instance,'app/changed.ts'),'base');
 const same=fixture('same');put(same.instance,'app/changed.ts','new');commit(same.instance);next(same);assert.doesNotThrow(()=>upgradeSitesSource(same.source,same.instance));preserved(same);
 const mode=fixture('mode');chmodSync(join(mode.source,'app/changed.ts'),0o755);commit(mode.source);upgradeSitesSource(mode.source,mode.instance);assert.ok(statSync(join(mode.instance,'app/changed.ts')).mode&0o111,'Mode-only upstream changes preserve executable semantics');
 const dirty=fixture('dirty');next(dirty);put(dirty.instance,'app/custom.ts','uncommitted');assert.throws(()=>upgradeSitesSource(dirty.source,dirty.instance),/Commit and review/);
 console.log('Sites upgrade: independent Git roots, exact provenance, adds/changes/deletes, preserved customizations/config/manifest/DB/backups, transformed ignore, conflicts and untracked collisions before writes, symlink/unknown-base/dirty rejection, and executed partial/provenance/pre-rename rollback passed.');
}finally{rmSync(temporary,{recursive:true,force:true})}
