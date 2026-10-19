import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ChatMessage, Citation } from '../../src/protocol';
import type { TaskWorkspaceView } from '../../src/taskWorkspaceContract';
import { onHostMessage, postToHost } from './vscode';
import { CitationPreview, CitationPreviewContext, SourceIcon, citationAddress } from './CitationPreview';
import { HeadingSlotContext } from './headingSlot';
export { useCitationPreview } from './CitationPreview';
import './taskWorkspace.css';

interface Props {
  view: TaskWorkspaceView;
  messages: ChatMessage[];
  busy: boolean;
  error: string | null;
  unsavedDraft?: boolean;
  onDismissError: () => void;
  children: ReactNode;
}

export function TaskWorkspaceFrame(props: Omit<Props, 'view'> & { view?: TaskWorkspaceView }) {
  return props.view ? <TaskWorkspace {...props} view={props.view} /> : <>{props.children}</>;
}

interface PreviewSelection { url: string; messageId?: string; scopeKey: string }
interface SourceRequest {
  requestId: string;
  url: string;
  taskId: string;
  scopeKey: string;
  phase: 'opening' | 'opened' | 'returning' | 'failed';
  trigger: HTMLElement | null;
  error?: string;
  returnRequested?: boolean;
}
// Correlate host replies; this identifier does not grant any source authority.
function sourceRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

interface ReadingPosition {
  scroller: HTMLElement;
  anchor?: HTMLElement;
  offset: number;
  scrollTop: number;
  scrollLeft: number;
  scopeKey: string;
}

