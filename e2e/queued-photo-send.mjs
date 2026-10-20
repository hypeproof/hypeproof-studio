// REQ-C16 / UX-QUEUE-01: exercise the real React composer, including its file input,
// asynchronous staging acknowledgement and persisted draft. No model or native-app claim.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatPanelProps } from '../extensions/hypeproof-chat/test/sx-screen-fixtures.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const ui = join(root, 'extensions/hypeproof-chat/webview-ui');
const temp = await mkdtemp(join(tmpdir(), 'hps-queue-photo-'));
const output = resolve(process.env.HPS_QUEUE_EVIDENCE ?? join(root, 'e2e/test-results/queued-photo-send'));
await mkdir(output, { recursive: true });
const fixture = chatPanelProps();
fixture.config.activity.kind = 'personal';
fixture.config.taskWorkspace = { activeTaskId: 'queue-fixture', tasks: [] };
fixture.config.profile.lesson = undefined;
fixture.config.profile.input = { image_files: true };
fixture.config.profile.classroom_panels = { help_request: false, artifact_approval: false };
await build({ stdin: { contents: `
  import React from 'react'; import {createRoot} from 'react-dom/client';
  import {ChatPanel} from './src/ChatPanel'; import './src/styles.css';
  const root=createRoot(document.getElementById('root'));
  const base=${JSON.stringify(fixture)};
  window.sends=[]; window.hostEvents=[]; window.rejectSend=false;
  let props={...base}, generation=0;
  props.onSend=(...args)=>{if(window.rejectSend)return false;window.sends.push(args);return true;};
  window.render=(over={})=>{props={...props,...over};root.render(<ChatPanel key={generation} {...props}/>);};
  window.reopen=()=>{const draft=window.hostEvents.filter(m=>m.type==='saveActivityDraft').at(-1).draft;
    generation++;props={...props,streaming:false,config:{...base.config,activityDraft:draft}};window.render();};
  window.render();`, resolveDir: ui, loader: 'tsx' }, bundle: true, loader: { '.svg': 'dataurl' },
  platform: 'browser', jsx: 'automatic', outfile: join(temp, 'ui.js'),
  plugins: process.env.HPS_QUEUE_PANEL_SOURCE ? [{name:'baseline-panel',setup(b){b.onLoad({filter:/ChatPanel\.tsx$/},async()=>({contents:await readFile(process.env.HPS_QUEUE_PANEL_SOURCE,'utf8'),loader:'tsx',resolveDir:join(ui,'src')}));}}] : [] });
const server = createServer(async (req, res) => {
  const asset = req.url === '/ui.js' ? 'ui.js' : req.url === '/ui.css' ? 'ui.css' : null;
  res.setHeader('content-type', asset === 'ui.js' ? 'text/javascript' : asset === 'ui.css' ? 'text/css' : 'text/html');
  res.end(asset ? await readFile(join(temp, asset)) : '<meta charset="utf-8"><link rel="stylesheet" href="/ui.css"><div id="root"></div><script src="/ui.js"></script>');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ headless: true });
