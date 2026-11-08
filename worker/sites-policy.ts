/** Sites Dispatch owns authentication for this separate owner-private profile.
 * It consumes service credentials without supplying a visitor identity. Never
 * interpret an incoming identity/bearer header as application authorization.
 * Direct/public Worker deployment of this entry point is unsupported. */
export function rejectSitesRequest(request: Request, localDevelopment = false): Response | null {
  const url = new URL(request.url);
  const host = request.headers.get('host');
  const local = localDevelopment && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const suppliedOrigin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  if ((!local && url.protocol !== 'https:') || url.username || url.password
    || host && host.toLowerCase() !== url.host.toLowerCase()
    || suppliedOrigin && suppliedOrigin !== url.origin
    || !['GET', 'HEAD', 'OPTIONS'].includes(request.method) && site && site !== 'same-origin' && site !== 'none') {
    return new Response('Request denied.', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  return null;
}

export function withoutSitesAuthentication(request: Request): Request {
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) {
    if (name === 'authorization' || name === 'cookie' || name.startsWith('cf-access-') || name.startsWith('oai-')) headers.delete(name);
  }
  return new Request(request, { headers });
}
