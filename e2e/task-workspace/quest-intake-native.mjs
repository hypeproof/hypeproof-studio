// REQ-QUEST-* (#4283) — intent → at most two key questions → 퀘스트 생성하기 → quest list → first step, on the
// isolated Mac development copy of the installed shell with the real extension, store and webview.
//
//   HPS_APP_PATH="<dev copy>.app" HPS_QUEST_EVIDENCE=e2e/test-results/quest-intake node --experimental-strip-types e2e/task-workspace/quest-intake-native.mjs
//
// Real: shell, extension host, task store, chat webview, reply choices, quest cards, work canvas, the coach's HTTP calls.
// Synthetic: a loopback Service serving a personal adult seat, and a scripted model behind its /v1/chat/completions. The
// model's replies are fixed, so this proves what the app does with them (guidance sent, cap counted, offer, one structured
// call, quest, step check), not how a real model follows the guidance.
import http from 'node:http';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { expect } from '@playwright/test';

if (!process.env.HPS_APP_PATH) throw Error('Set HPS_APP_PATH to the isolated development app.');
if (process.env.HPS_APP_PATH.startsWith('/Applications/')) throw Error('Never the installed app.');
const output = resolve(process.env.HPS_QUEST_EVIDENCE ?? 'e2e/test-results/quest-intake');
await mkdir(output, { recursive: true });
const temp = await mkdtemp(join(tmpdir(), 'hps-quest-intake-service-'));
const payload = Buffer.from(JSON.stringify({ c: 'studio-native-trial', n: 'synthetic-personal', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
process.env.HPS_E2E_TOKEN_FILE = join(temp, 'synthetic-token');
await writeFile(process.env.HPS_E2E_TOKEN_FILE, payload + '.synthetic-not-a-credential', { mode: 0o600 });
const bundled = await build({ entryPoints: [import.meta.resolve('@hypeproof/service-testkit/src/profiles/studio-native-trial.ts').replace('file://', '')], bundle: true, write: false, platform: 'node', format: 'esm', loader: { '.md': 'text' } });
const { profile: base } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const profile = { ...base, profile_id: base.id, activity_id: 'b'.repeat(64), activity_kind: 'personal', display_name: '퀘스트 검증', observation: undefined, coach_runtime: 'proxy', analytics: { log_metadata: false, log_user_messages: false } };

const INTENT = '매번 비슷한 메일을 보내는데, 좀 편하게 할 수 있을까?';
const REPLIES = [
  '반복되는 메일을 줄여 볼게요. 먼저 하나만 여쭤볼게요.\n\n주로 어떤 내용의 메일을 반복해서 보내시나요?\n아래에서 골라 주세요.\n1. 서류 제출 요청\n2. 일정·마감 안내\n3. 미응답자에게 재안내',
  '좋아요. 하나만 더 여쭤볼게요.\n\n메일에 꼭 들어가야 할 내용이나 말투가 있나요?\n아래에서 골라 주세요.\n1. 이름·서류·마감일을 넣어 정중하고 짧게 [추천]\n2. 친근한 말투로 길게',
  '알겠어요. 명단의 사람마다 이름과 서류, 마감일을 넣어 정중하고 짧은 요청 메일을 만드는 일이네요.\n\n**목표 정리:** 명단의 사람마다 이름·서류·마감일을 넣은 정중한 서류 제출 요청 메일을 쉽게 보내기',
  '좋아요, 업무 정리부터 해요. 이 메일은 누구에게, 어떤 서류를, 언제까지 받으려는 건가요? 평소 보내던 메일 한 통을 붙여 주시면 그걸 바탕으로 정리할게요.',
];
const QUEST = { title: '서류 제출 요청 메일 자동화', steps: [
  { title: '업무 정리', description: '받는 사람, 요청할 서류, 마감일을 정해요.' },
  { title: 'Google 연결', description: '내 계정으로 메일을 보낼 준비를 해요.' },
  { title: '명단 연결', description: '시트에서 이름·서류·마감일을 불러와요.' },
  { title: '미리보기·수정', description: '세 명에게 갈 메일을 보고 말투를 고쳐요.' },
  { title: '저장·완료', description: '다음에도 쓰도록 저장해요.' },
] };

const calls = [], turns = [], structured = [];
const readBody = request => new Promise(done => { let data = ''; request.on('data', chunk => { data += chunk; }); request.on('end', () => done(data)); });
const lastUser = body => { const user = [...(body.messages ?? [])].reverse().find(message => message.role === 'user'); return typeof user?.content === 'string' ? user.content : (user?.content ?? []).map(part => part.text ?? '').join('\n'); };
const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://local').pathname;
  calls.push({ path: pathname, method: request.method });
  if (pathname === '/v1/chat/completions' && request.method === 'POST') {
    const body = JSON.parse(await readBody(request) || '{}');
    const text = lastUser(body);
    if (body.stream === false) {
      structured.push({ model: body.model ?? null, stream: body.stream, prompt: text });
      response.setHeader('content-type', 'application/json');
      response.setHeader('x-hps-model', 'claude-haiku-5-5');
      response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(QUEST) } }] }));
      return;
    }
    const reply = REPLIES[Math.min(turns.length, REPLIES.length - 1)];
    turns.push({ guidance: text.split('\n').filter(line => line.startsWith('[Studio')), learner: text.split('\n\n')[0] });
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    for (const piece of reply.match(/[\s\S]{1,24}/g)) response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
    response.write('data: [DONE]\n\n');
    response.end();
    return;
  }
  response.setHeader('content-type', 'application/json');
  if (pathname === '/v1/profile') response.end(JSON.stringify(profile));
  else if (pathname === '/v1/activity') response.end(JSON.stringify({ activity_id: profile.activity_id }));
  else if (pathname === '/v1/health') response.end('{}');
  else if (pathname === '/v1/access') response.end(JSON.stringify({ schema: 'hps-access-view/1', configured: false, as_of: new Date().toISOString(), choices: [] }));
  else response.writeHead(404).end('{}');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const { launchApp, closeApp, chatFrame, previewFrame } = await import('../fixtures/app.ts');
