import assert from 'node:assert/strict';
import { secureRequest, secureResponse } from '../lib/security-headers.ts';
import { checkSecurityHeaders, checkScriptNonces } from './security-evidence.mjs';
const origin='https://money.example.test';
const secured=secureRequest(new Request(origin));
const good=secureResponse(new Response(''),secured.policy,origin).headers;
const nonce=checkSecurityHeaders(good);
checkScriptNonces(`<script nonce="${nonce}">bootstrap()</script><script nonce="${nonce}" src="/_next/static/a.js"></script>`,nonce);
assert.throws(()=>checkScriptNonces('<script>unsafe()</script>',nonce),/nonce/);
for(const name of ['Content-Security-Policy','X-Frame-Options','X-Content-Type-Options','Referrer-Policy','Strict-Transport-Security','Cache-Control']){
  const broken=new Headers(good);broken.delete(name);assert.throws(()=>checkSecurityHeaders(broken));
}
const open=new Headers(good);open.set('Access-Control-Allow-Origin','*');assert.throws(()=>checkSecurityHeaders(open));
console.log('Security evidence rejects missing browser protections, unnonced scripts and cross-origin exposure.');
