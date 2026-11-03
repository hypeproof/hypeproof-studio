import { staticTokens } from "./lib/expand-design-tokens.mjs";
// CGP-KNOW-R-004 (REQ-STUDIO-ANSWER-TO-WIKI) — "팀 브레인에 정리하기" on one finished answer, webview
// side: where the action renders and what a click hands to App. The real ChatPanel mounts on the
// minimal DOM (fixtures/mini-dom.mjs, loaded first) and the test clicks the real button. The host side
// (proposal, confirm, write) is test/answer-to-wiki.smoke.mjs. Bundled with esbuild, run with Node.

import { click, mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import type { ChatConfig, ChatMessage } from "../src/protocol";

const act: (fn: () => unknown) => Promise<void> = (React as unknown as { act: (fn: () => unknown) => Promise<void> }).act;
let fail = 0;
const tests: [string, () => void | Promise<void>][] = [];
const t = (label: string, fn: () => void | Promise<void>) => tests.push([label, fn]);
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const eq = (a: unknown, b: unknown, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

const LABEL = "팀 브레인에 정리하기";
const noop = () => {};
const UX = {
  coach: { naming_mode: "fixed" as const, fallback_name: "HypeProof", naming_prompt_md: "", personality_prompt_md: "" },
  suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: "" }, roll_input_button: { enabled: false, label: "", probe_md: "" } },
  retry_button: { enabled: false, show_counter: false },
};
const baseProfile = { profile_id: "p", activity_kind: "personal", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX };
const seat = (profile: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  model: "claude-sonnet-5", hasToken: true, proxyUrl: "http://localhost:8787",
  coach: { name: "HypeProof", personality: "", configured: true },
  profile: { ...baseProfile, ...profile },
  activity: { id: "p1", name: "내 작업", kind: "personal", workspace: "/tmp/p", verified: true },
  taskWorkspace: { scope: "s", revision: 1, activeTaskId: "t1", tasks: [{ id: "t1", title: "작업", createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null },
  ...extra,
}) as unknown as ChatConfig;
const brainOn = seat({ learning_wiki: { enabled: true } });
const brainOff = seat({ learning_wiki: { enabled: false } });
const brainAbsent = seat({});
const lesson = seat({ learning_wiki: { enabled: true }, lesson: { version: 1, content: { steps: [] } } });
const classroom = seat({ learning_wiki: { enabled: true }, activity_kind: "classroom" }, { taskWorkspace: undefined, activity: { id: "a1", name: "수업", kind: "classroom", workspace: "/tmp/w", verified: true } });

const u = (id: string, content: string): ChatMessage => ({ id, role: "user", content, createdAt: 1 });
const a = (id: string, content: string): ChatMessage => ({ id, role: "assistant", content, createdAt: 1 });
const tool = (id: string): ChatMessage => ({ id, role: "tool", content: "", createdAt: 1, tool: { icon: "🔧", label: "Write(index.html)", state: "done" } });
const plain = [u("u1", "첫 질문"), a("a1", "첫 답"), u("u2", "고양이 그려 줘"), a("a2", "만들게요"), tool("t2"), a("a2#2", "고양이 답")];

type El = { getAttribute(n: string): string | null; textContent: string; localName: string; findAll(test: (e: El) => boolean): El[] };
const mounted: Root[] = [];
async function harness(config: ChatConfig, extra: Record<string, unknown> = {}) {
  const asked: string[] = [];
  const host = mountPoint() as unknown as El;
  const root = createRoot(host as unknown as HTMLElement);
  mounted.push(root);
  const props: Record<string, unknown> = {
    messages: plain, streaming: false, streamingId: null, error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false,
    pageNotice: null, aiNotice: null, stopNotice: null, openWorldId: null, publish: null, incomingImage: null,
    onSend: noop, onRetry: noop, onRetryLast: noop, onDismissError: noop, onCancel: noop, onClear: noop,
    onSetToken: noop, onSettings: noop, onRunCode: noop, onNamingRitual: noop, onSaveCoach: noop,
    onReportProblem: noop, onInstallUpdate: noop, onDismissUpdate: noop, onPublish: noop, onVerdict: noop,
    onAnswerToWiki: (messageId: string) => { asked.push(messageId); },
    config, instructor: false, ...extra,
  };
  await act(async () => { root.render(<ChatPanel {...(props as React.ComponentProps<typeof ChatPanel>)} />); });
  const actions = () => host.findAll((e) => e.localName === "button" && e.getAttribute("aria-label") === LABEL);
  return { host, asked, actions, press: (el: El) => act(async () => { click(el); }) };
}
/** The text of the message bubble a button sits under: the nearest .hps-msg ancestor's body. */
const bubbleOf = (el: El) => {
  let n = el as unknown as { parentNode: unknown; getAttribute?(k: string): string | null; textContent: string } | null;
  while (n && !(n.getAttribute?.("class") ?? "").split(/\s+/).includes("hps-msg")) n = n.parentNode as typeof n;
  return n?.textContent ?? "";
};

t("one action per finished answer, on its last bubble; a confirmed inline review hands that answer's id to App (positive control)", async () => {
  const h = await harness(brainOn);
  const buttons = h.actions();
  eq(buttons.length, 2, "actions");
  ok(bubbleOf(buttons[0]).includes("첫 답") && !bubbleOf(buttons[0]).includes("고양이"), "first action is not under the first answer");
  ok(bubbleOf(buttons[1]).includes("고양이 답") && !bubbleOf(buttons[1]).includes("만들게요"), "second action is not under the split answer's last bubble");
  await h.press(buttons[1]);
  eq(h.asked, [], "opening review never posts");
  const proceed = () => h.host.findAll(e => e.localName === "button" && e.textContent === "정리할 내용 미리보기");
  await h.press(proceed()[0]);
  eq(h.asked, ["a2#2"], "confirmed payload");
  await h.press(buttons[0]);
  await h.press(proceed()[0]);
  eq(h.asked, ["a2#2", "a1"], "second confirmed payload");
});

t("placed in the existing answer action row, with the copy and verdict actions, as a 44px ghost action", async () => {
  const h = await harness(brainOn);
  const button = h.actions()[0];
  const cls = (button.getAttribute("class") ?? "").split(/\s+/);
  ok(cls.includes("hps-answer-action") && cls.includes("hps-answer-wiki"), `class ${button.getAttribute("class")}`);
  eq(button.getAttribute("type"), "button", "type");
  const row = (button as unknown as { parentNode: El }).parentNode;
  ok((row.getAttribute("class") ?? "").split(/\s+/).includes("hps-answer-actions"), "not in the answer action row");
  ok(row.textContent.includes("복사") && row.textContent.includes("맞아요"), "copy and verdict are not in the same row");
  const css = designValues(readFileSync("webview-ui/src/chatDetails.css", "utf8"));
  const rule = /\.hps-shell\[data-chat-detail="personal"\] \.hps-answer-actions \.hps-answer-action \{([^}]*)\}/.exec(css)?.[1] ?? "";
  ok(/min-height:\s*44px/.test(rule) && /min-width:\s*44px/.test(rule), "the shared action rule lost its 44px target");
});

