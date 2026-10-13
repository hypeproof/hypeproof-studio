// AE-01 (#554) — the student's own goal and completion criteria kept beside the lesson's criteria.
// Packet `goal` (config/requirement-work.json):
//   positive  after a goal change, the chat screens show the same new goal and the lesson's original criteria, also
//             after a reconnect (a fresh host over the same device storage) and in every chat view the host posts to;
//   negative  a student edit cannot remove a lesson criterion; another lesson's (or revision's, or activity's) goal is
//             never restored; viewing or saving a goal records no completion.
// Three layers: the pure rules (src/studentGoal.ts, which the screen also uses to decide what a save sends and which
// view shows an answer), the real host handler and config path (src/chatPanelProvider.ts, bundled, driven through a
// stand-in host as test/activity-draft.smoke.mjs does, plus bundles carrying one planted defect each), and the real
// rendered chat screen (webview-ui/src/ChatPanel.tsx and StudentGoal.tsx through the render instrument). A server
// render keeps no state, runs no effect and opens no block, so the screen over time (a lesson that arrives after the
// panel mounted, answers, another view's save reaching typed text, a reopen) is checked in the built webview in
// Chromium (e2e/sx/goal-browser.mjs, CI) and in the App (e2e/sx/goal-app.spec.ts). Every check that could pass
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
const REF_A = { course_id: LESSON_A.course_id, version: LESSON_A.version, sha256: LESSON_A.sha256 };
const ACT = "a".repeat(64);
const ACT_B = "b".repeat(64);
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
  for (const [label, lesson, activity] of [["another course", LESSON_B, ACT], ["a new revision of the course", LESSON_A2, ACT], ["another activity", LESSON_A, ACT_B], ["a seat without activity", LESSON_A, null]]) {
    const view = G.goalViewOf(lesson, activity, all);
    assert.deepEqual([view.goal, view.criteria, view.revision], ["", [], 0], `${label} showed A's goal`);
  }
  // A record copied under another lesson's key is refused, not shown as that lesson's goal.
  const record = all[G.goalScopeKey(REF_A, ACT)];
  const tampered = { [G.goalScopeKey({ course_id: LESSON_B.course_id, version: LESSON_B.version, sha256: LESSON_B.sha256 }, ACT)]: record };
  assert.equal(G.goalViewOf(LESSON_B, ACT, tampered).goal, "", "a copied record must not pass as B's goal");
  // ...and one filed under another activity's key is not that activity's goal.
  const crossFiled = { [G.goalScopeKey(REF_A, ACT_B)]: record };
  assert.equal(G.goalViewOf(LESSON_A, ACT_B, crossFiled).goal, "", "a record of activity A must not pass as activity B's goal");
  // Negative control: a lookup keyed by course alone (one goal per course) would hand A's goal to the new revision.
  const byCourse = (store, lesson) => Object.values(store).find((r) => r.lesson.course_id === lesson.course_id)?.goal ?? "";
  assert.equal(byCourse(all, LESSON_A2), GOAL, "the control must actually restore the old goal");
  assert.notEqual(byCourse(all, LESSON_A2), G.goalViewOf(LESSON_A2, ACT, all).goal);
  // Positive control: the same lesson and activity get the goal back.
  assert.equal(G.goalViewOf(LESSON_A, ACT, all).goal, GOAL);
  // Each revision keeps its own goal: a goal written under the new revision does not replace the old one's.
  const both = G.acceptGoalSave(LESSON_A2, ACT, { lesson: LESSON_A2.sha256, goal: "새 버전의 목표", criteria: [], base: 0 }, all, 2000).all;
  assert.deepEqual([G.goalViewOf(LESSON_A, ACT, both).goal, G.goalViewOf(LESSON_A2, ACT, both).goal], [GOAL, "새 버전의 목표"]);
  // Each activity keeps its own goal for the same lesson revision: a save under activity B does not replace A's.
  const twoActivities = G.acceptGoalSave(LESSON_A, ACT_B, { lesson: LESSON_A.sha256, goal: "다른 활동의 목표", criteria: ["다른 활동의 기준"], base: 0 }, all, 3000);
  assert.equal(twoActivities.ok, true);
  const [inA, inB] = [G.goalViewOf(LESSON_A, ACT, twoActivities.all), G.goalViewOf(LESSON_A, ACT_B, twoActivities.all)];
  assert.deepEqual([inA.goal, [...inA.criteria], inA.revision], [GOAL, CRITERIA, 1], "activity B's save replaced activity A's goal");
  assert.deepEqual([inB.goal, [...inB.criteria], inB.revision], ["다른 활동의 목표", ["다른 활동의 기준"], 1]);
  // Negative control: one slot per lesson revision (B's save written where A's goal is kept) reads as A's goal lost.
  const oneSlot = { ...all, [G.goalScopeKey(REF_A, ACT)]: twoActivities.record };
  assert.notEqual(G.goalViewOf(LESSON_A, ACT, oneSlot).goal, GOAL);
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
  assert.doesNotMatch(G.GOAL_CHANGED_ELSEWHERE, /\d/, "the other-screen sentence carries no number (SX-59)");
});

