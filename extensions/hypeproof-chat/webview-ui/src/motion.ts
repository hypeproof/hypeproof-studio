/**
 * CGP-DS-R-015: JS-driven scrolling follows the same reduce-motion rule as tokens.css. A smooth
 * scroll requested from JS overrides CSS `scroll-behavior`, so callers ask here instead.
 */
export function motionReduced(doc: Document = document, win: Pick<Window, 'matchMedia'> | undefined = typeof window === 'undefined' ? undefined : window): boolean {
  if (doc.documentElement.dataset.reducedMotion === 'true') return true;
  return !!win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function scrollBehavior(): ScrollBehavior {
  return motionReduced() ? 'auto' : 'smooth';
}
