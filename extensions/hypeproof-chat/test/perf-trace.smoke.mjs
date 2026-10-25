// CGP-AGENT-R-030 / REQ-STUDIO-PERF-TRACE — "느려요 기록" performance trace. Pure recorder rules, then the real host
// controller with VS Code replaced at the bundle boundary and fetch intercepted (nothing reaches a network), then the
// real ChatPanelProvider's seat rule and post() hook. What must hold:
//   P1  turns are bound to their stream id; chunks of another or a finished turn never move a turn; no text or id is kept.
//   P2  seat rule: instructor, or a resolved non-minor profile; no profile or a minor (incl. unknown tier) is refused.
//   P3  the send summary stays under the Service's 8 KB attachments cap even at 200 turns, keeping the newest turns.
//   P4  the note drops control, bidi, zero-width and line-separator characters and is capped.
//   P5  the consent lines in the start dialog are §8 of docs/session-log-consent.ko.md, verbatim.
//   H1  setting off or a refused seat opens nothing; only the 기록 시작 button starts; the red pill names its stop command.
//   H2  stop writes the trace on this machine only; the review shows the real file size, keep is the first button,
//       and keep or a closed dialog sends nothing.
//   H3  보내기: the outbound confirmation lists the frozen body's items; cancel sends nothing; approve POSTs it once.
//   H4  the recording stops by itself at ten minutes and when the seat stops qualifying; a double stop is harmless.
//   H5  the real provider: perfTraceSeatAllowed() and the post() hook that feeds the recorder.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, statSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url)), ext = path.resolve(here, ".."), repo = path.resolve(ext, "../..");
const require = createRequire(path.join(ext, "package.json"));
const { build } = require("esbuild");
let pass = 0;
const J = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
// Values built inside the vm realm have other prototypes; compare their JSON.
const deq = (a, b, m) => assert.deepEqual(J(a), J(b), m);
const ok = (label) => { pass++; console.log("  ok   " + label); };

async function load(entry, stubs = {}) {
  const plugins = [{ name: "stubs", setup(b) {
    for (const [filter, contents] of Object.entries(stubs)) {
      b.onResolve({ filter: new RegExp(filter) }, () => ({ path: filter, namespace: "stub" }));
      b.onLoad({ filter: new RegExp(filter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), namespace: "stub" }, () => ({ contents, loader: "js" }));
    }
  } }];
  const out = await build({ ...(entry.startsWith("export ") ? { stdin: { contents: entry, resolveDir: ext, sourcefile: "entry.ts", loader: "ts" } } : { entryPoints: [path.join(ext, entry)] }), bundle: true, platform: "node", format: "cjs", write: false, external: ["vscode"], plugins, logLevel: "silent" });
  return (vscode, fetchImpl = async () => { throw Error("no network in this test"); }) => {
    const mod = { exports: {} };
    vm.runInNewContext(out.outputFiles[0].text, { module: mod, exports: mod.exports, require: (id) => (id === "vscode" ? vscode : require(id)), fetch: (...a) => fetchImpl(...a),
      console: { log() {}, error() {}, warn() {} }, Buffer, process, setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, AbortSignal, AbortController, URL, TextEncoder, TextDecoder, Response, crypto: webcrypto, structuredClone });
    return mod.exports;
  };
}

const pure = (await load("src/perfTrace.ts"))({});
const { PerfTraceRecorder, perfTraceSeatAllowed, perfTraceSummary, cleanNote, PERF_TRACE_CONSENT_LINES, PERF_TRACE_MAX_MS, PERF_TRACE_SEND_MAX } = pure;
const ENV = { studioVersion: "0.0.0-synthetic", os: "synthetic-os" };

