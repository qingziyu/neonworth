import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, realpathSync } from 'node:fs';
import { resolve, dirname, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const read = path => readFileSync(resolve(root, path), 'utf8');
const manifest = JSON.parse(read('plugin.json'));
const catalog = JSON.parse(read('.agents/plugins/marketplace.json'));

function inside(root, path) {
  const result = relative(root, path);
  return result === '' || (!result.startsWith('..' + sep) && result !== '..' && !result.startsWith(sep));
}
function packagePath(path) {
  assert.equal(typeof path, 'string');
  assert.ok(path.startsWith('./'), 'Packaged component paths are explicit and relative');
  assert.ok(!path.split('/').includes('..'), 'Packaged component paths cannot traverse parents');
  const target = resolve(root, path);
  assert.ok(inside(root, target), 'Packaged component paths stay in the package');
  assert.ok(existsSync(target), 'A referenced component must exist');
  assert.ok(inside(realpathSync(root), realpathSync(target)), 'Packaged components cannot resolve outside the package');
  return target;
}
function validate(manifest, catalog) {
  assert.equal(manifest.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.match(manifest.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/);
  assert.equal(manifest.license, 'MIT');
  assert.ok(manifest.description && manifest.author?.name);
  const openai = manifest.extensions?.['com.openai'];
  assert.ok(openai);
  const onboarding = packagePath(openai.onboardingSkill);
  assert.ok(onboarding.endsWith('/SKILL.md'));
  assert.ok(inside(resolve(root, 'skills'), onboarding));
  assert.ok(openai.interface?.displayName?.length <= 30 && openai.interface.displayName.length > 0);
  assert.ok(openai.interface?.shortDescription?.length <= 30 && openai.interface.shortDescription.length > 0);
  assert.deepEqual(openai.interface.capabilities, [], 'This package claims no bundled tools');
  for (const value of [manifest, openai]) for (const field of ['apps', 'mcpServers', 'hooks']) assert.equal(value[field], undefined, 'The workflow package contains no account/server or hook wiring');
  assert.equal(catalog.plugins.length, 1);
  const entry = catalog.plugins[0];
  assert.equal(entry.name, manifest.name);
  assert.equal(entry.source.source, 'local');
  assert.equal(packagePath(entry.source.path), root, 'Catalog resolves the actual root plugin rather than a duplicate copy');
  assert.equal(entry.policy.installation, 'AVAILABLE');
  assert.equal(entry.policy.authentication, 'ON_USE', 'Installing instructions must not start connection setup');
  return onboarding;
}
validate(manifest, catalog);
for (const name of ['mcp.json', '.mcp.json', '.app.json', 'hooks/hooks.json']) assert.equal(existsSync(resolve(root, name)), false, 'Instructions-only package must not silently acquire service or hook configuration');
const badPath = structuredClone(manifest); badPath.extensions['com.openai'].onboardingSkill = './../private/SKILL.md';
assert.throws(() => validate(badPath, catalog), /traverse parents/);
const missing = structuredClone(manifest); missing.extensions['com.openai'].onboardingSkill = './skills/missing/SKILL.md';
assert.throws(() => validate(missing, catalog), /must exist/);
const wrongRoot = structuredClone(catalog); wrongRoot.plugins[0].source.path = './skills/';
assert.throws(() => validate(manifest, wrongRoot), /actual root plugin/);
const injected = structuredClone(manifest); injected.extensions['com.openai'].apps = './.app.json';
assert.throws(() => validate(injected, catalog), /no account\/server/);

const markdown = [];
function collect(directory) {
  for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) collect(path);
    else if (entry.name.endsWith('.md')) markdown.push(path);
  }
}
collect('skills'); collect('prompts');
for (const file of markdown) {
  for (const match of read(file).matchAll(/\]\(([^)]+)\)/g)) {
    const link = match[1].split('#')[0];
    if (!link || /^[a-z][a-z0-9+.-]*:/i.test(link)) continue;
    const target = resolve(root, dirname(file), link);
    assert.ok(inside(root, target), `${file}: local reference must stay within the distributed repository`);
    assert.ok(existsSync(target), `${file}: local reference must resolve: ${link}`);
    assert.ok(inside(realpathSync(root), realpathSync(target)), `${file}: reference cannot resolve outside the distributed repository`);
  }
}
// Use Git's real ignore parser: expose exactly the public catalog, not future
// private notes or runtime state under the same directory.
const candidates = ['.agents/session.json', '.agents/plugins/private-notes.md', '.agents/other/manifest.json', '.agents/plugins/marketplace.json'];
const ignored = new Set(execFileSync('git', ['check-ignore', '--no-index', '--stdin'], { cwd: root, input: candidates.join('\n') + '\n', encoding: 'utf8' }).trim().split('\n'));
for (const path of candidates.slice(0, 3)) assert.ok(ignored.has(path), `${path} must stay private to the checkout`);
assert.ok(!ignored.has(candidates[3]), 'The public marketplace catalog must be distributable');
console.log('Workflow package: portable manifest, real catalog resolution, instructions-only boundary, contained/discoverable references and narrow agent-state ignore exception passed.');
