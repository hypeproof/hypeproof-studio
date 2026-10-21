// CGP-AGENT-D-007 — the refusal banner's stylesheet, locked from the CSS text (pattern of
// ui-polish-1.smoke.mjs): each check is a function over the stylesheet, and each also runs against a
// mutated copy that must fail (negative controls).
//   1. readable surface: when the theme defines no --vscode-editorWidget-background the fallback is a
//      tint of the TEXT colour (never the dark-only --hp-panel under a theme text colour), so light
//      themes stay readable;
//   2. does not cover the draft: in normal flow (no fixed/absolute/sticky, no transform);
//   3. no slide-in motion: animation and transition are none;
//   4. the dismiss control is a 44px target; 14px type from the type-scale token.
//   node --experimental-strip-types test/refusal-banner-css.smoke.mjs
import assert from "node:assert/strict";
import { readDesignFile as readFileSync } from "./lib/design-token-values.mjs";

const FILE = "refusalBanner.css";
const real = readFileSync(new URL(`../webview-ui/src/${FILE}`, import.meta.url), "utf8");
let passed = 0;
const failures = [];
const check = (label, fn) => { try { fn(); passed++; console.log(`  ok   ${label}`); } catch (e) { failures.push(label); console.error(`  FAIL ${label}: ${e.message.split("\n")[0]}`); } };

/** Top-level rules with their media context; declarations split on ';' outside parentheses. */
function rules(raw) {
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  const walk = (from, to, media) => {
    let i = from;
    while (i < to) {
      const open = css.indexOf("{", i);
      if (open < 0 || open >= to) break;
      const head = css.slice(i, open).trim();
      let depth = 1, j = open + 1;
      for (; j < to && depth; j++) depth += css[j] === "{" ? 1 : css[j] === "}" ? -1 : 0;
      const body = css.slice(open + 1, j - 1);
      if (head.startsWith("@media")) walk(open + 1, j - 1, head.slice(6).trim());
      else {
        const decls = {}; let d = 0, cur = "";
        const flush = () => { const k = cur.indexOf(":"); if (k > 0) decls[cur.slice(0, k).trim()] = cur.slice(k + 1).trim(); cur = ""; };
        for (const ch of body) { if (ch === "(") d++; if (ch === ")") d--; if (ch === ";" && !d) flush(); else cur += ch; }
        flush();
        out.push({ selectors: head.split(",").map((x) => x.trim()), decls, media });
      }
      i = j;
    }
  };
  walk(0, css.length, "");
  return out;
}
const value = (css, selector, prop, media = "") => {
  let v;
  for (const r of rules(css)) if (r.media === media && r.selectors.includes(selector) && r.decls[prop] !== undefined) v = r.decls[prop];
  return v;
};
const BANNER = ".hps-refusal-banner";
const BUTTON = ".hps-refusal-banner button";

