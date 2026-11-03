// CGP-ART-R-006 (REQ-ART-06) — style tweak for a picked element. Pure and vscode-free.
//
// After the learner picks an element (CR-09), they can try a small set of style values on it:
// text colour, background, font size, spacing (padding) and corner radius. The values are
// shown live in the preview tab only (an inline style on the live DOM node, through CDP), never
// written to a file. The chosen values then go to the coach as a structured edit request inside
// the picked element's text block; the coach makes the change in the source. This tool never
// writes CSS itself.
//
// What this module owns:
//   - the offered value sets (page colours, fixed px steps) and the validation that refuses any
//     value outside them (REQ-ART-06 negative);
//   - the learner's choices, bound to one tweak id (one pick of one document generation);
//   - the exact request text (property, old value, new value per change) and the visible send text;
//   - the two page-side functions run on the picked node: read the facts, apply the whole state.

export const STYLE_TWEAK_PROPS = ["color", "background-color", "font-size", "padding", "border-radius"] as const;
export type StyleTweakProp = (typeof STYLE_TWEAK_PROPS)[number];

/** Row labels, in the design row's order (DES-ART-06: 색, 배경, 글자 크기, 간격, 모서리). */
export const STYLE_TWEAK_LABELS: Record<StyleTweakProp, string> = {
  color: "색",
  "background-color": "배경",
  "font-size": "글자 크기",
  padding: "간격",
  "border-radius": "모서리",
};

/** The px steps a stepper moves through. A value outside them cannot be chosen. */
export const STYLE_TWEAK_STEPS: Record<"font-size" | "padding" | "border-radius", readonly number[]> = {
  "font-size": [12, 14, 16, 18, 20, 24, 28, 32, 40, 48],
  padding: [0, 4, 8, 12, 16, 24, 32, 48],
  "border-radius": [0, 4, 8, 12, 16, 24, 32],
};

/** One page call of the tweak (read or apply) gives up after this long. */
export const STYLE_TWEAK_CALL_MS = 2000;

/** At most this many swatches from "이 페이지에 쓰인 색". */
export const PAGE_COLOR_MAX = 8;
/** Longest computed value kept as an "old value"; anything longer is unknown. */
const VALUE_MAX = 60;
export const UNKNOWN_VALUE = "알 수 없음";

export type StyleTweakKind = "color" | "step";
const kindOf = (p: StyleTweakProp): StyleTweakKind => (p === "color" || p === "background-color" ? "color" : "step");

/**
 * A computed colour as the browser reports it, canonicalised to `rgb(r, g, b)` or
 * `rgba(r, g, b, a)`. Anything else (other colour spaces, keywords, junk from a hostile page)
 * is null: it is never offered and never echoed into the request.
 */
export function normalizeColor(value: unknown): string | null {
  if (typeof value !== "string" || value.length > VALUE_MAX) return null;
  const m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(0|1|0?\.\d{1,4}|1\.0+)\s*)?\)$/.exec(value.trim());
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map(Number);
  if (r > 255 || g > 255 || b > 255) return null;
  if (m[4] === undefined || Number(m[4]) === 1) return `rgb(${r}, ${g}, ${b})`;
  return `rgba(${r}, ${g}, ${b}, ${Number(m[4])})`;
}

const isTransparent = (c: string) => /^rgba\(.*, 0\)$/.test(c);

/** A computed length (`16px`, or a 1–4 part shorthand like `8px 16px`). Otherwise null. */
export function normalizeLength(value: unknown): string | null {
  if (typeof value !== "string" || value.length > VALUE_MAX) return null;
  const v = value.trim().replace(/\s+/g, " ");
  return /^\d{1,4}(?:\.\d{1,3})?px(?: \d{1,4}(?:\.\d{1,3})?px){0,3}$/.test(v) ? v : null;
}

/** What the page-side read returns for the picked node (STYLE_TWEAK_READ). */
export interface StyleTweakFacts {
  current: Partial<Record<StyleTweakProp, unknown>>;
  /** The node's `style` attribute before any preview, or null when it had none. */
  styleAttr: unknown;
  /** Computed colours seen on the page, most used first. */
  pageColors: unknown;
}

