// CGP-KNOW-D-011 (DES-KNOW-20): "내 작품" as a drawer from the task rail, in the real App bundle in
// headless Chromium. Opens and closes with the keyboard, keeps focus inside, Escape returns focus to
// the opener (the rail toggle when the narrow rail closed under it); rows are at least 44px with 14px
// text; list by default, grid on request, list only at 360px and below; each item shows a thumbnail
// or a type glyph, the name, the provenance chip and the last recorded change; thumbnails are asked
// for only when their row is in view and only a host data: image is ever rendered (a URL answer is
// dropped). Dark and light, 1420/800/320, forced colours once.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { chatConfig } from './sx-screen-fixtures.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';
import { thumbnailSrc, worksGlyph, worksLayout, worksName } from '../webview-ui/src/myWorks.ts';

// Pure controls first.
assert.equal(worksLayout('grid', 361), 'grid');
assert.equal(worksLayout('grid', 360), 'list', 'list only at 360px and below');
assert.equal(worksLayout('list', 1420), 'list', 'list is the default and stays');
assert.deepEqual([worksGlyph('a.PNG'), worksGlyph('b/index.html'), worksGlyph('c.ts'), worksGlyph('notes.md')], ['image', 'globe', 'code', 'file']);
assert.deepEqual(worksName('a/b/c.png'), { name: 'c.png', folder: 'a/b' });
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
assert.equal(thumbnailSrc(PIXEL), PIXEL);
for (const bad of ['https://example.com/x.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,PGh0bWw+', `${PIXEL}"onerror="x`, 'file:///etc/hosts', null]) assert.equal(thumbnailSrc(bad), null, `refused src ${bad}`);

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER) throw Error('Chromium required'); console.log('NOT RUN my works drawer: no Chromium'); process.exit(0); }
const dir = fileURLToPath(new URL('../webview-ui/', import.meta.url));
const app = await build({ entryPoints: [dir + 'src/main.tsx'], bundle: true, platform: 'browser', format: 'iife', outdir: 'my-works-assets', write: false, loader: { '.svg': 'dataurl' }, logLevel: 'silent' });
const css = app.outputFiles.find(f => f.path.endsWith('.css')).text, script = app.outputFiles.find(f => f.path.endsWith('.js')).text;
const b = await launch(bin), evidence = process.env.MY_WORKS_EVIDENCE;
if (evidence) mkdirSync(evidence, { recursive: true });
const settle = (ms = 80) => new Promise(r => setTimeout(r, ms));
const send = async (data) => { await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(data)}}))`); await settle(); };
const shot = async (name) => { if (!evidence) return; const s = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/${name}.png`, Buffer.from(s.data, 'base64')); };
const key = async (k, code, vk, shift = false) => {
  const modifiers = shift ? 8 : 0;
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers, ...(k === 'Enter' ? { text: '\r' } : {}) });
  await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers }); await settle();
};
const posted = (type) => b.evaluate(`window.__posted.filter(m=>m.type===${JSON.stringify(type)})`);
const inDrawer = () => b.evaluate(`!!document.activeElement?.closest('.tw-works-drawer')`);

const NOW = Date.UTC(2026, 9, 27, 6, 30);
const entry = (path, kind, label, symbol, at) => ({ path, kind, label, symbol, history: [], ...(at ? { at } : {}) });
const entries = [
  entry('cat.png', 'ai_created', 'AI가 만듦', '✦', NOW),
  entry('remote.png', 'ai_changed', 'AI가 고침', '↻', NOW - 1000),
  entry('site/index.html', 'learner_uploaded', '내가 올림', '⇡', NOW - 2000),
  entry(`notes/${'아주긴이름'.repeat(12)}.md`, 'none', '기록 없음', '○'),
  ...Array.from({ length: 60 }, (_, i) => entry(`gallery/p${i}.png`, 'studio_created', 'Studio가 만듦', '▣', NOW - 10000 - i)),
];
const view = { entries, more: 3, unobserved: false, unconfirmed: false };
const workspace = { scope: 'activity-a', revision: 1, activeTaskId: 't1', tasks: [{ id: 't1', title: '내 웹페이지', createdAt: 1, updatedAt: NOW, messageCount: 2 }], sourceSelection: null };
const config = chatConfig(3, { activity: { ...chatConfig().activity, id: 'activity-a', kind: 'personal' }, profile: { ...chatConfig().profile, lesson: null }, taskWorkspace: workspace });

