import { readFile, stat, realpath, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkpoint, collectionPlan, prepareCollection, verifyReadback, WorkflowError } from './contract.ts';

// Offline only. Native calls and credentials are deliberately outside this CLI.
const usage='Usage: plan <checkpoint.json> <new-output.json> [initial-start|--full-history] | prepare <checkpoint.json> <collection.json> <new-output.json> | verify <before.json> <after.json> <readback.json> <new-output.json> | blocked <capability-code> <new-output.json>';
const repo=await realpath(fileURLToPath(new URL('../../',import.meta.url)));
async function read(file){const info=await stat(file);if(!info.isFile()||info.size>32_000_000)throw new Error('size');return JSON.parse(await readFile(file,'utf8'));}
async function write(file,value){
 const parent=await realpath(path.dirname(path.resolve(file))),info=await stat(parent);
 if(parent===repo||parent.startsWith(repo+path.sep)||process.platform!=='win32'&&(info.mode&0o077)!==0)throw new WorkflowError('private_output_required','Output must be a new file in a private directory outside the checkout (mode 700 on Unix).');
 const handle=await open(path.join(parent,path.basename(file)),'wx',0o600);try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');}finally{await handle.close();}
}
try{
 const [command,...args]=process.argv.slice(2);let result,out;
 if(command==='blocked'&&args.length===2&&['finance_tools','structured_file_bridge','site_reads','owner_verification'].includes(args[0])){result={version:1,kind:'capability-blocker',stage:'preflight',capability:args[0],financeAuthorization:'already-authorized',operationCompleted:false,verification:'not-run',recordedAt:new Date().toISOString()};out=args[1];}
 else if(command==='plan'&&(args.length===2||args.length===3)){result=collectionPlan(checkpoint(await read(args[0])),args[2]==='--full-history'?undefined:args[2],new Date(),args[2]==='--full-history');out=args[1];}
 else if(command==='prepare'&&args.length===3){result=prepareCollection(checkpoint(await read(args[0])),await read(args[1])).payload;out=args[2];}
 else if(command==='verify'&&args.length===4){const receipt=await read(args[2]);result=await verifyReadback(checkpoint(await read(args[0])),checkpoint(await read(args[1])),receipt.collection,receipt.receipt,receipt.status,receipt.summaries);out=args[3];}
 else throw new WorkflowError('usage',usage);
 await write(out,result);console.log(command==='verify'?'Saved hash-only verification evidence.':'Saved private workflow artifact. No native calls or hosted writes were made.');
}catch(error){console.error(error instanceof WorkflowError?`${error.code}: ${error.message}`:`Validation failed. ${usage}. Input contents were not printed.`);process.exitCode=1;}
