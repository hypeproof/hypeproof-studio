// Run: node --experimental-strip-types --test test/task-workspace-store.test.mjs
// These exercise the production store on disk; model calls and the native UI are separate gates.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { TaskWorkspaceStore } from '../src/taskWorkspaceStore.ts';

const message = (id, content = `Message ${id}`, role = 'user') => ({ id: String(id), content, role, createdAt: 1000 });
const draft = (text) => ({ text, images: [], queued: null });
const expected = store => ({ taskId: store.getView().activeTaskId, revision: store.getView().revision });
const hasCode = code => error => error?.code === code;
const temporary = t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hps-task-workspace-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
};

test('explicit draft recovery forks displayed context onto the latest valid revision without replacing existing tasks', async t => {
  const root = temporary(t), scope = 'draft-recovery', store = new TaskWorkspaceStore(root, scope);
  await store.initialize();
  const original = store.getView().activeTaskId;
  await store.append(original, [message('context', 'Current displayed conversation')]);
  const other = new TaskWorkspaceStore(root, scope);
  await other.rename(original, 'Concurrent title');
  await other.create('Other task', expected(other));
  await other.saveDraft(other.getView().activeTaskId, draft('Other writer draft'));
  const before = JSON.parse(fs.readFileSync(other.filePath, 'utf8')).data;
  const unsaved = { ...draft('Unsaved current text'), images: ['data:image/png;base64,cGhvdG8='], queued: 'Pending question', recovered: [{ text: 'Rejected question', toolMode: 'auto', images: [] }] };
  await store.recoverDraft(original, unsaved);
  const after = JSON.parse(fs.readFileSync(store.filePath, 'utf8')).data;
  assert.deepEqual(after.tasks.slice(0, before.tasks.length), before.tasks);
  assert.equal(after.revision, before.revision + 1);
  const recovered = store.getActiveTask();
  assert.deepEqual(recovered.messages, [message('context', 'Current displayed conversation')]);
  assert.deepEqual(recovered.draft, { ...unsaved, queuedPaused: true });
  assert.equal(new TaskWorkspaceStore(root, scope).getActiveTask().id, recovered.id);
  const validBytes = fs.readFileSync(store.filePath, 'utf8');
  fs.writeFileSync(store.filePath, 'broken external file');
  await assert.rejects(store.recoverDraft(recovered.id, draft('Keep this input')), hasCode('corrupt'));
  assert.equal(fs.readFileSync(store.filePath, 'utf8'), 'broken external file');
  assert.equal(store.getActiveTask().id, recovered.id);
  fs.writeFileSync(store.filePath, validBytes);
});

test('new task titles follow the first request and selected option, survive restart, and stop after two user turns', async t => {
  const root = temporary(t), store = new TaskWorkspaceStore(root, 'automatic-title');
  await store.initialize();
  const id = store.getView().activeTaskId;
  await store.append(id, [message('request', '치과 웹사이트를 만들고 싶어요')]);
  assert.equal(store.getActiveTask().title, '치과 웹사이트를 만들고 싶어요');
  await store.append(id, [message('options', '어떤 페이지부터 만들까요?\n1. 진료 안내\n2. 온라인 예약 페이지', 'assistant')]);
  await store.saveDraft(id, draft('보존할 초안'));
  await store.append(id, [message('choice', '2번')]);
  const reopened = new TaskWorkspaceStore(root, 'automatic-title');
  assert.equal(reopened.getActiveTask().title, '온라인 예약 페이지');
  assert.equal(reopened.getActiveTask().titleOrigin, 'automatic');
  assert.equal(reopened.getView().tasks[0].title, '온라인 예약 페이지');
  assert.equal(reopened.getDraft().text, '보존할 초안');
  await reopened.append(id, [message('later', '이번에는 투자 보고서를 작성해주세요')]);
  assert.equal(reopened.getActiveTask().title, '온라인 예약 페이지', 'later conversation cannot keep renaming the task');
  assert.deepEqual(reopened.getHistory().map(row => row.id), ['request', 'options', 'choice', 'later']);
});

