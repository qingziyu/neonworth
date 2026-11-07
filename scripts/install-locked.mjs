import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// npm exec selects the pinned JavaScript distribution on every host, including
// Intel Macs without a matching native @pnpm/exe binary. Never update the lock.
const root = fileURLToPath(new URL('../', import.meta.url));
const { packageManager } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
if (packageManager !== 'pnpm@11.25.0') throw new Error('Review the installer when changing the pnpm pin.');
const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
  'exec', '--yes', '--package', packageManager, '--',
  'pnpm', 'install', '--frozen-lockfile', '--prod=false', '--prefer-offline',
], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
