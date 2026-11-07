declare const __NEONWORTH_DEMO_BASE__: string;
export const DEMO_BASE = typeof __NEONWORTH_DEMO_BASE__ === 'string' ? __NEONWORTH_DEMO_BASE__ : '/neonworth/';
export function appHref(path: string): string {
  const url = new URL(path, 'https://demo.invalid');
  if (url.origin !== 'https://demo.invalid') throw new Error('Demo navigation must stay within the application.');
  if (url.pathname === '/goals') url.searchParams.set('view', 'goals');
  else if (url.pathname === '/year-in-review') url.searchParams.set('view', 'year-in-review');
  else if (url.pathname !== '/' && url.pathname !== DEMO_BASE) throw new Error('Unsupported demo destination.');
  return DEMO_BASE + url.search + url.hash;
}
export function readAppPath(url: URL): string {
  return url.searchParams.get('view') === 'goals' ? '/goals'
    : url.searchParams.get('view') === 'year-in-review' ? '/year-in-review' : '/';
}
