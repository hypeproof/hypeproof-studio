import { readDesignFile } from "./lib/design-token-values.mjs";
// CGP-DS-R-010 (REQ-CGP-DS-11, DES-06) — the 4px spacing unit and the control-height ladder, and the
// learner hit-target floor locked in the stylesheets.
//   node --experimental-strip-types test/control-ladder.smoke.mjs
//
// The render audit is e2e/hit-target-audit.mjs (headless Chromium, every interactive element of the
// personal and classroom chat and the start page, 44×44). This smoke is its committed CSS half: each
// learner control the audit found under 44px on origin/main is listed with the dimensions it needs,
// and every rule in any webview stylesheet whose selector ends on that control may only set those
// dimensions to ≥44px (min-*, the size itself and max-*), with at least one rule setting the floor. A later rule
// that shrinks a control again (the personal code toggle's 32px that overrode its own 44px floor)
// fails here. Each check also runs against a mutated stylesheet that must fail (negative controls).
// The composer card's press-to-focus, which makes the card the 24px textarea's hit target, is checked
// on composerSurfacePress with fake events.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import vm from "node:vm";

const SRC = new URL("../webview-ui/src/", import.meta.url);
const FILES = ["tokens.css", "styles.css", "chatDetails.css", "taskWorkspace.css", "start.css", "localReview.css", "citationPreview.css", "quoteAction.css", "codeBlock.css", "refusalBanner.css", "writeApprovalDialog.css", "outboundDialog.css"];
const real = Object.fromEntries(FILES.map((f) => [f, readDesignFile(new URL(f, SRC), "utf8")]));
const MIN = 44;
const CTA = 48; // CGP-DS-D-007: the ladder's lg step, the primary call to action
let passed = 0;
const failures = [];
const check = (label, fn) => { try { fn(); passed++; console.log(`  ok   ${label}`); } catch (e) { failures.push(label); console.error(`  FAIL ${label}: ${e.message.split("\n")[0]}`); } };

// ─── CSS ────────────────────────────────────────────────────────────────────────────────────────
function splitTop(list) {
  const out = []; let depth = 0, cur = "";
  for (const ch of list) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  return [...out, cur].map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
}
/** Every style rule (inside any @media/@supports) with its selectors and declarations. */
function rules(raw, file) {
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  const walk = (from, to) => {
    let i = from;
    while (i < to) {
      const open = css.indexOf("{", i);
      if (open < 0 || open >= to) return;
      const head = css.slice(i, open).trim();
      let depth = 1, j = open + 1;
      for (; j < to && depth; j++) depth += css[j] === "{" ? 1 : css[j] === "}" ? -1 : 0;
      if (/^@(media|supports)\b/.test(head)) walk(open + 1, j - 1);
      else if (!head.startsWith("@")) {
        const decls = [];
        for (const d of css.slice(open + 1, j - 1).split(";")) { const k = d.indexOf(":"); if (k > 0) decls.push([d.slice(0, k).trim().toLowerCase(), d.slice(k + 1).replace(/!\s*important/i, "").trim()]); }
        out.push({ file, selectors: splitTop(head), decls });
      }
      i = j;
    }
  };
  walk(0, css.length);
  return out;
}
/** Custom properties declared anywhere (tokens.css :root and component scopes), last wins. */
function customProps(css) {
  const map = new Map();
  for (const r of Object.entries(css).flatMap(([f, t]) => rules(t, f))) for (const [p, v] of r.decls) if (p.startsWith("--")) map.set(p, v);
  return map;
}
/** A length in px: literals, var() through the custom properties, calc(a * n) / calc(a + b). */
function px(value, props, seen = new Set()) {
  const v = value.trim();
  let m;
  if ((m = /^(-?\d*\.?\d+)px$/.exec(v))) return Number(m[1]);
  if (v === "0") return 0;
  if ((m = /^var\((--[\w-]+)(?:,\s*(.+))?\)$/.exec(v))) {
    if (seen.has(m[1])) throw new Error(`cyclic ${m[1]}`);
    if (props.has(m[1])) return px(props.get(m[1]), props, new Set([...seen, m[1]]));
    if (m[2]) return px(m[2], props, seen);
    throw new Error(`undefined ${m[1]}`);
  }
  if ((m = /^calc\((.+)\)$/.exec(v))) {
    const parts = m[1].split(/\s+([*+-])\s+/);
    let acc = px(parts[0], props, seen);
    for (let i = 1; i < parts.length; i += 2) {
      const op = parts[i], rhs = parts[i + 1];
      if (op === "*") acc *= /^\d*\.?\d+$/.test(rhs) ? Number(rhs) : px(rhs, props, seen);
      else acc += (op === "+" ? 1 : -1) * px(rhs, props, seen);
    }
    return acc;
  }
  return NaN; // auto, %, fit-content, …: not a fixed size
}

