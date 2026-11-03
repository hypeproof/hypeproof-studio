// CGP-CHAT-R-025 (REQ-STUDIO-TASK-ARCHIVE) — 보관하기 / 보관함 / 다시 열기 on the production store and host.
// Run: node --experimental-strip-types --test test/task-archive.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { TaskWorkspaceStore } from '../src/taskWorkspaceStore.ts';
import { createTaskHarness } from './task-workspace-harness.mjs';

const message = (id, content = `Message ${id}`, role = 'user') => ({ id: String(id), content, role, createdAt: 1000 });
const draft = text => ({ text, images: [], queued: null });
const expected = store => ({ taskId: store.getView().activeTaskId, revision: store.getView().revision });
const hasCode = code => error => error?.code === code;
const temporary = t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hps-task-archive-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
};
// Array.from: the host harness store lives in another realm, and deepStrictEqual compares prototypes.
const ids = list => Array.from(list ?? [], task => task.id);
const taskOnDisk = (store, id) => JSON.parse(fs.readFileSync(store.filePath, 'utf8')).data.tasks.find(task => task.id === id);

test('보관하기 hides the open task, keeps transcript, draft, versions and verdicts byte for byte, and 다시 열기 brings it back', async t => {
  const root = temporary(t), scope = 'archive-basic', store = new TaskWorkspaceStore(root, scope);
  await store.initialize();
  const first = store.getView().activeTaskId;
  await store.append(first, [message('q1', '첫 질문'), message('a1', '첫 답변', 'assistant')]);
  // An edited resend puts the first attempt in the versions sidecar.
  await store.append(first, [{ ...message('q1-v2', '고친 질문'), editOf: 'q1' }]);
  await store.recordVerdict(first, { messageId: 'a1', verdict: 'right', at: 1500 });
  await store.saveDraft(first, draft('아직 보내지 않은 입력'));
  await store.create('두 번째 작업', expected(store));
  const second = store.getView().activeTaskId;
  await store.select(first, expected(store));
  const before = taskOnDisk(store, first);
  const versionsBefore = fs.readFileSync(store.versionsPath, 'utf8');
  const verdictsBefore = fs.readFileSync(store.verdictsPath, 'utf8');
  const historyBefore = store.getHistory(first);

  await store.archiveTask(first, expected(store));
  const view = store.getView();
  assert.equal(view.activeTaskId, second, 'the most recent listed task opens next');
  assert.deepEqual(ids(view.tasks), [second], 'the archived task is not in the list');
  assert.deepEqual(ids(view.archived), [first], 'it is listed in 보관함');
  assert.equal(typeof view.archived[0].archivedAt, 'number');
  assert.deepEqual(taskOnDisk(store, first), before, 'the task document (transcript, draft, title, times) is unchanged');
  assert.equal(fs.readFileSync(store.versionsPath, 'utf8'), versionsBefore, 'earlier versions are kept');
  assert.equal(fs.readFileSync(store.verdictsPath, 'utf8'), verdictsBefore, 'answer verdicts are kept');
  assert.deepEqual(store.getHistory(first), historyBefore);
  assert.ok(!Object.keys(before).some(key => /archiv/i.test(key)), 'the task file keeps the shape older builds accept');

  const reopened = new TaskWorkspaceStore(root, scope);
  assert.deepEqual(ids(reopened.getView().archived), [first], 'the archive survives a restart');
  assert.deepEqual(ids(reopened.getView().tasks), [second]);

  await assert.rejects(store.select(first, expected(store)), hasCode('not_found'), 'an archived task opens only through 다시 열기');
  assert.equal(store.getView().activeTaskId, second);

  await store.restoreTask(first, expected(store));
  const back = store.getView();
  assert.equal(back.activeTaskId, first, '다시 열기 opens the task');
  assert.deepEqual(ids(back.archived), []);
  assert.deepEqual(new Set(ids(back.tasks)), new Set([first, second]));
  assert.deepEqual(taskOnDisk(store, first), before);
  assert.equal(store.getDraft(first).text, '아직 보내지 않은 입력');
  assert.deepEqual(store.getHistory(first), historyBefore);
  assert.equal(store.getVerdicts(first).a1?.verdict, 'right');
  await assert.rejects(store.restoreTask(first, expected(store)), hasCode('not_found'), 'a listed task cannot be restored again');
});

