import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface AccessEnvironment {
  LOCAL_DEV?: string;
  APP_ORIGIN?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUDIENCE?: string;
  OWNER_EMAIL?: string;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const denied = () => new Response('Access denied.', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

function configuration(env: AccessEnvironment) {
  const issuer = env.ACCESS_TEAM_DOMAIN;
  const audience = env.ACCESS_AUDIENCE;
  const owner = env.OWNER_EMAIL?.trim().toLowerCase();
  const origin = env.APP_ORIGIN;
  if (!issuer || !/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(issuer)
    || !audience || !/^[A-Za-z0-9_-]{1,256}$/.test(audience)
    || !owner || owner.length > 254 || !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(owner)
    || !origin) return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password || LOOPBACK.has(url.hostname)) return null;
  } catch { return null; }
  return { issuer, audience, owner, origin };
}

function sameOriginWrite(request: Request, origin: string) {
  const suppliedOrigin = request.headers.get('origin');
  if (suppliedOrigin && suppliedOrigin !== origin) return false;
  if (!SAFE_METHODS.has(request.method)) {
    const site = request.headers.get('sec-fetch-site');
    if (site && site !== 'same-origin' && site !== 'none') return false;
  }
  return true;
}

// Cloudflare's documented application-token protocol: signed assertion header,
// team JWKS, issuer and application audience. Never trust an email header alone.
// https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
export function createAccessGate(keysForIssuer?: (issuer: string) => JWTVerifyGetKey) {
  let cachedIssuer = '';
  let cachedKeys: JWTVerifyGetKey | undefined;
  const keys = (issuer: string) => {
    if (keysForIssuer) return keysForIssuer(issuer);
    if (!cachedKeys || cachedIssuer !== issuer) {
      cachedIssuer = issuer;
      cachedKeys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), {
        timeoutDuration: 5_000,
        cooldownDuration: 30_000,
        cacheMaxAge: 600_000,
      });
    }
    return cachedKeys;
  };

  return async function authorizeRequest(request: Request, env: AccessEnvironment): Promise<Response | null> {
    const url = new URL(request.url);
    const host = request.headers.get('host');
    if (url.username || url.password || host && host.toLowerCase() !== url.host.toLowerCase()) return denied();
    if (!sameOriginWrite(request, url.origin)) return denied();

    // Explicit local flag AND literal HTTP loopback. Remote domains, LAN IPs,
    // forwarded-host headers and a forged production flag cannot enable this.
    if (env.LOCAL_DEV === 'true' && url.protocol === 'http:' && LOOPBACK.has(url.hostname)) return null;

    const config = configuration(env);
    if (!config) return new Response('Authentication is not configured.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    if (url.origin !== config.origin) return denied();
    const token = request.headers.get('cf-access-jwt-assertion');
    if (!token || token.length > 16_384) return denied();
    try {
      const { payload } = await jwtVerify(token, keys(config.issuer), {
        algorithms: ['RS256'],
        issuer: config.issuer,
        audience: config.audience,
        requiredClaims: ['iss', 'aud', 'exp', 'iat', 'sub', 'email', 'type'],
        clockTolerance: 0,
      });
      // Access app tokens have one application audience. Do not accept a
      // multi-app token, service identity, or another identity in the same team.
      const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      if (audiences.length !== 1 || audiences[0] !== config.audience
        || payload.type !== 'app' || typeof payload.sub !== 'string' || !payload.sub
        || typeof payload.email !== 'string' || payload.email.trim().toLowerCase() !== config.owner
        || typeof payload.iat !== 'number' || payload.iat > Date.now() / 1000) return denied();
      return null;
    } catch {
      // Do not echo JWTs, claims, JWKS/parser errors or identity details.
      return denied();
    }
  };
}

export const authorizeRequest = createAccessGate();

/** The app consumes snapshots, never the authentication transport. */
export function withoutAuthentication(request: Request) {
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) {
    if (name === 'authorization' || name === 'cookie' || name.startsWith('cf-access-') || name.startsWith('oai-')) headers.delete(name);
  }
  return new Request(request, { headers });
}
