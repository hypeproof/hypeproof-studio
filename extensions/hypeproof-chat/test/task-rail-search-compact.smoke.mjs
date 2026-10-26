// CGP-KNOW-D-001 (DES-KNOW-01, REQ-STUDIO-TASK-RAIL-SEARCH): the real App bundle in headless Chromium.
// The 작업 찾기 field sits at the top of the task list (after 새 작업, before the list heading) and is a
// 44px target; on windows under 360px the empty field folds into one 44px search icon whose press
// opens and focuses the field; a typed or composing query never folds; an empty field folds again on
// blur (Escape keeps closing the narrow rail). At 320px nothing scrolls sideways, folded or
// open. Filtering 200 tasks updates the list within 100ms of the input event. Dark and light themes.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { chatConfig } from './sx-screen-fixtures.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';
import { railSearchFolded, TASK_SEARCH_COMPACT_BELOW } from '../webview-ui/src/taskTitleFilter.ts';

// Pure controls first (no browser): positive and negative.
assert.equal(TASK_SEARCH_COMPACT_BELOW, 360);
assert.equal(railSearchFolded(359, false, ''), true, 'an empty field folds under 360px');
assert.equal(railSearchFolded(360, false, ''), false, 'at 360px the field stays open');
assert.equal(railSearchFolded(320, true, ''), false, 'an opened field stays open');
assert.equal(railSearchFolded(320, false, 'ㄱ'), false, 'a typed or composing query never folds');

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN task rail search compact App: no Chromium'); process.exit(0); }
const dir = fileURLToPath(new URL('../webview-ui/', import.meta.url));
const app = await build({ entryPoints: [dir + 'src/main.tsx'], bundle: true, platform: 'browser', format: 'iife', outdir: 'rail-search-compact-assets', write: false, loader: { '.svg': 'dataurl' }, logLevel: 'silent' });
const css = app.outputFiles.find(f => f.path.endsWith('.css')).text, script = app.outputFiles.find(f => f.path.endsWith('.js')).text;
const b = await launch(bin), evidence = process.env.RAIL_SEARCH_EVIDENCE;
if (evidence) mkdirSync(evidence, { recursive: true });
const settle = (ms = 60) => new Promise(r => setTimeout(r, ms));
const send = async (data) => { await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(data)}}))`); await settle(); };
const shot = async (name) => { if (!evidence) return; const s = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/${name}.png`, Buffer.from(s.data, 'base64')); };
const field = `document.querySelector('.tw-search input')`;
const toggle = `document.querySelector('.tw-search-toggle')`;
const titles = () => b.evaluate(`[...document.querySelectorAll('.tw-task-list .tw-task-title')].map(e=>e.textContent)`);
const key = async (k, code, vk) => { await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, ...(k === 'Enter' ? { text: '\r' } : {}) }); await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }); await settle(); };
const noSideScroll = () => b.evaluate(`(()=>{const d=document.scrollingElement;const rail=document.querySelector('.tw-rail');return {page:d.scrollWidth<=d.clientWidth,rail:rail.scrollWidth<=rail.clientWidth,panel:[...document.querySelectorAll('.tw-home-panel')].every(p=>p.scrollWidth<=p.clientWidth)}})()`);
const box = (sel) => b.evaluate(`(()=>{const e=${sel};if(!e)return null;const r=e.getBoundingClientRect();const rail=document.querySelector('.tw-rail').getBoundingClientRect();return {w:r.width,h:r.height,top:r.top,left:r.left,right:r.right,inside:r.left>=rail.left-0.5&&r.right<=rail.right+0.5,font:parseFloat(getComputedStyle(e).fontSize)}})()`);

