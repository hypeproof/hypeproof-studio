import { click, document as doc, mountPoint } from './fixtures/mini-dom.mjs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { TaskWorkspace } from '../webview-ui/src/TaskWorkspace';
import type { TaskWorkspaceView } from '../src/taskWorkspaceContract';
for (const name of ['Node', 'Element']) (globalThis as any)[name] ??= (window as any)[name];
(globalThis as any).HTMLElement ??= (window as any).Element;
const view: TaskWorkspaceView = { scope: 's', revision: 1, activeTaskId: 'a', sourceSelection: null, tasks: [
  { id: 'a', title: '<script>작업</script>\u202e'.repeat(15), createdAt: 1, updatedAt: 1, messageCount: 0 },
  { id: 'b', title: '다른 작업', createdAt: 1, updatedAt: 1, messageCount: 2 },
] };
async function run() {
  const host = mountPoint(), root = createRoot(host);
  const labels = { preparing: '응답 준비 중', running: '작업 중', approval: '승인 기다리는 중', stopped: '멈춤', error: '오류', done: '끝남' } as const;
  for (const [state, label] of Object.entries(labels)) {
    await act(() => root.render(<TaskWorkspace view={view} messages={[]} busy={['preparing', 'running', 'approval'].includes(state)} error={null} runState={state as keyof typeof labels} onDismissError={() => {}}><p>대화 내용</p></TaskWorkspace>));
    const tasks = host.querySelectorAll('.tw-task'), badge = tasks[0].querySelector('.tw-task-state');
    assert.equal(badge.parentElement, tasks[0]);
    assert.equal(badge.textContent, label); assert.ok(label.split(' ').length <= 3);
    assert.equal(badge.getAttribute('data-run-state'), state);
    assert.equal(tasks[1].querySelector('.tw-task-state'), null);
    assert.equal(host.querySelector('script'), null);
  }
  const link = host.querySelector('.tw-skip'), target = host.querySelector('.tw-conversation');
  assert.equal(link.getAttribute('title'), '대화로 바로 가기 (Alt+Shift+J 또는 Enter)');
  assert.equal(link.getAttribute('href'), '#task-conversation');
  assert.equal(link.getAttribute('aria-keyshortcuts'), 'Alt+Shift+J');
  assert.equal(target.getAttribute('tabindex'), '-1');
  const key = async (extra = {}) => act(() => link.dispatchEvent({ type: 'keydown', bubbles: true, key: 'J', code: 'KeyJ', altKey: true, shiftKey: true, ctrlKey: false, metaKey: false, repeat: false, isComposing: false, ...extra }));
  for (const extra of [{ isComposing: true }, { defaultPrevented: true }, { repeat: true }, { ctrlKey: true }, { metaKey: true }, { altKey: false }, { shiftKey: false }, { code: 'KeyK' }]) {
    link.focus(); await key(extra); assert.equal(doc.activeElement === link, true, 'unrelated input or IME cannot jump');
  }
  link.focus(); await key(); assert.equal(doc.activeElement === target, true, 'shortcut reaches current conversation');
  link.focus(); await act(() => click(link));
  assert.equal(doc.activeElement === target, true, 'actual focus after jump');
  await act(() => root.render(<TaskWorkspace view={{ ...view, activeTaskId: 'b' }} messages={[]} busy={false} error={null} runState={null} onDismissError={() => {}}><p>다른 대화</p><dialog open><button className="settings-action">설정</button></dialog></TaskWorkspace>));
  assert.equal(host.querySelectorAll('.tw-task-state').length, 0);
  await act(() => click(host.querySelector('.tw-skip')));
  assert.equal(doc.activeElement === host.querySelector('.tw-conversation'), true);
  const settings = host.querySelector('.settings-action'); settings.focus();
  await act(() => settings.dispatchEvent({ type: 'keydown', bubbles: true, key: 'J', code: 'KeyJ', altKey: true, shiftKey: true }));
  assert.equal(doc.activeElement === settings, true, 'settings dialog owns its keyboard input');
  // Open each mobile dialog: the local jump must not escape its focus trap.
  window.innerWidth = 600;
  await act(() => window.dispatchEvent({ type: 'resize' } as any));
  for (const selector of ['.tw-rail-toggle', '.tw-sources-toggle']) {
    await act(() => click(host.querySelector(selector)));
    const modal = host.querySelector('[aria-modal="true"]');
    assert.ok(modal, selector);
    const focused = doc.activeElement;
    await act(() => focused.dispatchEvent({ type: 'keydown', bubbles: true, key: 'J', code: 'KeyJ', altKey: true, shiftKey: true }));
    assert.equal(doc.activeElement === focused, true, 'shortcut stays inside a modal');
    const close = modal.querySelector('button');
    await act(() => click(close));
  }
  await act(() => root.unmount());
  // Structural CSS contracts complement mounted behavior; real geometry is e2e/task-workspace/task-rail-badge.mjs.
  const css = fs.readFileSync(path.join(process.cwd(), 'webview-ui/src/taskWorkspace.css'), 'utf8');
  assert.match(css, /\.tw-task \{ display: grid; grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(css, /\.tw-task-state \{ justify-self: end; max-width: 100%;/);
  assert.doesNotMatch(css, /\.tw-task-state \{[^}]*white-space: nowrap/, 'the badge must not force a one-line width that starves the title');
  assert.match(css, /\.tw-task-state \{[^}]*font-size: var\(--hp-text-caption\)/);
  assert.match(fs.readFileSync(path.join(process.cwd(), 'webview-ui/src/tokens.css'), 'utf8'), /--hp-text-caption: calc\(14px \+ var\(--hp-text-step\)\)/, 'caption token floor is 14px');
  assert.match(css, /\.tw-task-meta \{ grid-column: 1 \/ -1;/);
  assert.match(css, /\.tw-task-state\[data-run-state="approval"\][^{]*\{[^}]*font-weight: 700;[^}]*border-width: 2px;/);
  assert.match(css, /\.tw-conversation:focus \{ outline: 2px solid var\(--hp-ring\); outline-offset: 2px;/);
  assert.match(css, /@media \(forced-colors: active\) \{\s*\.tw-task-state \{ border-color: CanvasText; color: CanvasText; background: Canvas; \}/);
  assert.match(css, /\.tw-task-state\[data-run-state="approval"\] \{ border-style: double; border-width: 3px; \}/);
  console.log('task-badge: mounted states, skip focus and CSS contracts PASS');
}
run().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
