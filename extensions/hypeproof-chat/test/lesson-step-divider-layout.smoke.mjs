// CGP-CHAT-R-023 / CGP-CHAT-D56 — computed layout and real behaviour of the lesson step divider, on the mounted
// ChatPanel with the shipped stylesheet in headless Chromium: the hairline spans the chat column, the label stays at
// the 14px floor, the divider takes no focus, "지금 단계로" is a 44px header button that scrolls the transcript to the
// current step's divider (instantly under reduced motion) without moving the rail, and forced colours keep the line.
// Classroom lesson seat, dark and light, 360, 800 and 1420 px wide (a 60-character title wraps at 360 and keeps its line) (1600 tall: the lesson header and rail cards take
// the top 640 px, and the transcript needs room to show the jump); the personal seat (no lesson) draws none.
// Fails under FOCUS_REQUIRE_BROWSER=1 without a browser; prints NOT RUN otherwise.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chatConfig, chatPanelProps } from './sx-screen-fixtures.mjs';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const SHA = 'f'.repeat(64);
// CGP-CHAT-D-023 — step 2 carries a title at the host's 60-character cap (STEP_TITLE_MAX), so a narrow column must wrap it.
const LONG = '화면 구성 요소를 하나씩 나누어 만들고 각 부분이 어떻게 연결되는지 직접 확인해 보는 단계입니다 그리고 마지막으로'.slice(0, 59) + '…';
const steps = [['expect', 1, '기대 조건'], ['build', 2, LONG], ['test', 3, 'Preview / Test']];
const messages = [], stepMarks = {};
for (const [id, n, title] of steps) for (let k = 0; k < 4; k++) {
  const u = `u-${id}-${k}`;
  messages.push({ id: u, role: 'user', content: `${title} 질문 ${k}`, createdAt: 1 }, { id: `a-${id}-${k}`, role: 'assistant', content: `${title} 답변 ${k}. `.repeat(12), createdAt: 1 });
  stepMarks[u] = { lesson: SHA, id, n, title };
}
const props = chatPanelProps({ messages, stepMarks });
const callbacks = Object.entries(props).filter(([, v]) => typeof v === 'function').map(([k]) => `${k}:()=>{}`).join(',');
const data = Object.fromEntries(Object.entries(props).filter(([, v]) => typeof v !== 'function'));
const asset = await build({ entryPoints: [`${root}/webview-ui/src/main.tsx`], bundle: true, write: false, outdir: 'out', loader: { '.svg': 'dataurl' }, logLevel: 'silent' });
const css = asset.outputFiles.find((f) => f.path.endsWith('.css')).text;
const js = (await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{ChatPanel}from'./src/ChatPanel';const root=createRoot(document.getElementById('root'));window.mount=(config,marks)=>root.render(<ChatPanel {...${JSON.stringify(data)}} {...{${callbacks}}} config={config} stepMarks={marks}/>);`, resolveDir: root + '/webview-ui', loader: 'tsx' }, bundle: true, write: false, outdir: 'fixture-assets', format: 'iife', platform: 'browser', loader: { '.svg': 'dataurl' }, logLevel: 'silent' })).outputFiles.find((f) => f.path.endsWith('.js')).text;

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN: lesson step divider browser unavailable'); process.exit(0); }
const browser = await launch(bin), evidence = process.env.STEP_DIVIDER_EVIDENCE;
if (evidence) mkdirSync(evidence, { recursive: true });
const delay = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const classroom = chatConfig();
const personal = chatConfig(3, { profile: { ...chatConfig().profile, lesson: null }, taskWorkspace: { scope: 's', revision: 1, activeTaskId: 't1', tasks: [{ id: 't1', title: '작업', createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null } });
let cases = 0;
try {
  for (const dark of [false, true]) for (const width of [360, 800, 1420]) {
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    // At 360px the lesson header, rail and step work wrap tall and the access header (CGP-LEARN-R-016) sits above
    // them, so the narrow case gets a taller window to leave the transcript room for the jump.
    await browser.load(`<html style="${vars}"><style>${css}</style><style>html,body,#root{height:100%}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}" style="margin:0"><div id="root"></div><script>window.posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m),getState:()=>({}),setState:()=>{}});</script><script>${js}</script></body></html>`, { width, height: width === 360 ? 1800 : 1600, dark });
    // Reduced motion from the start, so the mount's scroll to the latest message and the jump are both instant.
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
    await browser.evaluate(`mount(${JSON.stringify(classroom)},${JSON.stringify(stepMarks)})`); await delay();
    const m = await browser.evaluate(`(()=>{
      const box=document.querySelector('.hps-messages'),ds=[...box.querySelectorAll('.hps-step-divider')],br=box.getBoundingClientRect(),cs=getComputedStyle(box);
      const inner=br.width-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight)-(box.offsetWidth-box.clientWidth);
      const user=box.querySelector('.hps-msg-user');
      return {count:ds.length,labels:ds.map(d=>d.getAttribute('aria-label')),
        lines:ds.map(d=>{const before=getComputedStyle(d,'::before'),after=getComputedStyle(d,'::after'),r=d.getBoundingClientRect(),l=d.querySelector('.hps-step-divider-label').getBoundingClientRect();
          return {lineL:parseFloat(before.width),lineR:parseFloat(after.width),w:r.width,inner,lineTop:parseFloat(before.borderTopWidth),lineStyle:before.borderTopStyle,afterTop:parseFloat(after.borderTopWidth),centred:Math.abs((l.left+l.right)/2-(r.left+r.right)/2),font:parseFloat(getComputedStyle(d.querySelector('.hps-step-divider-label')).fontSize),tab:d.tabIndex,focusables:d.querySelectorAll('button,a,input,[tabindex]').length,inBox:r.left>=br.left-1&&r.right<=br.right+1}}),
        jump:(()=>{const b=document.querySelector('.hp-mission-jump');if(!b)return null;const r=b.getBoundingClientRect();return {w:r.width,h:r.height,font:parseFloat(getComputedStyle(b).fontSize),inHeader:!!b.closest('header.hp-mission')}})(),
        overflow:document.documentElement.scrollWidth>innerWidth,scrolls:box.scrollHeight>box.clientHeight}})()`);
    const tag = `${dark ? 'dark' : 'light'} ${width}`;
    assert.equal(m.count, 3, `${tag}: one divider per served step`);
    assert.deepEqual(m.labels, ['1단계: 기대 조건', `2단계: ${LONG}`, '3단계: Preview / Test']);
    for (const l of m.lines) {
      assert.ok(l.w >= l.inner - 2, `${tag}: the hairline spans the chat column (${l.w} vs ${l.inner})`);
      assert.ok(l.inBox, `${tag}: within the transcript`);
      assert.equal(l.lineStyle, 'solid'); assert.ok(l.lineTop >= 1 && l.lineTop <= 1.5 && l.afterTop >= 1, `${tag}: a 1px hairline on both sides`);
      assert.ok(l.centred <= 2, `${tag}: label centred`);
      assert.ok(l.lineL >= 24 && l.lineR >= 24, `${tag}: at least 24px of hairline on each side of the label (${l.lineL}/${l.lineR})`);
      assert.ok(l.font >= 14, `${tag}: label >= 14px (${l.font})`);
      assert.equal(l.tab, -1, `${tag}: the divider is not focusable`); assert.equal(l.focusables, 0);
    }
    assert.ok(m.jump, `${tag}: the header offers 지금 단계로`);
    assert.ok(m.jump.h >= 44 && m.jump.w >= 44 && m.jump.font >= 14 && m.jump.inHeader, `${tag}: a 44px header button at the 14px floor ${JSON.stringify(m.jump)}`);
    assert.equal(m.overflow, false, `${tag}: no horizontal page scroll`);
    assert.equal(m.scrolls, true, `${tag}: the transcript scrolls (the jump has work to do)`);

    // Tab order never stops on a divider.
    const stops = await browser.evaluate(`(()=>{const seen=[];document.body.focus();const all=[...document.querySelectorAll('button,a[href],input,textarea,select,[tabindex]')].filter(e=>e.tabIndex>=0);return all.filter(e=>e.closest('.hps-step-divider')).length})()`);
    assert.equal(stops, 0, `${tag}: no focus stop inside a divider`);

    // The jump: transcript at the bottom, rail on its first step ("expect"), reduced motion: an instant scroll.
    const before = await browser.evaluate(`(()=>{const box=document.querySelector('.hps-messages');box.scrollTop=box.scrollHeight;posted.length=0;return {summary:document.querySelector('.hp-rail-lesson summary')?.textContent,primary:document.querySelector('.hp-mission .hp-cta-primary')?.textContent}})()`);
    await browser.evaluate(`document.querySelector('.hp-mission-jump').click()`); await delay();
    const after = await browser.evaluate(`(()=>{const box=document.querySelector('.hps-messages'),d=box.querySelector('[data-step-divider="u-expect-0"]');return {box:box.clientHeight,offset:d.getBoundingClientRect().top-box.getBoundingClientRect().top,summary:document.querySelector('.hp-rail-lesson summary')?.textContent,primary:document.querySelector('.hp-mission .hp-cta-primary')?.textContent,posted:posted.map(p=>p.type)}})()`);
    assert.ok(Math.abs(after.offset) <= 2, `${tag}: the current step's divider is at the top of the transcript (${after.offset})`);
    assert.ok(after.box >= 200, `${tag}: the transcript has room to show the divider (${after.box})`);
    assert.equal(after.summary, before.summary, `${tag}: the rail did not move`);
    assert.equal(after.primary, before.primary, `${tag}: the header's step did not move`);
    assert.deepEqual(after.posted.filter((t) => /lesson/i.test(t)), [], `${tag}: no step message to the host`);

    // Forced colours keep the hairline and the label.
    if (width === 800) {
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] }); await delay();
      const fc = await browser.evaluate(`(()=>{const d=document.querySelector('.hps-step-divider');const b=getComputedStyle(d,'::before');return {w:parseFloat(b.borderTopWidth),style:b.borderTopStyle,color:b.borderTopColor,bg:getComputedStyle(document.body).backgroundColor}})()`);
      assert.ok(fc.w >= 1 && fc.style === 'solid' && fc.color !== fc.bg, `${tag}: forced colours keep the line ${JSON.stringify(fc)}`);
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'none' }, { name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
    }
    if (evidence) {
      await browser.evaluate(`(()=>{const box=document.querySelector('.hps-messages'),d=box.querySelector('[data-step-divider="u-build-0"]');box.scrollTop+=d.getBoundingClientRect().top-box.getBoundingClientRect().top-120})()`); await delay();
      const shot = await browser.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${evidence}/classroom-${dark ? 'dark' : 'light'}-${width}.png`, Buffer.from(shot.data, 'base64'));
    }

    // Personal seat (no lesson): no divider, no jump.
    await browser.evaluate(`mount(${JSON.stringify(personal)},${JSON.stringify(stepMarks)})`); await delay();
    const p = await browser.evaluate(`({d:document.querySelectorAll('.hps-step-divider').length,j:document.querySelectorAll('.hp-mission-jump').length})`);
    assert.deepEqual(p, { d: 0, j: 0 }, `${tag}: personal seat draws no step divider`);
    if (evidence) { const shot = await browser.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/personal-${dark ? 'dark' : 'light'}-${width}.png`, Buffer.from(shot.data, 'base64')); }
    cases++;
  }
  console.log(`PASS lesson-step-divider-layout: ${cases} theme/width cases, hairline, 14px label, no focus stop, 44px jump that scrolls without moving the rail, forced colours, personal none`);
} finally { await browser.close(); }
