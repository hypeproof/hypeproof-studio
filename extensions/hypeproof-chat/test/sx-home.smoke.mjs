// Region A, the work screen's home (SX-01 ~ SX-04): SX-02's "지난번 이어서" — the step the task
// record still holds from an earlier session of the App — and the two style rules the in-app run
// found missing. Run: node --experimental-strip-types test/sx-home.smoke.mjs
//
// What is judged:
//   1. the rule (`resumeOf`, src/taskFlowHelpers.ts), pure: an entry only for a record last
//      changed before this session began, and only while the task is being worked on; and the
//      session the host keeps (`FlowSession`): the student's own act on the task in this session
//      (a step start, work, a submit) ends the entry whether or not it writes the record;
//   2. the same rule over the App's real record store, across a restart (a fresh store instance
//      and a later session start, as a reopened App has): the first session never shows it, the
//      reopened one names the recorded step, pressing that step's own Primary or working on the
//      task takes it away though neither writes, and so does a move in the new session;
//   3. `learningState` carries it only when the host gives it;
//   4. the host passes it, with the session made once, notes every signal before it runs, redraws
//      a state that still shows an ended entry, and sends it only on a seat that runs the task flow
//      (static, as test/sx-task-flow.smoke.mjs: ChatPanelProvider cannot load without VS Code);
//      the webview hands the host's value to region A untouched, and starts the view at the step
//      the record holds (`stepViewOnState`; the student's own pick holds after that). Every static
//      check also runs on a planted source that must fail it;
//   5. region A draws it (the real MissionHeader through test/sx-render.mjs): below the actions
//      and the completion conditions, above the growth link, a quiet button with the step's own
//      title and no figure, and nothing for a step this lesson does not have;
//   6. styles.css keeps the header on screen while the rest scrolls, bounded so region B keeps
//      room on a short window and packed so its first 150 px hold all four parts there (SX-01),
//      and leaves one Lime button while region A shows its Primary (SX-04). A server render applies
//      no CSS, so these are static tripwires for CI; what they guard was measured in the App.
//
// Controls (.claude/rules/verification.md rules 2·3): each rule has a sample that must pass
// (catches a too-strict instrument) and one that must be refused (catches a too-lenient one).
// The in-app half (a real App: computed styles, a scrolled conversation, a narrow window, a close
// and a reopen) is e2e/sx/home-app.spec.ts.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
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

const week3 = JSON.parse(readFileSync(new URL("../../../worker/test/fixtures/session-design/week-3.json", import.meta.url), "utf8"));
const LESSON = { course_id: "globalbuddy", version: "m2026.09.20-1", sha256: "f".repeat(64), content: week3 };
const TASK = "task-ffffffffffffffff-a1b2c3d4";
const SEAT_A = { workspace: "file:///ws/globalbuddy", format: "hps-observation/2", scope: "a".repeat(64), program: "canary-sdk-contract" };
const SEAT_B = { ...SEAT_A, scope: "b".repeat(64) };
const CTX = { week: 3, step_id: "expect", task: TASK, module_version: LESSON.version };
const criterion = (task = TASK) => ({
  id: `crit-${task}`, seq: 1, task, at: 1, kind: "criterion_set", text: "", assistance: "unknown",
  actor: "user", student_text: "규정 원문과 같은 시간표가 보여야 한다", context: { ...CTX, task }, evidence_type: "criterion", source_state: "self_reported",
});

const flow = await import("../src/taskFlowHelpers.ts");
const { learningState } = await import("../src/learningStateHelpers.ts");
const logic = await import("../webview-ui/src/missionHeaderLogic.ts");
const lesson = flow.flowLessonOf(LESSON);
const curriculumAt = (phase, current_step = "build") => ({ module: { course_id: "globalbuddy", version: LESSON.version, sha256: LESSON.sha256 }, week: 3, phase, current_step, steps: {} });

// ── 1. The rule, pure ───────────────────────────────────────────────────────────

const SESSION = 5_000;

await check("resumeOf positive: a record last changed before this session, task being worked on → the step it holds", () => {
  assert.deepEqual(flow.resumeOf({ curriculum: curriculumAt("working", "build"), changed_at: SESSION - 1 }, SESSION), { step: "build" }, "a task left mid-way last time has no entry: too strict");
  // Opened last time and never started: there is still something to continue.
  assert.deepEqual(flow.resumeOf({ curriculum: curriculumAt("assigned", "expect"), changed_at: 10 }, SESSION), { step: "expect" });
});

await check("resumeOf negative: nothing left over from last time — opened or moved in this session (the same instant counts as this session)", () => {
  assert.equal(flow.resumeOf({ curriculum: curriculumAt("working"), changed_at: SESSION }, SESSION), null, "a record written as this session began is called 'last time'");
  assert.equal(flow.resumeOf({ curriculum: curriculumAt("working"), changed_at: SESSION + 1 }, SESSION), null, "a record the student moved in this session still offers 'last time'");
});

