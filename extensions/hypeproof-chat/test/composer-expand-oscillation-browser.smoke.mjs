// Composer auto-resize must settle (2026-11-02 incident: a Windows super seat on v2026.1029.0 got the
// error card "화면을 그리다가 멈췄어요" with React #185, Maximum update depth exceeded, and 다시 열기
// re-crashed because the draft was restored).
//   node test/composer-expand-oscillation-browser.smoke.mjs
//
// The real webview entry (main.tsx) is bundled and opened in headless Chromium with a personal task
// workspace. At each window width a long Korean draft is typed one character at a time, through the
// DevTools protocol, until the composer turns multi-line. useGrowingComposer used to flip `expanded`
// back and forth at a boundary width: measuring the field collapsed to 0px drew a scrollbar in the
// single-line layout only, so the draft wrapped at a narrower width there than in the expanded one. Reproduced on the 1029.0 bundle at 335 px (16th
// character) and 349 px (17th). Any React error or the error card fails this smoke.
// Without a headless Chromium this prints NOT RUN; FOCUS_REQUIRE_BROWSER=1 (set by CI) makes that a failure.
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('composer-expand-oscillation: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('composer-expand-oscillation NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)');
  process.exit(0);
}
const { build } = await import('esbuild');
const extension = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webview = path.join(extension, 'webview-ui');
const temp = mkdtempSync(path.join(tmpdir(), 'hps-composer-oscillation-'));
await build({
  entryPoints: [path.join(webview, 'src', 'main.tsx')], bundle: true, platform: 'browser', jsx: 'automatic', outfile: path.join(temp, 'ui.js'), logLevel: 'error',
  nodePaths: [path.join(webview, 'node_modules')], alias: { react: path.join(webview, 'node_modules/react'), 'react-dom': path.join(webview, 'node_modules/react-dom') },
  loader: { '.svg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.png': 'dataurl' },
});
const server = createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/ui.js' || u === '/ui.css') { try { res.setHeader('content-type', u.endsWith('js') ? 'text/javascript' : 'text/css'); res.end(readFileSync(path.join(temp, u))); } catch { res.statusCode = 404; res.end(); } return; }
  res.setHeader('content-type', 'text/html');
  res.end('<!doctype html><html lang="ko"><head><meta charset="utf-8"><link rel="stylesheet" href="/ui.css"></head><body><div id="root"></div><script src="/ui.js"></script></body></html>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const THEME = '--vscode-font-size:13px;--vscode-font-family:-apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;--vscode-sideBar-background:#181818;--vscode-foreground:#cccccc;--vscode-editor-background:#1f1f1f;--vscode-input-background:#313131;--vscode-input-foreground:#cccccc;--vscode-panel-border:#2b2b2b;--vscode-button-background:#0078d4;--vscode-button-foreground:#fff;';
const UX = { coach: { naming_mode: 'fixed', fallback_name: '코치', naming_prompt_md: '', personality_prompt_md: '' }, suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: '' }, roll_input_button: { enabled: false, label: '', probe_md: '' } }, retry_button: { enabled: false, show_counter: false } };
const config = {
  proxyUrl: 'http://controlled.invalid/v1', model: 'hypeproof-default', hasToken: true, coach: { name: '코치', personality: '', configured: true },
  profile: { profile_id: 'synthetic', display_name: '확인', activity_kind: 'personal', observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: '안녕하세요' }, model_selection: null, ux: UX },
  activity: { id: 'a-composer', name: '내 작업', kind: 'personal', workspace: '/synthetic', verified: true },
  taskWorkspace: { scope: 's-composer', revision: 1, activeTaskId: 't1', sourceSelection: null, tasks: [{ id: 't1', title: '작업', createdAt: 1, updatedAt: 2, messageCount: 0 }] },
};
const DRAFT = 'ComfyUI 클라우드에서 만든 JSON 노드 파일을 읽고 내 PRD 문서랑 로컬 홈페이지를 비교해서 다음 작업을 같이 정해줘.';
const FROM = Number(process.env.COMPOSER_FROM ?? 300), TO = Number(process.env.COMPOSER_TO ?? 520), STEP = Number(process.env.COMPOSER_STEP ?? 1);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await launch(bin);
const state = () => b.evaluate(`(() => { const w = (window.sent || []).find(m => m.type === 'webviewError');
  const input = document.querySelector('.hps-input');
  return { fatal: !!document.querySelector('.hps-fatal-title'), error: w ? String(w.message).slice(0, 160) : (window.errs || []).find(e => /Maximum update depth|Minified React error #185/.test(e)) || null,
    expanded: input?.getAttribute('data-expanded') === 'true' }; })()`);
const failures = [];
let widthsChecked = 0, expandedSeen = 0;
for (let w = FROM; w <= TO && failures.length < 3; w += STEP) {
  await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 1, mobile: false });
  const { identifier } = await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.sent = []; window.errs = [];
    window.acquireVsCodeApi = () => ({ postMessage: (m) => window.sent.push(m), getState: () => undefined, setState: () => {} });
    const err = console.error; console.error = (...a) => { window.errs.push(a.map(String).join(' ').slice(0, 300)); err(...a); };
    document.addEventListener('DOMContentLoaded', () => { const v = ${JSON.stringify(THEME)};
      document.documentElement.setAttribute('style', v); document.body.setAttribute('style', v + 'margin:0;background:var(--vscode-sideBar-background);color:var(--vscode-foreground)'); });` });
  try {
    await b.send('Page.navigate', { url: base });
    for (let i = 0; i < 100 && !(await b.evaluate(`!!window.sent && window.sent.some((m) => m.type === 'ready')`).catch(() => false)); i++) await pause(50);
    await b.evaluate(`window.dispatchEvent(new MessageEvent('message', { data: { type: 'config', config: ${JSON.stringify(config)} } }))`);
    for (let i = 0; i < 50 && !(await b.evaluate(`!!document.querySelector('.hps-input textarea')`)); i++) await pause(50);
  } finally { await b.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }); }
  await b.evaluate(`document.querySelector('.hps-input textarea').focus()`);
  widthsChecked++;
  for (let i = 0; i < DRAFT.length; i++) {
    await b.send('Input.insertText', { text: DRAFT[i] });
    await pause(10);
    const s = await state();
    if (s.fatal || s.error) { failures.push(`width ${w}px, character ${i + 1}: ${s.error ?? 'error card shown'}`); break; }
    // Past the turn to multi-line the boundary has been crossed; a few more characters, then the next width.
    if (s.expanded) { expandedSeen++; for (let k = 0; k < 4 && i + 1 < DRAFT.length; k++) { await b.send('Input.insertText', { text: DRAFT[++i] }); await pause(10); }
      const after = await state(); if (after.fatal || after.error) failures.push(`width ${w}px, after expanding: ${after.error ?? 'error card shown'}`); break; }
  }
}
await b.close?.();
server.close();
// Control: the sweep must actually cross the single-line → multi-line boundary, or it proves nothing.
if (expandedSeen < widthsChecked / 2) failures.push(`the composer turned multi-line at only ${expandedSeen} of ${widthsChecked} widths; the sweep did not exercise the boundary`);
if (failures.length) { console.error('composer-expand-oscillation FAIL\n  ' + failures.join('\n  ')); process.exit(1); }
console.log(`composer-expand-oscillation PASS: ${widthsChecked} widths (${FROM}-${TO}px), each typed past the single-line boundary with no update loop`);
