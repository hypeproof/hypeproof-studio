/**
 * CGP-CHAT-R-027 (REQ-STUDIO-CHAT-FIND) - find-in-chat over the open conversation.
 *
 * Plain text, case-insensitive, no regular expressions. The search reads the message bodies
 * (`.hps-msg-body`) of the conversation on screen, in document order. It never edits the DOM:
 * matches are painted with the CSS Custom Highlight API, so React rendering, streaming and the
 * chat's scroll-anchoring rules are untouched.
 *
 * A collapsed code pill has no code in the DOM. It registers its code here; its matches are
 * counted and, when the learner moves to one, the pill opens and the match is shown in place.
 */

/** Longest query kept; longer input is cut, never searched in full. */
export const FIND_QUERY_MAX = 200;

/** Interface chrome inside a message body that is not conversation text. */
const SKIP = 'button, input, textarea, select, script, style, [aria-hidden="true"], .hps-sr-only, '
  + '[role="status"], [role="alert"], [data-quote-skip], .hps-response-pending, .hps-code-progress';
/** Text in one of these (nearest) belongs to one searchable run; matches never cross runs. */
const BLOCK = 'p, li, pre, h1, h2, h3, h4, h5, h6, td, th, blockquote, dt, dd, summary, figcaption, div';

type Closed = { text: string; open: () => void };
const closedText = new WeakMap<Element, Closed>();

/** A collapsed region (code pill) whose text is not in the DOM. Returns the unregister. */
export function registerClosedText(element: Element, text: string, open: () => void) {
  closedText.set(element, { text, open });
  return () => { if (closedText.get(element)?.open === open) closedText.delete(element); };
}

export function openClosed(element: Element) { closedText.get(element)?.open(); }

/**
 * Controls (C0/C1), bidi marks/embeddings/isolates, line/paragraph separators and the BOM are
 * dropped: a pasted query can carry them, and none of them can be found as visible text.
 */
const INVISIBLE = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069\\u2028\\u2029\\ufeff]', 'g');
export function normalizeFindQuery(raw: string) {
  const cut = raw.replace(INVISIBLE, '').slice(0, FIND_QUERY_MAX);
  // Never leave half of a surrogate pair at the cut.
  return /[\ud800-\udbff]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/** Case folding that keeps every UTF-16 offset: a character whose lower case changes length stays as is. */
export function foldCase(text: string) {
  let out = '';
  for (const ch of text) {
    const lower = ch.toLowerCase();
    out += lower.length === ch.length ? lower : ch;
  }
  return out;
}

/** Start offsets of every non-overlapping occurrence of `query` in `text`, case-insensitive. */
export function findOffsets(text: string, query: string) {
  const out: number[] = [];
  if (!query) return out;
  const hay = foldCase(text), needle = foldCase(query);
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) out.push(at);
  return out;
}

export type FindHit =
  | { kind: 'range'; range: Range }
  | { kind: 'closed'; element: Element; nth: number };

type TextRun = { kind: 'text'; nodes: Text[]; starts: number[]; text: string; block: Element | null };
type Run = TextRun | { kind: 'closed'; element: Element; text: string };

function collect(node: Node, runs: Run[]) {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = (child as Text).data;
      if (!text) continue;
      const block = child.parentElement?.closest(BLOCK) ?? null;
      const last = runs[runs.length - 1];
      if (last?.kind === 'text' && last.block === block) {
        last.starts.push(last.text.length); last.nodes.push(child as Text); last.text += text;
      } else runs.push({ kind: 'text', nodes: [child as Text], starts: [0], text, block });
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const element = child as Element;
      // A line break or skipped chrome ends the run: no match across them.
      if (element.matches(SKIP) || element.tagName === 'BR') { runs.push({ kind: 'text', nodes: [], starts: [], text: '', block: element }); continue; }
      const closed = closedText.get(element);
      if (closed) { runs.push({ kind: 'closed', element, text: closed.text }); continue; }
      collect(element, runs);
    }
  }
}