await check("resumeOf negative: a submitted (or reflected) task has no step to go back to", () => {
  for (const phase of ["submitted", "reflected"]) {
    assert.equal(flow.resumeOf({ curriculum: curriculumAt(phase), changed_at: 1 }, SESSION), null, `a ${phase} task offers to continue a step`);
  }
});

await check("resumeOf negative: no record read, or a record whose time cannot be read → no entry", () => {
  assert.equal(flow.resumeOf(null, SESSION), null);
  assert.equal(flow.resumeOf({ curriculum: curriculumAt("working"), changed_at: Number.NaN }, SESSION), null, "an unreadable time was taken as 'before'");
  assert.equal(flow.resumeOf({ curriculum: curriculumAt("working"), changed_at: undefined }, SESSION), null);
});

// The session the host keeps (FlowSession): the entry ends once the student acts on the task in
// this session, whether or not the act writes the record.
const LEFT = { curriculum: curriculumAt("working", "build"), changed_at: SESSION - 1 };
const REC = "record-a";
const STUDENT_SIGNALS = [{ kind: "start_step", stepId: "build" }, { kind: "start_step", stepId: "test" }, { kind: "work" }, { kind: "submit" }];

await check("FlowSession positive: until the student acts in this session the entry is resumeOf's, and a screen refresh is not an act", () => {
  const session = new flow.FlowSession(SESSION);
  assert.equal(session.startedAt, SESSION);
  assert.deepEqual(session.resumeFor(REC, LEFT), { step: "build" }, "a task left mid-way last time has no entry before the student did anything: too strict");
  session.noteSignal(REC, { kind: "seen" });
  assert.deepEqual(session.resumeFor(REC, LEFT), { step: "build" }, "a screen refresh ended the entry");
  // Another task's record (another lesson, seat or folder) moving ends nothing here.
  session.noteSignal("record-b", { kind: "work" });
  assert.deepEqual(session.resumeFor(REC, LEFT), { step: "build" }, "another record's work ended this record's entry");
  // The rule underneath still holds: nothing from last time, nothing to offer.
  assert.equal(session.resumeFor(REC, { ...LEFT, changed_at: SESSION }), null);
  assert.equal(session.resumeFor(null, LEFT), null, "a seat without the task flow was offered an entry");
});

await check("FlowSession negative: any act of the student's own on the task ends the entry, written or not (the recorded step's own Primary, work on a working task)", () => {
  for (const signal of STUDENT_SIGNALS) {
    const session = new flow.FlowSession(SESSION);
    assert.deepEqual(session.resumeFor(REC, LEFT), { step: "build" }, "no entry to begin with — the check proves nothing");
    session.noteSignal(REC, signal);
    assert.equal(session.resumeFor(REC, LEFT), null, `the entry stays after ${JSON.stringify(signal)} in this session`);
  }
});

await check("FlowSession.stale: true only while the screen shows an entry the student has acted on since (so a signal that wrote nothing still redraws)", () => {
  const session = new flow.FlowSession(SESSION);
  assert.equal(session.stale, false, "a session that sent nothing owes a redraw");
  session.resumeFor(REC, LEFT);
  assert.equal(session.stale, false, "the entry just sent is already stale");
  session.noteSignal(REC, { kind: "seen" });
  assert.equal(session.stale, false, "a screen refresh made the entry stale");
  session.noteSignal(REC, { kind: "start_step", stepId: "build" });
  assert.equal(session.stale, true, "the student continued and the entry on screen is not redrawn");
  assert.equal(session.resumeFor(REC, LEFT), null);
  assert.equal(session.stale, false, "a redraw that took the entry away still owes one");
  // A first session: no entry was ever on screen, so the student's work owes no redraw for it.
  const first = new flow.FlowSession(SESSION);
  first.resumeFor(REC, { ...LEFT, changed_at: SESSION + 5 });
  first.noteSignal(REC, { kind: "work" });
  assert.equal(first.stale, false, "a redraw is owed for an entry that was never drawn");
});

// ── 2. The same rule over the App's real record store, across a restart ─────────

