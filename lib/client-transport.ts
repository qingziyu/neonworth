/** Hosted requests retain the browser's ordinary fetch/authentication behavior.
 * Only the separate static-demo build aliases this module to invented data. */
export const clientFetch: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, init);
export const CLIENT_READ_ONLY: boolean = false;
export const DEMO_MODE: boolean = false;
export const ALLOW_IMPORT: boolean = true;
