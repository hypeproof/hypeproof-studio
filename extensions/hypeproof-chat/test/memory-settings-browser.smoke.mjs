// CGP-KNOW-D-023 (DES-KNOW-41) — "AI가 기억하는 것" in 대화 설정, the real App bundle in headless Chromium, measured on the
// real markup. Personal seat, dark/light at 1420/800/320 px, plus forced colours; and a seat whose host has no view:
//   1. the list shows each item's text, date and source (a task link where the task can open) with 지우기; rows are at
//      least 44px, every control is a 44px target, text is 14px at 4.5:1; at 320px the source sits under the text;
//   2. 지우기 opens the chat's own confirm with 취소 focused first; real Tab/Shift+Tab stay inside it; a real Escape closes
//      only the confirm and returns focus to the button; its 지우기 posts one delete naming the item's pin, and the
//      notice after it names no file;
//   3. search filters on committed text only: an open IME composition never changes the list; the empty states read
//      "아직 기억하는 게 없어요" and "찾는 기억이 없어요";
//   4. no view (a seat without the store): no section.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { chatConfig } from './sx-screen-fixtures.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const { MEMORY_SETTINGS_COPY } = await import('../src/activityMemoryView.ts');
const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN memory settings: no Chromium'); process.exit(0); }
const dir = fileURLToPath(new URL('../webview-ui/', import.meta.url));
const app = await build({ entryPoints: [dir + 'src/main.tsx'], bundle: true, platform: 'browser', format: 'iife', outdir: 'memory-settings-assets', write: false, loader: { '.svg': 'dataurl' }, logLevel: 'silent' });
const css = app.outputFiles.find(f => f.path.endsWith('.css')).text, script = app.outputFiles.find(f => f.path.endsWith('.js')).text;
const evidence = process.env.MEMORY_SETTINGS_EVIDENCE;
if (evidence) mkdirSync(evidence, { recursive: true });
const b = await launch(bin);
const settle = (ms = 80) => new Promise(r => setTimeout(r, ms));
const send = async (data) => { await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(data)}}))`); await settle(); };
const shot = async (name) => { if (!evidence) return; const s = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/${name}.png`, Buffer.from(s.data, 'base64')); };
const lum = rgb => rgb.slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
const rgb = v => v.match(/[\d.]+/g).map(Number);
const contrast = (a, c) => { const x = lum(rgb(a)), y = lum(rgb(c)); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
const PIN = n => n.repeat(32);
const view = { scope: '["activity-a","task"]', folder: '.hypeproof/memory/', other: 0, unsafe: false, overview: null, entries: [
  { name: 'a.md', at: Date.UTC(2026, 10, 1, 5), text: '발표는 금요일 오후예요.', source: { kind: 'task', id: 'task', title: '아주 긴 작업 이름이 들어간 발표 준비 작업' }, pin: PIN('a') },
  { name: 'b.md', at: Date.UTC(2026, 10, 1, 4), text: '좋아하는 색은 초록', source: { kind: 'none' }, pin: PIN('b') },
  { name: 'c.md', at: Date.UTC(2026, 10, 1, 3), text: '<b>글꼴은 크게</b>', source: { kind: 'archived', title: '지난 숙제' }, pin: PIN('c') },
] };
const workspace = { scope: 'activity-a', revision: 1, activeTaskId: 'task', tasks: [{ id: 'task', title: '발표', createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null };
const config = chatConfig(3, { activity: { ...chatConfig().activity, id: 'activity-a', kind: 'personal' }, profile: { ...chatConfig().profile, lesson: null }, taskWorkspace: workspace });
const openSettings = async () => {
  await b.evaluate(`document.querySelector('.tw-chat-menu button[aria-haspopup]').click()`); await settle(200);
  await b.evaluate(`[...document.querySelectorAll('button[role=menuitem]')].find(x=>x.textContent.trim()==='설정').click()`); await settle(300);
};
const probe = `(()=>{const s=document.querySelector('dialog[open] [data-testid=memory-settings]');if(!s)return null;const d=s.closest('dialog');const D=d.getBoundingClientRect();
  const box=e=>{const q=e.getBoundingClientRect();return {left:q.left,right:q.right,top:q.top,bottom:q.bottom,w:q.width,h:q.height}};
  const bg=getComputedStyle(d).backgroundColor;
  const rows=[...s.querySelectorAll('.hps-memory-settings-list > li')].map(li=>{const text=li.querySelector('.hps-memory-settings-text');const src=li.querySelector('.tw-memory-source');const del=li.querySelector('.hps-memory-settings-delete');
    return {h:li.getBoundingClientRect().height,text:text.textContent,textBox:box(text),font:parseFloat(getComputedStyle(text).fontSize),fg:getComputedStyle(text).color,
      time:li.querySelector('time')?.getAttribute('datetime'),src:src?{text:src.textContent,box:box(src),links:[...src.querySelectorAll('button')].map(x=>({t:x.textContent,...box(x)}))}:null,
      del:{t:del.textContent,...box(del),font:parseFloat(getComputedStyle(del).fontSize),border:getComputedStyle(del).borderTopStyle}}});
  const search=s.querySelector('input[type=search]');
  return {title:s.querySelector('h3')?.textContent,D:{left:D.left,right:D.right},bg,rows,xss:!!s.querySelector('.hps-memory-settings-text b'),
    search:search?{...box(search),font:parseFloat(getComputedStyle(search).fontSize)}:null,empty:s.querySelector('.hps-memory-settings-empty')?.textContent??null,
    page:document.scrollingElement.scrollWidth>innerWidth}})()`;
const key = async (k, modifiers = 0) => { for (const type of ['rawKeyDown', 'keyUp']) await b.send('Input.dispatchKeyEvent', { type, key: k, code: k, windowsVirtualKeyCode: { Tab: 9, Escape: 27 }[k], modifiers }); await settle(60); };
const evalAsync = async (expression) => { const r = await b.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'evaluate failed'); return r.result.value; };
const deletes = () => b.evaluate(`window.posted.filter(m=>m.type==='activityMemoryAction')`);

let states = 0;
try {
  for (const [dark, width, forcedColors] of [[true, 1420, false], [false, 1420, false], [true, 800, false], [false, 800, false], [true, 320, false], [false, 320, false], [true, 800, true]]) {
    const tag = `${width}-${dark ? 'dark' : 'light'}${forcedColors ? '-forced' : ''}`;
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await b.load(`<html style="${vars}"><style>${css}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}"><div id="root"></div><script>window.posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m),getState:()=>undefined,setState:()=>{}});</script><script>${script}</script></body></html>`, { width, height: 900, dark, forcedColors, appReady: true });
    await send({ type: 'config', config });
    await send({ type: 'history', messages: [] });
    await openSettings();
    assert.ok((await b.evaluate(`window.posted.filter(m=>m.type==='activityMemoryRequest').length`)) >= 1, `${tag}: opening asks the host for the list`);
    await send({ type: 'activityMemoryState', view });
    let m = await b.evaluate(probe);
    assert.ok(m, `${tag}: the list is in 대화 설정`);
    assert.equal(m.title, MEMORY_SETTINGS_COPY.title);
    assert.deepEqual(m.rows.map(r => r.text), view.entries.map(e => e.text), `${tag}: item text as text`);
    assert.equal(m.xss, false);
    assert.deepEqual(m.rows.map(r => r.time), view.entries.map(e => new Date(e.at).toISOString()), `${tag}: each item's date`);
    assert.deepEqual(m.rows.map(r => r.src?.links.map(l => l.t) ?? []), [['‘아주 긴 작업 이름이 들어간 발표 준비 작업’ 작업 열기'], [], []], `${tag}: a source link only for a task that can open`);
    for (const r of m.rows) {
      assert.ok(r.h >= 44, `${tag}: row ${r.h}px`);
      assert.ok(r.font >= 14, `${tag}: text ${r.font}px`);
      if (!forcedColors) assert.ok(contrast(r.fg, m.bg) >= 4.5, `${tag}: contrast ${r.fg} on ${m.bg}`);
      assert.ok(r.del.h >= 44 && r.del.w >= 44 && r.del.font >= 14 && r.del.border !== 'none', `${tag}: 지우기 ${JSON.stringify(r.del)}`);
      for (const l of r.src?.links ?? []) { assert.ok(l.h >= 44, `${tag}: source link ${l.h}px`); assert.ok(l.left >= m.D.left - .5 && l.right <= m.D.right + .5, `${tag}: link inside the dialog`); }
      // The source sits under the item text (so at 320px it wraps below it, never beside it).
      if (r.src) assert.ok(r.src.box.top >= r.textBox.bottom - .5, `${tag}: source below the text`);
    }
    assert.ok(m.search && m.search.h >= 44 && m.search.font >= 14, `${tag}: search field`);
    assert.equal(m.page, false, `${tag}: no sideways scroll`);
    await shot(tag);

    // IME-safe search: an open composition never changes the list; the committed text filters.
    const ime = await evalAsync(`(async()=>{const i=document.querySelector('[data-testid=memory-settings] input[type=search]');i.focus();
      const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;const count=()=>document.querySelectorAll('[data-testid=memory-settings] .hps-memory-settings-list > li').length;
      const tick=()=>new Promise(r=>setTimeout(r,60));
      i.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));
      set.call(i,'ㅅ');i.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true,data:'ㅅ'}));await tick();
      const during1=count();
      set.call(i,'새');i.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true,data:'새'}));await tick();
      const during2=count();
      // Enter while composing commits the syllable: it must not close 대화 설정.
      i.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Enter',isComposing:true,keyCode:229}));await tick();
      const open=!!document.querySelector('dialog[open] [data-testid=memory-settings]');
      set.call(i,'색');i.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'색'}));i.dispatchEvent(new InputEvent('input',{bubbles:true,data:'색'}));await tick();
      const after=count();
      set.call(i,'없는말');i.dispatchEvent(new InputEvent('input',{bubbles:true,data:'없는말'}));await tick();
      const none=document.querySelector('[data-testid=memory-settings] .hps-memory-settings-empty')?.textContent;
      set.call(i,'');i.dispatchEvent(new InputEvent('input',{bubbles:true,data:''}));await tick();
      return {during1,during2,open,after,none,reset:count()};})()`);
    assert.deepEqual([ime.during1, ime.during2], [3, 3], `${tag}: no filtering while composing`);
    assert.equal(ime.open, true, `${tag}: Enter that commits a syllable closes nothing`);
    assert.equal(ime.after, 1, `${tag}: the committed text filters`);
    assert.equal(ime.none, MEMORY_SETTINGS_COPY.noMatch);
    assert.equal(ime.reset, 3);

    // 지우기: the chat's confirm with 취소 focused first; Escape closes only the confirm.
    await b.evaluate(`window.posted.length=0;document.querySelector('[data-testid=memory-settings] .hps-memory-settings-delete').click()`); await settle(150);
    const confirm = await b.evaluate(`(()=>{const d=document.querySelector('dialog.hps-memory-settings-confirm[open]');if(!d)return null;const a=document.activeElement;
      return {focus:a?.textContent,isCancel:a?.hasAttribute('data-memory-cancel'),text:d.querySelector('.hps-memory-settings-text')?.textContent,buttons:[...d.querySelectorAll('button')].map(x=>{const q=x.getBoundingClientRect();return {t:x.textContent,h:q.height,w:q.width,font:parseFloat(getComputedStyle(x).fontSize)}})}})()`);
    assert.ok(confirm, `${tag}: a confirm opens`);
    assert.equal(confirm.isCancel, true, `${tag}: 취소 has the first focus (got ${confirm.focus})`);
    assert.equal(confirm.focus, MEMORY_SETTINGS_COPY.cancel);
    assert.equal(confirm.text, view.entries[0].text, `${tag}: it names the item`);
    for (const x of confirm.buttons) assert.ok(x.h >= 44 && x.w >= 44 && x.font >= 14, `${tag}: confirm button ${JSON.stringify(x)}`);
    assert.deepEqual(await deletes(), [], `${tag}: opening the confirm deletes nothing`);
    await shot(`${tag}-confirm`);
    // Real keys: Tab and Shift+Tab never leave the confirm (focus never reaches 대화 설정 or <body>); then Escape.
    const inConfirm = `(()=>{const a=document.activeElement;return {inside:!!a?.closest('dialog.hps-memory-settings-confirm'),t:a?.localName+':'+(a?.textContent??'').slice(0,12)}})()`;
    for (const [n, shift] of [[5, false], [5, true]]) for (let i = 0; i < n; i++) {
      await key('Tab', shift ? 8 : 0);
      const at = await b.evaluate(inConfirm);
      assert.ok(at.inside, `${tag}: ${shift ? 'Shift+' : ''}Tab ${i + 1} stays in the confirm (focus on ${at.t})`);
    }
    await key('Tab');
    await key('Escape');
    const after = await b.evaluate(`({confirm:!!document.querySelector('dialog.hps-memory-settings-confirm[open]'),settings:!!document.querySelector('dialog[open] [data-testid=memory-settings]'),focus:document.activeElement?.className})`);
    assert.deepEqual([after.confirm, after.settings], [false, true], `${tag}: Escape closes only the confirm`);
    assert.equal(after.focus, 'hps-memory-settings-delete', `${tag}: focus returns to 지우기`);
    assert.deepEqual(await deletes(), [], `${tag}: 취소 deletes nothing`);
    assert.equal(await b.evaluate(`document.querySelectorAll('dialog[open]').length`), 1, `${tag}: only 대화 설정 is open`);
    await b.evaluate(`document.querySelector('[data-testid=memory-settings] .hps-memory-settings-delete').click()`); await settle(150);
    await b.evaluate(`document.querySelector('dialog.hps-memory-settings-confirm .hps-memory-settings-danger').click()`); await settle(150);
    const sent = await deletes();
    assert.deepEqual(sent.map(x => [x.action, x.name, x.confirmedPin, x.scope]), [['delete', 'a.md', PIN('a'), view.scope]], `${tag}: one delete, naming the listed identity`);
    // The host's answer: the status line names no file (the list never showed one), only that the memory is gone.
    await send({ type: 'activityMemoryState', requestId: sent[0].requestId, view: { ...view, entries: view.entries.slice(1) }, result: { action: 'delete', name: 'a.md' } });
    const note = await b.evaluate(`document.querySelector('[data-testid=memory-settings] [role=status]')?.textContent`);
    assert.equal(note, MEMORY_SETTINGS_COPY.deleted, `${tag}: the delete notice (got ${note})`);
    assert.ok(!note.includes('.md'), `${tag}: no file name in the notice`);

    // Empty store.
    await send({ type: 'activityMemoryState', view: { ...view, entries: [] } });
    m = await b.evaluate(probe);
    assert.equal(m.empty, MEMORY_SETTINGS_COPY.empty, `${tag}: empty state`);
    assert.equal(m.search, null, `${tag}: no search on an empty list`);
    // No store on this seat: no section.
    await send({ type: 'activityMemoryState', view: null });
    assert.equal(await b.evaluate(probe), null, `${tag}: no view, no list`);
    states++;
  }
  console.log(`PASS memory settings: ${states} layouts (dark/light, 1420/800/320, forced colours)`);
} finally { await b.close(); }
