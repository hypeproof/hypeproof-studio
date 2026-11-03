// CGP-CHAT-R-025 (REQ-STUDIO-TASK-ARCHIVE) — the webview side of 보관하기 / 보관함 / 다시 열기, mounted.
//   node scripts/run-tsx-tests.mjs task-archive-ui
// Real TaskWorkspace and ChatPanel. Geometry (44px, 14px, ring, no red) is test/task-archive-layout.smoke.mjs.
import { click, document as doc, mountPoint } from './fixtures/mini-dom.mjs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import assert from 'node:assert/strict';
import { TaskWorkspace } from '../webview-ui/src/TaskWorkspace';
import { ChatPanel } from '../webview-ui/src/ChatPanel';
import type { TaskWorkspaceView } from '../src/taskWorkspaceContract';
import type { ChatConfig, ChatMessage } from '../src/protocol';
for (const name of ['Node', 'Element']) (globalThis as any)[name] ??= (window as any)[name];
(globalThis as any).HTMLElement ??= (window as any).Element;
const posted = () => (globalThis as any).__posted as Array<Record<string, unknown>>;

const HOSTILE = '<img src=x onerror=alert(1)>‮보관';
const listed = { id: 'b', title: '열린 작업', createdAt: 1, updatedAt: 5, messageCount: 2 };
const view = (over: Partial<TaskWorkspaceView> = {}): TaskWorkspaceView => ({ scope: 's', revision: 3, activeTaskId: 'b', sourceSelection: null, tasks: [listed],
  archived: [{ id: 'a', title: HOSTILE, createdAt: 1, updatedAt: 2, messageCount: 4, archivedAt: Date.UTC(2026, 9, 24) }, { id: 'c', title: '오래된 작업', createdAt: 1, updatedAt: 1, messageCount: 0, archivedAt: Date.UTC(2026, 9, 1) }], ...over });

async function workspace() {
  const host = mountPoint(), root = createRoot(host);
  const draw = (v: TaskWorkspaceView, busy = false) => act(() => root.render(<TaskWorkspace view={v} messages={[]} busy={busy} error={null} onDismissError={() => {}}><p>대화</p></TaskWorkspace>));

  // No archived task: no 보관함 entry at all (older hosts send no `archived`).
  await draw({ ...view(), archived: undefined });
  assert.equal(host.querySelector('.tw-archive-open'), null);
  await draw(view({ archived: [] }));
  assert.equal(host.querySelector('.tw-archive-open'), null);

  await draw(view());
  const toggle = host.querySelector('.tw-archive-open');
  assert.ok(toggle, '보관함 opens from the task list');
  assert.equal(toggle.textContent, '보관함 2');
  assert.deepEqual(host.querySelectorAll('.tw-task').map((b: any) => b.querySelector('.tw-task-title').textContent), ['열린 작업'], 'archived tasks are not in 최근 작업');

  await act(() => click(toggle));
  assert.equal(host.querySelector('.tw-task'), null, '보관함 is a separate view of the list');
  const heading = host.querySelector('.tw-archive-heading h2');
  assert.equal(heading.textContent, '보관함');
  assert.equal(doc.activeElement === heading, true, 'focus moves to the 보관함 heading');
  const rows = host.querySelectorAll('.tw-archived');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].querySelector('.tw-task-title').textContent, HOSTILE, 'a title is text, never markup');
  assert.equal(host.querySelector('img'), null);
  const reopen = host.querySelectorAll('.tw-reopen');
  assert.deepEqual(reopen.map((b: any) => b.textContent), ['다시 열기', '다시 열기']);
  assert.equal(reopen[1].getAttribute('aria-label'), '다시 열기: 오래된 작업');
  assert.equal(host.querySelectorAll('.tw-archived button').length, 2, 'nothing in 보관함 deletes: one action per row');
  assert.ok(!/삭제|지우기|영구/.test(host.querySelector('.tw-rail').textContent), 'no delete wording in 보관함');

  // Busy (a turn running): 다시 열기 waits, like every other task switch.
  await draw(view(), true);
  assert.ok(host.querySelectorAll('.tw-reopen').every((b: any) => b.hasAttribute('disabled')));
  await draw(view());

  // Back to the list returns focus to the 보관함 button.
  await act(() => click(host.querySelector('.tw-archive-back')));
  assert.ok(host.querySelector('.tw-task'));
  assert.equal(doc.activeElement === host.querySelector('.tw-archive-open'), true, 'focus returns to 보관함');

  // 다시 열기 posts the archived task's id; focus follows only once that task really opened.
  await act(() => click(host.querySelector('.tw-archive-open')));
  posted().length = 0;
  await act(() => click(host.querySelectorAll('.tw-reopen')[1]));
  assert.deepEqual(posted().map(m => ({ type: m.type, id: m.id })), [{ type: 'taskRestore', id: 'c' }]);
  await draw(view({ revision: 4, activeTaskId: 'c', tasks: [{ id: 'c', title: '오래된 작업', createdAt: 1, updatedAt: 1, messageCount: 0 }, listed], archived: [view().archived![0]] }));
  // The task change closes 보관함; the rail shows the reopened task as current.
  assert.equal(host.querySelector('.tw-archive-heading'), null);
  const current = host.querySelector('.tw-task[aria-current="page"]');
  assert.equal(current.querySelector('.tw-task-title').textContent, '오래된 작업');
  assert.equal(doc.activeElement === current, true, 'focus lands on the reopened task, never <body>');

  // After 보관하기 the host opens another task: one calm line says where the task went, then goes with the next change.
  await draw(view({ revision: 5, activeTaskId: 'c', tasks: [{ id: 'c', title: '오래된 작업', createdAt: 1, updatedAt: 1, messageCount: 0 }, listed], archived: [] }));
  await draw(view({ revision: 6, activeTaskId: 'b', tasks: [listed], archived: [{ id: 'c', title: '오래된 작업', createdAt: 1, updatedAt: 1, messageCount: 0, archivedAt: 9 }] }));
  const note = host.querySelector('.tw-archive-note');
  assert.ok(note, 'an archive says where the task went');
  assert.equal(note.getAttribute('role'), 'status');
  assert.match(note.textContent, /‘오래된 작업’ 작업을 보관함에 넣었어요\. 대화는 그대로 있고/);
  await draw(view({ revision: 7, activeTaskId: 'x', tasks: [{ id: 'x', title: '새 작업', createdAt: 9, updatedAt: 9, messageCount: 0 }, listed], archived: [{ id: 'c', title: '오래된 작업', createdAt: 1, updatedAt: 1, messageCount: 0, archivedAt: 9 }] }));
  assert.equal(host.querySelector('.tw-archive-note'), null, 'a plain switch clears the line');
  // A different seat (scope) never inherits it.
  await draw(view({ scope: 'other', revision: 1, activeTaskId: 'b', tasks: [listed], archived: [] }));
  assert.equal(host.querySelector('.tw-archive-note'), null);
  await act(() => root.unmount());
}

