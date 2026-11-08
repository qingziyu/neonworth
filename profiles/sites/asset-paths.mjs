// URL-only namespace: no file may be packaged at this path. This forces the
// owner-private Sites router to send built assets through the Worker.
export const SITES_ASSET_PREFIX = '/__neonworth_assets';
export const SITES_ASSET_URL = `${SITES_ASSET_PREFIX}/_next/static/`;
export const SITES_ASSET_STORAGE = '/_next/static/';

export function sitesAssetPath(pathname) {
  if (!pathname.startsWith(SITES_ASSET_URL)) return null;
  const suffix = pathname.slice(SITES_ASSET_URL.length);
  // Build-generated filenames need no escaping. Refuse ambiguous routing,
  // encoded separators/dot segments and directory listing requests.
  if (!suffix || !/^[A-Za-z0-9_.\/-]+$/.test(suffix)
    || suffix.split('/').some(part => !part || part === '.' || part === '..')) return null;
  return SITES_ASSET_STORAGE + suffix;
}
