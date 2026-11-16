// AE-02 / AE-41 (#555, the `context` packet) — a 자료 text file the learner took out of the conversation stays out of every later
// model request, on the real ChatPanelProvider. Bundled with esbuild; VS Code I/O, the activity connection and the model
// runtime are scripted, and the scripted proxy records every request (`userText`, `history`, `contextText`). Its answer
// quotes any marker the request carried, the way a real coach quotes a material it read. Checked here:
//   - control: the quoting answers do carry A's marker into later history before anything is excluded;
//   - after 이후 대화에서 빼기 on A: no later request carries A's marker in the history, the learner text or the context, and the
//     learner's own messages, kept material B (read again) and the confirmed goal are still there;
//   - the replay is the same on the next turn (one prompt-cache miss, at the change), and an exclusion adds no request;
//   - an excluded item cannot be selected, and taking one out drops it from the pending selection;
//   - 다시 넣기 restores the original replay; the choice survives a reopen; another work folder is untouched;
//   - typing the fixed marker texts excludes nothing; an address or an unsent file is never offered as excludable.
// No network, CLI, model call or VS Code window.
// Run: node --experimental-strip-types test/context-exclusion-host.smoke.mjs
import assert from "node:assert/strict";
import vm from "node:vm";
import * as fs from "node:fs";
import * as os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const require = createRequire(import.meta.url), extension = fileURLToPath(new URL("..", import.meta.url));
const copy = (v) => JSON.parse(JSON.stringify(v));
let passed = 0;
const failures = [];

const bundle = await build({
  stdin: { contents: "export {ChatPanelProvider} from './src/chatPanelProvider'; export * as mat from './src/activityMaterials'; export { FOLDER_CONSENT_KEY, folderNoAiCopy } from './src/folderConsent'; export { setHostWriteSink } from './src/artifactProvenance';", resolveDir: extension, loader: "ts" },
  bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false, logLevel: "silent",
  plugins: [{ name: "scripted-runtime", setup(b) {
    const swap = { "./proxyClient": "proxy", "./activityConnections": "connections" };
    b.onResolve({ filter: /^\.\/(proxyClient|activityConnections)$/ }, (args) => args.importer.endsWith("/chatPanelProvider.ts") ? { path: swap[args.path], namespace: "runtime" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "runtime" }, (args) => ({ loader: "ts", resolveDir: extension, contents: args.path === "proxy"
      ? `export * from ${JSON.stringify(path.join(extension, "src/proxyClient.ts"))}; export const proxyChat=(a)=>globalThis.runtime.proxy(a); export const verifyActivity=async()=>{};`
      : `export * from ${JSON.stringify(path.join(extension, "src/activityConnections.ts"))}; export const activityConnections=()=>globalThis.runtime.connections;` }));
  } }],
});

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hps-materials-host-")));
const storage = path.join(tmp, "storage");
const outside = path.join(tmp, "picked");
fs.mkdirSync(storage); fs.mkdirSync(outside);
const put = (dir, rel, data) => { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); return p; };

const PLAN = "# 발표 계획\n표지에는 제목만 쓴다 (PLAN-MARKER)\n";
const NOTES = "# 실험 메모\n온도는 20도였다 (NOTES-MARKER)\n";
const CARD = { object_id: "obj-12345678", kind: "material", title: "강사 읽기 자료", body: "광합성 설명 (CARD-MARKER)", links: [], revision: 1, received_at: 1, is_new: false, withdrawn: false, unreadable: false };

