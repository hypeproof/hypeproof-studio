// REQ-STUDIO-TASK-RUN-STATE (AE-03, CGP-AGENT-R-022 recast) — the personal task rail draws the active
// task's run state in words plus a symbol, and the App reducer records how this view's last turn ended.
// Bundled with esbuild and run with plain Node, like answer-verdict.test.tsx.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TaskWorkspace } from "../webview-ui/src/TaskWorkspace";
import { chatPanelReducer, chatPanelInitialState } from "../webview-ui/src/App";
import { TASK_RUN_STATE_LABELS, deriveTaskRunState, type TaskRunState } from "../src/taskRunState";
import type { TaskWorkspaceView } from "../src/taskWorkspaceContract";

(globalThis as unknown as Record<string, unknown>).window = { acquireVsCodeApi: undefined, innerWidth: 1280, addEventListener() {}, removeEventListener() {} };
// SSR cannot run layout effects; that React warning is not what this test measures.
const consoleError = console.error;
console.error = (...args: unknown[]) => { if (typeof args[0] === "string" && args[0].startsWith("Warning: useLayoutEffect does nothing on the server")) return; consoleError(...args); };
let fail = 0;
const t = (label: string, fn: () => void) => { try { fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; } };
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };

const view: TaskWorkspaceView = {
  scope: "s", revision: 1, activeTaskId: "t1", sourceSelection: null,
  tasks: [
    { id: "t1", title: "고양이 페이지", createdAt: 1, updatedAt: 1_700_000_000_000, messageCount: 4 },
    { id: "t2", title: "강아지 페이지", createdAt: 1, updatedAt: 1_700_000_000_000, messageCount: 2 },
  ],
};
const render = (runState: TaskRunState | null, busy = false) =>
  renderToStaticMarkup(<TaskWorkspace view={view} messages={[]} busy={busy} error={null} runState={runState} onDismissError={() => {}}><div /></TaskWorkspace>);
const taskButton = (html: string, id: string) => {
  const meta = html.indexOf(`id="tw-task-meta-${id}"`);
  const start = html.lastIndexOf("<button", meta);
  return html.slice(start, html.indexOf("</button>", meta));
};
const ALL: TaskRunState[] = ["preparing", "running", "approval", "stopped", "error", "done"];

t("each state: words and a symbol on the active task, accessible name 'title, state' (positive controls)", () => {
  for (const state of ALL) {
    const html = render(state, state === "running" || state === "approval" || state === "preparing");
    const active = taskButton(html, "t1");
    const { label, icon } = TASK_RUN_STATE_LABELS[state];
    ok(active.includes(`aria-label="고양이 페이지, ${label}"`), `${state}: accessible name missing`);
    ok(active.includes(`aria-describedby="tw-task-meta-t1"`), `${state}: count/date not described`);
    ok(active.includes(`data-run-state="${state}"`), `${state}: state element missing`);
    // REQ-STUDIO-STROKE-ICONS: the symbol is a hidden stroke icon, then the visible words.
    ok(new RegExp(`<span class="tw-task-state-symbol"><svg [^>]*data-icon="${icon}"[^>]*aria-hidden="true">(?:(?!</svg>)[\\s\\S])*</svg></span>${label}</span>`).test(active), `${state}: icon + visible words missing`);
  }
});
t("no colour-only state: every state element carries its words as text", () => {
  for (const state of ALL) {
    const html = render(state);
    const at = html.indexOf(`data-run-state="${state}"`);
    const element = html.slice(at, html.indexOf("</span></span>", at));
    ok(element.includes(TASK_RUN_STATE_LABELS[state].label), `${state}: text missing from its element`);
  }
});
t("inactive tasks show no state and keep their plain accessible name (negative control)", () => {
  for (const state of ALL) {
    const other = taskButton(render(state), "t2");
    ok(!other.includes("data-run-state") && !other.includes("aria-label=") && !other.includes("aria-describedby"), `${state}: leaked onto the inactive task`);
  }
});
t("no evidence → no state anywhere (negative control)", () => {
  const html = render(null);
  ok(!html.includes("data-run-state") && !html.includes("aria-describedby=\"tw-task-meta"), "a state drawn without evidence");
});
t("busy line: approval says 승인 기다리는 중, otherwise the existing 작업 중 copy", () => {
  const waiting = render("approval", true);
  ok(waiting.includes("승인 기다리는 중<span class=\"tw-run-help\">입니다. 화면에 뜬 확인 창에서 골라 주세요.</span>"), "approval busy line missing");
  const running = render("running", true);
  ok(running.includes("작업 중<span class=\"tw-run-help\">입니다. 멈춘 뒤 다른 작업으로 이동할 수 있습니다.</span>"), "existing busy line changed");
  ok(!render("done", false).includes("tw-run-help"), "busy line shown while idle");
});
t("task switching stays blocked during a run, exactly as before", () => {
  const html = render("approval", true);
  ok(taskButton(html, "t2").includes("disabled"), "switching became possible during a run");
  ok(!taskButton(render("done", false), "t2").includes("disabled"), "switching blocked while idle");
});

// The reducer half: how this view's last turn ended.
type S = typeof chatPanelInitialState;
const run = (actions: Parameters<typeof chatPanelReducer>[1][]) => actions.reduce((s: S, a) => chatPanelReducer(s, a), chatPanelInitialState);
const outcome = (s: S) => deriveTaskRunState({ preparing: false, running: !!s.streamId, approvalPending: false, lastOutcome: s.lastOutcome });
const start = { type: "streamStart" as const, streamId: "s1", messageId: "m1" };
t("reducer: completed → 끝남, stopped → 멈춤, error → 오류, failed result → 오류", () => {
  ok(outcome(run([start, { type: "streamEnd" }])) === "done", "completed");
  ok(outcome(run([start, { type: "streamStopped" }])) === "stopped", "stopped");
  ok(outcome(run([start, { type: "streamStopped", by: "instructor" }])) === "stopped", "instructor stop");
  ok(outcome(run([start, { type: "streamError", error: "x" }])) === "error", "error");
  ok(outcome(run([start, { type: "streamEnd", failed: true }])) === "error", "failed result shown as 끝남");
});
t("reducer: a live turn and a new send clear the old outcome; dismissing the error keeps 오류 (negative controls)", () => {
  ok(outcome(run([start, { type: "streamError", error: "x" }, start])) === "running", "old error during a new run");
  ok(run([start, { type: "streamStopped" }, { type: "userSent", text: "다시" }]).lastOutcome === null, "old stop after a new send");
  ok(outcome(run([start, { type: "streamError", error: "x" }, { type: "streamEnd", dismissed: true }])) === "error", "dismissing the banner turned 오류 into 끝남");
  ok(outcome(chatPanelInitialState) === null, "fresh view guessed an outcome");
});

if (fail) { console.error(`task-run-state render: ${fail} failed`); process.exit(1); }
console.log("task-run-state render: all passed");