test('archiving the only listed task opens a new empty task; only the open task can be archived, against the current revision', async t => {
  const root = temporary(t), store = new TaskWorkspaceStore(root, 'archive-last');
  await store.initialize();
  const only = store.getView().activeTaskId;
  await store.append(only, [message('kept', '남길 대화')]);
  await store.create('다른 작업', expected(store));
  const other = store.getView().activeTaskId;
  await assert.rejects(store.archiveTask(only, expected(store)), hasCode('stale'), 'a task that is not open cannot be archived');
  await assert.rejects(store.archiveTask(other, { taskId: other, revision: store.getView().revision - 1 }), hasCode('stale'));
  assert.deepEqual(store.getView().archived, []);
  await store.archiveTask(other, expected(store));
  assert.equal(store.getView().activeTaskId, only);
  await store.archiveTask(only, expected(store));
  const view = store.getView();
  assert.deepEqual(new Set(ids(view.archived)), new Set([only, other]));
  assert.equal(view.tasks.length, 1);
  assert.notEqual(view.activeTaskId, only);
  assert.equal(view.tasks[0].title, '새 작업');
  assert.equal(view.tasks[0].messageCount, 0);
  assert.deepEqual(store.getHistory(only).map(m => m.content), ['남길 대화']);
});

test('the archive sidecar is untrusted: unreadable reads as nothing archived and is set aside; an archived open task stays listed', async t => {
  const root = temporary(t), scope = 'archive-sidecar', store = new TaskWorkspaceStore(root, scope);
  await store.initialize();
  const first = store.getView().activeTaskId;
  await store.create('둘', expected(store));
  await store.archiveTask(store.getView().activeTaskId, expected(store));
  const archivePath = store.archivePath;
  const good = fs.readFileSync(archivePath, 'utf8');
  // A crash between the sidecar and the task file: the sidecar names the still-open task.
  const data = JSON.parse(good).data;
  data.tasks[first] = 5;
  const { createHash } = await import('node:crypto');
  fs.writeFileSync(archivePath, JSON.stringify({ checksum: createHash('sha256').update(JSON.stringify(data)).digest('hex'), data }));
  const crashed = new TaskWorkspaceStore(root, scope);
  assert.equal(crashed.getView().activeTaskId, first);
  assert.ok(ids(crashed.getView().tasks).includes(first), 'the open task is always listed');
  assert.ok(!ids(crashed.getView().archived).includes(first));
  // Tampered bytes, a prototype key and a wrong scope all read as nothing archived.
  for (const text of ['not json', JSON.stringify({ checksum: 'x', data }), JSON.stringify({ checksum: createHash('sha256').update(JSON.stringify({ ...data, scope: 'other' })).digest('hex'), data: { ...data, scope: 'other' } })]) {
    fs.writeFileSync(archivePath, text);
    assert.deepEqual(new TaskWorkspaceStore(root, scope).getView().archived, [], text.slice(0, 20));
  }
  fs.writeFileSync(archivePath, 'not json');
  const fresh = new TaskWorkspaceStore(root, scope);
  assert.equal(fresh.getView().tasks.length, 2, 'a lost archive only lists every task again');
  await fresh.archiveTask(fresh.getView().activeTaskId, expected(fresh));
  assert.ok(fs.readdirSync(path.dirname(archivePath)).some(name => name.startsWith(`${path.basename(archivePath)}.unreadable-`)), 'the unreadable sidecar is kept aside, never overwritten in place');
  assert.equal(fresh.getView().archived.length, 1);
});

test('a folder move carries the archive: archived stays archived, listed stays listed', async t => {
  const root = temporary(t);
  const source = new TaskWorkspaceStore(root, 'archive-move-from');
  await source.initialize();
  const kept = source.getView().activeTaskId;
  await source.append(kept, [message('m', '옮길 대화')]);
  await source.create('보관할 작업', expected(source));
  const hidden = source.getView().activeTaskId;
  await source.archiveTask(hidden, expected(source));
  const target = new TaskWorkspaceStore(root, 'archive-move-to');
  await target.initialize();
  await target.adoptFrom(source);
  assert.deepEqual(ids(target.getView().archived), [hidden]);
  assert.ok(ids(target.getView().tasks).includes(kept));
  assert.deepEqual(ids(new TaskWorkspaceStore(root, 'archive-move-to').getView().archived), [hidden]);
});

