// CGP-CHAT-R-005 (REQ-STUDIO-ANSWER-VERDICT, DEC-09) — the verdict model behind "맞아요 / 고쳐야 해요".
// Pure functions, the production task store on disk, and the real outbound paths (class snapshot,
// class collection, session-log upload) run over a spool plus a verdict file. No vscode, no React.
//
// .claude/rules/verification.md §2: each judgement has a positive control (a good sample passes) and a
// negative control (a bad sample fails), so a too-strict and a too-lenient rule both show up.
// Run: node --experimental-strip-types test/answer-verdict.smoke.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const {
  appendVerdict, latestVerdicts, parseVerdictRequest, previousVerdict, promptIdFor,
  validVerdictEvent, verdictEvidence, verdictTargets, REASON_LABELS, VERDICT_LABELS, VERDICT_NOTE_MAX,
} = await import("../src/answerVerdict.ts");
const { TaskWorkspaceStore } = await import("../src/taskWorkspaceStore.ts");
const { SessionSpool } = await import("../src/sessionSpool.ts");
const { freezeSnapshot, freezeCollection } = await import("../src/evidenceSnapshot.ts");
const { uploadAllPending } = await import("../src/spoolUploader.ts");
const { taskWorkspaceRoot } = await import("../src/trialCarryoverSource.ts");
const { decodeBeforeEditResend } = await import("./fixtures/task-store-validator-before-edit-resend.mjs");

let n = 0;
const t = async (label, fn) => { await fn(); n++; console.log(`  ok   ${label}`); };
const at = 1000;
const u = (id, content) => ({ id, role: "user", content, createdAt: at });
const a = (id, content) => ({ id, role: "assistant", content, createdAt: at });
const tool = (id) => ({ id, role: "tool", content: "", createdAt: at, tool: { icon: "🔧", label: "Write(index.html)", state: "done" } });
const NOTE = "색이 너무 어두워서 다시 해야 해요";
const ev = (messageId, verdict, extra = {}) => ({ messageId, verdict, at, ...extra });

await t("labels are the Korean copy the requirement names", () => {
  assert.deepEqual(VERDICT_LABELS, { right: "맞아요", fix: "고쳐야 해요" });
  assert.deepEqual(Object.values(REASON_LABELS), ["틀렸어요", "내가 원한 게 아니에요", "너무 어려워요", "기타"]);
  assert.equal(VERDICT_NOTE_MAX, 300);
});

await t("requests: right, fix, fix + reason, fix + reason + note are accepted (positive control)", () => {
  assert.deepEqual(parseVerdictRequest({ type: "answerVerdict", messageId: "a1", verdict: "right" }), { messageId: "a1", verdict: "right" });
  assert.deepEqual(parseVerdictRequest({ messageId: "a1#2", verdict: "fix" }), { messageId: "a1#2", verdict: "fix" });
  assert.deepEqual(parseVerdictRequest({ messageId: "a1", verdict: "fix", reason: "too_hard" }), { messageId: "a1", verdict: "fix", reason: "too_hard" });
  assert.deepEqual(parseVerdictRequest({ messageId: "a1", verdict: "fix", reason: "other", note: `  ${NOTE} ` }), { messageId: "a1", verdict: "fix", reason: "other", note: NOTE });
  assert.deepEqual(parseVerdictRequest({ messageId: "a1", verdict: null }), { messageId: "a1", verdict: null });
  assert.deepEqual(parseVerdictRequest({ messageId: "a1", verdict: "fix", reason: "wrong", note: "x".repeat(300) })?.note?.length, 300);
});

await t("requests: malformed ones are refused (negative controls)", () => {
  const bad = [
    { messageId: "a1", verdict: "right", reason: "wrong" },          // a reason only belongs to 고쳐야 해요
    { messageId: "a1", verdict: null, reason: "wrong" },
    { messageId: "a1", verdict: "fix", note: NOTE },                 // a note only belongs under a reason
    { messageId: "a1", verdict: "fix", reason: "wrong", note: "x".repeat(301) },
    { messageId: "a1", verdict: "fix", reason: "boring" },
    { messageId: "a1", verdict: "good" },
    { messageId: "a 1", verdict: "right" },
    { messageId: "", verdict: "right" },
    { messageId: "a1" },
    null,
  ];
  for (const value of bad) assert.equal(parseVerdictRequest(value), null, JSON.stringify(value));
});

await t("an empty note is dropped, not stored as an empty string", () => {
  assert.deepEqual(parseVerdictRequest({ messageId: "a1", verdict: "fix", reason: "wrong", note: "   " }), { messageId: "a1", verdict: "fix", reason: "wrong" });
});

