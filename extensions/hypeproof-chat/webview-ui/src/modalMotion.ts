const exits = new WeakMap<HTMLElement, object>();
/** Keep the modal and its focus trap alive until its CSS exit finishes. No timer races. */
export function finishModal(node: HTMLElement | null, finish: () => void): void {
  if (!node || node.hasAttribute('data-closing')) return;
  const generation = {};
  exits.set(node, generation);
  node.setAttribute('data-closing', '');
  const animations = node.getAnimations?.() ?? [];
  // Reduced motion (and engines without animations) completes synchronously.
  if (!animations.length) { finish(); return; }
  void Promise.allSettled(animations.map(animation => animation.finished)).then(() => {
    // A scope change/unmount cancels this answer rather than answering a replacement request.
    if (node.isConnected && node.hasAttribute('data-closing') && exits.get(node) === generation) finish();
  });
}
