#!/usr/bin/env node
// CGP-DS-R-026 (REQ-STUDIO-LOGICAL-CSS): new component CSS uses logical properties.
// CGP-DS-D-023 (DES-CGP-DS-29) widens the list to `text-align: left/right` and to the four-value
// margin/padding/inset shorthands whose left and right sides differ.
//
// Ratchet lint. It finds every physical inline-axis declaration (margin-left/right,
// padding-left/right, left, right, text-align: left/right, asymmetric four-value margin,
// padding and inset) in the component CSS of the Studio webview and Chalk, and
// compares the result with config/logical-css-baseline.json, which grandfathers the
// declarations that shipped before the rule. A declaration is identified by its file,
// property and normalised value, counted per file. The lint fails when:
//   - a file has more occurrences of a (property, value) pair than the baseline allows
//     (a new physical declaration, or a grandfathered one copied);
//   - the baseline lists an occurrence that no longer exists (stale slack that a later
//     change could silently reuse): run `node scripts/logical-css-lint.mjs --update`.
// A physical declaration that is physical on purpose carries `logical-css: physical <reason>`
// in a comment on the same line; the reason is required.
//
// Usage:
//   node scripts/logical-css-lint.mjs            check (exit 1 on findings)
//   node scripts/logical-css-lint.mjs --update   rewrite the baseline from the tree (only
//                                                shrinks it unless --allow-grow is passed)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PHYSICAL_PROPERTIES = Object.freeze([
  'margin-left', 'margin-right', 'padding-left', 'padding-right', 'left', 'right',
]);
const PHYSICAL = new Set(PHYSICAL_PROPERTIES);
// Shorthands that are physical only for some values (CGP-DS-D-023).
export const SHORTHAND_PROPERTIES = Object.freeze(['margin', 'padding', 'inset']);
const SHORTHAND = new Set(SHORTHAND_PROPERTIES);
const CAMEL = Object.freeze({
  marginLeft: 'margin-left', marginRight: 'margin-right',
  paddingLeft: 'padding-left', paddingRight: 'padding-right',
  left: 'left', right: 'right',
  textAlign: 'text-align', margin: 'margin', padding: 'padding', inset: 'inset',
});
export const LOGICAL_HINT = Object.freeze({
  'margin-left': 'margin-inline-start', 'margin-right': 'margin-inline-end',
  'padding-left': 'padding-inline-start', 'padding-right': 'padding-inline-end',
  left: 'inset-inline-start', right: 'inset-inline-end',
});

// Top-level whitespace split, so `calc(a + b)` and `var(--x, 0 4px)` stay one component.
function components(value) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && /\s/.test(ch)) { if (cur) parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
}
// The value as CSS sees it: TSX values keep their quotes in the key, so strip them here, and drop
// a trailing !important.
const bareValue = (value) => value.replace(/^(['"`])(.*)\1$/s, '$2').replace(/\s*!\s*important\s*$/, '').trim();

// Is this declaration a physical inline-axis one?
export function isPhysical(d) {
  if (PHYSICAL.has(d.prop)) return true;
  const v = bareValue(d.value);
  if (d.prop === 'text-align') return /^(left|right)$/.test(v);
  if (SHORTHAND.has(d.prop)) {
    const c = components(v);
    return c.length === 4 && c[1] !== c[3];
  }
  return false;
}

// The logical replacement to name in a finding.
export function hintFor(key) {
  const colon = key.indexOf(':');
  const prop = key.slice(0, colon);
  const v = bareValue(key.slice(colon + 1).trim());
  if (prop === 'text-align') return v === 'right' ? 'text-align: end' : 'text-align: start';
  if (SHORTHAND.has(prop)) return prop === 'inset'
    ? 'inset-block plus inset-inline-start/end'
    : `${prop}-block plus ${prop}-inline-start/end (or ${prop}-inline)`;
  return LOGICAL_HINT[prop];
}

// The reason must be words (at least three characters before the comment closes).
const EXEMPT = /logical-css:\s*physical\s+[\p{L}\p{N}][^*\n]{2,}/u;

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE_PATH = path.join(REPO_ROOT, 'config', 'logical-css-baseline.json');

// Component CSS roots. Vendored CSS (webview-ui/styles: KaTeX) and the generated Chalk token
// transport (chalk/src/lib/design-tokens.ts, a copy of the webview token sources) are not
// authored component CSS and are left out. JS that positions an element from measured
// viewport rects (`el.style.left = x + 'px'`) is geometry, not authored CSS, and is out too.
const ROOTS = Object.freeze([
  { dir: 'extensions/hypeproof-chat/webview-ui/src', exts: ['.css', '.tsx'] },
  { dir: 'chalk/src', exts: ['.css', '.html', '.ts'] },
]);
const SKIP = new Set(['chalk/src/lib/design-tokens.ts']);

export function listComponentFiles(root = REPO_ROOT) {
  const out = [];
  const walk = (rel, exts) => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(child, exts); continue; }
      if (exts.includes(path.extname(entry.name)) && !SKIP.has(child)) out.push(child);
    }
  };
  for (const { dir, exts } of ROOTS) walk(dir, exts);
  return out.sort();
}

const lineAt = (text, index) => {
  let n = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
};
const normValue = (value) => value.replace(/\s+/g, ' ').trim().toLowerCase();

// Replace comments with spaces (keeping newlines) so offsets and line numbers still match.
function blankComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