const results = [];
const photo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
async function scenario(name, run) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.acquireVsCodeApi = () => ({ postMessage: m => { window.hostEvents.push(m); if(m.type==='prepareAttachments')setTimeout(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'attachmentsPrepared',requestId:m.requestId,failures:[]}}))); }, getState: () => undefined, setState: () => {} }); });
  const input = page.locator('.hps-input textarea');
  const queue = page.locator('.hps-queued:not(.hps-recovered)');
  const render = over => page.evaluate(over => window.render(over), over);
  const sends = () => page.evaluate(() => window.sends);
  const snapshot = () => page.evaluate(() => ({ sends: window.sends, saved: window.hostEvents.filter(m => m.type === 'saveActivityDraft').at(-1)?.draft, queue: document.querySelector('.hps-queued:not(.hps-recovered)')?.textContent, draft: document.querySelector('textarea')?.value }));
  const ack = stage => page.evaluate(stage => window.dispatchEvent(new MessageEvent('message', { data: { type: 'imageStagedByHost', stageId: stage.stageId, name: stage.name } })), stage);
  const stage = async () => {
    await page.getByLabel('첨부할 이미지 선택').setInputFiles({ name: 'sample.png', mimeType: 'image/png', buffer: photo });
    await page.waitForFunction(() => window.hostEvents.some(m => m.type === 'stageImage'));
    return page.evaluate(() => window.hostEvents.find(m => m.type === 'stageImage'));
  };
  try {
    await page.goto('http://127.0.0.1:' + server.address().port);
    await expect(input).toBeVisible();
    await page.evaluate(config => window.dispatchEvent(new MessageEvent('message', {data:{type:'config',config}})),fixture.config);
    await render({ streaming: true });
    await expect(input).toHaveAttribute('placeholder', '다음 메시지를 준비하세요');
    await input.fill('대기 메시지 C'); await input.press('Enter');
    await expect(queue).toContainText('대기 메시지 C');
    await input.fill('다음 초안 D');
    await run({ page, input, queue, render, stage, ack, sends, snapshot });
    assert.deepEqual(errors, []);
    results.push({ name, verdict: 'PASS', observed: await snapshot() });
  } catch (error) {
    results.push({ name, verdict: 'FAIL', error: String(error), observed: await snapshot(), errors });
  } finally {
    await page.screenshot({ path: join(output, name + '.png') });
    await page.close();
  }
}
try {
  await scenario('recovery-capacity-preserves-new-input', async ({ page, input, queue, render, sends }) => {
    await page.evaluate(activityId => {
      for (let i=0;i<8;i++) for(let duplicate=0;duplicate<2;duplicate++) {
        window.dispatchEvent(new MessageEvent('message',{data:{type:'inputRejected',activityId,text:`보관할 요청 ${i+1}`,toolMode:'web-search',images:['data:image/png;base64,c3ludGhldGlj']}}));
      }
    },fixture.config.activity.id);
    const recovered=page.locator('.hps-recovered');
    await expect(recovered).toHaveCount(8);
    await render({streaming:false,error:'합성 거절'});
    await input.press('Enter');
    await expect(input).toHaveValue('다음 초안 D');
    assert.equal((await sends()).length,0,'new requests must stop before recovery storage grows again');
    await queue.getByRole('button',{name:'보내기',exact:true}).click();
    assert.equal((await sends()).length,0,'parked sends obey the same recovery capacity');
    await expect(queue).toContainText('대기 메시지 C');
    await expect(page.getByRole('status').filter({hasText:'보관한 메시지를 먼저'})).toBeVisible();
    await page.waitForFunction(()=>window.hostEvents.filter(m=>m.type==='saveActivityDraft').at(-1)?.draft.recovered?.length===8);
    await page.evaluate(()=>window.reopen());
    await expect(recovered).toHaveCount(8);await expect(input).toHaveValue('다음 초안 D');
    await recovered.first().getByRole('button',{name:'다시 보내기',exact:true}).click();
    await expect(recovered).toHaveCount(7);assert.equal((await sends()).length,1);
    await queue.getByRole('button',{name:'보내기',exact:true}).click();
    await expect(queue).toHaveCount(0);assert.equal((await sends()).length,2);
    await expect(input).toHaveValue('다음 초안 D');
  });
  await scenario('rejected-search-keeps-existing-queue', async ({ page, input, queue, render, sends }) => {
    const reject = () => page.evaluate(activityId => window.dispatchEvent(new MessageEvent('message', {data: {
      type: 'inputRejected', activityId, text: '실패한 검색 요청 A', toolMode: 'web-search', images: ['data:image/png;base64,c3ludGhldGlj']
    }})), fixture.config.activity.id);
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', {data:{type:'inputRejected',activityId:'other-activity',text:'다른 활동 요청',toolMode:'web-search'}})));
    await expect(input).toHaveValue('다음 초안 D');
    await reject(); await reject();
    await render({streaming: false, error: '합성 검색 요청 거절'});
    await expect(input).toHaveValue('다음 초안 D');
    await expect(queue).toContainText('대기 메시지 C');
    await expect(queue).not.toContainText('실패한 검색 요청 A');
    await expect(queue).not.toContainText('웹 검색');
    const recovered = page.locator('.hps-recovered');
    await expect(recovered).toHaveCount(1);
    await expect(recovered).toContainText('실패한 검색 요청 A');
    await expect(recovered).toContainText('웹 검색');
    assert.equal((await sends()).length, 0, 'recovery never sends automatically');
    await page.waitForFunction(() => window.hostEvents.filter(m => m.type === 'saveActivityDraft').at(-1)?.draft.recovered?.length === 1);
    await page.evaluate(() => window.reopen());
    await expect(recovered).toHaveCount(1); await expect(queue).toContainText('대기 메시지 C');
    await expect(input).toHaveValue('다음 초안 D');
    await recovered.getByRole('button',{name:'수정하기',exact:true}).click();
    await expect(input).toHaveValue('다음 초안 D');await expect(recovered).toHaveCount(1);
    await page.screenshot({path:join(output,'recovery-separated.png')});
    await page.evaluate(() => {window.rejectSend=true;});
    await recovered.getByRole('button', {name:'다시 보내기',exact:true}).click();
    await expect(recovered).toHaveCount(1);assert.equal((await sends()).length,0);
    await page.evaluate(() => {window.rejectSend=false;});
    await recovered.getByRole('button', {name: '다시 보내기', exact: true}).focus();
    await page.keyboard.press('Enter');
    await expect(recovered).toHaveCount(0); await expect(input).toBeFocused();
    let sent = await sends(); assert.equal(sent.length, 1); assert.equal(sent[0][0], '실패한 검색 요청 A'); assert.equal(sent[0][4], 'web-search');
    assert.deepEqual(sent[0][1], ['data:image/png;base64,c3ludGhldGlj']);
    await expect(input).toHaveValue('다음 초안 D');
    await queue.getByRole('button', {name: '보내기', exact: true}).click();
    sent = await sends(); assert.equal(sent.length, 2); assert.equal(sent[1][0], '대기 메시지 C'); assert.equal(sent[1][4], 'auto');
    assert.equal(sent[1][1], undefined, 'rejected image cannot leak into the unrelated queued send');
    await expect(input).toHaveValue('다음 초안 D');
    await reject();
    await expect(recovered).toHaveCount(1);
    await expect(input).toHaveValue('다음 초안 D');
    await expect(queue).toHaveCount(0);
    assert.equal((await sends()).length, 2, 'a later refusal also stays separate from the draft');
    await input.fill('');
    await recovered.getByRole('button',{name:'수정하기',exact:true}).click();
    await expect(input).toHaveValue('실패한 검색 요청 A');await expect(recovered).toHaveCount(0);
    await expect(input).toBeFocused();assert.equal((await sends()).length,2);
  });
  await scenario('recovery-cleanup-small-window', async ({page,input,queue,render,sends}) => {
    await page.setViewportSize({width:560,height:600});
    await page.evaluate(activityId=>{
      for(let i=0;i<12;i++)window.dispatchEvent(new MessageEvent('message',{data:{type:'inputRejected',activityId,text:`기존 메시지 ${i+1} — 사진과 검색 의도를 보존합니다`,toolMode:'web-search',images:['data:image/png;base64,c3ludGhldGlj']}}));
    },fixture.config.activity.id);
    await render({streaming:false,error:'합성 거절'});
    const recovered=page.locator('.hps-recovered');await expect(recovered).toHaveCount(12);
    await recovered.last().getByRole('button',{name:'삭제',exact:true}).focus();await page.keyboard.press('Enter');
    const confirmation=page.getByRole('group',{name:'메시지 삭제 확인'});
    await expect(confirmation.getByRole('button',{name:'취소',exact:true})).toBeFocused();
    await page.keyboard.press('Escape');await expect(recovered).toHaveCount(12);await expect(input).toBeFocused();
    await page.screenshot({path:join(output,'small-window-recovery-before-cleanup.png')});
    await recovered.last().getByRole('button',{name:'삭제',exact:true}).click();
    await confirmation.getByRole('button',{name:'삭제 확인',exact:true}).click();
    await expect(recovered).toHaveCount(11);await expect(input).toBeFocused();
    await expect(input).toHaveValue('다음 초안 D');await expect(queue).toContainText('대기 메시지 C');
    await expect.poll(async()=>page.evaluate(()=>window.hostEvents.filter(m=>m.type==='saveActivityDraft').at(-1)?.draft.recovered?.length)).toBe(11);
    await page.evaluate(()=>window.reopen());await expect(recovered).toHaveCount(11);
    await expect(recovered.last()).toContainText('기존 메시지 11');await expect(input).toHaveValue('다음 초안 D');
    const geometry=await page.evaluate(()=>{const r=document.querySelector('.hps-recovery-list').getBoundingClientRect(),i=document.querySelector('.hps-input textarea').getBoundingClientRect();return {listHeight:r.height,inputTop:i.top,inputBottom:i.bottom,height:innerHeight,width:innerWidth,scrollWidth:document.documentElement.scrollWidth};});
    assert.ok(geometry.listHeight<=151,JSON.stringify(geometry));
    assert.ok(geometry.inputTop>=0&&geometry.inputBottom<=geometry.height,JSON.stringify(geometry));
    assert.ok(geometry.scrollWidth<=geometry.width,JSON.stringify(geometry));
    assert.equal((await sends()).length,0,'cleanup never sends any input');
  });
  await scenario('ready-photo-completion', async ({ input, queue, render, stage, ack, sends }) => {
    const photo = await stage(); await ack(photo); await render({ streaming: false });
    await expect(queue).toHaveCount(0); await expect(input).toHaveValue('다음 초안 D');
    const sent = await sends(); assert.equal(sent.length, 1); assert.equal(sent[0][0], '대기 메시지 C');
    assert.equal(sent[0][3][0].id, photo.stageId); assert.equal(sent[0][4], 'auto');
    await render({ streaming: false }); assert.equal((await sends()).length, 1);
  });
  await scenario('stop-restores-text', async ({ input, queue, render, stage, ack, sends }) => {
    const photo = await stage(); await render({ streaming: false, stopNotice: '사용자가 중단했습니다.' });
    await expect(queue).toHaveCount(0); await expect(input).toHaveValue('대기 메시지 C\n다음 초안 D');
    await ack(photo); assert.equal((await sends()).length, 0);
  });
  await scenario('pending-photo-keeps-queue', async ({ page, input, queue, render, stage, ack, sends }) => {
    const photo = await stage(); await render({ streaming: false });
    await expect(queue).toContainText('보관한 메시지'); await expect(queue).toContainText('대기 메시지 C');
    await expect(input).toHaveValue('다음 초안 D'); assert.equal((await sends()).length, 0);
    await queue.getByRole('button', { name: '보내기', exact: true }).click();
    await expect(queue).toContainText('대기 메시지 C'); assert.equal((await sends()).length, 0);
    await ack(photo); await render({ streaming: false }); assert.equal((await sends()).length, 0);
    await queue.getByRole('button', { name: '보내기', exact: true }).click();
    await expect(queue).toHaveCount(0); await expect(input).toHaveValue('다음 초안 D');
    const sent = await sends(); assert.equal(sent.length, 1); assert.equal(sent[0][0], '대기 메시지 C'); assert.equal(sent[0][3][0].id, photo.stageId);
    await render({ streaming: false }); assert.equal((await sends()).length, 1);
  });
  await scenario('refused-send-keeps-durable-queue', async ({ page, input, queue, render, sends }) => {
    await page.evaluate(() => { window.rejectSend = true; }); await render({ streaming: false });
    await expect(queue).toContainText('보관한 메시지'); await expect(input).toHaveValue('다음 초안 D');
    assert.equal((await sends()).length, 0);
    await page.waitForFunction(() => window.hostEvents.filter(m => m.type === 'saveActivityDraft').at(-1)?.draft.queuedPaused === true);
    await page.evaluate(() => window.reopen());
    await expect(queue).toContainText('대기 메시지 C'); await expect(input).toHaveValue('다음 초안 D');
    await page.evaluate(() => { window.rejectSend = false; });
    await queue.getByRole('button', { name: '보내기', exact: true }).click();
    await expect(queue).toHaveCount(0); assert.equal((await sends()).length, 1);
    await expect(input).toHaveValue('다음 초안 D');
  });
} finally {
  await browser.close(); await new Promise(r => server.close(r)); await rm(temp, { recursive: true, force: true });
}
const verdict = results.every(r => r.verdict === 'PASS') ? 'PASS' : 'FAIL';
await writeFile(join(output, 'result.json'), JSON.stringify({ verdict, scope: 'actual React component with synthetic host acknowledgements; no native, live model or real disk-reopen claim', results }, null, 2));
console.log(JSON.stringify({ verdict, results: results.map(({ name, verdict }) => ({ name, verdict })), output }));
if (verdict === 'FAIL') process.exitCode = 1;
