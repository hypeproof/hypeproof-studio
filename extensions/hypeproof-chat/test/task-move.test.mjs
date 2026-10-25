// Run: node --experimental-strip-types --test test/task-move.test.mjs
// CGP-KNOW-R-009 (REQ-KNOW-14) — the move rule (which activities a task may go to) and the real
// on-disk store halves of a move: export, receive in the destination scope, release from the source.
// A moved task keeps its transcript (with earlier versions), draft and verdicts byte-identical.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { TaskWorkspaceStore } from '../src/taskWorkspaceStore.ts';
import { TASK_MOVE_CLASS_REASON, TASK_MOVE_TRIAL_REASON, isPersonalActivity, taskMoveTarget, taskMoveView } from '../src/taskMove.ts';

const message = (id, content = `Message ${id}`, role = 'user') => ({ id: String(id), content, role, createdAt: 1000 });
const draft = text => ({ text, images: ['data:image/png;base64,cGhvdG8='], queued: '다음 질문', imports: [] });
const expected = store => ({ taskId: store.getView().activeTaskId, revision: store.getView().revision });
const hasCode = code => error => error?.code === code;
const temporary = t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hps-task-move-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
};

const a = { ref: 'ref-a', id: 'a', name: '내 활동', kind: 'personal' };
const others = [
  { ref: 'ref-b', id: 'b', name: '그림 연습', kind: 'personal' },
  { ref: 'ref-pass', id: 'p', name: '이용권', kind: 'trial', pass: true },
  { ref: 'ref-trial', id: 't', name: '체험', kind: 'trial' },
  { ref: 'ref-class', id: 'c', name: '3반 수업', kind: 'classroom' },
  { ref: 'ref-lesson', id: 'l', name: '레슨', kind: 'personal', lesson: true },
  { ref: 'ref-unknown', id: 'u', name: '모름' },
  { ref: 'ref-self', id: 'a', name: '내 활동 (예전 연결)', kind: 'personal' },
];

test('the move menu lists personal activities only; class, lesson, trial and unknown activities neither move nor receive', () => {
  const view = taskMoveView(a, others);
  assert.equal(view.allowed, true);
  assert.deepEqual(view.destinations, [{ ref: 'ref-pass', name: '이용권' }, { ref: 'ref-b', name: '그림 연습' }].sort((x, y) => x.name.localeCompare(y.name, 'ko')));
  for (const current of [{ ...a, kind: 'classroom' }, { ...a, lesson: true }, { ...a, kind: undefined }, { ...a, kind: 'classroom', pass: true }]) {
    assert.deepEqual(taskMoveView(current, others), { allowed: false, reason: TASK_MOVE_CLASS_REASON }, JSON.stringify(current));
  }
  assert.deepEqual(taskMoveView({ ...a, kind: 'trial' }, others), { allowed: false, reason: TASK_MOVE_TRIAL_REASON });
  assert.equal(taskMoveView({ ...a, kind: 'trial', pass: true }, others).allowed, true, 'a bought pass is personal work');
  assert.equal(isPersonalActivity({ kind: 'personal', lesson: true }), false);
  // The host re-derives the destination: only a listed personal ref resolves.
  assert.equal(taskMoveTarget(a, others, 'ref-b')?.id, 'b');
  for (const ref of ['ref-class', 'ref-lesson', 'ref-trial', 'ref-unknown', 'ref-self', 'nope', 42, null, 'x'.repeat(600)]) assert.equal(taskMoveTarget(a, others, ref), undefined, String(ref));
  assert.equal(taskMoveTarget({ ...a, kind: 'classroom' }, others, 'ref-b'), undefined, 'a class task cannot leave');
});

async function seeded(root, scope) {
  const store = new TaskWorkspaceStore(root, scope);
  await store.initialize();
  const first = store.getView().activeTaskId;
  await store.rename(first, '옮길 작업');
  await store.append(first, [message('q1', '첫 질문'), message('a1', '첫 답', 'assistant')]);
  // An edited resend keeps an earlier version in the versions sidecar.
  await store.append(first, [{ ...message('q1b', '고친 질문'), editOf: 'q1' }, message('a1b', '새 답', 'assistant')]);
  await store.recordVerdict(first, { messageId: 'a1b', verdict: 'right', at: 2000 });
  await store.saveDraft(first, draft('아직 보내지 않은 입력 ‮'));
  return { store, first };
}

