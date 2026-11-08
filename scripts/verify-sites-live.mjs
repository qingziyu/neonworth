import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { readHiddenJSON } from './hidden-json.mjs';
import { inspectPrivateSite, comparePrivateSiteEvidence, SiteVerificationError } from './sites-live-evidence.mjs';

try {
  const args=process.argv.slice(2), options={};
  for(let i=0;i<args.length;i+=2){
    if(!['--output','--compare'].includes(args[i]) || !args[i+1] || options[args[i]]) throw new SiteVerificationError('invalid_arguments');
    options[args[i]]=args[i+1];
  }
  // Instance evidence contains an origin and must remain in ignored local state.
  const evidencePath = async value => {
    const root=resolve('outputs'), path=resolve(value), suffix=relative(root,path);
    if(!suffix || suffix.startsWith('..') || resolve(path)===root || !path.endsWith('.json')) throw new SiteVerificationError('evidence_path_must_be_under_outputs');
    for(let parent=dirname(path);;parent=dirname(parent)){
      try{if((await lstat(parent)).isSymbolicLink())throw new SiteVerificationError('evidence_symlink_not_allowed');}
      catch(error){if(error.code!=='ENOENT')throw error;}
      if(parent===root)break;
    }
    return path;
  };
  const input=await readHiddenJSON('Ready for Site verification JSON on stdin',32_000);
  const evidence=await inspectPrivateSite(input);
  if(options['--compare']) comparePrivateSiteEvidence(JSON.parse(await readFile(await evidencePath(options['--compare']),'utf8')),evidence);
  if(options['--output']){
    const path=await evidencePath(options['--output']);await mkdir(dirname(path),{recursive:true});
    await writeFile(path,JSON.stringify(evidence,null,2)+'\n',{flag:'wx',mode:0o600});
  }
  console.log('Owner-private Site HTTP checks passed. Record hashes verified; desktop browser and native MCP acceptance remain separate.');
} catch(error) {
  console.error(error instanceof SiteVerificationError ? 'Site verification failed: '+error.message : 'Site verification could not complete; private diagnostics were withheld.');
  process.exitCode=1;
}