function fixture({ profile, instructor = false, reuse } = {}) {
  // `reuse`: the same work folder, workspace state and saved history, as after closing and reopening the window.
  const root = reuse?.root ?? fs.mkdtempSync(path.join(tmp, "work-"));
  const posts = [], history = reuse?.history ?? [], proxyCalls = [];
  let pick = null, onPick = null;
  const watchers = [];
  const connections = { scope: "a1", current: { service: "http://127.0.0.1:1/v1", serverId: "srv" }, token: async () => "synthetic-token", acquire: () => () => {} };
  const runtime = { connections, proxy: async (a) => { proxyCalls.push(copy({ userText: a.userText, history: a.history, contextText: a.contextText ?? null })); const text = reply(a.userText); a.onDelta?.(text); return { text, toolUses: [] }; } };
  const vscode = {
    env: { appName: "HypeProof Studio" },
    workspace: { createFileSystemWatcher: (pattern) => { const w = { pattern, on: {}, disposed: false, dispose() { this.disposed = true; } }; for (const k of ["Create", "Delete", "Change"]) w[`onDid${k}`] = (fn) => { w.on[k] = fn; return { dispose() {} }; }; watchers.push(w); return w; },
      workspaceFolders: [{ uri: { fsPath: root } }], getConfiguration: () => ({ get: (k, f) => ({ coachRuntime: "proxy", proxyUrl: "http://127.0.0.1:1/v1" })[k] ?? f }) },
    window: { createOutputChannel: () => ({ appendLine() {} }), showOpenDialog: async () => { await onPick?.(); return pick ? [{ fsPath: pick }] : undefined; }, showWarningMessage: async () => undefined, showInformationMessage: async () => undefined },
    commands: { executeCommand: async () => undefined },
    RelativePattern: class { constructor(base, pattern) { this.base = base; this.pattern = pattern; } },
    Uri: { file: (fsPath) => ({ fsPath }), joinPath: (u, ...n) => ({ fsPath: path.join(u.fsPath, ...n) }) },
    ProgressLocation: { Window: 10 },
  };
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports, runtime, console, process: { ...process, env: { PATH: process.env.PATH } },
    require: (id) => id === "vscode" ? vscode : require(id),
    Buffer, URL, TextEncoder, TextDecoder, AbortController, AbortSignal, DOMException, crypto: globalThis.crypto, setTimeout, clearTimeout, setInterval, clearInterval, performance,
    fetch: async () => { throw new Error("Network is forbidden in this test"); },
  });
  const { ChatPanelProvider, mat, FOLDER_CONSENT_KEY, folderNoAiCopy, setHostWriteSink } = module.exports;
  const hostWrites = [];
  setHostWriteSink({ wrote: (writes, actor) => hostWrites.push({ paths: writes.map((w) => w.absPath), actor }), replaced() {} });
  const h = Object.create(ChatPanelProvider.prototype), state = reuse?.state ?? new Map(), global = reuse?.global ?? new Map();
  const seat = profile ?? { profile_id: "class-a", activity_kind: "classroom", activity_id: "act-1", sdk_tools: { read: true }, ux: { coach: { naming_mode: "fixed", fallback_name: "코치" } } };
  let task = "task-a";
  Object.assign(h, {
    context: { globalStorageUri: { fsPath: storage }, workspaceState: { get: (k, f) => state.get(k) ?? f, update: async (k, v) => state.set(k, v) }, globalState: { get: (k) => global.get(k), update: async (k, v) => global.set(k, v) }, secrets: { get: async () => "synthetic-token" }, subscriptions: [] },
    nativeHistoryScope: "task-a", pendingSends: 0, activeStreams: new Map(), delegationControls: new Map(), turnTimelines: new Map(), turnRequests: new Map(),
    _instructorMode: { isInstructor: instructor, onTurnSuccess() {}, async revertModelOnTurnError() {} }, cachedProfile: seat, accessState: null, servedWorkspaceRoot: null,
    getHistory: () => history, appendHistory: async (items) => { for (const it of items) history.push(copy(it)); },
    post: async (e) => { posts.push(copy(e)); }, postConfig: async () => {}, getCoach: () => ({ name: "코치", personality: "", configured: true }),
    ensureProfile: async () => seat, loadAccess: async () => {},
    pullQuestResultFromPreview: async () => {}, elementQueue: { take: () => undefined }, verifySession: { running: false, takeCoachContext: () => null, endTurn() {} },
    isCurriculumRuntimeEnabled: () => false, takeProjectSwitchBrief: async () => null, isLearningWikiEnabled: () => false,
    prepareObservation: async () => null, crBlobSinkFor: () => undefined, savePastedImages: async () => ({ note: "" }), commitAttachedImages: () => "",
    resolveCoachCwd: () => root, crSdkResults: { reset() {}, onToolUse() {}, onToolResult() {} }, liveServer: { currentUrl: () => undefined },
    buildBrowserMcpHost: () => ({}), saveAgentMdIfPresent: async () => {}, observationWrites: Promise.resolve(), sitePublisher: () => ({ available: () => false }),
    provenanceRecorder: () => null, turnRequestScope: () => JSON.stringify(["a1", task]),
    inboxSource: { inboxView: async () => ({ run: "r", student: "s", generation: 1, ended: false, offline: false, cards: [CARD, { ...CARD, object_id: "obj-withdrawn", withdrawn: true }], unread: 0 }), inboxOpened: async () => {}, inboxLink: async () => null },
  });
  const states = () => posts.filter((e) => e.type === "materialsState");
  const last = () => states().at(-1);
  let n = 0;
  const say = async (msg) => { await h.handleMessage({ activityId: "a1", ...msg }); return last(); };
  const req = (type, extra = {}) => say({ type, requestId: `r${++n}`, ...extra });
  const send = (text, id) => h.handleMessage({ type: "sendMessage", activityId: "a1", text, history: [], toolMode: "auto", userMessageId: id });
  return { h, seat, hostWrites, root, posts, history, proxyCalls, state, last, say, req, send, mat, global, FOLDER_CONSENT_KEY, folderNoAiCopy, setPick: (p) => { pick = p; }, setTask: (t) => { task = t; }, onPick: (fn) => { onPick = fn; }, watchers };
}

