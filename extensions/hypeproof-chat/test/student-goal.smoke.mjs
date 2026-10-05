// AE-01 (#554) — the student's own goal and completion criteria kept beside the lesson's criteria.
// Packet `goal` (config/requirement-work.json):
//   positive  after a goal change, the chat screens show the same new goal and the lesson's original criteria, also
//             after a reconnect (a fresh host over the same device storage) and in every chat view the host posts to;
//   negative  a student edit cannot remove a lesson criterion; another lesson's (or revision's, or activity's) goal is
//             never restored; viewing or saving a goal records no completion.
// Three layers: the pure rules (src/studentGoal.ts), the real host handler and config path (src/chatPanelProvider.ts,
// bundled, driven through a stand-in host as test/activity-draft.smoke.mjs does), and the real rendered chat screen
// (webview-ui/src/ChatPanel.tsx and StudentGoal.tsx through the render instrument). Every check that could pass
// vacuously runs once on a planted defect that must be caught (verification.md rule 2).
//
// Run: node --experimental-strip-types test/student-goal.smoke.mjs

import assert from "node:assert/strict";
import { build } from "esbuild";
import vm from "node:vm";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { rendererStatus, renderComponent, visibleText } from "./sx-render.mjs";
import { auditRegionText } from "./sx-audit.mjs";
import { chatConfig, chatPanelProps, resolvedProfile, weekFixture } from "./sx-screen-fixtures.mjs";

const G = await import("../src/studentGoal.ts");
let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`ok ${name}`);
}

const week3 = weekFixture(3);
const LESSON_A = { course_id: "globalbuddy", version: "m2026.09.20-1", sha256: "f".repeat(64), content: week3 };
/** A new revision of the same course: another task, so it starts without A's goal. */
const LESSON_A2 = { ...LESSON_A, version: "m2026.09.27-1", sha256: "e".repeat(64) };
/** Another course. */
const LESSON_B = { course_id: "dental-l2", version: "m2026.09.20-3", sha256: "d".repeat(64), content: weekFixture(1) };
const ACT = "a".repeat(64);
const GOAL = "예약 버튼이 첫 화면에서 바로 보이게 만들기";
const CRITERIA = ["휴대폰 화면에서도 예약 버튼이 보인다", "원래 진료 시간과 같다"];
/** Every criterion the lesson itself states: the week's completion conditions and each step's acceptance. */
const lessonCriteriaOf = (lesson) => [
  ...(lesson.content.learning?.completion ?? []).map((c) => c.text),
  ...lesson.content.steps.map((s) => s.acceptance),
];
const save = (all, lesson, over = {}, activity = ACT) =>
  G.acceptGoalSave(lesson, activity, { lesson: lesson?.sha256 ?? LESSON_A.sha256, goal: GOAL, criteria: CRITERIA, base: 0, ...over }, all, 1000);

// ─── 1. Pure rules ──────────────────────────────────────────────────────────

await test("rules: a save stores only the goal and personal criteria, under this lesson revision and activity", () => {
  const first = save({}, LESSON_A);
  assert.equal(first.ok, true);
  assert.deepEqual(first.record, {
    schema: "hps-student-goal/1",
    lesson: { course_id: "globalbuddy", version: "m2026.09.20-1", sha256: LESSON_A.sha256 },
    activity: ACT,
    goal: GOAL,
    criteria: CRITERIA,
    revision: 1,
    saved_at: 1000,
  });
  const view = G.goalViewOf(LESSON_A, ACT, first.all);
  assert.equal(view.goal, GOAL);
  assert.deepEqual(view.criteria, CRITERIA);
  assert.equal(view.revision, 1);
  const second = G.acceptGoalSave(LESSON_A, ACT, { lesson: LESSON_A.sha256, goal: "  새 목표  ", criteria: ["  새 기준 ", "", "  "], base: 1 }, first.all, 2000);
  assert.equal(second.ok, true);
  assert.deepEqual([second.record.goal, second.record.criteria, second.record.revision], ["새 목표", ["새 기준"], 2]);
  // The student may also clear their own goal; the revision still moves forward.
  const cleared = G.acceptGoalSave(LESSON_A, ACT, { lesson: LESSON_A.sha256, goal: "", criteria: [], base: 2 }, second.all, 3000);
  assert.deepEqual([cleared.ok, G.goalViewOf(LESSON_A, ACT, cleared.all).goal, G.goalViewOf(LESSON_A, ACT, cleared.all).revision], [true, "", 3]);
  assert.deepEqual(G.goalCriteriaFromText("하나\r\n\n  둘  \n"), ["하나", "둘"]);
});

