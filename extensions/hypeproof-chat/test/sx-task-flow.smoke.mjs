// SX-55 — the task flow on the host (assigned → working → submitted), and what regions A and D
// draw from it. Run: node --experimental-strip-types test/sx-task-flow.smoke.mjs
//
// What is judged:
//   1. `learningState` (src/learningStateHelpers.ts) closes completion by phase, and keeps the
//      gate's own `missing` list for region A in every phase;
//   2. region A's check marks read only that list (webview-ui/src/missionHeaderLogic.ts);
//   3. the host CALLS the flow at each moment the design names. STATE.md's finding was exactly
//      "the transition table shipped, the caller did not", so the callers are checked first.
//      Static, like test/cr-host.smoke.mjs: ChatPanelProvider cannot load without VS Code;
//   4. the flow's rules (src/taskFlowHelpers.ts), pure;
//   5. the same rules on the App's real record store (FileRecordStorage on a temp dir), read
//      back through a fresh instance, as a restarted extension host would;
//   6. the local review list does not offer a task it cannot open;
//   7. the rendered region A marks and region D line (test/sx-render.mjs, real components).
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
  const state = learningState({ task: TASK, events: [], completion: [], phase: "submitted" });
  assert.equal(state.complete.ok, false, "a submitted task can be submitted again");
  assert.deepEqual(state.complete.reasons, [], "a submitted task is told something is still missing");
  assert.equal(state.phase, "submitted");
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

await check("host: the task opens where the learning state is computed, and its phase is what is sent", () => {
  const body = between(provider, "private async postLearningState()", "private taskFlowNotice");
  assert.match(body, /screenFlow\(await this\.runTaskFlow\(\{ kind: 'seen' \}, recorder, profile\), this\.taskFlowLast, task\)/, "postLearningState never opens the task, or ignores the last phase it read");
  assert.match(body, /phase: shown\.phase, currentStep: shown\.current_step/, "the stored phase is not what the screen gets");
  assert.match(between(provider, "private async runTaskFlow(", "private async recordStepStart("), /this\.taskFlowLast = \{ taskId, curriculum: outcome\.curriculum \};/, "a successful read is not remembered for a busy record");
});

await check("host: a submit moves the task only after the gate is judged again on the host", () => {
  const { body, ok } = submitOrder(provider);
  assert.ok(ok, "the submit handler moves the task before (or without) re-judging the gate");
  assert.match(body, /if \(msg\.task !== current\)/, "a submit naming another task would move this one");
});

