import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Application source only. Never inspect .git, credentials, runtime stores,
// exported financial records or build outputs to identify the running app.
const directories = ['app', 'lib', 'components', 'hooks', 'db', 'worker', 'public', 'vendor'];
const configFiles = ['vite.config.ts', 'next.config.ts', 'postcss.config.mjs', 'package.json', 'pnpm-lock.yaml', 'tsconfig.json', '.node-version', 'wrangler.example.jsonc', 'scripts/app-build-id.mjs'];

/** A stable fingerprint shared by the browser and Worker from the same build. */
export function appBuildId(root) {
  const files = [];
  const visit = relative => {
    const entries = readdirSync(join(root, relative), { withFileTypes: true });
    for (const entry of entries) {
      const path = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error('Application fingerprint inputs must not be symbolic links.');
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  for (const directory of directories) if (existsSync(join(root, directory))) {
    if (lstatSync(join(root, directory)).isSymbolicLink()) throw new Error('Application fingerprint inputs must not be symbolic links.');
    visit(directory);
  }
  for (const file of configFiles) if (existsSync(join(root, file))) {
    if (lstatSync(join(root, file)).isSymbolicLink()) throw new Error('Application fingerprint inputs must not be symbolic links.');
    files.push(file);
  }
  const hash = createHash('sha256');
  for (const file of files.sort()) {
    const bytes = readFileSync(join(root, file));
    hash.update(`${file}\0${bytes.length}\0`).update(bytes);
  }
  return hash.digest('hex');
}
