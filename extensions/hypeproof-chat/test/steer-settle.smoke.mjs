// REQ-STUDIO-STEER-NOW (CGP-CHAT-R-012), verifier F1: a stopped turn posts `streamStopped` at once
// but keeps the work-folder lock until its cleanup (saving the partial answer) ends. The steer sends
// the parked text right on that stop, so the host must start the next turn only after the stopped
// one settled — otherwise the send is refused as "다른 창에서 이 폴더를 사용 중입니다".
//
// The actual provider, bundled with esbuild; the model runtime, the activity verification and the
// activity connections are scripted. The connection lock behaves like the real one for a second
// acquire in the same process (test/activity-connections.smoke.mjs: same pid → "다른 창").
// No network, CLI, model call or VS Code window.
import assert from "node:assert/strict";
import vm from "node:vm";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { waitAtMost, turnSettleSignal, TURN_SETTLE_WAIT_MS, TURN_SETTLING_REFUSAL } from "../src/turnSettle.ts";

const require = createRequire(import.meta.url), extension = fileURLToPath(new URL("..", import.meta.url));
const copy = (v) => JSON.parse(JSON.stringify(v));
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const ok = (label) => { passed++; console.log(`✓ ${label}`); };

// ── pure: the bounded wait ───────────────────────────────────────────────────
{
  const s = turnSettleSignal();
  let done = false;
  const w = waitAtMost(s.promise, 1000).then((settled) => { done = settled; });
  await tick(5);
  assert.equal(done, false, "waits while the previous turn is settling");
  s.settled(); await w;
  assert.equal(done, true, "reports that the previous turn settled");
  const t0 = Date.now();
  assert.equal(await waitAtMost(new Promise(() => {}), 30), false, "reports that the wait ran out");
  assert.ok(Date.now() - t0 < 500, "a turn that never settles holds the next one only up to the cap");
  assert.equal(await waitAtMost(Promise.reject(new Error("x")), 1000), true);
  assert.equal(await waitAtMost(undefined, 1000), true);
  ok("waitAtMost: waits for the previous turn, is capped, tolerates a rejection and no previous turn");
}

// ── the actual provider ──────────────────────────────────────────────────────
const bundle = await build({
  stdin: { contents: "export {ChatPanelProvider} from './src/chatPanelProvider';", resolveDir: extension, loader: "ts" },
  bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false, logLevel: "silent",
  plugins: [{ name: "scripted-runtime", setup(b) {
    const swap = { "./proxyClient": "proxy", "./activityConnections": "connections" };
    b.onResolve({ filter: /^\.\/(proxyClient|activityConnections)$/ }, (args) => args.importer.endsWith("/chatPanelProvider.ts") ? { path: swap[args.path], namespace: "runtime" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "runtime" }, (args) => ({ loader: "ts", resolveDir: extension, contents: args.path === "proxy"
      ? `export * from ${JSON.stringify(path.join(extension, "src/proxyClient.ts"))}; export const proxyChat=(a)=>globalThis.runtime.proxy(a); export const verifyActivity=async()=>{};`
      : `import { ActivityConnectionError } from ${JSON.stringify(path.join(extension, "src/activityConnections.ts"))}; export * from ${JSON.stringify(path.join(extension, "src/activityConnections.ts"))}; globalThis.runtime.ActivityConnectionError = ActivityConnectionError; export const activityConnections=()=>globalThis.runtime.connections;` }));
  } }],
});

/**
 * `capMs` stands in for the 15 s cap (a fake clock for that one timer: every other delay is real);
 * `cleanupMs` is how long the stopped turn takes to save its partial answer.
 */