const t = async (label, fn) => { try { await fn(); passed++; console.log(`  ok   ${label}`); } catch (e) { failures.push(label); console.error(`  FAIL ${label}: ${e.stack ?? e}`); } };
const item = (state, test) => state.view.items.find(test);

const { OMITTED_REPLY, REBUILT_CONTEXT_HEAD, CONTEXT_EXCLUSION_COPY } = await import("../src/contextExclusion.ts");
const MARKERS = ["PLAN-MARKER", "NOTES-MARKER"];
// The scripted coach quotes every marker its request carried (as a real coach quotes what it read).
function reply(userText) { const seen = MARKERS.filter((m) => userText.includes(m)); return seen.length ? `자료에서 ${seen.join(", ")} 를 봤어요.` : "네"; }
const all = (call) => JSON.stringify([call.userText, call.history, call.contextText]);

console.log("context exclusion — host");

async function twoMaterials(f) {
  f.setPick(put(outside, "계획.md", PLAN)); await f.req("materialAddFile");
  f.setPick(put(outside, "메모.md", NOTES)); let s = await f.req("materialAddFile");
  return { s, plan: item(s, (i) => i.detail === "자료/계획.md"), notes: item(s, (i) => i.detail === "자료/메모.md") };
}
async function sendWith(f, id, text, uid) {
  const s = f.last();
  if (id) await f.req("materialSelect", { scope: s.view.scope, id, selected: true });
  await f.send(text, uid);
}

await t("control: quoting answers carry A's marker into later history; nothing is excludable before it was sent", async () => {
  const f = fixture();
  const { plan, notes } = await twoMaterials(f);
  assert.ok(!plan.excludable && !notes.excludable, "an unsent file is not offered");
  await sendWith(f, plan.id, "표지 어떻게 해?", "u-1");
  await sendWith(f, notes.id, "온도는?", "u-2");
  await f.send("다음은?", "u-3");
  assert.equal(f.proxyCalls.length, 3);
  assert.ok(JSON.stringify(f.proxyCalls[2].history).includes("PLAN-MARKER"), "the earlier answer quoted A (the carrier this feature must cut)");
  assert.equal(f.proxyCalls[2].contextText, null, "no rebuilt context without an exclusion");
  const s = await f.req("materialsRequest");
  assert.equal(item(s, (i) => i.id === plan.id).excludable, true, "a sent text file is offered");
});

