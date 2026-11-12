// #751 E5 (ADR 0012): the real host, with VS Code replaced at the bundle boundary and fetch intercepted.
// Designed behavior: the class data notice comes before the code is used; declining uses nothing; accepting connects
// and records consent at the notice's version; a Service without the notice still connects (answers stay off).
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NOTICE = { version: 'class-data-v1', title: '수업 참여 데이터 안내', body: 'HypeProof가 수집합니다.\n회사는 볼 수 없습니다.', accept: '동의하고 수업에 연결', decline: '동의하지 않음' };

async function fixture(t, { notice = 'ok', answer = NOTICE.accept } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'hps-participation-'));
  const originalFetch = globalThis.fetch, subscriptions = [];
  globalThis.__dialogs = []; globalThis.__answer = answer;
  t.after(async () => { for (const s of subscriptions) s.dispose?.(); globalThis.fetch = originalFetch; delete globalThis.__dialogs; delete globalThis.__answer; await rm(dir, { recursive: true, force: true }); });
  const bundled = join(dir, 'host.cjs');
  await build({
    entryPoints: [fileURLToPath(new URL('../src/classroomOpsHost.ts', import.meta.url))], outfile: bundled, bundle: true, platform: 'node', format: 'cjs',
    plugins: [{ name: 'vscode-stub', setup(b) {
      b.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ loader: 'js', contents: `
        const log = (kind) => async (message, options, ...actions) => { (globalThis.__dialogs ??= []).push({ kind, message, options, actions }); return options && options.modal ? (globalThis.__answer ?? undefined) : undefined; };
        export const window = { showInformationMessage: log('info'), showWarningMessage: log('warn'), showInputBox: async () => { (globalThis.__dialogs ??= []).push({ kind: 'input' }); return 'ABCD-EFGH-JKLM'; } };
        export const workspace = { getConfiguration: () => ({ get: () => 'https://service.invalid/v1' }) };` }));
    } }],
  });
  const { ClassroomOpsHost } = createRequire(import.meta.url)(bundled);
  const state = new Map(), secrets = new Map();
  const context = {
    globalState: { get: (k) => state.get(k), update: async (k, v) => { v === undefined ? state.delete(k) : state.set(k, v); } },
    secrets: { get: async (k) => secrets.get(k), store: async (k, v) => secrets.set(k, v), delete: async (k) => secrets.delete(k) },
    globalStorageUri: { fsPath: dir }, subscriptions,
  };
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname, body = init.body ? JSON.parse(init.body) : null; requests.push({ path, method: init.method ?? 'GET', body });
    if (path.endsWith('/participation/notice')) return notice === 'ok' ? Response.json({ notice: NOTICE }) : notice === 'disabled' ? Response.json({ reason: 'ops_disabled' }, { status: 404 }) : Response.json({ error: 'not_found' }, { status: 404 });
    if (path.endsWith('/classroom/ops/connect')) return Response.json({ credential: 'SYNTHETIC-CRED', grant_id: 'grant-1', class_run_id: 'run-1', seat_id: 'A1', expires_at: Date.now() + 3_600_000, poll_after_ms: 60000, lesson: null }, { status: 201 });
    if (path.endsWith('/participation/consent')) return Response.json({ consent: body.consent, notice_version: body.notice_version }, { status: 201 });
    return Response.json({ reason: 'unavailable' }, { status: 503 });
  };
  const host = new ClassroomOpsHost(context, () => ({ idleMs: 0, status: 'idle' }), { setHold() {} }, () => {});
  t.after(async () => { await host.disconnectInteractively().catch(() => {}); });
  return { host, requests };
}

test('the notice is shown as a modal before the code is asked, with the Service text and version', async (t) => {
  const f = await fixture(t);
  await f.host.connectInteractively();
  const [first, second] = globalThis.__dialogs;
  assert.deepEqual([first.kind, first.message, first.options.modal, first.options.detail, first.actions], ['info', NOTICE.title, true, NOTICE.body, [NOTICE.accept, NOTICE.decline]]);
  assert.equal(second.kind, 'input', 'the code is asked only after the notice');
  const paths = f.requests.map((r) => r.path);
  assert.ok(paths.indexOf('/v1/classroom/ops/connect') < paths.indexOf('/v1/classroom/ops/participation/consent'), 'consent is recorded for the connection it was given in');
  const consent = f.requests.find((r) => r.path.endsWith('/participation/consent'));
  assert.deepEqual(consent.body, { consent: true, notice_version: 'class-data-v1' });
  assert.equal(f.host.participationConsented('class-data-v1'), true);
  assert.equal(f.host.participationConsented('class-data-v2'), false, 'a newer notice is not covered');
});

for (const [name, answer] of [['declining', NOTICE.decline], ['closing the dialog', null]]) {
  test(`${name} uses no code and connects nothing`, async (t) => {
    const f = await fixture(t, { answer });
    await f.host.connectInteractively();
    assert.ok(!globalThis.__dialogs.some((d) => d.kind === 'input'), 'no code is asked');
    assert.deepEqual(f.requests.map((r) => r.path), ['/v1/classroom/ops/participation/notice']);
    assert.ok(globalThis.__dialogs.at(-1).message.includes('Studio 개인 사용은 그대로'));
  });
}

test('operations off: the learner is told before anything else, nothing is asked', async (t) => {
  const f = await fixture(t, { notice: 'disabled' });
  await f.host.connectInteractively();
  assert.equal(globalThis.__dialogs.length, 1);
  assert.ok(globalThis.__dialogs[0].message.includes('수업 연결 기능이 켜져 있지 않습니다'));
});

test('a Service without the notice still connects the seat; no consent is claimed', async (t) => {
  const f = await fixture(t, { notice: 'missing' });
  await f.host.connectInteractively();
  assert.ok(f.requests.some((r) => r.path.endsWith('/classroom/ops/connect')));
  assert.ok(!f.requests.some((r) => r.path.endsWith('/participation/consent')));
  assert.equal(f.host.participationConsented('class-data-v1'), false);
});
