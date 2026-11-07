import { fileURLToPath } from 'node:url';
import { configureToolEnvironment } from './tool-environment.mjs';

const [command, ...args] = process.argv.slice(2);
if (!['dev', 'build'].includes(command)) throw new Error('Expected dev or build.');
if (command === 'dev' && args.some(arg => /^--(?:host|https)(?:=|$)/.test(arg))) {
  throw new Error('Local development is restricted to HTTP loopback.');
}
configureToolEnvironment(fileURLToPath(new URL('../', import.meta.url)));
const cli = new URL('../node_modules/vinext/dist/cli.js', import.meta.url);
process.argv = [process.execPath, fileURLToPath(cli), command, ...args,
  ...(command === 'dev' ? ['--host', '127.0.0.1'] : [])];
await import(cli.href);
