import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { verifyArchive, findingLocations, scannerBinary } from './scan-secrets.mjs';

const archive = Buffer.from('Synthetic scanner archive');
const digest = createHash('sha256').update(archive).digest('hex');
assert.doesNotThrow(() => verifyArchive(archive, digest));
assert.throws(() => verifyArchive(Buffer.from('tampered scanner'), digest), /checksum/);
assert.throws(() => verifyArchive(archive, 'not-a-digest'), /checksum/);

const sensitive = ['SYNTHETIC', 'NEVER', 'PRINT'].join('_');
const rendered = findingLocations([{ File: 'lib/config.ts', StartLine: 7, RuleID: 'generic-api-key', Secret: sensitive, Match: `key=${sensitive}`, CommitMessage: sensitive }]).join('\n');
assert.equal(rendered, 'lib/config.ts:7 (generic-api-key)');
assert.ok(!rendered.includes(sensitive), 'Scanner values and source snippets never reach diagnostic output.');
assert.deepEqual(findingLocations([]), []);
assert.throws(() => findingLocations({ Secret: sensitive }), /invalid report/);
assert.equal(findingLocations([{File:'bad\nfile',StartLine:-1,RuleID:'rule\nforged'}])[0], 'bad?file:? (rule?forged)');
console.log('Secret scanner verifies pinned downloads and emits only bounded location metadata.');


// Execute the pinned scanner against invented tokens. No project-specific
// allowlist may weaken any default credential rule.
const temporary=await mkdtemp(join(tmpdir(),'neonworth-scanner-regression-'));
try {
 const binary=await scannerBinary(temporary),source=join(temporary,'source');
 await mkdir(source);
 const synthetic=createHash('sha256').update('Synthetic scanner regression only; no service capability').digest('hex');
 const generic=['api','key'].join('_')+' = "'+synthetic+'"';
 const provider=['gh','p_'].join('')+synthetic.slice(0,36);
 await writeFile(join(source,'example.txt'),generic+'\n'+provider+'\n');
 const report=join(temporary,'report.json');
 const result=spawnSync(binary,['dir',source,'--config',resolve('.gitleaks.toml'),'--redact=100','--no-banner','--ignore-gitleaks-allow','--gitleaks-ignore-path',join(temporary,'absent-ignore-file'),'--report-format=json','--report-path',report],{encoding:'utf8',maxBuffer:1_000_000,timeout:30_000});
 assert.ok(!result.error&&result.status===1,'Pinned scanner must detect synthetic canaries; diagnostics intentionally withheld');
 const locations=JSON.parse(await readFile(report,'utf8')).map(item=>({rule:item.RuleID,line:item.StartLine}));
 assert.ok(locations.some(item=>item.rule==='generic-api-key'&&item.line===1));
 assert.ok(locations.some(item=>item.rule==='github-pat'&&item.line===2));
 assert.doesNotMatch(await readFile(resolve('.gitleaks.toml'),'utf8'),/allowlist/,'No personal false-positive exemptions ship in the template');
} finally { await rm(temporary,{recursive:true,force:true}); }
console.log('Pinned scanner detects invented generic and provider credentials with the unchanged default rules.');
