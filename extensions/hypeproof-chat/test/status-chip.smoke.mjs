import { readDesignFile as readFileSync } from "./lib/design-token-values.mjs";
// CGP-DS-D-004 (DES-CGP-DS-05) — the status chip's stylesheet (styles.css `.hp-status-chip`):
//   1. geometry: 16px icon that never shrinks, 14px label (the caption step), 4px radius, 8px inline padding;
//   2. soft background: each intent's own colour at 8–20% over the surface, never solid, the icon in
//      that colour, five different fills, and the neutral (unverified) chip dashed;
//   3. contrast with every host variable absent (the HP palette): label ≥4.5:1 and icon ≥3:1 on the
//      fill over the app and panel surfaces;
//   4. a chip in a narrow rail wraps a Korean word between eojeol and is never cut;
//   5. forced colours: a CanvasText boundary, text and icon on Canvas;
//   6. CGP-DS-R-006 (REQ-CGP-DS-05): each named intent has its own edge (style + width), so a grayscale
//      capture separates the intents; the edge survives forced colours, the block padding gives back what a
//      heavier edge takes (one outer height), and every status family's mark is this chip, not its own look.
//   node --experimental-strip-types test/status-chip.smoke.mjs
//
// Each check is a function over the stylesheet text, so it also runs against mutated copies that must
// fail (negative controls). The rule walker is the one in test/ui-polish-1.smoke.mjs.
import assert from "node:assert/strict";

const SRC = new URL("../webview-ui/src/", import.meta.url);
const FILES = ["tokens.css", "styles.css"];
const real = Object.fromEntries(FILES.map((f) => [f, readFileSync(new URL(f, SRC), "utf8")]));
let passed = 0;
const failures = [];
const check = (label, fn) => {
  try { fn(); passed++; console.log(`  ok   ${label}`); } catch (e) { failures.push(label); console.error(`  FAIL ${label}: ${e.message.split("\n")[0]}`); }
};

// ─── CSS rules with their media context ─────────────────────────────────────────────────────────
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
/** Every declaration on an exact selector in one media context, later wins (styles.css only). */
const decls = (css, selector, media = "") => rules(css["styles.css"]).filter((r) => r.media === media && r.selectors.includes(selector)).reduce((a, r) => ({ ...a, ...r.decls }), {});
const tokenBlock = (css, scope) => rules(css["tokens.css"]).filter((r) => r.media === "" && r.selectors.includes(scope)).reduce((a, r) => ({ ...a, ...r.decls }), {});
/** A px length or a calc() of px terms joined by + and -. */
const lengthPx = (v) => {
  const m = /^calc\((.+)\)$/.exec(v ?? "");
  if (!m) return px(v);
  const terms = m[1].split(/\s+([+-])\s+/);
  let total = px(terms[0]);
  for (let k = 1; k < terms.length; k += 2) total += (terms[k] === "+" ? 1 : -1) * px(terms[k + 1]);
  return total;
};
const px = (v) => { assert.match(v ?? "", /^\d+px$/, `a px length: ${v}`); return parseInt(v, 10); };