/** The host owns persistence; this surface never treats browser storage as a transcript. */
export function TaskWorkspace({ view, messages, busy, error, unsavedDraft = false, onDismissError, children }: Props) {
  const [filter, setFilter] = useState('');
  const [railOpen, setRailOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewSelection | null>(null);
  const [headingSlot, setHeadingSlot] = useState<HTMLDivElement | null>(null);
  const [sourceRequest, setSourceRequest] = useState<SourceRequest | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState('');
  const renameButton = useRef<HTMLButtonElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const main = useRef<HTMLElement>(null);
  const rail = useRef<HTMLElement>(null);
  const sourcePanel = useRef<HTMLElement>(null);
  const sourceToggle = useRef<HTMLButtonElement>(null);
  const sourceTrigger = useRef<HTMLElement | null>(null);
  const requestRef = useRef<SourceRequest | null>(null);
  const requestTimer = useRef<ReturnType<typeof setTimeout>>();
  const readingPosition = useRef<ReadingPosition | null>(null);
  const pendingFocus = useRef<HTMLElement | 'source-title' | null>(null);
  const closingFocus = useRef<Element | null>(null);
  const [viewport, setViewport] = useState(() => window.innerWidth);
  const sourceDialog = sourcesOpen && viewport <= 1050;
  const railDialog = railOpen && viewport <= 700;
  const scopeKey = JSON.stringify([view.scope, view.activeTaskId]);
  const active = view.tasks.find(task => task.id === view.activeTaskId);
  const sources = useMemo(() => {
    const byUrl = new Map<string, Citation>();
    for (const message of messages) for (const source of message.citations ?? []) {
      if (citationAddress(source.url)) { byUrl.delete(source.url); byUrl.set(source.url, source); }
    }
    return [...byUrl.values()].reverse();
  }, [messages]);
  const current = useRef({ scopeKey, taskId: view.activeTaskId, sources });
  current.current = { scopeKey, taskId: view.activeTaskId, sources };
  const previewSourceValue = preview?.scopeKey === scopeKey
    ? (preview.messageId ? messages.find(message => message.id === preview.messageId)?.citations : sources)?.find(source => source.url === preview.url && citationAddress(source.url))
    : undefined;
  const pinnedSource = view.sourceSelection?.pinned ? sources.find(source => source.url === view.sourceSelection?.url) : undefined;
  const selected = previewSourceValue || pinnedSource || sources[0];
  const pinned = !!selected && pinnedSource?.url === selected.url;
  const request = sourceRequest?.scopeKey === scopeKey ? sourceRequest : null;
  const selectedRequest = request?.url === selected?.url ? request : null;
  const sourceDisplay = useRef({ open: sourcesOpen, url: selected?.url });
  sourceDisplay.current = { open: sourcesOpen, url: selected?.url };
  const blocked = busy || !!view.error;
  const visibleTasks = view.tasks.filter(task => task.title.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  const date = useMemo(() => new Intl.DateTimeFormat('ko', { month: 'short', day: 'numeric' }), []);

  const updateRequest = useCallback((next: SourceRequest | null) => {
    requestRef.current = next;
    setSourceRequest(next);
  }, []);
  const clearRequestTimer = useCallback(() => {
    if (requestTimer.current) clearTimeout(requestTimer.current);
    requestTimer.current = undefined;
  }, []);
  const rememberReadingPosition = useCallback((preferred?: HTMLElement | null) => {
    const scroller = main.current?.querySelector<HTMLElement>('.hps-messages');
    if (!scroller) return;
    const bounds = scroller.getBoundingClientRect(), top = bounds.top;
    const preferredBounds = preferred?.getBoundingClientRect();
    const anchor = preferred && scroller.contains(preferred) && preferredBounds && preferredBounds.bottom > top && preferredBounds.top < bounds.bottom
      ? preferred : [...scroller.querySelectorAll<HTMLElement>('.hps-msg')].find(element => element.getBoundingClientRect().bottom > top);
    readingPosition.current = { scroller, anchor, offset: anchor ? anchor.getBoundingClientRect().top - top : 0, scrollTop: scroller.scrollTop, scrollLeft: scroller.scrollLeft, scopeKey: current.current.scopeKey };
  }, []);
  const closeSources = useCallback((returnTo?: HTMLElement | null, restoreFocus = true) => {
    rememberReadingPosition(returnTo ?? sourceTrigger.current);
    pendingFocus.current = restoreFocus ? returnTo ?? sourceTrigger.current ?? sourceToggle.current : null;
    closingFocus.current = restoreFocus ? document.activeElement : null;
    setSourcesOpen(false);
    setPreview(null);
  }, [rememberReadingPosition]);
  const previewSource = useCallback((citation: Citation, trigger: HTMLElement, messageId?: string) => {
    const known = (messageId ? messages.find(message => message.id === messageId)?.citations : sources)?.some(source => source.url === citation.url && citationAddress(source.url));
    if (!known || view.error || !view.activeTaskId) return;
    rememberReadingPosition(trigger);
    sourceTrigger.current = trigger;
    pendingFocus.current = 'source-title';
    closingFocus.current = null;
    setPreview({ url: citation.url, messageId, scopeKey });
    setRailOpen(false);
    setSourcesOpen(true);
  }, [messages, sources, view.error, view.activeTaskId, scopeKey, rememberReadingPosition]);
  const awaitSourceResult = useCallback((requestId: string) => {
    clearRequestTimer();
    requestTimer.current = setTimeout(() => {
      const waiting = requestRef.current;
      if (!waiting || waiting.requestId !== requestId || waiting.scopeKey !== current.current.scopeKey) return;
      updateRequest({ ...waiting, phase: waiting.phase === 'returning' ? 'opened' : 'failed', error: '처리 결과를 확인하지 못했습니다. 다시 시도해 주세요.' });
    }, 15000);
  }, [clearRequestTimer, updateRequest]);
  const openSource = useCallback((url: string) => {
    const workspace = current.current;
    if (!workspace.taskId || view.error || !workspace.sources.some(source => source.url === url) || !citationAddress(url)) return;
    const waiting = requestRef.current;
    if (waiting && ['opening', 'returning'].includes(waiting.phase)) return;
    const next: SourceRequest = { requestId: sourceRequestId(), url, taskId: workspace.taskId, scopeKey: workspace.scopeKey, phase: 'opening', trigger: sourceTrigger.current ?? sourceToggle.current };
    updateRequest(next);
    awaitSourceResult(next.requestId);
    postToHost({ type: 'taskOpenSource', url, requestId: next.requestId, taskId: next.taskId });
  }, [view.error, updateRequest, awaitSourceResult]);
  const returnFromSource = () => {
    const opened = requestRef.current;
    if (!opened || opened.phase !== 'opened' || opened.scopeKey !== scopeKey || opened.url !== selected?.url) return;
    updateRequest({ ...opened, phase: 'returning', returnRequested: true, error: undefined });
    awaitSourceResult(opened.requestId);
    postToHost({ type: 'taskReturnFromSource', requestId: opened.requestId, url: opened.url, taskId: opened.taskId });
  };

  useEffect(() => onHostMessage(message => {
    if (message.type !== 'sourceOpenResult' && message.type !== 'sourceReturn') return;
    const pending = requestRef.current, workspace = current.current;
    if (!pending || pending.scopeKey !== workspace.scopeKey || pending.taskId !== workspace.taskId || message.taskId !== pending.taskId || message.requestId !== pending.requestId || message.url !== pending.url || !workspace.sources.some(source => source.url === pending.url)) return;
    if (message.type === 'sourceOpenResult') {
      if (typeof message.opened !== 'boolean' || pending.returnRequested && message.opened) return;
      clearRequestTimer();
      // A failed return does not undo the acknowledged browser tab or its retry binding.
      const returning = !!pending.returnRequested;
      const fallback = returning ? '대화로 돌아가지 못했습니다. 다시 시도해 주세요.' : '브라우저에서 출처를 열지 못했습니다. 다시 시도해 주세요.';
      updateRequest({ ...pending, phase: message.opened || returning ? 'opened' : 'failed', error: message.opened ? undefined : typeof message.error === 'string' && message.error.trim() ? message.error.slice(0, 500) : fallback });
    } else if (pending.returnRequested && (pending.phase === 'returning' || pending.phase === 'opened')) {
      clearRequestTimer();
      updateRequest(null);
      // A late acknowledgment must not take focus back from another source or the composer.
      if (sourceDisplay.current.open && sourceDisplay.current.url === pending.url && sourceTrigger.current === pending.trigger) {
        // Native editor reveal can temporarily clear window focus while retaining this request.
        const ownsFocus = document.activeElement === document.body || !!sourcePanel.current?.contains(document.activeElement);
        closeSources(pending.trigger, ownsFocus);
      }
    }
  }), [clearRequestTimer, updateRequest, closeSources]);
  useLayoutEffect(() => {
    clearRequestTimer();
    updateRequest(null);
    sourceTrigger.current = null;
    pendingFocus.current = null;
    closingFocus.current = null;
    readingPosition.current = null;
    setPreview(null);
    setSourcesOpen(false);
    setRenaming(false);
    setRailOpen(false);
  }, [scopeKey, clearRequestTimer, updateRequest]);
  useEffect(() => clearRequestTimer, [clearRequestTimer]);
  useEffect(() => {
    if (preview && !previewSourceValue) setPreview(null);
    if (request && !sources.some(source => source.url === request.url)) { clearRequestTimer(); updateRequest(null); }
  }, [preview, previewSourceValue, request, sources, clearRequestTimer, updateRequest]);
  useLayoutEffect(() => {
    const reading = readingPosition.current;
    readingPosition.current = null;
    if (reading?.scopeKey === scopeKey && reading.scroller.isConnected) {
      if (reading.anchor?.isConnected) reading.scroller.scrollTop += reading.anchor.getBoundingClientRect().top - reading.scroller.getBoundingClientRect().top - reading.offset;
      else reading.scroller.scrollTop = reading.scrollTop;
      reading.scroller.scrollLeft = reading.scrollLeft;
    }
    const focus = pendingFocus.current, origin = closingFocus.current;
    pendingFocus.current = null;
    closingFocus.current = null;
    const target = focus === 'source-title' ? (sourcePanel.current?.querySelector<HTMLElement>('#task-source-title') ?? sourcePanel.current?.querySelector<HTMLElement>('.tw-source-close')) : focus;
    if (target?.isConnected) requestAnimationFrame(() => {
      // Hiding a focused panel may move focus to BODY; a deliberate new target wins.
      const unchangedFocus = !origin || document.activeElement === origin || document.activeElement === document.body;
      if (target.isConnected && current.current.scopeKey === scopeKey && sourceDisplay.current.open === sourcesOpen && unchangedFocus) target.focus({ preventScroll: true });
    });
  }, [sourcesOpen, preview, scopeKey, sourceRequest?.requestId]);
  useEffect(() => { if (renaming) titleInput.current?.focus({ preventScroll: true }); }, [renaming]);
  useEffect(() => {
    const resize = () => setViewport(window.innerWidth);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  // Release inert before the queued focus restoration runs on the next animation frame.
  useLayoutEffect(() => {
    const dialog = sourceDialog ? sourcePanel.current : railDialog ? rail.current : null;
    if (!dialog) return;
    const restore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const mainWasInert = main.current?.inert ?? false;
    const railWasInert = rail.current?.inert ?? false;
    if (main.current) main.current.inert = true;
    if (rail.current && sourceDialog) rail.current.inert = true;
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]')].filter(element => element.getClientRects().length > 0);
    (focusable()[0] ?? dialog).focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (sourceDialog) closeSources(); else setRailOpen(false);
      } else if (event.key === 'Tab') {
        const items = focusable(), first = items[0], last = items.at(-1);
        if (!first || !last) { event.preventDefault(); dialog.focus({ preventScroll: true }); return; }
        const position = items.indexOf(document.activeElement as HTMLElement);
        if (position === -1 || event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) {
          event.preventDefault(); (event.shiftKey ? last : first).focus({ preventScroll: true });
        }
      }
    };
    dialog.addEventListener('keydown', key);
    return () => {
      dialog.removeEventListener('keydown', key);
      if (main.current) main.current.inert = mainWasInert;
      if (rail.current) rail.current.inert = railWasInert;
      if (!sourceDialog && restore?.isConnected) restore.focus({ preventScroll: true });
    };
  }, [sourceDialog, railDialog, closeSources]);
  const finishRename = () => {
    setRenaming(false);
    requestAnimationFrame(() => renameButton.current?.focus({ preventScroll: true }));
  };
  const toggleSources = () => {
    if (sourcesOpen) closeSources();
    else {
      rememberReadingPosition();
      sourceTrigger.current = sourceToggle.current;
      pendingFocus.current = 'source-title';
      closingFocus.current = null;
      setPreview(null);
      setSourcesOpen(true);
      setRailOpen(false);
    }
  };
  const revealRequestError = () => {
    if (!request) return;
    const citation = sources.find(source => source.url === request.url);
    const trigger = request.trigger?.isConnected ? request.trigger : sourceToggle.current;
    if (citation && trigger) previewSource(citation, trigger);
  };

  return <CitationPreviewContext.Provider value={{ previewSource, openSource, preview: sourcesOpen && previewSourceValue && preview ? { url: preview.url, messageId: preview.messageId } : null }}><div className="tw-workspace" data-sources-open={sourcesOpen} data-rail-open={railOpen} onKeyDown={event => {
    // Escape must work even in the frame before focus reaches the newly opened panel.
    if (sourcesOpen && event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); closeSources(); }
  }}>
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
      <p className="tw-local-note" role="status">{unsavedDraft ? '저장되지 않은 입력이 있습니다' : '이 기기에 보관됩니다'}</p>
    </nav>
    <section ref={main} className="tw-main" aria-label="작업 공간">
      <header className="tw-heading">
        <button className="tw-rail-toggle tw-quiet" aria-label={railOpen ? '작업 목록 닫기' : '작업 목록 열기'} aria-expanded={railOpen} onClick={() => { setRailOpen(!railOpen); setSourcesOpen(false); }}>☰</button>
        {renaming ? <form className="tw-rename" onSubmit={event => { event.preventDefault(); if (title.trim()) { postToHost({ type: 'taskRename', title: title.trim() }); finishRename(); } }}>
          <input ref={titleInput} aria-label="작업 이름" name="task-title" autoComplete="off" maxLength={100} value={title} onChange={event => setTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') finishRename(); }} />
          <button className="tw-quiet" disabled={!title.trim() || blocked}>저장</button><button type="button" className="tw-quiet" onClick={finishRename}>취소</button>
        </form> : <h1><button ref={renameButton} className="tw-title-button" title="작업 이름 바꾸기" disabled={blocked} onClick={() => { setTitle(active?.title ?? '새 작업'); setRenaming(true); }}>{active?.title ?? '작업 기록'}<span aria-hidden="true">⌄</span></button></h1>}
        <div ref={setHeadingSlot} className="tw-heading-slot" />
        <span className="tw-run-note" role="status" aria-live="polite" title={busy ? '멈춘 뒤 다른 작업으로 이동할 수 있습니다.' : undefined}>
          {busy && <>작업 중<span className="tw-run-help">입니다. 멈춘 뒤 다른 작업으로 이동할 수 있습니다.</span></>}
        </span>
        <button ref={sourceToggle} className="tw-quiet tw-sources-toggle" aria-expanded={sourcesOpen} aria-controls="task-sources" onClick={toggleSources}>자료{sources.length ? ` ${sources.length}` : ''}</button>
      </header>
      {(error || view.error) && <div className="tw-error" role="alert"><span>{view.error?.message || error}</span>{!view.error && (unsavedDraft
        ? <button className="tw-quiet" disabled={blocked} onClick={() => postToHost({ type: 'taskRecoverDraft' })}>새 작업에 보관</button>
        : <button className="tw-quiet" onClick={onDismissError}>알림 닫기</button>)}</div>}
      {request?.error && !sourcesOpen && <div className="cp-source-open-error" role="alert"><span>{request.error}</span><button type="button" className="tw-quiet" onClick={revealRequestError}>출처 확인</button></div>}
      <div id="task-conversation" className="tw-conversation" tabIndex={-1}><HeadingSlotContext.Provider value={headingSlot}>{children}</HeadingSlotContext.Provider></div>
    </section>
    {sourceDialog && <div className="tw-source-backdrop" aria-hidden="true" onMouseDown={event => event.preventDefault()} onClick={() => closeSources()} />}
    <aside ref={sourcePanel} id="task-sources" className="tw-sources" aria-label="작업 자료" role={sourceDialog ? 'dialog' : undefined} aria-modal={sourceDialog || undefined} tabIndex={-1} hidden={!sourcesOpen} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); closeSources(); } }}>
      <header><h2>작업 자료</h2><button type="button" className="tw-quiet tw-source-close" aria-label="자료 닫기" onClick={() => closeSources()}><SourceIcon kind="close" /></button></header>
      {request?.error && request.url !== selected?.url && <div className="cp-source-open-error" role="alert"><span>{request.error}</span><button type="button" className="tw-quiet" onClick={revealRequestError}>출처 확인</button></div>}
      {request?.phase === 'opening' && request.url !== selected?.url && <p className="cp-other-source-status" role="status">출처 여는 중: {citationAddress(request.url)?.hostname}</p>}
      {selected ? <>
        <CitationPreview citation={selected} pinned={pinned} otherPinned={!!pinnedSource && !pinned} ephemeral={!!previewSourceValue}
          opening={selectedRequest?.phase === 'opening'} blocked={request?.phase === 'opening' || request?.phase === 'returning'} opened={selectedRequest?.phase === 'opened' || selectedRequest?.phase === 'returning'} returning={selectedRequest?.phase === 'returning'} error={selectedRequest?.error}
          onOpen={() => openSource(selected.url)} onReturn={returnFromSource}
          onPin={() => postToHost({ type: 'taskSourceSelection', selection: { url: selected.url, pinned: !pinned } })} />
        <h3 className="tw-source-list-title">이 작업의 출처</h3>
        <ul className="tw-source-list">{sources.map(source => <li key={source.url}><button type="button" aria-pressed={selected.url === source.url} onClick={() => { setPreview({ url: source.url, scopeKey }); pendingFocus.current = 'source-title'; }}><span>{source.title || citationAddress(source.url)?.hostname}</span><small>{citationAddress(source.url)?.hostname}{pinnedSource?.url === source.url ? ' · 고정됨' : ''}</small></button></li>)}</ul>
      </> : <div className="tw-source-empty"><span aria-hidden="true"><SourceIcon kind="source" /></span><h3>출처를 모아 둘 자리</h3><p>대화에서 웹 자료를 찾으면 여기에서 다시 열 수 있습니다.</p></div>}
    </aside>
  </div></CitationPreviewContext.Provider>;
}
