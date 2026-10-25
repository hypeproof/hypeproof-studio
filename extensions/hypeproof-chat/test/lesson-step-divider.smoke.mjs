// CGP-CHAT-R-023 (CGP-CHAT-R56 / D56, REQ-STUDIO-LESSON-STEP-DIVIDER): when the served lesson step changes, the
// transcript shows a read-only divider "n단계: {name}" at that point; "지금 단계로" scrolls to the divider of the
// step on screen and never changes the rail.
//
// 1. Pure rules (lessonStepMarks.ts) with negative controls: title cleaning, the served mark, validation, the
//    bounded store, where dividers go and which one "지금 단계로" targets.
// 2. The real provider turn (agent-sdk and proxy): the step captured at turn start is the one the runtime got
//    (x-hps-lesson-step), it rides on streamStart, it is kept beside the transcript (not in the task file) and
//    a later history post carries it back. Instructor and lesson-less seats get none.
// 3. The rendered ChatPanel (classroom lesson seat, personal seat, instructor): divider position and copy,
//    not focusable, and the header button only when the step on screen has a divider.
//
// The computed layout and the real scroll are measured in lesson-step-divider-layout.smoke.mjs.
// Run: node --experimental-strip-types test/lesson-step-divider.smoke.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chatConfig, chatPanelProps } from "./sx-screen-fixtures.mjs";

const M = await import("../src/lessonStepMarks.ts");
const { PublishReadGate } = await import("../src/publishReadGate.ts");
const require = createRequire(import.meta.url), extension = fileURLToPath(new URL("..", import.meta.url));

let passed = 0;
const ok = (name) => { passed++; console.log(`✓ ${name}`); };
const ch = (code) => String.fromCharCode(code);
const SHA = "f".repeat(64), OTHER = "e".repeat(64);
const lesson = (sha = SHA) => ({ sha256: sha, content: { steps: [{ id: "expect", title: "기대 조건" }, { id: "build", title: "Build pane" }, { id: "test", title: "Preview / Test" }] } });

