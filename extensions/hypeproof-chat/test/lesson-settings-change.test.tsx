// CGP-SHELL-R-024 / CGP-SHELL-D-023 — the real ChatPanel draws the instructor's settings change as a system line in the
// chat stream: placed among the messages before the next turn, Panel background and no speaker, announced once by
// role="status" while unseen, never a dialog, and it reports itself seen only while the panel is visible.
// Bundled with esbuild and run with plain Node on fixtures/mini-dom.mjs (scripts/run-tsx-tests.mjs, BANNER_POSTED).
// It reads only the panel's markup and posted messages, so it fails on a build that does not draw the line.
import { mountPoint, document as doc } from "./fixtures/mini-dom.mjs";
import React from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
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
const TEXT = "선생님이 도움 방식을 바꿨어요: 승인 방식 중요한 것만 묻기 → 바꾸기 전에 묻기 · 시작 문장 바뀜";
const line = (seen: boolean, afterMessageId: string | null = "a1") => ({
  id: "lsc-1", text: TEXT, afterMessageId, task: null, seen,
  items: [{ key: "approval_preset", label: "승인 방식", before: "중요한 것만 묻기", after: "바꾸기 전에 묻기" }, { key: "starters", label: "시작 문장" }],
});
const config = (lines: unknown[]) => ({
  model: "claude-sonnet-5", hasToken: true, proxyUrl: "http://localhost:8787",
  coach: { name: "HypeProof", personality: "", configured: true },
  profile: { profile_id: "kids-class", activity_kind: "classroom", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX },
  lessonSettingsChanges: lines,
}) as unknown as ChatConfig;
const messages: ChatMessage[] = [
  { id: "u1", role: "user", content: "고양이 그려 줘", createdAt: 1 },
  { id: "a1", role: "assistant", content: "그렸어요.", createdAt: 2 },
  { id: "u2", role: "user", content: "색을 바꿔 줘", createdAt: 3 },
];
type El = { getAttribute(n: string): string | null; findAll(t: (e: El) => boolean): El[]; textContent: string; localName: string };
const posted = () => (globalThis as unknown as { __posted: Array<{ type: string; id?: string }> }).__posted;
const seenPosts = () => posted().filter((m) => m.type === "lessonSettingsChangeSeen");
const lines = (host: El) => host.findAll((e) => e.getAttribute("data-testid") === "lesson-settings-change");

for (const name of ["Node", "Element", "HTMLElement"]) (globalThis as any)[name] ??= (globalThis.window as any).Element;
async function main() {
  // 1. Unseen: one system line, in the stream after a1 and before the next turn (u2), announced once.
  let host = mountPoint() as unknown as El, root = createRoot(host as unknown as HTMLElement);
  await act(async () => root.render(<ChatPanel {...PROPS} config={config([line(false)])} instructor={false} messages={messages} />));
  const found = lines(host);
  ok(found.length === 1, `one line, got ${found.length}`);
  const el = found[0];
  ok(el.textContent === TEXT, `text: ${el.textContent}`);
  ok(el.getAttribute("role") === "status", "announced by role=status");
  const statuses = host.findAll((e) => e.getAttribute("role") === "status" && e.textContent.includes("도움 방식을 바꿨어요"));
  ok(statuses.length === 1, `announced once (one live region holds it), got ${statuses.length}`);
  const order = host.findAll((e) => e.getAttribute("data-testid") === "lesson-settings-change" || e.getAttribute("data-message-id") !== null)
    .map((e) => e.getAttribute("data-message-id") ?? "LINE");
  ok(JSON.stringify(order) === JSON.stringify(["u1", "a1", "LINE", "u2"]), `placed after a1, before the next turn: ${order.join(",")}`);
  const cls = (e: El) => e.getAttribute("class") ?? "";
  ok(cls(el).includes("hps-lesson-change") && !cls(el).includes("hps-msg"), "system style, not a message bubble");
  ok(el.findAll((e) => /hps-msg|speaker|avatar/.test(cls(e))).length === 0, "no avatar or speaker name");
  ok(el.findAll((e) => e.localName === "button").length === 0, "no control on the line");
  ok(host.findAll((e) => e.getAttribute("role") === "dialog" || e.getAttribute("aria-modal") === "true" || e.localName === "dialog").length === 0, "not a modal");
  ok(seenPosts().length === 1 && seenPosts()[0].id === "lsc-1", `reports seen once while visible: ${JSON.stringify(seenPosts())}`);
  await act(async () => root.render(<ChatPanel {...PROPS} config={config([line(false)])} instructor={false} messages={messages} />));
  ok(seenPosts().length === 1, "a re-render does not report again");
  await act(async () => root.unmount());

  // 2. Seen: the same line is drawn without a live region (a remount does not read it out again) and reports nothing.
  posted().length = 0;
  host = mountPoint() as unknown as El; root = createRoot(host as unknown as HTMLElement);
  await act(async () => root.render(<ChatPanel {...PROPS} config={config([line(true)])} instructor={false} messages={messages} />));
  ok(lines(host).length === 1 && lines(host)[0].getAttribute("role") === null, "seen: drawn, no role=status");
  ok(seenPosts().length === 0, "seen: no report");
  await act(async () => root.unmount());

  // 3. A hidden panel does not count as seen until it is shown.
  posted().length = 0;
  const d = doc as unknown as { visibilityState: string; hidden: boolean; dispatchEvent(e: object): void };
  d.visibilityState = "hidden"; d.hidden = true;
  host = mountPoint() as unknown as El; root = createRoot(host as unknown as HTMLElement);
  await act(async () => root.render(<ChatPanel {...PROPS} config={config([line(false, null)])} instructor={false} messages={[]} />));
  ok(lines(host).length === 1, "an empty conversation still draws the line");
  ok(seenPosts().length === 0, "hidden: not reported");
  d.visibilityState = "visible"; d.hidden = false;
  await act(async () => d.dispatchEvent({ type: "visibilitychange", bubbles: false, preventDefault() {}, stopPropagation() {} }));
  ok(seenPosts().length === 1, `shown: reported once, got ${seenPosts().length}`);
  await act(async () => root.unmount());

  // 4. The instructor console never draws it.
  host = mountPoint() as unknown as El; root = createRoot(host as unknown as HTMLElement);
  await act(async () => root.render(<ChatPanel {...PROPS} config={config([line(false)])} instructor={true} messages={messages} />));
  ok(lines(host).length === 0, "instructor: no line");
  await act(async () => root.unmount());

  // 5. DES-SHELL-23 style: Panel background token, caption step, tokens only, logical properties.
  const css = readFileSync("webview-ui/src/lessonSettingsChange.css", "utf8");
  ok(/\.hps-lesson-change \{[^}]*background: var\(--hp-bg-panel-default\)/.test(css), "Panel background");
  ok(/\.hps-lesson-change \{[^}]*font-size: var\(--hp-font-caption\)/.test(css), "14px caption step");
  ok(!/#[0-9a-fA-F]{3,6}\b|\b\d+px\b/.test(css), "tokens only");
  console.log("lesson-settings-change OK");
}
void main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
