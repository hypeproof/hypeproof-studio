// CGP-DS-D-028 (DES-CGP-DS-42, CGP-DS-R-034, REQ-STUDIO-TEXT-CONTRAST-TABLE) — the contrast table
// over every text colour the webview CSS actually declares, on every surface it can sit on.
//   node --experimental-strip-types test/text-contrast-table.smoke.mjs
//   HPS_CONTRAST_TABLE=<file.md> also writes the whole table as Markdown.
//
// 1. The muted tokens hold their stated values: forest #ACB9A5 (8.4:1 on #151D19, 7.1:1 on #202C24)
//    and the personal-chat CP-R1 #a4aab3 (6.8:1 on #202226). Never a ChatGPT-style 3.2:1 tertiary.
// 2. Under the HypeProof Studio theme, as VS Code delivers it (the theme's keys, and the colour
//    registry's dark default for every key the theme leaves out), every `color:` declaration in the
//    component CSS is >=4.5:1 on each surface of its scope.
// 3. The same table with no --vscode-* variable at all: every CSS fallback literal is >=4.5:1 too,
//    so a fallback can never be a quieter palette than the one it stands in for.
// 4. Every rule whose colour is a muted token keeps 4.5:1 under each of VS Code's default themes.
//
// A row is one rule's colour on one surface. The surface is the rule's own background when it sets
// one (painted over each surface of its scope when translucent), otherwise each surface of its scope:
//   chat     the app and panel roles and the webview body (sideBar.background), and the personal
//            canvas and rail, because the classroom and personal seats render the same components;
//   personal the --tw-canvas and --tw-panel surfaces of the task workspace;
//   branded  the start and disconnected screens' forest app and panel;
//   paper    the Paper app and panel of the reading surfaces.
// Not text, so not in the table: forced-colors rules (system palette), and rules that only style a
// disabled control (WCAG 1.4.3 exempts inactive components).
//
// Each check is a function over the file texts, so it also runs against mutated copies that must
// fail (negative controls), in the stylesheet-rule pattern of test/ui-polish-1.smoke.mjs.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { readDesignFile } from "./lib/design-token-values.mjs";
import { KIND_CLASS, THEMES } from "./lib/vscode-default-themes.mjs";

const require = createRequire(new URL("../webview-ui/package.json", import.meta.url));
const postcss = require("postcss");
const SRC = new URL("../webview-ui/src/", import.meta.url);
const COMPONENT_CSS = readdirSync(SRC).filter((f) => f.endsWith(".css") && f !== "tokens.css" && f !== "designTokens.css").sort();
const real = {
  "tokens.css": readDesignFile(new URL("tokens.css", SRC)),
  "hypeproof-theme.json": readFileSync(new URL("../media/hypeproof-theme.json", import.meta.url), "utf8"),
  ...Object.fromEntries(COMPONENT_CSS.map((f) => [f, readDesignFile(new URL(f, SRC))])),
};