// ── 1. Pure rules ──
{
  // Title cleaning: controls, bidi overrides/isolates, zero-width, line/paragraph separators, length.
  const hostile = `a${ch(0x202e)}b${ch(0x2028)}c${ch(0)}d${ch(0x2066)}e${ch(0x200b)}f${ch(0x2029)}g\n\th   i${ch(0xfeff)}`;
  assert.equal(M.cleanStepTitle(hostile), "ab cdef g h i");
  assert.equal(M.cleanStepTitle("  기대 조건  "), "기대 조건");
  const long = M.cleanStepTitle("가".repeat(200));
  assert.equal([...long].length, M.STEP_TITLE_MAX, "capped to the title maximum, ellipsis included");
  assert.ok(long.endsWith("…"));
  assert.equal(M.cleanStepTitle("e" + ch(0x301)), ch(0xe9), "NFC");

  // The served mark: the 1-based number and title of the served step in the served lesson.
  assert.deepEqual(M.servedStepMark(lesson(), "build"), { lesson: SHA, id: "build", n: 2, title: "Build pane" });
  assert.equal(M.servedStepMark(null, "build"), undefined, "no lesson: no mark");
  assert.equal(M.servedStepMark(lesson(), undefined), undefined, "no step: no mark");
  assert.equal(M.servedStepMark(lesson(), "missing"), undefined, "a step the lesson lacks: no mark");
  assert.equal(M.servedStepMark({ ...lesson(), sha256: "not-a-digest" }, "build"), undefined, "a malformed digest: no mark");
  assert.equal(M.servedStepMark({ sha256: SHA, content: { steps: [{ id: "x", title: `${ch(0x202e)} ` }] } }, "x").title, "이름 없는 단계", "an empty title after cleaning gets a neutral name");

  // Validation rejects every malformed field and extra keys (host payloads and storage are untrusted).
  const good = { lesson: SHA, id: "build", n: 2, title: "Build pane" };
  assert.equal(M.validStepMark(good), true);
  for (const bad of [null, [], "x", { ...good, extra: 1 }, { ...good, lesson: "F".repeat(64) }, { ...good, id: "" }, { ...good, id: "x".repeat(129) },
    { ...good, id: `a${ch(0x202e)}` }, { ...good, n: 0 }, { ...good, n: 1.5 }, { ...good, n: "2" }, { ...good, title: "" }, { ...good, title: `a${ch(0x2028)}b` },
    { ...good, title: "<b>" + "가".repeat(80) }, { lesson: SHA, id: "build", n: 2 }]) {
    assert.equal(M.validStepMark(bad), false, `rejects ${JSON.stringify(bad)?.slice(0, 60)}`);
  }

  // The store: invalid entries dropped, __proto__ ignored, bounded, newest kept, a retry replaces in place.
  const accepted = M.acceptStepMarks({ a: good, b: { ...good, n: 0 }, ["x".repeat(257)]: good, ...JSON.parse('{"__proto__": {"lesson": "' + SHA + '", "id": "p", "n": 1, "title": "p"}}') });
  assert.deepEqual(Object.keys(accepted), ["a"]);
  assert.equal(Object.getPrototypeOf(accepted), null);
  let marks = M.acceptStepMarks(null);
  for (let i = 0; i < M.STEP_MARKS_MAX + 5; i++) marks = M.rememberStepMark(marks, `m${i}`, good);
  assert.equal(Object.keys(marks).length, M.STEP_MARKS_MAX, "bounded");
  assert.equal(Object.keys(marks)[0], "m5", "the oldest go first");
  marks = M.rememberStepMark(marks, "m5", { ...good, id: "test", n: 3 });
  assert.equal(Object.keys(marks).at(-1), "m5", "a retry under the same id is the newest");
  assert.equal(marks.m5.id, "test");
  assert.deepEqual(Object.keys(M.marksFor(marks, ["m6", "nope", "m7"])), ["m6", "m7"], "a post carries only the marks of the given ids");
  assert.equal("m6" in M.forgetStepMarks(marks, ["m6"]), false, "forget drops the mark of a re-sent id");
  assert.equal(Object.keys(M.forgetStepMarks(marks, ["m6"])).length, M.STEP_MARKS_MAX - 1, "and nothing else");
  // The webview's reducer for a host post: no forget = the whole set (replace); forget = a delta (drop, then merge).
  const prev = { k1: good, k2: { ...good, id: "test", n: 3 } };
  assert.deepEqual(Object.keys(M.nextStepMarks(prev, { marks: { k3: good } })), ["k3"], "a history post replaces");
  assert.deepEqual(Object.keys(M.nextStepMarks(prev, { marks: {}, forget: ["k1"] })), ["k2"], "a forget post drops only that id");
  assert.deepEqual(Object.keys(M.nextStepMarks(prev, { marks: { k1: { ...good, id: "test", n: 3 } }, forget: ["k1"] })), ["k2", "k1"], "drop then merge");
  assert.deepEqual(Object.keys(M.nextStepMarks(prev, { marks: { k9: { ...good, n: 0 } }, forget: [7, null, "k2"] })), ["k1"], "untrusted fields are filtered");

  // Dividers: before the first marked prompt and wherever the served step changes; unmarked lines never start
  // or break a run; the same step id in another lesson is a change; tool and answer lines are never marked.
  const u = (id) => ({ id, role: "user" }), a = (id) => ({ id, role: "assistant" }), t = (id) => ({ id, role: "tool" });
  const mk = (id, n, sha = SHA) => ({ lesson: sha, id, n, title: `t-${id}` });
  const items = [u("old"), a("old-a"), u("u1"), a("a1"), t("t1"), u("u2"), u("shortcut"), u("u3"), a("a3"), u("u4"), u("u5"), u("u6")];
  const map = { u1: mk("expect", 1), u2: mk("expect", 1), u3: mk("build", 2), u4: mk("expect", 1), u5: mk("expect", 1, OTHER), u6: mk("expect", 1, OTHER), t1: mk("build", 2), a1: mk("test", 3) };
  const dividers = M.stepDividers(items, map);
  assert.deepEqual([...dividers.keys()], ["u1", "u3", "u4", "u5"]);
  assert.equal(M.stepDividerLabel(dividers.get("u3")), "2단계: t-build");
  assert.equal(M.stepDividers(items, null).size, 0, "no marks: no dividers");
  assert.equal(M.stepDividers(items, { u1: { ...mk("expect", 1), n: -1 } }).size, 0, "an invalid mark draws nothing");

  // "지금 단계로": the LAST divider of the step on screen in this lesson; none when that step has no divider.
  assert.equal(M.currentDividerId(dividers, SHA, "expect"), "u4", "returning to a step targets its latest divider");
  assert.equal(M.currentDividerId(dividers, SHA, "build"), "u3");
  assert.equal(M.currentDividerId(dividers, SHA, "test"), null, "a step not served yet has no target");
  assert.equal(M.currentDividerId(dividers, OTHER, "expect"), "u5", "only the lesson on screen");
  assert.equal(M.currentDividerId(dividers, null, "expect"), null);
  assert.equal(M.STEP_JUMP_LABEL, "지금 단계로");
  ok("pure rules: title cleaning, served mark, validation, bounded store, divider placement, jump target");
}

