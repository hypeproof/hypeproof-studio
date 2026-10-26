// CGP-VOICE-R-008 (REQ-CGPV-12 / DES-CGPV-12, VO-47): the compact voice control moves between
// the four viewport corners by keyboard, measured on the CASCADE in headless Chromium.
//   node --experimental-strip-types test/voice-compact-corner.smoke.mjs
//
// The real VoicePanel (compact presentation) is rendered with the shipped stylesheet order in
// dark and light themes at 1420x800, 800x800 and 320x480, and once in forced colours. Read from
// layout rects and computed styles, never rule text:
//   - arrow keys snap to each corner, 16px from the visible viewport edges (inside any classic scrollbar), and Home returns to the
//     home corner (top right); a modified arrow or Home moves nothing;
//   - focus stays on the control that had it, and the move is announced in a status region;
//   - the control is fully inside the viewport in every corner at every width;
//   - pressing the move button steps clockwise (pointer users are not left out);
//   - the corner is remembered per window: a remount reads it back from the store; a corrupt
//     value or a throwing store falls back to the home corner and moves still work;
//   - a pointer drag does not move it (no drag-to-hide);
//   - every button is at least 44x44, every visible text at least 14px, focus ring at least 2px;
//   - movement eases only when motion is allowed; under prefers-reduced-motion it is instant;
//   - Escape still ends the session from the compact control (VO-41).
// VoicePanel is not mounted by any screen yet (voice is planned, REQ-R1), so seats do not apply:
// this measures the component that a seat will mount. Without a headless Chromium this prints
// NOT RUN; FOCUS_REQUIRE_BROWSER=1 (set by CI) makes that a failure.
// Evidence PNGs: set VOICE_CORNER_EVIDENCE=<dir>.
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
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('voice-compact-corner: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('voice-compact-corner NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)');
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
window.store = { value: null, throws: false };
const store = { read: () => { if (window.store.throws) throw new Error('blocked'); return window.store.value; }, write: (v) => { if (window.store.throws) throw new Error('blocked'); window.store.value = v; } };
const session = { ...initialVoiceSession(), state: 'listening', captureOpen: true, listeningSessions: 1 };
let root = null;
window.mount = () => {
  if (root) root.unmount();
  document.getElementById('root').replaceChildren();
  root = createRoot(document.getElementById('root'));
  root.render(<VoicePanel coachName="발표 도우미" session={session} popup={{ ...initialPopupState(), presentation: 'compact' }}
    meter={meterView(session, { inputLevel: .4, outputPlaying: false, outputLevel: null }, { reduceMotion: false })}
    reference={null} info={[]} finalTranscript={null} partialTranscript={null} failure={null}
    onMinimize={() => {}} onExpand={() => window.actions.push('expand')} onToggleMute={() => window.actions.push('mute')}
    onResume={() => {}} onStopSpeaking={() => {}} onDismiss={(k) => window.actions.push(k)} onRetry={() => {}} cornerStore={store} />);
};
`;
const jsBuild = await build({ stdin: { contents: fixture, loader: 'tsx', resolveDir: SRC }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', logLevel: 'silent' });
const js = jsBuild.outputFiles[0].text;

const evidence = process.env.VOICE_CORNER_EVIDENCE;
if (evidence) mkdirSync(evidence, { recursive: true });
const delay = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const CODES = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Home: 36, Enter: 13, Escape: 27, Tab: 9 };
const GAP = 16;
// Classic (space-taking) scrollbars, as on the Linux CI runner and in Windows/Linux webviews. macOS
// headless uses overlay scrollbars of width 0, which hid a scrollbar-sized error there.
const CLASSIC_SCROLLBARS = '::-webkit-scrollbar { width: 15px; height: 15px; background: #8888; }';

const browser = await launch(bin);
const key = async (k, modifiers = 0) => {
  for (const type of ['keyDown', 'keyUp']) await browser.send('Input.dispatchKeyEvent', { type, key: k, code: k, windowsVirtualKeyCode: CODES[k], modifiers, ...(k === 'Enter' && type === 'keyDown' ? { text: '\r' } : {}) });
  await delay(250); // longer than the move transition, so rects are settled
};
const measure = () => browser.evaluate(`(() => {
  const c = document.querySelector('.hps-voice-compact'); if (!c) return null;
  const r = c.getBoundingClientRect();
  // The visible viewport: clientWidth/clientHeight exclude a classic scrollbar, innerWidth/innerHeight do not.
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  const texts = [...c.querySelectorAll('button, .hps-voice-compact-status')].map((e) => parseFloat(getComputedStyle(e).fontSize));
  return { corner: c.dataset.corner, left: r.left, top: r.top, right: vw - r.right, bottom: vh - r.bottom,
    inside: r.left >= 0 && r.top >= 0 && r.right <= vw && r.bottom <= vh && r.width > 0,
    focus: document.activeElement?.className ?? '', status: c.querySelector('[role=status]')?.textContent ?? '',
    buttons: [...c.querySelectorAll('button')].map((b) => [b.getBoundingClientRect().width, b.getBoundingClientRect().height]),
    minText: Math.min(...texts), duration: getComputedStyle(c).transitionDuration };
})()`);
const near = (a, b) => Math.abs(a - b) <= 0.5;
const assertAt = (m, corner, label) => {
  assert.ok(m, `${label}: compact control missing`);
  assert.equal(m.corner, corner, `${label}: data-corner`);
  assert.equal(m.inside, true, `${label}: control leaves the viewport (${JSON.stringify(m)})`);
  const [v, h] = corner.split('-');
  assert.ok(near(v === 'top' ? m.top : m.bottom, GAP), `${label}: ${v} gap ${v === 'top' ? m.top : m.bottom}px, want ${GAP}`);
  assert.ok(near(h === 'left' ? m.left : m.right, GAP), `${label}: ${h} gap ${h === 'left' ? m.left : m.right}px, want ${GAP}`);
};
const focusMove = () => browser.evaluate(`document.querySelector('.hps-voice-move').focus()`);

const VIEWS = [[1420, 800], [800, 800], [320, 480]];
let cases = 0;
try {
  for (const dark of [true, false]) for (const [width, height] of VIEWS) for (const forcedColors of (dark && width === 320 ? [false, true] : [false])) {
    const label = `${dark ? 'dark' : 'light'}-${width}${forcedColors ? '-forced' : ''}`;
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await browser.load(`<!doctype html><html style="${vars}"><head><style>${css}</style><style>${CLASSIC_SCROLLBARS}</style></head><body class="${dark ? 'vscode-dark' : 'vscode-light'}"><main style="height:100%"><p>작업 화면</p></main><div id="root"></div><script>window.errors = []; addEventListener('error', (e) => window.errors.push(String(e.message)));</script><script>${js}</script></body></html>`, { width, height, dark, forcedColors });
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: forcedColors ? 'active' : 'none' }, { name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }, { name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await browser.evaluate('window.mount()'); await delay(150);

    // Home corner on first open.
    let m = await measure();
    assertAt(m, 'top-right', `${label} initial`);
    assert.ok(m.buttons.length >= 4 && m.buttons.every(([w, h]) => w >= 44 && h >= 44), `${label}: target under 44px ${JSON.stringify(m.buttons)}`);
    assert.ok(m.minText >= 14, `${label}: text ${m.minText}px under 14px`);
    assert.ok(m.duration.split(',').some((d) => parseFloat(d) >= 0.1), `${label}: no move easing with motion allowed (${m.duration})`);
    const ring = await browser.focusVisibleStyle('.hps-voice-move', ['outline-width', 'outline-style']);
    assert.ok(parseFloat(ring['outline-width']) >= 2 && ring['outline-style'] !== 'none', `${label}: focus ring ${JSON.stringify(ring)}`);

    // Arrow keys from the move button: every corner, focus kept, move announced.
    await focusMove();
    for (const [k, corner] of [['ArrowDown', 'bottom-right'], ['ArrowLeft', 'bottom-left'], ['ArrowUp', 'top-left'], ['ArrowRight', 'top-right'], ['ArrowLeft', 'top-left'], ['ArrowDown', 'bottom-left']]) {
      await key(k);
      m = await measure();
      assertAt(m, corner, `${label} ${k}`);
      assert.match(m.focus, /hps-voice-move/, `${label} ${k}: focus left the move button`);
      assert.match(m.status, /옮겼어요$/, `${label} ${k}: move not announced`);
      if (evidence && k === 'ArrowLeft' && corner === 'bottom-left') {
        const shot = await browser.send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(`${evidence}/${label}-bottom-left.png`, Buffer.from(shot.data, 'base64'));
      }
    }
    assert.equal(await browser.evaluate('window.store.value'), 'bottom-left', `${label}: corner not remembered`);
    // Modified keys belong to shortcuts: Shift/Alt/Ctrl/Meta + arrow or Home move nothing.
    for (const mod of [1, 2, 4, 8]) { await key('ArrowUp', mod); await key('Home', mod); }
    assertAt(await measure(), 'bottom-left', `${label} modified keys`);
    // Arrow keys also work from the other controls in the region.
    await browser.evaluate(`[...document.querySelectorAll('.hps-voice-compact button')].find((b) => b.textContent === '펼치기').focus()`);
    await key('ArrowRight');
    m = await measure();
    assertAt(m, 'bottom-right', `${label} arrow from 펼치기`);
    assert.equal(await browser.evaluate('document.activeElement.textContent'), '펼치기', `${label}: focus moved off 펼치기`);
    assert.equal(await browser.evaluate('window.actions.includes("expand")'), false, `${label}: an arrow pressed 펼치기`);
    // Home resets.
    await key('Home');
    assertAt(await measure(), 'top-right', `${label} Home`);
    // Enter/press on the move button steps clockwise.
    await focusMove(); await key('Enter');
    assertAt(await measure(), 'bottom-right', `${label} Enter on 옮기기`);
    await browser.evaluate(`document.querySelector('.hps-voice-move').click()`); await delay(250);
    assertAt(await measure(), 'bottom-left', `${label} click on 옮기기`);

    // No drag: press, move far toward the top-right and off-screen, release.
    const before = await measure();
    const cx = before.left + 8, cy = height - before.bottom - 8;
    await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 });
    for (const [x, y] of [[cx + 200, cy - 200], [width + 400, -300]]) await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.min(x, width - 1), y: Math.max(y, 0), button: 'left', buttons: 1 });
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: width - 1, y: 0, button: 'left', clickCount: 1 });
    await delay(250);
    assertAt(await measure(), 'bottom-left', `${label} after drag`);

    // Per-window memory: a remount reads the stored corner back.
    await browser.evaluate(`window.store.value = 'bottom-left'; window.mount()`); await delay(150);
    assertAt(await measure(), 'bottom-left', `${label} remount`);
    // Corrupt value → home corner.
    await browser.evaluate(`window.store.value = '{"left":-9999}'; window.mount()`); await delay(150);
    assertAt(await measure(), 'top-right', `${label} corrupt store`);
    // Throwing store → home corner, and moves still work.
    await browser.evaluate(`window.store.throws = true; window.mount()`); await delay(150);
    assertAt(await measure(), 'top-right', `${label} blocked store`);
    await focusMove(); await key('ArrowDown');
    assertAt(await measure(), 'bottom-right', `${label} move with blocked store`);
    await browser.evaluate(`window.store.throws = false`);

    // Reduced motion: the move is instant (the global reduce rule leaves 0.01ms, under 1ms).
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: forcedColors ? 'active' : 'none' }, { name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
    m = await measure();
    assert.ok(m.duration.split(',').every((d) => parseFloat(d) < 0.001), `${label}: moves still animate under reduced motion (${m.duration})`);

    // Escape from the compact control still ends the session.
    await focusMove(); await key('Escape');
    assert.equal(await browser.evaluate('window.actions.includes("escape")'), true, `${label}: Escape no longer ends the session`);
    // A blocked store must never surface as a page error (the write is a convenience).
    assert.deepEqual(await browser.evaluate('window.errors'), [], `${label}: page errors`);
    cases++;
  }
  console.log(`PASS voice-compact-corner: ${cases} theme/width cases; four corners at 16px, Home, focus kept, announced, inside the viewport, per-window memory with corrupt/blocked fallback, no drag, 44px/14px/ring, reduced motion instant`);
} finally {
  await browser.close();
}