export interface StyleTweakRowState {
  prop: StyleTweakProp;
  /** Normalized computed value, or UNKNOWN_VALUE. */
  current: string;
  options: string[];
  chosen: string | null;
}

export interface StyleTweakState {
  id: string;
  backendNodeId: number;
  documentGeneration: string;
  /** Restored exactly on reset; the preview is always "original attribute + chosen values". */
  styleAttr: string | null;
  rows: StyleTweakRowState[];
}

const px = (n: number) => `${n}px`;

/** Build the offer for one picked node. Page data is untrusted: only normalized values survive. */
export function buildStyleTweak(id: string, node: { backendNodeId: number; documentGeneration: string }, facts: StyleTweakFacts): StyleTweakState {
  const seen = new Set<string>();
  const colors: string[] = [];
  for (const raw of Array.isArray(facts.pageColors) ? facts.pageColors.slice(0, 200) : []) {
    const c = normalizeColor(raw);
    if (!c || isTransparent(c) || seen.has(c)) continue;
    seen.add(c);
    colors.push(c);
    if (colors.length >= PAGE_COLOR_MAX) break;
  }
  const rows = STYLE_TWEAK_PROPS.map((prop): StyleTweakRowState => {
    const raw = facts.current?.[prop];
    const norm = kindOf(prop) === "color" ? normalizeColor(raw) : normalizeLength(raw);
    const options = kindOf(prop) === "color" ? [...colors] : STYLE_TWEAK_STEPS[prop as keyof typeof STYLE_TWEAK_STEPS].map(px);
    return { prop, current: norm ?? UNKNOWN_VALUE, options, chosen: null };
  });
  const attr = typeof facts.styleAttr === "string" ? facts.styleAttr : null;
  return { id, backendNodeId: node.backendNodeId, documentGeneration: node.documentGeneration, styleAttr: attr, rows };
}

export type ChooseResult = { ok: true; state: StyleTweakState } | { ok: false; reason: string };

/**
 * The learner chose `value` for `prop` (null = reset that property). Refused when the tweak id
 * is not the current one (a stale panel, another pick) or the value is not one of the offered
 * ones. Choosing the current value is the same as a reset.
 */
export function chooseStyle(state: StyleTweakState | null, id: unknown, prop: unknown, value: unknown): ChooseResult {
  if (!state || id !== state.id) return { ok: false, reason: "stale" };
  const row = state.rows.find((r) => r.prop === prop);
  if (!row) return { ok: false, reason: "unknown_property" };
  if (value !== null && (typeof value !== "string" || !row.options.includes(value))) return { ok: false, reason: "not_offered" };
  const chosen = value === null || value === row.current ? null : value;
  return { ok: true, state: { ...state, rows: state.rows.map((r) => (r === row ? { ...r, chosen } : r)) } };
}

/** Clear every choice (the page went away, or the learner removed the element). */
export function resetAll(state: StyleTweakState): StyleTweakState {
  return { ...state, rows: state.rows.map((r) => ({ ...r, chosen: null })) };
}

export interface StyleChange {
  property: StyleTweakProp;
  old: string;
  new: string;
}

export function styleChanges(state: StyleTweakState | null): StyleChange[] {
  return (state?.rows ?? []).filter((r) => r.chosen !== null).map((r) => ({ property: r.prop, old: r.current, new: r.chosen! }));
}

/** The values the preview applies on the node: only the chosen ones. */
export function previewValues(state: StyleTweakState): Partial<Record<StyleTweakProp, string>> {
  const out: Partial<Record<StyleTweakProp, string>> = {};
  for (const c of styleChanges(state)) out[c.property] = c.new;
  return out;
}

/**
 * The block the coach receives after the element's own text: one JSON line per change with
 * property, old value and new value. Empty when nothing is chosen.
 */
