// 침묵 구간 안내 줄을 닫는 경로(요약 모드 WorkLine.close / 일반 모드 postToolLog)가
// 쓰기 성공 여부를 각각 따르는가. 두 경로의 호출은 서로 다른 배열에 따로 모은다.
//
// Run: node --experimental-strip-types test/close-pending.smoke.mjs

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";

const { closePendingLine } = await import("../src/chatPanelHelpers.ts");
const { PublishReadGate } = await import("../src/publishReadGate.ts");

// The real provider and WorkLine, driven by a real sendMessage. Only the SDK runtime and
// VS Code are scripted, so no network, CLI or paid call happens.
const require = createRequire(import.meta.url);
const extension = fileURLToPath(new URL("..", import.meta.url));
const bundle = await build({
  stdin: {
    contents: "export {ChatPanelProvider} from './src/chatPanelProvider'; export {WorkLine} from './src/toolActivity';",
    resolveDir: extension,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  write: false,
  logLevel: "silent",
  plugins: [{
    name: "scripted-sdk",
    setup(b) {
      b.onResolve({ filter: /^\.\/sdkCoach$/ }, (args) =>
        args.importer.endsWith("/chatPanelProvider.ts") ? { path: "sdk", namespace: "runtime" } : undefined);
      b.onLoad({ filter: /.*/, namespace: "runtime" }, () => ({
        loader: "ts",
        resolveDir: extension,
        contents: `export * from ${JSON.stringify(path.join(extension, "src/sdkCoach.ts"))}; export const runSdkCoach=(args)=>globalThis.runtime.sdk(args);`,
      }));
    },
  }],
});

const appData = mkdtempSync(path.join(tmpdir(), "hps-close-pending-"));
process.on("exit", () => rmSync(appData, { recursive: true, force: true }));

const baseProfile = {
  profile_id: "synthetic-close-pending",
  tools: { web_search: true },
  coach_runtime: "agent-sdk",
  sdk_tools: { read: true, write: true, browser: true, subagents: true },
  ux: { coach: { naming_mode: "fixed", fallback_name: "코치" } },
};

/** Close calls land in `closeCalls`, direct pending-line logs in `logCalls`, never both. */
function providerFixture(toolActivity, { throwOnFirstClose = false } = {}) {
  const resolvedProfile = { ...baseProfile, tool_activity: toolActivity };
  const posts = [];
  const history = [];
  const closeCalls = [];
  const logCalls = [];
  const runtime = { sdk: async () => ({ kind: "success" }) };
  const values = { coachRuntime: "agent-sdk", proxyUrl: "http://127.0.0.1:1/v1" };
  const vscode = {
    env: { appName: "HypeProof Studio" },
    workspace: { getConfiguration: () => ({ get: (key, fallback) => values[key] ?? fallback }) },
    window: { createOutputChannel: () => ({ appendLine() {} }) },
    Uri: { file: (fsPath) => ({ fsPath }) },
  };
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports,
    require: (id) => (id === "vscode" ? vscode : require(id)),
    runtime, console,
    process: { ...process, env: { PATH: process.env.PATH, APPDATA: appData } },
    Buffer, URL, TextEncoder, TextDecoder, AbortController, AbortSignal, DOMException,
    crypto: globalThis.crypto, setTimeout, clearTimeout,
    fetch: async () => { throw new Error("Network is forbidden in this test"); },
  });
  const { ChatPanelProvider, WorkLine } = module.exports;

  let insideWorkClose = 0;
  let throwPending = throwOnFirstClose;
  const throwOnce = () => {
    if (!throwPending) return;
    throwPending = false;
    throw new Error("synthetic close failure");
  };
  const realClose = WorkLine.prototype.close;
  WorkLine.prototype.close = function (label) {
    closeCalls.push(label);
    throwOnce();
    insideWorkClose += 1;
    try {
      return realClose.call(this, label);
    } finally {
      insideWorkClose -= 1;
    }
  };

  const h = Object.create(ChatPanelProvider.prototype);
  const state = new Map();
  const context = {
    workspaceState: { get: (key, fallback) => state.get(key) ?? fallback, update: async (key, value) => state.set(key, value) },
    secrets: { get: async () => "synthetic-test-token" },
    globalState: { get: (_key, fallback) => fallback, update: async () => {} },
  };
  Object.assign(h, {
    context, nativeHistoryScope: "task-a", pendingSends: 0, activeStreams: new Map(), delegationControls: new Map(),
    turnTimelines: new Map(), turnRequests: new Map(),
    _instructorMode: { isInstructor: false, onTurnSuccess() {}, async revertModelOnTurnError() {} },
    cachedProfile: resolvedProfile, getHistory: () => history,
    appendHistory: async (items) => {
      for (const item of items) {
        const i = history.findIndex((previous) => previous.id === item.id);
        if (i < 0) history.push(item);
        else history[i] = item;
      }
    },
    post: async (event) => { posts.push(JSON.parse(JSON.stringify(event))); },
    postConfig: async () => {}, getCoach: () => ({ name: "코치", personality: "", configured: true }),
    ensureProfile: async () => resolvedProfile, loadAccess: async () => {},
    pullQuestResultFromPreview: async () => {}, elementQueue: { take: () => undefined },
    verifySession: { running: false, takeCoachContext: () => null, endTurn() {} },
    isCurriculumRuntimeEnabled: () => false, takeProjectSwitchBrief: async () => null, isLearningWikiEnabled: () => false,
    prepareObservation: async () => null, crBlobSinkFor: () => undefined,
    savePastedImages: async () => ({ note: "" }), commitAttachedImages: () => "",
    resolveCoachCwd: () => undefined, crSdkResults: { reset() {}, onToolUse() {}, onToolResult() {} },
    liveServer: { currentUrl: () => undefined }, buildBrowserMcpHost: () => ({}), saveAgentMdIfPresent: async () => {},
    observationWrites: Promise.resolve(), sitePublisher: () => ({ available: () => false }),
    funnel: { emit() {}, setTarget() {}, active: false }, turnWriteTrackers: new Map(),
    publishReadGate: new PublishReadGate(),
  });
  const realPostToolLog = ChatPanelProvider.prototype.postToolLog;
  h.postToolLog = function (streamId, entry) {
    if (!insideWorkClose && String(entry.id).startsWith("pending-") && entry.state === "done") {
      logCalls.push({ label: entry.label, state: entry.state });
      throwOnce();
    }
    return realPostToolLog.call(this, streamId, entry);
  };

  let sends = 0;
  const send = async (script) => {
    runtime.sdk = async (args) => { await script(args); return { kind: "success" }; };
    sends += 1;
    await h.handleMessage({ type: "sendMessage", text: "작업을 도와줘", history: [], toolMode: "auto", userMessageId: `close-${sends}` });
    assert.equal(posts.some((event) => event.type === "streamError"), false, "the turn must finish without an error");
  };
  const shownCloses = () => posts
    .filter((event) => event.type === "toolLog" && String(event.id).startsWith("pending-") && event.state === "done")
    .map((event) => event.label);
  return { send, closeCalls, logCalls, shownCloses };
}

