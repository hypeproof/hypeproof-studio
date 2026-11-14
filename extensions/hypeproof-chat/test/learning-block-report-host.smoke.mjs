// CGP-LEARN-R-011 (a) (REQ-STUDIO-LEARNING-BLOCK-REPORT) — the host half of "자료가 틀린 것 같아요".
// 1. lessonFocus.ts materialReportPayload builds the report from the SERVED lesson only: course, version, step, block type, pinned
//    version, a key-order-free params digest, and one of three reasons. A step without a drawn block, an unknown reason or a
//    hostile id gives null. The result carries no text field, so it passes the Service's material_report allowlist.
// 2. The real ChatPanelProvider.handleMessage queues it on the class connection (opsObserver.materialReport) and answers
//    materialReportResult "sent"; with no live connection, a refused outbox or no block it answers "not_sent" and queues nothing.
//    Webview-supplied block fields and text are ignored.
// 3. The real ClassroomOpsHost.materialReport adds a `material_report` event with actor student to the outbox, and returns false
//    without a connection.
// Run: node --experimental-strip-types test/learning-block-report-host.smoke.mjs

import assert from "node:assert/strict";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { MATERIAL_REPORT_REASONS, MATERIAL_REPORT_REASON_WORDS, materialReportPayload, stableJson } from "../src/lessonFocus.ts";

const require = createRequire(import.meta.url), extension = fileURLToPath(new URL("..", import.meta.url));
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`ok ${name}`); }
const sha = (t) => createHash("sha256").update(t, "utf8").digest("hex");

const step = (id, extra) => ({ id, title: `${id} 단계`, instructions: "해 보기", hint: "", acceptance: "직접 확인", ...extra });
const LESSON = {
  course_id: "web-1", version: "m2026.11.15-1", sha256: "a".repeat(64),
  content: { schema: "hps-session-design/1", title: "자료 수업", audience: "초등", duration_minutes: 40, objective: "", prerequisites: "", starter: "",
    steps: [step("s1", { ui: "criterion_form" }), step("s2", { ui: "decision_form", ui_version: 1, ui_params: { b: 2, a: [{ y: "1", x: "2" }] } }), step("s3"), step("s4", { ui: "decision_form", ui_version: 2 }), step("s5", { ui: "constructor" })] },
};
// The Service's allowlist (worker src/lib/classroom-ops.ts validatePayload 'material_report'), restated so a new key here fails.
const SERVICE_KEYS = ["lesson_course", "lesson_version", "step_id", "block_type", "block_version", "params_sha256", "reason"];

await test("payload: block identity and reason from the served lesson, no text field (positive control)", () => {
  assert.deepEqual([...MATERIAL_REPORT_REASONS], ["wrong", "broken", "unclear"]);
  assert.deepEqual(Object.values(MATERIAL_REPORT_REASON_WORDS), ["내용이 틀려요", "열리지 않아요", "이해하기 어려워요"]);
  const p = materialReportPayload(LESSON, { stepId: "s1", reason: "wrong" }, sha);
  assert.deepEqual(p, { lesson_course: "web-1", lesson_version: "m2026.11.15-1", step_id: "s1", block_type: "criterion_form", block_version: 1, reason: "wrong" });
  const q = materialReportPayload(LESSON, { stepId: "s2", reason: "unclear" }, sha);
  assert.equal(q.params_sha256, sha(stableJson({ a: [{ x: "2", y: "1" }], b: 2 })), "the digest does not depend on key order");
  assert.match(q.params_sha256, /^[a-f0-9]{64}$/);
  for (const x of [p, q]) assert.ok(Object.keys(x).every((k) => SERVICE_KEYS.includes(k)), JSON.stringify(x));
});

