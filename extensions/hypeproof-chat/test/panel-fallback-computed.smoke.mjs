// CGP-SHELL-D-012: a failed panel's fallback, measured on the real markup and the real cascade.
// Declarations are not enough: a later override or @media rule must not shrink the retry target.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {mkdirSync, writeFileSync} from 'node:fs';
import {THEMES} from './lib/vscode-default-themes.mjs';
import {findChromium, launch} from './lib/headless-chromium.mjs';
const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN panel fallback: no Chromium'); process.exit(0); }
const dir = fileURLToPath(new URL('../webview-ui/', import.meta.url));
const bundle = await build({entryPoints: [dir + 'src/main.tsx'], bundle: true, platform: 'browser', format: 'esm', outdir: 'panel-assets', write: false, loader: {'.svg': 'dataurl'}, logLevel: 'silent'});
const css = bundle.outputFiles.find((f) => f.path.endsWith('.css')).text;
// The fallback is drawn by the real PanelBoundary around a child that throws. The composer is a
// sibling outside the boundary, as in the app.
const script = await build({stdin: {contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {PanelBoundary} from './src/PanelBoundary';
const Boom=()=>{throw new Error('secret learner draft');};
window.addEventListener('error',e=>e.preventDefault());
const origError=console.error;console.error=()=>{};
createRoot(document.getElementById('mount')).render(<><PanelBoundary panel="task-rail"><Boom/></PanelBoundary><PanelBoundary panel="sources" blocking><Boom/></PanelBoundary><textarea id="composer" defaultValue="draft"/></>);`, resolveDir: dir, loader: 'tsx'}, bundle: true, write: false, platform: 'browser', format: 'iife', loader: {'.css': 'empty', '.svg': 'dataurl'}, logLevel: 'silent'});
const b = await launch(bin);
const evidence = process.env.PANEL_EVIDENCE;
if (evidence) mkdirSync(evidence, {recursive: true});
const measure = () => b.evaluate(`(()=>{const cs=(e)=>getComputedStyle(e);return {composer:(()=>{const c=document.getElementById('composer');return !!c&&!c.disabled&&c.value==='draft'&&cs(c).display!=='none';})(),boxes:[...document.querySelectorAll('.hps-panel-fallback')].map(box=>{const r=box.getBoundingClientRect();const btn=box.querySelector('.hps-panel-fallback-retry');const br=btn.getBoundingClientRect();const t=box.querySelector('.hps-panel-fallback-text');const ic=box.querySelector('svg');return {fits:r.left>=0&&r.right<=innerWidth,width:r.width,boxBorder:cs(box).borderTopWidth+'|'+cs(box).borderTopStyle+'|'+cs(box).borderTopColor,btnH:br.height,btnW:br.width,btnFont:parseFloat(cs(btn).fontSize),textFont:parseFloat(cs(t).fontSize),textLines:Math.round(t.getBoundingClientRect().height/parseFloat(cs(t).lineHeight)),btnBorder:cs(btn).borderTopWidth+'|'+cs(btn).borderTopStyle,iconHidden:ic.getAttribute('aria-hidden')==='true',btnInside:br.right<=r.right+0.5&&br.left>=r.left-0.5,textLeak:box.textContent.includes('secret'),label:btn.textContent,role:box.getAttribute('role')};})};})()`);
try {
  for (const seat of ['personal', 'classroom']) for (const dark of [false, true]) for (const width of [320, 800, 1420]) {
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await b.load(`<html style="${vars}"><style>${css}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}"><div class="${seat === 'personal' ? 'tw-workspace' : ''}" style="display:block"><div class="hps-shell" ${seat === 'personal' ? 'data-chat-detail="personal"' : ''}><div id="mount"></div></div></div><script>${script.outputFiles[0].text}</script></body></html>`, {width, height: 700, dark});
    await new Promise((r) => setTimeout(r, 100));
    const m = await measure();
    const tag = `${seat}/${dark ? 'dark' : 'light'}/${width}`;
    assert.equal(m.boxes.length, 2, `${tag}: both failed panels must show a fallback ${JSON.stringify(m)}`);
    assert.equal(m.composer, true, `${tag}: composer outside the boundary stays interactive and keeps its draft`);
    for (const x of m.boxes) {
      const why = `${tag}: ${JSON.stringify(x)}`;
      assert.ok(x.btnH >= 44 && x.btnW >= 44, `retry target >=44px, ${why}`);
      assert.ok(x.btnFont >= 14 && x.textFont >= 14, `text >=14px, ${why}`);
      assert.ok(x.fits && x.btnInside, `fallback and button fit the column, ${why}`);
      assert.ok(x.iconHidden && !x.textLeak && x.role === 'status', `decorative icon, no message leak, status role, ${why}`);
      assert.ok(parseFloat(x.btnBorder) >= 1 && x.btnBorder.endsWith('solid'), `retry has a visible border, ${why}`);
      assert.ok(parseFloat(x.boxBorder) >= 1 && x.boxBorder.includes('solid'), `fallback has a visible border, ${why}`);
      assert.equal(x.label, '다시 불러오기');
    }
    // Forced colours: the box edge and the focus ring must survive the system palette.
    await b.send('Emulation.setEmulatedMedia', {features: [{name: 'forced-colors', value: 'active'}, {name: 'prefers-color-scheme', value: dark ? 'dark' : 'light'}]});
    const forced = await b.evaluate(`getComputedStyle(document.querySelector('.hps-panel-fallback')).borderTopColor`);
    assert.ok(forced.startsWith('rgb'), `${tag}: forced-colours border resolves ${forced}`);
    const ring = await b.focusVisibleStyle('.hps-panel-fallback-retry');
    assert.ok(parseFloat(ring['outline-width']) >= 2 && ring['outline-style'] !== 'none', `${tag}: forced-colours focus ring ${JSON.stringify(ring)}`);
    await b.send('Emulation.setEmulatedMedia', {features: [{name: 'forced-colors', value: 'none'}, {name: 'prefers-color-scheme', value: dark ? 'dark' : 'light'}]});
    const ring2 = await b.focusVisibleStyle('.hps-panel-fallback-retry');
    assert.ok(parseFloat(ring2['outline-width']) >= 2 && ring2['outline-style'] !== 'none', `${tag}: focus ring ${JSON.stringify(ring2)}`);
    if (evidence) { const shot = await b.send('Page.captureScreenshot', {format: 'png'}); writeFileSync(`${evidence}/${seat}-${width}-${dark ? 'dark' : 'light'}.png`, Buffer.from(shot.data, 'base64')); }
  }
  console.log('PASS panel fallback: 44px target, >=14px text, fit, forced-colours and focus ring, composer untouched, both seats/themes/widths');
} finally { await b.close(); }
