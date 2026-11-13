// E5 (#3778): the real host connects with the class code on the projector. VS Code is replaced at the bundle boundary
// and fetch is intercepted. Contract: docs/requirements/classroom-join-code.md.
// Designed behavior: after the notice, the one input takes an 8-character class code or the 12-character seat code. A class
// code goes to /join with the learning token, after the learner confirmed the handle read from that token; without a token
// nothing is sent. A refusal is said in its own words and connects nothing. The 12-character path is what it was.
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NOTICE = { version: 'class-data-v1', title: '수업 참여 데이터 안내', body: 'HypeProof가 수집합니다.', accept: '동의하고 수업에 연결', decline: '동의하지 않음' };
const TOKEN = `${Buffer.from(JSON.stringify({ u: 's07', c: 'corp-a', p: 'adult' })).toString('base64url')}.SIGNATURE-PART`;
const CONNECTED = { credential: 'SYNTHETIC-CRED', grant_id: 'grant-1', class_run_id: 'run-1', seat_id: 'A3', expires_at: Date.now() + 3_600_000, poll_after_ms: 60000, lesson: null };

let bundled;
test.before(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hps-join-host-'));
  bundled = join(dir, 'host.cjs');
  await build({
    entryPoints: [fileURLToPath(new URL('../src/classroomOpsHost.ts', import.meta.url))], outfile: bundled, bundle: true, platform: 'node', format: 'cjs', logLevel: 'error',
    plugins: [{ name: 'vscode-stub', setup(b) {
      b.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ loader: 'js', contents: `
        const log = (kind) => async (message, options, ...actions) => { globalThis.__dialogs.push({ kind, message, options, actions }); return options && options.modal ? globalThis.__pick(message, actions) : undefined; };
        export const window = { showInformationMessage: log('info'), showWarningMessage: log('warn'), showInputBox: async (o) => { globalThis.__dialogs.push({ kind: 'input', options: o }); return globalThis.__code; } };
        export const workspace = { getConfiguration: () => ({ get: () => 'https://service.invalid/v1' }) };` }));
    } }],
  });
});

async function fixture(t, { code, token = TOKEN, confirm = true, join: joinReply = () => Response.json(CONNECTED, { status: 201 }) }) {
  const dir = await mkdtemp(join(tmpdir(), 'hps-join-'));
  const originalFetch = globalThis.fetch, subscriptions = [], logs = [];
  globalThis.__dialogs = []; globalThis.__code = code;
  globalThis.__pick = (message, actions) => message === NOTICE.title ? NOTICE.accept : confirm ? actions[0] : undefined;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname, body = init.body ? JSON.parse(init.body) : null; requests.push({ path, body, auth: init.headers?.authorization });
    if (path.endsWith('/participation/notice')) return Response.json({ notice: NOTICE });
    if (path.endsWith('/classroom/ops/join')) return joinReply();
    if (path.endsWith('/classroom/ops/connect')) return Response.json(CONNECTED, { status: 201 });
    if (path.endsWith('/participation/consent')) return Response.json({ consent: true, notice_version: body.notice_version }, { status: 201 });
    return Response.json({ reason: 'unavailable' }, { status: 503 });
  };
  const { ClassroomOpsHost } = createRequire(import.meta.url)(bundled);
  const state = new Map(), secrets = new Map(token ? [['hypeproofChat.workshopToken', token]] : []);
  const context = { globalState: { get: (k) => state.get(k), update: async (k, v) => { v === undefined ? state.delete(k) : state.set(k, v); } }, secrets: { get: async (k) => secrets.get(k), store: async (k, v) => secrets.set(k, v), delete: async (k) => secrets.delete(k) }, globalStorageUri: { fsPath: dir }, subscriptions };
  const host = new ClassroomOpsHost(context, () => ({ idleMs: 0, status: 'idle' }), { setHold() {} }, (line) => logs.push(line));
  t.after(async () => { await host.disconnectInteractively().catch(() => {}); for (const s of subscriptions) s.dispose?.(); globalThis.fetch = originalFetch; await rm(dir, { recursive: true, force: true }); });
  await host.connectInteractively();
  return { host, requests, secrets, logs, paths: requests.map((r) => r.path.replace('/v1/classroom/ops/', '')) };
}
const last = () => globalThis.__dialogs.at(-1).message;

test('the one input takes a class code (8, no 0 O 1 I L) or a seat code (12), and says which when neither', async (t) => {
  await fixture(t, { code: undefined });
  const { validateInput, prompt } = globalThis.__dialogs.find((d) => d.kind === 'input').options;
  assert.match(prompt, /수업 코드\(8자리\) 또는 좌석 코드\(12자리\)/);
  for (const ok of ['ABCD-EFGH', 'abcd efgh', 'Z2Z3-U4U5', 'ABCD-EFGH-JKLM', '2345-6789-ABCD']) assert.equal(validateInput(ok), null, ok);
  for (const bad of ['ABC0-EFGH', 'ABCO-EFGH', 'ABC1-EFGH', 'ABCI-EFGH', 'ABCL-EFGH', 'ABCD-EFG', 'ABCD-EFGH-JK', '']) assert.match(validateInput(bad), /8자리 또는 좌석 코드 12자리/, bad);
});

