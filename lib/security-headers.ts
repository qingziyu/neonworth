// The Worker verifies Cloudflare Access before application code. These headers
// add browser-side protections to both authorized and denied responses.
export function secureRequest(request: Request) {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))));
  const policy = [
    "default-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "script-src-attr 'none'",
    // React charts and existing component styles require inline CSS, not scripts.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "worker-src 'none'",
    ...(new URL(request.url).protocol === 'https:' ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
  const headers = new Headers(request.headers);
  // Overwrite caller-supplied policies/nonces. Vinext reads this header and
  // attaches the generated nonce to its own streamed/bootstrap scripts.
  headers.delete('content-security-policy-report-only');
  headers.delete('x-nonce');
  headers.set('Content-Security-Policy', policy);
  return { request: new Request(request, { headers }), policy };
}

export function secureResponse(response: Response, policy: string, url: string) {
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', policy);
  headers.delete('Content-Security-Policy-Report-Only');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  headers.set('Cache-Control', 'private, no-store, max-age=0');
  const vary = new Set((headers.get('Vary') || '').split(',').map(v => v.trim()).filter(Boolean));
  vary.add('Cookie');
  headers.set('Vary', [...vary].join(', '));
  if (new URL(url).protocol === 'https:') headers.set('Strict-Transport-Security', 'max-age=31536000');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