const checks = [];
let ctx;
try {
  ctx = await launchApp({ proxyUrl: origin + '/v1', preseedToken: true, stayOnStart: true, preseedCoach: { name: 'HypeProof' } });
  await ctx.win.setViewportSize({ width: 1440, height: 960 }).catch(() => {});
  const snapshot = async name => {
    await new Promise(done => setTimeout(done, 400));
    await ctx.win.screenshot({ path: join(output, name + '.png'), timeout: 15000 });
  };
  await snapshot('00-launched');
  const chat = await Promise.race([chatFrame(ctx.win), new Promise((_, fail) => setTimeout(() => fail(new Error('chat surface did not open in 60 s')), 60000))]);
  await expect(chat.locator('.tw-workspace')).toBeVisible({ timeout: 30000 });
  const input = chat.locator('.hps-input textarea');
  const latest = () => chat.locator('.hps-reply-question').last();
  const settled = async count => { await expect.poll(() => turns.length, { timeout: 30000 }).toBe(count); await expect(input).toBeEnabled({ timeout: 30000 }); };

  // 1. The intent.
  await input.fill(INTENT);
  await snapshot('01-intent');
  await input.press('Enter');
  // A personal activity outside its own folder asks once (REQ-STUDIO-FOLDER-CONSENT); chat-only is enough here.
  const consent = chat.getByRole('button', { name: '제한 모드로 열기' });
  await consent.waitFor({ state: 'visible', timeout: 15000 }).then(() => consent.click()).catch(() => {});
  await settled(1);
  await expect(latest()).toContainText('주로 어떤 내용의 메일', { timeout: 20000 });
  await snapshot('02-question-1');
  checks.push('intent turn carries the intake guidance with 2 questions left; question 1 shows suggested answers');

  // 2. Question 1 answered by picking a suggested answer.
  await latest().getByRole('radio', { name: /서류 제출 요청/ }).click();
  await latest().getByRole('button', { name: '선택한 답변 보내기' }).click();
  await settled(2);
  await expect(latest()).toContainText('꼭 들어가야 할 내용', { timeout: 20000 });
  await snapshot('03-question-2');
  checks.push('a picked answer is sent; question 2 has 1 question left');

  // 3. Question 2 answered; the third turn is told to stop asking and the offer appears.
  await latest().getByRole('radio', { name: /정중하고 짧게/ }).click();
  await latest().getByRole('button', { name: '선택한 답변 보내기' }).click();
  await settled(3);
  const offer = chat.getByTestId('quest-offer');
  await expect(offer).toBeVisible({ timeout: 20000 });
  await expect(offer).toContainText('명단의 사람마다 이름·서류·마감일을 넣은 정중한 서류 제출 요청 메일을 쉽게 보내기');
  await expect(chat.locator('.hps-reply-question')).toHaveCount(0);
  await snapshot('04-offer');
  checks.push('after two questions the third turn is told to stop; the summary card shows 퀘스트 생성하기');

  // 4. 퀘스트 생성하기 → one structured call → quest card + canvas → the conversation continues on step 1.
  await offer.getByRole('button', { name: '퀘스트 생성하기' }).click();
  const card = chat.getByTestId('quest-card');
  await expect(card).toBeVisible({ timeout: 30000 });
  await expect(card.locator('.hps-quest-step')).toHaveCount(5);
  await expect(card.locator('[aria-current="step"]')).toContainText('업무 정리');
  await settled(4);
  const transcript = await chat.locator('.hps-messages').innerText();
  await writeFile(join(output, 'transcript.txt'), transcript);
  expect(transcript).toContain('「업무 정리」 단계부터 시작할게요.');
  expect(transcript).toContain('업무 정리부터 해요');
  const canvas = (await previewFrame(ctx.win)).frameLocator("#frame");
  await expect(canvas.locator('.eyebrow')).toHaveText('QUEST', { timeout: 20000 });
  await expect(canvas.locator('[data-node-id="step-1"]')).toHaveAttribute('aria-current', 'step');
  await expect(canvas.locator('li.node')).toHaveCount(5);
  await snapshot('05-quest-list');
  checks.push('one non-streaming call with no model id; 5 ordered steps, step 1 current, quest canvas drawn; the coach continues on step 1');

  // 5. The learner checks step 1: step 2 becomes current, and the next turn names step 2.
  await card.getByRole('button', { name: '「업무 정리」 완료' }).click();
  await expect(card.locator('[aria-current="step"]')).toContainText('Google 연결', { timeout: 10000 });
  await expect(card).toContainText('1 / 5 완료');
  await expect(canvas.locator('[data-node-id="step-2"]')).toHaveAttribute('aria-current', 'step', { timeout: 10000 });
  await snapshot('06-step-checked');
  checks.push('only the learner check completes a step; the next step becomes current');

  // Guidance and cost evidence from what the app actually sent.
  expect(turns[0].guidance.join(' ')).toContain('지금 2개 남음');
  expect(turns[1].guidance.join(' ')).toContain('지금 1개 남음');
  expect(turns[2].guidance.join(' ')).toContain('질문은 여기까지');
  expect(turns[3].guidance.join(' ')).toContain('지금 단계 1. 업무 정리');
  expect(structured).toHaveLength(1);
  expect(structured[0].model).toBeNull();
  expect(structured[0].prompt).toContain('목표: 명단의 사람마다');

  const extension = join(process.env.HPS_APP_PATH, 'Contents/Resources/app/extensions/hypeproof-chat/dist/extension.js');
  const extensionSha256 = createHash('sha256').update(await readFile(extension)).digest('hex');
  await writeFile(join(output, 'result.json'), JSON.stringify({
    status: 'PASS',
    scope: 'Mac development copy of the installed shell + real extension/store/webview; synthetic loopback Service with a scripted model; not a real-model or Windows or release acceptance',
    checks, turns: turns.map(turn => turn.guidance[0] ?? null), structuredCalls: structured.map(({ model, stream }) => ({ model, stream })),
    modelCallsPerFlow: { coachTurns: turns.length, structured: structured.length }, extensionSha256,
  }, null, 2));
  console.log(JSON.stringify({ status: 'PASS', checks: checks.length, output }));
} catch (error) {
  if (ctx) {
    await ctx.win.screenshot({ path: join(output, 'failure.png'), timeout: 15000 }).catch(() => null);
  }
  await writeFile(join(output, 'result.json'), JSON.stringify({ status: 'FAIL', checks, turns, structured, calls: calls.slice(-40), error: String(error) }, null, 2));
  throw error;
} finally { if (ctx) await closeApp(ctx); await new Promise(done => server.close(done)); await rm(temp, { recursive: true, force: true }); }
