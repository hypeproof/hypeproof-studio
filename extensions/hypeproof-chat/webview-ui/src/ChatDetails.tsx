import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

export function ChatIcon({ kind, size = 18 }: { kind: 'send' | 'stop' | 'copy' | 'check' | 'down' | 'plus' | 'globe' | 'image' | 'retry' | 'code' | 'play' | 'chevron'; size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
  </svg>;
}

/**
 * The actions under a finished coach answer in the personal chat: copy, then (when offered) open
 * the answer's page in the preview and ask for the answer again. One row, one size, no boxes —
 * the answer text leads and these follow it (Jay 2026-10-19: the bordered retry square beside the
 * speaker label read as an out-of-place "restart").
 */
export function CopyAnswer({ content, onRun, onRetry, verdict }: { content: string; onRun?: () => void; onRetry?: () => void; /** CGP-CHAT-R-005 — the verdict buttons, last in the row. */ verdict?: ReactNode }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
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
    try { await navigator.clipboard.writeText(content); if (mounted.current && attempt === copyAttempt.current) setState('copied'); }
    catch { if (mounted.current && attempt === copyAttempt.current) setState('failed'); }
  };
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
    {verdict}
    <span role="status" className="hps-copy-status">{state === 'copied' ? '답변을 복사했습니다' : state === 'failed' ? '복사하지 못했습니다. 답변을 선택해 복사해 주세요.' : ''}</span>
  </div>;
}

export function ResponsePending({ hasContent = false }: { hasContent?: boolean }) {
  return <div className="hps-response-pending" role="status">
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
