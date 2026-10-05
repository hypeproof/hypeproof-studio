// AE-01 (#554) — the student's own goal and completion criteria for the lesson they are working in, kept beside the
// lesson's own criteria and never mixed into them.
//
// Two values with two owners (docs/requirements/learning-agent-experience.md AE-01, ledger packet `goal`):
//   lesson criteria  the frozen lesson revision's own wording: its objective, the week's completion conditions and each
//                    step's acceptance. The Service serves them (`profile.lesson`, addressed by sha256) and the screen
//                    draws them from the profile as before. Nothing here stores, copies or edits them, so no student
//                    edit can remove one.
//   student goal     the student's goal sentence and personal completion criteria. Only the student edits them. They are
//                    kept on this device per lesson revision and activity and come back on every mount and reconnect.
//
// Pure: no vscode and no Node built-ins, so the host, the webview and the tests share one rule (same convention as
// lessonFocus.ts).
//
// Storage is VS Code workspaceState, like the lesson work surfaces (`hps.lessonWork`, #751 G2) and the activity draft:
// device-local working state. It is not a learning event (SX-47) or an observation store (SX-48), nothing here is sent
// to the Service, and saving or viewing a goal records no completion and moves no task phase (AE-01: "과제 열람만으로
// 완료되지 않는다").

export const STUDENT_GOAL_KEY = "hps.studentGoal";
export const STUDENT_GOAL_SCHEMA = "hps-student-goal/1";
/** Bounds the screen's fields also enforce (`maxLength`); a message past them is refused, never cut. */
export const GOAL_TEXT_MAX = 300;
export const GOAL_CRITERION_MAX = 200;
export const GOAL_CRITERIA_MAX = 5;

/** The lesson revision a goal belongs to. A new revision of the same course is a new task (`learningTaskIdOf`), so it starts without one. */
export interface GoalLessonRef {
  course_id: string;
  version: string;
  sha256: string;
}

/** What is stored, one per lesson revision and activity. */
export interface StudentGoalRecord {
  schema: typeof STUDENT_GOAL_SCHEMA;
  lesson: GoalLessonRef;
  /** The activity the seat is bound to, or null on a seat without activity connections. */
  activity: string | null;
  goal: string;
  criteria: string[];
  /** 1 for the first save, then +1 per save. A save made from an older revision is refused (`stale`). */
  revision: number;
  saved_at: number;
}

/** What the screen is sent: the stored record for this lesson and activity, or an empty goal at revision 0. */
export interface StudentGoalView {
  lesson: GoalLessonRef;
  activity: string | null;
  goal: string;
  criteria: string[];
  revision: number;
  saved_at: number | null;
}

/** What the webview sends: the lesson it drew the form under, the edit, and the revision it started from. */
export interface GoalSaveRequest {
  lesson: string;
  goal: string;
  criteria: string[];
  base: number;
}

export type GoalRefusal = "no_lesson" | "other_lesson" | "invalid" | "too_long" | "too_many" | "stale";

const SHA256 = /^[a-f0-9]{64}$/;
const ACTIVITY_MAX = 128;
const nonEmpty = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** The revision of a served lesson, or null when the profile carries no lesson this rule can name. */
export function goalLessonRefOf(lesson: unknown): GoalLessonRef | null {
  if (!isObject(lesson)) return null;
  const { course_id, version, sha256 } = lesson;
  if (!nonEmpty(course_id, 200) || !nonEmpty(version, 100) || typeof sha256 !== "string" || !SHA256.test(sha256)) return null;
  return { course_id, version, sha256 };
}

const sameLesson = (a: GoalLessonRef, b: GoalLessonRef): boolean =>
  a.course_id === b.course_id && a.version === b.version && a.sha256 === b.sha256;

const activityOf = (activity: string | null | undefined): string | null =>
  typeof activity === "string" && activity.length > 0 && activity.length <= ACTIVITY_MAX ? activity : null;

/** Where one lesson revision's goal for one activity is stored inside the workspaceState map. */
export function goalScopeKey(ref: GoalLessonRef, activity: string | null): string {
  return ref.sha256 + ":" + (activity ?? "");
}

function validRecord(value: unknown): value is StudentGoalRecord {
  if (!isObject(value) || value.schema !== STUDENT_GOAL_SCHEMA) return false;
  const lesson = goalLessonRefOf(value.lesson);
  if (!lesson || Object.keys(value.lesson as object).length !== 3) return false;
  if (value.activity !== null && activityOf(value.activity as string) === null) return false;
  if (typeof value.goal !== "string" || value.goal.length > GOAL_TEXT_MAX) return false;
  const criteria = value.criteria;
  if (!Array.isArray(criteria) || criteria.length > GOAL_CRITERIA_MAX || !criteria.every((c) => nonEmpty(c, GOAL_CRITERION_MAX))) return false;
  return Number.isSafeInteger(value.revision) && (value.revision as number) >= 1 && Number.isFinite(value.saved_at);
}

/**
 * The stored goal of THIS lesson revision and activity, or null. The record must name the same lesson and activity it is
 * filed under: a record copied under another key (another lesson's goal) is never shown as this lesson's.
 */
