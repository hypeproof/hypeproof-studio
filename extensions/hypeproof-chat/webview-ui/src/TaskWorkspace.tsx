import { citationKindLabel } from './citationKind';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import type { ChatMessage, Citation } from '../../src/protocol';
import type { TaskWorkspaceView } from '../../src/taskWorkspaceContract';
import type { TaskSearchPart, TaskSearchResult } from '../../src/taskSearch';
import { taskCountLine, taskRunAccessibleName, type TaskRunState } from '../../src/taskRunState';
import { onHostMessage, postToHost } from './vscode';
import { CitationPreview, CitationPreviewContext, SourceIcon, citationAddress } from './CitationPreview';
import { HeadingSlotContext } from './headingSlot';
import { ChatIcon } from './ChatDetails';
import { IntentChip } from './StatusChip';
import { TASK_RUN_CHIPS } from './statusChipLogic';
export { useCitationPreview } from './CitationPreview';
import './taskWorkspace.css';
import { imeComposing } from './imeGuard';
import { ActivityTrashPanel } from './ActivityTrashPanel';
import { actionable, returnFocus, returnFocusSoon, returnTarget, trapTab } from './dialogFocus';
import type { ArtifactProvenanceView } from '../../src/artifactProvenanceView';
import { KeyboardSplitter, SkipToInput } from './KeyboardNavigation';
import { loadPanelSizes, PANEL_LIMITS, savePanelSizes, type PanelName } from './panelSizes';
import { PanelBoundary } from './PanelBoundary';
import { filterTasksByTitle, TASK_SEARCH_MAX } from './taskTitleFilter';
import { offerUndo } from './UndoToast';
import { MaterialsPanel } from './MaterialsPanel';
import { ActivityHomeContext, HOME_VIEW_LABEL, HOME_VIEWS, loadHomeView, nextHomeView, saveHomeView, type HomeView } from './activityHome';
import { TaskAppearanceContext, TaskAppearanceDialog, TaskMark } from './TaskAppearance';
import { TaskMenu } from './TaskMenu';
import type { TaskMoveView } from '../../src/taskMove';

interface Props {
  view: TaskWorkspaceView;
  messages: ChatMessage[];
  busy: boolean;
  error: string | null;
  unsavedDraft?: boolean;
  unsavedHistory?: boolean;
  /** REQ-STUDIO-TASK-RUN-STATE — the active task's run state; inactive tasks never get one. */
  runState?: TaskRunState | null;
  onDismissError: () => void;
  /** CGP-KNOW-R-015 — set only where the seat may attach work-folder files: 이 파일에 대해 묻기 per listed file. */
  onAskAboutFile?: (path: string) => void;
  /** CGP-KNOW-R-002 — set where the seat has the activity's 자료 list (R-003's gate, never the instructor): the rail offers 작업/자료. */
  materials?: boolean;
  /** CGP-KNOW-R-009 — the host's move rule for this activity's tasks; absent → no task menu. */
  taskMove?: TaskMoveView;
  children: ReactNode;
}

