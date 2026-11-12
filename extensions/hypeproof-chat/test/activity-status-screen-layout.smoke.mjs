// CGP-KNOW-D-036: the activity status screen measured on the CASCADE (headless Chromium, computed styles).
//   node --experimental-strip-types test/activity-status-screen-layout.smoke.mjs
// Real ActivityStatus markup + the shipped stylesheet bundle, every cause, both seats, dark and light, 740 / 320 px.
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
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('activity-status-screen-layout: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('activity-status-screen-layout: NOT RUN (no headless Chromium; set HEADLESS_CHROMIUM)');
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


// The panel column is the width under test (740 = the design's "headline one line" width, 320 = narrowest).
const CAUSES = ['auth', 'expired', 'ended', 'paused', 'exhausted', 'forbidden', 'not_started', 'outage', 'limited', 'unknown', 'revoked'];
const page = (cause, audience, width, dark) => `<!doctype html><html><head><meta name="viewport" content="width=${width}"><style>${css}</style></head><body style="margin:0;background:${dark ? '#1e1e1e' : '#fff'};color:${dark ? '#ddd' : '#222'}"><footer class="hps-input-area" style="box-sizing:border-box;width:${width}px;padding:0 16px">${render(cause, audience)}</footer></body></html>`;
const probe = `(() => { const box = document.querySelector('.hps-activity-status'); const h = box.querySelector('h3'); const hs = getComputedStyle(h);
  const lh = parseFloat(hs.lineHeight) || parseFloat(hs.fontSize) * 1.5; const range = document.createRange(); range.selectNodeContents(h);
  const own = [...box.querySelectorAll('.hps-activity-status-can button')].map((b) => ({ label: b.textContent, height: b.getBoundingClientRect().height, disabled: b.disabled, right: b.getBoundingClientRect().right }));
  return JSON.stringify({ lines: range.getClientRects().length, headHeight: h.getBoundingClientRect().height, lh, fontSize: parseFloat(getComputedStyle(box).fontSize),
    own, boxRight: box.getBoundingClientRect().right, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
    color: getComputedStyle(box).color, bg: getComputedStyle(document.body).backgroundColor }); })()`;

const browser = await launch(bin);
let cases = 0;
try {
  for (const cause of CAUSES) for (const audience of ['solo', 'classroom']) for (const dark of [true, false]) for (const width of [740, 320]) {
    await browser.load(page(cause, audience, width, dark), { width, height: 900, dark });
    const m = JSON.parse(await browser.evaluate(probe));
    const name = `${cause}/${audience}/${dark ? 'dark' : 'light'}/${width}`;
    if (width === 740) assert.ok(m.lines === 1 && m.headHeight <= m.lh * 1.5, `${name}: headline is one line (${m.lines} rects, ${m.headHeight}px vs line ${m.lh}px)`);
    assert.ok(m.own.length >= 2, `${name}: own-file buttons render`);
    for (const b of m.own) {
      assert.ok(b.height >= 44, `${name}: ${b.label} height ${b.height}`);
      assert.equal(b.disabled, false, `${name}: ${b.label} enabled`);
      assert.ok(b.right <= m.boxRight + 0.5, `${name}: ${b.label} inside the screen`);
    }
    assert.ok(m.scrollWidth <= m.clientWidth, `${name}: horizontal overflow ${m.scrollWidth} > ${m.clientWidth}`);
    assert.notEqual(m.color, m.bg, `${name}: text differs from the background`);
    cases++;
  }
  // The composer card next to the screen is hidden on the CASCADE in every layout that sets its own display
  // (plain, personal shell, file context, folder missing, both); the same card without [hidden] is drawn (control).
  const card = (attrs) => `<div class="hps-input" ${attrs}><textarea></textarea></div>`;
  for (const shell of ['hps-shell', 'hps-shell" data-chat-detail="personal']) for (const extra of ['', 'data-file-context="true"', 'data-folder-missing="true"', 'data-file-context="true" data-folder-missing="true"']) {
    const html = (hidden) => `<!doctype html><html><head><style>${css}</style></head><body><div class="${shell}"><footer class="hps-input-area">${render('ended', 'solo')}${card(`${extra}${hidden ? ' data-activity-status="true" hidden' : ''}`)}</footer></div></body></html>`;
    const display = `getComputedStyle(document.querySelector('.hps-input')).display`;
    await browser.load(html(true), { width: 740, height: 900 });
    assert.equal(await browser.evaluate(display), 'none', `${shell} ${extra}: composer card hidden`);
    await browser.load(html(false), { width: 740, height: 900 });
    assert.notEqual(await browser.evaluate(display), 'none', `${shell} ${extra}: control, card drawn without [hidden]`);
    cases++;
  }
  // Negative control: the instrument must see two lines when the column is too narrow for the headline.
  await browser.load(page('forbidden', 'solo', 120, true), { width: 120, height: 900, dark: true });
  assert.ok(JSON.parse(await browser.evaluate(probe)).lines > 1, 'negative control: a 120px column wraps the headline');
} finally { await browser.close(); }
console.log(`activity-status-screen-layout: ${cases} computed cases (one-line headline at 740, 44px enabled own-file buttons, no overflow at 320, dark and light, both seats, composer card hidden in 8 layouts) PASS`);
