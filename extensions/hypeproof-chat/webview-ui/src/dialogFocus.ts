// REQ-STUDIO-FOCUS-RESTORE (CGP-DS-R-023, extends SX-52) — one focus contract for every webview
// dialog, popover, menu and closable inline panel:
//   - on open, focus moves inside (an explicit target, else the first actionable element, else
//     the heading, else the container);
//   - on close by Escape, close button or outside click, focus returns to the element that opened
//     it; when that element is gone, disabled or hidden, to the composer; never to <body>;
//   - a modal keeps Tab inside; a popover lets Tab leave (from its opener) and closes.
// Surfaces with their own layout logic (the task sources panel and rail) use the primitives below;
// everything else uses `useDialogFocus`.

import { useLayoutEffect, useRef, type RefObject } from 'react';

export type DialogKind = 'modal' | 'popover' | 'inline';
export type DismissReason = 'escape' | 'outside' | 'tab';

/** The personal and classroom composer. It is the last resort for a focus return. */
export const COMPOSER_SELECTOR = '.hps-input textarea';
const ACTIONABLE = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], summary, [tabindex="0"]';
const HEADING = 'h1, h2, h3, [role="heading"]';

type Target = HTMLElement | null | undefined | (() => HTMLElement | null | undefined);

/** True without a layout engine (tests); there every element counts as rendered. */
function rendered(element: HTMLElement): boolean {
  if (document.documentElement.getClientRects().length === 0) return true;
  return element.getClientRects().length > 0;
}

/** Can this element take focus now: connected, enabled, not hidden, not inside an inert subtree. */
export function canFocus(element: HTMLElement | null | undefined): element is HTMLElement {
  if (!element || !element.isConnected || element === document.body) return false;
  if ((element as HTMLButtonElement).disabled) return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (node.hidden || node.inert || node.hasAttribute('hidden') || node.hasAttribute('inert')) return false;
  }
  return rendered(element);
}

/** Actionable descendants in DOM order, skipping hidden ones. */
export function actionable(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(ACTIONABLE)].filter(canFocus);
}

export function composer(): HTMLElement | null {
  return document.querySelector<HTMLElement>(COMPOSER_SELECTOR);
}

/** The first focusable of the candidates, then the composer. */
export function returnTarget(...candidates: Target[]): HTMLElement | null {
  for (const candidate of [...candidates, composer]) {
    const element = typeof candidate === 'function' ? candidate() : candidate;
    if (canFocus(element)) return element;
  }
  return null;
}

/** Focus the first usable candidate (then the composer). Returns what took focus. */
export function returnFocus(...candidates: Target[]): HTMLElement | null {
  const target = returnTarget(...candidates);
  target?.focus({ preventScroll: true });
  return target;
}

/** Nobody else owns the keyboard: focus is lost, or still inside the surface that is closing. */
export function focusIsLost(container?: Element | null): boolean {
  const active = document.activeElement;
  return !active || active === document.body || !active.isConnected || !!container?.contains(active);
}

/**
 * For a surface that closes inside a React commit (an effect cleanup): return focus now, again
 * after the commit (React puts back a focused element that is still in the document, such as a
 * control inside a panel that stays mounted), and once more on the next frame (a press outside
 * may still blur to <body>).
 */
export function returnFocusSoon(surface: Element | null | undefined, ...candidates: Target[]): void {
  returnFocus(...candidates);
  queueMicrotask(() => { if (focusIsLost(surface)) returnFocus(...candidates); });
  requestAnimationFrame(() => { if (focusIsLost()) returnFocus(...candidates); });
}

/** Move focus into a surface that just opened. */
export function focusInto(container: HTMLElement, initial?: string): void {
  const explicit = initial ? container.querySelector<HTMLElement>(initial) : null;
  const heading = container.querySelector<HTMLElement>(HEADING);
  const target = (canFocus(explicit) && explicit) || actionable(container)[0] || (heading && heading.tabIndex >= 0 ? heading : null) || container;
  target.focus({ preventScroll: true });
}

/** Keep Tab inside a modal: wrap at both ends, and pull a stray focus back in. */
export function trapTab(event: KeyboardEvent, container: HTMLElement): void {
  if (event.key !== 'Tab') return;
  const items = actionable(container), first = items[0], last = items.at(-1);
  if (!first || !last) { event.preventDefault(); container.focus({ preventScroll: true }); return; }
  const active = document.activeElement as HTMLElement | null;
  const position = active ? items.indexOf(active) : -1;
  if (position === -1 || (event.shiftKey && active === first) || (!event.shiftKey && active === last)) {
    event.preventDefault();
    (position === -1 ? (event.shiftKey ? last : first) : event.shiftKey ? last : first).focus({ preventScroll: true });
  }
}

const composing = (event: KeyboardEvent) => event.isComposing || event.keyCode === 229;

