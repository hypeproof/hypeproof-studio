// CGP-KNOW-R-008 / REQ-STUDIO-TASK-APPEARANCE: the production store on disk and the real provider.
// A task's emoji/colour persists across a restart (a new store reads the sidecar), only listed ids
// are accepted, the task file stays byte-identical (earlier builds keep reading it), a corrupt
// sidecar costs only the marks, and a folder move carries them. The host answers each request.
// Run: node --experimental-strip-types test/task-appearance.smoke.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TaskWorkspaceStore } from '../src/taskWorkspaceStore.ts';
import { parseTaskAppearanceRequest, validTaskAppearance, TASK_COLOURS, TASK_EMOJI } from '../src/taskAppearance.ts';
import { createTaskHarness } from './task-workspace-harness.mjs';

const roots = [];
const temporary = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hps-task-appearance-')); roots.push(root); return root; };
const rejects = async (promise, code) => { await assert.rejects(promise, error => error?.code === code); };
const expected = store => ({ taskId: store.getView().activeTaskId, revision: store.getView().revision });
const mark = (store, id) => store.getView().tasks.find(task => task.id === id)?.appearance;

try {
  // Validation: ids only, from the fixed lists; at least one set; no extra keys.
  assert.equal(TASK_COLOURS.length, 8, 'eight colours (DES-KNOW-13)');
  assert.ok(TASK_COLOURS.every(entry => /^[가-힣]+$/.test(entry.name)) && TASK_EMOJI.every(entry => /^[가-힣]+$/.test(entry.name)), 'every choice has a Korean text name');
  assert.ok(validTaskAppearance({ emoji: 'star' }) && validTaskAppearance({ colour: 'blue' }) && validTaskAppearance({ emoji: 'cat', colour: 'pink' }));
  for (const bad of [{}, { emoji: '⭐' }, { colour: '#ff0000' }, { emoji: 'star', title: 'x' }, { emoji: 'Star' }, { colour: 'blue‮' }, [], 'star', null])
    assert.equal(validTaskAppearance(bad), false, `refused: ${JSON.stringify(bad)}`);
  assert.equal(parseTaskAppearanceRequest(null), null);
  assert.equal(parseTaskAppearanceRequest({}), null, 'nothing chosen clears');
  assert.deepEqual(parseTaskAppearanceRequest({ emoji: 'star', colour: undefined }), { emoji: 'star' });
  assert.equal(parseTaskAppearanceRequest({ emoji: '<img src=x>' }), undefined);
  assert.equal(parseTaskAppearanceRequest('star'), undefined);

  // Persist across restart; the task file is untouched and keeps the strict schema.
  const root = temporary(), scope = 'appearance-scope';
  const store = new TaskWorkspaceStore(root, scope);
  await store.initialize();
  const first = store.getView().activeTaskId;
  await store.rename(first, '고양이 페이지');
  const before = fs.readFileSync(store.filePath, 'utf8');
  const updatedAt = store.getView().tasks[0].updatedAt;
  await store.setAppearance(first, { emoji: 'cat', colour: 'pink' });
  assert.deepEqual(mark(store, first), { emoji: 'cat', colour: 'pink' });
  assert.equal(fs.readFileSync(store.filePath, 'utf8'), before, 'the task file is not rewritten (older builds still read it)');
  assert.equal(store.getView().tasks[0].title, '고양이 페이지', 'the title is unchanged');
  assert.equal(store.getView().tasks[0].updatedAt, updatedAt, 'a mark does not move the task in the list');
  assert.ok(!JSON.parse(before).data.tasks.some(task => 'appearance' in task));
  const restarted = new TaskWorkspaceStore(root, scope);
  assert.deepEqual(mark(restarted, first), { emoji: 'cat', colour: 'pink' }, 'persists across restart');
  assert.equal(restarted.getView().tasks[0].title, '고양이 페이지');

  // Only the open task; invalid shapes are refused before any write.
  await restarted.create('새 작업', expected(restarted));
  const second = restarted.getView().activeTaskId;
  await rejects(restarted.setAppearance(first, { emoji: 'star' }), 'stale');
  await rejects(restarted.setAppearance(second, { emoji: 'nope' }), 'invalid');
  await rejects(restarted.setAppearance(second, { emoji: 'star', extra: 1 }), 'invalid');
  await restarted.setAppearance(second, { colour: 'teal' });
  // A second window's write does not drop the first task's mark (read-modify-write under the lock).
  assert.deepEqual(mark(new TaskWorkspaceStore(root, scope), first), { emoji: 'cat', colour: 'pink' });
  assert.deepEqual(mark(new TaskWorkspaceStore(root, scope), second), { colour: 'teal' });
  // Clearing removes the record.
  await restarted.setAppearance(second, null);
  assert.equal(mark(new TaskWorkspaceStore(root, scope), second), undefined);

  // A corrupt sidecar costs only the marks: tasks and titles still load; the next write sets it aside.
  fs.writeFileSync(restarted.appearancePath, '{"checksum":"bad","data":{}}');
  const damaged = new TaskWorkspaceStore(root, scope);
  assert.equal(damaged.getView().error, undefined, 'the workspace itself is fine');
  assert.equal(damaged.getView().tasks.length, 2);
  assert.ok(damaged.getView().tasks.every(task => task.appearance === undefined));
  await damaged.setAppearance(second, { emoji: 'rocket' });
  assert.ok(fs.readdirSync(path.dirname(damaged.appearancePath)).some(name => name.includes('.appearance.json.unreadable-')), 'the unreadable file is kept aside, not overwritten');
  assert.deepEqual(mark(new TaskWorkspaceStore(root, scope), second), { emoji: 'rocket' });
  // A forged sidecar with a valid checksum but an unknown id is refused as a whole.
  const forged = { version: 1, scope: damaged.scope, tasks: { [second]: { emoji: '<script>' } } };
  const { createHash } = await import('node:crypto');
  fs.writeFileSync(damaged.appearancePath, JSON.stringify({ checksum: createHash('sha256').update(JSON.stringify(forged)).digest('hex'), data: forged }));
  assert.ok(new TaskWorkspaceStore(root, scope).getView().tasks.every(task => task.appearance === undefined), 'unknown ids never reach the view');

  // A folder move (adoptFrom) carries the marks with the tasks.
  const moveRoot = temporary();
  const source = new TaskWorkspaceStore(moveRoot, 'old-folder');
  await source.initialize();
  const moved = source.getView().activeTaskId;
  await source.setAppearance(moved, { emoji: 'books', colour: 'green' });
  const target = new TaskWorkspaceStore(moveRoot, 'new-folder');
  await target.adoptFrom(source);
  assert.deepEqual(mark(target, moved), { emoji: 'books', colour: 'green' });
  assert.deepEqual(mark(new TaskWorkspaceStore(moveRoot, 'new-folder'), moved), { emoji: 'books', colour: 'green' }, 'carried mark persists');
  assert.deepEqual(mark(source, moved), { emoji: 'books', colour: 'green' }, 'the source is only read');

  // Host: the real provider answers with a result bound to the request and task.
  const hostRoot = temporary();
  const f = await createTaskHarness(hostRoot);
  const id = f.store.getView().activeTaskId;
  await f.handle(f.scoped({ type: 'taskAppearance', appearance: { emoji: 'star', colour: 'blue' }, requestId: 'appearance-ok' }));
  assert.deepEqual(f.posts.findLast(p => p.type === 'taskAppearanceResult'), { type: 'taskAppearanceResult', requestId: 'appearance-ok', taskId: id, saved: true, activityId: f.activity.id });
  assert.deepEqual(f.posts.findLast(p => p.type === 'taskWorkspaceState').view.tasks[0].appearance, { emoji: 'star', colour: 'blue' });
  await f.handle(f.scoped({ type: 'taskAppearance', appearance: { emoji: '💣' }, requestId: 'appearance-bad' }));
  assert.equal(f.posts.findLast(p => p.type === 'taskAppearanceResult').saved, false, 'an unlisted emoji is refused');
  assert.equal(f.posts.findLast(p => p.type === 'taskWorkspaceError').error, '고를 수 있는 아이콘과 색이 아닙니다.');
  await f.handle(f.scoped({ type: 'taskAppearance', appearance: { emoji: 'cat' }, requestId: 'bad id with spaces' }));
  assert.equal(f.posts.findLast(p => p.type === 'taskAppearanceResult').requestId, 'appearance-bad', 'a malformed request id gets no result echo');
  assert.deepEqual(JSON.parse(JSON.stringify(f.store.getView().tasks[0].appearance)), { emoji: 'star', colour: 'blue' }, 'refused requests change nothing');
  await f.handle(f.scoped({ type: 'taskAppearance', appearance: null, requestId: 'appearance-clear' }));
  assert.equal(f.posts.findLast(p => p.type === 'taskAppearanceResult').saved, true);
  assert.equal(f.store.getView().tasks[0].appearance, undefined, 'cleared');
  // A request for a task that is no longer open is refused by the provider's task guard.
  await f.handle({ ...f.scoped({ type: 'taskAppearance', appearance: { emoji: 'cat' }, requestId: 'appearance-stale' }), taskId: 'another-task' });
  assert.equal(f.store.getView().tasks[0].appearance, undefined, 'a stale task id writes nothing');
  // While a task switch is in progress the request is dropped, and the picker is told at once.
  f.h.taskChanging = true;
  await f.handle(f.scoped({ type: 'taskAppearance', appearance: { emoji: 'cat' }, requestId: 'appearance-busy' }));
  f.h.taskChanging = false;
  assert.deepEqual(JSON.parse(JSON.stringify(f.posts.findLast(p => p.type === 'taskAppearanceResult'))), { type: 'taskAppearanceResult', requestId: 'appearance-busy', taskId: id, saved: false, activityId: f.activity.id }, 'a dropped request gets a failure result, not silence');
  assert.equal(f.store.getView().tasks[0].appearance, undefined, 'and writes nothing');
  console.log('PASS task appearance: validation, restart persistence, untouched task file, open-task only, corrupt/forged sidecar, folder move, host result');
} finally {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
}
