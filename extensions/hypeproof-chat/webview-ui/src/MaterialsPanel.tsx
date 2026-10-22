// CGP-KNOW-R-003 (REQ-STUDIO-ACTIVITY-MATERIALS) — the activity's 자료 list in the coach rail, and
// the line above the composer that says which items go with the next message. The webview only
// asks: the host owns the list, the selection, every check and the picker, and answers each press
// with `materialsState` carrying the press's requestId.
//
// Rail rules (SX-04/05): closed by default, no Primary, outside the message stream. Who added an
// item is said in words (추가: 나/강사/AI); an instructor's item has no 빼기.

import { useEffect, useRef, useState } from 'react';
import type { MaterialItemView, MaterialsView } from '../../src/activityMaterialsView';
import { MATERIALS_COPY } from '../../src/activityMaterialsView';
import { imeComposing } from './imeGuard';
import { onHostMessage, postToHost } from './vscode';

let seq = 0;
const nextId = () => `material-${Date.now().toString(36)}-${(++seq).toString(36)}`;

/** One subscription per mounted surface; both read the same host message. */
function useMaterials() {
  const [view, setView] = useState<MaterialsView | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pending = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const dispose = onHostMessage(message => {
      if (message.type !== 'materialsState') return;
      setView(message.view);
      // An answer to another surface's press updates the list, not this surface's messages.
      if (message.requestId !== undefined && message.requestId !== pending.current) return;
      if (message.requestId !== undefined) { pending.current = null; setBusy(false); }
      setError(message.error ?? '');
      setNotice(message.notice ?? '');
    });
    postToHost({ type: 'materialsRequest' });
    return dispose;
  }, []);
  const ask = (build: (requestId: string) => Parameters<typeof postToHost>[0]) => {
    if (pending.current) return;
    const requestId = nextId();
    pending.current = requestId; setBusy(true); setError(''); setNotice('');
    postToHost(build(requestId));
  };
  return { view, error, notice, busy, ask };
}

function selectLabel(item: MaterialItemView): string {
  return `${item.selected ? '넣음' : '이번 질문에 넣기'}: ${item.title}`;
}

export function MaterialsPanel() {
  const { view, error, notice, busy, ask } = useMaterials();
  const [url, setUrl] = useState('');
  if (!view) return null;
  const chosen = view.items.filter(item => item.selected).length;
  const submitUrl = () => { if (url.trim()) ask(requestId => ({ type: 'materialAddUrl', requestId, url })); };
  return <details className="hp-rail-lesson hp-materials" data-testid="materials">
    <summary>자료 {view.items.length}개{chosen ? ` · 이번 질문에 ${chosen}개 넣음` : ''}</summary>
    <p className="hp-materials-note">{MATERIALS_COPY.note}</p>
    {view.items.length > 0 && <ul className="hp-materials-list" aria-label="자료 목록">
      {view.items.map(item => <li key={item.id} className="hp-materials-item" data-material-origin={item.origin}>
        <span className="hp-materials-title">{item.title}</span>
        <span className="hp-materials-meta">추가: {item.originLabel} · {item.kind === 'url' ? '주소' : item.kind === 'note' ? '강사가 보낸 글' : '파일'}</span>
        {item.kind !== 'note' && <span className="hp-materials-detail">{item.detail}</span>}
        <div className="hp-materials-actions">
          <button type="button" className="hp-cta-quiet" aria-pressed={item.selected} aria-label={selectLabel(item)} disabled={busy}
            onClick={() => ask(requestId => ({ type: 'materialSelect', requestId, scope: view.scope, id: item.id, selected: !item.selected }))}>
            {item.selected ? '넣음' : '이번 질문에 넣기'}
          </button>
          {item.removable
            ? <button type="button" className="hp-cta-quiet" data-material-remove="" aria-label={`목록에서 빼기: ${item.title}`} disabled={busy}
                onClick={() => ask(requestId => ({ type: 'materialRemove', requestId, scope: view.scope, id: item.id }))}>목록에서 빼기</button>
            : <span className="hp-materials-meta">{MATERIALS_COPY.instructorLocked}</span>}
        </div>
      </li>)}
    </ul>}
    <div className="hp-materials-add">
      <button type="button" className="hp-cta-quiet" data-material-add-file="" disabled={busy} onClick={() => ask(requestId => ({ type: 'materialAddFile', requestId }))}>파일 넣기</button>
      <form className="hp-materials-url" onSubmit={event => { event.preventDefault(); submitUrl(); }}>
        <label>
          <span>주소 넣기 (https)</span>
          <input type="url" name="material-url" inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://" value={url}
            onChange={event => setUrl(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && imeComposing(event)) event.preventDefault(); }} />
        </label>
        <button type="submit" className="hp-cta-quiet" disabled={busy || !url.trim()}>주소 넣기</button>
      </form>
    </div>
    {error && <p role="alert" className="hp-materials-error">{error}</p>}
    {notice && <p role="status" className="hp-materials-notice">{notice}</p>}
  </details>;
}

/**
 * Above the composer: exactly which 자료 go with the next message, each removable. A selected item
 * that cannot be sent now (deleted, renamed, unreadable, withdrawn) is named here with why, before
 * Send; the host holds the send until the learner takes it out.
 */
export function MaterialsChips() {
  const { view, ask, busy } = useMaterials();
  const unavailable = view?.unavailable ?? [];
  const blocked = new Set(unavailable.map(item => item.id));
  const chosen = view?.items.filter(item => item.selected && !blocked.has(item.id)) ?? [];
  if (!view || (!chosen.length && !unavailable.length)) return null;
  const takeOut = (id: string) => ask(requestId => ({ type: 'materialSelect', requestId, scope: view.scope, id, selected: false }));
  return <div className="hp-materials-chips" role="group" aria-label="다음 메시지와 함께 보낼 자료" data-testid="materials-chips">
    <span className="hp-materials-meta">함께 보낼 자료</span>
    {chosen.map(item => <span key={item.id} className="hp-materials-chip">
      <span>{item.title} · 추가: {item.originLabel}</span>
      <button type="button" className="hp-cta-quiet" aria-label={`${item.title} 빼기`} disabled={busy} onClick={() => takeOut(item.id)}>빼기</button>
    </span>)}
    {unavailable.map(item => <span key={item.id} className="hp-materials-chip" data-material-unavailable="">
      <span>{item.title} · 보낼 수 없음: {item.reason}</span>
      <button type="button" className="hp-cta-quiet" aria-label={`${item.title} 빼기 (보낼 수 없는 자료)`} disabled={busy} onClick={() => takeOut(item.id)}>빼기</button>
    </span>)}
    {unavailable.length > 0 && <p role="alert" className="hp-materials-error" data-testid="materials-unavailable">{MATERIALS_COPY.unavailableNote}</p>}
  </div>;
}
