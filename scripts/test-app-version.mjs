import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appBuildId } from './app-build-id.mjs';
import { APP_VERSION, appVersionChanged, readAppVersion } from '../lib/app-version.ts';
import ts from 'typescript';

const root = mkdtempSync(join(tmpdir(), 'neonworth-app-version-'));
try {
  mkdirSync(join(root, 'app'));mkdirSync(join(root, 'lib'));mkdirSync(join(root, 'outputs'));
  writeFileSync(join(root, 'app/page.tsx'), 'source page');
  writeFileSync(join(root, 'lib/rules.ts'), 'source rules');
  writeFileSync(join(root, 'package.json'), '{"version":"1"}');
  const first = appBuildId(root);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(appBuildId(root), first, 'Unchanged source produces the same browser/Worker identity');
  writeFileSync(join(root, 'outputs/private.json'), 'runtime record');
  writeFileSync(join(root, '.env'), 'secret');
  assert.equal(appBuildId(root), first, 'Private runtime files and environment secrets are outside the fingerprint');
  writeFileSync(join(root, 'lib/rules.ts'), 'updated rules');
  const next = appBuildId(root);assert.notEqual(next, first, 'Accounting changes produce a new app identity');
  writeFileSync(join(root, 'lib/rules.ts'), 'source rules');assert.equal(appBuildId(root), first);
  writeFileSync(join(root, 'app/new.tsx'), 'new view');assert.notEqual(appBuildId(root), first);
  unlinkSync(join(root, 'app/new.tsx'));assert.equal(appBuildId(root), first);
  writeFileSync(join(root, 'package.json'), '{"version":"2"}');assert.notEqual(appBuildId(root), first);
  symlinkSync(join(root, '.env'), join(root, 'app/external.ts'));assert.throws(() => appBuildId(root), /symbolic links/);
  assert.equal(APP_VERSION, 'development');
  assert.equal(appVersionChanged(first, first), false);assert.equal(appVersionChanged(first, next), true);
  for (const bad of [null, undefined, {}, 'new version', 'development']) assert.equal(appVersionChanged(first, bad), false);
  assert.equal(appVersionChanged('development', first), false);
  const signal = new AbortController().signal;
  let called = false;
  const valid = await readAppVersion(signal, async (url, options) => {called = true;assert.equal(url, '/api/app-version');assert.equal(options.cache, 'no-store');assert.equal(options.credentials, 'same-origin');assert.equal(options.signal, signal);return Response.json({version:next});});
  assert.equal(called, true);assert.equal(valid, next);
  for (const payload of [null, [], {}, {version:'development'}, {version:42}]) assert.equal(await readAppVersion(undefined, async () => Response.json(payload)), null);
  assert.equal(await readAppVersion(undefined, async () => new Response('Sign in', {status:401})), null);
  assert.equal(await readAppVersion(undefined, async () => {throw new Error('Network unavailable');}), null);
  assert.equal(await readAppVersion(undefined, async () => new Response('not json')), null);
  const compile = file => ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX},fileName:file}).outputText;
  const route = {};
  new Function('require','exports',compile('../app/api/app-version/route.ts'))(() => ({APP_VERSION:first}),route);
  const response = await route.GET();assert.equal(route.dynamic,'force-dynamic');assert.deepEqual(await response.json(),{version:first});assert.match(response.headers.get('cache-control'),/private, no-store/);assert.equal(response.headers.get('vary'),'Cookie');

  // Run the real component with controlled hook/DOM boundaries: checking for an
  // update must not navigate or discard a draft; only an enabled click may do so.
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  let available=false,effectStarted=false,cleanup,reloads=0,reads=0,remote=next;
  const listeners=new Map(),timers=new Map();let timerId=0;
  globalThis.window={location:{reload(){reloads++;}},addEventListener(name,fn){listeners.set('window:'+name,fn)},removeEventListener(name,fn){assert.equal(listeners.get('window:'+name),fn);listeners.delete('window:'+name)},setTimeout(fn){timers.set(++timerId,fn);return timerId},clearTimeout(id){timers.delete(id)},setInterval(fn){timers.set(++timerId,fn);return timerId},clearInterval(id){timers.delete(id)}};
  globalThis.document={visibilityState:'visible',addEventListener(name,fn){listeners.set('document:'+name,fn)},removeEventListener(name,fn){assert.equal(listeners.get('document:'+name),fn);listeners.delete('document:'+name)}};
  try {
    const component={};const jsx=(type,props)=>({type,props});
    new Function('require','exports',compile('../app/app-update-notice.tsx'))(name=>name==='react'?{useState(){return[available,value=>{available=value}]},useEffect(callback){if(!effectStarted){effectStarted=true;cleanup=callback()}}}:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='lucide-react'?{RefreshCw:()=>null}:name==='@/lib/app-version'?{APP_VERSION:first,appVersionChanged,readAppVersion:async()=>{reads++;return remote}}:{},component);
    assert.equal(component.AppUpdateNotice({blocked:false}),null);
    await Promise.resolve();await Promise.resolve();assert.equal(available,true);assert.equal(reloads,0,'Detection never reloads the page');
    const button=view=>view.props.children.find(child=>child?.type==='button');
    const blocked=button(component.AppUpdateNotice({blocked:true}));assert.equal(blocked.props.disabled,true);blocked.props.onClick();assert.equal(reloads,0,'Open editing/save context blocks even direct handler calls');
    const enabled=button(component.AppUpdateNotice({blocked:false}));enabled.props.onClick();assert.equal(reloads,1,'Explicit enabled click reloads once');
    document.visibilityState='hidden';listeners.get('window:focus')();await Promise.resolve();assert.equal(reads,1,'Hidden tabs do not poll');
    document.visibilityState='visible';remote=first;listeners.get('document:visibilitychange')();await Promise.resolve();await Promise.resolve();assert.equal(available,false,'A matching release clears the update notice');assert.equal(reloads,1);
    cleanup();assert.equal(listeners.size,0);assert.equal(timers.size,0);
  } finally {globalThis.window=previousWindow;globalThis.document=previousDocument;}
  console.log('App version: deterministic private-state-free source identity, current/malformed/failing no-store reads, private route, explicit draft-safe update action, visible polling and cleanup passed.');
} finally {rmSync(root, {recursive:true,force:true});}