const use = (args, id, name) => args.onActivity({ kind: "tool_use", id, name, input: { file_path: "notes.txt" } });
const result = (args, id, isError = false) => args.onActivity({ kind: "tool_result", id, isError, ...(isError ? { reason: "synthetic failure" } : {}) });
const readOnly = (args) => { use(args, "read-1", "Read"); result(args, "read-1"); };
const failedWrite = (args) => { use(args, "write-1", "Write"); result(args, "write-1", true); };
// A failed tool result does not open the line by itself, so a successful read follows it.
const failedWriteThenRead = (args) => { failedWrite(args); readOnly(args); };
const retriedWrite = (args) => { failedWrite(args); use(args, "write-2", "Write"); result(args, "write-2"); };

async function test_tc_0088_provider_summary_turn_without_write() {
  for (const script of [readOnly, failedWriteThenRead]) {
    const f = providerFixture("summary");
    await f.send(script);
    assert.deepEqual(f.closeCalls, ["생각했어요"]);
    assert.deepEqual(f.logCalls, [], "요약 모드 입력이 일반 모드 경로로 처리됐다");
    assert.deepEqual(f.shownCloses(), ["생각했어요"]);
  }
}

async function test_tc_0089_provider_normal_turn_without_write() {
  for (const script of [readOnly, failedWriteThenRead]) {
    const f = providerFixture("detailed");
    await f.send(script);
    assert.deepEqual(f.closeCalls, [], "일반 모드 입력이 요약 모드 경로로 처리됐다");
    assert.deepEqual(f.logCalls, [{ label: "생각했어요", state: "done" }]);
    assert.deepEqual(f.shownCloses(), ["생각했어요"]);
  }
}

