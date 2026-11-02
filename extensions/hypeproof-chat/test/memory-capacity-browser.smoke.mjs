// REQ-STUDIO-MEMORY-CAPACITY (CGP-KNOW-R-024 / REQ-KNOW-42) — memory capacity in the 기억 view of the 내 작품 drawer,
// measured on the built CSS and the real panel markup in headless Chromium: dark and light, 320 and 800 px, normal and
// forced colours, at 50%, 90% and 100% of the limit:
//   1. "기억 N/M개" in words (14px), with a bar that only repeats them (aria-hidden, outlined); no notice below 90%;
//   2. from 90% a notice in words with 오래된 기억 정리 (a 44px target); at 100% it says new memories are not kept;
//   3. 오래된 기억 정리 lists the oldest items first with as many pre-checked as bring the store back to 80%; each row is
//      a 44px target; the learner can change the pick; Escape closes it and focus returns to the button; the confirm
//      button posts `deleteOld` with exactly the checked names; the host's answer closes it with a notice;
//   4. no purchase, upgrade or "get more" element anywhere in the view, in every state (DOM absence).
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const { MEMORY_CAPACITY_COPY, memoryCleanupCount } = await import('../src/activityMemoryView.ts');
const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER) throw Error('Chromium required'); console.log('NOT RUN memory capacity: no Chromium'); process.exit(0); }
const dir = fileURLToPath(new URL('../webview-ui/', import.meta.url));
const app = await build({ entryPoints: [dir + 'src/main.tsx'], bundle: true, platform: 'browser', format: 'esm', outdir: 'assets', write: false, loader: { '.svg': 'dataurl' }, logLevel: 'silent' });
const css = app.outputFiles.find(f => f.path.endsWith('.css')).text;
const fixture = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {MyWorksDrawer} from './src/MyWorksDrawer';createRoot(document.getElementById('root')).render(<MyWorksDrawer files={null} scopeKey="a/t" viewport={innerWidth} opener={()=>null} fallback={()=>null} onClose={()=>{}}/>);`, resolveDir: dir, loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty', '.svg': 'dataurl' }, logLevel: 'silent' });
const evidence = process.env.MEMORY_CAPACITY_EVIDENCE; if (evidence) mkdirSync(evidence, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LIMIT = 200;
// Newest first, as the host lists them; `m-0` is the oldest.
const viewOf = used => ({ scope: '["a","t"]', folder: '.hypeproof/memory/', other: 0, unsafe: false, overview: null, limit: LIMIT,
  entries: Array.from({ length: used }, (_, i) => ({ name: `m-${i}.md`, at: Date.UTC(2026, 9, 1) + i * 60_000, text: `메모 ${i}번: 발표 자료는 학급 신문 폴더에 있어요.` })).reverse() });
// Words and addresses of a purchase path, Korean and English (the fixture's own memory texts use none of them). Checked
// against the view's text (hidden text too) and every attribute value of every element (href, title, alt, aria-*,
// data-*, class), so an icon-only control, an image's alt or a link address cannot carry one past the check.
const UPSELL = /get more|더 받기|더 사기|더 많은|더 얻|늘리|늘려|용량|업그레이드|upgrade|구매|구입|결제|요금|플랜|\bplans?\b|\bbuy\b|purchase|\bpro\b|프로 버전|프리미엄|premium|\bplus\b|구독|유료|subscri|pricing|billing|checkout|\bstore\b|\bshop|unlock|storage|more (memory|space)/i;
const b = await launch(bin);
const key = async k => { for (const type of ['rawKeyDown', 'keyUp']) await b.send('Input.dispatchKeyEvent', { type, key: k, code: k, windowsVirtualKeyCode: { Escape: 27 }[k] }); await sleep(60); };
let states = 0;
try {
  for (const dark of [true, false]) for (const width of [320, 800]) for (const forcedColors of width === 800 && dark ? [false, true] : [false]) {
    const tag = `${width}-${dark ? 'dark' : 'light'}${forcedColors ? '-forced' : ''}`;
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await b.load(`<!doctype html><style>:root{${vars}}${css}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}" style="margin:0;background:var(--hp-bg-app-default);color:var(--hp-text-primary-default)"><div class="hps-shell" data-chat-detail="personal"><div class="tw-workspace" style="display:block"><aside class="tw-sources" style="width:360px;max-width:100%"><div id="root"></div></aside></div></div><script>window.__posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>window.__posted.push(m),getState(){},setState(){}});</script><script>${fixture.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body>`, { width, height: 2400, dark, forcedColors });
    await sleep(30);
    await b.evaluate(`[...document.querySelectorAll('.tw-works-filter button')].find(e=>e.textContent==='기억').click()`); await sleep(30);
    const show = async view => { await b.evaluate(`window.postMessage({type:'activityMemoryState',view:${JSON.stringify(view)}},'*')`); await sleep(60); };
    const measure = () => b.evaluate(`(()=>{const c=document.querySelector('[data-testid=memory-capacity]');if(!c)return null;const box=e=>{const r=e.getBoundingClientRect();return {w:r.width,h:r.height,left:r.left,right:r.right}};
      const view=document.querySelector('[data-testid=activity-memory]');const bar=c.querySelector('.tw-memory-capacity-bar');
      return {level:c.dataset.level,line:c.querySelector('.tw-memory-capacity-line').textContent,lineFont:parseFloat(getComputedStyle(c.querySelector('.tw-memory-capacity-line')).fontSize),
        bar:{hidden:bar.getAttribute('aria-hidden'),border:getComputedStyle(bar).borderTopStyle,fill:bar.firstElementChild.style.inlineSize},
        notice:c.querySelector('.tw-memory-capacity-notice .tw-memory-note')?.textContent??null,
        texts:[...c.querySelectorAll('p,h5,.tw-memory-text,time,button,label')].map(e=>({t:e.textContent.slice(0,20),font:parseFloat(getComputedStyle(e).fontSize)})),
        buttons:[...c.querySelectorAll('button')].map(e=>({t:e.textContent,...box(e),border:getComputedStyle(e).borderTopStyle})),
        rows:[...c.querySelectorAll('.tw-memory-cleanup-item')].map(e=>({...box(e),name:e.closest('li')?.textContent.slice(0,12),checked:e.querySelector('input').checked})),
        upsell:${UPSELL}.test(view.textContent)||[...view.querySelectorAll('*')].some(e=>[...e.attributes].some(x=>x.name!=='style'&&${UPSELL}.test(x.value))),
        // The view links nowhere: any address (a store page, a plan page, a mail link) is a way out of the folder's limit.
        links:[...view.querySelectorAll('a,area,[href],[role=link],form[action]')].map(e=>e.outerHTML.slice(0,80)),
        sources:document.querySelector('.tw-sources').getBoundingClientRect().right,scroll:document.documentElement.scrollWidth>innerWidth,focus:document.activeElement?.textContent?.slice(0,20)??null}})()`);
    const floors = (m, label) => {
      for (const x of m.texts) assert.ok(x.font >= 14, `${tag} ${label}: "${x.t}" ${x.font}px`);
      for (const x of m.buttons) { assert.ok(x.h >= 44 && x.w >= 44, `${tag} ${label}: button "${x.t}" ${x.w}x${x.h}`); assert.ok(x.right <= m.sources + 0.5, `${tag} ${label}: "${x.t}" inside the drawer`); assert.notEqual(x.border, 'none'); }
      for (const r of m.rows) { assert.ok(r.h >= 44, `${tag} ${label}: pick row ${r.h}px`); assert.ok(r.right <= m.sources + 0.5, `${tag} ${label}: pick row inside`); }
      assert.equal(m.scroll, false, `${tag} ${label}: no horizontal scroll`);
      assert.equal(m.upsell, false, `${tag} ${label}: no purchase, upgrade or get-more element`);
      assert.deepEqual(m.links, [], `${tag} ${label}: no link out of the view`);
    };

    // 50%: the words and the bar only.
    await show(viewOf(100));
    let m = await measure();
    assert.equal(m.level, 'ok'); assert.equal(m.line, MEMORY_CAPACITY_COPY.line(100, LIMIT)); assert.equal(m.line, '기억 100/200개');
    assert.deepEqual(m.bar, { hidden: 'true', border: 'solid', fill: '50%' }, `${tag}: the bar repeats the words and is outlined`);
    assert.equal(m.notice, null, `${tag}: no notice below 90%`); assert.deepEqual(m.buttons, [], `${tag}: no cleanup entry below 90%`);
    floors(m, '50%');

    // 90%: the notice and 오래된 기억 정리.
    await show(viewOf(180));
    m = await measure();
    assert.equal(m.level, 'near'); assert.equal(m.notice, MEMORY_CAPACITY_COPY.near(180, LIMIT));
    assert.deepEqual(m.buttons.map(x => x.t), [MEMORY_CAPACITY_COPY.cleanup]);
    floors(m, '90%');
    await b.evaluate(`[...document.querySelectorAll('[data-testid=memory-capacity] button')].find(e=>e.textContent==='오래된 기억 정리').click()`); await sleep(80);
    m = await measure();
    const need = memoryCleanupCount(180, LIMIT);
    assert.equal(need, 20);
    assert.equal(m.rows.length, 20, `${tag}: the oldest items to choose from`);
    assert.deepEqual(m.rows.slice(0, 2).map(r => r.name.slice(0, 6)), ['메모 0번:', '메모 1번:'].map(s => s.slice(0, 6)), `${tag}: oldest first`);
    assert.equal(m.rows.filter(r => r.checked).length, need, `${tag}: as many pre-checked as bring it back to 80%`);
    assert.equal(m.focus, MEMORY_CAPACITY_COPY.pickTitle, `${tag}: focus on the pick's heading`);
    floors(m, 'pick');
    if (evidence) { const shot = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/${tag}-pick.png`, Buffer.from(shot.data, 'base64')); }
    // Escape closes the pick and returns to the button; nothing is sent.
    await key('Escape');
    m = await measure();
    assert.equal(m.rows.length, 0, `${tag}: Escape closes the pick`); assert.equal(m.focus, MEMORY_CAPACITY_COPY.cleanup, `${tag}: focus back on 오래된 기억 정리`);
    // Open again, keep one (uncheck the second oldest), confirm: exactly the checked names are posted.
    await b.evaluate(`document.querySelector('[data-testid=memory-capacity] button').click()`); await sleep(80);
    await b.evaluate(`document.querySelectorAll('.tw-memory-cleanup-item input')[1].click()`); await sleep(40);
    const label = await b.evaluate(`document.querySelector('.tw-memory-cleanup button[type=submit]').textContent`);
    assert.equal(label, MEMORY_CAPACITY_COPY.confirm(need - 1));
    await b.evaluate(`(()=>{window.__posted.length=0;const x=document.querySelector('.tw-memory-cleanup button[type=submit]');x.click();x.click();})()`); await sleep(40);
    const sent = await b.evaluate(`window.__posted.filter(m=>m.type==='activityMemoryAction')`);
    assert.equal(sent.length, 1, `${tag}: one request per press while pending`);
    const expected = Array.from({ length: need }, (_, i) => `m-${i}.md`).filter(n => n !== 'm-1.md');
    assert.deepEqual([sent[0].action, [...sent[0].names].sort()], ['deleteOld', expected.sort()], `${tag}: deleteOld with exactly the checked names`);

    // 100%: the full notice; the host's answer closes the pick and says what went.
    await b.evaluate(`window.postMessage({type:'activityMemoryState',requestId:${JSON.stringify(sent[0].requestId)},result:{action:'deleteOld',removed:${need - 1},kept:0},view:${JSON.stringify(viewOf(200))}},'*')`); await sleep(80);
    m = await measure();
    assert.equal(m.rows.length, 0, `${tag}: the answer closes the pick`);
    assert.equal(m.level, 'full'); assert.equal(m.line, '기억 200/200개'); assert.equal(m.notice, MEMORY_CAPACITY_COPY.full(LIMIT, false)); assert.ok(m.notice.endsWith('있는 기억은 지울 수 있어요.'), `${tag}: without the overview, no correction is promised`);
    assert.equal(await b.evaluate(`document.querySelector('.tw-memory [role=status]').textContent`), `오래된 기억 ${need - 1}개를 지웠어요.`);
    assert.equal(m.bar.fill, '100%');
    floors(m, '100%');
    await b.evaluate(`document.querySelector('[data-testid=memory-capacity] button').click()`); await sleep(80);
    m = await measure();
    assert.equal(m.rows.filter(r => r.checked).length, memoryCleanupCount(200, LIMIT), `${tag}: at 100% the pick brings it back to 80%`);
    floors(m, 'pick at 100%');
    if (evidence) { const shot = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/${tag}-full.png`, Buffer.from(shot.data, 'base64')); }
    // A seat with the overview can correct an item at 100% (a correction replaces, it does not add): the notice says so.
    await show({ ...viewOf(200), overview: { groups: [], withheld: 0 } });
    m = await measure();
    assert.equal(m.notice, MEMORY_CAPACITY_COPY.full(LIMIT, true)); assert.ok(m.notice.endsWith('있는 기억은 고치거나 지울 수 있어요.'), `${tag}: with the overview, correction is offered`);
    console.log(`PASS memory capacity ${tag}`);
    states++;
  }
  console.log(`PASS memory capacity: ${states} layouts (dark/light, 320/800, forced colours; 50%, 90%, 100%)`);
} finally { await b.close(); }
