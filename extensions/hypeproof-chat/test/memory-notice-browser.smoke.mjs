// REQ-STUDIO-MEMORY-NOTICE (CGP-KNOW-R-031 / REQ-KNOW-49, CGP-KNOW-D-031 / DES-KNOW-49) — the one-time memory notice, the
// real App bundle in headless Chromium, measured on the real markup. Personal and classroom seats, dark and light, 800
// and 1420 px, plus forced colours:
//   1. the chat asks the host on load; nothing shows until the host says the notice is due, and a classroom seat (the
//      host never says so there) shows none; a stale answer for another activity is dropped;
//   2. four labelled lines (무엇을, 어디에, 누가 보는지, 지우는 법) and exactly one button, 확인: no switch, no second choice;
//   3. 14px text, a 44px 확인 with a solid focus ring, inside the chat column; the composer stays usable and focus is not
//      taken when it appears;
//   4. 확인 posts the ack for the activity it showed, once (a double press sends one); when the host answers, the notice
//      goes and focus lands in the composer.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { chatConfig } from './sx-screen-fixtures.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const { MEMORY_NOTICE_COPY } = await import('../src/memoryNotice.ts');
const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN memory notice: no Chromium'); process.exit(0); }
const dir = fileURLToPath(new URL('../webview-ui/', import.meta.url));
const app = await build({ entryPoints: [dir + 'src/main.tsx'], bundle: true, platform: 'browser', format: 'iife', outdir: 'memory-notice-assets', write: false, loader: { '.svg': 'dataurl' }, logLevel: 'silent' });
const css = app.outputFiles.find(f => f.path.endsWith('.css')).text, script = app.outputFiles.find(f => f.path.endsWith('.js')).text;
const evidence = process.env.MEMORY_NOTICE_EVIDENCE;
if (evidence) mkdirSync(evidence, { recursive: true });
const b = await launch(bin);
const settle = (ms = 80) => new Promise(r => setTimeout(r, ms));
const send = async (data) => { await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(data)}}))`); await settle(); };
const shot = async (name) => { if (!evidence) return; const s = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/${name}.png`, Buffer.from(s.data, 'base64')); };
const history = [
  { id: 'u1', role: 'user', content: '발표 준비를 도와줘', createdAt: 1 },
  { id: 'a1', role: 'assistant', content: '금요일 발표에 맞춰 준비해 볼게요.', createdAt: 2 },
];
const probe = `(()=>{
  const n=document.querySelector('.hps-memory-notice');
  if(!n) return null;
  const col=document.querySelector('.hps-shell').getBoundingClientRect();
  const box=e=>{const q=e.getBoundingClientRect();return {left:q.left,right:q.right,w:q.width,h:q.height}};
  const texts=[...n.querySelectorAll('.hps-memory-notice-title span,dt,dd')].map(e=>({text:e.textContent,font:parseFloat(getComputedStyle(e).fontSize),...box(e)}));
  const buttons=[...n.querySelectorAll('button,input,select,[role=switch],[role=checkbox]')].map(e=>({text:e.textContent,font:parseFloat(getComputedStyle(e).fontSize),border:getComputedStyle(e).borderTopStyle,...box(e)}));
  return {col:{left:col.left,right:col.right},box:box(n),texts,buttons,labels:[...n.querySelectorAll('dt')].map(e=>e.textContent),lines:[...n.querySelectorAll('dd')].map(e=>e.textContent),
    active:document.activeElement?.tagName,composer:!document.querySelector('textarea')?.disabled};
})()`;
const notices = () => b.evaluate(`window.posted.filter(p=>p.type==='memoryNoticeRequest'||p.type==='memoryNoticeAck')`);

