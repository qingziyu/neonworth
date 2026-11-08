import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function selectBuildProfile(root, requested) {
  const profile = requested || 'cloudflare';
  if (!['cloudflare', 'sites'].includes(profile)) throw new Error('Unknown hosting profile. Use cloudflare or sites.');
  if (existsSync(resolve(root, '.openai/hosting.json')) && profile !== 'sites') throw new Error('A Sites instance requires an explicit Sites build. Use npm run sites:build or NEONWORTH_HOSTING_PROFILE=sites npm run build.');
  return profile;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const profile = selectBuildProfile(root, process.env.NEONWORTH_HOSTING_PROFILE);
  for (const args of profile === 'sites'
    ? [['scripts/run-sites.mjs', 'build'], ['scripts/prepare-sites-assets.mjs'], ['scripts/verify-sites-build.mjs']]
    : [['scripts/run-framework.mjs', 'build'], ['scripts/verify-build.mjs']]) {
    const result = spawnSync(process.execPath, args, { cwd: root, env: process.env, stdio: 'inherit' });
    if (result.error || result.status !== 0) process.exit(result.status || 1);
  }
}
