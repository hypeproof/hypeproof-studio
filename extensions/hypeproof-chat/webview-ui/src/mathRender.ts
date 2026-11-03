// CGP-CHAT-R-022 (REQ-STUDIO-ANSWER-MATH): `$…$` and `$$…$$` in an answer render as math.
// remark-math finds the spans; this rehype step typesets them with the bundled KaTeX and leaves a
// placeholder that MarkdownText renders as React elements built from KaTeX's hast (no innerHTML). KaTeX never grants
// trust (no \href, \url, \includegraphics, \html*): a formula that asks for it, anything KaTeX
// refuses, and a lone `$` that reads like money ("$5이고 $10") stay the exact raw source as plain
// text. KaTeX itself (mathTypeset.ts) is a separate chunk loaded on the first math span, so an
// answer without math pays nothing. Fonts come from the bundled katex.css via the webview's own
// cspSource; nothing is fetched from the network.
import type { ReactNode } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';

type Pos = { start?: { offset?: number }; end?: { offset?: number } };
export type HNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HNode[];
  position?: Pos;
};

/** Longer TeX is shown raw: typesetting cost grows with input, and an answer is not a paper. */
export const MAX_TEX_LENGTH = 4000;
/** Per rendered text: at most this many formulas are typeset; later ones stay raw. */
export const MAX_FORMULAS_PER_TEXT = 200;
/** Per rendered text: at most this much TeX in total is typeset; later formulas stay raw. With
 * MAX_TEX_LENGTH this bounds one render's typesetting no matter what the model writes. */
export const MAX_TEX_CHARS_PER_TEXT = 8000;
/** Typeset results kept for reuse, so a streamed answer typesets each finished formula once. */
export const TYPESET_CACHE_SIZE = 256;
/** Accessible name of a display-math block (a keyboard-scrollable region). */
export const MATH_BLOCK_LABEL = '수식';

const classesOf = (node: HNode): string[] => {
  const c = node.properties?.className;
  return Array.isArray(c) ? c.map(String) : typeof c === 'string' ? c.split(/\s+/) : [];
};
const textOf = (node: HNode): string =>
  node.type === 'text' ? node.value ?? '' : (node.children ?? []).map(textOf).join('');

// ---------- Lazy KaTeX ----------
type Typeset = (tex: string, display: boolean) => HNode[] | null;
let typesetter: Typeset | null = null;
let loading: Promise<void> | null = null;
let loadedVersion = 0;
const listeners = new Set<() => void>();

/** Load KaTeX (once). Renders before it resolves show math spans as their raw source; when it
 * resolves, every subscribed MarkdownText renders again with the formulas typeset. */
export function loadMath(): Promise<void> {
  loading ??= import('./mathTypeset').then(
    m => { typesetter = m.typesetUncached; loadedVersion++; listeners.forEach(l => l()); },
    () => { loading = null; }, // the raw source stays; a later math span retries
  );
  return loading;
}
/** useSyncExternalStore pair: changes once, when KaTeX has loaded. */
export const subscribeMath = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const mathVersion = () => loadedVersion;

// ---------- Typeset cache (LRU) ----------
// One entry per (mode, TeX): KaTeX's hast, and the React elements built from it on first use.
// React elements are immutable, so every render of the same formula reuses them, and the memoised
// <MathFormula> in MarkdownText skips re-rendering a finished formula while later text streams in.
type Entry = { nodes: HNode[] | null; element?: ReactNode };
const cache = new Map<string, Entry>();
let typesetCalls = 0;
/** How many times KaTeX actually ran (cache misses), for tests that bound streaming cost. */
export const typesetCallCount = () => typesetCalls;
let mathElementCalls = 0;
/** How many times a formula was rendered by React (MathFormula renders), for streaming tests. */
export const mathElementCallCount = () => mathElementCalls;
export const clearTypesetCache = () => { cache.clear(); };

