// Enforce one-way snapshot architecture without contacting external providers.
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(join(root, 'wrangler.example.jsonc'), 'utf8'));
assert.equal(manifest.d1_databases[0].binding, 'DB');
assert.equal(manifest.assets.run_worker_first, true, 'Assets must pass the owner boundary');
assert.equal(manifest.vars.LOCAL_DEV, 'false');
for (const name of ['services', 'r2_buckets', 'unsafe']) assert.equal(manifest[name], undefined, 'No source grants or capability bindings');

const apiPaths = new Set(['/api/data', '/api/budget', '/api/planning', '/api/preferences', '/api/import', '/api/refresh', '/api/status']);
function inspectSource(text, filename) {
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const client = source.statements.some(statement => ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression) && statement.expression.text === 'use client');
  const imports = [], errors = [];
  const specifier = value => {
    if (!ts.isStringLiteralLike(value)) { errors.push('computed module import'); return; }
    imports.push(value.text);
    if (/(?:^|\/)(?:connectors|connector-context|connector-contract|connector-preview)(?:[.\/]|$)/.test(value.text)) errors.push('connected-app capability import');
    if (/^(?:node:)?(?:http|https|http2|net|tls|child_process|worker_threads)$/.test(value.text) || /^(?:axios|undici|node-fetch)(?:\/|$)/.test(value.text)) errors.push('direct network/process transport');
  };
  const walk = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) specifier(node.moduleSpecifier);
    if (ts.isIdentifier(node) && node.text === 'CONNECTORS') errors.push('connected-app binding reference');
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require') specifier(node.arguments[0]);
      const expression = node.expression;
      const fetchCall = ts.isIdentifier(expression) && expression.text === 'fetch' || ts.isPropertyAccessExpression(expression) && expression.name.text === 'fetch';
      if (fetchCall) {
        const frameworkEntry = filename === 'worker/index.ts' && ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === 'handler';
        const bundledAsset = filename === 'worker/index.ts' && expression.getText(source) === 'env.ASSETS.fetch';
        const target = node.arguments[0];
        const clientFacade = filename === 'lib/client-transport.ts' && expression.getText(source) === 'globalThis.fetch' && node.arguments.length === 2 && target?.getText(source) === 'input' && node.arguments[1].getText(source) === 'init';
        const ownSnapshotReadOrWrite = client && target && ts.isStringLiteralLike(target) && apiPaths.has(target.text);
        if (!frameworkEntry && !bundledAsset && !ownSnapshotReadOrWrite && !clientFacade) errors.push('fetch outside fixed browser snapshot APIs');
      }
      if (ts.isPropertyAccessExpression(expression) && expression.name.text === 'sendBeacon') errors.push('browser network beacon');
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && ['WebSocket', 'EventSource', 'XMLHttpRequest'].includes(node.expression.text)) errors.push('direct network transport');
    ts.forEachChild(node, walk);
  };
  walk(source);
  return { imports, errors };
}

// Prove this gate rejects coupling, rather than merely recognizing today's code.
for (const sample of [
  'fetch("https://finance.example/api/accounts")',
  'globalThis.fetch("https://finance.example/api/accounts")',
  'import { connectorsForRequest } from "@/lib/connectors";',
  'const binding = ctx.props.CONNECTORS;',
  'import http from "node:http";',
  'new WebSocket("wss://finance.example")',
  '"use client"; fetch("https://finance.example/api/accounts")',
]) assert.ok(inspectSource(sample, 'app/example.ts').errors.length, 'A direct connection must fail the architecture gate');
assert.deepEqual(inspectSource('"use client"; fetch("/api/data")', 'app/example.ts').errors, []);

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => entry.isDirectory() ? filesIn(join(directory, entry.name)) : /\.(?:ts|tsx|mts|mjs)$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [join(directory, entry.name)] : []));
  return nested.flat();
}
async function localModule(from, specifier) {
  if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return null;
  const base = specifier.startsWith('@/') ? resolve(root, specifier.slice(2)) : resolve(dirname(from), specifier);
  if (/\.(?:css|json|svg)$/.test(base)) return null;
  for (const candidate of [base, base + '.ts', base + '.tsx', base + '.mts', base + '.mjs', base.replace(/\.mjs$/, '.mts'), join(base, 'index.ts')]) {
    try { await access(candidate); if (/\.(?:ts|tsx|mts|mjs)$/.test(candidate)) return candidate; } catch {}
  }
  throw new Error('Unresolved runtime source import: ' + relative(root, from));
}
const queue = [...await filesIn(join(root, 'app')), join(root, 'worker/index.ts')], visited = new Set();
while (queue.length) {
  const file = queue.shift();
  if (visited.has(file)) continue;
  visited.add(file);
  const name = relative(root, file), audit = inspectSource(await readFile(file, 'utf8'), name);
  assert.deepEqual(audit.errors, [], name + ' must remain isolated from provider APIs');
  for (const specifier of audit.imports) { const target = await localModule(file, specifier); if (target) queue.push(target); }
}
const vite = await readFile(join(root, 'vite.config.ts'), 'utf8');
assert.doesNotMatch(vite, /connectorPreview|connector-preview|CONNECTORS/, 'Local preview must not relay the agent’s connected financial tools into the Site');

// Execute the actual adapter with injected capabilities and assert the framework
// receives only storage and lifecycle helpers. No provider method may be called.
const originalHandler = globalThis.__neonworthSnapshotHandler;
let captured, invoked = 0, waited = 0, passed = 0;
globalThis.__neonworthSnapshotHandler = { fetch(request, env, ctx) { captured = { request, env, ctx }; return new Response('synthetic snapshot', { status: 200 }); } };
const hook = registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'vinext/server/fetch-handler') return { url: 'data:text/javascript,export default globalThis.__neonworthSnapshotHandler;', shortCircuit: true };
  return next(specifier, context);
} });
try {
  const { default: worker } = await import('../worker/index.ts');
  const capability = { invoke() { invoked++; throw new Error('Unexpected provider access'); }, getContext() { invoked++; } };
  const database = {}, bucket = {}, pending = Promise.resolve();
  const incomingContext = { props: { CONNECTORS: capability, otherPrivateProp: 'not-forwarded' }, waitUntil(value) { assert.equal(this, incomingContext); assert.equal(value, pending); waited++; }, passThroughOnException() { assert.equal(this, incomingContext); passed++; } };
  const response = await worker.fetch(new Request('http://127.0.0.1:5173/api/status'), { DB: database, BUCKET: bucket, LOCAL_DEV: 'true', CONNECTORS: capability, FINANCIAL_API_TOKEN: 'not-forwarded' }, incomingContext);
  assert.equal(response.status, 200);
  assert.deepEqual(captured.env, { DB: database, BUCKET: bucket, ASSETS: undefined });
  assert.deepEqual(captured.ctx.props, {});
  assert.equal(Object.hasOwn(captured.ctx, 'CONNECTORS'), false);
  captured.ctx.waitUntil(pending); captured.ctx.passThroughOnException();
  assert.equal(waited, 1); assert.equal(passed, 1); assert.equal(invoked, 0);
} finally { hook.deregister(); globalThis.__neonworthSnapshotHandler = originalHandler; }

console.log('Snapshot isolation: no provider transport or grants, authenticated Worker boundary, and only storage/lifecycle reach application routes.');
