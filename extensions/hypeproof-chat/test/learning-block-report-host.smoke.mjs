// CGP-LEARN-R-011 (a) (REQ-STUDIO-LEARNING-BLOCK-REPORT) — the host half of "자료가 틀린 것 같아요".
// 1. lessonFocus.ts materialReportPayload builds the report from the SERVED lesson only: course, version, step, block type, pinned
//    version and one of three reasons (no params digest). A step without a drawn block, an unknown reason or a
//    hostile id gives null. The result carries no text field, so it passes the Service's material_report allowlist.
// 2. The real ChatPanelProvider.handleMessage queues it on the class connection (opsObserver.materialReport) and answers
//    materialReportResult "sent" only for the Service's `accepted`; duplicate, capped and unconfirmed say so, and everything else is "not_sent".
//    Webview-supplied block fields and text are ignored.
// 3. The sync loop hands every 200 answer of its own stream to onReports, and the real ClassroomOpsHost.materialReport answers
//    with the Service's outcome for that event's seq: an older Service that does not name the kind, a rejected seq, a timeout or
//    a dropped connection is never "sent".
// Run: node --experimental-strip-types test/learning-block-report-host.smoke.mjs

import assert from "node:assert/strict";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { MATERIAL_REPORT_REASONS, MATERIAL_REPORT_REASON_WORDS, materialReportPayload } from "../src/lessonFocus.ts";

const require = createRequire(import.meta.url), extension = fileURLToPath(new URL("..", import.meta.url));
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`ok ${name}`); }

const step = (id, extra) => ({ id, title: `${id} 단계`, instructions: "해 보기", hint: "", acceptance: "직접 확인", ...extra });
const LESSON = {
  course_id: "web-1", version: "m2026.11.15-1", sha256: "a".repeat(64),
  content: { schema: "hps-session-design/1", title: "자료 수업", audience: "초등", duration_minutes: 40, objective: "", prerequisites: "", starter: "",
    steps: [step("s1", { ui: "criterion_form" }), step("s2", { ui: "decision_form", ui_version: 1, ui_params: { b: 2, a: [{ y: "1", x: "2" }] } }), step("s3"), step("s4", { ui: "decision_form", ui_version: 2 }), step("s5", { ui: "constructor" })] },
};
// The Service's allowlist (worker src/lib/classroom-ops.ts validatePayload 'material_report'), restated so a new key here fails.
const SERVICE_KEYS = ["lesson_course", "lesson_version", "step_id", "block_type", "block_version", "reason"];

await test("payload: block identity and reason from the served lesson, no text field (positive control)", () => {
  assert.deepEqual([...MATERIAL_REPORT_REASONS], ["wrong", "broken", "unclear"]);
  assert.deepEqual(Object.values(MATERIAL_REPORT_REASON_WORDS), ["내용이 틀려요", "열리지 않아요", "이해하기 어려워요"]);
  const p = materialReportPayload(LESSON, { stepId: "s1", reason: "wrong" });
  assert.deepEqual(p, { lesson_course: "web-1", lesson_version: "m2026.11.15-1", step_id: "s1", block_type: "criterion_form", block_version: 1, reason: "wrong" });
  const q = materialReportPayload(LESSON, { stepId: "s2", reason: "unclear" });
  assert.equal("params_sha256" in q, false, "no params digest, even for a step with ui_params (the Service refuses a client digest)");
  for (const x of [p, q]) assert.ok(Object.keys(x).every((k) => SERVICE_KEYS.includes(k)), JSON.stringify(x));
});

await test("payload: no block, an unknown reason or a hostile id gives null (negative controls)", () => {
  const no = [
    [LESSON, { stepId: "s3", reason: "wrong" }], [LESSON, { stepId: "s4", reason: "wrong" }], [LESSON, { stepId: "s5", reason: "wrong" }],
    [LESSON, { stepId: "nope", reason: "wrong" }], [LESSON, { stepId: "s1", reason: "other" }], [LESSON, { stepId: "s1", reason: "내용이 틀려요" }],
    [LESSON, { stepId: "s1" }], [LESSON, { stepId: 1, reason: "wrong" }], [null, { stepId: "s1", reason: "wrong" }],
    [{ ...LESSON, course_id: "web 1" }, { stepId: "s1", reason: "wrong" }], [{ ...LESSON, version: "a/b" }, { stepId: "s1", reason: "wrong" }],
  ];
  for (const [l, m] of no) assert.equal(materialReportPayload(l, m), null, JSON.stringify(m));
});

