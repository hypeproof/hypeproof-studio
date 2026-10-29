// CGP-KNOW-D-030 (DES-KNOW-48) on REQ-STUDIO-ACTIVITY-MEMORY-FILES, -STATE and -OVERVIEW (CGP-KNOW-R-030/022/025) —
// the activity's memory is the 기억 filter of the "내 작품" drawer, measured in the real App bundle in headless Chromium:
// dark/light, 1420/800/320 px, normal and forced colours. The drawer offers 파일/기억 (aria-pressed); 기억
// asks the host for the list, hides the 목록/격자 switch and lays out as a list; the "AI 기억: 켜짐" state line
// leads the view with nothing to expand, 작업별 기억 follows when the host sends it; the 작업 자료 panel no longer
// carries a second copy (no state line, overview or files there). Each file shows its full path in a monospace face at the 14px learner
// floor (the design's 11px loses to it), its time and its text as text (never markup). Every control is
// a 44px target with a focus ring, text is at least 14px at 4.5:1, nothing scrolls sideways, and 열기 /
// 지우기 ask the host with the listed scope and the exact file name (one request per press). After a
// confirmed delete focus stays in the drawer. A classroom seat has no drawer and no memory view.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { chatConfig } from './sx-screen-fixtures.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';
const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER) throw Error('Chromium required'); console.log('NOT RUN activity memory drawer: no Chromium'); process.exit(0); }
const dir = fileURLToPath(new URL('../webview-ui/', import.meta.url));
const app = await build({ entryPoints: [dir + 'src/main.tsx'], bundle: true, platform: 'browser', format: 'iife', outdir: 'memory-assets', write: false, loader: { '.svg': 'dataurl' }, logLevel: 'silent' });
const css = app.outputFiles.find(f => f.path.endsWith('.css')).text, script = app.outputFiles.find(f => f.path.endsWith('.js')).text;
const long = '가'.repeat(60);
const view = { scope: '["activity-a","t1"]', folder: '.hypeproof/memory/', entries: [
  { name: '2026-10-29T01-00-00-000Z-0a1b2c3d.md', at: Date.UTC(2026, 9, 29, 1), text: `좋아하는 색은 초록이에요.\n두 번째 줄 ${long}` },
  { name: '_img src_x onerror_alert_1__.md', at: Date.UTC(2026, 9, 28), text: '<b>굵게</b> <img src=x onerror="window.__xss=1">' },
  { name: 'big.md', at: Date.UTC(2026, 9, 27), text: null }], other: 2, unsafe: false };
