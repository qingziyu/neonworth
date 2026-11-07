import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const configFile = join(root, '.gitleaks.toml');
const pin = JSON.parse(await readFile(new URL('./secret-scanner.json', import.meta.url), 'utf8'));
const digest = data => createHash('sha256').update(data).digest('hex');

export function verifyArchive(data, expected) {
  if (!/^[a-f0-9]{64}$/.test(expected) || digest(data) !== expected) throw new Error('Secret scanner archive checksum mismatch.');
}

// Never forward scanner stdout/stderr, Match, Secret, commit messages, or code
// snippets. Keep a minimal, bounded location so a finding can be fixed safely.
export function findingLocations(findings) {
  if (!Array.isArray(findings)) throw new Error('Secret scanner produced an invalid report.');
  return findings.map(finding => {
    const file = String(finding.File ?? '').replace(/[\x00-\x1f\x7f]/g, '?').slice(0, 240);
    const rule = String(finding.RuleID ?? '').replace(/[^a-zA-Z0-9_-]/g, '?').slice(0, 80);
    const line = Number.isSafeInteger(finding.StartLine) && finding.StartLine > 0 ? finding.StartLine : '?';
    return `${file}:${line} (${rule})`;
  });
}

export async function scannerBinary(temporary) {
  const asset = pin.assets[`${process.platform}-${process.arch}`];
  if (!asset) throw new Error('Secret scanning supports Linux and macOS x64/arm64. Run the pinned CI gate on other hosts.');
  const cache = join(root, '.sites-runtime', 'security-tools');
  await mkdir(cache, { recursive: true });
  const archivePath = join(cache, asset.file);
  let archive;
  try { archive = await readFile(archivePath); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!archive) {
    const response = await fetch(`https://github.com/gitleaks/gitleaks/releases/download/v${pin.version}/${asset.file}`, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error('Could not download the pinned secret scanner.');
    archive = Buffer.from(await response.arrayBuffer());
    verifyArchive(archive, asset.sha256);
    await writeFile(archivePath, archive, { flag: 'wx', mode: 0o600 });
  }
  verifyArchive(archive, asset.sha256);
  const extraction = spawnSync('tar', ['-xzf', archivePath, '-C', temporary, 'gitleaks'], { encoding: 'utf8' });
  if (extraction.error || extraction.status !== 0) throw new Error('Could not extract the verified secret scanner.');
  return join(temporary, 'gitleaks');
}

async function snapshotSource(destination) {
  const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 16_000_000 }).split('\0').filter(Boolean);
  for (const filename of new Set(paths)) {
    const source = resolve(root, filename);
    if (relative(root, source).startsWith('..')) throw new Error('Unexpected path in tracked source.');
    let stat;
    try { stat = await lstat(source); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const target = join(destination, filename);
    await mkdir(dirname(target), { recursive: true });
    // Scan the link text, never dereference a symlink into a private host file.
    if (stat.isSymbolicLink()) await writeFile(target, await readlink(source));
    else if (stat.isFile()) await copyFile(source, target);
    else throw new Error('Unexpected file type in tracked source.');
  }
}

async function scan(binary, temporary, kind, source) {
  const report = join(temporary, `${kind}.json`);
  const args = [kind, source, '--config', configFile, '--redact=100', '--no-banner', '--ignore-gitleaks-allow',
    '--gitleaks-ignore-path', join(temporary, 'no-ignored-findings'), '--report-format=json', '--report-path', report,
    ...(kind === 'git' ? ['--log-opts=HEAD'] : [])];
  const result = spawnSync(binary, args, { cwd: root, encoding: 'utf8', maxBuffer: 16_000_000, timeout: 180_000 });
  if (result.error || ![0, 1].includes(result.status)) throw new Error('Secret scan could not complete; scanner diagnostics were withheld to avoid exposing content.');
  let findings;
  try { findings = JSON.parse(await readFile(report, 'utf8')); }
  catch { throw new Error('Secret scan did not produce a readable report.'); }
  if (result.status === 1 && !findings.length) throw new Error('Secret scan failed without a complete findings report.');
  return findingLocations(findings).map(location => `${kind === 'git' ? 'History' : 'Source'}: ${location}`);
}

async function main() {
  const temporary = await mkdtemp(join(tmpdir(), 'neonworth-secret-scan-'));
  try {
    const binary = await scannerBinary(temporary);
    const source = join(temporary, 'source');
    await mkdir(source);
    await snapshotSource(source);
    const locations = [...await scan(binary, temporary, 'git', root), ...await scan(binary, temporary, 'dir', source)];
    if (locations.length) {
      console.error(`Secret scan found ${locations.length} findings. Values and code are withheld.`);
      for (const location of locations.slice(0, 100)) console.error(location);
      if (locations.length > 100) console.error('Additional locations omitted.');
      process.exitCode = 1;
    } else console.log(`Gitleaks ${pin.version}: no findings in reachable Git history or current source.`);
  } catch {
    // Errors can contain response bodies or subprocess diagnostics. Do not relay
    // them; operational failures block the gate just like detected secrets.
    console.error('Secret scan failed to complete. Check the pinned download, checksum, Git history, and scanner configuration; no source or credential values were printed.');
    process.exitCode = 1;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
