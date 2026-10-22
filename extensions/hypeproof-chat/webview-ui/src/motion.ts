/**
 * CGP-DS-R-015: JS-driven scrolling follows the same reduce-motion rule as tokens.css. A smooth
 * scroll requested from JS overrides CSS `scroll-behavior`, so callers ask here instead.
 */
export function motionReduced(doc: Document = document, win: Pick<Window, 'matchMedia'> | undefined = typeof window === 'undefined' ? undefined : window): boolean {
  const preference = doc.documentElement.dataset.reducedMotion;
  if (preference === 'true' || preference === 'false') return preference === 'true';
  return !!win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function scrollBehavior(): ScrollBehavior {
  return motionReduced() ? 'auto' : 'smooth';
}

/** Apply live host config; returning to system removes the explicit override. */
export function applyMotionPreference(value: unknown, doc: Document = document): void {
  if (typeof value === 'boolean') doc.documentElement.dataset.reducedMotion = String(value);
  else delete doc.documentElement.dataset.reducedMotion;
}
