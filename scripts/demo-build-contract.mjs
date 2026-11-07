import ts from 'typescript';
import { relative, join } from 'node:path';
import { lstatSync, readdirSync } from 'node:fs';

export function demoBasePath(value = '/neonworth/') {
  if (value !== '/' && (!/^\/[A-Za-z0-9._-]+\/$/.test(value) || ['/../', '/./'].includes(value))) throw new Error('DEMO_BASE_PATH must be / or one repository path such as /neonworth/.');
  return value;
}
export function inferredDemoBase(repository = '') {
  const [owner, name] = repository.split('/');
  if (owner && name?.toLowerCase() === `${owner}.github.io`.toLowerCase()) return '/';
  return demoBasePath(`/${name || 'neonworth'}/`);
}
export const DEMO_PUBLIC_ASSETS = Object.freeze([
  'favicon.svg', 'fonts/space-grotesk-variable.woff2', 'fonts/README.md', 'fonts/OFL-space-grotesk.txt',
]);
export function verifyDemoPublicAssets(directory) {
  const found = new Set();
  const visit = (path = '') => {
    const stat = lstatSync(join(directory, path));
    if (stat.isSymbolicLink()) throw new Error('Public demo assets must not contain symbolic links.');
    if (stat.isDirectory()) {
      if (path && path !== 'fonts') throw new Error('Unexpected public demo asset directory.');
      for (const child of readdirSync(join(directory, path))) visit(path ? `${path}/${child}` : child);
    } else if (stat.isFile() && (DEMO_PUBLIC_ASSETS.includes(path) || path === '_headers')) found.add(path);
    else throw new Error('Unexpected public demo asset.');
  };
  visit();
  for (const asset of DEMO_PUBLIC_ASSETS) if (!found.has(asset)) throw new Error('A required public demo asset is missing.');
  // _headers is an explicitly known production-only file, never emitted below.
  return [...DEMO_PUBLIC_ASSETS];
}
export function inspectDemoSource(source, filename) {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, /\.[jt]sx$/.test(filename) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const errors = [];
  const safeFetchNames = new Set();
  for (const item of ast.statements) if (ts.isImportDeclaration(item) && /(?:^|\/)client-transport(?:\.ts)?$/.test(item.moduleSpecifier.text)) {
    const names = item.importClause?.namedBindings;
    if (names && ts.isNamedImports(names)) for (const name of names.elements) if ((name.propertyName?.text ?? name.name.text) === 'clientFetch') safeFetchNames.add(name.name.text);
  }
  const transportNames = new Set(['fetch', 'sendBeacon', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker']);
  const literal = (node, depth = 0) => {
    if (!node || depth > 8) return null;
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = literal(node.left, depth + 1), right = literal(node.right, depth + 1);
      if (left !== null && right !== null) return left + right;
    }
    return null;
  };
  const walk = node => {
    // Type-only signatures such as `typeof globalThis.fetch` create no runtime
    // transport. Imports are separately resolved by the module-graph boundary.
    if (ts.isTypeNode(node) || ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node) && node.text === 'fetch' && !safeFetchNames.has('fetch')) errors.push('unadapted browser fetch');
    if (ts.isPropertyAccessExpression(node) && transportNames.has(node.name.text)) errors.push('direct browser transport');
    if (ts.isElementAccessExpression(node) && transportNames.has(literal(node.argumentExpression))) errors.push('direct browser transport');
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && transportNames.has(node.expression.text)) errors.push('direct browser transport');
    ts.forEachChild(node, walk);
  };
  walk(ast);
  return [...new Set(errors)];
}
export function verifyDemoModuleGraph(ids, root, readSource) {
  let foundAdapter = false, foundHome = false;
  for (const id of ids) {
    if (id.includes('\0') || id.includes('/node_modules/')) continue;
    const path = relative(root, id.split('?')[0]).replaceAll('\\', '/');
    if (path.startsWith('../')) continue;
    if (/^(?:worker|db|app\/api|app\/mcp)\//.test(path)
      || /^lib\/(?:store|refresh|planning-store|client-transport)\.(?:ts|js)$/.test(path)) throw new Error('Server or hosted transport entered the public demo graph: ' + path);
    if (path === 'demo/transport.ts') foundAdapter = true;
    if (path === 'app/page.tsx') foundHome = true;
    if (/^(?:app|lib|components|hooks|demo|scripts)\/.+\.(?:[cm]?[jt]s|[jt]sx)$/.test(path)) {
      if (inspectDemoSource(readSource(id.split('?')[0]), path).length) throw new Error('Unadapted network access entered the public demo graph: ' + path);
    }
  }
  if (!foundAdapter || !foundHome) throw new Error('The demo must include the actual application and its synthetic transport.');
}
