// E5 (#3776): the real host answers a question card. VS Code is replaced at the bundle boundary and fetch is intercepted;
// the card reaches the inbox through the real sync loop and store.
// Designed behavior: nothing is sent until the learner presses; an answer counts as sent only after a 2xx and is remembered
// across a restart; a retry of the same answer reuses its key; a missing consent shows the class data notice, records the
// consent and retries once; a decline sends nothing and keeps the card; every refusal is said, none is called sent.
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NOTICE = { version: 'class-data-v1', title: '수업 참여 데이터 안내', body: 'HypeProof가 수집합니다.', accept: '동의하고 수업에 연결', decline: '동의하지 않음' };
const OBJ = '55555555-5555-4555-8555-555555555555', DIST = 'dddddddd-dddd-4ddd-8ddd-000000000009';
const sha = (s) => createHash('sha256').update(s).digest('hex');
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = `${b64({ u: 'kim', c: 'corp-a', p: 'adult', jti: 'j1' })}.sig`;
// The bytes the Service hashes for this card, written out from the contract.
const CANONICAL = '["hps-classroom-content/1","question","확인 질문","지금 실습이 잘 되나요?",[],["choice",["잘 된다","막혔다"]]]';
const CARD = { offer_key: sha('offer-q').slice(0, 32), distribution_id: DIST, seq: 1, object_id: OBJ, revision: 1, kind: 'question', schema: 'hps-classroom-content/1', title: '확인 질문', body: '지금 실습이 잘 되나요?', links: [], question: { type: 'choice', options: ['잘 된다', '막혔다'] }, content_hash: sha(CANONICAL), issued_at: 1, expires_at: 2, apply_within_ms: 30000 };

let bundled;
test.before(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hps-question-host-'));
  bundled = join(dir, 'host.cjs');
  await build({
    entryPoints: [fileURLToPath(new URL('../src/classroomOpsHost.ts', import.meta.url))], outfile: bundled, bundle: true, platform: 'node', format: 'cjs', logLevel: 'error',
    plugins: [{ name: 'vscode-stub', setup(b) {
      b.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ loader: 'js', contents: `
        const log = (kind) => async (message, options, ...actions) => { (globalThis.__dialogs ??= []).push({ kind, message, options, actions }); return options && options.modal ? (globalThis.__answer ?? undefined) : undefined; };
        export const window = { showInformationMessage: log('info'), showWarningMessage: log('warn'), showInputBox: async () => 'ABCD-EFGH-JKLM' };
        export const workspace = { getConfiguration: () => ({ get: () => 'https://service.invalid/v1' }) };` }));
    } }],
  });
});

/** `answers` = what the Service says to each answer POST, in order (a function of the request body, or 'network'). */
async function fixture(t, { answers = [], dir: reuse } = {}) {
  const dir = reuse ?? await mkdtemp(join(tmpdir(), 'hps-question-'));
  const originalFetch = globalThis.fetch;
  globalThis.__dialogs = []; globalThis.__answer = NOTICE.accept;
  const requests = [], queue = [...answers];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname, body = init.body ? JSON.parse(init.body) : null;
    requests.push({ path, body, auth: init.headers?.authorization });
    if (path.endsWith('/participation/notice')) return Response.json({ notice: NOTICE });
    if (path.endsWith('/classroom/ops/connect')) return Response.json({ credential: 'SYNTHETIC-CRED', grant_id: 'grant-1', class_run_id: 'run-1', seat_id: 'A1', expires_at: Date.now() + 3_600_000, poll_after_ms: 5, student: { u: 'kim', c: 'corp-a', p: 'adult' }, run: { starts_at: Date.now() - 60_000, ends_at: Date.now() + 3_600_000 }, lesson: null }, { status: 201 });
    if (path.endsWith('/participation/consent')) return Response.json({ consent: body.consent, notice_version: body.notice_version }, { status: 201 });
    if (path.endsWith('/classroom/ops/sync')) return Response.json({ ack: { boot_id: body.boot_id, contiguous_seq: 0, missing: [] }, poll_after_ms: 60000, server_time: Date.now(), distribution: { items: [CARD] } });
    if (path.endsWith('/participation/answers')) { const next = queue.shift() ?? (() => Response.json({ answered: true, answer_revision: 1, answered_at: 7 }, { status: 201 })); if (next === 'network') throw new TypeError('fetch failed'); return next(body); }
    return Response.json({ reason: 'unavailable' }, { status: 503 });
  };
  const { ClassroomOpsHost } = createRequire(import.meta.url)(bundled);
  const state = t.state ?? new Map(), secrets = t.secrets ?? new Map(), subscriptions = [];
  const context = { globalState: { get: (k) => state.get(k), update: async (k, v) => { v === undefined ? state.delete(k) : state.set(k, v); } }, secrets: { get: async (k) => secrets.get(k), store: async (k, v) => secrets.set(k, v), delete: async (k) => secrets.delete(k) }, globalStorageUri: { fsPath: dir }, subscriptions };
  const host = new ClassroomOpsHost(context, () => ({ idleMs: 0, status: 'idle' }), { setHold() {} }, () => {});
  host.profileResult({ ok: true }, TOKEN);
  const close = async () => { for (const s of subscriptions) s.dispose?.(); globalThis.fetch = originalFetch; };
  return { host, requests, dir, state, secrets, close };
}
const cardOf = async (host, deadline = Date.now() + 5000) => {
  for (;;) { const v = await host.inboxView(); const c = v.cards.find((x) => x.object_id === OBJ); if (c || Date.now() > deadline) return { view: v, card: c }; await new Promise((r) => setTimeout(r, 20)); }
};
const answerPosts = (f) => f.requests.filter((r) => r.path.endsWith('/participation/answers'));
async function connected(t, o) {
  const f = await fixture(t, o);
  t.after(async () => { await f.host.disconnectInteractively().catch(() => {}); await f.close(); if (!o?.keep) await rm(f.dir, { recursive: true, force: true }); });
  await f.host.connectInteractively();
  const { view, card } = await cardOf(f.host);
  assert.ok(card, 'the question card reached the inbox through sync');
  return { ...f, view, card };
}

