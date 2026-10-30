/** Restore only the last composer owner after native window focus drops to BODY.
 * No activation request, polling, draft mutation or selection rewrite. */
export function bindRetainedComposerFocus(
  input: HTMLTextAreaElement,
  current: () => boolean,
): () => void {
  const doc = input.ownerDocument, win = doc.defaultView;
  if (!win) return () => {};
  let disposed = false, epoch = 0, frame: number | undefined;
  let owned = doc.hasFocus() && doc.activeElement === input;
  const root = (element: Element | null) => !element || element === doc.body || element === doc.documentElement;
  const cancel = () => { epoch++; if (frame !== undefined) win.cancelAnimationFrame(frame); frame = undefined; };
  const usable = () => !disposed && current() && input.isConnected && !input.disabled && !input.readOnly;
  const focusIn = (event: FocusEvent) => {
    cancel();
    if (!root(event.target as Element | null)) owned = event.target === input && usable();
  };
  const focusOut = (event: FocusEvent) => {
    if (event.target === input && event.relatedTarget && !root(event.relatedTarget as Element)) { owned = false; cancel(); }
  };
  const pointer = (event: PointerEvent) => { if (event.target !== input) { owned = false; cancel(); } };
  const key = (event: KeyboardEvent) => { if (event.key === 'Tab' || event.key === 'Escape') { owned = false; cancel(); } };
  const blur = () => {
    cancel();
    if (!root(doc.activeElement)) owned = doc.activeElement === input && usable();
  };
  const focus = () => {
    cancel();
    if (!owned || !usable()) return;
    const ticket = epoch;
    frame = win.requestAnimationFrame(() => {
      frame = undefined;
      if (ticket !== epoch || !owned || !usable() || !doc.hasFocus() || doc.visibilityState !== 'visible' || !root(doc.activeElement)) return;
      // A modal can be mounted before its initial-focus effect runs. Never race it.
      if ([...doc.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]')].some(dialog => dialog.getClientRects().length)) return;
      if (!input.getClientRects().length) return;
      input.focus({ preventScroll: true });
    });
  };
  doc.addEventListener('focusin', focusIn);
  doc.addEventListener('focusout', focusOut);
  doc.addEventListener('pointerdown', pointer, true);
  doc.addEventListener('keydown', key, true);
  win.addEventListener('blur', blur);
  win.addEventListener('focus', focus);
  return () => {
    disposed = true; owned = false; cancel();
    doc.removeEventListener('focusin', focusIn); doc.removeEventListener('focusout', focusOut);
    doc.removeEventListener('pointerdown', pointer, true); doc.removeEventListener('keydown', key, true);
    win.removeEventListener('blur', blur); win.removeEventListener('focus', focus);
  };
}
