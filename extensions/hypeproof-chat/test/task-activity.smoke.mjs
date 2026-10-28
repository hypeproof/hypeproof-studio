// CGP-ART-R-020 (REQ-STUDIO-TASK-ACTIVITY) — the "AI가 한 일" roll-up, driven with real SDK message
// shapes (extractSdkActivity) through the host recorder into the task store and back.
// Planted answers: every count must equal the successful tool events planted for that task; refused,
// failed, unanswered and post-stop calls must leave nothing (negative: a count with no matching event).
// Run: node --experimental-strip-types test/task-activity.smoke.mjs

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const A = await import("../src/taskActivity.ts");
const { TaskActivityTurns, workFolderProbe } = await import("../src/taskActivityHost.ts");
const { extractSdkActivity } = await import("../src/sdkCoachHelpers.ts");
const { TaskWorkspaceStore } = await import("../src/taskWorkspaceStore.ts");

let fail = 0;
const t = async (label, fn) => {
  try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${e?.stack ?? e}`); fail++; }
};
const tmp = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `hps-task-activity-${tag}-`));
const use = (id, name, input) => extractSdkActivity({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } });
const result = (id, isError = false) => extractSdkActivity({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: isError, content: isError ? "실패" : "ok" }] } });
const counts = (s) => Object.fromEntries(A.TASK_ACTIVITY_VERBS.map((v) => [v, s[v].length]));

/** The provider's onActivity glue, verbatim in behaviour: tool_use → use, refused approval → deny, tool_result → result. */
function feed(turns, streamId, events, posted) {
  for (const a of events) {
    let msg = null;
    if (a.kind === "tool_use") msg = turns.note(streamId, { kind: "use", id: a.id, name: a.name, input: a.input });
    else if (a.kind === "approval" && !a.allowed) msg = turns.note(streamId, { kind: "deny", id: a.id });
    else if (a.kind === "tool_result") msg = turns.note(streamId, { kind: "result", id: a.id, isError: a.isError });
    if (msg) posted.push(msg);
  }
}

await t("real SDK shapes: only successful calls become entries, with created vs changed read before the write", async () => {
  const root = tmp("work");
  fs.writeFileSync(path.join(root, "index.html"), "<h1>old</h1>");
  fs.mkdirSync(path.join(root, "css"));
  const turns = new TaskActivityTurns();
  const ctrl = new AbortController();
  turns.begin("s1", { signal: ctrl.signal, cwd: root, activityId: "act-1", taskId: "task-1" });
  const posted = [];
  feed(turns, "s1", [
    ...use("r1", "Read", { file_path: path.join(root, "index.html") }), ...result("r1"),
    ...use("r2", "Read", { file_path: "index.html" }), ...result("r2"), // same file again: one row
    ...use("w1", "Write", { file_path: "css/new.css", content: "x" }), // new file: created
    ...use("w2", "Write", { file_path: "index.html", content: "x" }), // existing file: changed
    ...use("e1", "Edit", { file_path: "index.html", old_string: "a", new_string: "b" }),
    ...use("f1", "WebFetch", { url: "https://user:pw@example.org/docs?q=1", prompt: "읽어" }),
    ...use("q1", "WebSearch", { query: "고양이 먹이" }),
    ...use("b1", "mcp__hypeproof__browser_open", { url: "http://localhost:5173/" }), // own preview: not a web page
    ...use("x1", "Edit", { file_path: "secret.txt" }), // fails
    ...use("x2", "Write", { file_path: "denied.txt" }), // refused
    ...use("x3", "Read", { file_path: "never.txt" }), // never answered
    ...use("g1", "Grep", { pattern: "x" }), // not one of the five kinds
  ], posted);
  fs.writeFileSync(path.join(root, "css", "new.css"), "x"); // the write lands after tool_use
  feed(turns, "s1", [...result("w1"), ...result("w2"), ...result("e1"), ...result("f1"), ...result("q1"), ...result("b1"), ...result("x1", true), ...result("g1")], posted);
  feed(turns, "s1", [{ kind: "approval", id: "x2", name: "Write", input: {}, actor: "user", allowed: false }, ...result("x2")], posted);
  assert.deepEqual(posted.map((m) => [m.fact.id, m.fact.verb, m.fact.target]), [
    ["r1", "read", "index.html"], ["r2", "read", "index.html"], ["w1", "created", "css/new.css"], ["w2", "changed", "index.html"],
    ["e1", "changed", "index.html"], ["f1", "web", "https://example.org/docs?q=1"], ["q1", "search", "고양이 먹이"],
  ]);
  assert.ok(posted.every((m) => m.type === "taskActivityFact" && m.activityId === "act-1" && m.taskId === "task-1" && m.streamId === "s1"), "bound to the turn's task");
  const items = turns.attach("s1", [{ id: "a1", role: "assistant", content: "끝", createdAt: 1 }], "a1");
  const summary = A.summarizeTaskActivity(items);
  assert.deepEqual(counts(summary), { read: 1, created: 1, changed: 1, web: 1, search: 1 });
  assert.equal(summary.changed[0].inside, true);
});

await t("negative: no entry, no count — a task with tool lines but no successful event shows nothing", async () => {
  const empty = A.summarizeTaskActivity([
    { id: "t1", role: "tool", content: "", createdAt: 1, tool: { icon: "🔧", label: "Edit(index.html)", state: "error" } },
    { id: "a1", role: "assistant", content: "파일 3개를 고쳤어요", createdAt: 2 },
  ]);
  assert.equal(A.taskActivityTotal(empty), 0, "prose and failed tool lines never count");
  assert.equal(A.taskActivityTotal(A.summarizeTaskActivity([{ activity: [{ id: "x", verb: "made-up", target: "a" }, { id: "y", verb: "read" }] }])), 0, "malformed entries are ignored");
  // Persisted and live copies of the same call count once.
  const fact = { id: "toolu_1", verb: "read", target: "a.md", inside: true };
  assert.equal(A.summarizeTaskActivity([{ activity: [fact] }], [fact]).read.length, 1);
});

await t("stop freezes the record: a result after abort is neither posted nor saved", async () => {
  const turns = new TaskActivityTurns();
  const ctrl = new AbortController();
  turns.begin("s2", { signal: ctrl.signal, cwd: tmp("stop") });
  const posted = [];
  feed(turns, "s2", [...use("a", "WebSearch", { query: "하나" }), ...result("a"), ...use("b", "WebSearch", { query: "둘" })], posted);
  ctrl.abort();
  feed(turns, "s2", result("b"), posted);
  assert.deepEqual(posted.map((m) => m.fact.target), ["하나"]);
  assert.deepEqual(A.summarizeTaskActivity(turns.attach("s2", [{ id: "a2", role: "assistant", content: "", createdAt: 1 }], "a2")).search.map((r) => r.target), ["하나"]);
  turns.end("s2");
  assert.equal(turns.note("s2", { kind: "result", id: "c", isError: false }), null, "an ended turn records nothing");
});

await t("two turns stay apart: entries of one stream never land on another", async () => {
  const turns = new TaskActivityTurns();
  turns.begin("A", { signal: new AbortController().signal, cwd: tmp("a"), taskId: "task-A" });
  turns.begin("B", { signal: new AbortController().signal, cwd: tmp("b"), taskId: "task-B" });
  const posted = [];
  feed(turns, "A", [...use("1", "WebSearch", { query: "a" })], posted);
  feed(turns, "B", result("1"), posted); // B never saw tool_use 1
  feed(turns, "A", result("1"), posted);
  assert.deepEqual(posted.map((m) => [m.streamId, m.taskId]), [["A", "task-A"]]);
  assert.equal(turns.attach("B", [], "m").length, 0, "a turn with no entries adds no line");
});

await t("untrusted names: control/bidi/U+2028 are neutralised, length is capped, outside files are marked", async () => {
  const root = tmp("names");
  const probe = workFolderProbe(root);
  const rec = new A.TaskActivityRecorder(probe);
  rec.use("1", "Read", { file_path: "evil\u202enoisivic.txt" }); rec.result("1", false);
  rec.use("2", "WebSearch", { query: "줄\u2028바꿈\u0007" + "가".repeat(400) }); rec.result("2", false);
  rec.use("3", "Read", { file_path: path.join(os.tmpdir(), "elsewhere.md") }); rec.result("3", false);
  rec.use("4", "Read", { file_path: path.join(root, "..", path.basename(root), "in.md") }); rec.result("4", false);
  rec.use("5", "WebFetch", { url: "javascript:alert(1)" }); rec.result("5", false);
  rec.use("6", "mcp__hypeproof__browser_open", { url: "about:blank" }); rec.result("6", false);
  const [f1, f2, f3, f4] = rec.facts;
  assert.equal(rec.facts.length, 4, "javascript: and about:blank are not web pages");
  assert.ok(!/[\u202e\u2028\u0007]/.test(f1.target + f2.target), "unsafe characters removed");
  assert.ok(f2.target.length <= A.TASK_ACTIVITY_TARGET_MAX);
  assert.equal(f1.inside, true); assert.equal(f3.inside, undefined, "outside the work folder"); assert.equal(f4.target, "in.md", "`..` applied after resolution");
  assert.ok(rec.facts.every(A.validTaskActivityFact));
  assert.equal(A.validTaskActivityFact({ id: "z", verb: "read", target: "a\u202eb" }), false, "store refuses bidi in a target");
  assert.equal(A.validTaskActivityFact({ id: "z", verb: "read", target: "a", extra: 1 }), false, "exact keys");
  assert.equal(A.middleEllipsis("src/components/very/long/path/to/the/file/Name.tsx", 20), "src/compo…e/Name.tsx", "keeps the start and the file name end");
  // CGP-ART-D-020: the shown name is the longest middle-ellipsized form that fits one line.
  const long = "notes/아주/긴/폴더/이름이/계속/이어지는/경로/마지막-파일-이름.md";
  assert.equal(A.fitMiddleEllipsis(long, null), A.middleEllipsis(long), "no measurer: the 48-character cap");
  const fit = A.fitMiddleEllipsis(long, (s) => Array.from(s).length <= 20);
  assert.equal(Array.from(fit).length, 20, "longest form that fits"); assert.ok(fit.includes("…") && fit.endsWith("이름.md"), fit);
  assert.equal(A.fitMiddleEllipsis(long, () => false), A.middleEllipsis(long, 12), "never cut below the floor");
  assert.equal(A.fitMiddleEllipsis("index.html", () => true), "index.html");
  // The cut never lands inside a grapheme: ZWJ emoji, flags, combining marks, decomposed Hangul.
  const seg = new Intl.Segmenter("und", { granularity: "grapheme" });
  const cuts = (full, shown) => {
    if (!shown.includes("…")) return shown === full;
    const [head, tail] = shown.split("…");
    const bounds = new Set(); let at = 0; for (const g of seg.segment(full)) { at += g.segment.length; bounds.add(at); }
    return bounds.has(head.length) && bounds.has(full.length - tail.length) && full.startsWith(head) && full.endsWith(tail);
  };
  const nasty = { zwj: "👨‍👩‍👧‍👦".repeat(30) + ".png", flags: "🇰🇷".repeat(30) + ".md", combining: "e\u0301".repeat(60) + ".txt", jamo: "한글".normalize("NFD").repeat(30) + ".txt", ext: "report." + "x".repeat(60) };
  for (const [name, full] of Object.entries(nasty)) for (const max of [12, 13, 20, 30, 48]) assert.ok(cuts(full, A.middleEllipsis(full, max)), `${name} @${max}: ${A.middleEllipsis(full, max)}`);
  assert.ok(cuts(nasty.zwj, A.fitMiddleEllipsis(nasty.zwj, (s) => [...seg.segment(s)].length <= 15)), "fit keeps graphemes whole");
});

await t("symlinked work folder: the realpath of a write through a link is inside", async () => {
  const real = tmp("real");
  const link = path.join(tmp("link"), "w");
  fs.symlinkSync(real, link);
  const probe = workFolderProbe(link);
  assert.equal(probe.relative(path.join(real, "a.html")), "a.html");
  assert.equal(probe.relative("sub/b.html"), "sub/b.html");
  assert.equal(probe.relative("../escape.html"), null);
});

await t("the task store keeps entries across a reopen and refuses malformed ones", async () => {
  const root = tmp("store");
  const store = new TaskWorkspaceStore(root, "task-activity");
  await store.initialize();
  const taskId = store.getView().activeTaskId;
  const line = { id: "a1", role: "assistant", content: "했어요", createdAt: 1, activity: [{ id: "toolu_1", verb: "changed", target: "index.html", inside: true }] };
  await store.append(taskId, [{ id: "u1", role: "user", content: "고쳐 줘", createdAt: 0 }, line]);
  const reopened = new TaskWorkspaceStore(root, "task-activity").getHistory(taskId);
  assert.deepEqual(A.summarizeTaskActivity(reopened).changed, [{ target: "index.html", inside: true }]);
  let rejected = 0;
  for (const bad of [[{ id: "x", verb: "deleted", target: "a" }], [{ id: "x", verb: "read", target: "a\u0000" }], []]) {
    await store.append(taskId, [{ ...line, id: `bad-${rejected}-${bad.length}`, activity: bad }]).then(() => {}, (e) => { if (e?.code === "invalid") rejected++; });
  }
  assert.equal(rejected, 3, "malformed activity is refused, not stored");
});

await t("nothing reaches the model: the carrier line and the entries are absent from the request body", async () => {
  const { modelHistory } = await import("../src/chatTimeline.ts");
  const { proxyChat } = await import("../src/proxyClient.ts");
  const secret = "SECRET-TARGET-7f3a.html";
  const history = [
    { id: "u1", role: "user", content: "고쳐 줘", createdAt: 1 },
    { id: "a1", role: "assistant", content: "고쳤어요", createdAt: 2, activity: [{ id: "toolu_1", verb: "changed", target: secret, inside: true }] },
    { id: "a1#activity", role: "system", content: "", createdAt: 3, activity: [{ id: "toolu_2", verb: "read", target: secret }] },
  ];
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => { seen.push(String(init?.body ?? "")); throw new Error("stop after capture"); };
  try {
    await proxyChat({ proxyUrl: "https://proxy.invalid", model: "m", token: "t", history: modelHistory(history), userText: "다음", signal: new AbortController().signal, onDelta() {} }).catch(() => {});
  } finally { globalThis.fetch = realFetch; }
  assert.equal(seen.length, 1, "the request was built");
  assert.ok(seen[0].includes("고쳤어요"), "the assistant text is sent");
  assert.ok(!seen[0].includes(secret) && !/"activity"/.test(seen[0]) && !seen[0].includes("toolu_"), "no entry reaches the model");
  assert.equal(JSON.parse(seen[0]).messages.length, 3, "user, assistant, current user: the carrier system line is dropped");
});

await t("wiring: every runtime reports through the recorder, and both history paths carry its entries", async () => {
  // Structure check beside the behaviour above: the recorder is only as complete as its call sites.
  const src = fs.readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
  const send = src.slice(src.indexOf("  private async handleSend("), src.indexOf("  private async runBrowserLoop("));
  const loop = src.slice(src.indexOf("  private async runBrowserLoop("), src.indexOf("\n  private ", src.indexOf("  private async runBrowserLoop(") + 1));
  const begin = send.indexOf("this.taskActivity.begin(streamId");
  assert.ok(begin > 0 && begin < send.indexOf("const captureInterrupted"), "recorder opens before the stop capture can run");
  const on = send.slice(send.indexOf("const onActivity = (a"), send.indexOf("const onActivity = (a") + 900);
  for (const k of ["kind: 'use'", "kind: 'deny'", "kind: 'result'"]) assert.ok(on.includes(`this.noteTaskActivity(streamId, { ${k}`), `onActivity reports ${k}`);
  for (const runtime of ["runInstructorTurn({", "runLocalCoach({", "runSdkCoach({"]) assert.match(send.slice(send.indexOf(runtime), send.indexOf(runtime) + 4000), /onActivity/, `${runtime} gets onActivity`);
  assert.ok(loop.includes("this.noteTaskActivity(p.streamId, { kind: 'use'") && loop.includes("this.noteTaskActivity(p.streamId, { kind: 'result'"), "the proxy browser loop reports its calls");
  assert.match(src, /private finishTurnItems\([\s\S]{0,300}?return this\.taskActivity\.attach\(streamId, this\.finishTurnTimeline\(/, "finished and interrupted turns both pass through attach");
  assert.ok(send.includes("this.taskActivity.end(streamId);"), "the turn's recorder is dropped in finally");
});

if (fail) { console.error(`task-activity: ${fail} failed`); process.exit(1); }
console.log("PASS task activity roll-up");