const noop = () => {};
const PROPS = {
  messages: [] as ChatMessage[], streaming: false, streamingId: null, error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false,
  pageNotice: null, aiNotice: null, stopNotice: null, openWorldId: null, publish: null, incomingImage: null,
  onSend: noop, onRetry: noop, onRetryLast: noop, onDismissError: noop, onCancel: noop, onClear: noop,
  onSetToken: noop, onSettings: noop, onRunCode: noop, onNamingRitual: noop, onSaveCoach: noop,
  onReportProblem: noop, onInstallUpdate: noop, onDismissUpdate: noop, onPublish: noop, onEditResend: () => true,
};
const UX = { coach: { naming_mode: 'fixed' as const, fallback_name: 'HypeProof', naming_prompt_md: '', personality_prompt_md: '' }, suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: '' }, roll_input_button: { enabled: false, label: '', probe_md: '' } }, retry_button: { enabled: false, show_counter: false } };
const seat = (kind: 'personal' | 'classroom', lesson: unknown = null) => ({
  model: 'claude-sonnet-5', hasToken: true, proxyUrl: 'http://localhost:8787', coach: { name: 'HypeProof', personality: '', configured: true },
  profile: { profile_id: 'p', activity_kind: kind, observation: null, lesson, rehearsal: null, welcome: { greeting_md: '안녕하세요' }, model_selection: null, ux: UX },
  activity: { id: 'a1', name: '활동', kind, workspace: '/tmp/w', verified: true },
  ...(kind === 'personal' ? { taskWorkspace: view() } : {}),
}) as unknown as ChatConfig;
// The personal task menu (대화 메뉴) is a closed popover until its toggle is pressed: mount, open it, read it.
async function menuArchive(config: ChatConfig, extra: Record<string, unknown> = {}) {
  const host = mountPoint(), root = createRoot(host);
  await act(() => root.render(<ChatPanel {...PROPS} config={config} instructor={false} {...extra} />));
  const toggle = host.querySelector('.tw-chat-menu-toggle');
  if (toggle) await act(() => click(toggle));
  const all = host.querySelectorAll('button').filter((b: any) => b.textContent === '보관하기');
  const found = all[0] ?? null;
  return { host, root, found, count: all.length, menuOpen: !!host.querySelector('.tw-chat-menu-panel') };
}
async function chatPanel() {
  const personal = await menuArchive(seat('personal'));
  assert.ok(personal.menuOpen, 'the personal task menu opened');
  assert.ok(personal.found, 'personal tasks have 보관하기 in the task menu');
  assert.equal(personal.count, 1);
  assert.equal(personal.found.getAttribute('role'), 'menuitem');
  assert.equal(personal.found.hasAttribute('disabled'), false);
  assert.ok(!/danger|destructive/.test(personal.found.getAttribute('class') ?? ''), 'no destructive styling: nothing is deleted');
  posted().length = 0;
  await act(() => click(personal.found));
  assert.deepEqual(posted().map(m => m.type), ['taskArchive'], '보관하기 asks the host; the host decides which task is open');
  await act(() => personal.root.unmount());
  const running = await menuArchive(seat('personal'), { streaming: true });
  assert.equal(running.found?.hasAttribute('disabled'), true, 'a running task must be stopped first');
  await act(() => running.root.unmount());
  for (const [name, config, extra] of [['classroom', seat('classroom'), {}], ['lesson', seat('personal', { version: 1, content: { steps: [] } }), {}], ['instructor', seat('personal'), { instructor: true }]] as const) {
    const other = await menuArchive(config, extra);
    assert.equal(other.count, 0, `${name}: no 보관하기`);
    await act(() => other.root.unmount());
  }
}

async function run() {
  await workspace();
  await chatPanel();
  console.log('task-archive-ui: 보관함 view, 다시 열기, focus, note and 보관하기 per seat PASS');
}
run().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
