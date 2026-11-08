import { spawnSync } from 'node:child_process';
import { lstatSync, realpathSync, existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, rmdirSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allowedSitesSource, exportedSourceBytes } from './export-sites.mjs';

function git(root, args, encoding = 'utf8') {
  const result = spawnSync('git', ['-C', root, ...args], { encoding, maxBuffer: 64_000_000 });
  if (result.status !== 0) throw new Error('The selected source revision or clean Git checkpoint is unavailable.');
  return result.stdout;
}
function cleanRoot(root) {
  if (realpathSync(git(root, ['rev-parse', '--show-toplevel']).trim()) !== realpathSync(root)) throw new Error('Use the exact root of an independent Git checkout.');
  if (git(root, ['status', '--porcelain', '--untracked-files=no']).trim()) throw new Error('Commit and review tracked changes before upgrading.');
  return git(root, ['rev-parse', 'HEAD']).trim();
}
function safePath(root, path) {
  if (path.split('/').some(part => !part || part === '.' || part === '..') || /[\u0000-\u001f\u007f]/.test(path)) throw new Error('Unsupported source path.');
  const parts = path.split('/');
  for (let index = 1; index <= parts.length; index++) {
    const stat = lstatSync(resolve(root, ...parts.slice(0, index)), { throwIfNoEntry: false });
    if (!stat) break;
    if (stat.isSymbolicLink() || (index < parts.length ? !stat.isDirectory() : !stat.isFile())) throw new Error(`Unsupported file or symbolic link: ${path}`);
  }
  return resolve(root, path);
}
function templateTree(root, revision) {
  git(root, ['cat-file', '-e', `${revision}^{commit}`]);
  const entries = new Map();
  for (const line of git(root, ['ls-tree', '-r', '-z', revision]).split('\0').filter(Boolean)) {
    const match = /^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/.exec(line);
    if (!match) throw new Error('Unexpected template tree entry.');
    const [, mode, type, object, path] = match;
    if (!allowedSitesSource(path)) continue;
    if (type !== 'blob' || !['100644', '100755'].includes(mode) || /[\u0000-\u001f\u007f]/.test(path)) throw new Error('Template source must contain only regular files.');
    entries.set(path, { mode: mode === '100755' ? 0o755 : 0o644, object });
  }
  return entries;
}
function equal(left, right) {
  return left === null ? right === null : right !== null && left.mode === right.mode && left.bytes.equals(right.bytes);
}
function localFile(root, path) {
  const file = safePath(root, path), stat = lstatSync(file, { throwIfNoEntry: false });
  return stat ? { bytes: readFileSync(file), mode: stat.mode & 0o111 ? 0o755 : 0o644 } : null;
}
function provenance(root) {
  const file = safePath(root, '.openai/template.json');
  let value;
  try { value = JSON.parse(readFileSync(file, 'utf8')); } catch { throw new Error('This instance needs its recorded template provenance; do not guess the base revision.'); }
  if (!value || Object.keys(value).sort().join(',') !== 'upstreamRevision,version' || value.version !== 1 || !/^[a-f0-9]{40,64}$/.test(value.upstreamRevision)) throw new Error('Unsupported template provenance.');
  return { value, bytes: readFileSync(file), mode: lstatSync(file).mode & 0o777 };
}
export class SitesUpgradeConflict extends Error {
  constructor(paths) { super('Source conflicts require a reviewed manual merge; no files changed.'); this.paths = paths; }
}

/** File-level three-way upgrade. The fault hook is for executed rollback tests;
 * it has no CLI flag. No source-control, database, migration or hosting mutation. */
