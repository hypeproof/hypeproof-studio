// CGP-DS-D-028 (DES-CGP-DS-42, CGP-DS-R-034) — the text contrast table of every Chalk page, measured in
// real Chromium. Chalk's page CSS layers a dark palette over an older light one, so which colour a text
// actually gets is decided by the cascade; this audit reads it back from the browser instead of
// guessing it from the stylesheet.
//
// Every page is served as the Worker serves it (withDesignTokens, and the board/manage CSS modules
// spliced in), at 1280 and 390 px. Hidden blocks are revealed and every <details> is opened, so the
// help text, empty states and later steps are measured too. For every visible element that has its own
// text, every field with a value, every empty field's placeholder and every ::before/::after string,
// the text colour (faded by the opacity of the element and its ancestors) is composited over the
// element's background, which is every ancestor background composited over the page canvas. Text below 4.5:1 fails; inactive
// controls are exempt (WCAG 1.4.3). A background image on the element or an ancestor cannot be
// measured as one colour, so it is listed as a finding instead of being skipped silently.
//
// Controls run first in the same browser (verification rule 2): the forest muted text #ACB9A5 on
// #151D19 (8.4:1) must pass, a ChatGPT-style 3.2:1 tertiary must be caught, translucent backgrounds
// and faded groups must composite, an empty field must be measured by its placeholder, generated
// ::before text must be measured, and a disabled control must be exempt.
//
// The table (every measured text, its colours and ratio) is written as Markdown to
// CHALK_CONTRAST_REPORT (default: <tmpdir>/chalk-contrast/report.md), also when the audit fails.
// Run: npm run test:chalk-contrast   (from e2e/); also part of chalk `npm test`.
// Browser: extensions/hypeproof-chat/test/lib/headless-chromium.mjs (NOT RUN without one; FOCUS_REQUIRE_BROWSER=1 fails).
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChromium, launch } from '../extensions/hypeproof-chat/test/lib/headless-chromium.mjs';
import { withDesignTokens } from '../chalk/src/lib/design-tokens.ts';
import { renderBoardStatusPage } from '../chalk/src/lib/board-status.ts';
import { renderSafetySignal } from '../chalk/src/lib/safety-signal.ts';

// Browser contract (verification rule 7): the shared headless helper, no window, no OS input. Without a
// headless Chromium this prints NOT RUN; FOCUS_REQUIRE_BROWSER=1 (CI) makes that a failure.
const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('chalk-contrast-audit: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('chalk-contrast-audit NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)');
  process.exit(0);
}

const MIN = 4.5;
const WIDTHS = [1280, 390];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// CHALK_UI_DIR points the audit at a copy of chalk/src/ui (mutation checks); default: the real pages.
const UI = process.env.CHALK_UI_DIR || path.join(root, 'chalk/src/ui');
const reportPath = process.env.CHALK_CONTRAST_REPORT || path.join(os.tmpdir(), 'chalk-contrast', 'report.md');
// The routes in chalk/src/index.ts that splice a CSS module into the page.
const SERVED = { 'board.html': renderBoardStatusPage, 'manage.html': (h) => renderSafetySignal(renderBoardStatusPage(h)) };
const files = (await readdir(UI)).filter((f) => f.endsWith('.html')).sort();
if (files.length < 9) throw new Error(`only ${files.length} Chalk pages found in ${UI}`);
const pages = {};
for (const f of files) pages[f] = withDesignTokens((SERVED[f] ?? ((h) => h))(await readFile(path.join(UI, f), 'utf8')));

