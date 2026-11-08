import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, statSync, realpathSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportSitesSource } from './export-sites.mjs';

// CI-only compile gate. It never reads or updates this checkout's instance
// manifest and never calls hosting, source Finance, or deployment tooling.
// The exporter requires the profile to exist in a clean reviewed Git checkpoint.
function checkSitesBuild() {
  if (process.argv.length !== 2) throw new Error('sites:check accepts no arguments.');
  const source = fileURLToPath(new URL('../', import.meta.url));
  const dependencies = realpathSync(resolve(source, 'node_modules'));
  if (!statSync(dependencies).isDirectory()) throw new Error('Install the pinned dependencies before checking the Sites build.');
  const temporary = mkdtempSync(join(tmpdir(), 'neonworth-sites-ci-'));
  try {
    const instance = join(temporary, 'instance');
    const { revision } = exportSitesSource(source, instance);
    const manifestFile = join(instance, '.openai/hosting.json');
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    if (manifest.project_id !== undefined) throw new Error('The synthetic build must start without a Site identity.');
    manifest.project_id = 'synthetic-ci-only-never-deploy';
    writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
    // Build-only dependency reuse; this link is never part of a source export.
    symlinkSync(dependencies, join(instance, 'node_modules'), 'dir');
    const plainEnvironment = { ...process.env }; delete plainEnvironment.NEONWORTH_HOSTING_PROFILE;
    const wrongProfile = spawnSync(process.execPath, ['scripts/build-profile.mjs'], { cwd: instance, env: plainEnvironment, encoding: 'utf8' });
    if (wrongProfile.status === 0 || !wrongProfile.stderr?.includes('requires an explicit Sites build')) throw new Error('An instance without explicit Sites selection must fail closed.');
    const result = spawnSync(process.execPath, ['scripts/build-profile.mjs'], {
      cwd: instance,
      env: { ...process.env, NEONWORTH_HOSTING_PROFILE: 'sites' },
      stdio: 'inherit',
    });
    if (result.error || result.status !== 0) throw new Error('The isolated synthetic Sites build or artifact verification failed.');
    return revision;
  } finally {
    // Node removes the dependency symlink itself, never its shared target.
    rmSync(temporary, { recursive: true, force: true });
  }
}

try {
  const revision = checkSitesBuild();
  console.log(`Sites CI build passed for ${revision}; the temporary synthetic instance was removed. No deployment performed.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Sites CI build failed.');
  process.exitCode = 1;
}
