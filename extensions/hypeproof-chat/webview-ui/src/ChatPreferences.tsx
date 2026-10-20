import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { imeComposing } from './imeGuard';
import { useDialogFocus } from './dialogFocus';

/**
 * Native dialog keeps keyboard focus inside settings without a second modal implementation.
 * `initialFocus`: a selector inside the dialog to focus after it opens instead of the close button
 * (the usage entry opens the dialog on its usage section).
 * REQ-STUDIO-FOCUS-RESTORE: Escape, × and a press on the backdrop close it; Tab stays inside; focus
 * returns to the element that opened it (the menu toggle), or the composer when that is gone.
 */
export function ChatPreferences({ open, onClose, initialFocus, children }: { open: boolean; onClose: () => void; initialFocus?: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const composing = useRef(false);
  // Declared before the focus hook: the dialog is shown before focus moves in, and closed (its
  // cleanup runs first) before focus is returned outside it.
  useLayoutEffect(() => {
    const node = dialog.current;
    if (!open || !node) return;
    if (!node.open) node.showModal();
    return () => { if (node.open) node.close(); };
  }, [open]);
  // The cancel guard reads the last key pressed anywhere while open (focus may sit on <body> inside
  // the modal), so a stale composing key never blocks a later plain Escape.
  useLayoutEffect(() => {
    if (!open) return;
    composing.current = false;
    const track = (event: KeyboardEvent) => { composing.current = event.isComposing || event.keyCode === 229; };
    document.addEventListener('keydown', track, true);
    return () => document.removeEventListener('keydown', track, true);
  }, [open]);
  useDialogFocus(dialog, { open, kind: 'modal', initialFocus: initialFocus ?? 'header button', onDismiss: onClose });
  return <dialog ref={dialog} className="hps-preferences" aria-labelledby="chat-preferences-title"
    onKeyDown={event => {
      // CGP-DS-R-027 (#1880): an Escape that cancels an IME syllable must not close the dialog.
      // preventDefault stops the dialog's own close request; the cancel guard below covers a
      // close request that arrives anyway.
      if (imeComposing(event)) { if (event.key === 'Escape') event.preventDefault(); return; }
      // The top-layer dialog owns Escape. Keep the workspace underneath from dismissing the
      // sources panel (the focus hook has already closed the dialog).
      if (event.key === 'Escape') event.stopPropagation();
    }}
    onCancel={event => { if (composing.current) { event.preventDefault(); return; } onClose(); }} onClose={onClose}>
    <header><h2 id="chat-preferences-title">대화 설정</h2><button type="button" autoFocus aria-label="대화 설정 닫기" onClick={onClose}>×</button></header>
    <div className="hps-preferences-body">{children}</div>
  </dialog>;
}
