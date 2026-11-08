import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITES_ASSET_PREFIX, SITES_ASSET_STORAGE, sitesAssetPath } from '../profiles/sites/asset-paths.mjs';

export function verifySitesAssets(root) {
  const client = resolve(root, 'dist/client');
  if (existsSync(resolve(client, SITES_ASSET_PREFIX.slice(1)))) throw new Error('The Sites asset URL namespace must not contain packaged files.');
  const manifest = JSON.parse(readFileSync(resolve(client, '.vite/manifest.json'), 'utf8'));
  const files = Object.values(manifest).flatMap(entry => [entry.file, ...(entry.css || []), ...(entry.assets || [])]);
  if (!files.some(file => file?.endsWith('.js')) || !files.some(file => file?.endsWith('.css'))) throw new Error('Sites client JS/CSS metadata is missing.');
  for (const file of files) {
    const storagePath = typeof file === 'string' && sitesAssetPath(`/${file}`);
    if (!storagePath) throw new Error('Sites client metadata must use the Worker asset namespace.');
    const parts = storagePath.slice(1).split('/');
    for (let index = 1; index <= parts.length; index++) {
      const stat = lstatSync(resolve(client, ...parts.slice(0, index)));
      if (stat.isSymbolicLink() || (index === parts.length ? !stat.isFile() : !stat.isDirectory())) throw new Error('Sites client assets must be regular packaged files.');
    }
  }
}

// Vinext intentionally emits a path-style assetPrefix on disk too. Only after
// all client/server metadata has compiled, move the files out of that public
// URL namespace. Native Sites can otherwise serve a file before our Worker.
export function prepareSitesAssets(root) {
  const client = resolve(root, 'dist/client');
  const prefix = resolve(client, SITES_ASSET_PREFIX.slice(1));
  const source = resolve(prefix, SITES_ASSET_STORAGE.slice(1));
  const destination = resolve(client, SITES_ASSET_STORAGE.slice(1));
  const directory = path => lstatSync(path).isDirectory() && !lstatSync(path).isSymbolicLink();
  const regularTree = path => {
    if (!directory(path)) throw new Error('Sites asset preparation requires regular build directories.');
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isDirectory()) regularTree(resolve(path, entry.name));
      else if (!entry.isFile()) throw new Error('Sites assets must be regular files.');
    }
  };
  if (!directory(client) || !directory(prefix) || !directory(dirname(source))
    || readdirSync(prefix).join() !== '_next' || readdirSync(dirname(source)).join() !== 'static'
    || existsSync(destination)) throw new Error('Sites asset preparation found missing or conflicting build output.');
  regularTree(source);
  if (readdirSync(source).length === 0) throw new Error('Sites built assets are missing.');
  const parent = dirname(destination);
  if (existsSync(parent) && !directory(parent)) throw new Error('Sites asset destination is not a regular directory.');
  mkdirSync(parent, { recursive: true });
  renameSync(source, destination);
  rmdirSync(dirname(source)); rmdirSync(prefix);
  verifySitesAssets(root);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareSitesAssets(fileURLToPath(new URL('../', import.meta.url)));
  console.log('Sites built asset URLs now require the private Worker response boundary.');
}
