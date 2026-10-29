// REQ-CGP-AGENT-60 — shell rows and the "실행 중인 것" list, measured on the shipped cascade.
// The stylesheet is the CSS esbuild emits for webview-ui/src/main.tsx (the exact product order:
// tokens, focusGeometry, component sheets, styles, chatDetails, ...). Nothing is injected: no
// token, no focus rule. Markup is the real ToolLine / RunningProcessesPanel output.
// Self-tests: an injected override that breaks each guarded property must make the probe fail.
// Without Chromium this prints NOT RUN; FOCUS_REQUIRE_BROWSER=1 makes that a failure (CI).
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER === '1') { console.error('shell-process-layout: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('shell-process-layout NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)');
  process.exit(0);
}

// ---------- the shipped stylesheet ----------
const shipped = await build({
  entryPoints: [join(root, 'webview-ui/src/main.tsx')], bundle: true, write: false, outdir: join(root, 'out-shell-layout'), logLevel: 'silent',
  jsx: 'automatic', loader: { '.svg': 'text', '.png': 'empty', '.woff2': 'empty', '.woff': 'empty' },
  nodePaths: [join(root, 'webview-ui/node_modules')],
});
const css = shipped.outputFiles.find((o) => o.path.endsWith('.css')).text;
assert.ok(css.includes('.hps-shell-row pre') && css.includes('--hp-ring-focus-default'), 'the shipped cascade carries the row rules and the shared ring');

