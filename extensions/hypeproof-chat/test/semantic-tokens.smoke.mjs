// CGP-DS-D-001 / DES-CGP-DS-01 — the token file comes first and names its colour roles
// --hp-{text|bg|border|ring}-{role}-{state}.
//   node --experimental-strip-types test/semantic-tokens.smoke.mjs
//
// 1. Order: main.tsx imports tokens.css before anything else, tokens.css starts with the canonical
//    designTokens.css, and the stylesheet esbuild bundles from main.tsx carries the token rules
//    before any component rule.
// 2. Names: every colour role in tokens.css follows the pattern (state = default | hover | pressed | selected).
//    Type-scale sizes are --hp-font-*, so a --hp-text-* name is always a text colour.
// 3. Computed snapshot: the :root custom properties are resolved the way the browser computes them
//    (var() substituted, host --vscode-* absent so their fallbacks apply) for the dark (forest) theme
//    and for the light (Paper) reading surface. Every --hp-* role a component reads (CSS and TSX)
//    resolves to a value in both; the Paper rule binds every colour role explicitly; each theme is
//    readable on its own (text 4.5:1, control boundary and focus ring 3:1).
// 4. Components read roles; they never declare one (forced-colors rules excepted).
//
// The checks are functions over the file texts, so each also runs against a mutated copy that must
// fail (negative controls), in the stylesheet-rule pattern of test/ui-polish-1.smoke.mjs.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const require = createRequire(new URL("../webview-ui/package.json", import.meta.url));
const postcss = require("postcss");
const SRC = fileURLToPath(new URL("../webview-ui/src/", import.meta.url));
const TOKEN_FILES = ["tokens.css", "designTokens.css"];
const COMPONENT_CSS = readdirSync(SRC).filter((f) => f.endsWith(".css") && !TOKEN_FILES.includes(f)).sort();
const TSX = readdirSync(SRC).filter((f) => f.endsWith(".tsx")).sort();
const real = Object.fromEntries([...TOKEN_FILES, ...COMPONENT_CSS, ...TSX, "main.tsx"].map((f) => [f, readFileSync(join(SRC, f), "utf8")]));

const ROLE = /^--hp-(text|bg|border|ring)-[a-z]+-(default|hover|pressed|selected)$/;
const CATEGORY = /^--hp-(text|bg|border|ring)-/;
const HELPERS = new Set(["--hp-placeholder-mix"]); // an input of --hp-text-placeholder-default, read by no component
const PAPER = '[data-surface="growth"]';

