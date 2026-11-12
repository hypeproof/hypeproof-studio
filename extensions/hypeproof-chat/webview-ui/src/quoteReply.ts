/**
 * CGP-CHAT-R-007 (REQ-STUDIO-QUOTE-REPLY): quote part of one answer into the next message.
 * Pure logic only: which selection counts, which text in it is answer text, how it becomes a `> `
 * block, how that block joins the draft (CGP-CHAT-D-007: a removable chip at the start of the
 * draft) and where the popover goes. Nothing here sends anything.
 */
import { normalizeDraft, type DraftPart } from './pastedDraft';

export const QUOTE_LABEL = '인용하기';
/** Longest quote, in characters (grapheme clusters), before it is cut. */
export const QUOTE_MAX = 1000;
/** Appended to a cut quote, so the draft itself shows that text was left out. */
export const QUOTE_CUT_MARK = '…';
/** Shown next to the button when the selection is longer than QUOTE_MAX. */
export const QUOTE_CUT_NOTE = '앞 1,000자만 들어가요';
/** Set on the body of an answer that may be quoted; the value is the message id. */
export const QUOTE_SCOPE_ATTR = 'data-quote-answer';
/** Set on the whole message row of a quotable answer; the value is the message id. */
export const QUOTE_ROW_ATTR = 'data-quote-row';
/** Set on UI inside an answer (tool rows, notes) whose text is never answer text. */
export const QUOTE_SKIP_ATTR = 'data-quote-skip';

/** The DOM surface this module reads: a node tree and a selection range. */
export interface QuoteNode {
  nodeType: number;
  parentNode: QuoteNode | null;
  childNodes: ArrayLike<QuoteNode>;
  nextSibling?: QuoteNode | null;
  nodeName?: string;
  data?: string;
  getAttribute?(name: string): string | null;
}
export interface QuoteRange { startContainer: QuoteNode; startOffset: number; endContainer: QuoteNode; endOffset: number }
export interface QuoteSelection {
  isCollapsed?: boolean;
  rangeCount?: number;
  getRangeAt?(index: number): QuoteRange;
}

/** The selected range's line boxes, kept with the quote so the popover can follow scrolling without reading the selection again. */
export interface QuoteRangeRects { getClientRects(): ArrayLike<{ top: number; bottom: number; left: number; right: number; width: number; height: number }> }
export interface AnswerQuote { messageId: string; block: string; truncated: boolean; range?: QuoteRangeRects }

type Point = { node: QuoteNode; offset: number };

const attr = (n: QuoteNode, name: string) => (n.nodeType === 1 ? n.getAttribute?.(name) ?? null : null);
const indexIn = (n: QuoteNode) => (n.parentNode ? Array.prototype.indexOf.call(n.parentNode.childNodes, n) : 0);
const childCount = (n: QuoteNode) => (n.nodeType === 3 ? (n.data ?? '').length : n.childNodes.length);
const tag = (n: QuoteNode) => (n.nodeName ?? '').toUpperCase();

/** The nearest element at or above `node` that carries `name`, or null. */
function closestWith(node: QuoteNode | null, name: string): QuoteNode | null {
  for (let n = node; n; n = n.parentNode) if (attr(n, name)) return n;
  return null;
}

/** The id of the quotable answer body that contains `node`, or null. */
export function quoteScopeOf(node: QuoteNode | null): string | null {
  const body = closestWith(node, QUOTE_SCOPE_ATTR);
  return body ? attr(body, QUOTE_SCOPE_ATTR) : null;
}

/**
 * Document-order comparison of two boundary points inside `root` (negative: a is before b). Paths
 * stop at `root`, so the cost depends on the answer's own tree, never on the conversation's length.
 */
function comparePoints(root: QuoteNode, a: Point, b: Point): number {
  const path = (p: Point) => {
    const out = [p.offset];
    for (let n = p.node; n !== root && n.parentNode; n = n.parentNode) out.unshift(indexIn(n));
    return out;
  };
  const pa = path(a); const pb = path(b);
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return pa.length - pb.length;
}

/** True when `point` is the very first position inside `el` (offset 0 down a chain of first children). */
function atStartOf(point: Point, el: QuoteNode): boolean {
  if (point.offset !== 0) return false;
  for (let n = point.node; n !== el; n = n.parentNode!) if (!n.parentNode || n.parentNode.childNodes[0] !== n) return false;
  return true;
}