function entryFor(tex: string, display: boolean): Entry | null {
  if (!tex.trim() || tex.length > MAX_TEX_LENGTH) return null;
  if (!typesetter) { void loadMath(); return null; }
  const key = (display ? 'D' : 'I') + '\u0000' + tex;
  let entry = cache.get(key);
  if (!entry) {
    typesetCalls++;
    entry = { nodes: typesetter(tex, display) };
    if (cache.size >= TYPESET_CACHE_SIZE) cache.delete(cache.keys().next().value!);
  } else {
    cache.delete(key); // re-inserted below: most recently used last
  }
  cache.set(key, entry);
  return entry;
}

/** KaTeX's hast for `tex` (shared, do not mutate), or null when it must stay raw: KaTeX refused
 * it (invalid TeX, or a command that asks for trust), it is too long or empty, or KaTeX has not
 * loaded yet (the load starts here). */
export function typesetTex(tex: string, display: boolean): HNode[] | null {
  return entryFor(tex, display)?.nodes ?? null;
}

/** The typeset formula as React elements (cached), or null when it must stay raw. */
export function mathElement(tex: string, display: boolean): ReactNode {
  mathElementCalls++;
  const entry = entryFor(tex, display);
  if (!entry?.nodes) return null;
  entry.element ??= toJsxRuntime({ type: 'root', children: entry.nodes } as never, { Fragment, jsx, jsxs, ignoreInvalidStyle: true });
  return entry.element;
}

/** Placeholder the rehype step leaves for a typeset formula; MarkdownText maps it to <MathFormula>. */
export const MATH_TAG = 'hps-math';
const placeholder = (tex: string, display: boolean): HNode => ({
  type: 'element', tagName: MATH_TAG, properties: { dataTex: tex, dataDisplay: display ? 'true' : 'false' }, children: [],
});

/** Pandoc's rule for a single `$`: no space just inside either dollar, no digit right after the
 * closing one. Keeps "가격은 $5이고 $10이에요" as text. `$$…$$` is always meant as math. */
export function looksLikeInlineMath(raw: string, after: string): boolean {
  if (raw.startsWith('$$')) return true;
  // Read the source, not the parsed value: the parser trims one space inside each dollar.
  return raw.length > 2 && !/^\$\s|\s\$$/.test(raw) && !/^[0-9]/.test(after);
}

const rawText = (value: string): HNode => ({
  type: 'element', tagName: 'span', properties: { className: ['hps-math-raw'] }, children: [{ type: 'text', value }],
});

/** A display formula: a labelled, keyboard-scrollable region; or the raw source when refused. */
const displayBlock = (rendered: HNode[] | null, raw: string): HNode => rendered
  ? { type: 'element', tagName: 'div', properties: { className: ['hps-math-block'], role: 'region', ariaLabel: MATH_BLOCK_LABEL, tabIndex: 0 }, children: rendered }
  : { type: 'element', tagName: 'div', properties: { className: ['hps-math-block', 'hps-math-block-raw'] }, children: [rawText(raw)] };

const isMath = (node: HNode | undefined, kind: 'math-inline' | 'math-display') =>
  node?.type === 'element' && node.tagName === 'code' && classesOf(node).includes(kind);

