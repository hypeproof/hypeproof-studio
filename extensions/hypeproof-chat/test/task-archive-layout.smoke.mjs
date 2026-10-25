// CGP-CHAT-R-025 / CGP-CHAT-D-025 (REQ-STUDIO-TASK-ARCHIVE): 보관함 measured on the CASCADE in headless Chromium.
//   node --experimental-strip-types test/task-archive-layout.smoke.mjs
// The real TaskWorkspace (mounted with react-dom in the page) and the shipped stylesheet bundle (focus-geometry
// order). The task list's 보관함 button is pressed with a DOM click inside the page (no OS input), then:
//   - every 보관함 control (보관함, 최근 작업으로 돌아가기, 다시 열기) is a 44px target, width and height
//   - every element that draws text in the rail is at least 14px
//   - nothing in the rail is wider than the rail; no page scroll
//   - 다시 열기 is the quiet neutral button, never a destructive colour (nothing is deleted)
//   - the focus ring, forced through the DevTools protocol, is 2px solid; in forced colours it is Highlight
// Dark and light at 1420 and 800 px, the narrow (360 px) rail dialog, and forced colours. Class seats have no task
// list (no TaskWorkspace), so there is no 보관함 to measure there; test/task-archive-ui.test.tsx proves the menu
// item is absent on class, lesson and instructor seats.
// No Chromium: prints NOT RUN, or fails when FOCUS_REQUIRE_BROWSER=1 (CI sets it).
// HPS_SHOT_DIR=<dir> also saves one PNG per case for a human look.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { findChromium, launch } from './lib/headless-chromium.mjs';
const SRC = fileURLToPath(new URL('../webview-ui/src', import.meta.url));

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('task-archive-layout: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('task-archive-layout: NOT RUN (no headless Chromium; set HEADLESS_CHROMIUM)');
  process.exit(0);
}

