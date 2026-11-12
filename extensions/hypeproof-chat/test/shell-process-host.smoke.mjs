import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
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
  // Jay 2026-10-29: the entry names the preview server, what it serves in words (never ".") and its address.
  assert.equal(f.posts.at(-1).entries[0].purpose, '미리보기 서버');
  assert.equal(f.posts.at(-1).entries[0].kind, 'preview');
  assert.equal(f.posts.at(-1).entries[0].folder, `작업 폴더 전체 (${basename(root)})`);
  assert.equal(f.posts.at(-1).entries[0].address, '127.0.0.1:43210');
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
  // A -> B -> A: the config post shows each activity's own running entries again (verify3 V5).
  {
    const lists = () => f.posts.filter(m => m.type === 'runningProcesses');
    f.connections.active = f.activity;
    f.h.runningProcesses.add('a-run', 'A 서버', '.', async () => {});
    f.connections.active = { ...f.activity, id: 'other-activity' };
    await f.h.postConfig();
    assert.equal(lists().at(-1).entries.some(e => e.id === 'a-run'), false, 'activity B never shows A\'s entry');
    f.connections.active = f.activity;
    await f.h.postConfig();
    assert.equal(lists().at(-1).entries.find(e => e.id === 'a-run')?.state, 'running', 'back in A, its running entry is shown again');
    f.h.runningProcesses.finish('a-run', 'stopped');
  }
  // A reloaded webview's `ready` lists a server that started without a change event reaching the
  // provider (verify R2): only the ready refresh can add it.
  {
    const lists = () => f.posts.filter(m => m.type === 'runningProcesses');
    f.connections.active = f.activity;
    f.h.liveServer = { currentUrl: () => 'http://127.0.0.1:43299/', currentRoot: () => root, isListening: () => true, stop: async () => {} };
    const before = lists().length;
    await f.handle(f.scoped({ type: 'ready' }));
    assert.ok(lists().slice(before).some(m => m.entries.some(e => e.purpose === '미리보기 서버' && e.state === 'running')), 'ready lists the running live server');
    f.h.liveServer = { currentUrl: () => undefined, currentRoot: () => root, isListening: () => false, stop: async () => {} };
    f.h.observeLiveProcess();
  }
  // The provider built by its real constructor follows the real LiveServer's own change events
  // (verify3 blocker 2): the entry appears when the server starts and settles when it stops, with
  // no observeLiveProcess or ready call. Kills a missing constructor subscription (V7) and an
  // ensure that emits no change (V9).
  {
    registerHooks({ resolve(specifier, context, next) {
      // Live reload watches the root; the watcher is a no-op here.
      if (specifier === 'vscode') return { url: `data:text/javascript,${encodeURIComponent('const on = () => ({ dispose() {} }); export const Uri = { file: fsPath => ({ fsPath }) }; export class RelativePattern { constructor(base, pattern) { Object.assign(this, { base, pattern }); } } export const workspace = { createFileSystemWatcher: () => ({ onDidChange: on, onDidCreate: on, onDidDelete: on, dispose() {} }) };')}`, shortCircuit: true };
      if (specifier.startsWith('.') && !/\.[a-z0-9]+$/i.test(specifier)) return next(`${specifier}.ts`, context);
      return next(specifier, context);
    } });
    const { LiveServer } = await import('../src/liveServer.ts');
    const { ChatPanelProvider } = f.internals;
    f.connections.active = f.activity;
    f.h.context.subscriptions = []; f.h.context.globalState = { get: (_key, fallback) => fallback, update: async () => {} };
    const live = new LiveServer(), record = ChatPanelProvider.prototype.provenanceRecorder;
    ChatPanelProvider.prototype.provenanceRecorder = () => undefined;
    let built;
    try { built = new ChatPanelProvider(f.h.context, {}, live); } finally { ChatPanelProvider.prototype.provenanceRecorder = record; }
    built.editorChat = f.h.editorChat; built.resolveCoachCwd = () => root;
    const lists = () => f.posts.filter(m => m.type === 'runningProcesses');
    const before = lists().length;
    try {
      const url = await live.ensure(root);
      const started = lists().slice(before).at(-1);
      assert.equal(started?.entries.filter(e => e.state === 'running' && e.purpose === '미리보기 서버').length, 1, `the constructed provider lists ${url} as soon as it starts`);
      await live.stop();
      assert.equal(lists().at(-1).entries.filter(e => e.state === 'running').length, 0, 'and settles the entry when the server stops');
    } finally {
      await live.stop();
      for (const sub of f.h.context.subscriptions) sub.dispose?.();
    }
  }
  console.log('shell-process-host: PASS (store reload, delayed close, restarts, activity isolation incl. stop message after a switch, constructed provider follows the real live server)');
} finally { await rm(root, { recursive: true, force: true }); }