export function storedGoalFor(all: unknown, ref: GoalLessonRef, activity: string | null): StudentGoalRecord | null {
  if (!isObject(all)) return null;
  const record = all[goalScopeKey(ref, activityOf(activity))];
  if (!validRecord(record)) return null;
  return sameLesson(record.lesson, ref) && record.activity === activityOf(activity) ? record : null;
}

/** The goal the screen draws for the served lesson; null when the seat has no lesson. */
export function goalViewOf(lesson: unknown, activity: string | null | undefined, all: unknown): StudentGoalView | null {
  const ref = goalLessonRefOf(lesson);
  if (!ref) return null;
  const scope = activityOf(activity);
  const record = storedGoalFor(all, ref, scope);
  return {
    lesson: ref,
    activity: scope,
    goal: record?.goal ?? "",
    criteria: record ? [...record.criteria] : [],
    revision: record?.revision ?? 0,
    saved_at: record?.saved_at ?? null,
  };
}

/** One line of the criteria field per criterion; blank lines dropped. */
export function goalCriteriaFromText(text: string): string[] {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * A save from the webview, checked against the served lesson and the stored goal. Only the goal sentence and the
 * personal criteria are read from the message; any other key (a lesson's completion list, an acceptance sentence) is
 * ignored, so nothing the screen sends can reach the lesson's criteria. Pure: returns the new map to store.
 */
export function acceptGoalSave(
  lesson: unknown,
  activity: string | null | undefined,
  msg: unknown,
  all: unknown,
  now: number,
): { ok: true; record: StudentGoalRecord; all: Record<string, unknown> } | { ok: false; code: GoalRefusal } {
  const ref = goalLessonRefOf(lesson);
  if (!ref) return { ok: false, code: "no_lesson" };
  if (!isObject(msg)) return { ok: false, code: "invalid" };
  // The form was drawn under this lesson revision. A form left open across a lesson change would otherwise file the
  // old lesson's goal under the new one.
  if (msg.lesson !== ref.sha256) return { ok: false, code: "other_lesson" };
  if (typeof msg.goal !== "string" || !Array.isArray(msg.criteria) || !msg.criteria.every((c) => typeof c === "string")) return { ok: false, code: "invalid" };
  const goal = msg.goal.trim();
  const criteria = (msg.criteria as string[]).map((c) => c.trim()).filter((c) => c.length > 0);
  if (goal.length > GOAL_TEXT_MAX || criteria.some((c) => c.length > GOAL_CRITERION_MAX)) return { ok: false, code: "too_long" };
  if (criteria.length > GOAL_CRITERIA_MAX) return { ok: false, code: "too_many" };
  const scope = activityOf(activity);
  const stored = storedGoalFor(all, ref, scope);
  // Saved from an older revision (another chat view saved in between): refused, so it cannot overwrite the newer goal.
  if (msg.base !== (stored?.revision ?? 0)) return { ok: false, code: "stale" };
  const record: StudentGoalRecord = {
    schema: STUDENT_GOAL_SCHEMA,
    lesson: ref,
    activity: scope,
    goal,
    criteria,
    revision: (stored?.revision ?? 0) + 1,
    saved_at: now,
  };
  return { ok: true, record, all: { ...(isObject(all) ? all : {}), [goalScopeKey(ref, scope)]: record } };
}

/**
 * Which of two goal views the screen keeps. Views for one lesson and activity only move forward by revision: a config
 * built before a save cannot put the older goal back after the save's own answer. A view of another lesson or activity
 * replaces the held one (the screen follows the served lesson); null means the seat has no lesson now.
 */
export function acceptGoalView(prev: StudentGoalView | null, next: StudentGoalView | null | undefined): StudentGoalView | null {
  if (next === undefined) return prev;
  if (!next || !prev) return next ?? null;
  if (!sameLesson(prev.lesson, next.lesson) || prev.activity !== next.activity) return next;
  return next.revision >= prev.revision ? next : prev;
}

/** The view, when it belongs to the lesson the screen shows; otherwise nothing is drawn as this lesson's goal. */
export function goalOfLesson(view: StudentGoalView | null | undefined, lesson: unknown): StudentGoalView | null {
  const ref = goalLessonRefOf(lesson);
  return view && ref && sameLesson(view.lesson, ref) ? view : null;
}

/** What the student is told when a save is refused or not stored. Screen copy: no numbers (SX-59). */
export const GOAL_REFUSAL_SENTENCES: Record<GoalRefusal | "not_stored", string> = {
  no_lesson: "연결된 수업이 없어서 목표를 저장하지 않았어요.",
  other_lesson: "수업이 바뀌어서 저장하지 않았어요. 지금 수업에서 다시 적어 주세요.",
  invalid: "목표를 읽지 못해 저장하지 않았어요. 다시 저장해 주세요.",
  too_long: "목표나 완료 기준이 너무 길어요. 조금 줄여서 다시 저장해 주세요.",
  too_many: "내 완료 기준은 다섯 줄까지 적을 수 있어요.",
  stale: "다른 화면에서 목표가 먼저 바뀌었어요. 지금 목표를 확인하고 다시 고쳐 주세요.",
  not_stored: "목표를 저장하지 못했어요. 적은 내용은 그대로 있으니 다시 저장해 주세요.",
};
