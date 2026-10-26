// CGP-KNOW-R-002 (REQ-STUDIO-ACTIVITY-HOME) — the activity home's two views, 작업 and 자료, in the task
// workspace rail. The real App, TaskWorkspace, ChatPanel and MaterialsPanel on the minimal DOM
// (fixtures/mini-dom.mjs), driven by real clicks and key events. The host is played by window messages
// and every message the webview posts is read back. The webview state is a real get/setState pair
// (globalThis.__vsState), so "reopen" is an unmount and a fresh mount reading the same state.
//
// Guards:
//   - switching the view 20 times (clicks and arrow keys) leaves the composer's textarea the same node
//     with a byte-identical draft, and posts nothing but the 자료 list request: no task, draft or send;
//   - the chosen view survives a re-mount of the whole App for the same seat, another seat starts on 작업,
//     and corrupt stored state falls back to 작업;
//   - a seat without the 자료 list (no `materials` flag, or an instructor) has no tabs and its task list is shown;
//   - the 자료 list has one place: the chat column leaves out its card inside the task workspace;
//   - tab semantics: role=tablist/tab/tabpanel, aria-selected, one tab stop, Left/Right/Home/End, modifiers and IME ignored;
//   - CGP-KNOW-D-002: the tablist sits right under an <h2> activity title (the host's name, cleaned of control
//     and bidi characters, capped; the kind label when blank), and only where the tabs are.

import { click, document as doc, mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../webview-ui/src/App";
import { TaskWorkspaceFrame } from "../webview-ui/src/TaskWorkspace";
import { MaterialsPanel } from "../webview-ui/src/MaterialsPanel";
import { MATERIALS_COPY, type MaterialsView } from "../src/activityMaterialsView";
import { ACTIVITY_TITLE_MAX, activityTitleText, HOME_VIEW_MAX_SCOPES, loadHomeView, saveHomeView } from "../webview-ui/src/activityHome";
import type { ChatConfig } from "../src/protocol";

for (const name of ["Node", "Element"]) (globalThis as Record<string, unknown>)[name] ??= (window as unknown as Record<string, unknown>)[name];
(globalThis as Record<string, unknown>).HTMLElement ??= (window as unknown as Record<string, unknown>).Element;

const act: (fn: () => unknown) => Promise<void> = (React as unknown as { act: (fn: () => unknown) => Promise<void> }).act;
const g = globalThis as unknown as { __posted: Array<Record<string, unknown>>; __vsState: unknown };
const posted = g.__posted;
let fail = 0;
const tests: [string, () => void | Promise<void>][] = [];
const t = (label: string, fn: () => void | Promise<void>) => tests.push([label, fn]);
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

type El = {
  localName: string; textContent: string; value: string; id: string; tabIndex: number; hidden?: boolean;
  getAttribute(n: string): string | null; hasAttribute(n: string): boolean; findAll(test: (e: El) => boolean): El[];
  dispatchEvent(e: unknown): boolean; focus(): void; querySelector(s: string): El | null; parentNode: El | null; childNodes?: El[];
};
const ev = (type: string, extra: Record<string, unknown> = {}) => ({
  type, bubbles: true, cancelable: true, defaultPrevented: false, timeStamp: Date.now(),
  preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra,
});
const hostSays = (data: unknown) => act(async () => { (globalThis as unknown as { window: { dispatchEvent(e: unknown): boolean } }).window.dispatchEvent({ type: "message", data, bubbles: false }); });
const tick = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const cls = (e: El, c: string) => (e.getAttribute("class") ?? "").split(/\s+/).includes(c);
/** Hidden by its own `hidden` attribute or an ancestor's: what the learner cannot see. */
const shown = (e: El) => { for (let n: El | null = e; n && n.localName; n = n.parentNode) if (n.hasAttribute?.("hidden")) return false; return true; };

const UX = { coach: { naming_mode: "fixed" as const, fallback_name: "HypeProof", naming_prompt_md: "", personality_prompt_md: "" }, suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: "" }, roll_input_button: { enabled: false, label: "", probe_md: "" } }, retry_button: { enabled: false, show_counter: false } };
const VIEW = (scope: string) => ({ scope, revision: 1, activeTaskId: "t1", sourceSelection: null, tasks: [{ id: "t1", title: "반 소개 페이지", createdAt: 1, updatedAt: 1, messageCount: 0 }, { id: "t2", title: "두 번째 작업", createdAt: 1, updatedAt: 2, messageCount: 0 }] });
const config = (over: Record<string, unknown> = {}, scope = "seat-a") => ({
  model: "m", hasToken: true, proxyUrl: "http://localhost:8787", fileAttach: true, materials: true,
  coach: { name: "HypeProof", personality: "", configured: true },
  profile: { profile_id: "p", activity_kind: "personal", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX },
  activity: { id: "p1", name: "내 작업", kind: "personal", workspace: "/tmp/p", verified: true },
  taskWorkspace: VIEW(scope), ...over,
}) as unknown as ChatConfig;
const LIST: MaterialsView = { scope: "[\"p1\",\"t1\"]", maxSelected: 3, items: [
  { id: "me:aaaaaaaaaaaa", kind: "file", title: "계획.md", detail: "자료/계획.md", selected: false, removable: true, origin: "learner", originLabel: "나" },
  { id: "inbox:obj-12345678:1", kind: "note", title: "강사 읽기 자료", detail: "강사가 보낸 글", selected: false, removable: false, origin: "instructor", originLabel: "강사" },
] } as MaterialsView;