// ── P1 ──
{
  const r = new PerfTraceRecorder(1000);
  r.observe({ type: "streamStart", streamId: "s-A" }, 1000);
  r.observe({ type: "streamChunk", streamId: "s-B", delta: "PRIVATE-B" }, 1100); // not started: ignored
  r.observe({ type: "streamStart", streamId: "s-B" }, 1200);
  r.observe({ type: "streamChunk", streamId: "s-A", delta: "PRIVATE-A" }, 1500);
  r.observe({ type: "streamChunk", streamId: "s-B", delta: "PRIVATE-B" }, 1700);
  r.observe({ type: "streamChunk", streamId: "s-A", delta: "PRIVATE-A" }, 1800);
  r.observe({ type: "streamEnd", streamId: "s-A" }, 3000);
  r.observe({ type: "streamChunk", streamId: "s-A", delta: "late" }, 3100); // finished turn: ignored
  r.observe({ type: "streamEnd", streamId: "s-A", failed: true }, 3200);    // a second end does not overwrite
  r.observe({ type: "streamError", streamId: "s-B", error: "PRIVATE-ERR" }, 4200);
  r.observe({ type: "streamStart", streamId: "s-C" }, 5000);
  r.observe({ type: "streamStopped", streamId: "s-C" }, 5600);
  r.observe({ type: "streamStart", streamId: "s-D" }, 6000);
  r.observe({ type: "streamEnd", streamId: "s-D", failed: true }, 6400);
  r.observe({ type: "streamStart", streamId: "s-E" }, 7000);
  const t = r.finish(8000, "learner", ENV);
  deq(t.turns, [
    { start_ms: 0, first_chunk_ms: 500, total_ms: 2000, chunks: 2, outcome: "end" },
    { start_ms: 200, first_chunk_ms: 500, total_ms: 3000, chunks: 1, outcome: "error" },
    { start_ms: 4000, first_chunk_ms: null, total_ms: 600, chunks: 0, outcome: "stopped" },
    { start_ms: 5000, first_chunk_ms: null, total_ms: 400, chunks: 0, outcome: "failed" },
    { start_ms: 6000, first_chunk_ms: null, total_ms: null, chunks: 0, outcome: "open" },
  ]);
  const json = JSON.stringify(t);
  assert.ok(!/PRIVATE|s-[A-E]|late/.test(json), "no text, error message or stream id is kept");
  assert.equal(t.duration_ms, 7000); assert.equal(t.stopped_by, "learner");
  ok("P1 turns bound to their stream id; outcomes end/error/stopped/failed/open; no text or id in the trace");
}

// ── P2 ──
{
  assert.equal(perfTraceSeatAllowed({ instructor: true, hasProfile: false, minor: true }), true, "instructor");
  assert.equal(perfTraceSeatAllowed({ instructor: false, hasProfile: true, minor: false }), true, "adult seat");
  assert.equal(perfTraceSeatAllowed({ instructor: null, hasProfile: true, minor: true }), false, "minor seat");
  assert.equal(perfTraceSeatAllowed({ instructor: null, hasProfile: false, minor: false }), false, "unknown seat fails closed");
  ok("P2 seat rule: instructor or resolved non-minor; minor and unknown refused");
}

// ── P3 ──
{
  const r = new PerfTraceRecorder(0);
  for (let i = 0; i < 260; i++) { r.observe({ type: "streamStart", streamId: `s${i}` }, i * 1000); r.observe({ type: "streamChunk", streamId: `s${i}` }, i * 1000 + 123456); r.observe({ type: "streamEnd", streamId: `s${i}` }, i * 1000 + 999999); }
  for (let i = 0; i < 700; i++) r.sample(i * 1000, 512 * 1048576, 128 * 1048576, i % 7);
  const t = r.finish(600000, "limit", ENV);
  assert.equal(t.turns.length, 200, "turns capped at 200"); assert.equal(t.dropped_turns, 60);
  assert.equal(t.samples.length, PERF_TRACE_MAX_MS / 1000 + 1, "samples capped at ten minutes");
  const s = perfTraceSummary(t);
  assert.ok(JSON.stringify(s).length <= PERF_TRACE_SEND_MAX, "summary under its cap");
  assert.ok(s.turns.length > 0 && s.turns_omitted === 200 - s.turns.length, "trimmed, and says how many were left out");
  deq(s.turns.at(-1), [199000, 123456, 999999, 1, "end"], "the newest turn is kept");
  assert.equal(s.turn_count, 260); assert.equal(s.rss_mb_max, 512); assert.equal(s.first_chunk_ms.p50, 123456);
  const attachments = { kind: "perf_trace", studio_version: "0.0.0-synthetic-long-version-string", os: "x".repeat(80), ts_client: new Date(0).toISOString(), perf_trace: s };
  assert.ok(JSON.stringify(attachments).length <= 8192, "the whole attachments object stays under the Service's 8,192-character cap");
  ok("P3 send summary trims to the newest turns and fits the Service's attachments cap");
}

