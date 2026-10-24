// CGP-DS-D-015 — icon sizes 16 / 20 / 24, 1.5-2 stroke, currentColor, measured in a real browser.
// stroke-icons.smoke.mjs checks declarations and a static render; this one measures what Chromium
// draws: every ChatIcon kind at each size (catalogue), and every icon in the real built webview
// (classroom and personal seats), in dark and light. For each icon:
//   - its box is exactly 16, 20 or 24 px (a CSS rule that shrinks it fails);
//   - every stroked shape strokes in the icon's computed colour and the stroke-width is 1.5-2;
//   - every filled shape (the three dots, the stop square) fills in the computed colour;
//   - the colour follows the theme, so currentColor is not a hard-coded value.
// FOCUS_REQUIRE_BROWSER=1 fails when no browser is found (CI sets it); otherwise it prints NOT RUN.
// HPS_WEBVIEW_SRC points at another webview-ui/src (used to prove mutations on a scratch copy).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const name = 'icon-metrics-computed';
const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error(`${name}: no headless Chromium and FOCUS_REQUIRE_BROWSER=1`); process.exit(1); }
  console.log(`${name} NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)`);
  process.exit(0);
}
const { build } = await import('esbuild');
const extension = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webview = path.join(extension, 'webview-ui');
const src = process.env.HPS_WEBVIEW_SRC ? path.resolve(process.env.HPS_WEBVIEW_SRC) : path.join(webview, 'src');
const temp = mkdtempSync(path.join(tmpdir(), 'hps-icon-metrics-'));
const common = {
  bundle: true, platform: 'browser', jsx: 'automatic', logLevel: 'error',
  nodePaths: [path.join(webview, 'node_modules')], alias: { react: path.join(webview, 'node_modules/react'), 'react-dom': path.join(webview, 'node_modules/react-dom') },
  loader: { '.svg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.png': 'dataurl' },
};
const details = readFileSync(path.join(src, 'ChatDetails.tsx'), 'utf8');
const kinds = [...(/export type IconKind =([^;]+);/.exec(details)?.[1] ?? '').matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
assert.ok(kinds.length >= 50 && kinds.includes('dots'), `IconKind extraction found ${kinds.length} kinds; the instrument is broken`);
writeFileSync(path.join(temp, 'catalogue.tsx'), `
import { createRoot } from 'react-dom/client';
import { ChatIcon } from ${JSON.stringify(path.join(src, 'ChatDetails.tsx'))};
const kinds = ${JSON.stringify(kinds)};
createRoot(document.getElementById('root')!).render(<div>{[16, 20, 24].map((size) => <p key={size} data-size={size}>{kinds.map((k) => <span key={k}><ChatIcon kind={k as any} size={size as any} /></span>)}</p>)}</div>);
`);
await build({ ...common, entryPoints: [path.join(src, 'main.tsx')], outfile: path.join(temp, 'ui.js') });
await build({ ...common, entryPoints: [path.join(temp, 'catalogue.tsx')], outfile: path.join(temp, 'cat.js') });
const server = createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (['/ui.js', '/ui.css', '/cat.js'].includes(u)) { try { const body = readFileSync(path.join(temp, u)); res.setHeader('content-type', u.endsWith('css') ? 'text/css' : 'text/javascript'); res.end(body); } catch { res.statusCode = 404; res.end(); } return; }
  res.setHeader('content-type', 'text/html');
  res.end(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><link rel="stylesheet" href="/ui.css"></head><body><div id="root"></div><script src="${u === '/catalogue' ? '/cat.js' : '/ui.js'}"></script></body></html>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const THEMES = {
  dark: '--vscode-font-size:13px;--vscode-font-family:-apple-system, "Apple SD Gothic Neo", sans-serif;--vscode-sideBar-background:#181818;--vscode-foreground:#cccccc;--vscode-editor-foreground:#cccccc;--vscode-descriptionForeground:#9d9d9d;--vscode-editor-background:#1f1f1f;--vscode-focusBorder:#0078d4;--vscode-input-background:#313131;--vscode-input-foreground:#cccccc;--vscode-panel-border:#2b2b2b;--vscode-button-background:#0078d4;--vscode-button-foreground:#fff;--vscode-quickInput-background:#222222;',
  light: '--vscode-font-size:13px;--vscode-font-family:-apple-system, "Apple SD Gothic Neo", sans-serif;--vscode-sideBar-background:#f8f8f8;--vscode-foreground:#3b3b3b;--vscode-editor-foreground:#3b3b3b;--vscode-descriptionForeground:#616161;--vscode-editor-background:#ffffff;--vscode-focusBorder:#005fb8;--vscode-input-background:#ffffff;--vscode-input-foreground:#3b3b3b;--vscode-panel-border:#e5e5e5;--vscode-button-background:#005fb8;--vscode-button-foreground:#fff;--vscode-quickInput-background:#f8f8f8;',
};
const UX = { coach: { naming_mode: 'fixed', fallback_name: '코치', naming_prompt_md: '', personality_prompt_md: '' }, suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: '' }, roll_input_button: { enabled: false, label: '', probe_md: '' } }, retry_button: { enabled: false, show_counter: false } };
const config = (surface) => ({
  proxyUrl: 'http://controlled.invalid/v1', model: 'sonnet', hasToken: true, coach: { name: '코치', personality: '', configured: true },
  profile: { profile_id: 'synthetic', display_name: '확인', activity_kind: surface, observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: '안녕하세요' }, model_selection: null, ux: UX },
  activity: { id: 'a-' + surface, name: surface === 'classroom' ? '3반 웹페이지 만들기' : '내 작업', kind: surface, workspace: '/synthetic', verified: true },
  ...(surface === 'classroom' ? {} : { taskWorkspace: { scope: 's', revision: 1, activeTaskId: 't1', tasks: [{ id: 't1', title: '반 소개 페이지', createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null } }),
});
const history = [
  { id: 'u1', role: 'user', content: '내 소개 페이지를 만들어 줘', createdAt: 1 },
  { id: 't1', role: 'tool', content: '', createdAt: 2, tool: { icon: '🔍', label: '파일을 살펴보는 중…', state: 'done' } },
  { id: 't2', role: 'tool', content: '', createdAt: 3, tool: { icon: '⚠️', label: '미리보기 열기 실패', state: 'error' } },
  { id: 't3', role: 'tool', content: '', createdAt: 4, tool: { icon: '✏️', label: '파일을 고치는 중…', state: 'running' } },
  { id: 'a1', role: 'assistant', content: '만들었어요.', createdAt: 5 },
];

/** Runs in the page: one record per icon with its box and the computed paint of every shape. */
const MEASURE = `(() => [...document.querySelectorAll('svg[data-icon]')].map((svg) => {
  const r = svg.getBoundingClientRect(), color = getComputedStyle(svg).color;
  const shapes = [...svg.querySelectorAll('path,rect,circle,ellipse,line,polyline,polygon')].map((e) => {
    const s = getComputedStyle(e);
    return { tag: e.tagName, stroke: s.stroke, width: parseFloat(s.strokeWidth), fill: s.fill };
  });
  return { kind: svg.getAttribute('data-icon'), w: r.width, h: r.height, color, shapes, expected: Number(svg.closest('[data-size]')?.getAttribute('data-size') ?? 0) };
}))()`;

/** Throws when an icon is not a 16/20/24 box, or paints outside currentColor / the 1.5-2 stroke. */
export function auditMeasured(icons, where) {
  const problems = [];
  for (const i of icons) {
    const id = `${where} ${i.kind}`;
    if (![16, 20, 24].includes(Math.round(i.w * 100) / 100) || i.w !== i.h) problems.push(`${id}: box ${i.w}x${i.h}, not 16/20/24`);
    if (i.expected && i.w !== i.expected) problems.push(`${id}: asked for ${i.expected}px, drawn ${i.w}px`);
    let painted = 0;
    for (const s of i.shapes) {
      if (s.stroke !== 'none') {
        painted++;
        if (s.stroke !== i.color) problems.push(`${id}: ${s.tag} strokes ${s.stroke}, not currentColor ${i.color}`);
        if (!(s.width >= 1.5 && s.width <= 2)) problems.push(`${id}: ${s.tag} stroke-width ${s.width}px is outside 1.5-2`);
      }
      if (s.fill !== 'none') {
        painted++;
        if (s.fill !== i.color) problems.push(`${id}: ${s.tag} fills ${s.fill}, not currentColor ${i.color}`);
      }
    }
    if (!painted) problems.push(`${id}: nothing is painted`);
  }
  return problems;
}
// Controls for the audit itself: one planted defect each, and a clean icon.
{
  const clean = { kind: 'x', w: 16, h: 16, color: 'rgb(1, 2, 3)', expected: 16, shapes: [{ tag: 'path', stroke: 'rgb(1, 2, 3)', width: 1.7, fill: 'none' }] };
  assert.deepEqual(auditMeasured([clean], 'c'), [], 'positive control: a clean icon passes');
  assert.equal(auditMeasured([{ ...clean, w: 18, h: 18 }], 'c').length, 2, 'negative control: an 18px box fails');
  assert.equal(auditMeasured([{ ...clean, shapes: [{ ...clean.shapes[0], width: 2.6 }] }], 'c').length, 1, 'negative control: a 2.6 stroke fails');
  assert.equal(auditMeasured([{ ...clean, shapes: [{ ...clean.shapes[0], stroke: 'rgb(255, 0, 0)' }] }], 'c').length, 1, 'negative control: a fixed stroke colour fails');
  assert.equal(auditMeasured([{ ...clean, shapes: [{ tag: 'circle', stroke: 'none', width: 0, fill: 'rgb(9, 9, 9)' }] }], 'c').length, 1, 'negative control: a fixed fill fails');
  assert.equal(auditMeasured([{ ...clean, shapes: [{ tag: 'circle', stroke: 'none', width: 0, fill: 'rgb(1, 2, 3)' }] }], 'c').length, 0, 'positive control: a filled dot in currentColor passes without a stroke width');
}

let b;
const colors = {};
try {
  try { b = await launch(bin); } catch (error) {
    if (process.env.FOCUS_REQUIRE_BROWSER) throw error;
    console.log(`${name} NOT RUN: ${error.message}`); process.exit(0);
  }
  let checked = 0;
  for (const theme of ['dark', 'light']) {
    await b.send('Emulation.setDeviceMetricsOverride', { width: 1420, height: 800, deviceScaleFactor: 1, mobile: false });
    const { identifier } = await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.sent=[];window.acquireVsCodeApi=()=>({postMessage:m=>window.sent.push(m),getState:()=>undefined,setState(){}});document.addEventListener('DOMContentLoaded',()=>{document.documentElement.style.cssText=${JSON.stringify(THEMES[theme])};document.body.classList.add('vscode-${theme}');});` });
    try {
      // 1. Catalogue: every ChatIcon kind at 16, 20 and 24.
      await b.send('Page.navigate', { url: base + 'catalogue' });
      for (let i = 0; i < 100 && !(await b.evaluate(`document.querySelectorAll('svg[data-icon]').length`).catch(() => 0)); i++) await new Promise((r) => setTimeout(r, 50));
      const cat = await b.evaluate(MEASURE);
      assert.equal(cat.length, kinds.length * 3, `catalogue drew ${cat.length} icons, expected ${kinds.length * 3}`);
      const catProblems = auditMeasured(cat, `catalogue ${theme}`);
      assert.deepEqual(catProblems, [], catProblems.join('\n'));
      const dots = cat.filter((i) => i.kind === 'dots');
      assert.ok(dots.length === 3 && dots.every((d) => d.shapes.length === 3 && d.shapes.every((s) => s.tag === 'circle' && s.stroke === 'none' && s.fill === d.color)), 'dots are three filled circles with no stroke');
      colors[theme] = cat[0].color;
      checked += cat.length;
      // 2. The real built webview, both seats.
      for (const surface of ['classroom', 'personal']) {
        await b.send('Page.navigate', { url: base });
        for (let i = 0; i < 100 && !(await b.evaluate(`window.sent?.some(m=>m.type==='ready')`).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 50));
        await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'config',config:${JSON.stringify(config(surface))}}}));`);
        await new Promise((r) => setTimeout(r, 150));
        await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'history',messages:${JSON.stringify(history)}}}));`);
        await new Promise((r) => setTimeout(r, 150));
        // Icons inside closed menus and hidden panels have no box (display: none); only drawn ones are measured.
        const live = (await b.evaluate(MEASURE)).filter((i) => i.w > 0 || i.h > 0);
        assert.ok(live.length >= 8, `${surface} ${theme}: only ${live.length} icons rendered; the check would be vacuous`);
        const problems = auditMeasured(live, `${surface} ${theme}`);
        assert.deepEqual(problems, [], problems.join('\n'));
        checked += live.length;
      }
    } finally { await b.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }); }
  }
  assert.notEqual(colors.dark, colors.light, 'the icon colour is the same in dark and light, so it is not following currentColor');
  console.log(`PASS ${name}: ${checked} icons measured (${kinds.length} kinds x 16/20/24, plus the real classroom and personal webview) in dark and light; boxes 16/20/24, stroke 1.5-2, paint = currentColor`);
} finally { if (b) await b.close(); server.close(); rmSync(temp, { recursive: true, force: true }); }