const roots: Root[] = [];
async function mountApp(cfg: ChatConfig) {
  const host = mountPoint() as unknown as El;
  const root = createRoot(host as unknown as HTMLElement);
  roots.push(root);
  await act(async () => { root.render(<App />); });
  await hostSays({ type: "config", config: cfg });
  await hostSays({ type: "history", messages: [], activityId: "p1", taskId: "t1" });
  await hostSays({ type: "taskWorkspaceState", view: (cfg as unknown as { taskWorkspace: unknown }).taskWorkspace, activityId: "p1", taskId: "t1" });
  const all = (test: (e: El) => boolean) => host.findAll(test);
  return {
    host, root, all,
    tabs: () => all((e) => e.getAttribute("role") === "tab"),
    tab: (name: string) => all((e) => e.getAttribute("role") === "tab" && e.textContent === name)[0],
    tablist: () => all((e) => e.getAttribute("role") === "tablist")[0],
    textarea: () => all((e) => e.localName === "textarea")[0],
    taskList: () => all((e) => cls(e, "tw-task-list"))[0],
    materials: () => all((e) => e.getAttribute("data-testid") === "materials"),
    unmount: () => act(async () => { root.unmount(); }),
  };
}
const nonList = () => posted.filter((m) => m.type !== "materialsRequest" && m.type !== "webviewError");

t("switching 20 times keeps the composer node and its draft byte-identical and posts nothing but the list request", async () => {
  g.__vsState = undefined;
  const app = await mountApp(config());
  const ta = app.textarea();
  ok(ta, "the composer is drawn");
  // Hangul (precomposed and NFD), an emoji with a ZWJ, a tab, CRLF and trailing spaces: every byte must survive.
  const DRAFT = "반 소개 페이지에 각 사진을 넣고 싶어 👩‍💻\t\r\n둘째 줄  ";
  await act(async () => { ta.value = DRAFT; ta.dispatchEvent(ev("input")); });
  await tick(400);
  const saved = posted.filter((m) => m.type === "saveActivityDraft").at(-1) as { draft?: { text: string } } | undefined;
  eq(saved?.draft?.text, DRAFT, "control: the typed draft reached the host as typed");
  const before = posted.length;
  for (let i = 0; i < 20; i++) {
    const was = app.tabs().find((x) => x.getAttribute("aria-selected") === "true")!.textContent;
    if (i % 2 === 0) await act(async () => { click(app.tabs().find((x) => x.getAttribute("aria-selected") !== "true")!); });
    else await act(async () => { app.tablist().dispatchEvent(ev("keydown", { key: "ArrowRight", keyCode: 39 })); });
    const now = app.tabs().filter((x) => x.getAttribute("aria-selected") === "true");
    ok(now.length === 1 && now[0].textContent !== was, `switch ${i + 1}: the view changed from ${was}`);
    ok(app.textarea() === ta, `switch ${i + 1}: the composer is the same node (not remounted)`);
    eq(ta.value, DRAFT, `switch ${i + 1}: the draft is byte-identical`);
  }
  await tick(400);
  const after = posted.slice(before);
  eq(after.filter((m) => m.type !== "materialsRequest").map((m) => m.type), [], "switching posts no task, draft or send message");
  ok(after.some((m) => m.type === "materialsRequest"), "opening 자료 asks the host for the list");
  eq(nonList().filter((m) => m.type === "taskSelect" || m.type === "taskCreate" || m.type === "sendMessage").length, 0, "no navigation or send at all");
  await app.unmount();
});

