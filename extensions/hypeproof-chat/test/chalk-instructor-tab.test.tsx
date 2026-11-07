// #3563 — the real ChatPanel: an instructor verified by the Chalk runtime sees the Chalk tab notice
// instead of the student start screen, and the button asks the host to open the Chalk tab.
// Without the flag the start screen stays as it was.
import { click, mountPoint } from './fixtures/mini-dom.mjs';
import React from 'react';
import assert from 'node:assert/strict';
import { createRoot } from 'react-dom/client';
import { ChatPanel } from '../webview-ui/src/ChatPanel';
import type { ChatConfig, ChatMessage } from '../src/protocol';
const act = (React as any).act;
for (const name of ['Node','Element','HTMLElement']) (globalThis as any)[name] ??= (globalThis.window as any).Element;
const noop = () => {};
const PROPS = {
  messages: [] as ChatMessage[], streaming: false, streamingId: null, error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false,
  pageNotice: null, aiNotice: null, stopNotice: null, openWorldId: null, publish: null, incomingImage: null,
  onSend: noop, onRetry: noop, onRetryLast: noop, onDismissError: noop, onCancel: noop, onClear: noop,
  onSetToken: noop, onSettings: noop, onRunCode: noop, onNamingRitual: noop, onSaveCoach: noop,
  onReportProblem: noop, onInstallUpdate: noop, onDismissUpdate: noop, onPublish: noop,
  onEditResend: () => true,
};
const posted = (globalThis as unknown as { __posted: Array<{ type: string }> }).__posted;
const NOTICE = '강사 화면은 Chalk 탭에서 열립니다.';
const START = '시작할 준비가 됐나요?';

async function main() {
  const host = mountPoint(); const root = createRoot(host as any);
  await act(async () => root.render(<ChatPanel {...PROPS} config={{ chalkInstructorTab: true } as unknown as ChatConfig} instructor={false} />));
  assert.ok(host.textContent.includes(NOTICE), 'the Chalk tab notice is shown');
  assert.ok(!host.textContent.includes(START), 'the student start screen is not shown');
  const button = host.findAll((e: any) => e.localName === 'button' && (e.textContent ?? '').includes('Chalk 탭 열기'))[0];
  assert.ok(button, 'the Chalk tab button is shown');
  posted.length = 0;
  await act(async () => click(button));
  assert.ok(posted.some((m) => m.type === 'openChalkInstructorPanel'), 'the button asks the host to open the Chalk tab');

  await act(async () => root.render(<ChatPanel {...PROPS} config={{} as ChatConfig} instructor={false} />));
  assert.ok(host.textContent.includes(START), 'without the flag the student start screen stays');
  assert.ok(!host.textContent.includes(NOTICE), 'without the flag the Chalk tab notice is not shown');
  console.log('ok chalk-instructor-tab');
}
main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