t("the answer that is still streaming gets no action; earlier answers keep theirs", async () => {
  const live = [...plain, u("u3", "하나 더"), a("a3", "쓰는 중")];
  const h = await harness(brainOn, { messages: live, streaming: true, streamingId: "a3" });
  eq(h.actions().length, 2, "actions while streaming");
  ok(h.actions().every((b) => !bubbleOf(b).includes("쓰는 중")), "action under the live answer");
  const done = await harness(brainOn, { messages: live });
  eq(done.actions().length, 3, "control: once finished, it gets one");
});

t("no action where team brain is off or absent, in a lesson, a classroom seat, instructor mode, or without the handler (negative controls)", async () => {
  eq((await harness(brainOff)).actions().length, 0, "learning_wiki off");
  eq((await harness(brainAbsent)).actions().length, 0, "learning_wiki absent");
  eq((await harness(lesson)).actions().length, 0, "lesson");
  eq((await harness(classroom)).actions().length, 0, "classroom");
  eq((await harness(brainOn, { instructor: true })).actions().length, 0, "instructor");
  eq((await harness(brainOn, { onAnswerToWiki: undefined })).actions().length, 0, "no handler");
  eq((await harness(brainOn)).actions().length, 2, "control: on");
});

t("Korean copy, no capability or score labels", async () => {
  const h = await harness(brainOn);
  const b = h.actions()[0];
  const text = `${b.textContent} ${b.getAttribute("aria-label") ?? ""} ${b.getAttribute("data-hp-tooltip") ?? ""}`;
  ok(/[가-힣]/.test(text), "not Korean");
  ok(!/FRAMING|JUDGMENT|ORCHESTRATE|VERIFY|ADAPT|OWNERSHIP|점수|역량|등급/.test(text), `capability label in: ${text}`);
});

t("App posts the click to the host as answerToWiki with the message id only", () => {
  const app = readFileSync("webview-ui/src/App.tsx", "utf8");
  ok(/onAnswerToWiki=\{\(messageId\) => postToHost\(\{ type: "answerToWiki", messageId \}\)\}/.test(app), "App wiring");
});

(async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; }
  }
  for (const r of mounted) await act(async () => r.unmount());
  if (fail) { console.error(`\n${fail} answer-to-wiki check(s) failed`); process.exit(1); }
  console.log(`\n${tests.length} answer-to-wiki checks passed`);
  process.exit(0);
})();

function designValues(css: string): string { return staticTokens(readFileSync("webview-ui/src/designTokens.css", "utf8"))(css); }
