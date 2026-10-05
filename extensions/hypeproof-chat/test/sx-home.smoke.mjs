// Region A, the work screen's home (SX-01 ~ SX-04): SX-02's "지난번 이어서" — the step the task
// record still holds from an earlier session of the App — and the two style rules the in-app run
// found missing. Run: node --experimental-strip-types test/sx-home.smoke.mjs
//
// What is judged:
//   1. the rule (`resumeOf`, src/taskFlowHelpers.ts), pure: an entry only for a record last
//      changed before this session began, and only while the task is being worked on;
//   2. the same rule over the App's real record store, across a restart (a fresh store instance
//      and a later session start, as a reopened App has): the first session never shows it, the
//      reopened one names the recorded step, and a move in the new session takes it away;
//   3. `learningState` carries it only when the host gives it;
//   4. the host passes it, with the session start taken once, and only on a seat that runs the
//      task flow (static, as test/sx-task-flow.smoke.mjs: ChatPanelProvider cannot load without
//      VS Code); the webview hands the host's value to region A untouched. Every static check
//      also runs on a planted source that must fail it;
//   5. region A draws it (the real MissionHeader through test/sx-render.mjs): below the actions
//      and the completion conditions, above the growth link, a quiet button with the step's own
//      title and no figure, and nothing for a step this lesson does not have;
//   6. styles.css keeps the header on screen while the rest scrolls (SX-01) and leaves one Lime
//      button while region A shows its Primary (SX-04). A server render applies no CSS, so these
//      are static tripwires for CI; what they guard was measured in the App.
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
  "host: the entry is decided from the record the screen is shown, against the session start, on a flow seat only",
  provider,
  (text) =>
    lacks(postBody(text), /\.\.\.\(shown \? \{ phase: shown\.curriculum\.phase, currentStep: shown\.curriculum\.current_step, resume: resumeOf\(shown, this\.appSessionStartedAt\) \} : \{\}\)/, "the host does not send the entry from the shown record and the session start, or sends it on a seat without the flow"),
  [
    // The entry is never sent.
    [", resume: resumeOf(shown, this.appSessionStartedAt) }", " }"],
    // "Now" taken per state: every record written a moment ago reads as last time.
    ["resumeOf(shown, this.appSessionStartedAt)", "resumeOf(shown, Date.now())"],
    // The record's step sent whatever the session: the first session shows it too.
    ["resume: resumeOf(shown, this.appSessionStartedAt)", "resume: { step: shown.curriculum.current_step }"],
  ],
);
await staticCheck(
  "host: the session start is taken once, when the host is made",
  provider,
  (text) => lacks(text, /\n  private readonly appSessionStartedAt = Date\.now\(\);\n/, "the session start is not a value fixed when the host is made"),
  [
    ["private readonly appSessionStartedAt = Date.now();", "private get appSessionStartedAt() { return Date.now(); }"],
    ["private readonly appSessionStartedAt = Date.now();", "private appSessionStartedAt = 0;"],
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

// ── 5. Region A draws it (the real component) ───────────────────────────────────

await check("resumeStepOf: a step of this lesson, or nothing — never a fallback step", () => {
  const steps = week3.steps;
  assert.equal(logic.resumeStepOf(steps, { step: "build" })?.id, "build");
  assert.equal(logic.resumeStepOf(steps, { step: "없는단계" }), null, "a step this lesson does not have was drawn (or replaced by another)");
  for (const resume of [null, undefined, {}, { step: "" }, { step: 3 }]) assert.equal(logic.resumeStepOf(steps, resume), null, JSON.stringify(resume));
  assert.equal(logic.resumeStepOf([], { step: "build" }), null);
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

  await check("render negative: no entry without the host's word, for a step the lesson lacks, or with no design file", async () => {
    for (const resume of [null, undefined, { step: "없는단계" }]) {
      const none = visibleText(await renderComponent("MissionHeader", { ...homeProps, resume }));
      assert.ok(!none.includes(RESUME), `an entry was drawn for resume=${JSON.stringify(resume)}`);
      assert.ok(none.includes(week3.learning.mission), "the header itself disappeared — the check proves nothing");
    }
    const noLesson = visibleText(await renderComponent("MissionHeader", { ...homeProps, lesson: null, resume: { step: "build" } }));
    assert.ok(!noLesson.includes(RESUME), "a seat with no design file was offered a step");
  });
}

// ── 6. The style rules the in-app run found missing (static tripwires) ─────────────

const stylesCss = readFileSync(new URL("../webview-ui/src/styles.css", import.meta.url), "utf8");
/** [selector list, body] for every rule (comments stripped; the rule inside an @media block is listed too). */
const cssRules = (text) =>
  [...text.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim().replace(/\s+/g, " "), m[2]]);
const selectorsOf = (list) => list.split(",").map((s) => s.trim()).filter(Boolean);

/** SX-01: while region A shows a lesson's mission, the shell is the scroller the sticky header sticks to. */
function scrollerProblem(css) {
  const rules = cssRules(css);
  const sticky = rules.find(([sel]) => sel === ".hp-mission");
  if (!sticky || !/position:\s*sticky/.test(sticky[1]) || !/top:\s*0/.test(sticky[1])) return "region A's header is no longer sticky";
  const scroller = rules.find(([sel, body]) => sel === ".hps-shell:has(> .hp-mission .hp-mission-sentence)" && /overflow-y:\s*auto/.test(body));
  return scroller ? null : "the shell is not the scroller while the mission is on screen: the document scrolls the header away";
}
await staticCheck("SX-01 styles: the header stays on screen while the rest scrolls (measured in the App: e2e/sx/home-app.spec.ts)", stylesCss, scrollerProblem, [
  [".hps-shell:has(> .hp-mission .hp-mission-sentence) { overflow-y: auto; }\n", ""],
  ["position: sticky; top: 0; z-index: 2;", "position: relative; z-index: 2;"],
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