function fixture({ fixed = true, capMs = TURN_SETTLE_WAIT_MS, cleanupMs = 40 } = {}) {
  const posts = [], history = [], proxyCalls = [];
  let held = false;
  const connections = {
    scope: "a1", current: { service: "http://127.0.0.1:1/v1", serverId: "srv" },
    token: async () => "synthetic-token",
    acquire() {
      if (held) throw new runtime.ActivityConnectionError("다른 창에서 이 폴더를 사용 중입니다. 작업이 끝난 뒤 다시 보내 주세요.");
      held = true;
      return () => { held = false; };
    },
  };
  const runtime = { connections, proxy: null };
  const vscode = { env: { appName: "HypeProof Studio" }, workspace: { getConfiguration: () => ({ get: (k, f) => ({ coachRuntime: "proxy", proxyUrl: "http://127.0.0.1:1/v1" })[k] ?? f }) }, window: { createOutputChannel: () => ({ appendLine() {} }) }, Uri: { file: (fsPath) => ({ fsPath }) } };
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports, runtime, console, process: { ...process, env: { PATH: process.env.PATH } },
    require: (id) => id === "vscode" ? vscode : require(id),
    Buffer, URL, TextEncoder, TextDecoder, AbortController, AbortSignal, DOMException, crypto: globalThis.crypto, clearTimeout,
    setTimeout: (fn, ms, ...rest) => setTimeout(fn, ms === TURN_SETTLE_WAIT_MS ? capMs : ms, ...rest),
    fetch: async () => { throw new Error("Network is forbidden in this test"); },
  });
  const { ChatPanelProvider } = module.exports;
  const h = Object.create(ChatPanelProvider.prototype), state = new Map();
  const profile = { profile_id: "class-a", activity_kind: "classroom", ux: { coach: { naming_mode: "fixed", fallback_name: "코치" } } };
  Object.assign(h, {
    context: { workspaceState: { get: (k, f) => state.get(k) ?? f, update: async (k, v) => state.set(k, v) }, secrets: { get: async () => "synthetic-token" } },
    nativeHistoryScope: "task-a", pendingSends: 0, activeStreams: new Map(), turnTimelines: new Map(), turnRequests: new Map(),
    _instructorMode: { isInstructor: false, onTurnSuccess() {}, async revertModelOnTurnError() {} }, cachedProfile: profile,
    getHistory: () => history,
    // The stopped turn's partial answer is saved here before the lock is released; make that take a moment.
    appendHistory: async (items) => { await tick(cleanupMs); for (const it of items) history.push(copy(it)); },
    post: async (e) => { posts.push(copy(e)); }, postConfig: async () => {}, getCoach: () => ({ name: "코치", personality: "", configured: true }),
    ensureProfile: async () => profile, loadAccess: async () => {},
    pullQuestResultFromPreview: async () => {}, elementQueue: { take: () => undefined }, verifySession: { running: false, takeCoachContext: () => null, endTurn() {} },
    isCurriculumRuntimeEnabled: () => false, takeProjectSwitchBrief: async () => null, isLearningWikiEnabled: () => false,
    prepareObservation: async () => null, crBlobSinkFor: () => undefined, savePastedImages: async () => ({ note: "" }), commitAttachedImages: () => "",
    resolveCoachCwd: () => undefined, crSdkResults: { reset() {}, onToolUse() {}, onToolResult() {} }, liveServer: { currentUrl: () => undefined },
    buildBrowserMcpHost: () => ({}), saveAgentMdIfPresent: async () => {}, observationWrites: Promise.resolve(), sitePublisher: () => ({ available: () => false }),
  });
  if (!fixed) h.handleSend = withoutSettle(h, ChatPanelProvider.prototype.handleSend);
  return { h, posts, history, proxyCalls, runtime };
}

/** Negative control: the same provider with the settle wait taken out (the shipped faa61367 order). */
function withoutSettle(h, original) {
  return function (...args) { h.turnSettling = undefined; return original.apply(h, args).finally(() => { h.turnSettling = undefined; }); };
}

