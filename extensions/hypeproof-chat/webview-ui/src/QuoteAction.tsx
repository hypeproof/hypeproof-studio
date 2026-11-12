import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChatIcon } from './ChatDetails';
import { nativeComposing } from './imeGuard';
import { placeQuote, QUOTE_CUT_NOTE, QUOTE_LABEL, QUOTE_SCOPE_ATTR, quoteChipText, quoteFromSelection, type AnswerQuote, type QuoteBox, type QuotePlacement, type QuoteRangeRects, type QuoteSelection } from './quoteReply';
import type { DraftPart } from './pastedDraft';
import './quoteAction.css';

/**
 * CGP-CHAT-R-007 — tracks the document selection (at most once per animation frame) and returns a
 * quote while it lies inside one answer. A collapsed selection keeps the quote only while focus is on the quote button, so Tab
 * to the button (which may drop the selection) still works. CGP-CHAT-D-007: while the primary
 * pointer is down (a mouse drag in progress) nothing is shown; the release reads the selection at once.
 */
export function useAnswerQuote(enabled: boolean): [AnswerQuote | null, () => void] {
  const [quote, setQuote] = useState<AnswerQuote | null>(null);
  useEffect(() => {
    if (!enabled) { setQuote(null); return; }
    let dragging = false;
    const read = () => {
      if (dragging) return;
      const selection = document.getSelection?.() as (QuoteSelection & { getRangeAt?(index: number): unknown }) | null | undefined;
      const found = quoteFromSelection(selection);
      if (!found && (document.activeElement as Element | null)?.classList?.contains('hps-quote-action')) return;
      // D-007: a copy of the range goes with the quote, so placing the popover never reads the selection again.
      const live = found ? selection?.getRangeAt?.(0) as (QuoteRangeRects & { cloneRange?(): QuoteRangeRects }) | undefined : undefined;
      const next = found && live && typeof live.getClientRects === 'function' ? { ...found, range: live.cloneRange?.() ?? live } : found;
      setQuote(current => current && next && current.messageId === next.messageId && current.block === next.block ? current : next);
    };
    // selectionchange fires on every mouse move of a drag: read the selection once per frame.
    let frame: number | undefined;
    const schedule = () => { if (frame === undefined) frame = requestAnimationFrame(() => { frame = undefined; read(); }); };
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || (event.target as Element | null)?.closest?.('.hps-quote-row')) return;
      dragging = true;
      setQuote(null);
    };
    const up = () => { if (!dragging) return; dragging = false; read(); };
    document.addEventListener('selectionchange', schedule);
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    window.addEventListener('blur', up);
    return () => {
      document.removeEventListener('selectionchange', schedule);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', up, true);
      window.removeEventListener('blur', up);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [enabled]);
  return [quote, () => setQuote(null)];
}

type Rect = { top: number; bottom: number; left: number; right: number; width: number; height: number };
const box = (r: Rect): QuoteBox => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });

/**
 * CGP-CHAT-D-007 — the popover's place, in the coordinates of its containing block, from the quoted
 * range: its line boxes inside the answer body, the visible part of the conversation and the row.
 * Null when there is nothing to measure (no range, or no layout), so the last place stays.
 */
function measure(pop: HTMLElement, range: QuoteRangeRects | undefined): QuotePlacement | null {
  const row = pop.parentElement, body = row?.querySelector(`[${QUOTE_SCOPE_ATTR}]`);
  if (!range || !row || !body) return null;
  const limit = body.getBoundingClientRect();
  // A triple-click can end in the next row; only line boxes inside the answer body count.
  const lines = Array.from(range.getClientRects()).filter(r => r.width > 0 && r.height > 0 && r.bottom > limit.top && r.top < limit.bottom);
  if (!lines.length) return null;
  const first = lines.reduce((a, b) => (b.top < a.top ? b : a)), last = lines.reduce((a, b) => (b.bottom > a.bottom ? b : a));
  const scroller = pop.closest<HTMLElement>('.hps-messages');
  const frame = scroller?.getBoundingClientRect();
  const view: QuoteBox = scroller && frame
    ? { top: Math.max(0, frame.top + scroller.clientTop), bottom: Math.min(window.innerHeight, frame.top + scroller.clientTop + scroller.clientHeight), left: frame.left, right: frame.right }
    : { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth };
  const place = placeQuote(box(first), box(last), view, box(row.getBoundingClientRect()), { width: pop.offsetWidth, height: pop.offsetHeight });
  const parent = (pop.offsetParent as HTMLElement | null) ?? document.documentElement;
  const origin = parent.getBoundingClientRect();
  return { side: place.side, top: place.top - origin.top - parent.clientTop + parent.scrollTop, left: place.left - origin.left - parent.clientLeft + parent.scrollLeft };
}

/**
 * The 인용하기 popover, anchored above the selection in the answer that holds it (below when the
 * selection is near the top of the conversation). Escape anywhere dismisses it while it is shown.
 */
export function QuoteAction({ quote, disabled, onQuote, onDismiss }: {
  quote: AnswerQuote;
  disabled?: boolean;
  onQuote: (quote: AnswerQuote) => void;
  onDismiss: () => void;
}) {
  const pop = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<QuotePlacement | null>(null);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useLayoutEffect(() => {
    const node = pop.current;
    if (!node) return;
    let frame: number | undefined;
    const update = () => {
      frame = undefined;
      const next = measure(node, quote.range);
      if (next) setPlace(current => current && current.side === next.side && Math.abs(current.top - next.top) < 0.5 && Math.abs(current.left - next.left) < 0.5 ? current : next);
    };
    update();
    const schedule = () => { if (frame === undefined) frame = requestAnimationFrame(update); };
    const scroller = node.closest('.hps-messages');
    scroller?.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => { scroller?.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); if (frame !== undefined) cancelAnimationFrame(frame); };
  }, [quote]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || nativeComposing(event)) return;
      // An open modal owns Escape.
      if (document.querySelector?.('[aria-modal="true"], dialog[open]')) return;
      event.preventDefault();
      dismiss.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return <div ref={pop} className="hps-quote-row" data-side={place?.side} style={{ top: place?.top, left: place?.left }}>
    <button
      type="button"
      className="hps-quote-action"
      disabled={disabled}
      // Keep the selection (and the page focus) where it is until the click lands.
      onMouseDown={event => event.preventDefault()}
      onClick={() => onQuote(quote)}
    >{QUOTE_LABEL}</button>
    {quote.truncated && <span className="hps-quote-note">{QUOTE_CUT_NOTE}</span>}
  </div>;
}

export const QUOTE_CHIP_LABEL = '인용한 부분';
export const QUOTE_REMOVE_LABEL = '인용 빼기';

/** CGP-CHAT-D-007 — the quote in the composer: at most two lines with an ellipsis, × removes it (44px). */
export function QuoteChip({ part, disabled, onRemove }: { part: DraftPart; disabled: boolean; onRemove: () => void }) {
  return <div className="hps-file-context hps-quote-chip" role="group" aria-label={QUOTE_CHIP_LABEL}>
    <span className="hps-quote-chip-text">{quoteChipText(part)}</span>
    <button type="button" className="hps-file-context-remove hps-quote-chip-remove" disabled={disabled} onClick={onRemove} aria-label={QUOTE_REMOVE_LABEL} data-hp-tooltip={QUOTE_REMOVE_LABEL}><ChatIcon kind="close" size={16} /></button>
  </div>;
}
