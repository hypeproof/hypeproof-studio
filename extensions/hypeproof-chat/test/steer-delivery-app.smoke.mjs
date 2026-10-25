// CGP-CHAT-D-012: the steered request's "보내는 중…" row in the real App, driven by host messages.
// Every seat (personal, classroom, instructor) and every way a turn can end: a matching start fades the row
// (140 ms exit), anything else removes it once the turn is over, and an unrelated late end keeps it.
// Ported from the round-3 verifier probe: it covers App's own wiring (sendPending, streamFor for the
// instructor panel), which the ChatPanel fixture in steer-delivery-computed.smoke.mjs cannot see.
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { findChromium, launch } from './lib/headless-chromium.mjs';
const extension = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = findChromium(); if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN steer delivery in App: no Chromium'); process.exit(0); }
const webview = path.join(extension, 'webview-ui'); const src = path.join(webview, 'src');
const temp = mkdtempSync(path.join(tmpdir(), 'hps-steer-probe-'));
await build({ entryPoints: [path.join(src, 'main.tsx')], bundle: true, platform: 'browser', jsx: 'automatic', outfile: path.join(temp, 'ui.js'), logLevel: 'error',
  nodePaths: [path.join(webview, 'node_modules')], alias: { react: path.join(webview, 'node_modules/react'), 'react-dom': path.join(webview, 'node_modules/react-dom') },
  loader: { '.svg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.png': 'dataurl' } });
