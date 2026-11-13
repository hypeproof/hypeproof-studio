// CGP-VOICE-D-006 (DES-CGPV-08): the agent-status line in the voice panel, measured on the CASCADE in
// headless Chromium.
//   node --experimental-strip-types test/voice-agent-status.smoke.mjs
//
// The real VoicePanel, owned by the real popup and session reducers, is rendered with the shipped
// stylesheet order in dark and light themes at 1420x800 and 320x480, with and without reduced motion,
// and once in forced colours. Host events arrive as real window `message` events (the chat channel).
// Read from computed styles, layout boxes and attributes:
//   - the line sits under the state label, at 14px or more, with an icon;
//   - a label long enough to wrap in any font is clamped to at most two lines, and the whole text
//     is still in the DOM and the tooltip;
//   - the icon never animates or transitions (no spinner), with or without reduced motion;
//   - the line's text is not announced by itself (no live role); the one announcer is role=status;
//   - at 320px nothing scrolls sideways and the line stays inside the viewport.
// The clamp is read against the computed line height, never a text width, so a runner's fonts do not
// change the verdict. VoicePanel is not mounted by any screen yet (voice is not served on any seat).
// Without a headless Chromium this prints NOT RUN; FOCUS_REQUIRE_BROWSER=1 (set by CI) fails instead.
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
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('voice-agent-status: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('voice-agent-status NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)');
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
  const dispatch = (e) => set((cur) => { const step = popupTransition(cur.popup, e); let session = cur.session; for (const v of step.voiceEvents) session = voiceTransition(session, v); return { popup: step.state, session }; });
  return <VoicePanel coachName="발표 도우미" session={s.session} popup={s.popup} meter={meterView(s.session, null)}
    reference={null} info={[]} finalTranscript={null} partialTranscript={null} failure={null}
    onMinimize={() => dispatch({ type: 'minimize' })} onExpand={() => dispatch({ type: 'expand' })}
    onToggleMute={() => {}} onResume={() => {}} onStopSpeaking={() => {}} onDismiss={() => {}} onRetry={() => {}}
    outputMute={window.output} cornerStore={{ read: () => null, write: () => {} }} agentStatusIntervalMs={0} />;
}
let root = null;
window.mount = () => {
  if (root) root.unmount();
  document.getElementById('root').replaceChildren();
  root = createRoot(document.getElementById('root'));
  root.render(<Owner />);
};
`;
const jsBuild = await build({ stdin: { contents: fixture, loader: 'tsx', resolveDir: SRC }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', logLevel: 'silent' });
const js = jsBuild.outputFiles[0].text;

const delay = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const browser = await launch(bin);
const say = async (data) => { await browser.evaluate(`window.postMessage(${JSON.stringify(data)}, '*')`); await delay(); };
// A path long enough to need more than two lines at 320px or at 1420px in any font.
const LONG = `파일 고치기 ${'아주긴폴더이름/'.repeat(40)}index.html`;
const read = () => browser.evaluate(`(() => {
  const vw = document.documentElement.clientWidth;
  const label = document.querySelector('.hps-voice-status-text');
  const p = document.querySelector('.hps-voice-agent-status'); if (!p) return { line: null };
  const text = p.querySelector('.hps-voice-agent-status-text'), icon = p.querySelector('svg');
  const ts = getComputedStyle(text), is = getComputedStyle(icon), pr = p.getBoundingClientRect(), tr = text.getBoundingClientRect();
  const announcers = [...document.querySelectorAll('[data-agent-status-announcer]')];
  return { line: text.textContent, tooltip: p.getAttribute('data-hp-tooltip'), kind: p.dataset.agentStatus,
    font: parseFloat(ts.fontSize), lineHeight: parseFloat(ts.lineHeight), textHeight: tr.height,
    belowLabel: label ? pr.top >= label.getBoundingClientRect().bottom - 0.5 : false,
    iconAnimation: is.animationName, iconTransition: is.transitionDuration, iconWidth: icon.getBoundingClientRect().width,
    liveOnLine: p.getAttribute('role') ?? p.getAttribute('aria-live'), announcers: announcers.map((a) => [a.getAttribute('role'), a.textContent]),
    inside: pr.left >= 0 && pr.right <= vw + 0.5, sideways: document.documentElement.scrollWidth > vw, inkVisible: ts.color !== 'rgba(0, 0, 0, 0)' };
})()`);

let cases = 0;
try {
  for (const dark of [true, false]) for (const [width, height] of [[1420, 800], [320, 480]]) for (const [reduced, forcedColors] of (dark && width === 320 ? [[false, false], [true, false], [false, true]] : [[false, false], [true, false]])) {
    const label = `${dark ? 'dark' : 'light'}-${width}${reduced ? '-reduced' : ''}${forcedColors ? '-forced' : ''}`;
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await browser.load(`<!doctype html><html style="${vars}"><head><style>${css}</style></head><body class="${dark ? 'vscode-dark' : 'vscode-light'}"><main><p>작업 화면</p></main><div id="root"></div><script>window.errors = []; addEventListener('error', (e) => window.errors.push(String(e.message)));</script><script>${js}</script></body></html>`, { width, height, dark, forcedColors });
    await browser.send('Emulation.setEmulatedMedia', { features: [
      { name: 'forced-colors', value: forcedColors ? 'active' : 'none' }, { name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' },
      { name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] });
    await browser.evaluate('window.mount()'); await delay(150);

    let m = await read();
    assert.equal(m.line, null, `${label}: no line before any host event`);

    await say({ type: 'streamStart', streamId: 's', messageId: 'm' });
    await say({ type: 'toolLog', streamId: 's', id: 'toolu_1', icon: '✍️', label: '파일 고치기 index.html', state: 'running', kind: 'tool' });
    m = await read();
    assert.equal(m.line, '만드는 중 · 파일 고치기 index.html', `${label}: line`);
    assert.ok(m.belowLabel, `${label}: the line sits under the state label`);
    assert.ok(m.font >= 14, `${label}: ${m.font}px under 14px`);
    assert.ok(Math.abs(m.iconWidth - 16) <= 0.5, `${label}: icon ${m.iconWidth}px`);
    assert.equal(m.iconAnimation, 'none', `${label}: the icon animates`);
    // The global reduced-motion rule writes 0.00001s; anything under 10ms is no visible transition.
    assert.ok(m.iconTransition.split(',').every((d) => parseFloat(d) < 0.01), `${label}: the icon transitions (${m.iconTransition})`);
    assert.equal(m.liveOnLine, null, `${label}: the line itself is a live region (would announce every update)`);
    assert.deepEqual(m.announcers, [['status', '만드는 중 · 파일 고치기 index.html']], `${label}: one announcer`);
    assert.ok(m.inkVisible, `${label}: transparent ink`);

    await say({ type: 'toolLog', streamId: 's', id: 'toolu_1', icon: '✍️', label: LONG, state: 'running', kind: 'tool' });
    m = await read();
    assert.equal(m.line, `만드는 중 · ${LONG}`, `${label}: the DOM keeps the whole text`);
    assert.equal(m.tooltip, `만드는 중 · ${LONG}`, `${label}: the tooltip keeps the whole text`);
    assert.ok(m.textHeight <= 2 * m.lineHeight + 1, `${label}: ${m.textHeight}px is more than two ${m.lineHeight}px lines`);
    assert.ok(m.textHeight >= 2 * m.lineHeight - 1, `${label}: the long label should fill two lines (${m.textHeight}px)`);
    assert.deepEqual(m.announcers, [['status', '만드는 중 · 파일 고치기 index.html']], `${label}: a step update is not announced`);
    assert.ok(m.inside, `${label}: the line leaves the viewport`);
    assert.equal(m.sideways, false, `${label}: the page scrolls sideways`);

    await say({ type: 'toolLog', streamId: 's', id: 'toolu_1', icon: '✍️', label: '파일 고치기 index.html', state: 'done', kind: 'tool' });
    m = await read();
    assert.deepEqual([m.line, m.kind], ['파일 고치기 index.html 끝났어요', 'done'], `${label}: finished after the result event`);
    assert.deepEqual(m.announcers, [['status', '파일 고치기 index.html 끝났어요']], `${label}: the finish is announced`);
    assert.deepEqual(await browser.evaluate('window.errors'), [], `${label}: page errors`);
    cases++;
  }
  console.log(`PASS voice-agent-status: ${cases} theme/width/motion cases; the line under the state label at 14px with a static 16px icon (no animation or transition, reduced motion or not), clamped to two computed lines with the whole text in the DOM and tooltip, one role=status announcer for starts and finishes only, no sideways scroll at 320px`);
} finally {
  await browser.close();
}
