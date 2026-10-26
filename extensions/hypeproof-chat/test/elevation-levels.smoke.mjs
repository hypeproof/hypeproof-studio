// CGP-DS-R-012 / REQ-CGP-DS-13 / DES-CGP-DS-13: elevation uses at most three named levels with a
// theme-specific alpha, and high contrast replaces shadows with a 1px border.
//   node --experimental-strip-types test/elevation-levels.smoke.mjs
//
// Declaration-level guard over every stylesheet the product ships (Studio webview CSS, Chalk page
// <style> blocks and Chalk's injected *Css strings). test/elevation-computed.smoke.mjs measures the
// same rules in headless Chromium. Each check is a function over the file texts, so each also runs
// against a mutated copy that must fail (negative controls).
//
// 1. Tokens: the elevation primitives name exactly flat / raised / overlay; raised and overlay each
//    have a dark and a light value with the same geometry; dark alpha >= .2 and light alpha < dark.
// 2. Theme binding (tokens.css): :root and the forest screens bind dark, body.vscode-light binds light,
//    body.vscode-high-contrast and forced colors bind flat.
// 3. Consumers: every outer box-shadow is `none`, inset-only, or one named level
//    (Studio: var(--hp-elevation-raised|overlay); Chalk, dark only: var(--ds-c-elevation-*-dark)).
//    The only exception is the hps-breathe pending glow (a looping status animation, CGP-DS-D-011).
// 4. High contrast: every Studio rule that asks for a level has a body.vscode-high-contrast rule in the
//    same file that names its selector and sets border-color, unless it is a control (composer, button)
//    whose 1px border is the fixed control boundary in every theme.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const require = createRequire(new URL("../webview-ui/package.json", import.meta.url));
const postcss = require("postcss");
const SRC = fileURLToPath(new URL("../webview-ui/src/", import.meta.url));
const CHALK_UI = fileURLToPath(new URL("../../../chalk/src/ui/", import.meta.url));
const CHALK_SRC = fileURLToPath(new URL("../../../chalk/src/", import.meta.url));
const TOKEN_FILES = ["designTokens.css", "tokens.css"];

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const real = {};
for (const f of walk(SRC).filter((f) => f.endsWith(".css"))) real["studio:" + f.slice(SRC.length)] = readFileSync(f, "utf8");
for (const f of readdirSync(CHALK_UI).filter((f) => f.endsWith(".html"))) {
  const html = readFileSync(join(CHALK_UI, f), "utf8");
  real["chalk:" + f] = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n")
    + [...html.matchAll(/\bstyle\s*=\s*["']([^"']*)["']/gi)].map((m) => `\nx{${m[1]}}`).join("");
}
for (const f of walk(CHALK_SRC).filter((f) => f.endsWith(".ts") && !f.endsWith("/design-tokens.ts"))) {
  if (!/export const \w+Css\b/.test(readFileSync(f, "utf8"))) continue;
  for (const [name, value] of Object.entries(await import(f))) if (/Css$/.test(name) && typeof value === "string") real[`chalk:${f.slice(CHALK_SRC.length)}#${name}`] = value;
}
assert.ok(Object.keys(real).filter((k) => k.startsWith("studio:")).length > 20 && Object.keys(real).some((k) => k === "chalk:manage.html"), "the scan reads Studio and Chalk");

const alpha = (v) => { const m = /rgb\(0 0 0 \/ (\d+(?:\.\d+)?)%\)/.exec(v); return m ? Number(m[1]) / 100 : NaN; };
const geometry = (v) => v.replace(/rgb\([^)]*\)/, "").trim();
/** Split a box-shadow value into layers at top-level commas. */
const layers = (v) => { const out = []; let d = 0, cur = ""; for (const ch of v) { if (ch === "(") d++; if (ch === ")") d--; if (ch === "," && !d) { out.push(cur.trim()); cur = ""; } else cur += ch; } out.push(cur.trim()); return out; };
const inKeyframes = (node) => { for (let p = node.parent; p; p = p.parent) if (p.type === "atrule" && /keyframes$/.test(p.name)) return p.params; return null; };
const media = (node) => { for (let p = node.parent; p; p = p.parent) if (p.type === "atrule" && p.name === "media") return p.params; return ""; };