function locate(run: TextRun, offset: number, end: boolean): [Text, number] {
  // The last node that starts before (or, for an end, strictly before) the offset.
  let i = run.starts.length - 1;
  while (i > 0 && (end ? run.starts[i] >= offset : run.starts[i] > offset)) i--;
  return [run.nodes[i], offset - run.starts[i]];
}

/** Every match of `query` in the message bodies under `root`, in reading order. */
export function findHits(root: Element, query: string): FindHit[] {
  const hits: FindHit[] = [];
  if (!query.trim()) return hits;
  for (const body of Array.from(root.querySelectorAll('.hps-msg-body'))) {
    const runs: Run[] = [];
    collect(body, runs);
    for (const run of runs) {
      const offsets = findOffsets(run.text, query);
      if (run.kind === 'closed') { offsets.forEach((_, nth) => hits.push({ kind: 'closed', element: run.element, nth })); continue; }
      for (const at of offsets) {
        const range = document.createRange();
        const [startNode, startOffset] = locate(run, at, false);
        const [endNode, endOffset] = locate(run, at + query.length, true);
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);
        hits.push({ kind: 'range', range });
      }
    }
  }
  return hits;
}

const HIGHLIGHT_ALL = 'hp-find';
const HIGHLIGHT_CURRENT = 'hp-find-current';

type HighlightRegistry = { set(name: string, value: unknown): void; delete(name: string): void };
type HighlightCtor = new (...ranges: Range[]) => unknown;
function api(): { reg: HighlightRegistry; Highlight: HighlightCtor } | null {
  const g = globalThis as unknown as { CSS?: { highlights?: HighlightRegistry }; Highlight?: HighlightCtor };
  return g.CSS?.highlights && typeof g.Highlight === 'function' ? { reg: g.CSS.highlights, Highlight: g.Highlight } : null;
}

/** Paint matches; the current one gets its own highlight. Without the API nothing is painted. */
export function paintHits(hits: FindHit[], current: number) {
  const a = api();
  if (!a) return;
  const others: Range[] = [];
  let active: Range | null = null;
  hits.forEach((hit, i) => {
    if (hit.kind !== 'range') return;
    if (i === current) active = hit.range; else others.push(hit.range);
  });
  a.reg.set(HIGHLIGHT_ALL, new a.Highlight(...others));
  if (active) a.reg.set(HIGHLIGHT_CURRENT, new a.Highlight(active)); else a.reg.delete(HIGHLIGHT_CURRENT);
}

export function clearHits() {
  const a = api();
  a?.reg.delete(HIGHLIGHT_ALL);
  a?.reg.delete(HIGHLIGHT_CURRENT);
}

/**
 * Bring a match into view inside the conversation scroller. Closed <details> around it open first.
 * Only the scroller (and a horizontally scrolling code block) moves; nothing else is focused.
 * `topInset` is the find bar's height, which covers the top of the scroller.
 */
export function revealRange(range: Range, scroller: HTMLElement, topInset: number, beforeScroll?: () => void) {
  for (let el = range.startContainer.parentElement; el && el !== scroller; el = el.parentElement) {
    if (el instanceof HTMLDetailsElement && !el.open) el.open = true;
  }
  const rect = range.getBoundingClientRect();
  for (let el = range.startContainer.parentElement; el && el !== scroller; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth && /auto|scroll/.test(getComputedStyle(el).overflowX)) {
      const box = el.getBoundingClientRect();
      if (rect.left < box.left || rect.right > box.right) el.scrollLeft += rect.left - box.left - (box.width - rect.width) / 2;
    }
  }
  const after = range.getBoundingClientRect();
  const view = scroller.getBoundingClientRect();
  if (after.top >= view.top + topInset && after.bottom <= view.bottom) return false;
  beforeScroll?.();
  scroller.scrollTop += after.top - view.top - topInset - Math.max(0, (view.height - topInset - after.height) / 2);
  return true;
}
