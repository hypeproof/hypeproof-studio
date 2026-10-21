// CGP-DS-D-002 / DES-CGP-DS-02 (REQ-STUDIO-HOST-THEME-MAPPING) — the colour roles in tokens.css read
// the VS Code theme, with the forest value as the fallback.
//   node --experimental-strip-types test/host-theme-mapping.smoke.mjs
//
// 1. Sources: every :root colour role reads a --vscode-* variable first and falls back to the forest
//    value. Only the fixed roles listed below have no host source.
// 2. HP theme: with every fallback removed, the HypeProof Studio theme (media/hypeproof-theme.json)
//    alone resolves every role to the HP palette.
// 3. Light+: every text pair is >=4.5:1. The pairs are each text role on each surface it can sit on
//    (app, panel, and the webview body, which VS Code paints with sideBar.background), the CTA ink on
//    the CTA, the Paper chip pair, and every colour/background pair a component rule declares
//    together. The light override on <body> and the branded and Paper scopes are applied as the
//    browser applies them.
// 4. The same pairs hold in VS Code's other default themes. The control boundary and the focus ring
//    are >=3:1 on the app and panel surfaces.
// 5. Branded screens (start, disconnected) bind every role back to the forest value, and no colour
//    on them reads the host theme directly.
//
// Each check is a function over the file texts, so it also runs against mutated copies that must
// fail (negative controls), in the stylesheet-rule pattern of test/ui-polish-1.smoke.mjs.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { readDesignFile } from "./lib/design-token-values.mjs";

const require = createRequire(new URL("../webview-ui/package.json", import.meta.url));
const postcss = require("postcss");
const SRC = new URL("../webview-ui/src/", import.meta.url);
const COMPONENT_CSS = readdirSync(SRC).filter((f) => f.endsWith(".css") && f !== "tokens.css" && f !== "designTokens.css").sort();
const real = {
  "tokens.css": readDesignFile(new URL("tokens.css", SRC)),
  "hypeproof-theme.json": readFileSync(new URL("../media/hypeproof-theme.json", import.meta.url), "utf8"),
  ...Object.fromEntries(COMPONENT_CSS.map((f) => [f, readDesignFile(new URL(f, SRC))])),
};

const ROLE = /^--hp-(text|bg|border|ring)-[a-z]+-(default|hover|pressed|selected)$/;
// Roles with no host key that keeps their contract: no VS Code default theme draws a control boundary
// at 3:1 (DES-11), and the Paper chip is one fixed ink-on-paper pair.
const FIXED = ["--hp-text-paper-default", "--hp-bg-paper-default", "--hp-border-control-default"];
// CGP-DS-D-003 — state layers: the text role mixed over the surface. They follow the host through the
// text role, so they carry no --vscode-* key of their own, and every scope binds the same expression
// (test/control-state-layers.smoke.mjs owns the shares).
const DERIVED = new Map([["--hp-bg-control-hover", /^color-mix\(in srgb, var\(--hp-text-primary-default\) \d+%, transparent\)$/], ["--hp-bg-control-pressed", /^color-mix\(in srgb, var\(--hp-text-primary-default\) \d+%, transparent\)$/]]);
const BRANDED = ".studio-start, .studio-disconnected";
const PAPER = '[data-surface="growth"], .hp-reflection';
const LIGHT_BODY = "body.vscode-light, body.vscode-high-contrast-light";