const TEXT = 4.5;
// An icon is a graphic, not text: WCAG 1.4.11 asks 3:1 of it. A rule is an icon rule when its last
// compound selects an svg, an .hps-icon, a *-icon class or the tool-row mark (a glyph).
const ICON = /(^|[\s>])(svg|\.hps-icon|\.[\w-]+-icon|\.hps-tool-mark)(:[\w-]+)?$/;
const NON_TEXT = 3;
const BRANDED = ".studio-start, .studio-disconnected";
const PAPER = '[data-surface="growth"], .hp-reflection';
// The tokens a muted rule reads (check 4). --hp-ai-can-do-muted is the quiet card's own alias of the role.
const MUTED = /var\(--(hp-text-muted-default|tw-muted|hp-ai-can-do-muted|vscode-descriptionForeground)\b/;

// The colour registry's dark default (src/vs/platform/theme/common/colors/*.ts) for every key the
// component CSS reads and the HypeProof Studio theme does not set. VS Code writes these on the
// webview as --vscode-* for a dark theme, so the CSS fallback behind them never applies there.
const DARK_REGISTRY = {
  errorForeground: "#F48771",
  "charts.green": "#89D185",
  "charts.red": "#F14C4C",               // = editorError.foreground
  "editorInfo.foreground": "#59A4F9",
  "editorWidget.background": "#252526",
  "editorWidget.foreground": "#F2F4E8",  // = foreground
  "list.inactiveSelectionBackground": "#37373D",
  "textBlockQuote.background": "#222222",
  "textCodeBlock.background": "#0A0A0A66",
  "diffEditor.insertedTextBackground": "#9CCC2C33",
  "diffEditor.removedTextBackground": "#FF000033",
  "toolbar.activeBackground": "#63666750",
};

// ─── CSS model ───────────────────────────────────────────────────────────────────────────────────
const SYSTEM = /^(inherit|currentcolor|transparent|initial|unset|revert|canvastext|graytext|highlighttext|highlight|buttontext|buttonface|linktext|canvas|field|fieldtext|mark|marktext)$/i;
const inForced = (n) => { for (let p = n.parent; p; p = p.parent) if (p.type === "atrule" && /forced-colors/.test(p.params)) return true; return false; };
const inKeyframes = (n) => { for (let p = n.parent; p; p = p.parent) if (p.type === "atrule" && /keyframes$/.test(p.name)) return true; return false; };
/** Custom properties of every top-level rule, keyed by its selector list (outside @media). */
function blocks(css) {
  const out = new Map();
  postcss.parse(css).each((n) => {
    if (n.type !== "rule") return;
    const key = n.selectors.map((s) => s.trim()).join(", ");
    const decls = out.get(key) ?? new Map();
    for (const d of n.nodes) if (d.type === "decl" && d.prop.startsWith("--")) decls.set(d.prop, d.value.trim());
    out.set(key, decls);
  });
  return out;
}
function splitVar(inner) {
  let d = 0;
  for (let k = 0; k < inner.length; k++) { if (inner[k] === "(") d++; if (inner[k] === ")") d--; if (inner[k] === "," && d === 0) return [inner.slice(0, k).trim(), inner.slice(k + 1).trim()]; }
  return [inner.trim(), null];
}
/** Substitute var() the way the browser computes a value on one element. */
function resolve(text, env, seen = new Set()) {
  let out = "", i = 0;
  while (i < text.length) {
    const at = text.indexOf("var(", i);
    if (at < 0) { out += text.slice(i); break; }
    out += text.slice(i, at);
    let depth = 1, j = at + 4;
    for (; j < text.length && depth; j++) depth += text[j] === "(" ? 1 : text[j] === ")" ? -1 : 0;
    const [name, fb] = splitVar(text.slice(at + 4, j - 1));
    const raw = seen.has(name) ? null : env.get(name);
    const got = raw == null ? null : resolve(raw, env, new Set([...seen, name]));
    if (got != null) out += got;
    else if (fb != null) { const v = resolve(fb, env, seen); if (v == null) return null; out += v; }
    else return null;
    i = j;
  }
  return out;
}
/** An element that declares `decls` and inherits `env`: its own custom properties resolve there. */
function layer(env, decls) {
  const next = new Map(env);
  for (const [k, v] of decls) next.set(k, v);
  for (const k of decls.keys()) { const v = resolve(next.get(k), next); if (v == null) next.delete(k); else next.set(k, v); }
  return next;
}

// ─── colour maths ────────────────────────────────────────────────────────────────────────────────
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hexOf = (c) => "#" + c.map((n) => Math.round(n).toString(16).padStart(2, "0")).join("").toUpperCase();
/** A colour as painted over `under`: hex with alpha, rgb()/rgba(), color-mix(in srgb, A p%, B|transparent). */
function paint(v, under) {
  v = v?.trim();
  if (!v) return null;
  if (/^#[0-9a-f]{3}$/i.test(v)) v = "#" + [...v.slice(1)].map((c) => c + c).join("");
  if (/^white$/i.test(v)) v = "#FFFFFF";
  if (/^black$/i.test(v)) v = "#000000";
  const m = /^color-mix\(in srgb,\s*(.+?)\s+(\d+(?:\.\d+)?)%,\s*(.+)\)$/i.exec(v);
  if (m) {
    const a = paint(m[1], under), b = m[3].trim() === "transparent" ? under : paint(m[3], under), p = Number(m[2]) / 100;
    return a && b ? hexOf(rgb(a).map((x, i) => x * p + rgb(b)[i] * (1 - p))) : null;
  }
  const f = /^rgba?\(\s*(\d+)\s*,?\s*(\d+)\s*,?\s*(\d+)\s*(?:[,/]\s*([\d.]+)\s*)?\)$/.exec(v);
  if (f) { const a = f[4] == null ? 1 : Number(f[4]); return hexOf([1, 2, 3].map((i) => Number(f[i]) * a + rgb(under)[i - 1] * (1 - a))); }
  if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v)) return null;
  if (v.length === 7) return v.toUpperCase();
  const a = parseInt(v.slice(7), 16) / 255;
  return hexOf(rgb(v).map((x, i) => x * a + rgb(under)[i] * (1 - a)));
}
const lum = (h) => { const c = rgb(h).map((n) => n / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// ─── the environments a rule is computed in ──────────────────────────────────────────────────────
const vscodeVars = (colors) => new Map(Object.entries(colors).filter(([k, v]) => !["kind", "file"].includes(k) && v).map(([k, v]) => [`--vscode-${k.replace(/\./g, "-")}`, v]));
/** Scope environments for one theme: `colors` are the --vscode-* values, `kind` picks the body class. */
function environments(files, colors, kind) {
  const tokens = blocks(files["tokens.css"]);
  const rootDecls = new Map();
  for (const [sel, d] of tokens) if (sel.split(", ").includes(":root")) for (const [k, v] of d) rootDecls.set(k, v);
  const root = layer(vscodeVars(colors), rootDecls);
  const kindSel = (s) => s === `body.${KIND_CLASS[kind]}` || (kind === "hcLight" && s === "body.vscode-high-contrast");
  const bodyDecls = new Map();
  for (const [sel, d] of tokens) if (sel.split(", ").some(kindSel)) for (const [k, v] of d) bodyDecls.set(k, v);
  const body = layer(root, bodyDecls);
  // Component custom properties: the task workspace's --tw-* (and their per-kind rebinding on body)
  // belong to the personal scope; every other one is declared on the component that reads it.
  const own = new Map(), tw = new Map(), twKind = new Map();
  for (const f of COMPONENT_CSS) postcss.parse(files[f]).walkDecls((d) => {
    if (!d.prop.startsWith("--") || d.parent.type !== "rule" || inForced(d)) return;
    const sels = d.parent.selectors.map((s) => s.trim());
    if (sels.some((s) => /^body\.vscode-/.test(s))) { if (sels.some((s) => kindSel(s.split(/\s+/)[0]))) twKind.set(d.prop, d.value); return; }
    (sels.includes(".tw-workspace") ? tw : own).set(d.prop, d.value);
  });
  const chat = layer(body, own);
  const personal = layer(layer(chat, tw), twKind);
  const branded = layer(chat, tokens.get(BRANDED) ?? new Map());
  const paper = layer(chat, tokens.get(PAPER) ?? new Map());
  const sideBar = paint(colors["sideBar.background"] ?? null, "#000000");
  const bg = (env, name, under) => paint(env.get(name), under);
  const appUnder = sideBar ?? bg(chat, "--hp-bg-app-default", "#000000");
  const personalSurfaces = [["--tw-canvas", bg(personal, "--tw-canvas", appUnder)], ["--tw-panel", bg(personal, "--tw-panel", appUnder)]];
  const brandedApp = bg(branded, "--hp-bg-app-default", appUnder), paperApp = bg(paper, "--hp-bg-app-default", appUnder);
  return {
    chat: { env: chat, surfaces: [["--hp-bg-app-default", bg(chat, "--hp-bg-app-default", appUnder)], ["--hp-bg-panel-default", bg(chat, "--hp-bg-panel-default", appUnder)], ...(sideBar ? [["body", sideBar]] : []), ...personalSurfaces] },
    personal: { env: personal, surfaces: personalSurfaces },
    branded: { env: branded, surfaces: [["--hp-bg-app-default", brandedApp], ["--hp-bg-panel-default", bg(branded, "--hp-bg-panel-default", brandedApp)]] },
    paper: { env: paper, surfaces: [["--hp-bg-app-default", paperApp], ["--hp-bg-panel-default", bg(paper, "--hp-bg-panel-default", paperApp)]] },
  };
}
/** The scope a rule renders in, from its file, selector and the colour it reads: --tw-* is declared
 *  only on the task workspace, so a colour that reads it is painted only there (elsewhere the
 *  declaration is invalid at computed-value time and the element inherits its parent's colour). */
function scopeOf(file, selector, color) {
  if (/data-surface="growth"|\.hp-reflection\b/.test(selector)) return "paper";
  if (file === "start.css" || /\.studio-(start|disconnected)\b/.test(selector)) return "branded";
  if (file === "taskWorkspace.css" || file === "citationPreview.css" || /data-chat-detail="personal"|\.tw-/.test(selector) || /^var\(--tw-/.test(color)) return "personal";
  return "chat";
}
const DISABLED = /:disabled|\[disabled\]|\[aria-disabled="true"\]/;
const decl = (r, re) => r.nodes.filter((d) => d.type === "decl" && re.test(d.prop)).at(-1)?.value.replace(/\s*!important$/, "").trim() ?? null;
const STATE = /:(hover|active|focus-visible)$/;
/** Every top-level (non-forced, non-keyframes) rule of the component CSS. */
function allRules(files) {
  const out = [];
  for (const f of COMPONENT_CSS) postcss.parse(files[f]).walkRules((r) => { if (!inForced(r) && !inKeyframes(r)) out.push({ f, r, selectors: r.selectors.map((x) => x.trim().replace(/\s+/g, " ")) }); });
  return out;
}
// Text whose ancestor paints a surface though the selector does not say so: [child class, ancestor class],
// read from the TSX (the child renders inside the ancestor's element). Variants that share a name
// prefix without nesting (.hps-naming-btn-ghost, .hps-fatal-btn-ghost, .hps-error-banner--notice) are not here.
const ANCESTORS = [
  ["hps-queued-send", "hps-queued"], ["hps-queued-label", "hps-queued"], ["hps-queued-cancel", "hps-queued"],
  ["hps-outbound-send", "hps-outbound"],
  ["hps-error-banner-msg", "hps-error-banner"], ["hps-error-banner-retry", "hps-error-banner"], ["hps-error-banner-report", "hps-error-banner"], ["hps-error-banner-dismiss", "hps-error-banner"], ["hps-error-banner-rid", "hps-error-banner"],
  ["hps-update-banner-title", "hps-update-banner"], ["hps-update-banner-sub", "hps-update-banner"], ["hps-update-banner-toggle", "hps-update-banner"], ["hps-update-banner-install", "hps-update-banner"], ["hps-update-banner-dismiss", "hps-update-banner"],
  ["hps-long-step-stop", "hps-long-step"], ["hps-turn-review-note", "hps-turn-review"],
  ["hps-page-card-kind", "hps-page-card"], ["hps-page-card-more", "hps-page-card"], ["hps-delegation-stop", "hps-delegation"],
  ["hp-mission-week", "hp-mission"], ["hp-mission-activity", "hp-mission"], ["hp-mission-acceptance", "hp-mission"], ["hp-mission-completion-note", "hp-mission"], ["hp-mission-foot", "hp-mission"], ["hp-mission-growth", "hp-mission"], ["hp-mission-goal", "hp-mission"],
  ["hps-trial-end-card-primary", "hps-trial-end-card"], ["hps-trial-end-card-escape", "hps-trial-end-card"],
  ["hps-carryover-who", "hps-carryover"], ["hps-preview-recovery-action", "hps-preview-recovery"], ["hps-preview-recovery-detail", "hps-preview-recovery"],
  ["tw-rail-heading", "tw-rail"], ["tw-sources-toggle", "tw-sources"],
];
/** Surfaces an ancestor paints under a text rule: a rule whose selector is a leading descendant part of
 *  the text rule's selector (`.a` for `.a .b`), or the ANCESTORS entry for the rule's last class. */
function parentSurfaces(selector, bgBySelector) {
  const out = new Set();
  const parts = selector.split(/\s*>\s*|\s+/);
  for (let k = 1; k < parts.length; k++) { const bg = bgBySelector.get(parts.slice(0, k).join(" ")); if (bg) out.add(bg); }
  const last = /\.([a-z][\w-]*)$/.exec(parts.at(-1) ?? "")?.[1];
  for (const [child, parent] of ANCESTORS) if (child === last && bgBySelector.get(`.${parent}`)) out.add(bgBySelector.get(`.${parent}`));
  return [...out];
}
/** Every text rule: { file, selector, scope, color, bg, parents, alpha }. A pointer or press state that
 *  only paints a background is measured as the base rule's colour on that background. */
function textRules(files) {
  const rules = allRules(files), out = [];
  const bgBySelector = new Map();
  for (const { r, selectors } of rules) { const bg = decl(r, /^background(-color)?$/); if (bg && !/^(none|transparent|inherit)$/.test(bg) && !/gradient|url\(/.test(bg)) for (const sel of selectors) if (!STATE.test(sel) && !DISABLED.test(sel)) bgBySelector.set(sel, bg); }
  const colorBySelector = new Map();
  const push = (f, selectors, color, bg, alpha) => {
    const selector = selectors.join(", ");
    const parents = [...new Set(selectors.flatMap((x) => parentSurfaces(x.replace(STATE, ""), bgBySelector)))];
    // A rule whose selectors span scopes is measured in each of them. A background that reads --tw-*
    // paints only inside the task workspace; outside it the declaration is invalid and the text sits
    // on the chat surfaces, so such a rule is measured both ways.
    for (const scope of new Set(selectors.map((x) => scopeOf(f, x, color)))) {
      out.push({ file: f, selector, scope, color, bg, parents, alpha });
      if (scope === "chat" && bg && /var\(--tw-/.test(bg)) { out.at(-1).scope = "personal"; out.push({ file: f, selector, scope, color, bg: null, parents, alpha }); }
      // `var(--tw-x, fallback)` outside the workspace paints its fallback: measure that on the chat surfaces.
      if (scope === "personal" && f !== "taskWorkspace.css" && f !== "citationPreview.css" && !/data-chat-detail="personal"|\.tw-/.test(selector) && /^var\(--tw-[\w-]+,/.test(color)) out.push({ file: f, selector, scope: "chat", color, bg, parents, alpha });
    }
  };
  for (const { f, r, selectors: all } of rules) {
    const color = decl(r, /^color$/);
    if (!color || SYSTEM.test(color)) continue;
    const selectors = all.filter((x) => !DISABLED.test(x));
    if (!selectors.length) continue;
    const opacity = Number(decl(r, /^opacity$/) ?? 1);
    push(f, selectors, color, decl(r, /^background(-color)?$/), opacity > 0 && opacity < 1 ? opacity : 1);
    for (const x of selectors) colorBySelector.set(x, { f, color });
  }
  for (const { f, r, selectors } of rules) {
    if (decl(r, /^color$/)) continue;
    const bg = decl(r, /^background(-color)?$/);
    if (!bg) continue;
    for (const x of selectors) {
      if (!STATE.test(x) || DISABLED.test(x)) continue;
      const base = colorBySelector.get(x.replace(STATE, ""));
      if (base) push(f, [x], base.color, bg, 1);
    }
  }
  return out;
}
/** Measure `rules` in one theme. Returns { bad, rows }; a row is [theme, scope, file, selector, ink, surface name, surface, ratio].
 *  `absent`: what a colour that does not resolve means. With a theme it is a gap in this model (a
 *  --vscode-* key neither the theme nor DARK_REGISTRY supplies) and fails. With no theme at all,
 *  `var(--vscode-x)` without a fallback, or with `inherit`, paints nothing of its own: the element
 *  inherits its parent's colour, which is measured on the parent's rule. */
function measure(label, files, colors, kind, rules, { absent = "fail" } = {}) {
  const envs = environments(files, colors, kind);
  const bad = [], rows = [];
  for (const r of rules) {
    const { env, surfaces } = envs[r.scope];
    const ownValue = r.bg == null ? null : resolve(r.bg, env);
    if (r.bg != null && ownValue == null && absent === "fail") { bad.push(`${label}: ${r.file} "${r.selector.slice(0, 80)}": background ${r.bg} reads a --vscode-* key this theme table lacks`); continue; }
    // A background image or `none` paints no flat colour: the text sits on the scope surfaces.
    const ownFlat = ownValue && !/^(none|transparent)$|gradient|url\(/.test(ownValue) ? ownValue : null;
    // Each scope surface, and each ancestor surface painted over it; the rule's own background on top.
    const unders = [];
    for (const [name, base] of surfaces) {
      unders.push([name, base]);
      for (const p of r.parents ?? []) { const v = resolve(p, env); const painted = v && base && paint(v, base); if (painted) unders.push([`${name} under an ancestor's ${p.slice(0, 40)}`, painted]); }
    }
    for (const [name, base] of unders) {
      if (!base) { bad.push(`${label}: ${r.scope} surface ${name} is not a colour`); continue; }
      const surface = ownFlat ? paint(ownFlat, base) : base;
      // currentColor inside a mix is the inherited text colour: the scope's primary text.
      const value = resolve(r.color.replace(/\bcurrentColor\b/gi, "var(--hp-text-primary-default)"), env);
      if ((value == null || value === "inherit") && absent === "skip") break;
      // The rule's own opacity fades its text toward what lies under it.
      const solid = value && paint(value, surface);
      const ink = solid && (r.alpha < 1 ? hexOf(rgb(solid).map((x, i) => x * r.alpha + rgb(surface)[i] * (1 - r.alpha))) : solid);
      if (!surface || !ink) { bad.push(`${label}: ${r.file} "${r.selector.slice(0, 80)}": ${!surface ? `background ${r.bg} -> ${ownValue}` : `color ${r.color} -> ${value}`} is not a colour`); break; }
      const ratio = contrast(ink, surface);
      rows.push([label, r.scope, r.file, r.selector, ink, ownFlat ? "own" : name, surface, ratio]);
      const min = r.selector.split(", ").every((x) => ICON.test(x)) ? NON_TEXT : TEXT;
      if (ratio < min) bad.push(`${label}: ${r.file} "${r.selector.slice(0, 80)}" ${ink} on ${ownFlat ? "its own background" : name} ${surface} is ${ratio.toFixed(2)}:1 < ${min}:1`);
    }
  }
  return { bad, rows };
}
const hpTheme = (files) => ({ ...DARK_REGISTRY, ...JSON.parse(files["hypeproof-theme.json"]).colors });

// ─── checks ──────────────────────────────────────────────────────────────────────────────────────
const NAMED = [
  // [label, scope, text token, surface token, stated value of the text, stated value of the surface, stated ratio]
  ["forest muted on the app", "chat", "--hp-text-muted-default", "--hp-bg-app-default", "#ACB9A5", "#151D19", 8.4],
  ["forest muted on the panel", "chat", "--hp-text-muted-default", "--hp-bg-panel-default", "#ACB9A5", "#202C24", 7.1],
  ["CP-R1 muted on the canvas", "personal", "--tw-muted", "--tw-canvas", "#A4AAB3", "#202226", 6.8],
];
const CHECKS = {
  "1 the muted tokens hold their stated values and ratios (never a 3.2:1 tertiary)": (files) => {
    const bad = [], rows = [];
    // The stated values are the fallbacks (no theme) and, for forest, the HP theme too.
    for (const [mode, colors] of [["fallback", {}], ["HP theme", hpTheme(files)]]) {
      const envs = environments(files, colors, "dark");
      for (const [label, scope, fg, bg, wantFg, wantBg, wantRatio] of NAMED) {
        if (mode === "HP theme" && scope === "personal") continue; // under a theme --tw-* is the host's colour (check 4)
        const env = envs[scope].env;
        const ink = paint(env.get(fg), "#000000"), surface = paint(env.get(bg), "#000000");
        if (ink !== wantFg || surface !== wantBg) { bad.push(`${mode}: ${label}: ${fg} ${ink} on ${bg} ${surface}, stated ${wantFg} on ${wantBg}`); continue; }
        const ratio = contrast(ink, surface);
        rows.push([mode, scope, "tokens", label, ink, bg, surface, ratio]);
        if (Math.abs(ratio - wantRatio) >= 0.05) bad.push(`${mode}: ${label}: ${ratio.toFixed(2)}:1, stated ${wantRatio}:1`);
      }
    }
    return { bad, rows };
  },
  "2 under the HypeProof Studio theme every text colour is >=4.5:1 on every surface it can sit on": (files) => measure("HP theme", files, hpTheme(files), "dark", textRules(files)),
  "3 with no theme variables every CSS fallback is >=4.5:1 too": (files) => measure("fallback", files, {}, "dark", textRules(files), { absent: "skip" }),
  "4 every muted text keeps >=4.5:1 under each VS Code default theme": (files) => {
    const muted = textRules(files).filter((r) => MUTED.test(r.color) && r.scope !== "branded" && r.scope !== "paper");
    if (muted.length < 40) return [`only ${muted.length} muted rules found: the selector model lost them`];
    const out = Object.entries(THEMES).map(([name, t]) => measure(name, files, t, t.kind, muted));
    return { bad: out.flatMap((o) => o.bad), rows: out.flatMap((o) => o.rows) };
  },
  "5 quiet text is a colour, never an opacity": (files) => {
    // Opacity fades text toward whatever lies under it, so its contrast depends on the surface and
    // escapes the table above; quiet text takes the muted role instead (CGP-DS-R-019 says the same
    // of placeholders). Disabled controls (WCAG-exempt), animation frames and forced colours aside,
    // only icons may fade.
    const bad = [];
    for (const { f, r, selectors } of allRules(files)) {
      const o = Number(decl(r, /^opacity$/) ?? 1);
      if (!(o > 0 && o < 1)) continue;
      const live = selectors.filter((x) => !DISABLED.test(x) && !ICON.test(x));
      if (live.length) bad.push(`${f} "${live.join(", ").slice(0, 80)}" fades to opacity ${o}`);
    }
    return bad;
  },
};

let passed = 0;
const failures = [], table = [];
const run = (fn, files) => { const r = fn(files); return Array.isArray(r) ? { bad: r, rows: [] } : r; };
for (const [label, fn] of Object.entries(CHECKS)) {
  const { bad, rows } = run(fn, real);
  table.push(...rows);
  if (bad.length) { failures.push(label); console.error(`  FAIL ${label}:\n    - ${bad.join("\n    - ")}`); }
  else { passed++; console.log(`  ok   ${label} (${rows.length} pairs)`); }
}
// The table: the lowest ratio of each text colour per theme, then the named muted pairs.
const lowest = new Map();
for (const row of table) { const key = `${row[0]}|${row[3]}`; if (!lowest.has(key) || row[7] < lowest.get(key)[7]) lowest.set(key, row); }
const byTheme = new Map();
for (const row of lowest.values()) byTheme.set(row[0], [...(byTheme.get(row[0]) ?? []), row]);
for (const [theme, list] of byTheme) {
  const min = list.reduce((a, b) => (b[7] < a[7] ? b : a));
  console.log(`    ${theme.padEnd(12)} ${String(list.length).padStart(4)} text colours, lowest ${min[7].toFixed(2)}:1 (${min[2]} "${min[3].slice(0, 60)}" ${min[4]} on ${min[6]})`);
}
for (const row of table.filter((r) => r[2] === "tokens")) console.log(`    ${row[0].padEnd(12)} ${row[7].toFixed(2)}:1  ${row[3]}: ${row[4]} on ${row[6]}`);
if (process.env.HPS_CONTRAST_TABLE) {
  const md = ["| Theme | Scope | File | Rule | Text | Surface | Ratio |", "|---|---|---|---|---|---|---|",
    ...table.map(([t, s, f, sel, ink, name, surface, ratio]) => `| ${t} | ${s} | ${f} | \`${sel.replace(/\|/g, "\\|")}\` | ${ink} | ${name} ${surface} | ${ratio.toFixed(2)}:1 |`)];
  writeFileSync(process.env.HPS_CONTRAST_TABLE, md.join("\n") + "\n");
  console.log(`    table: ${table.length} rows -> ${process.env.HPS_CONTRAST_TABLE}`);
}

// ─── negative controls: each mutation must apply and must fail its check ─────────────────────────
const mutate = (file, from, to) => {
  const text = real[file];
  const next = text.replace(from, to);
  return next === text ? null : { ...real, [file]: next };
};
const theme = (edit) => { const t = JSON.parse(real["hypeproof-theme.json"]); edit(t.colors); return { ...real, "hypeproof-theme.json": JSON.stringify(t) }; };
const TERTIARY = "#616E65"; // a ChatGPT-style tertiary: 3.2:1 on #151D19
assert.ok(Math.abs(contrast(TERTIARY, "#151D19") - 3.2) < 0.1, `control colour ${TERTIARY} is ${contrast(TERTIARY, "#151D19").toFixed(2)}:1, not 3.2:1`);
const NEGATIVE = [
  ["1", "the forest muted fallback at a 3.2:1 tertiary", mutate("tokens.css", "--hp-text-muted-default: var(--vscode-descriptionForeground, #ACB9A5);", `--hp-text-muted-default: var(--vscode-descriptionForeground, ${TERTIARY});`)],
  ["1", "the CP-R1 muted fallback at a 3.2:1 tertiary", mutate("taskWorkspace.css", "--tw-muted: var(--vscode-descriptionForeground, #a4aab3);", `--tw-muted: var(--vscode-descriptionForeground, ${TERTIARY});`)],
  ["2", "the HP theme's description colour at a 3.2:1 tertiary", theme((c) => { c.descriptionForeground = TERTIARY; })],
  ["2", "the publish 'verified' state back on its 3.4:1 green", mutate("styles.css", /(\.hps-publish \[data-state="verified"\] \{ color: )[^;]+;/, "$1#2e7d32;")],
  ["2", "a muted caption on a surface of its own that it does not clear", mutate("chatDetails.css", /(\.hps-response-pending \{)/, "$1 background: #6E7A70;")],
  ["2", "the classroom Stop label back to white on the error fill (2.5:1 on #F48771)", mutate("styles.css", /(\.hps-btn-stop \{[^}]*?color: )var\(--hp-bg-app-default\)/, "$1#fff")],
  ["3", "an error message back on its #c62828 fallback", mutate("styles.css", /(\.hps-verify-error \{ color: var\(--vscode-errorForeground, )#f48771\)/, "$1#c62828)")],
  ["3", "the tool error back on its #e55 fallback", mutate("styles.css", /(\.hps-tool-error \{\s*color: var\(--vscode-errorForeground, )#f48771/, "$1#e55")],
  ["3", "the update toggle back on its #5b8def fallback", mutate("styles.css", /(\.hps-update-banner-toggle \{[^}]*?color: )var\(--hp-text-accent-default\)/, "$1var(--vscode-textLink-foreground, #5b8def)")],
  ["3", "a quiet note back on its #888 fallback", mutate("styles.css", /(\.hps-fatal-sub \{[^}]*?color: )var\(--hp-text-muted-default\)/, "$1var(--vscode-descriptionForeground, #888)")],
  ["3", "the recovery notice back on its #647078 fallback", mutate("styles.css", /(\.hps-recovery-notice \{[^}]*?color: )var\(--hp-text-muted-default\)/, "$1var(--vscode-descriptionForeground, #647078)")],
  ["4", "no light-theme rebinding of the personal muted colour (Light+ #717171 on #F3F3F3 is 4.4:1)", mutate("taskWorkspace.css", /body\.vscode-light \.tw-workspace, body\.vscode-high-contrast-light \.tw-workspace \{[^}]*\}/, "")],
  ["4", "the quiet card's alias back on the raw host colour", mutate("styles.css", ".hp-ai-can-do { --hp-ai-can-do-muted: var(--hp-text-muted-default); }", ".hp-ai-can-do { --hp-ai-can-do-muted: var(--vscode-descriptionForeground, var(--hp-text-muted-default)); }")],
  ["4", "the hint dimmed by opacity again (muted at .7 is 2.7:1 on the Light+ panel)", mutate("styles.css", /(\.hps-hint \{\n  font-size: [^;]+;\n)/, "$1  opacity: 0.7;\n")],
  ["4", "the request id back on the muted role over the error banner's tint (4.0:1 under Light+)", mutate("styles.css", /(\.hps-error-banner-rid \{[^}]*?color: )var\(--hp-text-primary-default\)/, "$1var(--hp-text-muted-default)")],
  ["4", "a pressed code tool keeping its muted text (3.6:1 on the 2026 Dark pressed layer)", mutate("codeBlock.css", /(\.hps-codeblock-tool:active \{ background-color: var\(--hp-bg-control-pressed\);) color: [^;]+;/, "$1")],
  ["5", "a quiet line faded with opacity instead of the muted colour", mutate("styles.css", ".hps-evidence-meta { color: var(--hp-text-muted-default);", ".hps-evidence-meta { opacity: 0.8;")],
  ["3", "a ghost button back on its #aaa fallback (4.1:1 pressed)", mutate("styles.css", /(\.hps-naming-btn-ghost \{[^}]*?)color: var\(--hp-text-primary-default\)/, "$1color: var(--vscode-foreground, #aaa)")],
  ["4", "a quiet note reading the host description colour directly (4.4:1 on the Light+ panel)", mutate("styles.css", /(\.hps-turn-review-note \{[^}]*?color: )var\(--hp-text-muted-default\)/, "$1var(--vscode-descriptionForeground)")],
];
for (const [id, label, files] of NEGATIVE) {
  const check = Object.entries(CHECKS).find(([k]) => k.startsWith(`${id} `));
  if (!files) { failures.push(label); console.error(`  FAIL negative control: ${label}: the mutation did not apply (a stale search string proves nothing)`); continue; }
  const { bad } = run(check[1], files);
  if (bad.length) { passed++; console.log(`  ok   negative control: ${label} -> ${id} fails (${bad[0].slice(0, 110)})`); }
  else { failures.push(label); console.error(`  FAIL negative control: ${label} -> check ${id} still passes`); }
}

console.log(`text-contrast-table: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
