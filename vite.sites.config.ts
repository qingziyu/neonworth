import vinext from 'vinext';
import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { configureToolEnvironment } from './scripts/tool-environment.mjs';
import { appBuildId } from './scripts/app-build-id.mjs';
import { readSitesManifest, inspectSitesModuleGraph } from './scripts/sites-profile.mjs';
import { sites } from './profiles/sites/sites-vite-plugin';

function sitesEntryProof(): Plugin {
  const name = 'sites-profile-proof.json';
  return {
    name: 'neonworth-sites-entry-proof', apply: 'build',
    generateBundle(_options, bundle) {
      const proof = inspectSitesModuleGraph([...this.getModuleIds()], process.cwd());
      if (!proof) return;
      if (bundle['index.js']?.type !== 'chunk' || !bundle['index.js'].isEntry) throw new Error('The Sites Worker entry was not emitted.');
      this.emitFile({ type: 'asset', fileName: name, source: JSON.stringify(proof) });
    },
    writeBundle(options, bundle) {
      if (!bundle[name]) return;
      const directory = resolve(options.dir || 'dist/server');
      const proof = JSON.parse(readFileSync(resolve(directory, name), 'utf8'));
      proof.sha256 = createHash('sha256').update(readFileSync(resolve(directory, 'index.js'))).digest('hex');
      writeFileSync(resolve(directory, name), JSON.stringify(proof, null, 2) + '\n');
    },
  };
}

export default defineConfig(async ({ command }) => {
  readSitesManifest(process.cwd());
  configureToolEnvironment(process.cwd());
  const { cloudflare } = await import('@cloudflare/vite-plugin');
  return {
    define: { __NEONWORTH_APP_VERSION__: JSON.stringify(appBuildId(process.cwd())) },
    server: { host: '127.0.0.1', port: 5173,
      ...(process.env.CODEX_SANDBOX === 'seatbelt' ? { watch: { useFsEvents: false, usePolling: true } } : {}) },
    plugins: [vinext(), sites({ mockAuth: false }), cloudflare({
      configPath: fileURLToPath(new URL('./profiles/sites/wrangler.jsonc', import.meta.url)),
      viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
      inspectorPort: false, remoteBindings: false, persistState: { path: '.wrangler/sites-state' },
      config: config => ({
        assets: { ...config.assets, binding: 'ASSETS', run_worker_first: true },
        vars: { SITES_LOCAL_DEV: command === 'serve' ? 'true' : 'false' },
      }),
    }), sitesEntryProof()],
  };
});
