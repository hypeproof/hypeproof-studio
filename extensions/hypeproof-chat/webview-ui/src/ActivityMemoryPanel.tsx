// REQ-STUDIO-ACTIVITY-MEMORY-FILES (CGP-KNOW-R-030 / REQ-KNOW-48) — the activity's memory files as the 기억
// filter of the 내 작품 drawer (CGP-KNOW-D-030 / DES-KNOW-48): where they live, each file's path (monospace),
// time and text, 열기 (a read-only editor tab) and 지우기. The webview only asks: the host lists the store,
// refuses anything outside it and shows its own native confirm (with 취소) before a delete.
// REQ-STUDIO-MEMORY-OVERVIEW (CGP-KNOW-R-025 / REQ-KNOW-43) — above the files, "작업별 기억": the stated facts grouped
// by task, built and checked by the host; each item has 고치기, where the learner rewrites it in words. The host
// sends no overview to a minor or unknown cohort, and then nothing of it is drawn.
// CGP-KNOW-D-025 (DES-KNOW-43) — the overview is plain sentences under task headings (no capability names, scores or
// badges), and the correction field sits once at its bottom: 고치기 opens it for that item, quoting the words it
// replaces; 취소 returns focus to that 고치기. The field is a textarea, so Enter (and an IME's Enter) never submits.
// REQ-STUDIO-MEMORY-MANAGER (CGP-KNOW-R-023 / REQ-KNOW-41) — each file names the task it was kept from (a link that opens
// that task, or the reason there is none), and 모두 지우기… removes every listed file after the host's two native confirms.
// REQ-STUDIO-MEMORY-CAPACITY (CGP-KNOW-R-024 / REQ-KNOW-42) — "기억 N/M개" with a bar that only repeats the words; from 90%
// a notice with 오래된 기억 정리, which lists the oldest items with a pre-checked pick for the host's two native confirms.
// There is no purchase, upgrade or "get more" control: the limit is a local folder's, not a plan's.

import { useEffect, useRef, useState } from 'react';
import { MEMORY_CAPACITY_COPY, MEMORY_CORRECTION_MAX, MEMORY_FOLDER_LABEL, memoryCapacity, memoryCleanupCount, MEMORY_SCOPE_LABEL, MEMORY_SOURCE_TEXT, MEMORY_STATE_LABEL, memoryResultNotice, type ActivityMemoryAction, type ActivityMemoryView, type MemorySource } from '../../src/activityMemoryView';
import { focusIsLost } from './dialogFocus';
import { onHostMessage, postToHost } from './vscode';

let requestSeq = 0;
const nextRequestId = () => `memory-${Date.now().toString(36)}-${(++requestSeq).toString(36)}`;

/** REQ-STUDIO-MEMORY-MANAGER — the task a file was kept from: a link to a task that can open now, otherwise words. */
export function MemorySourceLine({ source, onOpenTask }: { source: MemorySource; onOpenTask?: (taskId: string) => void }) {
  if (source.kind === 'task' && onOpenTask) return <div className="tw-memory-source">
    <span className="tw-memory-note">{MEMORY_SOURCE_TEXT.label}</span>
    <button type="button" dir="auto" onClick={() => onOpenTask(source.id)}>‘{source.title}’ 작업 열기</button>
  </div>;
  const text = source.kind === 'task' ? `‘${source.title}’` : source.kind === 'archived' ? MEMORY_SOURCE_TEXT.archived(source.title) : MEMORY_SOURCE_TEXT[source.kind];
  return <p className="tw-memory-note tw-memory-source" dir="auto">{MEMORY_SOURCE_TEXT.label}: {text}</p>;
}

/**
 * `fallback` takes keyboard focus when a delete or correction removes the focused control (the drawer's 기억 filter button).
 * `onOpenTask` (REQ-STUDIO-MEMORY-MANAGER) leaves the drawer for the task a file was kept from.
 */
