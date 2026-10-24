// CGP-DS-D-006 (DES-CGP-DS-10): the personal-chat text size, measured on the CASCADE in headless Chromium.
//   node --experimental-strip-types test/text-size-geometry.smoke.mjs
//
// The built webview (main.tsx, shipped stylesheet order) is mounted with the personal seat at each saved size,
// dark and light, at 320 and 800px. Computed styles and layout rects are read, never rule text:
//   - message body and composer text compute to 16 / 18 / 20px (base / large / xlarge);
//   - the page and the shell never scroll horizontally, even at 320px with 20px text;
//   - the Send button stays 44x44 or larger and fully inside the viewport (control targets do not shrink or scroll away).
// Self-test: three overrides are injected on top of the cascade at 320px / xlarge; each must be caught.
// Without a headless Chromium this prints NOT RUN; FOCUS_REQUIRE_BROWSER=1 (set by CI) makes that a failure.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('text-size-geometry: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('text-size-geometry NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)');
  process.exit(0);
}
const { build } = await import('esbuild');
const extension = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webview = path.join(extension, 'webview-ui');
const temp = mkdtempSync(path.join(tmpdir(), 'hps-text-size-'));
await build({
  entryPoints: [path.join(webview, 'src/main.tsx')], bundle: true, platform: 'browser', jsx: 'automatic', outfile: path.join(temp, 'ui.js'), logLevel: 'error',
  nodePaths: [path.join(webview, 'node_modules')], alias: { react: path.join(webview, 'node_modules/react'), 'react-dom': path.join(webview, 'node_modules/react-dom') },
  loader: { '.svg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.png': 'dataurl' },
});
const server = createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/ui.js' || u === '/ui.css') { try { const body = readFileSync(path.join(temp, u)); res.setHeader('content-type', u.endsWith('js') ? 'text/javascript' : 'text/css'); res.end(body); } catch { res.statusCode = 404; res.end(); } return; }
  res.setHeader('content-type', 'text/html');
  res.end('<!doctype html><html lang="ko"><head><meta charset="utf-8"><link rel="stylesheet" href="/ui.css"></head><body><div id="root"></div><script src="/ui.js"></script></body></html>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const FONT = '--vscode-font-size:13px;--vscode-font-family:-apple-system, "Apple SD Gothic Neo", sans-serif;';
const THEMES = {
  dark: FONT + '--vscode-sideBar-background:#181818;--vscode-foreground:#cccccc;--vscode-editor-foreground:#cccccc;--vscode-descriptionForeground:#9d9d9d;--vscode-editor-background:#1f1f1f;--vscode-focusBorder:#0078d4;--vscode-input-background:#313131;--vscode-input-foreground:#cccccc;--vscode-panel-border:#2b2b2b;--vscode-button-background:#0078d4;--vscode-button-foreground:#fff;',
  light: FONT + '--vscode-sideBar-background:#f8f8f8;--vscode-foreground:#3b3b3b;--vscode-editor-foreground:#3b3b3b;--vscode-descriptionForeground:#616161;--vscode-editor-background:#ffffff;--vscode-focusBorder:#005fb8;--vscode-input-background:#ffffff;--vscode-input-foreground:#3b3b3b;--vscode-panel-border:#e5e5e5;--vscode-button-background:#005fb8;--vscode-button-foreground:#fff;',
};
const UX = { coach: { naming_mode: 'fixed', fallback_name: '코치', naming_prompt_md: '', personality_prompt_md: '' }, suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: '' }, roll_input_button: { enabled: false, label: '', probe_md: '' } }, retry_button: { enabled: false, show_counter: false } };
const config = (textSize) => ({
  proxyUrl: 'http://controlled.invalid/v1', model: 'sonnet', hasToken: true, coach: { name: '코치', personality: '', configured: true },
  profile: { profile_id: 'synthetic', display_name: '확인', activity_kind: 'personal', observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: '안녕하세요' }, model_selection: null, ux: UX },
  activity: { id: 'a-personal', name: '내 작업', kind: 'personal', workspace: '/synthetic', verified: true },
  taskWorkspace: { scope: 's', revision: 1, activeTaskId: 't1', tasks: [{ id: 't1', title: '반 소개 페이지', createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null },
  textSize,
});
const MESSAGE = '글자 크기를 바꾸어도 긴 한국어 문장을 편안하게 읽고 다음 질문을 보낼 수 있어요.';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MEASURE = `(()=>{const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
const body=document.querySelector('.hps-msg-body'),input=document.querySelector('.hps-input textarea'),send=document.querySelector('.hps-btn-send'),shell=document.querySelector('.hps-shell');
return {body:body&&getComputedStyle(body).fontSize,input:input&&getComputedStyle(input).fontSize,send:send&&rect(send),
overflow:document.documentElement.scrollWidth>innerWidth,shellOverflow:shell.scrollWidth>shell.clientWidth,personal:shell.dataset.chatDetail,size:shell.dataset.textSize||'base'}})()`;

// Returns a list of problems (empty = fine) for one rendered state.
const problems = (r, { width, expected, size }) => {
  const out = [];
  if (r.personal !== 'personal') out.push(`not the personal seat (${r.personal})`);
  if (r.size !== size) out.push(`shell text size ${r.size}, want ${size}`);
  if (r.body !== `${expected}px`) out.push(`message body ${r.body}, want ${expected}px`);
  if (r.input !== `${expected}px`) out.push(`composer ${r.input}, want ${expected}px`);
  if (r.overflow) out.push('page scrolls horizontally');
  if (r.shellOverflow) out.push('shell scrolls horizontally');
  const s = r.send;
  if (!s) out.push('Send button missing');
  else {
    if (s.width < 43.99 || s.height < 43.99) out.push(`Send ${s.width}x${s.height} is under 44px`);
    if (s.left < 0 || s.right > width + 0.01 || s.top < 0 || s.bottom > 800.01) out.push(`Send is outside the viewport (${s.left}..${s.right} x ${s.top}..${s.bottom})`);
  }
  return out;
};

let b;
let checked = 0;
try {
  b = await launch(bin);
  const render = async ({ theme, width, size, inject }) => {
    await b.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false });
    const { identifier } = await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.sent=[];window.acquireVsCodeApi=()=>({postMessage:m=>window.sent.push(m),getState:()=>undefined,setState:()=>{}});` });
    try {
      await b.send('Page.navigate', { url: base });
      for (let i = 0; i < 100 && !(await b.evaluate(`window.sent?.some(m=>m.type==='ready')`).catch(() => false)); i++) await sleep(50);
      await b.evaluate(`document.documentElement.style.cssText=${JSON.stringify(THEMES[theme])};document.body.className=${JSON.stringify(theme === 'dark' ? 'vscode-dark' : 'vscode-light')};window.dispatchEvent(new MessageEvent('message',{data:{type:'config',config:${JSON.stringify(config(size))}}}));`);
      await sleep(100);
      await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'history',messages:[{id:'answer',role:'assistant',content:${JSON.stringify(MESSAGE)},createdAt:1}]}}));`);
      await sleep(100);
      if (inject) { await b.evaluate(`document.head.appendChild(Object.assign(document.createElement('style'),{textContent:${JSON.stringify(inject)}}))`); await sleep(50); }
      return await b.evaluate(MEASURE);
    } finally { await b.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }); }
  };

  for (const theme of ['dark', 'light']) for (const width of [320, 800]) for (const [size, expected] of [['base', 16], ['large', 18], ['xlarge', 20]]) {
    const r = await render({ theme, width, size });
    const found = problems(r, { width, expected, size });
    assert.deepEqual(found, [], `${theme} ${width}px ${size}: ${found.join('; ')}`);
    checked++;
  }

  // Self-test: each injected override must be reported at the tightest state (320px, xlarge, light).
  const SEL = '.hps-shell[data-chat-detail="personal"]';
  const MUTATIONS = [
    ['a later composer override ignores the step', `${SEL} .hps-input textarea{font-size:16px !important}`, /composer 16px/],
    ['the shell is wider than the pane', `${SEL}{min-width:520px}`, /page scrolls horizontally/],
    ['the Send target shrinks under 44px', `${SEL} .hps-btn-send{width:32px !important;height:32px !important;min-width:0 !important;min-height:0 !important}`, /under 44px/],
  ];
  for (const [label, css, want] of MUTATIONS) {
    const r = await render({ theme: 'light', width: 320, size: 'xlarge', inject: css });
    const found = problems(r, { width: 320, expected: 20, size: 'xlarge' }).join('; ');
    assert.match(found, want, `mutation not caught: ${label} (got: ${found || 'clean'})`);
  }
  console.log(`text-size-geometry OK: ${checked} personal states (dark/light x 320/800 x 16/18/20px) computed; ${MUTATIONS.length} negative controls caught`);
} finally {
  await b?.close();
  server.close();
  rmSync(temp, { recursive: true, force: true });
}
