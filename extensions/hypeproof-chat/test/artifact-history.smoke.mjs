import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, webcrypto } from 'node:crypto';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const H = await import(process.env.ARTIFACT_HISTORY_SOURCE ?? '../src/turnRestore.ts');
const hash = data => createHash('sha256').update(data).digest('hex');
const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'artifact-history-')));
try {
  const root = path.join(tmp, 'work'); await fs.mkdir(root);
  const file = path.join(root, '작품.bin');
  const store = H.artifactHistoryStore(path.join(tmp, 'state'), root, '작품.bin');
  const one = Buffer.from([0, 255, 10, 20]), two = Buffer.from([10, 20, 30]);
  await fs.writeFile(file, one);
  const first = await H.captureArtifactVersion(store, root, '작품.bin', 'ai');
  await fs.writeFile(file, two);
  const current = await H.captureArtifactVersion(store, root, '작품.bin', 'learner');
  assert.equal(first.turnId, 'artifact-ai'); assert.equal(current.turnId, 'artifact-learner');
  await fs.writeFile(path.join(root, 'unrelated.txt'), 'keep');
  assert.deepEqual(await H.restoreArtifactVersion({ store, root, rel: '작품.bin', id: first.id, expected: hash(two) }), { ok: true });
  assert.deepEqual(await fs.readFile(file), one);
  assert.equal(await fs.readFile(path.join(root, 'unrelated.txt'), 'utf8'), 'keep');
  const versions = await H.listRestorePoints(store);
  assert(versions.some(p => p.files[0].sha256 === hash(two)), 'pre-restore bytes remain recoverable');
  assert(versions.filter(p => p.files[0].sha256 === hash(one)).length >= 2, 'restore creates a new head');
  // Stale UI must never overwrite bytes written after listing, including same-size changes.
  await fs.writeFile(file, Buffer.from([99, 98, 97, 96]));
  assert.equal((await H.restoreArtifactVersion({ store, root, rel: '작품.bin', id: current.id, expected: hash(one) })).reason, 'changed');
  assert.deepEqual(await fs.readFile(file), Buffer.from([99, 98, 97, 96]));
  // A task/connection/dirty-buffer change while the dialog is open fails closed.
  assert.equal((await H.restoreArtifactVersion({ store, root, rel: '작품.bin', id: first.id, expected: hash(Buffer.from([99,98,97,96])), stillCurrent: () => false })).reason, 'changed');
  await fs.unlink(file); await fs.symlink(path.join(root, 'unrelated.txt'), file);
  assert.equal(await H.captureArtifactVersion(store, root, '작품.bin', 'ai'), null);
  assert.equal((await H.restoreArtifactVersion({ store, root, rel: '작품.bin', id: first.id, expected: hash('keep') })).ok, false);
  assert.equal(await H.captureArtifactVersion(store, root, '../outside', 'ai'), null);
  assert.equal(await H.captureArtifactVersion(store, root, 'x/../unrelated.txt', 'ai'), null);
  // The shared lock serializes windows rather than dropping their capture.
  const { accountLock } = await import('../src/accountLock.ts');
  let release, entered;
  const gate = new Promise(r => { release = r; });
  const ready = new Promise(r => { entered = r; });
  const held = accountLock(store)(async () => { entered(); await gate; });
  await ready;
  let completed = false;
  const waiting = H.captureArtifactVersion(store, root, '작품.bin', 'unknown').then(() => { completed = true; });
  await new Promise(r => setTimeout(r, 20)); assert.equal(completed, false);
  release(); await held; await waiting;
  await fs.unlink(file); await fs.writeFile(file, two);
  let enabled = true;
  const native = { workspace: { getConfiguration: () => ({ get: () => enabled }), textDocuments: [] }, window: {
    createOutputChannel: () => ({ appendLine() {} }),
    showQuickPick: async entries => entries.find(e => e.point.id === first.id),
    showWarningMessage: async () => '복원하기',
    showInformationMessage: async message => { notices.push(message); },
  } };
  const notices = [], require = createRequire(import.meta.url);
  const extension = fileURLToPath(new URL('..', import.meta.url));
  const bundle = await build({ stdin: { contents: "export { ChatPanelProvider } from './src/chatPanelProvider';", resolveDir: extension, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'silent' });
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: id => id === 'vscode' ? native : require(id), console, Buffer, process, setTimeout, clearTimeout, setInterval, clearInterval, AbortSignal, URL, TextEncoder, TextDecoder, crypto: webcrypto });
  const host = Object.create(module.exports.ChatPanelProvider.prototype);
  Object.assign(host, { resolveCoachCwd: () => root, _instructorMode: { isInstructor: false }, cachedProfile: { activity_kind: "classroom", minor_cohort: true }, hasActiveStream: () => false, pendingSends: 0, taskChanging: false, connectionChanging: false, clearingHistory: false, turnRestoreBusy: false, profileGeneration: 0, turnRestoreTaskKey: () => 'default', context: { globalStorageUri: { fsPath: path.join(tmp, 'state') } }, folderWriteRefusalFor: () => null, provenanceRecorder: () => ({ unobserved: async () => {} }) });
  // Cancel leaves disk unchanged, independent of any seat-age flag.
  native.window.showWarningMessage = async () => undefined;
  await host.showArtifactHistory(file); assert.deepEqual(await fs.readFile(file), two);
  native.window.showWarningMessage = async () => { host.profileGeneration++; return '복원하기'; };
  await host.showArtifactHistory(file); assert.deepEqual(await fs.readFile(file), two); assert.equal(notices.at(-1), '파일이 바뀌었어요');
  native.window.showWarningMessage = async () => '복원하기';
  native.workspace.textDocuments = [{ uri: { scheme: 'file', fsPath: file }, isDirty: true }];
  await host.showArtifactHistory(file); assert.deepEqual(await fs.readFile(file), two);
  native.workspace.textDocuments = [];
  await host.showArtifactHistory(file); assert.deepEqual(await fs.readFile(file), one);
  // Unknown save followed by measured exact-byte evidence enriches the revision.
  await fs.writeFile(file, 'manual-change');
  const unknown = await H.captureArtifactVersion(store, root, '작품.bin', 'unknown');
  native.window.showQuickPick = async entries => entries.find(e => e.point.id === unknown.id);
  native.window.showWarningMessage = async () => '내 수정으로 기록';
  await host.showArtifactHistory(file);
  assert.equal((await H.listRestorePoints(store))[0].turnId, 'artifact-learner');
  assert.equal(notices.at(-1), '내가 확인한 수정으로 기록했어요.');
  await fs.writeFile(file, 'ai-output');
  const beforeEvidence = await H.captureArtifactVersion(store, root, '작품.bin', 'unknown');
  const enriched = await H.captureArtifactVersion(store, root, '작품.bin', 'ai', hash('ai-output'));
  assert.equal(enriched.id, beforeEvidence.id); assert.equal(enriched.turnId, 'artifact-ai');
  assert.equal((await H.captureArtifactVersion(store, root, '작품.bin', 'learner', hash('ai-output'))).turnId, 'artifact-ai', 'cannot relabel AI bytes');
  // Exact-byte learner confirmation is refused if bytes/context move during its modal.
  await fs.writeFile(file, 'unconfirmed');
  const unconfirmed = await H.captureArtifactVersion(store, root, '작품.bin', 'unknown');
  native.window.showQuickPick = async entries => entries.find(e => e.point.id === unconfirmed.id);
  native.window.showWarningMessage = async () => { await fs.writeFile(file, 'external-change'); return '내 수정으로 기록'; };
  await host.showArtifactHistory(file); assert.equal(notices.at(-1), '파일이 바뀌었어요');
  assert.equal((await H.loadRestorePoint(store, unconfirmed.id)).turnId, 'artifact-unknown');
  native.window.showWarningMessage = async () => undefined;
  const defaultCount = (await H.listRestorePoints(store)).length;
  enabled = false; await host.recordArtifactSave(file); await host.showArtifactHistory(file);
  assert.equal((await H.listRestorePoints(store)).length, defaultCount, 'default off does not retain additional versions');
  enabled = true;
  for (const profile of [null, {activity_kind:'trial'}, {pass:{}}, {activity_kind:'lesson'}, {activity_kind:'classroom', minor_cohort:true}]) {
    host.cachedProfile = profile;
    assert.equal(host.artifactHistoryEnabled(), !!profile);
  }
  host._instructorMode.isInstructor = true; assert.equal(host.artifactHistoryEnabled(),false);
  host._instructorMode.isInstructor = null; assert.equal(host.artifactHistoryEnabled(),false);
  host._instructorMode.isInstructor = false;
  host.connectionChanging = true; assert.equal(host.artifactHistoryEnabled(),false); host.connectionChanging=false;
  // Recorder automatic history is off by default; enabling retains only measured writes.
  const { ArtifactProvenanceRecorder } = await import('../src/artifactProvenance.ts');
  const recorderBase = path.join(tmp, 'recorder');
  const recorderStore = H.artifactHistoryStore(recorderBase, root, '작품.bin');
  const recorder = new ArtifactProvenanceRecorder(recorderBase);
  await recorder.hostWrote(root, [{absPath:file,data:'external-change'}], 'ai');
  assert.equal((await H.listRestorePoints(recorderStore)).length,0);
  const optedIn = new ArtifactProvenanceRecorder(recorderBase, Date.now, () => true);
  await optedIn.hostWrote(root, [{absPath:file,data:'external-change'}], 'ai');
  assert.equal((await H.listRestorePoints(recorderStore))[0].turnId,'artifact-ai');
  // A context switch during queued metadata/blob IO must not commit a new revision.
  await fs.writeFile(file, 'pending-context');
  const beforeRace = (await H.listRestorePoints(store)).map(p => p.id);
  let guards = 0;
  assert.equal(await H.captureArtifactVersion(store, root, '작품.bin', 'learner', hash('pending-context'), () => ++guards < 3), null);
  assert.deepEqual((await H.listRestorePoints(store)).map(p => p.id), beforeRace);
  // Exact-byte capture refuses an external edit that lands before metadata commit.
  let checks = 0;
  assert.equal(await H.captureArtifactVersion(store, root, '작품.bin', 'learner', hash('pending-context'), () => {
    if (++checks === 3) require('node:fs').writeFileSync(file, 'external-late');
    return true;
  }), null);
  assert.deepEqual((await H.listRestorePoints(store)).map(p => p.id), beforeRace);
  for (let i = 0; i < 25; i++) {
    await fs.writeFile(file, `bounded-${i}`);
    await H.captureArtifactVersion(store, root, '작품.bin', 'unknown');
  }
  assert.equal((await H.listRestorePoints(store)).length, 20, 'retention is bounded per file');
  console.log('artifact-history: PASS (binary restore, recovery head, stale bytes/context, links, traversal, shared lock)');
} finally { await fs.rm(tmp, { recursive: true, force: true }); }
