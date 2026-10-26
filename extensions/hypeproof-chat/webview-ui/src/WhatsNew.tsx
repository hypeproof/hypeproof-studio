import { useEffect, useId, useRef, useState } from 'react';
import type { LearnerNotes } from '../../src/whatsNew';
import type { ChatConfig } from '../../src/protocol';
import { ChatIcon } from './ChatDetails';
import { ChatPreferences } from './ChatPreferences';
import { onHostMessage, postToHost } from './vscode';
import './whatsNew.css';

export interface WhatsNewView { notes: LearnerNotes | null; show: boolean; loaded: boolean }

/** CGP-SHELL-R-035 — the host decides once per window whether the panel is due; the lines come from the host too. */
export function useWhatsNew(config: ChatConfig | null, instructor: boolean): [WhatsNewView, () => void] {
  const id = useId(), serial = useRef(0);
  const [view, setView] = useState<WhatsNewView>({ notes: null, show: false, loaded: false });
  useEffect(() => {
    let requestId = '';
    const request = () => { requestId = `${id}-${++serial.current}`; postToHost({ type: 'whatsNewRequest', requestId }); };
    const off = onHostMessage(message => {
      if (message.type === 'whatsNewChanged') request();
      if (message.type === 'whatsNew' && message.requestId === requestId) setView({ notes: message.notes, show: message.show === true, loaded: true });
    });
    request();
    return off;
    // A new config can carry a resolved instructor mode; the host answers from its own state.
  }, [config, instructor]);
  // A late answer to a request sent before the close must not bring the panel back.
  const [closed, setClosed] = useState<string | null>(null);
  const dismiss = () => {
    const notesId = view.notes?.id;
    if (!notesId) return;
    setClosed(notesId);
    postToHost({ type: 'whatsNewDismiss', notesId });
  };
  return [{ notes: view.notes, loaded: view.loaded, show: view.show && !instructor && !!view.notes && view.notes.id !== closed }, dismiss];
}

/** A non-modal row above the composer. It never takes focus; drawing it tells the host it was seen. */
export function WhatsNewPanel({ notes, onDismiss }: { notes: LearnerNotes; onDismiss: () => void }) {
  const titleId = useId();
  useEffect(() => { postToHost({ type: 'whatsNewShown', notesId: notes.id }); }, [notes.id]);
  return <section className="hps-whats-new" aria-labelledby={titleId} data-whats-new={notes.id}>
    <div className="hps-whats-new-body">
      <h2 id={titleId} className="hps-whats-new-title">새로운 기능</h2>
      <ul className="hps-whats-new-list">{notes.items.map((item, index) => <li key={index}>{item}</li>)}</ul>
    </div>
    <button type="button" className="hps-whats-new-dismiss" aria-label="새로운 기능 닫기" data-hp-tooltip="닫기 · 대화 설정에서 다시 볼 수 있어요" onClick={onDismiss}>
      <ChatIcon kind="close" size={20} />
    </button>
  </section>;
}

/** The same lines, reachable later from the settings dialog (next to 키보드 단축키). */
export function WhatsNewSheet({ open, notes, loaded, onClose, opener }: { open: boolean; notes: LearnerNotes | null; loaded: boolean; onClose: () => void; opener?: () => HTMLElement | null }) {
  if (!open) return null;
  return <ChatPreferences open={open} onClose={onClose} title="새로운 기능" closeLabel="새로운 기능 닫기" className="hps-whats-new-sheet" {...(opener ? { opener } : {})}>
    {notes
      ? <ul className="hps-whats-new-list">{notes.items.map((item, index) => <li key={index}>{item}</li>)}</ul>
      : <p role="status">{loaded ? '이번 버전에서 새로 알려 드릴 기능이 없어요.' : '새로운 기능을 불러오고 있어요.'}</p>}
  </ChatPreferences>;
}