await test("rules: no student edit can reach a lesson criterion (negative: a save carrying the lesson's fields)", () => {
  const lesson = structuredClone(LESSON_A);
  const before = JSON.stringify(lesson);
  const forged = {
    lesson: lesson.sha256,
    goal: GOAL,
    criteria: [],
    base: 0,
    // What a screen trying to "replace the lesson's criteria" would send.
    completion: [],
    learning: { completion: [] },
    acceptance: "",
    objective: "",
    steps: [],
  };
  const saved = G.acceptGoalSave(lesson, ACT, forged, {}, 1000);
  assert.equal(saved.ok, true, "the student's own part of the save is still accepted");
  assert.deepEqual(Object.keys(saved.record).sort(), ["activity", "criteria", "goal", "lesson", "revision", "saved_at", "schema"]);
  assert.deepEqual(Object.keys(saved.record.lesson).sort(), ["course_id", "sha256", "version"], "only the revision's identity is kept, never its content");
  assert.equal(JSON.stringify(lesson), before, "the served lesson is untouched");
  assert.deepEqual(lessonCriteriaOf(lesson), lessonCriteriaOf(LESSON_A));
  // Negative control: a store that spread the message into the record would carry the lesson's fields. The key check
  // above tells the two apart, so it is not passing vacuously.
  const spreading = { ...forged, schema: "hps-student-goal/1", revision: 1, saved_at: 1000, activity: ACT };
  assert.notDeepEqual(Object.keys(spreading).sort(), Object.keys(saved.record).sort());
});

await test("rules: another lesson's, revision's or activity's goal is never restored (negative controls included)", () => {
  const all = save({}, LESSON_A).all;
  for (const [label, lesson, activity] of [["another course", LESSON_B, ACT], ["a new revision of the course", LESSON_A2, ACT], ["another activity", LESSON_A, "b".repeat(64)], ["a seat without activity", LESSON_A, null]]) {
    const view = G.goalViewOf(lesson, activity, all);
    assert.deepEqual([view.goal, view.criteria, view.revision], ["", [], 0], `${label} showed A's goal`);
  }
  // A record copied under another lesson's key is refused, not shown as that lesson's goal.
  const record = all[G.goalScopeKey({ course_id: LESSON_A.course_id, version: LESSON_A.version, sha256: LESSON_A.sha256 }, ACT)];
  const tampered = { [G.goalScopeKey({ course_id: LESSON_B.course_id, version: LESSON_B.version, sha256: LESSON_B.sha256 }, ACT)]: record };
  assert.equal(G.goalViewOf(LESSON_B, ACT, tampered).goal, "", "a copied record must not pass as B's goal");
  // Negative control: a lookup keyed by course alone (one goal per course) would hand A's goal to the new revision.
  const byCourse = (store, lesson) => Object.values(store).find((r) => r.lesson.course_id === lesson.course_id)?.goal ?? "";
  assert.equal(byCourse(all, LESSON_A2), GOAL, "the control must actually restore the old goal");
  assert.notEqual(byCourse(all, LESSON_A2), G.goalViewOf(LESSON_A2, ACT, all).goal);
  // Positive control: the same lesson and activity get the goal back.
  assert.equal(G.goalViewOf(LESSON_A, ACT, all).goal, GOAL);
  // Each revision keeps its own goal: a goal written under the new revision does not replace the old one's.
  const both = G.acceptGoalSave(LESSON_A2, ACT, { lesson: LESSON_A2.sha256, goal: "새 버전의 목표", criteria: [], base: 0 }, all, 2000).all;
  assert.deepEqual([G.goalViewOf(LESSON_A, ACT, both).goal, G.goalViewOf(LESSON_A2, ACT, both).goal], [GOAL, "새 버전의 목표"]);
});

