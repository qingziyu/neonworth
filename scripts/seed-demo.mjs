import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.argv.length > 2) throw new Error('Demo setup accepts no remote, database or input-file arguments.');
const cwd = fileURLToPath(new URL('../', import.meta.url));
for (const args of [
  ['scripts/setup-local.mjs'],
  ['--import', './scripts/test-support/register.mjs', 'scripts/generate-demo.mjs'],
  ['--import', './scripts/runtime-env.mjs', './node_modules/wrangler/bin/wrangler.js', 'd1', 'migrations', 'apply', 'DB', '--local', '--config', 'wrangler.jsonc', '--persist-to', '.wrangler/state'],
  ['--import', './scripts/runtime-env.mjs', './node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'DB', '--local', '--config', 'wrangler.jsonc', '--persist-to', '.wrangler/state', '--file', 'outputs/demo.sql'],
]) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' });
  if (result.error || result.status !== 0) { console.error('Demo setup stopped. Existing non-demo data and saved settings must never be overwritten.'); process.exit(1); }
}
console.log('Synthetic local demo ready. Run npm run dev. No hosted database was accessed.');
