// CGP-VOICE-R-002 / CGP-VOICE-D-001 (REQ-CGPV-02 / DES-CGPV-02): the microphone and speaker mute
// buttons, measured on the CASCADE in headless Chromium.
//   node --experimental-strip-types test/voice-mute-controls.smoke.mjs
//
// The real VoicePanel, owned by the real popup and session reducers, is rendered with the shipped
// stylesheet order in dark and light themes at 1420x800 and 320x480, and once in forced colours.
// Presses are real mouse input (CDP). Read from layout rects, computed styles and attributes:
//   - big panel and compact control each show exactly two mute buttons, named 마이크 끄기 and
//     소리 끄기, each with aria-pressed and a 20px glyph, each at least 44x44;
//   - pressed (off) differs from released by more than colour: the glyph changes (data-icon), and
//     the fill and the edge change; in forced colours the pressed button still differs;
//   - the off state is written out at 14px or more;
//   - pressing 소리 끄기 leaves the microphone pressed state and the session's capture untouched,
//     and the reverse; both survive collapse and expand;
//   - at 320px nothing scrolls sideways and both controls stay inside the viewport.
// Every read is a state, a computed style or a minimum box, never a text width, so a runner's
// fonts do not change the verdict. VoicePanel is not mounted by any screen yet (voice is not served
// on any seat), so this measures the component a seat will mount. Without a headless Chromium this
// prints NOT RUN; FOCUS_REQUIRE_BROWSER=1 (set by CI) makes that a failure.
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { findChromium, launch } from './lib/headless-chromium.mjs';
import { THEMES } from './lib/vscode-default-themes.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const SRC = resolve(root, 'webview-ui/src');

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('voice-mute-controls: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('voice-mute-controls NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)');
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
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { VoicePanel } from './VoicePanel.tsx';
import { initialPopupState, meterView, popupTransition } from '../../src/voicePopupHelpers.ts';
import { initialVoiceSession, voiceTransition } from '../../src/voiceSessionHelpers.ts';
import { OutputMute } from '../../src/voiceOutputMute.ts';
window.output = new OutputMute();
function Owner() {
  const listening = voiceTransition(voiceTransition(initialVoiceSession(), { type: 'start' }), { type: 'transport_ready' });
  const [s, set] = useState({ popup: popupTransition(initialPopupState(), { type: 'open' }).state, session: listening });
  window.state = s;
  const dispatch = (e) => set((cur) => { const step = popupTransition(cur.popup, e); let session = cur.session; for (const v of step.voiceEvents) session = voiceTransition(session, v); return { popup: step.state, session }; });
  return <VoicePanel coachName="발표 도우미" session={s.session} popup={s.popup} meter={meterView(s.session, null)}
    reference={null} info={[]} finalTranscript={null} partialTranscript={null} failure={null}
    onMinimize={() => dispatch({ type: 'minimize' })} onExpand={() => dispatch({ type: 'expand' })}
    onToggleMute={() => dispatch({ type: s.popup.userMuteIntent ? 'user_unmute' : 'user_mute' })}
    onResume={() => {}} onStopSpeaking={() => {}} onDismiss={() => dispatch({ type: 'dismissed' })} onRetry={() => {}}
    outputMute={window.output} cornerStore={{ read: () => null, write: () => {} }} />;
}
let root = null;
window.mount = () => {
  if (root) root.unmount();
  window.output.set(false);
  document.getElementById('root').replaceChildren();
  root = createRoot(document.getElementById('root'));
  root.render(<Owner />);
};
`;
const jsBuild = await build({ stdin: { contents: fixture, loader: 'tsx', resolveDir: SRC }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', logLevel: 'silent' });
const js = jsBuild.outputFiles[0].text;

const delay = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const browser = await launch(bin);
const SURFACE = '.hps-voice-panel, .hps-voice-compact';
const read = () => browser.evaluate(`(() => {
  const surface = document.querySelector('${SURFACE}'); if (!surface) return null;
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  const mutes = [...surface.querySelectorAll('button.hps-voice-mute')].map((b) => {
    const r = b.getBoundingClientRect(), cs = getComputedStyle(b), svg = b.querySelector('svg');
    return { name: b.getAttribute('aria-label'), pressed: b.getAttribute('aria-pressed'), icon: svg?.dataset.icon ?? null,
      iconSize: svg ? svg.getBoundingClientRect().width : 0, w: r.width, h: r.height,
      inside: r.left >= 0 && r.top >= 0 && r.right <= vw && r.bottom <= vh,
      bg: cs.backgroundColor, edge: cs.borderTopColor, ink: cs.color, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const state = surface.querySelector('.hps-voice-mute-state');
  return { kind: surface.classList.contains('hps-voice-compact') ? 'compact' : 'panel', mutes,
    stateText: state ? [...state.children].map((c) => c.textContent) : [],
    stateFont: state ? Math.min(...[...state.children].map((c) => parseFloat(getComputedStyle(c).fontSize))) : null,
    sideways: document.documentElement.scrollWidth > vw,
    session: { state: window.state.session.state, capture: window.state.session.captureOpen }, output: window.output.getMuted() };
})()`);
const clickAt = async ({ x, y }) => {
  for (const type of ['mousePressed', 'mouseReleased']) await browser.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  await delay();
};
const clickButton = async (selector) => {
  const at = await browser.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await clickAt(at);
};
const byName = (m, name) => m.mutes.find((b) => b.name === name);
const checkPair = (m, label) => {
  assert.ok(m, `${label}: voice surface missing`);
  assert.equal(m.mutes.length, 2, `${label}: want exactly two mute buttons, got ${JSON.stringify(m.mutes.map((b) => b.name))}`);
  assert.deepEqual(m.mutes.map((b) => b.name), ['마이크 끄기', '소리 끄기'], `${label}: names`);
  for (const b of m.mutes) {
    assert.ok(b.pressed === 'true' || b.pressed === 'false', `${label} ${b.name}: aria-pressed missing`);
    // 0.01px of slack: the compact control sits on a translate, so a 44px box can read 43.99998 (CI dark-320).
    assert.ok(b.w >= 43.99 && b.h >= 43.99, `${label} ${b.name}: target ${b.w}x${b.h} under 44px`);
    assert.ok(Math.abs(b.iconSize - 20) <= 0.5, `${label} ${b.name}: glyph ${b.iconSize}px, want 20`); // a translated corner box reads 20.00002
    assert.ok(b.inside, `${label} ${b.name}: outside the viewport`);
  }
  assert.equal(m.sideways, false, `${label}: the page scrolls sideways`);
};

let cases = 0;
try {
  for (const dark of [true, false]) for (const [width, height] of [[1420, 800], [320, 480]]) for (const forcedColors of (dark && width === 320 ? [false, true] : [false])) {
    const label = `${dark ? 'dark' : 'light'}-${width}${forcedColors ? '-forced' : ''}`;
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await browser.load(`<!doctype html><html style="${vars}"><head><style>${css}</style></head><body class="${dark ? 'vscode-dark' : 'vscode-light'}"><main><p>작업 화면</p></main><div id="root"></div><script>window.errors = []; addEventListener('error', (e) => window.errors.push(String(e.message)));</script><script>${js}</script></body></html>`, { width, height, dark, forcedColors });
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: forcedColors ? 'active' : 'none' }, { name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
    await browser.evaluate('window.mount()'); await delay(150);

    // Big panel, both on.
    let m = await read();
    assert.equal(m.kind, 'panel', `${label}: opens as the big panel`);
    checkPair(m, `${label} panel`);
    const released = byName(m, '소리 끄기');
    assert.deepEqual(m.mutes.map((b) => [b.pressed, b.icon]), [['false', 'mic'], ['false', 'speaker']], `${label}: both on`);
    assert.deepEqual(m.stateText, [], `${label}: no off words while both are on`);

    // 소리 끄기: speaker off, microphone and capture untouched.
    await clickAt(released);
    m = await read();
    const pressed = byName(m, '소리 끄기');
    assert.deepEqual([pressed.pressed, pressed.icon, m.output], ['true', 'speaker-off', true], `${label}: speaker off`);
    assert.deepEqual([byName(m, '마이크 끄기').pressed, m.session], ['false', { state: 'listening', capture: true }], `${label}: 소리 끄기 touched the microphone`);
    // More than colour: the glyph changed above; the fill and the edge change too. Forced colours
    // replace both with system colours, and the global pressed rule must still tell them apart.
    assert.ok(pressed.bg !== released.bg || pressed.edge !== released.edge, `${label}: pressed and released look the same (${released.bg}/${released.edge} vs ${pressed.bg}/${pressed.edge})`);
    if (!forcedColors) assert.notEqual(pressed.edge, released.edge, `${label}: the pressed edge does not change`);
    assert.deepEqual(m.stateText, ['소리 꺼짐'], `${label}: off state in words`);
    assert.ok(m.stateFont >= 14, `${label}: off words ${m.stateFont}px under 14px`);

    // 마이크 끄기: capture closes, the speaker switch stays.
    await clickAt(byName(m, '마이크 끄기'));
    m = await read();
    assert.deepEqual([byName(m, '마이크 끄기').pressed, byName(m, '마이크 끄기').icon, m.session.capture], ['true', 'mic-off', false], `${label}: microphone off`);
    assert.deepEqual([byName(m, '소리 끄기').pressed, m.output], ['true', true], `${label}: 마이크 끄기 touched the speaker`);
    assert.deepEqual(m.stateText, ['마이크 꺼짐', '소리 꺼짐'], `${label}: both off in words`);

    // Collapse: the compact control carries both, still off.
    await clickButton('.hps-voice-head-buttons button');
    m = await read();
    assert.equal(m.kind, 'compact', `${label}: collapsed`);
    checkPair(m, `${label} compact`);
    assert.deepEqual(m.mutes.map((b) => b.pressed), ['true', 'true'], `${label}: collapse kept both switches`);
    // The status name already says 마이크 꺼짐; the line adds the speaker only.
    assert.deepEqual(m.stateText, ['소리 꺼짐'], `${label}: compact off words`);
    assert.ok(m.stateFont >= 14, `${label}: compact off words ${m.stateFont}px under 14px`);

    // Speaker back on from the compact control; the microphone stays off. Then expand.
    await clickAt(byName(m, '소리 끄기'));
    m = await read();
    assert.deepEqual([m.mutes.map((b) => b.pressed), m.output, m.session.capture], [['true', 'false'], false, false], `${label}: compact speaker on, microphone still off`);
    await browser.evaluate(`[...document.querySelectorAll('.hps-voice-compact button')].find((b) => b.textContent === '펼치기').setAttribute('data-expand', '')`);
    await clickButton('.hps-voice-compact button[data-expand]');
    m = await read();
    assert.equal(m.kind, 'panel', `${label}: expanded`);
    assert.deepEqual(m.mutes.map((b) => b.pressed), ['true', 'false'], `${label}: expand kept both switches`);
    assert.deepEqual(await browser.evaluate('window.errors'), [], `${label}: page errors`);
    cases++;
  }
  console.log(`PASS voice-mute-controls: ${cases} theme/width cases; two named icon toggles in the big panel and the compact control, 44px, 20px glyphs, pressed differs by glyph, fill and edge (and in forced colours), off words at 14px, independent switches, kept across collapse and expand, no sideways scroll at 320px`);
} finally {
  await browser.close();
}
