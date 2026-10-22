// CGP-DS-D-016: the shared composer card, measured on the CASCADE in headless Chromium.
//   node --experimental-strip-types test/composer-geometry.smoke.mjs
//
// The real ChatPanel markup is rendered (personal and classroom seats, idle and streaming so both Send and
// Stop appear) into the shipped stylesheet order, in dark and light, at 1420/800/320. Computed styles and
// layout rects are read, never rule text, so a later or higher-specificity override and an @media override
// both fail: radius 20px on all four corners, min-height 48px, padding 12px on all sides, Send/Stop 44x44
// and inside the card, placeholder opacity 1 and contrast >= 4.5:1 on the surface it sits on.
// Self-test: the matrix is run again with four injected overrides; each must be caught.
// The lesson seat and the start screen draw no composer of their own: `.hps-input` exists only in ChatPanel
// (the lesson seat is the classroom render with `profile.lesson`), so the classroom render covers them.
// Without a headless Chromium this prints NOT RUN; FOCUS_REQUIRE_BROWSER=1 (set by CI) makes that a failure.
import assert from 'node:assert/strict';
import { readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const SRC = resolve(root, 'webview-ui/src');

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('composer-geometry: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('composer-geometry NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)');
  process.exit(0);
}

// ---------- the stylesheets as shipped (main.tsx order: tokens, component css, styles, chatDetails) ----------
const others = readdirSync(SRC).filter((f) => f.endsWith('.css') && !['tokens.css', 'designTokens.css', 'styles.css', 'chatDetails.css'].includes(f)).sort();
const bundled = await build({
  stdin: { contents: ['tokens.css', ...others, 'styles.css', 'chatDetails.css'].map((f) => `@import "./${f}";`).join('\n'), resolveDir: SRC, loader: 'css' },
  bundle: true, write: false, outdir: 'out', logLevel: 'silent',
  plugins: [{ name: 'external', setup(b) { b.onResolve({ filter: /\.(svg|png|jpe?g|gif|webp|woff2?)$/ }, (a) => ({ path: a.path, external: true })); } }],
});
const css = bundled.outputFiles.find((o) => o.path.endsWith('.css')).text;

// ---------- the real composer markup ----------
const dir = mkdtempSync(join(tmpdir(), 'composer-geometry-'));
const markup = {};
try {
  const out = join(dir, 'render.cjs');
  await build({ stdin: { contents: 'export { ChatPanel } from "./webview-ui/src/ChatPanel"; export { renderToStaticMarkup } from "react-dom/server"; export { createElement } from "react";', resolveDir: root, loader: 'tsx' }, bundle: true, platform: 'node', format: 'cjs', outfile: out, jsx: 'automatic', loader: { '.css': 'empty', '.svg': 'empty' }, alias: { react: join(root, 'webview-ui/node_modules/react'), 'react-dom': join(root, 'webview-ui/node_modules/react-dom') }, banner: { js: 'globalThis.window = { innerWidth: 1420, addEventListener() {}, removeEventListener() {} };' }, logLevel: 'error' });
  const { ChatPanel, renderToStaticMarkup, createElement } = createRequire(import.meta.url)(out);
  const originalError = console.error;
  console.error = (...args) => { if (!String(args[0]).includes('useLayoutEffect does nothing on the server')) originalError(...args); };
  const noop = () => {};
  const ux = { coach: { naming_mode: 'fixed', fallback_name: 'HypeProof' }, suggestions: { initial: [], follow_up: [] }, hints: { short_input: { enabled: false }, roll_input_button: { enabled: false } }, retry_button: { enabled: false } };
  for (const seat of ['classroom', 'personal']) for (const streaming of [false, true]) {
    markup[`${seat}/${streaming ? 'stop' : 'send'}`] = renderToStaticMarkup(createElement(ChatPanel, { messages: [], streaming, config: { hasToken: true, profile: { ux, welcome: { greeting_md: '' }, profile_id: 'studio-native-trial', activity_kind: 'trial', lesson: null }, activity: { id: 'a1', verified: true, workspace: '/tmp/synthetic' }, coach: { name: 'HypeProof', configured: true }, taskWorkspace: seat === 'personal' ? { tasks: [], sources: [] } : undefined }, onSend: noop, onCancel: noop, onSettings: noop, onSetToken: noop }));
  }
  console.error = originalError;
} finally { rmSync(dir, { recursive: true, force: true }); }