test('class code with a learning token: the handle is confirmed, then /join carries the token and the device fields, and the seat connects like /connect', async (t) => {
  const f = await fixture(t, { code: 'ABCD-EFGH' });
  const confirm = globalThis.__dialogs.find((d) => String(d.message).startsWith('handle'));
  assert.deepEqual([confirm.message, confirm.options.modal], ['handle s07(으)로 이번 수업에 연결합니다.', true]);
  assert.deepEqual(f.paths, ['participation/notice', 'join', 'participation/consent'], 'notice first, never /connect');
  const joinReq = f.requests.find((r) => r.path.endsWith('/join'));
  assert.equal(joinReq.auth, `Bearer ${TOKEN}`);
  assert.deepEqual(Object.keys(joinReq.body).sort(), ['app_instance_id', 'app_version', 'boot_id', 'capabilities', 'code', 'protocol']);
  assert.equal(joinReq.body.code, 'ABCD-EFGH'); assert.ok(joinReq.body.capabilities.includes('inbox_question'));
  assert.equal(f.secrets.get('hypeproof.classroomOps.credential'), 'SYNTHETIC-CRED');
  assert.equal(f.host.helpConnection()?.seat_id, 'A3');
  assert.match(last(), /수업에 연결했습니다 \(좌석 A3\)/);
  const shown = JSON.stringify(globalThis.__dialogs) + f.logs.join('\n');
  assert.ok(!shown.includes('SIGNATURE-PART') && !shown.includes(TOKEN.split('.')[0]), 'the token is never shown or logged');
});

test('class code without a learning token: says to enter Studio first and sends nothing', async (t) => {
  const f = await fixture(t, { code: 'ABCD-EFGH', token: null });
  assert.deepEqual(f.paths, ['participation/notice']);
  assert.equal(last(), '먼저 수업 참여 코드로 Studio에 들어온 뒤 다시 연결하세요.');
});

test('a token without a handle is treated as no token; a closed confirmation sends nothing', async (t) => {
  const a = await fixture(t, { code: 'ABCD-EFGH', token: `${Buffer.from('{"c":"corp-a"}').toString('base64url')}.x` });
  assert.deepEqual(a.paths, ['participation/notice']); assert.equal(last(), '먼저 수업 참여 코드로 Studio에 들어온 뒤 다시 연결하세요.');
  const b = await fixture(t, { code: 'ABCD-EFGH', confirm: false });
  assert.deepEqual(b.paths, ['participation/notice']);
});

for (const [name, status, reason, text] of [
  ['code_invalid', 403, 'code_invalid', '수업 코드가 맞지 않거나 만료됐습니다. 강사 화면의 코드를 다시 확인하세요.'],
  ['seat_not_found', 403, 'seat_not_found', '이번 수업 명단에 없습니다. 강사에게 알려 주세요.'],
  ['class_token_invalid', 401, 'class_token_invalid', /학습 토큰을 확인하지 못해 연결하지 않았습니다/],
  ['class_token_required', 403, 'class_token_required', /학습 토큰을 확인하지 못해 연결하지 않았습니다/],
  ['rate_limited', 429, 'rate_limited', /1분 뒤 다시 시도하세요/],
  ['ops_disabled', 404, 'ops_disabled', /수업 연결 기능이 켜져 있지 않습니다/],
]) test(`join refused (${name}): said in its own words, nothing stored, no consent`, async (t) => {
  const f = await fixture(t, { code: 'ABCD-EFGH', join: () => Response.json({ reason }, { status }) });
  if (typeof text === 'string') assert.equal(last(), text); else assert.match(last(), text);
  assert.deepEqual(f.paths, ['participation/notice', 'join']);
  assert.equal(f.secrets.get('hypeproof.classroomOps.credential'), undefined); assert.equal(f.host.helpConnection(), null);
});

test('the 12-character seat code still goes to /connect exactly as before: no token, no confirmation', async (t) => {
  const f = await fixture(t, { code: 'ABCD-EFGH-JKLM' });
  assert.deepEqual(f.paths, ['participation/notice', 'connect', 'participation/consent']);
  const c = f.requests.find((r) => r.path.endsWith('/connect'));
  assert.equal(c.auth, undefined, 'the learning token never rides the seat-code path');
  assert.deepEqual(Object.keys(c.body), ['ticket', 'app_instance_id', 'boot_id', 'protocol', 'capabilities', 'app_version']);
  assert.equal(c.body.ticket, 'ABCD-EFGH-JKLM');
  assert.ok(!globalThis.__dialogs.some((d) => String(d.message).startsWith('handle')));
  assert.match(last(), /수업에 연결했습니다 \(좌석 A3\)/);
});
