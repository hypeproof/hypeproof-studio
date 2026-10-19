import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
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
