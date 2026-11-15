// CGP-LEARN-R-011 follow-up to #4134 (verify-r027 S1). The real ClassroomOpsHost, with VS Code replaced at the bundle boundary
// and fetch intercepted, carries the material-report gate from the Service's sync answer to the inbox view the webview reads:
// - the device declares `material_report` on connect and on every sync (so the Service answers with `event_kinds`);
// - the view says `reports: true` only after a sync answer named `material_report`, never before and never for an older
//   Service that names no kinds, and drops it when a later answer stops naming it;
// - a disconnect resets it: on the next connection, before that connection's first answer, the view does not offer reports.
// Each block fails on the mutant verify-r027 found surviving (view without reportsAvailable, capability dropped from sync or
// from connect, no reset in stopConnection).
// Run: node --experimental-strip-types --test test/learning-block-report-gate-host.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NOTICE = { version: 'class-data-v1', title: '수업 참여 데이터 안내', body: 'HypeProof가 수집합니다.', accept: '동의하고 수업에 연결', decline: '동의하지 않음' };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = `${b64({ u: 'kim', c: 'corp-a', p: 'adult', jti: 'j1' })}.sig`;

let bundled;
test.before(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hps-report-gate-'));
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

/** `world.kinds` = what the Service's sync answer names (undefined = an older Service); `world.hold` = a promise that holds each sync answer. */
async function connected(t, world) {
  const dir = await mkdtemp(join(tmpdir(), 'hps-report-gate-world-'));
  const originalFetch = globalThis.fetch;
  globalThis.__dialogs = []; globalThis.__answer = NOTICE.accept;
  const requests = [];
  let grant = 0;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname, body = init.body ? JSON.parse(init.body) : null;
    requests.push({ path, body });
    if (path.endsWith('/participation/notice')) return Response.json({ notice: NOTICE });
    if (path.endsWith('/classroom/ops/connect')) { grant++; return Response.json({ credential: 'SYNTHETIC-CRED-' + grant, grant_id: 'grant-' + grant, class_run_id: 'run-1', seat_id: 'A1', expires_at: Date.now() + 3_600_000, poll_after_ms: 5, student: { u: 'kim', c: 'corp-a', p: 'adult' }, run: { starts_at: Date.now() - 60_000, ends_at: Date.now() + 3_600_000 }, lesson: null }, { status: 201 }); }
    if (path.endsWith('/participation/consent')) return Response.json({ consent: body.consent, notice_version: body.notice_version }, { status: 201 });
    if (path.endsWith('/classroom/ops/sync')) {
      if (world.hold) await world.hold;
      return Response.json({ ack: { boot_id: body.boot_id, contiguous_seq: 0, missing: [] }, poll_after_ms: 60000, server_time: Date.now(), ...(world.kinds ? { event_kinds: world.kinds } : {}) });
    }
    if (path.endsWith('/classroom/ops/disconnect') || path.endsWith('/classroom/ops/revoke')) return Response.json({ ok: true });
    return Response.json({ reason: 'unavailable' }, { status: 503 });
  };
  const { ClassroomOpsHost } = createRequire(import.meta.url)(bundled);
  const state = new Map(), secrets = new Map(), subscriptions = [];
  const context = { globalState: { get: (k) => state.get(k), update: async (k, v) => { v === undefined ? state.delete(k) : state.set(k, v); } }, secrets: { get: async (k) => secrets.get(k), store: async (k, v) => secrets.set(k, v), delete: async (k) => secrets.delete(k) }, globalStorageUri: { fsPath: dir }, subscriptions };
  const host = new ClassroomOpsHost(context, () => ({ idleMs: 0, status: 'idle' }), { setHold() {} }, () => {});
  host.profileResult({ ok: true }, TOKEN);
  t.after(async () => { await host.disconnectInteractively().catch(() => {}); for (const s of subscriptions) s.dispose?.(); globalThis.fetch = originalFetch; await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });
  const syncs = () => requests.filter((r) => r.path.endsWith('/classroom/ops/sync'));
  const waitSync = async (n) => { const end = Date.now() + 5000; while (syncs().length < n && Date.now() < end) await new Promise((r) => setTimeout(r, 10)); assert.ok(syncs().length >= n, `sync #${n} was sent`); await new Promise((r) => setTimeout(r, 30)); };
  return { host, requests, syncs, waitSync, view: () => host.inboxView() };
}

test('the device declares material_report on connect and on every sync', async (t) => {
  const f = await connected(t, { kinds: ['material_report'] });
  await f.host.connectInteractively();
  await f.waitSync(1);
  const connect = f.requests.find((r) => r.path.endsWith('/classroom/ops/connect'));
  assert.ok(connect.body.capabilities.includes('material_report'), 'connect declares it');
  assert.ok(f.syncs().every((s) => s.body.capabilities.includes('material_report')), 'every sync declares it');
  assert.ok(connect.body.capabilities.length <= 32, 'the Service ignores a list over 32');
});

test('the view offers reports only after the Service named the kind; an older Service never; a later answer can withdraw it', async (t) => {
  const world = { kinds: undefined };
  const f = await connected(t, world);
  await f.host.connectInteractively();
  await f.waitSync(1);
  const v0 = await f.view();
  assert.ok(v0.run, 'the class connection is live (the view has a run)');
  assert.equal(v0.reports, undefined, 'an older Service (no event_kinds): no report item');
  world.kinds = ['step', 'evidence'];
  await f.host.loop.tick();
  assert.equal((await f.view()).reports, undefined, 'a Service that does not name material_report: no report item');
  world.kinds = ['step', 'material_report'];
  await f.host.loop.tick();
  assert.equal((await f.view()).reports, true, 'named: the report is offered');
  world.kinds = undefined;
  await f.host.loop.tick();
  assert.equal((await f.view()).reports, undefined, 'a later answer without it withdraws it');
});

test('a disconnect resets it: the next connection offers no report before its own first answer names the kind', async (t) => {
  const world = { kinds: ['material_report'] };
  const f = await connected(t, world);
  await f.host.connectInteractively();
  await f.waitSync(1);
  assert.equal((await f.view()).reports, true, 'served on the first connection');
  await f.host.disconnectInteractively();
  // The next connection's sync answers are held: the view is read before any answer of this connection arrived.
  let release; world.hold = new Promise((r) => { release = r; });
  const before = f.syncs().length;
  await f.host.connectInteractively();
  await f.waitSync(before + 1);
  const v = await f.view();
  assert.ok(v.run, 'the new connection is live');
  assert.equal(v.reports, undefined, 'no report is offered on the strength of the previous connection');
  release(); world.hold = null;
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await f.view()).reports, true, 'its own first answer names the kind: offered again');
});
