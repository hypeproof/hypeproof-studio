// CGP-VOICE-R-009 (REQ-CGPV-14 / DES-CGPV-14): the "보여주기" menu in the expanded voice panel,
// measured on the CASCADE in headless Chromium.
//   node --experimental-strip-types test/voice-show-this-menu.smoke.mjs
//
// The real VoicePanel is rendered with the shipped stylesheet order in dark and light themes at
// 1420x800 and 800x800, and once in forced colours. Read from the DOM, layout rects and computed
// styles, never rule text:
//   - opening asks the host (onOpen) every time; the menu lists exactly 열린 파일 and 미리보기 화면,
//     even when the host payload carries a third "전체 화면" entry; no whole-screen text exists;
//   - a disabled item is a disabled button with its reason written next to it (visible, linked
//     by aria-describedby);
//   - a real mouse click on an enabled item calls onAttach once with that target, closes the menu
//     and returns focus to 보여주기; a second attach needs a second open and click;
//   - while an attach is pending every item is disabled and the status line says so;
//   - Escape inside the menu closes the menu only; the next Escape still ends the session (VO-41);
//   - targets at least 44x44, text at least 14px (menu, reasons, notice, reference line), focus
//     ring at least 2px, nothing wider than the panel;
//   - forced colours: the disabled item keeps a visible border.
// VoicePanel is not mounted by any screen yet (voice is planned, REQ-R1), so seats do not apply:
// this measures the component a seat will mount. Without a headless Chromium this prints NOT RUN;
// FOCUS_REQUIRE_BROWSER=1 (set by CI) makes that a failure. Evidence PNGs: VOICE_SHOW_EVIDENCE=<dir>.
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { findChromium, launch } from './lib/headless-chromium.mjs';
import { THEMES } from './lib/vscode-default-themes.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const SRC = resolve(root, 'webview-ui/src');

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('voice-show-this-menu: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('voice-show-this-menu NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)');
  process.exit(0);
}

const others = readdirSync(SRC).filter((f) => f.endsWith('.css') && !['tokens.css', 'designTokens.css', 'styles.css', 'chatDetails.css'].includes(f)).sort();
const cssBuild = await build({
  stdin: { contents: ['tokens.css', ...others, 'styles.css', 'chatDetails.css'].map((f) => `@import "./${f}";`).join('\n'), resolveDir: SRC, loader: 'css' },
  bundle: true, write: false, outdir: 'out', logLevel: 'silent',
  plugins: [{ name: 'external', setup(b) { b.onResolve({ filter: /\.(svg|png|jpe?g|gif|webp|woff2?)$/ }, (a) => ({ path: a.path, external: true })); } }],
});
const css = cssBuild.outputFiles.find((o) => o.path.endsWith('.css')).text;