const luminance = rgb => rgb.slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
const color = value => value.match(/[\d.]+/g).map(Number);
const contrast = (a, b) => { const x = luminance(color(a)), y = luminance(color(b)); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
const workspace = { scope: 'activity-a', revision: 1, activeTaskId: 't1', tasks: [{ id: 't1', title: '내 웹페이지', createdAt: 1, updatedAt: Date.UTC(2026, 9, 29), messageCount: 2 }], sourceSelection: null };
const config = chatConfig(3, { activity: { ...chatConfig().activity, id: 'activity-a', kind: 'personal' }, profile: { ...chatConfig().profile, lesson: null }, taskWorkspace: workspace });
const evidence = process.env.ACTIVITY_MEMORY_EVIDENCE; if (evidence) mkdirSync(evidence, { recursive: true });
const b = await launch(bin);
const settle = (ms = 80) => new Promise(r => setTimeout(r, ms));
const send = async data => { await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(data)}}))`); await settle(); };
const posted = type => b.evaluate(`window.__posted.filter(m=>m.type===${JSON.stringify(type)})`);
const page = (dark, extra = '') => `<html${extra}><style>${css}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}"><div id="root"></div><script>window.__posted=[];window.acquireVsCodeApi=()=>({postMessage:(m)=>window.__posted.push(m),getState:()=>undefined,setState:()=>{}});</script><script>${script}</script></body></html>`;
let runs = 0;
try {
  for (const [dark, width, forcedColors] of [[true, 1420, false], [false, 1420, false], [true, 800, false], [false, 800, false], [true, 320, false], [false, 320, false], [true, 800, true], [false, 1420, true]]) {
    const tag = `${width}-${dark ? 'dark' : 'light'}${forcedColors ? '-forced' : ''}`;
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await b.load(page(dark, ` style="${vars}"`), { width, height: 800, dark, forcedColors });
    await send({ type: 'config', config });
    await send({ type: 'history', messages: [] });
    if (width <= 700) { await b.evaluate(`document.querySelector('.tw-rail-toggle').click()`); await settle(150); }
    // The 작업 자료 panel carries no second copy of the memory files.
    if (width > 700) {
      await b.evaluate(`document.querySelector('.tw-sources-toggle')?.click()`); await settle(150);
      assert.equal(await b.evaluate(`!!document.querySelector('.tw-sources')`), true, `작업 자료 opened (${tag})`);
      assert.equal(await b.evaluate(`!!document.querySelector('.tw-sources :is([data-testid=activity-memory],[data-testid=activity-memory-state],[data-testid=memory-overview]), .tw-memory-entry')`), false, `no memory copy in 작업 자료 (${tag})`);
      await b.evaluate(`document.querySelector('.tw-sources-toggle')?.click()`); await settle(150);
    }
    await b.evaluate(`document.querySelector('.tw-works-open').click()`); await settle(250);
    assert.equal(await b.evaluate(`document.querySelector('.tw-works-drawer')?.open===true`), true, `drawer opens (${tag})`);
    // 파일 is the default filter; nothing asks for memory until 기억 is pressed.
    const filters = () => b.evaluate(`[...document.querySelectorAll('.tw-works-filter button')].map(x=>[x.textContent,x.getAttribute('aria-pressed')])`);
    assert.deepEqual(await filters(), [['파일', 'true'], ['기억', 'false']], `filter group (${tag})`);
    // Forced colours: a pressed filter reads as CanvasText on Canvas (a Highlight fill gets a Canvas text backplate and the text vanishes).
    const pressedColours = async label => { if (!forcedColors) return; const c = await b.evaluate(`(()=>{const e=[...document.querySelectorAll('.tw-works-filter button')].find(x=>x.textContent===${JSON.stringify(label)}),p=document.createElement('span');p.style.color='CanvasText';p.style.backgroundColor='Canvas';document.body.append(p);const s=getComputedStyle(e),x=getComputedStyle(p);const r={fg:s.color,bg:s.backgroundColor,canvasText:x.color,canvas:x.backgroundColor};p.remove();return r})()`);
      assert.equal(c.fg, c.canvasText, `pressed ${label} text is CanvasText (${tag}) ${JSON.stringify(c)}`); assert.equal(c.bg, c.canvas, `pressed ${label} sits on Canvas (${tag}) ${JSON.stringify(c)}`);
      assert.ok(contrast(c.fg, c.bg) >= 4.5, `pressed ${label} stays readable (${tag}) ${JSON.stringify(c)}`); };
    await pressedColours('파일');
    assert.equal((await posted('activityMemoryRequest')).length, 0, `no memory request before 기억 (${tag})`);
    // A grid chosen under 파일 does not carry over: 기억 is always a list.
    if (width > 360) { await b.evaluate(`[...document.querySelectorAll('.tw-works-views:not(.tw-works-filter) button')][1].click()`); await settle(); }
    await b.evaluate(`[...document.querySelectorAll('.tw-works-filter button')][1].click()`); await settle();
    assert.deepEqual(await filters(), [['파일', 'false'], ['기억', 'true']], `기억 pressed (${tag})`);
    await pressedColours('기억');
    assert.equal((await posted('activityMemoryRequest')).length, 1, `기억 asks the host once (${tag})`);
    assert.match(await b.evaluate(`document.querySelector('.tw-works-body [role=status]')?.textContent ?? ''`), /불러오는 중/, `loading line (${tag})`);
    assert.equal(await b.evaluate(`document.querySelectorAll('.tw-works-views:not(.tw-works-filter) button').length`), 0, `no 목록/격자 under 기억 (${tag})`);
    assert.equal(await b.evaluate(`document.querySelector('.tw-works-body').getAttribute('aria-label')`), 'AI 기억 파일 목록');
    await send({ type: 'activityMemoryState', view });
    await settle(120);
    // The state line (CGP-KNOW-R-022) leads the 기억 view: first in the body, drawn, text and not a control.
    const state = await b.evaluate(`(()=>{const line=document.querySelector('.tw-works-drawer [data-testid=activity-memory-state]');if(!line)return null;const r=line.getBoundingClientRect();const body=document.querySelector('.tw-works-body').getBoundingClientRect();
      const hit=document.elementFromPoint(r.left+Math.min(r.width,40)/2,r.top+Math.min(r.height,20)/2);
      return {text:line.textContent,first:!!(line.compareDocumentPosition(document.querySelector('.tw-memory-list'))&Node.DOCUMENT_POSITION_FOLLOWING),top:r.top-body.top,hit:!!hit&&line.contains(hit),font:parseFloat(getComputedStyle(line).fontSize),controls:line.querySelectorAll('button,input,[role=switch],[aria-pressed]').length,expanders:document.querySelectorAll('.tw-works-drawer [aria-expanded]').length}})()`);
    assert.ok(state && state.text === 'AI 기억: 켜짐 · .hypeproof/memory/', `state line in the 기억 view (${tag}) ${JSON.stringify(state)}`);
    assert.ok(state.first && state.top < 80 && state.hit && state.font >= 14 && state.controls === 0 && state.expanders === 0, `state line leads, visible, nothing to expand (${tag}) ${JSON.stringify(state)}`);
    const m = await b.evaluate(`(()=>{const d=document.querySelector('.tw-works-drawer');const panel=d.querySelector('[data-testid=activity-memory]');const bg=getComputedStyle(d).backgroundColor;
      const rect=e=>{const r=e.getBoundingClientRect();return {h:r.height,w:r.width,left:r.left,right:r.right}};
      return {text:panel.textContent,layout:d.dataset.layout,xss:window.__xss===1||!!panel.querySelector('b,img'),bg,
       paths:[...panel.querySelectorAll('li .tw-memory-path')].map(e=>({t:e.textContent,font:parseFloat(getComputedStyle(e).fontSize),family:getComputedStyle(e).fontFamily,dir:e.getAttribute('dir')})),
       texts:[...panel.querySelectorAll('.tw-memory-text,.tw-memory-path,.tw-memory-note:not(:empty),time,button')].map(e=>({cls:e.className||e.localName,font:parseFloat(getComputedStyle(e).fontSize),fg:getComputedStyle(e).color})),
       buttons:[...d.querySelectorAll('button')].map(x=>({...rect(x),border:getComputedStyle(x).borderTopStyle,label:x.getAttribute('aria-label')||x.textContent})),
       items:[...panel.querySelectorAll('li')].map(e=>({...rect(e),border:getComputedStyle(e).borderTopStyle})),
       side:d.querySelector('.tw-works-body').scrollWidth>d.querySelector('.tw-works-body').clientWidth,page:document.scrollingElement.scrollWidth>innerWidth,
       listDisplay:getComputedStyle(panel.querySelector('ul')).display,multiline:getComputedStyle(panel.querySelector('.tw-memory-text')).whiteSpace}})()`);
    assert.ok(m.text.includes('.hypeproof/memory/') && m.text.includes('이 활동 밖의 기억은 읽지 않아요'), `folder named (${tag})`);
    assert.ok(m.text.includes('목록에 없는 파일 2개'), `unlisted files counted (${tag})`);
    assert.ok(m.text.includes('<b>굵게</b>') && !m.xss, `file text as text (${tag})`);
    assert.ok(m.text.includes('열기로 확인해 주세요'), `a large file is listed without its text (${tag})`);
    assert.equal(m.multiline, 'pre-wrap', `line breaks kept (${tag})`);
    assert.equal(m.layout, 'list'); assert.equal(m.listDisplay, 'flex', `memory is always a list (${tag})`);
    assert.deepEqual(m.paths.map(p => p.t), view.entries.map(e => `.hypeproof/memory/${e.name}`), `full path per file (${tag})`);
    for (const p of m.paths) {
      assert.ok(p.font >= 14, `path ${p.font}px is at the learner floor (${tag})`);
      assert.match(p.family, /mono|menlo|courier|consolas/i, `path is monospace: ${p.family} (${tag})`);
      assert.equal(p.dir, 'ltr');
    }
    for (const x of m.texts) { assert.ok(x.font >= 14, `${x.cls} ${x.font}px (${tag})`); if (!forcedColors) assert.ok(contrast(x.fg, m.bg) >= 4.5, `${x.cls} contrast ${x.fg}/${m.bg} (${tag})`); }
    assert.ok(m.buttons.filter(x => /^(열기|지우기):/.test(x.label)).length === view.entries.length * 2);
    for (const x of m.buttons) { assert.ok(x.h >= 44 && x.w >= 44, `${x.label} ${x.w}x${x.h} (${tag})`); assert.ok(x.left >= 0 && x.right <= width + .5, `${x.label} inside the window (${tag})`); }
    for (const x of m.buttons.filter(x => /^(열기|지우기):/.test(x.label))) assert.notEqual(x.border, 'none', `memory buttons are bounded (${tag})`);
    for (const x of m.items) { assert.notEqual(x.border, 'none', `each file is a bounded card (${tag})`); assert.ok(x.right <= width + .5); }
    assert.ok(!m.side && !m.page, `no sideways scroll (${tag})`);
    const ring = await b.focusVisibleStyle('.tw-memory-actions button', ['outline-width', 'outline-style']);
    assert.ok(parseFloat(ring['outline-width']) >= 1 && ring['outline-style'] !== 'none', `focus ring (${tag})`);
    if (evidence) { const shot = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/drawer-memory-${tag}.png`, Buffer.from(shot.data, 'base64')); }
    // 열기 asks with the listed scope and the exact name.
    await b.evaluate(`document.querySelector('[aria-label="열기: big.md"]').click()`);
    let asked = await posted('activityMemoryAction');
    assert.deepEqual({ scope: asked[0].scope, action: asked[0].action, name: asked[0].name }, { scope: view.scope, action: 'open', name: 'big.md' });
    await send({ type: 'activityMemoryState', requestId: asked[0].requestId, result: { action: 'open', name: 'big.md' }, view });
    // 지우기: one request per press while pending.
    await b.evaluate(`(()=>{const x=document.querySelector('[aria-label="지우기: big.md"]');x.focus();x.click();x.click();})()`);
    asked = await posted('activityMemoryAction');
    assert.equal(asked.length, 2, `one request per press while pending (${tag})`);
    assert.deepEqual({ scope: asked[1].scope, action: asked[1].action, name: asked[1].name }, { scope: view.scope, action: 'delete', name: 'big.md' });
    // A stale answer (another request id) changes nothing.
    await send({ type: 'activityMemoryState', requestId: 'memory-forged', result: { action: 'delete', name: 'big.md' }, view: { ...view, entries: [] } });
    assert.equal(await b.evaluate(`document.querySelectorAll('.tw-memory li').length`), 3, `a forged answer is ignored (${tag})`);
    await send({ type: 'activityMemoryState', requestId: asked[1].requestId, result: { action: 'delete', name: 'big.md' }, view: { ...view, entries: view.entries.slice(0, 2) } });
    await settle(100);
    const after = await b.evaluate(`({rows:document.querySelectorAll('.tw-memory li').length,status:document.querySelector('.tw-memory [role=status]').textContent,focus:document.activeElement?.textContent,inDrawer:!!document.activeElement?.closest('.tw-works-drawer')})`);
    assert.equal(after.rows, 2); assert.match(after.status, /big\.md.*지웠어요/);
    assert.ok(after.inDrawer && after.focus === '기억', `focus lands on the 기억 filter, not body (${tag}): ${after.focus}`);
    // Back to 파일: the file list and its view switch return.
    await b.evaluate(`[...document.querySelectorAll('.tw-works-filter button')][0].click()`); await settle();
    assert.equal(await b.evaluate(`document.querySelector('.tw-works-body').getAttribute('aria-label')`), '내 작품 목록', `파일 filter returns (${tag})`);
    assert.equal(await b.evaluate(`document.querySelectorAll('.tw-works-views:not(.tw-works-filter) button').length`), width <= 360 ? 0 : 2, `목록/격자 back under 파일 (${tag})`);
    if (width > 360) assert.equal(await b.evaluate(`document.querySelector('.tw-works-drawer').dataset.layout`), 'grid', `the 파일 grid choice is kept (${tag})`);
    // 작업별 기억 (CGP-KNOW-R-025) sits in the same view when the host sends it, above the files.
    await b.evaluate(`[...document.querySelectorAll('.tw-works-filter button')][1].click()`); await settle();
    await send({ type: 'activityMemoryState', view: { ...view, overview: { groups: [{ task: 't1', title: '내 웹페이지', items: [{ name: view.entries[0].name, at: view.entries[0].at, text: '좋아하는 색은 초록이에요.' }] }], withheld: 0 } } });
    const ov = await b.evaluate(`(()=>{const o=document.querySelector('.tw-works-drawer [data-testid=memory-overview]');const files=document.querySelector('.tw-works-drawer ul[aria-label="AI 기억 파일"]');return o&&{headings:[...o.querySelectorAll('h4,h5')].map(e=>e.textContent),above:!!(o.compareDocumentPosition(files)&Node.DOCUMENT_POSITION_FOLLOWING),fix:o.querySelectorAll('button').length}})()`);
    assert.deepEqual(ov, { headings: ['작업별 기억', '내 웹페이지'], above: true, fix: 1 }, `overview in the 기억 view (${tag})`);
    await b.evaluate(`[...document.querySelectorAll('.tw-works-filter button')][0].click()`); await settle();
    console.log(`PASS activity memory drawer ${tag}`);
    runs++;
  }
  assert.equal(runs, 8);
  // A host answer of null (no store for this seat or activity) says so instead of an empty list.
  await b.load(page(true), { width: 1420, height: 800, dark: true });
  await send({ type: 'config', config }); await send({ type: 'history', messages: [] });
  await b.evaluate(`document.querySelector('.tw-works-open').click()`); await settle(250);
  await b.evaluate(`[...document.querySelectorAll('.tw-works-filter button')][1].click()`); await settle();
  await send({ type: 'activityMemoryState', view: null });
  assert.match(await b.evaluate(`document.querySelector('.tw-works-body').textContent`), /기억 파일을 보여 줄 수 없어요/);
  console.log('PASS activity memory drawer: no store says so');
  // A classroom seat has no task workspace: no drawer and no memory view.
  await b.load(page(true), { width: 1420, height: 800, dark: true });
  await send({ type: 'config', config: chatConfig(3) }); await send({ type: 'history', messages: [] }); await settle(150);
  assert.equal(await b.evaluate(`!!document.querySelector('.hps-shell') && !document.querySelector('.tw-works-open') && !document.querySelector('[data-testid=activity-memory]')`), true, 'classroom seat: no memory view');
  assert.equal((await posted('activityMemoryRequest')).length, 0, 'classroom seat never asks for memory');
  console.log('PASS activity memory drawer: classroom seat has none');
} finally { await b.close(); }