async function steerScenario(f) {
  // Turn 1 streams a partial answer and then waits until it is stopped.
  f.runtime.proxy = async (a) => {
    f.proxyCalls.push(a);
    if (f.proxyCalls.length === 1) {
      a.onDelta("고양이를 파랗게");
      await new Promise((_, reject) => a.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
    }
    a.onDelta("강아지로 바꿀게요");
    return { text: "강아지로 바꿀게요", toolUses: [] };
  };
  const first = f.h.handleMessage({ type: "sendMessage", activityId: "a1", text: "고양이 그려 줘", history: [], toolMode: "auto", userMessageId: "u-1" });
  for (let i = 0; i < 100 && !f.posts.some((e) => e.type === "streamStart"); i++) await tick(2);
  const streamId = f.posts.find((e) => e.type === "streamStart").streamId;
  // The steer: Stop, and on streamStopped the parked text goes out at once.
  await f.h.handleMessage({ type: "cancelStream", streamId });
  assert.ok(f.posts.some((e) => e.type === "streamStopped"), "the stop is announced at once");
  const second = f.h.handleMessage({ type: "sendMessage", activityId: "a1", text: "아니, 강아지로 바꿔 줘", history: [], toolMode: "auto", userMessageId: "u-2" });
  await Promise.all([first, second]);
}

{
  // The cap is 1 s here: a settle signal that is never resolved would run it out and refuse the send.
  const f = fixture({ capMs: 1000 });
  const t0 = Date.now();
  await steerScenario(f);
  assert.ok(Date.now() - t0 < 900, `the steered send starts when the stopped turn settles, not at the cap (${Date.now() - t0} ms)`);
  const errors = f.posts.filter((e) => e.type === "streamError");
  assert.deepEqual(errors.map((e) => e.error), [], "the steered send is not refused");
  assert.equal(f.posts.some((e) => e.type === "inputRejected"), false, "nothing handed back");
  assert.equal(f.proxyCalls.length, 2, "the steered turn reached the model");
  assert.equal(f.posts.filter((e) => e.type === "streamStart").length, 2, "the host started the steered turn");
  const sentHistory = JSON.stringify(f.proxyCalls[1].history);
  assert.ok(sentHistory.includes("고양이를 파랗게"), "the steered turn's history holds the stopped partial answer");
  assert.deepEqual(f.posts.filter((e) => e.type === "streamStart").map((e) => e.userMessageId), ["u-1", "u-2"], "each start names its own request");
  assert.equal(f.h.pendingSends, 0); assert.equal(f.h.activeStreams.size, 0);
  assert.equal(f.h.turnSettling, undefined, "the settle state is released once both turns ended");
  ok("stop then immediate send: the host waits for the stopped turn to release the folder and accepts the send");
}

{
  // Negative control: without the settle wait, the same sequence is refused by the lock.
  const f = fixture({ fixed: false });
  await steerScenario(f);
  const refused = f.posts.filter((e) => e.type === "streamError").map((e) => e.error);
  assert.ok(refused.some((m) => /다른 창/.test(m)), `control: refused by the lock (${JSON.stringify(refused)})`);
  assert.equal(f.proxyCalls.length, 1, "control: the steered turn never reached the model");
  ok("control: the shipped order (no settle wait) is refused with \"다른 창에서 이 폴더를 사용 중입니다\"");
}

{
  // A normal turn followed by a send after it ended is not delayed.
  const f = fixture();
  f.runtime.proxy = async (a) => { f.proxyCalls.push(a); a.onDelta("답"); return { text: "답", toolUses: [] }; };
  await f.h.handleMessage({ type: "sendMessage", activityId: "a1", text: "하나", history: [], toolMode: "auto", userMessageId: "u-a" });
  assert.equal(f.h.turnSettling, undefined, "released after a normal turn");
  const second = f.h.handleMessage({ type: "sendMessage", activityId: "a1", text: "둘", history: [], toolMode: "auto", userMessageId: "u-b" });
  assert.equal(f.h.pendingSends, 1, "owns its slot synchronously");
  await second;
  assert.equal(f.proxyCalls.length, 2);
  assert.equal(f.h.turnSettling, undefined, "released again");
  ok("the settle state is released after every turn; a send after a settled turn starts without waiting");
}

{
  // F-A: the stopped turn's cleanup outlasts the cap. The lock is this window's own turn, so the
  // refusal must say the stopped answer is being tidied up, never "another window".
  const f = fixture({ capMs: 10, cleanupMs: 300 });
  await steerScenario(f);
  const errors = f.posts.filter((e) => e.type === "streamError").map((e) => e.error);
  assert.deepEqual(errors, [TURN_SETTLING_REFUSAL], `the refusal names the real reason (${JSON.stringify(errors)})`);
  assert.equal(errors.some((m) => /다른 창/.test(m)), false, "never \"다른 창\"");
  assert.ok(f.posts.some((e) => e.type === "inputRejected" && e.text === "아니, 강아지로 바꿔 줘"), "the text is handed back");
  assert.equal(f.proxyCalls.length, 1, "nothing reached the model");
  assert.equal(f.h.turnSettling, undefined, "released after both ended");
  ok("cleanup longer than the cap: refused with \"중단한 응답을 정리하고 있어요\", text handed back");
}

console.log(`\nsteer-settle: ${passed} checks passed`);