export function ActivityMemoryList({ scopeKey, fallback, onOpenTask }: { scopeKey: string; fallback: () => HTMLElement | null; onOpenTask?: (taskId: string) => void }) {
  // undefined: not answered yet; null: this seat or activity has no memory store to show.
  const [view, setView] = useState<ActivityMemoryView | null | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const request = useRef<string | null>(null);
  const refocus = useRef(false);
  /** The overview item being corrected, and the learner's words for it. */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const corrector = useRef<HTMLButtonElement | null>(null);
  /** 오래된 기억 정리: the names picked for deletion, oldest first; null while the picker is closed. */
  const [cleanup, setCleanup] = useState<string[] | null>(null);
  const cleanupButton = useRef<HTMLButtonElement>(null);
  const pickHeading = useRef<HTMLHeadingElement>(null);
  const pickForm = useRef<HTMLFormElement>(null);

  useEffect(() => {
    setView(undefined); setPending(false); setError(''); setNotice(''); setEditing(null); setDraft(''); setCleanup(null);
    request.current = null; refocus.current = false;
    const dispose = onHostMessage(message => {
      if (message.type !== 'activityMemoryState') return;
      // An answer to another press (or to one from before a task switch) is not ours.
      if (message.requestId !== undefined && message.requestId !== request.current) return;
      if (message.requestId === undefined && request.current) return;
      setView(message.view);
      if (message.requestId === undefined) return;
      request.current = null; setPending(false);
      const result = message.result;
      if (!result || result.cancelled) return;
      if (result.error) { setError(result.error); return; }
      setError(''); setNotice(memoryResultNotice(result));
      if (result.action === 'correct') setEditing(null);
      if (result.action === 'deleteOld') setCleanup(null);
      // The deleted (or replaced) row's button goes away with this answer: the effect below lands focus after the commit.
      if (result.action === 'delete' || result.action === 'correct' || result.action === 'deleteAll' || result.action === 'deleteOld') refocus.current = true;
    });
    postToHost({ type: 'activityMemoryRequest' });
    return dispose;
  }, [scopeKey]);

  // After a delete commits, keep keyboard focus in the drawer, never on <body>.
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    if (focusIsLost()) fallback()?.focus({ preventScroll: true });
  });

  const act = (action: ActivityMemoryAction, name: string, text?: string) => {
    if (!view || request.current) return;
    const requestId = nextRequestId();
    request.current = requestId; setPending(true); setError(''); setNotice('');
    // 모두 지우기 names exactly the files this list shows; the host removes nothing else.
    const extra = action === 'correct' ? { text: text ?? '' } : action === 'deleteAll' ? { names: view.entries.map(entry => entry.name) } : action === 'deleteOld' ? { names: cleanup ?? [] } : {};
    postToHost({ type: 'activityMemoryAction', requestId, scope: view.scope, action, name, ...extra });
  };
  const overview = view?.overview ?? null;
  // The item being corrected, as the host lists it now: a refresh that dropped it closes the field.
  const correcting = editing === null ? undefined : overview?.groups.flatMap(group => group.items).find(item => item.name === editing);
  const closeCorrection = () => {
    setEditing(null); setError('');
    if (corrector.current?.isConnected) corrector.current.focus({ preventScroll: true });
    else refocus.current = true;
  };
  const capacity = view?.limit ? memoryCapacity(view.entries.length + view.other, view.limit) : null;
  // Oldest first. The pick starts with as many as bring the store back to 80%; the list shows at least ten to choose from.
  const oldest = view ? [...view.entries].sort((a, b) => a.at - b.at || (a.name < b.name ? -1 : 1)) : [];
  const openCleanup = () => {
    if (!capacity || pending) return;
    const count = Math.min(oldest.length, memoryCleanupCount(capacity.used, capacity.limit));
    setCleanup(oldest.slice(0, count).map(entry => entry.name)); setError(''); setNotice('');
    requestAnimationFrame(() => pickHeading.current?.focus({ preventScroll: true }));
  };
  const closeCleanup = () => { setCleanup(null); requestAnimationFrame(() => cleanupButton.current?.focus({ preventScroll: true })); };
  // Escape closes only the pick: the drawer listens for Escape on its own element, so the key is stopped here, natively.
  const pickOpen = cleanup !== null;
  useEffect(() => {
    const node = pickForm.current;
    if (!pickOpen || !node) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return;
      event.preventDefault(); event.stopPropagation();
      closeCleanup();
    };
    node.addEventListener('keydown', onKey);
    return () => node.removeEventListener('keydown', onKey);
  }, [pickOpen]);

  const note = (text: string, status = false) => <p className="tw-works-note" role={status ? 'status' : undefined}>{text}</p>;
  if (view === undefined) return note('기억 파일을 불러오는 중…', true);
  if (view === null) return note('이 활동에서는 기억 파일을 보여 줄 수 없어요.');
  return <section className="tw-memory" aria-label="AI 기억" data-testid="activity-memory">
    {/* REQ-STUDIO-ACTIVITY-MEMORY-STATE (CGP-KNOW-R-022): a text state, never a switch. Memory is always on
        (DEC-01, DEC-02), so there is no off state to show; the line exists only while the store does. */}
    <p className="tw-memory-state" data-testid="activity-memory-state">{MEMORY_STATE_LABEL} · <code>{view.folder}</code></p>
    {/* REQ-STUDIO-ACTIVITY-MEMORY-SCOPE (CGP-KNOW-R-005): the scope, fixed when the activity was made; text, never a choice. */}
    <p className="tw-memory-note" data-testid="activity-memory-scope">{MEMORY_SCOPE_LABEL}</p>
    {view.unsafe && <p className="tw-memory-note">기억 폴더가 링크이거나 폴더가 아니어서 읽지 않았어요.</p>}
    {error && <p role="alert" className="tw-memory-note">{error}</p>}
    <p role="status" className="tw-memory-note">{notice}</p>
    {capacity && <div className="tw-memory-capacity" data-testid="memory-capacity" data-level={capacity.level}>
      <p className="tw-memory-capacity-line">{MEMORY_CAPACITY_COPY.line(capacity.used, capacity.limit)}</p>
      {/* The words carry the state; the bar repeats them and is hidden from assistive tech. */}
      <div className="tw-memory-capacity-bar" aria-hidden="true"><span style={{ inlineSize: `${capacity.percent}%` }} /></div>
      {capacity.level !== 'ok' && <div className="tw-memory-capacity-notice">
        <p className="tw-memory-note">{capacity.level === 'full' ? MEMORY_CAPACITY_COPY.full(capacity.limit, !!overview) : MEMORY_CAPACITY_COPY.near(capacity.used, capacity.limit)}</p>
        {oldest.length > 0 && <div className="tw-memory-actions">
          <button ref={cleanupButton} type="button" aria-disabled={pending || undefined} aria-expanded={cleanup !== null} aria-controls={cleanup ? 'tw-memory-cleanup' : undefined}
            onClick={() => cleanup ? closeCleanup() : openCleanup()}>{MEMORY_CAPACITY_COPY.cleanup}</button>
        </div>}
      </div>}
      {cleanup && <form ref={pickForm} id="tw-memory-cleanup" className="tw-memory-cleanup" aria-labelledby="tw-memory-cleanup-title" onSubmit={event => { event.preventDefault(); if (!pending && cleanup.length) act('deleteOld', ''); }}>
        <h5 id="tw-memory-cleanup-title" ref={pickHeading} tabIndex={-1}>{MEMORY_CAPACITY_COPY.pickTitle}</h5>
        <p className="tw-memory-note">{MEMORY_CAPACITY_COPY.pickNote(cleanup.length)}</p>
        <ul aria-labelledby="tw-memory-cleanup-title">{oldest.slice(0, Math.max(10, memoryCleanupCount(capacity.used, capacity.limit))).map(entry => <li key={entry.name}>
          <label className="tw-memory-cleanup-item">
            <input type="checkbox" checked={cleanup.includes(entry.name)} onChange={event => setCleanup(event.target.checked ? [...cleanup, entry.name] : cleanup.filter(name => name !== entry.name))} />
            <span><span className="tw-memory-text" dir="auto">{entry.text ?? MEMORY_FOLDER_LABEL + entry.name}</span><time dateTime={new Date(entry.at).toISOString()}>{new Date(entry.at).toLocaleString('ko-KR')}</time></span>
          </label>
        </li>)}</ul>
        <div className="tw-memory-actions">
          <button type="submit" aria-disabled={pending || !cleanup.length || undefined}>{MEMORY_CAPACITY_COPY.confirm(cleanup.length)}</button>
          <button type="button" onClick={closeCleanup}>{MEMORY_CAPACITY_COPY.cancel}</button>
        </div>
      </form>}
    </div>}
    <div className="tw-memory-list">
      <p className="tw-memory-note">이 활동 폴더 안의 <code className="tw-memory-path" dir="ltr">{view.folder}</code>에 있는 파일이에요. 이 활동 밖의 기억은 읽지 않아요.</p>
      {overview && <section className="tw-memory-overview" aria-labelledby="tw-memory-overview-title" data-testid="memory-overview">
        <h4 id="tw-memory-overview-title">작업별 기억</h4>
        <p className="tw-memory-note">기억 파일에 적힌 사실을 작업별로 모았어요. 능력이나 성격을 말하는 것처럼 보이는 문장은 빼고 보여 줘요.</p>
        {overview.withheld > 0 && <p className="tw-memory-note">능력이나 성격을 말하는 것 같은 기억 {overview.withheld}개는 여기에 넣지 않았어요. 아래 파일 목록에서 보고 지울 수 있어요.</p>}
        {overview.groups.length === 0 ? <p className="tw-memory-note">작업별로 보여 줄 기억이 아직 없어요.</p>
          : overview.groups.map(group => <div key={group.task ?? ''} className="tw-memory-group">
            <h5>{group.title}</h5>
            <ul aria-label={`${group.title}에서 남긴 기억`}>{group.items.map(item => <li key={item.name}>
              <p className="tw-memory-text">{item.text}</p>
              <div className="tw-memory-actions">
                <button type="button" aria-disabled={pending || undefined} aria-label={`고치기: ${item.text.slice(0, 40)}`}
                  aria-expanded={editing === item.name} aria-controls={editing === item.name ? 'tw-memory-correct' : undefined}
                  onClick={event => { if (pending) return; corrector.current = event.currentTarget; setEditing(item.name); setDraft(item.text); setError(''); setNotice(''); }}>고치기</button>
              </div>
            </li>)}</ul>
          </div>)}
        {correcting && <form id="tw-memory-correct" className="tw-memory-correct" aria-labelledby="tw-memory-correct-title" onSubmit={event => { event.preventDefault(); if (!pending) act('correct', correcting.name, draft); }}>
          <h5 id="tw-memory-correct-title">기억 고치기</h5>
          <p className="tw-memory-note">고칠 기억</p>
          <p id="tw-memory-correct-quote" className="tw-memory-text tw-memory-correct-quote" dir="auto">{correcting.text}</p>
          <label htmlFor="tw-memory-correct-field">바르게 고친 문장</label>
          <textarea id="tw-memory-correct-field" value={draft} maxLength={MEMORY_CORRECTION_MAX} rows={3} autoFocus aria-describedby="tw-memory-correct-quote"
            onChange={event => setDraft(event.target.value)} />
          <div className="tw-memory-actions">
            <button type="submit" aria-disabled={pending || undefined}>고친 내용 저장</button>
            <button type="button" onClick={closeCorrection}>취소</button>
          </div>
        </form>}
      </section>}
      {view.other > 0 && <p className="tw-memory-note">목록에 없는 파일 {view.other}개는 폴더에서 직접 확인할 수 있어요.</p>}
      <h4 className="tw-memory-files-title">AI 기억 파일 · {view.entries.length}개</h4>
      {view.entries.length > 0 && <div className="tw-memory-actions">
        <button type="button" aria-disabled={pending || undefined} onClick={() => { if (!pending) act('deleteAll', ''); }}>모두 지우기…</button>
      </div>}
      {view.entries.length === 0 ? <p className="tw-memory-note">아직 기억 파일이 없어요.</p>
        : <ul className="tw-works-list" aria-label="AI 기억 파일">{view.entries.map(entry => <li key={entry.name} className="tw-works-item tw-memory-item">
          <code className="tw-memory-path" dir="ltr">{MEMORY_FOLDER_LABEL}{entry.name}</code>
          <time dateTime={new Date(entry.at).toISOString()}>{new Date(entry.at).toLocaleString('ko-KR')}</time>
          {entry.source && <MemorySourceLine source={entry.source} onOpenTask={onOpenTask} />}
          {entry.text === null ? <p className="tw-memory-note">파일이 크거나 글자가 아니어서 여기에서는 보여 주지 않아요. 열기로 확인해 주세요.</p>
            : <p className="tw-memory-text" dir="auto">{entry.text}</p>}
          <div className="tw-memory-actions">
            <button type="button" aria-disabled={pending || undefined} aria-label={`열기: ${entry.name}`} onClick={() => { if (!pending) act('open', entry.name); }}>열기</button>
            <button type="button" aria-disabled={pending || undefined} aria-label={`지우기: ${entry.name}`} onClick={() => { if (!pending) act('delete', entry.name); }}>지우기…</button>
          </div>
        </li>)}</ul>}
    </div>
  </section>;
}
