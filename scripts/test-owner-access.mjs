import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import { createAccessGate, withoutAuthentication } from '../worker/access.ts';

const env = { APP_ORIGIN: 'https://money.example.test', ACCESS_TEAM_DOMAIN: 'https://synthetic-team.cloudflareaccess.com', ACCESS_AUDIENCE: 'synthetic-app-audience', OWNER_EMAIL: 'owner@example.test' };
const pair = await generateKeyPair('RS256');
const other = await generateKeyPair('RS256');
const publicKey = { ...await exportJWK(pair.publicKey), kid: 'synthetic-key', alg: 'RS256', use: 'sig' };
const jwks = { keys: [publicKey] };
const localKeys = createLocalJWKSet(jwks);
const checkedIssuers = [];
const gate = createAccessGate(issuer => { checkedIssuers.push(issuer); return localKeys; });
const now = Math.floor(Date.now() / 1000);
const claims = { iss: env.ACCESS_TEAM_DOMAIN, aud: [env.ACCESS_AUDIENCE], email: env.OWNER_EMAIL, type: 'app', sub: 'synthetic-owner', iat: now - 30, exp: now + 300 };
const sign = (patch = {}, key = pair.privateKey) => new SignJWT({ ...claims, ...patch }).setProtectedHeader({ alg: 'RS256', kid: 'synthetic-key' }).sign(key);
const token = await sign();
const request = (tokenValue = token, headers = {}, path = '/api/data', method = 'GET', origin = env.APP_ORIGIN) => new Request(origin + path, { method, headers: { ...(tokenValue ? { 'Cf-Access-Jwt-Assertion': tokenValue } : {}), ...headers }, ...(method === 'POST' ? { body: '{"synthetic":true}' } : {}) });
async function deny(input, environment = env, expected = 403) {
  const result = await gate(input, environment);
  assert.equal(result?.status, expected);
  assert.equal(await result.text(), expected === 503 ? 'Authentication is not configured.' : 'Access denied.');
}

assert.equal(await gate(request(), env), null);
assert.equal(await gate(request(await sign({ email: 'OWNER@EXAMPLE.TEST' })), env), null);
assert.deepEqual(checkedIssuers, [env.ACCESS_TEAM_DOMAIN, env.ACCESS_TEAM_DOMAIN]);
for (const path of ['/', '/api/data', '/api/import', '/api/refresh', '/api/preferences', '/api/planning', '/api/budget', '/mcp', '/_next/static/app.js']) await deny(request(null, {}, path));
await deny(request(null, { 'Cf-Access-Authenticated-User-Email': env.OWNER_EMAIL, 'Authorization': 'Bearer untrusted' }));
for (const invalid of ['not.a.jwt', `${token.slice(0, -8)}forged00`, await sign({}, other.privateKey), `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`]) await deny(request(invalid));
for (const patch of [
  { iss: 'https://attacker.cloudflareaccess.com' }, { aud: ['another-app'] }, { aud: [env.ACCESS_AUDIENCE, 'another-app'] },
  { email: 'other@example.test' }, { email: null }, { type: 'service' }, { sub: '' },
  { exp: now - 1 }, { exp: undefined }, { iat: now + 3600 }, { iat: undefined }, { nbf: now + 3600 },
]) await deny(request(await sign(patch)));
const hmac = await new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).sign(new TextEncoder().encode('synthetic-not-an-access-key-with-enough-bytes'));
await deny(request(hmac));
await deny(request(token, { Origin: 'https://other.example.test' }, '/api/import', 'POST'));
await deny(request(token, { Origin: 'null' }, '/api/import', 'POST'));
await deny(request(token, { 'Sec-Fetch-Site': 'cross-site' }, '/api/import', 'POST'));
await deny(request(token, { 'Sec-Fetch-Site': 'same-site' }, '/mcp', 'POST'));
assert.equal(await gate(request(token, { Origin: env.APP_ORIGIN, 'Sec-Fetch-Site': 'same-origin' }, '/api/import', 'POST'), env), null);
assert.equal(await gate(request(token, {}, '/mcp', 'POST'), env), null, 'Signed single-owner CLI requests may omit browser Origin');
await deny(request(token, {}, '/', 'GET', 'https://alternate.example.test'));
await deny(request(token, { host: 'other.example.test' }));
for (const key of Object.keys(env)) await deny(request(), { ...env, [key]: '' }, 503);
for (const patch of [{ ACCESS_TEAM_DOMAIN: 'https://synthetic-team.cloudflareaccess.com.attacker.test' }, { ACCESS_TEAM_DOMAIN: 'http://synthetic-team.cloudflareaccess.com' }, { ACCESS_TEAM_DOMAIN: env.ACCESS_TEAM_DOMAIN + '/' }, { OWNER_EMAIL: 'owner@example.test,other@example.test' }, { APP_ORIGIN: env.APP_ORIGIN + '/' }]) await deny(request(), { ...env, ...patch }, 503);