await test("rules: a save from an older revision, another lesson or past the bounds is refused and stores nothing", () => {
  const all = save({}, LESSON_A).all;
  assert.deepEqual(save(all, LESSON_A, { base: 0 }), { ok: false, code: "stale" }, "a second view saving from revision 0 would overwrite revision 1");
  assert.equal(save(all, LESSON_A, { base: 1 }).ok, true);
  assert.deepEqual(save(all, LESSON_A, { lesson: LESSON_B.sha256, base: 1 }), { ok: false, code: "other_lesson" }, "a form drawn under another lesson");
  assert.deepEqual(save({}, null), { ok: false, code: "no_lesson" });
  assert.deepEqual(save({}, LESSON_A, { goal: "x".repeat(G.GOAL_TEXT_MAX + 1) }), { ok: false, code: "too_long" });
  assert.deepEqual(save({}, LESSON_A, { criteria: ["x".repeat(G.GOAL_CRITERION_MAX + 1)] }), { ok: false, code: "too_long" });
  assert.deepEqual(save({}, LESSON_A, { criteria: ["a", "b", "c", "d", "e", "f"] }), { ok: false, code: "too_many" });
  assert.deepEqual(save({}, LESSON_A, { criteria: "하나" }), { ok: false, code: "invalid" });
  assert.equal(save({}, LESSON_A, { goal: "x".repeat(G.GOAL_TEXT_MAX) }).ok, true, "the bound itself is allowed");
  for (const code of ["no_lesson", "other_lesson", "invalid", "too_long", "too_many", "stale", "not_stored"]) {
    assert.doesNotMatch(G.GOAL_REFUSAL_SENTENCES[code], /\d/, `${code}: screen copy carries no number (SX-59)`);
  }
});

await test("rules: the screen keeps the newest goal of a lesson and follows the served lesson", () => {
  const v1 = G.goalViewOf(LESSON_A, ACT, save({}, LESSON_A).all);
  const v2 = { ...v1, goal: "새 목표", revision: 2 };
  assert.equal(G.acceptGoalView(v2, v1), v2, "an older config cannot put the earlier goal back after the save's answer");
  assert.equal(G.acceptGoalView(v1, v2), v2);
  const other = G.goalViewOf(LESSON_B, ACT, {});
  assert.equal(G.acceptGoalView(v2, other), other, "another lesson's view replaces the held one");
  assert.equal(G.acceptGoalView(v2, null), null);
  assert.equal(G.acceptGoalView(v2, undefined), v2, "a config without the field keeps what is shown");
  assert.equal(G.goalOfLesson(v2, LESSON_A), v2);
  assert.equal(G.goalOfLesson(v2, LESSON_A2), null, "a view of another revision is not drawn as this lesson's goal");
});

// ─── 2. The real host: the save handler and the config every mount and reconnect starts from ──────────

const require = createRequire(import.meta.url);
const vscode = { workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }) }, env: { appName: "HypeProof Studio" } };
const bundle = await build({
  stdin: {
    contents: "export {ChatPanelProvider} from './src/chatPanelProvider';export {ActivityConnections} from './src/activityConnections';",
    resolveDir: new URL("..", import.meta.url).pathname,
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  write: false,
  logLevel: "silent",
});
const hostModule = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, {
  module: hostModule, exports: hostModule.exports, require: (id) => (id === "vscode" ? vscode : require(id)),
  process, console, URL, Buffer, crypto: globalThis.crypto, AbortSignal, TextEncoder, TextDecoder, setTimeout, clearTimeout,
});
const { ActivityConnections, ChatPanelProvider } = hostModule.exports;
const proto = ChatPanelProvider.prototype;

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hps-goal-"));
/** One folder's workspaceState, shared by every host below (a reconnect reads the same device storage). */
const states = new Map();
const secrets = new Map();
let failWrites = false;
const raw = (dir) => ({
  globalStorageUri: { fsPath: path.join(dir, "storage") },
  workspaceState: { get: (k, d) => (states.has(k) ? states.get(k) : d), update: async (k, v) => { if (failWrites) throw Error("synthetic write failure"); states.set(k, v); } },
  secrets: { keys: async () => [...secrets.keys()], get: async (k) => secrets.get(k), store: async (k, v) => secrets.set(k, v), delete: async (k) => secrets.delete(k) },
});

