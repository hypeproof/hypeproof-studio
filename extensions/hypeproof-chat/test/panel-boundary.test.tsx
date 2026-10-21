import { staticTokens } from "./lib/expand-design-tokens.mjs";
// CGP-SHELL-R-013 (REQ-C7 / S-04 extension, REQ-STUDIO-PANEL-BOUNDARY) — a broken panel does not
// take down the chat. The real App, TaskWorkspace and ChatPanel on the minimal DOM
// (fixtures/mini-dom.mjs): a task rail that throws while rendering (a task with an invalid
// updatedAt makes `new Date(NaN).toISOString()` throw a RangeError) shows only its own fallback,
// while the composer keeps its draft and the transcript still renders. 다시 불러오기 remounts only
// that panel; a second throw shows the same fallback without looping; the report goes out once and
// carries no learner text; the top-level boundary still catches a throw in the composer itself.
// Every wrapped panel is also thrown on purpose from inside its own component (the build script
// test/panel-boundary.build.mjs instruments each one) in the real App, data-driven over PANELS:
// only that panel's fallback appears. A panel moved out of its boundary fails that row.
// Bundled by test/panel-boundary.build.mjs and run with plain Node; the banner captures what the
// webview posts.

import { click, mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { App } from "../webview-ui/src/App";
import { ChatErrorBoundary } from "../webview-ui/src/ChatErrorBoundary";
import { TaskWorkspaceFrame } from "../webview-ui/src/TaskWorkspace";
import { PanelBoundary, PANEL_BLOCKED_TEXT, PANEL_FALLBACK_TEXT, PANEL_RETRY_LABEL, panelErrorReport, resetPanelReports } from "../webview-ui/src/PanelBoundary";
import { delegationRowId } from "../src/delegationRow";
import { missingTaskFolderNotice } from "../src/missingTaskFolder";
import { learningState } from "../src/learningStateHelpers";
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
  return <p data-testid="thrower-ok">패널 내용 <button type="button" data-testid="panel-first">자세히</button></p>;
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
  ok(!h.fatal(), "the whole-panel fatal screen did not take over");
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
  ok(!h.fatal(), "no fatal screen");
});

t("personal: a second throw after 다시 불러오기 shows the same fallback, once, with no loop", async () => {
  resetPanelReports(); posted.length = 0;
  const h = await personalApp();
  await h.type("고양이 그려 줘");
  await hostMsg({ type: "taskWorkspaceState", view: view(Number.NaN), activityId: "p1", taskId: "t1" });
  await h.press(h.retry("task-rail"));
  ok(h.fallback("task-rail"), "still broken: the same fallback");
  eq(h.fallbacks().length, 1, "one fallback");
  ok(!h.fatal(), "the second throw did not escalate to the fatal screen");
  eq(h.textarea().value, "고양이 그려 줘", "the draft is kept");
  eq(reports().length, 1, "still reported only once");
  const doc = (globalThis as unknown as { document: { activeElement: unknown } }).document;
  ok(doc.activeElement === h.retry("task-rail"), "focus stays on 다시 불러오기");
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
  const m = mount(<div><button type="button">앞 버튼</button><PanelBoundary panel="evidence"><Thrower /></PanelBoundary><button type="button" data-testid="after">뒤 버튼</button><PanelBoundary panel="help-request"><Sibling /></PanelBoundary></div>);
  await m.render();
  const h = probe(m.host);
  ok(h.fallback("evidence"), "failed first");
  throwing = 0;
  await h.press(h.retry("evidence"));
  eq(h.fallback("evidence"), undefined, "recovered");
  ok(m.host.findAll((e) => e.getAttribute("data-testid") === "thrower-ok").length === 1, "panel content back");
  eq(siblingMounts, 1, "the sibling panel was not remounted");
  const doc = (globalThis as unknown as { document: { activeElement: El } }).document;
  eq(doc.activeElement?.getAttribute("data-testid"), "panel-first", "focus moved to the panel's first focusable element (not <body>, not the next button)");
});

