// REQ-C6 / UX10: real App+composer against the existing host-message boundary.
// This browser test deliberately reorders messages; native/network proof is separate.
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
const temp = await mkdtemp(join(tmpdir(), 'hps-stop-stream-'));
const output = resolve(process.env.HPS_STOP_EVIDENCE ?? join(root, 'e2e/test-results/stop-stream'));
await mkdir(output, { recursive: true });
const config = chatPanelProps().config;
config.activity.kind = 'personal';
config.profile.lesson = undefined;
config.profile.classroom_panels = { help_request: false, artifact_approval: false };
config.taskWorkspace = { activeTaskId: 'stop-fixture', tasks: [] };
await build({ stdin: { contents: `
 import React from 'react'; import {createRoot} from 'react-dom/client';
 import {App} from './src/App'; import './src/styles.css';
 createRoot(document.getElementById('root')).render(<App/>);`,
 resolveDir: join(root, 'extensions/hypeproof-chat/webview-ui'), loader: 'tsx' },
 bundle: true, loader: { '.svg': 'dataurl' }, platform: 'browser', jsx: 'automatic', outfile: join(temp, 'ui.js') });
const server = createServer(async (req, res) => {
 const asset = req.url === '/ui.js' ? 'ui.js' : req.url === '/ui.css' ? 'ui.css' : null;
 res.setHeader('content-type', asset === 'ui.js' ? 'text/javascript' : asset === 'ui.css' ? 'text/css' : 'text/html');
 res.end(asset ? await readFile(join(temp, asset)) : '<meta charset="utf-8"><link rel="stylesheet" href="/ui.css"><div id="root"></div><script src="/ui.js"></script>');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const checks = [], errors = [], trace = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => { window.hostEvents = []; window.acquireVsCodeApi = () => ({ postMessage: m => window.hostEvents.push(m), getState: () => undefined, setState: () => {} }); });
const emit = async (...messages) => {
 trace.push(...messages.map(m => ({ at: new Date().toISOString(), direction: 'host-to-ui', ...m })));
 await page.evaluate(messages => { for (const m of messages) window.dispatchEvent(new MessageEvent('message', { data: m })); }, messages.map(m => ({ activityId: config.activity.id, taskId: config.taskWorkspace.activeTaskId, ...m })));
};
const requests = () => page.evaluate(() => window.hostEvents.filter(m => ['sendMessage', 'retryMessage'].includes(m.type)));
const input = page.locator('.hps-input textarea');
try {
 await page.goto('http://127.0.0.1:' + server.address().port);
 await expect.poll(() => page.evaluate(() => window.hostEvents.some(m => m.type === 'ready'))).toBe(true);
 await emit({ type: 'config', config });
 await input.fill('요청 A'); await input.press('Enter'); await expect.poll(async () => (await requests()).length).toBe(1);
 await emit({ type: 'streamStart', streamId: 'A', messageId: 'answer-a' }, { type: 'streamChunk', streamId: 'A', delta: 'A의 부분 답변' });
 await input.fill('중단해도 남을 초안 D'); await page.getByRole('button', { name: '응답 멈추기', exact: true }).click();
 await expect.poll(() => page.evaluate(() => window.hostEvents.filter(m => m.type === 'cancelStream').length)).toBe(1);
 await emit({ type: 'streamStopped', streamId: 'A' });
 await expect(input).toHaveValue('중단해도 남을 초안 D'); await expect(input).toBeFocused();
 await expect(page.getByText('A의 부분 답변', { exact: true })).toBeVisible();
 await expect(page.getByRole('button', { name: '메시지 보내기', exact: true })).toBeVisible();
 assert.equal((await requests()).length, 1);
 checks.push('Stop preserves the partial answer and draft, restores Send/focus, and does not send the draft.');
 await page.screenshot({ path: join(output, '01-after-stop.png') });

 await emit({ type: 'streamError', streamId: 'A', error: 'stale error while idle' });
 await expect(page.locator('body')).not.toContainText('stale error while idle');
 await input.press('Enter'); await expect.poll(async () => (await requests()).length).toBe(2);
 await emit({ type: 'streamEnd', streamId: 'A' }, { type: 'streamStopped', streamId: 'A' });
 await input.fill('세 번째 초안 E'); await input.press('Enter');
 assert.equal((await requests()).length, 2, 'old terminal messages cannot unlock a pending send');
 await expect(input).toHaveValue('세 번째 초안 E');
 checks.push('A delayed terminal is ignored while idle and while the next request is waiting for its start; no duplicate dispatch.');

 await emit({ type: 'streamStart', streamId: 'B', messageId: 'answer-b' }, { type: 'streamChunk', streamId: 'B', delta: 'B의 현재 답변' });
 await emit({ type: 'streamStart', streamId: 'B', messageId: 'duplicate-b' }, { type: 'streamChunk', streamId: 'B', delta: ' 계속' });
 for (const message of [
  { type: 'streamChunk', delta: '[STALE_A_CHUNK]' },
  { type: 'toolLog', id: 'stale-tool', icon: '', label: '[STALE_A_TOOL]', state: 'done' },
  { type: 'streamCitations', citations: [{ id: 'stale-source', url: 'https://example.com/', title: '[STALE_A_SOURCE]' }] },
  { type: 'streamError', error: '[STALE_A_ERROR]' },
  { type: 'streamStopped' }, { type: 'streamEnd' },
 ]) await emit({ ...message, streamId: 'A' });
 await expect(page.getByText('B의 현재 답변 계속', { exact: true })).toBeVisible();
 await expect(page.locator('body')).not.toContainText('[STALE_A_');
 await expect(page.getByRole('button', { name: '응답 멈추기', exact: true })).toBeVisible();
 await expect(input).toHaveValue('세 번째 초안 E'); assert.equal((await requests()).length, 2);
 checks.push('Late chunks/tools/citations/error/stop/end cannot change B; duplicate B start cannot erase its partial answer.');
 await page.screenshot({ path: join(output, '02-current-turn-protected.png') });

 await emit({ type: 'streamError', streamId: 'B', error: '현재 B 오류' });
 await expect(page.locator('.hps-error-banner')).toContainText('현재 B 오류');
 await expect(input).toHaveValue('세 번째 초안 E');
 await page.getByRole('button', { name: '다시 보내기', exact: true }).dblclick();
 await expect.poll(async () => (await requests()).length).toBe(3);
 await emit({ type: 'streamStart', streamId: 'C', messageId: 'answer-c' }, { type: 'streamChunk', streamId: 'C', delta: 'C의 정상 답변' }, { type: 'streamEnd', streamId: 'C' });
 await expect(page.getByText('C의 정상 답변', { exact: true })).toBeVisible();
 await expect(page.locator('.hps-error-banner')).toHaveCount(0); await expect(input).toHaveValue('세 번째 초안 E');
 checks.push('Current-turn errors remain visible; double-click retry sends once; current completion restores idle without deleting the draft.');

 await input.press('Enter'); await expect.poll(async () => (await requests()).length).toBe(4);
 await emit({ type: 'inputRejected', text: '세 번째 초안 E', toolMode: 'auto' }, { type: 'streamError', streamId: 'activity', error: '시작 전 활동 연결 오류' });
 await expect(input).toHaveValue('세 번째 초안 E');
 await expect(page.locator('.hps-error-banner')).toContainText('시작 전 활동 연결 오류');
 await expect(page.getByRole('button', { name: '메시지 보내기', exact: true })).toBeEnabled();
 checks.push('A real host-protocol preflight refusal still restores input and displays its error before any streamStart.');

 await emit({ type: 'streamStart', streamId: 'app-reply', messageId: 'app-reply-answer' }, { type: 'streamChunk', streamId: 'app-reply', delta: '앱에서 알려준 작업 결과' });
 await emit({ type: 'streamError', streamId: 'app-reply', error: '답변을 기록에 저장하지 못했어요. 화면의 내용을 확인해 주세요.' });
 await expect(page.getByText('앱에서 알려준 작업 결과', { exact: true })).toBeVisible();
 await expect(page.locator('.hps-error-banner')).toContainText('답변을 기록에 저장하지 못했어요.');
 await expect(input).toHaveValue('세 번째 초안 E');
 await expect(page.getByRole('button', { name: '메시지 보내기', exact: true })).toBeEnabled();
 assert.equal((await requests()).length, 4, 'an app reply failure cannot send a user request');
 await input.fill('저장 오류 후 새 질문'); await input.press('Enter');
 await expect.poll(async () => (await requests()).length).toBe(5);
 await emit({ type: 'streamStart', streamId: 'after-app-reply', messageId: 'next-answer' }, { type: 'streamChunk', streamId: 'after-app-reply', delta: '다음 질문의 정상 답변' }, { type: 'streamEnd', streamId: 'after-app-reply' });
 await expect(page.getByText('다음 질문의 정상 답변', { exact: true })).toBeVisible();
 await expect(page.locator('.hps-error-banner')).toHaveCount(0);
 checks.push('An app-authored reply storage error retains its visible text and unsent draft, returns Send, and permits an explicit next question.');
 assert.deepEqual(errors, []);
 await writeFile(join(output, 'result.json'), JSON.stringify({ verdict: 'PASS', checks, requests: await requests(), trace, scope: 'Real React App + composer; injected host-message ordering, not native/provider proof.' }, null, 2));
 console.log(JSON.stringify({ verdict: 'PASS', checks, output }));
} catch (error) {
 await page.screenshot({ path: join(output, 'failure.png') });
 await writeFile(join(output, 'result.json'), JSON.stringify({ verdict: 'FAIL', error: String(error), checks, requests: await requests(), trace, errors }, null, 2));
 throw error;
} finally {
 await browser.close(); await new Promise(r => server.close(r)); await rm(temp, { recursive: true, force: true });
}
