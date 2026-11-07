/** Default hosted paths; the static demo supplies a repository-subpath adapter. */
export function appHref(path: string): string { return path; }
export function readAppPath(url: URL): string { return url.pathname; }
