import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ChatMessage } from '../../src/protocol';
import type { TaskWorkspaceView } from '../../src/taskWorkspaceContract';
import { postToHost } from './vscode';
import './taskWorkspace.css';

interface Props {
  view: TaskWorkspaceView;
  messages: ChatMessage[];
  busy: boolean;
  error: string | null;
  onDismissError: () => void;
  children: ReactNode;
}

export function TaskWorkspaceFrame(props: Omit<Props, 'view'> & { view?: TaskWorkspaceView }) {
  return props.view ? <TaskWorkspace {...props} view={props.view} /> : <>{props.children}</>;
}

/** The host owns persistence; this surface never treats browser storage as a transcript. */
export function TaskWorkspace({ view, messages, busy, error, onDismissError, children }: Props) {
  const [filter, setFilter] = useState('');
  const [railOpen, setRailOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState('');
  const renameButton = useRef<HTMLButtonElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const main = useRef<HTMLElement>(null);
  const rail = useRef<HTMLElement>(null);
  const sourcePanel = useRef<HTMLElement>(null);
  const sourceToggle = useRef<HTMLButtonElement>(null);
  const [viewport, setViewport] = useState(() => window.innerWidth);
  const sourceDialog = sourcesOpen && viewport <= 1050;
  const railDialog = railOpen && viewport <= 700;
  const active = view.tasks.find(task => task.id === view.activeTaskId);
  const sources = useMemo(() => {
    const byUrl = new Map<string, NonNullable<ChatMessage['citations']>[number]>();
    for (const message of messages) for (const source of message.citations ?? []) {
      if (/^https?:\/\//i.test(source.url)) byUrl.set(source.url, source);
    }
    return [...byUrl.values()].reverse();
  }, [messages]);
  const selected = (view.sourceSelection?.pinned && sources.find(s => s.url === view.sourceSelection?.url)) || sources[0];
  const blocked = busy || !!view.error;
  const visibleTasks = view.tasks.filter(task => task.title.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  const date = useMemo(() => new Intl.DateTimeFormat('ko', { month: 'short', day: 'numeric' }), []);

  useEffect(() => { setRenaming(false); setRailOpen(false); }, [view.activeTaskId]);
  useEffect(() => { if (renaming) titleInput.current?.focus(); }, [renaming]);
  useEffect(() => {
    const resize = () => setViewport(window.innerWidth);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    const dialog = sourceDialog ? sourcePanel.current : railDialog ? rail.current : null;
    if (!dialog) return;
    const restore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (main.current) main.current.inert = true;
    if (rail.current && sourceDialog) rail.current.inert = true;
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]')].filter(element => element.getClientRects().length > 0);
    (focusable()[0] ?? dialog).focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (sourceDialog) setSourcesOpen(false); else setRailOpen(false);
      } else if (event.key === 'Tab') {
        const items = focusable(), first = items[0], last = items.at(-1);
        if (!first || !last) { event.preventDefault(); dialog.focus(); return; }
        if (!dialog.contains(document.activeElement) || event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) {
          event.preventDefault(); (event.shiftKey ? last : first).focus();
        }
      }
    };
    dialog.addEventListener('keydown', key);
    return () => {
      dialog.removeEventListener('keydown', key);
      if (main.current) main.current.inert = false;
      if (rail.current) rail.current.inert = false;
      if (restore?.isConnected) restore.focus();
    };
  }, [sourceDialog, railDialog]);
  const finishRename = () => {
    setRenaming(false);
    requestAnimationFrame(() => renameButton.current?.focus());
  };
  const closeSources = () => { setSourcesOpen(false); requestAnimationFrame(() => sourceToggle.current?.focus()); };

  return <div className="tw-workspace" data-sources-open={sourcesOpen} data-rail-open={railOpen}>
    <a className="tw-skip" href="#task-conversation">대화로 바로 가기</a>
    <nav ref={rail} className="tw-rail" aria-label="내 작업" role={railDialog ? 'dialog' : undefined} aria-modal={railDialog || undefined} tabIndex={-1}>
      {railDialog && <button className="tw-quiet tw-rail-close" onClick={() => setRailOpen(false)}>작업 목록 닫기</button>}
      <div className="tw-brand"><span aria-hidden="true" className="tw-mark">h</span><span>HypeProof</span></div>
      <button className="tw-new" disabled={blocked} onClick={() => { setRailOpen(false); postToHost({ type: 'taskCreate' }); }}><span aria-hidden="true">＋</span> 새 작업</button>
      <label className="tw-search"><span>작업 찾기</span><input name="task-search" autoComplete="off" type="search" value={filter} onChange={event => setFilter(event.target.value)} placeholder="작업 이름으로 찾기…" /></label>
      <div className="tw-rail-heading">최근 작업 <span>{view.tasks.length}</span></div>
      <ul className="tw-task-list">
        {visibleTasks.map(task => <li key={task.id}>
          <button className="tw-task" aria-current={task.id === view.activeTaskId ? 'page' : undefined} disabled={blocked} onClick={() => { setRailOpen(false); if (task.id !== view.activeTaskId) postToHost({ type: 'taskSelect', id: task.id }); }}>
            <span className="tw-task-title">{task.title}</span>
            <span className="tw-task-meta"><span>{task.messageCount ? `대화 ${task.messageCount}` : '시작 전'}</span><time dateTime={new Date(task.updatedAt).toISOString()}>{date.format(task.updatedAt)}</time></span>
          </button>
        </li>)}
      </ul>
      {!visibleTasks.length && <p className="tw-empty-search">찾는 이름이 없습니다. 다른 이름으로 찾아보세요.</p>}
      <p className="tw-local-note">이 기기에 보관됩니다</p>
    </nav>
    <section ref={main} className="tw-main" aria-label="작업 공간">
      <header className="tw-heading">
        <button className="tw-rail-toggle tw-quiet" aria-label={railOpen ? '작업 목록 닫기' : '작업 목록 열기'} aria-expanded={railOpen} onClick={() => { setRailOpen(!railOpen); setSourcesOpen(false); }}>☰</button>
        {renaming ? <form className="tw-rename" onSubmit={event => { event.preventDefault(); if (title.trim()) { postToHost({ type: 'taskRename', title: title.trim() }); finishRename(); } }}>
          <input ref={titleInput} aria-label="작업 이름" name="task-title" autoComplete="off" maxLength={100} value={title} onChange={event => setTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') finishRename(); }} />
          <button className="tw-quiet" disabled={!title.trim() || blocked}>저장</button><button type="button" className="tw-quiet" onClick={finishRename}>취소</button>
        </form> : <h1><button ref={renameButton} className="tw-title-button" title="작업 이름 바꾸기" disabled={blocked} onClick={() => { setTitle(active?.title ?? '새 작업'); setRenaming(true); }}>{active?.title ?? '작업 기록'}<span aria-hidden="true">⌄</span></button></h1>}
        <button ref={sourceToggle} className="tw-quiet tw-sources-toggle" aria-expanded={sourcesOpen} aria-controls="task-sources" onClick={() => { setSourcesOpen(!sourcesOpen); setRailOpen(false); }}>자료{sources.length ? ` ${sources.length}` : ''}</button>
      </header>
      {(error || view.error) && <div className="tw-error" role="alert"><span>{view.error?.message || error}</span>{!view.error && <button className="tw-quiet" onClick={onDismissError}>알림 닫기</button>}</div>}
      {busy && <p className="tw-run-note" role="status">작업 중입니다. 멈춘 뒤 다른 작업으로 이동할 수 있습니다.</p>}
      <div id="task-conversation" className="tw-conversation" tabIndex={-1}>{children}</div>
    </section>
    <aside ref={sourcePanel} id="task-sources" className="tw-sources" aria-label="작업 자료" role={sourceDialog ? 'dialog' : undefined} aria-modal={sourceDialog || undefined} tabIndex={-1} hidden={!sourcesOpen} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); closeSources(); } }}>
      <header><h2>작업 자료</h2><button className="tw-quiet" aria-label="자료 닫기" onClick={closeSources}>×</button></header>
      {selected ? <>
        <div className="tw-source-detail">
          <div className="tw-source-domain">{selected.domain}</div><h3>{selected.title || selected.domain}</h3>
          <p>대화에 인용된 출처입니다. 열면 오른쪽 브라우저에서 확인할 수 있습니다.</p>
          <button className="tw-open-source" onClick={() => postToHost({ type: 'taskOpenSource', url: selected.url })}>브라우저에서 열기</button>
          <button className="tw-quiet tw-pin" aria-pressed={!!view.sourceSelection?.pinned} onClick={() => postToHost({ type: 'taskSourceSelection', selection: { url: selected.url, pinned: !view.sourceSelection?.pinned } })}>{view.sourceSelection?.pinned ? '고정 해제' : '이 자료 고정'}</button>
          <p className="tw-source-policy">{view.sourceSelection?.pinned ? '새 출처가 와도 이 자료를 유지합니다.' : '최근 출처를 따라갑니다.'}</p>
        </div>
        <h3 className="tw-source-list-title">이 작업의 출처</h3>
        <ul className="tw-source-list">{sources.map(source => <li key={source.url}><button aria-pressed={selected.url === source.url} onClick={() => postToHost({ type: 'taskSourceSelection', selection: { url: source.url, pinned: true } })}><span>{source.title || source.domain}</span><small>{source.domain}</small></button></li>)}</ul>
      </> : <div className="tw-source-empty"><span aria-hidden="true">↗</span><h3>출처를 모아 둘 자리</h3><p>대화에서 웹 자료를 찾으면 여기에서 다시 열 수 있습니다.</p></div>}
    </aside>
  </div>;
}