// ─── Every wrapped panel, thrown from inside its own component, in the real App ───────────────
const WEEK = JSON.parse(readFileSync("test/fixtures/session-design/week-3.json", "utf8"));
const classroomApp = {
  proxyUrl: "http://localhost:8787/v1", model: "claude-sonnet-5", hasToken: true,
  coach: { name: "코치", personality: "", configured: true },
  activity: { id: "c1", name: "GlobalBuddy", kind: "classroom", workspace: "/w", verified: true },
  profile: { profile_id: "sx-fixture", display_name: WEEK.title, language: "ko", series_index: 3, series_total: 6,
    welcome: { greeting_md: "오늘 수업", example_prompts: [] }, ux: UX,
    lesson: { course_id: "globalbuddy", version: "m2026.09.20-1", sha256: "f".repeat(64), content: WEEK } },
} as unknown as ChatConfig;
const CITED = [
  { id: "u1", role: "user", content: "자료 찾아 줘", createdAt: 1 },
  { id: "a1", role: "assistant", content: "찾았어요", createdAt: 2, citations: [{ url: "https://example.com/cats", title: "고양이" }] },
];
const DELEGATED = [
  { id: "u1", role: "user", content: "리뷰 부탁해", createdAt: 1 },
  { id: "a1", role: "assistant", content: "맡겨 볼게요", createdAt: 2 },
  { id: delegationRowId("toolu_T", "s0"), role: "tool", content: "", createdAt: 3, tool: { icon: "🤝", label: "코드리뷰어: 살펴봐 줘", state: "done" } },
];
type Row = { panel: string; key: string | null; mode: "personal" | "classroom"; config?: Record<string, unknown>; history?: unknown[]; msgs?: () => Record<string, unknown>[]; blocking?: boolean };
const PANELS: Row[] = [
  { panel: "task-sources", key: "CitationPreview.tsx:CitationPreview", mode: "personal", history: CITED },
  { panel: "citations", key: "CitationPreview.tsx:CitationRack", mode: "personal", history: CITED },
  { panel: "citations", key: "ChatPanel.tsx:CitationRack", mode: "classroom", history: CITED },
  { panel: "page-card", key: "PageCard.tsx:PageCard", mode: "personal", msgs: () => [{ type: "pageCardsState", cards: [{ turnId: "s1", anchorId: "a1", pages: [] }] }] },
  { panel: "delegation", key: "DelegationRow.tsx:DelegationRow", mode: "personal", history: DELEGATED },
  { panel: "turn-review", key: "TurnReviewBar.tsx:TurnReviewBar", mode: "personal", msgs: () => [{ type: "turnReviewState", view: { turnId: "s1" } }] },
  { panel: "missing-folder", key: "MissingFolderNotice.tsx:MissingFolderNotice", mode: "personal", blocking: true, msgs: () => [{ type: "missingTaskFolder", notice: missingTaskFolderNotice("/gone") }] },
  { panel: "preview-recovery", key: "PreviewRecoveryNotice.tsx:PreviewRecoveryNotice", mode: "personal", msgs: () => [{ type: "previewRecovery", signals: { server: "stopped", status: null, path: "/", needsNetwork: false } }] },
  { panel: "long-step", key: "ChatPanel.tsx:LongStepHintLine", mode: "personal", msgs: () => [
    { type: "userSent", text: "빌드해 줘", id: "u9" }, { type: "streamStart", streamId: "s1", messageId: "a9" },
    { type: "toolLog", streamId: "s1", id: "toolu_B", icon: "🔧", label: "Bash(npm run build)", state: "running", step: "명령을 실행하는 중…", since: Date.now() - 25_000 }] },
  { panel: "trial-end", key: "TrialEndCard.tsx:TrialEndCard", mode: "personal", blocking: true, msgs: () => [
    { type: "userSent", text: "더 해 줘", id: "u9" }, { type: "streamStart", streamId: "s1", messageId: "a9" },
    { type: "streamError", streamId: "s1", error: "체험이 끝났어요", trialEndCard: { kind: "ended" } }] },
  { panel: "settings", key: "AccessControl.tsx:AccessControl", mode: "personal" },
  { panel: "ai-can-do", key: "ChatPanel.tsx:AiCanDo", mode: "personal", config: { aiCapabilities: [] } },
  { panel: "capability-change", key: "ChatPanel.tsx:CapabilityChangeCard", mode: "personal", config: { capabilityChange: { id: "c1" } } },
  { panel: "carryover", key: "TrialCarryover.tsx:TrialCarryover", mode: "personal", config: { carryover: {} } },
  { panel: "verify", key: "VerifyPanel.tsx:VerifyPanel", mode: "personal", msgs: () => [{ type: "verifyState", view: {} }] },
  { panel: "publish", key: "PublishPanel.tsx:PublishPanel", mode: "personal", msgs: () => [{ type: "publishState", view: {} }] },
  { panel: "evidence-panel", key: "EvidencePanel.tsx:EvidencePanel", mode: "personal", msgs: () => [{ type: "evidenceState", view: {} }] },
  { panel: "memory", key: "MemoryPanel.tsx:MemoryPanel", mode: "personal", msgs: () => [{ type: "memoryState", view: {} }] },
  { panel: "skills", key: "SkillsPanel.tsx:SkillsPanel", mode: "personal", msgs: () => [{ type: "skillsState", view: {} }] },
  { panel: "review", key: "ReviewPanel.tsx:ReviewPanel", mode: "personal", msgs: () => [{ type: "reviewState", view: { mode: "learner" } }] },
  { panel: "verify", key: "VerifyPanel.tsx:VerifyPanel", mode: "classroom", msgs: () => [{ type: "verifyState", view: {} }] },
  { panel: "mission-header", key: "MissionHeader.tsx:MissionHeader", mode: "classroom" },
  { panel: "student-goal", key: "StudentGoal.tsx:StudentGoal", mode: "classroom" },
  { panel: "lesson", key: "LessonStepPanel.tsx:LessonStepPanel", mode: "classroom" },
  { panel: "instructor-inbox", key: "InstructorInbox.tsx:InstructorInbox", mode: "classroom" },
  { panel: "help-request", key: "HelpRequest.tsx:HelpRequest", mode: "classroom" },
  { panel: "evidence", key: "CompletionGate.tsx:CompletionGate", mode: "classroom", msgs: () => [{ type: "learningState", state: learningState({ task: "t", events: [] }) }] },
  { panel: "observation", key: "NativeObservationPanel.tsx:NativeObservationPanel", mode: "classroom", config: { profile: { ...(classroomApp as unknown as { profile: object }).profile, observation: { format: "hps-observation/1", scope: "s", assess: true, record: true } } } },
];
// EvidenceDrawer sits inside the evidence region beside CompletionGate; it uses a <select>, which
// mini-dom does not model, so it is always stubbed.
const ALL_KEYS = [...new Set(PANELS.map((r) => r.key).filter((k): k is string => !!k)), "EvidenceDrawer.tsx:EvidenceDrawer"];
type G = { __hpsPanelThrow?: string; __hpsStub?: Set<string>; __hpsRendered?: Set<string> };
const g = globalThis as unknown as G;

