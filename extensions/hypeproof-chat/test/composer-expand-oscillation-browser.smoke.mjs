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
//
// studio#3396 item 2 widened it into a matrix: Korean, English, emoji and code drafts × two metric
// profiles (native scrollbars; Windows fonts with 17 px styled ones; macOS fonts with 11 px) × widths. The layout-loop guard's warning (webview-ui/src/layoutLoopGuard.ts)
// fails it too: a held oscillation is a loop the guard hid, not a pass.
//   COMPOSER_RANGES="280-640:1,644-1200:4"     width ranges in px with their steps
//                                                (default "280-640:10": a PR-sized sample, about 2-3 minutes)
//   COMPOSER_DRAFTS=ko,en,emoji,code              which drafts       COMPOSER_METRICS=native,windows,mac
//   COMPOSER_MAX_FAILURES=1                        stop at the first failure (the release gate; default 6)
//   COMPOSER_WEBVIEW_DIST=<dir>                    test a PACKAGED build's webview-ui/dist instead of bundling
//                                                  the source (the Windows release gate, build-windows.yml)
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
const extension = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webview = path.join(extension, 'webview-ui');
const packaged = process.env.COMPOSER_WEBVIEW_DIST ? path.resolve(process.env.COMPOSER_WEBVIEW_DIST) : null;
const temp = mkdtempSync(path.join(tmpdir(), 'hps-composer-oscillation-'));
if (!packaged) {
  const { build } = await import('esbuild');
  await build({
    entryPoints: [path.join(webview, 'src', 'main.tsx')], bundle: true, platform: 'browser', jsx: 'automatic', outfile: path.join(temp, 'ui.js'), logLevel: 'error',
    nodePaths: [path.join(webview, 'node_modules')], alias: { react: path.join(webview, 'node_modules/react'), 'react-dom': path.join(webview, 'node_modules/react-dom') },
    loader: { '.svg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.png': 'dataurl' },
  });
}
const PAGE = packaged ? null : '<!doctype html><html lang="ko"><head><meta charset="utf-8"><link rel="stylesheet" href="/ui.css"></head><body><div id="root"></div><script src="/ui.js"></script></body></html>';
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  // A packaged build is served as shipped: its own index.html and assets/ (vite output).
  const file = packaged ? path.join(packaged, u === '/' ? 'index.html' : u) : u === '/ui.js' || u === '/ui.css' ? path.join(temp, u) : null;
  if (file && (packaged ? file.startsWith(packaged) : true)) {
    try { res.setHeader('content-type', TYPES[path.extname(file)] ?? 'application/octet-stream'); res.end(readFileSync(file)); } catch { res.statusCode = 404; res.end(); }
    return;
  }
  res.setHeader('content-type', 'text/html');
  res.end(PAGE ?? '');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

// Scrollbars decide this bug, and hosts differ: macOS draws overlay scrollbars (no width) when no
// mouse is attached ("Show scroll bars: Automatic"); Windows and Linux draw classic ones. On one Mac
// the old code looped here (300, 301, 312 px) while it drew classic scrollbars, and passed once they
// were overlay again. So this smoke proves the fix only where the host draws classic scrollbars: the
// Windows release gate (build-windows.yml) and Linux CI. Styled ::-webkit-scrollbar rules did NOT
// reproduce the loop (measured), so they are no substitute; the `windows`/`mac` profiles below cover
// fonts and styled widths, `native` is the engine's own scrollbar.
const METRICS = {
  native: { font: '"Segoe UI", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif', scrollbar: 0 },
  // Windows 10/11 fonts with 17 px styled scrollbars (the 2026-11-02 seat's fonts).
  windows: { font: '"Segoe UI", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif', scrollbar: 17 },
  mac: { font: '-apple-system, "Apple SD Gothic Neo", sans-serif', scrollbar: 11 },
};
const theme = (m) => `--vscode-font-size:13px;--vscode-font-family:${m.font};--vscode-sideBar-background:#181818;--vscode-foreground:#cccccc;--vscode-editor-background:#1f1f1f;--vscode-input-background:#313131;--vscode-input-foreground:#cccccc;--vscode-panel-border:#2b2b2b;--vscode-button-background:#0078d4;--vscode-button-foreground:#fff;`;
const UX = { coach: { naming_mode: 'fixed', fallback_name: '코치', naming_prompt_md: '', personality_prompt_md: '' }, suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: '' }, roll_input_button: { enabled: false, label: '', probe_md: '' } }, retry_button: { enabled: false, show_counter: false } };
const config = {
  proxyUrl: 'http://controlled.invalid/v1', model: 'hypeproof-default', hasToken: true, coach: { name: '코치', personality: '', configured: true },
  profile: { profile_id: 'synthetic', display_name: '확인', activity_kind: 'personal', observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: '안녕하세요' }, model_selection: null, ux: UX },
  activity: { id: 'a-composer', name: '내 작업', kind: 'personal', workspace: '/synthetic', verified: true },
  taskWorkspace: { scope: 's-composer', revision: 1, activeTaskId: 't1', sourceSelection: null, tasks: [{ id: 't1', title: '작업', createdAt: 1, updatedAt: 2, messageCount: 0 }] },
};
const DRAFTS = {
  ko: 'ComfyUI 클라우드에서 만든 JSON 노드 파일을 읽고 내 PRD 문서랑 로컬 홈페이지를 비교해서 다음 작업을 같이 정해줘. 그리고 agents, codex 폴더도 봐줘.',
  en: 'Read the JSON node file I made in ComfyUI cloud, compare it with my PRD and the local homepage, then plan the next tasks with me and check the agents folder.',
  emoji: '오늘 할 일 🍞🥐🥖 빵집 페이지 🎨 색 바꾸고 📸 사진 넣고 ✅ 예약 버튼 고치고 🚀 배포까지 해줘 👍🏽👨‍👩‍👧‍👦🇰🇷 고마워요 🙏✨🔥💯🎉',
  code: 'fix this: const total = items.reduce((a, b) => a + b.price * b.qty, 0); document.querySelector("#total").textContent = total.toLocaleString("ko-KR");',
};
const RANGES = (process.env.COMPOSER_RANGES ?? '280-640:10').split(',').map((part) => {
  const [span, step] = part.split(':'); const [from, to] = span.split('-').map(Number);
  if (!(from > 0 && to >= from && Number(step) > 0)) throw new Error(`bad COMPOSER_RANGES part: ${part}`);
  return { from, to, step: Number(step) };
});
const WIDTHS = RANGES.flatMap(({ from, to, step }) => { const out = []; for (let w = from; w <= to; w += step) out.push(w); return out; });
const draftNames = (process.env.COMPOSER_DRAFTS ?? 'ko,en,emoji,code').split(',').filter((n) => DRAFTS[n]);
const metricNames = (process.env.COMPOSER_METRICS ?? 'native,windows').split(',').filter((n) => METRICS[n]);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await launch(bin);
const state = () => b.evaluate(`(() => { const w = (window.sent || []).find(m => m.type === 'webviewError');
  const input = document.querySelector('.hps-input');
  const loop = (window.errs || []).find(e => /Maximum update depth|Minified React error #185|\\[layout-loop-guard\\]/.test(e)) || null;
  return { fatal: !!document.querySelector('.hps-fatal-title'), error: w ? String(w.message).slice(0, 160) : loop ? String(loop).slice(0, 160) : null,
    expanded: input?.getAttribute('data-expanded') === 'true' }; })()`);