// ---------- measurement ----------
const THEMES = {
  dark: { cls: 'vscode-dark', dark: true, v: { 'editor-background': '#1f1f1f', 'input-background': '#313131', foreground: '#cccccc', descriptionForeground: '#9d9d9d', 'input-foreground': '#cccccc' } },
  light: { cls: 'vscode-light', dark: false, v: { 'editor-background': '#ffffff', 'input-background': '#ffffff', foreground: '#3b3b3b', descriptionForeground: '#717171', 'input-foreground': '#3b3b3b' } },
};
const WIDTHS = [1420, 800, 320];
const probe = () => {
  const px = (v) => parseFloat(v);
  const rgba = (c) => { const k = document.createElement('canvas'); k.width = k.height = 1; const x = k.getContext('2d', { willReadFrequently: true }); x.clearRect(0, 0, 1, 1); x.fillStyle = c; x.fillRect(0, 0, 1, 1); const d = x.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const card = document.querySelector('.hps-input');
  const area = card.querySelector('textarea');
  const btn = card.querySelector('.hps-btn-send, .hps-btn-stop');
  const cs = getComputedStyle(card);
  const cr = card.getBoundingClientRect(); const br = btn.getBoundingClientRect();
  // Surface under the placeholder: first non-transparent ancestor background, blended over white.
  let under = [255, 255, 255];
  const layers = [];
  for (let e = area; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] >= 1) break; }
  for (const c of layers.reverse()) under = under.map((v, i) => c[i] * c[3] + v * (1 - c[3]));
  const ph = getComputedStyle(area, '::placeholder');
  const pc = rgba(ph.color); const fg = pc.slice(0, 3).map((v, i) => v * pc[3] + under[i] * (1 - pc[3]));
  const bs = getComputedStyle(btn);
  return {
    radius: ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map((k) => cs[`border${k}Radius`]),
    minHeight: cs.minHeight, height: cr.height,
    padding: ['Top', 'Right', 'Bottom', 'Left'].map((k) => cs[`padding${k}`]),
    boxSizing: cs.boxSizing,
    btn: { w: br.width, h: br.height, inside: br.left >= cr.left - 0.01 && br.right <= cr.right + 0.01 && br.top >= cr.top - 0.01 && br.bottom <= cr.bottom + 0.01, boxSizing: bs.boxSizing },
    placeholderOpacity: ph.opacity, contrast: ratio(fg, under),
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    px: undefined,
  };
};

const measure = async (extraCss) => {
  const bad = [];
  const b = await launch(bin);
  try {
    for (const [tname, t] of Object.entries(THEMES)) for (const width of WIDTHS) for (const [key, html] of Object.entries(markup)) {
      const vars = Object.entries(t.v).map(([k, v]) => `--vscode-${k}:${v}`).join(';');
      await b.load(`<!doctype html><html><head><meta charset="utf-8"><style>:root{${vars}}${css}${extraCss}</style></head><body class="${t.cls}" style="margin:0;background:var(--vscode-editor-background);color:var(--vscode-foreground)">${html}</body></html>`, { width, height: 800, dark: t.dark });
      const m = await b.evaluate(`(${probe})()`);
      const at = `${key} ${tname} ${width}px`;
      if (m.radius.some((r) => r !== '20px')) bad.push(`${at}: radius ${m.radius.join('/')} not 20px`);
      if (m.minHeight !== '48px') bad.push(`${at}: min-height ${m.minHeight} not 48px`);
      if (m.height < 48) bad.push(`${at}: card height ${m.height}px under 48px`);
      if (m.padding.some((p) => p !== '12px')) bad.push(`${at}: padding ${m.padding.join('/')} not 12px`);
      if (m.boxSizing !== 'border-box') bad.push(`${at}: card box-sizing ${m.boxSizing}`);
      if (m.btn.w !== 44 || m.btn.h !== 44) bad.push(`${at}: Send/Stop ${m.btn.w}x${m.btn.h} not 44x44`);
      if (!m.btn.inside) bad.push(`${at}: Send/Stop outside the card`);
      if (m.btn.boxSizing !== 'border-box') bad.push(`${at}: Send/Stop box-sizing ${m.btn.boxSizing}`);
      if (Number(m.placeholderOpacity) !== 1) bad.push(`${at}: placeholder opacity ${m.placeholderOpacity}`);
      if (m.contrast < 4.5) bad.push(`${at}: placeholder contrast ${m.contrast.toFixed(2)}:1 under 4.5:1`);
      if (m.overflowX > 0) bad.push(`${at}: horizontal overflow ${m.overflowX}px`);
    }
  } finally { await b.close(); }
  return bad;
};

const baseline = await measure('');
assert.deepEqual(baseline, [], `composer geometry:\n${baseline.slice(0, 12).join('\n')}`);
console.log(`  ok   ${Object.keys(markup).length} renders x ${Object.keys(THEMES).length} themes x ${WIDTHS.length} widths: radius 20, min-height 48, padding 12, Send/Stop 44x44 inside, placeholder >= 4.5:1`);

// ---------- the guard must fail on the overrides declaration-only checks missed ----------
const MUTATIONS = [
  ['later higher-specificity radius (classroom)', '.hps-shell .hps-input:not([data-expanded]) { border-radius: 8px; }'],
  ['later higher-specificity radius (personal)', '.hps-shell[data-chat-detail="personal"] .hps-input[data-expanded] { border-radius: 8px; }'],
  ['@media radius and padding', '@media (max-width: 400px) { .hps-input { border-radius: 8px; padding: 4px; } }'],
  ['mission-style Send override', '.hps-shell:has(.hp-mission .hp-cta-primary) .hps-input .hps-btn-send, .hps-shell .hps-input .hps-btn-send { min-width: 0; min-height: 0; width: 32px; height: 32px; }'],
  ['low-contrast placeholder', '.hps-shell .hps-input textarea::placeholder { color: #777; }'],
];
for (const [name, extra] of MUTATIONS) {
  const caught = await measure(extra);
  assert.ok(caught.length > 0, `mutation not caught: ${name}`);
  console.log(`  ok   caught: ${name} (${caught.length} findings, e.g. ${caught[0]})`);
}
console.log('composer-geometry PASS');