const many = Array.from({ length: 200 }, (_, i) => ({ id: `t${i}`, title: i === 137 ? '고양이 페이지' : `작업 ${i} 메모`, createdAt: 1, updatedAt: 300 - i, messageCount: 1 }));
const workspace = (tasks, scope = 'activity-a') => ({ scope, revision: 1, activeTaskId: tasks[0]?.id ?? null, tasks, sourceSelection: null });
const configFor = (ws, id) => chatConfig(3, { activity: { ...chatConfig().activity, id, kind: 'personal' }, profile: { ...chatConfig().profile, lesson: null }, taskWorkspace: ws });
let states = 0;
try {
  for (const dark of [true, false]) for (const width of [1420, 800, 359, 320]) {
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await b.load(`<html style="${vars}"><style>${css}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}"><div id="root"></div><script>window.__posted=[];window.acquireVsCodeApi=()=>({postMessage:(m)=>window.__posted.push(m),getState:()=>undefined,setState:()=>{}});</script><script>${script}</script></body></html>`, { width, height: 900, dark });
    await send({ type: 'config', config: configFor(workspace(many), 'activity-a') });
    await send({ type: 'history', messages: [] });
    const tag = `${width}-${dark ? 'dark' : 'light'}`;
    const narrow = width < 360;
    if (width <= 700) { await b.evaluate(`document.querySelector('.tw-rail-toggle').click()`); await settle(120); }

    // Placement: the search control is the first thing above the task list heading, after 새 작업.
    const order = await b.evaluate(`(()=>{const p=document.querySelector('#tw-home-tasks');const s=p.querySelector('.tw-search, .tw-search-toggle'),n=p.querySelector('.tw-new'),h=p.querySelector('.tw-rail-heading');return {afterNew:!!(n.compareDocumentPosition(s)&Node.DOCUMENT_POSITION_FOLLOWING),beforeHeading:!!(s.compareDocumentPosition(h)&Node.DOCUMENT_POSITION_FOLLOWING)}})()`);
    assert.deepEqual(order, { afterNew: true, beforeHeading: true }, `search sits at the top of the task list (${tag})`);

    if (narrow) {
      assert.equal(await b.evaluate(`!!${field}`), false, `under 360px the empty field is folded (${tag})`);
      const t = await box(toggle);
      assert.ok(t && t.w >= 44 && t.h >= 44 && t.inside, `folded icon is a 44px target inside the rail (${tag}): ${JSON.stringify(t)}`);
      assert.equal(await b.evaluate(`${toggle}.getAttribute('aria-label')+'/'+${toggle}.getAttribute('aria-expanded')`), '작업 찾기/false', 'the icon is named and says it is collapsed');
      assert.equal(await b.evaluate(`!!${toggle}.querySelector('svg')&&!${toggle}.textContent.trim()`), true, 'an icon (ChatIcon svg), not a text glyph');
      assert.deepEqual(await noSideScroll(), { page: true, rail: true, panel: true }, `no sideways scroll, folded (${tag})`);
      await shot(`rail-search-folded-${tag}`);
      // Keyboard press opens the field and moves focus into it.
      await b.evaluate(`${toggle}.focus()`); await key('Enter', 'Enter', 13); await settle(60);
      assert.equal(await b.evaluate(`document.activeElement===${field}`), true, `pressing the icon opens and focuses the field (${tag})`);
      assert.equal(await b.evaluate(`!!${toggle}`), false, 'the icon gives way to the field');
      // A composing query keeps the field open even when focus leaves.
      await b.send('Input.imeSetComposition', { text: '고', selectionStart: 1, selectionEnd: 1 }); await settle();
      await b.evaluate(`${field}.blur()`); await settle();
      assert.equal(await b.evaluate(`${field}?.value`), '고', 'a composing query is never folded away');
      await b.evaluate(`${field}.focus()`); await b.evaluate(`${field}.select()`); await b.send('Input.insertText', { text: '고양' }); await settle();
      assert.equal(await b.evaluate(`${field}.value`), '고양');
      assert.deepEqual(await titles(), ['고양이 페이지'], 'the opened field filters');
      await b.evaluate(`${field}.blur()`); await settle();
      assert.equal(await b.evaluate(`!!${field}&&!${toggle}`), true, 'a typed query keeps the field open after blur');
      await b.evaluate(`${field}.focus()`); await b.evaluate(`${field}.select()`); await key('Backspace', 'Backspace', 8);
      assert.equal(await b.evaluate(`${field}.value`), '');
      assert.equal((await titles()).length, 200, 'clearing restores the list');
      // Escape keeps its one meaning on the narrow rail (close the list); reopened, the empty field is folded.
      await key('Escape', 'Escape', 27); await settle(120);
      assert.equal(await b.evaluate(`document.querySelector('.tw-workspace').dataset.railOpen`), 'false', 'Escape closes the narrow rail as before');
      await b.evaluate(`document.querySelector('.tw-rail-toggle').click()`); await settle(120);
      assert.equal(await b.evaluate(`!!${toggle}&&!${field}`), true, `reopened rail shows the folded icon (${tag})`);
      // Blur of the empty field folds it too.
      await b.evaluate(`${toggle}.click()`); await settle(60);
      assert.equal(await b.evaluate(`document.activeElement===${field}`), true);
      await b.evaluate(`document.querySelector('.tw-new').focus()`); await settle();
      assert.equal(await b.evaluate(`!!${toggle}`), true, 'an empty field folds again when focus leaves');
      await b.evaluate(`${toggle}.click()`); await settle(60);
    } else {
      assert.equal(await b.evaluate(`!!${toggle}`), false, `at 360px and wider there is no folded icon (${tag})`);
    }

    // The open field: 44px tall, >=14px text, inside the rail, theme colours (not a hard-coded fill).
    const f = await box(field);
    assert.ok(f && f.h >= 44 && f.font >= 14 && f.inside, `open field 44px / 14px inside the rail (${tag}): ${JSON.stringify(f)}`);
    const colours = await b.evaluate(`(()=>{const s=getComputedStyle(${field});const probe=document.createElement('div');probe.style.background='var(--vscode-input-background)';document.body.append(probe);const want=getComputedStyle(probe).backgroundColor;probe.remove();return {bg:s.backgroundColor,want}})()`);
    assert.equal(colours.bg, colours.want, `the field uses the theme input background (${tag})`);
    assert.deepEqual(await noSideScroll(), { page: true, rail: true, panel: true }, `no sideways scroll, open (${tag})`);

    // 200 tasks: the list changes within 100ms of the committed input event.
    await b.evaluate(`(()=>{window.__lat=null;const list=document.querySelector('.tw-task-list');let start=0;${field}.addEventListener('input',e=>{start=performance.now()},{capture:true,once:true});new MutationObserver((m,o)=>{if(!start)return;o.disconnect();window.__lat=performance.now()-start}).observe(list,{childList:true,subtree:true})})()`);
    await b.evaluate(`${field}.focus()`); await b.send('Input.insertText', { text: '고양이' }); await settle(200);
    const latency = await b.evaluate(`window.__lat`);
    assert.ok(typeof latency === 'number' && latency <= 100, `200-task filter updates within 100ms (${tag}): ${latency}`);
    assert.deepEqual(await titles(), ['고양이 페이지']);
    await shot(`rail-search-open-${tag}`);
    states++;
  }
  assert.equal(states, 8, 'two themes x four widths');
  console.log(`task rail search compact App: ${states} states OK`);
} finally { await b.close(); }