/** A stand-in host for one App session: the provider's own methods over these fields. Side effects are recorded. */
function makeHost(context, profile) {
  const effects = [];
  const posts = [];
  const host = {
    context,
    cachedProfile: profile,
    goalWrites: Promise.resolve(),
    saveGoal: proto.saveGoal,
    draftWrites: Promise.resolve(),
    loadAccess: async () => {},
    ensureProfile: async () => profile,
    lastProfileFailure: null,
    refreshCrDirectorContext: async () => {},
    _instructorMode: { reset() {}, handleAutoReadResult() { return null; } },
    getCoach: () => ({ name: "코치", personality: "", configured: true }),
    post: async (msg) => { posts.push(msg); return true; },
    // Everything a completion, a step move or a record would go through. A goal save must reach none of them.
    spool: { recordWorkflow: (r) => effects.push(["spool", r.event]) },
    opsObserver: { lessonStep: (...a) => effects.push(["ops.lessonStep", ...a]) },
    recordStepStart: async () => effects.push(["task-flow.step"]),
    postLearningState: async () => effects.push(["learning-state"]),
    persistObservation: () => effects.push(["observation"]),
  };
  return { host, posts, effects };
}
const goalStates = (posts) => posts.filter((m) => m.type === "goalState");
const configOf = (posts) => posts.filter((m) => m.type === "config").at(-1)?.config;

const profileA = { ...resolvedProfile(3), activity_id: ACT, lesson: LESSON_A };
const connA = new ActivityConnections(raw(root), () => "https://synthetic.invalid/v1", () => root, async () => profileA);
await connA.commit("synthetic-credential", { activity_id: ACT, display_name: "Synthetic" }, root);
const ctxA = connA.wrap();

