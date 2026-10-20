import { useEffect, useState } from 'react';
import { imeComposing } from './imeGuard';
import { QUOTE_CUT_NOTE, QUOTE_LABEL, quoteFromSelection, type AnswerQuote, type QuoteSelection } from './quoteReply';
import './quoteAction.css';

/**
 * CGP-CHAT-R-007 — tracks the document selection (at most once per animation frame) and returns a
 * quote while it lies inside one answer. A collapsed selection keeps the quote only while focus is on the quote button, so Tab
 * to the button (which may drop the selection) still works.
 */
export function useAnswerQuote(enabled: boolean): [AnswerQuote | null, () => void] {
  const [quote, setQuote] = useState<AnswerQuote | null>(null);
  useEffect(() => {
    if (!enabled) { setQuote(null); return; }
    const read = () => {
      const next = quoteFromSelection(document.getSelection?.() as QuoteSelection | null | undefined);
      if (!next && (document.activeElement as Element | null)?.classList?.contains('hps-quote-action')) return;
      setQuote(current => current && next && current.messageId === next.messageId && current.block === next.block ? current : next);
    };
    // selectionchange fires on every mouse move of a drag: read the selection once per frame.
    let frame: number | undefined;
    const schedule = () => { if (frame === undefined) frame = requestAnimationFrame(() => { frame = undefined; read(); }); };
    document.addEventListener('selectionchange', schedule);
    return () => { document.removeEventListener('selectionchange', schedule); if (frame !== undefined) cancelAnimationFrame(frame); };
  }, [enabled]);
  return [quote, () => setQuote(null)];
}

/** The 인용하기 button drawn under the answer that holds the selection. */
export function QuoteAction({ quote, disabled, onQuote, onDismiss }: {
  quote: AnswerQuote;
  disabled?: boolean;
  onQuote: (quote: AnswerQuote) => void;
  onDismiss: () => void;
}) {
  return <div className="hps-quote-row">
    <button
      type="button"
      className="hps-quote-action"
      disabled={disabled}
      // Keep the selection (and the page focus) where it is until the click lands.
      onMouseDown={event => event.preventDefault()}
      onClick={() => onQuote(quote)}
      onKeyDown={event => { if (event.key === 'Escape' && !imeComposing(event)) { event.preventDefault(); onDismiss(); } }}
    >{QUOTE_LABEL}</button>
    {quote.truncated && <span className="hps-quote-note">{QUOTE_CUT_NOTE}</span>}
  </div>;
}
