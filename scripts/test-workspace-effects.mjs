// Real native controllers with synthetic DOM/timing; no network or private data.
// Browser paint, focus visibility and responsive geometry remain separate gates.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

class Events {
  listeners = new Map();
  addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  emit(name, event = {}) { for (const fn of this.listeners.get(name) || []) fn(event); }
  count() { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0); }
}
function fixture() {
  const view = new Events(), document = new Events(), policy = new Events();
  const frames = new Map(), observers = [];
  let sequence = 0;
  policy.matches = true;
  view.matchMedia = query => { view.query = query; return policy; };
  view.requestAnimationFrame = callback => { const id = ++sequence; frames.set(id, callback); return id; };
  view.cancelAnimationFrame = id => frames.delete(id);
  view.ResizeObserver = class {
    targets = new Set();
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target) { this.targets.add(target); }
    unobserve(target) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); this.disconnected = true; }
  };
  document.defaultView = view; document.hidden = false;
  const element = (rect = { top: 100, left: 20, width: 200, height: 80 }) => {
    const node = new Events();
    node.ownerDocument = document;
    node.rect = rect;
    node.attributes = new Map();
    node.style = {
      setProperty(name, value) { this[name] = value; },
      removeProperty(name) { delete this[name]; },
    };
    node.scrollTop = 0; node.clientTop = 0;
    node.getBoundingClientRect = () => node.rect;
    node.getClientRects = () => node.visible === false ? [] : [node.rect];
    node.setAttribute = (name, value) => node.attributes.set(name, value);
    node.removeAttribute = name => node.attributes.delete(name);
    return node;
  };
  const flush = () => { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(); };
  return { view, document, policy, frames, observers, element, flush };
}

