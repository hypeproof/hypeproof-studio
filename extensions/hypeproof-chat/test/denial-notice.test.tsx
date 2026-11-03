import { click, mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { createRoot } from "react-dom/client";
import assert from "node:assert/strict";
import { App } from "../webview-ui/src/App";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { denialNotice, denialNoticeLabel, storedDenialNotice } from "../src/denialNotice";
import { DENIAL_SOURCE_LABEL } from "../src/denialSource";
import type { ChatConfig, ChatMessage } from "../src/protocol";
const act = (React as any).act;
const noop = () => {};
const PROPS = {
  messages: [], streaming: false, streamingId: null, error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false,
  pageNotice: null, aiNotice: null, stopNotice: null, openWorldId: null, publish: null, incomingImage: null,
  onSend: noop, onRetry: noop, onRetryLast: noop, onDismissError: noop, onCancel: noop, onClear: noop,
  onSetToken: noop, onSettings: noop, onRunCode: noop, onNamingRitual: noop, onSaveCoach: noop,
  onReportProblem: noop, onInstallUpdate: noop, onDismissUpdate: noop, onPublish: noop,
};
const UX = {
  coach: { naming_mode: "fixed" as const, fallback_name: "HypeProof", naming_prompt_md: "", personality_prompt_md: "" },
  suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: "" }, roll_input_button: { enabled: false, label: "", probe_md: "" } },
  retry_button: { enabled: false, show_counter: false },
};
const config = () => ({
  model: "claude-sonnet-5", hasToken: true, proxyUrl: "http://localhost:8787",
  coach: { name: "HypeProof", personality: "", configured: true },
  profile: { profile_id: "class-a", activity_kind: "classroom", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX },
  activity: { id: "a1", name: "수업", kind: "classroom", workspace: "/tmp/w", verified: true },
}) as unknown as ChatConfig;


async function run() {
  for (const classroom of [true, false]) {
    const host = mountPoint(), root = createRoot(host);
    let reported = 0;
    const messages: ChatMessage[] = Object.keys(DENIAL_SOURCE_LABEL).map((source, i) => ({
      id: `denied-${i}`, role: 'tool', content: '', createdAt: i + 1,
      tool: { icon: '🔒', state: 'error', label: denialNoticeLabel(denialNotice(source, classroom)) },
    }));
    const cfg = config();
    if (!classroom) cfg.profile = { ...cfg.profile, activity_kind: 'personal' } as any;
    await act(() => root.render(<ChatPanel {...PROPS} messages={messages} config={cfg} instructor={false} onReportProblem={() => { reported++; }} />));
    const rows = host.querySelectorAll('.hps-denial-notice');
    assert.equal(rows.length, 6);
    for (const row of rows) {
      assert.equal(row.getAttribute('aria-live'), 'polite');
      assert.equal(row.getAttribute('aria-atomic'), 'true');
      assert.equal(row.getAttribute('role'), 'status');
      assert.equal(row.querySelectorAll('button').length, 1);
      const key = row.getAttribute('data-denial-source');
      assert.equal(row.querySelector('.hps-denial-source').textContent, DENIAL_SOURCE_LABEL[key]);
      const bodies = { lesson: classroom ? '수업에서 정한 범위 밖의 동작이라 실행하지 않았어요.' : '지금 활동에서 정한 범위 밖의 동작이라 실행하지 않았어요.', safety: '안전 규칙에 맞지 않아 실행하지 않았어요.', runtime: '지금 앱 환경에서는 이 동작을 할 수 없어요.', access: '지금 고른 이용권에서는 이 동작을 할 수 없어요.', folder: '이 폴더에 허락한 범위 밖의 동작이라 실행하지 않았어요.', unknown: '이 동작을 마치지 못했어요. 이유를 확인하지 못했어요.' };
      assert.equal(row.querySelector('p').textContent, bodies[key]);
      assert.equal(row.querySelector('button').textContent, '문제 신고하기');
      await act(() => click(row.querySelector('button')));
    }
    assert.equal(reported, 6, 'one click invokes the existing report action once');
    if (!classroom) assert.doesNotMatch(rows.map(r => r.textContent).join(''), /선생님|수업에서/);
    await act(() => root.render(<ChatPanel {...PROPS} messages={[...messages, { id: 'next', role: 'user', content: '다음 질문', createdAt: 20 }]} config={cfg} instructor={false} onReportProblem={() => { reported++; }} />));
    assert.equal(host.querySelectorAll('.hps-denial-notice').length, 6, 'next message does not clear notices');
    await act(() => root.unmount());
  }
  // The real App must accept an idle notice without a stream and reject another task's notice.
  const appHost = mountPoint(), appRoot = createRoot(appHost);
  await act(() => appRoot.render(<App />));
  const send = async (data: unknown) => act(() => window.dispatchEvent({ type: 'message', data } as any));
  const cfg = config();
  await send({ type: 'config', config: cfg });
  const label = denialNoticeLabel(denialNotice('safety'));
  await send({ type: 'denialNotice', activityId: 'a1', id: 'idle-denial', label, at: 1 });
  assert.equal(appHost.querySelectorAll('.hps-denial-notice').length, 1, 'idle live notice enters timeline');
  await send({ type: 'denialNotice', activityId: 'a1', taskId: 'other-task', id: 'wrong-task', label, at: 2 });
  await send({ type: 'denialNotice', activityId: 'other', id: 'wrong-activity', label, at: 2 });
  await send({ type: 'denialNotice', activityId: 'a1', id: 'unsafe-body', label: '[안전 규칙] SECRET_TOKEN', at: 3 });
  assert.equal(appHost.querySelectorAll('.hps-denial-notice').length, 1, 'stale scope and noncanonical text rejected');
  assert.doesNotMatch(appHost.textContent, /SECRET_TOKEN/, 'noncanonical payload never renders as an ordinary tool row');
  await send({ type: 'history', activityId: 'a1', messages: [{ id: 'idle-denial', role: 'tool', content: '', createdAt: 1, tool: { icon: '🔒', state: 'error', label } }] });
  assert.equal(appHost.querySelectorAll('.hps-denial-notice').length, 1, 'restored history displays same row once');
  await act(() => appRoot.unmount());
  assert.equal(denialNotice('__proto__').source, 'unknown');
  assert.equal(denialNotice('safety\u202e').source, 'unknown');
  for (const raw of ['[안전 규칙] SECRET_TOKEN', '[수업 설정] <script>bad()</script>', 'Error: raw\n at /private/file', '[확인 안 됨] Bearer key', '\u2028[수업 설정] bad']) assert.equal(storedDenialNotice(raw), null, 'only a complete canonical sentence decodes');
  console.log('denial-notice render and action OK');
}
run().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