const failures = [];
const MAX_FAILURES = Number(process.env.COMPOSER_MAX_FAILURES ?? 6);
let widthsChecked = 0, expandedSeen = 0;
for (const metricName of metricNames) for (const draftName of draftNames) {
  const metric = METRICS[metricName], DRAFT = DRAFTS[draftName];
  let seenHere = 0, checkedHere = 0;
  for (const w of WIDTHS) {
    if (failures.length >= MAX_FAILURES) break;
    await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 1, mobile: false });
    const { identifier } = await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.sent = []; window.errs = [];
      window.acquireVsCodeApi = () => ({ postMessage: (m) => window.sent.push(m), getState: () => undefined, setState: () => {} });
      const err = console.error, warn = console.warn;
      console.error = (...a) => { window.errs.push(a.map(String).join(' ').slice(0, 300)); err(...a); };
      console.warn = (...a) => { window.errs.push(a.map(String).join(' ').slice(0, 300)); warn(...a); };
      document.addEventListener('DOMContentLoaded', () => { const v = ${JSON.stringify(theme(metric))};
        const css = ${JSON.stringify(metric.scrollbar ? `::-webkit-scrollbar{width:${metric.scrollbar}px;height:${metric.scrollbar}px}::-webkit-scrollbar-thumb{background:#555}` : '')};
        if (css) { const bar = document.createElement('style'); bar.textContent = css; document.head.appendChild(bar); }
        document.documentElement.setAttribute('style', v); document.body.setAttribute('style', v + 'margin:0;background:var(--vscode-sideBar-background);color:var(--vscode-foreground)'); });` });
    try {
      await b.send('Page.navigate', { url: base });
      for (let i = 0; i < 100 && !(await b.evaluate(`!!window.sent && window.sent.some((m) => m.type === 'ready')`).catch(() => false)); i++) await pause(50);
      await b.evaluate(`window.dispatchEvent(new MessageEvent('message', { data: { type: 'config', config: ${JSON.stringify(config)} } }))`);
      for (let i = 0; i < 50 && !(await b.evaluate(`!!document.querySelector('.hps-input textarea')`)); i++) await pause(50);
    } finally { await b.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }); }
    await b.evaluate(`document.querySelector('.hps-input textarea').focus()`);
    widthsChecked++; checkedHere++;
    const chars = [...DRAFT];
    for (let i = 0; i < chars.length; i++) {
      await b.send('Input.insertText', { text: chars[i] });
      await pause(10);
      const s = await state();
      if (s.fatal || s.error) { failures.push(`${metricName}/${draftName} width ${w}px, character ${i + 1}: ${s.error ?? 'error card shown'}`); break; }
      // Past the turn to multi-line the boundary has been crossed; a few more characters, then the next width.
      if (s.expanded) { expandedSeen++; seenHere++; for (let k = 0; k < 4 && i + 1 < chars.length; k++) { await b.send('Input.insertText', { text: chars[++i] }); await pause(10); }
        const after = await state(); if (after.fatal || after.error) failures.push(`${metricName}/${draftName} width ${w}px, after expanding: ${after.error ?? 'error card shown'}`); break; }
    }
  }
  console.log(`  ${metricName}/${draftName}: ${checkedHere} widths, multi-line reached at ${seenHere}`);
}
await b.close?.();
server.close();
// Control: the sweep must actually cross the single-line → multi-line boundary, or it proves nothing.
if (expandedSeen < widthsChecked / 2) failures.push(`the composer turned multi-line at only ${expandedSeen} of ${widthsChecked} widths; the sweep did not exercise the boundary`);
if (failures.length) { console.error('composer-expand-oscillation FAIL\n  ' + failures.join('\n  ')); process.exit(1); }
console.log(`composer-expand-oscillation PASS: ${widthsChecked} runs (${metricNames.join('+')} × ${draftNames.join('+')}, ${process.env.COMPOSER_RANGES ?? '280-640:10'}${packaged ? ', packaged build' : ''}) with no update loop`);
