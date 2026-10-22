// CGP-DS-D-021: the shared hint, measured and driven in headless Chromium on the REAL components.
//   node --experimental-strip-types test/tooltip-browser.smoke.mjs
//
// Real ChatPanel (personal + classroom), TaskWorkspace and WriteApprovalDialog markup is rendered into
// the shipped stylesheet order (main.tsx: tokens, focusGeometry, component css, styles, chatDetails,
// tooltips) and the real tooltips.ts runs in the page. Computed styles are read, never rule text:
//   - font-size 14px, border-radius 8px, padding 4px 8px (all four sides), in dark, light and forced
//     colours, at 1420 and 800 px;
//   - the hint appears on mouse hover (after 500 ms, not before) and on keyboard focus, on every
//     surface that shipped a hint, including a focus that scrolls the page, and a control inside a
//     modal <dialog>;
//   - Escape and a real wheel scroll dismiss it; a scroll that only follows a focus does not;
//   - every migrated control keeps its own accessible name (aria-label or text), the hint is aria-hidden.
// Input is sent through the DevTools protocol to the headless target only, never to the OS.
// Self-test: the matrix runs again with seven injected defects (a cascade override of each property, an
// @media override, a hint dropped on ChatPanel / TaskWorkspace / WriteApprovalDialog, and the old
// scroll-dismisses-every-focus behaviour); each must be caught.
// Without a headless Chromium this prints NOT RUN; FOCUS_REQUIRE_BROWSER=1 (set by CI) makes that a failure.
import assert from 'node:assert/strict';
import { readdirSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, transform } from 'esbuild';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const SRC = resolve(root, 'webview-ui/src');

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('tooltip-browser: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('tooltip-browser NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)');
  process.exit(0);
}

// ---------- the stylesheets as shipped (main.tsx import order) ----------
const FIRST = ['tokens.css', 'focusGeometry.css'];
const LAST = ['styles.css', 'chatDetails.css', 'tooltips.css'];
const middle = readdirSync(SRC).filter((f) => f.endsWith('.css') && f !== 'designTokens.css' && ![...FIRST, ...LAST].includes(f)).sort();
const bundled = await build({
  stdin: { contents: [...FIRST, ...middle, ...LAST].map((f) => `@import "./${f}";`).join('\n'), resolveDir: SRC, loader: 'css' },
  bundle: true, write: false, outdir: 'out', logLevel: 'silent',
  plugins: [{ name: 'external', setup(b) { b.onResolve({ filter: /\.(svg|png|jpe?g|gif|webp|woff2?)$/ }, (a) => ({ path: a.path, external: true })); } }],
});
const css = bundled.outputFiles.find((o) => o.path.endsWith('.css')).text;

// ---------- the real hint script ----------
const tooltipSource = readFileSync(join(SRC, 'tooltips.ts'), 'utf8');
const compile = async (source) => (await transform(source, { loader: 'ts', format: 'iife', globalName: 'HpsTooltips', target: 'es2022' })).code + '\nHpsTooltips.installTooltips(document);';
const script = await compile(tooltipSource);
// The behaviour this file exists to keep: before the fix every scroll dismissed, including the one a focus causes.
if (!/\['scroll', scrolled\]/.test(tooltipSource)) throw new Error('tooltips.ts no longer registers its scroll handler as `scrolled`; update the mutation in tooltip-browser.smoke.mjs');
const oldScrollScript = await compile(tooltipSource.replace("['scroll', scrolled]", "['scroll', dismiss]"));

