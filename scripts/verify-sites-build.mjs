import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { validateSitesManifest } from './sites-profile.mjs';

const emptyDefaults = {
  definedEnvironments: [], triggers: {}, durable_objects: { bindings: [] }, workflows: [], migrations: [], exports: {},
  kv_namespaces: [], cloudchamber: {}, send_email: [], queues: { producers: [], consumers: [] }, connect: [], r2_buckets: [],
  vectorize: [], ai_search_namespaces: [], ai_search: [], agent_memory: [], hyperdrive: [], services: [], analytics_engine_datasets: [],
  dispatch_namespaces: [], mtls_certificates: [], pipelines: [], k2: [], secrets_store_secrets: [], artifacts: [], unsafe_hello_world: [],
  flagship: [], worker_loaders: [], ratelimits: [], vpc_services: [], vpc_networks: [], logfwdr: { bindings: [] },
};
const allowedKeys = new Set(['configPath', 'userConfigPath', 'topLevelName', 'compatibility_date', 'compatibility_flags', 'jsx_factory', 'jsx_fragment', 'rules', 'name', 'main', 'assets', 'workers_dev', 'preview_urls', 'vars', 'd1_databases', 'upload_source_maps', 'observability', 'python_modules', 'dev', 'no_bundle', ...Object.keys(emptyDefaults)]);
const keysOnly = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key));
export function verifySitesBuildConfiguration(config) {
  if (!config || Object.keys(config).some(key => !allowedKeys.has(key)) || config.main !== 'index.js'
    || config.assets?.binding !== 'ASSETS' || config.assets?.run_worker_first !== true || config.assets?.directory !== '../client'
    || !keysOnly(config.assets, ['binding', 'run_worker_first', 'directory'])
    || config.vars?.SITES_LOCAL_DEV !== 'false' || Object.keys(config.vars).length !== 1
    || config.workers_dev !== false || config.preview_urls !== false
    || config.d1_databases?.length !== 1 || config.d1_databases[0].binding !== 'DB'
    || !keysOnly(config.d1_databases[0], ['binding', 'database_name', 'database_id', 'migrations_dir'])
    || Object.entries(emptyDefaults).some(([key, value]) => config[key] !== undefined && JSON.stringify(config[key]) !== JSON.stringify(value))
    || config.observability && JSON.stringify(config.observability) !== JSON.stringify({ enabled: false })
    || config.dev && !keysOnly(config.dev, ['ip', 'local_protocol', 'upstream_protocol', 'enable_containers', 'generate_types'])
    || config.python_modules && JSON.stringify(config.python_modules) !== JSON.stringify({ exclude: ['**/*.pyc'] })) {
    throw new Error('Built Sites profile has unexpected bindings, routing or local access.');
  }
}
export function verifySitesBuild(root) {
  try {
    const original = validateSitesManifest(JSON.parse(readFileSync(resolve(root, '.openai/hosting.json'), 'utf8')));
    const bundled = validateSitesManifest(JSON.parse(readFileSync(resolve(root, 'dist/.openai/hosting.json'), 'utf8')));
    if (JSON.stringify(original) !== JSON.stringify(bundled)) throw new Error();
    verifySitesBuildConfiguration(JSON.parse(readFileSync(resolve(root, 'dist/server/wrangler.json'), 'utf8')));
    if (!existsSync(resolve(root, 'dist/server/index.js')) || !existsSync(resolve(root, 'dist/.openai/drizzle/meta/_journal.json'))) throw new Error();
    const proof = JSON.parse(readFileSync(resolve(root, 'dist/server/sites-profile-proof.json'), 'utf8'));
    if (proof.version !== 1 || proof.profile !== 'sites-owner-private' || proof.entry !== 'index.js'
      || JSON.stringify(proof.modules) !== JSON.stringify(['worker/sites.ts', 'worker/sites-policy.ts'])
      || proof.sha256 !== createHash('sha256').update(readFileSync(resolve(root, 'dist/server/index.js'))).digest('hex')) throw new Error();
    if (existsSync(resolve(root, '.git')) && spawnSync('git', ['-C', root, 'ls-files', '--error-unmatch', '.openai/hosting.json'], { stdio: 'ignore' }).status !== 0) throw new Error();
  } catch { throw new Error('Sites build verification failed. Check the instance manifest, Worker configuration and bundled migrations.'); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { verifySitesBuild(fileURLToPath(new URL('../', import.meta.url))); console.log('Sites artifact verified: DB/MCP manifest, bundled migrations, worker-first assets, no grants, and local access disabled. Native owner-private access still requires deployment verification.'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