await test("rules: the screen keeps the newest goal of a lesson and follows the served lesson", () => {
  const v1 = G.goalViewOf(LESSON_A, ACT, save({}, LESSON_A).all);
  const v2 = { ...v1, goal: "새 목표", revision: 2 };
  assert.equal(G.acceptGoalView(v2, v1), v2, "an older config cannot put the earlier goal back after the save's answer");
  assert.equal(G.acceptGoalView(v1, v2), v2);
  const other = G.goalViewOf(LESSON_B, ACT, {});
  assert.equal(G.acceptGoalView(v2, other), other, "another lesson's view replaces the held one");
  assert.equal(G.acceptGoalView(v2, null), null);
  assert.equal(G.acceptGoalView(v2, undefined), v2, "an answer or config without a goal keeps what is shown");
  assert.equal(G.goalOfLesson(v2, LESSON_A), v2);
  assert.equal(G.goalOfLesson(v2, LESSON_A2), null, "a view of another revision is not drawn as this lesson's goal");
});

await test("rules: a save starts from the revision the fields were loaded from, and only when there is something new", () => {
  const before = save({}, LESSON_A).all;
  const v1 = G.goalViewOf(LESSON_A, ACT, before);
  const loaded = G.goalFieldsOf(v1);
  assert.deepEqual(loaded, { goal: GOAL, criteria: CRITERIA.join("\n"), base: 1 });
  assert.deepEqual(G.goalFieldsOf(null), { goal: "", criteria: "", base: 0 });
  const edit = (fields, view = v1, pending = false) => G.goalEditOf(view, LESSON_A.sha256, fields, pending);
  // Nothing new: no request. Spaces around the text and blank lines are not a change.
  assert.deepEqual([edit(loaded).save, edit(loaded).unchanged], [null, true]);
  assert.equal(edit({ ...loaded, goal: `  ${GOAL}  `, criteria: `${CRITERIA[0]}\n\n  ${CRITERIA[1]} ` }).save, null);
  // A change: the request carries the fields' own revision as its base and the criteria one per line.
  const changed = { ...loaded, goal: "새 목표", criteria: `${CRITERIA[0]}\n바뀐 기준` };
  assert.deepEqual(edit(changed).save, { lesson: LESSON_A.sha256, goal: "새 목표", criteria: [CRITERIA[0], "바뀐 기준"], base: 1 });
  assert.equal(G.acceptGoalSave(LESSON_A, ACT, edit(changed).save, before, 2000).ok, true, "the host accepts what the editor sends");
  // Past the bounds the host refuses, or while this view's earlier save is unanswered: no request.
  const six = edit({ ...changed, criteria: "1\n2\n3\n4\n5\n6" });
  assert.deepEqual([six.save, six.tooMany], [null, true]);
  assert.notEqual(edit({ ...changed, criteria: "1\n2\n3\n4\n5" }).save, null, "five criteria are allowed");
  const long = edit({ ...changed, criteria: "x".repeat(G.GOAL_CRITERION_MAX + 1) });
  assert.deepEqual([long.save, long.tooLong], [null, true]);
  assert.equal(edit(changed, v1, true).save, null, "a second save while the first is unanswered");
  // Another view saved revision 2 while these fields still hold revision 1's text: the save is sent from revision 1 and
  // the host refuses it as stale, instead of letting it replace the other view's goal.
  const after = G.acceptGoalSave(LESSON_A, ACT, { lesson: LESSON_A.sha256, goal: "다른 화면의 목표", criteria: [], base: 1 }, before, 2000).all;
  const v2 = G.goalViewOf(LESSON_A, ACT, after);
  const leftover = edit(changed, v2).save;
  assert.equal(leftover.base, 1);
  assert.deepEqual(G.acceptGoalSave(LESSON_A, ACT, leftover, after, 3000), { ok: false, code: "stale" });
  // Negative control: an edit that took the newest goal's revision as its base would silently replace that save.
  assert.equal(G.acceptGoalSave(LESSON_A, ACT, { ...leftover, base: v2.revision }, after, 3000).ok, true);
  // Fields reloaded from revision 2 save normally.
  assert.equal(G.acceptGoalSave(LESSON_A, ACT, edit({ ...G.goalFieldsOf(v2), goal: "다시 고친 목표" }, v2).save, after, 3000).ok, true);
});