for (const origin of ['http://127.0.0.1:5173', 'http://localhost:8787', 'http://[::1]:8787']) {
  assert.equal(await gate(request(null, {}, '/', 'GET', origin), { LOCAL_DEV: 'true' }), null);
  await deny(request(null, { Origin: 'https://attacker.test' }, '/api/import', 'POST', origin), { LOCAL_DEV: 'true' });
  await deny(request(null, {}, '/', 'GET', origin), {}, 503);
}
for (const origin of ['http://192.168.1.2:5173', 'http://0.0.0.0:5173', 'http://localhost.attacker.test', 'https://localhost:5173', env.APP_ORIGIN]) {
  await deny(request(null, { 'X-Forwarded-Host': 'localhost', 'X-Forwarded-Proto': 'http' }, '/', 'GET', origin), { LOCAL_DEV: 'true' }, 503);
}
await deny(request(null), { ...env, LOCAL_DEV: 'true' });
const stripped = withoutAuthentication(request(token, { Cookie: 'CF_Authorization=synthetic', Authorization: 'Bearer synthetic', 'Cf-Access-Client-Secret': 'synthetic', 'OAI-Authenticated-User-Email': 'synthetic', Origin: env.APP_ORIGIN }, '/api/import', 'POST'));
for (const name of ['cf-access-jwt-assertion', 'cookie', 'authorization', 'cf-access-client-secret', 'oai-authenticated-user-email']) assert.equal(stripped.headers.get(name), null);
assert.equal(stripped.headers.get('origin'), env.APP_ORIGIN);
assert.deepEqual(await stripped.json(), { synthetic: true });

// Exercise the actual remote JWKS path without network: only the configured
// public-key endpoint is contacted, with no assertion, cookie or finance input.
const originalFetch = globalThis.fetch;
let keyReads = 0;
globalThis.fetch = async (url, options) => {
  keyReads++;
  assert.equal(String(url), env.ACCESS_TEAM_DOMAIN + '/cdn-cgi/access/certs');
  assert.equal(new Headers(options.headers).get('cf-access-jwt-assertion'), null);
  assert.equal(new Headers(options.headers).get('cookie'), null);
  return Response.json(jwks);
};
try {
  const remoteGate = createAccessGate();
  assert.equal(await remoteGate(request(), env), null);
  assert.equal(await remoteGate(request(), env), null);
  assert.equal(keyReads, 1, 'A bounded JWKS cache avoids one external read per page asset');
} finally { globalThis.fetch = originalFetch; }

