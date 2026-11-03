// CGP-DS-D-025 / DES-CGP-DS-31: Korean reading rules measured on the CASCADE in headless Chromium.
//   node --experimental-strip-types test/korean-prose-computed.smoke.mjs
//
// Studio: the webview stylesheets in the exact order main.tsx imports them, on the shipped markup classes.
// Chalk: every real chalk/src/ui page through withDesignTokens (the production injection order, the
// page's own <style> after the shared one). Light and dark, 320 and 800 px. For each surface a probe block
// (heading of 40 Hangul syllables, a 120-char URL, a 70-syllable unbroken word, English text, pre, code) and
// every real prose element already on the page are read: computed word-break / overflow-wrap / line-break /
// text-wrap, real line geometry (no eojeol split, text stays inside the box and the viewport width), and
// white-space on pre. Widths are measured against document.documentElement.clientWidth (a Linux runner
// draws a 15px classic scrollbar). Self-test: the matrix is rerun with injected overrides (a later
// higher-specificity rule, an @media !important rule, a lower-priority rule that must stay harmless); each
// breaking one must be caught. Without a headless Chromium this prints NOT RUN; FOCUS_REQUIRE_BROWSER=1
// (set by CI) makes that a failure. The declaration-only guard stays in korean-prose.smoke.mjs.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('korean-prose-computed: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('korean-prose-computed NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)');
  process.exit(0);
}
const { withDesignTokens } = await import('../../../chalk/src/lib/design-tokens.ts');

const SRC = new URL('../webview-ui/src/', import.meta.url);
const UI = new URL('../../../chalk/src/ui/', import.meta.url);
const main = readFileSync(new URL('main.tsx', SRC), 'utf8');
const order = [...main.matchAll(/import "\.\/([\w.-]+\.css)"/g)].map((m) => m[1]);
assert.ok(order.includes('koreanProse.css'), 'main.tsx imports koreanProse.css');
const studioCss = order.map((f) => readFileSync(new URL(f, SRC), 'utf8')).join('\n');
assert.match(readFileSync(new URL('../index.html', SRC), 'utf8'), /<html[^>]*\blang="ko"/, 'webview index.html declares lang="ko"');

const heading = Array(8).fill('우리들의꿈').join(' '); // 40 Hangul syllables, eight 5-syllable eojeol
const url = 'https://example.com/' + 'a'.repeat(100); // 120 characters
assert.equal(url.length, 120);
const word = '가'.repeat(70);
const probe = (tag) => `<div id="zzp" lang="ko" style="position:absolute;left:0;top:0;width:280px;z-index:99;background:#fff;font:16px/1.6 sans-serif;margin:0;padding:0;"><${tag} id="zzh">${heading}</${tag}><p id="zzu">${url}</p><p id="zzlw">${word}</p><p id="zzen" lang="en">english words wrap normally here ok</p><div class="hps-msg-body" id="zzmb">${word} ${url}</div><div class="hps-error-banner-msg" id="zzeb">${word}</div><ul><li id="zzli">${url} ${word}</li></ul><blockquote id="zzbq">${word}</blockquote><pre id="zzpre" style="overflow:auto">const a = 1;\n    indented   ${'x'.repeat(200)}</pre></div>`;

const studioDoc = (tag, seat, extra) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>${studioCss}</style></head><body style="margin:0"><div class="hps-shell" data-chat-detail="${seat}">${probe(tag)}</div>${extra}</body></html>`;
const chalkPages = readdirSync(UI).filter((f) => f.endsWith('.html')).sort();
assert.ok(chalkPages.length >= 9, `chalk pages found: ${chalkPages}`);
const chalkDoc = (file, extra) => {
  const html = readFileSync(new URL(file, UI), 'utf8');
  assert.match(html, /<html[^>]*\blang="ko"/, `${file} declares lang="ko"`);
  const add = `${probe('h2')}${extra}`; // some pages have no </body>: append at the end, still inside the document
  return withDesignTokens(/<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${add}</body>`) : html + add);
};
const pages = (extra) => [
  ['studio-personal', studioDoc('h2', 'personal', extra)],
  ['studio-classroom', studioDoc('h1', 'classroom', extra)],
  ...chalkPages.map((f) => [`chalk-${f}`, chalkDoc(f, extra)]),
];

