// REQ-STUDIO-QUIT-GUARD — the real ChatPanel tells the host whether it holds a queued, unsent
// message, so the quit dialog can name it. Deleting the queueState effect must fail this file.
// Bundled with esbuild and run with plain Node; the banner captures what the panel posts.

import { mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { createRoot } from "react-dom/client";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import type { ChatConfig } from "../src/protocol";

const act: (fn: () => unknown) => Promise<void> = (React as unknown as { act: (fn: () => unknown) => Promise<void> }).act;
const posted = (globalThis as unknown as { __posted: Array<{ type: string; queued?: unknown }> }).__posted;
const fail = (m: string) => { console.error(`  FAIL ${m}`); process.exit(1); };
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail(`${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

const noop = () => {};
const UX = {
  coach: { naming_mode: "fixed" as const, fallback_name: "HypeProof", naming_prompt_md: "", personality_prompt_md: "" },
  suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: "" }, roll_input_button: { enabled: false, label: "", probe_md: "" } },
  retry_button: { enabled: false, show_counter: false },
};
const config = {
  model: "claude-sonnet-5", hasToken: true, proxyUrl: "http://localhost:8787",
  coach: { name: "HypeProof", personality: "", configured: true },
  profile: { profile_id: "p", activity_kind: "personal", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX },
  activity: { id: "p1", name: "내 작업", kind: "personal", workspace: "/tmp/p", verified: true },
} as unknown as ChatConfig;

type El = { value: string; localName: string; findAll(test: (e: El) => boolean): El[]; dispatchEvent(e: unknown): boolean };
const ev = (type: string, extra: Record<string, unknown> = {}) => ({
  type, bubbles: true, cancelable: true, defaultPrevented: false, timeStamp: Date.now(),
  preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra,
});

(async () => {
  const sent: string[] = [];
  const host = mountPoint() as unknown as El;
  const root = createRoot(host as unknown as HTMLElement);
  const render = (streaming: boolean) => act(async () => {
    const props: Record<string, unknown> = {
      messages: [], streaming, streamingId: streaming ? "s1" : null, error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false,
      pageNotice: null, aiNotice: null, stopNotice: null, openWorldId: null, publish: null, incomingImage: null,
      onSend: (text: string) => { sent.push(text); }, onRetry: noop, onRetryLast: noop, onDismissError: noop, onCancel: noop, onClear: noop,
      onSetToken: noop, onSettings: noop, onRunCode: noop, onNamingRitual: noop, onSaveCoach: noop,
      onReportProblem: noop, onInstallUpdate: noop, onDismissUpdate: noop, onPublish: noop,
      config, instructor: false,
    };
    root.render(<ChatPanel {...(props as React.ComponentProps<typeof ChatPanel>)} />);
  });
  const reports = () => posted.filter((m) => m.type === "queueState").map((m) => m.queued);
  const textarea = () => host.findAll((e) => e.localName === "textarea")[0];

  await render(true);
  eq(reports(), [false], "mount reports an empty queue");

  // Enter while a turn runs parks the message instead of sending it.
  await act(async () => { const ta = textarea(); ta.value = "다음에 보낼 말"; ta.dispatchEvent(ev("input")); });
  await act(async () => { textarea().dispatchEvent(ev("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, shiftKey: false, isComposing: false })); });
  eq(sent, [], "nothing sent during the turn");
  eq(reports(), [false, true], "the parked message is reported");

  // The turn ends, the queue flushes, and the host hears that nothing is waiting.
  await render(false);
  eq(sent, ["다음에 보낼 말"], "the queued message is sent at the end of the turn");
  eq(reports(), [false, true, false], "the flushed queue is reported empty");

  await act(async () => root.unmount());
  console.log("  ok   queued message reported to the host for the quit dialog");
  process.exit(0);
})();
