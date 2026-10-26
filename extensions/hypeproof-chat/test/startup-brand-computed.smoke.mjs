// REQ-STUDIO-BRAND-MARKS (CGP-DS-R-032 / REQ-CGP-DS-38): the startup and empty states draw only the
// HypeProof mark, and any startup motion is a single fade of at most 200ms that never loops.
//   FOCUS_REQUIRE_BROWSER=1 node --experimental-strip-types test/startup-brand-computed.smoke.mjs
// Mounts the real webview bundle (chat view before the host config, the start page before and after
// its state) and the real ChatPanel empty state (personal and classroom) in headless Chromium, in
// dark/light, at 800/1420px, with motion allowed, `data-reduced-motion="true"` and OS reduced motion.
// It reads every <img>, inline <svg> and CSS image (elements and ::before/::after) from the DOM and
// every running animation from the cascade and document.getAnimations(). Without a headless
// Chromium this prints NOT RUN; FOCUS_REQUIRE_BROWSER=1 (CI) makes that a failure.
// STARTUP_BRAND_EVIDENCE=<dir> saves one PNG per surface/theme/width.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';
import { VENDOR, decodeDataUri, ROOT } from './lib/brand-marks.mjs';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER === '1') { console.error('startup-brand-computed: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('startup-brand-computed: NOT RUN (no headless Chromium)');
  process.exit(0);
}
const { renderComponent } = await import('./sx-render.mjs');
const { chatPanelProps, chatConfig } = await import('./sx-screen-fixtures.mjs');

const HP_MARK = fs.readFileSync(path.join(ROOT, 'assets/brand/hypeproof-mark.svg'), 'utf8');
const dir = fileURLToPath(new URL('../webview-ui/', import.meta.url));
const app = await build({ entryPoints: [dir + 'src/main.tsx'], bundle: true, platform: 'browser', format: 'iife', outdir: 'startup-brand-assets', write: false, loader: { '.svg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.png': 'dataurl' }, logLevel: 'silent' });
const css = app.outputFiles.find((f) => f.path.endsWith('.css')).text, js = app.outputFiles.find((f) => f.path.endsWith('.js')).text;
const evidence = process.env.STARTUP_BRAND_EVIDENCE; if (evidence) fs.mkdirSync(evidence, { recursive: true });

const emptyChat = (seat) => renderComponent('ChatPanel', chatPanelProps({ messages: [], config: chatConfig(3, { taskWorkspace: seat === 'personal' ? { tasks: [], sources: [] } : undefined, profile: { ...chatConfig().profile, lesson: null }, activity: { id: 'empty', name: '빈 대화', kind: seat, workspace: '/w', verified: true } }) }));
const SURFACES = [
  // The chat view's first frame: no host config yet, so the boot screen with the HP mark renders.
  { id: 'chat-startup', live: '', ready: '.studio-disconnected', mark: true },
  { id: 'start-initial', live: ' data-surface="start"', ready: '.studio-start', mark: true },
  { id: 'start-ready', live: ' data-surface="start"', ready: '.studio-start', mark: true, post: { type: 'startState', state: { checking: false, version: '1.0.0', activities: [] } } },
  { id: 'empty-chat-personal', markup: await emptyChat('personal'), ready: '.hps-shell' },
  { id: 'empty-chat-classroom', markup: await emptyChat('classroom'), ready: '.hps-shell' },
];
const MOTION = [['motion', '', false], ['data-reduced-motion', ' data-reduced-motion="true"', false], ['os-reduced-motion', '', true]];

const PROBE = `(() => {
  const urls = (v) => [...String(v).matchAll(/url\\((['"]?)(.*?)\\1\\)/g)].map((m) => m[2]);
  const out = { imgs: [], svgs: [], cssImages: [], cascade: [], running: [] };
  for (const img of document.querySelectorAll('img')) out.imgs.push({ src: img.getAttribute('src'), alt: img.getAttribute('alt'), label: img.getAttribute('aria-label') });
  for (const svg of document.querySelectorAll('svg')) out.svgs.push(svg.outerHTML);
  for (const el of document.querySelectorAll('*')) for (const pseudo of [null, '::before', '::after']) {
    const s = getComputedStyle(el, pseudo);
    for (const p of ['background-image', 'mask-image', '-webkit-mask-image', 'list-style-image', 'border-image-source', 'content']) for (const u of urls(s.getPropertyValue(p))) out.cssImages.push(u);
    if (s.animationName && s.animationName !== 'none') out.cascade.push({ at: (el.className && String(el.className)) || el.tagName, pseudo, name: s.animationName, duration: s.animationDuration, delay: s.animationDelay, count: s.animationIterationCount });
  }
  for (const a of document.getAnimations()) {
    const t = a.effect.getComputedTiming();
    const props = new Set(a.effect.getKeyframes().flatMap((k) => Object.keys(k)).filter((k) => !['offset', 'computedOffset', 'easing', 'composite'].includes(k)));
    out.running.push({ name: a.animationName ?? a.id, duration: t.duration, iterations: t.iterations, delay: t.delay, props: [...props] });
  }
  return out;
})()`;
const sec = (v) => String(v).split(',').map((x) => x.trim()).map((x) => (x.endsWith('ms') ? parseFloat(x) / 1000 : parseFloat(x)));

/** Every rule violation in one probe result. Exported for the controls below. */
export function violations(m, { surface, reduced }) {
  const bad = [];
  for (const img of m.imgs) {
    const d = img.src?.startsWith('data:') ? decodeDataUri(img.src) : null;
    if (!d || d.body.trim() !== HP_MARK.trim()) bad.push(`${surface}: <img src=${String(img.src).slice(0, 60)}> is not the HP mark`);
    if (VENDOR.test(`${img.alt ?? ''} ${img.label ?? ''}`)) bad.push(`${surface}: image named for a third party`);
  }
  for (const svg of m.svgs) { const hit = VENDOR.exec(svg); if (hit) bad.push(`${surface}: inline SVG names ${hit[1]}`); }
  for (const u of m.cssImages) {
    if (!u.startsWith('data:')) { bad.push(`${surface}: CSS image ${u.slice(0, 60)} is not an inline HP asset`); continue; }
    const d = decodeDataUri(u); if (d.type !== 'image/svg+xml') { bad.push(`${surface}: CSS raster image cannot be read for a mark`); continue; }
    const hit = VENDOR.exec(d.body); if (hit) bad.push(`${surface}: CSS image names ${hit[1]}`);
  }
  for (const a of m.cascade) {
    const counts = String(a.count).split(',').map((x) => x.trim());
    if (counts.some((c) => c === 'infinite' || Number(c) > 1)) bad.push(`${surface}${reduced ? ' (reduced motion)' : ''}: ${a.name} on ${a.at}${a.pseudo ?? ''} loops (${a.count})`);
    if (sec(a.duration).some((x) => x > 0.2 + 1e-9)) bad.push(`${surface}: ${a.name} on ${a.at}${a.pseudo ?? ''} lasts ${a.duration} (> 200ms)`);
  }
  for (const a of m.running) {
    if (a.iterations === Infinity || a.iterations === null || a.iterations > 1) bad.push(`${surface}: running animation ${a.name} loops`);
    if (a.duration > 200) bad.push(`${surface}: running animation ${a.name} lasts ${a.duration}ms`);
    if (a.props.some((p) => p !== 'opacity')) bad.push(`${surface}: startup animation ${a.name} is not a fade (${a.props})`);
  }
  return bad;
}

// Controls: the rule must catch a vendor image, a looping shimmer, a long fade and a slide, and pass the real mark.
const hpSrc = `data:image/svg+xml,${encodeURIComponent(HP_MARK)}`;
assert.deepEqual(violations({ imgs: [{ src: hpSrc, alt: '' }], svgs: ['<svg><path d="M1 1"/></svg>'], cssImages: [], cascade: [{ name: 'fade', duration: '0.18s', count: '1' }], running: [{ name: 'fade', duration: 180, iterations: 1, props: ['opacity'] }] }, { surface: 'control' }), [], 'positive control: the HP mark and a 180ms fade pass');
assert.equal(violations({ imgs: [{ src: 'data:image/svg+xml,%3Csvg%3E%3Ctitle%3EOpenAI%3C/title%3E%3C/svg%3E', alt: '' }, { src: 'https://cdn.example/logo.png', alt: 'Claude' }], svgs: ['<svg aria-label="GitHub"/>'], cssImages: ['https://cdn.example/x.png'], cascade: [{ name: 'shimmer', duration: '2.2s', count: 'infinite' }], running: [{ name: 'slide', duration: 300, iterations: Infinity, props: ['transform'] }] }, { surface: 'control' }).length, 10, 'negative control: each vendor mark, loop, long duration and non-fade is reported');

const b = await launch(bin);
const counts = { probes: 0, marks: 0 };
try {
  for (const s of SURFACES) for (const dark of [true, false]) for (const width of [800, 1420]) for (const [mode, attr, osReduce] of MOTION) {
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    const body = s.markup !== undefined
      ? `<main style="width:${Math.min(width, 720)}px;height:800px">${s.markup}</main>`
      : `<div id="root"></div><script>window.acquireVsCodeApi=()=>({postMessage(){},getState(){},setState(){}});</script><script>${js}</script>`;
    const html = `<!doctype html><html${s.live ?? ''}${attr} style="${vars}"><head><style>${css}</style></head><body class="${dark ? 'vscode-dark' : 'vscode-light'}">${body}</body></html>`;
    // Media first, then the document, so the first frame already sees the reduced-motion preference.
    await b.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'none' }, { name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }, { name: 'prefers-reduced-motion', value: osReduce ? 'reduce' : 'no-preference' }] });
    const { frameTree } = await b.send('Page.getFrameTree');
    await b.send('Page.setDocumentContent', { frameId: frameTree.frame.id, html });
    let ready = false; for (let n = 0; n < 100 && !ready; n++) { ready = await b.evaluate(`!!document.querySelector(${JSON.stringify(s.ready)})`); if (!ready) await new Promise((r) => setTimeout(r, 20)); }
    assert.ok(ready, `${s.id}: ${s.ready} renders`);
    if (s.post) { await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(s.post)}}))`); await new Promise((r) => setTimeout(r, 30)); }
    const label = `${s.id} ${dark ? 'dark' : 'light'} ${width}px ${mode}`;
    const m = await b.evaluate(PROBE);
    counts.probes++;
    assert.deepEqual(violations(m, { surface: label, reduced: mode !== 'motion' }), [], label);
    if (s.mark) { assert.equal(m.imgs.length, 1, `${label}: the startup surface shows the HP mark once`); counts.marks++; }
    if (evidence && mode === 'motion') {
      const shot = await b.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(evidence, `${s.id}-${dark ? 'dark' : 'light'}-${width}.png`), Buffer.from(shot.data, 'base64'));
    }
  }
  console.log(`PASS startup brand marks: ${counts.probes} probes over ${SURFACES.length} startup/empty surfaces (dark/light, 800/1420px, motion/attr/OS reduced) show only the HP mark (${counts.marks} mark checks) and no startup animation loops or exceeds a 200ms fade`);
} finally { await b.close(); }
