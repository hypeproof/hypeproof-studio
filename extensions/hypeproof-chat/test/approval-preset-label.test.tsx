// CGP-AGENT-R-002 / DES-CGP-AGENT-01 — the lesson's approval preset is read-only text with a lock
// icon, left of the send button, never a control. Bundled with esbuild and run with plain Node.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { presetAtTurnBoundary } from "../webview-ui/src/ApprovalPresetLabel";
import type { ChatConfig } from "../src/protocol";

(globalThis as unknown as Record<string, unknown>).window = { acquireVsCodeApi: undefined };
let fail = 0;
const t = (label: string, fn: () => void) => { try { fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; } };

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
const BEFORE = { id: "before_changes", label: "바꾸기 전에 묻기", description: "파일을 고치거나 명령을 실행하기 전에 물어봐요." };
const ALWAYS = { id: "always_ask", label: "항상 묻기", description: "파일을 고치거나 명령을 실행하기 전에 매번 묻고, 한 번 허락한 일도 다시 물어봐요." };
const config = (approval_preset?: unknown) => ({
  model: "claude-sonnet-5", hasToken: true, proxyUrl: "http://localhost:8787",
  coach: { name: "HypeProof", personality: "", configured: true },
  profile: { profile_id: "class-a", activity_kind: "classroom", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX, ...(approval_preset ? { approval_preset } : {}) },
  activity: { id: "a1", name: "수업", kind: "classroom", workspace: "/tmp/w", verified: true },
}) as unknown as ChatConfig;
const render = (approval_preset?: unknown, streaming = false) =>
  renderToStaticMarkup(<ChatPanel {...PROPS} streaming={streaming} config={config(approval_preset)} instructor={false} />);
const label = (html: string) => /<span class="hps-approval-preset"[^>]*>[\s\S]*?<\/span><\/span>/.exec(html)?.[0] ?? "";

t("the served preset is drawn as text + lock icon", () => {
  const el = label(render(BEFORE));
  if (!el) throw new Error("label missing");
  if (!el.includes('data-approval-preset="before_changes"')) throw new Error("id");
  if (!el.includes('data-icon="lock"')) throw new Error("lock icon missing");
  if (!el.includes('<span class="hps-approval-preset-text">바꾸기 전에 묻기</span>')) throw new Error("label text");
  if (!el.includes('aria-label="승인 방식: 바꾸기 전에 묻기. 선생님이 정한 방식이에요. 파일을 고치거나 명령을 실행하기 전에 물어봐요."')) throw new Error("accessible name");
  if (!el.includes('data-hp-tooltip="바꾸기 전에 묻기 — 선생님이 정한 방식이에요.')) throw new Error("focus tooltip");
  if (!el.includes('tabindex="0"')) throw new Error("not focusable for its tooltip");
});
t("read-only: not a button, select, or menu; the learner has no control that changes it", () => {
  const el = label(render(BEFORE));
  for (const bad of ["<button", "<select", "role=\"button\"", "aria-haspopup", "onclick", "<input"]) if (el.includes(bad)) throw new Error(`control: ${bad}`);
});
t("sits left of the send button inside the composer buttons", () => {
  const html = render(BEFORE);
  const buttons = /<div class="hps-input-buttons">[\s\S]*?<\/div>/.exec(html)?.[0] ?? "";
  const at = buttons.indexOf("hps-approval-preset"), send = buttons.indexOf("hps-btn-send");
  if (at < 0 || send < 0 || at > send) throw new Error(`order ${at} ${send}`);
});
t("also next to the stop button while a turn runs", () => {
  const html = render(ALWAYS, true);
  const buttons = /<div class="hps-input-buttons">[\s\S]*?<\/div>/.exec(html)?.[0] ?? "";
  if (!(buttons.indexOf("hps-approval-preset") >= 0 && buttons.indexOf("hps-approval-preset") < buttons.indexOf("hps-btn-stop"))) throw new Error("not before stop");
});
t("negative control: no preset → no label (today's composer)", () => {
  if (render().includes("hps-approval-preset")) throw new Error("label without a preset");
});
t("negative control: an unknown or full-access preset is never drawn", () => {
  if (render({ id: "full_access", label: "모두 허용", description: "묻지 않아요." }).includes("hps-approval-preset")) throw new Error("drew full access");
});
t("a change applies at the next turn boundary only", () => {
  if (presetAtTurnBoundary(BEFORE as never, ALWAYS as never, true) !== BEFORE) throw new Error("changed mid-turn");
  if (presetAtTurnBoundary(BEFORE as never, ALWAYS as never, false) !== ALWAYS) throw new Error("did not follow the profile between turns");
  if (presetAtTurnBoundary(BEFORE as never, null, false) !== null) throw new Error("removal between turns");
});

if (fail) { console.error(`approval-preset-label: ${fail} failed`); process.exit(1); }
console.log("approval-preset-label: ok");
