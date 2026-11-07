/** Shared capability/visibility gate for decorative native animation only.
 * Missing observer or media capabilities leave the artwork static. Callers
 * cancel their animations on false; this helper owns no animation or timer. */
export function bindAmbientMotion(element: HTMLElement, enabled: boolean, onActiveChange: (active: boolean) => void) {
  let alive = true;
  let active = false;
  onActiveChange(false);
  const document = element.ownerDocument;
  const view = document.defaultView;
  if (!enabled || !view?.matchMedia) return () => {};
  if (![document, view].every(target => typeof target.addEventListener === 'function' && typeof target.removeEventListener === 'function')) return () => {};
  const Intersection = (view as Window & { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
  if (typeof Intersection !== 'function') return () => {};
  let policy: MediaQueryList, print: MediaQueryList;
  try {
    policy = view.matchMedia('(prefers-reduced-motion: no-preference) and (forced-colors: none)');
    print = view.matchMedia('print');
    if (![policy, print].every(query => typeof query.addEventListener === 'function' && typeof query.removeEventListener === 'function')) return () => {};
  } catch { return () => {}; }
  let intersecting = false;
  let printing = print.matches;
  let observer: IntersectionObserver | undefined;
  let generation = 0;
  let observing = false;
  let failed = false;
  const permitted = () => policy.matches && !print.matches && !printing && !document.hidden;
  const change = (next: boolean) => {
    if (active === next) return;
    active = next;
    onActiveChange(next);
  };
  const sync = () => {
    if (!alive) return;
    const rect = element.getBoundingClientRect();
    const inViewport = intersecting && element.getClientRects().length > 0 && rect.width > 0 && rect.height > 0 &&
      rect.bottom > 0 && rect.right > 0 && rect.top < view.innerHeight && rect.left < view.innerWidth;
    change(permitted() && inViewport);
  };
  const disconnect = () => {
    generation++;
    observing = false;
    intersecting = false;
    try { observer?.disconnect(); } catch { /* A failed capability remains static. */ }
    observer = undefined;
  };
  const refresh = () => {
    if (!alive) return;
    if (!permitted()) { disconnect(); change(false); return; }
    if (observing || failed) return;
    // A tab/policy restoration needs a fresh clipping observation. Old queued
    // callbacks must not wake a scene that is now behind a scroll container.
    const currentGeneration = ++generation;
    observing = true;
    try {
      observer = new Intersection(entries => {
        if (!alive || currentGeneration !== generation) return;
        const latest = entries.findLast(entry => entry.target === element);
        if (!latest) return;
        // IO can report edge-adjacent zero-area intersections as true. Match
        // this floor to the observer threshold so crossing it emits an update.
        intersecting = latest.isIntersecting && latest.intersectionRatio >= .01;
        sync();
      }, { threshold: .01 });
      observer.observe(element);
    } catch { failed = true; disconnect(); change(false); }
  };
  const beforePrint = () => { printing = true; refresh(); };
  const afterPrint = () => { printing = false; refresh(); };
  const printChanged = () => { printing = print.matches; refresh(); };
  const removals: (() => void)[] = [];
  const dispose = () => {
    alive = false;
    disconnect();
    for (const remove of removals.splice(0)) { try { remove(); } catch { /* Best effort on a broken event capability. */ } }
    change(false);
  };
  const listen = (target: EventTarget, event: string, callback: () => void) => {
    // Queue removal first: a partial registration may throw after adding.
    removals.push(() => target.removeEventListener(event, callback));
    target.addEventListener(event, callback);
  };
  try {
    listen(policy, 'change', refresh);
    listen(print, 'change', printChanged);
    listen(document, 'visibilitychange', refresh);
    listen(view, 'beforeprint', beforePrint);
    listen(view, 'afterprint', afterPrint);
    refresh();
    if (failed) dispose();
  } catch { dispose(); }
  return dispose;
}
