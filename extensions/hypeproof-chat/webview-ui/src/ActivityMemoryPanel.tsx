// REQ-STUDIO-ACTIVITY-MEMORY-FILES (CGP-KNOW-R-030 / REQ-KNOW-48) — the activity's memory files under
// 내 작품: where they live, each file's text, 열기 (a read-only editor tab) and 지우기. The webview
// only asks: the host lists the store, refuses anything outside it and shows its own native
// confirm (with 취소) before a delete.
// REQ-STUDIO-MEMORY-OVERVIEW (CGP-KNOW-R-025 / REQ-KNOW-43) — above the files, "작업별 기억": the stated facts grouped
// by task, built and checked by the host; each item has 고치기, where the learner rewrites it in words. The host
// sends no overview to a minor or unknown cohort, and then nothing of it is drawn.

import { useEffect, useRef, useState } from 'react';
import { MEMORY_CORRECTION_MAX, MEMORY_STATE_LABEL, memoryResultNotice, type ActivityMemoryAction, type ActivityMemoryView } from '../../src/activityMemoryView';
import { focusIsLost } from './dialogFocus';
import { onHostMessage, postToHost } from './vscode';

let requestSeq = 0;
const nextRequestId = () => `memory-${Date.now().toString(36)}-${(++requestSeq).toString(36)}`;

export function ActivityMemoryPanel({ scopeKey }: { scopeKey: string }) {
  const [view, setView] = useState<ActivityMemoryView | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const request = useRef<string | null>(null);
  const entryButton = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  /** The overview item being corrected, and the learner's words for it. */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    setView(null); setOpen(false); setPending(false); setError(''); setNotice(''); setEditing(null); setDraft('');
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
      // The deleted (or replaced) row's button goes away with this answer: the effect below lands focus after the commit.
      if (result.action === 'delete' || result.action === 'correct') refocus.current = true;
    });
    postToHost({ type: 'activityMemoryRequest' });
    return dispose;
  }, [scopeKey]);

  // After a delete commits, keep keyboard focus in the panel, never on <body>.
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    if (focusIsLost()) entryButton.current?.focus({ preventScroll: true });
  });

  const act = (action: ActivityMemoryAction, name: string, text?: string) => {
    if (!view || request.current) return;
    const requestId = nextRequestId();
    request.current = requestId; setPending(true); setError(''); setNotice('');
    postToHost({ type: 'activityMemoryAction', requestId, scope: view.scope, action, name, ...(action === 'correct' ? { text: text ?? '' } : {}) });
  };
  const overview = view?.overview ?? null;

  if (!view) return null;
  return <section className="tw-memory" aria-labelledby="tw-memory-entry" data-testid="activity-memory">
    {/* REQ-STUDIO-ACTIVITY-MEMORY-STATE (CGP-KNOW-R-022): a text state, never a switch. Memory is always on
        (DEC-01, DEC-02), so there is no off state to show; the line exists only while the store does. */}
    <p className="tw-memory-state" data-testid="activity-memory-state">{MEMORY_STATE_LABEL} · <code>{view.folder}</code></p>
    {view.unsafe && <p className="tw-memory-note">기억 폴더가 링크이거나 폴더가 아니어서 읽지 않았어요.</p>}
    <button ref={entryButton} id="tw-memory-entry" type="button" className="tw-memory-entry" aria-expanded={open} aria-controls="tw-memory-list"
      onClick={() => { setOpen(value => !value); if (!open) postToHost({ type: 'activityMemoryRequest' }); }}>
      AI 기억 파일 · {view.entries.length}개
    </button>
    {error && <p role="alert" className="tw-memory-note">{error}</p>}
    <p role="status" className="tw-memory-note">{notice}</p>
    {open && <div id="tw-memory-list" className="tw-memory-list">
      <p className="tw-memory-note">이 활동 폴더 안의 <code>{view.folder}</code>에 있는 파일이에요. 이 활동 밖의 기억은 읽지 않아요.</p>
      {overview && <section className="tw-memory-overview" aria-labelledby="tw-memory-overview-title" data-testid="memory-overview">
        <h4 id="tw-memory-overview-title">작업별 기억</h4>
        <p className="tw-memory-note">기억 파일에 적힌 사실을 작업별로 모았어요. 능력이나 성격을 말하는 것처럼 보이는 문장은 빼고 보여 줘요.</p>
        {overview.withheld > 0 && <p className="tw-memory-note">능력이나 성격을 말하는 것 같은 기억 {overview.withheld}개는 여기에 넣지 않았어요. 아래 파일 목록에서 보고 지울 수 있어요.</p>}
        {overview.groups.length === 0 ? <p className="tw-memory-note">작업별로 보여 줄 기억이 아직 없어요.</p>
          : overview.groups.map(group => <div key={group.task ?? ''} className="tw-memory-group">
            <h5>{group.title}</h5>
            <ul aria-label={`${group.title}에서 남긴 기억`}>{group.items.map(item => <li key={item.name}>
              <p className="tw-memory-text">{item.text}</p>
              {editing === item.name ? <form className="tw-memory-correct" onSubmit={event => { event.preventDefault(); if (!pending) act('correct', item.name, draft); }}>
                <label htmlFor="tw-memory-correct-field">바르게 고친 문장</label>
                <textarea id="tw-memory-correct-field" value={draft} maxLength={MEMORY_CORRECTION_MAX} rows={3} autoFocus
                  onChange={event => setDraft(event.target.value)} />
                <div className="tw-memory-actions">
                  <button type="submit" aria-disabled={pending || undefined}>고친 내용 저장</button>
                  <button type="button" onClick={() => { setEditing(null); setError(''); refocus.current = true; }}>취소</button>
                </div>
              </form> : <div className="tw-memory-actions">
                <button type="button" aria-disabled={pending || undefined} aria-label={`고치기: ${item.text.slice(0, 40)}`}
                  onClick={() => { if (pending) return; setEditing(item.name); setDraft(item.text); setError(''); setNotice(''); }}>고치기</button>
              </div>}
            </li>)}</ul>
          </div>)}
      </section>}
      {view.other > 0 && <p className="tw-memory-note">목록에 없는 파일 {view.other}개는 폴더에서 직접 확인할 수 있어요.</p>}
      {view.entries.length === 0 ? <p className="tw-memory-note">아직 기억 파일이 없어요.</p>
        : <ul aria-label="AI 기억 파일">{view.entries.map(entry => <li key={entry.name}>
          <span className="tw-memory-name">{entry.name}</span>
          <time dateTime={new Date(entry.at).toISOString()}>{new Date(entry.at).toLocaleString('ko-KR')}</time>
          {entry.text === null ? <p className="tw-memory-note">파일이 크거나 글자가 아니어서 여기에서는 보여 주지 않아요. 열기로 확인해 주세요.</p>
            : <p className="tw-memory-text">{entry.text}</p>}
          <div className="tw-memory-actions">
            <button type="button" aria-disabled={pending || undefined} aria-label={`열기: ${entry.name}`} onClick={() => { if (!pending) act('open', entry.name); }}>열기</button>
            <button type="button" aria-disabled={pending || undefined} aria-label={`지우기: ${entry.name}`} onClick={() => { if (!pending) act('delete', entry.name); }}>지우기…</button>
          </div>
        </li>)}</ul>}
    </div>}
  </section>;
}
