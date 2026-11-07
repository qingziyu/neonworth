"use client";

import { useEffect, useLayoutEffect, useRef, type HTMLAttributes, type ReactNode, type RefObject } from 'react';

// Independently authored native effects. Visual references, not copied source:
// https://reactbits.dev/components/spotlight-card
// https://reactbits.dev/components/pill-nav
const pointerPolicy = '(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine) and (forced-colors: none)';
const markerPolicy = '(prefers-reduced-motion: no-preference) and (forced-colors: none)';

function mediaPolicy(view: Window | null, query: string): MediaQueryList | undefined {
  try {
    const policy = view?.matchMedia?.(query);
    return policy && typeof policy.addEventListener === 'function' && typeof policy.removeEventListener === 'function' ? policy : undefined;
  } catch { return undefined; }
}

/** One frame per input batch, never an ambient animation or a React render. */
export function bindPointerLight(element: HTMLElement) {
  const view = element.ownerDocument.defaultView;
  const policy = mediaPolicy(view, pointerPolicy);
  if (!view || !policy || typeof view.requestAnimationFrame !== 'function' || typeof view.cancelAnimationFrame !== 'function') return () => {};
  let frame = 0;
  let alive = true;
  let point: { x: number; y: number } | null = null;
  const clear = () => {
    if (frame) view.cancelAnimationFrame(frame);
    frame = 0;
    point = null;
    element.removeAttribute('data-pointer-light');
    element.style.removeProperty('--pointer-light-x');
    element.style.removeProperty('--pointer-light-y');
  };
  const move = (event: PointerEvent) => {
    if (!alive || !policy.matches || event.pointerType !== 'mouse' || element.ownerDocument.hidden) return;
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    point = { x: event.clientX, y: event.clientY };
    if (frame) return;
    frame = view.requestAnimationFrame(() => {
      frame = 0;
      if (!alive || !policy.matches || !point) return;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return clear();
      const x = Math.max(0, Math.min(rect.width, point.x - rect.left));
      const y = Math.max(0, Math.min(rect.height, point.y - rect.top));
      element.style.setProperty('--pointer-light-x', `${x}px`);
      element.style.setProperty('--pointer-light-y', `${y}px`);
      element.setAttribute('data-pointer-light', 'active');
    });
  };
  const visibility = () => { if (element.ownerDocument.hidden) clear(); };
  element.addEventListener('pointerenter', move);
  element.addEventListener('pointermove', move);
  element.addEventListener('pointerleave', clear);
  element.addEventListener('pointercancel', clear);
  policy.addEventListener('change', clear);
  element.ownerDocument.addEventListener('visibilitychange', visibility);
  return () => {
    alive = false;
    clear();
    element.removeEventListener('pointerenter', move);
    element.removeEventListener('pointermove', move);
    element.removeEventListener('pointerleave', clear);
    element.removeEventListener('pointercancel', clear);
    policy.removeEventListener('change', clear);
    element.ownerDocument.removeEventListener('visibilitychange', visibility);
  };
}

type PointerLightProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  enabled?: boolean;
  tone?: 'cyan' | 'violet';
};

/** Use as a selected action surface, not a shell, chart or dialog ancestor. */
export function PointerLight({ children, enabled = true, tone = 'cyan', className = '', ...attributes }: PointerLightProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (enabled && ref.current) return bindPointerLight(ref.current);
  }, [enabled]);
  return <div {...attributes} ref={ref} className={`workspace-pointer-light ${className}`} data-light-tone={tone} data-light-enabled={enabled ? '' : undefined}>
    <span className="workspace-pointer-fill" aria-hidden="true" />
    <span className="workspace-pointer-edge" aria-hidden="true" />
    {children}
  </div>;
}