const checks = {
  "1 surface falls back to a tint of the text colour": (css) => {
    const bad = [];
    const bg = value(css, BANNER, "background") ?? "", fg = value(css, BANNER, "color") ?? "";
    if (!/^var\(--vscode-editorWidget-background,/.test(bg)) bad.push(`background ${bg}`);
    const fallback = bg.replace(/^var\(--vscode-editorWidget-background,\s*/, "").replace(/\)$/, "");
    if (/--hp-(panel|bg)\b/.test(fallback)) bad.push(`fallback ${fallback} is a dark-only surface; with a light theme's dark text it is unreadable`);
    if (!/--vscode-foreground/.test(fallback)) bad.push(`fallback ${fallback} is not derived from the text colour`);
    if (!/^var\(--vscode-foreground,/.test(fg)) bad.push(`text colour ${fg}`);
    if (/--hp-(panel|bg)\b/.test(fg)) bad.push("text colour is a dark-surface token");
    return bad;
  },
  "2 stays in normal flow above the composer": (css) => {
    const bad = [];
    const position = value(css, BANNER, "position");
    if (position !== undefined && position !== "static" && position !== "relative") bad.push(`position ${position} would float over the draft`);
    for (const prop of ["top", "bottom", "inset", "inset-block-start", "inset-block-end"]) if (value(css, BANNER, prop) !== undefined) bad.push(`${prop} is set`);
    if (value(css, BANNER, "transform") !== "none") bad.push(`transform ${value(css, BANNER, "transform")}`);
    return bad;
  },
  "3 no slide-in motion": (css) => {
    const bad = [];
    if (value(css, BANNER, "animation") !== "none") bad.push(`animation ${value(css, BANNER, "animation")}`);
    if (value(css, BANNER, "transition") !== "none") bad.push(`transition ${value(css, BANNER, "transition")}`);
    if (/@keyframes/.test(css)) bad.push("keyframes declared");
    return bad;
  },
  "4 44px dismiss target and 14px type": (css) => {
    const bad = [];
    if (value(css, BUTTON, "min-height") !== "44px") bad.push(`min-height ${value(css, BUTTON, "min-height")}`);
    if (value(css, BUTTON, "min-width") !== "44px") bad.push(`min-width ${value(css, BUTTON, "min-width")}`);
    if (value(css, BANNER, "font-size") !== "var(--hp-text-caption)") bad.push(`font-size ${value(css, BANNER, "font-size")}`);
    return bad;
  },
  "5 forced colours keep an edge": (css) => {
    const bad = [];
    if (value(css, BANNER, "border-color", "(forced-colors: active)") !== "CanvasText") bad.push("banner edge not repainted");
    if (value(css, BUTTON, "border-color", "(forced-colors: active)") !== "ButtonText") bad.push("button edge not repainted");
    return bad;
  },
};

const NEGATIVE = [
  ["1", "fallback back to the dark-only --hp-panel", (s) => s.replace(/color-mix\([^;]*?transparent\)/, "var(--hp-panel)")],
  ["1", "fallback is an unrelated literal", (s) => s.replace(/color-mix\([^;]*?transparent\)/, "#202C24")],
  ["1", "text colour on a dark-surface token", (s) => s.replace("color: var(--vscode-foreground, var(--hp-ink));", "color: var(--hp-panel);")],
  ["2", "position fixed over the draft", (s) => s.replace("  animation: none;", "  position: fixed; bottom: 0;\n  animation: none;")],
  ["2", "position sticky", (s) => s.replace("  animation: none;", "  position: sticky;\n  animation: none;")],
  ["2", "transform set", (s) => s.replace("transform: none;", "transform: translateY(8px);")],
  ["3", "animated entry", (s) => s.replace("  animation: none;", "  animation: hps-slide .3s;")],
  ["3", "transition on", (s) => s.replace("transition: none;", "transition: opacity .2s;")],
  ["4", "dismiss button 30px", (s) => s.replace("min-height: 44px;", "min-height: 30px;")],
  ["4", "dismiss button 30px wide", (s) => s.replace("min-width: 44px;", "min-width: 30px;")],
  ["4", "10px type", (s) => s.replace("font-size: var(--hp-text-caption);", "font-size: 10px;")],
  ["5", "forced colours edge dropped", (s) => s.replace("border-color: CanvasText;", "")],
];

for (const [name, fn] of Object.entries(checks)) check(`css ${name}`, () => assert.deepEqual(fn(real), [], fn(real).join("; ")));
for (const [key, label, mutate] of NEGATIVE) {
  const name = Object.keys(checks).find((n) => n.startsWith(key + " "));
  check(`negative control: ${label} -> ${name} fails`, () => {
    const css = mutate(real);
    assert.notEqual(css, real, "the mutation did not apply (a stale search string proves nothing)");
    assert.ok(checks[name](css).length > 0, "the mutated stylesheet still passes");
  });
}
if (failures.length) { console.error(`\n${failures.length} failed: ${failures.join("; ")}`); process.exit(1); }
console.log(`refusal-banner css OK (${passed} checks)`);
