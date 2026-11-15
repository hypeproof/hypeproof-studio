// CGP-LEARN-R-006 (box_spacing) / CGP-LEARN-R-005 (stage_stepper) / CGP-LEARN-R-009 (narrated_diagram) — the learner side of
// the parametric step blocks.
//
// The Service validates and pins a block's `ui_params` at confirm (hypeproof-service step-ui-catalog). This App still treats
// the served params as untrusted data: it re-validates them against its own copy of the published v1 specs, and a value that
// does not fit draws the "not available" notice, never a guessed value. The specs below must equal the Service's published
// snapshot, vendored byte-for-byte as test/fixtures/step-ui-catalog-published.json with a sha256 pin (block-params.smoke).
// Pure and DOM-free, so the webview and the Node tests share it.

export type ParamSpec =
  | { kind: "integer" | "number"; min: number; max: number; default: number }
  | { kind: "enum"; values: readonly string[]; default: string }
  | { kind: "boolean"; default: boolean }
  | { kind: "text_list"; minItems: number; maxItems: number; fields: Readonly<Record<string, TextField>>; required: true };
/** A text_list field; CGP-LEARN-R-009 text layers also carry a width budget (maxWidth px at fontPx over maxLines). */
export interface TextField { maxLength: number; maxWidth?: number; fontPx?: number; maxLines?: number }
export interface BlockVersionSpec { params: Readonly<Record<string, ParamSpec>>; presets: Readonly<Record<string, { label: string; params: Readonly<Record<string, unknown>> }>> }

/** The v1 specs this App draws. Equal to the Service's published snapshot (checked by test, never hand-tuned here). */
export const BLOCK_SPECS: Readonly<Record<"box_spacing" | "stage_stepper" | "narrated_diagram", Readonly<Record<string, BlockVersionSpec>>>> = {
  box_spacing: { "1": {
    params: {
      padding: { kind: "integer", min: 0, max: 48, default: 16 },
      border: { kind: "integer", min: 0, max: 8, default: 1 },
      margin: { kind: "integer", min: 0, max: 48, default: 8 },
      layout: { kind: "enum", values: ["block", "inline-block", "flex", "grid"], default: "block" },
    },
    presets: {
      default: { label: "기본", params: { padding: 16, border: 1, margin: 8, layout: "block" } },
      roomy: { label: "넉넉하게", params: { padding: 32, border: 2, margin: 24, layout: "block" } },
      tight: { label: "촘촘하게", params: { padding: 4, border: 1, margin: 0, layout: "flex" } },
    },
  } },
  stage_stepper: { "1": {
    params: { stages: { kind: "text_list", minItems: 2, maxItems: 8, fields: { title: { maxLength: 40 }, sentence: { maxLength: 60 } }, required: true } },
    presets: { default: { label: "기본", params: {} } },
  } },
  narrated_diagram: { "1": {
    params: {
      diagram: { kind: "enum", values: ["page_request", "html_to_page"], default: "page_request" },
      beats: {
        kind: "text_list", minItems: 3, maxItems: 3,
        fields: { title: { maxLength: 20, maxWidth: 168, fontPx: 14, maxLines: 1 }, sentence: { maxLength: 60, maxWidth: 488, fontPx: 14, maxLines: 2 } },
        required: true,
      },
    },
    presets: { default: { label: "기본", params: { diagram: "page_request" } } },
  } },
};

