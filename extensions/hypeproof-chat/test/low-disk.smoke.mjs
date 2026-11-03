// REQ-KNOW-35 (CGP-KNOW-R-019, DES-KNOW-35): when free space on the work folder's volume is under the
// threshold (setting hypeproofChat.lowDiskWarningMB, default 500 MB), Studio shows a persistent bar
// before a turn writes files; there is no purchase/upgrade control and nothing is held.
//
// 1 is pure (lowDisk.ts): threshold parsing, measurement with errors and a hung mount, the boundary,
//   seat/platform steps, copy rules.
// 2 runs the real ChatPanelProvider.refreshLowDisk against a fake VS Code: every seat, dedupe,
//   remount, folder change mid-measurement, the setting, recovery.
// 3 runs the real handleSend: the bar is posted before the turn reaches its runtime, and a low disk
//   does not hold the send (no inputRejected, the turn still runs).
// 4 checks the manifest setting.
//
// Run: node --experimental-strip-types test/low-disk.smoke.mjs

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";
import { build } from "esbuild";

const L = await import("../src/lowDisk.ts");
const here = path.dirname(fileURLToPath(import.meta.url));
const extRoot = path.join(here, "..");
const require = createRequire(import.meta.url);
const MB = 1024 * 1024;
let passed = 0;
const ok = (name) => { passed++; console.log(`✓ ${name}`); };
const J = (x) => JSON.parse(JSON.stringify(x));
const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "low-disk-")));
const PURCHASE = /구매|결제|업그레이드|요금|플랜|더 받기|용량 추가|upgrade|purchase|buy|get more|plan/i;
const CAPABILITY = /FRAMING|JUDGMENT|ORCHESTRATE|VERIFY|ADAPT|OWNERSHIP|역량|점수/;
const statfsOf = (freeMb) => async () => ({ bavail: BigInt(Math.round(freeMb * 4)), bsize: BigInt(MB / 4) });