export function TaskWorkspaceFrame(props: Omit<Props, 'view'> & { view?: TaskWorkspaceView }) {
  return <><SkipToInput />{props.view ? <TaskWorkspace {...props} view={props.view} /> : props.children}</>;
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

// Stable context values: a new object each render would re-render every consumer in the conversation.
const HOME_WITH_MATERIALS = { materialsHome: true }, HOME_WITHOUT_MATERIALS = { materialsHome: false };

/** CGP-CHAT-R-026 — the matched text is bold (a <strong>), never colour alone. */
function SearchParts({ parts }: { parts: TaskSearchPart[] }) {
  return <>{parts.map((part, index) => part.match ? <strong key={index}>{part.text}</strong> : <span key={index}>{part.text}</span>)}</>;
}

const SEARCH_PAUSE_MS = 150;

interface PendingReveal { taskId: string; messageId?: string; from: string | null }

interface ReadingPosition {
  scroller: HTMLElement;
  anchor?: HTMLElement;
  offset: number;
  scrollTop: number;
  scrollLeft: number;
  scopeKey: string;
}

/** The host owns persistence; this surface never treats browser storage as a transcript. */
export function TaskWorkspace({ view, messages, busy, error, unsavedDraft = false, unsavedHistory = false, runState = null, onDismissError, onAskAboutFile, materials = false, taskMove, children }: Props) {
  // REQ-STUDIO-TASK-RAIL-SEARCH: `text` is what the field shows, `applied` the committed query the list
  // filters by. An open IME composition (a half-built Hangul syllable) never filters; the commit does.
  // Both belong to one activity: a different scope starts with an empty search.
  const [search, setSearch] = useState({ scope: view.scope, text: '', applied: '' });
  const railSearch = search.scope === view.scope ? search : { scope: view.scope, text: '', applied: '' };
  // CGP-KNOW-R-002: the activity home's view, remembered per seat. Switching posts nothing and leaves the
  // conversation (and so the composer draft) mounted. A seat without the 자료 list always shows 작업.
  const [homeChoice, setHomeChoice] = useState(() => ({ scope: view.scope, value: loadHomeView(view.scope) }));
  const homeView: HomeView = !materials ? 'tasks' : homeChoice.scope === view.scope ? homeChoice.value : loadHomeView(view.scope);
  const homeTabs = useRef<HTMLDivElement>(null);
  const chooseHome = (next: HomeView, focus = false) => {
    setHomeChoice({ scope: view.scope, value: next });
    saveHomeView(view.scope, next);
    if (focus) homeTabs.current?.querySelector<HTMLElement>(`#tw-home-tab-${next}`)?.focus();
  };
  // CGP-CHAT-R-026 — on top of the local title filter, a committed query also asks the host to search
  // message text in the task files on this device. `results` null = the host could not read the task file.
  const [hostSearch, setHostSearch] = useState<{ scope: string; results: TaskSearchResult[] | null } | null>(null);
  const searchRequest = useRef<{ requestId: string; scope: string } | null>(null);
  const pendingReveal = useRef<PendingReveal | null>(null);
  const [revealTick, setRevealTick] = useState(0);
  // CGP-KNOW-R-009 — at most one task menu is open; a move is bound to its request id.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [moveStatus, setMoveStatus] = useState('');
  const moveRequest = useRef<string | null>(null);
  // CGP-SHELL-R-012: a size is the user's own choice, remembered per seat; until then the design-token width applies.
  const workspaceEl = useRef<HTMLDivElement>(null);
  const [panelSizes, setPanelSizes] = useState(() => ({ scope: view.scope, sizes: loadPanelSizes(view.scope) }));
  const [tokenWidths, setTokenWidths] = useState<Partial<Record<PanelName, number>>>({});
  const sizes = panelSizes.scope === view.scope ? panelSizes.sizes : loadPanelSizes(view.scope);
  const resizePanel = (panel: PanelName, value: number) => {
    const next = { ...sizes, [panel]: value };
    setPanelSizes({ scope: view.scope, sizes: next });
    savePanelSizes(view.scope, next);
  };
  const [railOpen, setRailOpen] = useState(false);
  // CGP-CHAT-R-025 — 보관함 is a separate view of the task list, inside the same rail.
  const [archiveOpen, setArchiveOpen] = useState(false);
  const archiveToggle = useRef<HTMLButtonElement>(null);
  const archiveHeading = useRef<HTMLHeadingElement>(null);
  const archiveFocus = useRef<'heading' | 'toggle' | null>(null);
  /** The task 다시 열기 asked for; focus follows it only if that task really opened. */
  const reopenPending = useRef<string | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  // REQ-STUDIO-ARTIFACT-PROVENANCE — undefined until the host answers for this scope.
  const [artifacts, setArtifacts] = useState<ArtifactProvenanceView | null | undefined>(undefined);
  const [preview, setPreview] = useState<PreviewSelection | null>(null);
  const [headingSlot, setHeadingSlot] = useState<HTMLDivElement | null>(null);
  const [sourceRequest, setSourceRequest] = useState<SourceRequest | null>(null);
  const [renaming, setRenaming] = useState(false);
  // CGP-KNOW-R-008 — the scope the appearance picker was opened in; a task switch closes it.
  const [appearanceScope, setAppearanceScope] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [renamePending, setRenamePending] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const renameRequest = useRef<{ id: string; scopeKey: string; taskId: string | null; title: string } | null>(null);
  const renameForm = useRef<HTMLFormElement>(null);
  const renameButton = useRef<HTMLButtonElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const currentTitle = useRef<string | undefined>(undefined);
  const main = useRef<HTMLElement>(null);
  const conversation = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLElement>(null);
  const sourcePanel = useRef<HTMLElement>(null);
  const sourceToggle = useRef<HTMLButtonElement>(null);
  const railToggle = useRef<HTMLButtonElement>(null);
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
  currentTitle.current = active?.title;
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
  const visibleTasks = useMemo(() => filterTasksByTitle(view.tasks, railSearch.applied), [view.tasks, railSearch.applied]);
  const searching = railSearch.applied.trim() !== '';
  const archivedTasks = view.archived ?? [];
  const visibleArchived = useMemo(() => filterTasksByTitle(archivedTasks, railSearch.applied), [archivedTasks, railSearch.applied]);
  // CGP-CHAT-R-025 — say where the task went when 보관하기 replaced it with another one. Bound to the
  // scope it was archived from and cleared by the next task change.
  const [archiveNote, setArchiveNote] = useState<{ title: string; scopeKey: string } | null>(null);
  const lastOpen = useRef({ scope: view.scope, taskId: view.activeTaskId });
  useEffect(() => {
    const before = lastOpen.current;
    lastOpen.current = { scope: view.scope, taskId: view.activeTaskId };
    if (before.scope !== view.scope || before.taskId === view.activeTaskId) return;
    const moved = before.taskId ? view.archived?.find(task => task.id === before.taskId) : undefined;
    setArchiveNote(moved ? { title: moved.title, scopeKey } : null);
  }, [view, scopeKey]);
  const openArchive = (open: boolean) => {
    archiveFocus.current = open ? 'heading' : 'toggle';
    setArchiveOpen(open);
  };
  useLayoutEffect(() => {
    const target = archiveFocus.current === 'heading' ? archiveHeading.current : archiveFocus.current === 'toggle' ? archiveToggle.current : null;
    archiveFocus.current = null;
    target?.focus({ preventScroll: true });
  }, [archiveOpen]);
  useLayoutEffect(() => {
    if (!reopenPending.current || reopenPending.current !== view.activeTaskId || archiveOpen) return;
    reopenPending.current = null;
    // REQ-STUDIO-FOCUS-RESTORE: the reopened task's row, else the composer, never <body>.
    returnFocus(() => rail.current?.querySelector<HTMLElement>('.tw-task[aria-current="page"]') ?? null);
  }, [view.activeTaskId, archiveOpen]);
  // The last answer stays on screen while a newer query or a saved turn is asked again, so the list does not blink.
  const answered = searching && hostSearch?.scope === view.scope ? hostSearch : null;
  // Owner reconciliation (KNOW-R-001 x CHAT-R-026): a task already listed by title is never listed again,
  // and a host answer that matched only the name adds nothing to the title list.
  const messageResults = useMemo(() => {
    if (!answered?.results) return [];
    const byTitle = new Set(visibleTasks.map(task => task.id));
    return answered.results.filter(result => result.messageId && !byTitle.has(result.taskId));
  }, [answered, visibleTasks]);
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
    renameRequest.current = null;
    setRenamePending(null);
    setRenameError(null);
    setRailOpen(false);
    setArchiveOpen(false);
    setAppearanceScope(null);
    setMenuFor(null);
  }, [scopeKey, clearRequestTimer, updateRequest]);
  useEffect(() => clearRequestTimer, [clearRequestTimer]);
  useEffect(() => onHostMessage(message => { if (message.type === 'artifactProvenance') setArtifacts(message.view); }), []);
  // A newer query, task change or saved turn asks again; only the latest request's answer is shown.
  useEffect(() => {
    // Only the committed query asks (an open IME composition never changes `applied`), and a blank one never does.
    const query = railSearch.applied;
    if (!query.trim()) { searchRequest.current = null; setHostSearch(null); return; }
    const request = { requestId: sourceRequestId(), scope: view.scope };
    searchRequest.current = request;
    // Typing asks once it pauses; the host scans every task, and it also runs the live turn.
    const timer = setTimeout(() => postToHost({ type: 'taskSearch', query, requestId: request.requestId }), SEARCH_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [railSearch.applied, view.scope, view.revision]);
  useEffect(() => onHostMessage(message => {
    if (message.type !== 'taskSearchResult') return;
    const waiting = searchRequest.current;
    if (!waiting || message.requestId !== waiting.requestId || message.scope !== waiting.scope || (message.results !== null && !Array.isArray(message.results))) return;
    setHostSearch({ scope: waiting.scope, results: message.results });
  }), []);
  // A refused or failed switch leaves the learner where they were: drop the jump so a later, unrelated
  // opening of that task does not scroll.
  useEffect(() => onHostMessage(message => { if (message.type === 'taskWorkspaceError' && message.error) pendingReveal.current = null; }), []);
  // CGP-CHAT-R-026 — opening a result scrolls the transcript to the matched message once it is on screen.
  useLayoutEffect(() => {
    const pending = pendingReveal.current;
    if (!pending) return;
    if (view.activeTaskId !== pending.taskId) {
      // The switch failed or another task was chosen: never jump later in an unrelated view.
      if (view.activeTaskId !== pending.from) pendingReveal.current = null;
      return;
    }
    if (!pending.messageId) { pendingReveal.current = null; return; }
    if (!messages.some(message => message.id === pending.messageId)) return;
    pendingReveal.current = null;
    const row = conversation.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(pending.messageId)}"]`);
    const scroller = row?.closest<HTMLElement>('.hps-messages');
    if (!row || !scroller) return;
    scroller.scrollTop += row.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    // Tell the transcript the reader moved now, so following the latest message cannot pull it back.
    scroller.dispatchEvent(new Event('scroll'));
  }, [messages, view.activeTaskId, revealTick]);
  useEffect(() => { setArtifacts(undefined); }, [scopeKey]);
  // Each opening asks again: the host rescans the folder when no turn runs.
  useEffect(() => { if (sourcesOpen) postToHost({ type: 'artifactProvenanceRequest' }); }, [sourcesOpen, scopeKey]);
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
    // REQ-STUDIO-FOCUS-RESTORE: closing returns to the opener (a citation or 자료); an opener that
    // is gone falls back to 자료, then the composer.
    const target = focus === 'source-title' ? (sourcePanel.current?.querySelector<HTMLElement>('#task-source-title') ?? sourcePanel.current?.querySelector<HTMLElement>('.tw-source-close')) : focus ? returnTarget(focus, sourceToggle.current) : null;
    const focusOrigin = origin ?? document.activeElement;
    if (target?.isConnected) requestAnimationFrame(() => {
      // Both opening and closing yield to a newer editing target while the frame waits.
      // Hiding a focused panel may legitimately move focus to BODY.
      const unchangedFocus = document.activeElement === focusOrigin || document.activeElement === document.body;
      if (target.isConnected && current.current.scopeKey === scopeKey && sourceDisplay.current.open === sourcesOpen && unchangedFocus) target.focus({ preventScroll: true });
    });
  }, [sourcesOpen, preview, scopeKey, sourceRequest?.requestId]);
  useLayoutEffect(() => {
    const style = workspaceEl.current ? getComputedStyle(workspaceEl.current) : null;
    const read = (name: string, panel: PanelName) => { const px = parseFloat(style?.getPropertyValue(name) ?? ''); return Number.isFinite(px) ? px : PANEL_LIMITS[panel].min; };
    setTokenWidths({ rail: read('--tw-rail-default', 'rail'), sources: read('--tw-source-default', 'sources') });
  }, []);
  useEffect(() => { if (renaming) titleInput.current?.focus({ preventScroll: true }); }, [renaming]);
  useEffect(() => {
    const resize = () => {
      const focused = document.activeElement;
      if (window.innerWidth <= 700 && focused?.classList.contains('tw-splitter-rail')) railToggle.current?.focus();
      setViewport(window.innerWidth);
    };
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
    (actionable(dialog)[0] ?? dialog).focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      // CGP-DS-R-027: a native listener sees composer keys too; composition keys belong to the IME.
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (sourceDialog) closeSources(); else setRailOpen(false);
      } else trapTab(event, dialog);
    };
    // The phone-width task list has no backdrop: a press outside it (on the inert page) closes it.
    const outside = (event: PointerEvent) => { if (!sourceDialog && event.target instanceof Node && !dialog.contains(event.target)) setRailOpen(false); };
    dialog.addEventListener('keydown', key);
    document.addEventListener('pointerdown', outside);
    return () => {
      dialog.removeEventListener('keydown', key);
      document.removeEventListener('pointerdown', outside);
      if (main.current) main.current.inert = mainWasInert;
      if (rail.current) rail.current.inert = railWasInert;
      if (!sourceDialog) returnFocusSoon(dialog, restore, railToggle.current);
    };
  }, [sourceDialog, railDialog, closeSources]);
  const restoreRenameFocus = (target: () => HTMLElement | null) => {
    const origin = document.activeElement;
    if (!origin || !renameForm.current?.contains(origin)) return;
    const owner = current.current.scopeKey;
    requestAnimationFrame(() => {
      // A delayed result must not interrupt typing or a later task/panel choice.
      if (current.current.scopeKey !== owner || (document.activeElement !== origin && document.activeElement !== document.body)) return;
      // REQ-STUDIO-FOCUS-RESTORE: the title, else the composer, never <body>.
      returnFocus(target);
    });
  };
  const finishRename = () => {
    restoreRenameFocus(() => renameButton.current);
    renameRequest.current = null;
    setRenamePending(null);
    setRenameError(null);
    setRenaming(false);
  };
  useEffect(() => onHostMessage(message => {
    if (message.type !== 'taskMoveResult' || message.requestId !== moveRequest.current) return;
    moveRequest.current = null;
    setMoveStatus(message.moved && message.title && message.destination ? `‘${message.title}’ 작업을 ‘${message.destination}’ 활동으로 옮겼어요. 그 활동을 열면 이어서 할 수 있어요.` : '');
    // The moved row is gone (or, on failure, focus would otherwise stay on <body>): land on the open task.
    const target = rail.current?.querySelector<HTMLElement>('.tw-task[aria-current="page"]') ?? rail.current;
    requestAnimationFrame(() => { if (!document.activeElement || document.activeElement === document.body) target?.focus({ preventScroll: true }); });
  }), []);
  useEffect(() => { if (blocked) setMenuFor(null); }, [blocked]);
  const moveTask = (taskId: string, destination: string) => {
    if (blocked || moveRequest.current) return;
    const requestId = sourceRequestId();
    moveRequest.current = requestId;
    setMoveStatus('');
    postToHost({ type: 'taskMove', id: taskId, destination, requestId });
    // A lost reply must not block later moves; the host answers well within this.
    setTimeout(() => { if (moveRequest.current === requestId) moveRequest.current = null; }, 20000);
  };
  useEffect(() => onHostMessage(message => {
    if (message.type !== 'taskRenameResult') return;
    const pending = renameRequest.current;
    if (!pending || pending.id !== message.requestId || pending.scopeKey !== current.current.scopeKey) return;
    renameRequest.current = null;
    setRenamePending(null);
    if (message.saved) {
      finishRename();
      // CGP-CHAT-R-029 — a rename offers 되돌리기; the host puts back the exact prior title it kept.
      const undoId = message.undoId;
      if (undoId) offerUndo({
        kind: 'rename', scope: { taskId: pending.taskId }, hostUndoId: undoId,
        undo: () => postToHost({ type: 'taskRenameUndo', undoId }),
        stillValid: () => current.current.taskId === pending.taskId && currentTitle.current === pending.title,
        focusAfter: () => renameButton.current,
      });
    }
    else {
      setRenameError('이름을 저장하지 못했습니다. 입력한 이름으로 다시 시도해 주세요.');
      restoreRenameFocus(() => titleInput.current);
    }
  }), []);
  useEffect(() => {
    if (!renamePending) return;
    const timer = setTimeout(() => {
      if (renameRequest.current?.id !== renamePending) return;
      renameRequest.current = null;
      setRenamePending(null);
      setRenameError('저장 결과를 확인하지 못했습니다. 입력한 이름은 유지됩니다. 다시 시도해 주세요.');
    }, 15000);
    return () => clearTimeout(timer);
  }, [renamePending]);
  const submitRename = () => {
    if (!title.trim() || blocked || renameRequest.current) return;
    const id = sourceRequestId();
    renameRequest.current = { id, scopeKey, taskId: view.activeTaskId, title: title.trim() };
    setRenamePending(id);
    setRenameError(null);
    onDismissError();
    postToHost({ type: 'taskRename', title: title.trim(), requestId: id });
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

  return <CitationPreviewContext.Provider value={{ previewSource, openSource, preview: sourcesOpen && previewSourceValue && preview ? { url: preview.url, messageId: preview.messageId } : null }}><div ref={workspaceEl} className="tw-workspace" style={{ '--tw-rail-width': sizes.rail ? `${sizes.rail}px` : undefined, '--tw-source-width': sizes.sources ? `${sizes.sources}px` : undefined } as CSSProperties} data-sources-open={sourcesOpen} data-rail-open={railOpen} onKeyDown={event => {
    // D019: a local current-conversation shortcut, never a claim to navigate native approvals.
    if (event.code === 'KeyJ' && event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.repeat && !event.defaultPrevented && !imeComposing(event) && !(event.target as HTMLElement).closest?.('dialog[open], [aria-modal="true"]')) {
      event.preventDefault();
      conversation.current?.focus();
      return;
    }
    // Escape must work even in the frame before focus reaches the newly opened panel.
    if (sourcesOpen && event.key === 'Escape' && !event.defaultPrevented && !imeComposing(event)) {
      event.preventDefault();
      event.stopPropagation();
      // A nonmodal panel does not own focus after the user resumes editing elsewhere.
      const active = document.activeElement;
      const panelOwnsFocus = active === document.body || !!sourcePanel.current?.contains(active);
      closeSources(undefined, panelOwnsFocus);
    }
  }}>
    <a className="tw-skip" href="#task-conversation" data-hp-tooltip="대화로 바로 가기 (Alt+Shift+J 또는 Enter)" aria-keyshortcuts="Alt+Shift+J" onClick={event => { event.preventDefault(); conversation.current?.focus(); }}>대화로 바로 가기</a>
    <nav id="task-rail" ref={rail} className="tw-rail" aria-label="내 작업" role={railDialog ? 'dialog' : undefined} aria-modal={railDialog || undefined} tabIndex={-1}>
      {railDialog && <button className="tw-quiet tw-rail-close" onClick={() => setRailOpen(false)}>작업 목록 닫기</button>}
      <div className="tw-brand"><span aria-hidden="true" className="tw-mark">h</span><span>HypeProof</span></div>
      {/* CGP-KNOW-R-002 — 작업/자료: one tab stop, arrow keys move between the two views (automatic activation). */}
      {materials && <div ref={homeTabs} className="tw-home-tabs" role="tablist" aria-label="활동 보기" onKeyDown={event => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented || imeComposing(event)) return;
        const next = nextHomeView(homeView, event.key);
        if (!next) return;
        event.preventDefault();
        chooseHome(next, true);
      }}>
        {HOME_VIEWS.map(option => <button key={option} type="button" role="tab" id={`tw-home-tab-${option}`} className="tw-home-tab" aria-selected={homeView === option} aria-controls={`tw-home-${option}`} tabIndex={homeView === option ? 0 : -1} onClick={() => chooseHome(option)}>{HOME_VIEW_LABEL[option]}</button>)}
      </div>}
      <div id="tw-home-tasks" className="tw-home-panel" role={materials ? 'tabpanel' : undefined} aria-labelledby={materials ? 'tw-home-tab-tasks' : undefined} hidden={homeView !== 'tasks'}>
      <button className="tw-new" disabled={blocked} onClick={() => { setRailOpen(false); postToHost({ type: 'taskCreate' }); }}><span aria-hidden="true">＋</span> 새 작업</button>
      <label className="tw-search"><span>작업 찾기</span><input name="task-search" autoComplete="off" type="search" maxLength={TASK_SEARCH_MAX} value={railSearch.text} onChange={event => {
        const text = event.target.value;
        const composing = (event.nativeEvent as InputEvent).isComposing === true;
        setSearch({ scope: view.scope, text, applied: composing ? railSearch.applied : text });
      }} onCompositionEnd={event => { const text = event.currentTarget.value; setSearch({ scope: view.scope, text, applied: text }); }} placeholder="작업 이름이나 대화 내용으로 찾기…" /></label>
      {/* CGP-SHELL-R-013 — the task list fails alone; 새 작업, search and the chat keep working. */}
      <PanelBoundary panel="task-rail">{() => archiveOpen ? <>
      {/* CGP-CHAT-R-025 — archived tasks keep their whole conversation; 다시 열기 lists and opens one. Nothing here deletes. */}
      <div className="tw-rail-heading tw-archive-heading"><h2 ref={archiveHeading} tabIndex={-1}>보관함</h2><span>{archivedTasks.length}</span></div>
      <button type="button" className="tw-quiet tw-archive-back" onClick={() => openArchive(false)}>최근 작업으로 돌아가기</button>
      <ul className="tw-task-list tw-archive-list" aria-label="보관한 작업">
        {visibleArchived.map(task => <li key={task.id} className="tw-archived">
          <span className="tw-task-title"><TaskMark appearance={task.appearance} />{task.title}</span>
          <span className="tw-task-meta"><span>{taskCountLine(task.messageCount, null)}</span><time dateTime={new Date(task.archivedAt).toISOString()}>{date.format(task.archivedAt)} 보관</time></span>
          <button type="button" className="tw-quiet tw-reopen" aria-label={`다시 열기: ${task.title}`} disabled={blocked} onClick={() => { reopenPending.current = task.id; setRailOpen(false); postToHost({ type: 'taskRestore', id: task.id }); }}>다시 열기</button>
        </li>)}
      </ul>
      {!visibleArchived.length && <p className="tw-empty-search">{archivedTasks.length ? '찾는 이름이 없습니다. 다른 이름으로 찾아보세요.' : '보관한 작업이 없어요.'}</p>}
      </> : <>
      <div className="tw-rail-heading">최근 작업 <span>{view.tasks.length}</span></div>
      {/* The list grows to fill the rail, so the no-match line sits above it, next to the field. */}
      {/* The polite live region stays mounted so a screen reader announces the line when it appears. */}
      <div role="status" aria-live="polite">{searching && !visibleTasks.length && <p className="tw-empty-search">찾는 이름이 없습니다. 다른 이름으로 찾아보세요.</p>}</div>
      <ul className="tw-task-list">
        {visibleTasks.map(task => {
          // Only the active task has a run state: tasks never run concurrently, and a stored transcript cannot tell how it ended.
          const state = task.id === view.activeTaskId ? runState : null;
          const metaId = `tw-task-meta-${task.id}`;
          return <li key={task.id} className={taskMove ? 'tw-task-row' : undefined}>
          <button className="tw-task" aria-current={task.id === view.activeTaskId ? 'page' : undefined} aria-label={taskRunAccessibleName(task.title, state)} aria-describedby={state ? metaId : undefined} disabled={blocked} onClick={() => { setRailOpen(false); if (task.id !== view.activeTaskId || error) postToHost({ type: 'taskSelect', id: task.id }); }}>
            <span className="tw-task-title"><TaskMark appearance={task.appearance} />{task.title}</span>
            {state && <IntentChip chip={TASK_RUN_CHIPS[state]} status={state} className="tw-task-state" attrs={{ 'data-run-state': state }} />}
            <span id={metaId} className="tw-task-meta"><span>{taskCountLine(task.messageCount, state)}</span><time dateTime={new Date(task.updatedAt).toISOString()}>{date.format(task.updatedAt)}</time></span>
          </button>
          {taskMove && <TaskMenu title={task.title} move={taskMove} open={menuFor === task.id} disabled={blocked} onOpenChange={open => setMenuFor(open ? task.id : null)} onMove={destination => moveTask(task.id, destination)} />}
        </li>;
        })}
      </ul>
      {archivedTasks.length > 0 && <button ref={archiveToggle} type="button" className="tw-quiet tw-archive-open" onClick={() => openArchive(true)}>보관함 <span>{archivedTasks.length}</span></button>}
      {/* CGP-CHAT-R-026 — tasks that match only in message text, under the filtered title list. */}
      {answered && (answered.results === null || messageResults.length > 0 || !visibleTasks.length) && <div className="tw-search-group">
      <div className="tw-rail-heading">찾은 대화 <span>{answered.results ? messageResults.length : ''}</span></div>
      {answered.results === null && <p className="tw-empty-search" role="status">작업 기록을 읽지 못해 지금은 찾을 수 없어요</p>}
      {messageResults.length > 0 && <ul className="tw-task-list tw-search-results" aria-label="찾은 대화">
        {messageResults.map(result => <li key={result.taskId}>
          <button className="tw-task tw-search-result" aria-current={result.taskId === view.activeTaskId ? 'page' : undefined}
            disabled={blocked && result.taskId !== view.activeTaskId} data-task-id={result.taskId}
            onClick={() => {
              setRailOpen(false);
              pendingReveal.current = { taskId: result.taskId, messageId: result.messageId, from: view.activeTaskId };
              if (result.taskId !== view.activeTaskId || error) postToHost({ type: 'taskSelect', id: result.taskId });
              setRevealTick(tick => tick + 1);
            }}>
            <span className="tw-task-title"><SearchParts parts={result.title} /></span>
            {result.snippet.length > 0 && <span className="tw-task-snippet"><SearchParts parts={result.snippet} /></span>}
            <span className="tw-task-meta"><span>대화에서 찾음</span><time dateTime={new Date(result.at).toISOString()}>{date.format(result.at)}</time></span>
          </button>
        </li>)}
      </ul>}
      {answered.results !== null && !messageResults.length && <p className="tw-empty-search" role="status">찾는 대화가 없어요</p>}
      </div>}
      </>}</PanelBoundary>
      </div>
      {materials && <div id="tw-home-materials" className="tw-home-panel tw-home-materials" role="tabpanel" aria-labelledby="tw-home-tab-materials" hidden={homeView !== 'materials'}>
        {/* Mounted only while chosen: the list asks the host once per opening. */}
        {homeView === 'materials' && <PanelBoundary panel="activity-home-materials"><MaterialsPanel home /></PanelBoundary>}
      </div>}
      {taskMove && <p className="tw-move-status" role="status" aria-live="polite">{moveStatus}</p>}
      <p className="tw-local-note" role="status">{unsavedHistory ? '저장되지 않은 대화가 있습니다' : unsavedDraft ? '저장되지 않은 입력이 있습니다' : '이 기기에 보관됩니다'}</p>
    </nav>
    {viewport > 700 && <KeyboardSplitter panel="rail" label="작업 목록 너비 조절" controls="task-rail" value={sizes.rail ?? tokenWidths.rail ?? PANEL_LIMITS.rail.min} onChange={value => resizePanel('rail', value)} />}
    <section ref={main} className="tw-main" aria-label="작업 공간">
      <header className="tw-heading">
        <button ref={railToggle} className="tw-rail-toggle tw-quiet" aria-label={railOpen ? '작업 목록 닫기' : '작업 목록 열기'} aria-expanded={railOpen} onClick={() => { setRailOpen(!railOpen); setSourcesOpen(false); }}><ChatIcon kind="menu" size={20} /></button>
        {renaming ? <form ref={renameForm} className="tw-rename" onSubmit={event => { event.preventDefault(); submitRename(); }}>
          <input ref={titleInput} aria-label="작업 이름" name="task-title" autoComplete="off" maxLength={100} readOnly={!!renamePending} aria-describedby={renameError ? 'task-rename-error' : undefined} value={title} onChange={event => setTitle(event.target.value)} onKeyDown={event => {
            // IME confirmation must not trigger the form's implicit submit.
            if (imeComposing(event)) {
              if (event.key === 'Enter') event.preventDefault();
              return;
            }
            if (event.key === 'Escape') finishRename();
          }} />
          <button className="tw-quiet" disabled={!title.trim() || blocked || !!renamePending} aria-busy={!!renamePending}>{renamePending ? '저장 중…' : '저장'}</button><button type="button" className="tw-quiet" onClick={finishRename}>취소</button>
        </form> : <h1><button ref={renameButton} className="tw-title-button" data-hp-tooltip={`작업 이름 바꾸기: ${active?.title ?? '작업 기록'}`} disabled={blocked} onClick={() => { setTitle(active?.title ?? '새 작업'); setRenaming(true); }}>{active?.title ?? '작업 기록'}<span aria-hidden="true">⌄</span></button></h1>}
        <div ref={setHeadingSlot} className="tw-heading-slot" />
        <span className="tw-run-note" role="status" aria-live="polite" data-hp-tooltip={busy ? (runState === 'approval' ? '화면에 뜬 확인 창에서 골라 주세요.' : '멈춘 뒤 다른 작업으로 이동할 수 있습니다.') : undefined}>
          {/* CGP-DS-R-006: the heading's run state is the same intent chip as the rail's; the help sentence stays for screen readers. */}
          {busy && (runState === 'approval'
            ? <><IntentChip chip={TASK_RUN_CHIPS.approval} status="approval" className="tw-run-chip" /><span className="tw-run-help">입니다. 화면에 뜬 확인 창에서 골라 주세요.</span></>
            : <><IntentChip chip={TASK_RUN_CHIPS.running} status="running" className="tw-run-chip" /><span className="tw-run-help">입니다. 멈춘 뒤 다른 작업으로 이동할 수 있습니다.</span></>)}
        </span>
        <button ref={sourceToggle} className="tw-quiet tw-sources-toggle" aria-expanded={sourcesOpen} aria-controls="task-sources" onClick={toggleSources}>자료{sources.length ? ` ${sources.length}` : ''}</button>
      </header>
      {renaming && renameError && <div id="task-rename-error" className="tw-error" role="alert">{renameError}</div>}
      {(error || view.error) && <div className="tw-error" role="alert"><span>{view.error?.message || error}</span>{!view.error && (unsavedHistory
        ? <button className="tw-quiet" disabled={blocked} onClick={() => postToHost({ type: 'taskSelect', id: view.activeTaskId! })}>대화 저장 다시 시도</button>
        : unsavedDraft
        ? <button className="tw-quiet" disabled={blocked} onClick={() => postToHost({ type: 'taskRecoverDraft' })}>새 작업에 보관</button>
        : <button className="tw-quiet" onClick={onDismissError}>알림 닫기</button>)}</div>}
      {archiveNote?.scopeKey === scopeKey && <p className="tw-archive-note" role="status">‘{archiveNote.title}’ 작업을 보관함에 넣었어요. 대화는 그대로 있고, 작업 목록의 보관함에서 다시 열 수 있어요.</p>}
      {request?.error && !sourcesOpen && <div className="cp-source-open-error" role="alert"><span>{request.error}</span><button type="button" className="tw-quiet" onClick={revealRequestError}>출처 확인</button></div>}
      <div ref={conversation} id="task-conversation" className="tw-conversation" tabIndex={-1}><HeadingSlotContext.Provider value={headingSlot}><ActivityHomeContext.Provider value={materials ? HOME_WITH_MATERIALS : HOME_WITHOUT_MATERIALS}><TaskAppearanceContext.Provider value={{ open: active && !view.error ? () => setAppearanceScope(scopeKey) : null }}>{children}</TaskAppearanceContext.Provider></ActivityHomeContext.Provider></HeadingSlotContext.Provider></div>
    </section>
    {sourcesOpen && !sourceDialog && <KeyboardSplitter panel="sources" label="자료 패널 너비 조절" controls="task-sources" value={sizes.sources ?? tokenWidths.sources ?? PANEL_LIMITS.sources.min} onChange={value => resizePanel('sources', value)} />}
    {sourceDialog && <div className="tw-source-backdrop" aria-hidden="true" onMouseDown={event => event.preventDefault()} onClick={() => closeSources()} />}
    <aside ref={sourcePanel} id="task-sources" className="tw-sources" aria-label="작업 자료" role={sourceDialog ? 'dialog' : undefined} aria-modal={sourceDialog || undefined} tabIndex={-1} hidden={!sourcesOpen} onKeyDown={event => { if (event.key === 'Escape' && !imeComposing(event)) { event.preventDefault(); closeSources(); } }}>
      <header><h2>작업 자료</h2><button type="button" className="tw-quiet tw-source-close" aria-label="자료 닫기" onClick={() => closeSources()}><SourceIcon kind="close" /></button></header>
      {request?.error && request.url !== selected?.url && <div className="cp-source-open-error" role="alert"><span>{request.error}</span><button type="button" className="tw-quiet" onClick={revealRequestError}>출처 확인</button></div>}
      {request?.phase === 'opening' && request.url !== selected?.url && <p className="cp-other-source-status" role="status">출처 여는 중: {citationAddress(request.url)?.hostname}</p>}
      <PanelBoundary panel="task-sources">{() => <>
      {selected ? <>
        <CitationPreview citation={selected} pinned={pinned} otherPinned={!!pinnedSource && !pinned} ephemeral={!!previewSourceValue}
          opening={selectedRequest?.phase === 'opening'} blocked={request?.phase === 'opening' || request?.phase === 'returning'} opened={selectedRequest?.phase === 'opened' || selectedRequest?.phase === 'returning'} returning={selectedRequest?.phase === 'returning'} error={selectedRequest?.error}
          onOpen={() => openSource(selected.url)} onReturn={returnFromSource}
          onPin={() => postToHost({ type: 'taskSourceSelection', selection: { url: selected.url, pinned: !pinned } })} />
        <h3 className="tw-source-list-title">이 작업의 출처</h3>
        <ul className="tw-source-list">{sources.map(source => <li key={source.url}><button type="button" aria-pressed={selected.url === source.url} onClick={() => { setPreview({ url: source.url, scopeKey }); pendingFocus.current = 'source-title'; }}><span className="tw-source-name"><span className="hps-source-kind">{citationKindLabel(source.kind)}</span> {source.title || citationAddress(source.url)?.hostname}</span><small>{citationAddress(source.url)?.hostname}{pinnedSource?.url === source.url ? ' · 고정됨' : ''}</small></button></li>)}</ul>
      </> : <div className="tw-source-empty"><span aria-hidden="true"><SourceIcon kind="source" size={24} /></span><h3>출처를 모아 둘 자리</h3><p>대화에서 웹 자료를 찾으면 여기에서 다시 열 수 있습니다.</p></div>}
      {sourcesOpen && <ActivityTrashPanel scopeKey={scopeKey} files={artifacts} onAsk={onAskAboutFile && (filePath => {
        // The narrow layout is a modal dialog: close it without restoring focus, so the host's
        // focus request after the attach reaches the composer.
        if (sourceDialog) closeSources(null, false);
        onAskAboutFile(filePath);
      })} />}
      </>}</PanelBoundary>
    </aside>
    {active && appearanceScope === scopeKey && <TaskAppearanceDialog key={scopeKey} task={active} onClose={() => setAppearanceScope(null)} />}
  </div></CitationPreviewContext.Provider>;
}