test('introductory greetings do not exhaust automatic naming before the first useful request', async t => {
  const root = temporary(t), store = new TaskWorkspaceStore(root, 'greeting-title');
  await store.initialize();
  const id = store.getView().activeTaskId;
  await store.append(id, [message('hello', '안녕'), message('ack', '네')]);
  assert.equal(store.getActiveTask().title, '새 작업');
  await store.saveDraft(id, draft('다음 초안'));
  await store.append(id, [message('topic', '여행 일정을 계획하고 싶어')]);
  const reopened = new TaskWorkspaceStore(root, 'greeting-title');
  assert.equal(reopened.getActiveTask().title, '여행 일정을 계획하고 싶어');
  assert.equal(reopened.getView().tasks[0].title, '여행 일정을 계획하고 싶어');
  assert.equal(reopened.getDraft().text, '다음 초안');
  assert.deepEqual(reopened.getHistory().map(row => row.id), ['hello', 'ack', 'topic']);
});

test('both numeric and full clickable replies persist the specific title instead of a general request', async t => {
  const root = temporary(t), label = '글쓰기나 정리: 메일, 보고서, 메모, 자료 요약';
  for (const reply of ['1', `1. ${label}`]) {
    const store = new TaskWorkspaceStore(root, `clicked-title:${reply}`);
    await store.initialize();
    const id = store.getView().activeTaskId;
    await store.append(id, [message('question', '객관식으로 질문해 줘')]);
    assert.equal(store.getActiveTask().title, '객관식으로 질문해 줘');
    await store.append(id, [message('menu', `1. **글쓰기나 정리**: 메일, 보고서, 메모, 자료 요약\n2. 웹사이트 만들기`, 'assistant')]);
    await store.append(id, [message('reply', reply)]);
    assert.equal(store.getView().tasks[0].title, label);
    assert.equal(new TaskWorkspaceStore(root, `clicked-title:${reply}`).getActiveTask().title, label);
  }
});

test('manual rename protects even the literal default name across restart and does not disable other tasks', async t => {
  const root = temporary(t), store = new TaskWorkspaceStore(root, 'manual-title');
  await store.initialize();
  const firstId = store.getView().activeTaskId;
  await store.rename(firstId, '새 작업');
  const reopened = new TaskWorkspaceStore(root, 'manual-title');
  await reopened.append(firstId, [message('first', '학생 출석부 만들기')]);
  assert.equal(reopened.getActiveTask().title, '새 작업');
  assert.equal(reopened.getActiveTask().titleOrigin, 'manual');
  await reopened.create('새 작업', expected(reopened));
  const secondId = reopened.getView().activeTaskId;
  await reopened.append(secondId, [message('second', '수업 일정 정리')]);
  assert.equal(reopened.getActiveTask().title, '수업 일정 정리');
  await reopened.rename(secondId, '내가 정한 이름');
  await reopened.append(secondId, [message('second-more', '다른 제목 후보')]);
  assert.equal(new TaskWorkspaceStore(root, 'manual-title').getActiveTask().title, '내가 정한 이름');
  assert.equal(reopened.getTask(firstId).title, '새 작업');
});

test('old snapshots keep names of unknown origin while newly created tasks still get automatic titles', async t => {
  const root = temporary(t), store = new TaskWorkspaceStore(root, 'old-title');
  await store.initialize();
  const firstId = store.getView().activeTaskId;
  await store.saveDraft(firstId, draft('기존 초안'));
  const envelope = JSON.parse(fs.readFileSync(store.filePath, 'utf8'));
  delete envelope.data.tasks[0].titleOrigin;
  envelope.checksum = createHash('sha256').update(JSON.stringify(envelope.data)).digest('hex');
  fs.writeFileSync(store.filePath, JSON.stringify(envelope));
  const reopened = new TaskWorkspaceStore(root, 'old-title');
  await reopened.initialize();
  await reopened.append(firstId, [message('old', '사용자가 붙인 옛 이름은 알 수 없음')]);
  assert.equal(reopened.getActiveTask().title, '새 작업', 'legacy default text may have been an explicit manual rename');
  assert.equal(reopened.getDraft().text, '기존 초안');
  assert.equal(new TaskWorkspaceStore(root, 'old-title').getActiveTask().title, '새 작업');
  await reopened.create('새 작업', expected(reopened));
  await reopened.append(reopened.getView().activeTaskId, [message('new', '새 수업 안내문')]);
  assert.equal(reopened.getActiveTask().title, '새 수업 안내문');
  assert.equal(reopened.getTask(firstId).title, '새 작업');
});