await t("after 이후 대화에서 빼기: A is gone from every part of the next requests; own words, B and the order stay; no extra request", async () => {
  const f = fixture();
  const { plan, notes } = await twoMaterials(f);
  await sendWith(f, plan.id, "표지 어떻게 해?", "u-1");
  await sendWith(f, notes.id, "온도는?", "u-2");
  let s = await f.req("materialExclude", { scope: f.last().view.scope, id: plan.id, excluded: true });
  assert.equal(s.error, undefined, s.error);
  assert.equal(s.notice, CONTEXT_EXCLUSION_COPY.excludedNote);
  assert.equal(item(s, (i) => i.id === plan.id).excluded, true);
  assert.equal(f.proxyCalls.length, 2, "the exclusion itself sends nothing");
  await f.send("다음은?", "u-3");
  await f.send("그다음은?", "u-4");
  assert.equal(f.proxyCalls.length, 4, "one request per turn");
  for (const call of f.proxyCalls.slice(2)) {
    assert.ok(!all(call).includes("PLAN-MARKER"), "A's marker is in no part of the request");
    assert.deepEqual(call.history.filter((m) => m.role === "user").map((m) => m.content).slice(0, 3), ["표지 어떻게 해?", "온도는?", "다음은?"].slice(0, call === f.proxyCalls[2] ? 2 : 3), "the learner's own messages are kept as written");
    assert.ok(call.history.filter((m) => m.role === "assistant").every((m) => m.content === OMITTED_REPLY), "answers after A was sent go as the fixed line");
    assert.ok(call.contextText?.startsWith(REBUILT_CONTEXT_HEAD), "the rebuilt context leads");
    assert.ok(call.contextText.includes("NOTES-MARKER"), "kept material B is read again");
  }
  // Cache stability: turn 4's history begins with turn 3's history, and the rebuilt context is the same.
  const [h3, h4] = [f.proxyCalls[2].history, f.proxyCalls[3].history];
  assert.deepEqual(h4.slice(0, h3.length), h3, "the replay is a stable prefix after the change");
  assert.equal(f.proxyCalls[3].contextText, f.proxyCalls[2].contextText, "the rebuilt context does not change turn to turn");
});

await t("an excluded item cannot be selected; taking one out drops it from the pending selection", async () => {
  const f = fixture();
  const { plan } = await twoMaterials(f);
  await sendWith(f, plan.id, "표지 어떻게 해?", "u-1");
  let s = await f.req("materialSelect", { scope: f.last().view.scope, id: plan.id, selected: true });
  assert.equal(item(s, (i) => i.id === plan.id).selected, true, "control: selected again for the next message");
  s = await f.req("materialExclude", { scope: s.view.scope, id: plan.id, excluded: true });
  assert.equal(item(s, (i) => i.id === plan.id).selected, false, "the pending selection lost it");
  s = await f.req("materialSelect", { scope: s.view.scope, id: plan.id, selected: true });
  assert.equal(s.error, CONTEXT_EXCLUSION_COPY.excludedSelect);
  assert.equal(item(s, (i) => i.id === plan.id).selected, false);
  await f.send("다시 보자", "u-2");
  assert.ok(!all(f.proxyCalls.at(-1)).includes("PLAN-MARKER"), "nothing of A went");
});

await t("다시 넣기 restores the original replay; the choice survives a reopen; another folder is untouched", async () => {
  const f = fixture();
  const { plan } = await twoMaterials(f);
  await sendWith(f, plan.id, "표지 어떻게 해?", "u-1");
  await f.req("materialExclude", { scope: f.last().view.scope, id: plan.id, excluded: true });
  // Reopen: the same folder, workspace state and saved history in a fresh provider.
  const g = fixture({ reuse: f });
  await g.send("다시 열었어", "u-2");
  assert.ok(!all(g.proxyCalls[0]).includes("PLAN-MARKER"), "still out after a reopen");
  let s = await g.req("materialsRequest");
  assert.equal(item(s, (i) => i.id === plan.id).excluded, true);
  // Another work folder (another activity) sees nothing of it.
  const other = fixture();
  const o = await twoMaterials(other);
  await sendWith(other, o.plan.id, "표지 어떻게 해?", "o-1");
  await other.send("다음", "o-2");
  assert.ok(JSON.stringify(other.proxyCalls[1].history).includes("PLAN-MARKER"), "the other activity keeps its own replay");
  assert.ok(!item(await other.req("materialsRequest"), (i) => i.id === o.plan.id).excluded);
  // 다시 넣기.
  s = await g.req("materialExclude", { scope: s.view.scope, id: plan.id, excluded: false });
  assert.equal(item(s, (i) => i.id === plan.id).excluded, undefined);
  await g.send("돌려놨어", "u-3");
  assert.ok(JSON.stringify(g.proxyCalls.at(-1).history).includes("PLAN-MARKER"), "the quoting answer is replayed again");
  assert.equal(g.proxyCalls.at(-1).contextText, null, "no rebuilt context once nothing is out");
});

