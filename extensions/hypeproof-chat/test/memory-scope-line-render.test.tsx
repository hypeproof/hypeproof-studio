// CGP-KNOW-D-005 (DES-KNOW-07) / REQ-KNOW-47 — the memory scope line in the real ChatPanel header, per seat.
//   personal / trial  — "AI 기억: 켜짐 · 이 작업 공간 안에서만" with the scope sentence as accessible text
//   class             — no store, so no line and no "이 수업 안에서만" promise
//   temporary task    — a "기록 없이 묻기" task keeps and uses no memory: the header must not say memory is on
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { MEMORY_FOLDER_LABEL, MEMORY_SCOPE_HEADER, MEMORY_SCOPE_SENTENCE, MEMORY_STATE_LABEL } from "../src/activityMemoryView";
import type { ChatConfig } from "../src/protocol";

(globalThis as unknown as Record<string, unknown>).window = { acquireVsCodeApi: undefined };
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
const workspace = (temporary: boolean) => ({
  scope: "ms-test", revision: 1, activeTaskId: "t1", sourceSelection: null,
  tasks: [{ id: "t1", title: "발표", createdAt: 1, updatedAt: 1, messageCount: 0 }],
  ...(temporary ? { temporaryTaskId: "t1" } : {}),
});
const config = (kind: "personal" | "trial" | "classroom", temporary = false): ChatConfig => ({
  model: "claude-sonnet-5", hasToken: true, proxyUrl: "http://localhost:8787",
  coach: { name: "HypeProof", personality: "", configured: true },
  profile: { profile_id: "p", activity_kind: kind, observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX } as unknown as NonNullable<ChatConfig["profile"]>,
  activity: { id: "a1", name: "활동", kind, workspace: "/tmp/w", verified: true } as NonNullable<ChatConfig["activity"]>,
  ...(kind === "classroom" ? {} : { taskWorkspace: workspace(temporary), memoryState: { folder: MEMORY_FOLDER_LABEL } }),
} as unknown as ChatConfig);

let fail = 0;
const t = (label: string, fn: () => void) => {
  try { fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; }
};
const render = (c: ChatConfig) => renderToStaticMarkup(<ChatPanel {...PROPS} config={c} instructor={false} />);
const has = (html: string, s: string) => html.includes(s);

for (const kind of ["personal", "trial"] as const) {
  t(`${kind}: header names state and scope`, () => {
    const html = render(config(kind));
    if (!has(html, 'data-testid="memory-state-header"')) throw new Error("no memory line");
    if (!has(html, MEMORY_STATE_LABEL) || !has(html, MEMORY_SCOPE_HEADER)) throw new Error("state or scope words missing");
    if (!has(html, MEMORY_SCOPE_SENTENCE)) throw new Error("scope sentence missing");
    if (has(html, "이 수업 안에서만")) throw new Error("class wording on a personal seat");
  });
}
t("class: no memory line and no class-store promise", () => {
  const html = render(config("classroom"));
  if (has(html, 'data-testid="memory-state-header"') || has(html, MEMORY_STATE_LABEL) || has(html, "이 수업 안에서만") || has(html, MEMORY_SCOPE_HEADER)) throw new Error("memory words on a class seat");
});
t("temporary task: header does not claim memory is kept", () => {
  const html = render(config("personal", true));
  if (has(html, 'data-testid="memory-state-header"') || has(html, 'hps-memory-now')) throw new Error("memory line shown in a temporary task");
});
t("a normal task of a seat that has a temporary task elsewhere keeps the line", () => {
  const c = config("personal");
  (c.taskWorkspace as { temporaryTaskId?: string }).temporaryTaskId = "other";
  if (!has(render(c), 'data-testid="memory-state-header"')) throw new Error("line missing");
});
if (fail) { console.error(`${fail} failed`); process.exit(1); }
console.log("memory scope line render: ok");