test('a moved task arrives byte-identical (transcript, versions, draft, verdicts) and leaves the source', async t => {
  const root = temporary(t);
  const { store: source, first } = await seeded(root, 'scope-a');
  const before = JSON.stringify(source.exportTask(first));
  assert.equal(source.exportTask(first).verdicts.length, 1);
  assert.ok(source.exportTask(first).versions, 'the edited resend left an earlier version');
  const history = JSON.stringify(source.getHistory(first)), draftBytes = JSON.stringify(source.getDraft(first));
  await source.create('남는 작업', expected(source));
  const kept = source.getView().activeTaskId;
  const destination = new TaskWorkspaceStore(root, 'scope-b');
  await destination.initialize();
  const destinationActive = destination.getView().activeTaskId;

  await new TaskWorkspaceStore(root, 'scope-b').receiveTask(source.exportTask(first));
  const reread = new TaskWorkspaceStore(root, 'scope-b');
  assert.equal(JSON.stringify(reread.exportTask(first)), before);
  assert.equal(JSON.stringify(reread.getHistory(first)), history);
  assert.equal(JSON.stringify(reread.getDraft(first)), draftBytes);
  assert.equal(reread.getView().activeTaskId, destinationActive, 'receiving does not switch the destination\'s open task');

  await source.releaseTask(first, expected(source));
  const after = new TaskWorkspaceStore(root, 'scope-a');
  assert.equal(after.getTask(first), undefined);
  assert.equal(after.getView().activeTaskId, kept);
  assert.deepEqual(after.getView().tasks.map(task => task.id), [kept]);
  assert.equal(JSON.stringify(after.getHistory(first)), '[]');
  // A retry of the same receive is idempotent; a different task under the same id is refused.
  await new TaskWorkspaceStore(root, 'scope-b').receiveTask(JSON.parse(before));
  assert.equal(new TaskWorkspaceStore(root, 'scope-b').getView().tasks.length, 2);
  const altered = JSON.parse(before); altered.task.draft.text = '다른 입력';
  await assert.rejects(new TaskWorkspaceStore(root, 'scope-b').receiveTask(altered), hasCode('invalid'));
  assert.equal(JSON.stringify(new TaskWorkspaceStore(root, 'scope-b').exportTask(first)), before);
});

test('moving the open task opens the most recent remaining one; moving the only task leaves a new empty one', async t => {
  const root = temporary(t);
  const { store, first } = await seeded(root, 'only');
  await store.releaseTask(first, expected(store));
  const view = new TaskWorkspaceStore(root, 'only').getView();
  assert.equal(view.tasks.length, 1);
  assert.notEqual(view.activeTaskId, first);
  assert.equal(view.tasks[0].title, '새 작업');
  assert.equal(view.tasks[0].messageCount, 0);
});

test('receive refuses an unopened destination, malformed input, and release refuses a stale list', async t => {
  const root = temporary(t);
  const { store, first } = await seeded(root, 'src');
  const moving = store.exportTask(first);
  const unopened = new TaskWorkspaceStore(root, 'never-opened');
  await assert.rejects(unopened.receiveTask(moving), hasCode('not_initialized'));
  assert.equal(fs.existsSync(unopened.filePath), false, 'no store file is created for an unopened activity');
  const dest = new TaskWorkspaceStore(root, 'dest');
  await dest.initialize();
  const bytes = fs.readFileSync(dest.filePath, 'utf8');
  for (const bad of [null, {}, { ...moving, task: { ...moving.task, messages: 'x' } }, { ...moving, verdicts: [{}] }, { ...moving, versions: { hidden: 'x' } }]) {
    await assert.rejects(dest.receiveTask(bad), hasCode('invalid'));
  }
  assert.equal(fs.readFileSync(dest.filePath, 'utf8'), bytes);
  // Another window changed the source list after the learner chose: nothing is removed.
  const other = new TaskWorkspaceStore(root, 'src');
  await other.create('다른 창', expected(other));
  await assert.rejects(store.releaseTask(first, { taskId: first, revision: 1 }), error => ['stale'].includes(error?.code));
  assert.ok(new TaskWorkspaceStore(root, 'src').getTask(first));
});

test('the rule ignores the service field: the host list is already the current service, and a full record as current still lists', () => {
  const record = { ...a, service: 'https://api.example', token: 'secret', workspace: '/w' };
  const summaries = others.map(({ ref, id, name, kind, pass, lesson }) => ({ ref, id, name, kind, ...(pass ? { pass } : {}), ...(lesson ? { lesson } : {}), workspace: '/x' }));
  assert.deepEqual(taskMoveView(record, summaries).destinations.map(d => d.ref).sort(), ['ref-b', 'ref-pass']);
  assert.equal(taskMoveTarget(record, summaries, 'ref-b')?.id, 'b');
  assert.equal(taskMoveView({ ...a, kind: undefined, pass: true }, others).allowed, true, 'a pass with no kind is personal work');
});