const { FileRecordStorage } = await import("../src/localRecordFile.ts");
const { LocalRecord } = await import("../../../worker/src/lib/measurement-core/index.ts");
const root = await mkdtemp(join(tmpdir(), "hps-home-resume-"));
try {
  // A fresh store and record per call: what a reopened App reads.
  const apply = (signal, at, { events = [], seat = SEAT_A } = {}) => {
    const store = new FileRecordStorage(root);
    return flow.runTaskFlowOn(store, new LocalRecord(store), { taskId: TASK, recordId: flow.taskRecordIdOf(TASK, seat), lesson, signal, events, at });
  };
  /** What the host shows (postLearningState): this read, the entry against the session start. */
  const entry = (outcome, sessionStart) => flow.resumeOf(flow.screenFlow(outcome, null, ""), sessionStart);
  const mine = [criterion()];

  // Session 1 starts at 1000: the task opens, the student works, writes a criterion and starts build.
  const S1 = 1_000;
  await check("first session: the record the screen just opened offers no 'last time'", async () => {
    const opened = await apply({ kind: "seen" }, S1);
    assert.equal(opened.changed, true, "the record was not opened — the checks below prove nothing");
    assert.equal(opened.changed_at, S1, "the outcome does not say when the record last changed");
    assert.equal(entry(opened, S1), null, "the session that opened the task offers to continue it");
  });
  await check("first session: work and a step move stay this session's — still no entry", async () => {
    await apply({ kind: "work" }, 1_100, { events: mine });
    const moved = await apply({ kind: "start_step", stepId: "build" }, 1_200, { events: mine });
    assert.equal(moved.curriculum.current_step, "build", "the step did not move — the reopen below proves nothing");
    assert.equal(moved.changed_at, 1_200);
    assert.equal(entry(moved, S1), null);
  });

  // The App is reopened: session 2 starts at 5000; the record is read by a fresh instance.
  const S2 = 5_000;
  await check("reopened: the refresh writes nothing, and the entry names the step the record holds", async () => {
    const seen = await apply({ kind: "seen" }, 5_001, { events: mine });
    assert.equal(seen.changed, false, "the refresh rewrote the record — then nothing is left over from last time");
    assert.equal(seen.changed_at, 1_200, "the last change read back is not the one session 1 wrote");
    assert.deepEqual(entry(seen, S2), { step: "build" }, "the reopened App does not offer the step left last time");
  });
  // What the host keeps for session 2 (FlowSession): the entry the screen shows, ended by the
  // student's own act. Neither act below writes the record, so the reopen checks after them still
  // read the record session 1 left.
  const rid = flow.taskRecordIdOf(TASK, SEAT_A);
  const shownBy = (session, outcome) => session.resumeFor(rid, flow.screenFlow(outcome, null, ""));
  await check("reopened, the student presses the recorded step's own Primary: nothing is written, and the entry goes", async () => {
    const session = new flow.FlowSession(S2);
    assert.deepEqual(shownBy(session, await apply({ kind: "seen" }, 5_010, { events: mine })), { step: "build" }, "no entry on the reopen — the check proves nothing");
    const signal = { kind: "start_step", stepId: "build" };
    session.noteSignal(rid, signal);
    const pressed = await apply(signal, 5_020, { events: mine });
    assert.equal(pressed.changed, false, "the start onto the recorded step wrote the record — the check below is the record's time, not the session");
    assert.equal(session.stale, true, "the screen still shows the entry and nothing asks for a redraw");
    assert.equal(shownBy(session, pressed), null, "'지난번 이어서' stays after the student continued the step it names");
  });
  await check("reopened, the student works on the task (a coach turn that answered): nothing is written, and the entry goes", async () => {
    const session = new flow.FlowSession(S2);
    assert.deepEqual(shownBy(session, await apply({ kind: "seen" }, 5_030, { events: mine })), { step: "build" });
    session.noteSignal(rid, { kind: "work" });
    const worked = await apply({ kind: "work" }, 5_040, { events: mine });
    assert.equal(worked.changed, false, "work on a working task wrote the record — the check proves nothing");
    assert.equal(shownBy(session, worked), null, "'지난번 이어서' stays after the student worked on the task");
    // The next session (a reopen after this one) offers it again: nothing was written.
    assert.deepEqual(shownBy(new flow.FlowSession(5_050), await apply({ kind: "seen" }, 5_051, { events: mine })), { step: "build" }, "a session that only worked lost the entry for the next one");
  });
  await check("reopened, another seat on this account: its own record, opened now, offers nothing", async () => {
    const other = await apply({ kind: "seen" }, 5_002, { seat: SEAT_B });
    assert.equal(other.curriculum.current_step, "expect", "seat B read seat A's record");
    assert.equal(entry(other, S2), null, "seat B is offered seat A's step from last time");
  });
  await check("reopened, the student moves on: the record changed this session, and the entry goes", async () => {
    const moved = await apply({ kind: "start_step", stepId: "test" }, 5_100, { events: mine });
    assert.equal(moved.curriculum.current_step, "test", "the move was refused — the check proves nothing");
    assert.equal(entry(moved, S2), null, "'last time' is still offered after the student continued");
  });
  await check("a task submitted last time is not offered again", async () => {
    await apply({ kind: "submit" }, 5_200, { events: mine });
    const S3 = 9_000;
    const seen = await apply({ kind: "seen" }, 9_001, { events: mine });
    assert.equal(seen.curriculum.phase, "submitted");
    assert.ok(seen.changed_at < S3, "the record changed in session 3 — the check proves nothing");
    assert.equal(entry(seen, S3), null, "a submitted task offers to continue a step");
  });
} finally {
  await rm(root, { recursive: true, force: true });
}

// ── 3. learningState carries it only when the host gives it ─────────────────────