t("tab semantics: a tablist of 작업 and 자료, one tab stop, arrows/Home/End move focus and selection, modifiers and IME ignored", async () => {
  g.__vsState = undefined; posted.length = 0;
  const app = await mountApp(config());
  const list = app.tablist();
  ok(list && list.getAttribute("aria-label") === "활동 보기", "a labelled tablist");
  eq(app.tabs().map((x) => x.textContent), ["작업", "자료"], "two tabs in order");
  const state = () => app.tabs().map((x) => [x.getAttribute("aria-selected"), x.getAttribute("tabindex")]);
  eq(state(), [["true", "0"], ["false", "-1"]], "작업 is the default and the only tab stop");
  for (const x of app.tabs()) {
    const panel = app.all((e) => e.getAttribute("id") === x.getAttribute("aria-controls"))[0];
    ok(panel && panel.getAttribute("role") === "tabpanel" && panel.getAttribute("aria-labelledby") === x.getAttribute("id"), `${x.textContent} controls a tabpanel labelled by it`);
  }
  ok(shown(app.taskList()), "작업 shows the task list");
  eq(app.materials().length, 0, "the 자료 list is not mounted while 작업 is chosen");
  eq(app.all((e) => cls(e, "hp-materials")).length, 0, "and the chat column draws no card of its own (the 함께 보낼 자료 line still asks for the list)");
  const key = (k: string, extra: Record<string, unknown> = {}) => act(async () => { app.tablist().dispatchEvent(ev("keydown", { key: k, keyCode: 0, ...extra })); });
  app.tab("작업").focus();
  for (const extra of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { isComposing: true }, { keyCode: 229 }]) {
    await key("ArrowRight", extra);
    eq(state()[0][0], "true", `ignored with ${JSON.stringify(extra)}`);
  }
  await key("ArrowRight");
  eq(state(), [["false", "-1"], ["true", "0"]], "ArrowRight selects 자료");
  ok(doc.activeElement === (app.tab("자료") as unknown), "and moves focus to it");
  ok(!shown(app.taskList()), "the task list is hidden");
  await hostSays({ type: "materialsState", view: LIST });
  eq(app.materials().length, 1, "the 자료 list is drawn once, in the rail");
  ok(app.materials()[0].localName === "section" && shown(app.materials()[0]), "as an open section, not a closed card");
  await key("ArrowRight");
  eq(state()[0][0], "true", "ArrowRight wraps to 작업");
  await key("ArrowLeft");
  eq(state()[1][0], "true", "ArrowLeft wraps to 자료");
  await key("Home");
  eq(state()[0][0], "true", "Home selects 작업");
  await key("End");
  eq(state()[1][0], "true", "End selects 자료");
  await key("Enter");
  eq(state()[1][0], "true", "other keys are not ours");
  await app.unmount();
});

t("the chosen view survives reopening the same seat; another seat starts on 작업; corrupt state falls back", async () => {
  g.__vsState = undefined;
  let app = await mountApp(config());
  await act(async () => { click(app.tab("자료")); });
  await app.unmount();
  app = await mountApp(config());
  eq(app.tab("자료").getAttribute("aria-selected"), "true", "reopened on 자료");
  ok(!shown(app.taskList()), "with the task list hidden");
  await app.unmount();
  app = await mountApp(config({}, "seat-b"));
  eq(app.tab("작업").getAttribute("aria-selected"), "true", "another seat starts on 작업");
  await app.unmount();
  app = await mountApp(config());
  eq(app.tab("자료").getAttribute("aria-selected"), "true", "the first seat still remembers 자료");
  await act(async () => { click(app.tab("작업")); });
  await app.unmount();
  app = await mountApp(config());
  eq(app.tab("작업").getAttribute("aria-selected"), "true", "choosing 작업 is remembered too");
  await app.unmount();
  for (const bad of [{ activityHomeView: { "seat-a": "<img>" } }, { activityHomeView: ["materials"] }, { activityHomeView: "materials" }, { activityHomeView: { "seat-a": { v: "materials" } } }]) {
    g.__vsState = bad;
    eq(loadHomeView("seat-a"), "tasks", `corrupt state ${JSON.stringify(bad)} reads as 작업`);
  }
  g.__vsState = { panelSizes: { "seat-a": { rail: 240 } } };
  saveHomeView("seat-a", "materials");
  eq((g.__vsState as { panelSizes: unknown }).panelSizes, { "seat-a": { rail: 240 } }, "saving keeps the other webview state");
  g.__vsState = undefined;
  saveHomeView("__proto__", "materials");
  eq(loadHomeView("__proto__"), "materials", "a scope spelled __proto__ is an ordinary key");
  eq(loadHomeView("constructor"), "tasks", "an inherited name is not a stored choice");
  g.__vsState = undefined;
  for (let i = 0; i < HOME_VIEW_MAX_SCOPES + 5; i++) saveHomeView(`scope-${i}`, "materials");
  const kept = Object.keys((g.__vsState as { activityHomeView: Record<string, string> }).activityHomeView);
  eq(kept.length, HOME_VIEW_MAX_SCOPES, "at most the newest seats are remembered");
  ok(kept.includes(`scope-${HOME_VIEW_MAX_SCOPES + 4}`) && !kept.includes("scope-0"), "the oldest is dropped first");
  g.__vsState = undefined;
});

