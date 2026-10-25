// REQ-STUDIO-TASK-RAIL-SEARCH (CGP-KNOW-R-001): the real App bundle in headless Chromium. Typing in the
// rail search shows only the current activity's tasks whose title contains the text; an open Korean
// IME composition never filters, the commit does; a title stored in decomposed jamo still matches;
// clearing restores the full list; another activity's tasks never appear and its search starts empty.
// The title filter itself posts nothing to the host: no post while an IME composition is open or for a
// blank query. Owner reconciliation with CGP-CHAT-R-026: each committed, non-blank query posts exactly one
// `taskSearch` (message-text search, debounced) and nothing else, so no model request. Computed
// geometry: the field is a 44px target with >=14px text inside the rail, dark and light, 1420 and 800 px.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { chatConfig } from './sx-screen-fixtures.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';
import { filterTasksByTitle } from '../webview-ui/src/taskTitleFilter.ts';

// Pure controls first (no browser): positive and negative.
const sample = [{ title: '고양이 페이지' }, { title: '강아지 그림'.normalize('NFD') }, { title: 'Cat Notes' }];
assert.deepEqual(filterTasksByTitle(sample, '강아지').map(t => t.title), [sample[1].title], 'NFD title matches an NFC query');
assert.deepEqual(filterTasksByTitle(sample, 'cAT').map(t => t.title), ['Cat Notes'], 'case is folded');
assert.equal(filterTasksByTitle(sample, '  ').length, 3, 'a blank query shows every task');
assert.equal(filterTasksByTitle(sample, '토끼').length, 0, 'a non-matching query shows none (negative control)');
assert.equal(filterTasksByTitle(sample, '페이지 그림').length, 0, 'the query is one substring, not a word search');

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN task rail search App: no Chromium'); process.exit(0); }
const dir = fileURLToPath(new URL('../webview-ui/', import.meta.url));
const app = await build({ entryPoints: [dir + 'src/main.tsx'], bundle: true, platform: 'browser', format: 'iife', outdir: 'rail-search-assets', write: false, loader: { '.svg': 'dataurl' }, logLevel: 'silent' });
const css = app.outputFiles.find(f => f.path.endsWith('.css')).text, script = app.outputFiles.find(f => f.path.endsWith('.js')).text;
const b = await launch(bin), evidence = process.env.RAIL_SEARCH_EVIDENCE;
if (evidence) mkdirSync(evidence, { recursive: true });
const settle = (ms = 60) => new Promise(r => setTimeout(r, ms));
const send = async (data) => { await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(data)}}))`); await settle(); };
const titles = () => b.evaluate(`[...document.querySelectorAll('.tw-task-list .tw-task-title')].map(e=>e.textContent)`);
const field = `document.querySelector('.tw-search input')`;
const emptyNote = () => b.evaluate(`document.querySelector('.tw-empty-search')?.textContent ?? null`);
// Plain (non-IME) typing and clearing: the browser's own edit commands, so React sees real input events.
const focusField = () => b.evaluate(`(${field}).focus()`);
const typeCommitted = async (text) => { await focusField(); await b.send('Input.insertText', { text }); await settle(); };
const clearField = async () => { await focusField(); await b.evaluate(`(${field}).select()`); await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }); await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }); await settle(); };
// The message-text search (CGP-CHAT-R-026) asks after a 150 ms pause; wait past it before counting posts.
const pause = () => settle(300);
const compose = async (text) => { await focusField(); await b.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length }); await settle(); };

const taskA = [
  { id: 'a1', title: '고양이 페이지', createdAt: 1, updatedAt: 4, messageCount: 4 },
  { id: 'a2', title: '강아지 그림'.normalize('NFD'), createdAt: 1, updatedAt: 3, messageCount: 2 },
  { id: 'a3', title: 'Cat Notes', createdAt: 1, updatedAt: 2, messageCount: 0 },
  { id: 'a4', title: '날씨 앱', createdAt: 1, updatedAt: 1, messageCount: 1 },
];
const allA = taskA.map(t => t.title);
const workspaceA = { scope: 'activity-a', revision: 1, activeTaskId: 'a1', tasks: taskA, sourceSelection: null };
const workspaceB = { scope: 'activity-b', revision: 1, activeTaskId: 'b1', tasks: [{ id: 'b1', title: '고양이 퀴즈', createdAt: 1, updatedAt: 2, messageCount: 0 }, { id: 'b2', title: '우주 이야기', createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null };
const configFor = (workspace, id) => chatConfig(3, { activity: { ...chatConfig().activity, id, kind: 'personal' }, profile: { ...chatConfig().profile, lesson: null }, taskWorkspace: workspace });
let states = 0;
try {
  for (const dark of [true, false]) for (const width of [1420, 800]) {
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await b.load(`<html style="${vars}"><style>${css}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}"><div id="root"></div><script>window.__posted=[];window.acquireVsCodeApi=()=>({postMessage:(m)=>window.__posted.push(m),getState:()=>undefined,setState:()=>{}});</script><script>${script}</script></body></html>`, { width, height: 900, dark });
    await send({ type: 'config', config: configFor(workspaceA, 'activity-a') });
    await send({ type: 'history', messages: [] });
    assert.deepEqual(await titles(), allA, 'the rail lists the activity\'s tasks');
    assert.equal(await emptyNote(), null, 'no "not found" line before a search');
    const posted = await b.evaluate(`window.__posted.length`);
    const postsSince = (from) => b.evaluate(`window.__posted.slice(${from})`);

    // Geometry of the field on the real markup.
    const g = await b.evaluate(`(()=>{const e=${field};const r=e.getBoundingClientRect();const rail=document.querySelector('.tw-rail').getBoundingClientRect();return {h:r.height,font:parseFloat(getComputedStyle(e).fontSize),label:parseFloat(getComputedStyle(e.closest('label').querySelector('span')).fontSize),inside:r.left>=rail.left-0.5&&r.right<=rail.right+0.5}})()`);
    assert.ok(g.h >= 44, `44px search target: ${JSON.stringify(g)}`); assert.ok(g.font >= 14 && g.label >= 14, `>=14px text: ${JSON.stringify(g)}`); assert.equal(g.inside, true, 'field stays inside the rail');

    // Korean IME: composing jamo and a half-built syllable never filters; the commit does.
    await compose('ㄱ');
    assert.deepEqual(await titles(), allA, 'an open composition (ㄱ) does not filter');
    await compose('고');
    assert.deepEqual(await titles(), allA, 'an open composition (고) does not filter');
    await compose('고양');
    assert.equal(await b.evaluate(`(${field}).value`), '고양', 'the field shows the composing text');
    assert.deepEqual(await titles(), allA, 'an open composition (고양) does not filter');
    await pause();
    assert.deepEqual(await postsSince(posted), [], 'nothing is posted to the host while an IME composition is open');
    await b.send('Input.insertText', { text: '고양' }); await settle();
    assert.deepEqual(await titles(), ['고양이 페이지'], 'after the IME commit only matching titles remain');
    await pause();
    const afterCommit = await postsSince(posted);
    assert.deepEqual(afterCommit.map(m => [m.type, m.query]), [['taskSearch', '고양']], `a committed query posts exactly one taskSearch: ${JSON.stringify(afterCommit)}`);
    if (evidence) { const shot = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/rail-search-${width}-${dark ? 'dark' : 'light'}.png`, Buffer.from(shot.data, 'base64')); }

    // Clearing restores the full list.
    await clearField();
    assert.equal(await b.evaluate(`(${field}).value`), '');
    assert.deepEqual(await titles(), allA, 'clearing restores the full list');

    // A title stored decomposed matches the composed syllables an IME commits.
    await compose('강아지'); await b.send('Input.insertText', { text: '강아지' }); await settle();
    assert.deepEqual(await titles(), [taskA[1].title], 'NFD title matches a committed NFC query');
    await pause(); await clearField();

    // Case folded; outer whitespace ignored; no match says so.
    await typeCommitted('cat');
    assert.deepEqual(await titles(), ['Cat Notes'], 'case-insensitive Latin match');
    await pause(); await clearField();
    const beforeBlank = await b.evaluate(`window.__posted.length`);
    await typeCommitted('   ');
    assert.deepEqual(await titles(), allA, 'a blank query shows every task');
    assert.equal(await emptyNote(), null);
    await pause();
    assert.deepEqual(await postsSince(beforeBlank), [], 'a blank query posts nothing to the host');
    await clearField();
    await typeCommitted('토끼');
    assert.deepEqual(await titles(), [], 'no title contains the text');
    assert.equal(await emptyNote(), '찾는 이름이 없습니다. 다른 이름으로 찾아보세요.');
    // Announced: the line lives inside a polite live region that was already mounted before it appeared.
    assert.equal(await b.evaluate(`document.querySelector('.tw-empty-search').parentElement.getAttribute('role') + '/' + document.querySelector('.tw-empty-search').parentElement.getAttribute('aria-live')`), 'status/polite', 'no-match line is in a polite live region');
    // The no-match line sits right under the field and heading, not pushed to the rail's foot.
    const near = await b.evaluate(`(()=>{const n=document.querySelector('.tw-empty-search').getBoundingClientRect();const f=${field}.getBoundingClientRect();return {gap:n.top-f.bottom,font:parseFloat(getComputedStyle(document.querySelector('.tw-empty-search')).fontSize)}})()`);
    assert.ok(near.gap >= 0 && near.gap <= 120, `no-match line next to the search field: ${JSON.stringify(near)}`); assert.ok(near.font >= 14, `no-match text >= 14px: ${near.font}`);
    if (evidence) { const shot = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/rail-search-empty-${width}-${dark ? 'dark' : 'light'}.png`, Buffer.from(shot.data, 'base64')); }

    // The title filter never leaves the webview: the only host messages are one taskSearch per committed,
    // non-blank query (CGP-CHAT-R-026), none for composing, clearing or the blank query.
    await pause();
    const sent = await postsSince(posted);
    assert.deepEqual(sent.map(m => [m.type, m.query]), [['taskSearch', '고양'], ['taskSearch', '강아지'], ['taskSearch', 'cat'], ['taskSearch', '토끼']], `only committed queries reach the host: ${JSON.stringify(sent)}`);

    // Another activity: only its own tasks, and the search starts empty (a stale query would hide them).
    await typeCommitted(''); await clearField(); await typeCommitted('고양');
    assert.deepEqual(await titles(), ['고양이 페이지']);
    await send({ type: 'config', config: configFor(workspaceB, 'activity-b') });
    assert.equal(await b.evaluate(`(${field}).value`), '', 'search resets with the activity');
    const shown = await titles();
    assert.deepEqual(shown, ['고양이 퀴즈', '우주 이야기'], 'the other activity\'s full list');
    for (const title of allA) assert.ok(!shown.includes(title), `activity A task never appears in B: ${title}`);
    await typeCommitted('고양');
    assert.deepEqual(await titles(), ['고양이 퀴즈'], 'search in B never surfaces A\'s 고양이 페이지');

    // An activity with no tasks and no query shows no "not found" line.
    await send({ type: 'config', config: configFor({ scope: 'activity-c', revision: 1, activeTaskId: null, tasks: [], sourceSelection: null }, 'activity-c') });
    assert.equal(await emptyNote(), null, 'an empty activity is not a failed search');
    states++;
  }
  assert.equal(states, 4, 'two themes x two widths');
  console.log(`task rail search App: ${states} states OK`);
} finally { await b.close(); }