await check("learningState: the entry travels when given, and only then", () => {
  const given = learningState({ task: TASK, events: [], completion: [], phase: "working", currentStep: "build", resume: { step: "build" } });
  assert.deepEqual(given.resume, { step: "build" });
  for (const resume of [null, undefined]) {
    const none = learningState({ task: TASK, events: [], completion: [], phase: "working", resume });
    assert.equal("resume" in none, false, `resume ${resume} drew an entry key`);
  }
  // A seat without the task flow (no phase, no record): no key at all.
  assert.equal("resume" in learningState({ task: TASK, events: [] }), false);
});

// ── 4. The host passes it; the webview hands it to region A untouched ────────────

const between = (text, from, to) => {
  const a = text.indexOf(from);
  const b = a < 0 ? -1 : text.indexOf(to, a + from.length);
  return a >= 0 && b > a ? text.slice(a, b) : "";
};
/** A static check that must hold on the real source and fail on every planted copy. */
async function staticCheck(name, source, rule, plants) {
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

const provider = readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
const postBody = (text) => between(text, "private async postLearningState()", "private taskFlowNotice");
await staticCheck(
  "host: the entry is decided by this session from the record the screen is shown, and sent on a flow seat only",
  provider,
  (text) =>
    lacks(postBody(text), /\n    const resume = this\.flowSession\.resumeFor\(target\?\.recordId \?\? null, shown\);\n/, "the host does not ask this session for the entry of the record shown") ??
    lacks(postBody(text), /\.\.\.\(shown \? \{ phase: shown\.curriculum\.phase, currentStep: shown\.curriculum\.current_step, resume \} : \{\}\)/, "the host does not send the entry, or sends it on a seat without the flow"),
  [
    // The entry is never sent.
    ["currentStep: shown.curriculum.current_step, resume }", "currentStep: shown.curriculum.current_step }"],
    // The record's time alone (the review's finding): the entry stays after the student continued.
    ["const resume = this.flowSession.resumeFor(target?.recordId ?? null, shown);", "const resume = resumeOf(shown, this.flowSession.startedAt);"],
    // The record's step sent whatever the session: the first session shows it too.
    ["const resume = this.flowSession.resumeFor(target?.recordId ?? null, shown);", "const resume = shown ? { step: shown.curriculum.current_step } : null;"],
  ],
);
await staticCheck(
  "host: the session is made once, when the host is made, and starts then",
  provider,
  (text) => lacks(text, /\n  private readonly flowSession = new FlowSession\(Date\.now\(\)\);\n/, "the session is not one value fixed when the host is made"),
  [
    // A session per state: "now" taken at every state, and the student's acts forgotten.
    ["private readonly flowSession = new FlowSession(Date.now());", "private get flowSession() { return new FlowSession(Date.now()); }"],
    ["private readonly flowSession = new FlowSession(Date.now());", "private readonly flowSession = new FlowSession(0);"],
  ],
);
const runFlowBody = (text) => between(text, "private async runTaskFlow(", "private async recordStepStart(");
const turnEnd = (text) => between(text, "void this.runTaskFlow({ kind: 'work' }, observation, profile)", ".catch(() => undefined);");
await staticCheck(
  "host: every signal is noted before it runs, and a state still showing an entry the student ended is sent again",
  provider,
  (text) =>
    lacks(runFlowBody(text), /if \(!target\) return null;[\s\S]*this\.flowSession\.noteSignal\(target\.recordId, signal\);\s*try \{/, "the student's signals never reach the session, or only those that stored") ??
    lacks(between(text, "private async recordStepStart(", "private view?"), /if \(flow\?\.changed \|\| this\.taskFlowNotice \|\| this\.flowSession\.stale\) await this\.postLearningState\(\);/, "a step start that wrote nothing leaves the ended entry on screen") ??
    lacks(turnEnd(text), /flow\?\.changed \|\| this\.taskFlowNotice \|\| this\.flowSession\.stale \? this\.postLearningState\(\)/, "a coach turn on a working task leaves the ended entry on screen"),
  [
    ["    this.flowSession.noteSignal(target.recordId, signal);\n", ""],
    // Noted only once the record answered: a busy record keeps the entry after the student acted.
    [
      "    this.flowSession.noteSignal(target.recordId, signal);\n    try {\n      const { store, record } = this.crRecordHandle();\n      const outcome = await runTaskFlowOn(store, record, { ...target, signal, events: recorder.batch.events, at: Date.now() });\n",
      "    try {\n      const { store, record } = this.crRecordHandle();\n      const outcome = await runTaskFlowOn(store, record, { ...target, signal, events: recorder.batch.events, at: Date.now() });\n      this.flowSession.noteSignal(target.recordId, signal);\n",
    ],
    ["if (flow?.changed || this.taskFlowNotice || this.flowSession.stale) await this.postLearningState();", "if (flow?.changed || this.taskFlowNotice) await this.postLearningState();"],
    ["flow?.changed || this.taskFlowNotice || this.flowSession.stale ? this.postLearningState()", "flow?.changed || this.taskFlowNotice ? this.postLearningState()"],
  ],
);

const chatPanel = readFileSync(new URL("../webview-ui/src/ChatPanel.tsx", import.meta.url), "utf8");
const headerProps = (text) => between(text, "<MissionHeader", "/>}");
await staticCheck(
  "webview: region A gets the host's entry as it came",
  chatPanel,
  (text) => lacks(headerProps(text), /\n\s*resume=\{learning\?\.resume \?\? null\}\n/, "region A does not get the host's entry"),
  [
    ["        resume={learning?.resume ?? null}\n", ""],
    ["resume={learning?.resume ?? null}", "resume={null}"],
  ],
);
const learningHandler = (text) => between(text, 'if (msg.type !== "learningState") return;', "return off;");
await staticCheck(
  "webview: the view starts at the step the record holds (stepViewOnState), and the student's own picks settle it",
  chatPanel,
  (text) =>
    lacks(learningHandler(text), /const next = stepViewOnState\(stepView\.current, msg\.state\);\s*stepView\.current = next\.settled;\s*if \(next\.step\) setCurrentStepId\(next\.step\);/, "a learning state never moves the view to the step the record holds") ??
    lacks(between(text, "const pickStep = (stepId: string) => {", "};"), /stepView\.current = stepViewOnPick\(learningTask\.current\);\s*setCurrentStepId\(stepId\);/, "a step the student picks does not settle the view") ??
    lacks(headerProps(text), /onSelectStep=\{pickStep\}/, "a step the student selects is not their pick: the next state moves the view away") ??
    lacks(headerProps(text), /onStartStep=\{\(step\) => \{\s*pickStep\(step\.id\);/, "a step the student starts is not their pick: the next state moves the view away"),
  [
    // The review's finding: the webview never reads the step the record holds.
    ["      if (next.step) setCurrentStepId(next.step);\n", ""],
    ["    stepView.current = stepViewOnPick(learningTask.current);\n", ""],
    ["onSelectStep={pickStep}", "onSelectStep={setCurrentStepId}"],
    ["          pickStep(step.id);\n", "          setCurrentStepId(step.id);\n"],
  ],
);

// ── 5. Region A draws it (the real component) ───────────────────────────────────

await check("resumeStepOf: a step of this lesson, or nothing — never a fallback step", () => {
  const steps = week3.steps;
  assert.equal(logic.resumeStepOf(steps, { step: "build" })?.id, "build");
  assert.equal(logic.resumeStepOf(steps, { step: "없는단계" }), null, "a step this lesson does not have was drawn (or replaced by another)");
  for (const resume of [null, undefined, {}, { step: "" }, { step: 3 }]) assert.equal(logic.resumeStepOf(steps, resume), null, JSON.stringify(resume));
  assert.equal(logic.resumeStepOf([], { step: "build" }), null);
});

// The view region A starts from (SX-01, SX-02): the step the task's record holds, not the first
// step. From the first step a reopened task offered an earlier step's action as the Primary, and
// pressing it moved the record back (decideFlow allows a move back) — review of 2026-10-05.
await check("stepViewOnState positive: the first state that names the record's step moves the view there, once per task", () => {
  const first = logic.stepViewOnState(null, { task: TASK, currentStep: "build" });
  assert.equal(first.step, "build", "a reopened task's view starts at the first step, not where its record stands");
  assert.deepEqual(first.settled, { task: TASK });
  // Settled: the record moving later, or the same state again, never moves the student's view.
  assert.equal(logic.stepViewOnState(first.settled, { task: TASK, currentStep: "test" }).step, null, "a later state for the same task moved the view");
  // Another task (another lesson or activity) starts where its own record stands.
  const other = logic.stepViewOnState(first.settled, { task: "task-other", currentStep: "diff" });
  assert.deepEqual(other, { settled: { task: "task-other" }, step: "diff" }, "a new task kept the old task's view");
});

await check("stepViewOnState negative: a state with no recorded step settles nothing, and the student's own pick is never overridden", () => {
  for (const currentStep of [null, undefined, ""]) {
    const none = logic.stepViewOnState(null, { task: TASK, currentStep });
    assert.deepEqual(none, { settled: null, step: null }, `a state with currentStep=${JSON.stringify(currentStep)} moved or settled the view`);
    // ...so the next state that names the step still moves it there.
    assert.equal(logic.stepViewOnState(none.settled, { task: TASK, currentStep: "build" }).step, "build");
  }
  // The student chose a step for this task: later states keep their choice.
  assert.equal(logic.stepViewOnState(logic.stepViewOnPick(TASK), { task: TASK, currentStep: "build" }).step, null, "a state overrode the step the student chose");
  // The student chose before any state arrived (the header draws from the profile first): the first
  // state settles that task without moving the view, and so do the states after it.
  const early = logic.stepViewOnPick(null);
  assert.deepEqual(early, { picked: true });
  const claimed = logic.stepViewOnState(early, { task: TASK, currentStep: "build" });
  assert.deepEqual(claimed, { settled: { task: TASK }, step: null }, "the first state overrode a step the student chose before it arrived");
  assert.equal(logic.stepViewOnState(claimed.settled, { task: TASK, currentStep: "build" }).step, null);
});

const { rendererStatus, renderComponent, visibleText } = await import("./sx-render.mjs");
const { auditRegionText, auditPrimaryCta } = await import("./sx-audit.mjs");
const status = rendererStatus();
if (!status.available) {
  // Do not pass silently: say what could not be measured.
  console.log(`NOT RUN render checks — ${status.detail}`);
} else {
  const noop = () => {};
  const homeProps = {
    lesson: LESSON, currentStepId: null, onSelectStep: noop, onStartStep: noop, onOpenGrowth: noop, busy: false,
    activity: { label: "수업", name: "GlobalBuddy", verified: true },
  };
  const RESUME = "지난번 이어서";
  const buildTitle = week3.steps.find((s) => s.id === "build").title;
  /** Region A's order: actions → completion conditions → the entry → the growth link. Positions in the markup. */
  const order = (html) => ({
    actions: html.indexOf("hp-mission-actions"),
    completion: html.indexOf("hp-mission-completion"),
    resume: html.indexOf("hp-mission-resume"),
    growth: html.indexOf("hp-mission-growth"),
  });
  const orderProblem = (html) => {
    const o = order(html);
    if (o.resume < 0) return "no entry";
    return o.actions >= 0 && o.completion > o.actions && o.resume > o.completion && o.growth > o.resume ? null : `order ${JSON.stringify(o)}`;
  };

  const html = await renderComponent("MissionHeader", { ...homeProps, resume: { step: "build" } });
  const text = visibleText(html);

  await check("render: the entry is the recorded step's own title and nothing else — no count, date or figure beside it", () => {
    assert.ok(text.length >= 60, `the render is ${text.length} characters: ${JSON.stringify(text)}`);
    assert.match(html, /data-resume-step="build"/);
    // The whole entry, exactly: the general screen audit below allows "N개" and dates (SX-43's
    // record-scope counts), so it cannot be what keeps a progress figure out of this line.
    const inner = /<button[^>]*data-resume-step[^>]*>([\s\S]*?)<\/button>/.exec(html)?.[1];
    assert.equal(visibleText(inner ?? ""), `${RESUME} · ${buildTitle}`);
  });

  await check("render: the entry sits below the actions and the completion conditions, above the growth link (SX-02, PROJECT_RULES order)", () => {
    assert.equal(orderProblem(html), null, orderProblem(html) ?? "");
    // Negative control: the same markup with the entry moved above the actions fails the order.
    const entry = /<p class="hp-mission-resume">[\s\S]*?<\/p>/.exec(html)?.[0];
    assert.ok(entry, "the entry's markup was not found — the control proves nothing");
    const moved = html.replace(entry, "").replace('<ol class="hp-mission-actions"', `${entry}<ol class="hp-mission-actions"`);
    assert.notEqual(orderProblem(moved), null, "an entry above the actions passed the order check");
  });

  await check("render: the entry is a quiet button — one Primary on the screen still (SX-04)", () => {
    const tag = /<button[^>]*data-resume-step[^>]*>/.exec(html)?.[0] ?? "";
    assert.match(tag, /class="hp-cta-quiet"/, `the entry is not a quiet button: ${tag}`);
    assert.deepEqual(auditPrimaryCta(html), { ok: true, count: 1 });
    // Negative control: the entry drawn as a Primary makes two.
    assert.equal(auditPrimaryCta(html.replace(tag, tag.replace("hp-cta-quiet", "hp-cta-primary"))).ok, false);
  });

  await check("render: no figure, score or date in the entry — the screen audit holds (SX-51, SX-59)", () => {
    const audit = auditRegionText(text, { region: "work", minLength: 60 });
    assert.equal(audit.ok, true, JSON.stringify(audit.findings));
    // Negative control: a count planted in the entry is caught.
    const planted = visibleText(html.replace(`${RESUME} · ${buildTitle}`, `${RESUME} · ${buildTitle} 62점`));
    assert.equal(auditRegionText(planted, { region: "work", minLength: 60 }).ok, false, "a score in the entry passed the audit");
  });

  await check("render negative: no entry without the host's word, or for a step the lesson lacks", async () => {
    for (const resume of [null, undefined, { step: "없는단계" }]) {
      const none = visibleText(await renderComponent("MissionHeader", { ...homeProps, resume }));
      assert.ok(!none.includes(RESUME), `an entry was drawn for resume=${JSON.stringify(resume)}`);
      assert.ok(none.includes(week3.learning.mission), "the header itself disappeared — the check proves nothing");
    }
    // A seat with no design file is NOT judged here. SX-02's negative clause says that seat shows
    // "지난번 이어서" alone (and no progress card); this slice draws none there, because what it
    // would resume (the conversation, which reopens by itself, or the project folder) waits for
    // Jay's decision. Asserting either way would turn that open question into a requirement.
  });
}

// ── 6. The style rules the in-app run found missing (static tripwires) ─────────────

const stylesCss = readFileSync(new URL("../webview-ui/src/styles.css", import.meta.url), "utf8");
/** [selector list, body] for every rule (comments stripped; the rule inside an @media block is listed too). */
const cssRules = (text) =>
  [...text.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim().replace(/\s+/g, " "), m[2]]);
const selectorsOf = (list) => list.split(",").map((s) => s.trim()).filter(Boolean);

/**
 * SX-01: while region A shows a lesson's mission, the shell is the scroller the sticky header
 * sticks to — and the header is bounded inside it, so region B keeps room on a short window (the
 * review of 2026-10-05: unbounded, a 346 px header covered the composer at 1280×400).
 */
const LESSON_SHELL = ".hps-shell:has(> .hp-mission .hp-mission-sentence)";
function scrollerProblem(css) {
  const rules = cssRules(css);
  const sticky = rules.find(([sel]) => sel === ".hp-mission");
  if (!sticky || !/position:\s*sticky/.test(sticky[1]) || !/top:\s*0/.test(sticky[1])) return "region A's header is no longer sticky";
  const scroller = rules.find(([sel, body]) => sel === LESSON_SHELL && /overflow-y:\s*auto/.test(body));
  if (!scroller) return "the shell is not the scroller while the mission is on screen: the document scrolls the header away";
  // The bound: the header's whole box leaves region B a fixed reserve (but keeps a floor of its
  // own), and what does not fit scrolls inside the header rather than over region B.
  const bound = rules.find(([sel, body]) => sel === `${LESSON_SHELL} > .hp-mission` && /max-height/.test(body));
  if (!bound) return "the sticky header has no bound: on a short window it covers the composer";
  const [, body] = bound;
  if (!/max-height:\s*max\(\d+px,\s*calc\(100%\s*-\s*\d+px\)\)/.test(body)) return `the header's bound is not "all of the shell but region B's reserve, with a floor": ${body.trim()}`;
  if (!/overflow-y:\s*auto/.test(body)) return "the bounded header does not scroll inside itself: what does not fit is cut";
  if (!/box-sizing:\s*border-box/.test(body)) return "the bound leaves out the header's padding: the box eats into region B's reserve";
  return null;
}
/** The body of every `@media (max-height:600px)` block, comments stripped. */
function shortWindowBlocks(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = [];
  for (const m of text.matchAll(/@media\s*\(max-height:\s*600px\)\s*\{/g)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < text.length && depth > 0; i++) depth += text[i] === "{" ? 1 : text[i] === "}" ? -1 : 0;
    blocks.push(text.slice(start, i - 1));
  }
  return blocks;
}
/**
 * SX-01 on a short window: the bound keeps the header's first 150 px, and those must hold all four
 * parts. Stacked, the week-3 header put its completion conditions and steps remaining below them
 * (the second review of 2026-10-05, in the App at 1280×450). So at 600 px of webview and below the
 * header packs into wrapping lines: the steps remaining leave the foot for the week's line, and the
 * parts that may scroll inside the header come after the completion conditions.
 */
const HEADER = `${LESSON_SHELL} > .hp-mission`;
function compactProblem(css) {
  const rules = shortWindowBlocks(css).flatMap(cssRules);
  const body = (sel) => rules.filter(([s]) => s === sel).map(([, b]) => b).join(";");
  if (!/display:\s*flex/.test(body(HEADER)) || !/flex-wrap:\s*wrap/.test(body(HEADER))) return "on a short window the header stacks: its first 150 px end before the completion conditions";
  if (!/display:\s*contents/.test(body(`${HEADER} > .hp-mission-foot`))) return "on a short window the steps remaining stay in the foot, after everything else";
  const orderOf = (part) => Number(/order:\s*(-?\d+)/.exec(body(`${HEADER} ${part}`))?.[1] ?? Number.NaN);
  const o = Object.fromEntries(
    Object.entries({ week: ".hp-mission-week", remaining: ".hp-mission-remaining", mission: ".hp-mission-sentence", actions: ".hp-mission-actions", completion: ".hp-mission-completion", resume: ".hp-mission-resume", acceptance: ".hp-mission-acceptance", activity: ".hp-mission-activity", growth: ".hp-mission-growth" }).map(([k, sel]) => [k, orderOf(sel)]),
  );
  if (Object.values(o).some(Number.isNaN)) return `a part has no place in the short window's order: ${JSON.stringify(o)}`;
  if (!(o.week < o.remaining && o.remaining < o.mission && o.mission < o.actions && o.actions < o.completion)) return `on a short window the four parts and the actions do not come first: ${JSON.stringify(o)}`;
  if (!(Math.min(o.acceptance, o.activity, o.growth) > o.completion)) return `on a short window a part that may scroll comes before the completion conditions: ${JSON.stringify(o)}`;
  if (!(o.completion < o.resume && o.resume < o.growth)) return `"지난번 이어서" is not between the completion conditions and the growth link (PROJECT_RULES order): ${JSON.stringify(o)}`;
  return null;
}
await staticCheck("SX-01 styles: on a short window the header packs all four parts into its first lines (measured in the App: e2e/sx/home-app.spec.ts)", stylesCss, compactProblem, [
  // The second review's finding: the header stacked as on a tall window.
  ["> .hp-mission { display:flex; flex-wrap:wrap; align-items:center; column-gap:12px; padding:8px 12px 6px; }", "> .hp-mission { padding:8px 12px 6px; }"],
  ["> .hp-mission > .hp-mission-foot { display:contents; }\n", ""],
  [".hp-mission-remaining { order:2;", ".hp-mission-remaining { order:11;"],
  [".hp-mission-acceptance { order:8; }", ".hp-mission-acceptance { order:4; }"],
  [".hp-mission-resume { order:7;", ".hp-mission-resume { order:11;"],
]);
await staticCheck("SX-01 styles: the header stays on screen while the rest scrolls, and leaves region B room (measured in the App: e2e/sx/home-app.spec.ts)", stylesCss, scrollerProblem, [
  [".hps-shell:has(> .hp-mission .hp-mission-sentence) { overflow-y: auto; }\n", ""],
  ["position: sticky; top: 0; z-index: 2;", "position: relative; z-index: 2;"],
  // The review's finding: the header sticks with no bound.
  [".hps-shell:has(> .hp-mission .hp-mission-sentence) > .hp-mission { box-sizing: border-box; max-height: max(150px, calc(100% - 250px)); overflow-y: auto; }\n", ""],
  ["max-height: max(150px, calc(100% - 250px)); overflow-y: auto; }", "max-height: none; overflow-y: auto; }"],
  ["max-height: max(150px, calc(100% - 250px)); overflow-y: auto; }", "max-height: max(150px, calc(100% - 250px)); }"],
  ["box-sizing: border-box; max-height: max(150px", "max-height: max(150px"],
]);

/**
 * SX-04: every button the theme paints Lime (`background: var(--vscode-button-background)`, which
 * the App's theme sets to the accent) steps down while region A shows its Primary — or is named
 * here with the reason it never shares a screen with it. A new theme-Lime button fails until it
 * is one or the other.
 */
const NOT_BESIDE_THE_PRIMARY = {
  ".hps-msg-user .hps-msg-body": "a chat bubble, not a button (SX-04 counts buttons; Lime on a bubble is SX-49's token-role question)",
  ".hps-naming-btn": "the naming ritual's own screen, drawn instead of the work screen",
  ".hps-world-open": "the kids worlds strip's open-world marker: a state, on seats with no lesson",
  ".hps-fatal-btn": "the error boundary's screen, drawn instead of the work screen",
  ".hps-voice-bar": "a voice level bar, not a button",
  ".hps-voice-to-text": "VoicePanel, which no screen of this webview mounts",
};
const STEP_DOWN = ".hps-shell:has(.hp-mission .hp-cta-primary) ";
function limeProblem(css) {
  const rules = cssRules(css);
  // The background each selector ends with, in source order (same selector, later rule wins).
  const last = new Map();
  for (const [list, body] of rules) {
    const bg = [...body.matchAll(/background(?:-color)?:\s*([^;]+)/g)].at(-1)?.[1].trim();
    if (bg) for (const sel of selectorsOf(list)) last.set(sel, bg);
  }
  const themeLime = [...last].filter(([sel, bg]) => bg.startsWith("var(--vscode-button-background") && !sel.startsWith(STEP_DOWN)).map(([sel]) => sel);
  if (themeLime.length === 0) return "no theme-Lime button found — the check reads nothing";
  const stepDown = rules.filter(([list, body]) => selectorsOf(list).every((s) => s.startsWith(STEP_DOWN)) && /background:\s*transparent/.test(body)).flatMap(([list]) => selectorsOf(list));
  const loose = themeLime.filter((sel) => !stepDown.some((s) => s.endsWith(" " + sel)) && !(sel in NOT_BESIDE_THE_PRIMARY));
  return loose.length ? `theme-Lime buttons beside region A's Primary: ${loose.join(", ")}` : null;
}
await staticCheck("SX-04 styles: no theme-Lime button stays Lime beside region A's Primary (measured in the App: e2e/sx/home-app.spec.ts)", stylesCss, limeProblem, [
  // Send keeps the theme's Lime again (the in-app finding of 2026-10-05).
  [".hps-shell:has(.hp-mission .hp-cta-primary) .hps-input .hps-btn-send,\n", ""],
  // A new button takes the theme's colour without stepping down.
  [".hps-btn-send {\n", ".hps-new-cta { background: var(--vscode-button-background); }\n.hps-btn-send {\n"],
]);

console.log(`sx-home: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