await test("rules: another view's save keeps text typed here, untouched fields follow, and the next save starts from it", () => {
  let all = save({}, LESSON_A).all;
  const v1 = G.goalViewOf(LESSON_A, ACT, all);
  const loaded = G.goalEditorOf(v1);
  assert.deepEqual([loaded.fields, loaded.from, loaded.elsewhere], [{ goal: GOAL, criteria: CRITERIA.join("\n"), base: 1 }, v1, false]);
  // Another chat view saves revision 2: a new goal sentence and new criteria.
  all = G.acceptGoalSave(LESSON_A, ACT, { lesson: LESSON_A.sha256, goal: "다른 화면의 목표", criteria: ["다른 화면의 기준"], base: 1 }, all, 2000).all;
  const v2 = G.goalViewOf(LESSON_A, ACT, all);
  // Untouched fields follow it, text and revision, and nothing is said.
  const followed = G.goalEditorOnView(loaded, v2, false);
  assert.deepEqual([followed.fields, followed.elsewhere], [G.goalFieldsOf(v2), false]);
  // Typed in the goal field: that text stays, the untouched criteria field follows, the base moves, the screen says so.
  const typing = G.goalEditorOnEdit(loaded, { goal: "  여기서 적던 목표 " });
  assert.equal(typing.elsewhere, false, "typing alone says nothing about another screen");
  const kept = G.goalEditorOnView(typing, v2, false);
  assert.deepEqual([kept.fields, kept.elsewhere], [{ goal: "  여기서 적던 목표 ", criteria: "다른 화면의 기준", base: 2 }, true]);
  // ...and the other way round: typed criteria stay, the untouched goal follows.
  const criteriaTyped = G.goalEditorOnView(G.goalEditorOnEdit(loaded, { criteria: "여기서 적던 기준" }), v2, false);
  assert.deepEqual([criteriaTyped.fields, criteriaTyped.elsewhere], [{ goal: "다른 화면의 목표", criteria: "여기서 적던 기준", base: 2 }, true]);
  // The save made after the sentence starts from revision 2: the host stores it as revision 3.
  const after = G.goalEditOf(v2, LESSON_A.sha256, kept.fields, false).save;
  assert.deepEqual(after, { lesson: LESSON_A.sha256, goal: "  여기서 적던 목표 ", criteria: ["다른 화면의 기준"], base: 2 });
  const stored = G.acceptGoalSave(LESSON_A, ACT, after, all, 3000);
  assert.deepEqual([stored.ok, stored.record.goal, stored.record.revision], [true, "여기서 적던 목표", 3]);
  // Negative controls: an editor that replaces its fields drops the typed text; one that keeps the text but not the base
  // sends a save the host refuses as stale every time, so the student could never save it.
  assert.notEqual(G.goalEditorOf(v2).fields.goal, typing.fields.goal, "the control must actually drop the typed text");
  const stuck = G.goalEditOf(v2, LESSON_A.sha256, { ...kept.fields, base: 1 }, false).save;
  assert.deepEqual(G.acceptGoalSave(LESSON_A, ACT, stuck, all, 3000), { ok: false, code: "stale" });
  // Typing back what the goal now is: nothing left to say and nothing to save.
  const reverted = G.goalEditorOnEdit(kept, { goal: "다른 화면의 목표" });
  assert.deepEqual([reverted.elsewhere, G.goalEditOf(v2, LESSON_A.sha256, reverted.fields, false).save], [false, null]);
  // This view's own save: fields that hold what it stored take it as stored (spaces gone), nothing is said; text typed
  // after pressing save stays, still nothing said, and the next save starts from the stored revision.
  const v3 = G.goalViewOf(LESSON_A, ACT, stored.all);
  const own = G.goalEditorOnView(kept, v3, true);
  assert.deepEqual([own.fields, own.elsewhere], [G.goalFieldsOf(v3), false]);
  const more = G.goalEditorOnView(G.goalEditorOnEdit(kept, { goal: "여기서 적던 목표 더" }), v3, true);
  assert.deepEqual([more.fields.goal, more.fields.base, more.elsewhere], ["여기서 적던 목표 더", 3, false]);
  // Negative control: the same answer treated as another screen's would say so.
  assert.equal(G.goalEditorOnView(G.goalEditorOnEdit(kept, { goal: "여기서 적던 목표 더" }), v3, false).elsewhere, true);
  // A goal no newer than the one the fields stand on (a repeated config, a stale refusal's goal) changes nothing.
  assert.equal(G.goalEditorOnView(kept, v2, false), kept);
  assert.equal(G.goalEditorOnView(kept, v1, false), kept);
  // Another revision of the lesson, another activity or no goal: the editor starts over and the typed text stays behind.
  for (const next of [G.goalViewOf(LESSON_A2, ACT, all), G.goalViewOf(LESSON_A, ACT_B, all), null]) {
    const fresh = G.goalEditorOnView(kept, next, false);
    assert.deepEqual([fresh.fields, fresh.elsewhere], [G.goalFieldsOf(next), false], JSON.stringify(next?.lesson ?? null));
  }
});