test('a rejected manual-name write cannot silently change title ownership in memory or on disk', async t => {
  const root = temporary(t), store = new TaskWorkspaceStore(root, 'title-atomicity');
  await store.initialize();
  const id = store.getView().activeTaskId, committed = fs.readFileSync(store.filePath, 'utf8');
  const originalRename = fs.promises.rename;
  fs.promises.rename = async (...args) => {
    if (args[1] === store.filePath) throw Object.assign(new Error('synthetic title-write failure'), { code: 'EIO' });
    return originalRename(...args);
  };
  syncBuiltinESMExports();
  try { await assert.rejects(store.rename(id, '새 작업'), hasCode('io')); }
  finally { fs.promises.rename = originalRename; syncBuiltinESMExports(); }
  assert.equal(fs.readFileSync(store.filePath, 'utf8'), committed);
  assert.equal(store.getActiveTask().titleOrigin, 'default');
  await store.append(id, [message('after-failure', '자동 제목 저장 재시도')]);
  assert.equal(new TaskWorkspaceStore(root, 'title-atomicity').getActiveTask().title, '자동 제목 저장 재시도');
});

test('failed first import is an explicit error, never an empty ready workspace', async t => {
  const root = temporary(t), store = new TaskWorkspaceStore(root, 'failed-import');
  await assert.rejects(store.initialize([{ id: 'broken' }]), hasCode('invalid'));
  assert.equal(store.getView().error.code, 'invalid');
  assert.equal(store.getView().activeTaskId, null);
  assert.equal(fs.existsSync(store.filePath), false);
});
const childCode = mode => `
  import fs from 'node:fs';
  import { syncBuiltinESMExports } from 'node:module';
  import { TaskWorkspaceStore } from ${JSON.stringify(new URL('../src/taskWorkspaceStore.ts', import.meta.url).href)};
  const store = new TaskWorkspaceStore(process.argv[1], 'crash-scope');
  const original = fs.promises.rename;
  fs.promises.rename = async (...args) => {
    if (args[1] === store.filePath) {
      ${mode === 'exit' ? 'process.exit(73);' : "process.stdout.write('LOCKED\\n'); setInterval(() => {}, 1000); await new Promise(() => {});"}
    }
    return original(...args);
  };
  syncBuiltinESMExports();
  await store.append(store.getView().activeTaskId, [{id:'interrupted',role:'user',content:'never committed',createdAt:1000}]);
`;

test('restart restores full history, draft and pinned source for the selected task; legacy imports only once', async t => {
  const root = temporary(t);
  const scope = 'synthetic-account:activity-a';
  const store = new TaskWorkspaceStore(root, scope);
  assert.equal(store.getView().activeTaskId, null);
  await store.initialize(Array.from({ length: 251 }, (_, index) => message(index)), draft('아직 보내지 않은 질문'));
  const firstId = store.getView().activeTaskId;
  assert.equal(store.getActiveTask().title, '이전 대화');
  assert.equal(store.getActiveTask().importedLegacy, true);
  await store.saveSurface(firstId, { url: 'https://example.test/research', pinned: true });
  await store.create('두 번째 작업', expected(store));
  const secondId = store.getView().activeTaskId;
  await store.append(secondId, [message('b1', '다른 주제')]);
  await store.saveDraft(secondId, draft('다른 초안'));
  await store.select(firstId, expected(store));
  const reopened = new TaskWorkspaceStore(root, scope);
  await reopened.initialize([message('must-not-reimport')], draft('must not overwrite'));
  assert.equal(reopened.getHistory().length, 251, 'storage must not inherit the 200-message model context clamp');
  assert.equal(reopened.getDraft().text, '아직 보내지 않은 질문');
  assert.deepEqual(reopened.getView().sourceSelection, { url: 'https://example.test/research', pinned: true });
  assert.deepEqual(reopened.getHistory(secondId), [message('b1', '다른 주제')]);
  assert.equal(reopened.getDraft(secondId).text, '다른 초안');
  assert.equal(reopened.getView().activeTaskId, firstId);
  const copy = reopened.getActiveTask();
  copy.messages.length = 0;
  copy.draft.text = 'caller mutation';
  assert.equal(reopened.getHistory().length, 251);
  assert.equal(reopened.getDraft().text, '아직 보내지 않은 질문');
});

