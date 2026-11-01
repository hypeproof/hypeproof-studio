// REQ-STUDIO-MEMORY-USE (CGP-KNOW-R-026 / REQ-KNOW-44) — the "기억 사용 N" chip, the real App bundle in headless Chromium,
// measured on the real markup. Personal and classroom seats, dark and light, 800 and 1420 px, plus forced colours:
//   1. only the answer the host marked shows the chip, with the host's count; an answer without memory shows nothing,
//      and a classroom seat (the host never marks one) shows none;
//   2. the chip and every item button are 44px targets with 14px text and a solid focus ring, inside the chat column;
//   3. opening it asks the host for that answer's items and lists their exact words; a deleted item says so in words;
//      an answer for another request is ignored; 이 작업에서 빼기 posts {id, exclude} for that answer.
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
const X = '좋아하는 색은 초록이에요.', Y = '발표는 금요일 오후예요.';
const history = [
  { id: 'u1', role: 'user', content: '발표 준비를 도와줘', createdAt: 1 },
  { id: 'a1', role: 'assistant', content: '금요일 발표에 맞춰 준비해 볼게요.', createdAt: 2 },
  { id: 'u2', role: 'user', content: '고마워', createdAt: 3 },
  { id: 'a2', role: 'assistant', content: '천만에요.', createdAt: 4 },
];
const probe = `(()=>{
  const col=document.querySelector('.hps-messages').getBoundingClientRect();
  const box=e=>{const q=e.getBoundingClientRect();return {left:q.left,right:q.right,w:q.width,h:q.height}};
  const chips=[...document.querySelectorAll('.hps-memory-use-chip')].map(e=>({msg:e.closest('[data-message-id]')?.dataset.messageId,text:e.textContent,font:parseFloat(getComputedStyle(e).fontSize),expanded:e.getAttribute('aria-expanded'),border:getComputedStyle(e).borderTopStyle,...box(e)}));
  const buttons=[...document.querySelectorAll('.hps-memory-use-action')].map(e=>({text:e.textContent,font:parseFloat(getComputedStyle(e).fontSize),border:getComputedStyle(e).borderTopStyle,...box(e)}));
  const texts=[...document.querySelectorAll('.hps-memory-use-text,.hps-memory-use-note')].map(e=>({text:e.textContent,font:parseFloat(getComputedStyle(e).fontSize),...box(e)}));
  const items=[...document.querySelectorAll('.hps-memory-use-item')].map(box);
  return {col:{left:col.left,right:col.right},chips,buttons,texts,items};
})()`;
const focusRing = (selector) => b.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();const s=getComputedStyle(e);return {style:s.outlineStyle,width:parseFloat(s.outlineWidth),offset:parseFloat(s.outlineOffset),focused:document.activeElement===e}})()`);

let states = 0;
try {
  for (const seat of ['personal', 'classroom']) for (const dark of [true, false]) for (const width of [800, 1420]) for (const forcedColors of width === 800 && dark ? [false, true] : [false]) {
    const tag = `${seat}-${width}-${dark ? 'dark' : 'light'}${forcedColors ? '-forced' : ''}`;
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await b.load(`<html style="${vars}"><style>${css}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}"><div id="root"></div><script>window.posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m),getState:()=>undefined,setState:()=>{}});</script><script>${script}</script></body></html>`, { width, height: 720, dark, forcedColors });
    const workspace = { scope: 'mu-test', revision: 1, activeTaskId: 'task', tasks: [{ id: 'task', title: '발표', createdAt: 1, updatedAt: 1, messageCount: history.length }], sourceSelection: null };
    await send({ type: 'config', config: chatConfig(3, { activity: { ...chatConfig().activity, kind: seat }, profile: { ...chatConfig().profile, lesson: null }, taskWorkspace: seat === 'personal' ? workspace : undefined }) });
    await send({ type: 'history', messages: history });
    assert.equal(await b.evaluate(`!!document.querySelector('.hps-shell[data-chat-detail=personal]')`), seat === 'personal', `${tag}: seat branch`);
    let m = await b.evaluate(probe);
    assert.deepEqual(m.chips, [], `${tag}: no marks, no chip`);
    if (seat === 'classroom') { await shot(tag); states++; continue; }

    await send({ type: 'memoryUseMarks', marks: { a1: 2, bogus: 'x', a9: 0 } });
    m = await b.evaluate(probe);
    assert.equal(m.chips.length, 1, `${tag}: one chip, on the marked answer only`);
    const chip = m.chips[0];
    assert.equal(chip.msg, 'a1');
    assert.equal(chip.text, MEMORY_USE_COPY.chip(2));
    assert.equal(chip.expanded, 'false');
    assert.ok(chip.h >= 44 && chip.w >= 44, `${tag}: chip is a 44px target (${chip.w}x${chip.h})`);
    assert.ok(chip.font >= 14, `${tag}: chip text >= 14px`);
    assert.ok(chip.left >= m.col.left - 1 && chip.right <= m.col.right + 1, `${tag}: chip inside the chat column`);
    assert.equal(chip.border, 'solid', `${tag}: the chip keeps a border (forced colours included)`);
    const ring = await focusRing('.hps-memory-use-chip');
    assert.ok(ring.focused && ring.style === 'solid' && ring.width >= 2, `${tag}: solid focus ring (${JSON.stringify(ring)})`);

    await b.evaluate(`window.posted.length=0;document.querySelector('.hps-memory-use-chip').click()`);
    await settle();
    const asked = await b.evaluate(`window.posted.filter(p=>p.type==='memoryUseRequest')`);
    assert.equal(asked.length, 1, `${tag}: opening asks once`);
    assert.equal(asked[0].messageId, 'a1');
    assert.equal(asked[0].exclude, undefined, `${tag}: opening changes nothing`);
    assert.match(await b.evaluate(`document.querySelector('.hps-memory-use-panel').textContent`), new RegExp(MEMORY_USE_COPY.loading));
    // An answer to another request is ignored.
    await send({ type: 'memoryUseItems', requestId: 'stale', messageId: 'a1', items: [{ id: 'f'.repeat(32), state: 'same', text: '다른 요청', excluded: false }] });
    assert.ok(!(await b.evaluate(`document.body.textContent.includes('다른 요청')`)), `${tag}: stale answer ignored`);
    const items = [
      { id: 'a'.repeat(32), state: 'same', text: Y, excluded: false },
      { id: 'b'.repeat(32), state: 'gone', text: null, excluded: false },
    ];
    await send({ type: 'memoryUseItems', requestId: asked[0].requestId, messageId: 'a1', items });
    m = await b.evaluate(probe);
    assert.equal(m.chips[0].expanded, 'true');
    assert.deepEqual(m.texts.map(t => t.text), [MEMORY_USE_COPY.intro, Y, MEMORY_USE_COPY.gone], `${tag}: exact words; a deleted item says so`);
    for (const t of m.texts) { assert.ok(t.font >= 14, `${tag}: item text >= 14px`); assert.ok(t.right <= m.col.right + 1, `${tag}: item text inside the column`); }
    assert.deepEqual(m.buttons.map(x => x.text), [MEMORY_USE_COPY.exclude], `${tag}: a deleted item has nothing to exclude`);
    for (const item of m.items) assert.ok(item.left >= m.col.left - 1 && item.right <= m.col.right + 1, `${tag}: each numbered item, number included, inside the column`);
    for (const x of m.buttons) { assert.ok(x.h >= 44 && x.w >= 44, `${tag}: item button is a 44px target`); assert.ok(x.font >= 14); assert.equal(x.border, 'solid'); }
    const ring2 = await focusRing('.hps-memory-use-action');
    assert.ok(ring2.focused && ring2.style === 'solid' && ring2.width >= 2, `${tag}: item button focus ring`);
    await shot(tag);

    await b.evaluate(`window.posted.length=0;document.querySelector('.hps-memory-use-action').click()`);
    await settle();
    const excluded = await b.evaluate(`window.posted.filter(p=>p.type==='memoryUseRequest')`);
    assert.deepEqual(excluded.map(p => [p.messageId, p.id, p.exclude]), [['a1', 'a'.repeat(32), true]], `${tag}: 이 작업에서 빼기 posts the item for this answer`);
    await send({ type: 'memoryUseItems', requestId: excluded[0].requestId, messageId: 'a1', items: [{ ...items[0], excluded: true }, items[1]] });
    m = await b.evaluate(probe);
    assert.deepEqual(m.buttons.map(x => x.text), [MEMORY_USE_COPY.include], `${tag}: excluded item offers 다시 쓰기`);
    assert.ok(m.texts.some(t => t.text === MEMORY_USE_COPY.excluded), `${tag}: the exclusion is said in words`);
    await shot(`${tag}-excluded`);
    states++;
  }
  console.log(`PASS memory use chip: ${states} states (personal and classroom, dark and light, 800 and 1420 px, forced colours)`);
} finally { await b.close(); }
