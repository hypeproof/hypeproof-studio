import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, readFile, rename, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { CompanionHostDispatcher } from '../src/companionHostDispatch.ts';
import { CommandRunner } from '../src/classroomOpsCommands.ts';
const hash = s => createHash('sha256').update(s).digest('hex');
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'hps-companion-dispatch-'));
  const text = '<html><button>합성 퀴즈</button></html>';
  const path = join(root, 'quiz.html'), file = join(root, 'journal.json');
  await writeFile(path, text);
  const request = { schema: 'hps-companion-host-request/1', requestId: 'request-1', actorId: 'account-a', deviceId: 'phone-a', hostId: 'host-a', workspaceId: 'workspace-a', projectId: 'project-a', taskId: 'task-a', version: 2, epoch: 1, consentRevision: 4, artifactId: 'quiz', artifactVersion: hash(text), operation: 'preview.read' };
  let context = { ...request, capability: 'preview.read', host: 'online', access: 'active', executionAuthorized: true, profile: { sdk_tools: { read: true } }, instructor: false, folderReadAllowed: true, artifact: { id: 'quiz', version: hash(text), path }, workspaceRoot: root };
  let failSave = false, failContext = false, failState = null, onSave = async () => {};
  const journal = {
    async load() { try { return JSON.parse(await readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } },
    async save(s) { if (failSave || s.entries.at(-1)?.state === failState) throw Error('disk full'); await writeFile(file + '.tmp', JSON.stringify(s)); await rename(file + '.tmp', file); await onSave(structuredClone(s)); },
  };
  const make = () => new CompanionHostDispatcher({ journal, context: async () => { if (failContext) throw Error('profile unavailable'); return context; }, now: () => 1000 });
  const dispatcher = make(); await dispatcher.recover();
  return { root, path, text, file, request, journal, dispatcher, make, get context() { return context; }, set context(v) { context = v; }, set failSave(v) { failSave = v; }, set failContext(v) { failContext = v; }, set failState(v) { failState = v; }, set onSave(v) { onSave = v; }, bytes: () => JSON.stringify(request), cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('DMC-T06: exact bytes are durable before running; retries/restart preserve exact result without reading changed source', async () => {
  const f = await fixture();
  try {
    const states = []; f.onSave = async s => { const e = s.entries[0]; if (e) { states.push(e.state); assert.equal(e.envelope.args.bytes, f.bytes()); } };
    const [first, duplicate] = await Promise.all([f.dispatcher.dispatch(f.bytes()), f.dispatcher.dispatch(f.bytes())]);
    assert.deepEqual(duplicate, first);
    assert.equal(first.state, 'completed'); assert.deepEqual(first.artifact, { id: 'quiz', version: hash(f.text), text: f.text });
    assert.ok(states.indexOf('accepted') < states.indexOf('running'));
    assert.equal(states.filter(state => state === 'running').length, 1, 'concurrent retry cannot dispatch twice');
    await writeFile(f.path, 'later local change');
    assert.deepEqual(await f.dispatcher.dispatch(f.bytes()), first);
    const restart = f.make(); await restart.recover(); assert.deepEqual(await restart.dispatch(f.bytes()), first);
    assert.equal((await f.dispatcher.dispatch(f.bytes() + ' ')).code, 'request_id_conflict', 'even whitespace changes exact payload bytes');
    assert.equal(await readFile(f.path, 'utf8'), 'later local change');
  } finally { await f.cleanup(); }
});

test('DMC-T12: pairing metadata never executes; current profile/scope/version/device/consent gates precede any request acceptance', async () => {
  const f = await fixture();
  try {
    const original = structuredClone(f.context);
    for (const change of [
      { executionAuthorized: false }, { capability: 'write' }, { capability: 'desktop.continue' }, { access: 'revoked' }, { access: 'expired' }, { deviceId: 'phone-b' },
      { actorId: 'account-b' }, { workspaceId: 'workspace-b' }, { projectId: 'project-b' }, { taskId: 'task-b' },
      { version: 3 }, { epoch: 2 }, { consentRevision: 5 }, { profile: { sdk_tools: { read: false, write: true } } },
      { folderReadAllowed: false }, { instructor: true }, { artifact: { ...original.artifact, version: hash('other') } },
    ]) {
      f.context = { ...structuredClone(original), ...change };
      assert.equal((await f.dispatcher.dispatch(f.bytes())).state, 'denied');
      assert.equal((await f.journal.load()).entries.length, 0, 'denial cannot become accepted');
    }
    f.context = original;
    f.failContext = true;
    assert.equal((await f.dispatcher.dispatch(f.bytes())).state, 'denied');
    assert.equal((await f.journal.load()).entries.length, 0);
    f.failContext = false;
    for (const change of [{ file_path: '../secret' }, { command: 'touch owned' }, { operation: 'Write' }, { operation: 'model.run' }, { requestId: '../escape' }, { version: -1 }]) {
      assert.equal((await f.dispatcher.dispatch(JSON.stringify({ ...f.request, ...change }))).code, 'invalid_request');
    }
    assert.equal(await readFile(f.path, 'utf8'), f.text);
  } finally { await f.cleanup(); }
});

test('local command output stays out of existing classroom transport receipts', async () => {
  let saved = null;
  const runner = new CommandRunner({
    journal: { async load() { return saved; }, async save(s) { saved = structuredClone(s); } },
    now: () => 1000, monotonic: () => 0, epoch: () => 1,
    executors: { read: { mutating: false, run: async () => ({ ok: true, code: 'read', output: { text: 'private artifact text' } }) } },
  });
  await runner.recover();
  await runner.onCommands([{ schema_version: 1, command_id: 'local-output', action: 'read', args: {}, lease_generation: 0, connection_epoch: 1, issued_at: 0, start_within_ms: 1000, run_within_ms: 1000 }]);
  await runner.onAcks([{ command_id: 'local-output', state: 'accepted', proceed: true, reason: '' }]);
  assert.equal(runner.result('local-output').output.text, 'private artifact text');
  assert.equal(JSON.stringify(runner.pendingReceipts()).includes('private artifact text'), false);
});

test('DMC-T04/T05: offline host waits without accepted/running work; desktop continuation makes no read/write/model claim', async () => {
  const f = await fixture();
  try {
    for (const host of ['offline', 'unknown']) { f.context.host = host; assert.equal((await f.dispatcher.dispatch(f.bytes())).state, 'wait_for_host'); }
    assert.equal((await f.journal.load()).entries.length, 0);
    f.context.host = 'online'; f.request.operation = 'desktop.continue';
    assert.equal((await f.dispatcher.dispatch(f.bytes())).code, 'runtime_capability_denied');
    f.context.capability = 'desktop.continue';
    const handoff = await f.dispatcher.dispatch(f.bytes()); assert.equal(handoff.state, 'desktop_handoff');
    const restart = f.make(); await restart.recover(); assert.deepEqual(await restart.dispatch(f.bytes()), handoff);
    assert.equal((await restart.dispatch(f.bytes() + ' ')).code, 'request_id_conflict');
    assert.equal(await readFile(f.path, 'utf8'), f.text);
  } finally { await f.cleanup(); }
});

test('DMC-T12: actual artifact adapter refuses outside path, symlink escape and changed source before accepted', async () => {
  const f = await fixture(), outside = await mkdtemp(join(tmpdir(), 'hps-companion-outside-'));
  try {
    const secret = join(outside, 'secret.html'); await writeFile(secret, f.text);
    for (const path of [secret, join(f.root, 'escape.html')]) {
      if (path !== secret) await symlink(secret, path);
      f.context.artifact.path = path;
      assert.equal((await f.dispatcher.dispatch(f.bytes())).state, 'denied');
      assert.equal((await f.journal.load()).entries.length, 0);
    }
    f.context.artifact.path = f.path; await writeFile(f.path, 'new content');
    assert.equal((await f.dispatcher.dispatch(f.bytes())).state, 'denied');
    assert.equal(await readFile(secret, 'utf8'), f.text);
  } finally { await f.cleanup(); await rm(outside, { recursive: true, force: true }); }
});

test('DMC-T06/T12: authority change at durable running boundary and persistence failure cannot expose results or retry the same instance', async () => {
  const f = await fixture();
  try {
    f.onSave = async s => { if (s.entries[0]?.state === 'running') f.context.consentRevision++; };
    const changed = await f.dispatcher.dispatch(f.bytes()); assert.equal(changed.state, 'denied'); assert.equal(changed.artifact, undefined);
    const saved = await f.journal.load(); assert.equal(saved.entries[0].state, 'failed'); assert.equal(saved.entries[0].output, undefined);
    f.request.requestId = 'request-2'; f.request.consentRevision = f.context.consentRevision;
    f.failSave = true;
    assert.equal((await f.dispatcher.dispatch(f.bytes())).code, 'journal_unavailable');
    f.failSave = false;
    assert.equal((await f.dispatcher.dispatch(f.bytes())).code, 'journal_unavailable');
    assert.equal(await readFile(f.path, 'utf8'), f.text);
  } finally { await f.cleanup(); }
});

test('DMC-T06: recovered running request remains outcome-unknown and corrupt journal blocks recovery', async () => {
  const f = await fixture();
  try {
    f.failState = 'succeeded';
    assert.equal((await f.dispatcher.dispatch(f.bytes())).code, 'journal_unavailable');
    f.failState = null;
    assert.equal((await f.journal.load()).entries[0].state, 'running', 'failed final receipt must leave durable running state');
    await writeFile(f.path, 'a new source version');
    const restart = f.make(); await restart.recover();
    const result = await restart.dispatch(f.bytes()); assert.equal(result.state, 'outcome_unknown'); assert.equal(result.artifact, undefined);
    await writeFile(f.file, '{broken');
    await assert.rejects(() => f.make().recover());
  } finally { await f.cleanup(); }
});