// ─── CSS model ───────────────────────────────────────────────────────────────────────────────────
function topRules(css) {
  const out = [];
  postcss.parse(css).each((n) => {
    if (n.type === "rule") out.push({ selectors: n.selectors.map((s) => s.trim()), decls: n.nodes.filter((d) => d.type === "decl").map((d) => [d.prop, d.value]) });
  });
  return out;
}
/** Every var() reference with the media context and the declaring property. */
function refs(css) {
  const out = [];
  postcss.parse(css).walkDecls((d) => {
    let media = "";
    for (let p = d.parent; p; p = p.parent) if (p.type === "atrule" && p.name === "media") media = p.params;
    for (const m of d.value.matchAll(/var\((--hp-[\w-]+)/g)) out.push({ name: m[1], prop: d.prop, media, selector: d.parent.selector ?? "" });
  });
  return out;
}
function decls(css) {
  const out = [];
  postcss.parse(css).walkDecls((d) => {
    let media = "";
    for (let p = d.parent; p; p = p.parent) if (p.type === "atrule" && p.name === "media") media = p.params;
    out.push({ prop: d.prop, value: d.value, media, selector: d.parent.selector ?? "" });
  });
  return out;
}

/** Substitute var() the way a browser computes a custom property on one element. */
function resolver(env) {
  const memo = new Map();
  function value(text, seen) {
    let out = "", i = 0;
    while (i < text.length) {
      const at = text.indexOf("var(", i);
      if (at < 0) { out += text.slice(i); break; }
      out += text.slice(i, at);
      let depth = 1, j = at + 4;
      for (; j < text.length && depth; j++) depth += text[j] === "(" ? 1 : text[j] === ")" ? -1 : 0;
      const inner = text.slice(at + 4, j - 1);
      let comma = -1, d = 0;
      for (let k = 0; k < inner.length; k++) { if (inner[k] === "(") d++; if (inner[k] === ")") d--; if (inner[k] === "," && d === 0) { comma = k; break; } }
      const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
      const fallback = comma < 0 ? null : inner.slice(comma + 1).trim();
      const got = env.has(name) ? get(name, seen) : null;
      if (got != null) out += got;
      else if (fallback != null) { const fb = value(fallback, seen); if (fb == null) return null; out += fb; }
      else return null; // guaranteed-invalid: the property is unset
      i = j;
    }
    return out;
  }
  function get(name, seen = new Set()) {
    if (memo.has(name)) return memo.get(name);
    if (seen.has(name) || !env.has(name)) return null;
    const v = value(env.get(name), new Set([...seen, name]));
    memo.set(name, v);
    return v;
  }
  return get;
}

/** :root and Paper custom properties as computed, plus the raw Paper rule. */
function snapshot(files) {
  const root = new Map();
  for (const f of ["designTokens.css", "tokens.css"]) for (const r of topRules(files[f])) if (r.selectors.includes(":root")) for (const [k, v] of r.decls) if (k.startsWith("--")) root.set(k, v);
  const paperDecls = new Map();
  for (const r of topRules(files["tokens.css"])) if (r.selectors.includes(PAPER)) for (const [k, v] of r.decls) paperDecls.set(k, v);
  // A custom property declared on the Paper element is computed there; the rest inherit computed :root values.
  const rootGet = resolver(root);
  const paperEnv = new Map([...root].map(([k]) => [k, rootGet(k) ?? "var(--unset-guaranteed-invalid)"]));
  for (const [k, v] of paperDecls) paperEnv.set(k, v);
  const paperGet = resolver(paperEnv);
  return { root, rootGet, paperDecls, paperGet };
}

// ─── contrast ────────────────────────────────────────────────────────────────────────────────────
const isHex = (v) => /^#[0-9a-f]{6}$/i.test(v ?? "");
/** `color-mix(in srgb, #A p%, #B)` of two flat colours, as the browser paints it; anything else as is. */
const flat = (v) => {
  const m = /^color-mix\(in srgb,\s*(#[0-9a-f]{6})\s+(\d+)%,\s*(#[0-9a-f]{6})\)$/i.exec(v ?? "");
  if (!m) return v;
  const [a, b, p] = [m[1], m[3], Number(m[2]) / 100];
  return "#" + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * p + parseInt(b.slice(i, i + 2), 16) * (1 - p)).toString(16).padStart(2, "0")).join("").toUpperCase();
};
const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const PAIRS = [
  ["--hp-text-primary-default", "--hp-bg-app-default", 4.5], ["--hp-text-primary-default", "--hp-bg-panel-default", 4.5],
  ["--hp-text-muted-default", "--hp-bg-app-default", 4.5], ["--hp-text-muted-default", "--hp-bg-panel-default", 4.5],
  ["--hp-text-placeholder-default", "--hp-bg-app-default", 4.5], ["--hp-text-placeholder-default", "--hp-bg-panel-default", 4.5], ["--hp-text-inverse-default", "--hp-bg-accent-default", 4.5],
  ["--hp-border-control-default", "--hp-bg-app-default", 3], ["--hp-border-control-default", "--hp-bg-panel-default", 3],
  ["--hp-ring-focus-default", "--hp-bg-app-default", 3], ["--hp-ring-focus-default", "--hp-bg-panel-default", 3],
];

// ─── checks ──────────────────────────────────────────────────────────────────────────────────────
const IMPORT = /^\s*import\s+(?:[^'";]+?\s+from\s+)?["']([^"']+)["']/gm;
const CHECKS = {
  "1 main.tsx imports tokens.css first and tokens.css starts with the canonical source": (files) => {
    const bad = [];
    const imports = [...files["main.tsx"].matchAll(IMPORT)].map((m) => m[1]);
    if (imports[0] !== "./tokens.css") bad.push(`main.tsx first import is ${imports[0]}`);
    const first = postcss.parse(files["tokens.css"]).nodes.find((n) => n.type !== "comment");
    if (!(first?.type === "atrule" && first.name === "import" && first.params === '"./designTokens.css"')) bad.push(`tokens.css starts with ${first?.toString().slice(0, 40)}`);
    return bad;
  },
  "2 every colour role in tokens.css is --hp-{text|bg|border|ring}-{role}-{state}": (files) => {
    const bad = [];
    const { root, rootGet } = snapshot(files);
    for (const d of decls(files["tokens.css"])) {
      if (!d.prop.startsWith("--hp-")) continue;
      if (CATEGORY.test(d.prop) && !ROLE.test(d.prop)) bad.push(`${d.prop} does not follow the pattern`);
    }
    for (const [k] of root) {
      if (!k.startsWith("--hp-") || ROLE.test(k) || HELPERS.has(k)) continue;
      const v = rootGet(k) ?? "";
      if (/^#|^rgba?\(|^color-mix\(|^(Highlight|CanvasText|ButtonText)$/i.test(v)) bad.push(`${k} carries a colour (${v}) outside the role pattern`);
    }
    return bad;
  },
  "3 computed :root and Paper resolve every role a component reads; Paper binds every colour role": (files) => {
    const bad = [];
    const { root, rootGet, paperDecls, paperGet } = snapshot(files);
    const used = new Set();
    for (const f of [...COMPONENT_CSS, ...TSX]) {
      const local = new Set(f.endsWith(".css") ? decls(files[f]).map((d) => d.prop) : []);
      const names = f.endsWith(".css") ? refs(files[f]).map((r) => r.name) : [...files[f].matchAll(/var\((--hp-[\w-]+)/g)].map((m) => m[1]);
      for (const n of names) if (!(local.has(n) && !root.has(n))) used.add(n);
    }
    if (used.size < 20) bad.push(`only ${used.size} roles seen: the scan is not reading the components`);
    for (const n of used) {
      if (rootGet(n) == null) bad.push(`${n} is read by a component but not defined on :root`);
      else if (paperGet(n) == null) bad.push(`${n} does not resolve on the Paper surface`);
      if (CATEGORY.test(n) && !ROLE.test(n)) bad.push(`${n} is read by a component but is not a role name`);
    }
    const rootRoles = [...root.keys()].filter((k) => ROLE.test(k)).sort();
    const paperRoles = [...paperDecls.keys()].filter((k) => ROLE.test(k)).sort();
    for (const k of rootRoles) if (!paperRoles.includes(k)) bad.push(`Paper does not bind ${k}`);
    for (const k of paperRoles) if (!rootRoles.includes(k)) bad.push(`Paper binds ${k}, which forest does not define`);
    for (const k of rootRoles) if (!used.has(k)) bad.push(`${k} is defined but no component reads it`);
    for (const [theme, get] of [["forest", rootGet], ["Paper", paperGet]]) {
      for (const [fg, bg, min] of PAIRS) {
        const [a, b] = [flat(get(fg)), flat(get(bg))];
        if (!isHex(a) || !isHex(b)) { bad.push(`${theme}: ${fg} (${a}) or ${bg} (${b}) is not a flat colour`); continue; }
        if (contrast(a, b) < min) bad.push(`${theme}: ${fg} ${a} on ${bg} ${b} is ${contrast(a, b).toFixed(2)}:1 < ${min}:1`);
      }
    }
    return bad;
  },
  "4 components read roles and never declare one outside forced colours": (files) => {
    const bad = [];
    for (const f of COMPONENT_CSS) for (const d of decls(files[f])) {
      if (ROLE.test(d.prop) && !/forced-colors:\s*active/.test(d.media)) bad.push(`${f}: ${d.selector} declares ${d.prop}`);
      if (/^--hp-text-/.test(d.prop) && !ROLE.test(d.prop)) bad.push(`${f}: ${d.selector} declares ${d.prop}`);
    }
    for (const f of TSX) for (const m of files[f].matchAll(/['"](--hp-(?:text|bg|border|ring)-[\w-]+)['"]\s*:/g)) bad.push(`${f}: inline style declares ${m[1]}`);
    return bad;
  },
};

let passed = 0;
const failures = [];
const report = (label, bad) => { if (bad.length) { failures.push(label); console.error(`  FAIL ${label}:\n    - ${bad.join("\n    - ")}`); } else { passed++; console.log(`  ok   ${label}`); } };
for (const [label, fn] of Object.entries(CHECKS)) report(label, fn(real));

// The computed snapshot, printed so a reviewer can read it next to the components.
{
  const { root, rootGet, paperGet } = snapshot(real);
  const roles = [...root.keys()].filter((k) => ROLE.test(k)).sort();
  console.log(`  snapshot: ${roles.length} colour roles · forest / Paper`);
  for (const k of roles) console.log(`    ${k.padEnd(32)} ${String(rootGet(k)).padEnd(40)} ${paperGet(k)}`);
}

// ─── bundled order: the stylesheet the webview actually loads ────────────────────────────────────
// In memory: main.tsx goes in as stdin with its own directory, so nothing is written to disk.
async function bundledOrder(mainText) {
  {
    const out = await build({
      stdin: { contents: mainText ?? real["main.tsx"], resolveDir: SRC, sourcefile: "main.tsx", loader: "tsx" },
      bundle: true, write: false, outdir: "out", logLevel: "silent",
      jsx: "automatic",
      // Only the stylesheet matters here: packages and image assets stay external.
      plugins: [{ name: "external", setup(b) { b.onResolve({ filter: /^[^./]|\.(svg|png|jpe?g|gif|webp|woff2?)$/ }, (a) => ({ path: a.path, external: true })); } }],
    });
    const css = out.outputFiles.find((o) => o.path.endsWith(".css"))?.text ?? "";
    const rules = [];
    postcss.parse(css).walkRules((r) => rules.push(r));
    const bad = [];
    const firstRole = rules.findIndex((r) => r.nodes.some((d) => d.prop === "--hp-text-primary-default"));
    if (firstRole < 0) bad.push("no role rule in the bundled stylesheet");
    if (rules[0] && !rules[0].nodes.every((d) => d.type !== "decl" || d.prop.startsWith("--ds-p-"))) bad.push(`the bundle opens with ${rules[0].selector}, not the primitive tokens`);
    for (const r of rules.slice(0, Math.max(firstRole, 0))) if (r.nodes.some((d) => d.type === "decl" && !d.prop.startsWith("--ds-"))) bad.push(`${r.selector.slice(0, 60)} comes before the role tokens`);
    return { bad, rules: rules.length };
  }
}
{
  const { bad, rules } = await bundledOrder(null);
  report(`5 the bundled stylesheet opens with designTokens.css then tokens.css (${rules} rules)`, rules > 100 ? bad : [...bad, `only ${rules} rules bundled`]);
}

// ─── negative controls: each mutation must apply and must fail its check ─────────────────────────
const mutate = (file, from, to) => {
  const text = real[file];
  const next = typeof from === "string" ? text.replace(from, to) : text.replace(from, to);
  return next === text ? null : { ...real, [file]: next };
};
const NEGATIVE = [
  ["1", "tokens.css imported after the components", mutate("main.tsx", 'import "./tokens.css";\n', "") && { ...real, "main.tsx": real["main.tsx"].replace('import "./tokens.css";\n', "").replace('import "./chatDetails.css";', 'import "./chatDetails.css";\nimport "./tokens.css";') }],
  ["1", "tokens.css without the canonical import", mutate("tokens.css", '@import "./designTokens.css";', "")],
  ["2", "a role without its state", mutate("tokens.css", /--hp-border-muted-default:/g, "--hp-border-muted:")],
  ["2", "the type scale back under --hp-text-*", mutate("tokens.css", "--hp-font-lead:", "--hp-text-lead:")],
  ["2", "a colour alias outside the pattern", mutate("tokens.css", "  --hp-ease:", "  --hp-accent: var(--ds-c-studio-tokens-ink-12);\n  --hp-ease:")],
  ["3", "a component reads a legacy name", mutate("styles.css", "var(--hp-text-muted-default)", "var(--hp-muted)")],
  ["3", "a role missing from :root", mutate("tokens.css", "  --hp-text-warn-default: var(--vscode-list-warningForeground, var(--vscode-editorWarning-foreground, var(--ds-c-studio-tokens-ink-39))); /* Amber · caution, hold, needs confirmation */\n", "")],
  ["3", "Paper loses a role binding", mutate("tokens.css", "  --hp-border-control-default: var(--ds-c-studio-tokens-boundary-52); /* 3.6:1 on Paper, 4.0:1 on white */\n", "")],
  ["3", "Paper text left on the forest ink", mutate("tokens.css", "  --hp-text-primary-default: var(--ds-c-studio-tokens-surface-68);\n  --hp-text-muted-default: var(--ds-c-studio-tokens-ink-42);", "  --hp-text-primary-default: var(--ds-c-studio-tokens-ink-40);\n  --hp-text-muted-default: var(--ds-c-studio-tokens-ink-42);")],
  ["3", "a role no component reads", mutate("tokens.css", /  --hp-ring-focus-default: /g, "  --hp-bg-unused-default: var(--ds-c-studio-tokens-surface-68);\n  --hp-ring-focus-default: ")],
  ["4", "a component redefines a role", mutate("styles.css", ".hp-ai-can-do { --hp-ai-can-do-muted:", ".hp-ai-can-do { --hp-text-muted-default: var(--ds-c-studio-tokens-ink-42); --hp-ai-can-do-muted:")],
];
for (const [id, label, files] of NEGATIVE) {
  const check = Object.entries(CHECKS).find(([k]) => k.startsWith(`${id} `));
  if (!files) { failures.push(label); console.error(`  FAIL negative control: ${label}: the mutation did not apply (a stale search string proves nothing)`); continue; }
  const bad = check[1](files);
  if (bad.length) { passed++; console.log(`  ok   negative control: ${label} -> ${id} fails (${bad[0].slice(0, 90)})`); }
  else { failures.push(label); console.error(`  FAIL negative control: ${label} -> check ${id} still passes`); }
}
{
  const moved = real["main.tsx"].replace('import "./tokens.css";\n', "").replace('import "./chatDetails.css";', 'import "./chatDetails.css";\nimport "./tokens.css";');
  assert.notEqual(moved, real["main.tsx"], "bundle negative control applies");
  const { bad } = await bundledOrder(moved);
  if (bad.length) { passed++; console.log(`  ok   negative control: tokens.css bundled last -> 5 fails (${bad[0].slice(0, 90)})`); }
  else { failures.push("bundle order"); console.error("  FAIL negative control: tokens.css bundled last -> check 5 still passes"); }
}

console.log(`semantic-tokens: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