await check("host: the student's learning event and a coach turn that answered both count as work", () => {
  assert.match(between(provider, "case 'learningEvent': {", "case 'learningDrawer':"), /recordLearningEvent\(made\.event\)[\s\S]*runTaskFlow\(\{ kind: 'work' \}/);
  assert.match(
    provider,
    /observation\?\.batch\.format === 'hps-observation\/2' && finalSpoolStatus === 'ok' && assistantText\.length > 0\) \{\s*void this\.runTaskFlow\(\{ kind: 'work' \}, observation, profile\)/,
    "a coach turn never starts the task, or a failed or cancelled turn does",
  );
});

await check("host: starting a step records it; marking a step done moves nothing in the flow", () => {
  const body = between(provider, 'case "lessonStep": {', 'case "lessonFocus": {');
  assert.match(body, /if \(signal\.status === "in_progress"\) void this\.recordStepStart\(signal\.step_id\)/);
});

await check("host: the flow runs on the record the local review already uses, under its lock (SX-48)", () => {
  const body = between(provider, "private async runTaskFlow(", "private async recordStepStart(");
  assert.match(body, /this\.crRecordHandle\(\)/, "the flow opened a store of its own");
  assert.match(body, /store\.exclusive\(\(\) => applyTaskFlow\(/, "the flow writes outside the record's lock");
  assert.match(body, /if \(!lesson \|\| recorder\.batch\.format !== 'hps-observation\/2'\) return null;/, "a seat without a mission or without /2 runs the flow");
});

await check("static checks count something: a planted provider that moves before judging fails", () => {
  // Swap the two lines: the move now comes first. The same order check must refuse it.
  const planted = provider.replace("const verdict = acceptSubmit({", "const verdictLater = 0; const verdict = acceptSubmit({").replace(
    "const flow = recorder ? await this.runTaskFlow({ kind: 'submit' }, recorder, profile) : null;",
    "",
  ).replace("case 'submitTask': {", "case 'submitTask': { await this.runTaskFlow({ kind: 'submit' }, recorder, profile);");
  assert.notEqual(planted, provider, "the planted defect did not apply — the check below proves nothing");
  assert.equal(submitOrder(planted).ok, false, "a handler that moves before judging passed the order check");
});

// ── 4. The flow's rules, pure ──────────────────────────────────────────────────

const flow = await load("../src/taskFlowHelpers.ts");
const lesson = flow?.flowLessonOf(LESSON) ?? null;

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

  await check("decideFlow: the transition table, both directions", () => {
    const at = (phase, current_step = "expect") => ({ module: { course_id: "globalbuddy", version: LESSON.version, sha256: LESSON.sha256 }, week: 3, phase, current_step, steps: {} });
    assert.deepEqual(flow.decideFlow(at("assigned"), { kind: "work" }, lesson), { kind: "patch", patch: { phase: "working" } });
    assert.deepEqual(flow.decideFlow(at("working"), { kind: "work" }, lesson), { kind: "none" });
    assert.deepEqual(flow.decideFlow(at("working"), { kind: "submit" }, lesson), { kind: "patch", patch: { phase: "submitted" } });
    assert.deepEqual(flow.decideFlow(at("assigned"), { kind: "submit" }, lesson), { kind: "refused", code: "not_started" });
    assert.deepEqual(flow.decideFlow(at("submitted"), { kind: "submit" }, lesson), { kind: "none" });
    assert.deepEqual(flow.decideFlow(at("working"), { kind: "start_step", stepId: "test" }, lesson), { kind: "patch", patch: { current_step: "test" } });
    assert.deepEqual(flow.decideFlow(at("working", "test"), { kind: "start_step", stepId: "test" }, lesson), { kind: "none" });
    assert.deepEqual(flow.decideFlow(at("working"), { kind: "start_step", stepId: "없는단계" }, lesson), { kind: "refused", code: "unknown_step" });
    assert.deepEqual(flow.decideFlow(at("working"), { kind: "seen" }, lesson), { kind: "none" });
  });

  await check("SX-55 negative: no signal the host has moves a task to reflected (the boundary reflection, sx-p2)", () => {
    const at = (phase) => ({ module: { course_id: "globalbuddy", version: LESSON.version, sha256: LESSON.sha256 }, week: 3, phase, current_step: "expect", steps: {} });
    const signals = [{ kind: "seen" }, { kind: "work" }, { kind: "submit" }, { kind: "start_step", stepId: "retest" }];
    for (const phase of ["assigned", "working", "submitted"]) {
      for (const signal of signals) {
        const d = flow.decideFlow(at(phase), signal, lesson);
        assert.notEqual(d.kind === "patch" ? d.patch.phase : undefined, "reflected", `${phase} + ${signal.kind} reached reflected`);
      }
    }
  });

  await check("one task per lesson version and activity; a new version is a new task (MC-08)", () => {
    assert.equal(flow.learningTaskIdOf("f".repeat(64), "a1b2c3d4e5f6"), TASK);
    assert.notEqual(flow.learningTaskIdOf("e".repeat(64), "a1b2c3d4"), flow.learningTaskIdOf("f".repeat(64), "a1b2c3d4"));
  });

  await check("screenFlow: a record that could not be read shows the last phase read for the same task, never a default", () => {
    const submitted = { module: { course_id: "globalbuddy", version: LESSON.version, sha256: LESSON.sha256 }, week: 3, phase: "submitted", current_step: "retest", steps: {} };
    const working = { ...submitted, phase: "working" };
    assert.equal(flow.screenFlow({ curriculum: working, changed: false }, { taskId: TASK, curriculum: submitted }, TASK), working, "a fresh read lost to a remembered one");
    assert.equal(flow.screenFlow(null, { taskId: TASK, curriculum: submitted }, TASK), submitted, "a busy record put the completion button back on a submitted task");
    assert.equal(flow.screenFlow(null, { taskId: "task-other", curriculum: submitted }, TASK), null, "another task's phase was shown for this one");
    assert.equal(flow.screenFlow(null, null, TASK), null);
  });

  await check("startedBefore: only this task's learning event counts", () => {
    seq = 0;
    assert.equal(flow.startedBefore([criterion()], TASK), true);
    assert.equal(flow.startedBefore([criterion()], "task-other"), false, "another task's event started this one");
    assert.equal(flow.startedBefore([ev("coach", { text: "안녕하세요" }), ev("artifact", { sha256: "a".repeat(64) })], TASK), false, "a coach message or an AI draft is not the student's work");
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
    const apply = (signal, at, started = false, taskId = TASK) => {
      const { store, record } = open();
      return store.exclusive(() => flow.applyTaskFlow(record, { taskId, lesson, signal, started, at }));
    };
    const phases = async (taskId = TASK) =>
      (await open().record.getTask(taskId)).history.filter((h) => h.change.startsWith("curriculum:phase:")).map((h) => h.change.slice("curriculum:phase:".length));

    await check("seen: the task opens once, as assigned on its first step, naming its module", async () => {
      const first = await apply({ kind: "seen" }, 1000);
      assert.equal(first.changed, true);
      assert.equal(first.curriculum.phase, "assigned");
      assert.equal(first.curriculum.current_step, "expect");
      assert.equal(first.curriculum.week, 3);
      assert.deepEqual(first.curriculum.module, { course_id: "globalbuddy", version: LESSON.version, sha256: LESSON.sha256 });
      const again = await apply({ kind: "seen" }, 1001);
      assert.equal(again.changed, false, "a screen refresh rewrote the record");
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

    await check("step: starting a step records it; going back is allowed and keeps the earlier record", async () => {
      const r = await apply({ kind: "start_step", stepId: "test" }, 1300);
      assert.equal(r.curriculum.current_step, "test");
      assert.equal(r.curriculum.steps.expect.left_at, 1300, "the step left has no left_at");
      const back = await apply({ kind: "start_step", stepId: "expect" }, 1400);
      assert.equal(back.curriculum.current_step, "expect");
      assert.equal(back.curriculum.steps.test.entered_at, 1300, "going back erased the visit to the later step");
      assert.equal(back.curriculum.steps.test.left_at, 1400);
    });

    await check("step negative: a step that is not this lesson's is refused and not stored", async () => {
      const r = await apply({ kind: "start_step", stepId: "없는단계" }, 1450);
      assert.equal(r.refused, "unknown_step");
      assert.equal(r.changed, false);
      assert.equal((await open().record.getTask(TASK)).curriculum.current_step, "expect");
    });

    await check("SX-55: a submit while working moves to submitted, and a reload reads it back", async () => {
      const r = await apply({ kind: "submit" }, 1500);
      assert.equal(r.curriculum.phase, "submitted");
      assert.equal(r.curriculum.submitted_at, 1500);
      const stored = await open().record.getTask(TASK);
      assert.equal(stored.curriculum.phase, "submitted", "the submit did not survive a reload");
      assert.equal(stored.status, "open", "the flow touched the work axis (Task.status, MC-23)");
      assert.deepEqual(await phases(), ["assigned", "working", "submitted"]);
    });

    await check("SX-55: a second submit changes nothing and is not an error", async () => {
      const r = await apply({ kind: "submit" }, 1600);
      assert.equal(r.changed, false);
      assert.equal(r.refused, undefined, "a double click was reported as a refusal");
      assert.deepEqual(await phases(), ["assigned", "working", "submitted"], "a second submit was recorded twice");
    });

    await check("SX-55 negative: after the submit, nothing the host sends moves the phase", async () => {
      for (const signal of [{ kind: "seen" }, { kind: "work" }, { kind: "submit" }, { kind: "start_step", stepId: "retest" }]) await apply(signal, 1700);
      assert.equal((await open().record.getTask(TASK)).curriculum.phase, "submitted");
      assert.deepEqual(await phases(), ["assigned", "working", "submitted"]);
    });

    await check("started before: a task whose student already left a learning event opens as working", async () => {
      const other = flow.learningTaskIdOf("f".repeat(64), "zz000000");
      const r = await apply({ kind: "seen" }, 1800, true, other);
      assert.equal(r.curriculum.phase, "working", "work already in the batch is shown as not started");
      assert.deepEqual(await phases(other), ["working"]);
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

// ── 6. The local review does not offer a task it cannot open ──────────────────

const reviewRoot = await mkdtemp(join(tmpdir(), "hps-task-flow-review-"));
try {
  const { LocalReviewService } = await import("../src/localReviewService.ts");
  const at = "2026-09-14T12:00:00Z";
  const transcript = [
    { type: "session_meta", payload: { id: "codex-one", cwd: "/project" } },
    { timestamp: at, type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Check the change and tell me what remains unknown." }] } },
    { timestamp: at, type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "I checked it." }] } },
  ].map((r) => JSON.stringify(r)).join("\n");
  const service = new LocalReviewService(reviewRoot);
  const card = await service.import(transcript, "codex", "/project");
  if (flow && lesson) await service.store.exclusive(() => flow.applyTaskFlow(service.record, { taskId: TASK, lesson, signal: { kind: "seen" }, started: false, at: 2000 }));

  await check("review list: transcript tasks stay, the curriculum task it cannot open is left out", async () => {
    assert.equal(typeof service.reviewRecords, "function", "the review screen has no list that leaves curriculum tasks out");
    const listed = (await service.reviewRecords()).tasks.map((t) => t.id);
    assert.deepEqual(listed, [card.task.id]);
  });

  await check("review list control: the record holds both, so the filter is what keeps it out", async () => {
    const all = (await service.record.records()).tasks.map((t) => t.id).sort();
    assert.deepEqual(all, [card.task.id, TASK].sort(), "the curriculum task is not on the record — the check above proves nothing");
    await assert.rejects(service.card(TASK), /import_incomplete/, "the review can open it after all, so it should be listed");
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
  const conditionTexts = (html) => [...html.matchAll(/<span class="hp-mission-completion-text">([^<]*)<\/span>/g)].map((m) => m[1]);
  const designTexts = week3.learning.completion.map((c) => c.text);

  await check("SX-01·SX-50: region A checks a condition off only where the host's gate says it is met", async () => {
    const all = await header([]);
    assert.deepEqual(marks(all), ["yes", "yes", "yes"], "nothing missing, and a condition stayed unchecked");
    assert.equal((all.match(/☑/g) ?? []).length, 4, "three ☑ marks and the note that explains them");
    assert.ok(visibleText(all).includes("☑ 표시는 내가 남긴 기록에서 확인된 것이에요."));
    const some = await header([{ code: "missing_completion_event", item: "c2", event: "change_requested" }]);
    assert.deepEqual(marks(some), ["yes", "no", "yes"]);
    const late = await header([{ code: "criterion_after_artifact", event: "criterion_set" }]);
    assert.deepEqual(marks(late), ["no", "yes", "yes"], "a late criterion was checked off as '시험 전에 적었다'");
  });

  await check("SX-50 negative: with no verdict from the host, nothing is checked off and the header says why", async () => {
    for (const html of [await header(undefined), await header(null)]) {
      assert.deepEqual(marks(html), ["no", "no", "no"], "a check mark was drawn with no verdict behind it");
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
}

console.log(`sx-task-flow: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