t("a seat without the 자료 list has no tabs and shows its tasks, even with 자료 remembered", async () => {
  g.__vsState = { activityHomeView: { "seat-a": "materials" } };
  for (const [label, over] of [["no materials flag", { materials: false }], ["instructor", { isInstructor: true }]] as const) {
    posted.length = 0;
    const app = await mountApp(config(over as Record<string, unknown>));
    eq(app.tabs().length, 0, `${label}: no tabs`);
    ok(app.taskList() && shown(app.taskList()), `${label}: the task list is shown`);
    const panel = app.all((e) => e.getAttribute("id") === "tw-home-tasks")[0];
    ok(panel && panel.getAttribute("role") === null, `${label}: no tabpanel role without a tablist`);
    eq(app.materials().length, 0, `${label}: no 자료 list`);
    await app.unmount();
  }
  g.__vsState = undefined;
});

t("the chat column leaves out its 자료 card inside the task workspace; outside it (classroom) keeps it", async () => {
  g.__vsState = undefined; posted.length = 0;
  const app = await mountApp(config());
  await hostSays({ type: "materialsState", view: LIST });
  eq(app.all((e) => e.localName === "details" && cls(e, "hp-materials")).length, 0, "no closed card in the chat column");
  await app.unmount();
  const classroom = config({ taskWorkspace: undefined, activity: { id: "c1", name: "수업", kind: "classroom", workspace: "/tmp/c", verified: true },
    profile: { profile_id: "c", activity_kind: "classroom", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX } });
  const host = mountPoint() as unknown as El;
  const root = createRoot(host as unknown as HTMLElement); roots.push(root);
  await act(async () => { root.render(<App />); });
  await hostSays({ type: "config", config: classroom });
  await hostSays({ type: "materialsState", view: LIST });
  eq(host.findAll((e) => e.getAttribute("role") === "tablist").length, 0, "classroom: no tabs");
  eq(host.findAll((e) => e.localName === "details" && cls(e, "hp-materials")).length, 1, "classroom: the card stays in the coach rail");
  await act(async () => { root.unmount(); });
});

t("the 자료 view says when the list is loading or unavailable, never an empty panel", async () => {
  posted.length = 0;
  const host = mountPoint() as unknown as El;
  const root = createRoot(host as unknown as HTMLElement); roots.push(root);
  await act(async () => { root.render(<MaterialsPanel home />); });
  ok(host.textContent === MATERIALS_COPY.homeLoading, "before the host answers: loading");
  await hostSays({ type: "materialsState", view: null });
  ok(host.textContent === MATERIALS_COPY.homeUnavailable, "the host has no list here: says so");
  await hostSays({ type: "materialsState", view: LIST });
  const heading = host.findAll((e) => e.localName === "h2")[0];
  ok(heading && heading.textContent === "자료 2개", "the count is a heading");
  const section = host.findAll((e) => e.localName === "section")[0];
  ok(section.getAttribute("aria-labelledby") === heading.getAttribute("id"), "the section is named by it");
  await act(async () => { root.unmount(); });
});

