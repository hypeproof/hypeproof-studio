// REQ-STUDIO-MEMORY-MANAGER (CGP-KNOW-R-023 / REQ-KNOW-41) — the 기억 view of the 내 작품 drawer measured in the real App
// bundle in headless Chromium: dark/light, 1420/800/320 px, normal and forced colours. Each memory file shows its text,
// its time and the task it was kept from: a listed task is a 44px button that closes the drawer and asks the host to open
// that task; an archived, gone or unrecorded task is words, never a dead link. 모두 지우기… is a 44px button that asks the
// host once (its two native confirms live there) with exactly the listed file names; the answer's count is announced and
// focus stays in the drawer. Text is at least 14px at 4.5:1 and nothing scrolls sideways.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { chatConfig } from './sx-screen-fixtures.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';
const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER) throw Error('Chromium required'); console.log('NOT RUN memory manager: no Chromium'); process.exit(0); }
const dir = fileURLToPath(new URL('../webview-ui/', import.meta.url));
const app = await build({ entryPoints: [dir + 'src/main.tsx'], bundle: true, platform: 'browser', format: 'iife', outdir: 'memory-manager-assets', write: false, loader: { '.svg': 'dataurl' }, logLevel: 'silent' });
const css = app.outputFiles.find(f => f.path.endsWith('.css')).text, script = app.outputFiles.find(f => f.path.endsWith('.js')).text;
const longTitle = '아주 긴 작업 이름 '.repeat(8).trim();
const view = { scope: '["activity-a","t1"]', folder: '.hypeproof/memory/', other: 0, unsafe: false, overview: null, entries: [
  { name: 'a.md', at: Date.UTC(2026, 9, 29, 5), text: '발표는 금요일이에요.', source: { kind: 'task', id: 't2', title: longTitle } },
  { name: 'b.md', at: Date.UTC(2026, 9, 29, 4), text: '색은 초록', source: { kind: 'task', id: 't1', title: '내 웹페이지' } },
  { name: 'c.md', at: Date.UTC(2026, 9, 29, 3), text: '제목은 별빛', source: { kind: 'archived', title: '지난 숙제' } },
  { name: 'd.md', at: Date.UTC(2026, 9, 29, 2), text: '글꼴은 크게', source: { kind: 'gone' } },
  { name: 'e.md', at: Date.UTC(2026, 9, 29, 1), text: '<b>굵게</b>', source: { kind: 'none' } }] };
