// CGP-ART-R-023 (REQ-ART-23 (2)) — the deck PDF's saved notice offers 폴더에서 보기 on the mounted ChatPanel with the shipped
// stylesheet in headless Chromium. It checks:
// - the action is a quiet 44px button at the 14px floor, named "폴더에서 보기: <file>", with a visible focus ring;
// - it sits outside the notice's polite region, so the region reads only the sentence;
// - a press posts exactly { type: "deckPdfReveal" } and no path (the host decides which file and checks it);
// - a notice without an action draws no button (control).
// Runs dark and light, at 320 and 800 px. Fails under FOCUS_REQUIRE_BROWSER=1 without a browser; prints NOT RUN otherwise.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { chatConfig, chatPanelProps } from './sx-screen-fixtures.mjs';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const props = chatPanelProps({});
const callbacks = Object.entries(props).filter(([, v]) => typeof v === 'function').map(([k]) => `${k}:()=>{}`).join(',');
const data = Object.fromEntries(Object.entries(props).filter(([, v]) => typeof v !== 'function'));
delete data.messages; delete data.config; delete data.pageNotice; delete data.pageNoticeAction;
const asset = await build({ entryPoints: [`${root}/webview-ui/src/main.tsx`], bundle: true, write: false, outdir: 'out', loader: { '.svg': 'dataurl' }, logLevel: 'silent' });
const css = asset.outputFiles.find((f) => f.path.endsWith('.css')).text;
const js = (await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{ChatPanel}from'./src/ChatPanel';
const root=createRoot(document.getElementById('root'));
window.mount=(config,notice,action)=>root.render(<ChatPanel {...${JSON.stringify(data)}} {...{${callbacks}}} config={config} messages={[]} pageNotice={notice} pageNoticeAction={action}/>);`, resolveDir: root + '/webview-ui', loader: 'tsx' }, bundle: true, write: false, outdir: 'out', platform: 'browser', loader: { '.svg': 'dataurl' }, logLevel: 'silent' })).outputFiles.find((f) => f.path.endsWith('.js')).text;

const config = chatConfig();
const SAVED = '덱을 PDF로 저장했어요: venture/deck.pdf (3장, 발표자 노트 없이)';
const ACTION = { kind: 'deckPdfReveal', label: '폴더에서 보기', name: 'venture/deck.pdf' };

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN: page-notice-action browser unavailable'); process.exit(0); }
const browser = await launch(bin);
const ev = (expr) => browser.evaluate(expr);
const settle = () => new Promise((r) => setTimeout(r, 80));
let checks = 0;
try {
  for (const dark of [false, true]) for (const width of [320, 800]) {
    const tag = `${dark ? 'dark' : 'light'} ${width}`;
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await browser.load(`<html lang="ko" style="${vars}"><style>${css}</style><style>html,body,#root{height:100%}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}" style="margin:0"><div id="root"></div><script>window.posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m),getState:()=>({}),setState:()=>{}});</script><script>${js}</script></body></html>`, { width, height: 900, dark });
    // Control: a notice without an action has no button.
    await ev(`mount(${JSON.stringify(config)}, ${JSON.stringify(SAVED)}, undefined)`); await settle();
    assert.deepEqual(await ev(`[!!document.querySelector('.hps-page-notice'), document.querySelectorAll('[data-page-notice-action]').length]`), [true, 0], `${tag}: no action, no button`);
    await ev(`mount(${JSON.stringify(config)}, ${JSON.stringify(SAVED)}, ${JSON.stringify(ACTION)})`); await settle();
    const look = await ev(`(()=>{const b=document.querySelector('[data-page-notice-action="deckPdfReveal"]'),r=b.getBoundingClientRect(),cs=getComputedStyle(b),live=document.querySelector('.hps-page-notice');
      return {name:b.getAttribute('aria-label'),words:b.textContent,cls:b.className,h:r.height,w:r.width,f:parseFloat(cs.fontSize),inLive:!!b.closest('[aria-live]'),live:live.textContent,scroll:document.documentElement.scrollWidth>innerWidth}})()`);
    assert.equal(look.name, '폴더에서 보기: venture/deck.pdf', `${tag}: accessible name`);
    assert.equal(look.words, '폴더에서 보기');
    assert.equal(look.cls, 'hp-cta-quiet', `${tag}: a quiet button, not Primary`);
    assert.ok(look.h >= 44 && look.w >= 44 && look.f >= 14, `${tag}: 44px / 14px ${JSON.stringify(look)}`);
    assert.equal(look.inLive, false, `${tag}: the button is outside the polite region`);
    assert.equal(look.live.trim(), SAVED, `${tag}: the region reads only the sentence`);
    assert.equal(look.scroll, false, `${tag}: no sideways scroll`);
    const ring = await browser.focusVisibleStyle('[data-page-notice-action="deckPdfReveal"]');
    assert.ok(parseFloat(ring['outline-width']) > 0 && ring['outline-style'] !== 'none', `${tag}: focus ring ${JSON.stringify(ring)}`);
    const before = await ev('posted.length');
    await ev(`document.querySelector('[data-page-notice-action="deckPdfReveal"]').click()`); await settle();
    assert.deepEqual(await ev(`posted.slice(${before})`), [{ type: 'deckPdfReveal' }], `${tag}: one press posts deckPdfReveal and no path`);
    checks += 10;
  }
  console.log(`PASS page-notice-action-browser: ${checks} checks (light/dark, 320/800 px)`);
} finally { await browser.close(); }