// ── 2. The real provider turn ──
const bundle = await build({ stdin: { contents: "export {ChatPanelProvider} from './src/chatPanelProvider';", resolveDir: extension, loader: "ts" }, bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false, logLevel: "silent", plugins: [{ name: "scripted-provider-runtime", setup(b) {
  b.onResolve({ filter: /^\.\/sdkCoach$/ }, (args) => args.importer.endsWith("/chatPanelProvider.ts") ? { path: "sdk", namespace: "runtime" } : undefined);
  b.onResolve({ filter: /^\.\/proxyClient$/ }, (args) => args.importer.endsWith("/chatPanelProvider.ts") ? { path: "proxy", namespace: "runtime" } : undefined);
  b.onLoad({ filter: /.*/, namespace: "runtime" }, (args) => ({ loader: "ts", resolveDir: extension, contents: args.path === "sdk"
    ? `export * from ${JSON.stringify(path.join(extension, "src/sdkCoach.ts"))}; export const runSdkCoach=(args)=>globalThis.runtime.sdk(args);`
    : `export * from ${JSON.stringify(path.join(extension, "src/proxyClient.ts"))}; export const proxyChat=(args)=>globalThis.runtime.proxy(args);` }));
} }] });
const copy = (v) => JSON.parse(JSON.stringify(v));
const servedProfile = (runtimeMode, withLesson = true) => ({ profile_id: "lesson-test", coach_runtime: runtimeMode, sdk_tools: { read: true }, ux: { coach: { naming_mode: "fixed", fallback_name: "코치" } }, ...(withLesson ? { lesson: { course_id: "c", version: "v1", ...lesson() } } : {}) });