let runs = 0;
try {
  for (const [dark, width, forcedColors] of [[true, 1420, false], [false, 1420, false], [true, 800, false], [false, 800, false], [true, 320, false], [false, 320, false], [true, 800, true]]) {
    const tag = `${width}-${dark ? 'dark' : 'light'}${forcedColors ? '-forced' : ''}`;
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await b.load(`<html style="${vars}"><style>${css}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}"><div id="root"></div><script>window.__posted=[];window.acquireVsCodeApi=()=>({postMessage:(m)=>window.__posted.push(m),getState:()=>undefined,setState:()=>{}});</script><script>${script}</script></body></html>`, { width, height: 800, dark, forcedColors });
    await send({ type: 'config', config });
    await send({ type: 'history', messages: [] });
    const narrow = width <= 700;
    if (narrow) { await b.evaluate(`document.querySelector('.tw-rail-toggle').click()`); await settle(150); }

    // The opener lives in the rail and is a 44px target.
    const opener = await b.evaluate(`(()=>{const e=document.querySelector('.tw-works-open');const r=e.getBoundingClientRect();return {h:r.height,in:!!e.closest('.tw-rail'),text:e.textContent,font:parseFloat(getComputedStyle(e).fontSize)}})()`);
    assert.ok(opener.in && opener.text.includes('내 작품') && opener.h >= 44 && opener.font >= 14, `opener in the rail, 44px (${tag}) ${JSON.stringify(opener)}`);
    await shot(`rail-${tag}`);
    const before = (await posted('artifactProvenanceRequest')).length;
    await b.evaluate(`document.querySelector('.tw-works-open').focus()`);
    await key('Enter', 'Enter', 13);
    await settle(200);
    assert.equal(await b.evaluate(`document.querySelector('.tw-works-drawer')?.open===true`), true, `Enter opens the drawer (${tag})`);
    assert.equal(await b.evaluate(`document.querySelector('.tw-works-drawer').matches(':modal')`), true, `the drawer is modal (${tag})`);
    assert.equal(await inDrawer(), true, `focus moves into the drawer (${tag})`);
    assert.ok((await posted('artifactProvenanceRequest')).length > before, `opening asks for the list (${tag})`);
    assert.match(await b.evaluate(`document.querySelector('.tw-works-note[role=status]')?.textContent ?? ''`), /불러오는 중/, `loading line before the answer (${tag})`);

    await send({ type: 'artifactProvenance', view });
    await settle(250);
    // Lazy: only rows in or near view asked; non-images never asked.
    let asked = await posted('artifactThumbnailRequest');
    const paths = asked.map(m => m.path);
    assert.ok(paths.includes('cat.png') && paths.includes('remote.png'), `visible images asked (${tag})`);
    assert.ok(!paths.some(p => p.endsWith('.html') || p.endsWith('.md')), `no thumbnail request for a page or a note (${tag})`);
    assert.ok(!paths.includes('gallery/p59.png'), `the last row is not asked before it scrolls into view (${tag})`);
    assert.ok(paths.length < 60, `lazy: ${paths.length} of 62 images asked up front (${tag})`);
    const answer = (path, src) => send({ type: 'artifactThumbnail', requestId: asked.find(m => m.path === path).requestId, path, src });
    await answer('cat.png', PIXEL);
    await answer('remote.png', 'https://example.com/x.png');
    await send({ type: 'artifactThumbnail', requestId: 'thumb-forged', path: 'cat.png', src: 'https://example.com/y.png' });
    const imgs = await b.evaluate(`[...document.querySelectorAll('.tw-works-drawer img')].map(i=>({src:i.getAttribute('src'),loading:i.getAttribute('loading'),alt:i.getAttribute('alt')}))`);
    assert.equal(imgs.length, 1, `one thumbnail rendered, the URL answer dropped (${tag})`);
    assert.ok(imgs.every(i => i.src.startsWith('data:image/png;base64,') && i.loading === 'lazy' && i.alt === ''), `thumbnails are inline and lazy (${tag})`);
    const items = await b.evaluate(`[...document.querySelectorAll('.tw-works-item')].slice(0,4).map(li=>{const r=li.getBoundingClientRect();const name=li.querySelector('.tw-works-name');return {h:r.height,left:r.left,right:r.right,glyph:li.querySelector('.tw-works-thumb svg')?.dataset.icon??null,img:!!li.querySelector('img'),name:name.textContent,font:Math.min(...[...li.querySelectorAll('.tw-works-name,.tw-works-folder,time,.tw-provenance-chip strong,.tw-works-meta>span')].map(e=>parseFloat(getComputedStyle(e).fontSize))),chip:li.querySelector('.tw-provenance-chip strong')?.textContent,time:li.querySelector('time')?.textContent??li.querySelector('.tw-works-meta>span:last-child')?.textContent}})`);
    assert.deepEqual(items.map(i => [i.img, i.glyph]), [[true, null], [false, 'image'], [false, 'globe'], [false, 'file']], `thumbnail or type glyph (${tag})`);
    assert.deepEqual(items.map(i => i.chip), ['AI가 만듦', 'AI가 고침', '내가 올림', '기록 없음'], `provenance chips (${tag})`);
    assert.equal(items[2].name, 'index.html', `the name is the file name (${tag})`);
    assert.match(items[0].time, /^마지막 기록 /, `last change shown (${tag})`);
    assert.equal(items[3].time, '바뀐 때 기록 없음', `no recorded change says so (${tag})`);
    for (const i of items) { assert.ok(i.h >= 44, `row ≥44px (${tag}) ${i.h}`); assert.ok(i.font >= 14, `text ≥14px (${tag}) ${i.font}`); assert.ok(i.left >= 0 && i.right <= width + 0.5, `row inside the window (${tag})`); }
    const geometry = await b.evaluate(`(()=>{const d=document.querySelector('.tw-works-drawer');const r=d.getBoundingClientRect();const body=d.querySelector('.tw-works-body');return {w:r.width,left:r.left,h:r.height,side:body.scrollWidth>body.clientWidth,page:document.scrollingElement.scrollWidth>innerWidth,controls:[...d.querySelectorAll('button,input')].map(x=>{const q=x.getBoundingClientRect();return Math.min(q.width,q.height)})}})()`);
    assert.ok(geometry.left === 0 && geometry.w <= Math.min(360, width) + 0.5 && geometry.h >= 799, `drawer on the rail side, full height (${tag}) ${JSON.stringify(geometry)}`);
    assert.ok(!geometry.side && !geometry.page, `no sideways scroll (${tag})`);
    assert.ok(geometry.controls.every(x => x >= 44), `every drawer control ≥44px (${tag}) ${geometry.controls}`);

    // List default; grid on request; list only at 360px and below.
    const listDisplay = () => b.evaluate(`getComputedStyle(document.querySelector('.tw-works-list')).display`);
    assert.equal(await listDisplay(), 'flex', `list by default (${tag})`);
    const toggle = await b.evaluate(`[...document.querySelectorAll('.tw-works-views:not(.tw-works-filter) button')].map(x=>[x.textContent,x.getAttribute('aria-pressed')])`);
    if (width <= 360) assert.deepEqual(toggle, [], `no grid at ${width}px`);
    else {
      assert.deepEqual(toggle, [['목록', 'true'], ['격자', 'false']], `view toggle (${tag})`);
      await b.evaluate(`[...document.querySelectorAll('.tw-works-views:not(.tw-works-filter) button')][1].click()`); await settle();
      assert.equal(await listDisplay(), 'grid', `grid on request (${tag})`);
      const cards = await b.evaluate(`[...document.querySelectorAll('.tw-works-item')].slice(0,2).map(e=>{const r=e.getBoundingClientRect();return {h:r.height,w:r.width}})`);
      assert.ok(cards.every(c => c.h >= 44 && c.w >= 44), `grid cards ≥44px (${tag})`);
      await shot(`grid-${tag}`);
      await b.evaluate(`[...document.querySelectorAll('.tw-works-views:not(.tw-works-filter) button')][0].click()`); await settle();
    }

    // #3290: search the listed inventory without changing provenance or hiding its limits.
    const search = async text => { await b.evaluate(`(()=>{const x=document.querySelector('.tw-works-drawer input[type=search]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(x,${JSON.stringify(text)});x.dispatchEvent(new Event('input',{bubbles:true}));})()`); await settle(150); };
    const inventoryBefore = (await posted('artifactProvenanceRequest')).length;
    const modelBefore = (await posted('sendMessage')).length;
    await search('SITE/');
    assert.deepEqual(await b.evaluate(`[...document.querySelectorAll('.tw-works-name')].map(e=>e.textContent)`), ['index.html'], `folder/case search (${tag})`);
    assert.equal(await b.evaluate(`document.querySelector('.tw-provenance-chip strong').textContent`), '내가 올림', `provenance unchanged (${tag})`);
    if (width > 360) {
      await b.evaluate(`[...document.querySelectorAll('.tw-works-views:not(.tw-works-filter) button')][1].click()`); await settle();
      assert.equal(await listDisplay(), 'grid', `filtered grid (${tag})`);
      assert.equal(await b.evaluate(`document.querySelectorAll('.tw-works-item').length`), 1, 'grid preserves search result');
      await b.evaluate(`[...document.querySelectorAll('.tw-works-views:not(.tw-works-filter) button')][0].click()`); await settle();
    }
    assert.ok(await b.evaluate(`document.querySelector('.tw-works-body').textContent.includes('현재 목록에서 1개 / 64개')`), `result count (${tag})`);
    await search('no-matching-path');
    assert.equal(await b.evaluate(`document.querySelectorAll('.tw-works-item').length`), 0, `no matches (${tag})`);
    assert.ok(await b.evaluate(`document.querySelector('.tw-works-body').textContent.includes('일치하는 파일이 없어요')`));
    assert.ok(await b.evaluate(`document.querySelector('.tw-works-body').textContent.includes('파일 3개는 더 있어서')`), `omitted inventory remains disclosed (${tag})`);
    assert.ok(!(await posted('artifactThumbnailRequest')).some(m=>m.path==='gallery/p58.png'), 'offscreen control has not requested a thumbnail');
    await search('gallery/p58.png');
    assert.ok((await posted('artifactThumbnailRequest')).some(m=>m.path==='gallery/p58.png'), `filter reobserves newly visible thumbnail (${tag})`);
    await b.evaluate(`(()=>{const x=[...document.querySelectorAll('.tw-works-drawer button')].find(e=>e.textContent==='검색 지우기');x.focus();x.click();})()`); await settle();
    assert.equal(await b.evaluate(`document.querySelectorAll('.tw-works-item').length`), entries.length, `clear restores inventory (${tag})`);
    assert.equal(await b.evaluate(`document.activeElement===document.querySelector('.tw-works-drawer input[type=search]')`), true, `clear keeps keyboard focus (${tag})`);
    assert.equal((await posted('artifactProvenanceRequest')).length, inventoryBefore, 'search does not rescan inventory');
    assert.equal((await posted('sendMessage')).length, modelBefore, 'search sends no model request');

    // Scrolling the list asks for the rows that come into view.
    await b.evaluate(`(()=>{const s=document.querySelector('.tw-works-body');s.scrollTop=s.scrollHeight;})()`); await settle(250);
    asked = await posted('artifactThumbnailRequest');
    assert.ok(asked.some(m => m.path === 'gallery/p59.png'), `the last row asks once it is in view (${tag})`);
    assert.equal(new Set(asked.map(m => m.path)).size, asked.length, `each image asked once (${tag})`);
    await b.evaluate(`document.querySelector('.tw-works-body').scrollTop=0`); await settle();
    await shot(`list-${tag}`);

    // Focus stays inside: Tab and Shift+Tab around the drawer's controls.
    await b.evaluate(`document.querySelector('.tw-works-close').focus()`);
    for (let i = 0; i < 8; i++) { await key('Tab', 'Tab', 9, i % 3 === 2); assert.equal(await inDrawer(), true, `Tab ${i} stays in the drawer (${tag})`); }
    // The page behind is inert: it cannot take focus while the drawer is open.
    assert.equal(await b.evaluate(`(()=>{document.querySelector('.tw-new').focus();return !!document.activeElement.closest('.tw-works-drawer')})()`), true, `the page behind cannot take focus (${tag})`);

    // Escape closes; focus returns to the opener (the rail toggle when the narrow rail closed under it).
    await key('Escape', 'Escape', 27);
    await settle(400);
    assert.equal(await b.evaluate(`!!document.querySelector('.tw-works-drawer')`), false, `Escape closes (${tag})`);
    const back = await b.evaluate(`document.activeElement?.className ?? ''`);
    assert.match(back, narrow ? /tw-rail-toggle/ : /tw-works-open/, `focus returns to the opener (${tag}): ${back}`);
    if (tag === '1420-dark') {
      // A task switch while the drawer is open closes it (the list belongs to the task it was asked for).
      await b.evaluate(`document.querySelector('.tw-works-open').click()`); await settle(200);
      assert.equal(await b.evaluate(`document.querySelector('.tw-works-drawer')?.open===true`), true);
      await send({ type: 'artifactProvenance', view });
      await search('SITE/');
      const second = { ...workspace, revision: 2, activeTaskId: 't2', tasks: [...workspace.tasks, { id: 't2', title: '두 번째', createdAt: 2, updatedAt: NOW, messageCount: 0 }] };
      await send({ type: 'taskWorkspaceState', view: second }); await settle(300);
      assert.equal(await b.evaluate(`!!document.querySelector('.tw-works-drawer')`), false, 'a task switch closes the drawer');
      await b.evaluate(`document.querySelector('.tw-works-open').click()`); await settle(200);
      await send({ type: 'artifactProvenance', view });
      assert.equal(await b.evaluate(`document.querySelector('.tw-works-drawer input[type=search]').value`), '', 'next task starts with an empty file query');
      assert.equal(await b.evaluate(`document.querySelectorAll('.tw-works-item').length`), entries.length, 'previous task search does not hide new task files');
      await key('Escape', 'Escape', 27); await settle(400);
    }
    console.log(`PASS my works drawer ${tag}`);
    runs++;
  }
  assert.equal(runs, 7);
  // A classroom seat has no task workspace, so no rail and no drawer (the commands stay where they were).
  await b.load(`<html><style>${css}</style><body class="vscode-dark"><div id="root"></div><script>window.__posted=[];window.acquireVsCodeApi=()=>({postMessage:(m)=>window.__posted.push(m),getState:()=>undefined,setState:()=>{}});</script><script>${script}</script></body></html>`, { width: 1420, height: 800, dark: true });
  await send({ type: 'config', config: chatConfig(3) }); await send({ type: 'history', messages: [] }); await settle(150);
  assert.equal(await b.evaluate(`!!document.querySelector('.hps-shell') && !document.querySelector('.tw-works-open')`), true, 'classroom seat: no 내 작품 drawer');
  console.log('PASS my works drawer: classroom seat has none');
} finally { await b.close(); }
