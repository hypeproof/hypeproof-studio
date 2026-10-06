// SX-55 — the task flow on the host (assigned → working → submitted), and what regions A and D
// draw from it. Run: node --experimental-strip-types test/sx-task-flow.smoke.mjs
//
// What is judged:
//   1. `learningState` (src/learningStateHelpers.ts) closes completion by phase, and keeps the
//      gate's own `missing` list for region A in every phase;
//   2. region A's check marks read only that list (webview-ui/src/missionHeaderLogic.ts);
//   3. the host CALLS the flow at each moment the design names, keys the record like the events,
//      and says what the student must be told. STATE.md's finding was exactly "the transition
//      table shipped, the caller did not", so the callers are checked first. Static, like
//      test/cr-host.smoke.mjs: ChatPanelProvider cannot load without VS Code. Every static check
//      also runs on a planted provider that must fail it;
//   4. the flow's rules (src/taskFlowHelpers.ts), pure: the transition table with the step gate,
//      the record id, and the notice the host shows;
//   5. the same rules on the App's real record store (FileRecordStorage on a temp dir), read
//      back through a fresh instance, as a restarted extension host would: a gated jump refused,
//      a start that a lost signal cannot undo, two seats on one record kept apart, who acted,
//      and a signal that writes nothing answered without the lock while every write still takes it;
//   6. the local review list does not offer a task it cannot open, says how many it leaves out
//      (MC-27), and deletes them only through the core's delete (MC-31);
//   7. the rendered region A marks, the region D line and the local review's omission line
//      (test/sx-render.mjs, real components).
//
// Every check runs and reports (the worker tests' `check` pattern), so a red run names each
// broken rule. On the tree before this change the run is red at the functions this extends
// (`learningState` ignores the phase, region A never checks anything off), not only at the
// file that did not exist yet.
//
// Controls (.claude/rules/verification.md rules 2·3): each rule has a sample that must pass
// (catches a too-strict instrument) and one that must be refused (catches a too-lenient one).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`ok ${name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL ${name}\n      ${String(error?.message ?? error).replace(/\s*\n\s*/g, " | ")}`);
  }
}
/** A module this change adds. Its absence is one failed check, and the rest still run. */
async function load(path) {
  try {
    return await import(path);
  } catch (error) {
    failed++;
    console.log(`FAIL load ${path}\n      ${String(error?.message ?? error).split("\n")[0]}`);
    return null;
  }
}

const week3 = JSON.parse(readFileSync(new URL("../../../worker/test/fixtures/session-design/week-3.json", import.meta.url), "utf8"));
const LESSON = { course_id: "globalbuddy", version: "m2026.09.20-1", sha256: "f".repeat(64), content: week3 };
const COMPLETION = week3.learning.completion.map((c) => ({ id: c.id, event: c.event, label: c.text }));
const TASK = "task-ffffffffffffffff-a1b2c3d4";
const CTX = { week: 3, step_id: "expect", task: TASK, module_version: LESSON.version };
let seq = 0;
const ev = (kind, extra = {}) => ({ id: `e${++seq}`, seq, task: TASK, at: 1_700_000_000_000 + seq, kind, text: "", assistance: "unknown", ...extra });
const criterion = () =>
  ev("criterion_set", { actor: "user", student_text: "규정 원문과 같은 시간표가 보여야 한다", context: CTX, evidence_type: "criterion", source_state: "self_reported" });
const noop = () => {};

const { learningState } = await import("../src/learningStateHelpers.ts");

// ── 1. learningState closes completion by phase ───────────────────────────────

await check("SX-55 negative: before any work (assigned) completion is closed, and the reason says what starts the task", () => {
  // No completion condition declared, so the gate alone would open (the positive control below).
  const state = learningState({ task: TASK, events: [], completion: [], phase: "assigned" });
  assert.equal(state.complete.ok, false, "a button pressed before any work would submit a task nobody started");
  assert.ok(state.complete.reasons.some((r) => r.includes("시작 전")), `no reason names the missing start: ${JSON.stringify(state.complete.reasons)}`);
  assert.ok(state.complete.reasons.every((r) => !/\d/.test(r)), "a reason with a number reads as a progress rate (SX-59)");
});

await check("SX-55 positive: the same task while working opens on the gate alone", () => {
  const state = learningState({ task: TASK, events: [], completion: [], phase: "working" });
  assert.equal(state.complete.ok, true, "a working task with its gate met is blocked: too strict");
  assert.deepEqual(state.complete.reasons, []);
});

await check("SX-55: once submitted there is nothing to press, and nothing is listed as missing", () => {
  // With the gate met (nothing declared) and with it unmet: there is no button left to explain.
  for (const completion of [[], COMPLETION]) {
    const state = learningState({ task: TASK, events: [], completion, phase: "submitted" });
    assert.equal(state.complete.ok, false, "a submitted task can be submitted again");
    assert.deepEqual(state.complete.reasons, [], `a submitted task is told something is still missing (${completion.length} conditions declared)`);
    assert.equal(state.phase, "submitted");
  }
});

await check("invariant: a seat that runs no task flow (no phase) reads exactly as before — the gate alone decides", () => {
  seq = 0;
  const open = learningState({ task: TASK, events: [criterion()], completion: COMPLETION.slice(0, 1) });
  assert.equal(open.phase, "working");
  assert.equal(open.complete.ok, true, "the P1 gate no longer opens for a seat without the flow");
  const shut = learningState({ task: TASK, events: [], completion: COMPLETION.slice(0, 1) });
  assert.equal(shut.complete.ok, false);
  assert.ok(!shut.complete.reasons.some((r) => r.includes("시작 전")), "a seat without the flow is told it has not started");
});

await check("region A reads the gate's own `missing` in every phase, not the phase-adjusted button", () => {
  seq = 0;
  const state = learningState({ task: TASK, events: [criterion()], completion: COMPLETION, phase: "submitted" });
  assert.deepEqual(state.complete.missing.map((m) => m.item), ["c2", "c3"]);
});

await check("a notice travels with the state, and only when there is one", () => {
  const said = learningState({ task: TASK, events: [], completion: [], phase: "working", notice: "제출을 저장하지 못했어요 (storage_busy). 다시 한 번 눌러 주세요." });
  assert.equal(said.notice, "제출을 저장하지 못했어요 (storage_busy). 다시 한 번 눌러 주세요.");
  const quiet = learningState({ task: TASK, events: [], completion: [], phase: "working", notice: null });
  assert.equal("notice" in quiet, false, "an empty notice line would be drawn as an empty alert");
});

// ── 2. Region A checks a condition off only where the host's gate says so ─────

const logic = await import("../webview-ui/src/missionHeaderLogic.ts");

await check("completionMet reads the gate's verdict: its own miss unchecks it, another item's does not", () => {
  assert.equal(typeof logic.completionMet, "function", "region A has no rule for checking a condition off");
  const [c1, c2] = week3.learning.completion;
  const missC1 = { code: "missing_completion_event", item: "c1", event: "criterion_set" };
  assert.equal(logic.completionMet(c1, []), true, "nothing missing, still unchecked: too strict");
  assert.equal(logic.completionMet(c1, [missC1]), false, "the gate names c1 as missing and c1 is checked: too lenient");
  assert.equal(logic.completionMet(c2, [missC1]), true, "c1's miss unchecked c2");
});

await check("completionMet negative: a criterion written after the draft does not earn '시험 전에 적었다'", () => {
  const [c1, c2] = week3.learning.completion;
  const late = { code: "criterion_after_artifact", event: "criterion_set" };
  assert.equal(logic.completionMet(c1, [late]), false, "the gate says the criterion came late and c1 claims it came first");
  assert.equal(logic.completionMet(c2, [late]), true, "a criterion miss unchecked an unrelated item");
});

// ── 3. The host calls the flow at each moment the design names ────────────────

const provider = readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
const between = (text, from, to) => {
  const a = text.indexOf(from);
  const b = a < 0 ? -1 : text.indexOf(to, a + from.length);
  return a >= 0 && b > a ? text.slice(a, b) : "";
};
/** The submit handler's order: judge the gate again, return on a refusal, then move the task. */
function submitOrder(text) {
  const body = between(text, "case 'submitTask': {", 'case "inboxRequest"');
  const gate = body.indexOf("acceptSubmit(");
  const refuse = body.indexOf("if (!verdict.ok)");
  const move = body.indexOf("runTaskFlow({ kind: 'submit' }");
  return { body, ok: gate > 0 && refuse > gate && move > refuse };
}

