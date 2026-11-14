// REQ-STUDIO-MEMORY-USE (CGP-KNOW-R-026 / REQ-KNOW-44) and CGP-KNOW-D-026 (DES-KNOW-44) — the "기억 사용 N" chip, the
// real App bundle in headless Chromium, measured on the real markup. Personal seat at 320, 800 and 1420 px, dark and
// light, plus forced colours; and a seat without the task shelf:
//   1. only the answer the host marked shows the chip, with the host's count, in that answer's action row: a 16px
//      bookmark glyph plus the words, a 44px target with 14px text, a border and a solid focus ring;
//   2. pressing it opens the 작업 자료 shelf on its 기억 tab (출처 / 기억, one tab stop, arrows switch), focus where the
//      shelf puts it for a citation (the heading; the sheet's first control at <=1050px); the shelf asks the host for that answer's items and lists their exact words; a deleted item says
//      so in words; an answer for another request is ignored; 이 작업에서 빼기 posts {id, exclude} for that answer;
//   3. Escape closes the shelf and focus returns to the chip; 자료 opens the shelf on 출처;
//   4. reduced motion: nothing on the chip, the tabs or the list moves (no running animation, transitions at most 1ms);
//   5. a seat without the shelf keeps the chip under the answer and opens the same list in place.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { chatConfig } from './sx-screen-fixtures.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const { MEMORY_USE_COPY } = await import('../src/memoryUseView.ts');
const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN memory use chip: no Chromium'); process.exit(0); }
const dir = fileURLToPath(new URL('../webview-ui/', import.meta.url));
const app = await build({ entryPoints: [dir + 'src/main.tsx'], bundle: true, platform: 'browser', format: 'iife', outdir: 'memory-use-assets', write: false, loader: { '.svg': 'dataurl' }, logLevel: 'silent' });
const css = app.outputFiles.find(f => f.path.endsWith('.css')).text, script = app.outputFiles.find(f => f.path.endsWith('.js')).text;
const evidence = process.env.MEMORY_USE_EVIDENCE;
if (evidence) mkdirSync(evidence, { recursive: true });
const b = await launch(bin);
const settle = (ms = 80) => new Promise(r => setTimeout(r, ms));
const send = async (data) => { await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(data)}}))`); await settle(); };
const shot = async (name) => { if (!evidence) return; const s = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/${name}.png`, Buffer.from(s.data, 'base64')); };
const key = async (k, modifiers = 0) => { for (const type of ['rawKeyDown', 'keyUp']) await b.send('Input.dispatchKeyEvent', { type, key: k, code: k, windowsVirtualKeyCode: { Escape: 27, ArrowRight: 39, ArrowLeft: 37 }[k], modifiers }); await settle(120); };
const X = '좋아하는 색은 초록이에요.', Y = '발표는 금요일 오후예요.';
const history = [
  { id: 'u1', role: 'user', content: '발표 준비를 도와줘', createdAt: 1 },
  { id: 'a1', role: 'assistant', content: '금요일 발표에 맞춰 준비해 볼게요.', createdAt: 2 },
  { id: 'u2', role: 'user', content: '고마워', createdAt: 3 },
  { id: 'a2', role: 'assistant', content: '천만에요.', createdAt: 4 },
];
const probe = `(()=>{
  const box=e=>{const q=e.getBoundingClientRect();return {left:q.left,right:q.right,top:q.top,bottom:q.bottom,w:q.width,h:q.height}};
  const col=document.querySelector('.hps-messages').getBoundingClientRect();
  const shelf=document.querySelector('#task-sources:not([hidden])');
  const scope=shelf ?? document;
  const chips=[...document.querySelectorAll('.hps-memory-use-chip')].map(e=>{const g=e.querySelector('svg');return {msg:e.closest('[data-message-id]')?.dataset.messageId,inRow:!!e.closest('.hps-answer-actions'),text:e.textContent,glyph:g?{kind:g.dataset.icon,w:g.getBoundingClientRect().width,h:g.getBoundingClientRect().height}:null,font:parseFloat(getComputedStyle(e).fontSize),expanded:e.getAttribute('aria-expanded'),controls:e.getAttribute('aria-controls'),border:getComputedStyle(e).borderTopStyle,...box(e)}});
  const tabs=shelf?[...shelf.querySelectorAll('[role=tab]')].map(e=>({text:e.textContent,selected:e.getAttribute('aria-selected'),tabIndex:e.tabIndex,font:parseFloat(getComputedStyle(e).fontSize),...box(e)})):[];
  const buttons=[...scope.querySelectorAll('.hps-memory-use-action')].map(e=>({text:e.textContent,font:parseFloat(getComputedStyle(e).fontSize),border:getComputedStyle(e).borderTopStyle,...box(e)}));
  const texts=[...scope.querySelectorAll('.hps-memory-use-text,.hps-memory-use-note')].filter(e=>e.offsetParent).map(e=>({text:e.textContent,font:parseFloat(getComputedStyle(e).fontSize),...box(e)}));
  const area=(shelf??document.querySelector('.hps-messages')).getBoundingClientRect();
  return {col:{left:col.left,right:col.right},area:{left:area.left,right:area.right},shelf:!!shelf,heading:shelf?.querySelector('#task-source-title')?.textContent??null,
    focus:document.activeElement?.id||document.activeElement?.className||document.activeElement?.localName,chips,tabs,buttons,texts,pageScroll:document.documentElement.scrollWidth-innerWidth};
})()`;
const focusRing = (selector) => b.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();const s=getComputedStyle(e);return {style:s.outlineStyle,width:parseFloat(s.outlineWidth),offset:parseFloat(s.outlineOffset),focused:document.activeElement===e}})()`);
const asks = () => b.evaluate(`window.posted.filter(p=>p.type==='memoryUseRequest')`);
const items = [
  { id: 'a'.repeat(32), state: 'same', text: Y, excluded: false },
  { id: 'b'.repeat(32), state: 'gone', text: null, excluded: false },
];
// Motion under prefers-reduced-motion: every running animation and every transition on the touched surfaces.
const motion = `(()=>{const secs=v=>v.split(',').map(x=>x.trim().endsWith('ms')?parseFloat(x)/1000:parseFloat(x));
  const els=[...document.querySelectorAll('.hps-memory-use-chip,.hps-memory-use-chip *,#task-sources,#task-sources *')];
  return {running:document.getAnimations().filter(a=>a.playState==='running').map(a=>a.effect?.target?.className??'?'),
    longest:Math.max(0,...els.flatMap(e=>{const s=getComputedStyle(e);return [...secs(s.transitionDuration),...secs(s.animationDuration)]}))};})()`;

let states = 0;
try {
  const layouts = [];
  for (const dark of [true, false]) for (const width of [320, 800, 1420]) layouts.push({ seat: 'personal', dark, width, forcedColors: false });
  layouts.push({ seat: 'personal', dark: true, width: 800, forcedColors: true }, { seat: 'classroom', dark: true, width: 800, forcedColors: false }, { seat: 'classroom', dark: false, width: 1420, forcedColors: false });
  for (const { seat, dark, width, forcedColors } of layouts) {
    const tag = `${seat}-${width}-${dark ? 'dark' : 'light'}${forcedColors ? '-forced' : ''}`;
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await b.load(`<html style="${vars}"><style>${css}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}"><div id="root"></div><script>window.posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m),getState:()=>undefined,setState:()=>{}});</script><script>${script}</script></body></html>`, { width, height: 720, dark, forcedColors, appReady: true });
    const workspace = { scope: 'mu-test', revision: 1, activeTaskId: 'task', tasks: [{ id: 'task', title: '발표', createdAt: 1, updatedAt: 1, messageCount: history.length }], sourceSelection: null };
    await send({ type: 'config', config: chatConfig(3, { activity: { ...chatConfig().activity, kind: seat }, profile: { ...chatConfig().profile, lesson: null }, taskWorkspace: seat === 'personal' ? workspace : undefined }) });
    await send({ type: 'history', messages: history });
    assert.equal(await b.evaluate(`!!document.querySelector('.hps-shell[data-chat-detail=personal]')`), seat === 'personal', `${tag}: seat branch`);
    let m = await b.evaluate(probe);
    assert.deepEqual(m.chips, [], `${tag}: no marks, no chip`);

    await send({ type: 'memoryUseMarks', marks: { a1: 2, bogus: 'x', a9: 0 } });
    m = await b.evaluate(probe);
    assert.equal(m.chips.length, 1, `${tag}: one chip, on the marked answer only`);
    const chip = m.chips[0];
    assert.equal(chip.msg, 'a1');
    assert.equal(chip.text, MEMORY_USE_COPY.chip(2));
    assert.deepEqual(chip.glyph && [chip.glyph.kind, chip.glyph.w, chip.glyph.h], ['bookmark', 16, 16], `${tag}: a 16px bookmark glyph (${JSON.stringify(chip.glyph)})`);
    assert.equal(chip.expanded, 'false');
    assert.ok(chip.h >= 44 && chip.w >= 44, `${tag}: chip is a 44px target (${chip.w}x${chip.h})`);
    assert.ok(chip.font >= 14, `${tag}: chip text >= 14px`);
    assert.ok(chip.left >= m.col.left - 1 && chip.right <= m.col.right + 1, `${tag}: chip inside the chat column`);
    assert.equal(chip.border, 'solid', `${tag}: the chip keeps a border (forced colours included)`);
    assert.ok(m.pageScroll <= 0, `${tag}: no page-wide sideways scroll (${m.pageScroll})`);
    const ring = await focusRing('.hps-memory-use-chip');
    assert.ok(ring.focused && ring.style === 'solid' && ring.width >= 2, `${tag}: solid focus ring (${JSON.stringify(ring)})`);

    if (seat === 'classroom') {
      // 5. No shelf on this seat: the chip stays under the answer and opens the list in place.
      assert.equal(chip.inRow, false, `${tag}: no action row here, the chip sits under the answer`);
      await b.evaluate(`window.posted.length=0;document.querySelector('.hps-memory-use-chip').click()`); await settle();
      const asked = await asks();
      assert.equal(asked.length, 1, `${tag}: opening asks once`);
      await send({ type: 'memoryUseItems', requestId: asked[0].requestId, messageId: 'a1', items });
      m = await b.evaluate(probe);
      assert.equal(m.chips[0].expanded, 'true');
      assert.deepEqual(m.texts.map(t => t.text), [MEMORY_USE_COPY.intro, Y, MEMORY_USE_COPY.gone], `${tag}: the same list, in place`);
      assert.deepEqual(m.buttons.map(x => x.text), [MEMORY_USE_COPY.exclude]);
      for (const x of m.buttons) assert.ok(x.h >= 44 && x.w >= 44 && x.font >= 14, `${tag}: item button`);
      await shot(tag); states++; continue;
    }

    // 1. In the answer's action row.
    assert.equal(chip.inRow, true, `${tag}: the chip is in the answer's action row`);
    assert.equal(chip.controls, 'task-sources', `${tag}: it controls the shelf`);
    // 4. Reduced motion, before and after the shelf opens.
    await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: forcedColors ? 'active' : 'none' }, { name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });

    // 2. The chip opens the shelf on 기억.
    await b.evaluate(`window.posted.length=0;document.querySelector('.hps-memory-use-chip').focus();document.querySelector('.hps-memory-use-chip').click()`);
    await settle(150);
    const asked = await asks();
    assert.equal(asked.length, 1, `${tag}: opening asks once`);
    assert.equal(asked[0].messageId, 'a1');
    assert.equal(asked[0].exclude, undefined, `${tag}: opening changes nothing`);
    m = await b.evaluate(probe);
    assert.ok(m.shelf, `${tag}: the shelf is open`);
    assert.deepEqual(m.tabs.map(t => [t.text, t.selected, t.tabIndex]), [[MEMORY_USE_COPY.tabSources, 'false', -1], [MEMORY_USE_COPY.tabMemory, 'true', 0]], `${tag}: on the 기억 tab, one tab stop`);
    for (const t of m.tabs) assert.ok(t.h >= 44 && t.w >= 44 && t.font >= 14, `${tag}: tab ${JSON.stringify(t)}`);
    assert.equal(m.heading, `${MEMORY_USE_COPY.listLabel} 2개`);
    // The shelf's own rule, as for a citation: the side panel focuses the heading; the modal sheet (<=1050px) its first control.
    assert.equal(m.focus, width <= 1050 ? 'tw-quiet tw-source-close' : 'task-source-title', `${tag}: focus where the shelf puts it`);
    assert.equal(m.chips[0].expanded, 'true', `${tag}: the chip says its shelf is open`);
    assert.match(m.texts.map(t => t.text).join('|'), new RegExp(MEMORY_USE_COPY.loading));
    // An answer to another request is ignored.
    await send({ type: 'memoryUseItems', requestId: 'stale', messageId: 'a1', items: [{ id: 'f'.repeat(32), state: 'same', text: '다른 요청', excluded: false }] });
    assert.ok(!(await b.evaluate(`document.body.textContent.includes('다른 요청')`)), `${tag}: stale answer ignored`);
    await send({ type: 'memoryUseItems', requestId: asked[0].requestId, messageId: 'a1', items });
    m = await b.evaluate(probe);
    assert.deepEqual(m.texts.map(t => t.text), [MEMORY_USE_COPY.intro, Y, MEMORY_USE_COPY.gone], `${tag}: exact words; a deleted item says so`);
    for (const t of m.texts) { assert.ok(t.font >= 14, `${tag}: item text >= 14px`); assert.ok(t.left >= m.area.left - 1 && t.right <= m.area.right + 1, `${tag}: item text inside the shelf`); }
    assert.deepEqual(m.buttons.map(x => x.text), [MEMORY_USE_COPY.exclude], `${tag}: a deleted item has nothing to exclude`);
    for (const x of m.buttons) { assert.ok(x.h >= 44 && x.w >= 44, `${tag}: item button is a 44px target`); assert.ok(x.font >= 14); assert.equal(x.border, 'solid'); assert.ok(x.left >= m.area.left - 1 && x.right <= m.area.right + 1, `${tag}: item button inside the shelf`); }
    assert.ok(m.pageScroll <= 0, `${tag}: no page-wide sideways scroll with the shelf open (${m.pageScroll})`);
    const still = await b.evaluate(motion);
    assert.deepEqual(still.running, [], `${tag}: reduced motion, nothing runs`);
    assert.ok(still.longest <= 0.001, `${tag}: reduced motion, transitions at most 1ms (${still.longest}s)`);
    await shot(tag);

    await b.evaluate(`window.posted.length=0;document.querySelector('#task-sources .hps-memory-use-action').click()`);
    await settle();
    const excluded = await asks();
    assert.deepEqual(excluded.map(p => [p.messageId, p.id, p.exclude]), [['a1', 'a'.repeat(32), true]], `${tag}: 이 작업에서 빼기 posts the item for this answer`);
    await send({ type: 'memoryUseItems', requestId: excluded[0].requestId, messageId: 'a1', items: [{ ...items[0], excluded: true }, items[1]] });
    m = await b.evaluate(probe);
    assert.deepEqual(m.buttons.map(x => x.text), [MEMORY_USE_COPY.include], `${tag}: excluded item offers 다시 쓰기`);
    assert.ok(m.texts.some(t => t.text === MEMORY_USE_COPY.excluded), `${tag}: the exclusion is said in words`);
    await shot(`${tag}-excluded`);

    // The tabs: arrows switch with focus; 출처 shows the sources panel and hides the memory list.
    await b.evaluate(`document.querySelector('#tw-shelf-tab-memory').focus()`);
    await key('ArrowLeft');
    m = await b.evaluate(probe);
    assert.deepEqual(m.tabs.map(t => t.selected), ['true', 'false'], `${tag}: ArrowLeft chooses 출처`);
    assert.equal(m.focus, 'tw-shelf-tab-sources');
    assert.equal(m.buttons.length, 0, `${tag}: the memory list is not on the 출처 tab`);
    await key('ArrowRight');
    m = await b.evaluate(probe);
    assert.deepEqual(m.tabs.map(t => t.selected), ['false', 'true'], `${tag}: ArrowRight back to 기억`);

    // 3. Escape closes the shelf and focus returns to the chip.
    await key('Escape'); await settle(100);
    m = await b.evaluate(probe);
    assert.equal(m.shelf, false, `${tag}: Escape closes the shelf`);
    assert.equal(m.focus, 'hps-memory-use-chip', `${tag}: focus returns to the chip`);
    assert.equal(m.chips[0].expanded, 'false');
    // 자료 opens the shelf on 출처, even after the chip chose 기억.
    await b.evaluate(`document.querySelector('.tw-sources-toggle').click()`); await settle(150);
    m = await b.evaluate(probe);
    assert.ok(m.shelf, `${tag}: 자료 opens the shelf`);
    assert.deepEqual(m.tabs.map(t => t.selected), ['true', 'false'], `${tag}: 자료 opens on 출처`);
    assert.equal(m.chips[0].expanded, 'false', `${tag}: the chip is not expanded while the shelf shows 출처`);
    states++;
  }
  console.log(`PASS memory use chip: ${states} states (personal at 320/800/1420 dark and light, forced colours, reduced motion; a seat without the shelf)`);
} finally { await b.close(); }