// ─── VS Code default themes, as a webview receives them ─────────────────────────────────────────
// Values are what VS Code writes on the webview's <html> as --vscode-* (theme-defaults/themes/*.json
// with include chains resolved; where a theme leaves a key out, the colour registry default for its
// kind from src/vs/platform/theme/common/colors/{baseColors,inputColors,editorColors,listColors,
// quickpickColors}.ts and src/vs/workbench/common/theme.ts). null = the registry has no value for
// that kind, so the variable is absent and the CSS fallback applies.
const KIND_CLASS = { dark: "vscode-dark", light: "vscode-light", hcDark: "vscode-high-contrast", hcLight: "vscode-high-contrast-light" };
const THEMES = {
  "Light+": { kind: "light", file: "light_plus.json", foreground: "#616161", descriptionForeground: "#717171", "textLink.foreground": "#006AB1", "list.warningForeground": "#855F00", "editorWarning.foreground": "#BF8803", "button.foreground": "#FFFFFF", "button.background": "#007ACC", "editor.background": "#FFFFFF", "quickInput.background": "#F3F3F3", "panel.border": "#80808059", focusBorder: "#0090F1", "sideBar.background": "#F3F3F3", "input.background": "#FFFFFF", "input.placeholderForeground": "#767676" },
  "Light Modern": { kind: "light", file: "light_modern.json", foreground: "#3B3B3B", descriptionForeground: "#3B3B3B", "textLink.foreground": "#005FB8", "list.warningForeground": "#855F00", "editorWarning.foreground": "#BF8803", "button.foreground": "#FFFFFF", "button.background": "#005FB8", "editor.background": "#FFFFFF", "quickInput.background": "#F8F8F8", "panel.border": "#E5E5E5", focusBorder: "#005FB8", "sideBar.background": "#F8F8F8", "input.background": "#FFFFFF", "input.placeholderForeground": "#767676" },
  "Dark+": { kind: "dark", file: "dark_plus.json", foreground: "#CCCCCC", descriptionForeground: "#CCCCCCB3", "textLink.foreground": "#3794FF", "list.warningForeground": "#CCA700", "editorWarning.foreground": "#CCA700", "button.foreground": "#FFFFFF", "button.background": "#0E639C", "editor.background": "#1E1E1E", "quickInput.background": "#252526", "panel.border": "#80808059", focusBorder: "#007FD4", "sideBar.background": "#252526", "input.background": "#3C3C3C", "input.placeholderForeground": "#A6A6A6" },
  "Dark Modern": { kind: "dark", file: "dark_modern.json", foreground: "#CCCCCC", descriptionForeground: "#9D9D9D", "textLink.foreground": "#4DAAFC", "list.warningForeground": "#CCA700", "editorWarning.foreground": "#CCA700", "button.foreground": "#FFFFFF", "button.background": "#0078D4", "editor.background": "#1F1F1F", "quickInput.background": "#222222", "panel.border": "#2B2B2B", focusBorder: "#0078D4", "sideBar.background": "#181818", "input.background": "#313131", "input.placeholderForeground": "#989898" },
  "HC Dark": { kind: "hcDark", file: "hc_black.json", foreground: "#FFFFFF", descriptionForeground: "#FFFFFFB3", "textLink.foreground": "#21A6FF", "list.warningForeground": null, "editorWarning.foreground": "#FFD370", "button.foreground": "#FFFFFF", "button.background": "#000000", "editor.background": "#000000", "quickInput.background": "#0C141F", "panel.border": "#6FC3DF", focusBorder: "#F38518", "sideBar.background": "#000000", "input.background": "#000000", "input.placeholderForeground": "#FFFFFFB3" },
  "HC Light": { kind: "hcLight", file: "hc_light.json", foreground: "#292929", descriptionForeground: "#292929B3", "textLink.foreground": "#0F4A85", "list.warningForeground": null, "editorWarning.foreground": "#895503", "button.foreground": "#FFFFFF", "button.background": "#0F4A85", "editor.background": "#FFFFFF", "quickInput.background": "#FFFFFF", "panel.border": "#0F4A85", focusBorder: "#006BBD", "sideBar.background": "#FFFFFF", "input.background": "#FFFFFF", "input.placeholderForeground": "#292929B3" },
  "2026 Dark": { kind: "dark", file: "2026-dark.json", foreground: "#BFBFBF", descriptionForeground: "#8C8C8C", "textLink.foreground": "#48A0C7", "list.warningForeground": "#E5BA7D", "editorWarning.foreground": "#CCA700", "button.foreground": "#FFFFFF", "button.background": "#297AA0", "editor.background": "#121314", "quickInput.background": "#202122", "panel.border": "#2A2B2CFF", focusBorder: "#3994BCB3", "sideBar.background": "#191A1B", "input.background": "#191A1B", "input.placeholderForeground": "#555555" },
  "2026 Light": { kind: "light", file: "2026-light.json", foreground: "#202020", descriptionForeground: "#606060", "textLink.foreground": "#0069CC", "list.warningForeground": "#667309", "editorWarning.foreground": "#BF8803", "button.foreground": "#FFFFFF", "button.background": "#0069CC", "editor.background": "#FFFFFF", "quickInput.background": "#FAFAFD", "panel.border": "#F0F1F2FF", focusBorder: "#0069CCFF", "sideBar.background": "#FAFAFD", "input.background": "#FFFFFF", "input.placeholderForeground": "#999999" },
};
// When the vscodium-base submodule is checked out (or VSCODE_THEME_DEFAULTS_DIR points at a copy of
// theme-defaults/themes), every key a theme file sets explicitly is re-derived, so the table cannot drift.
const THEME_DIR = process.env.VSCODE_THEME_DEFAULTS_DIR
  ? new URL(`file://${process.env.VSCODE_THEME_DEFAULTS_DIR.replace(/\/?$/, "/")}`)
  : new URL("../../../vscodium-base/vscode/extensions/theme-defaults/themes/", import.meta.url);