const own = <T>(o: Readonly<Record<string, T>> | undefined, k: string): T | undefined => (o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

export type BoxLayout = "block" | "inline-block" | "flex" | "grid";
export interface BoxValues { padding: number; border: number; margin: number; layout: BoxLayout }
export interface Stage { title: string; sentence: string }

/** Bounds of an integer param of box_spacing v1. */
export const BOX_BOUNDS = { padding: { min: 0, max: 48 }, border: { min: 0, max: 8 }, margin: { min: 0, max: 48 } } as const;

/** A whole number inside the param's range; anything else (a string, NaN, "8px;background:url(x)") becomes the nearest bound or the minimum. */
export function clampParam(name: keyof typeof BOX_BOUNDS, value: unknown): number {
  const { min, max } = BOX_BOUNDS[name];
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : min;
  return Math.min(max, Math.max(min, n));
}
/** The layout as one of the four values, or block. */
export const clampLayout = (value: unknown): BoxLayout =>
  value === "inline-block" || value === "flex" || value === "grid" ? value : "block";

/**
 * box_spacing params as served, or null when they do not fit v1 exactly (unknown key, wrong kind, out of range, bad enum).
 * A key the pin left out takes its default.
 */
export function boxParams(uiVersion: unknown, raw: unknown): BoxValues | null {
  const spec = own(BLOCK_SPECS.box_spacing, String(uiVersion === undefined ? 1 : uiVersion));
  if (!spec || (raw !== undefined && !isObj(raw))) return null;
  const given = (raw ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(given)) if (!own(spec.params, k)) return null;
  const out: Record<string, number | string> = {};
  for (const [name, p] of Object.entries(spec.params)) {
    const v = Object.prototype.hasOwnProperty.call(given, name) ? given[name] : (p as { default: unknown }).default;
    if (p.kind === "integer") { if (typeof v !== "number" || !Number.isInteger(v) || v < p.min || v > p.max) return null; out[name] = v; }
    else if (p.kind === "enum") { if (typeof v !== "string" || !p.values.includes(v)) return null; out[name] = v; }
    else return null;
  }
  return out as unknown as BoxValues;
}

/**
 * The Service's single-line safe-text rule (hypeproof-service worker/src/lib/session-design.ts validateOneLine), with the
 * same character classes Chalk uses: no control, format, bidi or separator characters, no blank look-alikes (U+3164,
 * U+FFA0, U+2800), no 3+ stacked combining marks, no lone surrogate, no surrounding whitespace, and (when `needReadable`)
 * a readable glyph once quotes are removed. chalk/test/fixtures/safe-text-cases.json is the shared case list, and
 * block-params.smoke checks this predicate against it. The Service also refuses links in stage text; Studio draws stage
 * text as text nodes only, so a link is never made clickable and is not re-checked here.
 */
const SAFE_INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u3164\uFFA0\u2800]/u;
const SAFE_MARK_STACK = /\p{M}{3,}/u;
const SAFE_LONE = /\p{Cs}/u;
const SAFE_READABLE = /[\p{L}\p{N}\p{S}\p{P}]/u;
export function safeLine(t: unknown, needReadable: boolean): boolean {
  return typeof t === "string" && t.length > 0 && t === t.trim() && !SAFE_INVISIBLE.test(t) && !SAFE_MARK_STACK.test(t) && !SAFE_LONE.test(t)
    && !(needReadable && !SAFE_READABLE.test(t.replace(/["'`]/g, "")));
}
/** stage_stepper stages as served, or null unless they are exactly 2–8 items of {title, sentence}, each a safe single line (the Service's rule) within its limit. */
export function stageParams(uiVersion: unknown, raw: unknown): Stage[] | null {
  const spec = own(BLOCK_SPECS.stage_stepper, String(uiVersion === undefined ? 1 : uiVersion));
  const p = spec ? own(spec.params, "stages") : undefined;
  if (!p || p.kind !== "text_list" || !isObj(raw) || Object.keys(raw).some((k) => k !== "stages")) return null;
  const list = raw.stages;
  if (!Array.isArray(list) || list.length < p.minItems || list.length > p.maxItems) return null;
  const out: Stage[] = [];
  for (const item of list) {
    if (!isObj(item) || Object.keys(item).length !== 2) return null;
    const stage: Record<string, string> = {};
    for (const [field, f] of Object.entries(p.fields)) {
      const v = item[field];
      if (typeof v !== "string" || v.length > f.maxLength || !safeLine(v, true)) return null;
      stage[field] = v;
    }
    out.push(stage as unknown as Stage);
  }
  return out;
}

/**
 * CGP-LEARN-R-009 — the Service's font-independent width estimate for one line at `fontPx` (service-contracts
 * step-ui-catalog `textLayerWidthPx`, same classes): Hangul, CJK, kana, full-width forms, anything outside the BMP and
 * any Extended_Pictographic code point count 1 em; everything else 0.6 em. block-params.smoke checks the two agree on a
 * shared case list.
 */
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
function wideCodePoint(cp: number): boolean {
  return (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x2e80 && cp <= 0x303f) || (cp >= 0x3040 && cp <= 0x33ff)
    || (cp >= 0x3400 && cp <= 0x9fff) || (cp >= 0xa960 && cp <= 0xa97f) || (cp >= 0xac00 && cp <= 0xd7ff)
    || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60)
    || (cp >= 0xffe0 && cp <= 0xffe6) || cp > 0xffff;
}
export function textLayerWidthPx(text: string, fontPx: number): number {
  let em = 0;
  for (const ch of text) em += wideCodePoint(ch.codePointAt(0)!) || PICTOGRAPHIC.test(ch) ? 1 : 0.6;
  return em * fontPx;
}

export interface Beat { title: string; sentence: string }
export interface DiagramValues { diagram: "page_request" | "html_to_page"; beats: [Beat, Beat, Beat] }

/**
 * narrated_diagram params as served, or null unless `diagram` is one of the v1 drawings and `beats` is exactly three
 * {title, sentence}, each a safe single line within its length and its text layer's width (the Service's rules).
 */
export function diagramParams(uiVersion: unknown, raw: unknown): DiagramValues | null {
  const spec = own(BLOCK_SPECS.narrated_diagram, String(uiVersion === undefined ? 1 : uiVersion));
  const d = spec ? own(spec.params, "diagram") : undefined, p = spec ? own(spec.params, "beats") : undefined;
  if (!d || d.kind !== "enum" || !p || p.kind !== "text_list" || !isObj(raw) || Object.keys(raw).some((k) => k !== "diagram" && k !== "beats")) return null;
  const diagram = Object.prototype.hasOwnProperty.call(raw, "diagram") ? raw.diagram : d.default;
  if (typeof diagram !== "string" || !d.values.includes(diagram)) return null;
  const list = raw.beats;
  if (!Array.isArray(list) || list.length < p.minItems || list.length > p.maxItems || list.length !== 3) return null;
  const out: Beat[] = [];
  for (const item of list) {
    if (!isObj(item) || Object.keys(item).length !== 2) return null;
    const beat: Record<string, string> = {};
    for (const [field, f] of Object.entries(p.fields)) {
      const v = item[field];
      if (typeof v !== "string" || v.length > f.maxLength || !safeLine(v, true)) return null;
      if (f.maxWidth !== undefined && textLayerWidthPx(v, f.fontPx ?? 14) > f.maxWidth * (f.maxLines ?? 1)) return null;
      beat[field] = v;
    }
    out.push(beat as unknown as Beat);
  }
  return { diagram: diagram as DiagramValues["diagram"], beats: out as DiagramValues["beats"] };
}

/**
 * The preview's three sizes, as custom properties built from clamped numbers only. They go into a React style OBJECT (React
 * sets each one; nothing is interpolated into a style attribute or a <style> block), and the stylesheet applies them under
 * `box-sizing: content-box` (learningBlockCard.css). The layout is a data attribute with four fixed CSS rules, never a
 * served string. Even values that bypassed boxParams cannot carry CSS text here.
 */
export interface BoxStyleVars { "--param-padding": string; "--param-border": string; "--param-margin": string }
export function boxStyle(v: Partial<Record<keyof BoxValues, unknown>>): BoxStyleVars {
  return {
    "--param-padding": `${clampParam("padding", v.padding)}px`,
    "--param-border": `${clampParam("border", v.border)}px`,
    "--param-margin": `${clampParam("margin", v.margin)}px`,
  };
}

export const BOX_LAYOUT_LABELS: Readonly<Record<BoxLayout, string>> = { block: "블록", "inline-block": "인라인 블록", flex: "플렉스", grid: "그리드" };
/** The param labels the controls show (and their accessible names). */
export const BOX_PARAM_LABELS = { padding: "안쪽 여백", border: "테두리", margin: "바깥 여백", layout: "배치" } as const;

/**
 * The caption, from the same clamped values the preview uses. The preview is content-box: the box is wider than its content
 * by 2 × (padding + border), and the margin is space outside the box (it does not change the box's width).
 */
export function boxCaption(v: Partial<Record<keyof BoxValues, unknown>>): string {
  const p = clampParam("padding", v.padding), b = clampParam("border", v.border), m = clampParam("margin", v.margin);
  const layout = BOX_LAYOUT_LABELS[clampLayout(v.layout)];
  const grow = 2 * (p + b);
  const head = `안쪽 여백 ${p}px · 테두리 ${b}px · 바깥 여백 ${m}px · ${layout} 배치`;
  const width = grow ? `상자가 내용보다 ${grow}px 넓어요` : "상자가 내용과 같은 너비예요";
  const outside = m ? ` 바깥 여백 ${m}px는 상자 밖의 빈 공간이에요.` : "";
  return `${head} → ${width}.${outside}`;
}

/** Keyboard steps for a range: arrows ±1, PageUp/PageDown ±10 % of the range (at least 1), Home/End to the bounds. */
export function rangeKeyStep(key: string, value: number, min: number, max: number): number | null {
  const big = Math.max(1, Math.round((max - min) / 10));
  const to = key === "ArrowRight" || key === "ArrowUp" ? value + 1 : key === "ArrowLeft" || key === "ArrowDown" ? value - 1
    : key === "PageUp" ? value + big : key === "PageDown" ? value - big : key === "Home" ? min : key === "End" ? max : null;
  return to === null ? null : Math.min(max, Math.max(min, to));
}

/** "2 / 4 단계". */
export const stageLabel = (index: number, count: number): string => `${index + 1} / ${count} 단계`;
/** The stage index after a move, inside 0..count-1. */
export const stageMove = (index: number, count: number, by: number): number => Math.min(count - 1, Math.max(0, index + by));

/** Reset/undo for the box values (R-010 semantics, local only): each change, or one reset, is one step back. */
export interface BoxHistory { past: BoxValues[] }
export const BOX_HISTORY_MAX = 50;
const sameBox = (a: BoxValues, b: BoxValues) => a.padding === b.padding && a.border === b.border && a.margin === b.margin && a.layout === b.layout;
export function boxEdit(h: BoxHistory, before: BoxValues, after: BoxValues): BoxHistory {
  return sameBox(before, after) ? h : { past: [...h.past, { ...before }].slice(-BOX_HISTORY_MAX) };
}
export function boxReset(h: BoxHistory, current: BoxValues, pinned: BoxValues): { history: BoxHistory; values: BoxValues } | null {
  return sameBox(current, pinned) ? null : { history: { past: [...h.past, { ...current }].slice(-BOX_HISTORY_MAX) }, values: { ...pinned } };
}
export function boxUndo(h: BoxHistory): { history: BoxHistory; values: BoxValues } | null {
  const last = h.past[h.past.length - 1];
  return last ? { history: { past: h.past.slice(0, -1) }, values: { ...last } } : null;
}
