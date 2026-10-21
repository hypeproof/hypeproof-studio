import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

/**
 * CGP-DS-R-018 / REQ-STUDIO-STROKE-ICONS — the webview's one stroke icon set. Studio's own paths
 * on a 24 grid, 1.7px round stroke, `currentColor` only (no fill that a theme or forced colours
 * could hide; `stop` is the one solid shape and it is currentColor too). Drawn at 16 (inline),
 * 20 (toolbar, default) or 24 (banners and empty states). Not copied from any third-party set.
 *
 * Accessibility: with no `label` the icon is decoration (`aria-hidden`) and the words beside it
 * carry the meaning. Give a Korean `label` only where the icon stands alone; it then becomes
 * `role="img"` with that name.
 */
export type IconKind =
  | 'send' | 'stop' | 'copy' | 'check' | 'down' | 'plus' | 'globe' | 'image' | 'retry' | 'code' | 'play' | 'chevron' | 'file'
  | 'info' | 'alert' | 'close' | 'search' | 'pencil' | 'terminal' | 'tool' | 'link' | 'external' | 'eye' | 'pointer'
  | 'back' | 'forward' | 'message' | 'chevron-down' | 'scroll' | 'flask' | 'bulb' | 'clock' | 'lock' | 'book' | 'package'
  | 'folder' | 'ruler' | 'dots' | 'sparkle' | 'square' | 'check-square' | 'help' | 'upload' | 'plug' | 'ticket' | 'moon'
  | 'flag' | 'people' | 'camera' | 'keyboard' | 'thought' | 'dot' | 'open-window' | 'pin' | 'source' | 'return'
  | 'minus' | 'menu' | 'settings' | 'hand' | 'game' | 'ban';
export type IconSize = 16 | 20 | 24;

