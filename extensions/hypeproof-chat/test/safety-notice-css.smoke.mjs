// DES-CGP-LEARN-13 — CSS guards for the learner safety notice (.hps-safety-*): no red alarm styling,
// no motion, 14px text, a 44px close button whose focus ring hugs it, numbers that do not break, and
// forced colours. The checks are functions over the shipped stylesheet text; each also runs against
// mutated copies that must fail (negative controls). Stylesheet-rule pattern of ui-polish-1.smoke.mjs.
//   node --experimental-strip-types test/safety-notice-css.smoke.mjs
import { readFileSync } from "node:fs";

const SRC = new URL("../webview-ui/src/", import.meta.url);
const FILES = ["styles.css", "chatDetails.css", "taskWorkspace.css", "tokens.css"];
const real = Object.fromEntries(FILES.map((f) => [f, readFileSync(new URL(f, SRC), "utf8")]));

// ─── CSS: rules with their media context ────────────────────────────────────────────────────────
/** Split a selector list on commas outside parentheses (":has(a, b)" stays one selector). */
function splitTop(list) {
  const out = []; let depth = 0, cur = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  return [...out, cur].map((x) => x.trim()).filter(Boolean);
}
function rules(raw) {
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  const walk = (from, to, media) => {
    let i = from;
    while (i < to) {
      const open = css.indexOf("{", i);
      if (open < 0 || open >= to) return;
      const head = css.slice(i, open).trim();
      let depth = 1, j = open + 1;
      for (; j < to && depth; j++) depth += css[j] === "{" ? 1 : css[j] === "}" ? -1 : 0;
      if (/^@media\b/.test(head)) walk(open + 1, j - 1, head.replace(/^@media\s*/, ""));
      else if (!head.startsWith("@")) {
        const body = css.slice(open + 1, j - 1);
        const decls = {};
        for (const d of body.split(";")) { const k = d.indexOf(":"); if (k > 0) decls[d.slice(0, k).trim()] = d.slice(k + 1).trim(); }
        out.push({ selectors: splitTop(head).map((s) => s.replace(/\s+/g, " ").trim()), decls, media });
      }
      i = j;
    }
  };
  walk(0, css.length, "");
  return out;
}
const all = (css) => Object.entries(css).flatMap(([file, text]) => rules(text).map((r) => ({ ...r, file })));
/** The last declaration of `prop` on an exact selector within one media context. */
const value = (css, selector, prop, media = "") => {
  let v;
  for (const r of all(css)) if (r.media === media && r.selectors.includes(selector) && r.decls[prop] !== undefined) v = r.decls[prop];
  return v;
};
/** Every rule that styles any .hps-safety-* element, in any media context. */
const safetyRules = (css) => all(css).filter((r) => r.selectors.some((s) => s.includes(".hps-safety-")));
const px = (v) => (/^(\d+(?:\.\d+)?)px$/.exec(v ?? "") ? Number(RegExp.$1) : NaN);
/** A colour that reads as red/alarm: a hex or rgb() with red dominant, or an error/validation theme token. */
function alarm(v) {
  if (/error|invalid|danger|warning|testing-icon(Failed|Errored)|statusBarItem-error/i.test(v)) return true;
  for (const m of v.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    if (r > 150 && r > g + 60 && r > b + 60) return true;
  }
  for (const m of v.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/gi)) {
    const [r, g, b] = [m[1], m[2], m[3]].map(Number);
    if (r > 150 && r > g + 60 && r > b + 60) return true;
  }
  return false;
}

