import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
    assert.match(f.posts.at(-1).error, /중단한 대화를 저장하지 못했습니다/);
    await f.handle(f.scoped({ type: 'taskCreate' }));
    assert.equal(f.store.getView().activeTaskId, id, 'failed persistence blocks leaving the transcript');
    assert.equal(f.h.connectionChanging, false);
    assert.equal(f.store.getHistory().length, 0);
    await assert.rejects(f.h.setConnectionChanging(true), /중단한 대화를 저장하지 못했습니다/, 'activity transition must not leave pending history behind');
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