export interface DialogFocusOptions {
  open: boolean;
  kind: DialogKind;
  /** Called for Escape, an outside pointer press and (popover) Tab. Without it the surface keeps its own keys. */
  onDismiss?: (reason: DismissReason) => void;
  /** The opener, when it is not simply the element focused at open time (or must be re-found later). Returning null means there is none. */
  opener?: () => HTMLElement | null | undefined;
  /** Tried after the opener and before the composer. */
  fallback?: () => HTMLElement | null | undefined;
  /**
   * Where focus goes on open: a selector inside the surface (else the first actionable element);
   * 'idle' moves focus in only when nothing owns it (a panel the host opened); false leaves it.
   */
  initialFocus?: string | 'idle' | false;
  /** The element an outside press is measured against (e.g. the trigger and its menu). Defaults to the surface. */
  scope?: RefObject<HTMLElement | null>;
}

/**
 * Apply the focus contract to one surface. `container` is its root element while it is open.
 * Returns `release()`: the next close leaves focus where it is unless it is lost (for a close
 * that hands focus to somewhere else on purpose).
 */
export function useDialogFocus(container: RefObject<HTMLElement | null>, options: DialogFocusOptions): { release: () => void } {
  const latest = useRef(options);
  latest.current = options;
  const released = useRef(false);
  const { open, kind } = options;
  useLayoutEffect(() => {
    if (!open) return;
    const node = container.current;
    const active = document.activeElement as HTMLElement | null;
    const captured = active && active !== document.body && !node?.contains(active) ? active : null;
    // An explicit opener is authoritative (null means "none": go to the fallback, then the composer).
    const opener = () => latest.current.opener ? latest.current.opener() : captured;
    released.current = false;
    const initial = latest.current.initialFocus;
    if (node && initial !== false && !(initial === 'idle' && !focusIsLost(node))) focusInto(node, initial === 'idle' ? undefined : initial);

    const dismiss = (reason: DismissReason) => {
      // Hand focus back before the surface goes, so it never passes through <body>.
      if (reason !== 'tab' && focusIsLost(container.current)) returnFocus(opener, () => latest.current.fallback?.());
      latest.current.onDismiss?.(reason);
    };
    const scopeNode = () => latest.current.scope?.current ?? container.current;
    const onKey = (event: KeyboardEvent) => {
      if (composing(event) || event.defaultPrevented) return;
      if (event.key === 'Escape' && latest.current.onDismiss) {
        event.preventDefault();
        event.stopPropagation();
        dismiss('escape');
      } else if (event.key === 'Tab' && container.current) {
        if (kind === 'modal') trapTab(event, container.current);
        else if (kind === 'popover' && latest.current.onDismiss) {
          // Leave as if from the opener: the browser's own Tab then moves on from there.
          const from = returnTarget(opener);
          if (from) from.focus({ preventScroll: true });
          released.current = true;
          dismiss('tab');
        }
      }
    };
    const onPointer = (event: PointerEvent) => {
      const surface = container.current, scope = scopeNode();
      if (!surface || !latest.current.onDismiss || kind === 'inline') return;
      const target = event.target as Node | null;
      let outside = !!target && !scope?.contains(target);
      // A native modal dialog receives presses on its backdrop itself.
      if (!outside && target === surface && surface.localName === 'dialog') {
        const box = surface.getBoundingClientRect();
        outside = box.width > 0 && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom);
      }
      if (!outside) return;
      // A press on a modal's backdrop: keep the browser's mousedown from focusing whatever lies
      // under it (the conversation region), so focus stays on the opener handed back below.
      if (kind === 'modal') event.preventDefault();
      dismiss('outside');
    };
    node?.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      node?.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      const surface = container.current ?? node;
      const fallback = () => latest.current.fallback?.();
      // Only take focus back from inside the surface now. A <body> focus here may be the middle of
      // a focus move (blur fires before the new element is focused), so that waits for the frame.
      // The composer is not tried yet either: a re-rendered opener may only appear in this commit.
      // React puts back, after its commit, a focused element that is still in the document, so a
      // surface that stays mounted (a closed <dialog>) is handled again in a microtask after it.
      const skip = released.current;
      const handBack = (afterCommit: boolean) => {
        if (skip) return;
        const inside = document.activeElement;
        const ours = inside && inside !== document.body ? !inside.isConnected || !!surface?.contains(inside) : afterCommit && !!surface && !surface.isConnected;
        if (!ours) return;
        const target = [opener(), fallback()].find(canFocus);
        target?.focus({ preventScroll: true });
      };
      handBack(false);
      queueMicrotask(() => handBack(true));
      released.current = false;
      // The surface may unmount in this commit, an outside press may blur to <body> after this
      // runs, and a re-rendered opener appears only after it: check once more on the next frame.
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (!active || active === document.body || !active.isConnected) returnFocus(opener, fallback);
      });
    };
  }, [open, kind, container]);
  return { release: () => { released.current = true; } };
}
