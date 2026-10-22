import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTaskHarness } from './task-workspace-harness.mjs';
const root = await mkdtemp(join(tmpdir(), 'shell-process-'));
try {
  const f = await createTaskHarness(root);
  const { TaskWorkspaceStore } = f.internals;
  const shell = { purpose: '서버 확인', command: 'npm run dev', collapsed: true };
  const message = { id: 'shell', role: 'tool', content: '', createdAt: 1000, tool: { icon: '', label: '', state: 'done', shell } };
  await f.store.append(f.store.getView().activeTaskId, [message]);
  const persisted = new TaskWorkspaceStore(root, 'synthetic-personal-a').getActiveTask().messages[0].tool;
  assert.equal(persisted.label, '서버 확인\n$ npm run dev', 'no folder line is stored when none is known');
  assert.deepEqual(Object.keys(persisted).sort(), ['icon', 'label', 'state'], 'old task-file schema remains readable');
  for (const bad of [{ ...shell, command: [] }, { ...shell, collapsed: 'false' }, { ...shell, purpose: 'x'.repeat(501) }, { ...shell, folder: 'x'.repeat(2001) }, { ...shell, folder: 7 }, { ...shell, command: 'x'.repeat(2001) }, { ...shell, extra: true }]) {
    await assert.rejects(f.store.append(f.store.getView().activeTaskId, [{ ...message, id: 'bad', tool: { ...message.tool, shell: bad } }]));
  }
  let url = 'http://127.0.0.1:43210/', listening = true, release;
  f.h.resolveCoachCwd = () => root;
  f.h.liveServer = { currentUrl: () => url, currentRoot: () => root, isListening: () => listening, stop: async () => { await new Promise(r => { release = r; }); url = undefined; listening = false; f.h.observeLiveProcess(); } };
  f.h.observeLiveProcess();
  const id = f.posts.at(-1).entries[0].id;
  assert.equal(f.posts.at(-1).entries[0].purpose, '라이브 서버');
  assert.equal(f.posts.at(-1).entries[0].folder, '.');
  const stopping = f.handle(f.scoped({ type: 'stopRunningProcess', id }));
  await new Promise(r => setTimeout(r, 0));
  assert.equal(f.posts.at(-1).entries[0].state, 'stopping');
  release(); await stopping;
  assert.equal(f.posts.at(-1).entries[0].state, 'stopped');
  url = 'http://127.0.0.1:43210/'; listening = true; f.h.observeLiveProcess();
  assert.notEqual(f.posts.at(-1).entries.at(-1).id, id, 'reused port must get a new owned handle');
  await f.handle(f.scoped({ type: 'stopRunningProcess', id }));
  assert.equal(f.posts.at(-1).entries.filter(e => e.state === 'running').length, 1);
  // The server moves to another address without a stop in between: the old entry settles, a new one starts.
  const first = f.posts.at(-1).entries.find(e => e.state === 'running').id;
  url = 'http://127.0.0.1:43211/'; f.h.observeLiveProcess();
  assert.equal(f.posts.at(-1).entries.find(e => e.id === first).state, 'done', 'old address entry settles');
  assert.equal(f.posts.at(-1).entries.filter(e => e.state === 'running').length, 1);
  // Race: the address changes before the host observes it; a stop on the stale handle must not
  // stop the server that now runs, and must not stay in 멈추는 중.
  const second = f.posts.at(-1).entries.find(e => e.state === 'running').id;
  let serverStops = 0; const realStop = f.h.liveServer.stop;
  f.h.liveServer.stop = async () => { serverStops++; };
  url = 'http://127.0.0.1:43212/';
  await f.handle(f.scoped({ type: 'stopRunningProcess', id: second }));
  assert.equal(serverStops, 0, 'a stale live-server handle never stops the current server');
  assert.equal(f.h.runningProcesses.list().find(e => e.id === second).state, 'done', 'stale stop settles instead of hanging');
  f.h.liveServer.stop = realStop;
  url = undefined; listening = false; f.h.observeLiveProcess();
  assert.equal(f.posts.at(-1).entries.filter(e => e.state === 'running').length, 0);
  const old = f.h.runningProcesses;
  let oldStops = 0;
  old.add('old-run', '이전 활동 서버', undefined, async () => { oldStops++; });
  const firstScope = f.connections.scope;
  f.connections.active = { ...f.activity, id: 'other-activity' };
  assert.notEqual(f.connections.scope, firstScope, 'the activity really changed');
  assert.equal(f.h.runningProcesses.list().length, 0);
  // Through the message path: a stop request in the new activity never reaches the old activity's handle,
  // whether it carries the current activity id or none.
  await f.handle({ type: 'stopRunningProcess', id: 'old-run', activityId: f.connections.scope });
  await f.handle({ type: 'stopRunningProcess', id: 'old-run' });
  assert.equal(oldStops, 0, 'a stop after an activity switch searches only the current activity');
  assert.equal(old.list().find(e => e.id === 'old-run').state, 'running', 'the old activity entry is untouched');
  // Positive control: back in the owning activity the same message does stop it.
  f.connections.active = f.activity;
  await f.handle(f.scoped({ type: 'stopRunningProcess', id: 'old-run' }));
  assert.equal(oldStops, 1, 'the owning activity can still stop its own process');
  old.finish('old-run', 'stopped');
  f.connections.active = { ...f.activity, id: 'other-activity' };
  const count = f.posts.length;
  old.finish(id, 'done'); assert.equal(f.posts.length, count, 'old scope must not broadcast into new activity');
  await f.h.runningProcesses.stop(id); assert.equal(f.h.runningProcesses.list().length, 0);
  console.log('shell-process-host: PASS (store reload, delayed close, restarts, activity isolation incl. stop message after a switch)');
} finally { await rm(root, { recursive: true, force: true }); }
