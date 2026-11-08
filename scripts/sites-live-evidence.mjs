import { createHash } from 'node:crypto';
import { checkSecurityHeaders, checkScriptNonces } from './security-evidence.mjs';
import { SITES_ASSET_URL } from '../profiles/sites/asset-paths.mjs';

export class SiteVerificationError extends Error {}
const fail = code => { throw new SiteVerificationError(code); };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const denied = response => [301,302,303,307,308,401,403].includes(response.status);
const routes = ['/api/data','/api/status','/api/budget','/api/planning'];

/** HTTP evidence supplements the native private-publisher/access-policy result.
 * It does not infer an audience policy, test a second signed-in account, or
 * authenticate a native Site MCP connection using a service bearer. */
export async function inspectPrivateSite(input, request = globalThis.fetch) {
  const { origin, token, privatePublicationConfirmed } = input ?? {};
  let url;
  try { url = new URL(origin); } catch { fail('invalid_origin'); }
  if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password
      || !url.hostname.endsWith('.chatgpt.site')) fail('invalid_origin');
  if (privatePublicationConfirmed !== true) fail('native_private_publication_required');
  if (typeof token !== 'string' || !token || token.length > 10_000 || /[\s\x00-\x1f\x7f]/.test(token)) fail('invalid_service_access');
  const get = async (path, authorized = false, additional = {}) => {
    const headers = { ...additional, ...(authorized ? {'OAI-Sites-Authorization': `Bearer ${token}`} : {}) };
    try {
      return await request(origin + path, { headers, redirect:'manual', cache:'no-store', signal:AbortSignal.timeout(30_000) });
    } catch { fail('request_failed'); }
  };
  for (const path of ['/', ...routes, '/mcp']) if (!denied(await get(path))) fail('anonymous_access_not_denied');
  if (!denied(await get('/api/data', false, {'oai-authenticated-user-id':'invented-user','oai-authenticated-user-email':'invented@example.invalid'}))) fail('forged_identity_not_denied');
  if (!denied(await get('/api/data', false, {'OAI-Sites-Authorization':'Bearer invented-invalid-service-access'}))) fail('invalid_service_access_not_denied');

  const page = await get('/', true);
  if (page.status !== 200) fail('authorized_page_unavailable');
  let nonce, html;
  try { nonce = checkSecurityHeaders(page.headers); html = await page.text(); checkScriptNonces(html, nonce); }
  catch { fail('page_security_policy_failed'); }
  const assets = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)]
    .map(match => new URL(match[1], origin)).filter(asset => asset.origin === origin
      && [SITES_ASSET_URL, '/_next/static/'].some(prefix => asset.pathname.startsWith(prefix)));
  if (!assets.length) fail('application_asset_missing');
  const asset = assets[0];
  if (!denied(await get(asset.pathname + asset.search))) fail('anonymous_asset_not_denied');
  const authorizedAsset = await get(asset.pathname + asset.search, true);
  if (authorizedAsset.status !== 200) fail('authorized_asset_unavailable');
  try { checkSecurityHeaders(authorizedAsset.headers); } catch { fail('asset_security_policy_failed'); }

  const read = async () => {
    const state = {};
    for (const path of routes) {
      const response = await get(path, true);
      if (response.status !== 200) fail('authorized_record_unavailable');
      try { checkSecurityHeaders(response.headers); state[path] = await response.json(); }
      catch { fail('record_security_or_json_failed'); }
    }
    if (!state['/api/data'] || !Object.hasOwn(state['/api/data'],'dataset')) fail('invalid_saved_state');
    if (!Object.hasOwn(state['/api/budget'] ?? {},'plan') || !Object.hasOwn(state['/api/planning'] ?? {},'plan')) fail('invalid_plan_state');
    if (state['/api/status']?.refresh?.lastRun?.status === 'running') fail('refresh_in_progress');
    return state;
  };
  const first = await read(), second = await read();
  if (digest(first) !== digest(second)) fail('records_changed_during_verification');
  const saved = first['/api/data'];
  return {
    format:1, origin, checkedAt:new Date().toISOString(),
    nativePrivatePublicationConfirmed:true, anonymousDenied:true, forgedIdentityDenied:true,
    invalidServiceDenied:true, assetsProtected:true, strictSecurityHeaders:true, consistentReadback:true,
    hashes:{saved:digest(saved),dataset:digest(saved.dataset),overrides:digest(saved.overrides ?? {}),
      settings:digest(saved.settings ?? {}),retirement:digest(saved.retirementOverrides ?? {}),
      review:digest(saved.reviewPreferences ?? {}),refresh:digest(saved.refresh ?? null),
      budget:digest(first['/api/budget']),planning:digest(first['/api/planning'])},
    desktopBrowserAcceptance:'not_tested', secondAccountAcceptance:'not_tested', nativeMcpAcceptance:'not_tested',
  };
}

export function comparePrivateSiteEvidence(before, after) {
  if (before?.format !== 1 || after?.format !== 1 || before.origin !== after.origin) fail('incompatible_evidence');
  if (digest(before.hashes) !== digest(after.hashes)) fail('saved_records_changed');
  return true;
}