await mkdir('.sites-runtime', { recursive: true });
const dir = await mkdtemp(path.resolve('.sites-runtime/workspace-effects-'));
try {
  const source = await readFile('app/workspace-effects.tsx', 'utf8');
  await writeFile(path.join(dir, 'effects.mjs'), ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText);
  const { PointerLight, NavigationMarker, bindPointerLight, bindNavigationMarker } = await import(pathToFileURL(path.join(dir, 'effects.mjs')).href);
  const p = fixture(), surface = p.element();
  const cleanup = bindPointerLight(surface);
  assert.match(p.view.query, /no-preference.*hover: hover.*pointer: fine.*forced-colors: none/);
  surface.emit('pointermove', { pointerType: 'touch', clientX: 40, clientY: 120 });
  assert.equal(p.frames.size, 0, 'Touch cannot start a decorative frame');
  for (let x = 30; x <= 80; x++) surface.emit('pointermove', { pointerType: 'mouse', clientX: x, clientY: 125 });
  assert.equal(p.frames.size, 1, 'A pointer burst coalesces to one pending frame');
  p.flush();
  assert.equal(surface.style['--pointer-light-x'], '60px');
  assert.equal(surface.style['--pointer-light-y'], '25px');
  assert.equal(surface.attributes.get('data-pointer-light'), 'active');
  assert.equal(p.frames.size, 0, 'Painting does not schedule another frame');
  surface.emit('pointermove', { pointerType: 'mouse', clientX: 90, clientY: 130 });
  const stalePointerFrame = [...p.frames.values()][0];
  surface.emit('pointerleave');
  stalePointerFrame();
  assert.equal(p.frames.size, 0);
  assert.equal(surface.attributes.has('data-pointer-light'), false, 'Leaving clears queued activation');
  surface.emit('pointerenter', { pointerType: 'mouse', clientX: 50, clientY: 120 });
  p.policy.matches = false; p.policy.emit('change'); p.flush();
  assert.equal(surface.attributes.has('data-pointer-light'), false, 'A live reduced-motion/fine-pointer change clears the effect');
  surface.emit('pointermove', { pointerType: 'mouse', clientX: 50, clientY: 120 });
  assert.equal(p.frames.size, 0);
  p.policy.matches = true; p.policy.emit('change');
  surface.emit('pointermove', { pointerType: 'mouse', clientX: 50, clientY: 120 });
  p.document.hidden = true; p.document.emit('visibilitychange');
  assert.equal(p.frames.size, 0, 'Backgrounding the document clears scheduled work');
  p.document.hidden = false;
  surface.emit('pointermove', { pointerType: 'mouse', clientX: 50, clientY: 120 });
  const afterUnmount = [...p.frames.values()][0];
  cleanup(); afterUnmount();
  assert.equal(p.frames.size, 0); assert.equal(surface.count(), 0); assert.equal(p.policy.count(), 0); assert.equal(p.document.count(), 0);
  assert.equal(surface.attributes.has('data-pointer-light'), false, 'Unmount cannot resurrect the effect');

  const n = fixture(), host = n.element({ top: 30, left: 0, width: 200, height: 400 }), marker = n.element();
  const first = n.element({ top: 50, left: 10, width: 180, height: 44 });
  const second = n.element({ top: 120, left: 10, width: 180, height: 44 });
  host.target = first;
  host.querySelector = selector => { assert.equal(selector, '[aria-current="page"]'); return host.target; };
  let midFlightOffset = 0;
  marker.getBoundingClientRect = () => ({ top: host.rect.top + parseFloat(marker.style.top || 0) + midFlightOffset, height: 28 });
  const animations = [];
  marker.animate = (keyframes, options) => {
    const animation = { keyframes, options, cancelled: false, cancel() { this.cancelled = true; } };
    animations.push(animation); return animation;
  };
  const nav = bindNavigationMarker(host, marker);
  assert.equal(marker.style.top, '20px'); assert.equal(marker.style.height, '44px');
  assert.equal(animations.length, 0, 'Initial marker placement is immediate');
  host.target = second; nav.refresh();
  assert.equal(marker.style.top, '90px');
  assert.deepEqual(animations[0].keyframes, [{ transform: 'translateY(-70px) scaleX(.78)', opacity: .35 }, { transform: 'translateY(-8.4px) scaleX(1.04)', opacity: 1, offset: .72 }, { transform: 'translateY(0) scaleX(1)', opacity: 1 }]);
  assert.equal(marker.style.width, '180px'); assert.equal(marker.style.left, '10px');
  n.observers[0].callback(); n.flush();
  assert.equal(animations[0].cancelled, false, 'The newly observed link initial resize notification must not cancel same-geometry travel');
  host.emit('toggle'); n.flush();
  assert.equal(animations[0].cancelled, false, 'A same-geometry details notification must not cancel travel');
  assert.equal(animations[0].options.iterations, 1); assert.equal(animations[0].options.duration, 460);
  midFlightOffset = -20;
  host.target = first; nav.refresh();
  assert.equal(animations[0].cancelled, true, 'Rapid navigation cancels the previous marker animation');
  assert.equal(animations[1].keyframes[0].transform, 'translateY(50px) scaleX(.78)', 'The next movement starts from the actual in-flight marker position');
  midFlightOffset = 0;
  n.policy.matches = false; n.policy.emit('change');
  assert.equal(animations[1].cancelled, true, 'Reduced motion cancels an animation already running');
  host.target = second; nav.refresh();
  assert.equal(animations.length, 2); assert.equal(marker.style.top, '90px', 'Reduced motion still updates selection immediately');
  host.target = null; nav.refresh();
  assert.equal(marker.style.visibility, 'hidden', 'A destination outside this nav has no stale marker');
  host.target = first; first.visible = false; nav.refresh();
  assert.equal(marker.style.visibility, 'hidden', 'Collapsed groups do not leave a marker on another link');
  first.visible = true; n.policy.matches = true;
  host.emit('toggle'); n.flush();
  assert.equal(marker.style.visibility, 'visible'); assert.equal(animations.length, 2, 'Disclosure/resize geometry settles without decorative travel');
  assert.equal(n.observers[0].targets.has(first), true);
  host.emit('toggle'); const staleNavFrame = [...n.frames.values()][0];
  nav.dispose(); staleNavFrame();
  assert.equal(marker.style.visibility, 'hidden'); assert.equal(n.frames.size, 0); assert.equal(n.observers[0].disconnected, true);
  assert.equal(host.count(), 0); assert.equal(n.view.count(), 0); assert.equal(n.policy.count(), 0); assert.equal(n.document.count(), 0);
  for (const node of [host, first, second]) assert.deepEqual(Object.keys(node.style), ['setProperty', 'removeProperty'], 'No link, content or shell styles are animated or changed');

  for (const broken of [() => ({ matches: false }), () => { throw new Error('Unavailable media API'); }]) {
    const f = fixture(), brokenHost = f.element(), brokenMarker = f.element();
    f.view.matchMedia = broken; brokenHost.querySelector = () => f.element();
    assert.doesNotThrow(() => bindPointerLight(brokenHost)());
    const binding = bindNavigationMarker(brokenHost, brokenMarker); binding.refresh(); binding.dispose();
    assert.equal(brokenHost.count(), 0, 'Missing APIs retain native functionality and clean listeners');
  }

  const quiet = fixture(), quietHost = quiet.element(), quietMarker = quiet.element();
  const q1 = quiet.element({ top: 10, left: 10, width: 180, height: 44 });
  const q2 = quiet.element({ top: 80, left: 10, width: 180, height: 44 });
  quietHost.target = q1; quietHost.querySelector = () => quietHost.target;
  quietMarker.animate = () => { throw new Error('Quiet must not animate navigation'); };
  const quietNav = bindNavigationMarker(quietHost, quietMarker, false);
  quietHost.target = q2; quietNav.refresh();
  assert.equal(quietMarker.style.visibility, 'visible', 'Quiet retains immediate active placement');
  quietNav.dispose();

  const clipping = fixture(), clipHost = clipping.element(), clipMarker = clipping.element();
  const c1 = clipping.element({ top: 10, left: 10, width: 180, height: 44 });
  const c2 = clipping.element({ top: 80, left: 10, width: 180, height: 44 });
  let io;
  clipping.view.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; io = this; }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  };
  const clipAnimations = [];
  clipMarker.animate = () => { const a = { cancel() { this.cancelled = true; } }; clipAnimations.push(a); return a; };
  clipHost.target = c1; clipHost.querySelector = () => clipHost.target;
  const clipNav = bindNavigationMarker(clipHost, clipMarker);
  io.callback([{ target: clipHost, isIntersecting: true }]); clipping.flush();
  clipHost.target = c2; clipNav.refresh();
  assert.equal(clipAnimations.length, 1);
  io.callback([{ target: clipHost, isIntersecting: false }]);
  assert.equal(clipAnimations[0].cancelled, true, 'Offscreen clipping cancels travel');
  clipHost.target = c1; clipNav.refresh();
  assert.equal(clipAnimations.length, 1, 'Offscreen changes only settle static placement');
  io.callback([{ target: clipHost, isIntersecting: true }]); clipping.flush();
  assert.equal(clipAnimations.length, 1, 'Returning onscreen does not replay');
  clipNav.dispose(); io.callback([{ target: clipHost, isIntersecting: true }]);
  assert.equal(io.disconnected, true); assert.equal(clipping.frames.size, 0, 'Disposed observation cannot schedule work');

  const markup = renderToStaticMarkup(React.createElement(PointerLight, { className: 'action-surface', tone: 'violet' }, React.createElement('a', { href: '/?view=goals' }, 'Your FIRE plan')));
  assert.equal((markup.match(/aria-hidden="true"/g) || []).length, 2);
  assert.match(markup, /<a href="\/\?view=goals">Your FIRE plan<\/a>/);
  assert.doesNotMatch(markup, /tabindex|role="button"|data-pointer-light=/, 'Decoration creates no focus stop, control or initial motion');
  const navMarkup = renderToStaticMarkup(React.createElement(NavigationMarker, { currentId: 'CANARY_DO_NOT_EMIT', containerRef: { current: null } }));
  assert.match(navMarkup, /aria-hidden="true"/); assert.doesNotMatch(navMarkup, /CANARY_DO_NOT_EMIT/);
  const disabled = renderToStaticMarkup(React.createElement(PointerLight, { enabled: false }, 'Unchanged content'));
  assert.doesNotMatch(disabled, /data-light-enabled/);
} finally { await rm(dir, { recursive: true, force: true }); }
console.log('Workspace effects passed: coalesced pointer work, live policy/visibility cancellation, cleanup, finite marker travel, rapid navigation, resize/disclosure placement and inert accessible decoration. Browser appearance remains separate.');
