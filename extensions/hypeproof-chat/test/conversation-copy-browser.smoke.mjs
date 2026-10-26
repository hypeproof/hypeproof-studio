// CGP-CHAT-R-024: the real App bundle in headless Chromium. "대화 내용 복사" sits in the personal task
// menu, writes the visible conversation as Markdown, and confirms only after the clipboard write
// settles. The clipboard is a controllable stub, so success, failure and a write still in flight
// are each observed. Computed geometry: 44px item target, >=14px status text inside the column.
// CGP-CHAT-D-024: the result is the answer-copy toast (same outlet, icon, live regions, 160ms entry,
// computed chrome), measured against a real 답변 복사 toast on the same page.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { chatConfig } from './sx-screen-fixtures.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN conversation copy App: no Chromium'); process.exit(0); }
const dir = fileURLToPath(new URL('../webview-ui/', import.meta.url));
const app = await build({ entryPoints: [dir + 'src/main.tsx'], bundle: true, platform: 'browser', format: 'iife', outdir: 'copy-assets', write: false, loader: { '.svg': 'dataurl' }, logLevel: 'silent' });
const css = app.outputFiles.find(f => f.path.endsWith('.css')).text, script = app.outputFiles.find(f => f.path.endsWith('.js')).text;
const b = await launch(bin), evidence = process.env.COPY_EVIDENCE;
if (evidence) mkdirSync(evidence, { recursive: true });
const settle = (ms = 60) => new Promise(r => setTimeout(r, ms));
const send = async (data) => { await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(data)}}))`); await settle(); };
// Clipboard stub: each write parks until the test resolves or rejects it.
const clipboardStub = `window.__writes=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:(text)=>new Promise((resolve,reject)=>window.__writes.push({text,resolve,reject}))}});`;
const item = `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='대화 내용 복사')`;
const openMenu = async () => { await b.evaluate(`(()=>{const t=document.querySelector('.tw-chat-menu-toggle');if(t&&t.getAttribute('aria-expanded')!=='true')t.click();})()`); await settle(); };
const DONE = '대화 내용을 복사했습니다', FAILED = '대화 내용을 복사하지 못했습니다. 다시 시도해 주세요.';
// The visible toast (hidden from AT) plus the two always-mounted live regions answer copy announces through.
const status = () => b.evaluate(`(()=>{const t=document.querySelector('.hps-copy-toasts .hps-conversation-copy-status');const live=s=>document.querySelector(s)?.textContent??null;return {text:t?t.textContent:'',icon:t?.querySelector('[data-icon]')?.getAttribute('data-icon')??null,polite:live('.hps-copy-live[role=status]'),assertive:live('.hps-copy-live[aria-live=assertive]')}})()`);
const expectStatus = async (want, message) => {
  const s = await status();
  if (want === null) { assert.equal(s.text, '', message); for (const t of [DONE, FAILED]) assert.ok(!(s.polite ?? '').includes(t) && !(s.assertive ?? '').includes(t), `${message}: nothing announced`); return s; }
  const text = want === 'copied' ? DONE : FAILED;
  assert.equal(s.text, text, message); assert.equal(s.icon, want === 'copied' ? 'check' : 'alert', `${message}: same icon as answer copy`);
  assert.ok((want === 'copied' ? s.polite : s.assertive)?.includes(text), `${message}: announced ${want === 'copied' ? 'politely' : 'assertively'} like answer copy`);
  assert.ok(!(want === 'copied' ? s.assertive : s.polite)?.includes(text), `${message}: announced once`);
  return s;
};
// Computed chrome compared between the conversation toast and a real answer-copy toast.
const chrome = (sel) => `(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const c=getComputedStyle(e);return ['animationName','animationDuration','fontSize','lineHeight','borderTopStyle','borderTopWidth','borderTopColor','borderTopLeftRadius','backgroundColor','color','paddingTop','paddingLeft','maxWidth'].map(k=>k+'='+c[k]).join(';')})()`;
const history = [
  { id: 'u1', role: 'user', content: '고양이 소개 페이지를 만들고 싶어요', createdAt: 1 },
  { id: 'think-1', role: 'tool', content: '', createdAt: 2, tool: { icon: 'think', label: '숨은 생각 줄', state: 'done' } },
  { id: 'tool-1', role: 'tool', content: '', createdAt: 3, tool: { icon: 'tool', label: 'Write(index.html) 원본 결과', state: 'done' } },
  { id: 'a1', role: 'assistant', content: '좋아요. **index.html** 을 만들었어요.', createdAt: 4, assistantName: '별빛' },
  { id: 'u2', role: 'user', content: '토큰 ghp_' + 'Z'.repeat(36) + ' 넣어 줘', createdAt: 5 },
  { id: 'a2', role: 'assistant', content: '토큰은 대화에 쓰지 마세요.', createdAt: 6 },
];
const expected = '# 고양이 페이지\n\n## 나\n\n고양이 소개 페이지를 만들고 싶어요\n\n## 별빛\n\n좋아요. **index.html** 을 만들었어요.\n\n## 나\n\n토큰 «GITHUB_TOKEN 가려짐» 넣어 줘\n\n## 코치\n\n토큰은 대화에 쓰지 마세요.\n';
let states = 0;
try {
  for (const seat of ['personal', 'classroom']) for (const dark of [true, false]) for (const width of [320, 800, 1420]) {
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await b.load(`<html style="${vars}"><style>${css}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}"><div id="root"></div><script>${clipboardStub}window.acquireVsCodeApi=()=>({postMessage:()=>{},getState:()=>undefined,setState:()=>{}});</script><script>${script}</script></body></html>`, { width, height: 900, dark });
    const workspace = { scope: 'copy-test', revision: 1, activeTaskId: 'task', tasks: [{ id: 'task', title: '고양이 페이지', createdAt: 1, updatedAt: 1, messageCount: 4 }, { id: 'other', title: '다른 작업', createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null };
    const base = chatConfig(3, { activity: { ...chatConfig().activity, kind: seat }, profile: { ...chatConfig().profile, lesson: null }, coach: { ...chatConfig().coach, name: '코치' }, taskWorkspace: seat === 'personal' ? workspace : undefined });
    await send({ type: 'config', config: base });
    await send({ type: 'history', messages: [] });
    assert.equal(await b.evaluate(`!!document.querySelector('.hps-shell[data-chat-detail=personal]')`), seat === 'personal', 'requested seat branch is mounted');
    if (seat === 'classroom') {
      await send({ type: 'history', messages: history });
      assert.equal(await b.evaluate(`!!(${item})`), false, 'classroom and lesson seats have no task menu item (personal task only)');
      await expectStatus(null, 'no conversation copy result outside the personal task');
      states++; continue;
    }
    await openMenu();
    assert.equal(await b.evaluate(`(${item})?.disabled`), true, 'an empty conversation has nothing to copy');
    await send({ type: 'history', messages: history });
    await openMenu();
    const geometry = await b.evaluate(`(()=>{const e=${item};const r=e.getBoundingClientRect();return {role:e.getAttribute('role'),h:r.height,w:r.width,font:parseFloat(getComputedStyle(e).fontSize),inView:r.left>=0&&r.right<=innerWidth}})()`);
    assert.equal(geometry.role, 'menuitem'); assert.ok(geometry.h >= 44 && geometry.w >= 44, `44px target: ${JSON.stringify(geometry)}`); assert.ok(geometry.font >= 14); assert.equal(geometry.inView, true);
    // The focused menu item's hint never covers another item (it once hid "대화 내용 복사").
    for (let i = 0; i < 4; i++) {
      const cover = await b.evaluate(`(()=>{const t=document.querySelector('.hp-tooltip');if(!t||t.hidden)return {shown:false};const r=t.getBoundingClientRect();const a=document.activeElement;const hit=[...document.querySelectorAll('[role=menu] [role=menuitem]')].filter(e=>e!==a).map(e=>[e.textContent.trim(),e.getBoundingClientRect()]).filter(([,q])=>r.left<q.right-1&&r.right>q.left+1&&r.top<q.bottom-1&&r.bottom>q.top+1).map(([n])=>n);return {shown:true,active:a&&a.textContent.trim(),hit,inView:r.left>=0&&r.right<=innerWidth}})()`);
      assert.equal(cover.shown, true, 'the focused menu item shows its hint');
      assert.deepEqual(cover.hit, [], `menu hint covers no other item at ${width}px: ${JSON.stringify(cover)}`); assert.equal(cover.inView, true);
      await b.evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))`); await settle();
    }
    await openMenu();
    if (evidence) { const shot = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/personal-${width}-${dark ? 'dark' : 'light'}-menu.png`, Buffer.from(shot.data, 'base64')); }
    // Press: nothing is claimed while the write is in flight.
    await b.evaluate(`(${item}).click()`); await settle();
    assert.equal(await b.evaluate(`window.__writes.length`), 1, 'one clipboard write per press');
    assert.equal(await b.evaluate(`window.__writes[0].text`), expected, 'visible user/assistant text in order, tool and think lines excluded, credential scrubbed');
    await expectStatus(null, 'no success before the clipboard write settles');
    assert.equal(await b.evaluate(`document.activeElement?.classList.contains('tw-chat-menu-toggle')`), true, 'focus returns to the menu toggle');
    await b.evaluate(`window.__writes[0].resolve()`); await settle();
    await expectStatus('copied', 'success after the write resolves');
    const shown = await b.evaluate(`(()=>{const e=document.querySelector('.hps-copy-toasts .hps-conversation-copy-status');const r=e.getBoundingClientRect();const col=document.querySelector('.hps-shell').getBoundingClientRect();const footer=e.closest('footer');const c=getComputedStyle(e);return {font:parseFloat(c.fontSize),visible:r.width>0&&r.height>0,inside:r.left>=col.left-0.5&&r.right<=col.right+0.5,inFooter:!!footer&&r.bottom<=footer.getBoundingClientRect().bottom+0.5,hidden:!!e.closest('[aria-hidden=true]'),border:c.borderTopStyle,width:r.width,animation:c.animationName,duration:c.animationDuration,inView:r.top>=0&&r.bottom<=innerHeight}})()`);
    assert.ok(shown.width <= 360.1, `toast keeps the answer-copy toast cap: ${shown.width}`);
    assert.ok(shown.font >= 14, `status text >= 14px: ${shown.font}`); assert.equal(shown.visible, true); assert.equal(shown.inside, true, 'toast stays inside the chat column'); assert.equal(shown.border, 'solid');
    assert.equal(shown.inFooter, true, 'toast sits in the composer footer outlet with answer copy'); assert.equal(shown.inView, true); assert.equal(shown.hidden, true, 'the visual copy is not announced twice');
    assert.equal(shown.animation, 'chat-feedback'); assert.equal(shown.duration, '0.16s', 'D62: the 160ms answer-copy entry');
    // Same chrome as answer copy, computed on the real markup (not two declarations that happen to match).
    const conversationChrome = await b.evaluate(chrome('.hps-copy-toasts .hps-conversation-copy-status'));
    await b.evaluate(`document.querySelector('[aria-label="답변 복사"]').click()`); await settle();
    await b.evaluate(`window.__writes.at(-1).resolve()`); await settle();
    const answerToast = '.hps-copy-toasts .hps-copy-toast:not(.hps-conversation-copy-status)';
    assert.equal(await b.evaluate(`document.querySelector(${JSON.stringify(answerToast)})?.textContent`), '답변을 복사했습니다', 'answer copy toast shown for the comparison');
    assert.equal(conversationChrome, await b.evaluate(chrome(answerToast)), 'conversation copy toast computes the same chrome as the answer copy toast');
    await expectStatus('copied', 'both toasts can show together');
    // The answer copy took write 1 (settled); drop it so the indexes below stay the menu presses.
    assert.equal(await b.evaluate(`window.__writes.splice(1).length`), 1);
    if (evidence) { const shot = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/personal-${width}-${dark ? 'dark' : 'light'}.png`, Buffer.from(shot.data, 'base64')); }
    // Failure: an alert that stays.
    await openMenu(); await b.evaluate(`(${item}).click()`); await settle();
    await expectStatus(null, 'a new press clears the previous result');
    await b.evaluate(`window.__writes[1].reject(new Error('denied'))`); await settle(5000);
    await expectStatus('failed', 'failure is assertive and does not time out');
    // A double press: only the latest write reports.
    await openMenu(); await b.evaluate(`(${item}).click()`); await openMenu(); await b.evaluate(`(${item}).click()`); await settle();
    await b.evaluate(`window.__writes[3].resolve()`); await settle(); await b.evaluate(`window.__writes[2].reject(new Error('late'))`); await settle();
    assert.equal((await status()).text, DONE, 'a stale write never overrides the latest result');
    // Task switch while a write is in flight: its result is not shown in the other task.
    await openMenu(); await b.evaluate(`(${item}).click()`); await settle();
    await send({ type: 'config', config: { ...base, taskWorkspace: { ...workspace, revision: 2, activeTaskId: 'other' } } });
    await send({ type: 'history', messages: [] });
    await b.evaluate(`window.__writes[4].resolve()`); await settle();
    await expectStatus(null, 'a write from the previous task does not confirm in this one');
    // Versions: the copy is the transcript as drawn. A retried answer keeps only the attempt on
    // screen; an edited prompt keeps only the version on screen, and paging changes what is copied.
    const versions = [...history,
      { id: 'u3', role: 'user', content: 'OLD-PROMPT', createdAt: 7 }, { id: 'a3', role: 'assistant', content: 'OLD-ANSWER', createdAt: 8 },
      { id: 'u3b', role: 'user', content: 'NEW-PROMPT', createdAt: 9, editOf: 'u3' }, { id: 'a3b', role: 'assistant', content: 'NEW-ANSWER', createdAt: 10 },
      { id: 'u4', role: 'user', content: 'RETRY-PROMPT', createdAt: 11 }, { id: 'a4', role: 'assistant', content: 'FIRST-TRY', createdAt: 12 },
      { id: 'u4r', role: 'user', content: 'RETRY-PROMPT', createdAt: 13, retryOf: 'u4' }, { id: 'a4r', role: 'assistant', content: 'SECOND-TRY', createdAt: 14 }];
    await send({ type: 'config', config: base }); await send({ type: 'history', messages: versions });
    await openMenu(); await b.evaluate(`(${item}).click()`); await settle(); await b.evaluate(`window.__writes.at(-1).resolve()`); await settle();
    const drawn = await b.evaluate(`window.__writes.at(-1).text`);
    for (const shown of ['NEW-PROMPT', 'NEW-ANSWER', 'SECOND-TRY']) assert.ok(drawn.includes(shown), `drawn version copied: ${shown}`);
    for (const hidden of ['OLD-PROMPT', 'OLD-ANSWER', 'FIRST-TRY']) assert.ok(!drawn.includes(hidden), `version not on screen is not copied: ${hidden}`);
    assert.equal(drawn.split('RETRY-PROMPT').length, 2, 'a retried prompt appears once');
    const paged = await b.evaluate(`(()=>{const m=[...document.querySelectorAll('.hps-msg')].find(e=>e.textContent.includes('NEW-PROMPT'));const p=m&&m.querySelector('.hps-version-pager button:first-child');if(!p||p.disabled)return false;p.click();return true})()`);
    assert.equal(paged, true, 'the edited prompt has a version pager'); await settle();
    await openMenu(); await b.evaluate(`(${item}).click()`); await settle(); await b.evaluate(`window.__writes.at(-1).resolve()`); await settle();
    const older = await b.evaluate(`window.__writes.at(-1).text`);
    assert.ok(older.includes('OLD-PROMPT') && older.includes('OLD-ANSWER') && !older.includes('NEW-PROMPT'), 'paging to the first version copies that version');
    // Streaming: the item is disabled (a partial answer is not the conversation yet).
    await send({ type: 'config', config: base }); await send({ type: 'history', messages: history });
    await send({ type: 'streamStart', streamId: 's', messageId: 'live' }); await send({ type: 'streamChunk', streamId: 's', delta: '작성 중' });
    await openMenu();
    assert.equal(await b.evaluate(`(${item})?.disabled`), true, 'disabled while an answer streams');
    states++;
  }
  // Forced colours: the shown status keeps a visible border.
  await b.load(`<html><style>${css}</style><body class="vscode-dark"><div id="root"></div><script>${clipboardStub}window.acquireVsCodeApi=()=>({postMessage:()=>{},getState:()=>undefined,setState:()=>{}});</script><script>${script}</script></body></html>`, { width: 800, height: 900, forcedColors: true });
  const fcBase = chatConfig(3, { activity: { ...chatConfig().activity, kind: 'personal' }, profile: { ...chatConfig().profile, lesson: null }, taskWorkspace: { scope: 'fc', revision: 1, activeTaskId: 'task', tasks: [{ id: 'task', title: '고양이 페이지', createdAt: 1, updatedAt: 1, messageCount: 4 }], sourceSelection: null } });
  await send({ type: 'config', config: fcBase }); await send({ type: 'history', messages: history });
  await openMenu(); await b.evaluate(`(${item}).click()`); await settle(); await b.evaluate(`window.__writes[0].resolve()`); await settle();
  const fc = await b.evaluate(`(()=>{const e=document.querySelector('.hps-copy-toasts .hps-conversation-copy-status');const s=getComputedStyle(e);return {style:s.borderTopStyle,width:parseFloat(s.borderTopWidth),color:s.borderTopColor}})()`);
  assert.equal(fc.style, 'solid'); assert.ok(fc.width >= 1, `forced-colors border: ${JSON.stringify(fc)}`);
  console.log(`PASS actual App conversation copy in ${states} seat/theme/width states + forced colours: menu item, answer-copy toast (160ms, same computed chrome), confirmed-after-write, failure alert, stale and cross-task writes, streaming, classroom exclusion`);
} finally { await b.close(); }
