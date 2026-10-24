import { staticTokens } from "./lib/expand-design-tokens.mjs";
// REQ-STUDIO-MISSING-TASK-FOLDER (CGP-AGENT-R-028, DES-CGP-AGENT-57) — the webview side: the real
// ChatPanel on the minimal DOM (fixtures/mini-dom.mjs) receives the host's notice, shows one sentence
// and two recovery actions, holds the read-only draft, and drops the notice when the host
// says the folder is back. The host side (hold, rebind, consent) is test/missing-task-folder.smoke.mjs.
// Bundled with esbuild and run with plain Node; the banner captures what the panel posts to the host.

import { click, mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { missingTaskFolderNotice, MISSING_TASK_FOLDER_ACTION, MISSING_TASK_FOLDER_COPY, MISSING_TASK_FOLDER_NOT_A_FOLDER } from "../src/missingTaskFolder";
import type { ChatConfig } from "../src/protocol";

const act: (fn: () => unknown) => Promise<void> = (React as unknown as { act: (fn: () => unknown) => Promise<void> }).act;
const posted = (globalThis as unknown as { __posted: Array<{ type: string }> }).__posted;
let fail = 0;
const tests: [string, () => void | Promise<void>][] = [];
const t = (label: string, fn: () => void | Promise<void>) => tests.push([label, fn]);
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const eq = (a: unknown, b: unknown, m = "") => { if (a !== b) throw new Error(`${m} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

const noop = () => {};
const UX = {
  coach: { naming_mode: "fixed" as const, fallback_name: "HypeProof", naming_prompt_md: "", personality_prompt_md: "" },
  suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: "" }, roll_input_button: { enabled: false, label: "", probe_md: "" } },
  retry_button: { enabled: false, show_counter: false },
};
const classroom = {
  model: "claude-sonnet-5", hasToken: true, proxyUrl: "http://localhost:8787",
  coach: { name: "HypeProof", personality: "", configured: true },
  profile: { profile_id: "class-a", activity_kind: "classroom", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX },
  activity: { id: "a1", name: "수업", kind: "classroom", workspace: "/tmp/w", verified: true },
} as unknown as ChatConfig;
const personal = {
  ...classroom, profile: { ...(classroom as unknown as { profile: object }).profile, activity_kind: "personal" },
  activity: { id: "p1", name: "내 작업", kind: "personal", workspace: "/tmp/p", verified: true },
  taskWorkspace: { scope: "s", revision: 1, activeTaskId: "t1", tasks: [{ id: "t1", title: "작업", createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null },
} as unknown as ChatConfig;

type El = {
  getAttribute(n: string): string | null; textContent: string; value: string; localName: string;
  findAll(test: (e: El) => boolean): El[]; dispatchEvent(e: unknown): boolean;
};
const ev = (type: string, extra: Record<string, unknown> = {}) => ({
  type, bubbles: true, cancelable: true, defaultPrevented: false, timeStamp: Date.now(),
  preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra,
});

const mounted: Root[] = [];
async function harness(config: ChatConfig) {
  const sent: string[] = [];
  const host = mountPoint() as unknown as El;
  const root = createRoot(host as unknown as HTMLElement);
  mounted.push(root);
  const props: Record<string, unknown> = {
    messages: [], streaming: false, streamingId: null, error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false,
    pageNotice: null, aiNotice: null, stopNotice: null, openWorldId: null, publish: null, incomingImage: null,
    onSend: (text: string) => { sent.push(text); }, onRetry: noop, onRetryLast: noop, onDismissError: noop, onCancel: noop, onClear: noop,
    onSetToken: noop, onSettings: noop, onRunCode: noop, onNamingRitual: noop, onSaveCoach: noop,
    onReportProblem: noop, onInstallUpdate: noop, onDismissUpdate: noop, onPublish: noop,
    config, instructor: false,
  };
  await act(async () => { root.render(<ChatPanel {...(props as React.ComponentProps<typeof ChatPanel>)} />); });
  const textarea = () => host.findAll((e) => e.localName === "textarea")[0];
  return {
    sent,
    notice: () => host.findAll((e) => e.getAttribute("data-testid") === "missing-task-folder")[0],
    action: () => host.findAll((e) => e.localName === "button" && e.textContent.trim() === MISSING_TASK_FOLDER_ACTION),
    type: async (text: string) => { const ta = textarea(); await act(async () => { ta.value = text; ta.dispatchEvent(ev("input")); }); },
    enter: async () => act(async () => { textarea().dispatchEvent(ev("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, shiftKey: false, isComposing: false })); }),
    draft: () => textarea().value,
    readonly: () => textarea().hasAttribute("readonly"),
    recheck: () => host.findAll(e => e.localName === "button" && e.textContent.trim() === "다시 확인")[0],
    press: async (el: El) => act(async () => { click(el); }),
    hostMsg: async (data: Record<string, unknown>) => act(async () => {
      const w = (globalThis as unknown as { window: { dispatchEvent(e: unknown): boolean } }).window;
      const cfg = config as unknown as { activity?: { id: string }; taskWorkspace?: { activeTaskId: string } };
      w.dispatchEvent({ type: "message", bubbles: false, data: { type: "config", config: { activity: cfg.activity, taskWorkspace: cfg.taskWorkspace } } });
      w.dispatchEvent({ type: "message", bubbles: false, data: { activityId: cfg.activity?.id, taskId: cfg.taskWorkspace?.activeTaskId, ...data } });
    }),
    text: () => (host as unknown as { textContent: string }).textContent,
  };
}

t("personal: the panel asks the host on mount", async () => {
  posted.length = 0;
  await harness(personal);
  ok(posted.some((m) => m.type === "missingTaskFolderRequest"), "missingTaskFolderRequest posted");
});

t("personal: recovery actions replace editing while the draft remains read-only", async () => {
  const h = await harness(personal);
  eq(h.notice(), undefined, "no notice before the host says so (negative control)");
  await h.type("고양이 그려 줘");
  await h.hostMsg({ type: "missingTaskFolder", notice: missingTaskFolderNotice("/gone") });
  ok(h.notice(), "notice drawn");
  ok(h.text().includes(MISSING_TASK_FOLDER_COPY), "the sentence");
  eq(h.action().length, 1, "exactly one action");
  eq(h.action()[0].getAttribute("type"), "button", "a real button");
  ok((h.action()[0].getAttribute("class") ?? "").includes("hps-missing-folder-action"), "44px class");
  eq(h.notice().getAttribute("role"), "status", "announced politely");
  ok(h.readonly(), "draft is read-only");
  ok(h.recheck(), "second action rechecks the folder");
  posted.length = 0;
  await h.enter();
  eq(h.sent.length, 0, "the send is held");
  eq(h.draft(), "고양이 그려 줘", "the draft stays");
  await h.press(h.recheck());
  ok(posted.some((m) => m.type === "missingTaskFolderRequest"), "recheck asks the host without sending");
  // Still missing: the notice stays and nothing goes out.
  await h.hostMsg({ type: "missingTaskFolder", notice: missingTaskFolderNotice("/gone") });
  eq(h.sent.length, 0, "still held");
  posted.length = 0;
  await h.press(h.action()[0]);
  ok(posted.some((m) => m.type === "missingTaskFolderRepick"), "다시 고르기 asks the host to run the picker");
  eq(h.sent.length, 0, "다시 고르기 never sends");
  // A pick that did not move the task: one extra line, still one action.
  await h.hostMsg({ type: "missingTaskFolder", notice: missingTaskFolderNotice("/gone", MISSING_TASK_FOLDER_NOT_A_FOLDER) });
  ok(h.text().includes(MISSING_TASK_FOLDER_NOT_A_FOLDER), "the note");
  eq(h.action().length, 1);
  // The rebind landed: the host clears the notice, the draft is intact, and sending works again (positive control).
  await h.hostMsg({ type: "missingTaskFolder", notice: null });
  eq(h.notice(), undefined, "notice gone");
  eq(h.draft(), "고양이 그려 줘", "the draft survived the whole recovery");
  eq(h.sent.length, 0, "clearing the notice alone sends nothing");
  await h.enter();
  eq(h.sent.length, 1, "sending works again");
  eq(h.sent[0], "고양이 그려 줘");
});

t("personal: recovery preserves the draft and requires a new send", async () => {
  const h = await harness(personal);
  await h.type("다시 보내 줘");
  await h.hostMsg({ type: "missingTaskFolder", notice: missingTaskFolderNotice("/flaky") });
  await h.enter();
  eq(h.sent.length, 0, "held");
  await h.hostMsg({ type: "missingTaskFolder", notice: null });
  eq(h.sent.length, 0, "recovery does not implicitly send");
  eq(h.draft(), "다시 보내 줘");
  await h.enter();
  eq(h.sent[0], "다시 보내 줘");
  await h.hostMsg({ type: "missingTaskFolder", notice: null });
  eq(h.sent.length, 1, "exactly once");
});

t("classroom: no notice and no webview hold (the host keeps the existing refusal)", async () => {
  const h = await harness(classroom);
  await h.hostMsg({ type: "missingTaskFolder", notice: missingTaskFolderNotice("/gone") });
  eq(h.notice(), undefined, "class seats never draw it");
  await h.type("안녕");
  await h.enter();
  eq(h.sent.length, 1, "the send reaches the host, which decides");
});

t("styles: learner text uses the type-scale tokens; the action is a 44px target", () => {
  const css = designValues(readFileSync("webview-ui/src/chatDetails.css", "utf8"));
  const rule = (sel: string) => new RegExp(`\\.hps-shell\\[data-chat-detail="personal"\\] \\.${sel}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
  ok(/font-size:\s*var\(--hp-font-body\)/.test(rule("hps-missing-folder-text")), "sentence at body size");
  ok(/font-size:\s*var\(--hp-font-caption\)/.test(rule("hps-missing-folder-note")), "note at caption size (14px floor)");
  const action = rule("hps-missing-folder-action");
  ok(/min-height:\s*44px/.test(action) && /min-width:\s*44px/.test(action), "44px target");
  ok(/flex-wrap:\s*wrap/.test(rule("hps-missing-folder")), "wraps to one column on a narrow panel");
});

(async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); if (process.env.HPS_TEST_STACK) console.error((e as Error).stack); fail++; }
  }
  for (const r of mounted) await act(async () => r.unmount());
  if (fail) { console.error(`\n${fail} missing-task-folder check(s) failed`); process.exit(1); }
  console.log(`\n${tests.length} missing-task-folder checks passed`);
  process.exit(0);
})();

function designValues(css: string): string { return staticTokens(readFileSync("webview-ui/src/designTokens.css", "utf8"))(css); }