await t("typing the fixed texts excludes nothing; an address is never excludable", async () => {
  const f = fixture();
  const { plan } = await twoMaterials(f);
  await sendWith(f, plan.id, "표지 어떻게 해?", "u-1");
  await f.send(`${OMITTED_REPLY} ${REBUILT_CONTEXT_HEAD} ${CONTEXT_EXCLUSION_COPY.exclude}`, "u-2");
  await f.send("다음은?", "u-3");
  assert.ok(JSON.stringify(f.proxyCalls[2].history).includes("PLAN-MARKER"), "a learner's words never decide an exclusion");
  assert.equal(f.proxyCalls[2].contextText, null);
  let s = await f.req("materialAddUrl", { url: "https://example.com/a" });
  const url = item(s, (i) => i.kind === "url");
  await f.req("materialSelect", { scope: s.view.scope, id: url.id, selected: true });
  await f.send("주소 봐", "u-4");
  s = await f.req("materialsRequest");
  assert.ok(!item(s, (i) => i.id === url.id).excludable, "an address is not offered");
  s = await f.req("materialExclude", { scope: s.view.scope, id: url.id, excluded: true });
  assert.ok(!item(s, (i) => i.id === url.id).excluded, "a forged request for an address changes nothing");
});

await t("the learner's own later messages and the confirmed goal go through verbatim after a cut", async () => {
  const f = fixture();
  const { plan, notes } = await twoMaterials(f);
  const later = ["표지에 \"제목\" 만 넣을까? (2/3쪽)", "그다음엔\n색을 바꿔 줘"];
  await sendWith(f, plan.id, "표지 어떻게 해?", "u-1");
  await f.send(later[0], "u-2");
  await f.send(later[1], "u-3");
  await f.req("materialExclude", { scope: f.last().view.scope, id: plan.id, excluded: true });
  await f.send("계속", "u-4");
  const users = f.proxyCalls.at(-1).history.filter((m) => m.role === "user").map((m) => m.content);
  assert.deepEqual(users, ["표지 어떻게 해?", ...later], "every later learner message, byte for byte");
  // The goal: a lesson seat with a saved goal; the provider's rebuilt context carries it as saved.
  const { acceptGoalSave, STUDENT_GOAL_KEY } = await import("../src/studentGoal.ts");
  const lesson = { course_id: "c1", version: "v1", sha256: "a".repeat(64), content: { steps: [] } };
  const goal = "발표 표지를 \"한 장\"으로 끝내기 (색 2가지)";
  const saved = acceptGoalSave(lesson, null, { lesson: lesson.sha256, goal, criteria: [], base: 0 }, {}, Date.now());
  assert.ok(saved.ok, JSON.stringify(saved));
  f.state.set(STUDENT_GOAL_KEY, saved.all);
  const ctx = await f.h.rebuiltExclusionContext({ ...f.seat, lesson }, [notes.id]);
  assert.ok(ctx.includes(`학습자가 확인한 목표: ${goal}`), `the goal verbatim: ${ctx}`);
  assert.ok(ctx.startsWith(REBUILT_CONTEXT_HEAD));
  await sendWith(f, notes.id, "메모 봐", "u-5");
  assert.ok((await f.h.rebuiltExclusionContext({ ...f.seat, lesson }, [notes.id])).includes("NOTES-MARKER"), "kept material read again");
});

// The wiring both runtimes share (source pins): one replayed history for every runtime call, the rebuilt context beside the
// learner's message, and no runtime call in the exclusion handler.
await t("both runtimes read the same replayed history; the exclusion handler calls no runtime", async () => {
  const src = fs.readFileSync(path.join(extension, "src/chatPanelProvider.ts"), "utf8");
  assert.match(src, /const replay = replayHistory\(modelHistory\(clampTimeline\(modelConversation\(attemptHistory\(conversation, retrySourceId\), versionOf\), HISTORY_MAX\)\), this\.materialMarks\(\), await this\.excludedMaterials\(\)\);\s*const history = replay\.history;/);
  assert.match(src, /const turnContext = joinTurnContext\(memoryTurn\?\.text, hintObservation, rebuiltText\);/);
  assert.equal((src.match(/userText:localLead\?`\$\{localLead\}\\n\\n\$\{userTextForModel\}`:userTextForModel,/g) ?? []).length, 2, "both local runtimes");
  const handler = src.slice(src.indexOf("private async excludeMaterial("), src.indexOf("private async excludedMaterials("));
  assert.ok(handler.length > 100 && !/runSdkCoach|proxyChat|runProxy|\bquery\(/.test(handler), "no runtime call when a material is taken out");
});

fs.rmSync(tmp, { recursive: true, force: true });
if (failures.length) { console.error(`context-exclusion-host: ${failures.length} failed`); process.exit(1); }
console.log(`context-exclusion-host smoke OK (${passed})`);
