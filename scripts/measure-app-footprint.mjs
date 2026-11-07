#!/usr/bin/env node
// Usage: node scripts/measure-app-footprint.mjs [--root <checkout>] [--help]
// Reads the existing local build, application fingerprint inputs and Git metadata.
// Never builds, reads a datastore, contacts a service, or changes a file.
// JSON goes to stdout; missing/stale/ambiguous artifacts exit nonzero.
// Gzip values are sums of individually compressed files using Node's default
// gzip settings. They are artifact measurements, not observed network bytes.
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { appBuildId } from './app-build-id.mjs';
import { layoutClientReferences } from './app-footprint-layout.mjs';

const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
const usage = 'node scripts/measure-app-footprint.mjs [--root <checkout>] [--help]';
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const emit = value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

function regular(path, directory = false) {
  let stat;
  try { stat = lstatSync(path); }
  catch { fail('BUILD_MISSING', 'Build artifacts are missing or unreadable. Run the approved build workflow before measuring.'); }
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) {
    fail('INVALID_ARTIFACT', 'Build artifacts must be regular files and directories, without symbolic links.');
  }
}

function inventory(directory) {
  regular(directory, true);
  const result = [];
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name), stat = lstatSync(path);
    if (stat.isSymbolicLink()) fail('INVALID_ARTIFACT', 'Build artifacts must not contain symbolic links.');
    if (stat.isDirectory()) result.push(...inventory(path));
    else if (stat.isFile() && /\.(?:js|css)$/.test(name)) result.push(path);
  }
  return result;
}

function measure(root) {
  const git = args => execFileSync('git', ['--no-optional-locks', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  let commit, dirty;
  try {
    commit = git(['rev-parse', 'HEAD']).trim();
    dirty = git(['status', '--porcelain', '--untracked-files=normal']).length > 0;
  } catch { fail('GIT_UNAVAILABLE', 'Could not read the checkout commit and working-tree status.'); }

  regular(join(root, 'dist'), true);
  regular(join(root, 'dist/server'), true);
  const client = join(root, 'dist/client');
  const paths = inventory(client);
  const assets = new Map(paths.map(path => {
    const bytes = readFileSync(path), url = `/${relative(client, path).split(sep).join('/')}`;
    return [url, { path: url, rawBytes: bytes.length, gzipBytes: gzipSync(bytes).length, bytes }];
  }));
  const manifestPath = join(root, 'dist/server/__vite_rsc_assets_manifest.js');
  regular(manifestPath);
  let manifest;
  try {
    // Parse generated JSON; do not execute a generated JavaScript module.
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8').replace(/^\s*export default\s+/, '').replace(/;\s*$/, ''));
  } catch { fail('INVALID_MANIFEST', 'The existing Vinext assets manifest is not in the supported JSON-export format.'); }
  if (!manifest?.clientReferenceDeps || !manifest?.clientEntryDeps || !manifest?.serverResources?.['app/layout.tsx']) {
    fail('INVALID_MANIFEST', 'The assets manifest is missing client or root-layout dependencies.');
  }

  const fingerprint = appBuildId(root);
  const matching = [...assets.values()].filter(asset => asset.path.endsWith('.js') && asset.bytes.includes(fingerprint));
  if (!matching.length) fail('BUILD_STALE', 'The build does not contain the current application source fingerprint. Rebuild with the approved workflow before measuring.');
  // In this app the Home client entry contains AppUpdateNotice's compiled
  // fingerprint. Require one entry root rather than guessing by chunk size/name.
  // If future routing splits that boundary, update this explicit graph selector.
  const matches = Object.entries(manifest.clientReferenceDeps).filter(([, deps]) => matching.some(asset => deps?.js?.[0] === asset.path));
  if (matches.length !== 1) fail('HOME_GRAPH_UNRESOLVED', 'Expected one fingerprint-bearing Home client entry. The build graph changed; update the measurement selector rather than guessing.');
  const [referenceId, home] = matches[0];
  const layoutSourcePath = join(root, 'app/layout.tsx'), serverSourcePath = join(root, 'dist/server/index.js');
  regular(layoutSourcePath); regular(serverSourcePath);
  const layoutClients = layoutClientReferences({
    layoutSource: readFileSync(layoutSourcePath, 'utf8'),
    serverSource: readFileSync(serverSourcePath, 'utf8'),
    clientReferenceDeps: manifest.clientReferenceDeps,
  });
  const checked = (urls, extension) => {
    if (!Array.isArray(urls) || urls.some(url => typeof url !== 'string' || !url.endsWith(extension))) fail('INVALID_MANIFEST', 'The manifest contains an invalid dependency list.');
    return urls.map(url => {
      const path = resolve(client, `.${url}`);
      if (!url.startsWith('/') || !path.startsWith(`${client}${sep}`) || !assets.has(url)) fail('BUILD_INCOMPLETE', 'A manifest dependency is missing from the client build.');
      return url;
    });
  };
  const aggregate = urls => {
    const files = [...new Set(urls)].sort().map(url => {
      const { bytes, ...measurement } = assets.get(url);
      return measurement;
    });
    return { count: files.length, rawBytes: files.reduce((sum, file) => sum + file.rawBytes, 0), gzipBytes: files.reduce((sum, file) => sum + file.gzipBytes, 0), files };
  };
  const entry = manifest.clientEntryDeps, layout = manifest.serverResources['app/layout.tsx'];
  const eagerJs = [...checked(entry.js, '.js'), ...checked(home.js, '.js'), ...checked(layout.js, '.js'), ...layoutClients.flatMap(root => checked(root.dependencies.js, '.js'))];
  const eagerCss = [...checked(entry.css, '.css'), ...checked(home.css, '.css'), ...checked(layout.css, '.css'), ...layoutClients.flatMap(root => checked(root.dependencies.css, '.css'))];
  return {
    schemaVersion: 2,
    git: { commit, dirty },
    build: { sourceFingerprint: fingerprint, sourceFingerprintMatches: true, homeClientReferenceId: referenceId, layoutClientReferences: layoutClients.map(({ dependencies, ...root }) => root) },
    measurement: 'Existing local artifacts; eager graph unions Home, client entry, layout resources and statically resolved direct layout client roots. Summed per-file default gzip; no browser timing or observed transfer measurement. Git commit describes the checkout; fingerprint validates application inputs, not build provenance.',
    eagerHome: { javascript: aggregate(eagerJs), css: aggregate(eagerCss) },
    all: {
      javascript: aggregate([...assets.keys()].filter(url => url.endsWith('.js'))),
      css: aggregate([...assets.keys()].filter(url => url.endsWith('.css'))),
    },
  };
}

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') emit({ usage, purpose: 'Measure the current existing build without rebuilding or reading financial data.', failure: 'Missing, stale, incomplete or ambiguous build artifacts produce JSON with ok=false and exit code 1.' });
  else {
    if (args.length && !(args.length === 2 && args[0] === '--root' && args[1] && !args[1].startsWith('--'))) fail('INVALID_ARGUMENTS', usage);
    emit({ ok: true, ...measure(args.length ? resolve(args[1]) : defaultRoot) });
  }
} catch (error) {
  emit({ ok: false, error: { code: typeof error?.code === 'string' && /^[A-Z_]+$/.test(error.code) ? error.code : 'MEASUREMENT_FAILED', message: error?.code && /^[A-Z_]+$/.test(error.code) ? error.message : 'Could not measure local build artifacts. Check the source fingerprint inputs and build files.' } });
  process.exitCode = 1;
}
