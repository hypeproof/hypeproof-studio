// CGP-ART-R-005: the real host places an instructor comment on this learner's approved page version and answers it.
// VS Code is replaced at the bundle boundary and fetch is intercepted; the comment reaches the inbox through the real sync
// loop and store, the learner's approvals come from spool event lines, and the current page from a stubbed read.
// Designed behavior: the app declares inbox_comment; a comment is shown only on a version this learner approved, as
// "current" while index.html is that version and "previous" once it changed; a comment about a version the learner never
// approved (or with no way to tell) is not shown and cannot be answered; {handled, reply} is sent only on a press and is
// "sent" only after the Service's 2xx; the comment's text never leaves the inbox.
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
const OBJ = '66666666-6666-4666-8666-666666666666', DIST = 'dddddddd-dddd-4ddd-8ddd-000000000010';
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = `${b64({ u: 'kim', c: 'corp-a', p: 'adult', jti: 'j1' })}.sig`;
const PAGE_V1 = '<!doctype html><html><body><h1>내 페이지</h1></body></html>', PAGE_V2 = '<!doctype html><html><body><h1>내 페이지 2</h1></body></html>';
const ANCHOR = { artifact_sha256: sha(PAGE_V1), rect: { x: 0, y: 0, w: 333, h: 333 } };
const BODY = '<a href="https://example.com">여기</a> 제목 색이 배경과 잘 구분돼요.';
// The bytes the Service hashes for this comment, written out from the contract (Service normalizeAnchor/contentCanonical).
const CANONICAL = JSON.stringify(['hps-classroom-content/1', 'comment', '강사 의견', BODY, [], ['rect', ANCHOR.artifact_sha256, 0, 0, 333, 333]]);
const CARD = { offer_key: sha('offer-c').slice(0, 32), distribution_id: DIST, seq: 1, object_id: OBJ, revision: 1, kind: 'comment', schema: 'hps-classroom-content/1', title: '강사 의견', body: BODY, links: [], anchor: ANCHOR, content_hash: sha(CANONICAL), issued_at: 0, expires_at: Date.now() + 3_600_000, apply_within_ms: 30_000 };
const approvalLine = (page, approved, ts) => JSON.stringify({ schema_version: 1, ts, type: 'artifact_approval', artifact_sha256: sha(page), path: 'index.html', approved, seq: 1 });
const spool = (lines) => ({ current: { files: [{ name: 'session.meta.json', data: new Uint8Array() }, { name: 'events.jsonl', data: new TextEncoder().encode(lines.join('\n') + '\n') }], sequence: { session_id: 's', last_seq: lines.length } }, others: [], omitted: { unreadable: 0, over_limit: 0 } });

let bundled;
test.before(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hps-comment-host-'));
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

/** `world.approvals` = spool lines; `world.page` = index.html now; `actions: false` = an older host without the readers. */
async function connected(t, world, { actions = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'hps-comment-'));
  const originalFetch = globalThis.fetch;
  globalThis.__dialogs = []; globalThis.__answer = NOTICE.accept;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname, body = init.body ? JSON.parse(init.body) : null;
    requests.push({ path, body });
    if (path.endsWith('/participation/notice')) return Response.json({ notice: NOTICE });
    if (path.endsWith('/classroom/ops/connect')) return Response.json({ credential: 'SYNTHETIC-CRED', grant_id: 'grant-1', class_run_id: 'run-1', seat_id: 'A1', expires_at: Date.now() + 3_600_000, poll_after_ms: 5, student: { u: 'kim', c: 'corp-a', p: 'adult' }, run: { starts_at: Date.now() - 60_000, ends_at: Date.now() + 3_600_000 }, lesson: null }, { status: 201 });
    if (path.endsWith('/participation/consent')) return Response.json({ consent: body.consent, notice_version: body.notice_version }, { status: 201 });
    if (path.endsWith('/classroom/ops/sync')) return Response.json({ ack: { boot_id: body.boot_id, contiguous_seq: 0, missing: [] }, poll_after_ms: 60000, server_time: Date.now(), distribution: { items: [CARD] } });
    if (path.endsWith('/participation/answers')) return Response.json({ answered: true, answer_revision: 1, answered_at: 7 }, { status: 201 });
    return Response.json({ reason: 'unavailable' }, { status: 503 });
  };
  const { ClassroomOpsHost } = createRequire(import.meta.url)(bundled);
  const state = new Map(), secrets = new Map(), subscriptions = [], reads = [];
  const context = { globalState: { get: (k) => state.get(k), update: async (k, v) => { v === undefined ? state.delete(k) : state.set(k, v); } }, secrets: { get: async (k) => secrets.get(k), store: async (k, v) => secrets.set(k, v), delete: async (k) => secrets.delete(k) }, globalStorageUri: { fsPath: dir }, subscriptions };
  const opsActions = { setHold() {}, ...(actions ? { readCollection: async (since, identity) => { reads.push(identity); return spool(world.approvals); }, currentPage: async () => world.page } : {}) };
  const host = new ClassroomOpsHost(context, () => ({ idleMs: 0, status: 'idle' }), opsActions, () => {});
  host.profileResult({ ok: true }, TOKEN);
  t.after(async () => { await host.disconnectInteractively().catch(() => {}); for (const s of subscriptions) s.dispose?.(); globalThis.fetch = originalFetch; await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });
  await host.connectInteractively();
  // Wait until the comment is stored (through the real sync loop); whether it is SHOWN is what the tests check.
  const deadline = Date.now() + 5000;
  while (!requests.some((r) => r.path.endsWith('/classroom/ops/sync') && (r.body?.distribution?.receipts ?? []).some((x) => x.stage === 'reflected')) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  const view = async () => host.inboxView();
  const card = async () => (await view()).cards.find((c) => c.object_id === OBJ);
  const posts = () => requests.filter((r) => r.path.endsWith('/participation/answers'));
  return { host, requests, reads, view, card, posts };
}

