import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { ChatIcon } from './ChatDetails';
import { clearHits, findHits, normalizeFindQuery, openClosed, paintHits, revealRange, FIND_QUERY_MAX, type FindHit } from './chatFind';

const isMac = () => /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || globalThis.navigator?.userAgent || '');

/** Cmd+F on macOS, Ctrl+F elsewhere; no other modifier. The physical key also counts, so a
 * Korean input source (where `key` is 'ㄹ') still opens it. */
export function isFindShortcut(e: KeyboardEvent) {
  if ((e.key.toLowerCase() !== 'f' && e.code !== 'KeyF') || e.altKey || e.shiftKey) return false;
  return isMac() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}

/**
 * CGP-CHAT-R-027 / CGP-CHAT-D-027 (REQ-STUDIO-CHAT-FIND) — the find bar, at the top of the
 * conversation. Opening and closing it never moves the text the learner is reading (see toggle).
 * Moving between matches scrolls the conversation like any reader scroll, so the chat's
 * follow-the-bottom rule (useChatViewport) decides what happens next, unchanged.
 */
export function ChatFindBar({ scrollRef, scope, onReading }: {
  scrollRef: RefObject<HTMLDivElement>;
  /** Activity/task the conversation belongs to; a change closes the bar. */
  scope: string;
  /** Called before a match is scrolled into view (explicit reading, not following). */
  onReading?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<FindHit[]>([]);
  const [current, setCurrent] = useState(0);
  const bar = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const hitsRef = useRef<FindHit[]>([]);
  const currentRef = useRef(0);
  // A collapsed code pill the learner moved into: after it opens, select its nth match.
  const pending = useRef<{ element: Element; nth: number } | null>(null);
  const reading = useRef(onReading);
  reading.current = onReading;
  hitsRef.current = hits;
  currentRef.current = current;

  // The bar sits in the column above the conversation, so opening or closing it moves the
  // conversation's top edge. Shift scrollTop by the same amount: the text stays where the reader
  // sees it and the distance to the bottom (follow-the-bottom) is unchanged.
  const edgeBefore = useRef<{ top: number; scrollTop: number } | null>(null);
  const isOpen = useRef(false);
  isOpen.current = open;
  const toggle = (next: boolean) => {
    if (next === isOpen.current) return;
    isOpen.current = next;
    const scroller = scrollRef.current;
    edgeBefore.current = scroller ? { top: scroller.getBoundingClientRect().top, scrollTop: scroller.scrollTop } : null;
    setOpen(next);
  };
  useLayoutEffect(() => {
    const scroller = scrollRef.current, before = edgeBefore.current;
    edgeBefore.current = null;
    if (!scroller || before === null) return;
    // Absolute, not +=: a scroller that grew may already have clamped its scrollTop.
    const delta = scroller.getBoundingClientRect().top - before.top;
    if (delta) scroller.scrollTop = before.scrollTop + delta;
  }, [open, scrollRef]);

  const show = useCallback((list: FindHit[], index: number, scroll: boolean) => {
    const scroller = scrollRef.current;
    const hit = list[index];
    if (hit?.kind === 'closed') {
      pending.current = { element: hit.element, nth: hit.nth };
      openClosed(hit.element);
      return;
    }
    paintHits(list, index);
    // Following stops only when the match really has to be scrolled to.
    if (scroll && hit && scroller) revealRange(hit.range, scroller, 0, () => reading.current?.());
  }, [scrollRef]);

  // Recompute on query change (scrolls to the first match) and on conversation changes (no scroll).
  const search = useCallback((fromQuery: boolean) => {
    const scroller = scrollRef.current;
    const q = normalizeFindQuery(query);
    if (fromQuery) pending.current = null;
    const list = scroller && open ? findHits(scroller, q) : [];
    let index = Math.min(currentRef.current, Math.max(0, list.length - 1));
    let scroll = fromQuery;
    const wait = pending.current;
    if (wait) {
      const inside = list.map((h, i) => [h, i] as const).filter(([h]) => h.kind === 'range' && wait.element.contains(h.range.startContainer));
      if (inside.length) { index = inside[Math.min(wait.nth, inside.length - 1)][1]; pending.current = null; scroll = true; }
    }
    if (fromQuery) {
      // The first match at or below the top of what the learner is reading.
      const top = scroller?.getBoundingClientRect().top ?? 0;
      const below = list.findIndex(h => h.kind === 'range' && h.range.getBoundingClientRect().bottom >= top);
      index = below === -1 ? 0 : below;
    }
    setHits(list);
    setCurrent(index);
    if (list.length) show(list, index, scroll); else clearHits();
  }, [scrollRef, query, open, show]);

  // A new query selects and reveals its first match; reopening with the kept query only repaints.
  const lastQuery = useRef(query);
  useEffect(() => {
    const changed = lastQuery.current !== query;
    lastQuery.current = query;
    search(changed);
  }, [query, open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!open || !scroller) return;
    let frame = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => search(false));
    });
    observer.observe(scroller, { subtree: true, childList: true, characterData: true });
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [open, scrollRef, search]);

  useEffect(() => () => clearHits(), []);

  const close = useCallback((restoreFocus: boolean) => {
    toggle(false);
    setHits([]);
    pending.current = null;
    clearHits();
    if (!restoreFocus) return;
    const back = returnTo.current;
    returnTo.current = null;
    const target = back?.isConnected && !(back as HTMLButtonElement).disabled ? back
      : scrollRef.current?.parentElement?.querySelector<HTMLTextAreaElement>('.hps-input textarea');
    target?.focus({ preventScroll: true });
  }, [scrollRef]);

  // A different task or activity is a different conversation.
  const firstScope = useRef(scope);
  useEffect(() => {
    if (firstScope.current === scope) return;
    firstScope.current = scope;
    close(!!bar.current?.contains(document.activeElement));
    setCurrent(0);
    setQuery(''); // #2974: the next conversation must perform a fresh search, even for the same text.
  }, [scope, close]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || !isFindShortcut(e) || !scrollRef.current) return;
      // A modal dialog owns the keyboard; find does not open behind it.
      if (document.querySelector('[aria-modal="true"], dialog[open]')) return;
      e.preventDefault();
      e.stopPropagation();
      const active = document.activeElement as HTMLElement | null;
      if (!bar.current?.contains(active)) returnTo.current = active && active !== document.body ? active : null;
      if (!bar.current) toggle(true);
      requestAnimationFrame(() => { input.current?.focus({ preventScroll: true }); input.current?.select(); });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [scrollRef]);

  const step = (by: 1 | -1) => {
    const list = hitsRef.current;
    if (!list.length) return;
    pending.current = null;
    const next = (currentRef.current + by + list.length) % list.length;
    setCurrent(next);
    show(list, next, true);
  };

  if (!open) return null;
  const q = normalizeFindQuery(query);
  const count = q.trim() ? `${hits.length ? current + 1 : 0}/${hits.length}` : '';
  return <div ref={bar} className="hps-find" role="search" aria-label="대화에서 찾기"
    onKeyDown={e => { if (e.key === 'Escape' && !e.nativeEvent.isComposing) { e.preventDefault(); e.stopPropagation(); close(true); } }}>
    <input ref={input} className="hps-find-input" type="text" aria-label="대화에서 찾기" placeholder="대화에서 찾기"
      maxLength={FIND_QUERY_MAX} value={query} spellCheck={false}
      onChange={e => setQuery(e.target.value)}
      onKeyDown={e => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
      }} />
    <span className="hps-find-count" role="status" aria-live="polite">{count}</span>
    <button type="button" className="hps-find-btn" aria-label="이전 결과" disabled={!hits.length} onClick={() => step(-1)}><ChatIcon kind="chevron-up" size={20} /></button>
    <button type="button" className="hps-find-btn" aria-label="다음 결과" disabled={!hits.length} onClick={() => step(1)}><ChatIcon kind="chevron-down" size={20} /></button>
    <button type="button" className="hps-find-btn" aria-label="찾기 닫기" onClick={() => close(true)}><ChatIcon kind="close" size={20} /></button>
  </div>;
}
