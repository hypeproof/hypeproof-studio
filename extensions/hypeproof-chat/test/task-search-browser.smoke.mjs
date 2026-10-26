// CGP-CHAT-R-026 / CGP-CHAT-D79 — task search on the mounted personal workspace (TaskWorkspace + the real
// ChatPanel, shipped stylesheet) in headless Chromium. Typing asks the host (taskSearch) and the page makes no
// network request; results show the title, a snippet with the match in bold (not colour alone) and a date;
// opening a result in another task asks the host to switch, and once that task's messages are on screen the
// transcript is scrolled to the matched message and stays there; a result in the open task scrolls at once;
// an answer to an older query is ignored; no match shows "찾는 대화가 없어요". Owner reconciliation with
// CGP-KNOW-R-001: message matches form a 찾은 대화 group under the local title list, and a task that matched
// by title is never listed twice. Geometry: 44px targets, 14px
// text floor, inside the rail, in dark and light, 800 and 1420 px, and with forced colours. A seat without a task
// workspace (classroom) draws no search field.
// Fails under FOCUS_REQUIRE_BROWSER=1 without a browser; prints NOT RUN otherwise.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chatConfig, chatPanelProps } from './sx-screen-fixtures.mjs';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const turns = (prefix, n, special = {}) => Array.from({ length: n }, (_, k) => [
  { id: `${prefix}-u${k}`, role: 'user', content: special[k] ?? `${prefix} 질문 ${k}`, createdAt: 1_760_000_000_000 + k * 60_000 },
  { id: `${prefix}-a${k}`, role: 'assistant', content: `${prefix} 답변 ${k}. `.repeat(30), createdAt: 1_760_000_000_000 + k * 60_000 + 1 },
]).flat();
const tasks = [
  { id: 't1', title: '날씨 앱 만들기', createdAt: 1, updatedAt: 1_760_100_000_000, messages: turns('t1', 12, { 3: '버튼 색을 바꾸고 싶어요', 5: '페이지 링크를 고쳐요' }) },
  { id: 't2', title: '자기소개 페이지', createdAt: 1, updatedAt: 1_760_200_000_000, messages: turns('t2', 14, { 4: '<b>무지개</b> 배경은 어떻게 넣어요?', 6: '<img src=x onerror="window.pwned=1">해킹시도 \u202e거꾸로\u2066 문장', 9: '자기소개 페이지 제목을 바꿔요' }) },
];
const summary = (task) => ({ id: task.id, title: task.title, createdAt: task.createdAt, updatedAt: task.updatedAt, messageCount: task.messages.length });
const view = (active) => ({ scope: 'scope-a', revision: 1, activeTaskId: active, tasks: tasks.map(summary), sourceSelection: null });
const personalConfig = (active) => chatConfig(3, { activity: { ...chatConfig().activity, kind: 'personal' }, profile: { ...chatConfig().profile, lesson: null }, taskWorkspace: view(active) });
const props = chatPanelProps({ config: personalConfig('t1') });
const callbacks = Object.entries(props).filter(([, v]) => typeof v === 'function').map(([k]) => `${k}:()=>{}`).join(',');
const data = Object.fromEntries(Object.entries(props).filter(([k, v]) => typeof v !== 'function' && k !== 'config' && k !== 'messages'));
const asset = await build({ entryPoints: [`${root}/webview-ui/src/main.tsx`], bundle: true, write: false, outdir: 'out', loader: { '.svg': 'dataurl' }, logLevel: 'silent' });
const css = asset.outputFiles.find((f) => f.path.endsWith('.css')).text;
const js = (await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import{ChatPanel}from'./src/ChatPanel';import{TaskWorkspaceFrame}from'./src/TaskWorkspace';import{searchTasks}from'../src/taskSearch';
window.searchTasks=searchTasks;const root=createRoot(document.getElementById('root'));
window.mountSync=(...a)=>flushSync(()=>mount(...a));window.mount=(config,messages,busy=false)=>root.render(<TaskWorkspaceFrame view={config.taskWorkspace} messages={messages} busy={busy} error={null} onDismissError={()=>{}}><ChatPanel {...${JSON.stringify(data)}} {...{${callbacks}}} config={config} messages={messages}/></TaskWorkspaceFrame>);`, resolveDir: root + '/webview-ui', loader: 'tsx' }, bundle: true, write: false, outdir: 'fixture-assets', format: 'iife', platform: 'browser', loader: { '.svg': 'dataurl' }, logLevel: 'silent' })).outputFiles.find((f) => f.path.endsWith('.js')).text;

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN: task search browser unavailable'); process.exit(0); }
const browser = await launch(bin), evidence = process.env.TASK_SEARCH_EVIDENCE;
if (evidence) mkdirSync(evidence, { recursive: true });
const delay = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const ev = (expr) => browser.evaluate(expr);
const lastSearch = () => ev(`posted.filter(m=>m.type==='taskSearch').at(-1)`);
// The host's answer, computed by the shipped search over the fixture task files.
const answer = async (requestId, query) => { await ev(`window.dispatchEvent(new MessageEvent('message',{data:{type:'taskSearchResult',requestId:${JSON.stringify(requestId)},scope:'scope-a',results:searchTasks(${JSON.stringify(tasks)},${JSON.stringify(query)})}}))`); await delay(); };
const type = async (text) => { await ev(`(()=>{const i=document.querySelector('.tw-search input');i.focus();i.select();})()`); await browser.send('Input.insertText', { text }); await delay(300); };
const transcript = () => ev(`(()=>{const box=document.querySelector('.hps-messages');return {top:box.scrollTop,max:box.scrollHeight-box.clientHeight}})()`);
const rowOffset = (id) => ev(`(()=>{const box=document.querySelector('.hps-messages'),row=box.querySelector('[data-message-id="${id}"]');return row.getBoundingClientRect().top-box.getBoundingClientRect().top})()`);
let cases = 0;
try {
  for (const forced of [false, true]) for (const dark of [false, true]) for (const width of [800, 1420]) {
    if (forced && width === 800) continue;
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await browser.load(`<html style="${vars}"><style>${css}</style><style>html,body,#root{height:100%}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}" style="margin:0"><div id="root"></div><script>window.posted=[];window.netCalls=0;const f=window.fetch;window.fetch=(...a)=>{netCalls++;return f(...a)};const o=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(...a){netCalls++;return o.apply(this,a)};window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(JSON.parse(JSON.stringify(m))),getState:()=>({}),setState:()=>{}});</script><script>${js}</script></body></html>`, { width, height: 900, dark, forcedColors: forced });
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }, { name: 'forced-colors', value: forced ? 'active' : 'none' }] });
    await ev(`mount(${JSON.stringify(personalConfig('t1'))},${JSON.stringify(tasks[0].messages)})`); await delay();
    if (width === 800) { await ev(`document.querySelector('.tw-rail-toggle').click()`); await delay(); }
    assert.equal(await ev(`document.querySelector('.tw-search input').placeholder`), '작업 이름이나 대화 내용으로 찾기…');

    // A stale answer (an older query) is ignored; only the latest request's answer draws.
    await type('무'); const stale = await lastSearch();
    await type('무지개'); const fresh = await lastSearch();
    assert.equal(fresh.query, '무지개'); assert.notEqual(stale.requestId, fresh.requestId);
    await answer(stale.requestId, '답변');
    assert.equal(await ev(`document.querySelectorAll('.tw-search-result').length`), 0, 'an older query\'s answer is not drawn');
    await answer(fresh.requestId, '무지개');
    const result = await ev(`(()=>{const b=document.querySelector('.tw-search-result');return {n:document.querySelectorAll('.tw-search-result').length,id:b.dataset.taskId,title:b.querySelector('.tw-task-title').textContent,snippet:b.querySelector('.tw-task-snippet').textContent,strong:[...b.querySelectorAll('.tw-task-snippet strong')].map(s=>s.textContent),weight:Number(getComputedStyle(b.querySelector('.tw-task-snippet strong')).fontWeight),plain:Number(getComputedStyle(b.querySelector('.tw-task-snippet span')).fontWeight),time:b.querySelector('time').getAttribute('datetime'),html:b.querySelector('.tw-task-snippet').innerHTML}})()`);
    assert.deepEqual([result.n, result.id, result.title], [1, 't2', '자기소개 페이지']);
    assert.match(result.snippet, /<b>무지개<\/b> 배경은 어떻게 넣어요\?/, 'the snippet is the matched message text, shown as text');
    assert.ok(!/<b>/.test(result.html.replace(/&lt;b&gt;/g, '')), 'model or learner markup is never rendered as HTML');
    assert.deepEqual(result.strong, ['무지개']); assert.ok(result.weight >= 600 && result.plain < result.weight, 'the match is bold, not colour only');
    assert.equal(result.time, new Date(tasks[1].messages[8].createdAt).toISOString(), 'the date is the matched message\'s');
    const geometry = await ev(`(()=>{const b=document.querySelector('.tw-search-result'),i=document.querySelector('.tw-search input'),rail=document.querySelector('.tw-rail').getBoundingClientRect();return [b,i].map(e=>{const r=e.getBoundingClientRect();return {h:r.height,w:r.width,l:r.left,r:r.right,rail:[rail.left,rail.right]}}).concat([...b.querySelectorAll('span,time,strong')].filter(e=>e.textContent.trim()).map(e=>({font:parseFloat(getComputedStyle(e).fontSize)})))})()`);
    for (const g of geometry.slice(0, 2)) { assert.ok(g.h >= 44 && g.w >= 44, `44px target ${JSON.stringify(g)}`); assert.ok(g.l >= g.rail[0] - 0.5 && g.r <= g.rail[1] + 0.5, `inside the rail ${JSON.stringify(g)}`); }
    for (const g of geometry.slice(2)) assert.ok(g.font >= 14, `14px text floor ${g.font}`);
    if (forced) {
      const ring = await browser.focusVisibleStyle('.tw-search-result');
      assert.notEqual(ring['outline-style'], 'none', 'forced colours keep a focus ring');
    }
    if (evidence) writeFileSync(`${evidence}/search-${forced ? 'forced-' : ''}${dark ? 'dark' : 'light'}-${width}.png`, Buffer.from((await browser.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

    // Opening a result in another task: ask the host to switch, then jump once its messages are on screen.
    const before = await ev('posted.length');
    await ev(`document.querySelector('.tw-search-result').click()`); await delay();
    assert.deepEqual(await ev(`posted.slice(${before}).filter(m=>m.type==='taskSelect').map(m=>m.id)`), ['t2']);
    // The switched task's messages and a second update (another host message with a new array) commit in one
    // task, before the browser's own scroll event: the jump must hold without waiting for that event.
    await ev(`(()=>{const c=${JSON.stringify(personalConfig('t2'))},m=${JSON.stringify(tasks[1].messages)};mountSync(c,m);mountSync(c,m.slice())})()`); await delay(200);
    const after = await transcript(), offset = await rowOffset('t2-u4');
    assert.ok(after.max > 400, 'the fixture transcript scrolls');
    assert.ok(after.top < after.max - 100, `not left at the latest message ${JSON.stringify(after)}`);
    assert.ok(Math.abs(offset) < 4, `the matched message is at the top of the transcript (${offset})`);
    await ev(`document.querySelector('.hps-messages').style.paddingBottom='40px'`); await delay(200);
    assert.ok(Math.abs(await rowOffset('t2-u4')) < 4, 'a later resize does not pull the transcript back to the latest message');
    if (evidence) writeFileSync(`${evidence}/opened-${forced ? 'forced-' : ''}${dark ? 'dark' : 'light'}-${width}.png`, Buffer.from((await browser.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

    // A result in the open task scrolls at once, without a host round trip.
    if (width === 800) { await ev(`document.querySelector('.tw-rail-toggle').click()`); await delay(); }
    await type('답변 1.'); const own = await lastSearch(); await answer(own.requestId, '답변 1.');
    await ev(`document.querySelector('.hps-messages').scrollTop=0;document.querySelector('.hps-messages').dispatchEvent(new Event('scroll'))`); await delay();
    const selects = await ev(`posted.filter(m=>m.type==='taskSelect').length`);
    const open = await ev(`(()=>{const b=[...document.querySelectorAll('.tw-search-result')].find(b=>b.dataset.taskId==='t2');return b&&b.getAttribute('aria-current')})()`);
    assert.equal(open, 'page');
    await ev(`[...document.querySelectorAll('.tw-search-result')].find(b=>b.dataset.taskId==='t2').click()`); await delay();
    assert.equal(await ev(`posted.filter(m=>m.type==='taskSelect').length`), selects, 'the open task is not re-selected');
    assert.ok(Math.abs(await rowOffset('t2-a1')) < 4, 'scrolled to the latest matching answer in the open task');

    // A failed switch never jumps later: the pending jump is dropped once another task is shown.
    if (width === 800) { await ev(`document.querySelector('.tw-rail-toggle').click()`); await delay(); }
    await type('버튼 색'); const other = await lastSearch(); await answer(other.requestId, '버튼 색');
    await ev(`document.querySelector('.tw-search-result').click()`); await delay();
    await ev(`mount(${JSON.stringify({ ...personalConfig('t2'), taskWorkspace: { ...view('t2'), tasks: [...view('t2').tasks, { id: 't3', title: '새 작업', createdAt: 1, updatedAt: 1, messageCount: 0 }], activeTaskId: 't3' } })},[])`); await delay();
    await ev(`mount(${JSON.stringify(personalConfig('t1'))},${JSON.stringify(tasks[0].messages)})`); await delay(200);
    assert.ok(Math.abs(await rowOffset('t1-u3')) > 40, 'no stale jump after the switch went elsewhere');

    // A refused switch (the host answers with a task error) stays put; opening that task later does not jump.
    await ev(`mount(${JSON.stringify(personalConfig('t2'))},${JSON.stringify(tasks[1].messages)})`); await delay();
    if (width === 800) { await ev(`document.querySelector('.tw-rail-toggle').click()`); await delay(); }
    await type('버튼 색을'); const refused = await lastSearch(); await answer(refused.requestId, '버튼 색을');
    await ev(`document.querySelector('.tw-search-result').click()`); await delay();
    await ev(`window.dispatchEvent(new MessageEvent('message',{data:{type:'taskWorkspaceError',error:'진행 중인 작업을 멈춘 뒤 다시 시도해 주세요.'}}))`); await delay();
    await ev(`mount(${JSON.stringify(personalConfig('t1'))},${JSON.stringify(tasks[0].messages)})`); await delay(200);
    assert.ok(Math.abs(await rowOffset('t1-u3')) > 40, 'no jump after a refused switch');

    // The host could not read the task file: say so, never "no match".
    if (width === 800) { await ev(`document.querySelector('.tw-rail-toggle').click()`); await delay(); }
    await type('아무거나'); const broken = await lastSearch();
    await ev(`window.dispatchEvent(new MessageEvent('message',{data:{type:'taskSearchResult',requestId:${JSON.stringify(broken.requestId)},scope:'scope-a',results:null}}))`); await delay();
    assert.equal(await ev(`[...document.querySelectorAll('.tw-search-group .tw-empty-search')].map(e=>e.textContent).join('|')`), '작업 기록을 읽지 못해 지금은 찾을 수 없어요');

    // No match.
    if (width === 800) { await ev(`document.querySelector('.tw-rail-toggle').click()`); await delay(); }
    await type('없는말'); const none = await lastSearch(); await answer(none.requestId, '없는말');
    assert.equal(await ev(`document.querySelector('.tw-search-group .tw-empty-search').textContent`), '찾는 대화가 없어요');
    // Hostile message text (an <img onerror> tag and bidi overrides) is shown as inert text in the result.
    if (width === 800) { await ev(`document.querySelector('.tw-rail-toggle').click()`); await delay(); }
    await type('해킹시도'); const hostile = await lastSearch(); await answer(hostile.requestId, '해킹시도');
    const inert = await ev(`(()=>{const box=document.querySelector('.tw-search-results'),s=box.querySelector('.tw-task-snippet');return {img:box.querySelectorAll('img,b').length,text:s.textContent,strong:[...s.querySelectorAll('strong')].map(e=>e.textContent),pwned:window.pwned===1}})()`);
    assert.equal(inert.img, 0, 'no element is created from message markup');
    assert.equal(inert.pwned, false, 'no handler from message text runs');
    assert.match(inert.text, /window\.pwned=1">해킹시도 거꾸로 문장/, 'the markup is visible as text (the window starts 24 characters before the match)');
    assert.ok(!/[\u202a-\u202e\u2066-\u2069]/.test(inert.text), 'bidi controls never reach the snippet');
    assert.deepEqual(inert.strong, ['해킹시도']);
    assert.equal(await ev('netCalls'), 0, 'search makes no network request from the page');
    // A task matching by title and in its messages is listed once, in the title list; a task matching only
    // in message text is in the 찾은 대화 group under it.
    await type('페이지'); const both = await lastSearch(); await answer(both.requestId, '페이지');
    assert.ok((await ev(`searchTasks(${JSON.stringify(tasks)},'페이지')`)).some(r => r.taskId === 't2' && r.messageId), 'control: the host answer does carry t2 as a message match');
    const rail = await ev(`(()=>({titles:[...document.querySelectorAll('.tw-task-list:not(.tw-search-results) .tw-task-title')].map(e=>e.textContent),found:[...document.querySelectorAll('.tw-search-results .tw-search-result')].map(b=>b.dataset.taskId),order:document.querySelector('.tw-task-list').compareDocumentPosition(document.querySelector('.tw-search-group'))}))()`);
    assert.deepEqual(rail.titles, ['자기소개 페이지'], 'the title list is the local filter');
    assert.deepEqual(rail.found, ['t1'], `a task already listed by title is not listed again: ${JSON.stringify(rail)}`);
    assert.ok(rail.order & 4, 'the message group follows the title list');
    cases++;
  }
  // Classroom seat: no task workspace, no search field.
  await ev(`mount(${JSON.stringify({ ...chatConfig(), taskWorkspace: undefined })},[])`); await delay();
  assert.equal(await ev(`document.querySelector('.tw-search')`), null);
  console.log(`PASS task search browser: ${cases} cases (dark/light, 800/1420, forced colours) — host query, bold snippet, date, jump to message, stale answers ignored, empty state, no network, 44px/14px`);
} finally { await browser.close(); }