async function test_tc_0090_provider_summary_turn_after_write_retry() {
  const f = providerFixture("summary");
  await f.send(retriedWrite);
  assert.deepEqual(f.closeCalls, ["고쳤어요"]);
  assert.deepEqual(f.logCalls, [], "요약 모드 입력이 일반 모드 경로로 처리됐다");
  assert.deepEqual(f.shownCloses(), ["고쳤어요"]);
}

async function test_tc_0091_provider_normal_turn_after_write_retry() {
  const f = providerFixture("detailed");
  await f.send(retriedWrite);
  assert.deepEqual(f.closeCalls, []);
  assert.deepEqual(f.logCalls, [{ label: "고쳤어요", state: "done" }]);
  assert.deepEqual(f.shownCloses(), ["고쳤어요"]);
}

async function test_tc_0091_provider_normal_next_tool_closes_after_write() {
  const f = providerFixture("detailed");
  await f.send((args) => {
    use(args, "write-1", "Write");
    result(args, "write-1");
    use(args, "read-2", "Read");
    assert.deepEqual(f.logCalls, [{ label: "고쳤어요", state: "done" }], "다음 도구가 시작되면 줄이 닫힌다");
    result(args, "read-2");
    args.onDelta("답변");
  });
  assert.deepEqual(f.closeCalls, []);
  assert.deepEqual(f.shownCloses(), ["고쳤어요", "고쳤어요"]);
}

async function test_tc_0092_provider_nothing_called_when_line_never_shown() {
  for (const mode of ["summary", "detailed"]) {
    const f = providerFixture(mode);
    await f.send((args) => args.onDelta("바로 답변"));
    assert.deepEqual(f.closeCalls, [], mode);
    assert.deepEqual(f.logCalls, [], mode);
    assert.deepEqual(f.shownCloses(), [], mode);
  }
}

async function test_tc_0092_provider_answer_close_is_not_repeated_at_turn_end() {
  for (const [mode, calls] of [["summary", "closeCalls"], ["detailed", "logCalls"]]) {
    const f = providerFixture(mode);
    await f.send((args) => { readOnly(args); args.onDelta("답변"); args.onDelta(" 이어서"); });
    assert.equal(f[calls].length, 1, `${mode}: 답변 시작에서 한 번만 닫힌다`);
    assert.deepEqual(f.shownCloses(), ["생각했어요"], mode);
  }
}

async function test_tc_0092_provider_throwing_close_is_not_retried() {
  for (const [mode, calls, other] of [["summary", "closeCalls", "logCalls"], ["detailed", "logCalls", "closeCalls"]]) {
    const f = providerFixture(mode, { throwOnFirstClose: true });
    await f.send((args) => {
      readOnly(args);
      assert.throws(() => args.onDelta("답변"), /synthetic close failure/);
      args.onDelta("다시 이어진 답변");
    });
    assert.equal(f[calls].length, 1, `${mode}: 실패한 닫기를 다시 시도하면 안 된다`);
    assert.equal(f[other].length, 0, mode);
  }
}

