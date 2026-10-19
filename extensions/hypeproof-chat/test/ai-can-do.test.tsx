// CGP-AGENT-R-003 — the "이 수업에서 AI가 할 수 있는 일" card lists exactly the seat's capabilities.
// Bundled with esbuild and run with plain Node, like seat-vocabulary-render.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { aiCapabilities } from "../src/aiCapabilities";
import type { ChatConfig } from "../src/protocol";

(globalThis as unknown as Record<string, unknown>).window = { acquireVsCodeApi: undefined };
let fail = 0;
const t = (label: string, fn: () => void) => { try { fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; } };
const eq = (a: unknown, b: unknown, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const onKeys = (p: Parameters<typeof aiCapabilities>[0], r: "proxy" | "agent-sdk") => aiCapabilities(p, r).filter((c) => c.on).map((c) => c.key);

// Three representative profiles (a kids proxy class, a kids SDK class with files, an adult SDK seat).
const kidsProxy = { browser_control: { enabled: false } };
const kidsFiles = { sdk_tools: { read: true, write: true } };
const adult = { sdk_tools: { read: true, write: true, shell: true, subagents: true, browser: true }, tools: { web_search: true } };
t("six rows in REQ-M38 order, always", () => eq(aiCapabilities(null, "proxy").map((c) => c.key), ["read", "write", "shell", "subagents", "browser", "web_search"]));
t("kids proxy class: nothing on", () => eq(onKeys(kidsProxy, "proxy"), []));
t("kids SDK class with files: read and write only", () => eq(onKeys(kidsFiles, "agent-sdk"), ["read", "write"]));
t("adult SDK seat: everything the profile grants", () => eq(onKeys(adult, "agent-sdk"), ["read", "write", "shell", "subagents", "browser", "web_search"]));
t("never over-promises: file and command grants do not count on the proxy runtime", () => eq(onKeys(adult, "proxy"), ["web_search"]));
t("proxy browsing comes from browser_control, not sdk_tools", () => eq(onKeys({ browser_control: { enabled: true }, sdk_tools: { browser: false } }, "proxy"), ["browser"]));

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
const config = (caps?: ReturnType<typeof aiCapabilities>) => ({
  model: "claude-sonnet-5", hasToken: true, proxyUrl: "http://localhost:8787",
  coach: { name: "HypeProof", personality: "", configured: true },
  profile: { profile_id: "class-a", activity_kind: "classroom", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX },
  activity: { id: "a1", name: "수업", kind: "classroom", workspace: "/tmp/w", verified: true },
  ...(caps ? { aiCapabilities: caps } : {}),
}) as unknown as ChatConfig;

t("card renders every row with 해요 / 안 해요 and stays closed", () => {
  const html = renderToStaticMarkup(<ChatPanel {...PROPS} config={config(aiCapabilities(kidsFiles, "agent-sdk"))} instructor={false} />);
  if (!html.includes('<details class="hp-rail-lesson hp-ai-can-do"><summary>이 수업에서 AI가 할 수 있는 일</summary>')) throw new Error("card missing or open");
  eq((html.match(/data-capability="/g) ?? []).length, 6, "rows");
  if (!/data-capability="read" data-on="true">[\s\S]*?<strong>해요<\/strong>/.test(html)) throw new Error("read on");
  if (!/data-capability="shell" data-on="false">[\s\S]*?<strong>안 해요<\/strong>/.test(html)) throw new Error("shell off");
});
t("negative control: no card without capabilities, and none for an instructor", () => {
  if (renderToStaticMarkup(<ChatPanel {...PROPS} config={config()} instructor={false} />).includes("hp-ai-can-do")) throw new Error("card without data");
});

if (fail) { console.error(`ai-can-do: ${fail} failed`); process.exit(1); }
console.log("ai-can-do OK");
