// CGP-CHAT-R-028 / CGP-CHAT-D81 — the "내 질문" list on the mounted ChatPanel with the shipped stylesheet in headless
// Chromium. Personal seat (inside the task workspace frame, header drawn into the task heading) and classroom lesson
// seat, dark and light, 800 and 1420 px: no button below 4 prompts; from 4 a 44px header button at the 14px floor
// opens a popover of numbered first lines, 44px rows, at most 10 visible before the list scrolls, inside the
// viewport. Choosing a row by keyboard scrolls the transcript so that prompt sits at its top (instantly under
// reduced motion), moves focus onto that prompt with a ring that hugs it, and closes the list; the prompt leaves the
// Tab order again once focus moves on. Escape closes and returns focus to the button. Forced colours keep the
// popover edge. CGP-CHAT-D-028: the popover hangs from the header button, a pointer choice also focuses the bubble,
// and a short window (1280x720, 800x480) shows only the whole rows that fit, up to 10. Fails under FOCUS_REQUIRE_BROWSER=1 without a browser; prints NOT RUN otherwise.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chatConfig, chatPanelProps } from './sx-screen-fixtures.mjs';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const conversation = (n) => Array.from({ length: n }, (_, i) => [
  { id: `u${i + 1}`, role: 'user', content: i === 4 ? `> 코치가 한 말\n\n${i + 1}번째 질문인데 이 줄은 아주 길어서 목록에서는 줄임표로 끝나야 합니다. 정말로 아주 길게 이어지는 문장입니다.` : `${i + 1}번째 질문: 웹페이지 제목을 바꾸고 싶어요\n둘째 줄은 목록에 나오지 않아요`, createdAt: i },
  { id: `a${i + 1}`, role: 'assistant', content: `${i + 1}번째 답변. `.repeat(40), createdAt: i },
]).flat();
const props = chatPanelProps({});
const callbacks = Object.entries(props).filter(([, v]) => typeof v === 'function').map(([k]) => `${k}:()=>{}`).join(',');
const data = Object.fromEntries(Object.entries(props).filter(([, v]) => typeof v !== 'function'));
delete data.messages; delete data.config;
const asset = await build({ entryPoints: [`${root}/webview-ui/src/main.tsx`], bundle: true, write: false, outdir: 'out', loader: { '.svg': 'dataurl' }, logLevel: 'silent' });
const css = asset.outputFiles.find((f) => f.path.endsWith('.css')).text;
const js = (await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{ChatPanel}from'./src/ChatPanel';import{TaskWorkspaceFrame}from'./src/TaskWorkspace';import{jumpToMyQuestion}from'./src/MyQuestions';window.jumpToMyQuestion=jumpToMyQuestion;
const root=createRoot(document.getElementById('root'));
window.mount=(config,messages,view)=>root.render(<TaskWorkspaceFrame view={view} messages={messages} busy={false} error={null} onDismissError={()=>{}}><ChatPanel {...${JSON.stringify(data)}} {...{${callbacks}}} config={config} messages={messages}/></TaskWorkspaceFrame>);`, resolveDir: root + '/webview-ui', loader: 'tsx' }, bundle: true, write: false, outdir: 'fixture-assets', format: 'iife', platform: 'browser', loader: { '.svg': 'dataurl' }, logLevel: 'silent' })).outputFiles.find((f) => f.path.endsWith('.js')).text;

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN: my-questions browser unavailable'); process.exit(0); }
const browser = await launch(bin), evidence = process.env.MY_QUESTIONS_EVIDENCE;
if (evidence) mkdirSync(evidence, { recursive: true });
const delay = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const key = async (k, code = k, keyCode = 0) => {
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: keyCode, ...(k === 'Enter' ? { text: String.fromCharCode(13) } : {}) });
  await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: keyCode });
};
// A real pointer press at the centre of the index-th match, through CDP like the keyboard above.
const click = async (sel, index = 0) => {
  const at = await browser.evaluate(`(()=>{const e=document.querySelectorAll(${JSON.stringify(sel)})[${index}];e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  for (const type of ['mousePressed', 'mouseReleased']) await browser.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 });
  await delay();
};
const view = { scope: 's', revision: 1, activeTaskId: 't1', sourceSelection: null, tasks: [{ id: 't1', title: '내 작업', createdAt: 1, updatedAt: 1, messageCount: 24 }] };
const seats = {
  personal: { config: chatConfig(3, { profile: { ...chatConfig().profile, lesson: null }, activity: { id: 'a1', name: '내 작업', kind: 'personal', workspace: '/w', verified: true }, taskWorkspace: view }), view },
  classroom: { config: chatConfig(), view: undefined },
};
let cases = 0;
try {
  for (const seat of ['personal', 'classroom']) for (const dark of [false, true]) for (const width of [800, 1420]) {
    const tag = `${seat} ${dark ? 'dark' : 'light'} ${width}`;
    const { config, view: frame } = seats[seat];
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k2, v]) => typeof v === 'string' && !['kind', 'file'].includes(k2)).map(([k2, v]) => `--vscode-${k2.replaceAll('.', '-')}:${v}`).join(';');
    await browser.load(`<html lang="ko" style="${vars}"><style>${css}</style><style>html,body,#root{height:100%}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}" style="margin:0"><div id="root"></div><script>window.posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m),getState:()=>({}),setState:()=>{}});</script><script>${js}</script></body></html>`, { width, height: 1400, dark });
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });

    // Below the threshold: no button.
    await browser.evaluate(`mount(${JSON.stringify(config)},${JSON.stringify(conversation(3))},${JSON.stringify(frame)})`); await delay();
    assert.equal(await browser.evaluate(`document.querySelectorAll('.hps-myq-toggle').length`), 0, `${tag}: three prompts draw no 내 질문 button`);

    await browser.evaluate(`mount(${JSON.stringify(config)},${JSON.stringify(conversation(14))},${JSON.stringify(frame)})`); await delay(150);
    const b = await browser.evaluate(`(()=>{const t=document.querySelector('.hps-myq-toggle');if(!t)return null;const r=t.getBoundingClientRect();return {text:t.textContent,w:r.width,h:r.height,font:parseFloat(getComputedStyle(t).fontSize),header:!!t.closest(${JSON.stringify(seat === 'personal' ? '.tw-heading' : 'header.hps-header')}),inView:r.left>=0&&r.right<=innerWidth,expanded:t.getAttribute('aria-expanded')}})()`);
    assert.ok(b, `${tag}: the button exists from 4 prompts`);
    assert.equal(b.text, '내 질문'); assert.equal(b.expanded, 'false');
    assert.ok(b.header, `${tag}: the button sits in the task header`);
    assert.ok(b.w >= 44 && b.h >= 44 && b.font >= 14 && b.inView, `${tag}: 44px button at the 14px floor ${JSON.stringify(b)}`);

    // Open with the keyboard: focus the button, Enter. Focus moves to the first row.
    await browser.evaluate(`document.querySelector('.hps-messages').scrollTop=1e9;document.querySelector('.hps-myq-toggle').focus()`);
    await key('Enter', 'Enter', 13); await delay();
    const p = await browser.evaluate(`(()=>{const panel=document.querySelector('.hps-myq-panel'),list=panel?.querySelector('.hps-myq-list');if(!panel)return null;const pr=panel.getBoundingClientRect();
      const rows=[...list.querySelectorAll('.hps-myq-item')];
      return {role:panel.getAttribute('role'),label:panel.getAttribute('aria-label'),count:rows.length,nums:rows.map(r=>r.querySelector('.hps-myq-n').textContent),lines:rows.map(r=>r.querySelector('.hps-myq-line').textContent),
        heights:rows.map(r=>r.getBoundingClientRect().height),fonts:rows.map(r=>parseFloat(getComputedStyle(r).fontSize)),
        visible:list.clientHeight,scrollH:list.scrollHeight,overflowY:getComputedStyle(list).overflowY,
        left:pr.left,right:pr.right,bottom:pr.bottom,innerWidth,innerHeight,ellipsis:getComputedStyle(rows[4].querySelector('.hps-myq-line')).textOverflow,
        lineFits:rows.every(r=>{const l=r.querySelector('.hps-myq-line');return l.getBoundingClientRect().right<=r.getBoundingClientRect().right+0.5}),
        active:document.activeElement===rows[0],ring:(()=>{const a=document.activeElement,st=getComputedStyle(a);return {fv:a.matches(':focus-visible'),w:parseFloat(st.outlineWidth),o:parseFloat(st.outlineOffset)}})(),expanded:document.querySelector('.hps-myq-toggle').getAttribute('aria-expanded'),
        top:document.elementFromPoint((pr.left+pr.right)/2,pr.top+30)?.closest('.hps-myq-panel')===panel,
        anchor:(()=>{const t=document.querySelector('.hps-myq-toggle').getBoundingClientRect(),h=document.querySelector('.hps-myq-toggle').closest('.hps-header').getBoundingClientRect();
          return {gap:pr.top-t.bottom,end:Math.abs(pr.right-t.right),belowHeader:pr.top>=h.top}})()}})()`);
    assert.ok(p, `${tag}: Enter opens the list`);
    assert.equal(p.role, 'dialog'); assert.equal(p.label, '내 질문'); assert.equal(p.expanded, 'true');
    assert.equal(p.count, 14, `${tag}: one row per prompt`);
    assert.deepEqual(p.nums, Array.from({ length: 14 }, (_, i) => String(i + 1)), `${tag}: numbered`);
    assert.equal(p.lines[0], '1번째 질문: 웹페이지 제목을 바꾸고 싶어요', `${tag}: first line only`);
    assert.ok(p.lines[4].startsWith('5번째 질문인데') && p.lines[4].endsWith('…'), `${tag}: the learner's own line, not the quote; cut with a mark (${p.lines[4]})`);
    assert.equal(p.ellipsis, 'ellipsis');
    for (const h of p.heights) assert.ok(Math.abs(h - 44) <= 0.5, `${tag}: 44px rows (${h})`);
    for (const f of p.fonts) assert.ok(f >= 14, `${tag}: row text >= 14px (${f})`);
    assert.ok(Math.abs(p.visible - 440) <= 1, `${tag}: at most 10 rows visible (${p.visible})`);
    assert.ok(p.scrollH > p.visible && p.overflowY === 'auto', `${tag}: the rest scrolls`);
    assert.ok(p.left >= 0 && p.right <= p.innerWidth && p.bottom <= p.innerHeight, `${tag}: the popover stays in the viewport ${JSON.stringify(p)}`);
    assert.ok(p.lineFits, `${tag}: no row text overflows its row`);
    assert.ok(p.active, `${tag}: focus moves into the list`);
    assert.ok(p.ring.fv && p.ring.w >= 2 && p.ring.o <= 0, `${tag}: a row's focus ring sits inside the scrolling list ${JSON.stringify(p.ring)}`);
    assert.ok(p.top, `${tag}: the popover is on top of the transcript`);
    // CGP-CHAT-D-028: the popover opens from the task header, right under its button and aligned to its end edge.
    assert.ok(p.anchor.gap >= 0 && p.anchor.gap <= 12 && p.anchor.end <= 1 && p.anchor.belowHeader, `${tag}: the popover hangs from the header button ${JSON.stringify(p.anchor)}`);
    if (evidence) { const shot = await browser.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/${seat}-${dark ? 'dark' : 'light'}-${width}-open.png`, Buffer.from(shot.data, 'base64')); }

    // Escape closes and returns focus to the button.
    await key('Escape', 'Escape', 27); await delay();
    const esc = await browser.evaluate(`({open:!!document.querySelector('.hps-myq-panel'),focus:document.activeElement?.className})`);
    assert.deepEqual(esc, { open: false, focus: 'hps-myq-toggle' }, `${tag}: Escape closes and returns focus`);

    // Jump: reopen from the button (focus is there), move to row 3, Enter.
    await key('Enter', 'Enter', 13); await delay();
    await browser.evaluate(`document.querySelectorAll('.hps-myq-item')[2].focus()`);
    await key('Enter', 'Enter', 13); await delay(150);
    const j = await browser.evaluate(`(()=>{const box=document.querySelector('.hps-messages'),row=box.querySelector('[data-my-question="u3"]'),a=document.activeElement,s=getComputedStyle(a);
      const br=box.getBoundingClientRect(),rr=row.getBoundingClientRect(),ar=a.getBoundingClientRect();
      return {open:!!document.querySelector('.hps-myq-panel'),same:row.contains(a)&&a.classList.contains('hps-msg-body')&&a.textContent.startsWith('3번째 질문'),narrow:ar.width<rr.width-40,offset:rr.top-br.top,maxScroll:box.scrollHeight-box.clientHeight,scrollTop:box.scrollTop,
        fv:a.matches(':focus-visible'),ow:parseFloat(s.outlineWidth),os:s.outlineStyle,oo:parseFloat(s.outlineOffset),tab:a.getAttribute('tabindex'),
        inBox:rr.left>=br.left-1&&rr.right<=br.right+1}})()`);
    assert.equal(j.open, false, `${tag}: choosing closes the list`);
    assert.ok(j.same, `${tag}: focus is on the chosen prompt's bubble`);
    assert.ok(j.narrow, `${tag}: the focused box is the bubble, not the full-width row`);
    assert.ok(Math.abs(j.offset) <= 2 && j.scrollTop < j.maxScroll - 100, `${tag}: the prompt is at the top of the transcript (${j.offset}, ${j.scrollTop}/${j.maxScroll})`);
    assert.ok(j.fv && j.os === 'solid' && j.ow >= 2, `${tag}: keyboard jump shows the focus ring ${JSON.stringify(j)}`);
    assert.ok(j.oo <= 0, `${tag}: the ring hugs inside the scrolling transcript (${j.oo})`);
    assert.equal(j.tab, '-1', `${tag}: focusable only programmatically`);
    if (evidence) { const shot = await browser.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/${seat}-${dark ? 'dark' : 'light'}-${width}-jumped.png`, Buffer.from(shot.data, 'base64')); }
    // Moving on removes the temporary tab stop.
    await browser.evaluate(`document.querySelector('.hps-myq-toggle').focus()`); await delay();
    assert.equal(await browser.evaluate(`document.querySelector('[data-my-question="u3"] .hps-msg-body').hasAttribute('tabindex')`), false, `${tag}: the prompt leaves the Tab order`);
    assert.equal(await browser.evaluate(`document.documentElement.scrollWidth>innerWidth`), false, `${tag}: no horizontal page scroll`);

    // CGP-CHAT-D-028: choosing with the pointer also moves focus to that prompt's bubble (no ring, since it was a click).
    await browser.evaluate(`document.querySelector('.hps-messages').scrollTop=1e9`);
    await click('.hps-myq-toggle'); await click('.hps-myq-item', 5); await delay(150);
    const m = await browser.evaluate(`(()=>{const box=document.querySelector('.hps-messages'),row=box.querySelector('[data-my-question="u6"]'),a=document.activeElement;
      return {open:!!document.querySelector('.hps-myq-panel'),bubble:row.contains(a)&&a.classList.contains('hps-msg-body'),offset:Math.round(row.getBoundingClientRect().top-box.getBoundingClientRect().top)}})()`);
    assert.ok(!m.open && m.bubble && Math.abs(m.offset) <= 2, `${tag}: a pointer choice jumps and focuses the bubble ${JSON.stringify(m)}`);
    await browser.evaluate(`document.querySelector('.hps-myq-toggle').focus()`); await delay();

    // Forced colours keep the popover edge.
    if (width === 800) {
      await key('Enter', 'Enter', 13); await delay();
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] }); await delay();
      const fc = await browser.evaluate(`(()=>{const s=getComputedStyle(document.querySelector('.hps-myq-panel'));return {w:parseFloat(s.borderTopWidth),style:s.borderTopStyle,color:s.borderTopColor,bg:s.backgroundColor}})()`);
      assert.ok(fc.w >= 1 && fc.style === 'solid' && fc.color !== fc.bg, `${tag}: forced colours keep the popover edge ${JSON.stringify(fc)}`);
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'none' }, { name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
      await key('Escape', 'Escape', 27); await delay();
    }
    cases++;
  }
  // CGP-CHAT-D-028: short windows (the 1280x720 layout floor and a 480px-tall pane) still show the whole popover.
  for (const [seat, width, height] of [['personal', 1280, 720], ['classroom', 1280, 720], ['personal', 800, 480], ['classroom', 800, 480]]) {
    const { config, view: frame } = seats[seat];
    await browser.load(`<html lang="ko"><style>${css}</style><style>html,body,#root{height:100%}</style><body class="vscode-dark" style="margin:0"><div id="root"></div><script>window.acquireVsCodeApi=()=>({postMessage:()=>{},getState:()=>({}),setState:()=>{}});</script><script>${js}</script></body></html>`, { width, height });
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await browser.evaluate(`mount(${JSON.stringify(config)},${JSON.stringify(conversation(14))},${JSON.stringify(frame)})`); await delay();
    await click('.hps-myq-toggle');
    const s = await browser.evaluate(`(()=>{const pr=document.querySelector('.hps-myq-panel').getBoundingClientRect(),list=document.querySelector('.hps-myq-list'),rows=[...list.querySelectorAll('.hps-myq-item')];
      return {bottom:pr.bottom,innerHeight,visible:list.clientHeight,rowH:rows[0].getBoundingClientRect().height,scrolls:list.scrollHeight>list.clientHeight}})()`);
    assert.ok(s.bottom <= s.innerHeight && s.visible <= 440.5 && Math.abs(s.rowH - 44) <= 0.5 && s.scrolls, `${seat} ${width}x${height}: the popover fits the window and scrolls its rows ${JSON.stringify(s)}`);
    if (evidence) { const shot = await browser.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/${seat}-dark-${width}x${height}-open.png`, Buffer.from(shot.data, 'base64')); }
    assert.ok(s.visible >= 44 && Math.abs(s.visible / 44 - Math.round(s.visible / 44)) < 0.02, `${seat} ${width}x${height}: whole rows only (${s.visible})`);
    if (height === 720) assert.ok(Math.abs(s.visible - 440) <= 1, `${seat}: 10 rows when the window has room (${s.visible})`);
    if (height === 480) {
      // Growing the window while the list is open gives the rows back, up to 10.
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false }); await delay(150);
      const grown = await browser.evaluate(`document.querySelector('.hps-myq-list').clientHeight`);
      assert.ok(Math.abs(grown - 440) <= 1, `${seat}: a taller window shows 10 rows again (${grown})`);
    }
  }
  // Jump targets beyond a normal bubble, on a plain scroller: a prompt being edited in place focuses its editor (no
  // tab stop added), a prompt whose row failed to render jumps to its turn fallback box, a missing prompt is a no-op.
  await browser.evaluate(`(()=>{const r=document.getElementById('root');r.innerHTML='';const box=document.createElement('div');box.id='box';box.style.cssText='height:200px;overflow:auto';
    const pad=()=>{const d=document.createElement('div');d.style.height='600px';box.append(d)};
    pad();const edit=document.createElement('div');edit.setAttribute('data-my-question','e1');edit.append(document.createElement('textarea'));box.append(edit);
    pad();const fb=document.createElement('div');fb.setAttribute('data-turn-fallback','f1');fb.textContent='x';box.append(fb);pad();r.append(box)})()`);
  const edge = await browser.evaluate(`(()=>{const box=document.getElementById('box'),out={};
    out.edit=jumpToMyQuestion(box,'e1');out.editFocus=document.activeElement?.localName;out.editTab=document.activeElement?.hasAttribute('tabindex');
    out.fb=jumpToMyQuestion(box,'f1');out.fbFocus=document.activeElement?.getAttribute('data-turn-fallback');out.fbTop=Math.round(document.querySelector('[data-turn-fallback]').getBoundingClientRect().top-box.getBoundingClientRect().top);
    out.missing=jumpToMyQuestion(box,'nope');return out})()`);
  assert.deepEqual(edge, { edit: true, editFocus: 'textarea', editTab: false, fb: true, fbFocus: 'f1', fbTop: 0, missing: false }, `edge jump targets ${JSON.stringify(edge)}`);
  console.log(`PASS my-questions-browser: ${cases} seat/theme/width cases, hidden below 4, 44px button and rows, 10 visible, keyboard jump moves focus to the prompt, Escape returns focus, forced colours, anchored under the header button, pointer jump, short windows fit`);
} finally { await browser.close(); }