test('the app declares inbox_question at connect and sync; the card shows its form, unanswered, and nothing is sent until a press', async (t) => {
  const f = await connected(t);
  const connect = f.requests.find((r) => r.path.endsWith('/classroom/ops/connect')), sync = f.requests.find((r) => r.path.endsWith('/classroom/ops/sync'));
  assert.ok(connect.body.capabilities.includes('inbox_question') && sync.body.capabilities.includes('inbox_question'));
  assert.ok(connect.body.capabilities.length <= 32 && sync.body.capabilities.length <= 32, 'the Service ignores a list over 32');
  assert.deepEqual([f.card.kind, f.card.body, f.card.question, f.card.answer], ['question', '지금 실습이 잘 되나요?', CARD.question, { sent: null }]);
  assert.equal(answerPosts(f).length, 0, 'arrival sends nothing');
});

test('submit: one POST with the seat credential and the card identity; sent only after the 2xx, and still sent after a restart', async (t) => {
  const f = await connected(t, { keep: true });
  await f.host.inboxAnswer(OBJ, 1, f.view.generation, { choice: 1 });
  const [post] = answerPosts(f);
  assert.equal(post.auth, 'Bearer SYNTHETIC-CRED');
  assert.match(post.body.idempotency_key, /^[A-Za-z0-9-]{8,64}$/);
  assert.deepEqual({ ...post.body, idempotency_key: 'k' }, { idempotency_key: 'k', distribution_id: DIST, object_id: OBJ, revision: 1, content_hash: CARD.content_hash, answer: { choice: 1 } });
  const after = (await cardOf(f.host)).card;
  assert.deepEqual([after.answer, after.answer_note], [{ sent: { choice: 1 } }, undefined]);
  // Restart: a new host over the same device storage resumes the stored connection.
  await f.close();
  const g = await fixture({ ...t, state: f.state, secrets: f.secrets }, { dir: f.dir });
  t.after(async () => { await g.host.disconnectInteractively().catch(() => {}); await g.close(); await rm(f.dir, { recursive: true, force: true }); });
  await g.host.resume();
  assert.deepEqual((await cardOf(g.host)).card.answer, { sent: { choice: 1 } }, 'the device remembers its own confirmed answer');
});

