import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FAILURE = 'Built Worker configuration does not enforce owner authentication.';

/** Inspect the emitted deployment artifact, after all Vite overrides apply. */
export function verifyBuildConfiguration(config) {
  if (!config || typeof config !== 'object'
    || config.assets?.run_worker_first !== true
    || config.assets?.binding !== 'ASSETS'
    || config.vars?.LOCAL_DEV !== 'false') throw new Error(FAILURE);
}

export async function verifyBuildFile(file) {
  let config;
  try { config = JSON.parse(await readFile(file, 'utf8')); }
  catch { throw new Error('Generated Worker configuration is missing or invalid. Run the framework build first.'); }
  verifyBuildConfiguration(config);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error('Build verification accepts no arguments.');
    await verifyBuildFile(new URL('../dist/server/wrangler.json', import.meta.url));
    console.log('Built Worker verified: assets require owner authentication and local access is disabled.');
  } catch (error) {
    // Never print generated variables, identity values or raw JSON parser text.
    console.error(error.message);
    process.exitCode = 1;
  }
}