// ---------- the real markup ----------
const dir = mkdtempSync(join(tmpdir(), 'tooltip-browser-'));
const markup = {};
try {
  const out = join(dir, 'render.cjs');
  await build({
    stdin: { contents: [
      'export { ChatPanel } from "./webview-ui/src/ChatPanel";',
      'export { TaskWorkspace } from "./webview-ui/src/TaskWorkspace";',
      'export { WriteApprovalDialog } from "./webview-ui/src/WriteApprovalDialog";',
      'export { renderToStaticMarkup } from "react-dom/server"; export { createElement } from "react";',
    ].join('\n'), resolveDir: root, loader: 'tsx' },
    bundle: true, platform: 'node', format: 'cjs', outfile: out, jsx: 'automatic', loader: { '.css': 'empty', '.svg': 'empty' },
    alias: { react: join(root, 'webview-ui/node_modules/react'), 'react-dom': join(root, 'webview-ui/node_modules/react-dom') },
    banner: { js: 'globalThis.window = { innerWidth: 1420, acquireVsCodeApi: undefined, addEventListener() {}, removeEventListener() {} };' }, logLevel: 'error',
  });
  const { ChatPanel, TaskWorkspace, WriteApprovalDialog, renderToStaticMarkup, createElement } = createRequire(import.meta.url)(out);
  const originalError = console.error;
  console.error = (...args) => { if (!String(args[0]).includes('useLayoutEffect does nothing on the server')) originalError(...args); };
  const noop = () => {};
  const ux = { coach: { naming_mode: 'fixed', fallback_name: 'HypeProof' }, suggestions: { initial: [], follow_up: [] }, hints: { short_input: { enabled: false }, roll_input_button: { enabled: false } }, retry_button: { enabled: false } };
  for (const seat of ['personal', 'classroom']) {
    markup[`ChatPanel/${seat}`] = renderToStaticMarkup(createElement(ChatPanel, { messages: [], streaming: false, config: { hasToken: true, profile: { ux, welcome: { greeting_md: '' }, profile_id: 'studio-native-trial', activity_kind: 'trial', lesson: null }, activity: { id: 'a1', verified: true, workspace: '/tmp/synthetic' }, coach: { name: 'HypeProof', configured: true }, taskWorkspace: seat === 'personal' ? { tasks: [], sources: [] } : undefined }, onSend: noop, onCancel: noop, onSettings: noop, onSetToken: noop }));
  }
  const view = { scope: 's', revision: 1, activeTaskId: 'a', tasks: [{ id: 'a', title: '첫 작업', createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null };
  markup['TaskWorkspace'] = renderToStaticMarkup(createElement(TaskWorkspace, { view, messages: [], busy: false, error: null, runState: null, onDismissError: noop }, createElement('div')));
  markup['WriteApprovalDialog'] = renderToStaticMarkup(createElement(WriteApprovalDialog, { prompt: { id: 'p1', title: '파일을 바꿀게요', verb: '바꾸기', files: ['notes/오늘 할 일.md', 'index.html', 'a-very-long-file-name-that-needs-the-full-name-on-hover-and-focus.txt'] }, onAnswer: noop }));
  console.error = originalError;
} finally { rmSync(dir, { recursive: true, force: true }); }

// Selectors of one hint-carrying control per surface that shipped a hint (the first match is driven).
const TRIGGERS = {
  'ChatPanel/personal': ['button[data-hp-tooltip="대화 메뉴"]'],
  'ChatPanel/classroom': ['button[data-hp-tooltip="설정"]', 'button[data-hp-tooltip="대화 기록 지우기"]'],
  'TaskWorkspace': ['.tw-title-button[data-hp-tooltip]', '.tw-chat-menu-toggle[data-hp-tooltip]'],
  'WriteApprovalDialog': ['.hps-write-chip[data-hp-tooltip]'],
};
const MODES = {
  dark: { cls: 'vscode-dark', dark: true, forced: false, v: { 'editor-background': '#1f1f1f', 'input-background': '#313131', foreground: '#cccccc', descriptionForeground: '#9d9d9d', 'input-foreground': '#cccccc' } },
  light: { cls: 'vscode-light', dark: false, forced: false, v: { 'editor-background': '#ffffff', 'input-background': '#ffffff', foreground: '#3b3b3b', descriptionForeground: '#717171', 'input-foreground': '#3b3b3b' } },
  forced: { cls: 'vscode-high-contrast', dark: true, forced: true, v: {} },
};
const WIDTHS = [1420, 800];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const documentFor = (mode, key, html, { spacer = 0 } = {}) => {
  const vars = Object.entries(mode.v).map(([k, v]) => `--vscode-${k}:${v}`).join(';');
  return { head: `<!doctype html><html><head><meta charset="utf-8"><style>:root{${vars}}`, body: `</style></head><body class="${mode.cls}" style="margin:0;background:var(--vscode-editor-background,Canvas);color:var(--vscode-foreground,CanvasText)">${spacer ? `<div style="height:${spacer}px"></div>` : ''}${html}</body></html>` };
};

// In-page probes. `tip()` reads the computed style of the one `.hp-tooltip` element.
const tipState = `(() => {
  const t = document.querySelector('.hp-tooltip');
  if (!t) return null;
  const s = getComputedStyle(t), r = t.getBoundingClientRect();
  return { hidden: t.hidden || s.display === 'none', text: t.textContent, ariaHidden: t.getAttribute('aria-hidden'), font: s.fontSize, radius: [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius],
    padding: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft], border: [s.borderTopWidth, s.borderTopStyle], color: s.color, background: s.backgroundColor, position: s.position, pointer: s.pointerEvents,
    rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, inViewport: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, parent: t.parentElement && t.parentElement.tagName, scrollY: Math.round(scrollY) };
})()`;
const rectOf = (selector) => `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; })()`;

const CLASSIC = '*::-webkit-scrollbar{width:15px;height:15px}*::-webkit-scrollbar-thumb{background:#888}*::-webkit-scrollbar-track{background:#ddd}';
const measure = async ({ classic = false, extraCss = classic ? CLASSIC : '', transformMarkup = (_k, html) => html, tipScript = script } = {}) => {
  const bad = [];
  const b = await launch(bin);
  const mouse = (x, y) => b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  const wheel = (x, y, deltaY) => b.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY });
  const escape = async () => { await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    // Chromium's close watcher closes a modal on a repeated Escape even when `cancel` is prevented; the component
    // answers and unmounts instead. Put the static dialog back so the next step still runs inside a modal.
    await sleep(40);
    const state = await b.evaluate(`({ hidden: (${tipState}).hidden, focus: document.activeElement?.hasAttribute('data-hp-tooltip') })`);
    await b.evaluate(`(() => { const d = document.querySelector('dialog.hps-write-approval'); if (d && !d.open) d.showModal(); return 0; })()`);
    return state;
  };
  const open = async (mode, width, key, opts) => {
    const d = documentFor(mode, key, transformMarkup(key, markup[key]), opts);
    await b.load(`${d.head}${css}${extraCss}${d.body}`, { width, height: 800, dark: mode.dark, forcedColors: mode.forced });
    // The component's onCancel keeps the dialog open on Escape (it answers instead); the static markup has no React handler.
    if (key === 'WriteApprovalDialog') await b.evaluate(`(() => { const d = document.querySelector('dialog'); d.addEventListener('cancel', (e) => e.preventDefault()); d.showModal(); return 0; })()`);
    await b.evaluate(tipScript);
    // Let the resize / focus events a media or viewport emulation queued for the next frame arrive now, not after the
    // first focus: a late window `resize` or `blur` rightly dismisses a hint and would read as a missing one.
    await b.evaluate(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`).catch(() => {});
    return b.evaluate(`window.scrollTo(0, 0), 0`);
  };
  // A control that already holds focus (showModal focuses the first one) must lose it first, or no focusin fires.
  const focusFresh = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (document.activeElement === e) e.blur(); e.focus(); return 0; })()`;
  const find = async (key) => { for (const sel of TRIGGERS[key]) { if (await b.evaluate(`!!document.querySelector(${JSON.stringify(sel)})`)) return sel; } return null; };
  try {
    // 1. Computed geometry of the hint in every mode and width, after a keyboard focus on a real control.
    for (const [mname, mode] of Object.entries(MODES)) for (const width of WIDTHS) for (const key of Object.keys(markup)) {
      const at = `${key} ${mname} ${width}px`;
      await open(mode, width, key);
      const sel = await find(key);
      if (!sel) { bad.push(`${at}: no control carries data-hp-tooltip (${TRIGGERS[key].join(' | ')})`); continue; }
      await b.evaluate(focusFresh(sel));
      await sleep(60);
      const t = await b.evaluate(tipState);
      if (!t || t.hidden) { bad.push(`${at}: focus on ${sel} shows no hint ${JSON.stringify(await b.evaluate(`(() => { const d = document.querySelector('dialog'); const a = document.activeElement; const r = a.getBoundingClientRect(); return { active: a.outerHTML.slice(0, 80), focus: document.hasFocus(), y: scrollY, dlg: d && { top: d.scrollTop, sh: d.scrollHeight, ch: d.clientHeight, ow: d.offsetWidth, cw: d.clientWidth }, chip: { l: r.left, t: r.top, w: r.width, h: r.height }, vw: innerWidth, vh: innerHeight }; })()`))}`); continue; }
      if (t.font !== '14px') bad.push(`${at}: font-size ${t.font} not 14px`);
      if (t.radius.some((r) => r !== '8px')) bad.push(`${at}: border-radius ${t.radius.join('/')} not 8px`);
      if (t.padding.join(' ') !== '4px 8px 4px 8px') bad.push(`${at}: padding ${t.padding.join(' ')} not 4px 8px`);
      if (t.border[0] !== '1px' || t.border[1] !== 'solid') bad.push(`${at}: border ${t.border.join(' ')}`);
      if (t.position !== 'fixed' || t.pointer !== 'none') bad.push(`${at}: position ${t.position} / pointer-events ${t.pointer}`);
      if (t.ariaHidden !== 'true') bad.push(`${at}: hint is not aria-hidden`);
      if (t.color === t.background) bad.push(`${at}: hint ink equals its surface (${t.color})`);
      if (!t.inViewport) bad.push(`${at}: hint outside the viewport ${JSON.stringify(t.rect)}`);
      if (key === 'WriteApprovalDialog' && t.parent !== 'DIALOG') bad.push(`${at}: hint is not inside the modal dialog (${t.parent}), so it would sit behind it`);
      // Every migrated control keeps its own name: aria-label, or visible text.
      const nameless = await b.evaluate(`[...document.querySelectorAll('button[data-hp-tooltip], a[data-hp-tooltip], summary[data-hp-tooltip], [tabindex][data-hp-tooltip]')].filter((e) => !(e.getAttribute('aria-label') || e.textContent.trim() || e.querySelector('[aria-label]'))).map((e) => e.outerHTML.slice(0, 80))`);
      if (nameless.length) bad.push(`${at}: controls with a hint and no accessible name: ${nameless.join(' ; ')}`);
      if (await b.evaluate(`[...document.querySelectorAll('[data-hp-tooltip]')].some((e) => e.hasAttribute('title') && e.getAttribute('title') === e.getAttribute('data-hp-tooltip'))`)) bad.push(`${at}: a control carries both title= and data-hp-tooltip= (native tooltip would double up)`);
    }

    // 2. Behaviour on the real controls (dark, 1420): hover delay, focus, Escape, wheel scroll.
    const dark = MODES.dark;
    for (const key of Object.keys(markup)) {
      const at = `${key} behaviour`;
      await open(dark, 1420, key);
      const sel = await find(key);
      if (!sel) continue; // already reported above
      const r = await b.evaluate(rectOf(sel));
      await mouse(5, 5); await sleep(30);
      await mouse(r.x, r.y); await sleep(300);
      if (!(await b.evaluate(tipState)).hidden) bad.push(`${at}: hover shows the hint before 500 ms`);
      await sleep(400);
      const hovered = await b.evaluate(tipState);
      if (hovered.hidden || hovered.text.length === 0) bad.push(`${at}: no hint after hovering ${sel} for 700 ms`);
      if (!(await escape()).hidden) bad.push(`${at}: Escape does not dismiss a hover hint`);
      await mouse(5, 5); await sleep(30);
      await b.evaluate(focusFresh(sel)); await sleep(30);
      if ((await b.evaluate(tipState)).hidden) bad.push(`${at}: keyboard focus shows no hint at once ${JSON.stringify(await b.evaluate('({a: document.activeElement.outerHTML.slice(0,100), y: scrollY})'))}`);
      const afterEsc = await escape();
      if (!afterEsc.hidden) bad.push(`${at}: Escape does not dismiss a focus hint`);
      if (!afterEsc.focus && key !== 'WriteApprovalDialog') bad.push(`${at}: Escape moved focus off the control (${JSON.stringify(afterEsc)})`);
    }

    // 3. Focus that scrolls the page: the control sits 2400 px below the fold in the real component's page.
    for (const key of ['ChatPanel/personal', 'TaskWorkspace', 'WriteApprovalDialog']) {
      const at = `${key} below the fold`;
      await open(dark, 1420, key, { spacer: key === 'WriteApprovalDialog' ? 0 : 2400 });
      const sel = await find(key);
      if (!sel) continue;
      // Keep the pointer off the page: a control that scrolls under a resting pointer is a hover on another control, not the focus case.
      await mouse(2, 2); await sleep(30);
      // A modal dialog does not scroll the page; it scrolls its own list, so shrink the dialog and push the chip down.
      if (key === 'WriteApprovalDialog') await b.evaluate(`(() => { const d = document.querySelector('dialog'); d.style.maxHeight = '120px'; d.style.overflow = 'auto'; document.querySelector('.hps-write-files').style.paddingTop = '600px'; return 0; })()`);
      const before = await b.evaluate(`({ y: scrollY, dy: document.querySelector('dialog')?.scrollTop ?? 0 })`);
      await b.evaluate(focusFresh(sel));
      await sleep(450);
      const t = await b.evaluate(tipState);
      const after = await b.evaluate(`({ y: scrollY, dy: document.querySelector('dialog')?.scrollTop ?? 0 })`);
      if (after.y <= before.y && after.dy <= before.dy) bad.push(`${at}: the focus did not scroll anything, so the case is not exercised`);
      else if (t.hidden) bad.push(`${at}: the hint is hidden after focus scrolled the control into view (scroll ${before.y}->${after.y}) `);
      else if (!t.inViewport) bad.push(`${at}: the hint is outside the viewport after the focus scroll ${JSON.stringify(t.rect)}`);
      else {
        const c = await b.evaluate(rectOf(sel));
        if (Math.abs(t.rect.top - c.y) > 200) bad.push(`${at}: the hint was not re-placed next to the scrolled control (hint top ${t.rect.top}, control ${c.y})`);
      }
      // A real wheel scroll dismisses it ...
      if (!t.hidden && key !== 'WriteApprovalDialog') {
        await mouse(700, 400); await wheel(700, 400, 120); await sleep(250);
        if (!(await b.evaluate(tipState)).hidden) bad.push(`${at}: a real wheel scroll does not dismiss the focus hint`);
        // ... and so does a scroll long after the focus.
        await b.evaluate(focusFresh(sel));
        await sleep(2000);
        const still = await b.evaluate(tipState);
        await b.evaluate(`window.scrollBy(0, 40); 0`); await sleep(150);
        if (!still.hidden && !(await b.evaluate(tipState)).hidden) bad.push(`${at}: a scroll long after the focus does not dismiss the hint`);
      }
    }
  } finally { await b.close(); }
  return bad;
};

// Linux CI Chrome draws classic 15 px scrollbars that take layout width; macOS overlay ones do not. Run both.
for (const classic of [false, true]) {
const baseline = await measure({ classic });
assert.deepEqual(baseline, [], `tooltip browser (${classic ? 'classic 15px scrollbars' : 'overlay scrollbars'}):\n${baseline.slice(0, 15).join('\n')}`);
console.log(`  ok   ${classic ? '[classic scrollbars] ' : ''}${Object.keys(markup).length} real surfaces x ${Object.keys(MODES).length} modes x ${WIDTHS.length} widths: 14px, radius 8px, padding 4px 8px; hover 500 ms, focus, Escape, wheel, focus-scroll`);
}

// ---------- the guard must fail on the defects the declaration-level tests missed ----------
const dropHint = (match) => (key, html) => (match.test(key) ? html.replace(/ data-hp-tooltip="[^"]*"/g, '') : html);
const revertToTitle = (match) => (key, html) => (match.test(key) ? html.replace(/data-hp-tooltip=/g, 'title=') : html);
const MUTATIONS = [
  ['later higher-specificity font-size', { extraCss: 'body .hp-tooltip.hp-tooltip { font-size: 12px; }' }],
  ['later higher-specificity radius and padding', { extraCss: '.hps-shell .hp-tooltip, body .hp-tooltip, dialog .hp-tooltip { border-radius: 4px; padding: 10px; }' }],
  ['@media padding and radius', { extraCss: '@media (max-width: 900px) { body .hp-tooltip { padding: 2px 4px; border-radius: 2px; } }' }],
  ['TaskWorkspace hint reverted to title=', { transformMarkup: revertToTitle(/^TaskWorkspace$/) }],
  ['ChatPanel hint dropped', { transformMarkup: dropHint(/^ChatPanel\//) }],
  ['WriteApprovalDialog hint dropped', { transformMarkup: dropHint(/^WriteApprovalDialog$/) }],
  ['every scroll dismisses, including the one a focus causes (old behaviour)', { tipScript: oldScrollScript }],
];
for (const [name, options] of MUTATIONS) {
  const caught = await measure(options);
  assert.ok(caught.length > 0, `mutation not caught: ${name}`);
  console.log(`  ok   caught: ${name} (${caught.length} findings, e.g. ${caught[0]})`);
}
console.log('tooltip-browser PASS');