test('a failed attempt is never called sent; retrying the same answer reuses its key, a changed answer gets a new one', async (t) => {
  const f = await connected(t, { answers: ['network', (b) => Response.json({ reason: 'storage' }, { status: 503 })] });
  await f.host.inboxAnswer(OBJ, 1, f.view.generation, { choice: 0 });
  let card = (await cardOf(f.host)).card;
  assert.deepEqual(card.answer, { sent: null }); assert.match(card.answer_note, /서버에 연결하지 못해 답을 보내지 않았습니다/);
  await f.host.inboxAnswer(OBJ, 1, f.view.generation, { choice: 0 });
  card = (await cardOf(f.host)).card;
  assert.deepEqual(card.answer, { sent: null }); assert.match(card.answer_note, /답을 보내지 못했습니다/);
  await f.host.inboxAnswer(OBJ, 1, f.view.generation, { choice: 0 });
  const keys = answerPosts(f).map((r) => r.body.idempotency_key);
  assert.equal(new Set(keys).size, 1, 'three tries of one answer are one answer to the Service');
  assert.deepEqual((await cardOf(f.host)).card.answer, { sent: { choice: 0 } });
  await f.host.inboxAnswer(OBJ, 1, f.view.generation, { skipped: true });
  const last = answerPosts(f).at(-1);
  assert.notEqual(last.body.idempotency_key, keys[0]); assert.deepEqual(last.body.answer, { skipped: true });
});

test('consent_required: the class data notice is shown as at connect, consent is recorded, the same answer is retried once', async (t) => {
  const f = await connected(t, { answers: [() => Response.json({ reason: 'consent_required', notice_version: 'class-data-v1' }, { status: 409 })] });
  const before = f.requests.length; globalThis.__dialogs = [];
  await f.host.inboxAnswer(OBJ, 1, f.view.generation, { choice: 0 });
  const modal = globalThis.__dialogs.find((d) => d.options?.modal);
  assert.deepEqual([modal.message, modal.options.detail, modal.actions], [NOTICE.title, NOTICE.body, [NOTICE.accept, NOTICE.decline]]);
  const later = f.requests.slice(before).map((r) => r.path.split('/').slice(-2).join('/'));
  assert.deepEqual(later.filter((p) => !p.endsWith('ops/sync')), ['participation/answers', 'participation/notice', 'participation/consent', 'participation/answers']);
  const [first, retry] = answerPosts(f);
  assert.equal(first.body.idempotency_key, retry.body.idempotency_key, 'the retry is the same answer');
  assert.deepEqual((await cardOf(f.host)).card.answer, { sent: { choice: 0 } });
});

test('consent declined (or the dialog closed): no consent, no retry, the card stays, the learner is told it was not sent', async (t) => {
  for (const answer of [NOTICE.decline, undefined]) {
    const f = await connected(t, { answers: [() => Response.json({ reason: 'consent_required' }, { status: 409 })] });
    const consentsBefore = f.requests.filter((r) => r.path.endsWith('/participation/consent')).length;
    globalThis.__answer = answer;
    await f.host.inboxAnswer(OBJ, 1, f.view.generation, { choice: 0 });
    assert.equal(answerPosts(f).length, 1);
    assert.equal(f.requests.filter((r) => r.path.endsWith('/participation/consent')).length, consentsBefore);
    const card = (await cardOf(f.host)).card;
    assert.ok(card && !card.withdrawn); assert.deepEqual(card.answer, { sent: null });
    assert.match(card.answer_note, /동의하지 않아 답을 보내지 않았습니다/);
  }
});

test('each refusal is said in its own words, and none of them is called sent', async (t) => {
  const cases = [['withdrawn', 409, /회수해/], ['not_offered', 404, /이 좌석에 보낸 질문이 아니어서/], ['content_mismatch', 409, /질문이 바뀌어/], ['run_ended', 409, /수업이 끝나/], ['ops_questions_disabled', 403, /질문 카드를 꺼 두어/], ['ops_grant_revoked', 401, /수업 연결이 끝나/], ['answer_invalid', 400, /답 형식이 맞지 않아/]];
  const f = await connected(t, { answers: cases.map(([reason, status]) => () => Response.json({ reason }, { status })) });
  for (const [reason, , note] of cases) {
    await f.host.inboxAnswer(OBJ, 1, f.view.generation, { choice: 0 });
    const card = (await cardOf(f.host)).card;
    assert.deepEqual(card.answer, { sent: null }, reason); assert.match(card.answer_note, note, reason);
  }
});

test('nothing is sent for a card drawn under an older connection, an answer the form does not allow, or a card that is not there', async (t) => {
  const f = await connected(t);
  await f.host.inboxAnswer(OBJ, 1, f.view.generation - 1, { choice: 0 });
  await f.host.inboxAnswer(OBJ, 1, f.view.generation, { choice: 5 });
  await f.host.inboxAnswer(OBJ, 2, f.view.generation, { choice: 0 });
  await f.host.inboxAnswer('66666666-6666-4666-8666-666666666666', 1, f.view.generation, { choice: 0 });
  assert.equal(answerPosts(f).length, 0);
  assert.match((await cardOf(f.host)).card.answer_note, /답 형식이 맞지 않아/);
});