const checks = {
  "calm surface: the stop-notice palette, no red or error tokens": (css) => {
    const bad = [];
    const n = ".hps-safety-notice";
    if (!/^var\(--vscode-editorWidget-background\b/.test(value(css, n, "background") ?? "")) bad.push(`background ${value(css, n, "background")}`);
    if (!/^var\(--vscode-foreground\b/.test(value(css, n, "color") ?? "")) bad.push(`color ${value(css, n, "color")}`);
    if (!/^1px solid var\(--vscode-widget-border\b/.test(value(css, n, "border") ?? "")) bad.push(`border ${value(css, n, "border")}`);
    for (const r of safetyRules(css)) for (const [k, v] of Object.entries(r.decls)) if (alarm(v)) bad.push(`${r.selectors.join(",")} ${k}: ${v}`);
    return bad;
  },
  "no motion": (css) => safetyRules(css).flatMap((r) => Object.keys(r.decls).filter((k) => /^(animation|transition)/.test(k)).map((k) => `${r.selectors.join(",")} ${k}`)),
  "14px text everywhere in the notice": (css) => {
    const bad = [];
    for (const sel of [".hps-safety-notice", ".hps-safety-title", ".hps-safety-msg", ".hps-safety-intro", ".hps-safety-adult", ".hps-safety-lines", ".hps-safety-dismiss"]) {
      if (!(px(value(css, sel, "font-size")) >= 14)) bad.push(`${sel} font-size ${value(css, sel, "font-size")}`);
    }
    if (!(px(value(css, ".hps-safety-number", "font-size")) >= 14)) bad.push("number font-size");
    return bad;
  },
  "numbers stay whole and selectable; lines wrap as units": (css) => {
    const bad = [];
    if (value(css, ".hps-safety-number", "white-space") !== "nowrap") bad.push("number may break");
    if (value(css, ".hps-safety-number", "user-select") !== "text") bad.push("number not selectable");
    if (value(css, ".hps-safety-lines", "flex-wrap") !== "wrap") bad.push("lines do not wrap");
    if (value(css, ".hps-safety-msg", "overflow-wrap") !== "anywhere") bad.push("long sentence may overflow");
    return bad;
  },
  "close button: 44px target and a hugging focus ring": (css) => {
    const bad = [];
    const b = ".hps-safety-dismiss";
    if (!(px(value(css, b, "min-height")) >= 44)) bad.push(`min-height ${value(css, b, "min-height")}`);
    if (!(px(value(css, b, "min-width")) >= 44)) bad.push(`min-width ${value(css, b, "min-width")}`);
    const outline = value(css, `${b}:focus-visible`, "outline") ?? "";
    if (outline !== "2px solid var(--hp-ring)") bad.push(`outline ${outline}`);
    const off = px(value(css, `${b}:focus-visible`, "outline-offset"));
    if (!(off >= 1 && off <= 3)) bad.push(`outline-offset ${off}`);
    return bad;
  },
  "forced colours keep the boundary and the focus": (css) => {
    const bad = [];
    const m = "(forced-colors: active)";
    if (value(css, ".hps-safety-notice", "border-color", m) !== "CanvasText") bad.push("notice border");
    if (value(css, ".hps-safety-dismiss", "border-color", m) !== "ButtonText") bad.push("button border");
    // The ring itself turns Highlight through --hp-ring (tokens.css); this rule must not override it.
    if (value(css, ".hps-safety-dismiss:focus-visible", "outline-color", m) !== undefined) bad.push("focus colour overridden");
    if (!/--hp-ring: Highlight/.test(css["tokens.css"] ?? "")) bad.push("tokens.css no longer maps --hp-ring to Highlight");
    return bad;
  },
};
const S = "styles.css";
const mutations = {
  "calm surface: the stop-notice palette, no red or error tokens": [
    [S, "background: var(--vscode-editorWidget-background, rgba(127, 127, 127, 0.08));\n  border: 1px solid var(--vscode-widget-border, rgba(127, 127, 127, 0.25));\n  border-left: 2px solid var(--vscode-descriptionForeground, #888);\n  color: var(--vscode-foreground, #ddd);\n  font-size: 14px; line-height: 1.5;", "background: rgba(255, 80, 80, 0.12);\n  border: 1px solid rgba(255, 80, 80, 0.4);\n  border-left: 2px solid var(--vscode-descriptionForeground, #888);\n  color: var(--vscode-foreground, #ddd);\n  font-size: 14px; line-height: 1.5;"],
    [S, ".hps-safety-title { margin: 0 0 4px; font-size: 14px; font-weight: 600; }", ".hps-safety-title { margin: 0 0 4px; font-size: 14px; font-weight: 600; color: var(--vscode-errorForeground, #f48771); }"],
    [S, "border-left: 2px solid var(--vscode-descriptionForeground, #888);\n  color: var(--vscode-foreground, #ddd);\n  font-size: 14px; line-height: 1.5;", "border-left: 2px solid #ff4d4d;\n  color: var(--vscode-foreground, #ddd);\n  font-size: 14px; line-height: 1.5;"],
  ],
  "no motion": [[S, ".hps-safety-title { margin: 0 0 4px;", ".hps-safety-title { animation: hp-pulse 1s infinite; margin: 0 0 4px;"]],
  "14px text everywhere in the notice": [
    [S, ".hps-safety-msg, .hps-safety-intro, .hps-safety-adult { margin: 0 0 6px; font-size: 14px;", ".hps-safety-msg, .hps-safety-intro, .hps-safety-adult { margin: 0 0 6px; font-size: 12px;"],
    [S, "  font-size: 14px; font-weight: 600;\n}\n.hps-safety-dismiss:focus-visible", "  font-size: 12px; font-weight: 600;\n}\n.hps-safety-dismiss:focus-visible"],
  ],
  "numbers stay whole and selectable; lines wrap as units": [
    [S, "user-select: text; white-space: nowrap; }", "user-select: text; }"],
    [S, "user-select: text; white-space: nowrap; }", "user-select: none; white-space: nowrap; }"],
  ],
  "close button: 44px target and a hugging focus ring": [
    [S, "min-width: 44px; min-height: 44px; padding: 6px 14px;", "min-width: 44px; min-height: 32px; padding: 6px 14px;"],
    [S, ".hps-safety-dismiss:focus-visible { outline: 2px solid var(--hp-ring); outline-offset: 2px; }", ".hps-safety-dismiss:focus-visible { outline: none; }"],
    [S, ".hps-safety-dismiss:focus-visible { outline: 2px solid var(--hp-ring); outline-offset: 2px; }", ".hps-safety-dismiss:focus-visible { outline: 2px solid var(--hp-ring); outline-offset: 6px; }"],
  ],
  "forced colours keep the boundary and the focus": [
    [S, "  .hps-safety-notice { border-color: CanvasText; }", "  .hps-safety-notice { border-color: transparent; }"],
    [S, "  .hps-safety-dismiss { border-color: ButtonText; }", "  .hps-safety-dismiss { border-color: ButtonText; }\n  .hps-safety-dismiss:focus-visible { outline-color: transparent; }"],
  ],
};

let failed = 0, controls = 0;
for (const [name, fn] of Object.entries(checks)) {
  const bad = fn(real);
  if (bad.length) { failed++; console.error(`  FAIL ${name}: ${bad.join("; ")}`); continue; }
  for (const [file, from, to] of mutations[name]) {
    if (!real[file].includes(from)) { failed++; console.error(`  FAIL mutation source missing for "${name}": ${from.slice(0, 60)}`); continue; }
    const mutated = { ...real, [file]: real[file].replace(from, to) };
    if (!fn(mutated).length) { failed++; console.error(`  FAIL negative control did not fail: ${name} ← ${to.slice(0, 60)}`); }
    controls++;
  }
  console.log(`  ok   ${name} (${mutations[name].length} negative controls)`);
}
if (failed) { console.error(`\n${failed} safety-notice CSS check(s) failed`); process.exit(1); }
console.log(`\nPASS safety-notice-css: ${Object.keys(checks).length} checks, ${controls} negative controls`);
