// Pure response checks; no live endpoint, identity or credential handling.
const fail = message => { throw new Error(message); };
export function checkSecurityHeaders(headers) {
  const policy=headers.get('content-security-policy')||'';
  const directives=new Map(policy.split(';').map(s=>s.trim().split(/\s+/)).filter(a=>a[0]).map(([key,...value])=>[key,value]));
  const scripts=directives.get('script-src')||[];
  const nonce=scripts.find(v=>/^'nonce-[A-Za-z0-9+/]{32}'$/.test(v))?.slice(7,-1);
  if (!nonce || scripts.includes("'unsafe-inline'") || scripts.includes("'unsafe-eval'") || !scripts.includes("'strict-dynamic'")) fail('Strict nonce-based script policy is missing.');
  for (const [key,expected] of [['default-src',"'none'"],['frame-ancestors',"'none'"],['base-uri',"'none'"],['object-src',"'none'"],['connect-src',"'self'"]]) {
    if (directives.get(key)?.join(' ')!==expected) fail('A required browser restriction is missing.');
  }
  for (const [key,value] of [['x-frame-options','DENY'],['x-content-type-options','nosniff'],['referrer-policy','no-referrer']]) if(headers.get(key)!==value)fail('A required security header is missing.');
  if (!/\bprivate\b/.test(headers.get('cache-control')||'') || !/\bno-store\b/.test(headers.get('cache-control')||'')) fail('Private page/API caching is missing.');
  if (!/max-age=31536000/.test(headers.get('strict-transport-security')||''))fail('HTTPS transport policy is missing.');
  if (headers.has('access-control-allow-origin'))fail('Unexpected cross-origin read permission.');
  return nonce;
}
export function checkScriptNonces(html,nonce) {
  const scripts=[...html.matchAll(/<script\b([^>]*)>[\s\S]*?<\/script\s*>/gi)];
  if (!scripts.length) fail('Dashboard scripts were not rendered.');
  for (const [,attrs] of scripts) {
    if (/\btype=["']application\/(?:ld\+)?json["']/i.test(attrs))continue;
    if (attrs.match(/\bnonce=["']([^"']+)["']/i)?.[1]!==nonce)fail('A rendered script lacks its response nonce.');
  }
}
