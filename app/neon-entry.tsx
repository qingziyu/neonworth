"use client";

import { useEffect, useRef } from "react";

/**
 * Independently authored from the public Neon Reveal visual concept:
 * https://pro.reactbits.dev/docs/components/neon-reveal
 * Decorative neon tube for an isolated, position:relative header.
 *
 * The static markup and CSS are the finished look: every animation uses
 * fill "none", so a cancelled, failed or skipped entry always rests on the lit
 * tube. Only the two ornament spans are animated, and this component never
 * receives data or financial values.
 */

export type NeonEntryLightProps = {
  entryKey: string;
  enabled: boolean;
};

/** Survives enabled changes and StrictMode effect replays; a new key resets it. */
export type NeonEntryMemory = {
  key: string;
  played: boolean;
};

export type NeonEntryBinding = {
  root: HTMLElement;
  tube: HTMLElement;
  spill: HTMLElement;
  entryKey: string;
  enabled: boolean;
  memory: NeonEntryMemory;
};

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: no-preference)";
const FORCED_COLORS_QUERY = "(forced-colors: none)";
const OBSERVER_THRESHOLDS = [0, 0.25, 0.5, 0.75, 1];
const MIN_VISIBLE_RATIO = 0.25;
const TOP_EDGE_TOLERANCE_PX = 1;

const TUBE_KEYFRAMES: Keyframe[] = [
  { transform: "scaleX(0)", opacity: 0.35 },
  { transform: "scaleX(1)", opacity: 1 },
];
const TUBE_TIMING: KeyframeAnimationOptions = {
  duration: 560,
  easing: "cubic-bezier(0.22, 1, 0.36, 1)",
  fill: "none",
};

// A keyframe hold rather than a delay: with fill "none", a delay would show the
// resting spill first and then jump to transparent.
const SPILL_KEYFRAMES: Keyframe[] = [
  { transform: "translateY(-24px)", opacity: 0, offset: 0 },
  { transform: "translateY(-24px)", opacity: 0, offset: 0.25 },
  { transform: "translateY(0)", opacity: 1, offset: 1 },
];
const SPILL_TIMING: KeyframeAnimationOptions = {
  duration: 800,
  easing: "ease-out",
  fill: "none",
};

function noop(): void {}

/**
 * The tube sits on the top edge, so that edge must be unclipped and a meaningful
 * part of the header must be showing. Entries are read from the wrapper because
 * the tube's own box collapses while its scaleX animation runs.
 */
function isEntryVisible(entry: IntersectionObserverEntry): boolean {
  const box = entry.boundingClientRect;
  const clip = entry.intersectionRect;
  return (
    entry.isIntersecting &&
    entry.intersectionRatio >= MIN_VISIBLE_RATIO &&
    box.width > 0 &&
    box.height > 0 &&
    clip.width > 0 &&
    clip.height > 0 &&
    clip.top - box.top <= TOP_EDGE_TOLERANCE_PX
  );
}

/**
 * Arms one entry animation and returns an idempotent cleanup. Any missing or
 * throwing browser API ends the binding and leaves the static ornament.
 *
 * `played` is set only once animations exist. Playback can start only from an
 * asynchronous observer callback, so a StrictMode effect replay disconnects the
 * first observer without spending the entry.
 */