await test("payload: no block, an unknown reason or a hostile id gives null (negative controls)", () => {
  const no = [
    [LESSON, { stepId: "s3", reason: "wrong" }], [LESSON, { stepId: "s4", reason: "wrong" }], [LESSON, { stepId: "s5", reason: "wrong" }],
    [LESSON, { stepId: "nope", reason: "wrong" }], [LESSON, { stepId: "s1", reason: "other" }], [LESSON, { stepId: "s1", reason: "내용이 틀려요" }],
    [LESSON, { stepId: "s1" }], [LESSON, { stepId: 1, reason: "wrong" }], [null, { stepId: "s1", reason: "wrong" }],
    [{ ...LESSON, course_id: "web 1" }, { stepId: "s1", reason: "wrong" }], [{ ...LESSON, version: "a/b" }, { stepId: "s1", reason: "wrong" }],
  ];
  for (const [l, m] of no) assert.equal(materialReportPayload(l, m, sha), null, JSON.stringify(m));
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
  const { host, posts, effects } = makeHost({ materialReport: async (p) => { queued.push(p); return true; } });
  await proto.handleMessage.call(host, { type: "materialReport", stepId: "s1", reason: "broken", block_type: "metric_board", note: "선생님 이거 틀렸어요", text: "x", transcript: ["a"] });
  assert.deepEqual(JSON.parse(JSON.stringify(queued)), [{ lesson_course: "web-1", lesson_version: "m2026.11.15-1", step_id: "s1", block_type: "criterion_form", block_version: 1, reason: "broken" }]);
  assert.deepEqual(JSON.parse(JSON.stringify(posts)), [{ type: "materialReportResult", sha256: LESSON.sha256, stepId: "s1", state: "sent" }]);
  assert.equal(effects.length, 0, "no spool line: a report is not work and not an observation");
  assert.ok(!JSON.stringify(queued).includes("틀렸어요"), "no learner words travel");
});

await test("handler: no connection, a refused outbox, a throwing observer or no block answers not_sent", async () => {
  for (const [observer, msg, what] of [
    [undefined, { stepId: "s1", reason: "wrong" }, "no class connection"],
    [{}, { stepId: "s1", reason: "wrong" }, "an observer without the method"],
    [{ materialReport: async () => false }, { stepId: "s1", reason: "wrong" }, "the outbox refused"],
    [{ materialReport: async () => { throw Error("disk"); } }, { stepId: "s1", reason: "wrong" }, "the outbox threw"],
    [{ materialReport: async () => { throw Error("must not be called"); } }, { stepId: "s3", reason: "wrong" }, "a step with no block"],
    [{ materialReport: async () => { throw Error("must not be called"); } }, { stepId: "s1", reason: "other" }, "an unknown reason"],
  ]) {
    const { host, posts } = makeHost(observer);
    await proto.handleMessage.call(host, { type: "materialReport", ...msg });
    assert.deepEqual(posts.map((p) => [p.type, p.state]), [["materialReportResult", "not_sent"]], what);
  }
});

// ─── the real ops host ──────────────────────────────────────────────────────
await test("ops host: a material_report event with actor student is added to the outbox; no connection returns false", async () => {
  const Host = await load("classroomOpsHost", "ClassroomOpsHost");
  assert.equal(await Object.assign(Object.create(Host.prototype), { outbox: null, loop: null }).materialReport({ reason: "wrong" }), false);
  const added = []; let nudged = 0;
  const live = Object.assign(Object.create(Host.prototype), { outbox: { add: async (...a) => { added.push(a); return true; } }, loop: { nudge: () => { nudged++; } } });
  const payload = materialReportPayload(LESSON, { stepId: "s2", reason: "unclear" }, sha);
  assert.equal(await live.materialReport(payload), true);
  assert.deepEqual(JSON.parse(JSON.stringify(added)), [["material_report", payload, "student"]]); assert.equal(nudged, 1);
  const full = Object.assign(Object.create(Host.prototype), { outbox: { add: async () => false }, loop: { nudge: () => { nudged++; } } });
  assert.equal(await full.materialReport(payload), false, "a full outbox is said, never pretended"); assert.equal(nudged, 1);
});

console.log(`learning-block-report-host: ${passed} passed`);