const server = createServer((req, res) => { const u = req.url.split('?')[0];
  if (u === '/ui.js' || u === '/ui.css') { try { const body = readFileSync(path.join(temp, u)); res.setHeader('content-type', u.endsWith('js') ? 'text/javascript' : 'text/css'); res.end(body); } catch { res.statusCode = 404; res.end(); } return; }
  res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html lang="ko"><head><meta charset="utf-8"><link rel="stylesheet" href="/ui.css"></head><body><div id="root"></div><script src="/ui.js"></script></body></html>'); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const UX = { coach: { naming_mode: 'fixed', fallback_name: '코치', naming_prompt_md: '', personality_prompt_md: '' }, suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: '' }, roll_input_button: { enabled: false, label: '', probe_md: '' } }, retry_button: { enabled: false, show_counter: false } };
const config = (surface, activityId) => ({ proxyUrl: 'http://controlled.invalid/v1', model: 'sonnet', hasToken: true, coach: { name: '코치', personality: '', configured: true },
  ...(surface === 'instructor' ? { isInstructor: true } : {}),
  profile: { profile_id: 'synthetic', display_name: '확인', activity_kind: surface === 'personal' ? 'personal' : 'classroom', observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: '안녕하세요' }, model_selection: null, ux: UX },
  activity: { id: activityId ?? 'a-' + surface, name: '작업', kind: surface === 'personal' ? 'personal' : 'classroom', workspace: '/synthetic', verified: true },
  ...(surface === 'personal' ? { taskWorkspace: { scope: 's', revision: 1, activeTaskId: 't1', tasks: [{ id: 't1', title: '페이지', createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null } } : {}) });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const QUEUED = '다른 색으로 바꿔 주세요';
const b = await launch(bin);
const host = (m) => b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(m)}}))`);
const row = () => b.evaluate(`(()=>{const e=document.querySelector('.hps-steer-delivery');return e?e.textContent+(e.classList.contains('hps-steer-delivered')?' [accepted]':''):null})()`);
const waitFor = async (expr, n = 60) => { for (let i = 0; i < n; i++) { if (await b.evaluate(expr).catch(() => false)) return true; await pause(50); } return false; };
const type = async (text) => { await b.evaluate(`document.querySelector('textarea').focus()`); await b.send('Input.insertText', { text });
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); };
const failures = [];
async function setup(surface) {
  await b.send('Emulation.setDeviceMetricsOverride', { width: 800, height: 800, deviceScaleFactor: 1, mobile: false });
  const { identifier } = await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.sent=[];window.acquireVsCodeApi=()=>({postMessage:(m)=>window.sent.push(m),getState:()=>undefined,setState:()=>{}});` });
  await b.send('Page.navigate', { url: base });
  await waitFor(`!!window.sent && window.sent.some(m=>m.type==='ready')`, 100);
  await b.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  await host({ type: 'config', config: config(surface) }); await pause(100); await host({ type: 'history', messages: [] }); await pause(100);
  await type('첫 질문입니다');
  if (!await waitFor(`window.sent.some(m=>m.type==='sendMessage')`)) throw Error('first send not posted');
  const id1 = await b.evaluate(`window.sent.find(m=>m.type==='sendMessage').userMessageId`);
  await host({ type: 'streamStart', streamId: 's1', messageId: 'a1', userMessageId: id1 }); await host({ type: 'streamChunk', streamId: 's1', delta: '만드는 중' }); await pause(100);
  await type(QUEUED);
  if (!await waitFor(`!!document.querySelector('.hps-queued-steer')`)) throw Error('steer button missing');
  await b.evaluate(`document.querySelector('.hps-queued-steer').click()`);
  if (!await waitFor(`window.sent.some(m=>m.type==='cancelStream')`)) throw Error('no cancelStream');
  await host({ type: 'streamStopped', streamId: 's1' });
  if (!await waitFor(`window.sent.filter(m=>m.type==='sendMessage').length===2`)) throw Error('steer send not posted');
  const id2 = await b.evaluate(`window.sent.filter(m=>m.type==='sendMessage')[1].userMessageId`);
  await b.evaluate(`window.sawDelivered=false;new MutationObserver(()=>{if(document.querySelector('.hps-steer-delivered'))window.sawDelivered=true}).observe(document.getElementById('root'),{subtree:true,childList:true,attributes:true})`);
  await pause(100);
  return { id2, activity: 'a-' + surface };
}
const scenarios = {
  A_matching_start_end: (c) => [{ type: 'streamStart', streamId: 's2', messageId: 'a2', userMessageId: c.id2 }, { type: 'streamChunk', streamId: 's2', delta: '네' }, { type: 'streamEnd', streamId: 's2' }],
  S1_start_no_id_end: () => [{ type: 'streamStart', streamId: 's2', messageId: 'a2' }, { type: 'streamChunk', streamId: 's2', delta: '프로젝트를 바꿔요' }, { type: 'streamEnd', streamId: 's2' }],
  S4_start_no_id_error: () => [{ type: 'streamStart', streamId: 's2', messageId: 'a2' }, { type: 'streamError', streamId: 's2', error: '오류' }],
  P_preflight_error: () => [{ type: 'streamError', streamId: 'connection', error: '연결 오류' }],
  R_inputRejected: (c) => [{ type: 'inputRejected', activityId: c.activity, text: QUEUED }],
  C_stop_new_turn: () => [{ type: 'streamStart', streamId: 's2', messageId: 'a2' }, { type: 'streamStopped', streamId: 's2' }],
  C2_stop_matching_turn: (c) => [{ type: 'streamStart', streamId: 's2', messageId: 'a2', userMessageId: c.id2 }, { type: 'streamStopped', streamId: 's2' }],
  X_activity_change: (c, surface) => [{ type: 'config', config: config(surface, 'other-activity') }],
  H_history_cleared_then_turn: () => [{ type: 'history', messages: [] }, { type: 'streamStart', streamId: 's2', messageId: 'a2' }, { type: 'streamEnd', streamId: 's2' }],
  D_late_dup_old_end_only: () => [{ type: 'streamEnd', streamId: 's1' }, { type: 'streamStopped', streamId: 's1' }],
};
const surfaces = ['personal', 'classroom', 'instructor'];
try {
  for (const surface of surfaces) for (const [name, steps] of Object.entries(scenarios)) {
    let c; try { c = await setup(surface); } catch (e) { failures.push(`${surface} ${name}: setup failed: ${e.message}`); continue; }
    const pending0 = await row(); await pause(400); const pending1 = await row();
    const during = [];
    for (const m of steps(c, surface)) { await host(m); await pause(250); during.push(await row()); }
    await pause(400);
    const after = await row();
    const expectStay = name.startsWith('D_');
    const faded = await b.evaluate('window.sawDelivered');
    const expectFade = name.startsWith('A_') || name.startsWith('C2_');
    const pass = faded === expectFade && pending1 === '보내는 중…' + QUEUED && (expectStay ? after !== null : after === null);
    if (!pass) failures.push(`${surface} ${name}: ${JSON.stringify({ faded, expectFade, pending1, during, after })}`);
  }
  const QUEUED2 = '이번에는 파란색으로 해 주세요';
  for (const surface of surfaces) {
    // A second steer while the first steered turn started without naming its message: the second row is a new
    // presentation (SteerDelivery is keyed by its scope and position), so it must not inherit "the turn already ran".
    let c; try { c = await setup(surface); } catch (e) { failures.push(`${surface} second steer: setup failed: ${e.message}`); continue; }
    await host({ type: 'streamStart', streamId: 's2', messageId: 'a2' }); await host({ type: 'streamChunk', streamId: 's2', delta: '앱이 쓰는 답' }); await pause(150);
    await type(QUEUED2);
    if (!await waitFor(`!!document.querySelector('.hps-queued-steer')`)) { failures.push(`${surface} second steer: steer button missing`); continue; }
    await b.evaluate(`document.querySelector('.hps-queued-steer').click()`);
    if (!await waitFor(`window.sent.filter(m=>m.type==='cancelStream').length===2`)) { failures.push(`${surface} second steer: no cancelStream`); continue; }
    await host({ type: 'streamStopped', streamId: 's2' });
    if (!await waitFor(`window.sent.filter(m=>m.type==='sendMessage').length===3`)) { failures.push(`${surface} second steer: send not posted`); continue; }
    await pause(300);
    const second = await row();
    if (second !== '보내는 중…' + QUEUED2) failures.push(`${surface} second steer: ${JSON.stringify({ second })}`);
    // A turn that ends within the 140 ms exit of an accepted row: the exit still runs its full duration.
    try { c = await setup(surface); } catch (e) { failures.push(`${surface} fast end: setup failed: ${e.message}`); continue; }
    const exit = await b.send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `new Promise(resolve=>{let begun=0;const send=m=>window.dispatchEvent(new MessageEvent('message',{data:m}));const observer=new MutationObserver(()=>{const el=document.querySelector('.hps-steer-delivery');if(el&&el.classList.contains('hps-steer-delivered')&&!begun){begun=performance.now();send({type:'streamEnd',streamId:'s2'})}if(!el&&begun){observer.disconnect();resolve({elapsed:performance.now()-begun})}});observer.observe(document.getElementById('root'),{subtree:true,childList:true,attributes:true});send({type:'streamStart',streamId:'s2',messageId:'a2',userMessageId:${JSON.stringify(c.id2)}});setTimeout(()=>resolve({elapsed:null,begun}),2000)})` });
    const fast = exit.result.value;
    if (!(fast.elapsed >= 110)) failures.push(`${surface} fast end: the exit was cut short ${JSON.stringify(fast)}`);
  }
} finally { await b.close(); server.close(); rmSync(temp, { recursive: true, force: true }); }
assert.deepEqual(failures, [], 'steer delivery row in the real App');
console.log(`PASS steer delivery row in the real App: ${surfaces.length} seats x ${Object.keys(scenarios).length} ways a turn ends, a second steer, and an end inside the exit`);
