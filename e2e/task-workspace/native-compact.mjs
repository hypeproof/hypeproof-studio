// Installed Mac shell + real extension/store/browser; loopback-only synthetic Service, no model.
import http from 'node:http';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { expect } from '@playwright/test';

if (!process.env.HPS_APP_PATH) throw Error('Set HPS_APP_PATH to the isolated development app.');
const output = resolve(process.env.HPS_COMPACT_NATIVE_EVIDENCE ?? 'e2e/test-results/chat-compact-native');
await mkdir(output, { recursive: true });
const temp = await mkdtemp(join(tmpdir(), 'hps-task-native-service-'));
const payload = Buffer.from(JSON.stringify({ c: 'studio-native-trial', n: 'synthetic-personal', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
process.env.HPS_E2E_TOKEN_FILE = join(temp, 'synthetic-token');
await writeFile(process.env.HPS_E2E_TOKEN_FILE, payload + '.synthetic-not-a-credential', { mode: 0o600 });
const bundled = await build({ entryPoints: [import.meta.resolve('@hypeproof/service-testkit/src/profiles/studio-native-trial.ts').replace('file://', '')], bundle: true, write: false, platform: 'node', format: 'esm', loader: { '.md': 'text' } });
const { profile: base } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const profile = { ...base, profile_id: base.id, activity_id: 'a'.repeat(64), activity_kind: 'personal', display_name: '개인 작업 검증', observation: { format: 'hps-observation/2', assess: true, scope: 'synthetic-personal' }, coach_runtime: 'proxy', analytics: { log_metadata: false, log_user_messages: false, upload_session_logs: false }, workspace_root: undefined };
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

const checks=[];
let ctx;
try {
  const history=[{id:'compact-user',role:'user',content:'객관식으로 질문해 줘',createdAt:1},{id:'compact-answer',role:'assistant',content:'객관식으로 골라 보세요.\n\n**어느 쪽에 가까웠나요?**\n\n1. 글쓰기나 정리: 메일, 보고서, 메모\n2. 계획 세우기: 여행, 일정, 공부\n3. 알아보고 비교하기: 제품, 장소, 정보 조사',createdAt:2}];
  ctx=await launchApp({proxyUrl:origin+'/v1',preseedToken:true,stayOnStart:true,preseedCoach:{name:'HypeProof'},preseedHistory:history});
  const chat=await chatFrame(ctx.win);
  await expect(chat.locator('.tw-workspace')).toBeVisible({timeout:30000});
  const input=chat.locator('.hps-input textarea');
  await expect(chat.getByRole('group',{name:'답변 선택'})).toBeVisible();
  await expect(chat.locator('.hps-access')).toBeHidden();
  await expect(chat.locator('.hps-native-observation')).toBeHidden();
  await expect(chat.locator('.hps-shell')).toHaveCSS('background-color','rgb(21, 29, 25)');
  await input.fill('보존할 초안');
  await chat.getByRole('button',{name:/글쓰기나 정리/}).click();
  await expect(input).toHaveValue('보존할 초안\n1. 글쓰기나 정리: 메일, 보고서, 메모');
  await expect(input).toBeFocused();
  checks.push('native green theme: small assistant and clickable question prepare reply without losing draft');
  const screenshot=async name=>{const encoded=await ctx.app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));await writeFile(join(output,name+'.png'),Buffer.from(encoded,'base64'));};
  await screenshot('native-compact-question');
  await chat.getByRole('button',{name:'대화 메뉴',exact:true}).click();
  await chat.getByRole('menuitem',{name:'설정',exact:true}).click();
  await expect(chat.getByRole('dialog',{name:'대화 설정',exact:true})).toBeVisible();
  await chat.getByText('응답 고급 설정',{exact:true}).click();
  await screenshot('native-compact-settings');
  await chat.getByRole('button',{name:'대화 설정 닫기'}).press('Escape');
  await expect(chat.getByRole('dialog',{name:'대화 설정',exact:true})).toBeHidden();
  await expect(chat.getByRole('button',{name:'대화 메뉴',exact:true})).toBeFocused();
  await expect(input).toHaveValue('보존할 초안\n1. 글쓰기나 정리: 메일, 보고서, 메모');
  checks.push('native modal settings: model/effort/usage/observation hidden on work surface; close restores focus and draft');
  await chat.getByRole('button',{name:'새 작업',exact:true}).click();
  await expect(input).toHaveValue('');
  await screenshot('native-compact-empty');
  checks.push('native new task returns a compact empty personal conversation');
  const extension=join(process.env.HPS_APP_PATH,'Contents/Resources/app/extensions/hypeproof-chat/dist/extension.js');
  await writeFile(join(output,'result.json'),JSON.stringify({status:'PASS',scope:'isolated Mac Dev app + real extension/browser UI, synthetic local Service and seeded messages; zero model inference, not signed RC or customer acceptance',checks,calls,extensionSha256:createHash('sha256').update(await readFile(extension)).digest('hex')},null,2));
  console.log(JSON.stringify({status:'PASS',checks,output}));
} catch(error) {
  await writeFile(join(output,'result.json'),JSON.stringify({status:'BLOCKED_OR_FAIL',error:String(error),checks,calls},null,2));throw error;
} finally { if(ctx)await closeApp(ctx);await new Promise(resolve=>server.close(resolve));await rm(temp,{recursive:true,force:true}); }
