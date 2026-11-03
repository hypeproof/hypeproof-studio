// CGP-CHAT-R-029 (REQ-STUDIO-REMOVAL-UNDO) — the host side of 되돌리기 on the real ChatPanelProvider and
// the real disk TaskWorkspaceStore; only VS Code I/O is substituted (task-workspace-harness.mjs).
// - A removed work-folder file or page chip is kept, unsent, under the webview's undo id and restored
//   exactly once, as the same snapshot, only in the same task and only while the slot is still empty.
// - A rename keeps the prior title and its origin; undo puts them back only while the task still carries
//   exactly that rename. A wrong id never spends the kept rename.
// Run: node --experimental-strip-types test/removal-undo-host.smoke.mjs
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTaskHarness } from './task-workspace-harness.mjs';

const root = await mkdtemp(join(tmpdir(), 'removal-undo-host-'));
try {
  let f;
  f = await createTaskHarness(root, message => {
    if (message.type === 'activityFreeze' && message.nonce) void f.handle(f.scoped({ type: 'saveActivityDraft', nonce: message.nonce, draft: { text: '', images: [], queued: null } }));
  }, { configureVscode: vscode => { vscode.workspace.workspaceFolders = [{ uri: { fsPath: root } }]; } });
  const { h } = f;
  Object.assign(h, { _instructorMode: { isInstructor: false }, cachedProfile: { activity_kind: 'personal', sdk_tools: { read: true }, input: { image_paste: true } } });
  // The folder-consent check reads the stored choice (none here: the folder is not refused).
  if (!h.context.globalState) h.context.globalState = { get: () => undefined, update: async () => {} };
  const last = type => f.posts.findLast(p => p.type === type);
  const undoResult = id => f.posts.findLast(p => p.type === 'removalUndoResult' && p.undoId === id);

  // ── file chip ──
  const file = { preview: { path: '노트/계획.md', bytes: 12, text: '첫 줄' }, modelText: '<file_content>첫 줄</file_content>', root };
  h.pendingFileAttachment = file;
  await f.handle(f.scoped({ type: 'removeFileContext', undoId: 'undo-file-1' }));
  assert.equal(h.pendingFileAttachment, null, 'removal empties the slot: nothing from the file is sent');
  assert.equal(last('fileAttachment').attachment, null);
  await f.handle(f.scoped({ type: 'restoreFileContext', undoId: 'undo-other' }));
  assert.deepEqual(undoResult('undo-other'), { type: 'removalUndoResult', undoId: 'undo-other', restored: false, activityId: f.activity.id, taskId: f.store.getView().activeTaskId }, 'another id restores nothing');
  assert.equal(h.pendingFileAttachment, null);
  await f.handle(f.scoped({ type: 'restoreFileContext', undoId: 'undo-file-1' }));
  assert.equal(h.pendingFileAttachment, file, 'undo puts the exact snapshot back (same object, no re-read)');
  assert.deepEqual(last('fileAttachment').attachment, file.preview);
  assert.equal(undoResult('undo-file-1').restored, true);
  h.pendingFileAttachment = null;   // the slot empties by itself (no new removal): the id is still spent
  await f.handle(f.scoped({ type: 'restoreFileContext', undoId: 'undo-file-1' }));
  assert.equal(h.pendingFileAttachment, null, 'an undo id restores once');
  h.pendingFileAttachment = file;
  await f.handle(f.scoped({ type: 'removeFileContext', undoId: 'undo-file-2' }));
  await f.handle(f.scoped({ type: 'restoreFileContext', undoId: 'undo-file-2' }));
  await f.handle(f.scoped({ type: 'removeFileContext', undoId: 'undo-file-3' }));
  await f.handle(f.scoped({ type: 'restoreFileContext', undoId: 'undo-file-2' }));
  assert.equal(h.pendingFileAttachment, null, 'a consumed id never restores twice');
  // A new attach replaces the removed one: undo must not bring back the old file over it.
  const other = { ...file, preview: { ...file.preview, path: '다른.md' } };
  h.pendingFileAttachment = other;
  await f.handle(f.scoped({ type: 'restoreFileContext', undoId: 'undo-file-3' }));
  assert.equal(h.pendingFileAttachment, other, 'an occupied slot is never overwritten');
  assert.equal(undoResult('undo-file-3').restored, false);
  // A send makes the removal final, on every send path and whether or not anything is pending. The
  // product test keeps each send from starting a model turn; the host must forget before that refusal.
  h.pendingFileAttachment = null;
  h.verifySession = { running: true };
  const sendPaths = [
    ['send', { type: 'sendMessage', text: '질문', history: [], userMessageId: 'local-s1' }],
    ['retry', { type: 'retryMessage', prompt: '질문', history: [], userMessageId: 'local-s2', sourceMessageId: 'local-s1' }],
  ];
  for (const [name, send] of sendPaths) {
    h.pendingFileAttachment = other;
    await f.handle(f.scoped({ type: 'removeFileContext', undoId: `undo-send-file-${name}` }));
    const finals = f.posts.filter(p => p.type === 'removalsFinal').length;
    await f.handle(f.scoped(send));
    assert.equal(h.pendingFileAttachment, null, `${name}: nothing was pending at the send`);
    assert.equal(f.posts.filter(p => p.type === 'removalsFinal').length, finals + 1, `${name}: both chat windows are told the removal is final`);
    await f.handle(f.scoped({ type: 'restoreFileContext', undoId: `undo-send-file-${name}` }));
    assert.equal(h.pendingFileAttachment, null, `${name}: a removed file never comes back after a send`);
    assert.equal(undoResult(`undo-send-file-${name}`).restored, false);
  }
  h.verifySession = undefined;
  // A lost gate (instructor seat) or another work folder refuses the restore.
  h.pendingFileAttachment = file;
  await f.handle(f.scoped({ type: 'removeFileContext', undoId: 'undo-file-5' }));
  h._instructorMode.isInstructor = true;
  await f.handle(f.scoped({ type: 'restoreFileContext', undoId: 'undo-file-5' }));
  h._instructorMode.isInstructor = false;
  assert.equal(h.pendingFileAttachment, null, 'the attach gate is re-checked on undo');
  h.pendingFileAttachment = { ...file, root: join(root, 'elsewhere') };
  await f.handle(f.scoped({ type: 'removeFileContext', undoId: 'undo-file-6' }));
  await f.handle(f.scoped({ type: 'restoreFileContext', undoId: 'undo-file-6' }));
  assert.equal(h.pendingFileAttachment, null, 'a file from another work folder is not restored');
  // Hostile ids are ignored, never matched.
  h.pendingFileAttachment = file;
  await f.handle(f.scoped({ type: 'removeFileContext', undoId: '../../x ' }));
  await f.handle(f.scoped({ type: 'restoreFileContext', undoId: '../../x ' }));
  assert.equal(h.pendingFileAttachment, null, 'an invalid id keeps nothing');

  // ── page chip ──
  const page = { url: 'https://example.com/a', title: '예시', textNote: null, text: '페이지 글' };
  Object.assign(h, { pendingPageContext: '<page>페이지 글</page>', pendingPageImage: 'data:image/jpeg;base64,AAAA', pendingPageAttachment: page, pendingPageNotice: '코치에게 페이지를 붙였어요' });
  await f.handle(f.scoped({ type: 'removePageContext', undoId: 'undo-page-1' }));
  assert.deepEqual([h.pendingPageContext, h.pendingPageImage, h.pendingPageAttachment, h.pendingPageNotice], [null, null, null, null], 'removal empties every page field');
  await f.handle(f.scoped({ type: 'restorePageContext', undoId: 'undo-page-1' }));
  assert.deepEqual([h.pendingPageContext, h.pendingPageImage, h.pendingPageAttachment, h.pendingPageNotice], ['<page>페이지 글</page>', 'data:image/jpeg;base64,AAAA', page, '코치에게 페이지를 붙였어요'], 'undo restores text, screenshot, chip and notice exactly');
  assert.deepEqual(last('pageAttachment').attachment, page);
  assert.equal(last('pageAttached').label, '코치에게 페이지를 붙였어요');
  assert.equal(undoResult('undo-page-1').restored, true);
  // A send with nothing pending makes the removed page final too.
  h.verifySession = { running: true };
  await f.handle(f.scoped({ type: 'removePageContext', undoId: 'undo-page-send' }));
  await f.handle(f.scoped({ type: 'sendMessage', text: '질문', history: [], userMessageId: 'local-s3' }));
  h.verifySession = undefined;
  await f.handle(f.scoped({ type: 'restorePageContext', undoId: 'undo-page-send' }));
  assert.equal(h.pendingPageAttachment, null, 'a removed page never comes back after a send');
  assert.equal(undoResult('undo-page-send').restored, false);
  // The screenshot is re-gated: with image_paste revoked since, the page is not restored at all (exact or nothing).
  Object.assign(h, { pendingPageContext: '<page>글</page>', pendingPageImage: 'data:image/jpeg;base64,AAAA', pendingPageAttachment: page, pendingPageNotice: null });
  await f.handle(f.scoped({ type: 'removePageContext', undoId: 'undo-page-gate' }));
  h.cachedProfile = { ...h.cachedProfile, input: { image_paste: false } };
  await f.handle(f.scoped({ type: 'restorePageContext', undoId: 'undo-page-gate' }));
  assert.deepEqual([h.pendingPageContext, h.pendingPageImage, h.pendingPageAttachment], [null, null, null], 'a revoked image gate restores no screenshot');
  assert.equal(undoResult('undo-page-gate').restored, false);
  Object.assign(h, { pendingPageContext: '<page>글</page>', pendingPageImage: null, pendingPageAttachment: page, pendingPageNotice: null });
  await f.handle(f.scoped({ type: 'removePageContext', undoId: 'undo-page-text' }));
  await f.handle(f.scoped({ type: 'restorePageContext', undoId: 'undo-page-text' }));
  assert.equal(h.pendingPageAttachment, page, 'a page without a screenshot needs no image gate');
  h.cachedProfile = { ...h.cachedProfile, input: { image_paste: true } };
  await f.handle(f.scoped({ type: 'removePageContext', undoId: 'undo-page-2' }));
  h.dropPageAttachment();
  await f.handle(f.scoped({ type: 'restorePageContext', undoId: 'undo-page-2' }));
  assert.equal(h.pendingPageAttachment, null, 'a consumed or replaced page slot forgets the removed page');

  // A removed chip belongs to its task: after a task switch nothing is restored.
  h.pendingFileAttachment = file;
  await f.handle(f.scoped({ type: 'removeFileContext', undoId: 'undo-file-7' }));
  Object.assign(h, { pendingPageContext: 'p', pendingPageImage: null, pendingPageAttachment: page, pendingPageNotice: null });
  await f.handle(f.scoped({ type: 'removePageContext', undoId: 'undo-page-3' }));
  await f.handle(f.scoped({ type: 'taskCreate' }));
  await f.handle(f.scoped({ type: 'restoreFileContext', undoId: 'undo-file-7' }));
  assert.equal(h.pendingFileAttachment, null, 'another task never receives the removed file');
  await f.handle(f.scoped({ type: 'restorePageContext', undoId: 'undo-page-3' }));
  assert.equal(h.pendingPageAttachment, null, 'nor the removed page');

  // ── rename ──
  const id = f.store.getView().activeTaskId;
  const before = f.store.getTask(id);
  assert.equal(before.titleOrigin, 'default');
  await f.handle(f.scoped({ type: 'taskRename', title: '  내 계획  ', requestId: 'rename-1' }));
  const result = last('taskRenameResult');
  assert.equal(result.saved, true);
  assert.match(result.undoId, /^[A-Za-z0-9_-]{1,64}$/, 'a rename that changed something offers an undo id');
  assert.equal(f.store.getTask(id).title, '내 계획');
  await f.handle(f.scoped({ type: 'taskRenameUndo', undoId: 'wrong' }));
  assert.equal(f.store.getTask(id).title, '내 계획', 'a wrong id restores nothing');
  assert.equal(undoResult('wrong').restored, false);
  assert.equal(f.posts.filter(p => p.type === 'taskWorkspaceError' && p.error).length, 0, 'a refused undo is answered on the toast, not as a workspace error');
  await f.handle(f.scoped({ type: 'taskRenameUndo', undoId: result.undoId }));
  assert.equal(undoResult(result.undoId).restored, true, 'a wrong id did not spend the real one');
  assert.equal(f.store.getTask(id).title, '새 작업');
  await f.handle(f.scoped({ type: 'taskRename', title: '내 계획', requestId: 'rename-1a' }));
  await f.handle(f.scoped({ type: 'taskRename', title: '내 계획', requestId: 'rename-1b' }));
  assert.equal(last('taskRenameResult').undoId, undefined, 'saving the same manual title changes nothing and offers no undo');
  await f.handle(f.scoped({ type: 'taskRename', title: '두 번째', requestId: 'rename-2' }));
  const second = last('taskRenameResult').undoId;
  await f.handle(f.scoped({ type: 'taskRenameUndo', undoId: second }));
  assert.equal(undoResult(second).restored, true);
  const back = f.store.getTask(id);
  assert.deepEqual([back.title, back.titleOrigin], ['내 계획', 'manual'], 'undo restores the prior title and origin');
  // From the default title: the origin goes back too, so the automatic title keeps following the chat.
  await f.handle(f.scoped({ type: 'taskCreate' }));
  const fresh = f.store.getView().activeTaskId, freshBefore = f.store.getTask(fresh);
  await f.handle(f.scoped({ type: 'taskRename', title: '이름', requestId: 'rename-3' }));
  const third = last('taskRenameResult').undoId;
  await f.handle(f.scoped({ type: 'taskRenameUndo', undoId: third }));
  const restored = f.store.getTask(fresh);
  assert.deepEqual([restored.title, restored.titleOrigin], [freshBefore.title, freshBefore.titleOrigin], 'title and origin are exactly as before');
  // The restored default origin is live: the next answer names the task automatically again.
  await f.store.append(fresh, [{ id: 'u-auto', role: 'user', content: '고양이 그림 사이트 만들기', createdAt: Date.now() }]);
  assert.notEqual(f.store.getTask(fresh).title, '새 작업', 'automatic naming resumes after the undo');
  assert.equal(f.store.getTask(fresh).titleOrigin, 'automatic');
  await f.handle(f.scoped({ type: 'taskRenameUndo', undoId: third }));
  assert.equal(f.posts.filter(p => p.type === 'removalUndoResult' && p.undoId === third).at(-1).restored, false, 'an undo id works once');
  // A rename that is no longer the current one is not undone over a newer change.
  await f.handle(f.scoped({ type: 'taskRename', title: '하나', requestId: 'rename-4' }));
  const fourth = last('taskRenameResult').undoId;
  const original = f.store.renameWithUndo.bind(f.store);
  await original(fresh, '바뀐 뒤');
  await f.handle(f.scoped({ type: 'taskRenameUndo', undoId: fourth }));
  assert.equal(f.store.getTask(fresh).title, '바뀐 뒤', 'a title changed since the rename is kept');
  // A send ends the rename offer too.
  await f.handle(f.scoped({ type: 'taskRename', title: '보내기 전', requestId: 'rename-send' }));
  const beforeSend = last('taskRenameResult').undoId;
  h.verifySession = { running: true };
  await f.handle(f.scoped({ type: 'sendMessage', text: '질문', history: [], userMessageId: 'local-s4' }));
  h.verifySession = undefined;
  await f.handle(f.scoped({ type: 'taskRenameUndo', undoId: beforeSend }));
  assert.equal(f.store.getTask(fresh).title, '보내기 전', 'a send makes the rename final');
  // A rename undo refused while a reply streams or a test runs is answered on the toast only: no banner,
  // so sending is not locked by it.
  await f.handle(f.scoped({ type: 'taskRename', title: '바쁠 때', requestId: 'rename-busy' }));
  const busy = last('taskRenameResult').undoId;
  const banners = f.posts.filter(p => p.type === 'taskWorkspaceError').length;
  h.verifySession = { running: true };
  await f.handle(f.scoped({ type: 'taskRenameUndo', undoId: busy }));
  h.verifySession = undefined;
  assert.equal(undoResult(busy).restored, false, 'busy: the undo is refused');
  assert.equal(f.posts.filter(p => p.type === 'taskWorkspaceError').length, banners, 'busy: no workspace error banner');
  assert.equal(f.store.getTask(fresh).title, '바쁠 때');
  // A task switch drops the rename undo.
  await f.handle(f.scoped({ type: 'taskRename', title: '다섯', requestId: 'rename-5' }));
  const fifth = last('taskRenameResult').undoId;
  await f.handle(f.scoped({ type: 'taskSelect', id }));
  await f.handle(f.scoped({ type: 'taskSelect', id: fresh }));
  await f.handle(f.scoped({ type: 'taskRenameUndo', undoId: fifth }));
  assert.equal(f.store.getTask(fresh).title, '다섯', 'leaving the task ends the rename undo');
  console.log('PASS removal undo host: file, page and rename restore exactly once, in scope, never over newer state');
} finally { await rm(root, { recursive: true, force: true }); }
