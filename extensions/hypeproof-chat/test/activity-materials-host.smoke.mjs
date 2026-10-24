// CGP-KNOW-R-003 (REQ-STUDIO-ACTIVITY-MATERIALS) — the 자료 list on the real ChatPanelProvider.
// Bundled with esbuild; VS Code I/O, the activity connection and the model runtime are scripted.
// The scripted proxy records every request the host makes (the host request log): a turn's
// `userText` is exactly what the model receives. Checked here:
//   - adding a file copies it into <work folder>/자료/ and lists it with origin 나;
//   - refused addresses (http, userinfo, IP literal, localhost) answer with their reason, nothing stored;
//   - a selected item is in the request, an unselected one is absent, the selection is used once;
//   - an instructor material card is listed as 강사 and the host refuses to remove it;
//   - the gate (sdk_tools.read, never instructors, "AI 안 씀") and a task switch.
// No network, CLI, model call or VS Code window.
// Run: node --experimental-strip-types test/activity-materials-host.smoke.mjs
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

function fixture({ profile, instructor = false } = {}) {
  const root = fs.mkdtempSync(path.join(tmp, "work-"));
  const posts = [], history = [], proxyCalls = [];
  let pick = null, onPick = null;
  const watchers = [];
  const connections = { scope: "a1", current: { service: "http://127.0.0.1:1/v1", serverId: "srv" }, token: async () => "synthetic-token", acquire: () => () => {} };
  const runtime = { connections, proxy: async (a) => { proxyCalls.push(copy({ userText: a.userText, history: a.history })); a.onDelta?.("네"); return { text: "네", toolUses: [] }; } };
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
  const h = Object.create(ChatPanelProvider.prototype), state = new Map(), global = new Map();
  const seat = profile ?? { profile_id: "class-a", activity_kind: "classroom", activity_id: "act-1", sdk_tools: { read: true }, ux: { coach: { naming_mode: "fixed", fallback_name: "코치" } } };
  let task = "task-a";
  Object.assign(h, {
    context: { globalStorageUri: { fsPath: storage }, workspaceState: { get: (k, f) => state.get(k) ?? f, update: async (k, v) => state.set(k, v) }, globalState: { get: (k) => global.get(k), update: async (k, v) => global.set(k, v) }, secrets: { get: async () => "synthetic-token" }, subscriptions: [] },
    nativeHistoryScope: "task-a", pendingSends: 0, activeStreams: new Map(), turnTimelines: new Map(), turnRequests: new Map(),
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
  return { h, seat, hostWrites, root, posts, history, proxyCalls, last, say, req, send, mat, global, FOLDER_CONSENT_KEY, folderNoAiCopy, setPick: (p) => { pick = p; }, setTask: (t) => { task = t; }, onPick: (fn) => { onPick = fn; }, watchers };
}

const t = async (label, fn) => { try { await fn(); passed++; console.log(`  ok   ${label}`); } catch (e) { failures.push(label); console.error(`  FAIL ${label}: ${e.stack ?? e}`); } };
const item = (state, test) => state.view.items.find(test);

console.log("activity materials — host");

await t("adding a file copies it into <work folder>/자료/ and lists it with origin 나", async () => {
  const f = fixture();
  f.setPick(put(outside, "계획.md", PLAN));
  const s = await f.req("materialAddFile");
  assert.equal(s.error, undefined, s.error);
  assert.equal(fs.readFileSync(path.join(f.root, "자료", "계획.md"), "utf8"), PLAN, "copied with identical bytes");
  const mine = item(s, (i) => i.detail === "자료/계획.md");
  assert.ok(mine, "listed");
  assert.equal(mine.originLabel, "나");
  assert.equal(mine.origin, "learner");
  assert.ok(Number.isSafeInteger(mine.addedAt) && mine.addedAt > 0, "host exposes recorded learner add time");
  assert.equal(item(s, i => i.origin === "instructor").addedAt, CARD.received_at, "host exposes receipt time");
  assert.equal(mine.selected, false, "never pre-selected");
  assert.match(s.notice, /자료에 넣었어요: 계획\.md/);
  assert.deepEqual(copy(f.hostWrites), [{ paths: [path.join(f.root, "자료", "계획.md")], actor: "learner_upload" }], "the copy is recorded as the learner's upload (내가 올림)");
});

for (const [url, cause] of [["http://example.com/a", "not-https"], ["https://user:pw@example.com/", "userinfo"], ["https://192.168.0.10/", "ip-literal"], ["https://[::1]/", "ip-literal"], ["https://localhost/", "localhost"], ["https://example.com:8080/", "port"]]) {
  await t(`address refused with its reason, nothing stored: ${url}`, async () => {
    const f = fixture();
    const s = await f.req("materialAddUrl", { url });
    assert.equal(s.error, f.mat.URL_REFUSAL_COPY[cause]);
    assert.ok(!s.view.items.some((i) => i.kind === "url"), "not listed");
  });
}

await t("a good address is listed with origin 나 (positive control)", async () => {
  const f = fixture();
  const s = await f.req("materialAddUrl", { url: "https://example.com/광합성" });
  assert.equal(s.error, undefined);
  const u = item(s, (i) => i.kind === "url");
  assert.equal(u.detail, "https://example.com/%EA%B4%91%ED%95%A9%EC%84%B1");
  assert.equal(u.originLabel, "나");
});

await t("host request log: the selected item is in the request; the unselected one is absent; used once", async () => {
  const f = fixture();
  f.setPick(put(outside, "계획.md", PLAN)); await f.req("materialAddFile");
  f.setPick(put(outside, "메모.md", NOTES)); await f.req("materialAddFile");
  let s = await f.req("materialAddUrl", { url: "https://example.com/unselected-url" });
  const plan = item(s, (i) => i.detail === "자료/계획.md");
  s = await f.req("materialSelect", { scope: s.view.scope, id: plan.id, selected: true });
  assert.equal(item(s, (i) => i.id === plan.id).selected, true, "host shows it selected");
  await f.send("표지 어떻게 해?", "u-1");
  assert.equal(f.proxyCalls.length, 1, "one model request");
  const sent = f.proxyCalls[0].userText;
  assert.ok(sent.includes("PLAN-MARKER"), "selected file text is in the request");
  assert.ok(sent.includes('<material origin="나" kind="file" path="자료/계획.md">'), "labelled with its origin");
  assert.ok(sent.endsWith("표지 어떻게 해?"), "learner text last");
  assert.ok(!sent.includes("NOTES-MARKER"), "unselected file absent");
  assert.ok(!sent.includes("unselected-url"), "unselected address absent");
  assert.ok(!sent.includes("CARD-MARKER"), "unselected instructor card absent");
  assert.ok(!JSON.stringify(f.history).includes("PLAN-MARKER"), "history keeps the learner's own text only");
  assert.equal(item(f.last(), (i) => i.id === plan.id).selected, false, "selection cleared after the send");
  await f.send("다음 질문", "u-2");
  assert.ok(!f.proxyCalls[1].userText.includes("PLAN-MARKER"), "not sent again on the next message");
  assert.ok(!f.proxyCalls[1].userText.includes("<material"), "no material block at all");
});

await t("a retry of a turn that carried 자료 does not resend them, and says so", async () => {
  const f = fixture();
  f.setPick(put(outside, "계획.md", PLAN));
  let s = await f.req("materialAddFile");
  await f.req("materialSelect", { scope: s.view.scope, id: item(s, (i) => i.origin === "learner").id, selected: true });
  await f.send("질문", "u-1");
  assert.ok(f.proxyCalls[0].userText.includes("PLAN-MARKER"), "control: the first send carried it");
  await f.h.handleMessage({ type: "retryMessage", activityId: "a1", prompt: "질문", history: [], toolMode: "auto", sourceMessageId: "u-1", userMessageId: "u-1" });
  assert.equal(f.proxyCalls.length, 2, "the retry reached the model");
  assert.ok(!f.proxyCalls[1].userText.includes("PLAN-MARKER"), "not resent");
  assert.ok(f.posts.some((e) => e.type === "materialsState" && e.notice === f.mat.MATERIALS_COPY.retryNotice), "the learner is told");
});

await t("a retry never carries 자료 selected after the original send; the new selection waits for the next fresh send", async () => {
  const f = fixture();
  f.setPick(put(outside, "계획.md", PLAN));
  let s = await f.req("materialAddFile");
  const id = item(s, (i) => i.origin === "learner").id;
  await f.send("질문", "u-1");
  s = await f.req("materialSelect", { scope: s.view.scope, id, selected: true });
  await f.h.handleMessage({ type: "retryMessage", activityId: "a1", prompt: "질문", history: [], toolMode: "auto", sourceMessageId: "u-1", userMessageId: "u-1" });
  assert.ok(!f.proxyCalls[1].userText.includes("PLAN-MARKER"), "the retry did not take the new selection");
  await f.send("새 질문", "u-2");
  assert.ok(f.proxyCalls[2].userText.includes("PLAN-MARKER"), "the next fresh send takes it");
});

await t("a seat that lost the gate after selecting sends nothing from the list", async () => {
  const f = fixture();
  f.setPick(put(outside, "계획.md", PLAN));
  const s = await f.req("materialAddFile");
  await f.req("materialSelect", { scope: s.view.scope, id: item(s, (i) => i.origin === "learner").id, selected: true });
  f.h.cachedProfile = { ...f.seat, sdk_tools: { read: false } };
  await f.send("질문", "u-1");
  assert.ok(!f.proxyCalls[0].userText.includes("PLAN-MARKER"));
  assert.ok(!f.proxyCalls[0].userText.includes("<material"));
});

await t("folder consent changed to \"AI 안 씀\" after selecting: the folder-consent gate holds the whole turn, nothing goes", async () => {
  const f = fixture({ profile: { profile_id: "p", activity_kind: "personal", activity_id: "act-1", sdk_tools: { read: true } } });
  const s = await f.req("materialAddUrl", { url: "https://example.com/consent-marker" });
  await f.req("materialSelect", { scope: s.view.scope, id: s.view.items[0].id, selected: true });
  f.global.set(f.FOLDER_CONSENT_KEY, { "act-1": { [f.root]: { level: "none", at: 1 } } });
  await f.send("질문", "u-1");
  assert.equal(f.proxyCalls.length, 0, "no model request at all (REQ-STUDIO-FOLDER-CONSENT)");
});

// A ledger that records one AI write, 자료/요약.md; every other recorder call is a no-op.
const aiRecorder = () => new Proxy({ view: async () => ({ entries: [{ path: "자료/요약.md", kind: "ai_created", createdAt: 1700000000000, at: 1700000060000 }] }) }, { get: (o, k) => o[k] ?? (() => undefined) });
const HELD = (f, titles) => f.posts.filter((e) => e.type === "streamError").some((e) => e.error === f.mat.MATERIALS_COPY.held(titles));
const rejected = (f, text) => f.posts.some((e) => e.type === "inputRejected" && e.text === text);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await t("a selected file deleted from 자료/ is named above the composer before Send (folder watcher), with why", async () => {
  const f = fixture();
  f.setPick(put(outside, "계획.md", PLAN));
  let s = await f.req("materialAddFile");
  const plan = item(s, (i) => i.origin === "learner");
  s = await f.req("materialSelect", { scope: s.view.scope, id: plan.id, selected: true });
  const w = f.watchers.at(-1);
  assert.ok(w, "a watcher on the work folder's 자료");
  assert.equal(w.pattern.base.fsPath, f.root);
  assert.equal(w.pattern.pattern, "{자료,자료/*}", "the folder itself and its files");
  const before = f.posts.length;
  fs.unlinkSync(path.join(f.root, "자료", "계획.md"));
  w.on.Delete({ fsPath: path.join(f.root, "자료", "계획.md") });
  await wait(250);
  const pushed = f.posts.slice(before).filter((e) => e.type === "materialsState").at(-1);
  assert.ok(pushed, "the host pushed a fresh list on its own, no press, no Send");
  assert.deepEqual(pushed.view.unavailable, [{ id: plan.id, title: "계획.md", reason: f.mat.MATERIALS_COPY.goneReason }], "named, with why");
  assert.equal(f.proxyCalls.length, 0, "nothing sent");
});

await t("a selected item that is gone holds the send: nothing goes, the draft comes back, the item is named", async () => {
  const f = fixture();
  f.setPick(put(outside, "계획.md", PLAN)); let s = await f.req("materialAddFile");
  const plan = item(s, (i) => i.detail === "자료/계획.md");
  s = await f.req("materialAddUrl", { url: "https://example.com/kept" });
  const url = item(s, (i) => i.kind === "url");
  await f.req("materialSelect", { scope: s.view.scope, id: plan.id, selected: true });
  s = await f.req("materialSelect", { scope: s.view.scope, id: url.id, selected: true });
  fs.unlinkSync(path.join(f.root, "자료", "계획.md"));
  await f.send("질문", "u-1"); // no refresh in between
  assert.equal(f.proxyCalls.length, 0, "held: no model request");
  assert.ok(rejected(f, "질문"), "the draft goes back to the composer");
  assert.ok(HELD(f, ["계획.md"]), "the held reason names the item");
  assert.deepEqual(f.last().view.unavailable.map((u) => u.title), ["계획.md"], "still shown as unavailable");
  assert.equal(item(f.last(), (i) => i.id === url.id).selected, true, "the rest of the selection is kept");
  // Taking it out is the learner's consent to send without it.
  s = await f.req("materialSelect", { scope: s.view.scope, id: plan.id, selected: false });
  assert.equal(s.error, undefined, s.error);
  assert.deepEqual(s.view.unavailable, []);
  await f.send("질문", "u-2");
  assert.equal(f.proxyCalls.length, 1);
  assert.ok(f.proxyCalls[0].userText.includes("https://example.com/kept"), "the remaining item goes");
  assert.ok(!f.proxyCalls[0].userText.includes("PLAN-MARKER"));
});

await t("a selected item that was renamed, or whose 자료 folder is gone, holds the send too", async () => {
  for (const vanish of ["rename", "folder"]) {
    const f = fixture();
    f.setPick(put(outside, "계획.md", PLAN)); const s = await f.req("materialAddFile");
    await f.req("materialSelect", { scope: s.view.scope, id: item(s, (i) => i.origin === "learner").id, selected: true });
    if (vanish === "rename") fs.renameSync(path.join(f.root, "자료", "계획.md"), path.join(f.root, "자료", "새 계획.md"));
    else fs.renameSync(path.join(f.root, "자료"), path.join(f.root, "옛 자료"));
    await f.send("질문", "u-1");
    assert.equal(f.proxyCalls.length, 0, `${vanish}: held`);
    assert.ok(HELD(f, ["계획.md"]), `${vanish}: named`);
  }
});

await t("a selected file that became unreadable (now binary) is named before Send with the attach reason and holds the send", async () => {
  const f = fixture();
  f.setPick(put(outside, "계획.md", PLAN)); let s = await f.req("materialAddFile");
  s = await f.req("materialSelect", { scope: s.view.scope, id: item(s, (i) => i.origin === "learner").id, selected: true });
  fs.writeFileSync(path.join(f.root, "자료", "계획.md"), Buffer.from([0, 1, 2, 3]));
  s = await f.req("materialsRequest");
  assert.equal(s.view.unavailable.length, 1);
  assert.notEqual(s.view.unavailable[0].reason, f.mat.MATERIALS_COPY.goneReason, "the file's own refusal, not 'gone'");
  await f.send("질문", "u-1");
  assert.equal(f.proxyCalls.length, 0);
  assert.ok(HELD(f, ["계획.md"]));
});

await t("a withdrawn instructor card that was selected holds the send, named", async () => {
  const f = fixture();
  let s = await f.req("materialsRequest");
  await f.req("materialSelect", { scope: s.view.scope, id: item(s, (i) => i.origin === "instructor").id, selected: true });
  f.h.inboxSource = { inboxView: async () => ({ cards: [{ ...CARD, withdrawn: true }] }) };
  await f.send("질문", "u-1");
  assert.equal(f.proxyCalls.length, 0);
  assert.ok(HELD(f, ["강사 읽기 자료"]));
});

await t("control: with nothing selected the request has no material block", async () => {
  const f = fixture();
  f.setPick(put(outside, "계획.md", PLAN)); await f.req("materialAddFile");
  await f.send("질문", "u-1");
  assert.ok(!f.proxyCalls[0].userText.includes("PLAN-MARKER"));
  assert.ok(!f.proxyCalls[0].userText.includes("<material"));
});

await t("instructor material shows origin 강사, cannot be removed, and goes only when selected", async () => {
  const f = fixture();
  let s = await f.req("materialsRequest");
  const card = item(s, (i) => i.origin === "instructor");
  assert.ok(card, "listed");
  assert.equal(card.originLabel, "강사");
  assert.equal(card.removable, false);
  assert.equal(s.view.items.filter((i) => i.origin === "instructor").length, 1, "a withdrawn card is not listed");
  s = await f.req("materialRemove", { scope: s.view.scope, id: card.id });
  assert.equal(s.error, f.mat.MATERIALS_COPY.notRemovable);
  assert.ok(item(s, (i) => i.id === card.id), "still listed");
  s = await f.req("materialSelect", { scope: s.view.scope, id: card.id, selected: true });
  await f.send("설명해 줘", "u-1");
  assert.ok(f.proxyCalls[0].userText.includes('<material origin="강사" kind="note" title="강사 읽기 자료">'));
  assert.ok(f.proxyCalls[0].userText.includes("CARD-MARKER"));
});

await t("a learner item can be removed; the copied file stays in the folder", async () => {
  const f = fixture();
  f.setPick(put(outside, "계획.md", PLAN));
  let s = await f.req("materialAddFile");
  const mine = item(s, (i) => i.origin === "learner");
  s = await f.req("materialRemove", { scope: s.view.scope, id: mine.id });
  assert.equal(s.error, undefined);
  assert.ok(!item(s, (i) => i.id === mine.id), "off the list");
  assert.ok(fs.existsSync(path.join(f.root, "자료", "계획.md")), "file kept");
});

await t("a selection made on another task is dropped, not sent", async () => {
  const f = fixture();
  f.setPick(put(outside, "계획.md", PLAN));
  let s = await f.req("materialAddFile");
  await f.req("materialSelect", { scope: s.view.scope, id: item(s, (i) => i.origin === "learner").id, selected: true });
  f.setTask("task-b");
  const other = await f.req("materialsRequest");
  assert.ok(other.view.items.every((i) => !i.selected), "the other task's list shows nothing selected");
  await f.send("다른 작업 질문", "u-1");
  assert.ok(!f.proxyCalls[0].userText.includes("PLAN-MARKER"));
  s = await f.req("materialSelect", { scope: JSON.stringify(["a1", "task-a"]), id: "me:000000000000", selected: true });
  assert.equal(s.error, f.mat.MATERIALS_COPY.changed, "a press from the old task's list is refused");
});

await t("folder binding: a selection made in folder A is never sent from folder B (same task), and the send is held, named", async () => {
  const f = fixture();
  const other = fs.realpathSync(fs.mkdtempSync(path.join(tmp, "work-b-")));
  put(f.root, "자료/요약.md", "A 폴더 요약 (A-MARKER)\n");
  put(other, "자료/요약.md", "B 폴더 요약 (B-MARKER)\n");
  f.h.provenanceRecorder = aiRecorder;
  let s = await f.req("materialsRequest");
  const ai = item(s, (i) => i.origin === "ai");
  assert.equal(ai.addedAt, 1700000000000, "host uses creation rather than latest edit time");
  assert.equal(ai.id, "ai:자료/요약.md", "control: an AI file, whose id is the same in both folders");
  s = await f.req("materialSelect", { scope: s.view.scope, id: ai.id, selected: true });
  f.h.resolveCoachCwd = () => other; // the coach folder changes; the task scope does not
  await f.send("질문", "u-1");
  assert.equal(f.proxyCalls.length, 0, "held");
  assert.ok(rejected(f, "질문"));
  assert.ok(f.posts.some((e) => e.type === "streamError" && e.error === f.mat.MATERIALS_COPY.heldChanged(["요약.md"])), "named");
  await f.send("질문", "u-2");
  assert.equal(f.proxyCalls.length, 1, "the selection is gone; the next send goes");
  assert.ok(!f.proxyCalls[0].userText.includes("B-MARKER"), "folder B's file of the same name is not sent");
  assert.ok(!f.proxyCalls[0].userText.includes("A-MARKER"), "folder A's file is not sent from folder B");
  assert.ok(!f.proxyCalls[0].userText.includes("<material"));
});

await t("folder binding: after a refresh in folder B the A selection is dropped and the learner is told", async () => {
  const f = fixture();
  const other = fs.realpathSync(fs.mkdtempSync(path.join(tmp, "work-b-")));
  put(f.root, "자료/요약.md", "A (A-MARKER)\n"); put(other, "자료/요약.md", "B (B-MARKER)\n");
  f.h.provenanceRecorder = aiRecorder;
  let s = await f.req("materialsRequest");
  await f.req("materialSelect", { scope: s.view.scope, id: "ai:자료/요약.md", selected: true });
  f.h.resolveCoachCwd = () => other;
  s = await f.req("materialsRequest");
  assert.equal(s.error, f.mat.MATERIALS_COPY.changed, "the drop is said");
  assert.ok(s.view.items.every((i) => !i.selected), "B's list shows nothing selected");
  await f.send("질문", "u-1");
  assert.ok(!f.proxyCalls[0].userText.includes("B-MARKER") && !f.proxyCalls[0].userText.includes("A-MARKER"));
});

await t("folder binding: the folder changes between the preflight and the model turn: nothing goes, named", async () => {
  const f = fixture();
  const other = fs.realpathSync(fs.mkdtempSync(path.join(tmp, "work-b-")));
  put(f.root, "자료/요약.md", "A (A-MARKER)\n"); put(other, "자료/요약.md", "B (B-MARKER)\n");
  f.h.provenanceRecorder = aiRecorder;
  const s = await f.req("materialsRequest");
  await f.req("materialSelect", { scope: s.view.scope, id: "ai:자료/요약.md", selected: true });
  const ensure = f.h.ensureProfile;
  f.h.ensureProfile = async () => { f.h.resolveCoachCwd = () => other; return ensure(); }; // after the preflight, before the take
  await f.send("질문", "u-1");
  assert.equal(f.proxyCalls.length, 1);
  assert.ok(!f.proxyCalls[0].userText.includes("A-MARKER") && !f.proxyCalls[0].userText.includes("B-MARKER"), "neither folder's file");
  assert.ok(f.posts.some((e) => e.type === "materialsState" && e.error === f.mat.MATERIALS_COPY.skipped(["요약.md"])), "named");
});

await t("adding: the folder or the task changes while the picker is open: nothing is copied or listed", async () => {
  for (const change of ["folder", "task"]) {
    const f = fixture();
    const other = fs.realpathSync(fs.mkdtempSync(path.join(tmp, "work-b-")));
    f.setPick(put(outside, "계획.md", PLAN));
    f.onPick(() => { if (change === "folder") f.h.resolveCoachCwd = () => other; else f.setTask("task-b"); });
    const s = await f.req("materialAddFile");
    assert.equal(s.error, f.mat.MATERIALS_COPY.changed, `${change}: refused`);
    assert.ok(!fs.existsSync(path.join(f.root, "자료", "계획.md")) && !fs.existsSync(path.join(other, "자료", "계획.md")), `${change}: nothing copied`);
  }
});

await t("at most three items per message", async () => {
  const f = fixture();
  let s;
  for (const u of ["a", "b", "c", "d"]) s = await f.req("materialAddUrl", { url: `https://example.com/${u}` });
  const ids = s.view.items.filter((i) => i.kind === "url").map((i) => i.id);
  for (const id of ids.slice(0, 3)) s = await f.req("materialSelect", { scope: s.view.scope, id, selected: true });
  s = await f.req("materialSelect", { scope: s.view.scope, id: ids[3], selected: true });
  assert.equal(s.error, f.mat.MATERIALS_COPY.tooManySelected);
  assert.equal(s.view.items.filter((i) => i.selected).length, 3);
});

await t("gate: without sdk_tools.read the seat has no list and every press is refused", async () => {
  const f = fixture({ profile: { profile_id: "p", activity_kind: "classroom", sdk_tools: { read: false } } });
  const s = await f.req("materialsRequest");
  assert.equal(s.view, null);
  const add = await f.req("materialAddUrl", { url: "https://example.com/" });
  assert.match(add.error, /자료/);
  assert.equal(fs.existsSync(f.mat.materialsManifestFile(storage, f.root)), false, "nothing stored");
});
await t("gate: never on the instructor surface", async () => {
  const f = fixture({ instructor: true });
  assert.equal((await f.req("materialsRequest")).view, null);
  assert.match((await f.req("materialAddUrl", { url: "https://example.com/" })).error, /자료/);
});
await t("folder consent \"AI 안 씀\" (personal activity): adding and selecting are refused with its copy", async () => {
  const f = fixture({ profile: { profile_id: "p", activity_kind: "personal", activity_id: "act-1", sdk_tools: { read: true } } });
  let s = await f.req("materialAddUrl", { url: "https://example.com/" });
  assert.equal(s.error, undefined, "control: undecided folder adds");
  f.global.set(f.FOLDER_CONSENT_KEY, { "act-1": { [f.root]: { level: "none", at: 1 } } });
  s = await f.req("materialAddUrl", { url: "https://example.com/b" });
  assert.equal(s.error, f.folderNoAiCopy());
  s = await f.req("materialSelect", { scope: s.view.scope, id: s.view.items[0].id, selected: true });
  assert.equal(s.error, f.folderNoAiCopy());
  assert.ok(s.view.items.every((i) => !i.selected));
});

await t("wiring: the config flag follows the file-attach gate", async () => {
  const src = fs.readFileSync(path.join(extension, "src/chatPanelProvider.ts"), "utf8");
  assert.ok(src.includes("...(fileAttachAllowed(toolProfile, isInstructor) ? { materials: true } : {}),"));
});

fs.rmSync(tmp, { recursive: true, force: true });
if (failures.length) { console.error(`activity-materials-host: ${failures.length} failed`); process.exit(1); }
console.log(`activity-materials-host smoke OK (${passed})`);
