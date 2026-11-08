import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSitesManifest } from './sites-profile.mjs';

export function setupSitesInstance(root) {
  const directory = resolve(root, '.openai'), file = resolve(directory, 'hosting.json');
  if (existsSync(file)) throw new Error('An instance manifest already exists; setup will not replace it.');
  if (existsSync(directory) && (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())) throw new Error('The instance manifest needs a real .openai directory.');
  const template = validateSitesManifest(JSON.parse(readFileSync(resolve(root, 'profiles/sites/hosting.example.json'), 'utf8')), { registered: false });
  mkdirSync(directory, { recursive: true });
  writeFileSync(file, JSON.stringify(template, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error('Sites setup takes no arguments; run it inside the exported instance.');
    setupSitesInstance(process.cwd());
    console.log('Sites instance manifest initialized without identity. Register one new owner-private Site, then use the supported set-project-id helper.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
