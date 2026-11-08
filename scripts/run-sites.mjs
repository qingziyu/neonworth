import { fileURLToPath } from 'node:url';
import { configureToolEnvironment } from './tool-environment.mjs';
import { readSitesManifest } from './sites-profile.mjs';

const [command, ...args] = process.argv.slice(2);
if (!['dev', 'build'].includes(command) || args.some(arg => /^--(?:host|https|config)(?:=|$)/.test(arg) || arg === '-c')) throw new Error('Expected Sites dev or build with the fixed profile.');
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
readSitesManifest(root); configureToolEnvironment(root);
const cli = new URL('../node_modules/vinext/dist/cli.js', import.meta.url);
process.argv = [process.execPath, fileURLToPath(cli), command, ...args, '--config', fileURLToPath(new URL('../vite.sites.config.ts', import.meta.url)), ...(command === 'dev' ? ['--host', '127.0.0.1'] : [])];
await import(cli.href);