// ─── contrast ───────────────────────────────────────────────────────────────────────────────────
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (hex) => {
  const c = rgb(hex).map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const over = (top, alpha, under) => "#" + rgb(top).map((t, i) => Math.round(t * alpha + rgb(under)[i] * (1 - alpha)).toString(16).padStart(2, "0")).join("");
/** The HP-palette colour of a value: --hp-* roles resolve through tokens.css :root, host variables fall back. */
const hexOf = (css, value) => {
  const root = tokenBlock(css, ":root");
  let v = value ?? "";
  for (let n = 0; n < 8; n++) v = v.replace(/var\((--hp-[\w-]+)\)/g, (m, name) => root[name] ?? m);
  const m = /#[0-9A-Fa-f]{6}\b/.exec(v);
  return m ? m[0].toLowerCase() : undefined;
};

const CHIP = ".hp-status-chip";
const ICON = ".hp-status-chip .hps-icon";
const INTENTS = ["success", "caution", "info", "neutral", "danger"];
const intent = (i) => `.hp-status-chip[data-intent="${i}"]`;
// The documented intent edges (docs/studio-requirements.md "Status intents (CGP-DS-R-006)"): severity reads
// as weight — danger double 3px, caution solid 2px — and the calm intents differ by line pattern.
const EDGE = { info: "dotted/1", success: "solid/1", caution: "solid/2", neutral: "dashed/1", danger: "double/3" };
const MIX = /^color-mix\(in srgb, (.+) (\d+(?:\.\d+)?)%, transparent\)$/;

const checks = {
  "1 geometry: 16px icon, 14px label, 4px radius, 8px inline padding": (css) => {
    const chip = decls(css, CHIP), icon = decls(css, ICON);
    assert.equal(px(chip["border-radius"]), 4, "radius");
    assert.equal(px(chip["padding-inline"]), 8, "inline padding");
    assert.ok(px(chip["padding-block"]) <= 4, "block padding stays small");
    assert.equal(px(icon["inline-size"]), 16, "icon inline size");
    assert.equal(px(icon["block-size"]), 16, "icon block size");
    assert.equal(icon.flex, "none", "the icon never shrinks beside a long label");
    assert.equal(chip["font-size"], "var(--hp-font-caption)", "label takes the caption step");
    // The caption step is 14px plus the learner's text-size step, which is 0 by default.
    const caption = tokenBlock(css, ".hps-shell")["--hp-font-caption"] ?? "";
    assert.match(caption, /^calc\(14px \+ var\(--hp-font-step\)\)$/, `caption step is ${caption}`);
    assert.equal(tokenBlock(css, ":root")["--hp-font-step"], "0px");
    assert.equal(chip.display, "inline-flex");
    assert.equal(chip["align-items"], "center");
  },
  "2 soft fill: the intent colour at 8–20%, the icon in it, five fills, neutral dashed": (css) => {
    const inks = INTENTS.map((i) => {
      const fill = decls(css, intent(i))["background-color"];
      const m = MIX.exec(fill ?? "");
      assert.ok(m, `${i}: fill is a soft mix over the surface: ${fill}`);
      const share = Number(m[2]);
      assert.ok(share >= 8 && share <= 20, `${i}: ${share}% is not soft`);
      assert.equal(decls(css, `${intent(i)} .hps-icon`).color, m[1], `${i}: the icon is not in the fill's colour`);
      return m[1];
    });
    assert.equal(new Set(inks).size, INTENTS.length, `two intents share a colour: ${inks.join(" | ")}`);
    const neutral = decls(css, intent("neutral"));
    assert.equal(neutral["border-style"], "dashed", "unverified is dashed");
    assert.match(neutral["border-color"] ?? "", /^var\(--hp-border-muted-default\)$/);
    assert.match(decls(css, CHIP).border ?? "", /solid transparent$/, "the base edge is transparent: each intent paints its own (check 6)");
  },
  "3 contrast: label ≥4.5:1 and icon ≥3:1 on each fill over app and panel": (css) => {
    const root = tokenBlock(css, ":root");
    const label = hexOf(css, decls(css, CHIP).color);
    assert.ok(label, "label colour resolves");
    const bad = [];
    for (const i of INTENTS) {
      const m = MIX.exec(decls(css, intent(i))["background-color"] ?? "");
      const ink = hexOf(css, m?.[1]);
      if (!ink) { bad.push(`${i}: no colour`); continue; }
      for (const [name, role] of [["app", "--hp-bg-app-default"], ["panel", "--hp-bg-panel-default"]]) {
        const surface = hexOf(css, root[role]);
        const fill = over(ink, Number(m[2]) / 100, surface);
        if (ratio(label, fill) < 4.5) bad.push(`${i} label on ${name}: ${ratio(label, fill).toFixed(2)}:1`);
        if (ratio(ink, fill) < 3) bad.push(`${i} icon on ${name}: ${ratio(ink, fill).toFixed(2)}:1`);
      }
    }
    assert.deepEqual(bad, []);
  },
  "4 no truncation: wraps between eojeol, never cut": (css) => {
    const chip = decls(css, CHIP);
    assert.equal(chip["white-space"], "normal");
    assert.equal(chip["word-break"], "keep-all");
    assert.equal(chip["overflow-wrap"], "anywhere");
    assert.equal(chip["max-width"], "100%");
    assert.equal(chip["min-width"], "0");
    for (const k of ["text-overflow", "overflow", "-webkit-line-clamp"]) assert.equal(chip[k], undefined, `chip sets ${k}`);
    assert.equal(decls(css, ".hp-status-chip-label")["min-width"], "0");
  },
  "5 forced colours: CanvasText boundary, text and icon on Canvas": (css) => {
    const media = "(forced-colors: active)";
    // The forced rules carry [data-intent] so they outrank every per-intent fill and icon rule.
    const chip = decls(css, `${CHIP}[data-intent]`, media), icon = decls(css, `${CHIP}[data-intent] .hps-icon`, media);
    assert.equal(chip["border-color"], "CanvasText");
    assert.equal(chip.color, "CanvasText");
    assert.equal(chip["background-color"], "Canvas");
    assert.equal(icon.color, "CanvasText");
  },
  "6 intents: one edge pattern each, visible in grayscale and forced colours, one outer height": (css) => {
    const base = decls(css, CHIP);
    const baseEdge = px(/^(\d+px)\b/.exec(base.border ?? "")?.[1]);
    const basePad = px(base["padding-block"]);
    const edges = INTENTS.map((i) => {
      const d = decls(css, intent(i));
      const style = d["border-style"];
      assert.ok(["solid", "dashed", "dotted", "double"].includes(style), `${i}: edge style ${style}`);
      assert.ok(d["border-color"] && !/transparent/.test(d["border-color"]), `${i}: the edge is painted (${d["border-color"]})`);
      const width = d["border-width"] ? px(d["border-width"]) : baseEdge;
      if (style === "double") assert.ok(width >= 3, `${i}: a double edge needs 3px to show two lines`);
      // One outer height: block padding + edge is the same for every intent.
      const pad = d["padding-block"] ? lengthPx(d["padding-block"]) : basePad;
      assert.ok(pad >= 0, `${i}: block padding ${pad}`);
      assert.equal(pad + width, basePad + baseEdge, `${i}: outer height moves (${pad}px padding + ${width}px edge)`);
      assert.equal(`${style}/${width}`, EDGE[i], `${i}: edge is ${style}/${width}px, the documented pattern is ${EDGE[i]}`);
      return `${style}/${width}`;
    });
    assert.equal(new Set(edges).size, INTENTS.length, `two intents share an edge pattern in grayscale: ${edges.join(" | ")}`);
    // Forced colours repaint the edge but must not flatten its style or width.
    const forced = decls(css, `${CHIP}[data-intent]`, "(forced-colors: active)");
    for (const k of ["border", "border-style", "border-width"]) assert.equal(forced[k], undefined, `forced colours reset ${k}`);
    // No family keeps a look of its own that would override the intent (task rail, product test, delegation, help).
    for (const sel of [".hps-verify-state", ".hps-verify-badge", ".hps-delegation-status", ".hp-help-status"]) {
      for (const k of ["background", "background-color", "border", "border-color", "border-style", "border-width", "color", "padding", "font-weight"]) assert.equal(decls(css, sel)[k], undefined, `${sel} sets ${k} over its intent`);
    }
    for (const r of rules(css["styles.css"])) for (const sel of r.selectors) assert.ok(!/^\.hps-verify-state-/.test(sel), `per-state look ${sel} outside the intent`);
  },
};
for (const [label, fn] of Object.entries(checks)) check(label, () => fn(real));

// ─── negative controls: each mutation must make its check fail ─────────────────────────────────
const mutate = (file, from, to) => {
  const text = real[file];
  assert.ok(text.includes(from), `negative control is stale: "${from.slice(0, 60)}" not in ${file}`);
  return { ...real, [file]: text.split(from).join(to) };
};
const negatives = [
  ["1 geometry", "12px icon", mutate("styles.css", ".hp-status-chip .hps-icon { flex: none; inline-size: 16px; block-size: 16px; }", ".hp-status-chip .hps-icon { flex: none; inline-size: 12px; block-size: 12px; }")],
  ["1 geometry", "icon may shrink", mutate("styles.css", ".hp-status-chip .hps-icon { flex: none;", ".hp-status-chip .hps-icon {")],
  ["1 geometry", "12px label", mutate("styles.css", "color: var(--hp-text-primary-default); font-size: var(--hp-font-caption); line-height: var(--hp-leading-label);\n  white-space: normal;", "color: var(--hp-text-primary-default); font-size: 12px; line-height: var(--hp-leading-label);\n  white-space: normal;")],
  ["1 geometry", "pill radius", mutate("styles.css", "border: 1px solid transparent; border-radius: 4px;", "border: 1px solid transparent; border-radius: 999px;")],
  ["1 geometry", "6px inline padding", mutate("styles.css", "padding-inline: 8px;\n  border: 1px solid transparent", "padding-inline: 6px;\n  border: 1px solid transparent")],
  ["2 soft fill", "danger fill solid", mutate("styles.css", "var(--vscode-errorForeground, #f48771) 14%, transparent", "var(--vscode-errorForeground, #f48771) 100%, transparent")],
  ["2 soft fill", "caution fill removed", mutate("styles.css", '.hp-status-chip[data-intent="caution"] { background-color: color-mix(in srgb, var(--hp-text-warn-default) 14%, transparent); border-style', '.hp-status-chip[data-intent="caution"] { border-style')],
  ["2 soft fill", "success icon in the body colour", mutate("styles.css", '.hp-status-chip[data-intent="success"] .hps-icon { color: var(--vscode-charts-green, #4ec9b0); }', '.hp-status-chip[data-intent="success"] .hps-icon { color: var(--hp-text-primary-default); }')],
  ["2 soft fill", "info tinted like success", mutate("styles.css", '.hp-status-chip[data-intent="info"] { background-color: color-mix(in srgb, var(--hp-text-primary-default) 14%, transparent); border-style: dotted; border-color: var(--hp-text-primary-default); }\n.hp-status-chip[data-intent="info"] .hps-icon { color: var(--hp-text-primary-default); }', '.hp-status-chip[data-intent="info"] { background-color: color-mix(in srgb, var(--vscode-charts-green, #4ec9b0) 14%, transparent); border-style: dotted; border-color: var(--hp-text-primary-default); }\n.hp-status-chip[data-intent="info"] .hps-icon { color: var(--vscode-charts-green, #4ec9b0); }')],
  ["2 soft fill", "unverified not dashed", mutate("styles.css", " border-style: dashed; border-color: var(--hp-border-muted-default); }", " }")],
  ["3 contrast", "label in the divider colour", mutate("styles.css", "color: var(--hp-text-primary-default); font-size: var(--hp-font-caption)", "color: var(--hp-border-divider-default); font-size: var(--hp-font-caption)")],
  ["3 contrast", "dark danger ink", mutate("styles.css", "var(--vscode-errorForeground, #f48771)", "var(--vscode-errorForeground, #c62828)")],
  ["4 no truncation", "ellipsis", mutate("styles.css", "white-space: normal; word-break: keep-all; overflow-wrap: anywhere;\n}", "white-space: nowrap; word-break: keep-all; overflow-wrap: anywhere; overflow: hidden; text-overflow: ellipsis;\n}")],
  ["4 no truncation", "Hangul split mid-word", mutate("styles.css", "white-space: normal; word-break: keep-all; overflow-wrap: anywhere;\n}", "white-space: normal; overflow-wrap: anywhere;\n}")],
  ["5 forced colours", "forced block removed", mutate("styles.css", "  .hp-status-chip[data-intent] { border-color: CanvasText; color: CanvasText; background-color: Canvas; }\n", "")],
  ["6 intents", "info edge like success (solid)", mutate("styles.css", "border-style: dotted; border-color: var(--hp-text-primary-default);", "border-style: solid; border-color: var(--hp-text-primary-default);")],
  ["6 intents", "danger edge single", mutate("styles.css", "border-style: double; border-width: 3px;", "border-style: solid; border-width: 3px;")],
  ["6 intents", "caution edge 1px (like success)", mutate("styles.css", "border-style: solid; border-width: 2px; border-color: var(--hp-text-warn-default);", "border-style: solid; border-color: var(--hp-text-warn-default);")],
  ["6 intents", "success edge left transparent", mutate("styles.css", "14%, transparent); border-style: solid; border-color: var(--vscode-charts-green, #4ec9b0); }", "14%, transparent); }")],
  ["6 intents", "danger chip taller (no padding give-back)", mutate("styles.css", "padding-block: calc(2px + 1px - 3px); }", "}")],
  ["6 intents", "forced colours flatten the edge", mutate("styles.css", "  .hp-status-chip[data-intent] { border-color: CanvasText;", "  .hp-status-chip[data-intent] { border: 1px solid CanvasText;")],
  ["6 intents", "verify state keeps its own fill", mutate("styles.css", ".hps-verify-head {", ".hps-verify-state-failed { background: #400; }\n.hps-verify-head {")],
  ["6 intents", "verdict badge keeps its own weight", mutate("styles.css", ".hps-verify-head {", ".hps-verify-badge { font-weight: 700; }\n.hps-verify-head {")],
  ["6 intents", "delegation status keeps its own weight", mutate("styles.css", ".hps-delegation-status { flex: 0 0 auto; }", ".hps-delegation-status { flex: 0 0 auto; font-weight: 600; }")],
  ["5 forced colours", "forced icon colour removed", mutate("styles.css", "  .hp-status-chip[data-intent] .hps-icon { color: CanvasText; }\n", "")],
];
for (const [prefix, label, css] of negatives) {
  const name = Object.keys(checks).find((k) => k.startsWith(prefix));
  check(`negative control fails: ${label}`, () => assert.throws(() => checks[name](css), undefined, `${name} still passes`));
}

console.log(`status-chip: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