export function upgradeSitesSource(source, instance, { beforeWrite } = {}) {
  if (!isAbsolute(instance)) throw new Error('Choose an absolute private-instance directory.');
  source = realpathSync(resolve(source));
  if (lstatSync(instance).isSymbolicLink()) throw new Error('The instance root must not be a symbolic link.');
  instance = realpathSync(instance);
  if (source === instance) throw new Error('The upstream and private instance must be different Git checkouts.');
  const nextRevision = cleanRoot(source), instanceRevision = cleanRoot(instance), prior = provenance(instance);
  const base = templateTree(source, prior.value.upstreamRevision), next = templateTree(source, nextRevision);
  const tracked = new Set(git(instance, ['ls-files', '-z']).split('\0').filter(Boolean));
  const plan = [], conflicts = [], cache = new Map();
  const contents = (path, entry) => {
    if (!entry) return null;
    const key = `${path}\0${entry.object}\0${entry.mode}`;
    if (!cache.has(key)) cache.set(key, { mode: entry.mode, bytes: exportedSourceBytes(path, git(source, ['cat-file', 'blob', entry.object], null)) });
    return cache.get(key);
  };
  for (const path of [...new Set([...base.keys(), ...next.keys()])].sort()) {
    const before = base.get(path), after = next.get(path);
    // Preflight every inherited template path, including unchanged source, so a
    // tracked symlink cannot silently become an accepted upgrade destination.
    const destination = safePath(instance, path);
    if (before?.object === after?.object && before?.mode === after?.mode) continue;
    const old = contents(path, before), incoming = contents(path, after);
    if (equal(old, incoming)) continue;
    if (existsSync(destination) && !tracked.has(path)) { conflicts.push(path); continue; }
    const current = localFile(instance, path);
    if (equal(current, incoming)) continue;
    if (!equal(current, old)) { conflicts.push(path); continue; }
    plan.push({ path, before: current, after: incoming });
  }
  if (conflicts.length) throw new SitesUpgradeConflict(conflicts);
  if (cleanRoot(source) !== nextRevision || cleanRoot(instance) !== instanceRevision) throw new Error('A Git checkpoint changed during upgrade preflight.');
  for (const change of plan) if (!equal(localFile(instance, change.path), change.before)) throw new Error('Instance source changed during upgrade preflight.');

  const applied = [], createdDirectories = [];
  function atomic(path, bytes, mode) {
    const destination = safePath(instance, path), parent = dirname(destination), missing = [];
    for (let directory = parent; !existsSync(directory); directory = dirname(directory)) missing.push(directory);
    for (const directory of missing.reverse()) { mkdirSync(directory); createdDirectories.push(directory); }
    const temporary = mkdtempSync(join(parent, '.neonworth-upgrade-'));
    try { const file = join(temporary, 'file'); writeFileSync(file, bytes, { mode }); renameSync(file, destination); }
    finally { rmSync(temporary, { recursive: true, force: true }); }
  }
  try {
    for (const [index, change] of plan.entries()) {
      beforeWrite?.(index, change.path);
      applied.push(change);
      if (change.after) atomic(change.path, change.after.bytes, change.after.mode); else unlinkSync(safePath(instance, change.path));
    }
    beforeWrite?.(plan.length, '.openai/template.json');
    atomic('.openai/template.json', Buffer.from(JSON.stringify({ version: 1, upstreamRevision: nextRevision }, null, 2) + '\n'), prior.mode);
  } catch {
    let restored = true;
    for (const change of applied.reverse()) try {
      if (change.before) atomic(change.path, change.before.bytes, change.before.mode);
      else unlinkSync(safePath(instance, change.path));
    } catch { restored = false; }
    try { atomic('.openai/template.json', prior.bytes, prior.mode); } catch { restored = false; }
    for (const directory of createdDirectories.reverse()) try { rmdirSync(directory); } catch { /* Keep nonempty or preexisting parents. */ }
    throw new Error(restored ? 'Source upgrade failed; the previous source files and provenance were restored.' : 'Source upgrade failed and rollback was incomplete. Keep the instance unpublished and restore its clean Git checkpoint.');
  }
  return { from: prior.value.upstreamRevision, to: nextRevision, changed: plan.map(change => change.path), provenanceUpdated: true };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: npm run sites:upgrade -- /absolute/private-instance');
    console.log(JSON.stringify(upgradeSitesSource(fileURLToPath(new URL('../', import.meta.url)), process.argv[2])));
  } catch (error) {
    console.error(error.message);
    if (error instanceof SitesUpgradeConflict) for (const path of error.paths) console.error(path);
    process.exitCode = 1;
  }
}