try {
  await test("host: a save is stored for this lesson and activity and every chat view gets the same goal", async () => {
    const { host, posts } = makeHost(ctxA, profileA);
    await proto.handleMessage.call(host, { type: "goalSave", activityId: connA.scope, lesson: LESSON_A.sha256, goal: GOAL, criteria: CRITERIA, base: 0 });
    const [answer] = goalStates(posts);
    assert.equal(answer.saved, true);
    assert.equal(answer.view.goal, GOAL);
    assert.deepEqual([...answer.view.criteria], CRITERIA, "the host's view carries the criteria as saved");
    assert.equal(answer.view.activity, connA.scope);
    const stored = states.get(G.STUDENT_GOAL_KEY);
    assert.deepEqual(Object.values(stored).map((r) => [r.goal, r.revision]), [[GOAL, 1]]);
    // The provider's `post` goes to the sidebar view and the editor chat alike; the answer names no view.
    assert.equal("requestId" in answer, false);
  });

  await test("host: reconnect — a fresh host over the same storage starts the screen from the saved goal", async () => {
    const { host, posts } = makeHost(ctxA, profileA);
    await proto.postConfig.call(host);
    const config = configOf(posts);
    assert.ok(config, "postConfig posted no config");
    assert.equal(config.studentGoal.goal, GOAL);
    assert.deepEqual([...config.studentGoal.criteria], CRITERIA);
    assert.equal(config.studentGoal.revision, 1);
    // The lesson's criteria in the same config are the served lesson's own, word for word.
    assert.deepEqual(lessonCriteriaOf(config.profile.lesson), lessonCriteriaOf(LESSON_A));
  });

  await test("host: the next lesson revision and another course start without the earlier goal", async () => {
    for (const lesson of [LESSON_A2, LESSON_B]) {
      const { host, posts } = makeHost(ctxA, { ...profileA, lesson });
      await proto.postConfig.call(host);
      const goal = configOf(posts).studentGoal;
      assert.deepEqual([goal.lesson.sha256, goal.goal, goal.revision], [lesson.sha256, "", 0], `${lesson.version} restored A's goal`);
    }
    // A host with no lesson sends no goal at all.
    const { host, posts } = makeHost(ctxA, { ...profileA, lesson: undefined });
    await proto.postConfig.call(host);
    assert.equal(configOf(posts).studentGoal, null);
  });

  await test("host: refused saves store nothing and say why (stale view, other lesson, write failure, other activity)", async () => {
    const before = JSON.stringify(states.get(G.STUDENT_GOAL_KEY));
    for (const [msg, sentence] of [
      [{ lesson: LESSON_A.sha256, goal: "다른 화면의 예전 목표", criteria: [], base: 0 }, G.GOAL_REFUSAL_SENTENCES.stale],
      [{ lesson: LESSON_B.sha256, goal: "수업 B 목표", criteria: [], base: 1 }, G.GOAL_REFUSAL_SENTENCES.other_lesson],
    ]) {
      const { host, posts } = makeHost(ctxA, profileA);
      await proto.handleMessage.call(host, { type: "goalSave", activityId: connA.scope, ...msg });
      const [answer] = goalStates(posts);
      assert.equal(answer.error, sentence);
      assert.equal(answer.view.goal, GOAL, "the refusal keeps the stored goal on screen");
    }
    failWrites = true;
    try {
      const { host, posts } = makeHost(ctxA, profileA);
      await proto.handleMessage.call(host, { type: "goalSave", activityId: connA.scope, lesson: LESSON_A.sha256, goal: "저장 실패", criteria: [], base: 1 });
      assert.equal(goalStates(posts)[0].error, G.GOAL_REFUSAL_SENTENCES.not_stored);
      assert.equal(goalStates(posts)[0].view.goal, GOAL);
    } finally {
      failWrites = false;
    }
    // A message from another activity's view is dropped by the handler's activity guard: no answer, nothing stored.
    const { host, posts } = makeHost(ctxA, profileA);
    await proto.handleMessage.call(host, { type: "goalSave", activityId: "c".repeat(64), lesson: LESSON_A.sha256, goal: "다른 활동", criteria: [], base: 1 });
    assert.deepEqual(posts, []);
    assert.equal(JSON.stringify(states.get(G.STUDENT_GOAL_KEY)), before);
  });

  await test("host: two views saving from the same revision — the second is refused, not overwriting the first", async () => {
    const { host, posts } = makeHost(ctxA, profileA);
    await Promise.all([
      proto.handleMessage.call(host, { type: "goalSave", activityId: connA.scope, lesson: LESSON_A.sha256, goal: "첫 화면의 목표", criteria: [], base: 1 }),
      proto.handleMessage.call(host, { type: "goalSave", activityId: connA.scope, lesson: LESSON_A.sha256, goal: "둘째 화면의 목표", criteria: [], base: 1 }),
    ]);
    const answers = goalStates(posts);
    assert.deepEqual(answers.map((a) => a.saved === true), [true, false]);
    assert.equal(answers[1].error, G.GOAL_REFUSAL_SENTENCES.stale);
    assert.equal(G.goalViewOf(LESSON_A, connA.scope, states.get(G.STUDENT_GOAL_KEY)).goal, "첫 화면의 목표");
    // Negative control: without the queue both handlers read revision 1 and both save. Run the two saves unqueued
    // on a copy of the store to show the race the queue removes is real.
    const copy = structuredClone(states.get(G.STUDENT_GOAL_KEY));
    const a = G.acceptGoalSave(LESSON_A, connA.scope, { lesson: LESSON_A.sha256, goal: "가", criteria: [], base: 2 }, copy, 1);
    const b = G.acceptGoalSave(LESSON_A, connA.scope, { lesson: LESSON_A.sha256, goal: "나", criteria: [], base: 2 }, copy, 2);
    assert.equal(a.ok && b.ok, true, "unqueued, both saves pass the revision check");
    // Back to the student's goal for the checks below.
    await proto.handleMessage.call(host, { type: "goalSave", activityId: connA.scope, lesson: LESSON_A.sha256, goal: GOAL, criteria: CRITERIA, base: 2 });
    assert.equal(G.goalViewOf(LESSON_A, connA.scope, states.get(G.STUDENT_GOAL_KEY)).revision, 3);
  });

  await test("host: viewing or saving a goal records no completion, step move, observation or class-board event", async () => {
    const { host, posts, effects } = makeHost(ctxA, profileA);
    await proto.postConfig.call(host);
    await proto.handleMessage.call(host, { type: "goalSave", activityId: connA.scope, lesson: LESSON_A.sha256, goal: "목표만 바꿨어요", criteria: [], base: 3 });
    assert.deepEqual(effects, []);
    assert.deepEqual([...new Set(posts.map((m) => m.type))].sort(), ["config", "goalState"]);
    // Negative control: the detector does see a message that does report progress (the learner's own "마쳤어요").
    const control = makeHost(ctxA, profileA);
    await proto.handleMessage.call(control.host, { type: "lessonStep", activityId: connA.scope, stepId: week3.steps[0].id, status: "submitted" });
    assert.ok(control.effects.some(([what]) => what === "spool") && control.effects.some(([what]) => what === "ops.lessonStep"), JSON.stringify(control.effects));
    // Restore the student's goal for the screen checks.
    await proto.handleMessage.call(host, { type: "goalSave", activityId: connA.scope, lesson: LESSON_A.sha256, goal: GOAL, criteria: CRITERIA, base: 4 });
  });
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

// ─── 3. The rendered chat screen ────────────────────────────────────────────

const status = rendererStatus();
if (!status.available) {
  console.log(`NOT RUN screen checks — ${status.detail}`);
  console.log(`PASS student-goal: ${passed} rule and host checks (screen not rendered)`);
  process.exit(0);
}

// The goal the host stored above, read the way the host reads it for config (the activity scope is the connection's
// own id, not the Service's activity id). Guarded: an empty view here would let every check below pass on nothing.
const storedView = G.goalViewOf(LESSON_A, connA.scope, states.get(G.STUDENT_GOAL_KEY));
assert.deepEqual([storedView.goal, [...storedView.criteria]], [GOAL, CRITERIA], "the screen checks need the stored goal");
const withGoal = (view, over = {}) => chatPanelProps({ config: { ...chatConfig(3), studentGoal: view }, ...over });
/** What a criterion check reads: each lesson criterion's words, and the student's own block apart from region A. */
function screenOf(html) {
  const text = visibleText(html);
  const header = /<header class="hp-mission"[\s\S]*?<\/header>/.exec(html)?.[0] ?? "";
  const goalBlock = /<details class="hp-rail-lesson hp-goal"[\s\S]*?<\/details>/.exec(html)?.[0] ?? "";
  const headerGoal = /<p class="hp-mission-goal">[\s\S]*?<\/p>/.exec(header)?.[0] ?? null;
  return {
    text,
    header: visibleText(header),
    headerHtml: header,
    /** Region A's goal line (fixed with the header), or null when none is drawn. */
    headerGoal: headerGoal === null ? null : visibleText(headerGoal),
    headerGoalHtml: headerGoal,
    goal: visibleText(goalBlock),
    goalHtml: goalBlock,
  };
}
/** The lesson's week conditions in region A and the current step's acceptance, each missing one named. */
function lessonCriteriaMissing(screen) {
  const wanted = [...week3.learning.completion.map((c) => c.text), week3.steps[0].acceptance];
  return wanted.filter((t) => !screen.header.includes(t));
}

await test("screen: the chat shows the saved goal and criteria beside the lesson's untouched criteria", async () => {
  const html = await renderComponent("ChatPanel", withGoal(storedView));
  const screen = screenOf(html);
  // Region A, fixed with the header: the goal as one line, after the lesson's own conditions.
  assert.equal(screen.headerGoal, `내 목표 · ${GOAL}`);
  assert.ok(screen.headerHtml.indexOf("hp-mission-completion") < screen.headerHtml.indexOf("hp-mission-goal"), "the goal line is not after the lesson's conditions");
  assert.ok(screen.headerHtml.indexOf("hp-mission-goal") < screen.headerHtml.indexOf("hp-mission-foot"), "the goal line is not above the steps remaining and the growth link");
  // The rail: the same goal, the personal criteria and the editor, closed by default.
  assert.ok(screen.goal.startsWith("내 목표와 완료 기준 보기·고치기"), screen.goal);
  assert.ok(screen.goal.includes(`내 목표 · ${GOAL}`), screen.goal);
  for (const c of CRITERIA) assert.ok(screen.goal.includes(c), `missing personal criterion ${c}`);
  assert.deepEqual(lessonCriteriaMissing(screen), []);
  for (const c of CRITERIA) assert.ok(!screen.header.includes(c), "a personal criterion was drawn as region A's");
  // The rehearsal read-back (LessonStepPanel drawnMission) reads region A's condition spans only.
  assert.equal((html.match(/hp-mission-completion-text/g) ?? []).length, week3.learning.completion.length);
  assert.equal((html.match(/class="[^"]*\bhp-cta-primary\b/g) ?? []).length, 1, "one Primary on the screen (SX-04)");
  const audit = auditRegionText(screen.text, { region: "work", minLength: 200 });
  assert.equal(audit.ok, true, JSON.stringify(audit.findings));
  // Negative control: the same check on a screen whose region A lost the lesson's conditions to the student's.
  const planted = html.replace(/<ul class="hp-mission-completion"[\s\S]*?<\/ul>/, `<ul class="hp-mission-completion">${CRITERIA.map((c) => `<li>${c}</li>`).join("")}</ul>`);
  assert.notEqual(planted, html, "the planted screen was not made");
  assert.deepEqual(lessonCriteriaMissing(screenOf(planted)), week3.learning.completion.map((c) => c.text));
  // Negative control: a header that dropped the goal line reads as no goal, so the first check above is not vacuous.
  const noLine = html.replace(/<p class="hp-mission-goal">[\s\S]*?<\/p>/, "");
  assert.notEqual(noLine, html, "the planted header was not made");
  assert.equal(screenOf(noLine).headerGoal, null);
});