const measure = `(() => {
  const cs = (e) => getComputedStyle(e), g = (id) => document.getElementById(id);
  const vw = document.documentElement.clientWidth;
  const box = g('zzp').getBoundingClientRect();
  const rowsOf = (e) => { const r = document.createRange(); r.selectNodeContents(e); return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size; };
  const rightOf = (e) => { const r = document.createRange(); r.selectNodeContents(e); return Math.max(0, ...[...r.getClientRects()].map((x) => x.right)); };
  const read = (e) => ({ wb: cs(e).wordBreak, ow: cs(e).overflowWrap, lb: cs(e).lineBreak, tw: cs(e).textWrap });
  const out = { vw, doc: document.documentElement.scrollWidth, o: {}, over: {}, real: [] };
  for (const id of ['zzh', 'zzu', 'zzlw', 'zzmb', 'zzeb', 'zzli', 'zzbq', 'zzen']) {
    const e = g(id); out.o[id] = read(e);
    out.over[id] = e.scrollWidth > e.clientWidth + 0.5 || rightOf(e) > Math.min(box.right, vw) + 0.5;
  }
  const h = g('zzh'), t = h.firstChild, tops = []; let i = 0;
  for (const w of t.data.split(' ')) { const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + w.length); tops.push(new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size); i += w.length + 1; }
  out.tops = tops; out.rows = rowsOf(h);
  out.pre = cs(g('zzpre')).whiteSpace;
  for (const e of document.querySelectorAll('p, li, blockquote, dd, dt, h1, h2, h3, h4, h5, h6, .hps-msg-body, .hps-prose, .hp-mission-sentence, .hp-mission-acceptance, .hps-error-banner-msg, .hps-stop-notice')) {
    if (g('zzp').contains(e) || !e.closest(':lang(ko)') || !e.textContent.trim() || e.closest('pre, code, script, style, template') || e.getClientRects().length === 0) continue;
    const r = read(e); if (r.wb !== 'keep-all' || r.ow !== 'anywhere' || r.lb !== 'strict') out.real.push((e.id ? '#' + e.id : e.tagName.toLowerCase() + '.' + e.className) + ' ' + JSON.stringify(r));
  }
  return out;
})()`;

const b = await launch(bin);
const run = async (extra) => {
  const bad = [];
  for (const width of [320, 800]) for (const dark of [false, true]) for (const [name, html] of pages(extra)) {
    await b.load(html, { width, height: 800, dark });
    const m = await b.evaluate(measure);
    const tag = `${name}@${width}${dark ? 'd' : 'l'}`, why = [];
    if (!m.tops.every((n) => n === 1)) why.push(`eojeol split ${m.tops}`);
    if (m.rows < 2) why.push('heading did not wrap');
    for (const id of ['zzh', 'zzu', 'zzlw', 'zzmb', 'zzeb', 'zzli', 'zzbq']) {
      const x = m.o[id];
      if (x.wb !== 'keep-all') why.push(`${id} word-break=${x.wb}`);
      if (x.ow !== 'anywhere') why.push(`${id} overflow-wrap=${x.ow}`);
      if (x.lb !== 'strict') why.push(`${id} line-break=${x.lb}`);
      if (m.over[id]) why.push(`${id} overflows`);
    }
    if (m.o.zzh.tw !== 'balance') why.push(`heading text-wrap=${m.o.zzh.tw}`);
    if (m.o.zzu.tw !== 'pretty') why.push(`p text-wrap=${m.o.zzu.tw}`);
    const en = m.o.zzen;
    // Chalk pages set overflow-wrap: anywhere on p themselves (learn, start), so English overflow-wrap is only pinned on Studio.
    if (en.wb !== 'normal' || en.lb !== 'auto' || en.tw !== 'wrap' || (name.startsWith('studio') && en.ow !== 'normal')) why.push(`English changed: ${JSON.stringify(en)}`);
    if (!['pre', 'pre-wrap'].includes(m.pre)) why.push(`pre white-space=${m.pre} (code whitespace must be preserved)`);
    if (name.startsWith('studio') && m.doc > m.vw) why.push(`page scrolls horizontally ${m.doc}>${m.vw}`);
    for (const r of m.real) why.push(`real prose ${r}`);
    if (why.length) bad.push(`${tag}: ${why.join('; ')}`);
  }
  return bad;
};

try {
  const base = await run('');
  assert.deepEqual(base, [], `baseline must be clean:\n${base.join('\n')}`);
  const mutations = [
    ['later higher-specificity override', '<style>.hps-shell[data-chat-detail] .hps-msg-body, body #zzp p, body #zzp ul li, body p { overflow-wrap: normal; word-break: normal }</style>'],
    ['@media !important override', '<style>@media (max-width: 400px) { p, li, h1, h2 { line-break: auto !important } }</style>'],
    ['@media !important keep-all removed at 800', '<style>@media (min-width: 500px) { p, li, h2 { word-break: normal !important } }</style>'],
    ['code-style white-space break', '<style>pre { white-space: normal !important }</style>'],
    ['heading text-wrap reset', '<style>h1, h2 { text-wrap: wrap !important }</style>'],
  ];
  for (const [name, css] of mutations) assert.ok((await run(css)).length > 0, `mutation not caught: ${name}`);
  assert.deepEqual(await run('<style>.zz-unrelated, .hps-unused-class { word-break: normal }</style>'), [], 'a rule matching nothing stays harmless');
  console.log(`korean-prose-computed: PASS (${2 + chalkPages.length} surfaces x 320/800 x light/dark; ${mutations.length} mutations caught)`);
} finally { await b.close(); }