// ---------- the real markup ----------
const bundle = await build({
  stdin: { contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {ToolLine} from './webview-ui/src/ChatPanel'; import {RunningProcessesPanel} from './webview-ui/src/RunningProcesses';
    const row = (shell, state) => renderToStaticMarkup(<ToolLine message={{id:'s',role:'tool',content:'',createdAt:0,tool:{icon:'',label:'',state,shell}}} onReport={()=>{}}/>);
    export const rows = row({purpose:'개발 서버가 뜨는지 확인해요',command:'npm run dev -- --port 5173 '+'--flag '.repeat(80),collapsed:false}, 'running');
    export const panel = renderToStaticMarkup(<RunningProcessesPanel entries={[{id:'live',purpose:'미리보기 서버',kind:'preview',folder:'작업 폴더 전체 (site)',address:'127.0.0.1:43299',state:'running'},{id:'sdk',purpose:'테스트 감시',state:'stopped'}]} onStop={()=>{}}/>);`, resolveDir: root, loader: 'tsx' },
  bundle: true, platform: 'node', format: 'cjs', write: false, jsx: 'automatic',
  alias: { react: root + '/webview-ui/node_modules/react', 'react-dom': root + '/webview-ui/node_modules/react-dom' }, nodePaths: [root + '/webview-ui/node_modules'],
  loader: { '.css': 'empty', '.svg': 'text' }, logLevel: 'silent',
});
const module = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, { window: { innerWidth: 1420, addEventListener() {}, removeEventListener() {} }, module, exports: module.exports, require: createRequire(import.meta.url), console, process, TextEncoder, TextDecoder, URL, setTimeout, clearTimeout });
const { rows, panel } = module.exports;

const THEMES = {
  dark: { cls: 'vscode-dark', dark: true, v: { 'editor-background': '#1f1f1f', 'sideBar-background': '#181818', foreground: '#cccccc', descriptionForeground: '#9d9d9d', focusBorder: '#0078d4' } },
  light: { cls: 'vscode-light', dark: false, v: { 'editor-background': '#ffffff', 'sideBar-background': '#f8f8f8', foreground: '#3b3b3b', descriptionForeground: '#717171', focusBorder: '#005fb8' } },
};
const page = (t, seat, extraCss) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>:root{${Object.entries(t.v).map(([k, v]) => `--vscode-${k}:${v}`).join(';')}}${css}${extraCss}</style></head>
<body class="${t.cls}" style="margin:0;background:var(--vscode-editor-background);color:var(--vscode-foreground)"><div id="root"><div class="hps-shell" data-chat-detail="${seat}">${panel}<div class="hps-messages">${rows}</div></div></div></body></html>`;

const probe = `(() => {
  const px = (v) => parseFloat(v);
  const row = document.querySelector('.hps-shell-row'), purpose = row.querySelector('.hps-shell-purpose'), summary = row.querySelector('summary'), pre = row.querySelector('pre');
  const li = document.querySelector('.hps-running-processes li'), status = li.querySelector('[role=status]'), button = li.querySelector('button');
  const folder = document.querySelector('.hps-running-processes .hps-shell-folder');
  const r = (e) => e.getBoundingClientRect();
  const range = document.createRange(); range.selectNodeContents(summary); const text = [...range.getClientRects()].filter(x => x.width > 0);
  const tTop = Math.min(...text.map(x => x.top)), tBottom = Math.max(...text.map(x => x.bottom));
  const s = r(summary);
  return {
    purposeFont: px(getComputedStyle(purpose).fontSize), purposeWeight: +getComputedStyle(purpose).fontWeight, folderWeight: +getComputedStyle(folder).fontWeight,
    purposeColor: getComputedStyle(purpose).color, folderColor: getComputedStyle(folder).color,
    summaryHeight: s.height, summaryTextOffset: Math.abs((tTop + tBottom) / 2 - (s.top + s.bottom) / 2),
    preMargin: getComputedStyle(pre).marginTop + ' ' + getComputedStyle(pre).marginBottom, preWrap: getComputedStyle(pre).whiteSpace, preMax: getComputedStyle(pre).maxHeight,
    preGap: r(pre).top - s.bottom,
    buttonHeight: r(button).height, statusGap: r(button).left - r(status).right, statusSameLine: Math.abs(r(button).top - r(status).top) < r(button).height,
    order: r(purpose).bottom <= r(pre).top,
    cards: [...document.querySelectorAll('.hps-running-processes li')].map(c => ({ border: px(getComputedStyle(c).borderTopWidth), top: r(c).top, bottom: r(c).bottom })),
    dotFolder: document.querySelector('.hps-running-processes').textContent.includes('폴더: .'),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
})()`;

async function check(b, extraCss = '', shots) {
  const bad = [];
  for (const [tname, t] of Object.entries(THEMES)) for (const seat of ['personal', 'classroom']) for (const width of [1420, 800, 320]) {
    const at = `${seat}/${tname}/${width}`;
    await b.load(page(t, seat, extraCss), { width, height: 900, dark: t.dark });
    const m = await b.evaluate(probe);
    if (m.purposeFont < 14) bad.push(`${at}: purpose ${m.purposeFont}px < 14px`);
    if (!(m.purposeWeight > m.folderWeight) || m.purposeColor === m.folderColor) bad.push(`${at}: purpose not set apart from the folder caption`);
    if (m.summaryHeight < 44) bad.push(`${at}: summary ${m.summaryHeight}px < 44px`);
    if (m.summaryTextOffset > 2) bad.push(`${at}: summary text not vertically centred (${m.summaryTextOffset.toFixed(1)}px)`);
    if (m.preMargin !== '0px 0px') bad.push(`${at}: pre margin ${m.preMargin}`);
    if (m.preWrap !== 'pre-wrap' || m.preMax !== '240px') bad.push(`${at}: pre ${m.preWrap} ${m.preMax}`);
    if (m.buttonHeight < 44) bad.push(`${at}: stop button ${m.buttonHeight}px < 44px`);
    if (m.statusSameLine && m.statusGap < 4) bad.push(`${at}: status text touches the stop button (${m.statusGap}px)`);
    if (!m.order) bad.push(`${at}: purpose is not above the command`);
    // Jay 2026-10-29 ("줄 구분도 잘 안 되고"): every running thing is its own bordered card, apart from the next.
    if (m.cards.length !== 2 || m.cards.some(c => c.border < 1)) bad.push(`${at}: running entries are not bordered cards ${JSON.stringify(m.cards)}`);
    else if (m.cards[1].top - m.cards[0].bottom < 4) bad.push(`${at}: cards touch (${(m.cards[1].top - m.cards[0].bottom).toFixed(1)}px)`);
    if (m.dotFolder) bad.push(`${at}: "폴더: ." is shown`);
    if (m.overflow > 0) bad.push(`${at}: horizontal overflow ${m.overflow}px`);
    // Focus: the shared ring, measured. The button sits outside a scroll scope (+2px); the summary
    // and the scrolling <pre> sit inside .hps-messages (-2px, never clipped).
    for (const [sel, offset] of [['.hps-running-processes button', '2px'], ['.hps-shell-row summary', '-2px'], ['.hps-shell-row pre', '-2px']]) {
      const f = await b.focusVisibleStyle(sel);
      if (f['outline-style'] !== 'solid' || f['outline-width'] !== '2px' || f['outline-offset'] !== offset) bad.push(`${at}: ${sel} ring ${f['outline-width']} ${f['outline-style']} offset ${f['outline-offset']} (want 2px solid ${offset})`);
      if (/rgba\(0, 0, 0, 0\)/.test(f['outline-color'])) bad.push(`${at}: ${sel} ring is transparent`);
    }
    if (shots) { mkdirSync(shots, { recursive: true }); const shot = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${shots}/${seat}-${tname}-${width}.png`, Buffer.from(shot.data, 'base64')); }
  }
  for (const [tname, t] of Object.entries(THEMES)) {
    await b.load(page(t, 'personal', extraCss), { width: 800, height: 900, dark: t.dark, forcedColors: true });
    for (const sel of ['.hps-running-processes button', '.hps-shell-row summary']) {
      const f = await b.focusVisibleStyle(sel);
      if (f['outline-style'] !== 'solid' || f['outline-width'] !== '2px') bad.push(`forced-colors/${tname}: ${sel} ring ${f['outline-width']} ${f['outline-style']}`);
    }
  }
  return bad;
}

let b;
try { b = await launch(bin); } catch (e) {
  if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw e;
  console.log(`shell-process-layout NOT RUN: ${e.message}`); process.exit(0);
}
try {
  const bad = await check(b, '', process.env.SHELL_PROCESS_SCREENSHOTS);
  assert.deepEqual(bad, [], 'shipped cascade');
  console.log('  ok   shipped cascade: 2 seats x 2 themes x 3 widths + forced colours');
  // Self-tests: each override must be caught, so the probe is not a no-op.
  const overrides = {
    'focus ring removed': 'html body .hps-shell-row summary:focus-visible { outline: none !important; }',
    'ring outside in the scroll scope': 'html body .hps-shell-row pre { --hp-focus-offset: 2px !important; }',
    'forced-colours ring removed': '@media (forced-colors: active) { html body .hps-running-processes button:focus-visible { outline-style: none !important; } }',
    'small target': '.hps-running-processes button { min-height: 0; height: 20px; padding: 0; }',
    'small purpose': '.hps-shell-row .hps-shell-purpose { font-size: 12px; }',
    'summary text top-aligned': '.hps-shell-row summary { display: block; }',
    'pre margin back': '.hps-shell-row pre { margin: 1em 0; }',
    'status touches button': '.hps-process-actions { gap: 0; }',
    'card boundary removed': '.hps-running-processes li.hps-process-card { border: 0; }',
    'cards touch': '.hps-running-processes ul { gap: 0; }',
    'flat purpose': '.hps-shell-purpose { font-weight: inherit; color: inherit; } .hps-shell-folder { color: inherit; }',
    'horizontal overflow': '.hps-shell-row pre { white-space: pre; overflow-wrap: normal; overflow: visible; max-height: 240px; }',
  };
  for (const [name, extra] of Object.entries(overrides)) {
    const caught = await check(b, extra);
    assert.ok(caught.length > 0, `self-test "${name}" was not detected`);
    console.log(`  ok   self-test detects: ${name} (${caught[0]})`);
  }
  console.log('shell-process-layout: PASS');
} finally { await b.close(); }