try {
  // ── 1. Pure decisions and copy ──
  {
    assert.equal(L.lowDiskThresholdBytes(undefined), 500 * MB, "default 500 MB");
    assert.equal(L.lowDiskThresholdBytes(1024), 1024 * MB);
    assert.equal(L.lowDiskThresholdBytes(0), 0, "0 turns the warning off");
    for (const bad of [-1, NaN, Infinity, "900", null, {}, L.LOW_DISK_MAX_MB + 1]) assert.equal(L.lowDiskThresholdBytes(bad), 500 * MB, `invalid setting ${String(bad)} → default`);
    // Measurement: a real volume, an error, a hung mount, a nonsense answer.
    const real = await L.freeBytesAt(tmp);
    assert.ok(typeof real === "number" && real > 0, "real statfs on this volume");
    assert.equal(await L.freeBytesAt(path.join(tmp, "gone")), null, "a missing folder is unknown, not low");
    assert.equal(await L.freeBytesAt(tmp, async () => { throw new Error("EIO"); }), null);
    const started = Date.now();
    assert.equal(await L.freeBytesAt(tmp, () => new Promise(() => {}), 50), null, "a hung mount times out as unknown");
    assert.ok(Date.now() - started < 1000);
    assert.equal(await L.freeBytesAt(tmp, async () => ({ bavail: -1, bsize: 4096 })), null);
    assert.equal(await L.freeBytesAt(tmp, statfsOf(300)), 300 * MB, "bigint statfs fields");
    // Boundary: under the threshold warns, at or over it does not; unknown and off never warn.
    const t = 500 * MB;
    assert.ok(L.lowDiskNotice({ free: t - 1, threshold: t, platform: "darwin", classroom: false }), "1 byte under → bar");
    assert.equal(L.lowDiskNotice({ free: t, threshold: t, platform: "darwin", classroom: false }), null, "at threshold → none");
    assert.equal(L.lowDiskNotice({ free: 10 * t, threshold: t, platform: "darwin", classroom: false }), null);
    assert.equal(L.lowDiskNotice({ free: null, threshold: t, platform: "darwin", classroom: false }), null, "unknown → none");
    assert.equal(L.lowDiskNotice({ free: 0, threshold: 0, platform: "darwin", classroom: false }), null, "off → none");
    const mac = L.lowDiskNotice({ free: 312 * MB + 5, threshold: t, platform: "darwin", classroom: false });
    assert.deepEqual(mac, {
      text: "저장 공간이 거의 없어요. 새 파일이 저장되지 않을 수 있어요.",
      help: "공간 확보 방법",
      amounts: "남은 공간 312MB · 필요한 여유 500MB",
      steps: ["휴지통을 비워요.", "다운로드 폴더에서 필요 없는 큰 파일을 지워요.", "시스템 설정 → 일반 → 저장 공간에서 정리할 항목을 볼 수 있어요."],
      keep: "지금 있는 파일은 그대로 열 수 있어요. 공간이 생기면 이 안내는 저절로 사라져요.",
    });
    assert.match(L.lowDiskNotice({ free: 1, threshold: t, platform: "win32", classroom: false }).steps[2], /설정 → 시스템 → 저장소/);
    assert.equal(L.lowDiskNotice({ free: 1, threshold: t, platform: "linux", classroom: false }).steps.length, 2);
    assert.deepEqual(L.lowDiskNotice({ free: 1, threshold: t, platform: "darwin", classroom: true }).steps, ["선생님께 저장 공간이 부족하다고 알려 주세요."], "class seats ask the teacher, never delete on a class PC");
    assert.equal(L.formatBytes(1536 * MB), "1.5GB");
    assert.equal(L.formatBytes(1023.9 * MB), "1023MB", "rounded down: never overstates free space");
    assert.equal(L.lowDiskNotice({ free: 1, threshold: 2048 * MB, platform: "darwin", classroom: false }).amounts, "남은 공간 0MB · 필요한 여유 2.0GB");
    const all = JSON.stringify([mac, L.LOW_DISK_COPY]);
    assert.doesNotMatch(all, PURCHASE, "no purchase or upgrade wording anywhere");
    assert.doesNotMatch(all, CAPABILITY, "no capability or score label");
    assert.match(mac.text, /[가-힣]/);
    assert.notEqual(L.lowDiskKey(mac), L.lowDiskKey(L.lowDiskNotice({ free: 100 * MB, threshold: t, platform: "darwin", classroom: false })), "a new amount is a new state");
    assert.equal(L.lowDiskKey(null), "");
    ok("pure: threshold, measurement, boundary, steps, copy");
  }

  // ── 2/3. The real chat host ──
  const bundle = await build({ stdin: { contents: "export {ChatPanelProvider} from './src/chatPanelProvider';", resolveDir: extRoot, loader: "ts" }, bundle: true, platform: "node", format: "cjs", external: ["vscode", "@anthropic-ai/claude-agent-sdk", "zod"], write: false, logLevel: "error" });
  const ws = { folder: tmp, setting: undefined };
  const toUri = (p) => ({ fsPath: p, path: p, scheme: "file" });
  const vscode = {
    ViewColumn: { One: 1, Two: 2, Beside: 2 }, ProgressLocation: { Window: 10, Notification: 15 },
    Uri: { file: toUri, joinPath: (u, ...parts) => toUri(path.join(u.fsPath, ...parts)), parse: (x) => toUri(x) },
    commands: { executeCommand: async () => undefined },
    env: { appName: "HypeProof Studio" },
    window: { showWarningMessage: async () => undefined, showInformationMessage: async () => undefined, showErrorMessage: async () => undefined, withProgress: async (_o, f) => f() },
    workspace: {
      get workspaceFolders() { return ws.folder ? [{ uri: toUri(ws.folder), name: path.basename(ws.folder) }] : undefined; },
      getConfiguration: () => ({ get: (k, fallback) => (k === "lowDiskWarningMB" && ws.setting !== undefined ? ws.setting : fallback) }),
    },
  };
  const fetchHook = { on: undefined };
  const mod = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module: mod, exports: mod.exports, require: (id) => (id === "vscode" ? vscode : require(id)), console: { ...console, log() {}, warn() {}, error() {} }, fetch: (...a) => (fetchHook.on ? fetchHook.on(...a) : Promise.reject(new Error("no network in tests"))), process, Buffer, URL, TextEncoder, TextDecoder, setTimeout, clearTimeout, setInterval, clearInterval, AbortController, AbortSignal, crypto: webcrypto });
  const { ChatPanelProvider } = mod.exports;
  const seats = {
    personal: { profile_id: "p", activity_kind: "personal" },
    trial: { profile_id: "t", activity_kind: "trial" },
    classroom: { profile_id: "c", activity_kind: "classroom" },
    lesson: { profile_id: "l", activity_kind: "classroom", lesson: { content: { title: "수업" } } },
    unknown: undefined,
  };
  const make = (profile, freeMb, instructor = false) => {
    const h = Object.create(ChatPanelProvider.prototype);
    const posts = [];
    Object.assign(h, {
      context: { globalState: { get: () => undefined, update: async () => {} }, workspaceState: { get: () => undefined, update: async () => {} }, secrets: { get: async () => "tok" } },
      cachedProfile: profile, _instructorMode: { isInstructor: instructor },
      post: async (m) => { posts.push(J(m)); return true; },
    });
    h.lowDiskStatfs = typeof freeMb === "function" ? freeMb : statfsOf(freeMb);
    const bars = () => posts.filter((m) => m.type === "lowDisk");
    return { h, posts, bars, last: () => bars().at(-1)?.notice ?? null };
  };
  {
    for (const [seat, profile] of Object.entries(seats)) {
      const { h, last } = make(profile, 300);
      await h.handleMessage({ type: "lowDiskRequest", mount: true });
      const bar = last();
      assert.ok(bar, `${seat}: bar under the threshold`);
      assert.equal(bar.amounts, "남은 공간 300MB · 필요한 여유 500MB");
      assert.equal(bar.steps[0] === "선생님께 저장 공간이 부족하다고 알려 주세요.", seat === "classroom" || seat === "lesson" || seat === "unknown", `${seat}: steps for the seat`);
    }
    const inst = make(seats.classroom, 300, true);
    await inst.h.refreshLowDisk();
    assert.ok(inst.last(), "instructor surface: bar too");
    assert.notEqual(inst.last().steps[0], "선생님께 저장 공간이 부족하다고 알려 주세요.", "the instructor is not told to ask the teacher");
    ok("every seat gets the bar; class seats are told to ask the teacher");

    const { h, bars, last } = make(seats.personal, 300);
    await h.handleMessage({ type: "lowDiskRequest", mount: true });
    await h.handleMessage({ type: "lowDiskRequest" });
    await h.refreshLowDisk();
    assert.equal(bars().length, 1, "an unchanged state is posted once (the live region is not re-announced)");
    await h.handleMessage({ type: "lowDiskRequest", mount: true });
    assert.equal(bars().length, 2, "a remounted panel gets the state again");
    h.lowDiskStatfs = statfsOf(2000);
    await h.refreshLowDisk();
    assert.equal(last(), null, "space freed → the bar goes away");
    ws.setting = 4096;
    await h.refreshLowDisk();
    assert.equal(last().amounts, "남은 공간 1.9GB · 필요한 여유 4.0GB", "the setting raises the threshold");
    ws.setting = 0;
    await h.refreshLowDisk();
    assert.equal(last(), null, "0 turns it off");
    ws.setting = "abc";
    h.lowDiskStatfs = statfsOf(10);
    await h.refreshLowDisk();
    assert.ok(last(), "an invalid setting falls back to 500 MB");
    ws.setting = undefined;
    const before = bars().length;
    h.lowDiskStatfs = async () => { throw new Error("EIO"); };
    await h.refreshLowDisk();
    assert.equal(bars().length, before, "unknown keeps the bar that is up (no flapping on a slow volume)");
    assert.ok(last(), "the bar stays while the last known space was low");
    h.lowDiskStatfs = () => new Promise(() => {});
    const t0 = Date.now();
    await h.refreshLowDisk();
    assert.ok(Date.now() - t0 < 2600, "a hung mount is bounded by the 2 s timeout");
    assert.ok(last(), "a timeout keeps the bar too");
    const fresh = make(seats.personal, async () => { throw new Error("EIO"); });
    await fresh.h.handleMessage({ type: "lowDiskRequest", mount: true });
    assert.equal(fresh.last(), null, "nothing known yet: unknown shows no guessed bar");
    assert.equal(fresh.bars().length, 1, "and says so once");
    ok("dedupe, remount, recovery, setting, unknown");

    // Concurrent requests share one measurement; a folder change mid-measurement drops the stale answer.
    let calls = 0, release;
    const slow = make(seats.personal, () => { calls++; return new Promise((r) => { release = () => r({ bavail: 1, bsize: 1 }); }); });
    const a = slow.h.refreshLowDisk(), b = slow.h.refreshLowDisk();
    ws.folder = path.join(tmp, "other");
    slow.h.lowDiskStatfs = statfsOf(100);
    release(); await a; await b;
    assert.equal(calls, 1, "one measurement for concurrent requests");
    assert.ok(!slow.bars().some((m) => m.notice && m.notice.amounts.includes("0MB ·")), "the old folder's answer is never posted");
    await new Promise((r) => setTimeout(r, 20));
    await slow.h.lowDiskRun;
    assert.equal(slow.last()?.amounts, "남은 공간 100MB · 필요한 여유 500MB", "the new folder is measured right away");
    ws.folder = tmp;
    const none = make(seats.personal, 1);
    ws.folder = undefined;
    await none.h.refreshLowDisk();
    assert.equal(none.last(), null, "no folder: nothing to measure");
    ws.folder = tmp;
    ok("concurrency and folder change");
  }

  // ── 3. The real handleSend: the bar is up before the turn's runtime starts, and nothing is held ──
  // A classroom seat on the proxy runtime: the first thing the runtime does is the model request (fetch),
  // which is the earliest point a turn could lead to a file write.
  {
    const profile = { ...seats.classroom, ux: { coach: { naming_mode: "fixed", fallback_name: "HypeProof", naming_prompt_md: "", personality_prompt_md: "" }, suggestions: { initial: [], follow_up: [] }, hints: { short_input: { enabled: false, min_chars: 0, message_md: "" }, roll_input_button: { enabled: false, label: "", probe_md: "" } }, retry_button: { enabled: false, show_counter: false } } };
    // The measurement answers when the model request arrives, or after 1.5 s (under freeBytesAt's 2 s timeout).
    // An awaited check therefore waits the 1.5 s and posts first; an unawaited one lets the request through first.
    let answer;
    const { h, posts } = make(profile, () => new Promise((r) => { answer = () => r({ bavail: 300, bsize: MB }); setTimeout(answer, 1500); }));
    const order = [];
    h.post = async (m) => { posts.push(J(m)); order.push(m.type); return true; };
    Object.assign(h, {
      pendingSends: 0, activeStreams: new Map(), delegationControls: new Map(), turnRequests: new Map(),
      ensureProfile: async () => profile,
      elementQueue: { take: () => undefined }, verifySession: { running: false, takeCoachContext: () => undefined },
      crSdkResults: { reset() {}, onToolUse() {}, onToolResult() {} }, finishNotice: { release() {}, turnEnded() {} },
      funnel: { emit() {} }, liveServer: { currentUrl: () => undefined }, turnTimelines: new Map(),
      getHistory: () => [], appendHistory: async () => {}, postHistory: async () => {},
    });
    // Pre-turn calls (the access check) fail harmlessly; the model request is the chat completion.
    fetchHook.on = (u) => { const url = String(u?.url ?? u); const model = /\/chat\/completions$/.test(url); order.push(model ? "model-request" : `fetch:${new URL(url).pathname}`); if (model) answer?.(); throw new Error("stop: no network in tests"); };
    try { await h.handleSend("파일 만들어 줘", [], undefined, undefined, undefined, undefined, "u1"); } catch { /* the stop above */ }
    fetchHook.on = undefined;
    const barAt = order.indexOf("lowDisk"), requestAt = order.indexOf("model-request");
    assert.ok(requestAt >= 0, `a low disk does not hold the send: the turn reached its model request (${order.join(" → ")})`);
    assert.ok(barAt >= 0 && barAt < requestAt, `the bar is posted before the turn's model request (${order.join(" → ")})`);
    assert.equal(posts.find((m) => m.type === "lowDisk").notice.amounts, "남은 공간 300MB · 필요한 여유 500MB");
    ok("handleSend: bar before the model request, send not held");
  }

  // ── 4. Manifest ──
  {
    const pkg = JSON.parse(fs.readFileSync(path.join(extRoot, "package.json"), "utf8"));
    const s = pkg.contributes.configuration.properties["hypeproofChat.lowDiskWarningMB"];
    assert.equal(s.type, "number");
    assert.equal(s.default, 500, "default 500 MB");
    assert.equal(s.minimum, 0);
    assert.equal(s.scope, "machine", "a workspace cannot silence the warning");
    assert.match(s.description, /^[가-힣]/);
    ok("manifest setting");
  }
  console.log(`PASS low-disk: ${passed} groups`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