/**
 * A static host check: `rule(text)` names what is wrong with one source text, or returns null.
 * It runs on the real source, then on each planted copy, which it must refuse — a rule that
 * passes a provider with the defect planted counts nothing.
 */
async function hostCheck(name, source, rule, plants) {
  await check(name, () => {
    const problem = rule(source);
    assert.equal(problem, null, problem ?? "");
    for (const [from, to] of plants) {
      assert.ok(source.includes(from), `the planted defect did not apply (${from.slice(0, 70)}) — the check proves nothing`);
      assert.notEqual(rule(source.replace(from, to)), null, `a source planted with "${to.slice(0, 70)}" passed`);
    }
  });
}
const lacks = (text, pattern, why) => (pattern.test(text) ? null : why);
const postBody = (text) => between(text, "private async postLearningState()", "private taskFlowNotice");
const targetBody = (text) => between(text, "private taskFlowTarget(", "private async runTaskFlow(");
const runBody = (text) => between(text, "private async runTaskFlow(", "private async recordStepStart(");

await hostCheck(
  "host: the task opens where the learning state is computed, and its stored phase is what is sent",
  provider,
  (text) =>
    lacks(postBody(text), /const target = this\.taskFlowTarget\(recorder, profile\);\s*const shown = target \? screenFlow\(await this\.runTaskFlow\(\{ kind: 'seen' \}, recorder, profile\), this\.taskFlowLast, target\.recordId\) : null;/, "postLearningState never opens the task, or reads the last phase of another record") ??
    lacks(postBody(text), /phase: shown\.curriculum\.phase, currentStep: shown\.curriculum\.current_step/, "the stored phase is not what the screen gets") ??
    lacks(runBody(text), /this\.taskFlowLast = \{ recordId: target\.recordId, curriculum: outcome\.curriculum, changed_at: outcome\.changed_at \};/, "a successful read is not remembered for a busy record"),
  [
    ["this.taskFlowLast, target.recordId) : null;", "this.taskFlowLast, task) : null;"],
    ["this.taskFlowLast = { recordId: target.recordId, curriculum: outcome.curriculum, changed_at: outcome.changed_at };", ""],
  ],
);

await hostCheck(
  "host: the notice is read, cleared and sent with the state it explains (postLearningState)",
  provider,
  (text) =>
    lacks(postBody(text), /const notice = this\.taskFlowNotice;\s*this\.taskFlowNotice = null;[\s\S]*learningState\(\{[\s\S]*\bnotice,\s*\}\)/, "the waiting notice never reaches the screen, or is said twice"),
  [
    // (h) the notice is dropped before it is sent.
    ["const notice = this.taskFlowNotice;\n    this.taskFlowNotice = null;", "const notice = null;"],
    // the notice is read but never cleared: it would be said again with every later state.
    ["const notice = this.taskFlowNotice;\n    this.taskFlowNotice = null;", "const notice = this.taskFlowNotice;"],
  ],
);