export function ChatIcon({ kind, size = 20, label }: { kind: IconKind; size?: IconSize; label?: string }) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const };
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" focusable="false" data-icon={kind} className="hps-icon" {...a11y}>
    {kind === 'plus' && <path d="M12 5v14M5 12h14" />}
    {kind === 'globe' && <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z" /></>}
    {kind === 'image' && <><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="8" cy="8" r="1" /><path d="m3 17 5-5 4 4 4-6 5 7" /></>}
    {kind === 'retry' && <><path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5" /></>}
    {kind === 'send' && <path d="M12 19V5m-6 6 6-6 6 6" />}
    {kind === 'stop' && <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />}
    {kind === 'copy' && <><rect x="8" y="8" width="11" height="12" rx="2" /><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3" /></>}
    {kind === 'check' && <path d="m5 12 4 4L19 6" />}
    {kind === 'down' && <path d="M12 5v14m-6-6 6 6 6-6" />}
    {kind === 'code' && <path d="m8 7-5 5 5 5M16 7l5 5-5 5" />}
    {kind === 'play' && <path d="M8 5.5v13l10.5-6.5L8 5.5Z" />}
    {kind === 'chevron' && <path d="m9 6 6 6-6 6" />}
    {kind === 'file' && <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>}
    {kind === 'info' && <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.01" /></>}
    {kind === 'alert' && <><path d="M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" /><path d="M12 9.5v4.5M12 17.2v.01" /></>}
    {kind === 'close' && <path d="M6 6l12 12M18 6 6 18" />}
    {kind === 'search' && <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.4-4.4" /></>}
    {kind === 'pencil' && <><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></>}
    {kind === 'terminal' && <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M12.5 15H17" /></>}
    {kind === 'tool' && <path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3l7.5-7.5a4 4 0 0 0-2-2Zm0 0L17 4" />}
    {kind === 'link' && <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>}
    {kind === 'external' && <path d="M8 16 17 7M9 7h8v8" />}
    {kind === 'eye' && <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>}
    {kind === 'pointer' && <path d="m5 4 13 6.5-5.5 1.5L10.5 18 5 4Z" />}
    {kind === 'back' && <path d="M19 12H5m6-6-6 6 6 6" />}
    {kind === 'forward' && <path d="M5 12h14m-6-6 6 6-6 6" />}
    {kind === 'message' && <path d="M4 5h16v11H9l-5 4V5Z" />}
    {kind === 'chevron-down' && <path d="m6 9 6 6 6-6" />}
    {kind === 'scroll' && <path d="M12 3v18m-4-14 4-4 4 4m-8 10 4 4 4-4" />}
    {kind === 'flask' && <><path d="M9.5 3h5M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3" /><path d="M7 15h10" /></>}
    {kind === 'bulb' && <><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z" /></>}
    {kind === 'clock' && <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>}
    {kind === 'lock' && <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>}
    {kind === 'book' && <path d="M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2V5Zm0 15a2 2 0 0 0 2 2h13v-4" />}
    {kind === 'package' && <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9" /></>}
    {kind === 'folder' && <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />}
    {kind === 'ruler' && <><rect x="2.5" y="8" width="19" height="8" rx="1.5" /><path d="M6.5 8v3M10.5 8v4M14.5 8v3M18.5 8v4" /></>}
    {kind === 'dots' && <path d="M6 12h.01M12 12h.01M18 12h.01" strokeWidth="2.6" />}
    {kind === 'sparkle' && <path d="M12 3.5c.6 4.3 2.2 5.9 6.5 6.5-4.3.6-5.9 2.2-6.5 6.5-.6-4.3-2.2-5.9-6.5-6.5 4.3-.6 5.9-2.2 6.5-6.5ZM18.5 16v4M16.5 18h4" />}
    {kind === 'square' && <rect x="4" y="4" width="16" height="16" rx="3" />}
    {kind === 'check-square' && <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8 12 3 3 5-6" /></>}
    {kind === 'help' && <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.4M12 16.8v.01" /></>}
    {kind === 'upload' && <><path d="M12 15V4m-5 5 5-5 5 5" /><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></>}
    {kind === 'plug' && <path d="M9 3v4M15 3v4M6 7h12v4a6 6 0 0 1-12 0V7Zm6 10v4" />}
    {kind === 'ticket' && <><path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4V8Z" /><path d="M14 6v12" strokeDasharray="2 2.5" /></>}
    {kind === 'moon' && <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />}
    {kind === 'flag' && <path d="M5 21V4m0 0h11l-2 4 2 4H5" />}
    {kind === 'people' && <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6" /></>}
    {kind === 'camera' && <><path d="M4 8h3l2-3h6l2 3h3v11H4V8Z" /><circle cx="12" cy="13" r="3.5" /></>}
    {kind === 'keyboard' && <><rect x="2.5" y="6" width="19" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" /></>}
    {kind === 'thought' && <><path d="M7 15a4 4 0 0 1-.5-8A5 5 0 0 1 16 6a4 4 0 0 1 1 8H7Z" /><path d="M8 18.5h.01M5.5 20.5h.01" /></>}
    {kind === 'dot' && <circle cx="12" cy="12" r="2.5" />}
    {kind === 'open-window' && <><path d="M14 4h6v6M20 4l-9 9" /><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></>}
    {kind === 'pin' && <path d="m9 3 6 0-1 6 4 4v2H6v-2l4-4-1-6ZM12 15v6" />}
    {kind === 'source' && <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></>}
    {kind === 'return' && <path d="m9 5-7 7 7 7M2 12h13a6 6 0 0 0 6-6" />}
    {kind === 'minus' && <path d="M7 12h10" />}
    {kind === 'ban' && <><circle cx="12" cy="12" r="9" /><path d="m5.6 5.6 12.8 12.8" /></>}
    {kind === 'game' && <><rect x="2.5" y="7" width="19" height="11" rx="4" /><path d="M7 10.5v4M5 12.5h4M15.5 12h.01M18 14h.01" /></>}
    {kind === 'menu' && <path d="M4 7h16M4 12h16M4 17h16" />}
    {kind === 'settings' && <><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /><circle cx="12" cy="12" r="6.5" /></>}
    {kind === 'hand' && <path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12m0-6.5v-1a1.5 1.5 0 0 1 3 0V12m0-6a1.5 1.5 0 0 1 3 0v6m0-3.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-5-2.7L4.6 15a1.5 1.5 0 0 1 2.5-1.7L8 14.5" />}
  </svg>;
}

/**
 * The actions under a finished coach answer in the personal chat: copy, then (when offered) open
 * the answer's page in the preview and ask for the answer again. One row, one size, no boxes —
 * the answer text leads and these follow it (Jay 2026-10-19: the bordered retry square beside the
 * speaker label read as an out-of-place "restart").
 */
export type CopyState = 'idle' | 'copied' | 'failed';

/** Write `text` to `clipboard` and report the outcome. "copied" only after the write resolves. */
export async function writeClipboard(text: string, clipboard: Pick<Clipboard, 'writeText'> | undefined = globalThis.navigator?.clipboard): Promise<Exclude<CopyState, 'idle'>> {
  try {
    if (!clipboard) throw new Error('no clipboard');
    await clipboard.writeText(text);
    return 'copied';
  } catch { return 'failed'; }
}

/**
 * Confirmed copy feedback shared by the answer copy and every code block (CP-R1, CGP-CHAT-R-008):
 * the confirmation appears only after the clipboard write succeeds, a failure is stated, and the
 * state returns to idle after 2.4s.
 */
export function useConfirmedCopy(text: string): [CopyState, () => Promise<void>] {
  const [state, setState] = useState<CopyState>('idle');
  const mounted = useRef(true);
  const copyAttempt = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 2400);
    return () => clearTimeout(timer);
  }, [state]);
  const copy = async () => {
    const attempt = ++copyAttempt.current;
    setState('idle');
    // Older clipboard completions must not replace the latest attempt's feedback.
    const result = await writeClipboard(text);
    if (mounted.current && attempt === copyAttempt.current) setState(result);
  };
  return [state, copy];
}

/** CGP-KNOW-R-004 — the answer action's label (the session command's name, package.json wikiIngest). */
export const ANSWER_TO_WIKI_LABEL = '팀 브레인에 정리하기';

export function CopyAnswer({ content, onRun, onRetry, verdict, onToWiki }: { content: string; onRun?: () => void; onRetry?: () => void; /** CGP-CHAT-R-005 — the verdict buttons, last in the row. */ verdict?: ReactNode; /** CGP-KNOW-R-004 — file this answer to the team brain (the host asks before writing). */ onToWiki?: () => void }) {
  const [state, copy] = useConfirmedCopy(content);
  return <div className="hps-answer-actions">
    <button type="button" className="hps-copy-answer hps-answer-action" onClick={copy} aria-label="답변 복사" title="답변 복사">
      <ChatIcon kind={state === 'copied' ? 'check' : 'copy'} size={16} /><span>{state === 'copied' ? '복사됨' : '복사'}</span>
    </button>
    {onRun && <button type="button" className="hps-msg-run hps-answer-action" onClick={onRun} title="미리보기 패널에서 실행">
      <ChatIcon kind="play" size={16} /><span>미리보기</span>
    </button>}
    {onRetry && <button type="button" className="hps-msg-retry hps-answer-action" onClick={onRetry} aria-label="답변 다시 받기" title="같은 요청으로 답변을 한 번 더 받아요">
      <ChatIcon kind="retry" size={16} /><span>다시 받기</span>
    </button>}
    {onToWiki && <button type="button" className="hps-answer-wiki hps-answer-action" onClick={onToWiki} title="이 답과 질문을 팀 브레인에 정리해요. 쓰기 전에 한 번 더 물어봐요.">
      <span>{ANSWER_TO_WIKI_LABEL}</span>
    </button>}
    {verdict}
    <span role="status" className="hps-copy-status">{state === 'copied' ? '답변을 복사했습니다' : state === 'failed' ? '복사하지 못했습니다. 답변을 선택해 복사해 주세요.' : ''}</span>
  </div>;
}

export function ResponsePending({ hasContent = false }: { hasContent?: boolean }) {
  return <div className="hps-response-pending">
    <span className="hps-response-dots" aria-hidden="true"><i /><i /><i /></span>
    <span>{hasContent ? '답변 작성 중' : '응답을 준비하고 있어요'}</span>
  </div>;
}

/** Keep live output in view only while the reader chooses to follow the bottom. */
export function useChatViewport(ref: RefObject<HTMLDivElement>, enabled: boolean, revision: unknown, textSize?: string) {
  const follow = useRef(true);
  const readingAnchor = useRef<{ element: HTMLElement; offset: number } | null>(null);
  const [away, setAway] = useState(false);
  const captureReadingPosition = () => {
    readingAnchor.current = null;
    const node = ref.current;
    if (!enabled || follow.current || !node) return;
    const viewport = node.getBoundingClientRect();
    const middle = (viewport.top + viewport.bottom) / 2;
    // A single answer can contain many screens of text. Preserve a visible
    // passage near the reading area's center, not the whole message's top.
    const passages = [...node.querySelectorAll<HTMLElement>('.hps-msg-body p, .hps-msg-body li, .hps-msg-body pre, .hps-msg-body h1, .hps-msg-body h2, .hps-msg-body h3, .hps-msg-body td, .hps-msg-body th')]
      .map(element => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.height > 0 && rect.bottom > viewport.top && rect.top < viewport.bottom)
      .sort((a, b) => Math.abs((a.rect.top + a.rect.bottom) / 2 - middle) - Math.abs((b.rect.top + b.rect.bottom) / 2 - middle));
    if (passages[0]) readingAnchor.current = { element: passages[0].element, offset: passages[0].rect.top - viewport.top };
  };
  const toLatest = () => {
    readingAnchor.current = null;
    follow.current = true;
    setAway(false);
    // Instant positioning avoids a stream of competing smooth-scroll animations.
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  };
  const onScroll = () => {
    // A newer reader scroll takes precedence over an outstanding settings reply.
    readingAnchor.current = null;
    if (!enabled || !ref.current) return;
    const node = ref.current;
    follow.current = node.scrollHeight - node.scrollTop - node.clientHeight <= 48;
    setAway(!follow.current);
  };
  useLayoutEffect(() => {
    if (enabled && follow.current && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [enabled, revision, ref, textSize]);
  useLayoutEffect(() => {
    const anchor = readingAnchor.current;
    readingAnchor.current = null;
    const node = ref.current;
    if (!enabled || follow.current || !node || !anchor || !node.contains(anchor.element)) return;
    node.scrollTop += anchor.element.getBoundingClientRect().top - node.getBoundingClientRect().top - anchor.offset;
  }, [enabled, ref, textSize]);
  useEffect(() => {
    if (!enabled || !ref.current) return;
    const node = ref.current;
    const resize = new ResizeObserver(() => {
      if (follow.current) node.scrollTop = node.scrollHeight;
    });
    resize.observe(node);
    for (const child of node.children) resize.observe(child);
    return () => resize.disconnect();
  }, [enabled, revision, ref]);
  return { away, onScroll, toLatest, captureReadingPosition };
}

/** Measure the active selection edge with the editor's actual wrapping and font. */
function composerCaretLine(node: HTMLTextAreaElement) {
  const style = getComputedStyle(node);
  const mirror = document.createElement('div');
  for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing',
    'lineHeight', 'textIndent', 'textTransform', 'tabSize', 'wordSpacing', 'paddingTop',
    'paddingRight', 'paddingBottom', 'paddingLeft'] as const) mirror.style[property] = style[property];
  Object.assign(mirror.style, { position: 'fixed', visibility: 'hidden', pointerEvents: 'none',
    left: '-10000px', top: '0', width: `${node.clientWidth}px`, boxSizing: 'border-box',
    whiteSpace: 'pre-wrap', overflowWrap: 'break-word' });
  const edge = node.selectionDirection === 'backward' ? node.selectionStart : node.selectionEnd;
  mirror.textContent = node.value.slice(0, edge);
  const marker = document.createElement('span');
  marker.textContent = node.value.slice(edge) || '.';
  mirror.append(marker);
  document.body.append(mirror);
  const top = marker.offsetTop;
  const height = parseFloat(style.lineHeight) || 24;
  mirror.remove();
  return { top, bottom: top + height };
}

/** Keep one editor node while compact and expanded layouts share draft ownership. */
export function useGrowingComposer(ref: RefObject<HTMLTextAreaElement>, enabled: boolean, draft: string, hasContext = false) {
  const [expanded, setExpanded] = useState(false);
  useLayoutEffect(() => {
    if (!enabled || !ref.current) return;
    const node = ref.current;
    const shell = node.closest<HTMLElement>('.hps-shell');
    const footer = node.closest<HTMLElement>('.hps-input-area');
    const card = node.closest<HTMLElement>('.hps-input');
    let previous = '';
    let caret = composerCaretLine(node);
    let caretVisible = caret.top >= node.scrollTop - 1 && caret.bottom <= node.scrollTop + node.clientHeight + 1;
    const rememberCaret = () => {
      caret = composerCaretLine(node);
      caretVisible = caret.top >= node.scrollTop - 1 && caret.bottom <= node.scrollTop + node.clientHeight + 1;
    };
    node.addEventListener('scroll', rememberCaret);
    node.addEventListener('select', rememberCaret);
    node.addEventListener('keyup', rememberCaret);

    const geometry = () => [card?.clientWidth, shell?.clientHeight, footer?.offsetHeight,
      ...Array.from(shell?.children ?? []).filter(child => child !== footer && !child.classList.contains('hps-messages')).map(child => (child as HTMLElement).offsetHeight)].join(':');
    const fit = () => {
      // Measure before temporarily collapsing the editor. Follow an editing end
      // only when it was visible; a reader who scrolled up keeps their position.
      const readingTop = node.scrollTop;
      const followEnd = node.selectionStart === node.value.length
        && node.selectionEnd === node.value.length
        && node.scrollHeight - readingTop - node.clientHeight <= 1;
      const cardStyle = card && getComputedStyle(card);
      const inset = cardStyle ? parseFloat(cardStyle.paddingLeft) + parseFloat(cardStyle.paddingRight) : 16;
      const tools = card?.querySelector<HTMLElement>('.hps-composer-tools');
      const controls = card?.querySelector<HTMLElement>('.hps-input-buttons');
      const compactWidth = Math.max(40, (card?.clientWidth ?? node.clientWidth) - inset - (tools?.offsetWidth ?? 0) - (controls?.offsetWidth ?? 44) - 12);
      const line = parseFloat(getComputedStyle(node).lineHeight) || 24;
      // Measure at the compact width so a wrapped paragraph cannot oscillate between layouts.
      node.style.width = `${compactWidth}px`;
      node.style.height = '0px';
      const needsRoom = hasContext || node.scrollHeight > line + 1;
      node.style.width = '';
      setExpanded(needsRoom);
      const chrome = shell ? Array.from(shell.children).reduce((height, child) =>
        height + (child === footer || child.classList.contains('hps-messages') ? 0 : (child as HTMLElement).offsetHeight), 0) : 0;
      const fixedFooter = (footer?.offsetHeight ?? node.offsetHeight) - node.offsetHeight;
      const cap = Math.max(24, Math.min(192, (shell?.clientHeight ?? 600) - fixedFooter - chrome - 96));
      node.style.maxHeight = `${cap}px`;
      node.style.height = '0px';
      node.style.height = `${Math.min(cap, Math.max(24, node.scrollHeight))}px`;
      node.scrollTop = followEnd ? node.scrollHeight : readingTop;
      if (document.activeElement === node && caretVisible) {
        const next = composerCaretLine(node);
        if (next.bottom > node.scrollTop + node.clientHeight) node.scrollTop = next.bottom - node.clientHeight;
        else if (next.top < node.scrollTop) node.scrollTop = next.top;
      }
      rememberCaret();
      previous = geometry();
    };
    fit();
    const resize = new ResizeObserver(() => { if (geometry() !== previous) fit(); });
    if (card) resize.observe(card);
    if (shell) resize.observe(shell);
    if (footer) resize.observe(footer);
    return () => {
      resize.disconnect();
      node.removeEventListener('scroll', rememberCaret);
      node.removeEventListener('select', rememberCaret);
      node.removeEventListener('keyup', rememberCaret);
    };
  }, [enabled, draft, ref, hasContext, expanded]);
  return expanded;
}
