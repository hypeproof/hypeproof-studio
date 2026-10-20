// CGP-SHELL-R-013 (REQ-C7 / S-04 extension, REQ-STUDIO-PANEL-BOUNDARY) — a broken panel does not
// take down the chat. The real App, TaskWorkspace and ChatPanel on the minimal DOM
// (fixtures/mini-dom.mjs): a task rail that throws while rendering (a task with an invalid
// updatedAt makes `new Date(NaN).toISOString()` throw a RangeError) shows only its own fallback,
// while the composer keeps its draft and the transcript still renders. 다시 불러오기 remounts only
// that panel; a second throw shows the same fallback without looping; the report goes out once and
// carries no learner text; the top-level boundary still catches a throw in the composer itself.
// Bundled with esbuild and run with plain Node; the banner captures what the webview posts.

import { click, mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { App } from "../webview-ui/src/App";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { ChatErrorBoundary } from "../webview-ui/src/ChatErrorBoundary";
import { TaskWorkspaceFrame } from "../webview-ui/src/TaskWorkspace";
import { PanelBoundary, PANEL_FALLBACK_TEXT, PANEL_RETRY_LABEL, panelErrorReport, resetPanelReports } from "../webview-ui/src/PanelBoundary";
import type { ChatConfig } from "../src/protocol";

const act: (fn: () => unknown) => Promise<void> = (React as unknown as { act: (fn: () => unknown) => Promise<void> }).act;
const posted = (globalThis as unknown as { __posted: Array<{ type: string; message?: string; stack?: string; componentStack?: string }> }).__posted;
let fail = 0;
const tests: [string, () => void | Promise<void>][] = [];
const t = (label: string, fn: () => void | Promise<void>) => tests.push([label, fn]);
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const eq = (a: unknown, b: unknown, m = "") => { if (a !== b) throw new Error(`${m} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
// React logs every caught render error; keep the run readable and count them instead.
const consoleError = console.error;
let loggedErrors = 0;
console.error = (...args: unknown[]) => { loggedErrors++; if (process.env.HPS_TEST_STACK) consoleError(...args); };

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
  taskWorkspace: { scope: "s", revision: 1, activeTaskId: "t1", tasks: [{ id: "t1", title: "작업", createdAt: 1, updatedAt: 1, messageCount: 2 }], sourceSelection: null },
} as unknown as ChatConfig;
const LEARNER_TITLE = "우리 반 고양이 갤러리";
const view = (updatedAt: number) => ({ scope: "s", revision: 1, activeTaskId: "t1", sourceSelection: null,
  tasks: [{ id: "t1", title: LEARNER_TITLE, createdAt: 1, updatedAt, messageCount: 2 }] });
const HISTORY = [
  { id: "u1", role: "user", content: "고양이 사진을 모아 줘", createdAt: 1 },
  { id: "a1", role: "assistant", content: "갤러리를 만들었어요", createdAt: 2 },
];

type El = {
  getAttribute(n: string): string | null; textContent: string; value: string; localName: string;
  findAll(test: (e: El) => boolean): El[]; dispatchEvent(e: unknown): boolean; querySelector(s: string): El | null;
};
const ev = (type: string, extra: Record<string, unknown> = {}) => ({
  type, bubbles: true, cancelable: true, defaultPrevented: false, timeStamp: Date.now(),
  preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra,
});
const reports = () => posted.filter((m) => m.type === "webviewError");
const tick = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

const mounted: Root[] = [];
function mount(node: React.ReactNode) {
  const host = mountPoint() as unknown as El;
  const root = createRoot(host as unknown as HTMLElement);
  mounted.push(root);
  return { host, render: () => act(async () => { root.render(node); }) };
}
function probe(host: El) {
  const textarea = () => host.findAll((e) => e.localName === "textarea")[0];
  return {
    textarea,
    fallback: (panel: string) => host.findAll((e) => e.getAttribute("data-panel-fallback") === panel)[0],
    fallbacks: () => host.findAll((e) => e.getAttribute("data-panel-fallback") !== null),
    retry: (panel: string) => host.findAll((e) => e.getAttribute("data-panel-fallback") === panel)[0]?.findAll((e) => e.localName === "button")[0],
    fatal: () => host.findAll((e) => (e.getAttribute("class") ?? "").split(" ").includes("hps-fatal"))[0],
    taskButtons: () => host.findAll((e) => (e.getAttribute("class") ?? "").split(" ").includes("tw-task")),
    message: (id: string) => host.findAll((e) => (e.getAttribute("class") ?? "").includes("hps-msg") && e.textContent.includes(id))[0],
    type: async (text: string) => { const ta = textarea(); await act(async () => { ta.value = text; ta.dispatchEvent(ev("input")); }); },
    press: async (el: El) => act(async () => { click(el); }),
    text: () => host.textContent,
  };
}
async function hostMsg(data: Record<string, unknown>) {
  await act(async () => {
    const w = (globalThis as unknown as { window: { dispatchEvent(e: unknown): boolean } }).window;
    w.dispatchEvent({ type: "message", bubbles: false, data });
  });
}
async function personalApp() {
  const m = mount(<App />);
  await m.render();
  await hostMsg({ type: "config", config: personal });
  await hostMsg({ type: "history", messages: HISTORY, activityId: "p1", taskId: "t1" });
  await hostMsg({ type: "taskWorkspaceState", view: view(5), activityId: "p1", taskId: "t1" });
  return { ...probe(m.host), host: m.host };
}

let throwing = 0;
let throwRenders = 0;
function Thrower({ always = false, text = "" }: { always?: boolean; text?: string }) {
  throwRenders++;
  if (always || throwing > 0) { if (!always) throwing--; throw new Error(`render failed for ${text}`); }
  return <p data-testid="thrower-ok">패널 내용</p>;
}

t("personal: a throwing task rail shows only its fallback; the draft and the transcript stay", async () => {
  resetPanelReports(); posted.length = 0;
  const h = await personalApp();
  eq(h.fallbacks().length, 0, "no fallback while the rail renders (negative control)");
  eq(h.taskButtons().length, 1, "the rail lists the task (positive control)");
  await h.type("고양이 그려 줘");
  const textarea = h.textarea();
  const userRow = h.message("고양이 사진을 모아 줘");
  ok(userRow, "transcript renders");
  await hostMsg({ type: "taskWorkspaceState", view: view(Number.NaN), activityId: "p1", taskId: "t1" });
  ok(h.fallback("task-rail"), "the task rail shows its fallback");
  eq(h.fatal(), undefined, "the whole-panel fatal screen did not take over");
  eq(h.fallbacks().length, 1, "only the failed panel");
  ok(h.fallback("task-rail").textContent.includes(PANEL_FALLBACK_TEXT), "calm sentence");
  eq(h.retry("task-rail").textContent.trim(), PANEL_RETRY_LABEL, "one 다시 불러오기 action");
  eq(h.retry("task-rail").getAttribute("type"), "button", "a real button");
  eq(h.fallback("task-rail").getAttribute("role"), "status", "announced politely, not as an alert");
  eq(h.textarea(), textarea, "the composer was not remounted");
  eq(h.textarea().value, "고양이 그려 줘", "the draft is kept");
  eq(h.message("고양이 사진을 모아 줘"), userRow, "the transcript row was not remounted");
  ok(h.text().includes("갤러리를 만들었어요"), "the answer still renders");
  ok(h.text().includes("새 작업"), "the rest of the rail (새 작업) still renders");
  ok(!/RangeError|Invalid time value/.test(h.fallback("task-rail").textContent), "no error text shown to the learner");
  eq(reports().length, 1, "reported once");
  const r = reports()[0];
  ok(/task-rail/.test(r.message ?? ""), "the report names the panel");
  ok(!JSON.stringify(r).includes(LEARNER_TITLE) && !JSON.stringify(r).includes("고양이"), "no learner text in the report");
});

t("personal: 다시 불러오기 remounts only the task rail; the draft and the transcript stay", async () => {
  resetPanelReports(); posted.length = 0;
  const h = await personalApp();
  await h.type("고양이 그려 줘");
  const textarea = h.textarea();
  const userRow = h.message("고양이 사진을 모아 줘");
  await hostMsg({ type: "taskWorkspaceState", view: view(Number.NaN), activityId: "p1", taskId: "t1" });
  ok(h.fallback("task-rail"), "failed");
  await hostMsg({ type: "taskWorkspaceState", view: view(7), activityId: "p1", taskId: "t1" });
  ok(h.fallback("task-rail"), "a good update alone does not silently swap the fallback (only the learner's press does)");
  await h.press(h.retry("task-rail"));
  eq(h.fallback("task-rail"), undefined, "the fallback is gone");
  eq(h.taskButtons().length, 1, "the rail renders the task again");
  eq(h.textarea(), textarea, "the composer node is the same one");
  eq(h.textarea().value, "고양이 그려 줘", "the draft is kept");
  eq(h.message("고양이 사진을 모아 줘"), userRow, "the transcript row node is the same one");
  eq(h.fatal(), undefined, "no fatal screen");
});

t("personal: a second throw after 다시 불러오기 shows the same fallback, once, with no loop", async () => {
  resetPanelReports(); posted.length = 0;
  const h = await personalApp();
  await h.type("고양이 그려 줘");
  await hostMsg({ type: "taskWorkspaceState", view: view(Number.NaN), activityId: "p1", taskId: "t1" });
  await h.press(h.retry("task-rail"));
  ok(h.fallback("task-rail"), "still broken: the same fallback");
  eq(h.fallbacks().length, 1, "one fallback");
  eq(h.fatal(), undefined, "the second throw did not escalate to the fatal screen");
  eq(h.textarea().value, "고양이 그려 줘", "the draft is kept");
  eq(reports().length, 1, "still reported only once");
  const doc = (globalThis as unknown as { document: { activeElement: unknown } }).document;
  eq(doc.activeElement, h.retry("task-rail"), "focus stays on 다시 불러오기");
});

t("no loop: a panel that always throws renders a bounded number of times and stays put", async () => {
  resetPanelReports(); posted.length = 0;
  const m = mount(<div><PanelBoundary panel="lesson"><Thrower always text="학생 비밀 메모" /></PanelBoundary><textarea defaultValue="초안" /></div>);
  throwRenders = 0;
  await m.render();
  const h = probe(m.host);
  ok(h.fallback("lesson"), "fallback");
  const first = throwRenders;
  // React's dev build replays a failed render (and double-invokes it): at most four calls.
  ok(first >= 1 && first <= 4, `rendered ${first} times on mount`);
  await tick(60);
  eq(throwRenders, first, "nothing re-renders on its own");
  await h.press(h.retry("lesson"));
  await tick(60);
  ok(throwRenders - first >= 1 && throwRenders - first <= 4, `one retry is one render plus React's replays, got ${throwRenders - first}`);
  const after = throwRenders;
  await tick(60);
  eq(throwRenders, after, "still settled after the retry");
  ok(h.fallback("lesson"), "fallback again");
  eq(reports().length, 1, "reported once");
  ok(!JSON.stringify(reports()[0]).includes("학생 비밀 메모"), "the error message (learner text) is not reported");
  eq(reports()[0].stack, "", "no stack is reported");
});

t("report once per panel id; a different panel reports separately", async () => {
  resetPanelReports(); posted.length = 0;
  const m = mount(<div>
    <PanelBoundary panel="page-card"><Thrower always /></PanelBoundary>
    <PanelBoundary panel="page-card"><Thrower always /></PanelBoundary>
    <PanelBoundary panel="turn-review"><Thrower always /></PanelBoundary>
  </div>);
  await m.render();
  eq(probe(m.host).fallbacks().length, 3, "three fallbacks");
  eq(reports().length, 2, "page-card once, turn-review once");
  // The pure report shape (negative controls: a hostile panel id and error name are flattened).
  const err = new Error("고양이 그려 줘"); err.name = "<img src=x>";
  const r = panelErrorReport("Bad Panel!", err);
  eq(r.message, "panel render error: unknown (Error)", "hostile values flattened");
  eq(panelErrorReport("task-rail", new RangeError("x")).message, "panel render error: task-rail (RangeError)", "positive control");
});

t("retry recovers a panel that threw once (positive control), and only that panel remounts", async () => {
  resetPanelReports(); posted.length = 0;
  let siblingMounts = 0;
  function Sibling() { React.useEffect(() => { siblingMounts++; }, []); return <span>옆 패널</span>; }
  throwing = 100; // every render (React's replays included) throws until the panel is fixed
  const m = mount(<div><PanelBoundary panel="evidence"><Thrower /></PanelBoundary><PanelBoundary panel="help-request"><Sibling /></PanelBoundary></div>);
  await m.render();
  const h = probe(m.host);
  ok(h.fallback("evidence"), "failed first");
  throwing = 0;
  await h.press(h.retry("evidence"));
  eq(h.fallback("evidence"), undefined, "recovered");
  ok(m.host.findAll((e) => e.getAttribute("data-testid") === "thrower-ok").length === 1, "panel content back");
  eq(siblingMounts, 1, "the sibling panel was not remounted");
});

t("classroom: a throwing verify panel shows its fallback; the composer keeps its draft", async () => {
  resetPanelReports(); posted.length = 0;
  const props: Record<string, unknown> = {
    messages: HISTORY, streaming: false, streamingId: null, error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false,
    pageNotice: null, aiNotice: null, stopNotice: null, openWorldId: null, publish: null, incomingImage: null,
    onSend: noop, onRetry: noop, onRetryLast: noop, onDismissError: noop, onCancel: noop, onClear: noop,
    onSetToken: noop, onSettings: noop, onRunCode: noop, onNamingRitual: noop, onSaveCoach: noop,
    onReportProblem: noop, onInstallUpdate: noop, onDismissUpdate: noop, onPublish: noop,
    config: classroom, instructor: false,
  };
  const panel = (verifyPanel: React.ReactNode) => <ChatErrorBoundary><ChatPanel {...(props as React.ComponentProps<typeof ChatPanel>)} verifyPanel={verifyPanel} /></ChatErrorBoundary>;
  const host = mountPoint() as unknown as El;
  const root = createRoot(host as unknown as HTMLElement);
  mounted.push(root);
  await act(async () => { root.render(panel(<p>검증 패널</p>)); });
  const h = probe(host);
  eq(h.fallbacks().length, 0, "healthy verify panel: no fallback (negative control)");
  await h.type("발표 준비");
  const textarea = h.textarea();
  await act(async () => { root.render(panel(<Thrower always />)); });
  ok(h.fallback("verify-panel"), "the verify panel shows its fallback");
  eq(h.fatal(), undefined, "no fatal screen");
  eq(h.textarea(), textarea, "the composer was not remounted");
  eq(h.textarea().value, "발표 준비", "the draft is kept");
  ok(h.text().includes("갤러리를 만들었어요"), "the transcript still renders");
});

t("top-level: a throw in the composer itself still reaches ChatErrorBoundary", async () => {
  resetPanelReports(); posted.length = 0;
  function ThrowingComposer(): React.ReactNode { throw new Error("composer broke"); }
  const m = mount(<ChatErrorBoundary><TaskWorkspaceFrame view={view(5) as never} messages={[]} busy={false} error={null} onDismissError={noop}><ThrowingComposer /></TaskWorkspaceFrame></ChatErrorBoundary>);
  await m.render();
  const h = probe(m.host);
  ok(h.fatal(), "the last-resort screen is shown");
  eq(h.fallbacks().length, 0, "no panel boundary swallowed the composer's error");
  ok(reports().some((r) => r.message === "composer broke"), "the existing REQ-C7 report path still fires");
  // Positive control: the same frame with a healthy composer draws no fatal screen.
  const ok2 = mount(<ChatErrorBoundary><TaskWorkspaceFrame view={view(5) as never} messages={[]} busy={false} error={null} onDismissError={noop}><textarea /></TaskWorkspaceFrame></ChatErrorBoundary>);
  await ok2.render();
  eq(probe(ok2.host).fatal(), undefined, "healthy frame: no fatal screen");
});

t("top-level: App's REQ-C7 crash injection still lands on the fatal screen", async () => {
  resetPanelReports(); posted.length = 0;
  const h = await personalApp();
  await hostMsg({ type: "webviewTestCrash" });
  ok(h.fatal(), "fatal screen");
  eq(h.fallbacks().length, 0, "not a panel fallback");
});

t("inventory: every independent panel sits in its own PanelBoundary", () => {
  const src = (f: string) => readFileSync(`webview-ui/src/${f}`, "utf8");
  const want: Record<string, string[]> = {
    "TaskWorkspace.tsx": ["task-rail", "task-sources"],
    "ChatPanel.tsx": ["mission-header", "student-goal", "lesson", "ai-can-do", "instructor-inbox", "help-request", "evidence", "observation", "delegation", "page-card", "verify-panel", "capability-change", "turn-review", "trial-end", "missing-folder", "citations"],
    "App.tsx": ["carryover", "verify", "publish", "evidence-panel", "memory", "skills", "review"],
  };
  for (const [file, ids] of Object.entries(want)) {
    const text = src(file);
    for (const id of ids) ok(text.includes(`<PanelBoundary panel="${id}"`), `${file}: no PanelBoundary for ${id}`);
  }
  // The composer is deliberately outside every panel boundary: the top-level boundary owns it.
  const chat = src("ChatPanel.tsx");
  const footer = chat.indexOf('<footer className="hps-input-area">');
  const textarea = chat.indexOf("<textarea", footer);
  const between = chat.slice(footer, textarea);
  ok(footer > 0 && textarea > footer, "composer found");
  ok((between.match(/<PanelBoundary /g) ?? []).length === (between.match(/<\/PanelBoundary>/g) ?? []).length, "the composer textarea is not inside a PanelBoundary");
});

t("styles: 44px retry target, type-scale tokens, forced-colors boundary", () => {
  const css = readFileSync("webview-ui/src/chatDetails.css", "utf8");
  const rule = (sel: string) => new RegExp(`(?:^|\\n)${sel.replace(/\./g, "\\.")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
  const retry = rule(".hps-panel-fallback-retry");
  ok(/min-height:\s*44px/.test(retry) && /min-width:\s*44px/.test(retry), "44px target");
  ok(/font-size:\s*var\(--hp-text-body\)/.test(retry), "retry label at body size");
  ok(/font-size:\s*var\(--hp-text-body\)/.test(rule(".hps-panel-fallback-text")), "sentence at body size (>=14px)");
  ok(/flex-wrap:\s*wrap/.test(rule(".hps-panel-fallback")), "wraps on a narrow panel");
  ok(/border:\s*1px solid/.test(rule(".hps-panel-fallback")), "a real border that survives forced colors");
  const forced = /@media \(forced-colors: active\) \{([\s\S]*?)\n\}/.exec(css.slice(css.indexOf(".hps-panel-fallback")))?.[1] ?? "";
  ok(/\.hps-panel-fallback\s*\{[^}]*border-color:\s*CanvasText/.test(forced), "forced colors: the panel keeps a CanvasText border");
});

(async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { consoleError(`  FAIL ${label}: ${(e as Error).message}`); if (process.env.HPS_TEST_STACK) consoleError((e as Error).stack); fail++; }
  }
  for (const r of mounted) await act(async () => r.unmount());
  console.log(`(${loggedErrors} React error logs suppressed)`);
  if (fail) { consoleError(`\n${fail} panel-boundary check(s) failed`); process.exit(1); }
  console.log(`\n${tests.length} panel-boundary checks passed`);
  process.exit(0);
})();
