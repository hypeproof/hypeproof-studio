// CGP-KNOW-R-008 / DES-KNOW-13: the real App bundle in headless Chromium.
// - The task list draws the chosen emoji and colour before the title, and the accessibility tree
//   names each task by its title: no emoji in any accessible name (measured through CDP, not source).
// - Colour is never the only cue: the title text is drawn next to every mark.
// - Every swatch is at least 3:1 against the task list background, dark and light (computed).
// - The picker opens from the personal task menu, has 44px choices, a text name on every colour,
//   a check mark plus ring on the selected one, posts only ids, closes on a saved result bound to its
//   request and task, shows an alert on failure, and closes when the open task changes.
// - Classroom seats have no task menu item. Forced colours keep the swatch outline.
// Set FOCUS_REQUIRE_BROWSER=1 to fail without Chromium. APPEARANCE_EVIDENCE=<dir> saves PNGs.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { chatConfig } from './sx-screen-fixtures.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN task appearance App: no Chromium'); process.exit(0); }
const dir = fileURLToPath(new URL('../webview-ui/', import.meta.url));
const app = await build({ entryPoints: [dir + 'src/main.tsx'], bundle: true, platform: 'browser', format: 'iife', outdir: 'appearance-assets', write: false, loader: { '.svg': 'dataurl' }, logLevel: 'silent' });
const css = app.outputFiles.find(f => f.path.endsWith('.css')).text, script = app.outputFiles.find(f => f.path.endsWith('.js')).text;
const b = await launch(bin), evidence = process.env.APPEARANCE_EVIDENCE;
if (evidence) mkdirSync(evidence, { recursive: true });
const settle = (ms = 60) => new Promise(r => setTimeout(r, ms));
const send = async (data) => { await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(data)}}))`); await settle(); };
const shot = async name => { if (!evidence) return; const png = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/${name}.png`, Buffer.from(png.data, 'base64')); };
const stub = `window.__posts=[];window.acquireVsCodeApi=()=>({postMessage:m=>window.__posts.push(JSON.parse(JSON.stringify(m))),getState:()=>undefined,setState:()=>{}});`;
const page = (vars, dark) => `<html style="${vars}"><style>${css}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}"><div id="root"></div><script>${stub}</script><script>${script}</script></body></html>`;
const item = `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='아이콘과 색 정하기')`;
const openMenu = async () => { await b.evaluate(`(()=>{const t=document.querySelector('.tw-chat-menu-toggle');if(t&&t.getAttribute('aria-expanded')!=='true')t.click();})()`); await settle(); };
const COLOURS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'];
const EMOJI = /\p{Extended_Pictographic}/u;
const workspace = (tasks, active = 'task') => ({ scope: 'appearance-test', revision: 1, activeTaskId: active, tasks, sourceSelection: null });
const tasks = [
  { id: 'task', title: '고양이 페이지', createdAt: 1, updatedAt: 9, messageCount: 2, appearance: { emoji: 'cat', colour: 'pink' } },
  ...COLOURS.map((colour, i) => ({ id: `c-${colour}`, title: `색 ${colour}`, createdAt: 1, updatedAt: 8 - i * 0.1, messageCount: 0, appearance: { colour } })),
  { id: 'plain', title: '표시 없는 작업', createdAt: 1, updatedAt: 1, messageCount: 0 },
];
// WCAG relative luminance from a computed rgb()/rgba() string, composited on the backdrop when translucent.
const contrastJs = `(()=>{const p=s=>{const m=s.match(/rgba?\\(([^)]+)\\)/);if(!m)return null;const v=m[1].split(/[ ,/]+/).filter(Boolean).map(Number);return {r:v[0],g:v[1],b:v[2],a:v.length>3?v[3]:1}};
const lum=c=>{const f=x=>{x/=255;return x<=0.03928?x/12.92:((x+0.055)/1.055)**2.4};return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b)};
const rail=p(getComputedStyle(document.querySelector('.tw-rail')).backgroundColor);
return [...document.querySelectorAll('.tw-task .tw-task-mark[data-colour]')].map(m=>{const c=p(getComputedStyle(m.querySelector('.tw-task-swatch')).backgroundColor);const a=lum(c),z=lum(rail);return {colour:m.dataset.colour,ratio:(Math.max(a,z)+0.05)/(Math.min(a,z)+0.05),swatch:getComputedStyle(m.querySelector('.tw-task-swatch')).backgroundColor,rail:getComputedStyle(document.querySelector('.tw-rail')).backgroundColor}})})()`;
let states = 0;
try {
  for (const dark of [true, false]) for (const width of [800, 1420]) {
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await b.load(page(vars, dark), { width, height: 900, dark });
    const base = chatConfig(3, { activity: { ...chatConfig().activity, kind: 'personal' }, profile: { ...chatConfig().profile, lesson: null }, taskWorkspace: workspace(tasks) });
    await send({ type: 'config', config: base });
    await send({ type: 'history', messages: [] });
    if (width === 800) { await b.evaluate(`document.querySelector('.tw-rail-toggle')?.click()`); await settle(); }
    // List: the mark is drawn, hidden from the accessibility tree, and the title is always beside it.
    const rows = await b.evaluate(`[...document.querySelectorAll('.tw-task')].map(e=>({title:e.querySelector('.tw-task-title').textContent,mark:e.querySelector('.tw-task-mark')?.getAttribute('aria-hidden')??null,visibleTitle:(()=>{const t=e.querySelector('.tw-task-title');const r=t.getBoundingClientRect();return r.width>20&&r.height>0})()}))`);
    assert.equal(rows.length, tasks.length);
    assert.ok(rows[0].title.includes('🐱') && rows[0].title.endsWith('고양이 페이지'), `emoji drawn before the title: ${rows[0].title}`);
    assert.ok(rows.filter(r => r.mark !== null).every(r => r.mark === 'true'), 'every mark is aria-hidden');
    assert.ok(rows.every(r => r.visibleTitle), 'the title text is visible next to every mark (colour is never the only cue)');
    const ax = await b.send('Accessibility.getFullAXTree', {});
    const named = ax.nodes.filter(n => n.role?.value === 'button' && !n.ignored).map(n => n.name?.value ?? '');
    for (const task of tasks) assert.ok(named.some(name => name.startsWith(task.title)), `accessible name starts with the title: ${task.title} in ${JSON.stringify(named.filter(n => n.includes(task.title)))}`);
    assert.ok(!ax.nodes.some(n => !n.ignored && EMOJI.test(n.name?.value ?? '')), 'no accessible name in the page contains an emoji');
    // Contrast: each colour against the list background, in this theme.
    const ratios = await b.evaluate(contrastJs);
    assert.equal(ratios.length, 9);
    assert.deepEqual([...new Set(ratios.map(r => r.colour))].sort(), [...COLOURS].sort());
    for (const r of ratios) assert.ok(r.ratio >= 3, `${dark ? 'dark' : 'light'} ${r.colour} swatch ${r.swatch} vs ${r.rail}: ${r.ratio.toFixed(2)}:1 < 3:1`);
    assert.equal(new Set(ratios.map(r => r.swatch)).size, 8, 'eight distinct drawn colours');
    await shot(`rail-${width}-${dark ? 'dark' : 'light'}`);
    if (width === 800) { await b.evaluate(`document.querySelector('.tw-rail-close')?.click()`); await settle(); }

    // Picker from the task menu.
    await openMenu();
    const menuItem = await b.evaluate(`(()=>{const e=${item};if(!e)return null;const r=e.getBoundingClientRect();return {role:e.getAttribute('role'),h:r.height,w:r.width,font:parseFloat(getComputedStyle(e).fontSize)}})()`);
    assert.ok(menuItem, 'the personal task menu offers 아이콘과 색 정하기');
    assert.equal(menuItem.role, 'menuitem'); assert.ok(menuItem.h >= 44 && menuItem.font >= 14, JSON.stringify(menuItem));
    await b.evaluate(`(${item}).click()`); await settle(150);
    const dialog = await b.evaluate(`(()=>{const d=document.querySelector('dialog.tw-appearance');if(!d)return null;const a=document.activeElement;return {open:d.open,modal:d.matches(':modal'),focus:a&&a.type==='radio'&&a.checked?a.name+':'+a.value:null,label:document.getElementById(d.getAttribute('aria-labelledby'))?.textContent}})()`);
    assert.deepEqual(dialog, { open: true, modal: true, focus: 'task-emoji:cat', label: '아이콘과 색 정하기' }, 'modal picker opens on the current choice');
    const options = await b.evaluate(`[...document.querySelectorAll('.tw-appearance-option')].map(l=>{const r=l.getBoundingClientRect();const i=l.querySelector('input');return {name:i.getAttribute('aria-label')??l.textContent.trim(),colour:l.dataset.colour??null,w:r.width,h:r.height,font:parseFloat(getComputedStyle(l).fontSize),inView:r.left>=0&&r.right<=innerWidth}})`);
    assert.equal(options.length, 13 + 9, '12 emoji + none, 8 colours + none');
    for (const o of options) { assert.ok(o.w >= 44 && o.h >= 44, `44px choice: ${JSON.stringify(o)}`); assert.ok(o.font >= 14, `>=14px: ${JSON.stringify(o)}`); assert.equal(o.inView, true, `in view at ${width}px: ${o.name}`); }
    const colourNames = options.filter(o => o.colour).map(o => o.name);
    assert.deepEqual(colourNames, ['빨강', '주황', '노랑', '초록', '청록', '파랑', '보라', '분홍'], 'every swatch has a visible text name');
    assert.ok(options.every(o => o.name && !EMOJI.test(o.name)), 'every choice has a text name; emoji choices are named in Korean');
    // Selected: check mark + 2px ring; others have neither.
    await b.evaluate(`document.querySelector('.tw-appearance-colour[data-colour=blue]').click()`); await settle();
    const selected = await b.evaluate(`[...document.querySelectorAll('.tw-appearance-colour')].map(l=>{const s=getComputedStyle(l);return {colour:l.dataset.colour??'none',check:!!l.querySelector('svg'),ring:s.boxShadow!=='none',border:s.borderTopColor}})`);
    assert.deepEqual(selected.filter(s => s.check).map(s => s.colour), ['blue'], 'only the selected colour shows the check');
    assert.deepEqual(selected.filter(s => s.ring).map(s => s.colour), ['blue'], 'only the selected colour has the ring');
    // Keyboard: arrows move within the group (native radio group) and the focus ring hugs the choice.
    await b.evaluate(`document.querySelector('input[name=task-colour][value=blue]').focus()`);
    await b.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }); await settle();
    const ring = await b.evaluate(`(()=>{const a=document.activeElement;const l=a.closest('label');const s=getComputedStyle(l);return {value:a.value,outline:s.outlineStyle,width:parseFloat(s.outlineWidth)}})()`);
    assert.deepEqual(ring, { value: 'purple', outline: 'solid', width: 2 }, 'arrow key selects the next colour and the label shows a 2px focus ring');
    await shot(`picker-${width}-${dark ? 'dark' : 'light'}`);
    // Save: ids only, bound to request + task. A result for another request is ignored.
    await b.evaluate(`window.__posts.length=0;document.querySelector('.tw-appearance-save').click()`); await settle();
    const posted = await b.evaluate(`window.__posts.filter(p=>p.type==='taskAppearance')`);
    assert.equal(posted.length, 1);
    assert.deepEqual({ appearance: posted[0].appearance, taskId: posted[0].taskId }, { appearance: { emoji: 'cat', colour: 'purple' }, taskId: 'task' });
    assert.equal(await b.evaluate(`document.querySelector('.tw-appearance-save').disabled`), true, 'no double save while pending');
    await send({ type: 'taskAppearanceResult', requestId: 'someone-else', taskId: 'task', saved: true });
    assert.equal(await b.evaluate(`!!document.querySelector('dialog.tw-appearance[open]')`), true, 'a result for another request does not close the picker');
    await send({ type: 'taskAppearanceResult', requestId: posted[0].requestId, taskId: 'task', saved: false });
    assert.equal(await b.evaluate(`document.querySelector('.tw-appearance [role=alert]')?.textContent`), '아이콘과 색을 저장하지 못했습니다. 고른 것은 그대로 있어요. 다시 시도해 주세요.');
    assert.equal(await b.evaluate(`document.querySelector('input[name=task-colour]:checked').value`), 'purple', 'the choice is kept after a failure');
    await b.evaluate(`window.__posts.length=0;document.querySelector('.tw-appearance-save').click()`); await settle();
    const retry = await b.evaluate(`window.__posts.find(p=>p.type==='taskAppearance')`);
    await send({ type: 'taskWorkspaceState', view: workspace(tasks.map(t => t.id === 'task' ? { ...t, appearance: { emoji: 'cat', colour: 'purple' } } : t)) });
    await send({ type: 'taskAppearanceResult', requestId: retry.requestId, taskId: 'task', saved: true }); await settle(400);
    assert.equal(await b.evaluate(`!!document.querySelector('dialog.tw-appearance')`), false, 'a saved result closes the picker');
    assert.equal(await b.evaluate(`document.activeElement?.classList.contains('tw-chat-menu-toggle')`), true, 'focus returns to the task menu');
    assert.equal(await b.evaluate(`document.querySelector('.tw-task[aria-current=page] .tw-task-mark').dataset.colour`), 'purple', 'the list draws the saved colour');
    // Escape cancels without posting; a task switch closes an open picker.
    await openMenu(); await b.evaluate(`(${item}).click()`); await settle(150);
    await b.evaluate(`window.__posts.length=0`);
    await b.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await settle(400);
    assert.equal(await b.evaluate(`!!document.querySelector('dialog.tw-appearance')`), false, 'Escape closes');
    assert.equal(await b.evaluate(`window.__posts.filter(p=>p.type==='taskAppearance').length`), 0, 'Escape saves nothing');
    assert.equal(await b.evaluate(`document.activeElement?.classList.contains('tw-chat-menu-toggle')`), true, 'Escape returns focus to the task menu');
    await openMenu(); await b.evaluate(`(${item}).click()`); await settle(150);
    await b.evaluate(`[...document.querySelectorAll('.tw-appearance-actions button')].find(e=>e.textContent==='취소').click()`); await settle(400);
    assert.equal(await b.evaluate(`!!document.querySelector('dialog.tw-appearance')`), false, '취소 closes');
    assert.equal(await b.evaluate(`document.activeElement?.classList.contains('tw-chat-menu-toggle')`), true, '취소 returns focus to the task menu');
    await openMenu(); await b.evaluate(`(${item}).click()`); await settle(150);
    await send({ type: 'config', config: { ...base, taskWorkspace: { ...workspace(tasks, 'plain'), revision: 2 } } });
    await send({ type: 'history', messages: [] });
    assert.equal(await b.evaluate(`!!document.querySelector('dialog.tw-appearance')`), false, 'a task switch closes the picker');
    states++;
  }
  // Classroom seat: no task workspace, no menu item.
  await b.load(page('', true), { width: 1420, height: 900 });
  await send({ type: 'config', config: chatConfig(3, { activity: { ...chatConfig().activity, kind: 'classroom' } }) });
  await send({ type: 'history', messages: [] });
  assert.equal(await b.evaluate(`!!(${item})`), false, 'classroom seats have no appearance item');
  // Forced colours: the swatch keeps an outline when author colours are replaced.
  await b.load(page('', true), { width: 1420, height: 900, forcedColors: true });
  await send({ type: 'config', config: chatConfig(3, { activity: { ...chatConfig().activity, kind: 'personal' }, profile: { ...chatConfig().profile, lesson: null }, taskWorkspace: workspace(tasks) }) });
  await send({ type: 'history', messages: [] });
  const fc = await b.evaluate(`(()=>{const s=getComputedStyle(document.querySelector('.tw-task .tw-task-swatch'));return {style:s.borderTopStyle,width:parseFloat(s.borderTopWidth)}})()`);
  assert.equal(fc.style, 'solid'); assert.ok(fc.width >= 1, `forced-colours swatch outline: ${JSON.stringify(fc)}`);
  await shot('rail-forced-colours');
  console.log(`PASS task appearance App in ${states} theme/width states + classroom + forced colours: aria-hidden marks, title-only names, 3:1 swatches, 44px picker, named colours, check+ring, ids-only save, request binding, failure alert, Escape, task switch`);
} finally { await b.close(); }
