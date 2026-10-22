import { readDesignFile } from "./lib/design-token-values.mjs";
// CGP-DS-R-017 / CGP-DS-R-019 (REQ-STUDIO-FOCUS-AND-PLACEHOLDER) — one focus ring and readable
// placeholders across the chat webview CSS, measured from tokens.css.
//   node --experimental-strip-types test/focus-placeholder.smoke.mjs
//
// 1. Every focus rule in webview-ui/src/*.css draws `2px solid var(--hp-ring-focus-default)` with a 2px offset
//    (-2px only inside the tight scrolling rows listed below), and nothing removes an outline
//    without a ring replacement.
// 2. Every `::placeholder` rule uses `var(--hp-text-placeholder-default)` and never lowers opacity.
// 3. The ring is >=3:1 and the placeholder >=4.5:1 on the surfaces they sit on: HP dark, Paper,
//    the HypeProof Studio theme, VS Code's default themes, and the CSS fallbacks.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const SRC = new URL("../webview-ui/src/", import.meta.url);
const read = (f) => readDesignFile(new URL(f, SRC), "utf8");
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

// ---------- colour maths (WCAG relative luminance; color-mix in srgb) ----------
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const alpha = (hex) => (hex.length === 9 ? parseInt(hex.slice(7), 16) / 255 : 1);
const toHex = (c) => "#" + c.map((n) => Math.round(n).toString(16).padStart(2, "0")).join("").toUpperCase();
const mix = (a, b, p) => { const [x, y] = [rgb(a), rgb(b)]; return toHex(x.map((v, i) => v * p + y[i] * (1 - p))); };
// A translucent theme colour is what it looks like over the surface it is painted on.
const flat = (hex, under) => (alpha(hex) === 1 ? hex.slice(0, 7).toUpperCase() : mix(hex.slice(0, 7), under, alpha(hex)));
const lum = (hex) => {
  const c = rgb(hex).map((n) => n / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const meets = (fg, bg, min) => ratio(fg, bg) >= min;

// ---------- tokens ----------
const tokensRaw = read("tokens.css");
const tokens = strip(tokensRaw);
const [rootBlock, paperBlock] = tokens.split('[data-surface="growth"]');
const decl = (block, name) => new RegExp(`--hp-${name}:\\s*([^;]+);`).exec(block)?.[1].trim();
const hex = (block, name) => /^#[0-9A-Fa-f]{6}$/.exec(decl(block, name) ?? "")?.[0];
// CGP-DS-D-002: the :root roles follow the host theme; the forest values are bound literally on the
// branded screens (start, disconnected), and those are the HP dark surfaces measured here.
const forestBlock = /\.studio-start,\s*\.studio-disconnected\s*\{([^}]*)\}/.exec(tokens)?.[1] ?? "";
const HP = { bg: hex(forestBlock, "bg-app-default"), panel: hex(forestBlock, "bg-panel-default"), accent: hex(forestBlock, "border-accent-default"), muted: hex(forestBlock, "text-muted-default"), line: hex(forestBlock, "border-divider-default"), paper: hex(forestBlock, "bg-paper-default") };
assert.ok(Object.values(HP).every(Boolean), `the branded forest block binds the HP surface roles as literals: ${JSON.stringify(HP)}`);
const PAPER = { bg: HP.paper, panel: hex(paperBlock, "bg-panel-default"), ring: hex(paperBlock, "ring-focus-default"), placeholder: hex(paperBlock, "text-placeholder-default") };

const ringDecl = /^var\(--vscode-focusBorder,\s*(#[0-9A-Fa-f]{6})\)$/.exec(decl(rootBlock, "ring-focus-default") ?? "");
assert.ok(ringDecl, `:root --hp-ring-focus-default is the theme focusBorder with a literal fallback, got "${decl(rootBlock, "ring-focus-default")}"`);
const RING_FALLBACK = ringDecl[1];
const phDecl = /^color-mix\(in srgb,\s*var\(--vscode-descriptionForeground,\s*(#[0-9A-Fa-f]{6})\)\s+(\d+)%,\s*var\(--vscode-input-foreground,\s*(#[0-9A-Fa-f]{6})\)\)$/.exec(decl(rootBlock, "placeholder-mix") ?? "");
assert.ok(phDecl, `:root --hp-placeholder-mix mixes descriptionForeground into input-foreground, got "${decl(rootBlock, "placeholder-mix")}"`);
assert.equal(decl(rootBlock, "text-placeholder-default"), "var(--vscode-input-placeholderForeground, var(--hp-placeholder-mix))", ":root --hp-text-placeholder-default is the theme's own placeholder colour first");
const PH = { descFallback: phDecl[1], share: Number(phDecl[2]) / 100, inFgFallback: phDecl[3] };
const placeholderOn = (desc, inFg, input, share = PH.share) => mix(flat(desc, input), flat(inFg, input), share);
// Themes whose own placeholder fails 4.5:1 get the mix instead, keyed by the webview body's theme id.
const MIX_THEME_IDS = new Set(rulesOfTokens().filter((r) => r.body.replace(/[\s;]+/g, "") === "--hp-text-placeholder-default:var(--hp-placeholder-mix)")
  .flatMap((r) => r.parts.map((p) => /^body\[data-vscode-theme-id="([^"]+)"\]$/.exec(p)?.[1])).filter(Boolean));
function rulesOfTokens() { return [...tokens.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({ parts: sel.split(",").map((x) => x.trim()), body })); }
assert.ok(PAPER.ring && PAPER.placeholder && PAPER.panel, "Paper surface defines --hp-ring-focus-default and --hp-text-placeholder-default as literals");

// Surfaces that paint their own HP background fix the token to an HP value.
const scopeOf = (value) => {
  const m = [...tokens.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, , body]) => body.replace(/\s+/g, "").includes(value));
  return m ? m[1].split(",").map((s) => s.trim()) : [];
};
// The branded screens keep the lime ring and the muted placeholder as literals.
assert.equal(hex(forestBlock, "ring-focus-default"), HP.accent, "branded screens: the ring is the lime accent");
assert.equal(hex(forestBlock, "text-placeholder-default"), HP.muted, "branded screens: the placeholder is the muted text");
const mutedScope = [...scopeOf("--hp-text-placeholder-default:var(--hp-text-muted-default)"), ".studio-start", ".studio-disconnected"];
assert.ok(mutedScope.includes(".hp-surface"), `muted placeholder scope: ${mutedScope}`);

// The design doc is the canonical source (tokens.css header): every new declaration is recorded there.
const doc = readFileSync(new URL("../../../docs/design/studio-learning-experience.md", import.meta.url), "utf8").replace(/\s+/g, " ");
for (const [block, name] of [[rootBlock, "ring-focus-default"], [rootBlock, "placeholder-mix"], [rootBlock, "text-placeholder-default"], [paperBlock, "ring-focus-default"], [paperBlock, "text-placeholder-default"]]) {
  const line = `--hp-${name}: ${decl(block, name)};`.replace(/\s+/g, " ");
  assert.ok(doc.includes(line), `design doc §디자인 시스템 records "${line}"`);
}

// ---------- themes ----------
// The default theme ships with the extension; read it, never copy it.
const studioTheme = JSON.parse(readFileSync(new URL("../media/hypeproof-theme.json", import.meta.url), "utf8")).colors;
// VS Code default themes (vscode extensions/theme-defaults/themes/*.json, include chains resolved)
// and, where a theme leaves a key out, the colour registry defaults
// (src/vs/platform/theme/common/colors/{baseColors,inputColors}.ts, src/vs/workbench/common/theme.ts):
//   foreground        dark #CCCCCC  light #616161  hcDark #FFFFFF  hcLight #292929
//   focusBorder       dark #007FD4  light #0090F1  hcDark #F38518  hcLight #006BBD
//   descriptionForeground  light #717171, otherwise foreground at 70% (B3)
//   input.background  dark #3C3C3C  light #FFFFFF  hcDark #000000  hcLight #FFFFFF
//   input.foreground  = foreground;  sideBar.background dark #252526  light #F3F3F3
//   input.placeholderForeground  foreground at 50% (dark, light), 70% (hcDark, hcLight)
// `id` is the theme's settings id, which the webview body carries as data-vscode-theme-id.
const THEMES = [
  { name: "HypeProof Studio", id: "HypeProof Studio", kind: "dark", side: studioTheme["sideBar.background"], editor: studioTheme["editor.background"], input: studioTheme["input.background"], focus: studioTheme.focusBorder, desc: studioTheme.descriptionForeground ?? `${studioTheme.foreground}B3`, inFg: studioTheme["input.foreground"] ?? studioTheme.foreground, ph: studioTheme["input.placeholderForeground"] ?? `${studioTheme.foreground}80` },
  { name: "Dark Modern", id: "Dark Modern", kind: "dark", side: "#181818", editor: "#1F1F1F", input: "#313131", focus: "#0078D4", desc: "#9D9D9D", inFg: "#CCCCCC", ph: "#989898" },
  { name: "Light Modern", id: "Light Modern", kind: "light", side: "#F8F8F8", editor: "#FFFFFF", input: "#FFFFFF", focus: "#005FB8", desc: "#3B3B3B", inFg: "#3B3B3B", ph: "#767676" },
  { name: "Dark+", id: "Dark+", kind: "dark", side: "#252526", editor: "#1E1E1E", input: "#3C3C3C", focus: "#007FD4", desc: "#CCCCCCB3", inFg: "#CCCCCC", ph: "#A6A6A6" },
  { name: "Light+", id: "Light+", kind: "light", side: "#F3F3F3", editor: "#FFFFFF", input: "#FFFFFF", focus: "#0090F1", desc: "#717171", inFg: "#616161", ph: "#767676" },
  { name: "HC Dark", id: "Default High Contrast", kind: "hcDark", side: "#000000", editor: "#000000", input: "#000000", focus: "#F38518", desc: "#FFFFFFB3", inFg: "#FFFFFF", ph: "#FFFFFFB3" },
  { name: "HC Light", id: "Default High Contrast Light", kind: "hcLight", side: "#FFFFFF", editor: "#FFFFFF", input: "#FFFFFF", focus: "#006BBD", desc: "#292929B3", inFg: "#292929", ph: "#292929B3" },
  { name: "2026 Dark", id: "Dark 2026", kind: "dark", side: "#191A1B", editor: "#121314", input: "#191A1B", focus: "#3994BCB3", desc: "#8C8C8C", inFg: "#BFBFBF", ph: "#555555" },
  { name: "2026 Light", id: "Light 2026", kind: "light", side: "#FAFAFD", editor: "#FFFFFF", input: "#FFFFFF", focus: "#0069CCFF", desc: "#606060", inFg: "#202020", ph: "#999999" },
];
// When the vscodium-base submodule is checked out (or VSCODE_THEME_DEFAULTS_DIR points at a copy), re-derive the explicit theme keys so the table cannot drift.
const THEME_DIR = process.env.VSCODE_THEME_DEFAULTS_DIR
  ? new URL(`file://${process.env.VSCODE_THEME_DEFAULTS_DIR.replace(/\/?$/, "/")}`)
  : new URL("../../../vscodium-base/vscode/extensions/theme-defaults/themes/", import.meta.url);
const THEME_FILES = { "Dark Modern": "dark_modern.json", "Light Modern": "light_modern.json", "Dark+": "dark_plus.json", "Light+": "light_plus.json", "HC Dark": "hc_black.json", "HC Light": "hc_light.json", "2026 Dark": "2026-dark.json", "2026 Light": "2026-light.json" };
if (existsSync(new URL("dark_modern.json", THEME_DIR))) {
  // Theme files are JSONC: drop // and /* */ comments outside strings, then trailing commas.
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
  const load = (url) => {
    const j = jsonc(readFileSync(url, "utf8"));
    return { ...(j.include ? load(new URL(j.include, url)) : {}), ...(j.colors ?? {}) };
  };
  const KEYS = { side: "sideBar.background", editor: "editor.background", input: "input.background", focus: "focusBorder", desc: "descriptionForeground", inFg: "input.foreground", ph: "input.placeholderForeground" };
  const pkgThemes = jsonc(readFileSync(new URL("../package.json", THEME_DIR), "utf8")).contributes.themes;
  for (const t of THEMES.slice(1)) {
    const c = load(new URL(THEME_FILES[t.name], THEME_DIR));
    for (const [k, key] of Object.entries(KEYS)) if (c[key]) assert.equal(t[k].toUpperCase(), c[key].toUpperCase(), `${t.name} ${key} matches theme-defaults`);
    assert.equal(pkgThemes.find((x) => x.path === `./themes/${THEME_FILES[t.name]}`)?.id, t.id, `${t.name} settings id matches theme-defaults/package.json`);
  }
  console.log("  theme table re-derived from vscodium-base theme-defaults");
} else console.log("  vscodium-base not checked out: theme table taken as recorded (sources in the comment above)");

// ---------- ratios ----------
const rows = [];
const need = (label, fg, bg, min) => { rows.push([label, fg, bg, ratio(fg, bg).toFixed(2)]); assert.ok(meets(fg, bg, min), `${label}: ${fg} on ${bg} is ${ratio(fg, bg).toFixed(2)}:1 < ${min}:1`); };

// Ring — HP dark surfaces (lime scope), including the start page's radial highlight.
const startCss = strip(read("start.css"));
const gradient = /radial-gradient\([^,]*,\s*(#[0-9A-Fa-f]{8})/.exec(startCss)?.[1];
assert.ok(gradient, "start page gradient colour found");
for (const [label, bg] of [["--hp-bg-app-default", HP.bg], ["--hp-bg-panel-default", HP.panel], ["start gradient", flat(gradient, HP.bg)]]) need(`ring (lime) on ${label}`, HP.accent, bg, 3);
assert.match(strip(read("styles.css")), /\.hp-mission\s*\{[^}]*background:\s*var\(--hp-bg-panel-default\)/, "the lime-ring scope .hp-mission paints --hp-bg-panel-default itself");
// Ring — Paper.
need("ring on Paper", PAPER.ring, PAPER.bg, 3);
need("ring on Paper white panel", PAPER.ring, PAPER.panel, 3);
// Ring — theme-following surfaces: each theme's focusBorder on the surfaces the webview paints with it.
// The 2px offset leaves a gap of that surface between control and ring, so the surface is the adjacent colour.
for (const t of THEMES) for (const s of ["side", "editor"]) need(`ring ${t.name} on ${s}`, flat(t.focus, t[s]), t[s], 3);
// Ring — fallback when no --vscode-* variable is set: every literal surface fallback the theme-following CSS uses.
const surfaceFallbacks = new Set();
for (const f of ["styles.css", "taskWorkspace.css"]) {
  for (const m of strip(read(f)).matchAll(/--vscode-(?:sideBar|editor)-background,\s*(#[0-9A-Fa-f]{6})\)/g)) surfaceFallbacks.add(m[1].toUpperCase());
}
assert.ok(surfaceFallbacks.size >= 3, `surface fallbacks found: ${[...surfaceFallbacks]}`);
for (const bg of surfaceFallbacks) need("ring fallback on fallback surface", RING_FALLBACK, bg, 3);

// Placeholder — every rule, against the field background it is drawn on.
const placeholderToken = {
  theme: (t) => placeholderOn(t.desc, t.inFg, t.input),
  fallback: (input) => placeholderOn(PH.descFallback, PH.inFgFallback, input),
};
// The placeholder a theme actually gets: its own input.placeholderForeground, or the mix where tokens.css
// overrides that theme by id. It must reach 4.5:1 on the input and stay >=1.5:1 apart from typed text.
// Where the typed text itself is too close to the background for both (text/bg < 4.5 x 1.5), the gap
// cannot be met by any colour; such a theme must be listed here, so a new one cannot slip in silently.
const SEPARATION = 1.5;
const SEPARATION_INFEASIBLE = ["Light+"]; // #616161 text is 6.2:1 on white: at most 1.38:1 of room above 4.5:1
const effectivePlaceholder = (t) => (MIX_THEME_IDS.has(t.id) ? placeholderToken.theme(t) : flat(t.ph, t.input));
for (const t of THEMES) {
  const placeholder = effectivePlaceholder(t), typed = flat(t.inFg, t.input);
  need(`placeholder ${t.name} on input${MIX_THEME_IDS.has(t.id) ? " (mix override)" : ""}`, placeholder, t.input, 4.5);
  const gap = ratio(placeholder, typed), room = ratio(typed, t.input) / 4.5;
  rows.push([`placeholder ${t.name} apart from typed text`, placeholder, typed, gap.toFixed(2)]);
  if (room < SEPARATION) {
    assert.ok(SEPARATION_INFEASIBLE.includes(t.name), `${t.name}: only ${room.toFixed(2)}:1 of room between 4.5:1 and the typed text; list it as infeasible`);
  } else {
    assert.ok(!SEPARATION_INFEASIBLE.includes(t.name), `${t.name} is listed as infeasible but has ${room.toFixed(2)}:1 of room`);
    assert.ok(gap >= SEPARATION, `${t.name}: placeholder ${placeholder} is ${gap.toFixed(2)}:1 from typed text ${typed} (< ${SEPARATION}:1)`);
  }
}
for (const id of MIX_THEME_IDS) assert.ok(THEMES.some((t) => t.id === id), `override for unknown theme id "${id}"`);
need("placeholder (muted) on --hp-bg-app-default field", HP.muted, HP.bg, 4.5);
need("placeholder on Paper", PAPER.placeholder, PAPER.bg, 4.5);
need("placeholder on Paper white", PAPER.placeholder, PAPER.panel, 4.5);

// ---------- CSS scan ----------
const RING = "2px solid var(--hp-ring-focus-default)";
const INSET_OK = [".tw-task-list", ".tw-source-list"]; // tight rows in scrolling lists
// Programmatic focus targets (tabIndex=-1 headings), not controls: no ring by design.
const NO_RING_OK = [".cp-preview h3:focus"];
// State markers that are not focus: the local review's current-page tab keeps its own outline.
const STATE_OUTLINE_OK = [".local-review [aria-current=page]"];
const norm = (s) => s.replace(/\s+/g, " ").trim();
const rulesOf = (css) => [...strip(css).matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({
  parts: sel.split(",").map(norm).filter(Boolean),
  decls: body.split(";").map((d) => d.split(":")).filter((d) => d.length >= 2).map(([k, ...v]) => [k.trim(), norm(v.join(":")).replace(/\s*!important$/, "")]),
}));
const isFocus = (part) => /:focus(-visible|-within)?\b/.test(part);

// `geometry` checks need no token (width, style, offset, removal without any 2px ring); `token`
// checks the colour is --hp-ring-focus-default. The geometry checks alone fail on origin/main (fixtures below).
const GEOMETRY = /^2px solid \S.*$/;
function scanFocus(files, { token = true } = {}) {
  const bad = [];
  // Shared important geometry is parsed separately by focus-geometry.smoke.mjs.
  const rules = Object.entries(files).filter(([f]) => f !== "designTokens.css" && f !== "focusGeometry.css").flatMap(([f, css]) => rulesOf(css).map((r) => ({ ...r, f })));
  const ringOk = (v) => (token ? v === RING : GEOMETRY.test(v));
  const ringParts = new Set(rules.filter((r) => r.decls.some(([k, v]) => k === "outline" && ringOk(v))).flatMap((r) => r.parts));
  let ringRules = 0;
  for (const { f, parts, decls } of rules) {
    const focus = parts.some(isFocus);
    for (const [k, v] of decls) {
      if (!k.startsWith("outline")) continue;
      const removes = (k === "outline" && /^(none|0)$/.test(v)) || (k === "outline-style" && v === "none") || (k === "outline-width" && /^0(px)?$/.test(v));
      if (removes) {
        for (const p of parts) {
          if (NO_RING_OK.includes(p)) continue;
          const base = p.replace(/:focus(-visible)?$/, "");
          const ancestors = base.split(" ").slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join(" "));
          const replaced = ringParts.has(`${base}:focus-visible`) || ringParts.has(`${base}:focus`) || ancestors.some((a) => ringParts.has(`${a}:focus-within`));
          if (!replaced) bad.push(`${f}: "${p}" removes the outline without a --hp-ring-focus-default replacement`);
        }
        continue;
      }
      if (!focus && parts.every((p) => STATE_OUTLINE_OK.includes(p)) && k === "outline") continue;
      if (!focus) { bad.push(`${f}: "${parts[0]}" sets ${k} outside a focus rule`); continue; }
      if (k === "outline") { if (ringOk(v)) ringRules++; else bad.push(`${f}: "${parts[0]}" focus ring is "${v}", not "${RING}"`); }
      else if (k === "outline-offset") {
        if (v === "-2px") { if (!parts.every((p) => INSET_OK.some((s) => p.includes(s)))) bad.push(`${f}: "${parts[0]}" insets the ring outside a tight scroll row`); }
        else if (v !== "2px") bad.push(`${f}: "${parts[0]}" outline-offset ${v}, not 2px`);
      } else if (token || k !== "outline-color") bad.push(`${f}: "${parts[0]}" sets ${k}; use the outline shorthand with --hp-ring-focus-default`);
    }
  }
  return { bad, ringRules };
}

function scanPlaceholder(files) {
  const bad = [];
  const found = [];
  for (const [f, css] of Object.entries(files)) for (const { parts, decls } of rulesOf(css)) {
    if (!parts.some((p) => p.includes("::placeholder"))) continue;
    found.push(...parts);
    const color = decls.find(([k]) => k === "color")?.[1];
    if (color !== "var(--hp-text-placeholder-default)") bad.push(`${f}: "${parts[0]}" placeholder colour is "${color}", not var(--hp-text-placeholder-default)`);
    for (const [k, v] of decls) if (k === "opacity" && Number(v) !== 1) bad.push(`${f}: "${parts[0]}" placeholder opacity ${v}`);
  }
  return { bad, found };
}

const cssFiles = Object.fromEntries(readdirSync(SRC).filter((f) => f.endsWith(".css")).map((f) => [f, read(f)]));
const focus = scanFocus(cssFiles);
assert.deepEqual(focus.bad, [], focus.bad.join("\n"));
assert.deepEqual(scanFocus(cssFiles, { token: false }).bad, [], "geometry-only scan passes too");
assert.ok(focus.ringRules >= 20, `focus scan saw ${focus.ringRules} ring rules: the scan is not reading the CSS`);
const ph = scanPlaceholder(cssFiles);
assert.deepEqual(ph.bad, [], ph.bad.join("\n"));

// The baselines in tokens.css. VS Code's injected webview defaults
// (`a:focus, input:focus, select:focus, textarea:focus { outline: 1px solid -webkit-focus-ring-color; outline-offset: -1px }`)
// sit in `@layer vscode-default`; an unlayered rule beats any layered one, so a plain `:focus-visible`
// replaces them. The baselines must stay unlayered.
const baselineOf = (css, sel) => rulesOf(css).find((r) => r.parts.length === 1 && r.parts[0] === sel);
assert.doesNotMatch(tokens, /@layer/, "tokens.css baselines are unlayered");
assert.deepEqual(Object.fromEntries(baselineOf(tokensRaw, ":focus-visible")?.decls ?? []), { outline: RING, "outline-offset": "2px" }, "tokens.css :focus-visible baseline");
const placeholderBaseline = (css) => {
  const d = Object.fromEntries(baselineOf(css, "::placeholder")?.decls ?? []);
  return d.color === "var(--hp-text-placeholder-default)" && d.opacity === "1";
};
assert.ok(placeholderBaseline(tokensRaw), "tokens.css ::placeholder baseline gives every field the token at opacity 1");

// Every field the CSS paints, measured with the placeholder it gets. Fields that paint their own HP
// background must sit in the muted placeholder scope; the rest take the theme placeholder (measured above
// per theme) and, without theme variables, the mix fallback on their literal fallback background.
const lastHex = (v) => [...(v ?? "").matchAll(/#[0-9A-Fa-f]{6}\b/g)].pop()?.[0];
const HP_ANCESTOR = { ".studio-connect": ".studio-start" }; // DOM ancestors the selector does not name
const inScope = (part) => part.split(/\s+/).some((seg) => mutedScope.some((s) => seg === s || seg.startsWith(`${s}:`) || seg.startsWith(`${s}[`) || HP_ANCESTOR[seg] === s));
let fields = 0;
for (const [f, css] of Object.entries(cssFiles)) for (const { parts, decls } of rulesOf(css)) {
  for (const part of parts) {
    if (!/(^|[\s>+~(])(input|textarea)\b/.test(part) || /::|:(focus|hover|disabled|active)|type="?(radio|checkbox)/.test(part)) continue;
    const bg = decls.find(([k]) => k === "background" || k === "background-color")?.[1];
    if (!bg || /^(transparent|none)$/.test(bg) || /--vscode-(button|foreground)/.test(bg)) continue;
    fields++;
    if (/var\(--hp-bg-(app|panel)-default\b/.test(bg) || /^#[0-9A-Fa-f]{6}$/.test(bg)) {
      assert.ok(inScope(part), `${f}: "${part}" paints its own HP background (${bg}) but is outside the muted placeholder scope`);
      const literal = /--hp-bg-app-default/.test(bg) ? HP.bg : /--hp-bg-panel-default/.test(bg) ? HP.panel : bg;
      need(`placeholder (muted) ${part}`, HP.muted, literal, 4.5);
    } else {
      assert.match(bg, /var\(--vscode-input-background\b/, `${f}: "${part}" field background "${bg}" is neither HP nor the theme input`);
      const fb = lastHex(bg);
      if (fb) need(`placeholder fallback ${part}`, placeholderToken.fallback(fb), fb, 4.5);
    }
  }
}
assert.ok(fields >= 10, `field scan saw ${fields} fields: the scan is not reading the CSS`);

// ---------- origin/main regression fixtures ----------
// Rules copied verbatim from origin/main before this change. The token-free checks must reject
// them on their own merits, not only because they predate --hp-ring-focus-default.
const MAIN = {
  "styles.css": ".hps-input textarea:focus {\n  outline: 1px solid var(--vscode-focusBorder, #007fd4);\n}",
  "start.css": ".studio-start :focus-visible,.studio-disconnected :focus-visible {\n  outline:2px solid #d8c5a9;\n  outline-offset:4px}",
  "styles.css#2": ".hps-instructor-model-input:focus-visible { outline: 2px solid var(--hp-accent, #0ea5e9); outline-offset: 1px; }",
  "localReview.css": ".local-review :focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:3px}",
};
for (const [f, css] of Object.entries(MAIN)) assert.equal(scanFocus({ [f]: css }, { token: false }).bad.length, 1, `main fixture ${f} fails the geometry check`);
// main had no ::placeholder baseline: the classroom composer and ~25 other fields drew the browser
// default, which ignores the theme (#757575 in a light scheme is 2.4:1 on Dark+ input).
const mainTokens = ":root {\n  --hp-muted: #ACB9A5;\n}\n:root[data-reduced-motion=\"true\"] * {\n  animation-duration: 0.01ms !important;\n}";
assert.ok(!placeholderBaseline(mainTokens), "main fixture: tokens.css without a ::placeholder baseline fails");
assert.ok(!meets("#757575", THEMES.find((t) => t.name === "Dark+").input, 4.5), "main fixture: the browser default placeholder fails on Dark+");

// ---------- negative controls ----------
const neg = (css) => scanFocus({ "neg.css": css }).bad;
assert.equal(neg("button:focus { outline: none; }").length, 1, "control: outline:none with no replacement is caught");
assert.equal(neg("button:focus { outline: 0; }").length, 1, "control: outline:0 is caught");
assert.equal(neg(".a:focus-visible { outline: 1px solid var(--hp-ring-focus-default); outline-offset: 2px; }").length, 1, "control: a 1px ring is caught");
assert.equal(neg(".a:focus-visible { outline: 2px solid var(--vscode-focusBorder, #799ed7); outline-offset: 2px; }").length, 1, "control: a ring that bypasses the token is caught");
assert.equal(neg(".a:focus-visible { outline: 2px solid var(--hp-ring-focus-default); outline-offset: 3px; }").length, 1, "control: a 3px offset is caught");
assert.equal(neg(".a:focus-visible { outline: 2px solid var(--hp-ring-focus-default); outline-offset: -2px; }").length, 1, "control: an inset ring outside a scroll row is caught");
assert.equal(neg(".a:focus-visible { outline-color: red; }").length, 1, "control: a longhand outline colour is caught");
assert.deepEqual(neg(".w .f { outline: none; } .w:focus-within { outline: 2px solid var(--hp-ring-focus-default); outline-offset: 2px; }"), [], "control: an ancestor :focus-within ring is a valid replacement");
assert.deepEqual(neg(".f { outline: none; } .f:focus-visible { outline: 2px solid var(--hp-ring-focus-default); }"), [], "control: a :focus-visible ring on the same element is a valid replacement");
const negPh = (css) => scanPlaceholder({ "neg.css": css }).bad;
assert.equal(negPh(".f::placeholder { color: var(--hp-text-placeholder-default); opacity: .5; }").length, 1, "control: placeholder opacity .5 is caught");
assert.equal(negPh(".f::placeholder { color: #8f8f8f; }").length, 1, "control: a literal placeholder colour is caught");
assert.ok(!meets("#8F8F8F", "#FFFFFF", 4.5), "control: ChatGPT's tertiary #8f8f8f on white really is below 4.5:1");
assert.ok(!meets(HP.line, HP.bg, 3), "control: --hp-border-divider-default would be too faint for a ring");
assert.ok(!meets(HP.accent, PAPER.bg, 3), "control: the lime ring would vanish on Paper, which is why Paper has its own");
const darkPlus = THEMES.find((t) => t.name === "Dark+"), lightModern = THEMES.find((t) => t.name === "Light Modern");
assert.ok(!meets(placeholderOn(darkPlus.desc, darkPlus.inFg, darkPlus.input, 1), darkPlus.input, 4.5), "control: plain descriptionForeground fails Dark+, which is why the mix blends in input text");
assert.ok(ratio(placeholderToken.theme(lightModern), flat(lightModern.inFg, lightModern.input)) < SEPARATION, "control: the mix alone equals typed text in Light Modern, which is why the theme placeholder comes first");
assert.ok(!meets(flat(THEMES.find((t) => t.id === "Dark 2026").ph, "#191A1B"), "#191A1B", 4.5), "control: Dark 2026's own placeholder fails 4.5:1, which is why it is overridden");
assert.equal(negPh("::placeholder { color: var(--hp-text-placeholder-default); }").length, 0, "control: a baseline-style rule passes");

for (const r of rows) console.log(`  ${r[3].padStart(6)}:1  ${r[0]} (${r[1]} on ${r[2]})`);
console.log(`focus-placeholder smoke OK (${focus.ringRules} ring rules, ${ph.found.length} placeholder rules, ${fields} fields)`);
