// CGP-AGENT-R-027 / DES-CGP-AGENT-53 — computed layout of the checkpoint form and history in the real ChatPanel,
// built from the webview source and measured in headless Chromium: personal and classroom seats, dark and light,
// 320 / 800 / 1420 px, normal and forced colours. Every button and the textarea are at least 44px tall, personal
// chat text is at least 14px, the textarea has a visible 2px focus ring when focused, nothing overflows the review
// section, and the history sits inside the 바뀐 것 section. FOCUS_REQUIRE_BROWSER=1 makes a missing browser a
// failure; otherwise it prints NOT RUN. CHECKPOINT_EVIDENCE=<dir> writes the PNGs.
//   node --experimental-strip-types test/checkpoint-layout.smoke.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { chatPanelProps, chatConfig } from './sx-screen-fixtures.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const dir = fileURLToPath(new URL('../webview-ui/', import.meta.url));
const app = await build({ entryPoints: [dir + 'src/main.tsx'], bundle: true, platform: 'browser', format: 'esm', outdir: 'assets', write: false, loader: { '.svg': 'dataurl' }, logLevel: 'silent' });
const css = app.outputFiles.find((f) => f.path.endsWith('.css')).text;
const js = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {ChatPanel} from './src/ChatPanel';createRoot(document.getElementById('root')).render(<ChatPanel {...window.fixture}/>);`, resolveDir: dir, loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty', '.svg': 'dataurl' }, logLevel: 'silent' });
const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN checkpoint layout: no Chromium'); process.exit(0); }
const evidence = process.env.CHECKPOINT_EVIDENCE;
if (evidence) mkdirSync(evidence, { recursive: true });
const pause = (ms = 120) => new Promise((r) => setTimeout(r, ms));
const VIEW = {
  turnId: 't1', state: 'open', added: ['images/hero.png'], changed: ['index.html'], deleted: [], notCovered: [],
  checkpoint: { suggestion: '메인 페이지에 예약 버튼과 진료 시간 안내를 추가했어요.', source: 'ai', history: [
    { id: 'cp-2', message: '첫 화면 정리: 병원 소개 문단을 두 줄로 줄이고 사진을 바꿈', createdAt: new Date(2026, 9, 25, 14, 3).getTime(), fileCount: 4 },
    { id: 'cp-1', message: '처음 만든 홈페이지', createdAt: new Date(2026, 9, 24, 9, 30).getTime(), fileCount: 2 },
  ] },
};
const b = await launch(bin);
try {
  for (const seat of ['personal', 'classroom']) for (const dark of [true, false]) for (const width of [320, 800, 1420]) for (const forcedColors of [false, true]) {
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    const config = chatConfig(3, { activity: { ...chatConfig().activity, kind: seat }, profile: { ...chatConfig().profile, lesson: null }, taskWorkspace: seat === 'personal' ? { tasks: [], sources: [] } : undefined });
    const messages = [{ id: 'u1', role: 'user', content: '예약 버튼 넣어 줘', createdAt: 1 }, { id: 'a1', role: 'assistant', content: '메인 페이지에 예약 버튼과 진료 시간 안내를 추가했어요.', createdAt: 2 }];
    await b.load(`<!doctype html><html style="${vars}"><style>${css}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}"><div class="${seat === 'personal' ? 'tw-workspace' : ''}" style="display:block;height:1400px"><div id="root"></div></div><script>window.fixture=${JSON.stringify(chatPanelProps({ config, messages }))};</script><script>${js.outputFiles[0].text}</script></body></html>`, { width, height: 1400, dark, forcedColors });
    await pause();
    await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'turnReviewState',view:${JSON.stringify(VIEW)}}}))`);
    await pause();
    const opened = await b.evaluate(`(()=>{const btn=[...document.querySelectorAll('.hps-checkpoint button')].find(x=>x.textContent==='저장 지점 남기기');if(!btn)return false;btn.click();return true})()`);
    assert.equal(opened, true, 'checkpoint button missing');
    await pause();
    const m = await b.evaluate(`(()=>{const sec=document.querySelector('[data-testid="turn-review"]'),field=document.querySelector('#hps-checkpoint-message'),r=e=>e.getBoundingClientRect();
      const buttons=[...document.querySelectorAll('.hps-checkpoint button')].map(e=>({t:e.textContent,h:r(e).height,w:r(e).width}));
      const texts=[...document.querySelectorAll('.hps-checkpoint label,.hps-checkpoint .hps-turn-review-note,.hps-checkpoint-message,.hps-checkpoint-title,#hps-checkpoint-message')].map(e=>({t:e.textContent.slice(0,12),f:parseFloat(getComputedStyle(e).fontSize)}));
      const fs=getComputedStyle(field);const sr=r(sec),fr=r(field),col=(sec.closest('.hps-messages')||sec.parentElement);
      return {active:document.activeElement===field,selStart:field.selectionStart,selEnd:field.selectionEnd,len:field.value.length,buttons,texts,fieldH:fr.height,fieldW:fr.width,secW:sr.width,secScroll:sec.scrollWidth,secClient:sec.clientWidth,secLeft:sr.left,secRight:sr.right,colLeft:r(col).left,colRight:r(col).right,
        outlineStyle:fs.outlineStyle,outlineWidth:parseFloat(fs.outlineWidth),fieldInSec:sec.contains(field),history:document.querySelectorAll('[data-testid="turn-review"] ol[aria-label="저장 지점 기록"] li').length,docScroll:document.documentElement.scrollWidth,vw:innerWidth}})()`);
    const tag = `${seat} ${width} ${dark ? 'dark' : 'light'} ${forcedColors ? 'forced' : 'normal'}`;
    assert.equal(m.active, true, `${tag}: textarea not focused`);
    assert.deepEqual([m.selStart, m.selEnd], [0, m.len], `${tag}: suggestion not selected`);
    for (const x of m.buttons) assert.ok(x.h >= 44, `${tag}: button ${x.t} ${x.h}px`);
    assert.ok(m.fieldH >= 44, `${tag}: textarea ${m.fieldH}px`);
    if (seat === 'personal') for (const x of m.texts) assert.ok(x.f >= 14, `${tag}: ${x.t} ${x.f}px`);
    assert.ok(m.secScroll <= m.secClient + 1, `${tag}: review overflows (${m.secScroll} > ${m.secClient})`);
    assert.ok(m.fieldW <= m.secW, `${tag}: textarea wider than the section`);
    assert.ok(m.docScroll <= m.vw + 1, `${tag}: page scrolls sideways (${m.docScroll} > ${m.vw})`);
    assert.equal(m.fieldInSec, true);
    assert.equal(m.history, 2, `${tag}: history not inside the 바뀐 것 section`);
    // Keyboard focus ring: focus-visible after a keyboard move.
    await b.evaluate(`document.querySelector('#hps-checkpoint-message').blur()`);
    await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await b.evaluate(`document.querySelector('#hps-checkpoint-message').focus()`);
    await pause(60);
    const ring = await b.evaluate(`(()=>{const s=getComputedStyle(document.querySelector('#hps-checkpoint-message'));return {style:s.outlineStyle,width:parseFloat(s.outlineWidth)}})()`);
    assert.ok(ring.style !== 'none' && ring.width >= 2, `${tag}: no visible focus ring (${JSON.stringify(ring)})`);
    if (evidence) { const shot = await b.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); writeFileSync(`${evidence}/checkpoint-${seat}-${width}-${dark ? 'dark' : 'light'}-${forcedColors ? 'forced' : 'normal'}.png`, Buffer.from(shot.data, 'base64')); }
    console.log('PASS', tag);
  }
} finally { await b.close(); }
console.log('PASS checkpoint layout');
