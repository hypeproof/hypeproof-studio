import { onHostMessage } from './vscode';

/** An explicit editor Focus command; no focus listeners or activation-time steal. */
export function bindComposerFocus(input: () => HTMLTextAreaElement | null, activityId: string | undefined): () => void {
  let frame: number | undefined;
  const off = onHostMessage(message => {
    if (message.type !== 'focusInput' || message.activityId !== activityId) return;
    if (frame !== undefined) cancelAnimationFrame(frame);
    // Let editor reveal/layout finish; do not mutate the draft or selection.
    frame = requestAnimationFrame(() => {
      frame = undefined;
      const element = input();
      if (element?.isConnected && !element.disabled) element.focus();
    });
  });
  return () => { off(); if (frame !== undefined) cancelAnimationFrame(frame); };
}

// CGP-DS-R-010 (REQ-CGP-DS-11) — the one-line composer's textarea is 24px tall inside a card of at
// least 44px; a press on the card's own surface (padding, gaps between its parts) puts the caret in
// the textarea, so the card is the hit target. A press on any control inside it stays with that control.
const COMPOSER_OWN_CONTROLS = 'button, a, input, textarea, select, label, summary, [contenteditable], [role="menu"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [tabindex]';
export function composerSurfacePress(event: { target: EventTarget | null; currentTarget: EventTarget | null; button: number; preventDefault(): void }, input: HTMLTextAreaElement | null): void {
  const target = event.target as Element | null;
  const card = event.currentTarget as Element | null;
  if (event.button !== 0 || !input || input.disabled || input.readOnly || !target || !card || typeof target.closest !== 'function') return;
  // Only the card's own controls count: an ancestor of the card (a focusable <main>) does not.
  const control = target.closest(COMPOSER_OWN_CONTROLS);
  if (control && card.contains(control)) return;
  event.preventDefault();
  input.focus();
}
