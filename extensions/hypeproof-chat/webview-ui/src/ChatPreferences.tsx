import { useEffect, useRef, type ReactNode } from 'react';

/** Native dialog keeps keyboard focus inside settings without a second modal implementation. */
export function ChatPreferences({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (open && node && !node.open) node.showModal();
    if (!open && node?.open) node.close();
  }, [open]);
  return <dialog ref={dialog} className="hps-preferences" aria-labelledby="chat-preferences-title"
    onCancel={onClose} onClose={onClose}>
    <header><h2 id="chat-preferences-title">대화 설정</h2><button type="button" autoFocus aria-label="대화 설정 닫기" onClick={onClose}>×</button></header>
    <div className="hps-preferences-body">{children}</div>
  </dialog>;
}
