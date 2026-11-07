// Source/SSR safety checks for decorative motion. Browser geometry, computed
// contrast, keyboard interaction and actual media preferences remain separate.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

// Reuse the CSS parser already required by the pinned styling toolchain.
const require = createRequire(import.meta.resolve('@tailwindcss/postcss'));
const { parse } = require('postcss');
const source = await readFile(new URL('../app/section-trace.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
}).outputText.replaceAll('"react/jsx-runtime"', JSON.stringify(import.meta.resolve('react/jsx-runtime')));
const module = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const SectionTrace = module.SectionTrace ?? module.default;
const tree = SectionTrace();
assert.equal(String(tree.props['aria-hidden']), 'true', 'Decoration is absent from the accessibility tree');
const allowedElements = new Set(['div', 'span', 'svg', 'g', 'path', 'line', 'circle', 'rect', 'polyline']);
const elements = [];
let primitives = 0, svgs = 0;
function inspect(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return;
  assert.ok(React.isValidElement(node), 'Decoration has no financial text, labels or dynamic content');
  assert.ok(allowedElements.has(node.type), 'Decoration contains no interactive or executable elements');
  elements.push({ classes: new Set((node.props.className || '').split(/\s+/)), motion: {} });
  if (node.type === 'svg') {
    svgs++;
    assert.equal(String(node.props['aria-hidden']), 'true');
    assert.equal(String(node.props.focusable), 'false');
  }
  if (['path', 'line', 'circle', 'rect', 'polyline'].includes(node.type)) primitives++;
  for (const key of Object.keys(node.props)) {
    assert.ok(!/^on[A-Z]|^(?:tabIndex|href|xlinkHref|dangerouslySetInnerHTML|aria-label|aria-valuenow|aria-valuetext)$/.test(key), `Unexpected interactive/value property: ${key}`);
  }
  React.Children.forEach(node.props.children, inspect);
}
inspect(tree);
assert.equal(svgs, 1);
assert.ok(primitives > 0 && primitives <= 12, 'Keep a small, fixed SVG ornament');
const markup = renderToStaticMarkup(React.createElement(SectionTrace));
assert.equal(renderToStaticMarkup(React.createElement(SectionTrace, { amount: 987654.32, hidden: false, section: 'Private note $987654.32' })), markup, 'No caller data becomes decorative content');
assert.doesNotMatch(markup, /https?:|data:|<animate|<script|<foreignObject/i);

const css = parse(await readFile(new URL('../app/cyberpunk.css', import.meta.url), 'utf8'));
function ancestors(node) { const result = []; for (let p = node.parent; p; p = p.parent) result.push(p); return result; }
const inMedia = (node, pattern) => ancestors(node).some(p => p.type === 'atrule' && p.name === 'media' && pattern.test(p.params));
const timeMs = value => {
  const match = /^(-?\d*\.?\d+)(ms|s)$/.exec(value);
  assert.ok(match, `Expected an explicit finite CSS time: ${value}`);
  return Number(match[1]) * (match[2] === 's' ? 1000 : 1);
};
const keyframeNames = new Set();
css.walkAtRules(/keyframes$/, rule => keyframeNames.add(rule.params));
let animations = 0;
css.walkDecls(decl => {
  assert.doesNotMatch(decl.value, /url\s*\(|infinite|\bwill-change\b/i, 'No remote resources or perpetual decorative work');
  assert.ok(!['filter', 'backdrop-filter', 'will-change'].includes(decl.prop), 'Keep effects bounded and avoid persistent compositing hints');
  const keyframes = ancestors(decl).find(p => p.type === 'atrule' && /keyframes$/.test(p.name));
  if (keyframes) {
    assert.ok(['opacity', 'transform'].includes(decl.prop), 'Only compositor-friendly decorative keyframes');
  }
  if (/^(?:animation|transition)(?:-|$)/.test(decl.prop) && decl.value !== 'none') {
    assert.ok(inMedia(decl, /prefers-reduced-motion\s*:\s*no-preference/), 'Motion is opt-in to no-preference');
    assert.ok(decl.parent.type === 'rule');
    for (const selector of decl.parent.selectors) assert.match(selector, /^\.section-trace(?:__[a-z-]+)?$/, 'Motion applies only to ornament classes, never data or shell ancestors');
    const affected = elements.filter(element => decl.parent.selectors.some(selector => element.classes.has(selector.slice(1))));
    assert.ok(affected.length, 'Every animated selector matches a rendered decorative primitive');
    if (decl.prop === 'animation') {
      animations++;
      // CSS functions can contain commas; each primitive has one finite effect.
      const parts = decl.value.split(/,(?![^()]*\))/);
      assert.equal(parts.length, 1, 'Avoid stacked decorative animations');
      const tokens = parts[0].replace(/[\w-]+\([^)]*\)/g, '').trim().split(/\s+/);
      const times = tokens.filter(token => /^-?\d*\.?\d+(ms|s)$/.test(token)).map(timeMs);
      const name = tokens.find(token => keyframeNames.has(token));
      const iterations = tokens.find(token => /^\d*\.?\d+$/.test(token));
      assert.ok(name && times.length >= 1 && times.length <= 2);
      affected.forEach(element => Object.assign(element.motion, { name, duration: times[0], delay: times[1] ?? 0, iterations: Number(iterations ?? 1) }));
    } else if (decl.prop === 'animation-delay' || decl.prop === 'animation-duration') {
      affected.forEach(element => { element.motion[decl.prop === 'animation-delay' ? 'delay' : 'duration'] = timeMs(decl.value); });
    } else if (decl.prop === 'animation-iteration-count') {
      affected.forEach(element => { element.motion.iterations = Number(decl.value); });
    } else {
      assert.fail(`Review unsupported decorative motion property: ${decl.prop}`);
    }
  }
});
assert.ok(animations > 0, 'The added effect has finite CSS feedback');
for (const { motion } of elements) {
  if (!motion.name) continue;
  assert.equal(motion.iterations, 1, 'The effect plays once per section navigation');
  assert.ok(motion.duration >= 0 && Math.max(0, motion.delay) + motion.duration <= 820, 'Combined duration and cascaded delay settle within 820ms');
}
const ornamentStatic = css.nodes.filter(node => node.type === 'rule' && node.selectors.some(selector => /(?:^|\s|>)\.section-trace$/.test(selector)));
assert.ok(ornamentStatic.some(rule => rule.nodes.some(decl => decl.prop === 'pointer-events' && decl.value === 'none')), 'Decoration never intercepts interaction');
for (const media of [/\bprint\b/, /forced-colors\s*:\s*active/]) {
  let hidesOrnament = false, hidesMetricCorner = false, hidesPanelCorner = false;
  css.walkRules(rule => {
    if (!inMedia(rule, media)) return;
    const hidden = rule.nodes.some(decl => decl.prop === 'display' && decl.value === 'none');
    if (hidden && rule.selectors.includes('.section-trace')) hidesOrnament = true;
    if (hidden && rule.selectors.some(selector => /\.metric::?after/.test(selector))) hidesMetricCorner = true;
    if (hidden && rule.selectors.some(selector => /\.panel::?after/.test(selector))) hidesPanelCorner = true;
  });
  assert.ok(hidesOrnament && hidesMetricCorner && hidesPanelCorner, 'Print and forced colors omit decoration');
}
console.log('Cyberpunk contract: decorative SSR has no text/data/interactivity; parsed CSS confines finite motion to the ornament under no-preference, respects the duration budget, and removes print/forced-color decoration. Browser acceptance remains required.');
