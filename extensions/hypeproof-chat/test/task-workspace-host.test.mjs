import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTaskHarness } from './task-workspace-harness.mjs';

test('actual host flushes drafts, switches and refuses delayed cross-task writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'task-host-'));
  try {
    let f;
    f = await createTaskHarness(root, message => {
      if (message.type === 'activityFreeze' && message.nonce) void f.handle(f.scoped({ type: 'saveActivityDraft', nonce: message.nonce, draft: { text: '아직 보내지 않은 입력', images: [], queued: null } }));
    });
    const first = f.store.getView().activeTaskId;
    await f.handle(f.scoped({ type: 'taskCreate' }));
    const second = f.store.getView().activeTaskId;
    assert.notEqual(second, first);
    assert.equal(f.store.getTask(first).draft.text, '아직 보내지 않은 입력');
    await f.handle({ type: 'saveActivityDraft', activityId: f.activity.id, taskId: first, draft: { text: 'stale', images: [], queued: null } });
    assert.equal(f.store.getDraft().text, '');
    assert.equal(f.posts.at(-1).type, 'taskWorkspaceError');
    await f.handle(f.scoped({ type: 'taskSelect', id: first }));
    assert.equal(f.store.getView().activeTaskId, first);
    assert.equal(f.posts.findLast(message => message.type === 'config').config.activityDraft.text, '아직 보내지 않은 입력');
    assert.equal(f.h.connectionChanging, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('actual host refuses active navigation and foreign or unsafe sources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'task-host-'));
  try {
    const f = await createTaskHarness(root), first = f.store.getView().activeTaskId;
    f.h.pendingSends = 1;
    await f.handle(f.scoped({ type: 'taskCreate' }));
    assert.equal(f.store.getView().activeTaskId, first);
    assert.match(f.posts.at(-1).error, /멈춘/);
    const stopped = new AbortController(); stopped.abort();
    f.h.activeStreams.set('stopped-turn', stopped);
    await f.handle(f.scoped({ type: 'taskCreate' }));
    assert.equal(f.store.getView().activeTaskId, first);
    assert.match(f.posts.at(-1).error, /중단한 응답을 정리/);
    assert.doesNotMatch(f.posts.at(-1).error, /멈춘 뒤/);
    const running = new AbortController();
    f.h.activeStreams.set('running-turn', running);
    await f.handle(f.scoped({ type: 'taskCreate' }));
    assert.match(f.posts.at(-1).error, /멈춘/, 'a different running stream still needs stopping');
    f.h.activeStreams.clear();
    f.h.pendingSends = 0;
    f.h.verifySession = { running: true };
    await f.handle(f.scoped({ type: 'taskCreate' }));
    assert.equal(f.store.getView().activeTaskId, first, 'a product verification run also owns its task until completion');
    assert.match(f.posts.at(-1).error, /멈춘/);
    f.h.verifySession.running = false;
    await f.store.append(first, [{ id: 'citation', role: 'assistant', content: '출처', createdAt: 1, citations: [{ title: 'Source', url: 'https://example.org/source', domain: 'example.org', tier: 3 }, { title: 'Unsafe', url: 'javascript:alert(1)', domain: '', tier: 4 }] }]);
    for (const url of ['https://foreign.example', 'javascript:alert(1)', 'file:///etc/passwd', 'https://user:secret@example.org/source']) await f.handle(f.scoped({ type: 'taskOpenSource', url }));
    assert.equal(f.opened.length, 0);
    await f.handle(f.scoped({ type: 'taskOpenSource', url: 'https://example.org/source' }));
    assert.deepEqual(f.opened.map(row => [row.url, row.options.preserveFocus]), [['https://example.org/source', true]]);
    await f.handle(f.scoped({ type: 'taskSourceSelection', selection: { url: 'https://example.org/source', pinned: true } }));
    assert.equal(f.store.getView().sourceSelection.pinned, true);
    f.connections.active = { ...f.activity, id: 'foreign-principal' };
    await f.handle({ type: 'taskOpenSource', activityId: f.activity.id, taskId: first, url: 'https://example.org/source' });
    assert.equal(f.opened.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('actual host retains more than 200 messages and does not silently drop a failed draft flush', async () => {
  const root = await mkdtemp(join(tmpdir(), 'task-host-'));
  try {
    const f = await createTaskHarness(root), first = f.store.getView().activeTaskId;
    await f.h.appendHistory(Array.from({ length: 240 }, (_, n) => ({ id: String(n), role: n % 2 ? 'assistant' : 'user', content: String(n), createdAt: n })));
    assert.equal(f.h.getHistory().length, 240);
    f.h.setConnectionChanging = async value => { f.h.connectionChanging = value; if (value) throw new Error('synthetic draft write failure'); };
    await f.handle(f.scoped({ type: 'taskCreate' }));
    assert.equal(f.store.getView().activeTaskId, first);
    assert.equal(f.h.connectionChanging, false);
    assert.match(f.posts.at(-1).error, /저장하지 못했습니다/);
    assert.equal(f.h.getHistory().length, 240);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('actual host identifies an unsaved conflicting draft without overwriting another writer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'task-host-conflict-'));
  try {
    const unsaved = { text: '화면에만 있는 새 초안', images: ['data:image/png;base64,cGhvdG8='], queued: '보관한 질문', queuedToolMode: 'web-search' };
    let f;
    f = await createTaskHarness(root, message => {
      if (message.type === 'activityFreeze' && message.nonce) void f.handle(f.scoped({ type: 'saveActivityDraft', nonce: message.nonce, draft: unsaved }));
    });
    const id = f.store.getView().activeTaskId;
    await f.store.append(id, [{ id: 'context', role: 'user', content: '원래 대화 맥락', createdAt: 1 }]);
    await f.handle(f.scoped({ type: 'saveActivityDraft', draft: { text: '저장된 초안', images: [], queued: null } }));
    const other = new f.store.constructor(root, 'synthetic-personal-a');
    await other.rename(id, '다른 창의 이름');
    const bytes = await readFile(other.filePath, 'utf8');
    await f.handle(f.scoped({ type: 'saveActivityDraft', draft: { text: '화면에만 있는 새 초안', images: [], queued: null } }));
    const error = f.posts.at(-1);
    assert.equal(error.type, 'taskWorkspaceError');
    assert.equal(error.draftSaveFailed, true);
    assert.match(error.error, /다른 창.*충돌.*현재 화면에만/);
    assert.doesNotMatch(error.error, /다시 선택/);
    assert.equal(await readFile(other.filePath, 'utf8'), bytes);
    assert.equal(f.store.getDraft().text, '저장된 초안');
    const request = f.scoped({ type: 'taskRecoverDraft' });
    await writeFile(other.filePath, 'unreadable fixture snapshot');
    await f.handle(request);
    assert.equal(f.posts.at(-1).draftSaveFailed, true, 'a newer recovery failure must replace the previous persistent draft warning');
    assert.match(f.posts.at(-1).error, /작업 기록 파일을 읽을 수 없습니다/);
    assert.equal(await readFile(other.filePath, 'utf8'), 'unreadable fixture snapshot');
    assert.equal(f.store.getView().activeTaskId, id);
    assert.equal(f.h.connectionChanging, false);
    await writeFile(other.filePath, bytes);
    await Promise.all([f.handle(request), f.handle(request)]);
    const recovered = f.store.getActiveTask();
    assert.notEqual(recovered.id, id);
    assert.equal(f.store.getView().tasks.length, 2, 'repeated clicks cannot create duplicate recovery tasks');
    assert.deepEqual(JSON.parse(JSON.stringify(recovered.draft)), { ...unsaved, queuedPaused: true });
    assert.equal(recovered.messages[0].content, '원래 대화 맥락');
    const latest = new f.store.constructor(root, 'synthetic-personal-a');
    assert.equal(latest.getTask(id).title, '다른 창의 이름');
    assert.equal(latest.getTask(id).draft.text, '저장된 초안');
    assert.equal(latest.getActiveTask().id, recovered.id);
    assert.equal(f.h.connectionChanging, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});


test('actual browser host opens a blank right-hand browser without starting a website', async () => {
  const root = await mkdtemp(join(tmpdir(), 'task-host-browser-'));
  try {
    const f = await createTaskHarness(root);
    let previewStarts = 0;
    f.h.siteCheckTabs = new Set();
    f.h.liveServer = { currentUrl: () => null };
    f.h.isCurriculumRuntimeEnabled = () => false;
    f.h.startLivePreview = async () => { previewStarts++; return 'http://127.0.0.1:50000/'; };
    const {runBrowserOpen, runLivePreviewStart} = await import('../src/browserMcp.ts');
    const host = f.h.buildBrowserMcpHost('웹브라우저를 열어줘봐 옆에');
    assert.equal((await runLivePreviewStart(host)).isError, true);
    assert.equal((await runBrowserOpen(host, 'http://127.0.0.1:3000/')).isError, true);
    assert.equal((await runBrowserOpen(host, undefined)).isError, undefined);
    assert.deepEqual(f.opened.map(row => [row.url, row.options.viewColumn, row.options.preserveFocus]), [['about:blank', 2, true]]);
    assert.equal(previewStarts, 0);
    const authoring = f.h.buildBrowserMcpHost('내 웹사이트 미리보기를 열어줘');
    assert.equal((await runLivePreviewStart(authoring)).isError, undefined);
    assert.equal(previewStarts, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('interrupted history survives failed storage and recovers in the same task', async () => {
  const root = await mkdtemp(join(tmpdir(), 'task-host-interrupted-'));
  try {
    let f;
    const draft = { text: '다음 질문', images: [], queued: null };
    f = await createTaskHarness(root, message => {
      if (message.type === 'activityFreeze' && message.nonce) void f.handle(f.scoped({ type: 'saveActivityDraft', nonce: message.nonce, draft }));
    });
    const id = f.store.getView().activeTaskId;
    const messages = [{ id: 'interrupted-user', role: 'user', content: '계획해줘', createdAt: 1 }, { id: 'interrupted-answer', role: 'assistant', content: '부분 답변', createdAt: 2 }];
    f.h.interruptedHistory = { scope: f.h.turnRequestScope(), messages };
    const append = f.store.append.bind(f.store);
    f.store.append = async () => { throw Error('synthetic disk refusal'); };
    await f.handle(f.scoped({ type: 'saveActivityDraft', draft }));
    assert.match(f.posts.at(-1).error, /받은 대화를 저장하지 못했습니다/);
    await f.handle(f.scoped({ type: 'taskCreate' }));
    assert.equal(f.store.getView().activeTaskId, id, 'failed persistence blocks leaving the transcript');
    assert.equal(f.h.connectionChanging, false);
    assert.equal(f.store.getHistory().length, 0);
    await f.h.postHistory();
    assert.deepEqual(Array.from(f.posts.findLast(row => row.type === 'history').messages, row => row.content), ['계획해줘', '부분 답변'], 'reopened view retains unsaved conversation');
    assert.equal(f.posts.at(-1).historySaveFailed, true);
    assert.equal(f.store.getHistory().length, 0, 'showing pending content does not claim durable storage');
    await assert.rejects(f.h.setConnectionChanging(true), /받은 대화를 저장하지 못했습니다/, 'activity transition must not leave pending history behind');
    await f.h.setConnectionChanging(false);
    assert.equal(f.h.connectionChanging, false);
    f.store.append = append;
    await f.handle(f.scoped({ type: 'taskSelect', id }));
    assert.equal(f.store.getView().activeTaskId, id);
    assert.deepEqual(Array.from(f.store.getHistory(), row => row.content), ['계획해줘', '부분 답변']);
    assert.equal(f.store.getDraft().text, draft.text);
    await f.handle(f.scoped({ type: 'taskSelect', id }));
    assert.equal(f.store.getHistory().length, 2, 'repeat recovery does not duplicate the transcript');
    assert.equal(f.h.interruptedHistoryError(), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});


test('rename acknowledges the matching request only after persistence and reports failed saves', async () => {
  const root = await mkdtemp(join(tmpdir(), 'task-rename-result-'));
  try {
    let f;
    f = await createTaskHarness(root, message => {
      if (message.type === 'activityFreeze' && message.nonce) void f.handle(f.scoped({ type: 'saveActivityDraft', nonce: message.nonce, draft: { text: '보존할 초안', images: [], queued: null } }));
    });
    // CGP-CHAT-R-029: the host renames through renameWithUndo (the rename plus what it replaced).
    const original = f.store.renameWithUndo.bind(f.store), id = f.store.getView().activeTaskId;
    f.store.renameWithUndo = async () => { throw new Error('Synthetic write failure'); };
    await f.handle(f.scoped({ type: 'taskRename', title: '새 이름', requestId: 'rename-failure' }));
    assert.deepEqual(f.posts.findLast(p => p.type === 'taskRenameResult'), { type: 'taskRenameResult', requestId: 'rename-failure', taskId: id, saved: false, activityId: f.activity.id });
    assert.equal(f.store.getActiveTask().title, '새 작업');
    f.store.renameWithUndo = original;
    await f.handle(f.scoped({ type: 'taskRename', title: '새 이름', requestId: 'rename-retry' }));
    assert.equal(f.posts.findLast(p => p.type === 'taskRenameResult').saved, true);
    assert.equal(f.posts.findLast(p => p.type === 'taskRenameResult').requestId, 'rename-retry');
    assert.equal(f.store.getActiveTask().title, '새 이름');
    assert.equal(f.store.getDraft().text, '보존할 초안');
  } finally { await rm(root, { recursive: true, force: true }); }
});


test('config snapshot waits for an accepted draft write before recreating the UI', async () => {
  const root = await mkdtemp(join(tmpdir(), 'task-config-draft-'));
  let release, saving, config;
  try {
    const f = await createTaskHarness(root);
    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    const held = new Promise(resolve => { release = resolve; });
    const save = f.store.saveDraft.bind(f.store);
    f.store.saveDraft = async (...args) => { entered(); await held; return save(...args); };
    saving = f.handle(f.scoped({ type: 'saveActivityDraft', draft: { text: '보존할 초안 ABC', images: [], queued: null } }));
    await started;
    config = f.h.postConfig();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.posts.filter(message => message.type === 'config').length, 0, 'do not publish an older draft while the accepted write is pending');
    release();
    await Promise.all([saving, config]);
    assert.equal(f.posts.findLast(message => message.type === 'config').config.activityDraft.text, '보존할 초안 ABC');
    assert.equal(f.store.getDraft().text, '보존할 초안 ABC');
  } finally {
    release?.();
    await Promise.allSettled([saving, config]);
    await rm(root, { recursive: true, force: true });
  }
});


test('mounted review requests recover only the owning task and never resurrect dismissed results', async () => {
  const root = await mkdtemp(join(tmpdir(), 'task-review-'));
  try {
    let f;
    f = await createTaskHarness(root, message => {
      if (message.type === 'activityFreeze' && message.nonce) void f.handle(f.scoped({ type: 'saveActivityDraft', nonce: message.nonce, draft: f.store.getDraft() }));
    });
    const first = f.store.getView().activeTaskId;
    const view = { turnId: 'review-turn', state: 'restored', added: [], changed: ['note.txt'], deleted: [], notCovered: [], restoredCount: 1 };
    f.h.turnReview = { taskKey: first, view };
    const request = async () => {
      const count = f.posts.length;
      await f.handle(f.scoped({ type: 'turnReviewRequest' }));
      const reply = f.posts.slice(count).find(message => message.type === 'turnReviewState');
      assert.ok(reply, 'every mounted subscriber receives an explicit current state');
      return reply.view;
    };
    assert.deepEqual(await request(), view);
    await f.handle(f.scoped({ type: 'taskCreate' }));
    assert.equal(await request(), null, 'another task must not see the review');
    await f.handle(f.scoped({ type: 'turnReviewClose', turnId: view.turnId }));
    await f.handle(f.scoped({ type: 'taskSelect', id: first }));
    assert.deepEqual(await request(), view, 'returning to the owning task recovers its review');
    await f.handle(f.scoped({ type: 'turnReviewClose', turnId: view.turnId }));
    assert.equal(await request(), null, 'a later remount must not resurrect a closed result');
  } finally { await rm(root, { recursive: true, force: true }); }
});


test('a delayed keep clears its own review but preserves a newer measured review', async () => {
  const root = await mkdtemp(join(tmpdir(), 'task-review-keep-'));
  const work = join(root, 'work');
  let release, pending;
  try {
    await mkdir(work);
    let pause, scanRoot;
    const f = await createTaskHarness(root, () => {}, { beforeReadDir: async path => {
      if (pause && String(path) === scanRoot) { const hold = pause; pause = null; await hold(); }
    } });
    f.h.resolveCoachCwd = () => work;
    const review = async (id, before, after) => {
      await writeFile(join(work, 'note.txt'), before);
      const point = await f.h.beginTurnRestore(id);
      assert.ok(point);
      await writeFile(join(work, 'note.txt'), after);
      await f.h.endTurnRestore(point, id);
      assert.equal(f.h.turnReview.view.turnId, id);
    };
    await review('ordinary', 'before', 'ordinary');
    await f.handle(f.scoped({ type: 'turnKeep', turnId: 'ordinary' }));
    assert.equal(f.h.turnReview, null);
    await review('older', 'ordinary', 'older');
    scanRoot = f.h.turnReview.root;
    let entered;
    const reached = new Promise(resolve => { entered = resolve; });
    const held = new Promise(resolve => { release = resolve; });
    pause = async () => { entered(); await held; };
    pending = f.handle(f.scoped({ type: 'turnKeep', turnId: 'older' }));
    await reached;
    assert.equal(f.h.turnReview, null, 'keep is accepted before the evidence scan finishes');
    await f.handle(f.scoped({ type: 'turnRevert', turnId: 'older' }));
    await f.handle(f.scoped({ type: 'turnKeep', turnId: 'older' }));
    assert.equal(await readFile(join(work, 'note.txt'), 'utf8'), 'older', 'a competing decision cannot restore kept files');
    await review('newer', 'older', 'newer');
    release(); await pending;
    assert.equal(f.h.turnReview?.view.turnId, 'newer', 'old completion must not dismiss new measured changes');
    assert.equal(await readFile(join(work, 'note.txt'), 'utf8'), 'newer');
    await f.handle(f.scoped({ type: 'turnReviewRequest' }));
    assert.equal(f.posts.findLast(message => message.type === 'turnReviewState').view.turnId, 'newer');
  } finally {
    release?.(); await pending;
    await rm(root, { recursive: true, force: true });
  }
});

// CGP-KNOW-R-009 (REQ-KNOW-14) — the real host moves a personal task to another personal activity:
// the open task's draft is flushed first, the copy is read back byte-identical before the source
// lets go, and class destinations, class seats and a running turn move nothing.
test('actual host moves a personal task to another personal activity only, byte-identical', async () => {
  const root = await mkdtemp(join(tmpdir(), 'task-host-'));
  try {
    let f;
    f = await createTaskHarness(root, message => {
      if (message.type === 'activityFreeze' && message.nonce) void f.handle(f.scoped({ type: 'saveActivityDraft', nonce: message.nonce, draft: { text: '옮기기 직전 입력', images: [], queued: null } }));
    });
    const { TaskWorkspaceStore } = f.internals;
    const otherFolder = join(root, 'other');
    await mkdir(join(root, 'task-workspaces'), { recursive: true });
    const destinationScope = JSON.stringify(['synthetic-personal-b', otherFolder]);
    const destination = new TaskWorkspaceStore(join(root, 'task-workspaces'), destinationScope);
    await destination.initialize();
    f.connections.list = async () => [
      { ref: 'ref-b', id: 'synthetic-personal-b', name: '그림 연습', kind: 'personal', workspace: otherFolder },
      { ref: 'ref-class', id: 'synthetic-class', name: '3반 수업', kind: 'classroom', workspace: join(root, 'class') },
    ];
    const first = f.store.getView().activeTaskId;
    await f.store.append(first, [{ id: 'q', role: 'user', content: '질문', createdAt: 1 }, { id: 'a', role: 'assistant', content: '답', createdAt: 2 }]);
    // No loaded profile: the lesson state is unknown, so nothing is offered and nothing moves.
    assert.match((await f.h.taskMoveState()).reason, /활동 정보를 아직 확인하지 못해/);
    await f.handle(f.scoped({ type: 'taskMove', id: first, destination: 'ref-b', requestId: 'r-noprofile' }));
    assert.ok(f.store.getTask(first));
    f.h.cachedProfile = { activity_kind: 'personal', lesson: null };
    assert.deepEqual(JSON.parse(JSON.stringify(await f.h.taskMoveState())), { allowed: true, destinations: [{ ref: 'ref-b', name: '그림 연습' }] });

    // A class destination is refused even when the webview names it.
    // The open task stays, so a file or page chip attached to it stays too (CGP-CHAT-R-011, CGP-ART-R-007).
    const fileChip = { preview: { path: 'notes.txt', text: '메모', bytes: 6 }, modelText: '메모', root };
    const pageChip = { label: 'index.html' };
    f.h.pendingFileAttachment = fileChip;
    f.h.pendingPageAttachment = pageChip;
    await f.handle(f.scoped({ type: 'taskMove', id: first, destination: 'ref-class', requestId: 'r-class' }));
    assert.ok(f.store.getTask(first));
    assert.equal(f.h.pendingFileAttachment, fileChip, 'a refused move keeps the attached file');
    assert.equal(f.h.pendingPageAttachment, pageChip, 'a refused move keeps the attached page');
    assert.deepEqual((({ activityId, taskId, ...rest }) => rest)(f.posts.findLast(message => message.type === 'taskMoveResult')), { type: 'taskMoveResult', requestId: 'r-class', moved: false });

    // A running turn moves nothing.
    f.h.pendingSends = 1;
    await f.handle(f.scoped({ type: 'taskMove', id: first, destination: 'ref-b', requestId: 'r-busy' }));
    assert.ok(f.store.getTask(first));
    assert.match(f.posts.findLast(message => message.type === 'taskWorkspaceError').error, /멈춘/);
    f.h.pendingSends = 0;

    // A copy that does not read back identical is withdrawn; the task stays here.
    const proto = TaskWorkspaceStore.prototype, exportTask = proto.exportTask;
    proto.exportTask = function (id) { const out = exportTask.call(this, id); if (this.scope !== f.store.scope) out.task.title += ' (변형)'; return out; };
    try { await f.handle(f.scoped({ type: 'taskMove', id: first, destination: 'ref-b', requestId: 'r-readback' })); }
    finally { proto.exportTask = exportTask; }
    assert.ok(f.store.getTask(first));
    assert.equal(new TaskWorkspaceStore(join(root, 'task-workspaces'), destinationScope).getTask(first), undefined, 'the unconfirmed copy was withdrawn');
    assert.match(f.posts.findLast(message => message.type === 'taskWorkspaceError').error, /확인하지 못해 옮기지 않았어요/);

    // The source cannot let go (another window changed the list): the copy is withdrawn too.
    const release = f.store.releaseTask;
    f.store.releaseTask = async () => { throw new Error('stale'); };
    try { await f.handle(f.scoped({ type: 'taskMove', id: first, destination: 'ref-b', requestId: 'r-release' })); }
    finally { f.store.releaseTask = release; }
    assert.ok(f.store.getTask(first));
    assert.equal(new TaskWorkspaceStore(join(root, 'task-workspaces'), destinationScope).getTask(first), undefined);
    assert.match(f.posts.findLast(message => message.type === 'taskWorkspaceError').error, /목록이 바뀌어 옮기지 않았어요/);

    // A malformed request id is not echoed.
    const results = f.posts.filter(message => message.type === 'taskMoveResult').length;
    await f.handle(f.scoped({ type: 'taskMove', id: first, destination: 'ref-class', requestId: '<img>' }));
    assert.equal(f.posts.filter(message => message.type === 'taskMoveResult').length, results);

    // The open task moves with the draft that was on screen.
    f.h.renameUndo = { id: 'u-open', store: f.store, undo: { taskId: first } };
    const beforeMove = f.posts.length;
    await f.handle(f.scoped({ type: 'taskMove', id: first, destination: 'ref-b', requestId: 'r-ok' }));
    assert.equal(f.h.renameUndo, null, 'moving the open task away ends its rename 되돌리기, like a switch');
    // CGP-CHAT-R-011 / CGP-ART-R-007 — the attached file and page belonged to the task that left: both chips drop.
    assert.equal(f.h.pendingFileAttachment, null, 'moving the open task away drops the attached file');
    assert.equal(f.h.pendingPageAttachment, null, 'moving the open task away drops the attached page');
    assert.ok(f.posts.slice(beforeMove).some(message => message.type === 'fileAttachment' && message.attachment === null), 'the file chip is cleared in the webview');
    assert.ok(f.posts.slice(beforeMove).some(message => message.type === 'pageAttachment' && message.attachment === null), 'the page chip is cleared in the webview');
    assert.equal(f.store.getTask(first), undefined, 'the source no longer lists the task');
    assert.notEqual(f.store.getView().activeTaskId, first);
    const arrived = new TaskWorkspaceStore(join(root, 'task-workspaces'), destinationScope).getTask(first);
    assert.equal(arrived.draft.text, '옮기기 직전 입력');
    assert.deepEqual(JSON.parse(JSON.stringify(arrived.messages.map(message => message.content))), ['질문', '답']);
    assert.deepEqual((({ activityId, taskId, ...rest }) => rest)(f.posts.findLast(message => message.type === 'taskMoveResult')), { type: 'taskMoveResult', requestId: 'r-ok', moved: true, title: arrived.title, destination: '그림 연습' });

    // A class seat (served lesson) offers nothing and refuses a move.
    const second = f.store.getView().activeTaskId;
    f.h.cachedProfile = { activity_kind: 'personal', lesson: { content: { title: '레슨' } } };
    const state = await f.h.taskMoveState();
    assert.equal(state.allowed, false);
    assert.match(state.reason, /수업 작업은 이 수업 활동 안에만/);
    await f.handle(f.scoped({ type: 'taskMove', id: second, destination: 'ref-b', requestId: 'r-lesson' }));
    assert.ok(f.store.getTask(second));
    assert.equal(f.posts.findLast(message => message.type === 'taskMoveResult').moved, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// CGP-KNOW-R-009 (verifier S7, S1, S8) — when the source's release reports a failure, the host asks
// the disk before it undoes the copy: a task the source no longer lists has moved (withdrawing the
// copy would leave it nowhere); a task the source still holds intact is withdrawn from the
// destination; anything else keeps both copies and says so. No path loses the task or its versions.
test('actual host never loses a moved task when the source release fails part-way', async () => {
  const root = await mkdtemp(join(tmpdir(), 'task-host-'));
  try {
    let f;
    f = await createTaskHarness(root, message => {
      if (message.type === 'activityFreeze' && message.nonce) void f.handle(f.scoped({ type: 'saveActivityDraft', nonce: message.nonce, draft: { text: '', images: [], queued: null } }));
    });
    const { TaskWorkspaceStore } = f.internals;
    const otherFolder = join(root, 'other');
    await mkdir(join(root, 'task-workspaces'), { recursive: true });
    const destinationScope = JSON.stringify(['synthetic-personal-b', otherFolder]);
    await new TaskWorkspaceStore(join(root, 'task-workspaces'), destinationScope).initialize();
    const destination = () => new TaskWorkspaceStore(join(root, 'task-workspaces'), destinationScope);
    const source = () => new TaskWorkspaceStore(root, 'synthetic-personal-a'); // the harness's store, read again from disk
    f.connections.list = async () => [{ ref: 'ref-b', id: 'synthetic-personal-b', name: '그림 연습', kind: 'personal', workspace: otherFolder }];
    f.h.cachedProfile = { activity_kind: 'personal', lesson: null };
    const seed = async title => {
      const id = f.store.getView().activeTaskId;
      await f.store.rename(id, title);
      await f.store.append(id, [{ id: `${id}-q`, role: 'user', content: '질문', createdAt: 1 }, { id: `${id}-a`, role: 'assistant', content: '답', createdAt: 2 }]);
      // An edited resend keeps an earlier version in the versions sidecar.
      await f.store.append(id, [{ id: `${id}-q2`, role: 'user', content: '고친 질문', createdAt: 3, editOf: `${id}-q` }, { id: `${id}-a2`, role: 'assistant', content: '새 답', createdAt: 4 }]);
      await f.store.create('다음 작업', { taskId: id, revision: f.store.getView().revision });
      assert.ok(f.store.exportTask(id).versions, 'the seeded task has earlier versions');
      return { id, bytes: JSON.stringify(f.store.exportTask(id)) };
    };
    const move = requestId => f.handle(f.scoped({ type: 'taskMove', id: current.id, destination: 'ref-b', requestId }));
    const result = () => f.posts.findLast(message => message.type === 'taskMoveResult');
    let current;

    // S7: the task file is saved without the task, then the lock release fails. The move is done.
    current = await seed('잠금에서 실패');
    // Faults are armed only inside releaseTask, so the draft flush before it saves normally.
    const write = f.store.writeAtomic, releaseLock = f.store.releaseLock, releaseTask = f.store.releaseTask;
    let releasing = false, saved = false;
    f.store.releaseTask = function (...args) { releasing = true; return releaseTask.apply(this, args).finally(() => { releasing = false; }); };
    f.store.writeAtomic = async function (target, ...rest) { await write.call(this, target, ...rest); if (releasing && target === this.filePath) saved = true; };
    f.store.releaseLock = async function (lease) { await releaseLock.call(this, lease); if (saved) { saved = false; throw Object.assign(new Error('synthetic EPERM'), { code: 'EPERM' }); } };
    try { await move('r-s7'); } finally { f.store.writeAtomic = write; f.store.releaseLock = releaseLock; f.store.releaseTask = releaseTask; }
    assert.equal(JSON.stringify(destination().exportTask(current.id)), current.bytes, 'the destination keeps the whole task');
    assert.equal(source().getTask(current.id), undefined, 'the source no longer lists it');
    assert.equal(result().requestId, 'r-s7');
    assert.equal(result().moved, true);

    // S1: the source's task-file write fails. The task stays here whole and the copy is withdrawn.
    current = await seed('저장에서 실패');
    f.store.releaseTask = function (...args) { releasing = true; return releaseTask.apply(this, args).finally(() => { releasing = false; }); };
    f.store.writeAtomic = async function (target, ...rest) { if (releasing && target === this.filePath) throw new Error('synthetic EIO'); return write.call(this, target, ...rest); };
    try { await move('r-s1'); } finally { f.store.writeAtomic = write; f.store.releaseTask = releaseTask; }
    assert.equal(JSON.stringify(source().exportTask(current.id)), current.bytes, 'the source keeps the task with its earlier versions');
    assert.equal(destination().getTask(current.id), undefined, 'the copy was withdrawn');
    assert.equal(result().moved, false);
    assert.match(f.posts.findLast(message => message.type === 'taskWorkspaceError').error, /목록이 바뀌어 옮기지 않았어요/);

    // S8: release fails with the source intact and the withdraw fails too: both stay, said plainly.
    current = await seed('둘 다 실패');
    const withdraw = TaskWorkspaceStore.prototype.withdrawTask;
    f.store.releaseTask = async () => { throw new Error('stale'); };
    TaskWorkspaceStore.prototype.withdrawTask = async () => { throw new Error('synthetic EIO'); };
    try { await move('r-s8'); } finally { f.store.releaseTask = releaseTask; TaskWorkspaceStore.prototype.withdrawTask = withdraw; }
    assert.equal(JSON.stringify(source().exportTask(current.id)), current.bytes);
    assert.equal(JSON.stringify(destination().exportTask(current.id)), current.bytes);
    assert.match(f.posts.findLast(message => message.type === 'taskWorkspaceError').error, /두 곳에 같은 작업이 있으니/);

    // The source still lists the task but not as it was copied (another window edited it): both stay.
    // Last, because this store's memory is behind the disk afterwards.
    current = await seed('다른 창에서 고침');
    f.store.releaseTask = async id => {
      const other = source();
      await other.select(id, { taskId: other.getView().activeTaskId, revision: other.getView().revision });
      await other.rename(id, '다른 창에서 바꾼 이름');
      throw new Error('stale');
    };
    try { await move('r-changed'); } finally { f.store.releaseTask = releaseTask; }
    assert.equal(source().getTask(current.id).title, '다른 창에서 바꾼 이름');
    assert.equal(JSON.stringify(destination().exportTask(current.id)), current.bytes, 'the copy is not withdrawn');
    assert.match(f.posts.findLast(message => message.type === 'taskWorkspaceError').error, /두 곳에 같은 작업이 있으니/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// CGP-KNOW-R-009 (re-verify fault matrix) — one fault at each write, lock and cleanup step of
// receive, read-back, release and withdraw during a real host move. Afterwards the disk decides:
// the task is whole somewhere; two copies are always told; "두 곳에" is never said for one copy;
// a task only at the destination is reported moved, and one only here is not.
const MOVE_FAULTS = [
  ['receive', 'acquire'], ['receive', 'versions'], ['receive', 'verdicts'], ['receive', 'file'], ['receive', 'file-cleanup'], ['receive', 'lock-after-file'],
  ['readback', 'throw'],
  ['release', 'acquire'], ['release', 'file'], ['release', 'file-cleanup'], ['release', 'lock-after-file'], ['release', 'versions'], ['release', 'verdicts'],
  ['withdraw', 'versions'], ['withdraw', 'lock-after-file'], ['withdraw', 'file'], ['withdraw', 'file-cleanup'], ['withdraw', 'acquire'], ['withdraw', 'verdicts'],
  ['none', 'none'],
];
for (const [phase, step] of MOVE_FAULTS) {
  test(`actual host move under fault ${phase}/${step} keeps the task whole and tells the truth`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'task-fault-'));
    try {
      let f;
      f = await createTaskHarness(root, message => {
        if (message.type === 'activityFreeze' && message.nonce) void f.handle(f.scoped({ type: 'saveActivityDraft', nonce: message.nonce, draft: { text: '', images: [], queued: null } }));
      });
      const { TaskWorkspaceStore } = f.internals;
      const P = TaskWorkspaceStore.prototype;
      const otherFolder = join(root, 'other');
      await mkdir(join(root, 'task-workspaces'), { recursive: true });
      const destinationScope = JSON.stringify(['synthetic-personal-b', otherFolder]);
      await new TaskWorkspaceStore(join(root, 'task-workspaces'), destinationScope).initialize();
      f.connections.list = async () => [{ ref: 'ref-b', id: 'synthetic-personal-b', name: '그림 연습', kind: 'personal', workspace: otherFolder }];
      f.h.cachedProfile = { activity_kind: 'personal', lesson: null };
      const id = f.store.getView().activeTaskId;
      await f.store.rename(id, '옮길 작업');
      await f.store.append(id, [{ id: 'q', role: 'user', content: '질문', createdAt: 1 }, { id: 'a', role: 'assistant', content: '답', createdAt: 2 }]);
      await f.store.append(id, [{ id: 'q2', role: 'user', content: '고친 질문', createdAt: 3, editOf: 'q' }, { id: 'a2', role: 'assistant', content: '새 답', createdAt: 4 }]);
      await f.store.recordVerdict(id, { messageId: 'a2', verdict: 'right', at: 2000 });
      await f.store.create('다음 작업', { taskId: id, revision: f.store.getView().revision });
      const bytes = JSON.stringify(f.store.exportTask(id));

      // Each fault fires once, only inside the named store method.
      const orig = { receiveTask: P.receiveTask, releaseTask: P.releaseTask, withdrawTask: P.withdrawTask, writeAtomic: P.writeAtomic, releaseLock: P.releaseLock, acquireLock: P.acquireLock, exportTask: P.exportTask };
      let running = null, fired = false, armedLock = false;
      const wrap = name => function (...args) { const prev = running; running = name; return Promise.resolve(orig[name].apply(this, args)).finally(() => { running = prev; }); };
      P.receiveTask = wrap('receiveTask'); P.releaseTask = wrap('releaseTask'); P.withdrawTask = wrap('withdrawTask');
      const method = { receive: 'receiveTask', release: 'releaseTask', withdraw: 'withdrawTask' }[phase];
      const hit = () => !fired && running === method;
      const fault = (code, text) => Object.assign(new Error(text), { code });
      P.writeAtomic = async function (target, ...rest) {
        const kind = target === this.filePath ? 'file' : target === this.versionsPath ? 'versions' : target === this.verdictsPath ? 'verdicts' : '?';
        if (hit() && step === kind) { fired = true; throw fault('EIO', 'synthetic EIO'); }
        await orig.writeAtomic.call(this, target, ...rest);
        if (hit() && kind === 'file' && step === 'file-cleanup') { fired = true; throw fault('EIO', 'synthetic cleanup'); }
        if (hit() && kind === 'file' && step === 'lock-after-file') armedLock = true;
      };
      P.releaseLock = async function (lease) { await orig.releaseLock.call(this, lease); if (armedLock && !fired) { fired = true; armedLock = false; throw fault('EPERM', 'synthetic EPERM'); } };
      P.acquireLock = async function () { if (hit() && step === 'acquire') { fired = true; throw fault('EBUSY', 'synthetic locked'); } return orig.acquireLock.call(this); };
      if (phase === 'readback') P.exportTask = function (taskId) { if (this.scope !== f.store.scope && !fired) { fired = true; throw new Error('synthetic read-back'); } return orig.exportTask.call(this, taskId); };
      // withdraw: the release is refused (the list changed), then the fault fires in the withdraw.
      if (phase === 'withdraw') f.store.releaseTask = async () => { throw new Error('stale'); };
      try { await f.handle(f.scoped({ type: 'taskMove', id, destination: 'ref-b', requestId: 'r-fault' })); }
      finally { Object.assign(P, orig); delete f.store.releaseTask; }
      assert.ok(fired || phase === 'none', 'the fault fired');

      const s = new TaskWorkspaceStore(root, 'synthetic-personal-a');
      const d = new TaskWorkspaceStore(join(root, 'task-workspaces'), destinationScope);
      const inS = !!s.getTask(id), inD = !!d.getTask(id);
      const wholeS = inS && JSON.stringify(s.exportTask(id)) === bytes, wholeD = inD && JSON.stringify(d.exportTask(id)) === bytes;
      const result = f.posts.findLast(message => message.type === 'taskMoveResult');
      const error = f.posts.findLast(message => message.type === 'taskWorkspaceError')?.error ?? '';
      const row = JSON.stringify({ inS, inD, moved: result?.moved, error });
      assert.equal(result?.requestId, 'r-fault', `the request is answered ${row}`);
      assert.ok(wholeS || wholeD, `the task survives whole somewhere ${row}`);
      if (inS && inD) assert.match(error, /두 곳에/, `two copies are told ${row}`);
      if (/두 곳에/.test(error)) assert.ok(inS && inD, `"두 곳에" only for two copies ${row}`);
      if (!inS && inD) assert.equal(result.moved, true, `moved is reported ${row}`);
      if (inS && !inD) assert.equal(result.moved, false, `not moved is reported ${row}`);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

// A move that reaches an early host return (the open task changed, another task change running)
// is still answered, so the menu does not wait out its 20 s guard.
test('actual host answers a move request it refuses before starting', async () => {
  const root = await mkdtemp(join(tmpdir(), 'task-host-'));
  try {
    const f = await createTaskHarness(root);
    f.h.cachedProfile = { activity_kind: 'personal', lesson: null };
    const id = f.store.getView().activeTaskId;
    const answered = requestId => f.posts.findLast(message => message.type === 'taskMoveResult' && message.requestId === requestId);
    f.h.taskChanging = true;
    await f.handle(f.scoped({ type: 'taskMove', id, destination: 'ref-b', requestId: 'r-changing' }));
    f.h.taskChanging = false;
    assert.equal(answered('r-changing')?.moved, false);
    assert.match(f.posts.findLast(message => message.type === 'taskWorkspaceError').error, /다른 작업 변경이 끝난 뒤/);
    await f.handle({ ...f.scoped({ type: 'taskMove', id, destination: 'ref-b', requestId: 'r-stale-task' }), taskId: 'another-task' });
    assert.equal(answered('r-stale-task')?.moved, false);
    await f.handle({ ...f.scoped({ type: 'taskMove', id, destination: 'ref-b', requestId: 'r-other-activity' }), activityId: 'another-activity' });
    assert.equal(answered('r-other-activity')?.moved, false);
    assert.ok(f.store.getTask(id));
  } finally { await rm(root, { recursive: true, force: true }); }
});

// CGP-KNOW-R-009 (re-verify 3) — when the disk cannot be read back after a half-done step, the
// host cannot know whether the task is in one place or two, so it says it may be in both.
// Two chains: the receive saved its task file and then failed, and the destination re-read fails;
// the release failed, and the source re-read fails. Both copies stay whole and the move is not reported.
for (const chain of ['receive-then-destination-unreadable', 'release-then-source-unreadable']) {
  test(`actual host move hedges when ${chain}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'task-fault-'));
    try {
      let f;
      f = await createTaskHarness(root, message => {
        if (message.type === 'activityFreeze' && message.nonce) void f.handle(f.scoped({ type: 'saveActivityDraft', nonce: message.nonce, draft: { text: '', images: [], queued: null } }));
      });
      const { TaskWorkspaceStore } = f.internals;
      const P = TaskWorkspaceStore.prototype;
      const otherFolder = join(root, 'other');
      await mkdir(join(root, 'task-workspaces'), { recursive: true });
      const destinationScope = JSON.stringify(['synthetic-personal-b', otherFolder]);
      await new TaskWorkspaceStore(join(root, 'task-workspaces'), destinationScope).initialize();
      f.connections.list = async () => [{ ref: 'ref-b', id: 'synthetic-personal-b', name: '그림 연습', kind: 'personal', workspace: otherFolder }];
      f.h.cachedProfile = { activity_kind: 'personal', lesson: null };
      const id = f.store.getView().activeTaskId;
      await f.store.rename(id, '옮길 작업');
      await f.store.append(id, [{ id: 'q', role: 'user', content: '질문', createdAt: 1 }, { id: 'a', role: 'assistant', content: '답', createdAt: 2 }]);
      await f.store.recordVerdict(id, { messageId: 'a', verdict: 'right', at: 2000 });
      await f.store.create('다음 작업', { taskId: id, revision: f.store.getView().revision });
      const bytes = JSON.stringify(f.store.exportTask(id));
      const sourceScope = f.store.scope;

      const orig = { receiveTask: P.receiveTask, writeAtomic: P.writeAtomic, getTask: P.getTask };
      let receiving = false, receiveFailed = false, readFailed = false, releaseFailed = false;
      if (chain.startsWith('release')) f.store.releaseTask = async () => { releaseFailed = true; throw new Error('stale'); };
      P.receiveTask = function (...args) { receiving = true; return Promise.resolve(orig.receiveTask.apply(this, args)).finally(() => { receiving = false; }); };
      P.writeAtomic = async function (target, ...rest) {
        await orig.writeAtomic.call(this, target, ...rest);
        if (chain.startsWith('receive') && receiving && target === this.filePath && !receiveFailed) { receiveFailed = true; throw Object.assign(new Error('synthetic cleanup'), { code: 'EIO' }); }
      };
      // The first re-read of the named scope after the failure throws (a store outside any store method).
      P.getTask = function (taskId) {
        const wanted = chain.startsWith('receive') ? receiveFailed && this.scope !== sourceScope : this.scope === sourceScope && this !== f.store && releaseFailed;
        if (wanted && !receiving && !readFailed) { readFailed = true; throw new Error('synthetic unreadable'); }
        return orig.getTask.call(this, taskId);
      };
      try { await f.handle(f.scoped({ type: 'taskMove', id, destination: 'ref-b', requestId: 'r-hedge' })); }
      finally { Object.assign(P, orig); delete f.store.releaseTask; }
      assert.ok(readFailed, 'the re-read fault fired');

      const s = new TaskWorkspaceStore(root, 'synthetic-personal-a');
      const d = new TaskWorkspaceStore(join(root, 'task-workspaces'), destinationScope);
      assert.equal(JSON.stringify(s.exportTask(id)), bytes, 'the source keeps the whole task');
      assert.equal(JSON.stringify(d.exportTask(id)), bytes, 'the copy is kept');
      const result = f.posts.findLast(message => message.type === 'taskMoveResult');
      assert.equal(result?.requestId, 'r-hedge');
      assert.equal(result.moved, false);
      assert.match(f.posts.findLast(message => message.type === 'taskWorkspaceError').error, /‘그림 연습’에도 남았을 수 있어요\. 두 활동의 작업 목록을 확인해 주세요\./);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