// Declarations of a CSS text: split on { } ; and keep the chunks that end a declaration
// (ended by ; or }), never a selector or at-rule prelude (ended by {). `offset` and `source`
// map positions back to the file the CSS came from.
export function cssDeclarations(css, { offset = 0, source = css } = {}) {
  const text = blankComments(css);
  const found = [];
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    const ch = i < text.length ? text[i] : '}';
    if (ch !== '{' && ch !== '}' && ch !== ';') continue;
    const chunk = text.slice(start, i);
    if (ch !== '{') {
      const colon = chunk.indexOf(':');
      if (colon > 0) {
        const prop = chunk.slice(0, colon).trim().toLowerCase();
        if (/^[a-z-]+$/.test(prop)) {
          const lead = chunk.length - chunk.trimStart().length;
          const at = offset + start + lead;
          found.push({ prop, value: normValue(chunk.slice(colon + 1)), index: at, line: lineAt(source, at) });
        }
      }
    }
    start = i + 1;
  }
  return found;
}

// CSS carried by a file of each kind.
export function extractDeclarations(rel, text) {
  const ext = path.extname(rel);
  if (ext === '.css') return cssDeclarations(text);
  const out = [];
  if (ext === '.html') {
    for (const m of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
      out.push(...cssDeclarations(m[1], { offset: m.index + m[0].indexOf(m[1]), source: text }));
    }
    for (const m of text.matchAll(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
      const body = m[2] ?? m[3];
      out.push(...cssDeclarations(body, { offset: m.index + m[0].indexOf(body), source: text }));
    }
    return out;
  }
  if (ext === '.ts') {
    // Chalk keeps page CSS in exported template literals (`export const fooCss = \`…\``).
    for (const m of text.matchAll(/export\s+const\s+\w*(?:Css|CSS|_CSS)\s*=\s*`([\s\S]*?)`/g)) {
      out.push(...cssDeclarations(m[1], { offset: m.index + m[0].indexOf(m[1]), source: text }));
    }
    return out;
  }
  if (ext === '.tsx') {
    // React inline style objects: style={{ marginLeft: 4, 'margin-left': … }}.
    for (const m of text.matchAll(/style=\{\{([\s\S]*?)\}\}/g)) {
      const body = m[1];
      const base = m.index + m[0].indexOf(body);
      for (const k of body.matchAll(/(^|[\s,{])(['"]?)([A-Za-z-]+)\2\s*:\s*([^,]*)/g)) {
        const key = k[3];
        const prop = CAMEL[key] ?? (PHYSICAL.has(key) || SHORTHAND.has(key) || key === 'text-align' ? key : null);
        if (!prop) continue;
        const at = base + k.index + k[1].length;
        out.push({ prop, value: normValue(k[4]), index: at, line: lineAt(text, at) });
      }
    }
    return out;
  }
  return out;
}

export function physicalDeclarations(rel, text) {
  const lines = text.split('\n');
  return extractDeclarations(rel, text)
    .filter(isPhysical)
    .map((d) => ({ ...d, file: rel, exempt: EXEMPT.test(lines[d.line - 1] ?? '') }));
}

export const keyOf = (d) => `${d.prop}: ${d.value}`;

// { file: { "prop: value": count } } for the non-exempt physical declarations.
export function tally(files, read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')) {
  const counts = {};
  const where = {};
  for (const rel of files) {
    for (const d of physicalDeclarations(rel, read(rel))) {
      if (d.exempt) continue;
      const key = keyOf(d);
      ((counts[rel] ??= {})[key] = (counts[rel][key] ?? 0) + 1);
      ((where[rel] ??= {})[key] ??= []).push(d.line);
    }
  }
  return { counts, where };
}

export function compare(counts, baseline, where = {}) {
  const added = [];
  const stale = [];
  const files = new Set([...Object.keys(counts), ...Object.keys(baseline)]);
  for (const file of [...files].sort()) {
    const now = counts[file] ?? {};
    const was = baseline[file] ?? {};
    for (const key of new Set([...Object.keys(now), ...Object.keys(was)])) {
      const n = now[key] ?? 0;
      const b = was[key] ?? 0;
      if (n > b) added.push({ file, key, extra: n - b, lines: where[file]?.[key] ?? [] });
      else if (n < b) stale.push({ file, key, missing: b - n });
    }
  }
  return { added, stale };
}

export function readBaseline(file = BASELINE_PATH) {
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  return json.files ?? {};
}

function sortCounts(counts) {
  const out = {};
  for (const file of Object.keys(counts).sort()) {
    out[file] = {};
    for (const key of Object.keys(counts[file]).sort()) out[file][key] = counts[file][key];
  }
  return out;
}

function main(argv) {
  const files = listComponentFiles();
  const { counts, where } = tally(files);
  const baseline = readBaseline();
  const { added, stale } = compare(counts, baseline, where);
  if (argv.includes('--update')) {
    if (added.length && !argv.includes('--allow-grow')) {
      console.error('logical-css: refusing to grow the baseline; convert these to logical properties:');
      for (const a of added) console.error(`  ${a.file}:${a.lines.join(',')}  ${a.key}`);
      return 1;
    }
    const doc = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
    doc.files = sortCounts(counts);
    fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(doc, null, 2)}\n`);
    console.log(`logical-css: baseline rewritten (${Object.values(counts).reduce((s, c) => s + Object.values(c).reduce((a, b) => a + b, 0), 0)} grandfathered declarations)`);
    return 0;
  }
  for (const a of added) {
    console.error(`logical-css: ${a.file}:${a.lines.join(',')} new physical "${a.key}" (+${a.extra}); use ${hintFor(a.key)}`);
  }
  for (const s of stale) {
    console.error(`logical-css: ${s.file} baseline lists "${s.key}" ${s.missing} more time(s) than the file has; run node scripts/logical-css-lint.mjs --update`);
  }
  if (added.length || stale.length) return 1;
  console.log(`logical-css: ok (${files.length} files, 0 new physical declarations)`);
  return 0;
}

const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
