// CGP-KNOW-R-009 (REQ-KNOW-14) / DES-KNOW-14 — the per-task menu in the rail, rendered by the real
// TaskWorkspace on the minimal DOM. A personal task's menu lists exactly the personal activities the
// host gave and posts one taskMove for the picked one; a class (or trial) task's menu offers nothing
// to pick: its move item stays focusable with aria-disabled and the reason as its description.
// The host and store halves are test/task-move.test.mjs and test/task-workspace-host.test.mjs.
import { click, document as doc, mountPoint } from './fixtures/mini-dom.mjs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import assert from 'node:assert/strict';
import { TaskWorkspace } from '../webview-ui/src/TaskWorkspace';
import type { TaskWorkspaceView } from '../src/taskWorkspaceContract';
import { TASK_MOVE_CLASS_REASON, TASK_MOVE_NONE_REASON, TASK_MOVE_TRIAL_REASON, type TaskMoveView } from '../src/taskMove';
for (const name of ['Node', 'Element']) (globalThis as any)[name] ??= (window as any)[name];
(globalThis as any).HTMLElement ??= (window as any).Element;
const posted = () => (globalThis as unknown as { __posted: Array<Record<string, unknown>> }).__posted;
const hostSays = (data: unknown) => act(async () => { (globalThis as unknown as { window: { dispatchEvent(e: unknown): boolean } }).window.dispatchEvent({ type: 'message', data, bubbles: false }); });
const key = (target: any, k: string) => act(() => target.dispatchEvent({ type: 'keydown', bubbles: true, cancelable: true, key: k, isComposing: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} }));

const view: TaskWorkspaceView = { scope: 's', revision: 1, activeTaskId: 'a', sourceSelection: null, tasks: [
  { id: 'a', title: '첫 작업', createdAt: 1, updatedAt: 2, messageCount: 2 },
  { id: 'b', title: '둘째 작업', createdAt: 1, updatedAt: 1, messageCount: 0 },
] };
const personal: TaskMoveView = { allowed: true, destinations: [{ ref: 'ref-b', name: '그림 연습' }, { ref: 'ref-c', name: '<b>홈페이지</b>' }] };