await test("screen: every chat view and every remount draws the same goal from the host (sidebar, editor tab, reconnect)", async () => {
  // Both chat views render the same component from the same host messages; the editor tab is where the preview
  // (the result) opens beside it. A remount starts from config, so the view after a reconnect is the same render.
  const sidebar = screenOf(await renderComponent("ChatPanel", withGoal(storedView)));
  const editor = screenOf(await renderComponent("ChatPanel", withGoal(structuredClone(storedView))));
  assert.equal(editor.goal, sidebar.goal);
  assert.equal(editor.header, sidebar.header);
  assert.equal(editor.headerGoal, `내 목표 · ${GOAL}`);
  // Negative control: a remount that started from nothing (the goal kept only in the webview) would lose it.
  const forgetful = screenOf(await renderComponent("ChatPanel", withGoal(null)));
  assert.equal(forgetful.headerGoal, null, "no goal, no line in region A (nothing invented)");
  assert.ok(forgetful.goal.startsWith("내 목표와 완료 기준 적기"), forgetful.goal);
  assert.ok(forgetful.goal.includes("내 목표 · 아직 적지 않았어요"));
  assert.notEqual(forgetful.goal, sidebar.goal);
});

await test("screen: another lesson's goal is not drawn, and an empty goal still leaves the lesson's criteria whole", async () => {
  const otherRevision = { ...storedView, lesson: { ...storedView.lesson, version: LESSON_A2.version, sha256: LESSON_A2.sha256 } };
  const screen = screenOf(await renderComponent("ChatPanel", withGoal(otherRevision)));
  assert.ok(!screen.text.includes(GOAL), "another revision's goal was drawn");
  assert.equal(screen.headerGoal, null, "another revision's goal reached region A");
  assert.ok(screen.goal.includes("아직 적지 않았어요"));
  assert.deepEqual(lessonCriteriaMissing(screen), [], "lesson criteria must not depend on the student's goal");
  const emptied = screenOf(await renderComponent("ChatPanel", withGoal({ ...storedView, goal: "", criteria: [], revision: 9 })));
  assert.deepEqual(lessonCriteriaMissing(emptied), []);
  assert.ok(emptied.goal.includes("아직 내가 정한 완료 기준이 없어요."));
});

