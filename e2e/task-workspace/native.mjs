// Installed Mac shell + real extension/store/browser; loopback-only synthetic Service, no model.
import http from 'node:http';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { expect } from '@playwright/test';

if (!process.env.HPS_APP_PATH) throw Error('Set HPS_APP_PATH to the isolated development app.');
const output = resolve(process.env.HPS_TASK_NATIVE_EVIDENCE ?? 'e2e/test-results/task-workspace-native');
await mkdir(output, { recursive: true });
const temp = await mkdtemp(join(tmpdir(), 'hps-task-native-service-'));
const payload = Buffer.from(JSON.stringify({ c: 'studio-native-trial', n: 'synthetic-personal', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
process.env.HPS_E2E_TOKEN_FILE = join(temp, 'synthetic-token');
await writeFile(process.env.HPS_E2E_TOKEN_FILE, payload + '.synthetic-not-a-credential', { mode: 0o600 });
const bundled = await build({ entryPoints: [import.meta.resolve('@hypeproof/service-testkit/src/profiles/studio-native-trial.ts').replace('file://', '')], bundle: true, write: false, platform: 'node', format: 'esm', loader: { '.md': 'text' } });
const { profile: base } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const profile = { ...base, profile_id: base.id, activity_id: 'a'.repeat(64), activity_kind: 'personal', display_name: '개인 작업 검증', observation: undefined, coach_runtime: 'proxy', analytics: { log_metadata: false, log_user_messages: false, upload_session_logs: false }, workspace_root: undefined };
const calls = [];
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://local').pathname;
  calls.push({ path: pathname, method: request.method });
  if (pathname === '/native-source') { response.setHeader('content-type', 'text/html; charset=utf-8'); response.end('<!doctype html><html lang="ko"><title>작업 자료 검증</title><body><h1>작업 자료 검증</h1><p>내장 브라우저에 열린 로컬 출처입니다.</p></body></html>'); return; }
  response.setHeader('content-type', 'application/json');
  if (pathname === '/v1/profile') response.end(JSON.stringify(profile));
  else if (pathname === '/v1/activity') response.end(JSON.stringify({ activity_id: profile.activity_id }));
  else if (pathname === '/v1/health') response.end('{}');
  else if (pathname === '/v1/access') response.end(JSON.stringify({ schema: 'hps-access-view/1', configured: false, as_of: new Date().toISOString(), choices: [] }));
  else response.writeHead(404).end('{}');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const { launchApp, closeApp, chatFrame } = await import('../fixtures/app.ts');
const checks = [];
let ctx;
try {
  const history = [{ id: 'native-task-user', role: 'user', content: '재실행 후에도 작업과 자료를 이어갈 수 있어야 해.', createdAt: 1 }, { id: 'native-task-answer', role: 'assistant', content: '저장한 대화와 입력을 다시 엽니다.', createdAt: 2, citations: [{ url: origin + '/native-source', title: '작업 자료 검증', domain: '127.0.0.1', tier: 3 }] }];
  ctx = await launchApp({ proxyUrl: origin + '/v1', preseedToken: true, stayOnStart: true, preseedCoach: { name: 'HypeProof' }, preseedHistory: history });
  const snapshot = async name => {
    const encoded = await ctx.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
    await writeFile(join(output, name + '.png'), Buffer.from(encoded, 'base64'));
  };
  let chat = await chatFrame(ctx.win);
  await expect(chat.locator('.tw-workspace')).toBeVisible({ timeout: 30000 });
  await expect(chat.locator('.hp-mission')).toHaveCount(0);
  await expect(chat.getByText('강사에게 도움 요청', { exact: true })).toHaveCount(0);
  await expect(chat.getByText('현재 연결은 작업 관찰을 지원하지 않습니다.', { exact: false })).toHaveCount(0);
  checks.push('personal native task omits lesson banner and default classroom controls');
  await expect(chat.locator('.hps-messages')).toContainText('저장한 대화와 입력');
  await chat.locator('.hps-input textarea').fill('앱을 닫아도 남아 있어야 하는 입력');
  await chat.getByRole('button', { name: '새 작업', exact: true }).click();
  await expect(chat.locator('.hps-input textarea')).toHaveValue('');
  await chat.locator('.tw-task').filter({ hasText: '이전 대화' }).click();
  await expect(chat.locator('.hps-input textarea')).toHaveValue('앱을 닫아도 남아 있어야 하는 입력');
  checks.push('installed shell create/switch restores draft and migrated transcript');
  const citation = chat.getByRole('button', { name: /작업 자료 검증.*출처 미리보기/ });
  await citation.click();
  await expect(chat.locator('#task-source-title')).toBeFocused();
  await chat.getByRole('button', { name: '이 자료 고정', exact: true }).click();
  await chat.getByRole('button', { name: '브라우저에서 열기', exact: true }).click();
  await expect(chat.getByRole('button', { name: '대화로 돌아가기', exact: true })).toBeVisible();
  await expect.poll(() => ctx.app.evaluate(async ({ webContents }) => {
    const source = webContents.getAllWebContents().find(contents => contents.getURL().endsWith('/native-source'));
    return source ? source.executeJavaScript('document.body.innerText') : '';
  }), { timeout: 20000 }).toContain('내장 브라우저에 열린 로컬 출처입니다.');
  const captureSource = async () => {
    const encoded = await ctx.app.evaluate(async ({ webContents }) => {
      const source = webContents.getAllWebContents().find(contents => contents.getURL().endsWith('/native-source'));
      return (await source.capturePage()).toPNG().toString('base64');
    });
    await writeFile(join(output, 'native-source-document.png'), Buffer.from(encoded, 'base64'));
  };
  await captureSource();
  await snapshot('native-browser');
  await chat.getByRole('button', { name: '브라우저에서 열기', exact: true }).click();
  await expect(chat.getByRole('button', { name: '대화로 돌아가기', exact: true })).toBeVisible();
  expect(await ctx.app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(contents => contents.getURL().endsWith('/native-source')).length)).toBe(1);
  await chat.getByRole('button', { name: '대화로 돌아가기', exact: true }).click();
  await expect(chat.locator('#task-sources')).toBeHidden();
  await expect(citation).toBeFocused();
  await expect(chat.locator('.hps-input textarea')).toHaveValue('앱을 닫아도 남아 있어야 하는 입력');
  await snapshot('native-source-return');
  checks.push('real native browser document rendered, repeated open reuses it, acknowledged return restores exact citation and draft');
  const userDataDir = ctx.userDataDir;
  await ctx.app.close();
  ctx = await launchApp({ reuseUserDataDir: userDataDir, proxyUrl: origin + '/v1', preseedToken: true, stayOnStart: true, preseedCoach: { name: 'HypeProof' } });
  chat = await chatFrame(ctx.win);
  await expect(chat.locator('.tw-workspace')).toBeVisible({ timeout: 30000 });
  await expect(chat.locator('.hps-input textarea')).toHaveValue('앱을 닫아도 남아 있어야 하는 입력');
  await expect(chat.locator('.hps-messages')).toContainText('저장한 대화와 입력');
  await chat.getByRole('button', { name: /^자료/ }).click();
  await expect(chat.getByRole('button', { name: '고정 해제', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await snapshot('native-reopened');
  checks.push('real process restart restores active task, full transcript, draft and pin');
  expect(calls.filter(call => /messages|completions/.test(call.path))).toHaveLength(0);
  const extension = join(process.env.HPS_APP_PATH, 'Contents/Resources/app/extensions/hypeproof-chat/dist/extension.js');
  const extensionSha256 = createHash('sha256').update(await readFile(extension)).digest('hex');
  await writeFile(join(output, 'result.json'), JSON.stringify({ status: 'PASS', scope: 'Mac development copy of installed shell + real extension/store/native browser; synthetic local Service, no model; not signed release acceptance', checks, calls, extensionSha256 }, null, 2));
  console.log(JSON.stringify({ status: 'PASS', checks: checks.length, output }));
} catch (error) {
  if (ctx) {
    const encoded = await ctx.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')).catch(() => null);
    if (encoded) await writeFile(join(output, 'failure.png'), Buffer.from(encoded, 'base64'));
  }
  await writeFile(join(output, 'result.json'), JSON.stringify({ status: 'FAIL', checks, calls, error: String(error) }, null, 2));
  throw error;
} finally { if (ctx) await closeApp(ctx); await new Promise(resolve => server.close(resolve)); await rm(temp, { recursive: true, force: true }); }
