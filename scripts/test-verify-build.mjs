import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyBuildConfiguration, verifyBuildFile } from './verify-build.mjs';

const config = { name: 'synthetic-app', assets: { binding: 'ASSETS', directory: '../client', run_worker_first: true }, vars: { LOCAL_DEV: 'false', OWNER_EMAIL: 'synthetic-private-identity@example.test' } };
const before = structuredClone(config);
assert.doesNotThrow(() => verifyBuildConfiguration(config));
assert.deepEqual(config, before);
const failure = error => {
  assert.equal(error.message, 'Built Worker configuration does not enforce owner authentication.');
  assert.ok(!error.message.includes(config.vars.OWNER_EMAIL));
  return true;
};
// These are the actual dangerous mutations of the emitted artifact, not
// assertions about the example/source spelling that precedes plugin overrides.
const invalid = [
  { ...config, assets: { ...config.assets, run_worker_first: false } },
  { ...config, assets: { ...config.assets, run_worker_first: ['/*'] } },
  { ...config, assets: { ...config.assets, run_worker_first: undefined } },
  { ...config, assets: { ...config.assets, binding: 'UNPROTECTED_ASSETS' } },
  { ...config, vars: { ...config.vars, LOCAL_DEV: 'true' } },
  { ...config, vars: { ...config.vars, LOCAL_DEV: false } },
  { ...config, vars: {} }, null, {},
];
const temporary = await mkdtemp(join(tmpdir(), 'neonworth-build-contract-'));
try {
  const file = join(temporary, 'wrangler.json');
  await writeFile(file, JSON.stringify(config));
  await verifyBuildFile(file);
  for (const candidate of invalid) {
    assert.throws(() => verifyBuildConfiguration(candidate), failure);
    await writeFile(file, JSON.stringify(candidate));
    await assert.rejects(verifyBuildFile(file), failure);
  }
  await writeFile(file, '{"private": "synthetic-sensitive-parser-content"');
  await assert.rejects(verifyBuildFile(file), error => error.message === 'Generated Worker configuration is missing or invalid. Run the framework build first.');
  await assert.rejects(verifyBuildFile(join(temporary, 'missing.json')), error => error.message === 'Generated Worker configuration is missing or invalid. Run the framework build first.');
} finally { await rm(temporary, { recursive: true, force: true }); }
console.log('Generated build contract: emitted asset/auth flag mutations fail, safe configuration passes, no identity or parser content is echoed.');
