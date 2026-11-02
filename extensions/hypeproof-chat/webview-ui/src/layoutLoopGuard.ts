// Layout-loop guard (studio#3396 item 1). An effect that measures layout and sets state from the
// measurement can feed itself: the new state changes the layout, the next measurement flips the state
// back, and React stops with #185 ("Maximum update depth exceeded"). On 2026-11-02 the composer's
// auto-resize did exactly that on a Windows seat (v2026.1029.0), and the restored draft made every
// reopen crash again.
//
// guardLayoutSetter wraps such a setter. It passes every change through, except an OSCILLATION: a
// value that returns to one set moments ago. After OSCILLATION_LIMIT returns within WINDOW_MS the
// guard holds the current value and drops further changes until the window passes, then logs once.
// The screen keeps a slightly stale layout instead of crashing; the next real change (typing, a
// resize after the window) is measured as usual.
//
// Every layout effect or ResizeObserver callback in the webview that sets state must use it, or say
// why it cannot loop with a `// layout-loop-ok: <reason>` comment inside the block
// (test/layout-loop-guard.smoke.mjs enforces this).
import { useMemo } from 'react';

export const WINDOW_MS = 500;
export const OSCILLATION_LIMIT = 3;
export const GUARD_LOG = '[layout-loop-guard]';

type Clock = () => number;

/** Wraps a plain-value setter (not an updater function). `name` only labels the log line. */
export function guardLayoutSetter<T>(set: (value: T) => void, name: string, now: Clock = () => performance.now()): (value: T) => void {
  let current: { value: T } | null = null;
  let recent: Array<{ value: T; at: number }> = [];
  let returns: number[] = [];
  let heldUntil = 0;
  let logged = false;
  return (value: T) => {
    const t = now();
    if (current && Object.is(current.value, value)) return;
    if (t < heldUntil) return;
    recent = recent.filter((r) => t - r.at <= WINDOW_MS);
    returns = returns.filter((at) => t - at <= WINDOW_MS);
    if (recent.some((r) => Object.is(r.value, value))) returns.push(t);
    if (returns.length >= OSCILLATION_LIMIT) {
      heldUntil = t + WINDOW_MS;
      returns = [];
      if (!logged) { logged = true; console.warn(`${GUARD_LOG} ${name}: held an oscillating layout state for ${WINDOW_MS} ms`); }
      return;
    }
    recent.push({ value, at: t });
    current = { value };
    set(value);
  };
}

/** The hook form: one guard per component instance, stable across renders. */
export function useLayoutLoopGuard<T>(set: (value: T) => void, name: string): (value: T) => void {
  return useMemo(() => guardLayoutSetter(set, name), [set, name]);
}
