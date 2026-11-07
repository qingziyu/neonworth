import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { demoBasePath, inferredDemoBase, verifyDemoModuleGraph, verifyDemoPublicAssets } from './scripts/demo-build-contract.mjs';

const project = fileURLToPath(new URL('.', import.meta.url));
const base = demoBasePath(process.env.DEMO_BASE_PATH || inferredDemoBase(process.env.GITHUB_REPOSITORY));
const publicDirectory = resolve(project, 'public');
function isolateDemo(): Plugin {
  return {
    name: 'neonworth-synthetic-demo-boundary',
    enforce: 'pre',
    buildStart() { verifyDemoPublicAssets(publicDirectory); },
    generateBundle(_, bundle) {
      verifyDemoModuleGraph([...this.getModuleIds()], project, (path: string) => readFileSync(path, "utf8"));
      if (Object.keys(bundle).some(path => path.endsWith(".map"))) throw new Error("Public demo sourcemaps are disabled.");
      for (const fileName of verifyDemoPublicAssets(publicDirectory)) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(resolve(publicDirectory, fileName)) });
      }
    },
    resolveId(source, importer) {
      for (const [module, target] of [['client-transport', 'transport'], ['client-navigation', 'navigation']]) {
        const absolute = resolve(project, 'lib', module);
        if (source === `@/lib/${module}` || source === absolute || source === absolute + '.ts'
          || (source === `./${module}` || source === `./${module}.ts`) && importer?.startsWith(resolve(project, 'lib') + '/')) return resolve(project, 'demo', target + '.ts');
      }
      if (source === 'cloudflare:workers' || source.startsWith('node:')
        || /(?:^|\/)(?:worker|app\/api|app\/mcp)(?:\/|$)/.test(source)
        || /(?:^|\/)(?:store|refresh|planning-store)\.(?:ts|js)$/.test(source)) {
        throw new Error('Server modules must not enter the public demo bundle.');
      }
      return null;
    },
  };
}
export default defineConfig({
  root: resolve(project, 'demo'),
  base,
  // Keep Vite's public URL rewriting, but never copy this whole directory.
  publicDir: publicDirectory,
  plugins: [isolateDemo(), react()],
  resolve: { alias: [
    { find: '@/lib/client-transport', replacement: resolve(project, 'demo/transport.ts') },
    { find: '@/lib/client-navigation', replacement: resolve(project, 'demo/navigation.ts') },
    { find: '@', replacement: project },
  ] },
  define: { __NEONWORTH_APP_VERSION__: JSON.stringify('synthetic-demo'), __NEONWORTH_DEMO_BASE__: JSON.stringify(base) },
  build: { outDir: resolve(project, 'demo-dist'), emptyOutDir: true, copyPublicDir: false, manifest: false, sourcemap: false },
  server: { host: '127.0.0.1', fs: { allow: [project] } },
});