await test("screen: the goal block offers no completion — no check mark, no completion button, nothing pressed by opening it", async () => {
  const { goal, goalHtml, headerGoalHtml } = screenOf(await renderComponent("ChatPanel", withGoal(storedView)));
  const completionMarks = (html) => [/☑/.test(html), /완료하기|마쳤어요|제출/.test(visibleText(html)), /hp-cta-primary/.test(html)];
  assert.deepEqual(completionMarks(goalHtml), [false, false, false]);
  assert.ok(headerGoalHtml, "region A's goal line is not drawn — the check below proves nothing");
  assert.deepEqual(completionMarks(headerGoalHtml), [false, false, false], "region A's goal line carries a mark or a button");
  assert.doesNotMatch(headerGoalHtml, /<button|data-met/);
  assert.ok(goal.includes("목표를 적거나 고쳐도 과제가 완료되지는 않아요."));
  assert.match(goalHtml, /^<details class="hp-rail-lesson hp-goal"[^>]*>/, "closed by default: no open attribute");
  assert.doesNotMatch(goalHtml.slice(0, goalHtml.indexOf(">")), /\bopen\b/);
  // Negative control: the same detector on a block that ticks a criterion off and offers to complete.
  const planted = goalHtml.replace("<li>", "<li>☑ ").replace("</form>", '<button class="hp-cta-primary">이 과제 완료하기</button></form>');
  assert.deepEqual(completionMarks(planted), [true, true, true]);
});

await test("screen: an instructor's chat has no student goal block", async () => {
  const html = await renderComponent("ChatPanel", withGoal(storedView, { instructor: true }));
  assert.ok(!html.includes("hp-goal") && !html.includes("hp-mission-goal") && !html.includes(GOAL));
  assert.ok(html.includes("hps-messages"), "the instructor render is not empty");
});

console.log(`PASS student-goal: ${passed} checks — rules, host save and config, rendered chat screen`);
