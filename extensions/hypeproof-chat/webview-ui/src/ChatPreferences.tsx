import { finishModal } from './modalMotion';
import './modalSurface.css';
import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { imeComposing } from './imeGuard';
import { useDialogFocus } from './dialogFocus';

/**
 * Native dialog keeps keyboard focus inside settings without a second modal implementation.
 * `initialFocus`: a selector inside the dialog to focus after it opens instead of the close button
 * (the usage entry opens the dialog on its usage section).
 * REQ-STUDIO-FOCUS-RESTORE: Escape, × and a press on the backdrop close it; Tab stays inside; focus
 * returns to the element that opened it (the menu toggle), or the composer when that is gone.
 */
export function ChatPreferences({ open, onClose, initialFocus, opener, children, title = '대화 설정', closeLabel = '대화 설정 닫기', className }: { open: boolean; onClose: () => void; initialFocus?: string; opener?: () => HTMLElement | null; children: ReactNode; title?: string; closeLabel?: string; className?: string }) {
  // CGP-CHAT-R-030: the shortcut sheet is the same modal with its own title, so the heading id is unique.
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const composing = useRef(false);
  // Declared before the focus hook: the dialog is shown before focus moves in, and closed (its
  // cleanup runs first) before focus is returned outside it.
  useLayoutEffect(() => {
    const node = dialog.current;
    if (!open || !node) return;
    if (!node.open) node.showModal();
    return () => { node.removeAttribute('data-closing'); if (node.open) node.close(); };
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
  const dismiss = () => finishModal(dialog.current, onClose);
  useDialogFocus(dialog, { open, kind: 'modal', keepFocusOnDismiss: true, initialFocus: initialFocus ?? 'header button', onDismiss: dismiss, ...(opener ? { opener } : {}) });
  return <dialog ref={dialog} className={['hps-preferences hp-modal', className].filter(Boolean).join(' ')} aria-labelledby={titleId}
    onKeyDown={event => {
      // CGP-DS-R-027 (#1880): an Escape that cancels an IME syllable must not close the dialog.
      // preventDefault stops the dialog's own close request; the cancel guard below covers a
      // close request that arrives anyway.
      if (imeComposing(event)) { if (event.key === 'Escape') event.preventDefault(); return; }
      // The top-layer dialog owns Escape. Keep the workspace underneath from dismissing the
      // sources panel (the focus hook has already closed the dialog).
      if (event.key === 'Escape') event.stopPropagation();
    }}
    onCancel={event => { event.preventDefault(); if (!composing.current) dismiss(); }}>
    <header><h2 id={titleId}>{title}</h2><button type="button" autoFocus aria-label={closeLabel} onClick={dismiss}>×</button></header>
    <div className="hps-preferences-body">{children}</div>
  </dialog>;
}
