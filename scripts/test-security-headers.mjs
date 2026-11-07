import assert from 'node:assert/strict';
import { secureRequest, secureResponse } from '../lib/security-headers.ts';

const url = 'https://money.example.test/api/refresh';
const input = new Request(url, { method: 'POST', headers: {
  'Content-Security-Policy': "script-src 'nonce-attacker' 'unsafe-inline'",
  'Content-Security-Policy-Report-Only': "default-src *",
  'x-nonce': 'attacker', 'Content-Type': 'application/json',
  'Cf-Access-Jwt-Assertion': 'synthetic-access-assertion',
  'Origin': new URL(url).origin,
}, body: '{"action":"begin"}' });
const secured = secureRequest(input);
assert.match(secured.policy, /script-src 'self' 'nonce-[A-Za-z0-9+/]{32}' 'strict-dynamic'/);
assert.doesNotMatch(secured.policy, /attacker|unsafe-eval/);
assert.ok(!secured.policy.split(';').find(v=>v.trim().startsWith('script-src ')).includes('unsafe-inline'));
assert.equal(secured.request.headers.get('content-security-policy-report-only'), null);
assert.equal(secured.request.headers.get('x-nonce'), null);
assert.equal(secured.request.headers.get('Cf-Access-Jwt-Assertion'), 'synthetic-access-assertion');
assert.equal(secured.request.headers.get('origin'), new URL(url).origin);
assert.deepEqual(await secured.request.json(), { action: 'begin' });
assert.notEqual(secureRequest(new Request(url)).policy, secureRequest(new Request(url)).policy);
const response = secureResponse(new Response('streamed body', { status: 400, headers: {
  'Cache-Control': 'public, max-age=3600', Vary: 'RSC',
  'Content-Type': 'text/html', 'Set-Cookie': 'test=1; HttpOnly; Secure',
}}), secured.policy, url);
assert.equal(response.status, 400);
assert.equal(await response.text(), 'streamed body');
assert.equal(response.headers.get('content-security-policy'), secured.policy);
assert.equal(response.headers.get('x-frame-options'), 'DENY');
assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
assert.match(response.headers.get('cache-control'), /private, no-store/);
assert.match(response.headers.get('strict-transport-security'), /max-age=31536000/);
assert.equal(response.headers.get('vary'), 'RSC, Cookie');
assert.equal(response.headers.get('set-cookie'), 'test=1; HttpOnly; Secure');
assert.match(secured.policy, /frame-ancestors 'none'/);
assert.match(secured.policy, /connect-src 'self'/);
const local = secureRequest(new Request('http://127.0.0.1:8787/'));
assert.doesNotMatch(local.policy, /upgrade-insecure-requests/);
assert.equal(secureResponse(new Response('local'),local.policy,'http://127.0.0.1:8787/').headers.get('strict-transport-security'),null);
console.log('Security headers: unpredictable server nonce, intact service/body/session semantics, private caching and browser restrictions verified.');