const cssFiles = readdirSync(SRC).filter((f) => f.endsWith('.css') && !['tokens.css', 'designTokens.css', 'focusGeometry.css', 'styles.css', 'chatDetails.css'].includes(f)).sort();
const order = ['tokens.css', ...(existsSync(resolve(SRC, 'focusGeometry.css')) ? ['focusGeometry.css'] : []), ...cssFiles, 'styles.css', 'chatDetails.css'];
const cssBundle = await build({
  stdin: { contents: order.map((f) => `@import "./${f}";`).join('\n'), resolveDir: SRC, loader: 'css' },
  bundle: true, write: false, outdir: 'out', logLevel: 'silent',
  plugins: [{ name: 'external', setup(b) { b.onResolve({ filter: /\.(svg|png|jpe?g|gif|webp|woff2?)$/ }, (a) => ({ path: a.path, external: true })); } }],
});
const css = cssBundle.outputFiles.find((o) => o.path.endsWith('.css')).text;
const LONG = '아주 긴 보관한 작업 이름 '.repeat(8) + 'x'.repeat(80);
const view = {
  scope: 's', revision: 3, activeTaskId: 'b', sourceSelection: null,
  tasks: [{ id: 'b', title: '열린 작업', createdAt: 1, updatedAt: 1792800000000, messageCount: 2 }],
  archived: [
    { id: 'a', title: LONG, createdAt: 1, updatedAt: 2, messageCount: 14, archivedAt: 1792700000000 },
    { id: 'c', title: '반 소개 페이지', createdAt: 1, updatedAt: 1, messageCount: 0, archivedAt: 1792600000000 },
  ],
};
const jsBundle = await build({
  stdin: {
    contents: `import React from 'react'; import { createRoot } from 'react-dom/client'; import { TaskWorkspace } from './TaskWorkspace';
createRoot(document.getElementById('root')).render(<TaskWorkspace view={${JSON.stringify(view)}} messages={[]} busy={false} error={null} onDismissError={() => {}}><p>대화 내용</p></TaskWorkspace>);`,
    resolveDir: SRC, loader: 'tsx', sourcefile: 'entry.tsx',
  },
  bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', logLevel: 'silent',
  nodePaths: [resolve(SRC, '../node_modules')], loader: { '.css': 'empty', '.svg': 'dataurl' }, define: { 'process.env.NODE_ENV': '"production"' },
});
const js = jsBundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const THEMES = {
  dark: '--vscode-font-size:13px;--vscode-font-family:-apple-system, "Apple SD Gothic Neo", sans-serif;--vscode-sideBar-background:#181818;--vscode-foreground:#cccccc;--vscode-editor-foreground:#cccccc;--vscode-descriptionForeground:#9d9d9d;--vscode-editor-background:#1f1f1f;--vscode-focusBorder:#0078d4;--vscode-input-background:#313131;--vscode-input-foreground:#cccccc;--vscode-panel-border:#2b2b2b;--vscode-button-background:#0078d4;--vscode-button-foreground:#fff;--vscode-errorForeground:#f85149;',
  light: '--vscode-font-size:13px;--vscode-font-family:-apple-system, "Apple SD Gothic Neo", sans-serif;--vscode-sideBar-background:#f8f8f8;--vscode-foreground:#3b3b3b;--vscode-editor-foreground:#3b3b3b;--vscode-descriptionForeground:#616161;--vscode-editor-background:#ffffff;--vscode-focusBorder:#005fb8;--vscode-input-background:#ffffff;--vscode-input-foreground:#3b3b3b;--vscode-panel-border:#e5e5e5;--vscode-button-background:#005fb8;--vscode-button-foreground:#fff;--vscode-errorForeground:#e51400;',
};
const page = (theme) => `<!doctype html><html lang="ko" style='${THEMES[theme]}'><head><meta charset="utf-8"><style>${css}</style></head><body class="vscode-${theme}" style='${THEMES[theme]}margin:0;background:var(--vscode-sideBar-background);color:var(--vscode-foreground)'><div id="root"></div><script>window.acquireVsCodeApi = () => ({ postMessage() {}, getState() {}, setState() {} });</script><script>${js}</script></body></html>`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const measure = `(() => {
  const rail = document.querySelector('.tw-rail'), rb = rail.getBoundingClientRect();
  const shows = (e) => { for (let n = e; n && n !== document.documentElement; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden') return false; } return e.getClientRects().length > 0; };
  const out = { heading: !!document.querySelector('.tw-archive-heading'), rows: document.querySelectorAll('.tw-archived').length, controls: [], texts: [], overflow: [], doc: [document.documentElement.scrollWidth, document.documentElement.clientWidth] };
  for (const e of rail.querySelectorAll('.tw-archive-back, .tw-reopen')) { const b = e.getBoundingClientRect(); out.controls.push({ name: e.className + ':' + e.textContent, w: b.width, h: b.height }); }
  for (const e of rail.querySelectorAll('*')) {
    if (!shows(e)) continue;
    const b = e.getBoundingClientRect();
    if (b.right > rb.right + 0.5 || b.left < rb.left - 0.5) out.overflow.push(e.localName + '.' + e.className + ' ' + Math.round(b.left) + '..' + Math.round(b.right) + ' outside ' + Math.round(rb.left) + '..' + Math.round(rb.right));
    if ([...e.childNodes].some((n) => n.nodeType === 3 && n.data.trim())) out.texts.push({ name: e.localName + '.' + e.className + ':' + e.textContent.slice(0, 12), size: parseFloat(getComputedStyle(e).fontSize) });
  }
  // A meta line (count, archive date) never breaks inside a word, even in the narrowest rail.
  out.squeezed = [...rail.querySelectorAll('.tw-archived .tw-task-meta > *')].filter((e) => e.getClientRects().length !== 1 || e.getBoundingClientRect().height > parseFloat(getComputedStyle(e).fontSize) * 2).map((e) => e.textContent + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height));
  const look = (sel) => { const s = getComputedStyle(document.querySelector(sel)); return [s.color, s.backgroundColor, s.borderTopColor].join(' / '); };
  out.reopenLook = look('.tw-reopen'); out.backLook = look('.tw-archive-back');
  const probe = document.createElement('i'); probe.style.color = 'var(--vscode-errorForeground)'; document.body.append(probe); out.danger = getComputedStyle(probe).color; probe.remove();
  return JSON.stringify(out);
})()`;

