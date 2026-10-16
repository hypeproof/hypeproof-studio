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