let states = 0;
try {
  for (const seat of ['personal', 'classroom']) for (const dark of [true, false]) for (const width of [800, 1420]) for (const forcedColors of width === 800 && dark ? [false, true] : [false]) {
    const tag = `${seat}-${width}-${dark ? 'dark' : 'light'}${forcedColors ? '-forced' : ''}`;
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await b.load(`<html style="${vars}"><style>${css}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}"><div id="root"></div><script>window.posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m),getState:()=>undefined,setState:()=>{}});</script><script>${script}</script></body></html>`, { width, height: 720, dark, forcedColors });
    const workspace = { scope: 'mn-test', revision: 1, activeTaskId: 'task', tasks: [{ id: 'task', title: '발표', createdAt: 1, updatedAt: 1, messageCount: history.length }], sourceSelection: null };
    const config = chatConfig(3, { activity: { ...chatConfig().activity, kind: seat }, profile: { ...chatConfig().profile, lesson: null }, taskWorkspace: seat === 'personal' ? workspace : undefined });
    const activity = config.activity.id;
    await send({ type: 'config', config });
    await send({ type: 'history', messages: history });
    assert.equal(await b.evaluate(`!!document.querySelector('.hps-shell[data-chat-detail=personal]')`), seat === 'personal', `${tag}: seat branch`);
    assert.ok((await notices()).some(p => p.type === 'memoryNoticeRequest'), `${tag}: the chat asks the host`);
    assert.equal(await b.evaluate(probe), null, `${tag}: nothing until the host says it is due`);
    await send({ type: 'memoryNoticeState', notice: null, activityId: activity });
    assert.equal(await b.evaluate(probe), null, `${tag}: not due, nothing shown`);
    if (seat === 'classroom') { await shot(tag); states++; continue; }

    // A stale answer for another activity is dropped.
    await send({ type: 'memoryNoticeState', notice: { activity: 'other' }, activityId: 'other' });
    assert.equal(await b.evaluate(probe), null, `${tag}: a stale answer is dropped`);
    await b.evaluate(`document.querySelector('textarea').focus()`);
    await send({ type: 'memoryNoticeState', notice: { activity }, activityId: activity });
    const m = await b.evaluate(probe);
    assert.ok(m, `${tag}: shown when due`);
    assert.deepEqual(m.labels, ['무엇을', '어디에', '누가 보는지', '지우는 법'], `${tag}: the four lines`);
    assert.deepEqual(m.lines, MEMORY_NOTICE_COPY.lines.map(l => l.text));
    assert.deepEqual(m.buttons.map(x => x.text), ['확인'], `${tag}: exactly one button, 확인; no switch or second choice`);
    assert.equal(m.active, 'TEXTAREA', `${tag}: appearing does not take focus`);
    assert.ok(m.composer, `${tag}: the composer stays usable`);
    for (const x of m.texts) { assert.ok(x.font >= 14, `${tag}: "${x.text}" >= 14px (${x.font})`); assert.ok(x.left >= m.col.left - 1 && x.right <= m.col.right + 1, `${tag}: text inside the column`); }
    assert.ok(m.box.left >= m.col.left - 1 && m.box.right <= m.col.right + 1, `${tag}: notice inside the chat column`);
    const [ok] = m.buttons;
    assert.ok(ok.h >= 44 && ok.w >= 44, `${tag}: 확인 is a 44px target (${ok.w}x${ok.h})`);
    assert.ok(ok.font >= 14, `${tag}: 확인 text >= 14px`);
    assert.equal(ok.border, 'solid', `${tag}: 확인 keeps a border (forced colours included)`);
    const ring = await b.evaluate(`(()=>{const e=document.querySelector('.hps-memory-notice-confirm');e.focus();const s=getComputedStyle(e);return {style:s.outlineStyle,width:parseFloat(s.outlineWidth),focused:document.activeElement===e}})()`);
    assert.ok(ring.focused && ring.style === 'solid' && ring.width >= 2, `${tag}: solid focus ring (${JSON.stringify(ring)})`);
    await shot(tag);

    await b.evaluate(`(()=>{window.posted.length=0;const k=document.querySelector('.hps-memory-notice-confirm');k.click();k.click()})()`);
    await settle();
    const acks = (await notices()).filter(p => p.type === 'memoryNoticeAck');
    assert.deepEqual(acks.map(p => p.activity), [activity], `${tag}: one ack, for the activity it showed`);
    assert.ok(await b.evaluate(`!!document.querySelector('.hps-memory-notice')`), `${tag}: stays until the host confirms`);
    await send({ type: 'memoryNoticeState', notice: null, activityId: activity });
    assert.equal(await b.evaluate(probe), null, `${tag}: gone after 확인`);
    assert.equal(await b.evaluate(`document.activeElement?.tagName`), 'TEXTAREA', `${tag}: focus lands in the composer`);

    // A task switch clears a shown card at once (it belonged to the old scope) and the chat asks again for the new one.
    await send({ type: 'memoryNoticeState', notice: { activity }, activityId: activity });
    assert.ok(await b.evaluate(probe), `${tag}: shown again before the switch`);
    await b.evaluate(`window.posted.length=0`);
    const switched = { ...workspace, revision: 2, activeTaskId: 'task2', tasks: [...workspace.tasks, { id: 'task2', title: '두 번째', createdAt: 2, updatedAt: 2, messageCount: 0 }] };
    await send({ type: 'config', config: { ...config, taskWorkspace: switched } });
    assert.equal(await b.evaluate(probe), null, `${tag}: a task switch clears the card until the host answers for the new task`);
    assert.ok((await notices()).some(p => p.type === 'memoryNoticeRequest'), `${tag}: and asks again`);
    states++;
  }
  console.log(`PASS memory notice: ${states} states (personal and classroom, dark and light, 800 and 1420 px, forced colours)`);
} finally { await b.close(); }