// ─── the real provider handler ───────────────────────────────────────────────
const vscode = { workspace: { getConfiguration: () => ({ get: (_k, f) => f }) }, env: { appName: "HypeProof Studio" } };
const load = async (entry, name) => {
  const bundle = await build({ stdin: { contents: `export {${name}} from './src/${entry}';`, resolveDir: extension, loader: "ts" }, bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false, logLevel: "silent" });
  const mod = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module: mod, exports: mod.exports, require: (id) => (id === "vscode" ? vscode : require(id)), process, console, URL, Buffer, crypto: globalThis.crypto, AbortSignal, TextEncoder, TextDecoder, setTimeout, clearTimeout, setInterval, clearInterval });
  return mod.exports[name];
};
const proto = (await load("chatPanelProvider", "ChatPanelProvider")).prototype;
function makeHost(observer) {
  const posts = [], effects = [];
  const host = Object.assign(Object.create(proto), {
    context: { workspaceState: { get: (_k, d) => d, update: async () => {} } },
    cachedProfile: { profile_id: "p", activity_kind: "classroom", lesson: LESSON },
    post: async (m) => { posts.push(m); return true; },
    spool: { recordWorkflow: (r) => effects.push(["spool", r]) },
    opsObserver: observer,
  });
  return { host, posts, effects };
}

await test("handler: a report goes to the class connection with ids only; webview-supplied block fields and text are dropped", async () => {
  const queued = [];
  const { host, posts, effects } = makeHost({ materialReport: async (p) => { queued.push(p); return "accepted"; } });
  await proto.handleMessage.call(host, { type: "materialReport", stepId: "s1", reason: "broken", block_type: "metric_board", note: "선생님 이거 틀렸어요", text: "x", transcript: ["a"] });
  assert.deepEqual(JSON.parse(JSON.stringify(queued)), [{ lesson_course: "web-1", lesson_version: "m2026.11.15-1", step_id: "s1", block_type: "criterion_form", block_version: 1, reason: "broken" }]);
  assert.deepEqual(JSON.parse(JSON.stringify(posts)), [{ type: "materialReportResult", sha256: LESSON.sha256, stepId: "s1", state: "sent" }]);
  assert.equal(effects.length, 0, "no spool line: a report is not work and not an observation");
  assert.ok(!JSON.stringify(queued).includes("틀렸어요"), "no learner words travel");
});

await test("handler: only the Service's accepted answer is sent; every other outcome says what happened", async () => {
  for (const [observer, msg, want] of [
    [{ materialReport: async () => "duplicate" }, { stepId: "s1", reason: "wrong" }, "already"],
    [{ materialReport: async () => "capped" }, { stepId: "s1", reason: "wrong" }, "capped"],
    [{ materialReport: async () => "unconfirmed" }, { stepId: "s1", reason: "wrong" }, "unconfirmed"],
    [{ materialReport: async () => "rejected" }, { stepId: "s1", reason: "wrong" }, "not_sent"],
    [{ materialReport: async () => "not_sent" }, { stepId: "s1", reason: "wrong" }, "not_sent"],
    [{ materialReport: async () => true }, { stepId: "s1", reason: "wrong" }, "not_sent"],
    [undefined, { stepId: "s1", reason: "wrong" }, "not_sent"],
    [{}, { stepId: "s1", reason: "wrong" }, "not_sent"],
    [{ materialReport: async () => { throw Error("disk"); } }, { stepId: "s1", reason: "wrong" }, "not_sent"],
    [{ materialReport: async () => { throw Error("must not be called"); } }, { stepId: "s3", reason: "wrong" }, "not_sent"],
    [{ materialReport: async () => { throw Error("must not be called"); } }, { stepId: "s1", reason: "other" }, "not_sent"],
  ]) {
    const { host, posts } = makeHost(observer);
    await proto.handleMessage.call(host, { type: "materialReport", ...msg });
    assert.deepEqual(posts.map((p) => [p.type, p.state]), [["materialReportResult", want]], JSON.stringify([msg, want]));
  }
});

// ─── the sync loop and the real ops host ────────────────────────────────────
const ops = await import("../src/classroomOps.ts");
const memoryStore = () => { let saved = null; return { async load() { return saved ? JSON.parse(saved) : null; }, async save(x) { saved = JSON.stringify(x); } }; };
let uid = 0; const uuid = () => `event-${String(++uid).padStart(8, "0")}`;

await test("readReportAnswer: served only when the Service names the kind; malformed outcomes are not outcomes", () => {
  assert.equal(ops.readReportAnswer({}).served, false, "an older Service names no kinds");
  assert.equal(ops.readReportAnswer({ event_kinds: ["step", "evidence"] }).served, false);
  assert.equal(ops.readReportAnswer({ event_kinds: ["material_report"] }).served, true);
  assert.deepEqual(ops.readReportAnswer({ material_reports: [{ seq: 1, outcome: "accepted" }, { seq: "2", outcome: "accepted" }, { seq: 3, outcome: "sent" }, null], rejected: [{ seq: 4, error: "kind" }, { seq: "x" }] }), { served: false, outcomes: [{ seq: 1, outcome: "accepted" }], rejected: [4] });
});