const luminance = rgb => rgb.slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
const color = value => value.match(/[\d.]+/g).map(Number);
const contrast = (a, b) => { const x = luminance(color(a)), y = luminance(color(b)); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
const tasks = [{ id: 't1', title: '내 웹페이지', createdAt: 1, updatedAt: Date.UTC(2026, 9, 29), messageCount: 2 }, { id: 't2', title: longTitle, createdAt: 2, updatedAt: Date.UTC(2026, 9, 28), messageCount: 2 }];
const workspace = { scope: 'activity-a', revision: 1, activeTaskId: 't1', tasks, sourceSelection: null };
const config = chatConfig(3, { activity: { ...chatConfig().activity, id: 'activity-a', kind: 'personal' }, profile: { ...chatConfig().profile, lesson: null }, taskWorkspace: workspace });
const evidence = process.env.MEMORY_MANAGER_EVIDENCE; if (evidence) mkdirSync(evidence, { recursive: true });
const b = await launch(bin);
const settle = (ms = 80) => new Promise(r => setTimeout(r, ms));
const send = async data => { await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(data)}}))`); await settle(); };
const posted = type => b.evaluate(`window.__posted.filter(m=>m.type===${JSON.stringify(type)})`);
const page = (dark, extra = '') => `<html${extra}><style>${css}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}"><div id="root"></div><script>window.__posted=[];window.acquireVsCodeApi=()=>({postMessage:(m)=>window.__posted.push(m),getState:()=>undefined,setState:()=>{}});</script><script>${script}</script></body></html>`;
const openMemory = async width => {
  if (width <= 700) { await b.evaluate(`document.querySelector('.tw-rail-toggle').click()`); await settle(150); }
  await b.evaluate(`document.querySelector('.tw-works-open').click()`); await settle(250);
  await b.evaluate(`[...document.querySelectorAll('.tw-works-filter button')][1].click()`); await settle();
  await send({ type: 'activityMemoryState', view }); await settle(120);
};
let runs = 0;
try {
  for (const [dark, width, forcedColors] of [[true, 1420, false], [false, 1420, false], [true, 800, false], [false, 800, false], [true, 320, false], [false, 320, false], [true, 800, true], [false, 1420, true]]) {
    const tag = `${width}-${dark ? 'dark' : 'light'}${forcedColors ? '-forced' : ''}`;
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await b.load(page(dark, ` style="${vars}"`), { width, height: 900, dark, forcedColors, appReady: true });
    await send({ type: 'config', config });
    await send({ type: 'history', messages: [] });
    await openMemory(width);
    const m = await b.evaluate(`(()=>{const d=document.querySelector('.tw-works-drawer');const bg=getComputedStyle(d).backgroundColor;
      const rect=e=>{const r=e.getBoundingClientRect();return {h:r.height,w:r.width,left:r.left,right:r.right}};
      const rows=[...d.querySelectorAll('ul[aria-label="AI 기억 파일"] > li')];
      return {bg,xss:!!d.querySelector('.tw-memory-text b'),
        rows:rows.map(li=>({text:li.querySelector('.tw-memory-text')?.textContent,time:li.querySelector('time')?.getAttribute('datetime'),
          source:li.querySelector('.tw-memory-source')?.textContent,link:[...li.querySelectorAll('.tw-memory-source button')].map(x=>({t:x.textContent,...rect(x),border:getComputedStyle(x).borderTopStyle,font:parseFloat(getComputedStyle(x).fontSize),fg:getComputedStyle(x).color}))})),
        sourceText:[...d.querySelectorAll('.tw-memory-source, .tw-memory-source span')].map(e=>({font:parseFloat(getComputedStyle(e).fontSize),fg:getComputedStyle(e).color,...rect(e)})),
        all:[...d.querySelectorAll('.tw-memory-actions button')].filter(x=>x.textContent==='모두 지우기…').map(x=>({...rect(x),border:getComputedStyle(x).borderTopStyle,font:parseFloat(getComputedStyle(x).fontSize),fg:getComputedStyle(x).color})),
        side:d.querySelector('.tw-works-body').scrollWidth>d.querySelector('.tw-works-body').clientWidth,page:document.scrollingElement.scrollWidth>innerWidth}})()`);
    assert.deepEqual(m.rows.map(r => r.text), view.entries.map(e => e.text), `item text as text (${tag})`);
    assert.equal(m.xss, false);
    assert.deepEqual(m.rows.map(r => r.time), view.entries.map(e => new Date(e.at).toISOString()), `each item has its time (${tag})`);
    assert.deepEqual(m.rows.map(r => r.link.map(l => l.t)), [[`‘${longTitle}’ 작업 열기`], ['‘내 웹페이지’ 작업 열기'], [], [], []], `only listed tasks link (${tag})`);
    assert.ok(m.rows.every(r => r.source?.startsWith('남긴 작업')), `every item names its source (${tag})`);
    assert.match(m.rows[2].source, /‘지난 숙제’ · 보관함에 있는 작업이에요/);
    assert.match(m.rows[3].source, /작업을 찾을 수 없어요/);
    assert.match(m.rows[4].source, /어느 작업에서 남겼는지 기록이 없어요/);
    const controls = [...m.rows.flatMap(r => r.link), ...m.all];
    assert.equal(m.all.length, 1, `one 모두 지우기 (${tag})`);
    for (const x of controls) {
      assert.ok(x.h >= 44 && x.w >= 44, `${x.t ?? '모두 지우기'} ${x.w}x${x.h} (${tag})`);
      assert.ok(x.left >= 0 && x.right <= width + .5, `inside the window (${tag})`);
      assert.notEqual(x.border, 'none', `bounded (${tag})`);
      assert.ok(x.font >= 14, `${x.font}px (${tag})`);
      if (!forcedColors) assert.ok(contrast(x.fg, m.bg) >= 4.5, `control contrast ${x.fg}/${m.bg} (${tag})`);
    }
    for (const x of m.sourceText) { assert.ok(x.font >= 14, `source ${x.font}px (${tag})`); assert.ok(x.right <= width + .5); if (!forcedColors) assert.ok(contrast(x.fg, m.bg) >= 4.5, `source contrast ${x.fg}/${m.bg} (${tag})`); }
    assert.ok(!m.side && !m.page, `no sideways scroll (${tag})`);
    const ring = await b.focusVisibleStyle('.tw-memory-source button', ['outline-width', 'outline-style']);
    assert.ok(parseFloat(ring['outline-width']) >= 1 && ring['outline-style'] !== 'none', `source link focus ring (${tag})`);
    if (evidence) { const shot = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/memory-manager-${tag}.png`, Buffer.from(shot.data, 'base64')); }
    // 모두 지우기…: one request per press while pending, naming exactly the listed files.
    await b.evaluate(`(()=>{const x=[...document.querySelectorAll('.tw-memory-actions button')].find(e=>e.textContent==='모두 지우기…');x.focus();x.click();x.click();})()`);
    const asked = await posted('activityMemoryAction');
    assert.equal(asked.length, 1, `one request per press (${tag})`);
    assert.deepEqual({ scope: asked[0].scope, action: asked[0].action, names: asked[0].names }, { scope: view.scope, action: 'deleteAll', names: view.entries.map(e => e.name) });
    // The host's confirm was cancelled: nothing changes and no line is shown.
    await send({ type: 'activityMemoryState', requestId: asked[0].requestId, result: { action: 'deleteAll', cancelled: true }, view });
    assert.equal(await b.evaluate(`document.querySelectorAll('ul[aria-label="AI 기억 파일"] > li').length`), 5, `cancel keeps the list (${tag})`);
    assert.equal(await b.evaluate(`document.querySelector('.tw-memory [role=status]').textContent`), '');
    await b.evaluate(`(()=>{const x=[...document.querySelectorAll('.tw-memory-actions button')].find(e=>e.textContent==='모두 지우기…');x.focus();x.click();})()`);
    const again = (await posted('activityMemoryAction')).at(-1);
    await send({ type: 'activityMemoryState', requestId: again.requestId, result: { action: 'deleteAll', removed: 4, kept: 1 }, view: { ...view, entries: view.entries.slice(0, 1) } });
    await settle(100);
    const after = await b.evaluate(`({rows:document.querySelectorAll('ul[aria-label="AI 기억 파일"] > li').length,status:document.querySelector('.tw-memory [role=status]').textContent,focus:document.activeElement?.textContent,inDrawer:!!document.activeElement?.closest('.tw-works-drawer')})`);
    assert.equal(after.rows, 1);
    assert.equal(after.status, '기억 파일 4개를 지웠어요. 1개는 남아 있어요. 목록에서 확인해 주세요.');
    assert.ok(after.inDrawer && after.focus === '모두 지우기…', `focus stays on the pressed button while files remain (${tag}): ${after.focus}`);
    // The last file goes too: no 모두 지우기 on an empty list, and focus moves to the 기억 filter, not the page.
    await b.evaluate(`[...document.querySelectorAll('.tw-memory-actions button')].find(e=>e.textContent==='모두 지우기…').click()`);
    const last = (await posted('activityMemoryAction')).at(-1);
    assert.deepEqual(last.names, ['a.md']);
    await send({ type: 'activityMemoryState', requestId: last.requestId, result: { action: 'deleteAll', removed: 1, kept: 0 }, view: { ...view, entries: [] } });
    await settle(100);
    const empty = await b.evaluate(`({all:[...document.querySelectorAll('.tw-memory-actions button')].some(e=>e.textContent==='모두 지우기…'),status:document.querySelector('.tw-memory [role=status]').textContent,focus:document.activeElement?.textContent,inDrawer:!!document.activeElement?.closest('.tw-works-drawer')})`);
    assert.equal(empty.all, false, `no 모두 지우기 without files (${tag})`);
    assert.equal(empty.status, '기억 파일 1개를 지웠어요.');
    assert.ok(empty.inDrawer && empty.focus === '기억', `focus lands on the 기억 filter (${tag}): ${empty.focus}`);
    // The source link: the drawer closes and the host is asked to open that task.
    await send({ type: 'activityMemoryState', view });
    await b.evaluate(`document.querySelector('.tw-memory-source button').click()`); await settle(250);
    assert.equal(await b.evaluate(`!!document.querySelector('.tw-works-drawer')`), false, `the drawer closes (${tag})`);
    assert.deepEqual((await posted('taskSelect')).map(x => x.id), ['t2'], `the source task opens (${tag})`);
    // The open task's own link only closes the drawer.
    await openMemory(width);
    const before = (await posted('taskSelect')).length;
    await b.evaluate(`document.querySelectorAll('.tw-memory-source button')[1].click()`); await settle(250);
    assert.equal(await b.evaluate(`!!document.querySelector('.tw-works-drawer')`), false);
    assert.equal((await posted('taskSelect')).length, before, `the open task is not re-selected (${tag})`);
    console.log(`PASS memory manager ${tag}`);
    runs++;
  }
  assert.equal(runs, 8);
  // A classroom seat has no task workspace: no drawer, no list and no 모두 지우기.
  await b.load(page(true), { width: 1420, height: 800, dark: true, appReady: true });
  await send({ type: 'config', config: chatConfig(3) }); await send({ type: 'history', messages: [] }); await settle(150);
  assert.equal(await b.evaluate(`!!document.querySelector('.hps-shell') && !document.querySelector('.tw-works-open') && !document.querySelector('[data-testid=activity-memory]')`), true, 'classroom seat: no memory view');
  console.log('PASS memory manager: classroom seat has none');
} finally { await b.close(); }