// ── P4 ──
{
  const B = String.fromCharCode;
  const dirty = `  느려요${B(0x202e)}${B(0x2028)}${B(0x200b)}${B(0x7)}${B(0xfeff)} 메모\n두 줄 `;
  assert.equal(cleanNote(dirty), "느려요 메모\n두 줄");
  assert.equal(Array.from(cleanNote("가".repeat(1200))).length, 1000);
  assert.equal(cleanNote("😀".repeat(1001)), "😀".repeat(1000), "cap never splits a surrogate pair");
  assert.equal(cleanNote(undefined), "");
  ok("P4 note cleaned of control/bidi/zero-width/separator characters and capped");
}

// ── P5 ──
{
  const doc = readFileSync(path.join(repo, "docs/session-log-consent.ko.md"), "utf8");
  const section = doc.split(/^## /m).find((s) => s.startsWith("8. "));
  assert.ok(section, "§8 exists");
  for (const line of PERF_TRACE_CONSENT_LINES.filter(Boolean)) assert.ok(section.includes(`> ${line}`), `consent line in §8: ${line}`);
  ok("P5 start-dialog consent text equals §8 of the session-log consent doc");
}

// ── Host ──
function fakeVscode() {
  const v = {
    setting: true, modals: [], infos: [], warnings: [], inputs: [], answers: [], items: [],
    window: {
      showInformationMessage: async (message, options, ...actions) => {
        if (options && typeof options === "object" && options.modal) { v.modals.push({ message, options, actions }); return v.answers.shift(); }
        v.infos.push(message); return undefined;
      },
      showWarningMessage: async (m) => { v.warnings.push(m); return undefined; },
      showInputBox: async (o) => { v.lastInput = o; return v.inputs.shift(); },
      createStatusBarItem: (alignment, priority) => { const it = { alignment, priority, shown: false, disposed: false, show() { it.shown = true; }, hide() { it.shown = false; }, dispose() { it.disposed = true; it.shown = false; } }; v.items.push(it); return it; },
    },
    workspace: { getConfiguration: () => ({ get: (k, fallback) => (k === "performanceTraceEnabled" ? v.setting : k === "proxyUrl" ? "https://service.invalid/v1" : fallback) }) },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ThemeColor: class { constructor(id) { this.id = id; } },
  };
  return v;
}
const makeHost = await load("src/perfTraceHost.ts", { "^\\./extension$": 'export const TOKEN_KEY = "synthetic.token.key";' });
const root = mkdtempSync(path.join(os.tmpdir(), "hps-perf-trace-"));
try {
  const harness = ({ seat = () => true, confirm = async () => false } = {}) => {
    const v = fakeVscode(), posts = [], timers = [], clock = { t: 1_700_000_000_000 }, confirms = [];
    const storage = mkdtempSync(path.join(root, "store-"));
    const { PerfTraceController, PERF_TRACE_DIR } = makeHost(v, async (url, init) => { posts.push({ url, body: init.body }); return Response.json({ report_id: "R-9" }); });
    const c = new PerfTraceController({
      context: { secrets: { get: async () => "synthetic-token" }, globalStorageUri: { fsPath: storage }, extension: { packageJSON: { version: "0.0.0-synthetic" } } },
      seatAllowed: () => seat(), getProfileId: () => "profile-1",
      now: () => clock.t, memory: () => ({ rss: 300 * 1048576, heapUsed: 90 * 1048576 }),
      setTimer: (fn) => { const t = { fn, disposed: false, dispose() { t.disposed = true; } }; timers.push(t); return t; },
      confirm: async (m) => { confirms.push(m); return confirm(m); },
      fetchImpl: async (url, init) => { posts.push({ url, body: init.body }); return Response.json({ report_id: "R-9" }); },
    });
    const files = () => { try { return readdirSync(path.join(storage, PERF_TRACE_DIR)).map((f) => path.join(storage, PERF_TRACE_DIR, f)); } catch { return []; } };
    const tick = (ms) => { clock.t += ms; timers.filter((t) => !t.disposed).forEach((t) => t.fn()); };
    return { v, c, posts, timers, clock, confirms, files, tick };
  };

  // H1
  {
    const off = harness(); off.v.setting = false;
    assert.equal(await off.c.start(), false); assert.equal(off.v.modals.length, 0, "setting off: no dialog");
    const minor = harness({ seat: () => false });
    assert.equal(await minor.c.start(), false); assert.equal(minor.v.modals.length, 0, "refused seat: no dialog");
    assert.match(minor.v.infos[0], /성인 이용자와 강사만/);
    const h = harness();
    h.v.answers = [undefined]; assert.equal(await h.c.start(), false, "closed dialog does not start");
    h.v.answers = ["취소"]; assert.equal(await h.c.start(), false, "any other answer does not start");
    assert.equal(h.v.items.length, 0, "no pill without the start click"); assert.equal(h.c.recording, false);
    const d = h.v.modals[0];
    assert.equal(d.message, "느려요 기록을 시작할까요?"); deq(d.actions, ["기록 시작"]);
    assert.equal(d.options.detail, PERF_TRACE_CONSENT_LINES.join("\n"));
    let seatOk = true; const late = harness({ seat: () => seatOk }); late.v.answers = ["기록 시작"];
    const p = late.c.start(); seatOk = false; assert.equal(await p, false, "seat re-checked after the click");
    h.v.answers = ["기록 시작"]; assert.equal(await h.c.start(), true); assert.equal(h.c.recording, true);
    const pill = h.v.items[0];
    assert.equal(pill.text, "$(record) 기록 중 · 멈추기"); assert.equal(pill.shown, true);
    assert.equal(pill.command, "hypeproof-chat.stopPerformanceTrace"); assert.equal(pill.backgroundColor.id, "statusBarItem.errorBackground");
    assert.equal(pill.accessibilityInformation.role, "button");
    assert.equal(await h.c.start(), false, "a second start while recording does nothing"); assert.equal(h.v.items.length, 1);
    h.c.dispose();
    ok("H1 setting off / refused seat open nothing; only 기록 시작 starts; red pill with the stop command");
  }

  // H2 + H3
  for (const mode of ["escape", "keep", "send-cancel", "send"]) {
    const h = harness({ confirm: async () => mode === "send" });
    h.v.answers = ["기록 시작"]; await h.c.start();
    h.c.observe({ type: "streamStart", streamId: "s1" }); h.tick(1500);
    h.c.observe({ type: "streamChunk", streamId: "s1", delta: "PRIVATE-ANSWER" }); h.tick(1000);
    h.c.observe({ type: "streamEnd", streamId: "s1" });
    h.v.inputs = [mode === "escape" ? undefined : `  화면이 3초 멈춰요 ${String.fromCharCode(0x202e)}`];
    h.v.answers = [mode === "escape" ? undefined : mode === "keep" ? "내 컴퓨터에만 두기" : "보내기"];
    const file = await h.c.stop("learner");
    assert.equal(h.c.recording, false); assert.equal(h.v.items[0].shown, false, "pill gone after stop");
    deq(h.files(), [file], "one trace file in this machine's extension storage");
    const saved = JSON.parse(readFileSync(file, "utf8"));
    assert.ok(!readFileSync(file, "utf8").includes("PRIVATE"), "no answer text in the file");
    assert.equal(saved.turns.length, 1); assert.equal(saved.turns[0].first_chunk_ms, 1500); assert.equal(saved.samples.length, 3);
    assert.equal(saved.note, mode === "escape" ? undefined : "화면이 3초 멈춰요", "optional note, cleaned");
    if ((statSync(file).mode & 0o777) !== 0o600) assert.fail("trace file is owner-only");
    const review = h.v.modals.at(-1);
    deq(review.actions, ["내 컴퓨터에만 두기", "보내기"], "keep first (default), then send");
    const size = statSync(file).size;
    assert.ok(review.message.includes(size < 1024 ? `${size.toLocaleString("ko-KR")} 바이트` : "KB"), "review shows the file size");
    if (mode === "escape" || mode === "keep") {
      assert.equal(h.posts.length, 0, `${mode}: nothing sent`); assert.equal(h.confirms.length, 0);
      assert.ok(h.v.infos.includes("기록을 이 컴퓨터에만 두었어요. 아무것도 보내지 않았어요."));
    } else {
      assert.equal(h.confirms.length, 1, "send asks through the outbound confirmation");
      const m = h.confirms[0];
      assert.equal(m.recipient, "Studio 운영팀 (문제 신고 채널) · service.invalid");
      if (mode === "send-cancel") { assert.equal(h.posts.length, 0, "cancel: nothing sent"); continue; }
      assert.equal(h.posts.length, 1, "approve: one POST"); assert.equal(h.posts[0].url, "https://service.invalid/v1/report");
      const body = JSON.parse(h.posts[0].body);
      assert.equal(body.description, "화면이 3초 멈춰요"); assert.equal(body.include_recent_turns, false); assert.equal(body.recent_turns, undefined);
      assert.equal(body.attachments.kind, "perf_trace"); assert.equal(body.attachments.perf_trace.turns.length, 1);
      assert.ok(JSON.stringify(body.attachments).length <= 8192);
      // Exactly the listed items leave: no extra body field, and the summary holds numbers only (the note is its own item).
      deq(Object.keys(body).sort(), ["attachments", "description", "include_recent_turns", "profile_id"], "body carries only the listed items");
      deq(Object.keys(body.attachments).sort(), ["kind", "os", "perf_trace", "studio_version", "ts_client"], "app info is only version, OS and time");
      deq(Object.keys(body.attachments.perf_trace).sort(), ["duration_ms", "first_chunk_ms", "format", "heap_mb_max", "loop_lag_ms", "rss_mb_max", "sample_count", "stopped_by", "total_ms", "turn_count", "turns", "turns_omitted"], "summary keys are numbers-only aggregates");
      assert.ok(!JSON.stringify(body.attachments).includes("화면이"), "the note is not repeated inside the summary");
      assert.equal(m.items[0].name, "내가 쓴 메모"); assert.equal(m.items[0].bytes, Buffer.byteLength(JSON.stringify(body.description)), "listed size is the sent size");
      assert.equal(m.items[1].bytes, Buffer.byteLength(JSON.stringify(body.attachments.perf_trace)));
      assert.ok(h.files().length === 1, "the local copy stays after sending");
    }
  }
  ok("H2/H3 stop keeps the file local; keep/closed send nothing; 보내기 confirms the listed items, cancel sends nothing, approve POSTs once");

  // H3b seat changed between stop and send
  {
    let seatOk = true; const h = harness({ seat: () => seatOk, confirm: async () => true });
    h.v.answers = ["기록 시작"]; await h.c.start(); h.v.inputs = [""]; h.v.answers = ["보내기"];
    const stopping = h.c.stop(); seatOk = false; await stopping;
    assert.equal(h.posts.length, 0); assert.equal(h.confirms.length, 0, "refused before the confirmation");
    ok("H3b send re-checks the seat and refuses without asking");
  }

  // H4
  {
    let seatOk = true; const h = harness({ seat: () => seatOk });
    h.v.answers = ["기록 시작"]; await h.c.start(); h.v.inputs = [undefined]; h.v.answers = [undefined];
    h.tick(1000); seatOk = false; h.tick(1000);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(h.c.recording, false, "seat change stops the recording");
    assert.equal(JSON.parse(readFileSync(h.files()[0], "utf8")).stopped_by, "seat");
    const lim = harness(); lim.v.answers = ["기록 시작"]; await lim.c.start(); lim.v.inputs = [undefined]; lim.v.answers = [undefined];
    for (let i = 0; i < 599; i++) lim.tick(1000);
    assert.equal(lim.c.recording, true, "still recording just under ten minutes");
    lim.tick(1250); await new Promise((r) => setTimeout(r, 20));
    assert.equal(lim.c.recording, false, "stops at ten minutes");
    const t = JSON.parse(readFileSync(lim.files()[0], "utf8"));
    assert.equal(t.stopped_by, "limit"); assert.equal(t.samples.at(-1).loop_lag_ms, 250, "a late tick is measured as loop lag");
    assert.match(lim.v.modals.at(-1).message, /^10분이 지나 기록을 멈췄어요\./);
    assert.equal(await lim.c.stop(), undefined, "a second stop does nothing"); assert.equal(lim.files().length, 1);
    ok("H4 stops at ten minutes and on a seat change; lag measured; double stop harmless");
  }

  // H6 review after a seat stop, setting off mid-recording, start during a stop, write failure
  {
    let seatOk = true; const h = harness({ seat: () => seatOk });
    h.v.answers = ["기록 시작"]; await h.c.start(); h.v.inputs = [undefined]; h.v.answers = [undefined];
    seatOk = false; h.tick(1000); await new Promise((r) => setTimeout(r, 20));
    deq(h.v.modals.at(-1).actions, ["내 컴퓨터에만 두기"], "a seat that cannot send is not offered 보내기");
    const off = harness(); off.v.answers = ["기록 시작"]; await off.c.start(); off.v.inputs = [undefined]; off.v.answers = [undefined];
    off.v.setting = false; off.tick(1000); await new Promise((r) => setTimeout(r, 20));
    assert.equal(off.c.recording, false, "turning the setting off stops the recording");
    const race = harness(); race.v.answers = ["기록 시작"]; await race.c.start();
    let releaseNote; race.v.window.showInputBox = () => new Promise((r) => { releaseNote = r; });
    const stopping = race.c.stop(); await new Promise((r) => setTimeout(r, 20));
    race.v.answers = ["기록 시작"]; assert.equal(await race.c.start(), false, "no new start while the previous review is open");
    assert.equal(race.v.items.length, 1, "no second pill"); race.v.answers = [undefined]; releaseNote(undefined); await stopping;
    race.v.answers = ["기록 시작"]; assert.equal(await race.c.start(), true, "a new start works once the review is done"); race.c.dispose();
    const broken = harness(); broken.v.answers = ["기록 시작"]; await broken.c.start();
    const { writeFileSync } = await import("node:fs"); const dir = path.join(root, "not-a-dir"); writeFileSync(dir, "x");
    broken.c.deps.context.globalStorageUri.fsPath = dir;
    assert.equal(await broken.c.stop(), undefined, "a write failure returns no file");
    assert.match(broken.v.warnings[0] ?? "", /^느려요 기록을 저장하지 못했어요: .*아무것도 보내지 않았어요\.$/);
    assert.equal(broken.posts.length, 0); assert.equal(broken.c.recording, false);
    ok("H6 no 보내기 for a seat that cannot send; setting off stops; no start during a review; write failure warns and sends nothing");
  }

  // H5 the real provider
  {
    const makeProvider = await load('export { ChatPanelProvider } from "./src/chatPanelProvider.ts";');
    const v = fakeVscode(); v.window.createWebviewPanel = () => ({});
    const { ChatPanelProvider } = makeProvider(v);
    const p = Object.create(ChatPanelProvider.prototype);
    const seen = [];
    Object.assign(p, { _instructorMode: { isInstructor: null }, cachedProfile: undefined, context: {}, perfTraceObserver: (m) => seen.push(m.type) });
    assert.equal(p.perfTraceSeatAllowed(), false, "no profile, not instructor: refused");
    p.cachedProfile = { game: { template_tier: "website" } }; assert.equal(p.perfTraceSeatAllowed(), true, "adult workshop tier");
    p.cachedProfile = { game: { template_tier: "website" }, minor_cohort: true }; assert.equal(p.perfTraceSeatAllowed(), false, "minor cohort");
    p.cachedProfile = {}; assert.equal(p.perfTraceSeatAllowed(), false, "unknown tier counts as minor");
    p._instructorMode = { isInstructor: true }; assert.equal(p.perfTraceSeatAllowed(), true, "instructor");
    await p.post({ type: "streamStart", streamId: "x", messageId: "m" });
    deq(seen, ["streamStart"], "post() hands every message to the trace observer");
    p.perfTraceObserver = () => { throw Error("boom"); };
    await p.post({ type: "streamEnd", streamId: "x" });
    ok("H5 provider seat rule and post() hook (an observer error never blocks a post)");
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log(`perf-trace: ${pass} passed`);