// Each learner control from the origin/main audit, by the selector its rules end on, and the
// dimensions whose floor it needs. `last` is matched against the last compound of each selector.
// `base`: the classroom chat draws it too, so its floor must come from a rule that is not scoped to
// the personal workspace (a personal-only 44px rule leaves the classroom control at its old size).
const H = ["height"], HW = ["height", "width"];
const CONTROLS = [
  { base: true, name: "classroom chat header actions (활동 변경, 대화 지우기, 설정)", ctx: /\.hps-header\b/, last: /^button(?:$|[.:[])/, dims: HW },
  { base: true, name: "answer Run / retry", ctx: null, last: /\.hps-msg-(run|retry)(?![\w-])/, dims: HW },
  { base: true, name: "code disclosure (코드 보기)", ctx: null, last: /\.hps-codepill-toggle(?![\w-])/, dims: H },
  { base: true, name: "나의 변화 기록 ›", ctx: null, last: /\.hp-mission-growth(?![\w-])/, dims: H },
  { base: true, name: "lesson step fields", ctx: /\.hp-surface\b/, last: /^(input|textarea)(?:$|[.:[])/, dims: H },
  { base: true, name: "help mode radio labels", ctx: /\.hp-help-modes\b/, last: /^label(?:$|[.:[])/, dims: H },
  { base: true, name: "test panel buttons and fields (내 제품 테스트), height", ctx: /\.hps-verify\b/, last: /^(button|input)(?:$|[.:[])/, dims: H },
  { base: true, name: "composer buttons (보내기, Stop)", ctx: /\.hps-input\b/, last: /^button(?:$|[.:[])|\.hps-btn-(send|stop)(?![\w-])/, dims: HW },
  { name: "skip link (대화로 바로 가기)", ctx: null, last: /\.tw-skip(?![\w-])/, dims: H },
  { name: "task search field", ctx: /\.tw-search\b/, last: /^input(?:$|[.:[])/, dims: H },
  { name: "task title button", ctx: null, last: /\.tw-title-button(?![\w-])/, dims: HW },
  { name: "start page nav (나의 변화 기록, 파일, 설정)", ctx: /\.studio-nav\b/, last: /^button(?:$|[.:[])/, dims: H },
  { name: "start page bottom (작업 폴더 열기)", ctx: /\.studio-bottom\b/, last: /^button(?:$|[.:[])/, dims: H },
  { base: true, name: "image remove ×", ctx: null, last: /\.hps-attachment-remove(?![\w-])(?!(?::[\w-]+)*::)/, dims: HW },
  { base: true, name: "citation chips", ctx: null, last: /\.hps-cit-chip(?![\w-])/, dims: H },
  { name: "trial end card escape (나중에)", ctx: null, last: /\.hps-trial-end-card-escape(?![\w-])/, dims: H },
  { base: true, name: "voice panel buttons", ctx: /\.hps-voice-(actions|compact|head-buttons|resume)\b|\.hps-voice-retry/, last: /^button(?:$|[.:[])|\.hps-voice-retry(?![\w-])/, dims: HW },
  { base: true, name: "picked element remove ×", ctx: null, last: /\.hps-element-remove(?![\w-])/, dims: HW },
  { base: true, name: "picked element 코치에게 보낼 내용 보기", ctx: /\.hps-element-meta\b/, last: /^summary(?:$|[.:[])/, dims: H },
  { name: "task rename field", ctx: /\.tw-rename\b/, last: /^input(?:$|[.:[])/, dims: H },
  { name: "sources panel 브라우저에서 열기", ctx: null, last: /\.tw-open-source(?![\w-])/, dims: H },
  { name: "start page text buttons (시작 방법 다시 선택, 다른 활동 선택, 연결 해제)", ctx: null, last: /\.studio-text-button(?![\w-])/, dims: H },
];
const SCOPED = /data-chat-detail="personal"|\.tw-workspace|\.tw-conversation|:has\(/;
const lastCompound = (sel) => sel.split(/\s*[\s>+~]\s*/).filter(Boolean).pop() ?? "";
const PROPS = { height: ["min-height", "height", "max-height", "block-size", "min-block-size", "max-block-size"], width: ["min-width", "width", "max-width", "inline-size", "min-inline-size", "max-inline-size"] };
const FLOOR = { height: ["min-height", "height", "block-size", "min-block-size"], width: ["min-width", "width", "inline-size", "min-inline-size"] };

/** Findings for one control: a rule that sets a needed dimension below its floor (44px, or c.min), or no floor at all. */
function controlFindings(css, c) {
  const props = customProps(css);
  const MIN = c.min ?? 44;
  const bad = []; const floor = Object.fromEntries(c.dims.map((d) => [d, false]));
  for (const r of Object.entries(css).flatMap(([f, t]) => rules(t, f))) {
    const sels = r.selectors.filter((s) => c.last.test(lastCompound(s)) && (!c.ctx || c.ctx.test(s)));
    if (!sels.length) continue;
    for (const d of c.dims) for (const [p, v] of r.decls) {
      if (!PROPS[d].includes(p)) continue;
      const n = px(v, props);
      // A size that is not a fixed px length is a finding unless it cannot shrink the box below its content.
      if (Number.isNaN(n)) { if (!/^(auto|none|100%|fit-content|max-content|min-content|inherit|initial|unset)$/.test(v)) bad.push(`${r.file} ${sels[0]} { ${p}: ${v} } is not a measurable px size`); continue; }
      if (n < MIN) bad.push(`${r.file} ${sels[0]} { ${p}: ${v} } = ${n}px`);
      else if (FLOOR[d].includes(p) && (!c.base || sels.some((s) => !SCOPED.test(s)))) floor[d] = true;
    }
  }
  for (const d of c.dims) if (!floor[d]) bad.push(`no ${c.base ? "unscoped " : ""}rule gives it a ${d} of at least ${MIN}px`);
  return bad;
}

const props = customProps(real);
check("tokens: --hp-space is the 4px unit", () => assert.equal(px("var(--hp-space)", props), 4));
check("tokens: the control ladder is 32 / 44 / 48 and the learner floor is its 44px step", () => {
  assert.deepEqual(["sm", "md", "lg"].map((s) => px(`var(--hp-control-${s})`, props)), [32, 44, 48]);
  assert.equal(props.get("--hp-control-min"), "var(--hp-control-md)");
  assert.equal(px("var(--hp-control-min)", props), MIN);
});
// CGP-DS-D-007 (DES-CGP-DS-11) — the spacing ladder 4 / 8 / 12 / 16 / 20 / 24 / 32px, each a multiple of the unit.
const LADDER = [[1, 4], [2, 8], [3, 12], [4, 16], [5, 20], [6, 24], [8, 32]];
const LADDER_PX = new Set(LADDER.map(([, v]) => v));
/** The ladder findings for a stylesheet set: a step at the wrong size or not derived from --hp-space. */
function ladderFindings(css) {
  const p = customProps(css); const bad = [];
  for (const [step, want] of LADDER) {
    const name = `--hp-space-${step}`; const raw = p.get(name);
    if (!raw) { bad.push(`${name} missing`); continue; }
    const got = px(raw, p);
    if (got !== want) bad.push(`${name} = ${got}px, not ${want}px`);
    if (!/var\(--hp-space\)/.test(raw)) bad.push(`${name} is not derived from --hp-space: ${raw}`);
  }
  if (px("var(--hp-control-cta)", p) !== CTA) bad.push(`--hp-control-cta is not ${CTA}px`);
  if (p.get("--hp-control-cta") !== "var(--hp-control-lg)") bad.push("--hp-control-cta is not the lg step");
  return bad;
}
const SPACING = /^(padding|margin|gap|row-gap|column-gap|inset|top|right|bottom|left|scroll-padding|scroll-margin)(-[\w-]+)?$/;
/** Every spacing declaration that uses the unit or a ladder step must land on the ladder (DEC-DS-R-010: new and changed spacing). */
function spacingFindings(css) {
  const p = customProps(css); const bad = [];
  for (const r of Object.entries(css).flatMap(([f, t]) => rules(t, f))) for (const [prop, v] of r.decls) {
    if (!SPACING.test(prop) || !/var\(--hp-space/.test(v)) continue;
    // Split only between complete CSS values. Unknown nested arithmetic fails closed in px().
    const parts = []; let depth = 0, part = "";
    for (const ch of v) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (/\s/.test(ch) && depth === 0) { if (part) parts.push(part); part = ""; } else part += ch;
    }
    if (part) parts.push(part);
    for (const part of parts) {
      if (!/--hp-space/.test(part)) continue;
      const n = Math.abs(px(part, p));
      if (!LADDER_PX.has(n)) bad.push(`${r.file} ${r.selectors[0]} { ${prop}: ${v} } uses ${n}px, off the ladder`);
    }
  }
  return bad;
}
check("tokens: the spacing ladder is 4 / 8 / 12 / 16 / 20 / 24 / 32px from --hp-space, and the primary CTA step is 48px", () => { const bad = ladderFindings(real); assert.deepEqual(bad, [], bad.join("; ")); });
check("spacing: every padding/margin/gap/inset that uses --hp-space lands on the ladder", () => { const bad = spacingFindings(real); assert.deepEqual(bad, [], bad.join("; ")); });
check("tokens: declared in tokens.css on :root", () => {
  const root = rules(real["tokens.css"], "tokens.css").filter((r) => r.selectors.includes(":root"));
  const names = new Set(root.flatMap((r) => r.decls.map(([p]) => p)));
  for (const n of ["--hp-space", "--hp-control-sm", "--hp-control-md", "--hp-control-lg", "--hp-control-min", ...LADDER.map(([s]) => `--hp-space-${s}`), "--hp-control-cta"]) assert.ok(names.has(n), `${n} missing on :root`);
});
check("tokens: no learner rule uses the instructor-only sm step", () => {
  const uses = Object.entries(real).flatMap(([f, t]) => rules(t, f)).filter((r) => r.decls.some(([p, v]) => !p.startsWith("--") && /var\(--hp-control-sm\)/.test(v)));
  assert.deepEqual(uses.map((r) => `${r.file} ${r.selectors[0]}`), []);
});
// CGP-DS-D-007 (DES-CGP-DS-11) — the primary call to action takes the ladder's 48px step. One per screen
// (SX-04): the start page's main button, the lesson header's Primary (also the trial carry-over's 이어가기)
// and the trial end card's 이용권 살펴보기. `base`: drawn in the classroom too, so the floor is unscoped.
const CTAS = [
  { base: true, min: CTA, name: "primary CTA: Google account", ctx: null, last: /\.studio-google(?![\w-])/, dims: H },
  { base: true, min: CTA, name: "primary CTA: start page (.studio-primary)", ctx: null, last: /\.studio-primary(?![\w-])/, dims: H },
  { base: true, min: CTA, name: "primary CTA: lesson header and trial carry-over (.hp-cta-primary)", ctx: null, last: /\.hp-cta-primary(?![\w-])/, dims: H },
  { base: true, min: CTA, name: "primary CTA: trial end card 이용권 살펴보기", ctx: null, last: /\.hps-trial-end-card-primary(?![\w-])/, dims: H },
  { base: true, min: CTA, name: "primary CTA: test panel 테스트 시작 (.hps-verify-primary)", ctx: null, last: /\.hps-verify-primary(?![\w-])/, dims: H },
];
CONTROLS.push(...CTAS);
for (const c of CONTROLS) check(`floor: ${c.name}`, () => { const bad = controlFindings(real, c); assert.deepEqual(bad, [], bad.join("; ")); });

// ─── negative controls: each fix reverted must fail its check ────────────────────────────────────
const mutate = (file, from, to) => { assert.ok(real[file].includes(from), `${file}: mutation anchor missing: ${from}`); return { ...real, [file]: real[file].replace(from, to) }; };
const tokensMut = (from, to) => mutate("tokens.css", from, to);
const NEGATIVE = [
  ["tokens", "--hp-space at 5px", () => assert.notEqual(px("var(--hp-space)", customProps(tokensMut("--hp-space: 4px;", "--hp-space: 5px;"))), 4)],
  ["tokens", "learner floor on the sm step", () => assert.notEqual(px("var(--hp-control-min)", customProps(tokensMut("--hp-control-min: var(--hp-control-md);", "--hp-control-min: var(--hp-control-sm);"))), MIN)],
];
NEGATIVE.push(
  ["spacing", "nested off-ladder arithmetic fails closed", () => assert.ok(spacingFindings(mutate("styles.css", "padding: var(--hp-space) ", "padding: calc(var(--hp-space) * (3 + 4)) ")).length)],
  ["tokens", "a ladder step at 28px (--hp-space-6 = unit × 7)", () => assert.ok(ladderFindings(tokensMut("--hp-space-6: calc(var(--hp-space) * 6);", "--hp-space-6: calc(var(--hp-space) * 7);")).length)],
  ["tokens", "a ladder step as a literal off the unit", () => assert.ok(ladderFindings(tokensMut("--hp-space-8: calc(var(--hp-space) * 8);", "--hp-space-8: 32px;")).length)],
  ["tokens", "a ladder step removed", () => assert.ok(ladderFindings(tokensMut("  --hp-space-5: calc(var(--hp-space) * 5);", "")).length)],
  ["tokens", "the CTA step on md (44px)", () => assert.ok(ladderFindings(tokensMut("--hp-control-cta: var(--hp-control-lg);", "--hp-control-cta: var(--hp-control-md);")).length)],
  ["spacing", "a gap of unit × 7 (28px)", () => assert.ok(spacingFindings(mutate("styles.css", "padding: var(--hp-space) ", "padding: calc(var(--hp-space) * 7) ")).length)],
  ["spacing", "a margin of unit × 1.5 (6px)", () => assert.ok(spacingFindings(mutate("styles.css", "padding: var(--hp-space) ", "padding: calc(var(--hp-space) * 1.5) ")).length)],
);
for (const [, label, fn] of NEGATIVE) check(`negative control: ${label}`, () => fn());
const FLOOR_MUTATIONS = [
  ["primary CTA: Google account", "start.css", "min-height: var(--hp-control-cta);", "min-height: var(--hp-control-min);"],
  ["classroom chat header actions", "styles.css", "  min-width: var(--hp-control-min); min-height: var(--hp-control-min); /* CGP-DS-R-010 */\n}\n.hps-header button:hover", "}\n.hps-header button:hover"],
  ["answer Run / retry", "styles.css", "  min-width: var(--hp-control-min); min-height: var(--hp-control-min); /* CGP-DS-R-010 */\n}\n.hps-msg-run:hover", "}\n.hps-msg-run:hover"],
  ["code disclosure", "chatDetails.css", "gap: 6px; min-height: var(--hp-control-min); margin-left:", "gap: 6px; min-height: 32px; margin-left:"],
  ["code disclosure", "styles.css", "  cursor: pointer;\n  min-height: var(--hp-control-min); /* CGP-DS-R-010 */\n}\n.hps-codepill-toggle:hover", "  cursor: pointer;\n}\n.hps-codepill-toggle:hover"],
  ["나의 변화 기록", "styles.css", " cursor: pointer; min-height: var(--hp-control-min); /* CGP-DS-R-010 */", " cursor: pointer;"],
  ["lesson step fields", "styles.css", "box-sizing: border-box; min-height: var(--hp-control-min); padding: 6px 8px;\n  background: var(--hp-bg-app-default);", "box-sizing: border-box; min-height: 36px; padding: 6px 8px;\n  background: var(--hp-bg-app-default);"],
  ["help mode radio labels", "styles.css", "gap: 6px; min-height: var(--hp-control-min); }", "gap: 6px; min-height: 32px; }"],
  ["composer buttons", "styles.css", "  min-width: var(--hp-control-min); min-height: var(--hp-control-min); /* CGP-DS-R-010 */\n}\n.hps-btn-roll {", "  min-width: 32px; min-height: 32px;\n}\n.hps-btn-roll {"],
  ["skip link", "taskWorkspace.css", "display: inline-flex; align-items: center; min-height: var(--hp-control-min); }", "display: inline-flex; align-items: center; }"],
  ["task search field", "taskWorkspace.css", ".tw-search input { width: 100%; box-sizing: border-box; min-height: var(--hp-control-min);", ".tw-search input { width: 100%; box-sizing: border-box;"],
  ["task title button", "taskWorkspace.css", ".tw-workspace .tw-quiet { min-width: var(--hp-control-min); min-height: var(--hp-control-min); }", ".tw-workspace .tw-quiet { min-height: var(--hp-control-min); }"],
  ["start page nav", "start.css", "padding: 7px 14px; min-height: var(--hp-control-min); cursor: pointer; }", "padding: 7px 14px; cursor: pointer; }"],
  ["start page bottom", "start.css", "  padding:0;\n  min-height:var(--hp-control-min);\n", "  padding:0;\n"],
  ["start page text buttons", "start.css", "  min-height:var(--hp-control-min);\n  font-size:12px!important}", "  font-size:12px!important}"],
  ["composer buttons", "chatDetails.css", "  width: var(--hp-control-min); height: var(--hp-control-min); padding: 0; border-radius: 50%;", "  width: 36px; height: 36px; padding: 0; border-radius: 50%;"],
  ["image remove ×", "styles.css", "  width: var(--hp-control-min);\n  height: var(--hp-control-min);\n  padding: 0;\n  line-height:", "  width: 18px;\n  height: 18px;\n  padding: 0;\n  line-height:"],
  ["citation chips", "styles.css", "  min-height: var(--hp-control-min); /* CGP-DS-R-010 */\n  text-align: left;", "  text-align: left;"],
  ["trial end card escape", "styles.css", "border: 0; cursor: pointer; min-height: var(--hp-control-min); padding: 6px 8px; background: transparent;", "border: 0; cursor: pointer; padding: 6px 8px; background: transparent;"],
  ["voice panel buttons", "styles.css", "  font: inherit; min-width: var(--hp-control-min); min-height: var(--hp-control-min); padding: 6px 12px;", "  font: inherit; padding: 6px 12px;"],
  ["picked element remove ×", "styles.css", "  min-width: var(--hp-control-min); min-height: var(--hp-control-min); justify-content: center; /* CGP-DS-R-010 */\n", ""],
  ["picked element 코치에게", "styles.css", ".hps-element-meta summary { display: flex; align-items: center; min-height: var(--hp-control-min); cursor: pointer; }", ".hps-element-meta summary { cursor: pointer; }"],
  ["task rename field", "taskWorkspace.css", ".tw-rename input { width: 100%; box-sizing: border-box; min-height: var(--hp-control-min);", ".tw-rename input { width: 100%; box-sizing: border-box;"],
  ["sources panel", "taskWorkspace.css", ".tw-open-source { width: 100%; min-height: var(--hp-control-min);", ".tw-open-source { width: 100%;"],
  // CGP-DS-D-007: each primary CTA back on the 44px step, or with no floor, must fail its 48px check.
  ["primary CTA: start page", "start.css", "  width:100%;\n  min-height:var(--hp-control-cta);\n", "  width:100%;\n  min-height:var(--hp-control-min);\n"],
  ["primary CTA: start page", "start.css", "  width:100%;\n  min-height:var(--hp-control-cta);\n", "  width:100%;\n"],
  ["primary CTA: lesson header", "styles.css", ".hp-cta-primary {\n  min-height: var(--hp-control-cta);", ".hp-cta-primary {\n  min-height: var(--hp-control-min);"],
  ["primary CTA: lesson header", "styles.css", ".hp-cta-primary {\n  min-height: var(--hp-control-cta);", ".hp-cta-primary {\n  min-height: var(--hp-control-cta); height: var(--hp-control-md);"],
  ["primary CTA: trial end card", "styles.css", "border: 0; cursor: pointer; min-height: var(--hp-control-cta); padding: 6px 14px;", "border: 0; cursor: pointer; min-height: var(--hp-control-min); padding: 6px 14px;"],
  ["primary CTA: trial end card", "styles.css", "border: 0; cursor: pointer; min-height: var(--hp-control-cta); padding: 6px 14px;", "border: 0; cursor: pointer; padding: 6px 14px;"],
  ["primary CTA: test panel", "styles.css", ".hps-verify .hps-verify-primary { min-height: var(--hp-control-cta); }", ".hps-verify .hps-verify-primary { min-height: var(--hp-control-min); }"],
  ["primary CTA: test panel", "styles.css", ".hps-verify .hps-verify-primary { min-height: var(--hp-control-cta); }", ""],
  ["test panel buttons", "styles.css", ".hps-verify button, .hps-verify input { min-height: var(--hp-control-min); }", ""],
  // A size in another unit is not measured, so it is a finding.
  ["citation chips", "styles.css", "  min-height: var(--hp-control-min); /* CGP-DS-R-010 */\n  text-align: left;", "  min-height: var(--hp-control-min); max-height: 2em;\n  text-align: left;"],
  // A later rule that shrinks a control again must fail even when the floor rule is intact.
  ["task title button", "taskWorkspace.css", ".tw-title-button span {", ".tw-title-button { max-height: 40px; }\n.tw-title-button span {"],
];
for (const [name, file, from, to] of FLOOR_MUTATIONS) {
  const c = CONTROLS.find((x) => x.name.startsWith(name));
  check(`negative control: ${name} reverted in ${file} → its floor check fails`, () => {
    assert.ok(c, `no control named ${name}`);
    assert.ok(controlFindings(mutate(file, from, to), c).length > controlFindings(real, c).length, "the mutated stylesheet still passes");
  });
}

// ─── composer card press → textarea focus ────────────────────────────────────────────────────────
const bundle = await build({ entryPoints: [new URL("../webview-ui/src/composerFocus.ts", import.meta.url).pathname], bundle: true, platform: "browser", format: "iife", globalName: "composerFocus", write: false, logLevel: "error" });
const ctx = { window: { addEventListener() {}, removeEventListener() {}, acquireVsCodeApi: undefined }, requestAnimationFrame: () => 0, cancelAnimationFrame() {} };
vm.runInNewContext(bundle.outputFiles[0].text, ctx);
const { composerSurfacePress } = ctx.composerFocus;
// A tiny element tree: closest() walks up, contains() walks down, as the DOM does.
const el = (tag, parent = null, attrs = {}) => {
  const node = { tag, parent, attrs, kids: [] };
  if (parent) parent.kids.push(node);
  node.closest = (sel) => { for (let n = node; n; n = n.parent) if (sel.split(",").some((s) => matches(n, s.trim()))) return n; return null; };
  node.contains = (other) => { for (let n = other; n; n = n.parent) if (n === node) return true; return false; };
  return node;
};
const matches = (n, s) => (/^\[tabindex\]$/.test(s) ? "tabindex" in n.attrs : /^\[role="([\w]+)"\]$/.test(s) ? n.attrs.role === /"(\w+)"/.exec(s)[1] : n.tag === s);
const main = el("main", null, { tabindex: "-1" });
const card = el("div", main);
const tools = el("div", card);
const trigger = el("button", tools);
const buttons = el("div", card);
const press = (target, over = {}) => {
  let prevented = false, focused = false;
  const input = { disabled: false, readOnly: false, focus: () => { focused = true; }, ...over.input };
  composerSurfacePress({ target, currentTarget: card, button: over.button ?? 0, preventDefault: () => { prevented = true; } }, over.noInput ? null : input);
  return { prevented, focused };
};
check("composer: a press on the card's own surface focuses the textarea (inside a focusable <main>)", () => assert.deepEqual(press(card), { prevented: true, focused: true }));
check("composer: a press on a non-control wrapper inside the card focuses the textarea", () => assert.deepEqual(press(buttons), { prevented: true, focused: true }));
check("composer: a press on a button inside the card stays with the button", () => assert.deepEqual(press(trigger), { prevented: false, focused: false }));
check("composer: a disabled textarea is not focused", () => assert.deepEqual(press(card, { input: { disabled: true } }), { prevented: false, focused: false }));
check("composer: a read-only textarea (the seat is unavailable) is not focused", () => assert.deepEqual(press(card, { input: { readOnly: true } }), { prevented: false, focused: false }));
check("composer: only the primary button forwards", () => assert.deepEqual(press(card, { button: 2 }), { prevented: false, focused: false }));
check("composer: no textarea, no action", () => assert.deepEqual(press(card, { noInput: true }), { prevented: false, focused: false }));
check("composer: wired on the composer card in ChatPanel", () => assert.match(readFileSync(new URL("ChatPanel.tsx", SRC), "utf8"), /className=\{`hps-input\$\{dragActive \? " hps-input-drag" : ""\}`\}\s+data-expanded=\{[^}]+\}\s+data-file-context=\{[^}]+\}\s+onMouseDown=\{event => composerSurfacePress\(event, textareaRef\.current\)\}/));

// ─── The × is a 44px target with a small visible dot: hover/pressed paint the dot, never the 44px box ───────
// #2377's hover layer is a full-box linear-gradient. Applied to the 44px button it replaces the dark dot with a faint 44px
// circle. The dot is the button's ::before; the button itself stays transparent and only ::before takes the state layer.
const rawStyles = readFileSync(new URL("styles.css", SRC), "utf8");  // readDesignFile resolves tokens to values; tokens-only checks read the source
const removeRules = (css) => rules(css, "styles.css").filter((r) => r.selectors.some((x) => /\.hps-attachment-remove(?![\w-])/.test(x) && !/^@/.test(x)));
const paints = (r) => r.decls.some(([k]) => k === "background" || k === "background-image" || k === "background-color");
const dotLayerOnly = (css, raw) => {
  const all = removeRules(css);
  const onButton = all.filter((r) => r.selectors.some((x) => /\.hps-attachment-remove:(hover|active)$/.test(x)));
  assert.deepEqual(onButton.filter(paints).map((r) => r.selectors[0]), [], "a hover/pressed rule paints the 44px button, replacing the dot");
  for (const state of ["hover", "active"]) {
    const dotRule = all.filter((r) => r.selectors.some((x) => x.endsWith(`.hps-attachment-remove:${state}::before`)));
    assert.ok(dotRule.length, `${state}: the dot has no state rule`);
    const src = removeRules(raw).filter((r) => r.selectors.some((x) => x.endsWith(`:${state}::before`))).flatMap((r) => r.decls).map(([, v]) => v).join(" ");
    assert.ok(src.includes(`var(--hp-bg-layer-${state === "active" ? "pressed" : "hover"})`), `${state}: not the shared layer token`);
    assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(src), `${state}: raw colour, tokens only`);
  }
  const dot = all.filter((r) => r.selectors.some((x) => x.endsWith(".hps-attachment-remove::before"))).flatMap((r) => r.decls);
  const get = (k) => dot.find(([d]) => d === k)?.[1];
  assert.equal(get("border-radius"), "50%", "the dot is a circle");
  assert.ok(get("background-color"), "the dot has its own fill");
  const base = all.filter((r) => r.selectors.includes(".hps-attachment-remove")).flatMap((r) => r.decls);
  assert.equal(base.find(([d]) => d === "background")?.[1], "transparent", "the 44px button is transparent: the dot is the only visible fill");
  assert.ok(!base.some(([d, v]) => d.startsWith("background") && /gradient/.test(v)), "no gradient paints the 44px button at rest");
};
check("image remove ×: the state layer is on the dot only; the 44px button stays transparent", () => dotLayerOnly(real["styles.css"], rawStyles));
check("image remove ×: negative control, main's full-box hover layer on the button fails", () => {
  const mutate = (c) => c.replace(/(\.hps-attachment-remove:hover::before)(\s*\{)/, ".hps-attachment-remove:hover$2");
  const bad = mutate(real["styles.css"]);
  assert.notEqual(bad, real["styles.css"]);
  assert.throws(() => dotLayerOnly(bad, mutate(rawStyles)), /replacing the dot/);
});
check("image remove ×: negative control, a radial dot swapped back for the full box fails", () => {
  const bad = real["styles.css"].replace(/(\.hps-attachment-remove\s*\{[^}]*?)background:\s*transparent/, "$1background: red");
  assert.notEqual(bad, real["styles.css"]);
  assert.throws(() => dotLayerOnly(bad, rawStyles), /transparent/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