const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { VoicePanel } from './VoicePanel.tsx';
import { initialPopupState, meterView } from '../../src/voicePopupHelpers.ts';
import { initialVoiceSession } from '../../src/voiceSessionHelpers.ts';
window.actions = [];
window.state = { items: null, pending: null, notice: null };
const session = { ...initialVoiceSession(), state: 'listening', captureOpen: true, listeningSessions: 1 };
let root = null;
window.render = () => {
  root ??= createRoot(document.getElementById('root'));
  root.render(<VoicePanel coachName="발표 도우미" session={session} popup={{ ...initialPopupState(), presentation: 'expanded' }}
    meter={meterView(session, { inputLevel: .4, outputPlaying: false, outputLevel: null }, { reduceMotion: false })}
    reference={{ artifactId: 'site/index.html', title: 'site/index.html', revision: 'v7-3fa9c2d1e0b4' }} info={[]} finalTranscript={null} partialTranscript={null} failure={null}
    onMinimize={() => {}} onExpand={() => {}} onToggleMute={() => {}} onResume={() => {}} onStopSpeaking={() => {}}
    onDismiss={(k) => window.actions.push('dismiss:' + k)} onRetry={() => {}}
    showThis={{ ...window.state, onOpen: () => window.actions.push('open'), onAttach: (t) => window.actions.push('attach:' + t) }} />);
};
`;
const jsBuild = await build({ stdin: { contents: fixture, loader: 'tsx', resolveDir: SRC }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', logLevel: 'silent' });
const js = jsBuild.outputFiles[0].text;

const evidence = process.env.VOICE_SHOW_EVIDENCE;
if (evidence) mkdirSync(evidence, { recursive: true });
const delay = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const HOST_ITEMS = [
  { target: 'screen', label: '전체 화면', enabled: true, reason: null },
  { target: 'editor_file', label: '열린 파일', enabled: false, reason: '저장하지 않은 바뀐 내용이 있어요. 저장한 뒤 보여 주세요.' },
  { target: 'preview_tab', label: '미리보기 화면', enabled: true, reason: null },
];

const browser = await launch(bin);
const key = async (k) => {
  for (const type of ['keyDown', 'keyUp']) await browser.send('Input.dispatchKeyEvent', { type, key: k, code: k, windowsVirtualKeyCode: k === 'Escape' ? 27 : 0 });
  await delay();
};
const click = async (selector) => {
  const r = await browser.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  assert.ok(r, `no element ${selector}`);
  for (const type of ['mousePressed', 'mouseReleased']) await browser.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
  await delay();
};
const setState = (s) => browser.evaluate(`window.state = ${JSON.stringify(s)}; window.render()`).then(() => delay());
const measure = () => browser.evaluate(`(() => {
  const panel = document.querySelector('.hps-voice-panel');
  const show = document.querySelector('.hps-voice-show');
  const menu = document.querySelector('.hps-voice-show-menu');
  const items = menu ? [...menu.querySelectorAll('button')] : [];
  const texts = [...show.querySelectorAll('button, .hps-voice-show-reason, .hps-voice-show-notice'), document.querySelector('.hps-voice-reference')].filter((e) => e.textContent.trim()).map((e) => parseFloat(getComputedStyle(e).fontSize));
  const buttons = [...show.querySelectorAll('button')].map((b) => { const r = b.getBoundingClientRect(); return [r.width, r.height]; });
  const reasonFor = (b) => { const id = b.getAttribute('aria-describedby'); const e = id && document.getElementById(id); return e ? { text: e.textContent, h: e.getBoundingClientRect().height, visible: getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none' } : null; };
  const pr = panel.getBoundingClientRect();
  return {
    open: !!menu, expanded: show.querySelector('.hps-voice-show-toggle').getAttribute('aria-expanded'),
    items: items.map((b) => ({ target: b.dataset.target, label: b.textContent, disabled: b.disabled, reason: reasonFor(b), border: getComputedStyle(b).borderTopStyle !== 'none' && parseFloat(getComputedStyle(b).borderTopWidth) > 0 })),
    whole: /전체 화면|화면 전체|데스크톱/.test(document.body.textContent),
    status: show.querySelector('[role=status]:last-child')?.textContent ?? '',
    focus: document.activeElement?.className ?? '',
    minText: Math.min(...texts), buttons,
    inside: [...show.querySelectorAll('*')].every((e) => { const r = e.getBoundingClientRect(); return r.width === 0 || (r.left >= pr.left - 0.5 && r.right <= pr.right + 0.5); }),
    overflow: panel.scrollWidth - panel.clientWidth,
  };
})()`);

let cases = 0;
try {
  for (const dark of [true, false]) for (const [width, height] of [[1420, 800], [800, 800]]) for (const forcedColors of (dark && width === 800 ? [false, true] : [false])) {
    const label = `${dark ? 'dark' : 'light'}-${width}${forcedColors ? '-forced' : ''}`;
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await browser.load(`<!doctype html><html style="${vars}"><head><style>${css}</style></head><body class="${dark ? 'vscode-dark' : 'vscode-light'}"><div id="root"></div><script>window.errors = []; addEventListener('error', (e) => window.errors.push(String(e.message)));</script><script>${js}</script></body></html>`, { width, height, dark, forcedColors });
    await browser.evaluate(`window.actions = []; window.state = { items: null, pending: null, notice: null }; window.render()`); await delay(150);

    let m = await measure();
    assert.equal(m.open, false, `${label}: menu open before a click`);
    assert.deepEqual(await browser.evaluate('window.actions'), [], `${label}: host asked before a click`);

    // Open: the host is asked; until it answers, the menu says it is checking and offers nothing.
    await click('.hps-voice-show-toggle');
    assert.deepEqual(await browser.evaluate('window.actions'), ['open'], `${label}: open did not ask the host`);
    m = await measure();
    assert.equal(m.open, true); assert.equal(m.expanded, 'true'); assert.equal(m.items.length, 0, `${label}: items before the host answered`);
    await setState({ items: HOST_ITEMS, pending: null, notice: null });
    m = await measure();
    assert.deepEqual(m.items.map((i) => [i.target, i.label, i.disabled]), [['editor_file', '열린 파일', true], ['preview_tab', '미리보기 화면', false]], `${label}: menu items ${JSON.stringify(m.items)}`);
    assert.equal(m.whole, false, `${label}: a whole-screen item is drawn`);
    const reason = m.items[0].reason;
    assert.ok(reason && reason.visible && reason.h > 0 && reason.text === HOST_ITEMS[1].reason, `${label}: disabled reason not shown next to the item ${JSON.stringify(reason)}`);
    assert.equal(m.items[1].reason, null, `${label}: enabled item carries a reason`);
    assert.ok(m.buttons.every(([w, h]) => w >= 44 && h >= 44), `${label}: target under 44px ${JSON.stringify(m.buttons)}`);
    assert.ok(m.minText >= 14, `${label}: text ${m.minText}px under 14px`);
    assert.equal(m.inside, true, `${label}: menu wider than the panel`); assert.ok(m.overflow <= 0, `${label}: panel scrolls sideways ${m.overflow}`);
    if (forcedColors) assert.equal(m.items[0].border, true, `${label}: disabled item lost its border in forced colours`);
    const ring = await browser.focusVisibleStyle('.hps-voice-show-menu button[data-target="preview_tab"]', ['outline-width', 'outline-style']);
    assert.ok(parseFloat(ring['outline-width']) >= 2 && ring['outline-style'] !== 'none', `${label}: focus ring ${JSON.stringify(ring)}`);
    if (evidence) writeFileSync(`${evidence}/${label}-menu.png`, Buffer.from((await browser.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

    // Clicking the disabled item does nothing.
    await click('.hps-voice-show-menu button[data-target="editor_file"]');
    assert.deepEqual(await browser.evaluate('window.actions'), ['open'], `${label}: disabled item attached`);
    // A real click on the enabled item: one attach, menu closed, focus back on 보여주기.
    await click('.hps-voice-show-menu button[data-target="preview_tab"]');
    assert.deepEqual(await browser.evaluate('window.actions'), ['open', 'attach:preview_tab'], `${label}: click did not attach exactly once`);
    m = await measure();
    assert.equal(m.open, false, `${label}: menu stayed open after attaching`);
    assert.match(m.focus, /hps-voice-show-toggle/, `${label}: focus not returned to 보여주기`);
    // Pending: every item waits, the status line says so.
    await setState({ items: HOST_ITEMS, pending: 'preview_tab', notice: null });
    await click('.hps-voice-show-toggle');
    m = await measure();
    assert.ok(m.items.length === 2 && m.items.every((i) => i.disabled), `${label}: items usable while an attach is pending`);
    assert.equal(m.status, '보여 줄 것을 붙이는 중이에요', `${label}: pending not said`);
    await click('.hps-voice-show-menu button[data-target="preview_tab"]');
    assert.equal((await browser.evaluate('window.actions')).filter((a) => a.startsWith('attach')).length, 1, `${label}: pending click attached`);
    // Result notice, then a second attach needs a second open and click.
    await setState({ items: HOST_ITEMS, pending: null, notice: '미리보기 화면을 붙였어요.' });
    m = await measure();
    assert.equal(m.status, '미리보기 화면을 붙였어요.');
    await click('.hps-voice-show-menu button[data-target="preview_tab"]');
    assert.deepEqual((await browser.evaluate('window.actions')).filter((a) => a.startsWith('attach')), ['attach:preview_tab', 'attach:preview_tab'], `${label}: second click`);
    assert.equal((await measure()).open, false);
    if (evidence) writeFileSync(`${evidence}/${label}-attached.png`, Buffer.from((await browser.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

    // Escape closes the menu only; the next Escape ends the session.
    await click('.hps-voice-show-toggle');
    await browser.evaluate(`document.querySelector('.hps-voice-show-menu button[data-target="preview_tab"]').focus()`);
    await key('Escape');
    m = await measure();
    assert.equal(m.open, false, `${label}: Escape left the menu open`);
    assert.ok(!(await browser.evaluate('window.actions')).some((a) => a.startsWith('dismiss')), `${label}: Escape in the menu ended the session`);
    assert.match(m.focus, /hps-voice-show-toggle/);
    await key('Escape');
    assert.ok((await browser.evaluate('window.actions')).includes('dismiss:escape'), `${label}: Escape no longer ends the session`);
    assert.deepEqual(await browser.evaluate('window.errors'), [], `${label}: page errors`);
    cases++;
  }
  console.log(`PASS voice-show-this-menu: ${cases} theme/width cases; two Studio targets only, reasons shown, one click = one attach, pending/notice, Escape order, 44px/14px/ring, inside the panel`);
} finally {
  await browser.close();
}