// Controls: [name, html, expectation]. Each page body is one fixture.
const CONTROLS = [
  ['forest muted passes', '<body style="margin:0;background:#151D19"><p id="t" style="color:#ACB9A5">조용한 안내</p></body>', (rows) => rows.length === 1 && Math.abs(rows[0].ratio - 8.38) < 0.05 && rows[0].ratio >= MIN],
  ['3.2:1 tertiary is caught', '<body style="margin:0;background:#151D19"><p id="t" style="color:#616E65">흐린 안내</p></body>', (rows) => rows.length === 1 && rows[0].ratio < MIN && Math.abs(rows[0].ratio - 3.21) < 0.05],
  ['translucent surfaces composite', '<body style="margin:0;background:#151D19"><div style="background:rgba(242,244,232,.5)"><p id="t" style="color:#ACB9A5">겹친 면</p></div></body>', (rows) => rows.length === 1 && rows[0].bg === 'rgb(132,137,129)' && rows[0].ratio < MIN],
  ['inactive controls are exempt', '<body style="margin:0;background:#151D19"><button disabled style="color:#616E65;background:#151D19">비활성</button></body>', (rows) => rows.length === 1 && rows[0].disabled],
  ['a faded group fades its text', '<body style="margin:0;background:#151D19"><div style="opacity:.5"><p id="t" style="color:#ACB9A5">반투명</p></div></body>', (rows) => rows.length === 1 && rows[0].ratio < MIN && rows[0].ratio > 2],
  ['an empty field is measured by its placeholder', '<body style="margin:0;background:#151D19"><input placeholder="이름" style="background:#1D2630;color:#F2F4E8"></body>', (rows) => rows.length === 1 && rows[0].sel.endsWith('::placeholder') && rows[0].ratio < MIN],
  ['generated text is measured, empty content is not', '<body style="margin:0;background:#151D19"><style>.g::before{content:"! ";color:#616E65}.e::before{content:"";color:#000}</style><p class="g" style="color:#ACB9A5">경고</p><p class="e" style="color:#ACB9A5">빈 내용</p></body>', (rows) => rows.length === 3 && rows.filter((r) => r.sel.endsWith('::before')).length === 1 && rows.find((r) => r.sel.endsWith('::before')).ratio < MIN],
  ['a background image is reported, not guessed', '<body style="margin:0;background:#151D19"><p style="color:#ACB9A5;background-image:linear-gradient(#000,#fff)">그라데이션</p></body>', (rows) => rows.length === 1 && rows[0].image],
];

/** Runs in the page: every visible own-text element with its composited colours. */
function measurePage() {
  const parse = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c);
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const over = (top, under) => top.slice(0, 3).map((v, i) => v * top[3] + under[i] * (1 - top[3])).concat(1);
  const lin = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  // The canvas: the root background, or the body's when the root has none (CSS background propagation).
  const rootBg = parse(getComputedStyle(document.documentElement).backgroundColor);
  const bodyBg = parse(getComputedStyle(document.body).backgroundColor);
  const canvas = rootBg && rootBg[3] > 0 ? over(rootBg, [255, 255, 255, 1]) : bodyBg && bodyBg[3] > 0 ? over(bodyBg, [255, 255, 255, 1]) : [255, 255, 255, 1];
  const rows = [];
  // A visible string in generated content: quoted text that is not empty or only an alternative-text marker.
  const generated = (content) => { const m = /^"((?:[^"\\]|\\.)*)"/.exec(content || ''); return m && m[1].trim() ? m[1].trim() : null; };
  for (const el of document.body.querySelectorAll('*')) {
    if (['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'svg', 'SVG'].includes(el.tagName) || el.closest('svg')) continue;
    const isField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) && !['hidden', 'checkbox', 'radio', 'range', 'color', 'file'].includes(el.type);
    const value = isField && String(el.value ?? '').trim();
    const placeholder = isField && !value && el.tagName !== 'SELECT' && (el.getAttribute('placeholder') || '').trim();
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    if (!r.width || !r.height || s.visibility !== 'visible') continue;
    // Ancestors from the root down; the root and body backgrounds are already the canvas. Opacity
    // multiplies down the chain: a faded group fades its text toward what lies under the group.
    const chain = [];
    for (let e = el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) chain.unshift(e);
    let bg = canvas, image = false, alpha = 1;
    for (const e of chain) {
      const cs = getComputedStyle(e);
      alpha *= Number(cs.opacity);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') image = true;
      const c = parse(cs.backgroundColor);
      if (c && c[3] > 0) bg = over(c, bg);
    }
    if (alpha === 0) continue;
    const sel = el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + (el.classList.length ? `.${[...el.classList].join('.')}` : '');
    const disabled = !!el.closest(':disabled, [aria-disabled="true"]');
    const add = (part, color, text) => {
      const c = parse(color);
      const fg = over([c[0], c[1], c[2], c[3] * alpha], bg);
      rows.push({ sel: sel + part, text: text.replace(/\s+/g, ' ').slice(0, 24), fg: color + (alpha < 1 ? ` ×${alpha.toFixed(2)}` : ''), bg: `rgb(${bg.slice(0, 3).map(Math.round).join(',')})`, ratio: ratio(fg, bg), disabled, image, size: s.fontSize });
    };
    if (ownText || value) add('', s.color, value || el.textContent.trim());
    if (placeholder) { const ps = getComputedStyle(el, '::placeholder'); const c = parse(ps.color); add('::placeholder', `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${c[3] * Number(ps.opacity || 1)})`, placeholder); }
    for (const pseudo of ['::before', '::after']) {
      const ps = getComputedStyle(el, pseudo), text = generated(ps.content);
      if (text && ps.display !== 'none' && ps.visibility === 'visible' && Number(ps.opacity) > 0) add(pseudo, ps.color, text);
    }
  }
  return rows;
}