test('withdraw removes only the exact received task, never the open one or a changed one', async t => {
  const root = temporary(t);
  const { store: source, first } = await seeded(root, 'w-src');
  const moving = source.exportTask(first);
  const dest = new TaskWorkspaceStore(root, 'w-dest');
  await dest.initialize();
  const open = dest.getView().activeTaskId;
  await new TaskWorkspaceStore(root, 'w-dest').receiveTask(moving);
  const changed = JSON.parse(JSON.stringify(moving)); changed.task.title = '다른 이름';
  assert.equal(await new TaskWorkspaceStore(root, 'w-dest').withdrawTask(changed), false);
  assert.equal(await new TaskWorkspaceStore(root, 'w-dest').withdrawTask({ ...moving, task: new TaskWorkspaceStore(root, 'w-dest').getTask(open) }), false, 'the open task is never withdrawn');
  assert.equal(await new TaskWorkspaceStore(root, 'w-dest').withdrawTask(moving), true);
  const after = new TaskWorkspaceStore(root, 'w-dest');
  assert.equal(after.getTask(first), undefined);
  assert.deepEqual(after.getView().tasks.map(task => task.id), [open]);
  assert.deepEqual(after.exportTask(open).verdicts, []);
  assert.ok(new TaskWorkspaceStore(root, 'w-src').getTask(first), 'the source is untouched');
});

test('an interrupted receive (the verdict sidecar write fails) leaves the list unchanged and a retry succeeds', async t => {
  const root = temporary(t);
  const { store: source, first } = await seeded(root, 'i-src');
  const moving = source.exportTask(first);
  const dest = new TaskWorkspaceStore(root, 'i-dest');
  await dest.initialize();
  const before = fs.readFileSync(dest.filePath, 'utf8');
  // The verdict sidecar cannot be written: the task must not be listed without its verdicts.
  const receiving = new TaskWorkspaceStore(root, 'i-dest');
  const write = receiving.writeAtomic.bind(receiving);
  receiving.writeAtomic = async (target, content, nonce) => { if (target === receiving.verdictsPath) throw new Error('synthetic disk full'); return write(target, content, nonce); };
  await assert.rejects(receiving.receiveTask(moving), hasCode('io'));
  assert.equal(fs.readFileSync(dest.filePath, 'utf8'), before, 'the list did not change');
  await new TaskWorkspaceStore(root, 'i-dest').receiveTask(moving);
  assert.equal(JSON.stringify(new TaskWorkspaceStore(root, 'i-dest').exportTask(first)), JSON.stringify(moving));
});

// Verifier S1: the source's task-file write fails during release. The task must stay with every
// earlier version and verdict: the task file is the commit point, the versions entry goes after it.
test('a release whose task-file write fails keeps the task with its earlier versions and verdicts', async t => {
  const root = temporary(t);
  const { store, first } = await seeded(root, 's1-src');
  await store.create('남는 작업', expected(store));
  const before = JSON.stringify(store.exportTask(first));
  assert.ok(store.exportTask(first).versions, 'the seeded task has earlier versions');
  const write = store.writeAtomic.bind(store);
  store.writeAtomic = async (target, content, nonce) => { if (target === store.filePath) throw new Error('synthetic EIO'); return write(target, content, nonce); };
  await assert.rejects(store.releaseTask(first, expected(store)), hasCode('io'));
  assert.equal(JSON.stringify(new TaskWorkspaceStore(root, 's1-src').exportTask(first)), before, 'the task, its versions and verdicts are on disk as before');
});

// The same order holds for withdraw (undoing a receive) and a later receive clears leftovers.
test('withdraw keeps the versions while its task-file write fails; a leftover sidecar entry never attaches to a later receive', async t => {
  const root = temporary(t);
  const { store: source, first } = await seeded(root, 'o-src');
  const moving = source.exportTask(first);
  const dest = new TaskWorkspaceStore(root, 'o-dest');
  await dest.initialize();
  await new TaskWorkspaceStore(root, 'o-dest').receiveTask(moving);
  const failing = new TaskWorkspaceStore(root, 'o-dest');
  const write = failing.writeAtomic.bind(failing);
  failing.writeAtomic = async (target, content, nonce) => { if (target === failing.filePath) throw new Error('synthetic EIO'); return write(target, content, nonce); };
  await assert.rejects(failing.withdrawTask(moving), hasCode('io'));
  assert.equal(JSON.stringify(new TaskWorkspaceStore(root, 'o-dest').exportTask(first)), JSON.stringify(moving), 'the received copy is still whole');
  // A release interrupted after the task file leaves sidecar entries for an id the list no longer
  // holds. A later receive of that id without versions or verdicts must not inherit them.
  const releasing = new TaskWorkspaceStore(root, 'o-dest');
  const mutate = releasing.mutate.bind(releasing);
  let calls = 0;
  releasing.mutate = (...args) => (++calls === 2 ? Promise.reject(new Error('synthetic')) : mutate(...args));
  releasing.dropVerdicts = async () => { throw new Error('synthetic'); };
  await releasing.releaseTask(first, expected(releasing));
  assert.equal(new TaskWorkspaceStore(root, 'o-dest').getTask(first), undefined);
  const bare = { ...JSON.parse(JSON.stringify(moving)), versions: null, verdicts: [] };
  await new TaskWorkspaceStore(root, 'o-dest').receiveTask(bare);
  const back = new TaskWorkspaceStore(root, 'o-dest').exportTask(first);
  assert.equal(back.versions, null, 'no leftover versions');
  assert.deepEqual(back.verdicts, [], 'no leftover verdicts');
});
