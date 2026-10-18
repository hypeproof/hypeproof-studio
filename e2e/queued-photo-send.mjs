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
  platform: 'browser', jsx: 'automatic', outfile: join(temp, 'ui.js') });
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
  await page.addInitScript(() => { window.acquireVsCodeApi = () => ({ postMessage: m => window.hostEvents.push(m), getState: () => undefined, setState: () => {} }); });
  const input = page.locator('.hps-input textarea');
  const queue = page.locator('.hps-queued');
  const render = over => page.evaluate(over => window.render(over), over);
  const sends = () => page.evaluate(() => window.sends);
  const snapshot = () => page.evaluate(() => ({ sends: window.sends, saved: window.hostEvents.filter(m => m.type === 'saveActivityDraft').at(-1)?.draft, queue: document.querySelector('.hps-queued')?.textContent, draft: document.querySelector('textarea')?.value }));
  const ack = stage => page.evaluate(stage => window.dispatchEvent(new MessageEvent('message', { data: { type: 'imageStagedByHost', stageId: stage.stageId, name: stage.name } })), stage);
  const stage = async () => {
    await page.getByLabel('첨부할 이미지 선택').setInputFiles({ name: 'sample.png', mimeType: 'image/png', buffer: photo });
    await page.waitForFunction(() => window.hostEvents.some(m => m.type === 'stageImage'));
    return page.evaluate(() => window.hostEvents.find(m => m.type === 'stageImage'));
  };
  try {
    await page.goto('http://127.0.0.1:' + server.address().port);
    await expect(input).toBeVisible();
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