test('actual host: a running task must be stopped first; archive flushes the draft; 다시 열기 reopens', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'task-archive-host-'));
  try {
    let f;
    f = await createTaskHarness(root, msg => {
      if (msg.type === 'activityFreeze' && msg.nonce) void f.handle(f.scoped({ type: 'saveActivityDraft', nonce: msg.nonce, draft: draft('보관 직전 입력') }));
    });
    const first = f.store.getView().activeTaskId;
    await f.store.append(first, [message('q', '보관할 대화')]);
    await f.handle(f.scoped({ type: 'taskCreate' }));
    const second = f.store.getView().activeTaskId;
    await f.handle(f.scoped({ type: 'taskSelect', id: first }));
    assert.equal(f.store.getView().activeTaskId, first);

    // A turn in flight, a stopped turn still settling, an approval or a verification run: refused.
    f.h.pendingSends = 1;
    await f.handle(f.scoped({ type: 'taskArchive' }));
    assert.deepEqual(ids(f.store.getView().archived), [], 'nothing is archived while the task runs');
    assert.equal(f.store.getView().activeTaskId, first);
    assert.match(f.posts.at(-1).error, /멈춘 뒤/);
    f.h.pendingSends = 0;
    f.h.activeStreams.set('running', new AbortController());
    await f.handle(f.scoped({ type: 'taskArchive' }));
    assert.deepEqual(ids(f.store.getView().archived), []);
    f.h.activeStreams.clear();
    f.h.verifySession = { running: true };
    await f.handle(f.scoped({ type: 'taskArchive' }));
    assert.deepEqual(ids(f.store.getView().archived), []);
    f.h.verifySession.running = false;

    // A message for another task (a stale view) is dropped.
    await f.handle({ type: 'taskArchive', activityId: f.activity.id, taskId: second });
    assert.deepEqual(ids(f.store.getView().archived), []);

    // CGP-AGENT-R-004: "이번 작업 동안" allows end with the task, also when it is archived or another is reopened.
    let ended = 0;
    const endAllows = f.h.endTaskCommandAllows;
    f.h.endTaskCommandAllows = function () { ended++; return endAllows.call(this); };
    await f.handle(f.scoped({ type: 'taskArchive' }));
    assert.equal(ended, 1, 'archiving ends the task-scoped command allows');
    const view = f.store.getView();
    assert.deepEqual(ids(view.archived), [first]);
    assert.equal(view.activeTaskId, second);
    assert.equal(f.store.getTask(first).draft.text, '보관 직전 입력', 'the draft on screen is saved into the archived task first');
    assert.deepEqual(Array.from(f.store.getHistory(first), m => m.content), ['보관할 대화']);
    const state = f.posts.findLast(m => m.type === 'taskWorkspaceState');
    assert.deepEqual(ids(state.view.archived), [first], 'the webview receives the 보관함 list');
    assert.equal(f.h.connectionChanging, false);
    assert.equal(f.h.taskChanging, false);

    f.h.pendingSends = 1;
    await f.handle(f.scoped({ type: 'taskRestore', id: first }));
    assert.deepEqual(ids(f.store.getView().archived), [first], '다시 열기 also waits for the running turn');
    f.h.pendingSends = 0;
    for (const id of [second, 'missing', '__proto__', 42]) {
      await f.handle(f.scoped({ type: 'taskRestore', id }));
      assert.equal(f.store.getView().activeTaskId, second, `restore of ${String(id)} is refused`);
      assert.equal(f.posts.at(-1).type, 'taskWorkspaceError');
    }
    await f.handle(f.scoped({ type: 'taskRestore', id: first }));
    assert.equal(f.store.getView().activeTaskId, first);
    assert.equal(ended, 2, '다시 열기 ends them too');
    assert.deepEqual(ids(f.store.getView().archived), []);
    assert.equal(f.posts.findLast(m => m.type === 'config').config.activityDraft.text, '보관 직전 입력', 'the reopened task shows its kept draft');

    // 내 작업 가져가기 still takes archived tasks: they are the learner's work. The flow is stopped at its first dialog.
    await f.handle(f.scoped({ type: 'taskArchive' }));
    assert.deepEqual(ids(f.store.getView().archived), [first]);
    f.h.cachedProfile = { activity_kind: 'personal' }; f.h._instructorMode = { isInstructor: false }; f.h.resolveCoachCwd = () => root;
    f.vscode.workspace.getConfiguration = () => ({ get: (key, fallback) => key === 'workTakeawayEnabled' ? true : fallback });
    let dialogs = 0;
    f.vscode.window.showQuickPick = async () => { dialogs++; return undefined; };
    f.vscode.window.showWarningMessage = async () => {};
    const read = [], getHistory = f.store.getHistory;
    f.store.getHistory = function (id) { read.push(id); return getHistory.call(this, id); };
    await f.h.takeMyWork();
    f.store.getHistory = getHistory;
    assert.equal(dialogs, 1, 'the takeaway flow reached its first dialog');
    assert.ok(read.includes(first), 'an archived task is part of 내 작업 가져가기');
    assert.ok(read.includes(f.store.getView().activeTaskId));
  } finally { await rm(root, { recursive: true, force: true }); }
});
