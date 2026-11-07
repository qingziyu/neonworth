import { clientFetch as fetch } from './client-transport.ts';
declare const __NEONWORTH_APP_VERSION__: string;

// Vite replaces this for both client and server; direct source tests have no
// compiled identity and must not claim that a development view is out of date.
export const APP_VERSION = typeof __NEONWORTH_APP_VERSION__ === 'string' ? __NEONWORTH_APP_VERSION__ : 'development';
const versionPattern = /^[a-f0-9]{64}$/;

export function appVersionChanged(current: string, received: unknown): boolean {
  return versionPattern.test(current) && typeof received === 'string' && versionPattern.test(received) && current !== received;
}

export async function readAppVersion(signal?: AbortSignal, request: typeof fetch = fetch): Promise<string | null> {
  try {
    const response = await request('/api/app-version', { cache: 'no-store', credentials: 'same-origin', signal });
    if (!response.ok) return null;
    const value: unknown = await response.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const version = (value as { version?: unknown }).version;
    return typeof version === 'string' && versionPattern.test(version) ? version : null;
  } catch {
    // A failed update check must never replace a valid loaded finance view.
    return null;
  }
}