export function bindNeonEntry({
  root,
  tube,
  spill,
  entryKey,
  enabled,
  memory,
}: NeonEntryBinding): () => void {
  // Reconciled while disabled too, so A -> B -> A counts as a new entry.
  if (memory.key !== entryKey) {
    memory.key = entryKey;
    memory.played = false;
  }
  if (!enabled || memory.played) return noop;

  const doc = root.ownerDocument;
  const view = doc.defaultView;
  if (!view) return noop;

  let disposed = false;
  let observer: IntersectionObserver | null = null;
  let observerGeneration = 0;
  let animations: Animation[] = [];
  let motionQuery: MediaQueryList | null = null;
  let colorsQuery: MediaQueryList | null = null;
  const removers: Array<() => void> = [];

  function stopObserving(): void {
    observerGeneration += 1;
    const current = observer;
    observer = null;
    if (!current) return;
    try {
      current.disconnect();
    } catch {
      // Stale callbacks are already rejected by the generation check.
    }
  }

  function cancelAll(list: Animation[]): void {
    for (const animation of list) {
      try {
        animation.onfinish = null;
        animation.cancel();
      } catch {
        // Fill "none" leaves the static ornament once the animation is gone.
      }
    }
  }

  function teardown(): void {
    if (disposed) return;
    disposed = true;
    stopObserving();
    cancelAll(animations);
    animations = [];
    for (const remove of removers.splice(0)) {
      try {
        remove();
      } catch {
        // A surviving listener is inert because `disposed` is set.
      }
    }
  }

  function motionAllowed(): boolean {
    try {
      return Boolean(motionQuery?.matches && colorsQuery?.matches && !doc.hidden);
    } catch {
      return false;
    }
  }

  function play(): void {
    const created: Animation[] = [];
    try {
      created.push(tube.animate(TUBE_KEYFRAMES, TUBE_TIMING));
      created.push(spill.animate(SPILL_KEYFRAMES, SPILL_TIMING));
      let remaining = created.length;
      for (const animation of created) {
        animation.onfinish = () => {
          remaining -= 1;
          if (remaining === 0) teardown();
        };
      }
    } catch {
      cancelAll(created);
      teardown();
      return;
    }
    animations = created;
    memory.played = true;
  }

  function handleEntries(entries: IntersectionObserverEntry[]): void {
    let latest: IntersectionObserverEntry | undefined;
    for (const entry of entries) {
      if (entry.target === root) latest = entry;
    }
    if (!latest) return;

    const visible = isEntryVisible(latest);
    if (animations.length > 0) {
      if (!visible) teardown();
      return;
    }
    if (visible && !memory.played && motionAllowed()) play();
  }

  function startObserving(): void {
    observerGeneration += 1;
    const generation = observerGeneration;
    try {
      observer = new view!.IntersectionObserver(
        (entries) => {
          if (disposed || generation !== observerGeneration) return;
          handleEntries(entries);
        },
        { threshold: OBSERVER_THRESHOLDS },
      );
      observer.observe(root);
    } catch {
      teardown();
    }
  }

  function syncPolicy(): void {
    if (disposed) return;
    if (!motionAllowed()) {
      // A cancelled run stays played. An unplayed entry keeps waiting, and its
      // earlier visibility reading is discarded because hidden pages stop
      // delivering observer updates.
      if (animations.length > 0) teardown();
      else stopObserving();
      return;
    }
    if (!observer && !memory.played) startObserving();
  }

  try {
    motionQuery = view.matchMedia(REDUCED_MOTION_QUERY);
    colorsQuery = view.matchMedia(FORCED_COLORS_QUERY);
    const sources: Array<[EventTarget, string]> = [
      [motionQuery, "change"],
      [colorsQuery, "change"],
      [doc, "visibilitychange"],
    ];
    if (sources.some(([target]) => typeof target?.addEventListener !== "function" || typeof target?.removeEventListener !== "function")) {
      teardown();
      return teardown;
    }
    for (const [target, type] of sources) {
      target.addEventListener(type, syncPolicy);
      removers.push(() => target.removeEventListener(type, syncPolicy));
    }
  } catch {
    teardown();
    return teardown;
  }

  syncPolicy();
  return teardown;
}

export function NeonEntryLight({ entryKey, enabled }: NeonEntryLightProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const tubeRef = useRef<HTMLSpanElement>(null);
  const spillRef = useRef<HTMLSpanElement>(null);
  const memoryRef = useRef<NeonEntryMemory>({ key: entryKey, played: false });

  useEffect(() => {
    const root = rootRef.current;
    const tube = tubeRef.current;
    const spill = spillRef.current;
    if (!root || !tube || !spill) return;
    return bindNeonEntry({
      root,
      tube,
      spill,
      entryKey,
      enabled,
      memory: memoryRef.current,
    });
  }, [entryKey, enabled]);

  return (
    <span ref={rootRef} className="neon-entry" aria-hidden="true">
      <span ref={spillRef} className="neon-entry__spill" aria-hidden="true" />
      <span ref={tubeRef} className="neon-entry__tube" aria-hidden="true" />
    </span>
  );
}
