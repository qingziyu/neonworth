// Static, bounded extraction for the existing Vinext root layout. Never imports
// or executes generated application code. A changed boundary fails closed.
import ts from 'typescript';

const supported = new Map([
  ['WorkspacePreferencesProvider', './workspace-preferences'],
  ['WorkspaceBackground', './workspace-background'],
]);
const fail = message => { throw Object.assign(new Error(message), { code: 'LAYOUT_GRAPH_UNRESOLVED' }); };
const literal = node => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
const visit = (node, callback) => { callback(node); ts.forEachChild(node, child => visit(child, callback)); };

export function layoutClientReferences({ layoutSource, serverSource, clientReferenceDeps }) {
  const layout = ts.createSourceFile('app/layout.tsx', layoutSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const server = ts.createSourceFile('dist/server/index.js', serverSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (layout.parseDiagnostics.length || server.parseDiagnostics.length) fail('Could not statically parse the layout and generated client-reference registrations.');
  const imports = new Map();
  for (const statement of layout.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) {
      if (!binding.isTypeOnly) imports.set(binding.name.text, { exportName: binding.propertyName?.text ?? binding.name.text, source: literal(statement.moduleSpecifier) });
    }
  }
  const root = layout.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'RootLayout');
  if (!root) fail('The supported RootLayout declaration is missing.');
  const rendered = new Map();
  visit(root, node => {
    if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) return;
    const name = node.tagName.getText(layout);
    if (/^[a-z][\w-]*$/.test(name)) return;
    const imported = imports.get(name);
    if (!imported || supported.get(imported.exportName) !== imported.source) fail('The layout renders an unknown component boundary; update the footprint selector before measuring.');
    rendered.set(imported.exportName, { ...imported, kind: 'application' });
  });
  if (!rendered.has('WorkspacePreferencesProvider')) fail('The expected layout preference owner is missing.');
  // The pinned Vinext route wrapper always renders this client boundary, even
  // though serverResources[layout].js is empty. Keep it explicit and auditable.
  rendered.set('LayoutSegmentProvider', { exportName: 'LayoutSegmentProvider', source: 'vinext/dist/shims/layout-segment-context.js', kind: 'framework' });
  const ids = new Map([...rendered.keys()].map(name => [name, new Set()]));
  visit(server, node => {
    if (!ts.isCallExpression(node) || node.arguments.length !== 3) return;
    const [callback, reference, exported] = node.arguments, name = literal(exported);
    if (!ids.has(name) || !ts.isArrowFunction(callback) || !ts.isBlock(callback.body)) return;
    const statements = callback.body.statements;
    if (statements.length !== 1 || !ts.isThrowStatement(statements[0])) return;
    const error = statements[0].expression;
    if (!error || !ts.isCallExpression(error) || !ts.isIdentifier(error.expression) || error.expression.text !== 'Error' || error.arguments.length !== 1) return;
    if (literal(error.arguments[0]) !== `Unexpectedly client reference export '${name}' is called on server`) return;
    const id = literal(reference);
    if (!id || !/^[\da-f]+$/i.test(id)) fail('A layout client reference has an unsupported generated ID.');
    ids.get(name).add(id);
  });
  return [...rendered.values()].map(({ exportName, source, kind }) => {
    const candidates = [...ids.get(exportName)];
    if (candidates.length !== 1) fail('A rendered layout client reference is missing or ambiguous in the server build.');
    const referenceId = candidates[0], dependencies = clientReferenceDeps?.[referenceId];
    if (!Object.hasOwn(clientReferenceDeps ?? {}, referenceId) || !Array.isArray(dependencies?.js) || !dependencies.js.length || !Array.isArray(dependencies.css)) fail('A rendered layout client reference has no supported manifest dependency group.');
    return { exportName, source, kind, referenceId, dependencies };
  });
}
