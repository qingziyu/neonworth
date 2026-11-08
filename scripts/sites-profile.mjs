import { readFileSync, lstatSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const FAILURE = 'Sites requires a registered owner-private instance manifest with DB, MCP, and no source capabilities.';
export function validateSitesManifest(value, { registered = true } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['project_id', 'd1', 'r2', 'capabilities'].includes(key))
    || value.d1 !== 'DB' || value.r2 !== null
    || !Array.isArray(value.capabilities) || value.capabilities.length !== 1 || value.capabilities[0] !== 'mcp'
    || registered && (typeof value.project_id !== 'string' || !value.project_id || value.project_id.length > 200 || value.project_id.trim() !== value.project_id || /[\u0000-\u001f\u007f]/.test(value.project_id))
    || !registered && value.project_id !== undefined) throw new Error(FAILURE);
  return value;
}
export function readSitesManifest(root) {
  try {
    const path = resolve(root, '.openai/hosting.json');
    if (!lstatSync(resolve(root, '.openai')).isDirectory() || lstatSync(resolve(root, '.openai')).isSymbolicLink()
      || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error();
    return validateSitesManifest(JSON.parse(readFileSync(path, 'utf8')));
  } catch { throw new Error(FAILURE); }
}
export function inspectSitesModuleGraph(ids, root) {
  const paths = new Set(ids.filter(id => !id.includes('\0')).map(id => relative(root, id.split('?')[0]).replaceAll('\\', '/')));
  if (!paths.has('worker/sites.ts')) return null;
  if (!paths.has('worker/sites-policy.ts') || ['worker/index.ts', 'worker/access.ts', 'lib/connector-context.ts', 'lib/connectors.ts'].some(path => paths.has(path))) throw new Error('The Sites build included an unsupported Worker or source capability.');
  return { version: 1, profile: 'sites-owner-private', entry: 'index.js', modules: ['worker/sites.ts', 'worker/sites-policy.ts'] };
}