test('the app declares inbox_comment; a comment on a version this learner approved is shown as current, text kept as typed', async (t) => {
  const f = await connected(t, { approvals: [approvalLine(PAGE_V1, true, '2026-11-13T01:00:00.000Z')], page: PAGE_V1 });
  const connect = f.requests.find((r) => r.path.endsWith('/classroom/ops/connect')), sync = f.requests.find((r) => r.path.endsWith('/classroom/ops/sync'));
  assert.ok(connect.body.capabilities.includes('inbox_comment') && sync.body.capabilities.includes('inbox_comment'));
  assert.ok(connect.body.capabilities.length <= 32, 'the Service ignores a list over 32');
  const c = await f.card();
  assert.ok(c, 'the comment is in the view');
  assert.deepEqual([c.kind, c.body, c.anchor, c.version, c.answer], ['comment', BODY, ANCHOR, 'current', { sent: null }]);
  assert.equal((await f.view()).unread, 1, 'a placed comment counts as new until opened');
  assert.deepEqual(f.reads[0], { u: 'kim', c: 'corp-a', p: 'adult' }, 'approvals are read for exactly this learner');
  assert.equal(f.posts().length, 0, 'arrival sends nothing');
});

test('the learner changed their page since approving: the comment says it is about the previous version', async (t) => {
  const f = await connected(t, { approvals: [approvalLine(PAGE_V1, true, '2026-11-13T01:00:00.000Z')], page: PAGE_V2 });
  assert.equal((await f.card()).version, 'previous');
});

test('negative: a comment on a version this learner never approved (or withdrew) is not shown and cannot be answered', async (t) => {
  const f = await connected(t, { approvals: [approvalLine(PAGE_V2, true, '2026-11-13T01:00:00.000Z'), approvalLine(PAGE_V1, true, '2026-11-13T01:00:00.000Z'), approvalLine(PAGE_V1, false, '2026-11-13T01:05:00.000Z')], page: PAGE_V1 });
  assert.equal(await f.card(), undefined, 'approval withdrawn → not this learner\'s approved version → not drawn');
  assert.equal((await f.view()).unread, 0, 'an unshown comment is not counted as new');
  await f.host.inboxAnswer(OBJ, 1, (await f.view()).generation, { handled: true });
  assert.equal(f.posts().length, 0);
});

test('negative: an older host that cannot read approvals shows no comment at all', async (t) => {
  const f = await connected(t, { approvals: [], page: null }, { actions: false });
  assert.equal(await f.card(), undefined);
});

test('reply and handled: one POST each on a press, {handled, reply} only; a malformed answer sends nothing', async (t) => {
  const f = await connected(t, { approvals: [approvalLine(PAGE_V1, true, '2026-11-13T01:00:00.000Z')], page: PAGE_V1 });
  const gen = (await f.view()).generation;
  await f.host.inboxAnswer(OBJ, 1, gen, { handled: false, reply: 'x'.repeat(501) });
  await f.host.inboxAnswer(OBJ, 1, gen, { choice: 0 });
  assert.equal(f.posts().length, 0, 'a reply over 500 characters or a question answer is refused on the device');
  assert.match((await f.card()).answer_note, /답글은 500자 안으로/);
  await f.host.inboxAnswer(OBJ, 1, gen, { handled: false, reply: '  버튼 색도 바꿔 볼게요\r\n' });
  await f.host.inboxAnswer(OBJ, 1, gen, { handled: true, reply: '버튼 색도 바꿔 볼게요' });
  const bodies = f.posts().map((p) => ({ ...p.body, idempotency_key: 'k' }));
  assert.deepEqual(bodies, [
    { idempotency_key: 'k', distribution_id: DIST, object_id: OBJ, revision: 1, content_hash: CARD.content_hash, answer: { handled: false, reply: '버튼 색도 바꿔 볼게요' } },
    { idempotency_key: 'k', distribution_id: DIST, object_id: OBJ, revision: 1, content_hash: CARD.content_hash, answer: { handled: true, reply: '버튼 색도 바꿔 볼게요' } },
  ]);
  assert.deepEqual((await f.card()).answer, { sent: { handled: true, reply: '버튼 색도 바꿔 볼게요' } }, 'sent only after the 2xx');
  // Nothing about the comment went anywhere but the answer route: no request carries its text.
  assert.ok(!f.requests.some((r) => r.body && JSON.stringify(r.body).includes('제목 색이 배경과')), 'the comment text never leaves the device');
});