if (existsSync(new URL("light_plus.json", THEME_DIR))) {
  const jsonc = (text) => {
    let out = "", str = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (str) { out += c; if (c === "\\") out += text[++i]; else if (c === '"') str = false; continue; }
      if (c === '"') { str = true; out += c; }
      else if (c === "/" && text[i + 1] === "/") { while (i < text.length && text[i] !== "\n") i++; out += "\n"; }
      else if (c === "/" && text[i + 1] === "*") { i = text.indexOf("*/", i + 2) + 1; }
      else out += c;
    }
    return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
  };
  const load = (url) => { const j = jsonc(readFileSync(url, "utf8")); return { ...(j.include ? load(new URL(j.include, url)) : {}), ...(j.colors ?? {}) }; };
  for (const [name, t] of Object.entries(THEMES)) {
    const c = load(new URL(t.file, THEME_DIR));
    for (const [key, value] of Object.entries(t)) if (!["kind", "file"].includes(key) && c[key]) assert.equal(value.toUpperCase(), c[key].toUpperCase(), `${name} ${key} matches theme-defaults`);
  }
  console.log("  theme table re-derived from theme-defaults");
} else console.log("  vscodium-base not checked out: theme table taken as recorded (sources in the comment above)");

// ─── CSS model ───────────────────────────────────────────────────────────────────────────────────
/** Top-level rules (outside @media), keyed by their normalised selector list. */
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
/** The custom properties a :root rule declares (`:root` and `:root, .hps-shell`). */
function rootDecls(css) {
  const out = new Map();
  for (const [sel, decls] of blocks(css)) if (sel.split(", ").includes(":root")) for (const [k, v] of decls) out.set(k, v);
  return out;
}
/** Split a var() body at its top-level comma. */
function splitVar(inner) {
  let d = 0;
  for (let k = 0; k < inner.length; k++) { if (inner[k] === "(") d++; if (inner[k] === ")") d--; if (inner[k] === "," && d === 0) return [inner.slice(0, k).trim(), inner.slice(k + 1).trim()]; }
  return [inner.trim(), null];
}
/** Substitute var() the way the browser computes a custom property on one element. */
function resolve(text, env, { fallbacks = true } = {}, seen = new Set()) {
  let out = "", i = 0;
  while (i < text.length) {
    const at = text.indexOf("var(", i);
    if (at < 0) { out += text.slice(i); break; }
    out += text.slice(i, at);
    let depth = 1, j = at + 4;
    for (; j < text.length && depth; j++) depth += text[j] === "(" ? 1 : text[j] === ")" ? -1 : 0;
    const [name, fb] = splitVar(text.slice(at + 4, j - 1));
    const raw = seen.has(name) ? null : env.get(name);
    const got = raw == null ? null : resolve(raw, env, { fallbacks }, new Set([...seen, name]));
    if (got != null) out += got;
    else if (fallbacks && fb != null) { const v = resolve(fb, env, { fallbacks }, seen); if (v == null) return null; out += v; }
    else return null;
    i = j;
  }
  return out;
}
/** Computed values on :root, then on an element that redeclares `scoped` (it inherits the rest). */
function computed(rootEnv, scoped = new Map(), opts) {
  const root = new Map([...rootEnv].map(([k, v]) => [k, k.startsWith("--vscode-") ? v : resolve(v, rootEnv, opts)]));
  if (!scoped.size) return root;
  const env = new Map(root);
  for (const [k, v] of scoped) env.set(k, v);
  return new Map([...env].map(([k, v]) => [k, scoped.has(k) ? resolve(v, env, opts) : v]));
}
const vscodeVars = (colors) => new Map(Object.entries(colors).filter(([k, v]) => !["kind", "file"].includes(k) && v).map(([k, v]) => [`--vscode-${k.replace(".", "-")}`, v]));

