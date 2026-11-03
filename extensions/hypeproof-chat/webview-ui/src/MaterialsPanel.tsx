// CGP-KNOW-R-003 (REQ-STUDIO-ACTIVITY-MATERIALS) — the activity's 자료 list in the coach rail, and
// the line above the composer that says which items go with the next message. The webview only
// asks: the host owns the list, the selection, every check and the picker, and answers each press
// with `materialsState` carrying the press's requestId.
//
// Rail rules (SX-04/05): closed by default, no Primary, outside the message stream. Who added an
// item is said in words (추가: 나/강사/AI); an instructor's item has no 빼기.
//
// #2641 — the open card also takes one dropped file, the same file 파일 넣기 takes. A webview File has no
// path, so its bytes go to the host as base64 and the host runs the picker's checks on them. The drop
// stops here: it never reaches the shell, which would attach it to the composer instead.

import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { MaterialItemView, MaterialsView } from '../../src/activityMaterialsView';
import { MATERIALS_COPY, MATERIALS_DROP_MAX_BYTES } from '../../src/activityMaterialsView';
import { ChatIcon } from './ChatDetails';
import { imeComposing } from './imeGuard';
import { onHostMessage, postToHost } from './vscode';

let seq = 0;
const nextId = () => `material-${Date.now().toString(36)}-${(++seq).toString(36)}`;

/** One subscription per mounted surface; both read the same host message. */
function useMaterials() {
  const [view, setView] = useState<MaterialsView | null>(null);
  // CGP-KNOW-R-002: the activity home tells "not answered yet" from "the host has no list here".
  const [answered, setAnswered] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pending = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const dispose = onHostMessage(message => {
      if (message.type !== 'materialsState') return;
      setView(message.view);
      setAnswered(true);
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
  /** A refusal decided here, with no host request (several files in one drop). */
  const refuse = (message: string) => { setError(message); setNotice(''); };
  return { view, answered, error, notice, busy, ask, refuse };
}

const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.items ?? []).some(item => item.kind === 'file');

function base64Of(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function selectLabel(item: MaterialItemView): string {
  return `${item.selected ? '넣음' : '이번 질문에 넣기'}: ${item.title}`;
}

/** Unknown or malformed historical timestamps never become the current time. */
function MaterialAddedTime({ at }: { at?: number }) {
  if (!Number.isSafeInteger(at) || at! <= 0 || at! > 8640000000000000) return <span className="hp-materials-meta">추가 시각 미확인</span>;
  const date = new Date(at!);
  const label = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
  return <time className="hp-materials-meta" dateTime={date.toISOString()} title={date.toISOString()}>추가: {label}</time>;
}

/**
 * `home` (CGP-KNOW-R-002): drawn as the activity home's 자료 view in the task workspace rail, open,
 * with a heading instead of a disclosure. Without it, the coach rail's closed card (classroom seats).
 */
export function MaterialsPanel({ home = false }: { home?: boolean }) {
  const { view, answered, error, notice, busy, ask, refuse } = useMaterials();
  const [url, setUrl] = useState('');
  const [dropping, setDropping] = useState(false);
  if (!view) return home ? <p className="hp-materials-note hp-materials-home-state" role="status">{answered ? MATERIALS_COPY.homeUnavailable : MATERIALS_COPY.homeLoading}</p> : null;
  const chosen = view.items.filter(item => item.selected).length;
  const submitUrl = () => { if (url.trim()) ask(requestId => ({ type: 'materialAddUrl', requestId, url })); };
  // Only the open card is a drop target (the home view is always open); the closed summary row leaves a drop to the shell.
  const target = (event: DragEvent<HTMLElement>) => (home || (event.currentTarget as HTMLDetailsElement).open) && hasFiles(event);
  const onDragOver = (event: DragEvent<HTMLElement>) => {
    if (!target(event)) return;
    event.preventDefault(); event.stopPropagation();
    if (!dropping) setDropping(true);
  };
  const onDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
  };
  const onDrop = (event: DragEvent<HTMLElement>) => {
    if (!target(event)) return;
    event.preventDefault(); event.stopPropagation();
    setDropping(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length !== 1) { refuse(MATERIALS_COPY.dropOne); return; }
    const [file] = files;
    // Over the cap the bytes are never read: the host answers with the picker's size refusal.
    const read = file.size > MATERIALS_DROP_MAX_BYTES ? Promise.resolve('') : file.arrayBuffer().then(base64Of);
    void read.then(base64 => ask(requestId => ({ type: 'materialAddDrop', requestId, name: file.name, size: file.size, base64 })))
      .catch(() => ask(requestId => ({ type: 'materialAddDrop', requestId, name: file.name, size: file.size, base64: '' })));
  };
  const Root = home ? 'section' : 'details';
  const count = `자료 ${view.items.length}개${chosen ? ` · 이번 질문에 ${chosen}개 넣음` : ''}`;
  return <Root className={home ? 'hp-materials hp-materials-home' : 'hp-rail-lesson hp-materials'} data-testid="materials" aria-labelledby={home ? 'hp-materials-home-count' : undefined}
    data-drop-active={dropping ? '' : undefined} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
    {home ? <h2 id="hp-materials-home-count" className="hp-materials-home-count">{count}</h2> : <summary>{count}</summary>}
    <p className="hp-materials-note">{MATERIALS_COPY.note}</p>
    {view.items.length > 0 && <ul className="hp-materials-list" aria-label="자료 목록">
      {view.items.map(item => <li key={item.id} className="hp-materials-item" data-material-origin={item.origin}>
        <div className="hp-materials-heading">
          <ChatIcon kind={item.kind === 'url' ? 'link' : item.kind === 'note' ? 'book' : 'file'} size={20} />
          <span className="hp-materials-title" tabIndex={0} aria-label={item.title} title={item.title} data-hp-tooltip={item.title}>{item.title}</span>
          <span className="hp-materials-origin">추가: {item.originLabel}</span>
        </div>
        <MaterialAddedTime at={item.addedAt} />
        <span className="hp-materials-meta">{item.kind === 'url' ? '주소' : item.kind === 'note' ? '강사가 보낸 글' : '파일'}</span>
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
  </Root>;
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