/** Targets only the existing current-page link; never receives financial data. */
export function bindNavigationMarker(container: HTMLElement, marker: HTMLElement, enabled = true) {
  const view = container.ownerDocument.defaultView;
  const policy = mediaPolicy(view, markerPolicy);
  let alive = true;
  let frame = 0;
  let animation: Animation | undefined;
  let previous: { top: number; height: number; left: number; width: number } | null = null;
  let inView = true;
  let observed: HTMLElement | null = null;
  const cancel = () => { animation?.cancel(); animation = undefined; };
  const hide = () => { cancel(); marker.style.visibility = 'hidden'; previous = null; };
  const refresh = (animate = true) => {
    if (!alive) return;
    const target = container.querySelector<HTMLElement>('[aria-current="page"]');
    if (target !== observed) {
      if (observed) observer?.unobserve(observed);
      observed = target;
      if (observed) observer?.observe(observed);
    }
    if (!target || !target.getClientRects().length || !container.getClientRects().length) return hide();
    const parent = container.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    if (rect.height <= 0 || rect.width <= 0) return hide();
    const top = rect.top - parent.top + container.scrollTop - container.clientTop;
    const height = rect.height;
    const left = rect.left - parent.left + (container.scrollLeft || 0) - (container.clientLeft || 0);
    const width = rect.width;
    if (previous?.top === top && previous.height === height && previous.left === left && previous.width === width) {
      if (!enabled || !inView || !policy?.matches || container.ownerDocument.hidden) cancel();
      return;
    }
    const from = previous ? marker.getBoundingClientRect().top - parent.top + container.scrollTop - container.clientTop : top;
    const canAnimate = enabled && inView && !!previous && animate && policy?.matches && !container.ownerDocument.hidden && !container.closest?.('[inert]');
    cancel();
    marker.style.top = `${top}px`;
    marker.style.height = `${height}px`;
    marker.style.left = `${left}px`;
    marker.style.width = `${width}px`;
    marker.style.visibility = 'visible';
    previous = { top, height, left, width };
    if (canAnimate && Math.abs(from - top) > 0.5 && marker.animate) {
      animation = marker.animate([{ transform: `translateY(${from - top}px) scaleX(.78)`, opacity: .35 }, { transform: `translateY(${(from - top) * .12}px) scaleX(1.04)`, opacity: 1, offset: .72 }, { transform: 'translateY(0) scaleX(1)', opacity: 1 }], {
        duration: 460, easing: 'cubic-bezier(.22,.61,.36,1)', iterations: 1,
      });
    }
  };
  const schedule = () => {
    if (!view || !alive || frame || container.ownerDocument.hidden) return;
    frame = view.requestAnimationFrame(() => { frame = 0; refresh(false); });
  };
  // Resize invalidates only decorative placement, never report layout.
  const ResizeObserverClass = view && (view as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
  const observer = ResizeObserverClass ? new ResizeObserverClass(schedule) : undefined;
  const policyChanged = () => { cancel(); refresh(false); };
  const visibility = () => { if (container.ownerDocument.hidden) cancel(); else schedule(); };
  const IntersectionObserverClass = view && (view as Window & { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
  const intersection = IntersectionObserverClass ? new IntersectionObserverClass(entries => {
    const entry = entries.findLast(item => item.target === container);
    if (!entry) return;
    inView = entry.isIntersecting;
    if (!inView) { cancel(); if (frame) view?.cancelAnimationFrame(frame); frame = 0; } else schedule();
  }) : undefined;
  intersection?.observe(container);
  observer?.observe(container);
  container.addEventListener('toggle', schedule, true);
  view?.addEventListener('resize', schedule);
  policy?.addEventListener('change', policyChanged);
  container.ownerDocument.addEventListener('visibilitychange', visibility);
  refresh(false);
  return {
    refresh,
    dispose() {
      alive = false;
      if (frame) view?.cancelAnimationFrame(frame);
      frame = 0;
      hide();
      observer?.disconnect();
      intersection?.disconnect();
      container.removeEventListener('toggle', schedule, true);
      view?.removeEventListener('resize', schedule);
      policy?.removeEventListener('change', policyChanged);
      container.ownerDocument.removeEventListener('visibilitychange', visibility);
    },
  };
}

/** Render inside a .workspace-marker-host containing normal aria-current links. */
export function NavigationMarker({ currentId, containerRef, enabled = true }: { currentId: string; containerRef: RefObject<HTMLElement | null>; enabled?: boolean }) {
  const marker = useRef<HTMLSpanElement>(null);
  const controller = useRef<ReturnType<typeof bindNavigationMarker> | null>(null);
  useLayoutEffect(() => {
    if (!containerRef.current || !marker.current) return;
    const binding = bindNavigationMarker(containerRef.current, marker.current, enabled);
    controller.current = binding;
    return () => { binding.dispose(); controller.current = null; };
  }, [containerRef, enabled]);
  useLayoutEffect(() => { controller.current?.refresh(); }, [currentId]);
  return <span ref={marker} className="workspace-nav-marker" aria-hidden="true" />;
}
