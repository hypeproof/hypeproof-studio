// CGP-KNOW-D-027 (DES-KNOW-45) — the real ChatPanel draws a memory write as one secondary-text line: bookmark glyph, the
// quoted item on one line (expandable) and a 되돌리기 button that asks the host to undo exactly that write. Bundled with
// esbuild and run with plain Node (scripts/run-tsx-tests.mjs); clicks go through fixtures/mini-dom.mjs.
import { click, mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { memoryWriteLabel } from "../src/memoryWriteLine";
import type { ChatConfig, ChatMessage } from "../src/protocol";

const act: (fn: () => unknown) => Promise<void> = (React as unknown as { act: (fn: () => unknown) => Promise<void> }).act;
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const noop = () => {};
const PROPS = {
  messages: [] as ChatMessage[], streaming: false, streamingId: null, error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false,
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
const config = {
  model: "claude-sonnet-5", hasToken: true, proxyUrl: "http://localhost:8787",
  coach: { name: "HypeProof", personality: "", configured: true },
  profile: { profile_id: "p", activity_kind: "personal", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX },
  activity: { id: "p1", name: "내 작업", kind: "personal", workspace: "/tmp/p", verified: true },
} as unknown as ChatConfig;
const line = (id: string, label: string): ChatMessage => ({ id, role: "tool", content: "", createdAt: 3, tool: { icon: "🔖", label, state: "done" } });

for (const name of ["Node", "Element", "HTMLElement"]) (globalThis as any)[name] ??= (globalThis.window as any).Element;
async function main() {
  const item = "좋아하는 색은 초록이에요.";
  const messages: ChatMessage[] = [
    { id: "u1", role: "user", content: "내가 초록 좋아하는 거 기억해 줘", createdAt: 1 },
    { id: "a1", role: "assistant", content: "알겠어요.", createdAt: 2 },
    line("memwrite-w1", memoryWriteLabel("written", item)),
    line("memwrite-w2", memoryWriteLabel("undone", "빠진 기억")),
  ];
  const host: any = mountPoint(), root = createRoot(host);
  await act(async () => root.render(<ChatPanel {...PROPS} config={config} instructor={false} messages={messages} />));
  const lines = [...host.querySelectorAll('[data-testid="memory-write-line"]')];
  ok(lines.length === 2, "one line per memory write, got " + lines.length);
  const first = lines[0];
  ok(first.textContent.includes("기억에 남겼어요") && first.textContent.includes(item), "lead and quoted item");
  ok(first.querySelector("svg"), "bookmark glyph");
  const undo = first.querySelector(".hps-memory-write-undo");
  ok(undo && undo.textContent === "되돌리기", "undo button text");
  ok(/되돌리기/.test(undo.getAttribute("aria-label") ?? ""), "undo button has an accessible label");
  ok(undo.tagName === "BUTTON", "keyboard reachable: a real button");
  ok(!lines[1].querySelector(".hps-memory-write-undo"), "an undone line has no undo button");
  ok(lines[1].textContent.includes("되돌렸어요"), "undone line says it was undone");
  const expand = first.querySelector(".hps-memory-write-expand");
  ok(expand.getAttribute("aria-expanded") === "false" && !first.querySelector(".hps-memory-write-item-open"), "item starts on one line");
  await act(async () => click(expand));
  ok(first.querySelector(".hps-memory-write-expand").getAttribute("aria-expanded") === "true" && first.querySelector(".hps-memory-write-item-open"), "expands");
  const css = readFileSync("webview-ui/src/styles.css", "utf8");
  ok(/\.hps-memory-write-item \{[^}]*white-space: nowrap/.test(css) && /\.hps-memory-write button:focus-visible/.test(css), "one-line rule and focus ring in css");
  await act(async () => root.unmount());
  console.log("memory-write-line OK");
}
void main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