await test("rules: only the view whose save an answer names shows its note; ids are echoed only when plain", () => {
  const v1 = G.goalViewOf(LESSON_A, ACT, save({}, LESSON_A).all);
  const stored = { view: v1, saved: true, requestId: "kq1-abc" };
  assert.deepEqual(G.goalNoteFor(stored, "kq1-abc"), { saved: true, revision: 1 });
  assert.equal(G.goalNoteFor(stored, "zz9-other"), undefined, "another view's save gives this view no note");
  assert.equal(G.goalNoteFor(stored, null), undefined, "no save pending: no note");
  assert.equal(G.goalNoteFor({ view: v1, saved: true }, "kq1-abc"), undefined, "an answer naming no save is no view's");
  assert.deepEqual(G.goalNoteFor({ error: "거절", requestId: "kq1-abc" }, "kq1-abc"), { error: "거절" });
  // "저장했어요." describes the revision it stored, while the fields still hold it.
  const note = G.goalNoteFor(stored, "kq1-abc");
  const shown = (view, fields) => G.goalSavedNoteShown(note, view, G.goalEditOf(view, LESSON_A.sha256, fields, false));
  assert.equal(shown(v1, G.goalFieldsOf(v1)), true);
  assert.equal(shown(v1, { ...G.goalFieldsOf(v1), goal: "더 고치는 중" }), false, "the fields changed after the save");
  const v2 = { ...v1, goal: "다른 화면의 목표", revision: 2 };
  assert.equal(shown(v2, G.goalFieldsOf(v2)), false, "another view's later save is not this view's");
  // Request ids: echoed when plain, dropped otherwise.
  assert.equal(G.goalRequestIdOf({ requestId: "lx2k9-4f0q1z" }), "lx2k9-4f0q1z");
  for (const bad of ["", "x".repeat(65), "<b>", "a b", 7, null]) assert.equal(G.goalRequestIdOf({ requestId: bad }), undefined, JSON.stringify(bad));
  assert.equal(G.goalRequestIdOf(null), undefined);
});

// ─── 2. The real host: the save handler and the config every mount and reconnect starts from ──────────

const require = createRequire(import.meta.url);
const vscode = { workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }) }, env: { appName: "HypeProof Studio" } };
/**
 * The real provider, bundled from source. `plant` (optional) replaces one piece of one source file first: a planted
 * defect in the real handler. The piece must be found, or the control would run the unchanged code.
 */
async function hostModule(plant) {
  const plugins = plant
    ? [{
        name: "plant",
        setup(b) {
          b.onLoad({ filter: plant.file }, (args) => {
            const src = fs.readFileSync(args.path, "utf8");
            assert.equal(src.split(plant.from).length, 2, `planted defect "${plant.what}": the code to replace is not in ${args.path} exactly once`);
            return { contents: src.replace(plant.from, plant.to), loader: "ts" };
          });
        },
      }]
    : [];
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
    plugins,
  });
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports, require: (id) => (id === "vscode" ? vscode : require(id)),
    process, console, URL, Buffer, crypto: globalThis.crypto, AbortSignal, TextEncoder, TextDecoder, setTimeout, clearTimeout,
  });
  return module.exports;
}
const { ActivityConnections, ChatPanelProvider } = await hostModule();
const proto = ChatPanelProvider.prototype;

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hps-goal-"));
/** One folder's workspaceState, shared by every host below (a reconnect reads the same device storage). */
const states = new Map();
const secrets = new Map();
let failWrites = false;
const raw = (dir, store = states) => ({
  globalStorageUri: { fsPath: path.join(dir, "storage") },
  workspaceState: { get: (k, d) => (store.has(k) ? store.get(k) : d), update: async (k, v) => { if (failWrites) throw Error("synthetic write failure"); store.set(k, v); } },
  secrets: { keys: async () => [...secrets.keys()], get: async (k) => secrets.get(k), store: async (k, v) => secrets.set(k, v), delete: async (k) => secrets.delete(k) },
});