// Run the real Worker adapter: denied calls never enter the framework or D1;
// signed production and local calls strip credentials on both downstream paths.
let calls = 0;
const downstream = [];
const authHeaders = { Cookie: 'CF_Authorization=synthetic-session', Authorization: 'Bearer synthetic-unrelated', 'Cf-Access-Client-Secret': 'synthetic-capability', 'Cf-Access-Authenticated-User-Email': env.OWNER_EMAIL, 'OAI-Authenticated-User-Email': 'synthetic' };
const authHeaderNames = ['cf-access-jwt-assertion', 'cookie', 'authorization', 'cf-access-client-secret', 'cf-access-authenticated-user-email', 'oai-authenticated-user-email'];
const assertStripped = req => {
  for (const name of authHeaderNames) assert.equal(req.headers.get(name), null, `Downstream must not receive ${name}`);
};
globalThis.__neonworthTestHandler = { async fetch(req, appEnv) {
  calls++;
  assert.deepEqual(Object.keys(appEnv).sort(), ['ASSETS', 'BUCKET', 'DB']);
  assertStripped(req);
  downstream.push({ method: req.method, origin: req.headers.get('origin'), body: req.method === 'POST' ? await req.json() : null });
  return Response.json({ accepted: true });
} };
const hook = registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'vinext/server/fetch-handler') return { url: 'data:text/javascript,export default globalThis.__neonworthTestHandler;', shortCircuit: true };
  return next(specifier, context);
} });
try {
  const { default: worker } = await import('../worker/index.ts');
  for (const path of ['/', '/mcp', '/api/data', '/api/import', '/_next/static/app.js']) {
    const result = await worker.fetch(request(null, {}, path), env, {});
    assert.equal(result.status, 403);
    assert.match(result.headers.get('cache-control'), /no-store/);
    assert.equal(result.headers.get('access-control-allow-origin'), null);
  }
  assert.equal(calls, 0);
  const context = { waitUntil() {}, passThroughOnException() {}, abort() {}, tracing: {} };
  const result = await worker.fetch(request(null, {}, '/api/data', 'GET', 'http://127.0.0.1:5173'), { LOCAL_DEV: 'true', DB: {} }, context);
  assert.equal(result.status, 200);
  assert.equal(calls, 1);
  let workerKeyReads = 0;
  globalThis.fetch = async (url, options) => {
    workerKeyReads++;
    assert.equal(String(url), env.ACCESS_TEAM_DOMAIN + '/cdn-cgi/access/certs');
    const headers = new Headers(options.headers);
    for (const name of authHeaderNames) assert.equal(headers.get(name), null);
    return Response.json(jwks);
  };
  for (const [origin, bindings] of [[env.APP_ORIGIN, env], ['http://127.0.0.1:5173', { LOCAL_DEV: 'true' }]]) {
    const signedPost = request(token, { ...authHeaders, Origin: origin, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' }, '/api/import', 'POST', origin);
    const accepted = await worker.fetch(signedPost, { ...bindings, DB: {} }, context);
    assert.equal(accepted.status, 200, 'The real Worker accepts a signed owner or explicit loopback mode');
    assert.deepEqual(downstream.at(-1), { method: 'POST', origin, body: { synthetic: true } }, 'Double request wrapping preserves the actual POST body and Origin');
  }
  assert.equal(workerKeyReads, 1, 'The production Worker actually verifies the signed token using the configured JWKS');
  assert.equal(calls, 3);
  let assetReads = 0;
  const assets = { async fetch(req) {
    assetReads++;
    assert.equal(new URL(req.url).pathname, '/_next/static/app.css');
    assertStripped(req);
    return new Response('/* synthetic bundled asset */', { headers: { 'Content-Type': 'text/css' } });
  } };
  const assetPath = '/_next/static/app.css';
  const protectedAsset = await worker.fetch(request(null, {}, assetPath), { ...env, ASSETS: assets }, context);
  assert.equal(protectedAsset.status, 403);assert.equal(assetReads, 0);
  for (const [origin, bindings] of [[env.APP_ORIGIN, env], ['http://127.0.0.1:5173', { LOCAL_DEV: 'true' }]]) {
    for (const method of ['GET', 'HEAD']) {
      const asset = await worker.fetch(request(token, authHeaders, assetPath, method, origin), { ...bindings, ASSETS: assets }, context);
      assert.equal(asset.status, 200);assert.equal(asset.headers.get('content-type'), 'text/css');
      assert.match(asset.headers.get('cache-control'), /no-store/);
    }
  }
  assert.equal(workerKeyReads, 1, 'The same bounded JWKS cache serves subsequent authenticated asset requests');
  assert.equal(assetReads, 4);assert.equal(calls, 3, 'Authenticated static build files bypass only the framework router');
} finally { hook.deregister(); delete globalThis.__neonworthTestHandler; globalThis.fetch = originalFetch; }
console.log('Owner access: signed JWT/JWKS, issuer/audience/expiry/owner enforcement, fail-closed routes/assets/MCP, same-origin writes, loopback-only local mode and auth isolation passed.');
