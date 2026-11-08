import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, realpathSync, readdirSync, mkdirSync, writeFileSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { resolve, dirname, isAbsolute, relative, basename, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupSitesInstance } from './setup-sites.mjs';

const directories = new Set(['app', 'components', 'db', 'drizzle', 'hooks', 'lib', 'public', 'worker', 'profiles', 'scripts', 'vendor', 'docs', 'examples', 'demo', 'integrations', 'plugins', 'skills', 'prompts', 'contracts', '.github']);
const topFiles = new Set(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', '.gitleaks.toml', '.node-version', '.gitignore', 'tsconfig.json', 'next-env.d.ts', 'next.config.ts', 'postcss.config.mjs', 'components.json', 'eslint.config.mjs', 'cloudflare-env.d.ts', 'drizzle.config.ts', 'vite.config.ts', 'vite.sites.config.ts', 'vite.demo.config.ts', 'wrangler.example.jsonc', 'plugin.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md', 'AGENTS.md', 'SECURITY.md', 'CONTRIBUTING.md', 'CHANGELOG.md']);
export function allowedSitesSource(path) {
  if (path === '.agents/plugins/marketplace.json') return true;
  const parts = path.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part.startsWith('.env') || ['.git', '.wrangler', '.openai', 'node_modules', 'outputs', 'work'].includes(part)) || /\.(?:pem|key)$/i.test(path)) return false;
  return parts.length === 1 ? topFiles.has(path) : directories.has(parts[0]);
}
export function exportedSourceBytes(path, bytes) {
  return path === '.gitignore'
    ? Buffer.from(bytes.toString('utf8').split('\n').filter(line => !/^\/?\.openai(?:\/|$)/.test(line.trim())).join('\n'))
    : bytes;
}
function git(root, args, encoding = 'utf8') {
  const result = spawnSync('git', ['-C', root, ...args], { encoding, maxBuffer: 64_000_000 });
  if (result.status !== 0) throw new Error('Unable to inspect the tracked source checkpoint.');
  return result.stdout;
}
export function exportSitesSource(source, destination) {
  if (!isAbsolute(destination)) throw new Error('Choose an absolute path to a new empty instance directory.');
  source = realpathSync(resolve(source)); destination = resolve(destination);
  const suffix = []; let ancestor = destination;
  while (!existsSync(ancestor)) { suffix.unshift(basename(ancestor)); ancestor = dirname(ancestor); }
  const canonicalDestination = resolve(realpathSync(ancestor), ...suffix);
  const inside = (parent, child) => { const path = relative(parent, child); return path === '' || path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path); };
  if (inside(source, canonicalDestination) || inside(canonicalDestination, source)) throw new Error('The instance must not contain, replace, or be inside the source checkout.');
  if (existsSync(destination) && (lstatSync(destination).isSymbolicLink() || !lstatSync(destination).isDirectory() || readdirSync(destination).length)) throw new Error('The instance destination must be a new or empty real directory.');
  const revision = git(source, ['rev-parse', 'HEAD']).trim();
  if (git(source, ['status', '--porcelain', '--untracked-files=no']).trim()) throw new Error('Commit and review tracked changes before exporting the source checkpoint.');
  const entries = git(source, ['ls-files', '--stage', '-z']).split('\0').filter(Boolean).map(line => {
    const match = /^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/.exec(line);
    if (!match) throw new Error('Unexpected tracked source entry.');
    return { mode: match[1], object: match[2], stage: match[3], path: match[4] };
  }).filter(entry => allowedSitesSource(entry.path));
  for (const entry of entries) {
    const parents = entry.path.split('/').slice(0, -1);
    for (let index = 1; index <= parents.length; index++) if (lstatSync(resolve(source, ...parents.slice(0, index))).isSymbolicLink()) throw new Error('Exported source directories must not be symbolic links.');
    if (!['100644', '100755'].includes(entry.mode) || entry.stage !== '0' || !lstatSync(resolve(source, entry.path)).isFile() || lstatSync(resolve(source, entry.path)).isSymbolicLink()) throw new Error('Exported source must contain only tracked regular files, never symlinks or submodules.');
  }
  const required = ['package.json', 'vite.sites.config.ts', 'worker/sites.ts', 'profiles/sites/hosting.example.json'];
  if (required.some(path => !entries.some(entry => entry.path === path))) throw new Error('The committed checkpoint does not include the complete Sites profile.');
  mkdirSync(dirname(destination), { recursive: true });
  const staging = mkdtempSync(join(dirname(destination), `.${basename(destination)}-prepare-`));
  try {
    for (const entry of entries) {
      const target = resolve(staging, entry.path); mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, exportedSourceBytes(entry.path, git(source, ['cat-file', 'blob', entry.object], null)), { mode: entry.mode === '100755' ? 0o755 : 0o644 });
    }
    // A public checkout ignores instance identity. The newly exported private
    // source repository must be able to retain its own generated manifest.
    setupSitesInstance(staging);
    writeFileSync(resolve(staging, '.openai/template.json'), JSON.stringify({ version: 1, upstreamRevision: revision }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    if (git(source, ['rev-parse', 'HEAD']).trim() !== revision || git(source, ['status', '--porcelain', '--untracked-files=no']).trim()) throw new Error('Source changed during export; review a stable checkpoint and try again.');
    renameSync(staging, destination);
    return { revision, files: entries.length, initialized: true };
  } finally { rmSync(staging, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: npm run sites:export -- /absolute/new-empty-instance');
    console.log(JSON.stringify(exportSitesSource(fileURLToPath(new URL('../', import.meta.url)), process.argv[2])));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