await t("evidence row: time, ids, codes and the note's length, never its text", () => {
  const event = ev("a1", "fix", { promptId: "u1", turnId: "stream-1", reason: "other", note: NOTE });
  const payload = verdictEvidence(event, "right");
  assert.deepEqual(payload, { at, message_id: "a1", prompt_id: "u1", turn_id: "stream-1", verdict: "fix", previous: "right", reason: "other", note_length: NOTE.length });
  assert.ok(!JSON.stringify(payload).includes(NOTE.slice(0, 4)), "note text in the evidence row");
  // Negative control: the check above does see text when it is there.
  assert.ok(JSON.stringify({ ...payload, note: NOTE }).includes(NOTE.slice(0, 4)));
  assert.deepEqual(verdictEvidence(ev("a1", null), "fix"), { at, message_id: "a1", verdict: "removed", previous: "fix", note_length: 0 });
  for (const key of Object.keys(payload)) assert.ok(!/score|grade|level|rank/i.test(key), `score-like field ${key}`);
});

await t("history: change and removal append; the latest wins for display", () => {
  let history = [];
  history = appendVerdict(history, ev("a1", "right"));
  history = appendVerdict(history, ev("a2", "fix", { reason: "wrong" }));
  history = appendVerdict(history, ev("a1", "fix", { reason: "too_hard" }));
  assert.deepEqual(latestVerdicts(history), { a1: { verdict: "fix", reason: "too_hard" }, a2: { verdict: "fix", reason: "wrong" } });
  assert.equal(previousVerdict(history, "a1"), "fix");
  history = appendVerdict(history, ev("a1", null));
  assert.equal(history.length, 4, "history was rewritten instead of appended");
  assert.deepEqual(latestVerdicts(history), { a2: { verdict: "fix", reason: "wrong" } });
  assert.equal(previousVerdict(history, "a1"), "none");
  assert.equal(previousVerdict([], "a9"), "none");
});

await t("history cap: superseded events go first, so every message keeps its latest", () => {
  let history = [];
  for (let i = 0; i < 6; i++) history = appendVerdict(history, ev("a1", i % 2 ? "fix" : "right"), 4);
  history = appendVerdict(history, ev("a2", "right"), 4);
  history = appendVerdict(history, ev("a3", "fix"), 4);
  assert.equal(history.length, 4);
  assert.deepEqual(latestVerdicts(history), { a1: { verdict: "fix" }, a2: { verdict: "right" }, a3: { verdict: "fix" } });
  // Negative control: a plain "keep the newest N" trim would still pass here, so check the case it fails:
  const firstOnly = [ev("a1", "right"), ev("a2", "right"), ev("a2", "fix"), ev("a2", "right")];
  const trimmed = appendVerdict(firstOnly, ev("a2", "fix"), 4);
  assert.deepEqual(latestVerdicts(trimmed).a1, { verdict: "right" }, "a1's only event was trimmed");
  assert.deepEqual(latestVerdicts(firstOnly.concat(ev("a2", "fix")).slice(-4)).a1, undefined, "control: newest-N loses a1");
});

await t("stored events validate; a stored note without a reason or a junk key does not (negative control)", () => {
  assert.ok(validVerdictEvent(ev("a1", "fix", { reason: "wrong", note: NOTE, promptId: "u1", turnId: "stream-1" })));
  assert.ok(!validVerdictEvent(ev("a1", "fix", { turnId: "a b" })));
  assert.ok(!validVerdictEvent(ev("a1", "fix", { note: NOTE })));
  assert.ok(!validVerdictEvent({ ...ev("a1", "right"), score: 1 }));
  assert.ok(!validVerdictEvent({ ...ev("a1", "right"), at: -1 }));
});

const turn = [u("u1", "첫 질문"), a("a1", "첫 답"), u("u2", "고양이 그려 줘"), a("a2", "만들게요"), tool("t2"), a("a2#2", "다 만들었어요"), u("u3", "고마워"), a("a3", "")];
await t("targets: the last answer bubble of each finished turn, with text (positive control)", () => {
  assert.deepEqual([...verdictTargets(turn, false)], ["a1", "a2#2"]);
});
await t("targets: never a user line, the first bubble of a split answer, an empty answer, or the running turn (negative controls)", () => {
  const targets = verdictTargets(turn, false);
  for (const id of ["u1", "u2", "u3", "a2", "t2", "a3"]) assert.ok(!targets.has(id), id);
  const live = [...turn.slice(0, 6), u("u3", "하나 더"), a("a3", "쓰는 중")];
  assert.deepEqual([...verdictTargets(live, true)], ["a1", "a2#2"], "the running turn got a verdict");
  assert.deepEqual([...verdictTargets(live, false)], ["a1", "a2#2", "a3"], "control: once finished, it gets one");
  // A tool line ending the running turn (no new bubble yet) must not expose the turn's first bubble.
  const midTool = [...turn.slice(0, 2), u("u2", "고양이 그려 줘"), a("a2", "만들게요"), tool("t2")];
  assert.deepEqual([...verdictTargets(midTool, true)], ["a1"]);
});
await t("prompt id: the user line the answer replied to", () => {
  assert.equal(promptIdFor(turn, "a2#2"), "u2");
  assert.equal(promptIdFor(turn, "a1"), "u1");
  assert.equal(promptIdFor([a("a0", "인사")], "a0"), undefined);
});