const shotDir = process.env.HPS_SHOT_DIR;
if (shotDir) mkdirSync(shotDir, { recursive: true });
const browser = await launch(bin);
let cases = 0;
async function openArchive(name, width) {
  if (width <= 700) {
    await browser.evaluate(`document.querySelector('.tw-rail-toggle').click()`); await wait(150);
  }
  const listed = await browser.evaluate(`(() => { const t = document.querySelector('.tw-archive-open'); if (!t) return null; const b = t.getBoundingClientRect(); return { w: b.width, h: b.height, text: t.textContent, size: parseFloat(getComputedStyle(t).fontSize) }; })()`);
  assert.ok(listed, `${name}: the task list offers 보관함`);
  assert.equal(listed.text, '보관함 2');
  assert.ok(listed.h >= 44 && listed.w >= 44, `${name}: 보관함 button ${listed.w}x${listed.h}`);
  assert.ok(listed.size >= 14, `${name}: 보관함 text ${listed.size}px`);
  await browser.evaluate(`document.querySelector('.tw-archive-open').click()`); await wait(150);
}
try {
  for (const theme of ['dark', 'light']) for (const width of [1420, 800, 360]) {
    const name = `personal/${theme}/${width}`;
    await browser.load(page(theme), { width, height: 760, dark: theme === 'dark' });
    await wait(200);
    await openArchive(name, width);
    const m = JSON.parse(await browser.evaluate(measure));
    assert.ok(m.heading, `${name}: 보관함 view is shown`);
    assert.equal(m.rows, 2, `${name}: both archived tasks listed`);
    assert.equal(m.controls.length, 3, `${name}: back + two 다시 열기`);
    for (const c of m.controls) assert.ok(c.w >= 44 && c.h >= 44, `${name}: ${c.name} is ${c.w}x${c.h}`);
    for (const t of m.texts) assert.ok(t.size >= 14, `${name}: ${t.name} text ${t.size}px`);
    assert.deepEqual(m.overflow, [], `${name}: rail overflow`);
    assert.deepEqual(m.squeezed, [], `${name}: meta text squeezed into a column`);
    assert.ok(m.doc[0] <= m.doc[1], `${name}: page scrolls sideways ${m.doc[0]} > ${m.doc[1]}`);
    assert.equal(m.reopenLook, m.backLook, `${name}: 다시 열기 is the quiet neutral button`);
    assert.ok(!m.reopenLook.includes(m.danger), `${name}: no destructive colour on 다시 열기`);
    const ring = await browser.focusVisibleStyle('.tw-reopen');
    assert.equal(ring['outline-width'], '2px', `${name}: ring width`);
    assert.equal(ring['outline-style'], 'solid', `${name}: ring style`);
    if (shotDir) {
      const { data } = await browser.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(shotDir, `archive-${theme}-${width}.png`), Buffer.from(data, 'base64'));
    }
    cases++;
  }
  await browser.load(page('dark'), { width: 800, height: 760, forcedColors: true });
  await wait(200);
  await openArchive('forced/800', 800);
  const m = JSON.parse(await browser.evaluate(measure));
  for (const c of m.controls) assert.ok(c.w >= 44 && c.h >= 44, `forced: ${c.name}`);
  const ring = await browser.focusVisibleStyle('.tw-reopen');
  const highlight = await browser.evaluate(`(() => { const e = document.createElement('i'); e.style.color = 'Highlight'; document.body.appendChild(e); const c = getComputedStyle(e).color; e.remove(); return c; })()`);
  assert.equal(ring['outline-color'], highlight, 'forced: ring is Highlight');
  assert.equal(ring['outline-width'], '2px');
  if (shotDir) { const { data } = await browser.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(shotDir, 'archive-forced-800.png'), Buffer.from(data, 'base64')); }
  cases++;
} finally { await browser.close(); }
console.log(`task-archive-layout: ${cases} computed cases (44px, 14px, overflow, neutral colour, ring, forced colours) PASS`);