async function run() {
  const host = mountPoint(), root = createRoot(host);
  const render = (taskMove: TaskMoveView | undefined, busy = false) => act(() => root.render(<TaskWorkspace view={view} messages={[]} busy={busy} error={null} runState={null} taskMove={taskMove} onDismissError={() => {}}><p>대화</p></TaskWorkspace>));

  // No move rule from the host (a seat without one) → no task menu at all.
  await render(undefined);
  assert.equal(host.querySelectorAll('.tw-task-menu-toggle').length, 0);

  // Personal: one menu toggle per task, named with its task; the menu lists the host's personal activities only.
  await render(personal);
  const toggles = host.querySelectorAll('.tw-task-menu-toggle');
  assert.equal(toggles.length, 2);
  assert.equal(toggles[1].getAttribute('aria-label'), '작업 메뉴: 둘째 작업');
  assert.equal(toggles[1].getAttribute('aria-haspopup'), 'menu');
  await act(() => click(toggles[1]));
  assert.equal(toggles[1].getAttribute('aria-expanded'), 'true');
  const menu = host.querySelector('[role="menu"]');
  assert.ok(menu);
  const items = menu.querySelectorAll('button[role="menuitem"]');
  assert.deepEqual([...items].map((item: any) => item.textContent), ['그림 연습', '<b>홈페이지</b>']);
  assert.equal(host.querySelector('b'), null, 'activity names render as text');
  assert.equal(items[0].getAttribute('aria-label'), '옮기기: 그림 연습');
  assert.equal(doc.activeElement === items[0], true, 'the first item takes focus');
  await key(items[0], 'ArrowDown');
  assert.equal(doc.activeElement === items[1], true);
  await key(items[1], 'Escape');
  assert.equal(host.querySelector('[role="menu"]'), null);
  assert.equal(doc.activeElement === toggles[1], true, 'Escape returns focus to the toggle');

  // Picking posts one taskMove for that task and destination, bound to a request id.
  await act(() => click(toggles[1]));
  const before = posted().length;
  await act(() => click(host.querySelectorAll('button[role="menuitem"]')[0]));
  const sent = posted().slice(before).filter(message => message.type === 'taskMove');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].id, 'b');
  assert.equal(sent[0].destination, 'ref-b');
  assert.match(String(sent[0].requestId), /^[0-9a-f-]{36}$/);
  // A second pick while the first is unanswered sends nothing.
  await act(() => click(host.querySelectorAll('.tw-task-menu-toggle')[0]));
  await act(() => click(host.querySelectorAll('button[role="menuitem"]')[1]));
  assert.equal(posted().slice(before).filter(message => message.type === 'taskMove').length, 1);
  // A foreign reply is ignored; the matching one is announced in the polite status line.
  await hostSays({ type: 'taskMoveResult', requestId: 'someone-else', moved: true, title: 'x', destination: 'y' });
  assert.equal(host.querySelector('.tw-move-status').textContent, '');
  await hostSays({ type: 'taskMoveResult', requestId: sent[0].requestId, moved: true, title: '둘째 작업', destination: '그림 연습' });
  const status = host.querySelector('.tw-move-status');
  assert.equal(status.getAttribute('role'), 'status');
  assert.equal(status.textContent, '‘둘째 작업’ 작업을 ‘그림 연습’ 활동으로 옮겼어요. 그 활동을 열면 이어서 할 수 있어요.');
  // The picked row's menu closed without a focus target; focus lands on the open task's row, not <body>.
  await act(() => new Promise(resolve => setTimeout(resolve, 5)));
  assert.equal(doc.activeElement === host.querySelector('.tw-task[aria-current="page"]'), true, 'focus moves to the open task after the move');

  // A running turn disables the toggles (the host refuses too).
  await render(personal, true);
  assert.equal([...host.querySelectorAll('.tw-task-menu-toggle')].every((toggle: any) => toggle.hasAttribute('disabled')), true);

  // Class task, trial task and "no other personal activity": nothing to pick; the move item stays
  // focusable (aria-disabled, not disabled) and its reason is its description.
  for (const [move, reason] of [
    [{ allowed: false, reason: TASK_MOVE_CLASS_REASON }, TASK_MOVE_CLASS_REASON],
    [{ allowed: false, reason: TASK_MOVE_TRIAL_REASON }, TASK_MOVE_TRIAL_REASON],
    [{ allowed: true, destinations: [] }, TASK_MOVE_NONE_REASON],
  ] as [TaskMoveView, string][]) {
    await render(move);
    await act(() => click(host.querySelectorAll('.tw-task-menu-toggle')[0]));
    const only = host.querySelectorAll('[role="menu"] button[role="menuitem"]');
    assert.equal(only.length, 1);
    const item: any = only[0];
    assert.equal(item.textContent, '다른 활동으로 옮기기');
    assert.equal(item.parentElement.getAttribute('role'), 'group', 'the reason sits in a group, not loose in the menu');
    assert.equal(item.getAttribute('aria-disabled'), 'true');
    assert.equal(item.hasAttribute('disabled'), false, 'focusable, not disabled');
    assert.equal(doc.activeElement === item, true, 'the reason is reached on focus');
    const describedBy = item.getAttribute('aria-describedby');
    const described = (host as any).findAll((e: any) => e.getAttribute?.('id') === describedBy)[0];
    assert.equal(described?.textContent, reason);
    const count = posted().length;
    await act(() => click(item));
    assert.equal(posted().slice(count).some(message => message.type === 'taskMove'), false, 'a disabled move sends nothing');
    await key(item, 'Escape');
  }
  await act(() => root.unmount());
  console.log('task-menu: ok');
}
run().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