async function scenario(row: Row) {
  const base = row.mode === "personal" ? personal : classroomApp;
  const config = { ...base, ...(row.config ?? {}) } as ChatConfig;
  const m = mount(<App />);
  await m.render();
  const ctx = row.mode === "personal" ? { activityId: "p1", taskId: "t1" } : {};
  await hostMsg({ type: "config", config });
  await hostMsg({ type: "history", messages: row.history ?? HISTORY, ...ctx });
  if (row.mode === "personal") await hostMsg({ type: "taskWorkspaceState", view: view(5), ...ctx });
  for (const msg of row.msgs?.() ?? []) await hostMsg({ ...ctx, ...msg });
  return { ...probe(m.host), host: m.host };
}

t("table: every instrumented component is in the table, and the table covers every PanelBoundary in the sources", () => {
  const ids = new Set<string>();
  for (const f of ["App.tsx", "ChatPanel.tsx", "TaskWorkspace.tsx"]) for (const [, id] of readFileSync(`webview-ui/src/${f}`, "utf8").matchAll(/<PanelBoundary (?:key=\{.*?\} )?panel="([a-z-]+)"/g)) ids.add(id);
  const tested = new Set([...PANELS.map((r) => r.panel), "task-rail"]);
  for (const id of ids) ok(tested.has(id), `PanelBoundary "${id}" has no rendered row in PANELS`);
  for (const id of tested) ok(ids.has(id), `PANELS row "${id}" has no PanelBoundary in the sources`);
  ok(ids.size >= 25, `found ${ids.size} boundaries`);
});

