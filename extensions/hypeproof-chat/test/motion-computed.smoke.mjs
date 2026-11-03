// REQ-STUDIO-MOTION-MEASURE-GUTTER (CGP-DS-D-011, DES-CGP-DS-15): motion durations and curves,
// measured on the CASCADE in headless Chromium, not read from declarations.
//   FOCUS_REQUIRE_BROWSER=1 node --experimental-strip-types test/motion-computed.smoke.mjs
// Real webview sheets (tokens.css, modalSurface.css, quoteAction.css, styles.css) are loaded; a transitioning
// element must resolve 140 / 160 / 180 / 240ms, the dialog exit must resolve 120ms on the exit curve,
// and every looping pending indicator (the bounded-pending exception to the 300ms cap) must stop
// (one iteration, 0.01ms) under both reduced-motion routes. Without a headless Chromium this prints
// NOT RUN; FOCUS_REQUIRE_BROWSER=1 (CI) makes that a failure.
import assert from 'node:assert/strict';
import { readDesignFile } from './lib/design-token-values.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin || process.env.FOCUS_STATIC_ONLY) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('motion-computed: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('motion-computed: NOT RUN (no headless Chromium; set HEADLESS_CHROMIUM or FOCUS_REQUIRE_BROWSER=1)');
  process.exit(0);
}

const SRC = new URL('../webview-ui/src/', import.meta.url);
const css = ['tokens.css', 'modalSurface.css', 'quoteAction.css', 'styles.css'].map((f) => readDesignFile(new URL(f, SRC), 'utf8')).join('\n');
const EASE = 'cubic-bezier(0.19, 1, 0.22, 1)';
const EXIT = 'cubic-bezier(0.4, 0, 1, 1)';
const probe = (id, token) => `<div id="${id}" style="transition: opacity var(${token}) var(--hp-ease)">x</div>`;
const body = `
  ${probe('press', '--hp-dur-press')}${probe('confirm', '--hp-dur-confirm')}${probe('content', '--hp-dur-content')}
  ${probe('enter', '--hp-dur-enter')}${probe('move', '--hp-dur-move')}
  <div id="exit" style="transition: opacity var(--hp-dur-modal-exit) var(--hp-ease-exit)">x</div>
  <button id="action" class="hps-quote-action">q</button>
  <div id="row" class="hps-quote-row">r</div>
  <div id="modal" class="hp-modal" data-closing>m</div>
  <div class="hps-runner"><div id="go" class="hps-runner-go"><span id="face" class="hps-runner-face">x</span><span id="dust" class="hps-runner-dust"></span></div></div>
  <div id="breathe" class="hps-code-progress">c</div><span id="dots" class="hps-dots">...</span><span id="shim" class="hps-idle-progress-motion"></span>`;
const page = (attr) => `<!doctype html><html${attr}><head><style>${css}</style></head><body>${body}</body></html>`;

const sec = (v) => v.split(',').map((x) => x.trim()).map((x) => (x.endsWith('ms') ? parseFloat(x) / 1000 : parseFloat(x)));
const near = (a, b) => Math.abs(a - b) < 0.0005;

export async function measure(b, html, { osReduce = false } = {}) {
  await b.load(html);
  if (osReduce) await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'forced-colors', value: 'none' }, { name: 'prefers-color-scheme', value: 'dark' }] });
  return b.evaluate(`(() => {
    const g = (id, ps) => { const s = getComputedStyle(document.getElementById(id)); const o = {}; for (const p of ps) o[p] = s.getPropertyValue(p); return o; };
    const T = ['transition-duration', 'transition-timing-function'], A = ['animation-duration', 'animation-iteration-count', 'animation-timing-function'];
    const out = {};
    for (const id of ['press', 'confirm', 'content', 'enter', 'move', 'exit', 'action']) out[id] = g(id, T);
    for (const id of ['row', 'modal', 'go', 'face', 'dust', 'dots', 'breathe']) out[id] = g(id, A);
    const sh = getComputedStyle(document.getElementById('shim'), '::after'); out.shim = { 'animation-duration': sh.animationDuration, 'animation-iteration-count': sh.animationIterationCount };
    return out;
  })()`);
}

const b = await launch(bin);
try {
  const m = await measure(b, page(''));
  for (const [id, ms] of [['press', 0.14], ['confirm', 0.16], ['content', 0.16], ['enter', 0.18], ['move', 0.24], ['exit', 0.12], ['action', 0.14]]) {
    assert.ok(near(sec(m[id]['transition-duration'])[0], ms), `${id} transition-duration is ${ms}s, got ${m[id]['transition-duration']}`);
  }
  for (const id of ['press', 'confirm', 'content', 'enter', 'move', 'action']) assert.equal(m[id]['transition-timing-function'], EASE, `${id} uses the one UI curve`);
  assert.equal(m.exit['transition-timing-function'], EXIT, 'the exit token resolves to the accelerating exit curve');
  assert.ok(near(sec(m.row['animation-duration'])[0], 0.16), `quote row confirm is 160ms, got ${m.row['animation-duration']}`);
  assert.ok(near(sec(m.modal['animation-duration'])[0], 0.12), `dialog exit is 120ms, got ${m.modal['animation-duration']}`);
  assert.equal(m.modal['animation-timing-function'], EXIT, 'the real dialog exit rule uses the exit curve, not ease-in');
  // No spring or bounce: every resolved timing function on the page keeps y in [0, 1].
  for (const [id, props] of Object.entries(m)) for (const v of Object.values(props)) {
    for (const c of String(v).matchAll(/cubic-bezier\(([^)]*)\)/g)) { const [, y1, , y2] = c[1].split(',').map(Number); assert.ok(y1 >= 0 && y1 <= 1 && y2 >= 0 && y2 <= 1, `${id}: overshoot curve ${c[0]}`); }
    assert.ok(!/linear\(/.test(v), `${id}: linear() easing can encode a spring`);
  }
  // Outside the loops nothing runs longer than 300ms; the loops are the bounded-pending exception.
  const LOOPS = ['go', 'face', 'dust', 'dots', 'shim', 'breathe'];
  for (const [id, props] of Object.entries(m)) {
    const d = props['transition-duration'] ?? props['animation-duration'];
    if (LOOPS.includes(id)) continue;
    for (const x of sec(d)) assert.ok(x <= 0.3 + 1e-9, `${id}: ${x}s exceeds the 300ms cap and is not a pending loop`);
  }
  for (const id of LOOPS) assert.equal(m[id]['animation-iteration-count'], 'infinite', `${id} is a looping pending indicator`);
  // Both reduced-motion routes stop every loop (one iteration, 0.01ms) and the tokenised transitions.
  for (const [label, html, opts] of [['data-reduced-motion=true', page(' data-reduced-motion="true"'), {}], ['OS prefers-reduced-motion', page(''), { osReduce: true }]]) {
    const r = await measure(b, html, opts);
    for (const id of LOOPS) {
      assert.equal(r[id]['animation-iteration-count'], '1', `${label}: ${id} stops looping`);
      assert.ok(sec(r[id]['animation-duration']).every((x) => x <= 0.00002), `${label}: ${id} duration collapses, got ${r[id]['animation-duration']}`);
    }
    for (const id of ['press', 'confirm', 'enter', 'move', 'exit']) assert.ok(sec(r[id]['transition-duration']).every((x) => x <= 0.00002), `${label}: ${id} transition collapses`);
  }
  console.log('motion-computed smoke OK (140/160/180/240ms, exit 120ms on the exit curve, no overshoot, loops stop under both reduced-motion routes)');
} finally { await b.close(); }