await hostCheck(
  "host: every task-flow result goes through flowNotice with the line still waiting",
  provider,
  (text) =>
    lacks(runBody(text), /this\.taskFlowNotice = flowNotice\(this\.taskFlowNotice, signal, \{ outcome \}\);/, "a refused submit is never said beside the button") ??
    lacks(runBody(text), /catch \(error\) \{\s*this\.taskFlowNotice = flowNotice\(this\.taskFlowNotice, signal, \{ error: flowErrorCode\(error\) \}\);/, "a store failure is not said, or replaces the line still waiting"),
  [
    // (f) the outcome is never turned into a notice: "아직 시작 전이라 제출할 수 없어요" is lost.
    ["this.taskFlowNotice = flowNotice(this.taskFlowNotice, signal, { outcome });", ""],
    // (b) a failure forgets the line still waiting: the refresh after a failed submit overwrites it.
    ["flowNotice(this.taskFlowNotice, signal, { error:", "flowNotice(null, signal, { error:"],
  ],
);

await hostCheck(
  "host: a submit moves the task only after the gate is judged again on the host",
  provider,
  (text) => {
    const { body, ok } = submitOrder(text);
    return (ok ? null : "the submit handler moves the task before (or without) re-judging the gate") ?? lacks(body, /if \(msg\.task !== current\)/, "a submit naming another task would move this one");
  },
  [
    // The move now comes first: the same order check must refuse it.
    ["case 'submitTask': {", "case 'submitTask': { await this.runTaskFlow({ kind: 'submit' }, recorder, profile);"],
    ["if (msg.task !== current) { await this.postLearningState(); return; }", ""],
  ],
);

await check("host: the student's learning event and a coach turn that answered both count as work", () => {
  assert.match(between(provider, "case 'learningEvent': {", "case 'learningDrawer':"), /recordLearningEvent\(made\.event\)[\s\S]*runTaskFlow\(\{ kind: 'work' \}/);
  assert.match(
    provider,
    /observation\?\.batch\.format === 'hps-observation\/2' && finalSpoolStatus === 'ok' && assistantText\.length > 0\) \{\s*void this\.runTaskFlow\(\{ kind: 'work' \}, observation, profile\)/,
    "a coach turn never starts the task, or a failed or cancelled turn does",
  );
});

const stepBody = (text) => between(text, 'case "lessonStep": {', 'case "lessonFocus": {');
await hostCheck(
  "host: starting a step asks the flow, and a moved step is redrawn; marking a step done moves nothing",
  provider,
  (text) =>
    lacks(stepBody(text), /if \(signal\.status === "in_progress" && runsTaskFlow\(this\.cachedProfile\)\) void this\.recordStepStart\(signal\.step_id\)/, "a started step never reaches the flow") ??
    // The third condition is SX-02's (test/sx-home.smoke.mjs judges it); this check needs the first two.
    lacks(between(text, "private async recordStepStart(", "private view?"), /runTaskFlow\(\{ kind: 'start_step', stepId \}[\s\S]*if \(flow\?\.changed \|\| this\.taskFlowNotice \|\| this\.flowSession\.stale\) await this\.postLearningState\(\);/, "a step start is stored but never redrawn"),
  [
    ['if (signal.status === "in_progress" && runsTaskFlow(this.cachedProfile)) void this.recordStepStart(signal.step_id)', 'if (false) void this.recordStepStart(signal.step_id)'],
    // M5 — the step start's redraw is gone.
    ["if (flow?.changed || this.taskFlowNotice || this.flowSession.stale) await this.postLearningState();\n  }", "\n  }"],
  ],
);

await hostCheck(
  "host: a step start on a seat outside the flow prepares no observation recorder (no Service request, no recorder reset)",
  provider,
  (text) => {
    const body = stepBody(text);
    // Every call that reaches the recorder from this handler must sit behind the flow's own test.
    const calls = [...body.matchAll(/this\.(recordStepStart|currentLearningRecorder|postLearningState|runTaskFlow)\(/g)];
    if (calls.length === 0) return "the handler no longer starts a step in the flow at all";
    return calls.every((m) => /&& runsTaskFlow\(this\.cachedProfile\)\) void $/.test(body.slice(0, m.index))) ? null : "a /1 or mission-less seat now prepares the observation recorder on every step start";
  },
  [
    // The review's finding: the hook ran on every seat.
    ['if (signal.status === "in_progress" && runsTaskFlow(this.cachedProfile)) void this.recordStepStart', 'if (signal.status === "in_progress") void this.recordStepStart'],
    // A second, ungated way into the recorder from the same handler.
    ['this.opsObserver?.lessonStep(signal.lesson_version, signal.step_id, signal.status);', 'this.opsObserver?.lessonStep(signal.lesson_version, signal.step_id, signal.status); void this.currentLearningRecorder();'],
  ],
);

await hostCheck(
  "host: the flow runs on the record the local review already uses, locked for every write (SX-48), on this seat's own events",
  provider,
  (text) =>
    lacks(runBody(text), /this\.crRecordHandle\(\)/, "the flow opened a store of its own") ??
    lacks(runBody(text), /await runTaskFlowOn\(store, record, \{ \.\.\.target, signal, events: recorder\.batch\.events, at: Date\.now\(\) \}\)/, "the flow runs around runTaskFlowOn (the lock for a write, a plain read for whatever writes nothing), or judges the start and the step gates on something other than this recorder's batch") ??
    lacks(targetBody(text), /if \(!lesson \|\| recorder\.batch\.format !== 'hps-observation\/2'\) return null;/, "a seat without a mission or without /2 runs the flow"),
  [
    // M2 — the start and the gates are judged on nothing: a seat that worked reopens as not started.
    ["signal, events: recorder.batch.events, at: Date.now()", "signal, events: [], at: Date.now()"],
    ["if (!lesson || recorder.batch.format !== 'hps-observation/2') return null;", "if (!lesson) return null;"],
    // Back to the lock for every signal: a busy record again fails a refresh or a coach turn that writes nothing.
    ["await runTaskFlowOn(store, record, {", "await store.exclusive(() => applyTaskFlow(record, {"],
  ],
);

await hostCheck(
  "host: the record id carries the observation batch the gate reads and this folder",
  provider,
  (text) =>
    lacks(targetBody(text), /const \{ format, scope, program \} = recorder\.batch;\s*return \{ lesson, taskId, recordId: taskRecordIdOf\(taskId, \{ workspace: this\.context\.storageUri\?\.toString\(\) \?\? '', format, scope, program \}\) \};/, "the record is keyed without the seat's observation scope or the folder: another seat reads this task's phase"),
  [
    ["recordId: taskRecordIdOf(taskId, {", "recordId: taskId, unused: ({"],
    ["workspace: this.context.storageUri?.toString() ?? ''", "workspace: ''"],
  ],
);

const reviewPanel = readFileSync(new URL("../src/localReviewPanel.ts", import.meta.url), "utf8");
const refreshBody = (text) => between(text, "const refresh = async", "const handle = async");
await hostCheck(
  "review panel (MC-27): the list comes from reviewRecords, and how many it leaves out goes to the screen with it",
  reviewPanel,
  (text) =>
    lacks(refreshBody(text), /const \{ tasks, improvements, curriculumTasks \} = await service\.reviewRecords\(\);/, "the review panel lists the raw record again, or drops the count of what it leaves out") ??
    lacks(refreshBody(text), /postMessage\(\{ type: 'localReviewState', tasks, improvements, curriculumTasks,/, "the count of what the list leaves out never reaches the screen: the omission is silent again"),
  [
    // M1 — the panel reads the raw record: the curriculum task is listed and fails when clicked.
    ["await service.reviewRecords()", "await service.record.records()"],
    // The review's finding: the records are filtered and nothing says so.
    ["tasks, improvements, curriculumTasks, storage", "tasks, improvements, storage"],
  ],
);

const deleteBody = (text) => between(text, "msg.action === 'deleteCurriculum'", "else if (msg.action !== 'load')");
await hostCheck(
  "review panel (MC-31): the curriculum task records are deleted only after a modal question that says what stays",
  reviewPanel,
  (text) => {
    const body = deleteBody(text);
    const ask = body.indexOf("showWarningMessage(curriculumDeleteQuestion(curriculumTasks), { modal: true }, '지우기') === '지우기'");
    const remove = body.indexOf("service.deleteCurriculumTasks()");
    return ask > 0 && remove > ask ? null : "the curriculum task records are deleted without the question, or before it";
  },
  [
    // Deleted with no question at all.
    ["if (curriculumTasks > 0 && await vscode.window.showWarningMessage(curriculumDeleteQuestion(curriculumTasks), { modal: true }, '지우기') === '지우기') {", "if (curriculumTasks > 0) {"],
    // Asked, but without saying what stays where the delete cannot reach (MC-31).
    ["showWarningMessage(curriculumDeleteQuestion(curriculumTasks),", "showWarningMessage('기록을 지울까요?',"],
  ],
);

// ── 4. The flow's rules, pure ──────────────────────────────────────────────────

const flow = await load("../src/taskFlowHelpers.ts");
const lesson = flow?.flowLessonOf(LESSON) ?? null;
/** Two seats on one OS account: the same folder, two observation scopes (two tokens). */
const SEAT_A = { workspace: "file:///ws/globalbuddy", format: "hps-observation/2", scope: "a".repeat(64), program: "canary-sdk-contract" };
const SEAT_B = { ...SEAT_A, scope: "b".repeat(64) };
const RECORD = flow ? flow.taskRecordIdOf(TASK, SEAT_A) : "";
const curriculumAt = (phase, current_step = "expect") => ({ module: { course_id: "globalbuddy", version: LESSON.version, sha256: LESSON.sha256 }, week: 3, phase, current_step, steps: {} });

if (flow) {
  await check("SX-01 negative: a design file without a mission starts no task flow", () => {
    assert.ok(lesson, "the week-3 design runs no flow: too strict");
    assert.equal(lesson.week, 3);
    assert.deepEqual(lesson.steps.map((s) => s.id), week3.steps.map((s) => s.id));
    const { learning: _l, ...noLearning } = week3;
    assert.equal(flow.flowLessonOf({ ...LESSON, content: noLearning }), null, "no learning block, and the flow starts");
    assert.equal(flow.flowLessonOf({ ...LESSON, content: { ...week3, learning: { ...week3.learning, mission: "  " } } }), null, "a blank mission starts the flow");
    assert.equal(flow.flowLessonOf(null), null);
    assert.equal(flow.flowLessonOf({ ...LESSON, sha256: "not-a-digest" }), null);
    assert.equal(flow.flowLessonOf({ ...LESSON, content: { ...week3, steps: [] } }), null);
    assert.equal(flow.flowLessonOf({ ...LESSON, content: { ...week3, learning: { ...week3.learning, week: 0 } } }), null);
  });

  await check("the flow reads each step's gate from the design, and refuses a gate no event can meet", () => {
    assert.deepEqual(lesson.steps, week3.steps.map((s) => (s.gate ? { id: s.id, gate: s.gate } : { id: s.id })), "a step's gate was lost: the step could be left without it");
    const bad = { ...week3, steps: week3.steps.map((s, i) => (i === 0 ? { ...s, gate: "criterion_written" } : s)) };
    assert.equal(flow.flowLessonOf({ ...LESSON, content: bad }), null, "a gate that is no learning event kind was kept: nothing could ever leave that step");
  });

  await check("a design that repeats a step id runs no flow: the step walk could never end (the Service refuses it too)", () => {
    // The review's repro: steps a, b, a, c — a start_step to c walked a → b → a → b … inside the record's lock.
    const repeated = { ...week3, steps: [{ id: "a" }, { id: "b" }, { id: "a" }, { id: "c" }] };
    assert.equal(flow.flowLessonOf({ ...LESSON, content: repeated }), null, "a repeated step id was accepted");
    const [first, second] = week3.steps;
    assert.equal(flow.flowLessonOf({ ...LESSON, content: { ...week3, steps: [first, second, { ...first, gate: undefined }] } }), null, "a repeat of the first step was accepted");
    // Control: the same shape with distinct ids is a lesson the flow runs.
    assert.ok(flow.flowLessonOf({ ...LESSON, content: { ...week3, steps: [{ id: "a" }, { id: "b" }, { id: "a2" }, { id: "c" }] } }), "distinct ids refused: too strict");
  });

  await check("runsTaskFlow: only a /2 seat on a lesson the flow can run — the test the step-start hook reads", () => {
    const p2 = { observation: { format: "hps-observation/2" }, lesson: LESSON };
    assert.equal(flow.runsTaskFlow(p2), true, "a /2 seat with a mission does not run the flow: too strict");
    assert.equal(flow.runsTaskFlow({ ...p2, observation: { format: "hps-observation/1" } }), false, "a /1 classroom seat runs the flow");
    assert.equal(flow.runsTaskFlow({ lesson: LESSON }), false, "a seat that declares no observation format runs the flow");
    assert.equal(flow.runsTaskFlow({ ...p2, observation: null }), false);
    assert.equal(flow.runsTaskFlow({ ...p2, lesson: { ...LESSON, content: { ...week3, learning: { ...week3.learning, mission: "" } } } }), false, "a lesson without a mission runs the flow (SX-01 negative)");
    assert.equal(flow.runsTaskFlow({ ...p2, lesson: undefined }), false, "a seat with no confirmed lesson runs the flow");
    assert.equal(flow.runsTaskFlow(null), false);
    assert.equal(flow.runsTaskFlow(undefined), false);
  });

  await check("decideFlow: the phase transitions, both directions", () => {
    assert.deepEqual(flow.decideFlow(curriculumAt("assigned"), { kind: "work" }, lesson, []), { kind: "patch", patch: { phase: "working" } });
    assert.deepEqual(flow.decideFlow(curriculumAt("working"), { kind: "work" }, lesson, []), { kind: "none" });
    assert.deepEqual(flow.decideFlow(curriculumAt("working"), { kind: "submit" }, lesson, []), { kind: "patch", patch: { phase: "submitted" } });
    assert.deepEqual(flow.decideFlow(curriculumAt("assigned"), { kind: "submit" }, lesson, []), { kind: "refused", code: "not_started" });
    assert.deepEqual(flow.decideFlow(curriculumAt("submitted"), { kind: "submit" }, lesson, []), { kind: "none" });
    assert.deepEqual(flow.decideFlow(curriculumAt("working"), { kind: "seen" }, lesson, []), { kind: "none" });
  });

  await check("SX-55 step gate positive: forward past a gate the student met moves; back always moves (SX-16)", () => {
    seq = 0;
    const mine = [criterion()];
    assert.deepEqual(flow.decideFlow(curriculumAt("working"), { kind: "start_step", stepId: "build" }, lesson, mine), { kind: "patch", patch: { current_step: "build" } }, "the student's criterion meets expect's gate and the move was refused: too strict");
    assert.deepEqual(flow.decideFlow(curriculumAt("working"), { kind: "start_step", stepId: "test" }, lesson, mine), { kind: "patch", patch: { current_step: "test" } }, "build has no gate, so test is reachable");
    assert.deepEqual(flow.decideFlow(curriculumAt("working", "test"), { kind: "start_step", stepId: "expect" }, lesson, []), { kind: "patch", patch: { current_step: "expect" } }, "going back was refused");
    // Back to a step that is not the first, with no event at all: still allowed, no gate is asked.
    assert.deepEqual(flow.decideFlow(curriculumAt("working", "retest"), { kind: "start_step", stepId: "build" }, lesson, []), { kind: "patch", patch: { current_step: "build" } }, "going back was judged like a forward move");
    assert.deepEqual(flow.decideFlow(curriculumAt("working", "test"), { kind: "start_step", stepId: "test" }, lesson, mine), { kind: "none" });
  });

  await check("SX-55 step gate negative: no forward move past a gate the student's own event has not met", () => {
    seq = 0;
    assert.deepEqual(flow.decideFlow(curriculumAt("working"), { kind: "start_step", stepId: "build" }, lesson, []), { kind: "refused", code: "gate_not_met", gate: "criterion_set" });
    // A jump is judged on every step before the target, not only on the one being left.
    assert.deepEqual(flow.decideFlow(curriculumAt("working"), { kind: "start_step", stepId: "retest" }, lesson, [criterion()]), { kind: "refused", code: "gate_not_met", gate: "test_observed" });
    assert.deepEqual(flow.decideFlow(curriculumAt("working", "diff"), { kind: "start_step", stepId: "retest" }, lesson, []), { kind: "refused", code: "gate_not_met", gate: "criterion_set" }, "a later stored step let a jump skip the earlier gates");
    // The gate needs the STUDENT's event: a criterion the coach wrote is not theirs (SX-45).
    assert.deepEqual(flow.decideFlow(curriculumAt("working"), { kind: "start_step", stepId: "build" }, lesson, [{ ...criterion(), actor: "ai" }]), { kind: "refused", code: "gate_not_met", gate: "criterion_set" }, "an AI-authored criterion opened the student's gate");
    assert.deepEqual(flow.decideFlow(curriculumAt("working"), { kind: "start_step", stepId: "없는단계" }, lesson, []), { kind: "refused", code: "unknown_step" });
  });

  await check("SX-55 step negative: a step moves only while working — not before any work, not after the submit", () => {
    seq = 0;
    const mine = [criterion()];
    assert.deepEqual(flow.decideFlow(curriculumAt("assigned"), { kind: "start_step", stepId: "build" }, lesson, mine), { kind: "refused", code: "not_started" });
    for (const phase of ["submitted", "reflected"]) {
      for (const stepId of ["build", "expect", "retest"]) {
        assert.deepEqual(flow.decideFlow(curriculumAt(phase, "test"), { kind: "start_step", stepId }, lesson, mine), { kind: "none" }, `${phase}: a step move to ${stepId} was decided`);
      }
    }
  });

  await check("SX-55 negative: no signal the host has moves a task to reflected (the boundary reflection, sx-p2)", () => {
    seq = 0;
    const signals = [{ kind: "seen" }, { kind: "work" }, { kind: "submit" }, { kind: "start_step", stepId: "build" }, { kind: "start_step", stepId: "retest" }];
    for (const phase of ["assigned", "working", "submitted"]) {
      for (const signal of signals) {
        const d = flow.decideFlow(curriculumAt(phase), signal, lesson, [criterion()]);
        assert.notEqual(d.kind === "patch" ? d.patch.phase : undefined, "reflected", `${phase} + ${signal.kind} reached reflected`);
      }
    }
  });

  await check("one task per lesson version and activity; a new version is a new task (MC-08)", () => {
    assert.equal(flow.learningTaskIdOf("f".repeat(64), "a1b2c3d4e5f6"), TASK);
    assert.notEqual(flow.learningTaskIdOf("e".repeat(64), "a1b2c3d4"), flow.learningTaskIdOf("f".repeat(64), "a1b2c3d4"));
  });

  await check("record id: one record per seat and folder — named by the observation batch the gate reads", () => {
    const a = flow.taskRecordIdOf(TASK, SEAT_A);
    assert.equal(a, flow.taskRecordIdOf(TASK, { ...SEAT_A }), "the same seat in the same folder got two records");
    assert.ok(a.startsWith(TASK + "."), "the record id no longer names the design's task");
    assert.match(a, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, "the record store refuses this id (LocalRecord's id rule)");
    for (const other of [SEAT_B, { ...SEAT_A, workspace: "file:///ws/other-folder" }, { ...SEAT_A, program: "other-program" }, { ...SEAT_A, format: "hps-observation/1" }]) {
      assert.notEqual(flow.taskRecordIdOf(TASK, other), a, `a seat differing only in ${JSON.stringify(other)} shares the record`);
    }
    assert.notEqual(flow.taskRecordIdOf(flow.learningTaskIdOf("e".repeat(64), "a1b2c3d4"), SEAT_A), a, "two tasks of one seat share a record");
  });

  await check("screenFlow: a record that could not be read shows the last phase read for the same record, never a default", () => {
    const submitted = { ...curriculumAt("submitted", "retest") };
    const working = { ...submitted, phase: "working" };
    // The record's last-change time travels with its phase (SX-02 reads it), from the same read.
    assert.deepEqual(flow.screenFlow({ curriculum: working, changed_at: 2, changed: false }, { recordId: RECORD, curriculum: submitted, changed_at: 1 }, RECORD), { curriculum: working, changed_at: 2 }, "a fresh read lost to a remembered one");
    assert.deepEqual(flow.screenFlow(null, { recordId: RECORD, curriculum: submitted, changed_at: 1 }, RECORD), { curriculum: submitted, changed_at: 1 }, "a busy record put the completion button back on a submitted task");
    assert.equal(flow.screenFlow(null, { recordId: flow.taskRecordIdOf(TASK, SEAT_B), curriculum: submitted, changed_at: 1 }, RECORD), null, "another seat's phase was shown for this one");
    assert.equal(flow.screenFlow(null, null, RECORD), null);
  });

  await check("startedBefore: only this task's learning event counts", () => {
    seq = 0;
    assert.equal(flow.startedBefore([criterion()], TASK), true);
    assert.equal(flow.startedBefore([criterion()], "task-other"), false, "another task's event started this one");
    assert.equal(flow.startedBefore([ev("coach", { text: "안녕하세요" }), ev("artifact", { sha256: "a".repeat(64) })], TASK), false, "a coach message or an AI draft is not the student's work");
  });

  await check("notice: a submit the record could not store is said, and replaces the line still waiting", () => {
    assert.equal(flow.flowNotice(null, { kind: "submit" }, { error: "storage_busy" }), "제출을 저장하지 못했어요 (storage_busy). 다시 한 번 눌러 주세요.");
    assert.equal(flow.flowNotice("앞의 줄", { kind: "submit" }, { error: "storage_busy" }), flow.submitNotStoredSentence("storage_busy"));
  });

  await check("notice (b): the refresh after a failed submit keeps the submit's sentence; other failures are said", () => {
    const waiting = flow.submitNotStoredSentence("storage_busy");
    assert.equal(flow.flowNotice(waiting, { kind: "seen" }, { error: "storage_busy" }), waiting, "the refresh overwrote the sentence that says the submit was not stored");
    assert.equal(flow.flowNotice(null, { kind: "seen" }, { error: "storage_busy" }), flow.flowNotStoredSentence("storage_busy"), "a failed read with nothing waiting went unsaid");
    assert.equal(flow.flowNotice(null, { kind: "work" }, { error: "capacity_exceeded" }), "과제 진행 기록을 읽거나 저장하지 못했어요 (capacity_exceeded). 작업은 계속할 수 있어요.");
  });

  await check("notice (f): a submit refused before any work says what starts the task; nothing else adds a line", () => {
    const answered = (refused) => ({ outcome: { curriculum: curriculumAt("assigned"), changed: false, ...(refused ? { refused } : {}) } });
    assert.equal(flow.flowNotice(null, { kind: "submit" }, answered("not_started")), "아직 시작 전이라 제출할 수 없어요. 코치와 이야기하거나 기록을 남기면 시작돼요");
    assert.equal(flow.flowNotice(null, { kind: "submit" }, answered()), null, "an accepted submit was told something");
    assert.equal(flow.flowNotice(null, { kind: "start_step", stepId: "retest" }, answered("gate_not_met")), null, "a refused step start put an alert beside the completion button");
    assert.equal(flow.flowNotice("남은 줄", { kind: "seen" }, answered()), "남은 줄", "a successful refresh dropped the line still waiting");
  });

  await check("notice: a step start refused before any work says nothing, and leaves the line still waiting as it was", () => {
    // Same refusal code as the submit's, different signal: only the submit is told "제출할 수 없어요".
    const refusedStart = { outcome: { curriculum: curriculumAt("assigned"), changed: false, refused: "not_started" } };
    assert.equal(flow.flowNotice(null, { kind: "start_step", stepId: "build" }, refusedStart), null, "a step start before any work was told it cannot be submitted");
    assert.equal(flow.flowNotice("남은 줄", { kind: "start_step", stepId: "build" }, refusedStart), "남은 줄", "a refused step start replaced the line still waiting");
    assert.equal(flow.flowNotice("남은 줄", { kind: "start_step", stepId: "없는단계" }, { outcome: { curriculum: curriculumAt("working"), changed: false, refused: "unknown_step" } }), "남은 줄");
  });

  await check("notice: a failure is named by its code, never by a message or a path", () => {
    assert.equal(flow.flowErrorCode(new Error("storage_busy")), "storage_busy");
    assert.equal(flow.flowErrorCode(new Error("ENOENT: no such file, open '/Users/someone/x.json'")), "storage_failure");
    assert.equal(flow.flowErrorCode("storage_busy"), "storage_failure");
  });
}

// ── 5. The same rules on the App's real record store ──────────────────────────

const { FileRecordStorage } = await import("../src/localRecordFile.ts");
const { LocalRecord } = await import("../../../worker/src/lib/measurement-core/index.ts");
const root = await mkdtemp(join(tmpdir(), "hps-task-flow-"));
try {
  if (flow && lesson) {
    // A fresh store and record per call: what a reload or a second window reads.
    const open = () => {
      const store = new FileRecordStorage(root);
      return { store, record: new LocalRecord(store) };
    };
    // What the host runs (runTaskFlowOn): the record's lock for a write, a plain read for whatever writes nothing.
    const apply = (signal, at, { events = [], taskId = TASK, recordId = RECORD } = {}) => {
      const { store, record } = open();
      return flow.runTaskFlowOn(store, record, { taskId, recordId, lesson, signal, events, at });
    };
    const stored = (recordId = RECORD) => open().record.getTask(recordId);
    const phases = async (recordId = RECORD) =>
      (await stored(recordId)).history.filter((h) => h.change.startsWith("curriculum:phase:")).map((h) => h.change.slice("curriculum:phase:".length));
    /** Another live Studio window holding the record's lock (this test's parent process stands in for it). */
    const whileLocked = async (fn) => {
      const lock = join(root, ".writer");
      await mkdir(lock);
      await writeFile(join(lock, "pid"), String(process.ppid));
      try {
        return await fn();
      } finally {
        await rm(lock, { recursive: true, force: true });
      }
    };
    seq = 0;
    // The student's own criterion for this task: expect's gate.
    const theirCriterion = criterion();
    const forTask = (taskId, e = theirCriterion) => ({ ...e, task: taskId, context: { ...e.context, task: taskId } });

    await check("seen: the task opens once, as assigned on its first step, naming its module", async () => {
      const first = await apply({ kind: "seen" }, 1000);
      assert.equal(first.changed, true);
      assert.equal(first.curriculum.phase, "assigned");
      assert.equal(first.curriculum.current_step, "expect");
      assert.equal(first.curriculum.week, 3);
      assert.deepEqual(first.curriculum.module, { course_id: "globalbuddy", version: LESSON.version, sha256: LESSON.sha256 });
      assert.equal((await stored()).id, RECORD, "the record is not stored under this seat's id");
      const again = await apply({ kind: "seen" }, 1001);
      assert.equal(again.changed, false, "a screen refresh rewrote the record");
    });

    await check("who acted: the record a refresh opens is the host's, created line included; the student's work is theirs", async () => {
      const opened = await stored();
      assert.deepEqual(opened.history[0], { at: 1000, by: "adapter_explicit", change: "created" }, "the record says the student created a task the host opened");
      assert.deepEqual(opened.history.filter((h) => h.change.startsWith("curriculum:")).map((h) => h.by), ["adapter_explicit", "adapter_explicit"], "the host's opening of the curriculum is not marked as the host's");
      // A task first opened by the student's own work: every line is theirs.
      const byWork = flow.learningTaskIdOf("f".repeat(64), "wk000000");
      const recordId = flow.taskRecordIdOf(byWork, SEAT_A);
      await apply({ kind: "work" }, 1050, { taskId: byWork, recordId });
      const worked = await stored(recordId);
      assert.deepEqual(worked.history.map((h) => [h.by, h.change]), [["user", "created"], ["user", "curriculum:phase:working"], ["user", "curriculum:step:expect:entered"]]);
    });

    await check("SX-55 negative: a submit before any work is refused by name and moves nothing", async () => {
      const r = await apply({ kind: "submit" }, 1100);
      assert.equal(r.refused, "not_started");
      assert.equal(r.changed, false);
      assert.equal(r.curriculum.phase, "assigned");
      assert.deepEqual(await phases(), ["assigned"]);
    });

    await check("SX-55: the first work moves assigned → working; more work changes nothing", async () => {
      const r = await apply({ kind: "work" }, 1200);
      assert.equal(r.curriculum.phase, "working");
      assert.equal((await apply({ kind: "work" }, 1201)).changed, false);
      assert.deepEqual(await phases(), ["assigned", "working"]);
    });

    await check("SX-55 step negative: a jump past gates nobody met is refused and stores nothing", async () => {
      const r = await apply({ kind: "start_step", stepId: "retest" }, 1250);
      assert.equal(r.refused, "gate_not_met");
      assert.equal(r.changed, false, "a refused jump was written");
      const task = await stored();
      assert.equal(task.curriculum.current_step, "expect");
      assert.ok(!task.history.some((h) => h.change.startsWith("curriculum:step:retest")), "the record says the student entered retest");
    });

    await check("step: past a met gate the step is recorded; going back is allowed and keeps the earlier record", async () => {
      const r = await apply({ kind: "start_step", stepId: "test" }, 1300, { events: [theirCriterion] });
      assert.equal(r.refused, undefined, "the student's own criterion did not open expect's gate: too strict");
      assert.equal(r.curriculum.current_step, "test");
      assert.equal(r.curriculum.steps.expect.left_at, 1300, "the step left has no left_at");
      const back = await apply({ kind: "start_step", stepId: "expect" }, 1400);
      assert.equal(back.curriculum.current_step, "expect");
      assert.equal(back.curriculum.steps.test.entered_at, 1300, "going back erased the visit to the later step");
      assert.equal(back.curriculum.steps.test.left_at, 1400);
    });

    await check("step negative: a step that is not this lesson's, or a gate met only by another task's event, moves nothing", async () => {
      const r = await apply({ kind: "start_step", stepId: "없는단계" }, 1450, { events: [theirCriterion] });
      assert.equal(r.refused, "unknown_step");
      assert.equal(r.changed, false);
      const foreign = await apply({ kind: "start_step", stepId: "build" }, 1460, { events: [forTask("task-other")] });
      assert.equal(foreign.refused, "gate_not_met", "another task's criterion opened this task's gate");
      assert.equal((await stored()).curriculum.current_step, "expect");
    });

    await check("SX-55: a submit while working moves to submitted, and a reload reads it back", async () => {
      const r = await apply({ kind: "submit" }, 1500);
      assert.equal(r.curriculum.phase, "submitted");
      assert.equal(r.curriculum.submitted_at, 1500);
      const task = await stored();
      assert.equal(task.curriculum.phase, "submitted", "the submit did not survive a reload");
      assert.equal(task.status, "open", "the flow touched the work axis (Task.status, MC-23)");
      assert.deepEqual(await phases(), ["assigned", "working", "submitted"]);
    });

    await check("SX-55: a second submit changes nothing and is not an error", async () => {
      const r = await apply({ kind: "submit" }, 1600);
      assert.equal(r.changed, false);
      assert.equal(r.refused, undefined, "a double click was reported as a refusal");
      assert.deepEqual(await phases(), ["assigned", "working", "submitted"], "a second submit was recorded twice");
    });

    await check("SX-55 negative: after the submit, nothing the host sends moves the phase or the step", async () => {
      const before = (await stored()).history.length;
      for (const signal of [{ kind: "seen" }, { kind: "work" }, { kind: "submit" }, { kind: "start_step", stepId: "build" }, { kind: "start_step", stepId: "retest" }]) {
        await apply(signal, 1700, { events: [theirCriterion] });
      }
      const task = await stored();
      assert.equal(task.curriculum.phase, "submitted");
      assert.equal(task.curriculum.current_step, "expect", "a step was entered after the submit");
      assert.equal(task.history.length, before, "something was written after the submit");
    });

    await check("started before: a task whose student already left a learning event opens as working", async () => {
      const other = flow.learningTaskIdOf("f".repeat(64), "zz000000");
      const recordId = flow.taskRecordIdOf(other, SEAT_A);
      const r = await apply({ kind: "seen" }, 1800, { taskId: other, recordId, events: [forTask(other)] });
      assert.equal(r.curriculum.phase, "working", "work already in the batch is shown as not started");
      assert.deepEqual(await phases(recordId), ["working"]);
    });

    await check("SX-55: a lost `work` signal cannot leave a started task closed — the next refresh reads the event", async () => {
      const level = flow.learningTaskIdOf("f".repeat(64), "lv000000");
      const at = { taskId: level, recordId: flow.taskRecordIdOf(level, SEAT_A) };
      const mine = [forTask(level)];
      assert.equal((await apply({ kind: "seen" }, 1900, at)).curriculum.phase, "assigned");
      // The student's criterion is in the batch, and the `work` write fails: another live Studio
      // window holds the record's lock (this test's parent process stands in for it).
      const lock = join(root, ".writer");
      await mkdir(lock);
      await writeFile(join(lock, "pid"), String(process.ppid));
      try {
        await assert.rejects(apply({ kind: "work" }, 1901, { ...at, events: mine }), /storage_busy/, "the lock did not hold — the check below proves nothing");
      } finally {
        await rm(lock, { recursive: true, force: true });
      }
      assert.equal((await stored(at.recordId)).curriculum.phase, "assigned", "the failed write was stored after all — the check below proves nothing");
      const seen = await apply({ kind: "seen" }, 1902, { ...at, events: mine });
      assert.equal(seen.curriculum.phase, "working", "a refresh with the student's criterion on record still reads 'not started'");
      const state = learningState({ task: level, events: mine, completion: COMPLETION.slice(0, 1), phase: seen.curriculum.phase });
      assert.equal(state.complete.ok, true, "the gate holds and the button is still closed");
      const submit = await apply({ kind: "submit" }, 1903, { ...at, events: mine });
      assert.equal(submit.refused, undefined, "the submit was refused as not started");
      assert.deepEqual(await phases(at.recordId), ["assigned", "working", "submitted"]);
    });

    await check("who acted: a start that a refresh reads from the student's own event is theirs, not the host's", async () => {
      const level = flow.learningTaskIdOf("f".repeat(64), "ls000000");
      const at = { taskId: level, recordId: flow.taskRecordIdOf(level, SEAT_A) };
      assert.equal((await apply({ kind: "seen" }, 1910, at)).curriculum.phase, "assigned");
      // The next refresh finds the student's criterion in the batch: the level start.
      assert.equal((await apply({ kind: "seen" }, 1911, { ...at, events: [forTask(level)] })).curriculum.phase, "working");
      assert.deepEqual(
        (await stored(at.recordId)).history.map((h) => [h.by, h.change]),
        [["adapter_explicit", "created"], ["adapter_explicit", "curriculum:phase:assigned"], ["adapter_explicit", "curriculum:step:expect:entered"], ["user", "curriculum:phase:working"]],
        "the start is credited to the host, though the student's own event is what started the task",
      );
    });

    await check("two seats on one record: B never reads A's phase, and B's submit is its own", async () => {
      const shared = flow.learningTaskIdOf("d".repeat(64), "a1b2c3d4");
      const A = { taskId: shared, recordId: flow.taskRecordIdOf(shared, SEAT_A) };
      const B = { taskId: shared, recordId: flow.taskRecordIdOf(shared, SEAT_B) };
      const eventsA = [forTask(shared)];
      await apply({ kind: "seen" }, 2000, A);
      await apply({ kind: "work" }, 2001, { ...A, events: eventsA });
      assert.equal((await apply({ kind: "submit" }, 2002, { ...A, events: eventsA })).curriculum.phase, "submitted");
      // Seat B: another token on this OS account, so another observation batch with none of A's events.
      const b = await apply({ kind: "seen" }, 2003, B);
      assert.equal(b.curriculum.phase, "assigned", "seat B opened on seat A's submitted task");
      const stateB = learningState({ task: shared, events: [], completion: COMPLETION.slice(0, 1), phase: b.curriculum.phase });
      assert.equal(stateB.complete.ok, false);
      assert.ok(stateB.complete.reasons.some((r) => r.includes("시작 전")), "region D and region A disagree about seat B");
      assert.deepEqual(stateB.complete.missing.map((m) => m.item), ["c1"]);
      assert.equal((await apply({ kind: "submit" }, 2004, B)).refused, "not_started");
      await apply({ kind: "work" }, 2005, B);
      assert.equal((await apply({ kind: "submit" }, 2006, B)).curriculum.phase, "submitted", "seat B cannot submit its own work");
      assert.deepEqual(await phases(A.recordId), ["assigned", "working", "submitted"], "seat B's moves were written on seat A's record");
      // Control: under the design's id alone (the old key) B would have read A's record, submitted.
      assert.equal((await stored(A.recordId)).curriculum.phase, "submitted");
    });

    await check("a refresh of an open task needs no lock: another Studio window writing to the record does not make it fail", async () => {
      // RECORD is submitted by now (the checks above), and another live window holds the lock.
      const shown = await whileLocked(() => apply({ kind: "seen" }, 1950, { events: [theirCriterion] }));
      assert.equal(shown.changed, false);
      assert.equal(shown.refused, undefined);
      assert.equal(shown.curriculum.phase, "submitted", "the refresh showed something other than the stored phase");
    });

    await check("refresh control: whatever must be written still takes the lock, and fails storage_busy while another window holds it", async () => {
      const fresh = flow.learningTaskIdOf("c".repeat(64), "a1b2c3d4");
      const at = { taskId: fresh, recordId: flow.taskRecordIdOf(fresh, SEAT_A) };
      // Opening a task the record does not hold yet is a write.
      await whileLocked(() => assert.rejects(apply({ kind: "seen" }, 1960, at), /storage_busy/, "a task was opened without the record's lock"));
      assert.equal((await apply({ kind: "seen" }, 1961, at)).curriculum.phase, "assigned");
      // So is the level start: the student's event for this assigned task is in the batch now.
      const mine = [forTask(fresh)];
      await whileLocked(() => assert.rejects(apply({ kind: "seen" }, 1962, { ...at, events: mine }), /storage_busy/, "the level start was answered from a plain read: a started task shown as not started"));
      assert.equal((await apply({ kind: "seen" }, 1963, { ...at, events: mine })).curriculum.phase, "working");
      // And so is a submit that moves the phase.
      await whileLocked(() => assert.rejects(apply({ kind: "submit" }, 1964, { ...at, events: mine }), /storage_busy/));
      assert.equal((await stored(at.recordId)).curriculum.phase, "working", "a refused write was stored after all");
    });

    await check("a signal that writes nothing needs no lock either: a coach turn or learning event while working, a step start in place, a refused move, a second submit", async () => {
      const quiet = flow.learningTaskIdOf("f".repeat(64), "qt000000");
      const at = { taskId: quiet, recordId: flow.taskRecordIdOf(quiet, SEAT_A) };
      const mine = [forTask(quiet)];
      await apply({ kind: "seen" }, 2100, at);
      assert.equal((await apply({ kind: "work" }, 2101, { ...at, events: mine })).curriculum.phase, "working");
      const before = (await stored(at.recordId)).history.length;
      /** One signal while another live window holds the lock: its outcome, or the error it failed with. */
      const lockedOut = (signal, when) => apply(signal, when, { ...at, events: mine }).catch((error) => ({ error: String(error?.message ?? error) }));
      const quietAs = (r, signal, refused, phase) => {
        assert.equal(r.error, undefined, `${JSON.stringify(signal)} writes nothing, yet failed ${r.error} while another window held the lock`);
        assert.equal(r.changed, false, `${JSON.stringify(signal)} wrote`);
        assert.equal(r.refused, refused);
        assert.equal(r.curriculum.phase, phase);
        // What the host does with it (runTaskFlow → flowNotice): no line beside the completion button.
        assert.equal(flow.flowNotice(null, signal, { outcome: r }), null, `${JSON.stringify(signal)} put a line beside the completion button`);
      };
      await whileLocked(async () => {
        // An answered coach turn or a learning event (`work`) on a working task; a step start onto the
        // step it stands on; a jump past test's gate (test_observed), which nobody met; a foreign step.
        for (const [signal, refused] of [[{ kind: "work" }, undefined], [{ kind: "start_step", stepId: "expect" }, undefined], [{ kind: "start_step", stepId: "retest" }, "gate_not_met"], [{ kind: "start_step", stepId: "없는단계" }, "unknown_step"]]) {
          quietAs(await lockedOut(signal, 2102), signal, refused, "working");
        }
        // Control: what does write still takes the lock, and fails while another window holds it.
        await assert.rejects(apply({ kind: "start_step", stepId: "build" }, 2103, { ...at, events: mine }), /storage_busy/, "a step move was answered from a plain read: nothing stored it");
        await assert.rejects(apply({ kind: "submit" }, 2104, { ...at, events: mine }), /storage_busy/, "a submit was answered from a plain read: nothing stored it");
      });
      const after = await stored(at.recordId);
      assert.equal(after.history.length, before, "a signal that writes nothing wrote, or a write refused for the lock was stored after all");
      assert.equal(after.curriculum.current_step, "expect");
      // With the lock free, the same move and the submit are stored: what refused them above was the lock.
      assert.equal((await apply({ kind: "start_step", stepId: "build" }, 2105, { ...at, events: mine })).curriculum.current_step, "build");
      assert.equal((await apply({ kind: "submit" }, 2106, { ...at, events: mine })).curriculum.phase, "submitted");
      const submitted = (await stored(at.recordId)).history.length;
      await whileLocked(async () => {
        for (const signal of [{ kind: "submit" }, { kind: "work" }, { kind: "start_step", stepId: "build" }]) quietAs(await lockedOut(signal, 2107), signal, undefined, "submitted");
      });
      assert.equal((await stored(at.recordId)).history.length, submitted, "a second submit or a signal after it wrote");
    });

    await check("SX-48: the flow writes only Task records — no new store, no new record kind", async () => {
      const keys = await open().store.list("");
      assert.ok(keys.length > 0, "nothing was written: the checks above proved nothing");
      assert.deepEqual(keys.filter((k) => !k.startsWith("tasks/")), [], "the flow wrote a key outside tasks/");
    });
  }
} finally {
  await rm(root, { recursive: true, force: true });
}

// ── 6. The local review says what its list leaves out, and deletes it on request ──

const reviewRoot = await mkdtemp(join(tmpdir(), "hps-task-flow-review-"));
try {
  const reviewModule = await import("../src/localReviewService.ts");
  const { LocalReviewService } = reviewModule;
  const at = "2026-09-14T12:00:00Z";
  const transcript = [
    { type: "session_meta", payload: { id: "codex-one", cwd: "/project" } },
    { timestamp: at, type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Check the change and tell me what remains unknown." }] } },
    { timestamp: at, type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "I checked it." }] } },
  ].map((r) => JSON.stringify(r)).join("\n");
  const service = new LocalReviewService(reviewRoot);
  const card = await service.import(transcript, "codex", "/project");
  const openTask = (at) => flow.runTaskFlowOn(service.store, service.record, { taskId: TASK, recordId: RECORD, lesson, signal: { kind: "seen" }, events: [], at });
  if (flow && lesson) await openTask(2000);

  await check("review list (MC-27): transcript tasks stay as rows; the curriculum task it cannot open is counted, never dropped silently", async () => {
    assert.equal(typeof service.reviewRecords, "function", "the review screen has no list of its own");
    const listed = await service.reviewRecords();
    assert.deepEqual(listed.tasks.map((t) => t.id), [card.task.id], "a row the screen cannot open, or a transcript task missing");
    assert.equal(listed.curriculumTasks, 1, "the list left the curriculum task out and says nothing about it");
  });

  await check("review list control: the record holds both, so the list is what keeps it out", async () => {
    const all = (await service.record.records()).tasks.map((t) => t.id).sort();
    assert.deepEqual(all, [card.task.id, RECORD].sort(), "the curriculum task is not on the record — the checks above prove nothing");
    await assert.rejects(service.card(RECORD), /import_incomplete/, "the review can open it after all, so it should be a row");
  });

  await check("review delete (MC-31): the question says what is deleted and what stays where the delete cannot reach", () => {
    const q = reviewModule.curriculumDeleteQuestion?.(2) ?? "";
    for (const part of ["수업 과제 진행 기록 2개를 지울까요?", "되돌릴 수 없어요", "학습 기록은 각 폴더의 관찰 기록에 남아서", "진행 기록이 거기서 새로 시작돼요"]) {
      assert.ok(q.includes(part), `the question does not say "${part}": ${q}`);
    }
    assert.equal(reviewModule.curriculumDeletedSentence?.(2), "수업 과제 진행 기록 2개를 지웠어요.");
  });

  await check("review delete (MC-31): the curriculum task records go through the core's delete; the transcript task stays and still opens", async () => {
    assert.equal(typeof service.deleteCurriculumTasks, "function", "there is no way to delete a curriculum task record");
    assert.equal(await service.deleteCurriculumTasks(), 1);
    const after = await service.reviewRecords();
    assert.equal(after.curriculumTasks, 0, "a curriculum task record is still on the record");
    assert.deepEqual(after.tasks.map((t) => t.id), [card.task.id], "the delete took a transcript task with it");
    assert.ok(after.deleted_tasks.includes(RECORD), "the core's tombstone is missing: the delete went around deleteTask");
    assert.equal((await service.card(card.task.id)).task.id, card.task.id, "the transcript task no longer opens");
    assert.equal(await service.deleteCurriculumTasks(), 0, "a second delete found something to delete");
  });

  await check("review delete: opening the lesson again starts a new progress record, as the question says", async () => {
    const reopened = await openTask(3000);
    assert.equal(reopened.changed, true);
    assert.equal(reopened.curriculum.phase, "assigned", "the deleted progress came back");
    assert.equal((await service.reviewRecords()).curriculumTasks, 1);
  });
} finally {
  await rm(reviewRoot, { recursive: true, force: true });
}

// ── 7. What regions A and D draw (real components) ────────────────────────────

const { rendererStatus, renderComponent, visibleText } = await import("./sx-render.mjs");
const { auditRegionText, countPrimaryCta } = await import("./sx-audit.mjs");
const status = rendererStatus();
if (!status.available) {
  // Do not pass silently: say what was not measured.
  console.log(`NOT RUN render checks — ${status.detail}`);
} else {
  const header = (missing) =>
    renderComponent("MissionHeader", {
      lesson: LESSON,
      ...(missing === undefined ? {} : { missing }),
      currentStepId: null,
      onSelectStep: noop,
      onStartStep: noop,
      onOpenGrowth: noop,
      busy: false,
      activity: { label: "수업", name: "GlobalBuddy", verified: true },
    });
  const marks = (html) => [...html.matchAll(/<li data-met="(yes|no)"/g)].map((m) => m[1]);
  /** Each condition's mark as the eye and a screen reader get it: "☑ 확인됨" or "☐ 아직" (SX-50: icon and words). */
  const markSaid = (html) => [...html.matchAll(/<li data-met="(?:yes|no)"><span class="hp-mark" role="img" aria-label="([^"]*)">([^<]*)<\/span>/g)].map((m) => `${m[2]} ${m[1]}`);
  const conditionTexts = (html) => [...html.matchAll(/<span class="hp-mission-completion-text">([^<]*)<\/span>/g)].map((m) => m[1]);
  const designTexts = week3.learning.completion.map((c) => c.text);

  await check("SX-01·SX-50: region A checks a condition off only where the host's gate says it is met", async () => {
    const all = await header([]);
    assert.deepEqual(marks(all), ["yes", "yes", "yes"], "nothing missing, and a condition stayed unchecked");
    assert.deepEqual(markSaid(all), ["☑ 확인됨", "☑ 확인됨", "☑ 확인됨"], "a screen reader is told something other than the marks show");
    assert.equal((all.match(/☑/g) ?? []).length, 4, "three ☑ marks and the note that explains them");
    assert.ok(visibleText(all).includes("☑ 표시는 내가 남긴 기록에서 확인된 것이에요."));
    const some = await header([{ code: "missing_completion_event", item: "c2", event: "change_requested" }]);
    assert.deepEqual(marks(some), ["yes", "no", "yes"]);
    assert.deepEqual(markSaid(some), ["☑ 확인됨", "☐ 아직", "☑ 확인됨"], "a screen reader hears an unmet condition as confirmed, or a met one as not yet");
    const late = await header([{ code: "criterion_after_artifact", event: "criterion_set" }]);
    assert.deepEqual(marks(late), ["no", "yes", "yes"], "a late criterion was checked off as '시험 전에 적었다'");
  });

  await check("SX-50 negative: with no verdict from the host, nothing is checked off and the header says why", async () => {
    for (const html of [await header(undefined), await header(null)]) {
      assert.deepEqual(marks(html), ["no", "no", "no"], "a check mark was drawn with no verdict behind it");
      assert.deepEqual(markSaid(html), ["☐ 아직", "☐ 아직", "☐ 아직"], "a screen reader hears a condition confirmed with no verdict behind it");
      assert.ok(!html.includes("☑"), "a ☑ appeared with no verdict");
      assert.ok(visibleText(html).includes("지금은 아직 확인 전입니다"), "the header stopped saying nothing is confirmed yet");
    }
  });

  await check("region A keeps what the rehearsal reads back: condition wording, one Primary, no numbers", async () => {
    for (const html of [await header([]), await header(null)]) {
      assert.deepEqual(conditionTexts(html), designTexts, "the condition wording changed — the rehearsal compares it word for word");
      assert.equal(countPrimaryCta(html), 1, "region A no longer has exactly one Primary (SX-04)");
      const audit = auditRegionText(visibleText(html), { region: "work", minLength: 60 });
      assert.equal(audit.ok, true, `region A tripped the audit: ${JSON.stringify(audit.findings)}`);
    }
  });

  const gate = (state) => renderComponent("CompletionGate", { learning: state, onSubmit: noop });
  seq = 0;
  const ready = learningState({ task: TASK, events: [criterion()], completion: COMPLETION.slice(0, 1), phase: "working" });
  const blocked = learningState({ task: TASK, events: [], completion: COMPLETION, phase: "working" });
  const fresh = learningState({ task: TASK, events: [], completion: [], phase: "assigned" });
  const done = learningState({ task: TASK, events: [], completion: [], phase: "submitted" });
  const failedSubmit = learningState({ task: TASK, events: [criterion()], completion: COMPLETION.slice(0, 1), phase: "working", notice: "제출을 저장하지 못했어요 (storage_busy). 다시 한 번 눌러 주세요." });

  await check("region D positive: a working task with its gate met offers the completion button", async () => {
    const html = await gate(ready);
    assert.match(html, /<button[^>]*>이 과제 완료하기<\/button>/);
    assert.doesNotMatch(html, /<button[^>]*disabled/, "the button is disabled with the gate met");
    assert.doesNotMatch(html, /hp-complete-why/);
  });

  await check("region D negative: blocked or not started, the button is disabled and the reason sits beside it", async () => {
    const shut = await gate(blocked);
    assert.match(shut, /<button[^>]*disabled=""[^>]*>이 과제 완료하기<\/button>/);
    assert.ok(visibleText(shut).includes("☐ 아직 안 한 것: 기대 조건을 시험 전에 적었다"), visibleText(shut));
    const unstarted = await gate(fresh);
    assert.match(unstarted, /<button[^>]*disabled=""/);
    assert.ok(visibleText(unstarted).includes("☐ 아직 시작 전이에요."), visibleText(unstarted));
  });

  await check("SX-55: a submitted task shows a state line with icon and words, and no button to press", async () => {
    const html = await gate(done);
    assert.doesNotMatch(html, /<button/, "a submitted task still offers a submit button");
    assert.match(html, /role="status"/);
    assert.ok(visibleText(html).includes("☑이 과제를 제출했어요") || visibleText(html).includes("☑ 이 과제를 제출했어요"), visibleText(html));
  });

  await check("SX-55: a submit the record could not store is said beside the button", async () => {
    const html = await gate(failedSubmit);
    assert.match(html, /<p class="hp-complete-notice" role="alert">제출을 저장하지 못했어요 \(storage_busy\)\. 다시 한 번 눌러 주세요\.<\/p>/);
    assert.match(html, /<button[^>]*>이 과제 완료하기<\/button>/, "after a failed store the student cannot try again");
  });

  await check("region D never takes the Primary and passes the audit in every state (SX-04, SX-59)", async () => {
    for (const state of [ready, blocked, fresh, done, failedSubmit]) {
      const html = await gate(state);
      assert.equal(countPrimaryCta(html), 0, `region D drew a Primary in phase ${state.phase}`);
      const audit = auditRegionText(visibleText(html), { region: "work", minLength: 5 });
      assert.equal(audit.ok, true, `region D tripped the audit in phase ${state.phase}: ${JSON.stringify(audit.findings)}`);
    }
  });

  await check("region D audit control: a planted score in the notice line is caught", async () => {
    const html = await gate({ ...failedSubmit, notice: "검증 점수 62점 · 개선 필요" });
    const audit = auditRegionText(visibleText(html), { region: "work", minLength: 5 });
    assert.equal(audit.ok, false, "a score in region D passed the audit — the audit above counts nothing");
  });

  await check("local review (MC-27): the line says how many curriculum task records the list leaves out, with the delete beside it", async () => {
    const html = await renderComponent("OmittedRecords", { count: 2, busy: false, onDelete: noop });
    assert.ok(visibleText(html).includes("수업 과제 진행 기록 2개는 이 화면에서 열 수 없어 목록에서 뺐어요."), `the omission is not said: ${visibleText(html)}`);
    assert.match(html, /<button class="danger">수업 과제 진행 기록 지우기<\/button>/, "no way to delete what the list leaves out");
    assert.match(await renderComponent("OmittedRecords", { count: 2, busy: true, onDelete: noop }), /<button class="danger" disabled="">/, "the delete stays pressable while the screen is busy");
    // Control: nothing left out, nothing drawn — no empty box and no "0개".
    assert.equal(await renderComponent("OmittedRecords", { count: 0, busy: false, onDelete: noop }), "");
  });
}

console.log(`sx-task-flow: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