// ── production task store on disk ────────────────────────────────────────────
const root = fs.mkdtempSync(path.join(os.tmpdir(), "hps-answer-verdict-"));
try {
  const store = new TaskWorkspaceStore(root, "answer-verdict");
  await store.initialize();
  const taskId = store.getView().activeTaskId;
  await store.append(taskId, turn);
  const taskFileBefore = fs.readFileSync(store.filePath, "utf8");

  await t("legacy load: a task with no verdict sidecar loads with no verdicts", () => {
    assert.ok(!fs.existsSync(store.verdictsPath));
    assert.deepEqual(new TaskWorkspaceStore(root, "answer-verdict").getVerdicts(taskId), {});
  });

  await store.recordVerdict(taskId, ev("a1", "right", { promptId: "u1" }));
  await store.recordVerdict(taskId, ev("a1", "fix", { promptId: "u1", reason: "not_wanted", note: NOTE }));
  const confirmed = await store.recordVerdict(taskId, ev("a2#2", "right", { promptId: "u2" }));

  await t("round trip: reopening the task shows the learner's last choice per answer", () => {
    const expected = { a1: { verdict: "fix", reason: "not_wanted", note: NOTE }, "a2#2": { verdict: "right" } };
    assert.deepEqual(confirmed, expected);
    const reopened = new TaskWorkspaceStore(root, "answer-verdict");
    assert.deepEqual(reopened.getVerdicts(taskId), expected);
    assert.equal(reopened.getVerdictHistory(taskId).length, 3, "history not kept");
  });
  await t("downgrade: a verdict never touches the task file, which the older validator still reads", () => {
    assert.equal(fs.readFileSync(store.filePath, "utf8"), taskFileBefore, "the task file changed");
    const old = decodeBeforeEditResend(fs.readFileSync(store.filePath, "utf8"), store.scope);
    assert.equal(old.tasks.find((task) => task.id === taskId).messages.length, turn.length);
    assert.ok(!fs.readFileSync(store.filePath, "utf8").includes("not_wanted"));
  });
  await t("an invalid event and another task's id are refused (negative controls)", async () => {
    await assert.rejects(store.recordVerdict(taskId, ev("a1", "right", { reason: "wrong" })), (error) => error.code === "invalid");
    await assert.rejects(store.recordVerdict("not-the-task", ev("a1", "right")), (error) => error.code === "stale");
    assert.equal(new TaskWorkspaceStore(root, "answer-verdict").getVerdictHistory(taskId).length, 3);
  });

  fs.writeFileSync(store.verdictsPath, "{not json");
  const damaged = new TaskWorkspaceStore(root, "answer-verdict");
  await t("an unreadable sidecar costs only the drawn verdicts; the conversation loads", () => {
    assert.deepEqual(damaged.getVerdicts(taskId), {});
    assert.equal(damaged.getHistory(taskId).length, turn.length);
  });
  await damaged.recordVerdict(taskId, ev("a1", "right"));
  await t("the next verdict sets the unreadable sidecar aside instead of overwriting it", () => {
    assert.ok(fs.readdirSync(path.dirname(store.verdictsPath)).some((name) => name.startsWith(path.basename(store.verdictsPath) + ".unreadable-")));
    assert.deepEqual(new TaskWorkspaceStore(root, "answer-verdict").getVerdicts(taskId), { a1: { verdict: "right" } });
  });
  await damaged.clearHistory(taskId);
  await t("clearing the task drops its verdicts with its answers", () => {
    const reopened = new TaskWorkspaceStore(root, "answer-verdict");
    assert.deepEqual(reopened.getHistory(taskId), []);
    assert.deepEqual(reopened.getVerdicts(taskId), {});
  });
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

// ── DEC-09: nothing that leaves the device carries a verdict ────────────────
// The host must not write verdicts to the session spool at all (read its source), and the three
// outbound paths that exist — the class snapshot (/2 copy), the class collection (/3, kinds incl.
// `record`, which selects every line) and the session-log upload — are run for real over a spool
// plus a verdict file. Negative control: the same run WITH an injected answer_verdict spool line
// must show it on every path, which proves the probe would see a leak.
await t("host: the verdict handler never touches the spool", () => {
  const source = fs.readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
  const start = source.indexOf("private async handleAnswerVerdict(");
  assert.ok(start > 0, "handler not found");
  const body = source.slice(start, source.indexOf("\n  private async postHistory(", start));
  assert.ok(body.length > 200, "handler body not isolated");
  assert.ok(!/spool/i.test(body), "the verdict handler mentions the spool");
  assert.ok(!source.includes("answer_verdict"), "an answer_verdict event is still written somewhere");
  // Control: the probe does see spool use in a handler that has it (the edit-resend path).
  assert.ok(/this\.spool\?\.recordWorkflow\(\{ event: "edit_resend"/.test(source));
});

const T = Date.parse("2026-10-20T03:00:00Z");
const ident = { u: "synthetic", c: "test", p: "test" };
const scope = { grant_id: "g", class_run_id: "run", seat_id: "A1", student: ident, activity: null, run: { starts_at: T - 60_000, ends_at: T + 3_600_000 } };
const consent = { purpose: "class_report", notice_version: "v1" };
const MARKERS = ["answer_verdict", "verdict-answer-7f3", NOTE, "not_wanted"];
const text = (files) => files.map((f) => new TextDecoder().decode(f.data ?? f)).join("\n");

async function outbound(inject) {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), "hps-verdict-leak-"));
  try {
    // The verdict file, written by the production store where the app keeps it.
    const store = new TaskWorkspaceStore(taskWorkspaceRoot(storage), "personal-scope");
    await store.initialize();
    const taskId = store.getView().activeTaskId;
    await store.append(taskId, [u("u-7f3", "질문"), a("verdict-answer-7f3", "답")]);
    await store.recordVerdict(taskId, ev("verdict-answer-7f3", "fix", { promptId: "u-7f3", turnId: "stream-7f3", reason: "not_wanted", note: NOTE }));
    assert.ok(fs.readFileSync(store.verdictsPath, "utf8").includes(NOTE), "fixture: the verdict file holds the verdict");
    // The session spool of the same learner, with an ordinary turn in it.
    const spoolRoot = path.join(storage, "logs", "sessions");
    const spool = new SessionSpool({ root: spoolRoot, appVersion: "test", os: { platform: "darwin", release: "test", arch: "arm64" }, now: () => new Date(T), newSessionId: () => "11111111-1111-4111-8111-111111111111" });
    spool.noteIdentity(ident);
    spool.recordPrompt({ turnId: "stream-7f3", runtime: "proxy", text: "PROMPT-SEEN" });
    if (inject) spool.recordWorkflow({ turnId: "stream-7f3", event: "answer_verdict", payload: { message_id: "verdict-answer-7f3", reason: "not_wanted", note: NOTE } });
    await spool.flush();
    const sent = {};
    const snap = await spool.readForSnapshot(0);
    const frozen = freezeSnapshot(snap.files, scope, "batch", consent, T + 1000, snap);
    assert.equal(frozen.ok, true, `snapshot: ${frozen.code}`);
    sent.snapshot = text(frozen.files);
    const src = await spool.readForCollection(0, ident);
    sent.collection = "";
    for (const kinds of [["record"], ["prompts"], ["artifacts", "prompts"]]) {
      const copy = freezeCollection(src, scope, "batch", consent, kinds, T + 1000);
      assert.equal(copy.ok, true, `collection ${kinds}: ${copy.code}`);
      sent.collection += text(copy.files);
    }
    const sealed = await spool.seal();
    const bodies = [];
    const results = await uploadAllPending(spoolRoot, {
      baseUrl: "https://example.invalid/v1", token: "t", identity: { u: ident.u, c: ident.c }, allowFresh: sealed ? [sealed] : [],
      now: () => new Date(T + 1000),
      fetchFn: async (url, init) => { bodies.push(`${url}\n${Buffer.from(init.body).toString("utf8")}`); return { ok: true, status: 200, json: async () => ({ key: url }) }; },
    });
    assert.ok(results.length === 1 && results[0].ok, `upload: ${JSON.stringify(results)}`);
    sent.upload = bodies.join("\n");
    return sent;
  } finally {
    fs.rmSync(storage, { recursive: true, force: true });
  }
}

const clean = await outbound(false);
await t("class snapshot, class collection (record/prompts/artifacts) and log upload carry no verdict data", () => {
  for (const [path_, body] of Object.entries(clean)) {
    assert.ok(body.includes("PROMPT-SEEN"), `${path_}: positive control, the ordinary turn did not go out`);
    for (const marker of MARKERS) assert.ok(!body.includes(marker), `${path_} carries ${marker}`);
  }
});
const leaky = await outbound(true);
await t("negative control: an answer_verdict line in the spool WOULD leave on every path", () => {
  for (const [path_, body] of Object.entries(leaky)) {
    if (path_ === "collection") assert.ok(body.includes("answer_verdict"), "collection (record) did not include the injected line");
    else assert.ok(body.includes("answer_verdict") && body.includes(NOTE), `${path_} did not include the injected line`);
  }
});

console.log(`answer-verdict: ${n} checks OK`);