export function styleEditRequestText(state: StyleTweakState | null): string {
  const changes = styleChanges(state);
  if (!changes.length) return "";
  return [
    "[학생이 고른 스타일 변경 요청]",
    "학생이 미리보기에서 아래 값을 직접 골랐다. 미리보기 탭에만 잠깐 보여 줬고 파일은 바뀌지 않았다.",
    "이 요소의 소스를 고쳐서 이 값들을 반영하라. 학생이 고르지 않은 속성은 바꾸지 마라.",
    ...changes.map((c) => JSON.stringify(c)),
  ].join("\n");
}

/** The learner's visible message for the send button: their chosen values, in their own turn. */
export function styleTweakSendText(state: StyleTweakState | null): string {
  const changes = styleChanges(state);
  if (!changes.length) return "";
  return `고른 요소를 이렇게 바꿔 주세요: ${changes.map((c) => `${STYLE_TWEAK_LABELS[c.property]} ${c.old} → ${c.new}`).join(", ")}`;
}

/** The next/previous offered step from the chosen or current value; null at either end. */
export function stepFrom(row: StyleTweakRowState, dir: 1 | -1): string | null {
  if (kindOf(row.prop) !== "step") return null;
  const from = parseFloat(row.chosen ?? row.current);
  const steps = row.options.map((o) => parseFloat(o));
  if (!Number.isFinite(from)) return dir === 1 ? row.options[0] ?? null : null;
  const i = dir === 1 ? steps.findIndex((s) => s > from) : steps.map((s) => s < from).lastIndexOf(true);
  return i < 0 ? null : row.options[i];
}

/** What the webview draws: one row per property, with the stepper targets precomputed. */
export interface StyleTweakView {
  id: string;
  rows: {
    prop: StyleTweakProp;
    label: string;
    kind: StyleTweakKind;
    current: string;
    options: string[];
    chosen: string | null;
    prev: string | null;
    next: string | null;
  }[];
  changes: number;
  sendText: string;
  /** The exact element text the tweak's send carries (element block + request); set by the queue. */
  requestText?: string;
}

export function styleTweakView(state: StyleTweakState | null): StyleTweakView | null {
  if (!state) return null;
  return {
    id: state.id,
    rows: state.rows.map((r) => ({
      prop: r.prop,
      label: STYLE_TWEAK_LABELS[r.prop],
      kind: kindOf(r.prop),
      current: r.current,
      options: r.options,
      chosen: r.chosen,
      prev: stepFrom(r, -1),
      next: stepFrom(r, 1),
    })),
    changes: styleChanges(state).length,
    sendText: styleTweakSendText(state),
  };
}

// ── page side (run on the picked node with Runtime.callFunctionOn) ──────────

/** Read the node's computed values, its style attribute and the page's colours (bounded walk). */
export const STYLE_TWEAK_READ = `function(props){
  var cs = getComputedStyle(this), cur = {};
  for (var i = 0; i < props.length; i++) cur[props[i]] = cs.getPropertyValue(props[i]);
  var counts = {}, all = this.ownerDocument.querySelectorAll('body, body *');
  for (var j = 0; j < all.length && j < 1500; j++) {
    var s = getComputedStyle(all[j]);
    var a = s.color, b = s.backgroundColor;
    counts[a] = (counts[a] || 0) + 1;
    counts[b] = (counts[b] || 0) + 1;
  }
  var colors = Object.keys(counts).sort(function(x, y){ return counts[y] - counts[x]; }).slice(0, 40);
  return { current: cur, styleAttr: this.getAttribute('style'), pageColors: colors };
}`;

/**
 * Apply the whole preview state: restore the original style attribute exactly, then set each
 * chosen value as an inline `!important` declaration. Idempotent, so the last call wins and a
 * reset is the same call with no values. Nothing outside this node's style attribute changes.
 */
export const STYLE_TWEAK_APPLY = `function(attr, values){
  if (attr === null) this.removeAttribute('style'); else this.setAttribute('style', attr);
  for (var k in values) if (Object.prototype.hasOwnProperty.call(values, k)) this.style.setProperty(k, values[k], 'important');
  return true;
}`;
