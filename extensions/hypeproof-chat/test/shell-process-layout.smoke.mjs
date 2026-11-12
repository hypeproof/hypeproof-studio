// REQ-CGP-AGENT-60 — shell rows and the "실행 중인 것" list, measured on the shipped cascade.
// CGP-AGENT-D-025 (DES-CGP-AGENT-60): the command block is monospace and stops at 240px, scrolling inside;
// its copy button sits beside the command (never over it), is a 44px tab stop right after the summary, and is
// drawn while the row is hovered or holds focus (always without a hover-capable pointer), with no motion.
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
    export const long = row({purpose:'모든 테스트를 차례로 돌려요',command:'npm run test:unit -- --reporter=dot ⏎ '.repeat(52),collapsed:false}, 'done');
    export const panel = renderToStaticMarkup(<RunningProcessesPanel entries={[{id:'live',purpose:'미리보기 서버',kind:'preview',folder:'작업 폴더 전체 (site)',address:'127.0.0.1:43299',state:'running'},{id:'sdk',purpose:'테스트 감시',state:'stopped'}]} onStop={()=>{}}/>);`, resolveDir: root, loader: 'tsx' },
  bundle: true, platform: 'node', format: 'cjs', write: false, jsx: 'automatic',
  alias: { react: root + '/webview-ui/node_modules/react', 'react-dom': root + '/webview-ui/node_modules/react-dom' }, nodePaths: [root + '/webview-ui/node_modules'],
  loader: { '.css': 'empty', '.svg': 'text' }, logLevel: 'silent',
});
const module = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, { window: { innerWidth: 1420, addEventListener() {}, removeEventListener() {} }, module, exports: module.exports, require: createRequire(import.meta.url), console, process, TextEncoder, TextDecoder, URL, setTimeout, clearTimeout });
const { rows, long, panel } = module.exports;

const THEMES = {
  dark: { cls: 'vscode-dark', dark: true, v: { 'editor-background': '#1f1f1f', 'sideBar-background': '#181818', foreground: '#cccccc', descriptionForeground: '#9d9d9d', focusBorder: '#0078d4' } },
  light: { cls: 'vscode-light', dark: false, v: { 'editor-background': '#ffffff', 'sideBar-background': '#f8f8f8', foreground: '#3b3b3b', descriptionForeground: '#717171', focusBorder: '#005fb8' } },
};
// VS Code's high-contrast themes (the copy button's edge must stay visible there too).
const HC_THEMES = {
  'high-contrast': { cls: 'vscode-high-contrast', dark: true, v: { 'editor-background': '#000000', 'sideBar-background': '#000000', foreground: '#ffffff', descriptionForeground: '#ffffff', focusBorder: '#f38518', contrastBorder: '#6fc3df' } },
  'high-contrast-light': { cls: 'vscode-high-contrast vscode-high-contrast-light', dark: false, v: { 'editor-background': '#ffffff', 'sideBar-background': '#ffffff', foreground: '#292929', descriptionForeground: '#292929', focusBorder: '#006bbd', contrastBorder: '#0f4a85' } },
};
const page = (t, seat, extraCss) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>:root{${Object.entries(t.v).map(([k, v]) => `--vscode-${k}:${v}`).join(';')}}${css}${extraCss}</style></head>
<body class="${t.cls}" style="margin:0;background:var(--vscode-editor-background);color:var(--vscode-foreground)"><div id="root"><div class="hps-shell" data-chat-detail="${seat}">${panel}<div class="hps-messages">${rows}<div id="long">${long}</div></div></div></div></body></html>`;

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
    ...copyFacts(),
  };
  function copyFacts() {
    const copy = row.querySelector('.hps-shell-copy');
    // Monospace: ten narrow and ten wide letters in the command's own font take the same width.
    const code = pre.querySelector('code');
    const width = (text) => { const s = document.createElement('span'); s.textContent = text; code.appendChild(s); const w = s.getBoundingClientRect().width; s.remove(); return w; };
    const mono = Math.abs(width('iiiiiiiiii') - width('WWWWWWWWWW'));
    const longPre = document.querySelector('#long pre'), lp = getComputedStyle(longPre);
    const block = { mono, longHeight: r(longPre).height, longScroll: longPre.scrollHeight - longPre.clientHeight, longOverflow: lp.overflowY };
    if (!copy) return { ...block, copy: null };
    const c = getComputedStyle(copy), cr = r(copy), pr = r(pre);
    return { ...block, copy: {
      tag: copy.localName, type: copy.type, tabIndex: copy.tabIndex, disabled: copy.disabled, name: copy.getAttribute('aria-label'),
      w: cr.width, h: cr.height, opacity: +c.opacity, border: px(c.borderTopWidth), borderStyle: c.borderTopStyle, borderColor: c.borderTopColor,
      // Does the opacity change animate? (a transition on opacity or all with a non-zero duration)
      fade: (() => { const props = c.transitionProperty.split(',').map((v) => v.trim()), durs = c.transitionDuration.split(',').map(parseFloat); return props.some((p, i) => (p === 'opacity' || p === 'all') && durs[i % durs.length] > 0); })(),
      // Beside the command, never over it: no overlap with the <pre> box, inside the row.
      overlap: Math.max(0, Math.min(cr.right, pr.right) - Math.max(cr.left, pr.left)) * Math.max(0, Math.min(cr.bottom, pr.bottom) - Math.max(cr.top, pr.top)),
      inside: cr.right <= r(row).right + 0.5 && cr.left >= r(row).left - 0.5,
    } };
  }
})()`;
// Headless Chromium has no pointer device (hover: none). Studio runs with a mouse or trackpad on macOS and
// Windows, so the main browser gets a fine, hover-capable pointer; a second one gets a coarse pointer that
// cannot hover (touch).
const DESKTOP_POINTER = '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4';
const TOUCH_POINTER = '--blink-settings=primaryHoverType=1,availableHoverTypes=1,primaryPointerType=2,availablePointerTypes=2';
const opacityOf = (sel) => `(() => { const e = document.querySelector('${sel}'); return e ? +getComputedStyle(e).opacity : null; })()`;
const pause = () => new Promise((r) => setTimeout(r, 30));
/** The copy button's opacity while the first shell row matches :hover (forced; headless updates no hover state). */
async function hoveredOpacity(b) {
  const { root } = await b.send('DOM.getDocument', { depth: 0 });
  const { nodeId } = await b.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.hps-shell-row' });
  await b.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] });
  try { return await b.evaluate(opacityOf('.hps-shell-copy')); } finally { await b.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] }); }
}
async function tab(b) {
  for (const type of ['keyDown', 'keyUp']) await b.send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
  await pause();
  return b.evaluate(`({ tag: document.activeElement?.localName ?? '', cls: document.activeElement?.className ?? '', opacity: ${opacityOf('.hps-shell-copy')} })`);
}
/** Tab from the summary: the next stop is the copy button, or the command itself first when it scrolls
 * (Chromium makes a scroller with nothing focusable inside a tab stop, so the command can be scrolled by keys). */
async function tabFromSummary(b) {
  await b.evaluate(`document.querySelector('.hps-shell-row summary').focus()`);
  let at = await tab(b);
  if (at.tag === 'pre') at = await tab(b);
  return at;
}
/** The forced :focus-visible ring of `sel`, or null when the page has no such element. */
async function ringOf(b, sel) {
  if (!(await b.evaluate(`!!document.querySelector('${sel}')`))) return null;
  return b.focusVisibleStyle(sel);
}
async function copyChecks(b, at, bad) {
  const m = await b.evaluate(probe);
  const c = m.copy;
  if (!c) { bad.push(`${at}: the command block has no copy button`); return; }
  if (c.tag !== 'button' || c.type !== 'button' || c.tabIndex !== 0 || c.disabled) bad.push(`${at}: copy is not a plain enabled button in the tab order (${c.tag} ${c.type} ${c.tabIndex} ${c.disabled})`);
  if (c.name !== '명령 복사') bad.push(`${at}: copy is named "${c.name}"`);
  if (c.w < 44 || c.h < 44) bad.push(`${at}: copy target ${c.w}x${c.h} < 44px`);
  if (c.overlap > 0) bad.push(`${at}: copy button covers the command (${c.overlap.toFixed(0)}px²)`);
  if (!c.inside) bad.push(`${at}: copy button leaves the row`);
  if (c.fade) bad.push(`${at}: copy reveal animates`);
  if (c.border < 1 || c.borderStyle !== 'solid' || /rgba\(0, 0, 0, 0\)/.test(c.borderColor)) bad.push(`${at}: copy button has no visible edge (${c.border}px ${c.borderStyle} ${c.borderColor})`);
  // At rest (pointer away, focus elsewhere) the button is not drawn; hover and focus draw it.
  if (!(await b.evaluate(`matchMedia('(hover: hover)').matches`))) { bad.push(`${at}: environment: no hover-capable pointer, the hover checks cannot run`); return; }
  await b.evaluate(`document.activeElement?.blur()`);
  const rest = await b.evaluate(opacityOf('.hps-shell-copy'));
  if (rest !== 0) bad.push(`${at}: copy is drawn at rest (opacity ${rest})`);
  const hover = await hoveredOpacity(b);
  if (hover !== 1) bad.push(`${at}: copy not drawn while the pointer is over the row (opacity ${hover})`);
  const focused = await tabFromSummary(b);
  if (!/\bhps-shell-copy\b/.test(focused.cls)) bad.push(`${at}: Tab from the summary lands on <${focused.tag} class="${focused.cls}">, not the copy button`);
  else if (focused.opacity !== 1) bad.push(`${at}: copy not drawn while it has keyboard focus (opacity ${focused.opacity})`);
  await b.evaluate(`document.activeElement?.blur()`);
}

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
    if (m.mono > 0.5) bad.push(`${at}: the command is not monospace (${m.mono.toFixed(1)}px apart)`);
    if (m.longHeight > 240.5 || m.longScroll <= 0 || !/^(auto|scroll)$/.test(m.longOverflow)) bad.push(`${at}: a long command block is ${m.longHeight.toFixed(0)}px, overflow ${m.longOverflow}, ${m.longScroll}px to scroll (want <=240px, scrolling)`);
    await copyChecks(b, at, bad);
    // Focus: the shared ring, measured. The button sits outside a scroll scope (+2px); the summary
    // and the scrolling <pre> sit inside .hps-messages (-2px, never clipped).
    for (const [sel, offset] of [['.hps-running-processes button', '2px'], ['.hps-shell-row summary', '-2px'], ['.hps-shell-row pre', '-2px'], ['.hps-shell-copy', '-2px']]) {
      const f = await ringOf(b, sel);
      if (!f) { bad.push(`${at}: no ${sel}`); continue; }
      if (f['outline-style'] !== 'solid' || f['outline-width'] !== '2px' || f['outline-offset'] !== offset) bad.push(`${at}: ${sel} ring ${f['outline-width']} ${f['outline-style']} offset ${f['outline-offset']} (want 2px solid ${offset})`);
      if (/rgba\(0, 0, 0, 0\)/.test(f['outline-color'])) bad.push(`${at}: ${sel} ring is transparent`);
    }
    if (shots) { mkdirSync(shots, { recursive: true }); const shot = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${shots}/${seat}-${tname}-${width}.png`, Buffer.from(shot.data, 'base64')); }
  }
  for (const [tname, t] of Object.entries(THEMES)) {
    await b.load(page(t, 'personal', extraCss), { width: 800, height: 900, dark: t.dark, forcedColors: true });
    for (const sel of ['.hps-running-processes button', '.hps-shell-row summary', '.hps-shell-copy']) {
      const f = await ringOf(b, sel);
      if (!f) { bad.push(`forced-colors/${tname}: no ${sel}`); continue; }
      if (f['outline-style'] !== 'solid' || f['outline-width'] !== '2px') bad.push(`forced-colors/${tname}: ${sel} ring ${f['outline-width']} ${f['outline-style']}`);
    }
    await copyChecks(b, `forced-colors/${tname}`, bad);
  }
  for (const [tname, t] of Object.entries(HC_THEMES)) {
    await b.load(page(t, 'personal', extraCss), { width: 800, height: 900, dark: t.dark });
    await copyChecks(b, tname, bad);
  }
  // Without a hover-capable pointer (touch) nothing can hover, so the button is always drawn.
  for (const [tname, t] of Object.entries(THEMES)) {
    await touch.load(page(t, 'personal', extraCss), { width: 320, height: 900, dark: t.dark });
    if (!(await touch.evaluate(`matchMedia('(hover: none)').matches`))) bad.push(`touch/${tname}: environment: the touch browser can hover`);
    else { const o = await touch.evaluate(opacityOf('.hps-shell-copy')); if (o !== 1) bad.push(`touch/${tname}: copy not drawn without hover (opacity ${o})`); }
  }
  return bad;
}