test('serialized writes retain all turns, update message IDs in place, and reject stale task/draft navigation', async t => {
  const root = temporary(t);
  const store = new TaskWorkspaceStore(root, 'scope');
  await store.initialize();
  assert.equal(store.getActiveTask().title, '새 작업');
  assert.equal(store.getActiveTask().importedLegacy, false);
  const firstId = store.getView().activeTaskId;
  const staleView = expected(store);
  await Promise.all(Array.from({ length: 15 }, (_, index) => store.append(firstId, [message(index)])));
  await store.append(firstId, [message('tool-call', 'Running', 'tool')]);
  await store.append(firstId, [message('tool-call', 'Done', 'tool'), message('tool-call', 'Done', 'tool')]);
  assert.equal(store.getHistory().length, 16);
  assert.equal(store.getHistory().at(-1).content, 'Done');
  await assert.rejects(store.create('stale create', staleView), hasCode('stale'));
  await store.create('새 주제', expected(store));
  const secondId = store.getView().activeTaskId;
  await assert.rejects(store.saveDraft(firstId, draft('late first-task autosave')), hasCode('stale'));
  await assert.rejects(store.append(firstId, [message('late turn')]), hasCode('stale'));
  await assert.rejects(store.select(firstId, { taskId: firstId, revision: store.getView().revision }), hasCode('stale'));
  await store.saveDraft(secondId, draft('second task only'));
  assert.equal(store.getDraft(firstId).text, '');
  await store.rename(secondId, '이름 변경');
  await store.append(secondId, [message('second')]);
  await store.clearHistory(secondId);
  assert.equal(store.getHistory(secondId).length, 0);
  assert.equal(store.getHistory(firstId).length, 16, 'clearing one task cannot erase another');
  assert.equal(store.getActiveTask().title, '이름 변경');
});

test('another writer and an existing lock fail without discarding committed data or breaking locks', async t => {
  const root = temporary(t);
  const store = new TaskWorkspaceStore(root, 'shared-scope');
  await store.initialize();
  const other = new TaskWorkspaceStore(root, 'shared-scope');
  const id = store.getView().activeTaskId;
  await store.append(id, [message('first-writer')]);
  const committed = fs.readFileSync(store.filePath, 'utf8');
  await assert.rejects(other.append(id, [message('stale-writer')]), hasCode('stale'));
  assert.equal(fs.readFileSync(store.filePath, 'utf8'), committed);
  const lockPath = `${store.filePath}.lock`;
  const lockBytes = JSON.stringify({ pid: 999999, createdAt: 0, token: 'synthetic-lock' });
  fs.writeFileSync(lockPath, lockBytes);
  await assert.rejects(store.append(id, [message('locked-out')]), hasCode('locked'));
  assert.equal(fs.readFileSync(lockPath, 'utf8'), lockBytes, 'age/dead-looking PID is not authority to break a lock');
  assert.equal(fs.readFileSync(store.filePath, 'utf8'), committed);
  fs.unlinkSync(lockPath);
  await store.append(id, [message('retry-after-owner-released')]);
  assert.equal(store.getHistory().length, 2, 'a rejected operation must not poison the serialization queue');
});

test('malformed, tampered and wrong-schema records remain explicit errors and are never initialized over', async t => {
  const root = temporary(t);
  const store = new TaskWorkspaceStore(root, 'scope');
  await store.initialize([message('preserved')]);
  const good = fs.readFileSync(store.filePath, 'utf8');
  const modified = JSON.parse(good);
  modified.data.tasks[0].messages[0].content = 'checksum mismatch';
  const wrongSchema = JSON.parse(good);
  wrongSchema.data.version = 2;
  wrongSchema.checksum = createHash('sha256').update(JSON.stringify(wrongSchema.data)).digest('hex');
  const wrongTitleOrigin = JSON.parse(good);
  wrongTitleOrigin.data.tasks[0].titleOrigin = 'unrecognized';
  wrongTitleOrigin.checksum = createHash('sha256').update(JSON.stringify(wrongTitleOrigin.data)).digest('hex');
  for (const bad of ['{broken', JSON.stringify(modified), JSON.stringify(wrongSchema), JSON.stringify(wrongTitleOrigin)]) {
    fs.writeFileSync(store.filePath, bad);
    const reopened = new TaskWorkspaceStore(root, 'scope');
    assert.equal(reopened.getView().error.code, 'corrupt');
    assert.equal(reopened.getView().activeTaskId, null);
    assert.throws(() => reopened.getHistory(), hasCode('corrupt'));
    await assert.rejects(reopened.initialize(), hasCode('corrupt'));
    assert.equal(fs.readFileSync(store.filePath, 'utf8'), bad, 'failed recovery may not overwrite the source');
  }
  fs.writeFileSync(store.filePath, good);
  assert.deepEqual(new TaskWorkspaceStore(root, 'scope').getHistory(), [message('preserved')]);
});