async function test_tc_0089_provider_new_request_does_not_inherit_write() {
  for (const [mode, labels] of [
    ["summary", (f) => f.closeCalls],
    ["detailed", (f) => f.logCalls.map((entry) => entry.label)],
  ]) {
    const f = providerFixture(mode);
    await f.send((args) => { use(args, "write-1", "Write"); result(args, "write-1"); });
    await f.send(readOnly);
    assert.deepEqual(labels(f), ["고쳤어요", "생각했어요"], mode);
  }
}

function run({ summary, wroteOk, pendingShown }) {
  const closeCalls = [];
  const logCalls = [];
  const work = summary ? { close: (label) => closeCalls.push(label) } : undefined;
  closePendingLine({
    pendingShown,
    wroteOk,
    work,
    postToolLog: (entry) => logCalls.push(entry),
  });
  return { closeCalls, logCalls };
}

function test_tc_0088_summary_mode_close_without_write() {
  const { closeCalls, logCalls } = run({ summary: true, wroteOk: false, pendingShown: true });
  assert.deepEqual(closeCalls, ["생각했어요"]);
  assert.equal(logCalls.length, 0, "요약 모드 입력이 일반 모드 경로로 처리됐다");
}

function test_tc_0089_normal_mode_close_without_write() {
  const { closeCalls, logCalls } = run({ summary: false, wroteOk: false, pendingShown: true });
  assert.equal(closeCalls.length, 0);
  assert.equal(logCalls.length, 1);
  assert.equal(logCalls[0].label, "생각했어요");
  assert.equal(logCalls[0].state, "done");
}

function test_tc_0090_summary_mode_close_after_write() {
  const { closeCalls, logCalls } = run({ summary: true, wroteOk: true, pendingShown: true });
  assert.deepEqual(closeCalls, ["고쳤어요"]);
  assert.equal(logCalls.length, 0);
}

function test_tc_0091_normal_mode_close_after_write() {
  const { closeCalls, logCalls } = run({ summary: false, wroteOk: true, pendingShown: true });
  assert.equal(closeCalls.length, 0);
  assert.equal(logCalls.length, 1);
  assert.equal(logCalls[0].label, "고쳤어요");
  assert.equal(logCalls[0].state, "done");
}

function test_tc_0092_nothing_called_when_line_not_shown() {
  for (const summary of [true, false]) {
    for (const wroteOk of [true, false]) {
      const { closeCalls, logCalls } = run({ summary, wroteOk, pendingShown: false });
      assert.equal(closeCalls.length, 0);
      assert.equal(logCalls.length, 0);
    }
  }
}

function test_clear_pending_source_uses_helper() {
  const src = readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
  assert.match(src, /const clearPending = \(\) => \{[\s\S]{0,400}closePendingLine\(/, "clearPending must call closePendingLine");
}

for (const t of [
  test_tc_0088_summary_mode_close_without_write,
  test_tc_0089_normal_mode_close_without_write,
  test_tc_0090_summary_mode_close_after_write,
  test_tc_0091_normal_mode_close_after_write,
  test_tc_0092_nothing_called_when_line_not_shown,
  test_clear_pending_source_uses_helper,
  test_tc_0088_provider_summary_turn_without_write,
  test_tc_0089_provider_normal_turn_without_write,
  test_tc_0089_provider_new_request_does_not_inherit_write,
  test_tc_0090_provider_summary_turn_after_write_retry,
  test_tc_0091_provider_normal_turn_after_write_retry,
  test_tc_0091_provider_normal_next_tool_closes_after_write,
  test_tc_0092_provider_nothing_called_when_line_never_shown,
  test_tc_0092_provider_answer_close_is_not_repeated_at_turn_end,
  test_tc_0092_provider_throwing_close_is_not_retried,
]) {
  await t();
  console.log(`✓ ${t.name}`);
}
console.log("\nclose-pending smoke: ok");