/** A stand-in host for one App session: the provider's own methods over these fields. Side effects are recorded. */
function makeHost(context, profile, provider = proto) {
  const effects = [];
  const posts = [];
  const host = {
    context,
    cachedProfile: profile,
    goalWrites: Promise.resolve(),
    saveGoal: provider.saveGoal,
    draftWrites: Promise.resolve(),
    loadAccess: async () => {},
    applyPendingFundingSelection: proto.applyPendingFundingSelection,
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

/**
 * Two chat views saving from the same revision, through a host built from `module` on its own storage: a first save
 * makes revision 1, then both views save from it at once. Returns which answers said "saved", in the order they came,
 * and the goal stored at the end.
 */
async function twoViewsSave(module) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hps-goal-two-"));
  try {
    const store = new Map();
    const conn = new module.ActivityConnections(raw(dir, store), () => "https://synthetic.invalid/v1", () => dir, async () => profileA);
    await conn.commit("synthetic-credential", { activity_id: ACT, display_name: "Synthetic" }, dir);
    const { host, posts } = makeHost(conn.wrap(), profileA, module.ChatPanelProvider.prototype);
    const send = (goal, base, requestId) => module.ChatPanelProvider.prototype.handleMessage.call(host, { type: "goalSave", activityId: conn.scope, lesson: LESSON_A.sha256, goal, criteria: [], base, requestId });
    await send(GOAL, 0, "first-0");
    posts.length = 0;
    await Promise.all([send("첫 화면의 목표", 1, "view-1"), send("둘째 화면의 목표", 1, "view-2")]);
    const answers = goalStates(posts);
    return {
      saved: answers.map((a) => a.saved === true),
      order: answers.map((a) => a.requestId),
      goal: G.goalViewOf(LESSON_A, conn.scope, store.get(G.STUDENT_GOAL_KEY)).goal,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

try {
  await test("host: a save is stored for this lesson and activity and every chat view gets the same goal", async () => {
    const { host, posts } = makeHost(ctxA, profileA);
    await proto.handleMessage.call(host, { type: "goalSave", activityId: connA.scope, lesson: LESSON_A.sha256, goal: GOAL, criteria: CRITERIA, base: 0, requestId: "kq1-first" });
    const [answer] = goalStates(posts);
    assert.equal(answer.saved, true);
    assert.equal(answer.view.goal, GOAL);
    assert.deepEqual([...answer.view.criteria], CRITERIA, "the host's view carries the criteria as saved");
    assert.equal(answer.view.activity, connA.scope);
    const stored = states.get(G.STUDENT_GOAL_KEY);
    assert.deepEqual(Object.values(stored).map((r) => [r.goal, r.revision]), [[GOAL, 1]]);
    // The provider's `post` goes to the sidebar view and the editor chat alike. The answer names the save it answers,
    // so only the view that sent it shows "저장했어요."; every view takes the goal.
    assert.equal(answer.requestId, "kq1-first");
    assert.equal(G.goalNoteFor(answer, "kq1-first")?.saved, true);
    assert.equal(G.goalNoteFor(answer, "other-view"), undefined);
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

  await test("host: refused saves store nothing, say why, and leave every screen's goal as it is (only stale brings the newer one)", async () => {
    const before = JSON.stringify(states.get(G.STUDENT_GOAL_KEY));
    const held = G.goalViewOf(LESSON_A, connA.scope, states.get(G.STUDENT_GOAL_KEY));
    const refused = async (msg, profile = profileA) => {
      const { host, posts } = makeHost(ctxA, profile);
      await proto.handleMessage.call(host, { type: "goalSave", activityId: connA.scope, ...msg });
      const answers = goalStates(posts);
      assert.equal(answers.length, 1);
      return answers[0];
    };
    // Stale: the save lost to a newer goal, which the answer brings so the student re-edits from it.
    const stale = await refused({ lesson: LESSON_A.sha256, goal: "다른 화면의 예전 목표", criteria: [], base: 0, requestId: "kq1-stale" });
    assert.deepEqual([stale.error, stale.requestId, stale.view.goal, stale.view.revision], [G.GOAL_REFUSAL_SENTENCES.stale, "kq1-stale", GOAL, 1]);
    // Every other refusal carries no goal: the screen keeps the goal it shows, and so the fields keep the typed text.
    const otherLesson = await refused({ lesson: LESSON_B.sha256, goal: "수업 B 목표", criteria: [], base: 1, requestId: "<b>" });
    assert.equal(otherLesson.error, G.GOAL_REFUSAL_SENTENCES.other_lesson);
    assert.equal("view" in otherLesson, false, "a refusal put a goal on the screens");
    assert.equal("requestId" in otherLesson, false, "a malformed request id was echoed");
    failWrites = true;
    let notStored;
    try {
      notStored = await refused({ lesson: LESSON_A.sha256, goal: "저장 실패", criteria: [], base: 1, requestId: "kq1-write" });
    } finally {
      failWrites = false;
    }
    assert.deepEqual([notStored.error, notStored.requestId, "view" in notStored], [G.GOAL_REFUSAL_SENTENCES.not_stored, "kq1-write", false]);
    // The App lost its lesson (a failed profile refresh leaves no profile at hand) while the screen still draws lesson A.
    const noLesson = await refused({ lesson: LESSON_A.sha256, goal: "고친 목표", criteria: ["기준"], base: 1, requestId: "kq1-nolesson" }, null);
    assert.deepEqual([noLesson.error, "view" in noLesson], [G.GOAL_REFUSAL_SENTENCES.no_lesson, false]);
    assert.equal(G.acceptGoalView(held, noLesson.view), held, "the screen keeps lesson A's goal (and its fields the typed text)");
    // Negative control: an answer carrying the host's goal for "no lesson" (null) would wipe the screen's goal.
    const wiping = G.goalViewOf(undefined, connA.scope, states.get(G.STUDENT_GOAL_KEY));
    assert.equal(wiping, null);
    assert.equal(G.acceptGoalView(held, wiping), null);
    // A message from another activity's view is dropped by the handler's activity guard: no answer, nothing stored.
    const { host, posts } = makeHost(ctxA, profileA);
    await proto.handleMessage.call(host, { type: "goalSave", activityId: "c".repeat(64), lesson: LESSON_A.sha256, goal: "다른 활동", criteria: [], base: 1 });
    assert.deepEqual(posts, []);
    assert.equal(JSON.stringify(states.get(G.STUDENT_GOAL_KEY)), before);
  });

  await test("host: two views saving from the same revision — exactly one is stored, the other refused, answers in order", async () => {
    const { host, posts } = makeHost(ctxA, profileA);
    await Promise.all([
      proto.handleMessage.call(host, { type: "goalSave", activityId: connA.scope, lesson: LESSON_A.sha256, goal: "첫 화면의 목표", criteria: [], base: 1, requestId: "view-1" }),
      proto.handleMessage.call(host, { type: "goalSave", activityId: connA.scope, lesson: LESSON_A.sha256, goal: "둘째 화면의 목표", criteria: [], base: 1, requestId: "view-2" }),
    ]);
    const answers = goalStates(posts);
    assert.deepEqual(answers.map((a) => [a.requestId, a.saved === true]), [["view-1", true], ["view-2", false]]);
    assert.equal(answers[1].error, G.GOAL_REFUSAL_SENTENCES.stale);
    assert.equal(G.goalViewOf(LESSON_A, connA.scope, states.get(G.STUDENT_GOAL_KEY)).goal, "첫 화면의 목표");
    // Which part does what, shown with one planted defect each in the real handler (same procedure, own storage). The
    // revision check refuses the second save: without it both are stored and the first view's goal is silently
    // replaced. The queue only keeps the answers in the order the saves were sent: without it one save is still
    // refused, and the answers come back the other way round.
    assert.deepEqual(await twoViewsSave({ ActivityConnections, ChatPanelProvider }), { saved: [true, false], order: ["view-1", "view-2"], goal: "첫 화면의 목표" });
    const noRevisionCheck = await twoViewsSave(await hostModule({
      what: "the revision check removed", file: /src[\\/]studentGoal\.ts$/,
      from: 'if (msg.base !== (stored?.revision ?? 0)) return { ok: false, code: "stale" };', to: "",
    }));
    assert.deepEqual(noRevisionCheck, { saved: [true, true], order: ["view-1", "view-2"], goal: "둘째 화면의 목표" });
    const noQueue = await twoViewsSave(await hostModule({
      what: "the save queue removed", file: /src[\\/]chatPanelProvider\.ts$/,
      from: "const save = this.goalWrites.then(() => this.saveGoal(msg));", to: "const save = this.saveGoal(msg);",
    }));
    assert.deepEqual(noQueue, { saved: [false, true], order: ["view-2", "view-1"], goal: "첫 화면의 목표" });
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
const GOAL_BLOCK = /<details class="hp-rail-goal hp-goal"[\s\S]*?<\/details>/;
/** What a criterion check reads: each lesson criterion's words, and the student's own block apart from region A. */
function screenOf(html) {
  const text = visibleText(html);
  const header = /<header class="hp-mission"[\s\S]*?<\/header>/.exec(html)?.[0] ?? "";
  const goalBlock = GOAL_BLOCK.exec(html)?.[0] ?? "";
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
/**
 * What scripts that drive the chat by its first field or its first rail card meet (e2e/classroom/ops-lesson-settings.mjs
 * takes the first textarea as the composer, e2e/lesson-studio/mac.mjs the first `.hp-rail-lesson` as the lesson card).
 */
function layoutProblem(html) {
  const goalBlock = /<details class="(?:[^"]*\s)?hp-goal(?:\s[^"]*)?"[\s\S]*?<\/details>/.exec(html);
  const problems = [];
  if (!goalBlock) return "the goal block is not drawn — the check proves nothing";
  if (/<(textarea|input|select)\b/.test(goalBlock[0])) problems.push("the closed goal block puts a field on the screen");
  const firstField = /<(textarea|input|select)\b/.exec(html);
  if (firstField && firstField.index > goalBlock.index && firstField.index < goalBlock.index + goalBlock[0].length) problems.push("the screen's first field is the goal editor's");
  const firstRail = /<(\w+) class="(?:[^"]*\s)?hp-rail-lesson(?:\s[^"]*)?"[^>]*>(?:<summary>([^<]*))?/.exec(html);
  if (!firstRail?.[2]?.startsWith("이번 단계 안내")) problems.push(`the first .hp-rail-lesson is not the lesson card: ${JSON.stringify(firstRail?.[0])}`);
  return problems.length ? problems.join("; ") : null;
}

await test("screen: the chat shows the saved goal and criteria beside the lesson's untouched criteria", async () => {
  const html = await renderComponent("ChatPanel", withGoal(storedView));
  const screen = screenOf(html);
  // Region A, fixed with the header: the goal, after the lesson's own conditions.
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

await test("screen: the closed goal block adds no field, and the first .hp-rail-lesson is still the lesson card", async () => {
  for (const view of [storedView, null]) {
    const html = await renderComponent("ChatPanel", withGoal(view));
    assert.equal(layoutProblem(html), null, `with ${view ? "a" : "no"} goal`);
  }
  // Negative controls: the editor drawn while the block is closed, and the block under the lesson card's class name
  // (both as this block first shipped) must each be reported.
  const html = await renderComponent("ChatPanel", withGoal(storedView));
  const withEditor = html.replace(/(<details class="hp-rail-goal hp-goal"[^>]*><summary>[^<]*<\/summary>)/, '$1<form class="hp-goal-form"><textarea></textarea></form>');
  assert.notEqual(withEditor, html, "the planted editor was not made");
  assert.match(layoutProblem(withEditor) ?? "", /puts a field on the screen.*first field is the goal editor's/);
  const lessonClass = html.replace('<details class="hp-rail-goal hp-goal"', '<details class="hp-rail-lesson hp-goal"');
  assert.notEqual(lessonClass, html, "the planted class was not made");
  assert.match(layoutProblem(lessonClass) ?? "", /first \.hp-rail-lesson is not the lesson card/);
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

await test("screen: a goal only the config carries (revision 2, no save answered) is drawn — the panel reads config on every render", async () => {
  // A server render holds no answer: what is drawn here can only come from `config`. The same panel over time (mounted
  // before its lesson arrived, then given a config under the same key) is e2e/sx/goal-browser.mjs.
  const two = G.acceptGoalSave(LESSON_A, ACT, { lesson: LESSON_A.sha256, goal: "두 번째로 고친 목표", criteria: ["두 번째 기준"], base: 1 }, save({}, LESSON_A).all, 2000).all;
  const v2 = G.goalViewOf(LESSON_A, ACT, two);
  assert.equal(v2.revision, 2);
  const screen = screenOf(await renderComponent("ChatPanel", withGoal(v2)));
  assert.equal(screen.headerGoal, "내 목표 · 두 번째로 고친 목표");
  assert.ok(screen.goal.includes("내 목표 · 두 번째로 고친 목표") && screen.goal.includes("두 번째 기준"), screen.goal);
  assert.match(screen.goalHtml, /^<details class="hp-rail-goal hp-goal" data-student-goal="2"/, "the block does not stand on revision 2");
  // Negative control: the same verdicts on a screen drawn from no config goal report it missing.
  const none = screenOf(await renderComponent("ChatPanel", withGoal(null)));
  assert.deepEqual([none.headerGoal, /data-student-goal="0"/.test(none.goalHtml)], [null, true]);
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

await test("screen: the goal block and its editor offer no completion — no check mark, no completion button", async () => {
  const { goal, goalHtml, headerGoalHtml } = screenOf(await renderComponent("ChatPanel", withGoal(storedView)));
  const editorHtml = await renderComponent("GoalEditor", { fields: G.goalFieldsOf(storedView), edit: G.goalEditOf(storedView, LESSON_A.sha256, { ...G.goalFieldsOf(storedView), goal: "새 목표" }, false), onEdit() {}, onSave() {} });
  const completionMarks = (html) => [/☑/.test(html), /완료하기|마쳤어요|제출/.test(visibleText(html)), /hp-cta-primary/.test(html)];
  assert.deepEqual(completionMarks(goalHtml), [false, false, false]);
  assert.deepEqual(completionMarks(editorHtml), [false, false, false]);
  assert.ok(headerGoalHtml, "region A's goal line is not drawn — the check below proves nothing");
  assert.deepEqual(completionMarks(headerGoalHtml), [false, false, false], "region A's goal line carries a mark or a button");
  assert.doesNotMatch(headerGoalHtml, /<button|data-met/);
  assert.ok(goal.includes("목표를 적거나 고쳐도 과제가 완료되지는 않아요."));
  assert.match(goalHtml, /^<details class="hp-rail-goal hp-goal"[^>]*>/, "closed by default: no open attribute");
  assert.doesNotMatch(goalHtml.slice(0, goalHtml.indexOf(">")), /\bopen\b/);
  // Negative control: the same detector on a block that ticks a criterion off and offers to complete.
  const planted = goalHtml.replace("<li>", "<li>☑ ").replace("</details>", '<button class="hp-cta-primary">이 과제 완료하기</button></details>');
  assert.deepEqual(completionMarks(planted), [true, true, true]);
});

await test("screen: the open editor holds the stored goal and saves only a change, with one quiet button", async () => {
  const fields = G.goalFieldsOf(storedView);
  const render = (f, pending = false) => renderComponent("GoalEditor", { fields: f, edit: G.goalEditOf(storedView, LESSON_A.sha256, f, pending), onEdit() {}, onSave() {} });
  /** The save button's disabled attribute (true: cannot be pressed), or null when there is no such button. */
  const disabled = (html) => {
    const m = /<button type="submit" class="hp-cta-quiet"( disabled="")?>목표 저장<\/button>/.exec(html);
    return m ? !!m[1] : null;
  };
  const same = await render(fields);
  assert.match(same, new RegExp(`<textarea maxLength="${G.GOAL_TEXT_MAX}" rows="2">${GOAL}</textarea>`), "the goal field does not hold the stored goal");
  assert.ok(same.includes(`<textarea rows="3">${CRITERIA.join("\n")}</textarea>`), "the criteria field does not hold the stored criteria");
  assert.equal(disabled(same), true, "nothing changed, yet the save button can be pressed");
  assert.equal(disabled(await render({ ...fields, goal: "새 목표" })), false, "a change cannot be saved");
  assert.equal(disabled(await render({ ...fields, goal: "새 목표" }, true)), true, "a second save while the first is unanswered");
  const six = await render({ ...fields, criteria: "1\n2\n3\n4\n5\n6" });
  assert.equal(disabled(six), true);
  assert.ok(visibleText(six).includes("다섯 줄까지만 저장할 수 있어요."));
  // Negative control: the detector does see a button that can be pressed.
  assert.equal(disabled(same.replace(' disabled=""', "")), false);
});

await test("screen: this view's answer — a refusal as an alert, '저장했어요.' only for the revision it stored", async () => {
  const props = (note) => ({ lesson: LESSON_A, view: storedView, note, pending: false, onSave() {} });
  const errorLine = (html) => /<p class="hp-goal-error" role="alert">([^<]*)<\/p>/.exec(html)?.[1] ?? null;
  const savedLine = (html) => /<p class="hp-rail-lesson-note" role="status">저장했어요\.<\/p>/.test(html);
  for (const code of ["stale", "no_lesson", "other_lesson", "not_stored"]) {
    const html = await renderComponent("StudentGoal", props({ error: G.GOAL_REFUSAL_SENTENCES[code] }));
    assert.deepEqual([errorLine(html), savedLine(html)], [G.GOAL_REFUSAL_SENTENCES[code], false], code);
  }
  const saved = await renderComponent("StudentGoal", props({ saved: true, revision: storedView.revision }));
  assert.deepEqual([errorLine(saved), savedLine(saved)], [null, true]);
  assert.equal(savedLine(await renderComponent("StudentGoal", props({ saved: true, revision: storedView.revision - 1 }))), false, "a note about an earlier revision");
  const none = await renderComponent("StudentGoal", props(null));
  assert.deepEqual([errorLine(none), savedLine(none)], [null, false]);
  // Negative controls: a block that dropped the refusal line, or the saved line, reads as without it.
  const refused = await renderComponent("StudentGoal", props({ error: G.GOAL_REFUSAL_SENTENCES.stale }));
  assert.equal(errorLine(refused.replace(/<p class="hp-goal-error"[^>]*>[^<]*<\/p>/, "")), null);
  assert.equal(savedLine(saved.replace("저장했어요.", "")), false);
});

await test("screen: an instructor's chat has no student goal block", async () => {
  const html = await renderComponent("ChatPanel", withGoal(storedView, { instructor: true }));
  assert.ok(!html.includes("hp-goal") && !html.includes("hp-mission-goal") && !html.includes(GOAL));
  assert.ok(html.includes("hps-messages"), "the instructor render is not empty");
});

console.log(`PASS student-goal: ${passed} checks — rules, host save and config, rendered chat screen`);
