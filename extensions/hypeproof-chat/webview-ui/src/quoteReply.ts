/**
 * CGP-CHAT-R-007 (REQ-STUDIO-QUOTE-REPLY): quote part of one answer into the next message.
 * Pure logic only: which selection counts, how it becomes a `> ` block, and how that block joins
 * the draft. The quote is plain draft text the learner can edit; nothing here sends anything.
 */

export const QUOTE_LABEL = '인용하기';
/** Longest quote, in characters (code points), before it is cut. */
export const QUOTE_MAX = 1000;
/** Appended to a cut quote, so the draft itself shows that text was left out. */
export const QUOTE_CUT_MARK = '…';
/** Shown next to the button when the selection is longer than QUOTE_MAX. */
export const QUOTE_CUT_NOTE = '앞 1,000자만 들어가요';
/** Set on the body of an answer that may be quoted; the value is the message id. */
export const QUOTE_SCOPE_ATTR = 'data-quote-answer';

/** The DOM surface this module reads: a node chain and a selection. */
export interface QuoteNode { nodeType: number; parentNode: QuoteNode | null; getAttribute?(name: string): string | null }
export interface QuoteSelection {
  isCollapsed?: boolean;
  rangeCount?: number;
  anchorNode: QuoteNode | null;
  focusNode: QuoteNode | null;
  toString(): string;
}

export interface AnswerQuote { messageId: string; block: string; truncated: boolean }

/** The id of the quotable answer body that contains `node`, or null. */
export function quoteScopeOf(node: QuoteNode | null): string | null {
  for (let n = node; n; n = n.parentNode) {
    if (n.nodeType !== 1) continue;
    const id = n.getAttribute?.(QUOTE_SCOPE_ATTR);
    if (id) return id;
  }
  return null;
}

/** Selected text as a `> ` block, capped at QUOTE_MAX code points. Null when nothing is left. */
export function toQuoteBlock(raw: string): { block: string; truncated: boolean } | null {
  const text = raw.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\s+$/g, '');
  if (!text.trim()) return null;
  const chars = Array.from(text);
  const truncated = chars.length > QUOTE_MAX;
  const kept = truncated ? chars.slice(0, QUOTE_MAX).join('').trimEnd() + QUOTE_CUT_MARK : text;
  return { block: kept.split('\n').map(line => (line ? `> ${line}` : '>')).join('\n'), truncated };
}

/**
 * A quote for a selection that starts and ends inside one quotable answer body; null for a
 * collapsed selection, one that spans messages, or one in the composer or any other UI.
 */
export function quoteFromSelection(selection: QuoteSelection | null | undefined): AnswerQuote | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const start = quoteScopeOf(selection.anchorNode);
  if (!start || quoteScopeOf(selection.focusNode) !== start) return null;
  const quoted = toQuoteBlock(selection.toString());
  return quoted && { messageId: start, ...quoted };
}

/**
 * The draft with the quote block appended, followed by a blank line for the reply. The existing
 * draft is kept byte for byte as the prefix; only the separator before the block is added.
 */
export function mergeQuoteIntoDraft(draft: string, block: string): string {
  if (!draft) return `${block}\n\n`;
  const separator = draft.endsWith('\n\n') ? '' : draft.endsWith('\n') ? '\n' : '\n\n';
  return `${draft}${separator}${block}\n\n`;
}