test('a failed atomic replace keeps the previous committed snapshot and the in-memory draft', async t => {
  const root = temporary(t);
  const store = new TaskWorkspaceStore(root, 'scope');
  await store.initialize([], draft('last saved'));
  const id = store.getView().activeTaskId;
  const committed = fs.readFileSync(store.filePath, 'utf8');
  const originalRename = fs.promises.rename;
  fs.promises.rename = async (...args) => {
    if (args[1] === store.filePath) throw Object.assign(new Error('synthetic disk failure'), { code: 'EIO' });
    return originalRename(...args);
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(store.saveDraft(id, draft('uncommitted')), hasCode('io'));
  } finally {
    fs.promises.rename = originalRename;
    syncBuiltinESMExports();
  }
  assert.equal(fs.readFileSync(store.filePath, 'utf8'), committed);
  assert.equal(store.getDraft().text, 'last saved');
  assert.deepEqual(fs.readdirSync(path.dirname(store.filePath)), [path.basename(store.filePath)], 'failed commit cleans its temp file and lock');
  await store.saveDraft(id, draft('retry committed'));
  assert.equal(new TaskWorkspaceStore(root, 'scope').getDraft().text, 'retry committed');
});

test('scopes are isolated and private on disk; host schema rejects hidden credential fields and unsafe source URLs', async t => {
  const root = temporary(t);
  const rawScope = 'synthetic-sensitive-account@example.invalid:/workspace';
  const a = new TaskWorkspaceStore(root, rawScope);
  const b = new TaskWorkspaceStore(root, `${rawScope}:other`);
  await a.initialize([message('only-a')]);
  await b.initialize();
  assert.notEqual(a.filePath, b.filePath);
  assert.equal(b.getHistory().length, 0);
  assert.equal(fs.readFileSync(a.filePath, 'utf8').includes(rawScope), false);
  assert.match(path.basename(a.filePath), /^[a-f0-9]{64}\.json$/);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(a.filePath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(a.filePath)).mode & 0o777, 0o700);
  }
  const id = a.getView().activeTaskId;
  await assert.rejects(a.saveDraft(id, { ...draft(''), accessToken: 'synthetic-only' }), hasCode('invalid'));
  await assert.rejects(a.append(id, [{ ...message('bad'), credential: 'synthetic-only' }]), hasCode('invalid'));
  for (const url of ['file:///tmp/private', 'javascript:alert(1)', 'https://user:secret@example.test/']) {
    await assert.rejects(a.saveSurface(id, { url, pinned: false }), hasCode('invalid'));
  }
  assert.equal(a.getHistory().length, 1);
  assert.equal(a.getView().sourceSelection, null);
  fs.copyFileSync(a.filePath, b.filePath);
  assert.equal(new TaskWorkspaceStore(root, `${rawScope}:other`).getView().error.code, 'corrupt', 'a copied file cannot cross the account/activity scope');
});

test('a child-process crash releases only its dead owner lease; two recovering writers cannot delete each other’s lock', async t => {
  const root = temporary(t);
  const original = new TaskWorkspaceStore(root, 'crash-scope');
  await original.initialize([message('before-crash')]);
  const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', childCode('exit'), root], { encoding: 'utf8' });
  assert.equal(child.status, 73, child.stderr);
  assert(fs.existsSync(`${original.filePath}.lock`), 'crash must leave a real production lock');
  assert.deepEqual(original.getHistory(), [message('before-crash')]);
  const a = new TaskWorkspaceStore(root, 'crash-scope');
  const b = new TaskWorkspaceStore(root, 'crash-scope');
  const result = await Promise.allSettled([
    a.append(a.getView().activeTaskId, [message('recovery-a')]),
    b.append(b.getView().activeTaskId, [message('recovery-b')]),
  ]);
  assert.equal(result.filter(row => row.status === 'fulfilled').length, 1, 'one writer commits; the stale/contending writer must fail');
  const rejected = result.find(row => row.status === 'rejected');
  assert(['locked', 'stale'].includes(rejected.reason.code));
  const reopened = new TaskWorkspaceStore(root, 'crash-scope');
  assert.equal(reopened.getHistory().length, 2);
  assert.equal(reopened.getHistory()[0].id, 'before-crash');
  assert.equal(reopened.getHistory().some(row => row.id === 'interrupted'), false);
  assert.deepEqual(fs.readdirSync(path.dirname(original.filePath)), [path.basename(original.filePath)], 'recovery cleans only the dead owner’s temp/lease and releases its own lock');
  await reopened.append(reopened.getView().activeTaskId, [message('after-recovery')]);
  assert.equal(new TaskWorkspaceStore(root, 'crash-scope').getHistory().length, 3);
});