const CHECKS = {
  "1 the elevation tokens are three named levels with a dark and a light alpha": (files) => {
    const bad = [];
    const prim = new Map();
    postcss.parse(files["studio:designTokens.css"]).walkDecls(/^--ds-p-elevation-/, (d) => prim.set(d.prop.slice("--ds-p-elevation-".length), d.value));
    const levels = new Set([...prim.keys()].map((k) => k.replace(/-(dark|light)$/, "")));
    if ([...levels].sort().join() !== "flat,overlay,raised") bad.push(`elevation levels are ${[...levels].sort().join()} (want flat, raised, overlay)`);
    if (levels.size > 3) bad.push(`${levels.size} elevation levels`);
    if (prim.get("flat") !== "none") bad.push(`flat is ${prim.get("flat")}`);
    for (const level of ["raised", "overlay"]) {
      const dark = prim.get(`${level}-dark`), light = prim.get(`${level}-light`);
      if (!dark || !light) { bad.push(`${level} needs a dark and a light value`); continue; }
      if (!(alpha(dark) >= 0.2)) bad.push(`${level} dark alpha ${alpha(dark)} < .2`);
      if (!(alpha(light) < alpha(dark))) bad.push(`${level} light alpha ${alpha(light)} is not below dark ${alpha(dark)}`);
      if (geometry(dark) !== geometry(light)) bad.push(`${level} geometry differs between themes`);
      if (layers(dark).length !== 1 || /inset/.test(dark)) bad.push(`${level} must be one outer shadow`);
    }
    return bad;
  },
  "2 tokens.css binds dark, light and flat per host theme": (files) => {
    const bad = [];
    const want = [
      [":root", "", "dark"], ["body.vscode-light", "", "light"], [".studio-start", "", "dark"],
      ["body.vscode-high-contrast", "", "flat"], ["body.vscode-high-contrast .studio-start", "", "flat"],
      ["body", "forced-colors: active", "flat"], [".studio-start", "forced-colors: active", "flat"],
    ];
    const got = [];
    postcss.parse(files["studio:tokens.css"]).walkDecls(/^--hp-elevation-(raised|overlay)$/, (d) => {
      for (const sel of d.parent.selectors.map((s) => s.trim())) got.push([sel, media(d), d.prop, d.value]);
    });
    for (const [sel, m, theme] of want) for (const level of ["raised", "overlay"]) {
      const value = theme === "flat" ? "var(--ds-c-elevation-flat)" : `var(--ds-c-elevation-${level}-${theme})`;
      if (!got.some(([s, gm, p, v]) => s === sel && gm.includes(m) && (m || !gm) && p === `--hp-elevation-${level}` && v === value)) bad.push(`${sel}${m ? ` @media (${m})` : ""} must bind --hp-elevation-${level} to ${value}`);
    }
    return bad;
  },
  "3 every outer shadow is none, inset or a named level": (files) => {
    const bad = [];
    let seen = 0;
    for (const [file, css] of Object.entries(files)) {
      if (TOKEN_FILES.some((t) => file === "studio:" + t)) continue;
      const chalk = file.startsWith("chalk:");
      postcss.parse(css).walkDecls(/^box-shadow$/i, (d) => {
        const v = d.value.replace(/\s*!important$/, "").trim();
        if (/^none$/i.test(v)) return;
        if (layers(v).every((l) => /^inset\b/.test(l))) return;
        seen++;
        const ok = chalk ? /^var\(--ds-c-elevation-(?:(?:raised|overlay)-dark|flat)\)$/.test(v) : /^var\(--hp-elevation-(?:raised|overlay)\)$/.test(v);
        if (ok) return;
        if (file === "studio:styles.css" && inKeyframes(d) === "hps-breathe") return; // pending glow, not depth
        bad.push(`${file}: ${d.parent.selector ?? inKeyframes(d)} box-shadow: ${v}`);
      });
    }
    if (seen < 10) bad.push(`only ${seen} outer shadows seen: the scan is not reading the stylesheets`);
    return bad;
  },
  "4 every Studio surface that asks for a level gets a 1px border colour in high contrast": (files) => {
    const bad = [];
    for (const [file, css] of Object.entries(files)) {
      if (!file.startsWith("studio:") || TOKEN_FILES.some((t) => file === "studio:" + t)) continue;
      const hc = [];
      const elevated = [];
      postcss.parse(css).walkRules((r) => {
        const decls = r.nodes?.filter((n) => n.type === "decl") ?? [];
        if (/^body\.vscode-high-contrast\b/.test(r.selector) && decls.some((d) => d.prop === "border-color")) hc.push(r.selector);
        // A control (field, button) keeps its fixed control boundary in every theme (CGP-DS-R-005); that 1px
        // border is already the high-contrast edge, so it needs no override.
        const control = decls.some((d) => /^border(-color)?$/.test(d.prop) && /solid var\(--hp-border-control-default\)$/.test(d.value)) && /\.hps-input$|button$/.test(r.selector);
        if (!control && decls.some((d) => d.prop === "box-shadow" && /var\(--hp-elevation-(raised|overlay)\)/.test(d.value))) elevated.push(...r.selectors.map((s) => s.trim()));
      });
      for (const sel of elevated) if (!hc.some((h) => h.replace(/^body\.vscode-high-contrast\s+/, "").replace(/^:is\(|\)$/g, "").split(/\s*,\s*/).includes(sel))) bad.push(`${file}: ${sel} has no body.vscode-high-contrast border-color rule`);
    }
    return bad;
  },
};

