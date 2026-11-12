// CGP-KNOW-D-023 (DES-KNOW-41) — "AI가 기억하는 것" in 대화 설정: the same memory items as the 내 작품 기억 view
// (REQ-STUDIO-MEMORY-MANAGER, one store, one host), each with its text, date, the task it came from and 지우기.
// The list asks the host for the view (activityMemoryRequest) and draws nothing on a seat without the store.
// - Search filters by committed text only: while an IME composition is open the list keeps its last filter, so a
//   half-typed syllable never empties it.
// - 지우기 opens the chat's own confirm dialog with 취소 focused first; only its 지우기 sends the delete, naming the
//   identity the item was listed with (the host deletes that exact file or refuses).
// - Rows are at least 44px; the source line sits under the text, so at 320px it wraps below it.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MEMORY_SETTINGS_COPY, memoryResultNotice, type ActivityMemoryItem, type ActivityMemoryView } from '../../src/activityMemoryView';
import { MemorySourceLine } from './ActivityMemoryPanel';
import { useDialogFocus } from './dialogFocus';
import { imeComposing } from './imeGuard';
import { onHostMessage, postToHost } from './vscode';

let requestSeq = 0;
const nextRequestId = () => `memory-settings-${Date.now().toString(36)}-${(++requestSeq).toString(36)}`;
/** Committed search text as matched: NFC, case-folded, spaces collapsed. */
const fold = (text: string) => text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

export function MemorySettingsList({ onOpenTask }: { onOpenTask?: (taskId: string) => void }) {
  // undefined: not answered yet; null: no memory store on this seat (nothing is drawn).
  const [view, setView] = useState<ActivityMemoryView | null | undefined>(undefined);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const composing = useRef(false);
  const [confirm, setConfirm] = useState<ActivityMemoryItem | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const request = useRef<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const dispose = onHostMessage(message => {
      if (message.type !== 'activityMemoryState') return;
      // Every answer carries the store as it is now (also one to the 내 작품 view): the list follows it. Only this
      // list's own press reports a result here.
      setView(message.view);
      if (message.requestId === undefined || message.requestId !== request.current) return;
      request.current = null;
      const result = message.result;
      if (!result || result.cancelled) return;
      if (result.error) { setError(result.error); setNotice(''); return; }
      // The list shows each memory by its words, never its file name, so the notice names none either.
      setError(''); setNotice(result.action === 'delete' ? MEMORY_SETTINGS_COPY.deleted : memoryResultNotice(result));
      // The deleted row's button is gone: keep focus in the dialog, on the list heading.
      heading.current?.focus({ preventScroll: true });
    });
    postToHost({ type: 'activityMemoryRequest' });
    return dispose;
  }, []);

  const closeConfirm = () => {
    dialog.current?.close();
    setConfirm(null);
    opener.current?.focus({ preventScroll: true });
  };
  // The confirm opens modal over 대화 설정, with 취소 focused first (it must be open before the focus contract moves
  // focus in, so this layout effect comes first). useDialogFocus keeps Tab inside it and takes its Escape on the
  // confirm's own element, stopped there, so 대화 설정 never sees the key and stays open.
  useLayoutEffect(() => {
    const node = dialog.current;
    if (confirm && node && !node.open) node.showModal();
  }, [confirm]);
  useDialogFocus(dialog, { open: !!confirm, kind: 'modal', keepFocusOnDismiss: true, initialFocus: '[data-memory-cancel]', opener: () => opener.current, onDismiss: closeConfirm });

  const confirmDelete = () => {
    if (!confirm || !view || request.current || composing.current) return;
    const requestId = nextRequestId();
    request.current = requestId;
    setError(''); setNotice('');
    postToHost({ type: 'activityMemoryAction', requestId, scope: view.scope, action: 'delete', name: confirm.name, ...(confirm.pin ? { confirmedPin: confirm.pin } : {}) });
    dialog.current?.close();
    setConfirm(null);
  };

  if (!view) return null;
  const items = view.entries.filter(entry => entry.text !== null);
  const shown = query ? items.filter(entry => fold(entry.text ?? '').includes(fold(query))) : items;
  return <section className="hps-memory-settings" aria-labelledby="hps-memory-settings-title" data-testid="memory-settings">
    <h3 id="hps-memory-settings-title" ref={heading} tabIndex={-1}>{MEMORY_SETTINGS_COPY.title}</h3>
    {items.length > 0 && <label className="hps-memory-settings-search">
      <span>{MEMORY_SETTINGS_COPY.search}</span>
      <input type="search" value={draft}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={event => { composing.current = false; setQuery(event.currentTarget.value); }}
        onChange={event => { setDraft(event.target.value); if (!composing.current && !(event.nativeEvent as InputEvent).isComposing) setQuery(event.target.value); }}
        onKeyDown={event => { if (imeComposing(event, composing.current) && (event.key === 'Enter' || event.key === 'Escape')) event.stopPropagation(); }} />
    </label>}
    {error && <p role="alert" className="hps-memory-settings-note">{error}</p>}
    <p role="status" className="hps-memory-settings-note">{notice}</p>
    {items.length === 0 ? <p className="hps-memory-settings-empty">{MEMORY_SETTINGS_COPY.empty}</p>
      : shown.length === 0 ? <p className="hps-memory-settings-empty">{MEMORY_SETTINGS_COPY.noMatch}</p>
      : <ul className="hps-memory-settings-list" aria-label={MEMORY_SETTINGS_COPY.title}>{shown.map(entry => <li key={entry.name}>
        <p className="hps-memory-settings-text" dir="auto">{entry.text}</p>
        <div className="hps-memory-settings-meta">
          <time dateTime={new Date(entry.at).toISOString()}>{new Date(entry.at).toLocaleDateString('ko-KR')}</time>
          {entry.source && <MemorySourceLine source={entry.source} onOpenTask={onOpenTask} />}
        </div>
        <button type="button" className="hps-memory-settings-delete" aria-label={`${MEMORY_SETTINGS_COPY.delete}: ${(entry.text ?? '').slice(0, 40)}`}
          onClick={event => { opener.current = event.currentTarget; setConfirm(entry); }}>{MEMORY_SETTINGS_COPY.delete}</button>
      </li>)}</ul>}
    {confirm && <dialog ref={dialog} className="hps-memory-settings-confirm hp-modal" aria-labelledby="hps-memory-confirm-title" aria-describedby="hps-memory-confirm-text hps-memory-confirm-note"
      onCancel={event => { event.preventDefault(); closeConfirm(); }}
      onKeyDown={event => { if (imeComposing(event, composing.current) && event.key === 'Enter') event.preventDefault(); }}>
      <h4 id="hps-memory-confirm-title">{MEMORY_SETTINGS_COPY.confirmTitle}</h4>
      <p id="hps-memory-confirm-text" className="hps-memory-settings-text" dir="auto">{confirm.text}</p>
      <p id="hps-memory-confirm-note" className="hps-memory-settings-note">{MEMORY_SETTINGS_COPY.confirmNote}</p>
      <div className="hps-memory-settings-actions">
        <button type="button" data-memory-cancel="" onClick={closeConfirm}>{MEMORY_SETTINGS_COPY.cancel}</button>
        <button type="button" className="hps-memory-settings-danger" onClick={confirmDelete}>{MEMORY_SETTINGS_COPY.delete}</button>
      </div>
    </dialog>}
  </section>;
}