await test("sync loop: declares nothing new by itself; every 200 answer of this stream reaches onReports", async () => {
  const box = await ops.OpsOutbox.open(memoryStore(), "grant-a", "stream-0001", () => 1000, uuid);
  const seen = [];
  const deps = (post) => ({ post, outbox: box, appInstanceId: "instance-0001", sample: () => ({ idle_ms: 1 }), now: () => 5, random: () => 0.5, setTimeout: () => 0, clearTimeout: () => {}, onDisconnected: () => {}, onReports: (a) => seen.push(a) });
  const seq = await box.addSeq("material_report", { reason: "wrong" }, "student");
  assert.equal(seq, 1);
  let loop = ops.startOpsSync(deps(async () => ({ status: 200, body: { ack: { boot_id: "stream-0001", contiguous_seq: 1, missing: [] }, event_kinds: ["material_report"], material_reports: [{ seq: 1, outcome: "accepted" }], rejected: [] } })));
  await loop.tick(); loop.stop();
  assert.deepEqual(seen, [{ served: true, outcomes: [{ seq: 1, outcome: "accepted" }], rejected: [] }]);
  loop = ops.startOpsSync(deps(async () => ({ status: 200, body: { ack: { boot_id: "other-stream", contiguous_seq: 9, missing: [] }, material_reports: [{ seq: 1, outcome: "accepted" }] } })));
  await loop.tick(); loop.stop();
  assert.equal(seen.length, 1, "an answer for another stream is not this stream's outcome");
  loop = ops.startOpsSync(deps(async () => ({ status: 503, body: { reason: "storage" } })));
  await loop.tick(); loop.stop();
  assert.equal(seen.length, 1, "a failed sync carries no outcome");
});

await test("ops host: an older Service (kind not named) gives not_sent and queues nothing", async () => {
  const Host = await load("classroomOpsHost", "ClassroomOpsHost");
  const added = [];
  const h = Object.assign(Object.create(Host.prototype), { outbox: { addSeq: async (...a) => { added.push(a); return 1; } }, loop: { nudge() {} }, reportsServed: false });
  assert.equal(await h.materialReport({ reason: "wrong" }), "not_sent"); assert.equal(added.length, 0);
  assert.equal(await Object.assign(Object.create(Host.prototype), { outbox: null, loop: null, reportsServed: true }).materialReport({ reason: "wrong" }), "not_sent", "no connection");
  assert.equal(h.reportsAvailable(), false);
});

await test("ops host: the answer is the Service's outcome for that seq; a rejected seq, a timeout or a dropped connection is never sent", async () => {
  const Host = await load("classroomOpsHost", "ClassroomOpsHost");
  Host.REPORT_ANSWER_MS = 200;
  const make = () => { const added = []; let next = 0; const inbox = []; const h = Object.assign(Object.create(Host.prototype), { outbox: { addSeq: async (...a) => { added.push(a); return ++next; }, close: async () => {} }, loop: { nudge() {}, stop() {} }, inboxListeners: new Set([() => inbox.push(1)]), log() {} });
    h.inboxChanged = () => inbox.push(1); return { h, added, inbox }; };
  const live = () => true;
  const { h, added, inbox } = make();
  h.onReports({ served: true, outcomes: [], rejected: [] }, live);
  assert.equal(h.reportsAvailable(), true); assert.equal(inbox.length, 1, "availability change republishes the inbox view");
  const payload = materialReportPayload(LESSON, { stepId: "s2", reason: "unclear" });
  const p1 = h.materialReport(payload);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(JSON.parse(JSON.stringify(added)), [["material_report", payload, "student"]]);
  h.onReports({ served: true, outcomes: [{ seq: 99, outcome: "accepted" }], rejected: [] }, live);
  let settled = false; void p1.then(() => { settled = true; }); await new Promise((r) => setTimeout(r, 10));
  assert.equal(settled, false, "another seq's outcome does not answer this report");
  h.onReports({ served: true, outcomes: [{ seq: 1, outcome: "accepted" }], rejected: [] }, live);
  assert.equal(await p1, "accepted");
  for (const outcome of ["duplicate", "capped"]) { const p = h.materialReport(payload); await new Promise((r) => setTimeout(r, 10)); h.onReports({ served: true, outcomes: [{ seq: added.length, outcome }], rejected: [] }, live); assert.equal(await p, outcome); }
  const pr = h.materialReport(payload); await new Promise((r) => setTimeout(r, 10)); h.onReports({ served: true, outcomes: [], rejected: [added.length] }, live); assert.equal(await pr, "rejected", "an older-schema rejection is not sent");
  assert.equal(await h.materialReport(payload), "unconfirmed", "no answer in time is unconfirmed, never sent");
  const pd = h.materialReport(payload); await new Promise((r) => setTimeout(r, 10));
  // The real stopConnection (the learner disconnects, the seat is replaced): the waiting report is unconfirmed, and the item goes.
  Object.assign(h, { generation: 0, paused: false, applyHold() {}, recoveryWatch: { clear() {} }, automationGate: { reset() {} } });
  await h.stopConnection();
  assert.equal(await pd, "unconfirmed", "a dropped connection leaves it unconfirmed");
  assert.equal(h.reportsAvailable(), false, "and the report is no longer offered");
  const n = inbox.length; h.onReports({ served: true, outcomes: [], rejected: [] }, () => false); assert.equal(inbox.length, n, "a stale connection's answer changes nothing");
});

console.log(`learning-block-report-host: ${passed} passed`);