let passed = 0;
const failures = [];
for (const [name, check] of Object.entries(CHECKS)) {
  const bad = check(real);
  if (bad.length) { failures.push(name); console.log(`  FAIL ${name}:\n      ${bad.join("\n      ")}`); } else { passed++; console.log(`  ok   ${name}`); }
}

// Negative controls: each mutation is a regression this smoke must catch.
const mutate = (file, from, to) => (files) => {
  assert.ok(files[file]?.includes(from), `negative control anchor missing in ${file}: ${from.slice(0, 60)}`);
  return { ...files, [file]: files[file].replace(from, to) };
};
const NEGATIVE = [
  ["1", "dark alpha below .2", mutate("studio:designTokens.css", "--ds-p-elevation-overlay-dark: 0 4px 8px -2px rgb(0 0 0 / 30%);", "--ds-p-elevation-overlay-dark: 0 4px 8px -2px rgb(0 0 0 / 10%);")],
  ["1", "a fourth level", mutate("studio:designTokens.css", "--ds-p-elevation-flat: none;", "--ds-p-elevation-flat: none;\n  --ds-p-elevation-modal-dark: 0 12px 48px rgb(0 0 0 / 50%);")],
  ["1", "light no lighter than dark", mutate("studio:designTokens.css", "--ds-p-elevation-raised-light: 0 1px 2px rgb(0 0 0 / 10%);", "--ds-p-elevation-raised-light: 0 1px 2px rgb(0 0 0 / 30%);")],
  ["2", "light theme left on the dark alpha", mutate("studio:tokens.css", "body.vscode-light { --hp-elevation-raised: var(--ds-c-elevation-raised-light);", "body.vscode-light { --hp-elevation-raised: var(--ds-c-elevation-raised-dark);")],
  ["2", "high contrast keeps shadows", mutate("studio:tokens.css", "body.vscode-high-contrast, body.vscode-high-contrast .studio-start, body.vscode-high-contrast .studio-disconnected { --hp-elevation-raised: var(--ds-c-elevation-flat);", "body.vscode-high-contrast, body.vscode-high-contrast .studio-start, body.vscode-high-contrast .studio-disconnected { --hp-elevation-raised: var(--ds-c-elevation-raised-dark);")],
  ["3", "a raw shadow on the tools menu", mutate("studio:chatDetails.css", "box-shadow: var(--hp-elevation-overlay); animation: chat-feedback", "box-shadow: 0 8px 32px var(--ds-c-studio-chatdetails-shadow-5); animation: chat-feedback")],
  ["3", "Chalk menu back on its own shadow", mutate("chalk:manage.html", ".menu-body{position:absolute", ".menu-body{box-shadow:0 8px 24px var(--ds-c-chalk-manage-shadow-24);position:absolute")],
  ["4", "the menu panel loses its high-contrast border", mutate("studio:taskWorkspace.css", "body.vscode-high-contrast :is(.tw-sources, .tw-chat-menu-panel)", "body.vscode-high-contrast :is(.tw-sources)")],
];
for (const [id, label, fn] of NEGATIVE) {
  const name = Object.keys(CHECKS).find((k) => k.startsWith(id + " "));
  const bad = CHECKS[name](fn(real));
  if (bad.length) { passed++; console.log(`  ok   negative control: ${label} -> ${bad.length} fails (${bad[0].slice(0, 110)})`); }
  else { failures.push(`negative control ${label}`); console.log(`  FAIL negative control: ${label} was not caught`); }
}
console.log(`elevation-levels: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
