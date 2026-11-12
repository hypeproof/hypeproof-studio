// REQ-STUDIO-FEEDBACK-ENTRY (#3413) — a visible 의견·문제 보내기 in the personal 대화 메뉴, opening the same report form.
//   node scripts/run-tsx-tests.mjs feedback-entry
// Real ChatPanel and ProblemReportDialog. The start page button and its host command are in
// test/account-start-entry.test.tsx and test/start-page.smoke.mjs.
import { click, mountPoint } from './fixtures/mini-dom.mjs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import assert from 'node:assert/strict';
import { ChatPanel } from '../webview-ui/src/ChatPanel';
import { ProblemReportDialog } from '../webview-ui/src/ProblemReportDialog';
import { FEEDBACK_ENTRY_LABEL, PROBLEM_FORM_LEAD, problemDetailRows } from '../src/problemReport';
import type { ChatConfig, ChatMessage } from '../src/protocol';
for (const name of ['Node', 'Element']) (globalThis as any)[name] ??= (window as any)[name];
(globalThis as any).HTMLElement ??= (window as any).Element;

const noop = () => {};
const PROPS = {
  messages: [] as ChatMessage[], streaming: false, streamingId: null, error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false,
  pageNotice: null, aiNotice: null, stopNotice: null, openWorldId: null, publish: null, incomingImage: null,
  onSend: noop, onRetry: noop, onRetryLast: noop, onDismissError: noop, onCancel: noop, onClear: noop,
  onSetToken: noop, onSettings: noop, onRunCode: noop, onNamingRitual: noop, onSaveCoach: noop,
  onInstallUpdate: noop, onDismissUpdate: noop, onPublish: noop, onEditResend: () => true,
};
const UX = { coach: { naming_mode: 'fixed' as const, fallback_name: 'HypeProof', naming_prompt_md: '', personality_prompt_md: '' }, suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: '' }, roll_input_button: { enabled: false, label: '', probe_md: '' } }, retry_button: { enabled: false, show_counter: false } };
const seat = (kind: 'personal' | 'classroom') => ({
  model: 'claude-sonnet-5', hasToken: true, proxyUrl: 'http://localhost:8787', coach: { name: 'HypeProof', personality: '', configured: true },
  profile: { profile_id: 'p', activity_kind: kind, observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: '안녕하세요' }, model_selection: null, ux: UX },
  activity: { id: 'a1', name: '활동', kind, workspace: '/tmp/w', verified: true },
  ...(kind === 'personal' ? { taskWorkspace: { scope: 's', revision: 1, activeTaskId: 'b', sourceSelection: null, tasks: [{ id: 'b', title: '작업', createdAt: 1, updatedAt: 1, messageCount: 0 }] } } : {}),
}) as unknown as ChatConfig;

async function mount(config: ChatConfig, extra: Record<string, unknown> = {}) {
  const calls: unknown[][] = [];
  const host = mountPoint(), root = createRoot(host);
  await act(() => root.render(<ChatPanel {...PROPS} onReportProblem={(...args: unknown[]) => { calls.push(args); }} config={config} instructor={false} {...extra} />));
  const entry = () => host.querySelectorAll('button').filter((b: any) => b.textContent === FEEDBACK_ENTRY_LABEL);
  return { host, root, calls, entry };
}

async function menu() {
  const { host, root, calls, entry } = await mount(seat('personal'));
  // Closed menu: the entry is one press away, behind the named 대화 메뉴 toggle.
  assert.equal(entry().length, 0, 'the item lives inside the closed menu');
  const toggle = host.querySelector('.tw-chat-menu-toggle');
  assert.ok(toggle, 'personal chat has the 대화 메뉴');
  assert.equal(toggle.getAttribute('aria-label'), '대화 메뉴');
  await act(() => click(toggle));                                         // click 1
  const items = entry();
  assert.equal(items.length, 1, '의견·문제 보내기 is in the 대화 메뉴');
  const item = items[0];
  assert.equal(item.getAttribute('role'), 'menuitem', 'a menu item, reachable with the menu keys');
  assert.equal(item.hasAttribute('disabled'), false, 'available while idle');
  assert.equal(item.textContent, '의견·문제 보내기', 'its accessible name is its visible text');
  await act(() => click(item));                                           // click 2
  assert.deepEqual(calls, [[]], 'opens the report form as the learner\'s own report (no "error" source)');
  await act(() => root.unmount());

  // A running turn does not hide or block it: a complaint can come at any time.
  const running = await mount(seat('personal'), { streaming: true });
  await act(() => click(running.host.querySelector('.tw-chat-menu-toggle')));
  assert.equal(running.entry()[0]?.hasAttribute('disabled'), false);
  await act(() => running.root.unmount());

  // Classroom layout has no 대화 메뉴; its header row stays as it was (negative control).
  const classroom = await mount(seat('classroom'));
  assert.equal(classroom.host.querySelector('.tw-chat-menu-toggle'), null);
  assert.equal(classroom.entry().length, 0);
  await act(() => classroom.root.unmount());
}

function form() {
  const view = (reason: 'manual' | 'error') => ({
    id: 'f1', reason, details: problemDetailRows(undefined, '0.1.60', 'windows-x64'), contactPrompt: '답을 받을 연락처', contactPlaceholder: '예: 이메일',
    recentTurns: 0, autoReport: false, logs: { available: true, checked: false, errorCount: 0 },
  });
  const manual = renderToStaticMarkup(<ProblemReportDialog form={view('manual')} onAnswer={noop} />);
  assert.match(manual, /<h2 id="problem-report-title">의견·문제 보내기<\/h2>/, 'the form opened from the entry carries the entry\'s name');
  assert.ok(manual.includes(PROBLEM_FORM_LEAD.manual));
  assert.match(PROBLEM_FORM_LEAD.manual, /「이게 불편해요」/, 'the lead says a plain complaint is welcome');
  assert.ok(!/무엇이 안 되는지/.test(PROBLEM_FORM_LEAD.manual), 'the lead no longer asks only for failures');
  assert.ok(manual.includes('예: 글씨가 작아서 읽기 불편해요'));
  // A failure keeps its own title, lead and example (positive control for the switch).
  const error = renderToStaticMarkup(<ProblemReportDialog form={view('error')} onAnswer={noop} />);
  assert.match(error, /<h2 id="problem-report-title">문제 보내기<\/h2>/);
  assert.ok(error.includes('방금 생긴 문제를') && error.includes('예: 보내기를 누르면 계속 오류가 나요'));
}

async function run() {
  await menu();
  form();
  console.log('feedback-entry: 대화 메뉴 item (2 clicks, menuitem, name), classroom control, form title/lead/example PASS');
}
run().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