/** The next sibling element of `n` (in a browser an O(1) pointer). */
function nextElement(n: QuoteNode): QuoteNode | null {
  let next = n.nextSibling ?? null;
  while (next && next.nodeType !== 1) next = next.nextSibling ?? null;
  return next;
}

/** UI inside an answer whose text is not answer text: controls, hidden marks, status lines. */
function skipped(n: QuoteNode): boolean {
  if (n.nodeType !== 1) return false;
  const name = tag(n);
  return name === 'BUTTON' || attr(n, QUOTE_SKIP_ATTR) !== null || attr(n, 'aria-hidden') === 'true' || attr(n, 'role') === 'status';
}
const PARAGRAPH = new Set(['P', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'BLOCKQUOTE', 'TABLE', 'HR']);
const LINE = new Set(['LI', 'DIV', 'TR', 'BR', 'SECTION', 'DL', 'DT', 'DD']);
const CELL = new Set(['TD', 'TH']);
/** Containers whose whitespace-only text is markup layout (react-markdown's "\n" between items), not text. */
const STRUCTURE = new Set(['UL', 'OL', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR']);
/** Separator strength: a cell gap is weaker than a line break, which is weaker than a blank line. */
const RANK: Record<string, number> = { '': 0, ' | ': 1, '\n': 2, '\n\n': 3 };

/**
 * The answer text between `start` and `end` inside `root`, walking text nodes in order. Skipped UI
 * contributes nothing (a code block counts as its code, never its tool row or a pill's toggle; a
 * collapsed pill has no code in the page and adds nothing); block elements become line breaks (a
 * paragraph-level block a blank line), table cells are joined with ` | `, and outside `<pre>` a
 * newline inside text (a Markdown soft break, drawn as a space) becomes a space.
 */
export function answerTextBetween(root: QuoteNode, start: Point, end: Point): string {
  let out = '';
  let pending = '';
  const emit = (text: string) => {
    if (!text) return;
    if (out && pending) out += pending;
    pending = '';
    out += text;
  };
  const brk = (sep: string) => { if (RANK[sep] > RANK[pending]) pending = sep; };
  const walk = (n: QuoteNode, pre: boolean) => {
    if (n.nodeType === 3) {
      const data = n.data ?? '';
      if (!data.trim() && n.parentNode && STRUCTURE.has(tag(n.parentNode))) return;
      const len = childCount(n);
      const s = comparePoints(root, { node: n, offset: 0 }, start) >= 0 ? 0 : start.node === n ? start.offset : len;
      const e = comparePoints(root, { node: n, offset: len }, end) <= 0 ? len : end.node === n ? end.offset : 0;
      if (e > s) emit(pre ? data.slice(s, e) : data.slice(s, e).replace(/[ \t]*\n[ \t]*/g, ' '));
      return;
    }
    if (n.nodeType !== 1 || skipped(n)) return;
    const name = tag(n);
    if (CELL.has(name)) brk(' | ');
    const sep = PARAGRAPH.has(name) ? '\n\n' : LINE.has(name) ? '\n' : '';
    if (sep) brk(sep);
    if (name === 'BR') return;
    for (const c of Array.from(n.childNodes)) walk(c, pre || name === 'PRE');
    if (sep) brk(sep);
  };
  for (const c of Array.from(root.childNodes)) walk(c, false);
  return out;
}

/** Grapheme clusters when the runtime can segment them (composed emoji, NFD Hangul), else code points. */
function graphemes(text: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  return Seg ? Array.from(new Seg(undefined, { granularity: 'grapheme' }).segment(text), s => s.segment) : Array.from(text);
}

/** Selected text as a `> ` block, capped at QUOTE_MAX characters. Null when nothing is left. */
export function toQuoteBlock(raw: string): { block: string; truncated: boolean } | null {
  const text = raw.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\s+$/g, '');
  if (!text.trim()) return null;
  const chars = graphemes(text);
  const truncated = chars.length > QUOTE_MAX;
  const kept = truncated ? chars.slice(0, QUOTE_MAX).join('').trimEnd() + QUOTE_CUT_MARK : text;
  return { block: kept.split('\n').map(line => (line ? `> ${line}` : '>')).join('\n'), truncated };
}

/**
 * A quote for a selection that starts inside one quotable answer body. The end is clamped to that
 * body when it lies elsewhere in the same message row (a triple-click on the last paragraph ends
 * in the citations or the answer's actions) or at the very start of the element right after that
 * row (a triple-click ends at the start of the next block). Null for a collapsed selection, one
 * that starts outside an answer, or one that reaches text in another message, the composer or
 * other UI. Clamping only looks up the end's ancestors, and the text walk stays inside the answer
 * body, so a selectionchange costs the same in a 300-answer conversation as in a short one.
 */
export function quoteFromSelection(selection: QuoteSelection | null | undefined): AnswerQuote | null {
  if (!selection || selection.isCollapsed || !selection.rangeCount || !selection.getRangeAt) return null;
  const range = selection.getRangeAt(0);
  const body = closestWith(range.startContainer, QUOTE_SCOPE_ATTR);
  if (!body) return null;
  const id = attr(body, QUOTE_SCOPE_ATTR)!;
  const start: Point = { node: range.startContainer, offset: range.startOffset };
  let end: Point = { node: range.endContainer, offset: range.endOffset };
  if (closestWith(end.node, QUOTE_SCOPE_ATTR) !== body) {
    const row = closestWith(body, QUOTE_ROW_ATTR) ?? body;
    const endRow = closestWith(end.node, QUOTE_ROW_ATTR);
    const next = endRow === row ? null : nextElement(row);
    if (endRow !== row && !(next && atStartOf(end, next))) return null;
    end = { node: body, offset: body.childNodes.length };
  }
  const quoted = toQuoteBlock(answerTextBetween(body, start, end));
  return quoted && { messageId: id, ...quoted };
}

/**
 * CGP-CHAT-D-007 — the draft with the quote as its first part: a hidden part (like a folded paste)
 * drawn as the quote chip, so the editor keeps exactly what the learner typed. Sending, queueing
 * and saving use the full draft, so the message starts with the `> ` block and a blank line. One
 * quote at a time: a new quote replaces the chip, never the typed text.
 */
export function withQuote(parts: DraftPart[], block: string, id: number): DraftPart[] {
  return normalizeDraft([{ text: `${block}\n\n`, id, quote: true }, ...parts.filter(part => !part.quote)]);
}

/** The chip's text: the quote without its `> ` marks, its lines joined by a space (the chip shows two lines). */
export function quoteChipText(part: DraftPart): string {
  return part.text.split('\n').map(line => line.replace(/^>[ ]?/, '').trim()).filter(Boolean).join(' ');
}

/** CGP-CHAT-D-007 — the popover goes below the selection when the selection's top is closer than this to the top of the conversation. */
export const QUOTE_FLIP_MIN = 48;
/** Space between the selection and the popover. */
export const QUOTE_GAP = 2;

export interface QuoteBox { top: number; bottom: number; left: number; right: number }
export interface QuotePlacement { side: 'above' | 'below'; top: number; left: number }

/**
 * Where the popover goes, in viewport coordinates. `first` and `last` are the selection's top and
 * bottom line boxes, `view` the visible part of the conversation, `row` the answer's row (the
 * horizontal bounds) and `size` the popover. Above the first line, centred on it; below the last
 * line when the space above is under QUOTE_FLIP_MIN (or under the popover's own height). While the
 * selection is in view the popover is kept inside the view, so it never sits under the header or
 * the composer; a selection scrolled out of view takes its popover with it.
 */
export function placeQuote(first: QuoteBox, last: QuoteBox, view: QuoteBox, row: QuoteBox, size: { width: number; height: number }): QuotePlacement {
  const side = first.top - view.top >= Math.max(QUOTE_FLIP_MIN, size.height + QUOTE_GAP) ? 'above' : 'below';
  let top = side === 'above' ? first.top - QUOTE_GAP - size.height : last.bottom + QUOTE_GAP;
  if (last.bottom > view.top && first.top < view.bottom) top = Math.max(view.top, Math.min(top, view.bottom - size.height));
  const anchor = side === 'above' ? first : last;
  const left = Math.max(row.left, Math.min((anchor.left + anchor.right - size.width) / 2, row.right - size.width));
  return { side, top, left };
}
