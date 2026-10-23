// CGP-KNOW-R-035: the takeaway button measured on the CASCADE (headless Chromium, computed styles), not read from CSS text.
//   node --experimental-strip-types test/work-takeaway-layout.smoke.mjs
// Real ActivityStatus markup + the shipped stylesheet bundle (focus-geometry order), both seats where it shows
// (ended / solo and classroom), dark and light, 1420 / 800 / 360 px, forced colours at 800 px.
// No Chromium: prints NOT RUN, or fails when FOCUS_REQUIRE_BROWSER=1 (CI sets it).
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { findChromium, launch } from './lib/headless-chromium.mjs';
const SRC = fileURLToPath(new URL('../webview-ui/src', import.meta.url));
const webviewRequire = createRequire(new URL('../webview-ui/package.json', import.meta.url));

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('work-takeaway-layout: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('work-takeaway-layout: NOT RUN (no headless Chromium; set HEADLESS_CHROMIUM)');
  process.exit(0);
}

const cssFiles = readdirSync(SRC).filter((f) => f.endsWith('.css') && !['tokens.css', 'designTokens.css', 'focusGeometry.css', 'styles.css', 'chatDetails.css'].includes(f)).sort();
const order = ['tokens.css', ...(existsSync(resolve(SRC, 'focusGeometry.css')) ? ['focusGeometry.css'] : []), ...cssFiles, 'styles.css', 'chatDetails.css'];
const cssBundle = await build({
  stdin: { contents: order.map((f) => `@import "./${f}";`).join('\n'), resolveDir: SRC, loader: 'css' },
  bundle: true, write: false, outdir: 'out', logLevel: 'silent',
  plugins: [{ name: 'external', setup(b) { b.onResolve({ filter: /\.(svg|png|jpe?g|gif|webp|woff2?)$/ }, (a) => ({ path: a.path, external: true })); } }],
});
const css = cssBundle.outputFiles.find((o) => o.path.endsWith('.css')).text;
const jsBundle = await build({
  stdin: {
    contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {ActivityStatus} from './ActivityStatus';
const noop=()=>{}; export const render=(cause,audience)=>renderToStaticMarkup(<ActivityStatus status={{cause,audience}} onOpen={noop} onExport={noop} onRecover={noop} onSupport={noop} onToken={noop} onTakeaway={noop}/>);`,
    resolveDir: SRC, loader: 'tsx', sourcefile: 'entry.tsx',
  },
  bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic', logLevel: 'silent',
  nodePaths: [resolve(SRC, '../node_modules')],
});
const mod = { exports: {} };
new Function('module', 'exports', 'require', jsBundle.outputFiles[0].text)(mod, mod.exports, webviewRequire);
const { render } = mod.exports;

const LABEL = '내 작업 가져가기';
const page = (cause, audience, width, dark) => `<!doctype html><html><head><style>${css}</style></head><body style="margin:0;background:${dark ? '#1e1e1e' : '#fff'};color:${dark ? '#ddd' : '#222'}"><div style="width:${Math.min(width - 40, 640)}px;padding:20px">${render(cause, audience)}</div></body></html>`;
const probe = `(() => { const b = [...document.querySelectorAll('.hps-activity-status button')].find((x) => x.textContent === ${JSON.stringify(LABEL)}); if (!b) return JSON.stringify({ found: false }); b.setAttribute('data-takeaway-probe', '1');
  const r = b.getBoundingClientRect(), s = getComputedStyle(b), box = document.querySelector('.hps-activity-status'), br = box.getBoundingClientRect(), bs = getComputedStyle(box);
  return JSON.stringify({ found: true, height: r.height, minHeight: s.minHeight, fontSize: parseFloat(s.fontSize), right: r.right, left: r.left, boxRight: br.right, boxLeft: br.left, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, boxBorder: bs.borderTopColor, boxBorderWidth: bs.borderTopWidth, canvasText: (() => { const e = document.createElement('i'); e.style.color = 'CanvasText'; document.body.appendChild(e); const c = getComputedStyle(e).color; e.remove(); return c; })() }); })()`;

const browser = await launch(bin);
let cases = 0;
try {
  for (const audience of ['solo', 'classroom']) for (const dark of [true, false]) for (const width of [1420, 800, 360]) {
    await browser.load(page('ended', audience, width, dark), { width, height: 600, dark });
    const m = JSON.parse(await browser.evaluate(probe));
    const name = `${audience}/${dark ? 'dark' : 'light'}/${width}`;
    assert.ok(m.found, `${name}: the takeaway button renders at class end`);
    assert.ok(m.height >= 44, `${name}: target height ${m.height}`);
    assert.ok(parseFloat(m.minHeight) >= 44, `${name}: min-height ${m.minHeight}`);
    assert.ok(m.fontSize >= 14, `${name}: font ${m.fontSize}`);
    assert.ok(m.scrollWidth <= m.clientWidth, `${name}: horizontal overflow ${m.scrollWidth} > ${m.clientWidth}`);
    assert.ok(m.right <= m.boxRight + 0.5 && m.left >= m.boxLeft - 0.5, `${name}: button inside the status box`);
    const ring = await browser.focusVisibleStyle('[data-takeaway-probe]');
    assert.equal(ring['outline-width'], '2px', `${name}: ring width`);
    assert.equal(ring['outline-style'], 'solid', `${name}: ring style`);
    assert.equal(ring['outline-offset'], '2px', `${name}: ring offset`);
    cases++;
  }
  // Forced colours: the ring is the system Highlight colour and the status box keeps a visible CanvasText edge.
  for (const audience of ['solo', 'classroom']) {
    await browser.load(page('ended', audience, 800, true), { width: 800, height: 600, forcedColors: true });
    const m = JSON.parse(await browser.evaluate(probe));
    assert.ok(m.found && m.height >= 44 && m.fontSize >= 14, `${audience}/forced: size holds`);
    assert.equal(m.boxBorder, m.canvasText, `${audience}/forced: status edge is CanvasText`);
    assert.notEqual(m.boxBorderWidth, '0px', `${audience}/forced: edge is drawn`);
    const ring = await browser.focusVisibleStyle('[data-takeaway-probe]');
    const highlight = await browser.evaluate(`(() => { const e = document.createElement('i'); e.style.color = 'Highlight'; document.body.appendChild(e); const c = getComputedStyle(e).color; e.remove(); return c; })()`);
    assert.equal(ring['outline-color'], highlight, `${audience}/forced: ring is Highlight`);
    assert.equal(ring['outline-width'], '2px'); assert.equal(ring['outline-style'], 'solid');
    cases++;
  }
  // The same markup for other causes carries no takeaway button (computed DOM, not source text).
  for (const cause of ['outage', 'limited', 'auth']) {
    await browser.load(page(cause, 'solo', 800, true), { width: 800, height: 600 });
    assert.equal(JSON.parse(await browser.evaluate(probe)).found, false, `${cause}: no takeaway button`);
    assert.equal(await browser.evaluate(`document.querySelectorAll('.hps-activity-status button').length > 0`), true, `${cause}: positive control, other actions render`);
  }
} finally { await browser.close(); }
console.log(`work-takeaway-layout: ${cases} computed cases (44px, 14px, ring, overflow, forced colours, 1420/800/360, both seats) PASS`);
