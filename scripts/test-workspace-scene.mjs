// Real native controllers and SSR component against synthetic DOM/WAAPI.
// Browser interaction, paint, responsive collisions and contrast are separate.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const { parse } = createRequire(import.meta.resolve('vite/package.json'))('postcss');

class Events {
  listeners = new Map();
  addEventListener(name, callback) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(callback); }
  removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
  emit(name, event = {}) { for (const callback of this.listeners.get(name) || []) callback(event); }
  count() { return [...this.listeners.values()].reduce((total, entries) => total + entries.size, 0); }
}
const trackCounts = { '.workspace-scene__star-drift': 1, '.workspace-scene__wave-front': 1, '.workspace-scene__wave-back': 1,
  '.workspace-scene__aurora-front': 1, '.workspace-scene__aurora-back': 1, '.workspace-scene__thread-drift': 1, '.workspace-scene__glyph-column': 8 };
const renderedTargets = (html, selector) => {
  assert.match(selector, /^\.[a-z_-]+$/, 'The markup selector check supports the actual single-class selectors');
  return [...html.matchAll(/<([a-zA-Z]+)\b[^>]*\bclass="([^"]*)"[^>]*>/g)]
    .filter(match => match[2].split(/\s+/).includes(selector.slice(1)));
};
function fixture({ observer = true, animate = true, reduced = false, visible = true, hidden = false, printing = false } = {}) {
  const view = new Events(), document = new Events(), policy = new Events(), print = new Events();
  const observers = [], animations = [], targets = new Map();
  view.innerHeight = 900; view.innerWidth = 1440;
  policy.matches = !reduced; print.matches = printing;
  view.matchMedia = query => {
    if (query === 'print') return print;
    assert.equal(query, '(prefers-reduced-motion: no-preference) and (forced-colors: none)'); return policy;
  };
  for (const api of ['requestAnimationFrame', 'setTimeout', 'setInterval', 'fetch']) view[api] = () => assert.fail(`Artwork must not use ${api}`);
  document.defaultView = view; document.hidden = hidden;
  const scene = new Events();
  scene.ownerDocument = document; scene.attributes = new Map();
  scene.getAttribute = name => scene.attributes.get(name) ?? null;
  scene.setAttribute = (name, value) => scene.attributes.set(name, value);
  scene.rect = { left: 580, top: 80, right: 1060, bottom: 320, width: 480, height: 240 };
  scene.visible = visible;
  scene.getBoundingClientRect = () => scene.rect;
  scene.getClientRects = () => scene.visible ? [scene.rect] : [];
  const makeTarget = name => {
    const target = { name };
    if (animate) target.animate = (keyframes, options) => {
      const animation = { name, keyframes, options, cancelled: false, playState: 'running',
        cancel() { this.cancelled = true; this.playState = 'idle'; }, finish() { this.playState = 'finished'; } };
      animations.push(animation); return animation;
    };
    return target;
  };
  const illumination = makeTarget('illumination');
  scene.animate = () => assert.fail('The button/container itself must never animate');
  scene.querySelector = selector => { assert.equal(selector, '.workspace-scene__illumination'); return illumination; };
  scene.querySelectorAll = selector => {
    assert.ok(selector in trackCounts, `Only approved decorative SVG groups may animate: ${selector}`);
    if (!targets.has(selector)) targets.set(selector, Array.from({ length: trackCounts[selector] }, (_, index) => makeTarget(`${selector}:${index}`)));
    return targets.get(selector);
  };
  if (observer) view.IntersectionObserver = class {
    constructor(callback, options) { this.callback = callback; this.options = options; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
    report(isIntersecting) { this.callback([{ target: this.target, isIntersecting, intersectionRatio: isIntersecting ? 1 : 0 }]); }
  };
  const enter = () => observers.at(-1)?.report(true);
  const pulses = () => animations.filter(animation => animation.name === 'illumination');
  const loops = () => animations.filter(animation => animation.options.iterations === Infinity);
  const running = () => animations.filter(animation => animation.playState === 'running');
  return { view, document, policy, print, observers, animations, targets, scene, illumination, enter, pulses, loops, running };
}

await mkdir('.sites-runtime', { recursive: true });
const directory = await mkdtemp(path.resolve('.sites-runtime/workspace-scene-'));
try {
  const source = await readFile('app/workspace-scene.tsx', 'utf8');
  const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  await writeFile(path.join(directory, 'ambient-motion.mjs'), compile(await readFile('app/ambient-motion.ts', 'utf8')));
  await writeFile(path.join(directory, 'scene.mjs'), compile(source).replace(/(['"])\.\/ambient-motion\1/g, "'./ambient-motion.mjs'"));
  const { bindWorkspaceScene, WorkspaceScene } = await import(pathToFileURL(path.join(directory, 'scene.mjs')).href);
  const { bindAmbientMotion } = await import(pathToFileURL(path.join(directory, 'ambient-motion.mjs')).href);

  // The shared gate transitions only after a fresh, latest matching observation.
  const g = fixture(), changes = [], closeGate = bindAmbientMotion(g.scene, true, active => changes.push(active));
  assert.deepEqual(changes, [false]);
  assert.equal(g.observers[0].options.threshold, .01, 'The notification threshold matches the visibility floor');
  const record = state => ({ target: g.scene, isIntersecting: state, intersectionRatio: state ? 1 : 0 });
  g.observers[0].callback([record(true), record(false)]); assert.deepEqual(changes, [false]);
  g.observers[0].callback([record(false), record(true), { target: {}, isIntersecting: false }]);
  assert.deepEqual(changes, [false, true]); g.enter(); assert.deepEqual(changes, [false, true]);
  const stale = g.observers[0];
  g.document.hidden = true; g.document.emit('visibilitychange'); assert.deepEqual(changes, [false, true, false]);
  assert.equal(stale.disconnected, true);
  g.document.hidden = false; g.document.emit('visibilitychange'); stale.report(true);
  assert.deepEqual(changes, [false, true, false], 'Restoration rejects stale clipping observations');
  g.enter(); assert.deepEqual(changes, [false, true, false, true]);
  g.view.emit('beforeprint'); assert.equal(changes.at(-1), false);
  g.view.emit('afterprint'); assert.equal(changes.at(-1), false); g.enter(); assert.equal(changes.at(-1), true);
  g.print.matches = true; g.print.emit('change'); assert.equal(changes.at(-1), false);
  g.print.matches = false; g.print.emit('change'); g.enter(); assert.equal(changes.at(-1), true);
  g.policy.matches = false; g.policy.emit('change'); assert.equal(changes.at(-1), false);
  g.policy.matches = true; g.policy.emit('change'); g.enter(); assert.equal(changes.at(-1), true);
  closeGate(); const afterClose = [...changes]; g.enter(); g.document.emit('visibilitychange');
  assert.deepEqual(changes, afterClose); assert.equal(changes.at(-1), false);
  for (const events of [g.view, g.document, g.policy, g.print]) assert.equal(events.count(), 0);

  const edge = fixture(), edgeChanges = [], closeEdge = bindAmbientMotion(edge.scene, true, active => edgeChanges.push(active));
  const edgeEntry = ratio => ({ target: edge.scene, isIntersecting: true, intersectionRatio: ratio });
  edge.observers[0].callback([edgeEntry(0)]);
  edge.observers[0].callback([edgeEntry(.009)]);
  assert.deepEqual(edgeChanges, [false], 'Zero-area and less-than-one-percent ancestor clipping stay static despite true isIntersecting');
  edge.observers[0].callback([edgeEntry(.01)]);
  assert.deepEqual(edgeChanges, [false, true], 'Crossing the configured visibility floor activates');
  edge.observers[0].callback([edgeEntry(1), edgeEntry(0), { target: {}, isIntersecting: true, intersectionRatio: 1 }]);
  assert.deepEqual(edgeChanges, [false, true, false], 'The latest matching zero-area observation stops active work');
  closeEdge();

  const variants = ['overview', 'analysis', 'planning', 'records', 'terminal'];
  const expectedLoops = { overview: 1, analysis: 2, planning: 2, records: 1, terminal: 8 };
  const choreographies = new Set();
  for (const variant of variants) {
    const p = fixture(), availability = [], close = bindWorkspaceScene(p.scene, variant, true, { played: false }, active => availability.push(active));
    const markup = renderToStaticMarkup(React.createElement(WorkspaceScene, { variant, sceneKey: 'synthetic', enabled: true }));
    assert.equal(p.animations.length, 0, 'No work before policy and visibility readiness');
    p.enter(); assert.equal(p.loops().length, expectedLoops[variant]); assert.equal(p.pulses().length, 1);
    let renderedCount = 0;
    for (const selector of p.targets.keys()) {
      const nodes = renderedTargets(markup, selector);
      assert.equal(nodes.length, trackCounts[selector], `${variant}: the synthetic target count must match actual component markup for ${selector}`);
      assert.ok(nodes.every(node => ['g', 'path'].includes(node[1])), 'Only rendered SVG groups/paths receive ambient animation');
      renderedCount += nodes.length;
    }
    assert.equal(p.loops().length, renderedCount, 'Every mocked ambient target exists in the real rendered scene');
    assert.equal(availability.at(-1), true);
    for (const loop of p.loops()) {
      assert.ok(loop.options.duration >= 10000 && loop.options.duration <= 30000, 'Ambient movement is deliberately slow');
      assert.ok(loop.keyframes.some(frame => frame.transform), 'Each composition has actual decorative movement');
      assert.ok(loop.keyframes.every(frame => Object.keys(frame).every(key => ['transform', 'opacity', 'offset', 'easing'].includes(key))));
      assert.equal(loop.options.easing, 'linear', 'Timeline easing must not force a full-speed midpoint reversal');
      assert.ok(loop.keyframes.every(frame => frame.easing === 'ease-in-out'), 'Each motion leg settles at its turning point');
      assert.ok(loop.options.delay >= 0, 'Staggered tracks wait in the static pose instead of jumping into mid-cycle');
      assert.ok(['rotate(0deg)', 'scaleY(1)', 'translateY(0)', 'translate(0, 0)'].includes(loop.keyframes[0].transform), 'Ambient motion begins at the real static pose');
      assert.equal(loop.keyframes.at(-1).transform, loop.keyframes[0].transform, 'The loop seam returns to its initial pose');
      if (variant === 'terminal') {
        assert.equal(loop.keyframes[0].opacity, 1); assert.equal(loop.keyframes.at(-1).opacity, 1);
        assert.equal(loop.keyframes[1].opacity, 0); assert.equal(loop.keyframes[2].opacity, 0, 'Glyph reset happens entirely while invisible');
      }
    }
    choreographies.add(JSON.stringify(p.loops().map(loop => loop.keyframes)));
    assert.equal(p.pulses()[0].options.iterations, 1); assert.ok(p.pulses()[0].options.duration <= 800);
    assert.equal(p.pulses()[0].options.fill, undefined);
    assert.ok(p.pulses()[0].keyframes.every(frame => Object.keys(frame).every(key => ['opacity', 'offset'].includes(key))));
    assert.deepEqual([...p.scene.listeners.keys()], ['click'], 'Only the art button listens for native activation');
    const loopsBefore = p.loops().length;
    for (let index = 0; index < 100; index++) p.scene.emit('click', { detail: index % 2 });
    assert.equal(p.pulses().length, 101);
    assert.ok(p.pulses().slice(0, -1).every(animation => animation.cancelled));
    assert.equal(p.running().length, expectedLoops[variant] + 1, 'Repeated keyboard/mouse clicks replace one finite pulse');
    assert.equal(p.loops().length, loopsBefore, 'Clicks never multiply ambient loops');
    p.scene.setAttribute('aria-disabled', 'true'); p.scene.emit('click');
    assert.equal(p.pulses().length, 101, 'A just-rendered Quiet state blocks clicks before passive effect cleanup');
    p.scene.setAttribute('aria-disabled', 'false');
    close(); p.scene.emit('click'); p.enter();
    assert.equal(p.running().length, 0);
    for (const events of [p.scene, p.view, p.document, p.policy, p.print]) assert.equal(events.count(), 0);
  }
  assert.equal(choreographies.size, 5, 'The five scenes have different movement');

  for (const reason of ['hidden', 'policy', 'offscreen', 'print-event', 'print-media']) {
    const p = fixture(), close = bindWorkspaceScene(p.scene, 'planning', true); p.enter();
    const pulseCount = p.pulses().length;
    if (reason === 'hidden') { p.document.hidden = true; p.document.emit('visibilitychange'); }
    if (reason === 'policy') { p.policy.matches = false; p.policy.emit('change'); }
    if (reason === 'offscreen') p.observers.at(-1).report(false);
    if (reason === 'print-event') p.view.emit('beforeprint');
    if (reason === 'print-media') { p.print.matches = true; p.print.emit('change'); }
    assert.equal(p.running().length, 0, `${reason} stops all finite and ambient work`);
    p.scene.emit('click'); assert.equal(p.pulses().length, pulseCount, 'Unavailable artwork cannot pulse');
    p.document.hidden = false; p.policy.matches = true; p.print.matches = false;
    p.document.emit('visibilitychange'); p.policy.emit('change'); p.print.emit('change'); p.view.emit('afterprint'); p.enter();
    assert.equal(p.running().length, 2, 'Reactivation starts only the two planning ambient tracks');
    assert.equal(p.pulses().length, pulseCount, 'Reactivation never replays completed entry'); close();
  }
  for (const options of [{ enabled: false }, { reduced: true }, { hidden: true }, { printing: true }, { visible: false }]) {
    const p = fixture(options), close = bindWorkspaceScene(p.scene, 'overview', options.enabled !== false);
    p.enter(); p.scene.emit('click'); assert.equal(p.animations.length, 0); close();
  }
  const first = fixture({ reduced: true }), closeFirst = bindWorkspaceScene(first.scene, 'overview', true);
  assert.equal(first.observers.length, 0); first.policy.matches = true; first.policy.emit('change'); first.enter();
  assert.equal(first.loops().length, 1); assert.equal(first.pulses().length, 1); closeFirst();

  for (const failure of ['missing-media', 'throws-media', 'missing-add', 'missing-remove', 'print-remove', 'view-add', 'document-remove', 'throws-print-registration', 'throws-view-registration', 'missing-observer', 'throws-observer', 'throws-observe', 'disabled']) {
    const p = fixture(), updates = [];
    if (failure === 'missing-media') p.view.matchMedia = undefined;
    if (['throws-media', 'disabled'].includes(failure)) p.view.matchMedia = () => { throw new Error('Synthetic media failure'); };
    if (failure === 'missing-add') p.policy.addEventListener = undefined;
    if (failure === 'missing-remove') p.policy.removeEventListener = undefined;
    if (failure === 'print-remove') p.print.removeEventListener = undefined;
    if (failure === 'view-add') p.view.addEventListener = undefined;
    if (failure === 'document-remove') p.document.removeEventListener = undefined;
    if (failure === 'throws-print-registration') p.print.addEventListener = function(...args) {
      Events.prototype.addEventListener.apply(this, args); throw new Error('Synthetic partial media registration');
    };
    if (failure === 'throws-view-registration') p.view.addEventListener = function(...args) {
      Events.prototype.addEventListener.apply(this, args); throw new Error('Synthetic partial window registration');
    };
    if (failure === 'missing-observer') p.view.IntersectionObserver = undefined;
    if (failure === 'throws-observer') p.view.IntersectionObserver = class { constructor() { throw new Error('Synthetic observer failure'); } };
    if (failure === 'throws-observe') p.view.IntersectionObserver = class {
      constructor() { p.observers.push(this); } observe() { throw new Error('Synthetic observe failure'); } disconnect() { this.disconnected = true; }
    };
    let close;
    assert.doesNotThrow(() => { close = bindAmbientMotion(p.scene, failure !== 'disabled', active => updates.push(active)); }, failure);
    assert.deepEqual(updates, [false]);
    for (const events of [p.view, p.document, p.policy, p.print]) assert.equal(events.count(), 0, failure);
    assert.doesNotThrow(close);
    assert.ok(p.observers.every(observer => observer.disconnected), failure);
  }
  const absent = fixture({ animate: false }), unavailable = [], closeAbsent = bindWorkspaceScene(absent.scene, 'overview', true, { played: false }, active => unavailable.push(active));
  absent.enter(); absent.scene.emit('click'); assert.equal(absent.animations.length, 0); assert.equal(unavailable.at(-1), false); closeAbsent();
  const broken = fixture(); let attempts = 0;
  broken.illumination.animate = () => { attempts++; throw new Error('Synthetic animation failure'); };
  const closeBroken = bindWorkspaceScene(broken.scene, 'overview', true); broken.enter(); broken.scene.emit('click');
  assert.equal(attempts, 1, 'A failed pulse API remains static without retries'); closeBroken();
  const partial = fixture(); let loopAttempts = 0;
  partial.scene.querySelectorAll('.workspace-scene__wave-back')[0].animate = () => { loopAttempts++; throw new Error('Synthetic second loop failure'); };
  const closePartial = bindWorkspaceScene(partial.scene, 'analysis', true); partial.enter();
  assert.ok(partial.loops().every(animation => animation.cancelled), 'A partial ambient setup rolls back all native loops');
  partial.document.hidden = true; partial.document.emit('visibilitychange');
  partial.document.hidden = false; partial.document.emit('visibilitychange'); partial.enter();
  assert.equal(loopAttempts, 1, 'Broken loop APIs do not retry on visibility events'); closePartial();

  // Actual effect/dependencies retain memory and the same focusable button.
  const ast = ts.createSourceFile('scene.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect, componentReturn;
  const walk = node => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect') effect = node;
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'WorkspaceScene') componentReturn = node.body.statements.find(statement => ts.isReturnStatement(statement))?.expression;
    ts.forEachChild(node, walk);
  };
  walk(ast); assert.ok(effect);
  const evaluate = (node, env) => new Function(...Object.keys(env), compile(`return (${node.getText(ast)});`))(...Object.values(env));
  const p = fixture(), ref = { current: p.scene }, entryMemory = { current: { key: 'overview', played: false } };
  let deps, cleanup, available = false;
  const render = ({ sceneKey = 'overview', enabled = true, variant = 'overview', ...ignored } = {}) => {
    const env = { sceneKey, enabled, variant, ...ignored, ref, entryMemory, bindWorkspaceScene, setAvailable: next => { available = next; } };
    const next = evaluate(effect.arguments[1], env);
    if (!deps || next.some((value, index) => !Object.is(value, deps[index]))) { cleanup?.(); cleanup = evaluate(effect.arguments[0], env)(); deps = next; }
    p.enter();
  };
  render({ enabled: false }); assert.equal(p.animations.length, 0); assert.equal(available, false);
  render(); assert.equal(p.pulses().length, 1); assert.equal(available, true);
  render({ hidden: true, dataRevision: 'synthetic-correction', date: '2027-01-01' });
  assert.equal(p.observers.length, 1, 'Privacy/data/date rerenders never recreate animation');
  render({ enabled: false }); assert.equal(p.running().length, 0); assert.equal(available, false);
  render(); assert.equal(p.pulses().length, 1); assert.equal(p.running().length, 1, 'Resume keeps entry memory while restarting ambient work');
  render({ sceneKey: 'goals', variant: 'planning' }); assert.equal(p.pulses().length, 2); cleanup(); assert.equal(p.running().length, 0);

  const html = renderToStaticMarkup(React.createElement('div', null, ...variants.map(variant => React.createElement(WorkspaceScene, { key: variant, variant, sceneKey: 'PRIVATE_ROUTE_CANARY', enabled: true }))));
  assert.equal((html.match(/<button\b/g) || []).length, 5);
  assert.equal((html.match(/type="button"/g) || []).length, 5);
  assert.equal((html.match(/aria-label="Lights paused"/g) || []).length, 5);
  assert.equal((html.match(/<svg[^>]*aria-hidden="true"/g) || []).length, 5);
  assert.equal((html.match(/focusable="false"/g) || []).length, 5);
  assert.doesNotMatch(html, /PRIVATE_ROUTE_CANARY|tabindex|<canvas|reticle| disabled(?:=|\s|>)/);
  for (const match of html.matchAll(/aria-describedby="([^"]+)"/g)) assert.ok(html.includes(`id="${match[1]}"`), 'Every button has a real descriptive node');
  const ids = [...html.matchAll(/<(?:linearGradient|radialGradient) id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, 15);
  const geometry = new Set();
  for (const variant of variants) {
    const active = renderToStaticMarkup(React.createElement(WorkspaceScene, { variant, sceneKey: 'one', enabled: true }));
    const quiet = renderToStaticMarkup(React.createElement(WorkspaceScene, { variant, sceneKey: 'two', enabled: false }));
    assert.equal(active, quiet, 'Pre-policy SSR/Quiet retain identical art and button identity');
    assert.match(quiet, /aria-disabled="true"/); assert.match(quiet, /paused or unavailable/);
    const nodes = (active.match(/<(?!\/)[a-zA-Z][^>]*>/g) || []).length;
    assert.ok(nodes <= 110, `${variant} exceeds node budget: ${nodes}`);
    if (variant === 'overview') for (const coordinate of active.matchAll(/\b(?:cx|cy|r)="([^"]+)"/g)) assert.match(coordinate[1], /^-?\d+(?:\.\d{1,2})?$/, 'Star coordinates serialize at bounded precision across engines');
    if (variant === 'terminal') {
      const characters = [...active.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map(match => match[1]);
      assert.equal(characters.length, 68, 'Eight trailing character columns plus four pulse heads stay bounded');
      assert.ok(characters.every(character => /^[01]$/.test(character)), 'Only one fixed decorative binary digit appears in each text node');
      assert.deepEqual(new Set(characters), new Set(['0', '1']), 'The retained terminal illustration matches the shared binary vocabulary');
      const columns = [...active.matchAll(/<g class="workspace-scene__glyph-column [^"]+">([\s\S]*?)<\/g>/g)];
      assert.equal(columns.length, 8);
      for (const [,column] of columns) {
        const cells = [...column.matchAll(/<text\b([^>]+)>([^<]*)<\/text>/g)].map(([,attrs,character]) => ({...Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(([,key,value]) => [key,value])),character}));
        assert.equal(cells.length, 8);
        assert.equal(new Set(cells.map(cell => cell.x)).size, 1, 'The character stream remains a vertical column');
        assert.equal(cells.at(-1).class, 'workspace-scene__glyph-head');
        for (let index = 1; index < cells.length; index++) {
          assert.equal(Number(cells[index].y) - Number(cells[index - 1].y), 22);
          assert.ok(Number(cells[index].opacity) > Number(cells[index - 1].opacity), 'The falling head leads a fading upward trail');
        }
      }
    } else assert.doesNotMatch(active, /<text\b/, 'Only the terminal scene receives a character motif');
    geometry.add([...active.matchAll(/(?: d| cx| cy| rx| ry| x| y)="([^"]+)"/g)].map(match => match[1]).join('|'));
  }
  assert.equal(geometry.size, 5);
  const css = parse(await readFile('app/workspace-scene.css', 'utf8')), rules = [];
  css.walkRules(rule => rules.push(rule));
  const declarations = rule => Object.fromEntries(rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop,node.value]));
  const hover = rules.filter(rule => rule.selector.includes('.workspace-scene:hover'));
  assert.ok(hover.every(rule => Object.keys(declarations(rule)).every(property => !/^(border|outline|box-shadow)(-|$)/.test(property))), 'Pointer hover cannot add an artwork selection frame');
  const focus = rules.find(rule => rule.selector === '.personal-experience .workspace-scene:focus-visible');
  assert.match(declarations(focus).outline, /^2px solid /, 'Keyboard focus retains a visible outline');
  assert.ok(rules.every(rule => !Object.entries(declarations(rule)).some(([property,value]) => property === 'outline' && /^(none|0)$/.test(value))), 'Artwork styling never removes the native focus outline wholesale');
  assert.doesNotMatch(css.toString(), /@font-face|https?:\/\//, 'The character motif uses only available system fonts');
  // Execute the real returned JSX with both policy states. Geometry is covered
  // above using the actual SSR component; this isolates its control semantics.
  assert.ok(componentReturn);
  const renderControl = new Function('React', 'ref', 'variant', 'id', 'paint', 'Geometry', 'enabled', 'available', ts.transpileModule(`return (${componentReturn.getText(ast)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React },
  }).outputText);
  for (const [enabled, available] of [[true, true], [true, false], [false, true], [false, false]]) {
    const label = enabled && available ? 'Pulse lights' : 'Lights paused';
    const rendered = renderToStaticMarkup(renderControl(React, { current: null }, 'overview', 'synthetic', { warm: 'warm', cool: 'cool', bloom: 'bloom' }, () => null, enabled, available));
    assert.ok(rendered.includes(`aria-label="${label}"`));
    assert.ok(rendered.includes(`class="workspace-scene__hint" aria-hidden="true">${label}</span>`), 'The visible label and accessible name agree in every state');
    assert.ok(rendered.includes(`aria-disabled="${!enabled || !available}"`));
    assert.match(rendered, /header artwork|Header lights/, 'The associated description still explains the header context');
  }
} finally { await rm(directory, { recursive: true, force: true }); }
console.log('Atmospheric scenes passed: five distinct slow native motions, bounded repeatable keyboard/click pulse, policy/print/visibility/offscreen gate with fresh observations, full cleanup, focus-preserving native button, fixed SVG/privacy and persistent route memory. Browser geometry/paint remain separate.');