t("D-002: the tabs sit right under the activity title, an h2 with the activity's name", async () => {
  g.__vsState = undefined;
  const app = await mountApp(config({ activity: { id: "p1", name: "2학기 과학 발표", kind: "personal", workspace: "/tmp/p", verified: true } }));
  const titles = app.all((e) => cls(e, "tw-activity-title"));
  eq(titles.length, 1, "one activity title");
  const title = titles[0];
  ok(title.localName === "h2" && title.textContent === "2학기 과학 발표", `an h2 with the name, got <${title.localName}> ${title.textContent}`);
  eq(title.getAttribute("data-hp-tooltip"), "2학기 과학 발표", "the full name is the tooltip");
  eq(title.getAttribute("dir"), "auto", "direction comes from the name itself");
  const siblings = (title.parentNode?.childNodes ?? []).filter((n) => n.localName);
  const at = siblings.indexOf(title);
  ok(at >= 0 && siblings[at + 1] === app.tablist(), "the tablist is the element right after the title");
  await act(async () => { click(app.tab("자료")); });
  eq(app.all((e) => cls(e, "tw-activity-title")).length, 1, "the title stays when 자료 is chosen");
  await app.unmount();
  for (const [label, over] of [["no materials flag", { materials: false }], ["instructor", { isInstructor: true }]] as const) {
    const other = await mountApp(config(over as Record<string, unknown>));
    eq(other.all((e) => cls(e, "tw-activity-title")).length, 0, `${label}: no title without the tabs (today's rail)`);
    await other.unmount();
  }
  const blank = await mountApp(config({ activity: { id: "p1", name: " \u202e\u200b\t ", kind: "trial", workspace: "/tmp/p", verified: true } }));
  eq(blank.all((e) => cls(e, "tw-activity-title"))[0]?.textContent, "AI 체험", "a blank name falls back to the activity kind");
  await blank.unmount();
});

t("D-002: the activity title is cleaned, not trusted", () => {
  eq(activityTitleText("  우리 반\n\t발표  "), "우리 반 발표", "whitespace runs become one space");
  eq(activityTitleText("abc\u202Eexe.txt"), "abcexe.txt", "an RLO override is dropped");
  eq(activityTitleText("\u2066a\u2069\u200E\u200F\u061C\u2028\u2029b"), "a b", "isolates and marks dropped; U+2028/2029 are whitespace");
  eq(activityTitleText("a\u0000\u0007\u001B[31mb\u007F\u0085c"), "a[31mbc", "C0/C1 controls dropped");
  eq(activityTitleText("\u200B\uFEFF\u3164\u115F"), "", "a name of invisible characters only is empty");
  eq(activityTitleText("발\u200D표 👩‍💻"), "발\u200D표 👩‍💻", "ZWJ stays");
  eq(activityTitleText("\u1100\u1161"), "가", "NFD Hangul is composed");
  for (const bad of [undefined, null, 3, {}, ["a"]]) eq(activityTitleText(bad), "", `${JSON.stringify(bad)} is not a title`);
  const long = activityTitleText("가".repeat(ACTIVITY_TITLE_MAX - 2) + "👩‍💻".repeat(5));
  ok(long.endsWith("…") && Array.from(new Intl.Segmenter("ko", { granularity: "grapheme" }).segment(long)).length === ACTIVITY_TITLE_MAX, `a long name is cut to ${ACTIVITY_TITLE_MAX} clusters with an ellipsis`);
  eq(long, "가".repeat(ACTIVITY_TITLE_MAX - 2) + "👩‍💻…", "the cut keeps the last emoji whole, never a lone 👩");
  eq(activityTitleText("가".repeat(ACTIVITY_TITLE_MAX)), "가".repeat(ACTIVITY_TITLE_MAX), "exactly the cap is kept whole");
});

t("TaskWorkspaceFrame without the prop keeps today's rail (no tabs)", async () => {
  const host = mountPoint() as unknown as El;
  const root = createRoot(host as unknown as HTMLElement); roots.push(root);
  await act(async () => { root.render(<TaskWorkspaceFrame view={VIEW("s") as never} messages={[]} busy={false} error={null} onDismissError={() => {}}><textarea /></TaskWorkspaceFrame>); });
  eq(host.findAll((e) => e.getAttribute("role") === "tablist").length, 0, "no tabs");
  ok(host.findAll((e) => cls(e, "tw-task-list")).length === 1, "the task list is there");
  await act(async () => { root.unmount(); });
});

(async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); }
    catch (e) { fail++; console.error(`  FAIL ${label}: ${(e as Error).message}`); }
  }
  if (fail) { console.error(`activity-home: ${fail} failed`); process.exit(1); }
  console.log(`PASS activity home (${tests.length}): 작업/자료 switching keeps the draft, remembered per seat, one 자료 list, tab semantics`);
  process.exit(0);
})();