const routes = { ...pages, ...Object.fromEntries(CONTROLS.map(([, html], i) => [`control-${i}.html`, `<!doctype html><meta charset="utf-8">${html}`])) };
const server = createServer((req, res) => {
  const f = decodeURIComponent(req.url.slice(1).split('?')[0]);
  if (routes[f]) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(routes[f]); }
  // Every API call a page makes gets an empty failure: pages render their signed-out state.
  else { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const findings = [], table = [], summary = [];
try {
  // One browser per document: the helper's target runs a document's scripts once.
  const visit = async (file, width) => {
    const b = await launch(bin);
    try {
      await b.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
      await b.send('Page.navigate', { url: base + file });
      for (let i = 0; i < 100 && (await b.evaluate('document.readyState')) !== 'complete'; i++) await new Promise((r) => setTimeout(r, 50));
      await new Promise((r) => setTimeout(r, 150));
      await b.evaluate(`document.querySelectorAll('[hidden]').forEach((e) => e.removeAttribute('hidden')); document.querySelectorAll('details').forEach((d) => { d.open = true; }); 0`);
      return await b.evaluate(`(${measurePage.toString()})()`);
    } finally { await b.close(); }
  };
  for (const [i, [name, , expect]] of CONTROLS.entries()) {
    const rows = await visit(`control-${i}.html`, 800);
    if (!expect(rows)) throw new Error(`control "${name}" did not hold: ${JSON.stringify(rows)}`);
    console.log(`  ok   control: ${name}`);
  }
  for (const f of files) {
    for (const width of WIDTHS) {
      const rows = await visit(f, width);
      if (!rows.length) findings.push(`${f} @${width}: no text measured (the page did not render)`);
      let lowest = null;
      for (const r of rows) {
        table.push({ page: f, width, ...r });
        if (r.disabled) continue;
        if (r.image) { findings.push(`${f} @${width}: ${r.sel} "${r.text}" sits on a background image; measure it by hand or give it a flat surface`); continue; }
        if (!lowest || r.ratio < lowest.ratio) lowest = r;
        if (r.ratio < MIN) findings.push(`${f} @${width}: ${r.sel} "${r.text}" ${r.fg} on ${r.bg} is ${r.ratio.toFixed(2)}:1 < ${MIN}:1`);
      }
      summary.push(`${f.padEnd(15)} @${String(width).padEnd(4)} ${String(rows.length).padStart(4)} texts, lowest ${lowest ? `${lowest.ratio.toFixed(2)}:1 (${lowest.sel} ${lowest.fg} on ${lowest.bg})` : 'n/a'}`);
    }
  }
} finally {
  server.close();
}

await mkdir(path.dirname(reportPath), { recursive: true });
const md = [
  '# Chalk text contrast table (CGP-DS-D-028)', '',
  `Pages: ${files.length} · widths: ${WIDTHS.join(', ')} px · floor ${MIN}:1 · findings: ${findings.length}`, '',
  ...(findings.length ? ['## Findings', '', ...findings.map((f) => `- ${f}`), ''] : []),
  '## Table', '', '| Page | Width | Element | Text | Colour | Background | Ratio |', '|---|---|---|---|---|---|---|',
  ...table.map((r) => `| ${r.page} | ${r.width} | \`${r.sel.replace(/\|/g, '\\|')}\` | ${r.text.replace(/\|/g, '\\|')} | ${r.fg} | ${r.bg} | ${r.ratio.toFixed(2)}:1${r.disabled ? ' (inactive)' : ''} |`),
];
await writeFile(reportPath, md.join('\n') + '\n');
for (const s of summary) console.log(`    ${s}`);
console.log(`  table: ${table.length} rows -> ${reportPath}`);
if (findings.length) {
  console.error(`  FAIL ${findings.length} finding(s):\n    - ${findings.join('\n    - ')}`);
  process.exit(1);
}
console.log(`chalk-contrast-audit: ${files.length} pages, ${table.length} texts, 0 below ${MIN}:1`);
