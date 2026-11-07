import { spawnSync } from 'node:child_process';
import { mkdir, readdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  throw new Error('Neonworth regression tests require Node 22.18 or newer; use the version pinned in .node-version (26.8.1).');
}
if (process.argv.length > 2) throw new Error('The public test suite accepts no private fixtures.');
const tests = (await readdir(join(root, 'scripts')))
  .filter(name => /^test-.*\.mjs$/.test(name) && name !== 'test-all.mjs')
  .sort();
await mkdir(join(root, '.sites-runtime'), { recursive: true });
const failed = [];
for (const test of tests) {
  console.log(`\n=== ${test} ===`);
  const result = spawnSync(process.execPath, [
    '--experimental-strip-types', '--import', join(root, 'scripts/test-support/register.mjs'),
    join(root, 'scripts', test),
  ], {
    cwd: root,
    env: { ...process.env, TZ: 'UTC', NODE_ENV: 'test' },
    stdio: 'inherit',
    timeout: 120_000,
    killSignal: 'SIGKILL',
  });
  if (result.status !== 0 || result.error) {
    failed.push(test);
    console.error(result.error?.message || `${test} exited with ${result.signal || result.status}.`);
  }
}
console.log(`\n${tests.length - failed.length}/${tests.length} regression scripts passed.`);
if (failed.length) {
  console.error(`Failed: ${failed.join(', ')}`);
  process.exitCode = 1;
}
