"use client";

// App-styled adapter over the installed Radix Dialog primitive.
//
// Radix owns the modal mechanics: focus trapping, Tab/Shift+Tab order, initial
// focus, Escape and outside dismissal, background isolation (aria-hidden on
// siblings), scroll locking and generated Title/Description associations.
// This adapter only adds Neonworth policy on top:
//   * dismissal requests are rejected while a save/import is busy;
//   * focus returns to a caller-supplied explicit target (the visible import
//     button), else the connected element that opened the dialog (ledger rows
//     and review buttons are not Dialog.Trigger), else a caller-supplied fallback;
//   * the existing warm `.modal-overlay` / `.modal` classes are applied, with
//     Content nested inside Overlay (Radix's supported scrollable-overlay shape).
//
// The shadcn copy in components/ui/dialog.tsx is intentionally not used: its
// positional and utility defaults conflict with the application stylesheet.
import { useLayoutEffect, useRef, type ComponentPropsWithoutRef } from "react";
import { Dialog } from "radix-ui";

type PreventableEvent = { preventDefault(): void };

/** Controlled onOpenChange: close requests are ignored while busy. Opening is always caller-driven. */
export function guardedOpenChange(busy: boolean, onDismiss: () => void) {
  return (open: boolean) => {
    if (!open && !busy) onDismiss();
  };
}

/** Escape / outside-interaction handler that cancels Radix dismissal while busy. */
export function preventWhileBusy(busy: boolean) {
  return (event: PreventableEvent) => {
    if (busy) event.preventDefault();
  };
}

/** Disabling the focused Save control can move focus to body. Repair that transition once; Radix still owns trapping. */
export function recoverBusyDialogFocus(wasBusy: boolean, busy: boolean, content: HTMLElement | null) {
  if (wasBusy || !busy || !content) return;
  const active = content.ownerDocument.activeElement;
  if (!active || !content.contains(active) || active.matches(":disabled")) content.focus({ preventScroll: true });
}

type PointerLike = { target: unknown; offsetX?: number; offsetY?: number };
type SizedTarget = { clientWidth: number; clientHeight: number };

/**
 * True when a pointer-down landed on the overlay's own scrollbar. The overlay is
 * the scroll container for tall dialogs, so dragging its scrollbar must not be
 * treated as an outside click.
 */
export function isOverlayScrollbarPointer(event: PointerLike, overlay: SizedTarget | null) {
  if (!overlay || event.target !== overlay) return false;
  return (typeof event.offsetX === "number" && event.offsetX > overlay.clientWidth)
    || (typeof event.offsetY === "number" && event.offsetY > overlay.clientHeight);
}

type FocusCandidate = {
  isConnected?: boolean;
  disabled?: boolean;
  focus?: unknown;
  closest?: (selector: string) => unknown;
  getClientRects?: () => { length: number };
  ownerDocument?: { body?: unknown; documentElement?: unknown } | null;
};

/** A return-focus target must still be in the document, rendered, enabled and not inert. */
export function canReturnFocusTo(candidate: unknown): candidate is HTMLElement {
  if (!candidate || typeof candidate !== "object") return false;
  const element = candidate as FocusCandidate;
  if (!element.isConnected || typeof element.focus !== "function") return false;
  if (element.ownerDocument && (candidate === element.ownerDocument.body || candidate === element.ownerDocument.documentElement)) return false;
  if (element.disabled === true) return false;
  if (typeof element.closest === "function" && element.closest("[inert]")) return false;
  if (typeof element.getClientRects === "function" && element.getClientRects().length === 0) return false;
  return true;
}

export function resolveReturnFocus(opener: unknown, fallback?: () => HTMLElement | null): HTMLElement | null {
  if (canReturnFocusTo(opener)) return opener;
  const next = fallback?.() ?? null;
  return canReturnFocusTo(next) ? next : null;
}

/** Prefer the caller's explicit return target (e.g. the visible import button), then the recorded opener, then the fallback. */
export function resolveDialogReturnFocus(explicit: unknown, opener: unknown, fallback?: () => HTMLElement | null): HTMLElement | null {
  return resolveReturnFocus(canReturnFocusTo(explicit) ? explicit : opener, fallback);
}

type ManagedContentProps = "onEscapeKeyDown" | "onInteractOutside" | "onPointerDownOutside" | "onOpenAutoFocus" | "onCloseAutoFocus" | "aria-busy" | "aria-describedby";

export type FinanceDialogSurfaceProps = Omit<ComponentPropsWithoutRef<typeof Dialog.Content>, ManagedContentProps> & {
  busy: boolean;
  /** Set false when no FinanceDialogDescription is rendered, so aria-describedby never points at a missing id. */
  hasDescription?: boolean;
  /** Explicit return target, used before the recorded opener. Async file selection can leave activeElement on the hidden input or body. */
  getReturnFocus?: () => HTMLElement | null;
  /** Focus target used when the opener is no longer connected or focusable. */
  getFallbackFocus?: () => HTMLElement | null;
  overlayClassName?: string;
};

/** Overlay + Content. Must be rendered inside a Dialog.Root (FinanceDialog provides one). */
export function FinanceDialogSurface({ busy, hasDescription = true, getReturnFocus, getFallbackFocus, overlayClassName = "modal-overlay", className = "modal", children, ...contentProps }: FinanceDialogSurfaceProps) {
  const opener = useRef<Element | null>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const previousBusy = useRef(busy);
  useLayoutEffect(() => {
    recoverBusyDialogFocus(previousBusy.current, busy, content.current);
    previousBusy.current = busy;
  }, [busy]);
  const blockWhileBusy = preventWhileBusy(busy);
  return <Dialog.Overlay ref={overlay} className={overlayClassName}>
    <Dialog.Content
      {...contentProps}
      ref={content}
      {...(hasDescription ? {} : { "aria-describedby": undefined })}
      className={className}
      aria-busy={busy}
      // Record the opener before Radix moves focus inside; do not override Radix's initial focus.
      onOpenAutoFocus={() => { opener.current = document.activeElement; }}
      onEscapeKeyDown={blockWhileBusy}
      onPointerDownOutside={event => { if (isOverlayScrollbarPointer(event.detail.originalEvent, overlay.current)) event.preventDefault(); }}
      onInteractOutside={blockWhileBusy}
      onCloseAutoFocus={event => {
        // Radix would focus a Dialog.Trigger; these dialogs are opened by rows, buttons and async file selection.
        event.preventDefault();
        resolveDialogReturnFocus(getReturnFocus?.(), opener.current, getFallbackFocus)?.focus();
        opener.current = null;
      }}
    >
      {children}
    </Dialog.Content>
  </Dialog.Overlay>;
}

export type FinanceDialogProps = FinanceDialogSurfaceProps & {
  open: boolean;
  /** Called for allowed dismissals (Escape, outside click, FinanceDialogClose) when not busy. */
  onDismiss: () => void;
  /** Portal host. Pass the app root so existing `.unified-dashboard …` descendant styles still apply. */
  container?: Element | DocumentFragment | null;
};

export function FinanceDialog({ open, onDismiss, container, busy, children, ...surfaceProps }: FinanceDialogProps) {
  return <Dialog.Root open={open} onOpenChange={guardedOpenChange(busy, onDismiss)}>
    <Dialog.Portal container={container ?? undefined}>
      <FinanceDialogSurface busy={busy} {...surfaceProps}>{children}</FinanceDialogSurface>
    </Dialog.Portal>
  </Dialog.Root>;
}

export const FinanceDialogTitle = Dialog.Title;
export const FinanceDialogDescription = Dialog.Description;
export const FinanceDialogClose = Dialog.Close;