for (const row of PANELS) {
  t(`rendered: ${row.mode} ${row.panel} (${row.key}) throws inside its own boundary only`, async () => {
    const others = new Set(ALL_KEYS.filter((k) => k !== row.key));
    // Control: the scenario reaches the component, with no fallback and no fatal screen.
    resetPanelReports(); posted.length = 0;
    g.__hpsStub = new Set(ALL_KEYS); g.__hpsRendered = new Set(); g.__hpsPanelThrow = undefined;
    const c = await scenario(row);
    ok(g.__hpsRendered.has(row.key!), `control: the scenario never rendered ${row.key}`);
    eq(c.fallbacks().length, 0, `control: no fallback (got ${c.fallbacks().map((f) => f.getAttribute("data-panel-fallback"))})`);
    ok(!c.fatal(), "control: no fatal screen");
    // The component throws: only its panel falls back; the composer keeps working.
    resetPanelReports(); posted.length = 0;
    g.__hpsStub = others; g.__hpsRendered = new Set(); g.__hpsPanelThrow = row.key!;
    const h = await scenario(row);
    ok(!h.fatal(), `${row.key} escaped to the fatal screen: it is not inside a PanelBoundary`);
    const fb = h.fallbacks();
    ok(fb.length >= 1, "a fallback is shown");
    for (const f of fb) eq(f.getAttribute("data-panel-fallback"), row.panel, "only this panel falls back");
    ok(fb[0].textContent.includes(row.blocking ? PANEL_BLOCKED_TEXT : PANEL_FALLBACK_TEXT), row.blocking ? "a send-holding notice says sending is held" : "calm sentence");
    ok(h.textarea(), "the composer is still there");
    await h.type("계속 쓸 수 있어요");
    eq(h.textarea().value, "계속 쓸 수 있어요", "the composer still takes input");
    eq(reports().filter((r) => /panel render error/.test(r.message ?? "")).length, 1, "one report");
    g.__hpsPanelThrow = undefined; g.__hpsStub = undefined;
  });
}

// ─── Host listeners that parse payloads (boundaries do not see listener errors) ───────────────
t("listener: a malformed pageCardsState becomes no cards and one report; a valid one draws the card", async () => {
  resetPanelReports(); posted.length = 0; g.__hpsStub = undefined; g.__hpsPanelThrow = undefined; g.__hpsRendered = new Set();
  const h = await personalApp();
  await hostMsg({ type: "pageCardsState", cards: "not-a-list", activityId: "p1", taskId: "t1" });
  await hostMsg({ type: "pageCardsState", cards: { length: 1 }, activityId: "p1", taskId: "t1" });
  ok(!g.__hpsRendered.has("PageCard.tsx:PageCard"), "no card drawn from a malformed payload");
  ok(!h.fatal(), "no fatal screen");
  const r = reports().filter((x) => /host payload error: page-cards/.test(x.message ?? ""));
  eq(r.length, 1, "reported once across two malformed payloads");
  ok(!JSON.stringify(r[0]).includes("not-a-list"), "the payload is not reported");
  await hostMsg({ type: "pageCardsState", cards: [{ turnId: "s1", anchorId: "a1", pages: [{ path: "index.html", kind: "added" }] }], activityId: "p1", taskId: "t1" });
  ok(g.__hpsRendered.has("PageCard.tsx:PageCard"), "a valid payload still draws the card (positive control)");
});

t("listener: a malformed learningState clears the evidence region with one report; preview signals too", async () => {
  resetPanelReports(); posted.length = 0; g.__hpsStub = new Set(ALL_KEYS); g.__hpsPanelThrow = undefined; g.__hpsRendered = new Set();
  const hostile = new Proxy({}, { get() { throw new TypeError("bad signals"); } });
  const h = await scenario({ panel: "evidence", key: null, mode: "classroom", msgs: () => [{ type: "learningState", state: null }, { type: "previewRecovery", signals: hostile }] });
  ok(!g.__hpsRendered.has("CompletionGate.tsx:CompletionGate"), "no evidence region from a malformed state");
  eq(reports().filter((x) => /host payload error: learning-state/.test(x.message ?? "")).length, 1, "learning-state reported once");
  eq(reports().filter((x) => /host payload error: preview-recovery/.test(x.message ?? "")).length, 1, "unreadable preview signals reported once (they are read on every render)");
  ok(!h.fatal(), "no fatal screen");
  ok(h.textarea(), "the composer is still there");
  g.__hpsStub = undefined;
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

t("styles: 44px retry target, type-scale tokens, forced-colors boundary", () => {
  const css = designValues(readFileSync("webview-ui/src/chatDetails.css", "utf8"));
  const rule = (sel: string) => new RegExp(`(?:^|\\n)${sel.replace(/\./g, "\\.")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
  const retry = rule(".hps-panel-fallback-retry");
  ok(/min-height:\s*44px/.test(retry) && /min-width:\s*44px/.test(retry), "44px target");
  ok(/font-size:\s*var\(--hp-font-body\)/.test(retry), "retry label at body size");
  ok(/font-size:\s*var\(--hp-font-body\)/.test(rule(".hps-panel-fallback-text")), "sentence at body size (>=14px)");
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

function designValues(css: string): string { return staticTokens(readFileSync("webview-ui/src/designTokens.css", "utf8"))(css); }