test('a live child lock is never stolen; its subsequent SIGKILL can be recovered without elapsed-time guesses', async t => {
  const root = temporary(t);
  const store = new TaskWorkspaceStore(root, 'crash-scope');
  await store.initialize();
  const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', childCode('wait'), root], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const exited = once(child, 'exit');
  await Promise.race([
    new Promise((resolve, reject) => {
      child.stdout.on('data', data => { if (data.toString().includes('LOCKED')) resolve(); });
      child.once('error', reject);
      child.once('exit', code => reject(new Error(`Child exited before owning lock: ${code}`)));
    }),
    new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Child lock timeout')), 5000); timer.unref(); }),
  ]);
  const lockBytes = fs.readFileSync(`${store.filePath}.lock`, 'utf8');
  await assert.rejects(store.append(store.getView().activeTaskId, [message('must-not-steal')]), hasCode('locked'));
  assert.equal(fs.readFileSync(`${store.filePath}.lock`, 'utf8'), lockBytes);
  child.kill('SIGKILL');
  await exited;
  await store.append(store.getView().activeTaskId, [message('recovered-after-exit')]);
  assert.deepEqual(new TaskWorkspaceStore(root, 'crash-scope').getHistory(), [message('recovered-after-exit')]);
});

test('symlinked storage roots, scope directories and scope files fail without writing through them', async t => {
  const root = temporary(t);
  const target = path.join(root, 'target');
  fs.mkdirSync(target);
  const alias = path.join(root, 'alias');
  fs.symlinkSync(target, alias, 'junction');
  const rootLink = new TaskWorkspaceStore(alias, 'scope');
  assert.equal(rootLink.getView().error.code, 'corrupt');
  await assert.rejects(rootLink.initialize(), hasCode('corrupt'));
  assert.deepEqual(fs.readdirSync(target), []);
  const directoryRoot = path.join(root, 'directory-root');
  fs.mkdirSync(directoryRoot);
  fs.symlinkSync(target, path.join(directoryRoot, 'task-workspaces'), 'junction');
  await assert.rejects(new TaskWorkspaceStore(directoryRoot, 'scope').initialize(), hasCode('corrupt'));
  const fileRoot = path.join(root, 'file-root');
  const fileStore = new TaskWorkspaceStore(fileRoot, 'scope');
  fs.mkdirSync(path.dirname(fileStore.filePath), { recursive: true });
  const preserved = path.join(target, 'preserved.json');
  fs.writeFileSync(preserved, 'unrelated file');
  fs.symlinkSync(preserved, fileStore.filePath, 'file');
  const linked = new TaskWorkspaceStore(fileRoot, 'scope');
  await assert.rejects(linked.initialize(), hasCode('corrupt'));
  assert.equal(fs.readFileSync(preserved, 'utf8'), 'unrelated file');
});

// Navigation saves the same draft contract that reload reads; inline text is not a composer send.
test('inline prompt edits remain task-scoped on disk without replacing the composer or transcript', async t => {
  const root = temporary(t), store = new TaskWorkspaceStore(root, 'inline-edit');
  await store.initialize();
  const a = store.getView().activeTaskId;
  await store.append(a, [message('prompt', 'Original prompt')]);
  const saved = { ...draft('Separate composer'), inlineEdit: { messageId:'prompt', text:'Unsent\nrevision', images:['data:image/png;base64,YQ=='] } };
  await store.saveDraft(a, saved);
  await store.create('B', expected(store));
  const b = store.getView().activeTaskId;
  await store.saveDraft(b, draft('B draft'));
  const reopened = new TaskWorkspaceStore(root, 'inline-edit');
  assert.deepEqual(reopened.getDraft(a), saved);
  assert.deepEqual(reopened.getDraft(b), draft('B draft'));
  assert.equal(reopened.getTask(a).messages[0].content, 'Original prompt');
  await reopened.select(a, expected(reopened));
  await assert.rejects(reopened.saveDraft(a, {...saved, inlineEdit:{...saved.inlineEdit, images:['https://invalid/image']}}), hasCode('invalid'));
  assert.deepEqual(reopened.getDraft(a), saved, 'invalid draft must not overwrite saved edit');
  await reopened.saveDraft(a, draft('Separate composer'));
  assert.deepEqual(new TaskWorkspaceStore(root, 'inline-edit').getDraft(a), draft('Separate composer'));
});