/** Rehype plugin: replace remark-math's `code.math-inline` / `pre > code.math-display` nodes. */
export function rehypeAnswerMath() {
  return (tree: HNode, file: { value?: unknown }) => {
    const source = typeof file.value === 'string' ? file.value : String(file.value ?? '');
    const slice = (node: HNode, fallback: string) => {
      const s = node.position?.start?.offset, e = node.position?.end?.offset;
      return s != null && e != null && e <= source.length ? source.slice(s, e) : fallback;
    };
    // Per-text budget: counted for cached formulas too, so the result depends on the text only.
    let formulas = 0, chars = 0;
    const budgeted = (tex: string, display: boolean): HNode[] | null => {
      formulas++;
      chars += tex.length;
      if (formulas > MAX_FORMULAS_PER_TEXT || chars > MAX_TEX_CHARS_PER_TEXT) return null;
      return typesetTex(tex, display) ? [placeholder(tex, display)] : null;
    };
    const visit = (parent: HNode) => {
      const kids = parent.children;
      if (!kids) return;
      for (let i = 0; i < kids.length; i++) {
        const node = kids[i];
        if (node.type !== 'element') continue;
        // ```$$ … $$``` on its own lines.
        const code = node.tagName === 'pre' && node.children?.length === 1 ? node.children[0] : undefined;
        if (isMath(code, 'math-display')) {
          const tex = textOf(code!);
          kids[i] = displayBlock(budgeted(tex, true), slice(node, `$$\n${tex}\n$$`));
          continue;
        }
        // `$$x$$` alone in its paragraph is a display formula written on one line.
        const only = node.tagName === 'p' ? node.children?.filter(k => k.type !== 'text' || (k.value ?? '').trim()) : undefined;
        if (only?.length === 1 && isMath(only[0], 'math-inline')) {
          const raw = slice(only[0], '');
          if (raw.startsWith('$$')) {
            kids[i] = displayBlock(budgeted(textOf(only[0]), true), raw);
            continue;
          }
        }
        if (isMath(node, 'math-inline')) {
          const tex = textOf(node);
          const raw = slice(node, `$${tex}$`);
          const end = node.position?.end?.offset;
          const after = end == null ? '' : source.slice(end, end + 1);
          const rendered = looksLikeInlineMath(raw, after) ? budgeted(tex, false) : null;
          kids[i] = rendered
            ? { type: 'element', tagName: 'span', properties: { className: ['hps-math-inline'] }, children: rendered }
            : rawText(raw);
          continue;
        }
        visit(node);
      }
    };
    visit(tree);
  };
}

const TEX_ANNOTATION = 'annotation[encoding="application/x-tex"]';

/** Replace every rendered formula in `fragment` with its TeX source: `$$…$$` for display math,
 * `$…$` inline. Returns the plain text of the result. */
export function mathCopyText(fragment: DocumentFragment): string {
  const doc = fragment.ownerDocument;
  const swap = (el: Element, open: string, close: string) => {
    const tex = el.querySelector(TEX_ANNOTATION)?.textContent;
    if (tex != null) el.replaceWith(doc.createTextNode(`${open}${tex}${close}`));
  };
  fragment.querySelectorAll('.katex-display').forEach(el => swap(el, '$$', '$$'));
  fragment.querySelectorAll('.katex').forEach(el => swap(el, '$', '$'));
  return fragment.textContent ?? '';
}

let installedOn: Document | null = null;
/** One document-level copy listener. A selection that touches no formula copies as usual. A
 * selection that starts or ends inside a formula grows to the whole formula, so a half-selected
 * formula never copies as broken glyph text. */
export function installMathCopy(doc: Document): void {
  if (installedOn === doc || typeof doc.addEventListener !== 'function') return;
  installedOn = doc;
  doc.addEventListener('copy', (event: ClipboardEvent) => {
    const selection = doc.getSelection?.();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !event.clipboardData) return;
    const range = selection.getRangeAt(0).cloneRange();
    const formulaOf = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest('.katex');
    const start = formulaOf(range.startContainer);
    if (start) range.setStartBefore(start.closest('.katex-display') ?? start);
    const end = formulaOf(range.endContainer);
    if (end) range.setEndAfter(end.closest('.katex-display') ?? end);
    const fragment = range.cloneContents();
    if (!fragment.querySelector('.katex-mathml')) return;
    // Plain text only: pasted anywhere, the formula arrives as the TeX it was written in.
    event.clipboardData.setData('text/plain', mathCopyText(fragment));
    event.preventDefault();
  });
}