let b, touch;
try { b = await launch(bin, 1, { args: [DESKTOP_POINTER] }); touch = await launch(bin, 1, { args: [TOUCH_POINTER] }); } catch (e) {
  await b?.close();
  if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw e;
  console.log(`shell-process-layout NOT RUN: ${e.message}`); process.exit(0);
}
try {
  const bad = await check(b, '', process.env.SHELL_PROCESS_SCREENSHOTS);
  assert.deepEqual(bad, [], 'shipped cascade');
  console.log('  ok   shipped cascade: 2 seats x 2 themes x 3 widths + forced colours + high contrast + touch');
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
    'proportional command font': '.hps-shell-row pre, .hps-shell-row pre code { font-family: serif !important; }',
    'block grows without a cap': '.hps-shell-row pre { max-height: none !important; }',
    'block clips instead of scrolling': '.hps-shell-row pre { overflow: hidden !important; }',
    'copy never drawn': '.hps-shell-row .hps-shell-copy { opacity: 0 !important; }',
    'copy drawn at rest': '.hps-shell-copy { opacity: 1 !important; }',
    'copy only on hover, not on focus': '.hps-shell-row:focus-within .hps-shell-copy { opacity: 0; } .hps-shell-row:hover .hps-shell-copy { opacity: 1 !important; }',
    'copy out of the tab order': '.hps-shell-copy { visibility: hidden; }',
    'copy over the command': '.hps-shell-block { position: relative; } .hps-shell-copy { position: absolute; inset-block-start: 0; inset-inline-end: 0; }',
    'small copy target': '.hps-shell-copy { min-height: 0; min-width: 0; height: 24px; width: 24px; }',
    'copy has no edge': '.hps-shell-copy { border: 0 !important; }',
    'copy fades in': '.hps-shell-copy { transition: opacity 160ms; }',
    'copy hidden on touch': '@media (hover: none) { .hps-shell-copy { opacity: 0 !important; } }',
  };
  for (const [name, extra] of Object.entries(overrides)) {
    const caught = await check(b, extra);
    assert.ok(caught.length > 0, `self-test "${name}" was not detected`);
    console.log(`  ok   self-test detects: ${name} (${caught[0]})`);
  }
  console.log('shell-process-layout: PASS');
} finally { await b.close(); await touch.close(); }
