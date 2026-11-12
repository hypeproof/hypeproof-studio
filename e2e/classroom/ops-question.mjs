import '@hypeproof/service-testkit/test/harness/loader.mjs';
// E5 (#3776) — a question card end to end with real parts: the REAL ClassroomOpsHost (VS Code stubbed at the bundle
// boundary; its own connect, notice, consent, sync loop, inbox store and answer POST) against the real Service routes +
// SQLite. The instructor side is driven through the Service API (Chalk's screen is its own repo's test).
// Shown: the class data notice before the code; the card reaches a connected seat; nothing is sent until the learner
// answers; the answer reaches the instructor's answers view; a changed answer replaces it; withdrawal closes the card.
// Synthetic accounts. NOT a real Studio window, Chalk page, D1, school network or production.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { localOps, OPS_ALL } from './service-fixture.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const local = await localOps(), { setRoster } = await import('@hypeproof/service-testkit/src/lib/kv.ts');
const realFetch = globalThis.fetch, calls = [];
globalThis.fetch = (url, init) => { if (!String(url).startsWith('https://service.test')) return realFetch(url, init); calls.push(new URL(url).pathname); return local.app.fetch(new Request(url, init), local.env, { waitUntil() {} }); };
let n = 0; const ok = (name) => { n++; console.log('PASS ' + name); };
const until = async (fn, what) => { for (let i = 0; i < 100; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); } throw Error('timed out: ' + what); };
const dir = mkdtempSync(path.join(tmpdir(), 'hps-ops-question-'));
let host;
try {
  await local.freeze();
  await setRoster(local.env.HPS_KV, local.cohort, ['student-a', 'student-b']);
  const T = await local.teacher('teacher-q', [...OPS_ALL, 'distribute']);
  assert.equal((await local.configure([{ seat_id: 'A1', student_id: 'student-a' }, { seat_id: 'A2', student_id: 'student-b' }], 0, { flags: { ops_observe: true, ops_distribute: true, ops_questions: true } }, T)).status, 201);

  const bundled = path.join(dir, 'host.cjs'), dialogs = [];
  await build({ entryPoints: [path.join(repo, 'extensions/hypeproof-chat/src/classroomOpsHost.ts')], outfile: bundled, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
    plugins: [{ name: 'vscode-stub', setup(b) { b.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'stub' })); b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ loader: 'js', contents: `
      const log = async (message, o, ...items) => { globalThis.__hpsDialogs.push({ message, modal: !!(o && o.modal), detail: o && o.detail, items }); return o && o.modal ? items[0] : undefined; };
      export const window = { showInputBox: async () => globalThis.__hpsTicket, showInformationMessage: log, showWarningMessage: log };
      export const workspace = { getConfiguration: () => ({ get: () => 'https://service.test/v1' }) };` })); } }] });
  globalThis.__hpsDialogs = dialogs;
  const { ClassroomOpsHost } = createRequire(import.meta.url)(bundled);
  const state = new Map(), secrets = new Map();
  const context = { globalState: { get: (k) => state.get(k), update: async (k, v) => { v === undefined ? state.delete(k) : state.set(k, v); } }, secrets: { get: async (k) => secrets.get(k), store: async (k, v) => secrets.set(k, v), delete: async (k) => secrets.delete(k) }, globalStorageUri: { fsPath: dir }, subscriptions: [], extension: { packageJSON: { version: '0.1.5-e2e' } } };
  host = new ClassroomOpsHost(context, () => ({ idleMs: 0, status: 'idle' }), { hasActiveRun: () => false, probeProfile: async () => ({ ok: true }), refreshProfile: async () => true, setHold() {} }, () => {});
  const studentToken = await local.student('student-a');

  // ── the learner connects: notice first, then the code, then consent at the notice's version ──
  globalThis.__hpsTicket = (await local.request(local.base + '/pairings', 'POST', { seat_id: 'A1', roster_revision: 1 }, T)).json.ticket;
  await host.connectInteractively();
  assert.ok(dialogs[0].modal && dialogs[0].detail, 'the class data notice comes first, as a modal with the Service text');
  assert.ok(calls.indexOf('/v1/classroom/ops/participation/notice') < calls.indexOf('/v1/classroom/ops/connect') && calls.includes('/v1/classroom/ops/participation/consent'));
  host.profileResult({ ok: true }, studentToken);
  const status = (await local.request(local.base + '/status', 'GET', undefined, T)).json;
  assert.equal(status.seats.find((s) => s.seat_id === 'A1').participation_consent.state, 'given');
  ok('connect: notice → code → consent recorded at the Service');

  // ── the instructor writes and sends a question card to every seat ──
  const question = { type: 'choice', options: ['잘 된다', '막혔다', '아직 시작 전'] };
  const card = (await local.request(local.base + '/contents', 'POST', { idempotency_key: crypto.randomUUID(), kind: 'question', title: '실습 확인', body: '지금 실습이 어디까지 됐나요?', question }, T)).json;
  assert.equal(card.kind, 'question');
  const sent = (await local.request(local.base + '/distributions', 'POST', { idempotency_key: crypto.randomUUID(), expected_roster_revision: 1, object_id: card.object_id, revision: 1, content_hash: card.content_hash, targets: ['A1', 'A2'] }, T));
  assert.ok(sent.status === 201 || sent.status === 200, sent.raw);
  const answersView = async () => (await local.request(`${local.base}/questions/${card.object_id}/answers`, 'GET', undefined, T)).json;

  const shown = await until(async () => { host.profileResult({ ok: true }, studentToken); /* nudges the sync loop */ return (await host.inboxView()).cards.find((c) => c.object_id === card.object_id); }, 'the card reaches the connected seat');
  assert.deepEqual([shown.kind, shown.body, shown.question, shown.answer, shown.unreadable], ['question', '지금 실습이 어디까지 됐나요?', question, { sent: null }, false], 'the device re-hashed the card with the question form and kept it');
  const delivered = await until(async () => { host.profileResult({ ok: true }, studentToken); const v = await answersView(); return v.seats.find((s) => s.seat_id === 'A1').status === 'delivered' ? v : null; }, 'the device confirms it holds the card');
  assert.deepEqual(delivered.seats.map((s) => [s.seat_id, s.status]), [['A1', 'delivered'], ['A2', 'not_delivered']], 'the absent seat is not delivered; nothing says "opened"');
  assert.ok(!calls.includes('/v1/classroom/ops/participation/answers'), 'arrival sent no answer');
  ok('delivery: the card reached the connected seat through the real sync loop; the instructor sees delivered, not answered');

  // ── the learner answers ──
  const generation = (await host.inboxView()).generation;
  await host.inboxAnswer(card.object_id, 1, generation, { choice: 1 });
  let mine = (await host.inboxView()).cards.find((c) => c.object_id === card.object_id);
  assert.deepEqual([mine.answer, mine.answer_note], [{ sent: { choice: 1 } }, undefined]);
  let view = await answersView(), a1 = view.seats.find((s) => s.seat_id === 'A1');
  assert.deepEqual([a1.status, a1.answer.choice, a1.answer.answer_revision, view.summary.answered], ['answered', 1, 1, 1]);
  ok('answer: 제출 → the Service recorded it → the instructor\'s answers view shows A1 answered "막혔다"');

  await host.inboxAnswer(card.object_id, 1, generation, { choice: 0 });
  view = await answersView(); a1 = view.seats.find((s) => s.seat_id === 'A1');
  assert.deepEqual([a1.answer.choice, a1.answer.answer_revision, view.summary.answered], [0, 2, 1], 'a changed answer replaces the first, one learner is still one answer');
  ok('답 바꾸기: the changed answer replaces the first');

  // ── the instructor withdraws the card ──
  const row = (await local.request(local.base + '/distributions/' + sent.json.distribution.id, 'GET', undefined, T)).json;
  const revoked = await local.request(local.base + '/distributions/' + sent.json.distribution.id + '/revoke', 'POST', { expected_row_revision: row.distribution?.row_revision ?? row.row_revision }, T);
  assert.ok(revoked.status < 300, revoked.raw);
  const gone = await until(async () => { host.profileResult({ ok: true }, studentToken); const c = (await host.inboxView()).cards.find((x) => x.object_id === card.object_id); return c?.withdrawn ? c : null; }, 'the withdrawal reaches the device');
  assert.equal(gone.question, undefined, 'a withdrawn card offers nothing to answer');
  await host.inboxAnswer(card.object_id, 1, (await host.inboxView()).generation, { choice: 2 });
  assert.equal((await answersView()).seats.find((s) => s.seat_id === 'A1').answer.choice, 0, 'nothing is sent for a withdrawn card');
  ok('withdrawal: the card comes down on the device and can no longer be answered');
  console.log(`classroom-ops-question: ${n} checks passed`);
} finally {
  await host?.disconnectInteractively().catch(() => {});
  globalThis.fetch = realFetch; rmSync(dir, { recursive: true, force: true });
}
process.exit(0);