function fixture({ runtimeMode = "agent-sdk", withLesson = true, instructor = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hps-step-divider-"));
  const posts = [], history = [], calls = [];
  const runtime = {
    sdk: async (args) => { calls.push({ runtime: "sdk", step: args.lessonStep }); args.onDelta("답"); return { kind: "success" }; },
    proxy: async (args) => { calls.push({ runtime: "proxy", step: args.lessonStep }); args.onDelta("답"); return { text: "답", toolUses: [] }; },
  };
  const values = { coachRuntime: runtimeMode, proxyUrl: "http://127.0.0.1:1/v1" };
  const vscode = { env: { appName: "HypeProof Studio" }, workspace: { getConfiguration: () => ({ get: (key, fallback) => values[key] ?? fallback }) }, window: { createOutputChannel: () => ({ appendLine() {} }) }, Uri: { file: (fsPath) => ({ fsPath }) } };
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: (id) => id === "vscode" ? vscode : require(id), runtime, console,
    process: { ...process, env: { PATH: process.env.PATH, APPDATA: root } },
    Buffer, URL, TextEncoder, TextDecoder, AbortController, AbortSignal, DOMException, crypto: globalThis.crypto, setTimeout, clearTimeout,
    fetch: async () => { throw new Error("Network is forbidden in this test"); },
  });
  const profile = servedProfile(runtimeMode, withLesson);
  const h = Object.create(module.exports.ChatPanelProvider.prototype), state = new Map();
  const context = { workspaceState: { get: (key, fallback) => state.get(key) ?? fallback, update: async (key, value) => state.set(key, copy(value)) }, secrets: { get: async () => "synthetic-test-token" } };
  Object.assign(h, { context, nativeHistoryScope: "task-a", pendingSends: 0, activeStreams: new Map(), delegationControls: new Map(), turnTimelines: new Map(), turnRequests: new Map(),
    _instructorMode: { isInstructor: instructor, onTurnSuccess() {}, async revertModelOnTurnError() {} }, cachedProfile: profile,
    getHistory: () => history, appendHistory: async (items) => { for (const item of items) { const i = history.findIndex((p) => p.id === item.id); if (i < 0) history.push(copy(item)); else history[i] = copy(item); } },
    post: async (event) => posts.push(copy(event)), postConfig: async () => {}, postContextTrim: async () => {}, postVerdicts: async () => {}, getCoach: () => ({ name: "코치", personality: "", configured: true }),
    ensureProfile: async () => profile, loadAccess: async () => {},
    pullQuestResultFromPreview: async () => {}, elementQueue: { take: () => undefined }, verifySession: { running: false, takeCoachContext: () => null, endTurn() {} },
    isCurriculumRuntimeEnabled: () => false, takeProjectSwitchBrief: async () => null, isLearningWikiEnabled: () => false,
    prepareObservation: async () => null, crBlobSinkFor: () => undefined, savePastedImages: async () => ({ note: "" }), commitAttachedImages: () => "",
    resolveCoachCwd: () => undefined, crSdkResults: { reset() {}, onToolUse() {}, onToolResult() {} }, liveServer: { currentUrl: () => undefined },
    buildBrowserMcpHost: () => ({}), saveAgentMdIfPresent: async () => {}, observationWrites: Promise.resolve(), sitePublisher: () => ({ available: () => false }),
    funnel: { emit() {}, setTarget() {}, active: false }, publishReadGate: new PublishReadGate(),
  });
  const send = (text, userMessageId) => h.handleMessage({ type: "sendMessage", text, history: [], toolMode: "auto", userMessageId });
  const focus = (stepId) => h.handleMessage({ type: "lessonFocus", stepId, helpMode: null });
  return { h, posts, history, calls, state, send, focus, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

for (const runtimeMode of ["agent-sdk", "proxy"]) {
  const f = fixture({ runtimeMode });
  try {
    await f.send("첫 질문", "u1");
    await f.send("두 번째", "u2");
    await f.focus("test");
    await f.send("세 번째", "u3");
    const starts = f.posts.filter((p) => p.type === "streamStart");
    assert.equal(starts.length, 3, `${runtimeMode}: three turns`);
    assert.deepEqual(starts.map((s) => s.userMessageId), ["u1", "u2", "u3"]);
    assert.deepEqual(starts.map((s) => s.lessonStep), [
      { lesson: SHA, id: "expect", n: 1, title: "기대 조건" },
      { lesson: SHA, id: "expect", n: 1, title: "기대 조건" },
      { lesson: SHA, id: "test", n: 3, title: "Preview / Test" },
    ], `${runtimeMode}: each turn carries the step it was served under`);
    assert.deepEqual(f.calls.map((c) => c.step), ["expect", "expect", "test"], `${runtimeMode}: the divider names exactly the step the runtime received`);
    // Kept beside the transcript: the saved user lines have no extra key (the task file shape is unchanged).
    for (const line of f.history.filter((m) => m.role === "user")) assert.equal("lessonStep" in line, false, `${runtimeMode}: no step field inside the saved line`);
    const stored = f.state.get("hps.lessonStepMarks");
    assert.deepEqual(Object.keys(stored), ["u1", "u2", "u3"]);
    // A later history post (reload, task switch) carries the marks of the transcript it posts, and only those.
    stored.stranger = { lesson: SHA, id: "build", n: 2, title: "Build pane" };
    f.posts.length = 0;
    await f.h.postHistory();
    const marks = f.posts.find((p) => p.type === "lessonStepMarks");
    assert.ok(marks, `${runtimeMode}: the history post brings the marks`);
    assert.deepEqual(Object.keys(marks.marks), ["u1", "u2", "u3"]);
    assert.ok(f.posts.findIndex((p) => p.type === "history") < f.posts.findIndex((p) => p.type === "lessonStepMarks"), "after the history it belongs to");
    assert.deepEqual([...M.stepDividers(f.history, marks.marks).keys()], ["u1", "u3"], `${runtimeMode}: dividers before u1 and u3 after a reload`);
    // A retry of u3 after the learner moved to another step is re-stamped with the step served on the retry.
    await f.focus("build");
    f.posts.length = 0;
    await f.h.handleMessage({ type: "retryMessage", prompt: "세 번째", history: [], toolMode: "auto", userMessageId: "u3", sourceMessageId: "u3" });
    assert.equal(f.posts.some((p) => p.type === "streamError"), false, `${runtimeMode}: the retry ran`);
    assert.equal(f.posts.find((p) => p.type === "streamStart")?.lessonStep?.id, "build");
    assert.equal(f.state.get("hps.lessonStepMarks").u3.id, "build");
  } finally { f.cleanup(); }
}
for (const [label, opts] of [["instructor", { instructor: true }], ["no lesson (personal)", { withLesson: false }]]) {
  const f = fixture(opts);
  try {
    await f.send("질문", "u1");
    const start = f.posts.find((p) => p.type === "streamStart");
    assert.ok(start, `${label}: the turn ran`);
    assert.equal("lessonStep" in start, false, `${label}: no step on streamStart`);
    assert.equal(f.state.get("hps.lessonStepMarks"), undefined, `${label}: nothing stored`);
  } finally { f.cleanup(); }
}
// A re-send (retry) after the learner moved to another step: the old mark is cleared at the start of the send and
// the open panel is told at once; only the model path stamps again. The panel's marks are replayed from the posts
// through the same reducers App.tsx uses.
const panelMarks = (posts) => {
  let marks = M.acceptStepMarks(null);
  for (const p of posts) {
    if (p.type === "lessonStepMarks") marks = M.nextStepMarks(marks, p);
    if (p.type === "streamStart" && p.userMessageId && M.validStepMark(p.lessonStep)) marks = M.rememberStepMark(marks, p.userMessageId, p.lessonStep);
  }
  return marks;
};
const WORLD = { id: "w1", guest: "토끼", emoji: "🐰", chip: "토끼 도와주기", line: "당근이 사라졌대요" };
for (const [label, setup, expectStep] of [
  ["(a) model path", async () => {}, "build"],
  ["(b) app short-circuit", async (f) => { f.h.cachedProfile.worlds = [WORLD]; }, null],
  ["(c) instructor mode", async (f) => { f.h._instructorMode.isInstructor = true; }, null],
]) {
  const f = fixture();
  try {
    const prompt = "다른 친구도 있어?";
    await f.send(prompt, "u1");
    await f.send("두 번째", "u2");
    assert.deepEqual(Object.keys(panelMarks(f.posts)), ["u1", "u2"], `${label}: both stamped first`);
    assert.equal(f.calls.length, 2, `${label}: the first sends were model turns`);
    await f.focus("build");
    await setup(f);
    const before = f.posts.length;
    await f.h.handleMessage({ type: "retryMessage", prompt, history: [], toolMode: "auto", userMessageId: "u1", sourceMessageId: "u1" });
    const retryPosts = f.posts.slice(before);
    const instructor = label.startsWith("(c)"), shortcut = label.startsWith("(b)");
    // The instructor seat refuses this fixture's runtime after its turn starts; what matters is the start it announced.
    if (!instructor) assert.equal(retryPosts.some((p) => p.type === "streamError"), false, `${label}: the retry ran`);
    const retryStart = retryPosts.find((p) => p.type === "streamStart");
    assert.ok(retryStart && retryStart.userMessageId === "u1", `${label}: the retry started`);
    assert.equal("lessonStep" in retryStart, !!expectStep, `${label}: only the learner model path announces a step`);
    if (!instructor) assert.equal(f.calls.length, shortcut ? 2 : 3, `${label}: ${shortcut ? "the app answered, no model call" : "the model answered"}`);
    const forgetAt = retryPosts.findIndex((p) => p.type === "lessonStepMarks" && Array.isArray(p.forget) && p.forget.includes("u1"));
    assert.ok(forgetAt >= 0, `${label}: the open panel is told u1 lost its old mark`);
    assert.ok(forgetAt < retryPosts.findIndex((p) => p.type === "streamStart"), `${label}: before the retry's answer starts`);
    const stored = f.state.get("hps.lessonStepMarks"), panel = panelMarks(f.posts);
    assert.equal(stored.u1?.id ?? null, expectStep, `${label}: stored mark of the re-sent id`);
    assert.equal(panel.u1?.id ?? null, expectStep, `${label}: panel mark of the re-sent id`);
    assert.equal(stored.u2.id, "expect", `${label}: other marks untouched`);
    const items = [{ id: "u2", role: "user" }, { id: "u1", role: "user" }]; // the errored turn appended late
    assert.deepEqual([...M.stepDividers(items, panel).entries()].map(([id, m]) => `${id}:${m.n}`), expectStep ? ["u2:1", "u1:2"] : ["u2:1"], `${label}: no stale boundary`);
  } finally { f.cleanup(); }
}
ok("real provider turns (agent-sdk and proxy) stamp the served step; reload, retry, re-send clears (model, shortcut, instructor), instructor and lesson-less seats");

// ── 3. Rendered ChatPanel ──
{
  const webviewDir = new URL("../webview-ui/", import.meta.url);
  const entry = [
    `import { createElement } from "react";`,
    `import { renderToStaticMarkup } from "react-dom/server";`,
    `import { ChatPanel } from "./src/ChatPanel.tsx";`,
    `export function render(props) { return renderToStaticMarkup(createElement(ChatPanel, props)); }`,
  ].join("\n");
  const out = await build({
    stdin: { contents: entry, resolveDir: webviewDir.pathname, loader: "tsx", sourcefile: "step-divider-entry.tsx" },
    bundle: true, platform: "node", format: "cjs", jsx: "automatic",
    loader: { ".css": "text", ".svg": "text", ".png": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"' }, write: false, logLevel: "silent",
  });
  const windowStub = { addEventListener() {}, removeEventListener() {}, postMessage() {} };
  const module = { exports: {} };
  vm.runInNewContext(out.outputFiles[0].text, {
    module, exports: module.exports, require: createRequire(import.meta.url), console, process, Buffer,
    setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, queueMicrotask,
    TextEncoder, TextDecoder, URL, window: windowStub, self: windowStub,
  });
  const render = module.exports.render;
  const msg = (id, role, content) => ({ id, role, content, createdAt: 1 });
  const messages = [msg("u1", "user", "질문-1"), msg("a1", "assistant", "답-1"), msg("u2", "user", "질문-2"), msg("a2", "assistant", "답-2"), msg("u3", "user", "질문-3"), msg("a3", "assistant", "답-3")];
  const hostileTitle = `<img src=x onerror=alert(1)>`;
  const stepMarks = { u1: { lesson: SHA, id: "expect", n: 1, title: "기대 조건" }, u2: { lesson: SHA, id: "expect", n: 1, title: "기대 조건" }, u3: { lesson: SHA, id: "build", n: 2, title: hostileTitle } };
  const count = (html, s) => html.split(s).length - 1;
  const html = render(chatPanelProps({ messages, stepMarks }));
  assert.equal(count(html, 'class="hps-step-divider"'), 2, "classroom: two dividers (u1, u3)");
  const d1 = html.indexOf("1단계: 기대 조건"), d2 = html.indexOf("2단계: ");
  assert.ok(d1 > 0 && d1 < html.indexOf("질문-1"), "the first divider sits before the first prompt of the step");
  assert.ok(html.indexOf("답-2") < d2 && d2 < html.indexOf("질문-3"), "the second sits where the served step changed");
  assert.ok(!html.includes("<img src=x"), "a hostile title is text, never markup");
  assert.ok(html.includes("2단계: &lt;img src=x onerror=alert(1)&gt;"));
  assert.match(html, /<div class="hps-step-divider" role="separator" aria-label="1단계: 기대 조건" data-step-divider="u1"><span class="hps-step-divider-label" aria-hidden="true">1단계: 기대 조건<\/span><\/div>/, "a separator, not focusable, no control inside");
  assert.ok(!/<div class="hps-step-divider"[^>]*tabindex/.test(html));
  // The rail starts on the first step (no pick yet): the step on screen is "expect", whose divider exists.
  assert.equal(count(html, ">지금 단계로</button>"), 1, "the header offers the jump to the current step's divider");
  assert.match(html, /<button type="button" class="hp-cta-quiet hp-mission-jump">지금 단계로<\/button>/);
  assert.ok(html.indexOf("hp-mission-jump") < html.indexOf("hps-messages"), "the jump lives in the header, above the transcript");
  // The rail's step has no divider yet (only "build" was served): no button.
  const notYet = render(chatPanelProps({ messages, stepMarks: { u3: stepMarks.u3 } }));
  assert.equal(count(notYet, "hps-step-divider\""), 1);
  assert.equal(count(notYet, "지금 단계로"), 0, "no divider for the step on screen: no button");
  // Marks from another lesson digest still draw where they were served, but never become the jump target.
  const otherLesson = render(chatPanelProps({ messages, stepMarks: { u1: { ...stepMarks.u1, lesson: OTHER } } }));
  assert.equal(count(otherLesson, 'class="hps-step-divider"'), 1);
  assert.equal(count(otherLesson, "지금 단계로"), 0);
  // No marks: nothing changes (negative control).
  const none = render(chatPanelProps({ messages }));
  assert.equal(count(none, "hps-step-divider"), 0);
  assert.equal(count(none, "지금 단계로"), 0);
  // Instructor seat and the personal workspace draw neither.
  const instructor = render(chatPanelProps({ messages, stepMarks, instructor: true }));
  assert.equal(count(instructor, "hps-step-divider"), 0, "instructor: no dividers");
  const personalConfig = chatConfig(3, { profile: { ...chatConfig().profile, lesson: null }, taskWorkspace: { scope: "s", revision: 1, activeTaskId: "t1", tasks: [{ id: "t1", title: "작업", createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null } });
  const personal = render(chatPanelProps({ config: personalConfig, messages, stepMarks }));
  assert.equal(count(personal, "hps-step-divider"), 0, "personal (no lesson): no dividers");
  assert.equal(count(personal, "지금 단계로"), 0);
  assert.ok(!/FRAMING|JUDGMENT|ORCHESTRATE|VERIFY|ADAPT|OWNERSHIP|점수/.test(html.slice(d1 - 200, d1 + 200)), "no capability or score labels");
  ok("ChatPanel draws read-only dividers and the header jump only on a learner lesson seat");
}

console.log(`\nlesson-step-divider: ${passed} checks passed`);