// ─── colour maths ────────────────────────────────────────────────────────────────────────────────
const isHex = (v) => /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v ?? "");
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hexOf = (c) => "#" + c.map((n) => Math.round(n).toString(16).padStart(2, "0")).join("").toUpperCase();
/** A colour as painted over `under`: translucent theme colours and `color-mix(in srgb, A p%, B)`. */
function paint(v, under) {
  const m = /^color-mix\(in srgb,\s*(#[0-9a-f]{6,8})\s+(\d+)%,\s*(#[0-9a-f]{6,8})\)$/i.exec(v ?? "");
  if (m) { const [a, b, p] = [paint(m[1], under), paint(m[3], under), Number(m[2]) / 100]; return hexOf(rgb(a).map((x, i) => x * p + rgb(b)[i] * (1 - p))); }
  const f = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v ?? "");
  if (f) { const a = f[4] == null ? 1 : Number(f[4]); return hexOf([1, 2, 3].map((i) => Number(f[i]) * a + rgb(under)[i - 1] * (1 - a))); }
  if (!isHex(v)) return null;
  if (v.length === 7) return v.toUpperCase();
  const a = parseInt(v.slice(7), 16) / 255;
  return hexOf(rgb(v).map((x, i) => x * a + rgb(under)[i] * (1 - a)));
}
const lum = (h) => { const c = rgb(h).map((n) => n / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// ─── the theme a webview sees ────────────────────────────────────────────────────────────────────
/** Computed roles in the chat body and in the branded and Paper scopes for one theme. */
function scopes(files, colors, kind) {
  const css = files["tokens.css"];
  const all = blocks(css);
  const rootEnv = new Map([...vscodeVars(colors), ...rootDecls(css)]);
  // <body> carries the theme-kind class; a rule naming body.<class> applies to it.
  const bodyDecls = new Map();
  for (const [sel, decls] of all) if (sel.split(", ").some((s) => s === `body.${KIND_CLASS[kind]}` || (kind === "hcLight" && s === "body.vscode-high-contrast"))) for (const [k, v] of decls) bodyDecls.set(k, v);
  const body = computed(rootEnv, bodyDecls);
  const inScope = (sel) => { const env = new Map(body); const d = all.get(sel) ?? new Map(); for (const [k, v] of d) env.set(k, v); return new Map([...env].map(([k, v]) => [k, d.has(k) ? resolve(v, env) : v])); };
  const branded = inScope(BRANDED), paper = inScope(PAPER), sideBar = paint(colors["sideBar.background"], "#000000");
  return { body, branded, paper, sideBar, brandedBase: paint(branded.get("--hp-bg-app-default"), sideBar), paperBase: paint(paper.get("--hp-bg-app-default"), sideBar), input: colors["input.background"] };
}
const TEXT_ON_SURFACES = ["--hp-text-primary-default", "--hp-text-muted-default", "--hp-text-accent-default", "--hp-text-warn-default"];
const SURFACES = ["--hp-bg-app-default", "--hp-bg-panel-default", "body"];
// A placeholder sits in a field: the theme input, or a field that paints the app surface. Per-theme
// placeholder overrides (the 2026 themes, by id) are measured in test/focus-placeholder.smoke.mjs,
// so placeholder pairs are measured here for Light+ only.
const PLACEHOLDER = [["--hp-text-placeholder-default", "input", 4.5], ["--hp-text-placeholder-default", "--hp-bg-app-default", 4.5]];
// Paper keeps the lime and amber roles for icons and edges only (1.2:1 and 2.0:1 on Paper, CGP-DS-D-001);
// no component draws accent or warning text on a Paper surface.
const PAPER_ICON_ONLY = ["--hp-text-accent-default", "--hp-text-warn-default"];
/** Every colour/background role pair one component rule declares together. */
function componentPairs(files) {
  const out = new Set();
  for (const f of COMPONENT_CSS) postcss.parse(files[f]).walkRules((r) => {
    const color = r.nodes.find((d) => d.type === "decl" && d.prop === "color")?.value.match(/^var\((--hp-text-[\w-]+)\)$/)?.[1];
    const bg = r.nodes.find((d) => d.type === "decl" && /^background(-color)?$/.test(d.prop))?.value.match(/^var\((--hp-bg-[\w-]+)\)/)?.[1];
    if (color && bg) out.add(`${color}|${bg}`);
  });
  return [...out].map((p) => p.split("|"));
}
function pairs(files) {
  const list = [];
  for (const fg of TEXT_ON_SURFACES) for (const bg of SURFACES) list.push([fg, bg, 4.5]);
  list.push(["--hp-text-inverse-default", "--hp-bg-accent-default", 4.5], ["--hp-text-paper-default", "--hp-bg-paper-default", 4.5]);
  for (const [fg, bg] of componentPairs(files)) if (!list.some(([a, b]) => a === fg && b === bg)) list.push([fg, bg, 4.5]);
  return list;
}
// Text whose surface is painted by an ancestor rule, not by its own rule: [text rule, file, ancestor rule].
const ANCESTOR_SURFACES = [[".hps-instructor-connection", "styles.css", ".hps-instructor-band"], [".hps-instructor-model-label", "styles.css", ".hps-instructor-band"]];
function ancestorPairs(files) {
  const rule = (f, sel) => { let found = null; postcss.parse(files[f]).walkRules((r) => { if (r.selectors.map((x) => x.trim()).includes(sel)) found = r; }); return found; };
  const decl = (r, re) => r?.nodes.find((d) => d.type === "decl" && re.test(d.prop))?.value;
  return ANCESTOR_SURFACES.map(([text, f, anc]) => ({ label: `${text} on ${anc}`, color: decl(rule(f, text), /^color$/), bg: decl(rule(f, anc), /^background(-color)?$/) }));
}
const NON_TEXT = [["--hp-border-control-default", "--hp-bg-app-default", 3], ["--hp-border-control-default", "--hp-bg-panel-default", 3], ["--hp-ring-focus-default", "--hp-bg-app-default", 3], ["--hp-ring-focus-default", "--hp-bg-panel-default", 3]];
/** Text on an ancestor-painted surface: the surface is resolved against the theme and painted over the body. */
function measureAncestors(label, files, scope, colors, base) {
  const bad = [], rows = [];
  const env = new Map([...scope, ...vscodeVars(colors)]);
  for (const p of ancestorPairs(files)) {
    if (!p.color || !p.bg) { bad.push(`${label}: ${p.label}: rule not found`); continue; }
    const surface = paint(resolve(p.bg, env), base), ink = surface && paint(resolve(p.color, env), surface);
    if (!surface || !ink) { bad.push(`${label}: ${p.label}: ${p.color} on ${p.bg} is not a colour`); continue; }
    const r = contrast(ink, surface);
    rows.push(`${label.padEnd(24)} ${r.toFixed(2).padStart(6)}:1  ${p.label} ${ink} on ${surface}`);
    if (r < 4.5) bad.push(`${label}: ${p.label}: ${ink} on ${surface} is ${r.toFixed(2)}:1 < 4.5:1`);
  }
  return { bad, rows };
}
/** Measure pairs in one computed scope. `base` is what lies under the scope: the webview body
 *  (sideBar.background) for the chat, the scope's own app surface for the branded and Paper screens,
 *  which paint it themselves. */
function measure(label, scope, base, list, input) {
  const bad = [], rows = [];
  for (const [fg, bg, min] of list) {
    const surface = bg === "body" ? base : bg === "input" ? paint(input, base) : paint(scope.get(bg), base);
    const ink = paint(scope.get(fg), surface ?? base);
    if (!surface || !ink) { bad.push(`${label}: ${fg} (${scope.get(fg)}) or ${bg} (${scope.get(bg)}) is not a colour`); continue; }
    const r = contrast(ink, surface);
    rows.push(`${label.padEnd(24)} ${r.toFixed(2).padStart(6)}:1  ${fg} ${ink} on ${bg} ${surface}`);
    if (r < min) bad.push(`${label}: ${fg} ${ink} on ${bg} ${surface} is ${r.toFixed(2)}:1 < ${min}:1`);
  }
  return { bad, rows };
}

// ─── checks ──────────────────────────────────────────────────────────────────────────────────────
const forestOf = (files) => blocks(files["tokens.css"]).get(BRANDED) ?? new Map();
const CHECKS = {
  "1 every :root colour role reads a --vscode-* source first and falls back to the forest value": (files) => {
    const bad = [];
    const root = rootDecls(files["tokens.css"]);
    const roles = [...root.keys()].filter((k) => ROLE.test(k));
    if (roles.length < 20) bad.push(`only ${roles.length} roles on :root`);
    const forest = forestOf(files);
    const bare = computed(root); // no --vscode-* at all: every fallback applies
    for (const k of roles) {
      const v = root.get(k);
      if (FIXED.includes(k)) { if (!isHex(v)) bad.push(`${k} is listed as fixed but is "${v}"`); }
      else if (DERIVED.has(k)) {
        if (!DERIVED.get(k).test(v)) bad.push(`${k} is not derived from the text role: "${v}"`);
        if (forest.get(k) !== v) bad.push(`the branded forest scope binds ${k} to "${forest.get(k)}", not "${v}"`);
        continue;
      }
      else if (!/^var\(--vscode-[\w-]+,/.test(v) && !/^var\(--vscode-input-placeholderForeground, var\(--hp-placeholder-mix\)\)$/.test(v)) bad.push(`${k} has no host source: "${v}"`);
      const want = forest.get(k);
      if (!want) bad.push(`the branded forest scope does not bind ${k}`);
      else if (k !== "--hp-text-placeholder-default" && bare.get(k)?.toUpperCase() !== want.toUpperCase()) bad.push(`${k} falls back to ${bare.get(k)}, not the forest value ${want}`);
    }
    return bad;
  },
  "2 under the HypeProof Studio theme the fallback-free values equal the HP palette": (files) => {
    const bad = [];
    const theme = JSON.parse(files["hypeproof-theme.json"]);
    if (theme.type !== "dark") bad.push(`the HP theme is "${theme.type}", so a light-kind override would apply`);
    const root = rootDecls(files["tokens.css"]);
    const env = new Map([...vscodeVars(theme.colors), ...root]);
    const strict = computed(env, new Map(), { fallbacks: false });
    const forest = forestOf(files);
    for (const k of [...root.keys()].filter((r) => ROLE.test(r) && !DERIVED.has(r))) {
      const got = strict.get(k), want = forest.get(k);
      if (got == null) bad.push(`${k} does not resolve without its fallback: the HP theme lacks ${root.get(k).match(/--vscode-[\w-]+/)?.[0]}`);
      else if (got.toUpperCase() !== want?.toUpperCase()) bad.push(`${k} is ${got} under the HP theme, not the HP palette ${want}`);
    }
    return bad;
  },
  "3 under Light+ every text pair is >=4.5:1": (files) => {
    const s = scopes(files, THEMES["Light+"], "light");
    const list = [...pairs(files), ...PLACEHOLDER];
    const out = [
      measure("Light+ chat", s.body, s.sideBar, list, s.input),
      measureAncestors("Light+ chat", files, s.body, THEMES["Light+"], s.sideBar),
      // Fields on the branded and Paper screens paint their own surface, never the theme input.
      measure("Light+ branded", s.branded, s.brandedBase, list, s.brandedBase),
      measure("Light+ Paper", s.paper, s.paperBase, list.filter(([fg]) => !PAPER_ICON_ONLY.includes(fg)), s.paperBase),
    ];
    return { bad: out.flatMap((o) => o.bad), rows: out.flatMap((o) => o.rows) };
  },
  "4 every other default theme keeps the text pairs (4.5:1) and the boundary and ring (3:1)": (files) => {
    const bad = [];
    for (const [name, t] of Object.entries(THEMES)) {
      const s = scopes(files, t, t.kind);
      bad.push(...measure(`${name} chat`, s.body, s.sideBar, [...pairs(files), ...NON_TEXT], s.input).bad);
      bad.push(...measureAncestors(`${name} chat`, files, s.body, t, s.sideBar).bad);
      bad.push(...measure(`${name} branded`, s.branded, s.brandedBase, [...pairs(files), ...NON_TEXT], s.brandedBase).bad);
    }
    return bad;
  },
  "5 branded screens stay forest: no colour on them reads the host theme": (files) => {
    const bad = [];
    postcss.parse(files["start.css"]).walkDecls((d) => {
      if (/^(color|background(-color)?|fill|caret-color|accent-color)$/.test(d.prop) && /--vscode-/.test(d.value)) bad.push(`start.css ${d.parent.selector}: ${d.prop} reads ${d.value}`);
    });
    const forest = forestOf(files);
    for (const [k, v] of forest) if (ROLE.test(k) && !isHex(v) && !(DERIVED.has(k) && DERIVED.get(k).test(v))) bad.push(`${BRANDED} binds ${k} to "${v}", not a forest literal`);
    const light = blocks(files["tokens.css"]).get(LIGHT_BODY);
    if (!light) bad.push(`no ${LIGHT_BODY} rule`);
    for (const sel of blocks(files["tokens.css"]).keys()) if (/vscode-dark|^body$|vscode-high-contrast(?!-light)/.test(sel) && [...(blocks(files["tokens.css"]).get(sel)?.keys() ?? [])].some((k) => ROLE.test(k))) bad.push(`${sel} re-binds a role on a dark theme kind`);
    return bad;
  },
};

let passed = 0;
const failures = [];
const run = (fn, files) => { const r = fn(files); return Array.isArray(r) ? { bad: r, rows: [] } : r; };
for (const [label, fn] of Object.entries(CHECKS)) {
  const { bad, rows } = run(fn, real);
  for (const r of rows) console.log(`    ${r}`);
  if (bad.length) { failures.push(label); console.error(`  FAIL ${label}:\n    - ${bad.join("\n    - ")}`); }
  else { passed++; console.log(`  ok   ${label}`); }
}

// ─── negative controls: each mutation must apply and must fail its check ─────────────────────────
const mutate = (file, from, to) => {
  const text = real[file];
  const next = text.replace(from, to);
  return next === text ? null : { ...real, [file]: next };
};
const theme = (edit) => { const t = JSON.parse(real["hypeproof-theme.json"]); edit(t.colors); return { ...real, "hypeproof-theme.json": JSON.stringify(t) }; };
const NEGATIVE = [
  ["1", "a role back on its forest literal", mutate("tokens.css", "--hp-text-muted-default: var(--vscode-descriptionForeground, #ACB9A5);", "--hp-text-muted-default: #ACB9A5;")],
  ["1", "a fallback that is not the forest value", mutate("tokens.css", "--hp-bg-panel-default: var(--vscode-quickInput-background, #202C24);", "--hp-bg-panel-default: var(--vscode-quickInput-background, #17191D);")],
  ["2", "the HP theme without descriptionForeground", theme((c) => { delete c.descriptionForeground; })],
  ["2", "the HP theme without list.warningForeground", theme((c) => { delete c["list.warningForeground"]; })],
  ["2", "the panel read from sideBar.background (#18231C in the HP theme)", mutate("tokens.css", "--hp-bg-panel-default: var(--vscode-quickInput-background, #202C24);", "--hp-bg-panel-default: var(--vscode-sideBar-background, #202C24);")],
  ["3", "no light override for the muted text (Light+ #717171 on #F3F3F3 is 4.4:1)", mutate("tokens.css", /body\.vscode-light, body\.vscode-high-contrast-light \{[^}]*\}/, "")],
  ["3", "warning text from editorWarning.foreground (Light+ #BF8803)", mutate("tokens.css", "--hp-text-warn-default: var(--vscode-list-warningForeground, var(--vscode-editorWarning-foreground, #E6A373));", "--hp-text-warn-default: var(--vscode-editorWarning-foreground, #E6A373);")],
  ["3", "the CTA from focusBorder (white on Light+ #0090F1)", mutate("tokens.css", "--hp-bg-accent-default: var(--vscode-button-background, #D5F279);", "--hp-bg-accent-default: var(--vscode-focusBorder, #D5F279);")],
  ["3", "the accent text left lime (1.2:1 on white)", mutate("tokens.css", "--hp-text-accent-default: var(--vscode-textLink-foreground, #D5F279);", "--hp-text-accent-default: #D5F279;")],
  ["3", "instructor band labels back on the muted role (4.0:1 on the Light+ band)", mutate("styles.css", ".hps-instructor-connection { color: var(--hp-text-primary-default); }", ".hps-instructor-connection { color: var(--hp-text-muted-default); }")],
  ["4", "the ring from the panel border", mutate("tokens.css", "--hp-ring-focus-default: var(--vscode-focusBorder, #D5F279);", "--hp-ring-focus-default: var(--vscode-panel-border, #D5F279);")],
  ["5", "a start-screen colour read from the host", mutate("start.css", /(\.studio-account-pass > span \{[^}]*?color: )var\(--hp-text-muted-default\)/, "$1var(--vscode-descriptionForeground, #aaa)")],
  ["1", "the branded screens follow the host", mutate("tokens.css", /\.studio-start, \.studio-disconnected \{[^}]*\}/, "")],
  ["5", "a role re-bound for dark themes", mutate("tokens.css", "body.vscode-light, body.vscode-high-contrast-light {", "body.vscode-light, body.vscode-high-contrast-light, body.vscode-dark {")],
];
for (const [id, label, files] of NEGATIVE) {
  const check = Object.entries(CHECKS).find(([k]) => k.startsWith(`${id} `));
  if (!files) { failures.push(label); console.error(`  FAIL negative control: ${label}: the mutation did not apply (a stale search string proves nothing)`); continue; }
  const { bad } = run(check[1], files);
  if (bad.length) { passed++; console.log(`  ok   negative control: ${label} -> ${id} fails (${bad[0].slice(0, 100)})`); }
  else { failures.push(label); console.error(`  FAIL negative control: ${label} -> check ${id} still passes`); }
}

console.log(`host-theme-mapping: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
