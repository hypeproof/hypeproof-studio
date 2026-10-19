import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Native dialog keeps keyboard focus inside settings without a second modal implementation.
 * `initialFocus`: a selector inside the dialog to focus after it opens instead of the close button
 * (the usage entry opens the dialog on its usage section).
 */
export function ChatPreferences({ open, onClose, initialFocus, children }: { open: boolean; onClose: () => void; initialFocus?: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (open && node && !node.open) {
      node.showModal();
      if (initialFocus) node.querySelector<HTMLElement>(initialFocus)?.focus({ preventScroll: true });
    }
    if (!open && node?.open) node.close();
  }, [open, initialFocus]);
  return <dialog ref={dialog} className="hps-preferences" aria-labelledby="chat-preferences-title"
    onKeyDown={event => {
      // The top-layer dialog owns Escape. Keep its native cancel behavior while
      // preventing the workspace underneath from dismissing the sources panel.
      if (event.key === 'Escape') event.stopPropagation();
    }}
    onCancel={onClose} onClose={onClose}>
    <header><h2 id="chat-preferences-title">대화 설정</h2><button type="button" autoFocus aria-label="대화 설정 닫기" onClick={onClose}>×</button></header>
    <div className="hps-preferences-body">{children}</div>
  </dialog>;
}
