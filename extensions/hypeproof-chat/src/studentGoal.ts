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
// 완료되지 않는다"). Records of earlier lesson revisions stay on this device with no delete path, like `hps.lessonWork`;
// how long they are kept is an open decision (docs/testing/learning-agent-experience.md#goal-20261006).

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
  /** The activity the seat is bound to. Null only on a host without activity connections (tests): see `goalScopeKey`. */
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
  /** The sending chat view's own id for this save. The host echoes it, so only that view shows the answer's note. */
  requestId?: string;
}

export type GoalRefusal = "no_lesson" | "other_lesson" | "invalid" | "too_long" | "too_many" | "stale";

/**
 * The host's answer to one save. It goes to every chat view (the sidebar and the editor tab alike).
 *   view       the goal as stored, after a save; after a `stale` refusal, the newer goal the save lost to. Absent on
 *              every other refusal and on a failed write: those change nothing on any screen but the sentence.
 *   requestId  the id of the save it answers, echoed from the request.
 */
export interface GoalAnswer {
  view?: StudentGoalView;
  error?: string;
  saved?: boolean;
  requestId?: string;
}

/**
 * What one chat view says under the editor about its own last save: refused (`error`), or stored as `revision`
 * (`saved`). The saved note describes that revision only; once another goal reaches the screen it no longer applies.
 */
export type GoalNote = { error?: string; saved?: boolean; revision?: number } | null;

/** What the editor holds: the two fields and the revision their text was loaded from (the next save's `base`). */
export interface GoalFields {
  goal: string;
  criteria: string;
  base: number;
}

/** The editor's verdict on its fields: `save` is the request to send, or null while saving would change nothing or be refused. */
export interface GoalEdit {
  save: GoalSaveRequest | null;
  unchanged: boolean;
  tooMany: boolean;
  tooLong: boolean;
}

const SHA256 = /^[a-f0-9]{64}$/;
const REQUEST_ID = /^[A-Za-z0-9-]{1,64}$/;
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

/**
 * Where one lesson revision's goal for one activity is stored inside the workspaceState map.
 *
 * In the App every goal is filed under an activity. The provider's context is the ActivityConnections wrapper
 * (extension.ts `connections.wrap()`): it hands out only the active activity's token, and `ensureProfile` answers no
 * profile while no activity of this Service is active, so a seat without an activity binding is served no lesson and
 * draws no goal. The activity id includes the Service's per-user activity id, and a workspace folder is claimed by one
 * activity only (`ActivityConnections.claim`), so two students on one Mac never share a key. The empty scope below is
 * reached only by hosts without that wrapper (tests); a seat served a lesson without an activity would first need its
 * own seat identity here.
 */
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
 * replaces the held one (the screen follows the served lesson); null means the seat has no lesson now. The chat screen
 * folds the host's save answers with this, and draws `acceptGoalView(answers, config.studentGoal)` on every render.
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

/** The save's request id, echoed by the host only when it is a plain short id; anything else is not echoed. */
export function goalRequestIdOf(msg: unknown): string | undefined {
  const id = isObject(msg) ? msg.requestId : undefined;
  return typeof id === "string" && REQUEST_ID.test(id) ? id : undefined;
}

/**
 * The note a chat view shows for a host answer, given the id of the save it is waiting on. Only the answer to that save
 * gives one; for any other answer (another view's save, or none pending) the result is undefined: keep what is shown.
 */
export function goalNoteFor(answer: GoalAnswer, pending: string | null): GoalNote | undefined {
  if (!pending || answer.requestId !== pending) return undefined;
  if (answer.error) return { error: answer.error };
  return answer.saved && answer.view ? { saved: true, revision: answer.view.revision } : null;
}

/** Whether the saved note still describes what the screen shows: the revision it stored, and fields left as saved. */
export function goalSavedNoteShown(note: GoalNote, view: StudentGoalView | null | undefined, edit: GoalEdit): boolean {
  return !!note?.saved && note.revision === (view?.revision ?? 0) && edit.unchanged;
}

/** The editor's fields for a goal the host sent: its text, and its revision as the base of the next save. */
export function goalFieldsOf(view: StudentGoalView | null | undefined): GoalFields {
  return { goal: view?.goal ?? "", criteria: (view?.criteria ?? []).join("\n"), base: view?.revision ?? 0 };
}

/** What the editor holds over time: its fields, the goal they stand on, and whether to say the goal changed elsewhere. */
export interface GoalEditorState {
  fields: GoalFields;
  /** The goal the fields were loaded from or last moved to (`fields.base` is its revision); null before the host sent one. */
  from: StudentGoalView | null;
  /** The fields keep text the student typed before another chat view's save arrived: the screen says so (`GOAL_CHANGED_ELSEWHERE`). */
  elsewhere: boolean;
}

/** The editor for a goal the host sent: its text, its revision as the next save's base, nothing to say. */
export function goalEditorOf(view: StudentGoalView | null | undefined): GoalEditorState {
  return { fields: goalFieldsOf(view), from: view ?? null, elsewhere: false };
}

/**
 * The editor after the host sends `next` (a reconnect, this view's save, another chat view's save, another lesson).
 * A field the student has not changed since the goal it stands on follows `next`; a field they typed in keeps the typed
 * text, so another chat view's save never drops what is being written here. The base moves to `next` either way: a save
 * made after this starts from the newest goal (it is not refused as stale), and `elsewhere` has the screen say first
 * that the goal was changed on another screen, so the save replaces it knowingly. A save already sent from the older
 * revision is still refused by the host (`acceptGoalSave`). `own` means `next` is this view's own stored save: nothing
 * is said, and text typed after pressing save stays. Another lesson, revision or activity, or no goal, starts the editor
 * over: typed text never moves to another lesson's goal. A goal no newer than the one the fields stand on (a repeated
 * config, the goal a stale refusal brings) changes nothing.
 */
export function goalEditorOnView(state: GoalEditorState, next: StudentGoalView | null | undefined, own: boolean): GoalEditorState {
  const from = state.from;
  if (!next || !from || !sameLesson(from.lesson, next.lesson) || from.activity !== next.activity) return goalEditorOf(next);
  if (next.revision <= from.revision) return state;
  const goalTyped = state.fields.goal.trim() !== from.goal;
  const criteriaTyped = goalCriteriaFromText(state.fields.criteria).join("\n") !== from.criteria.join("\n");
  const fields: GoalFields = {
    goal: goalTyped ? state.fields.goal : next.goal,
    criteria: criteriaTyped ? state.fields.criteria : next.criteria.join("\n"),
    base: next.revision,
  };
  // Nothing typed, or what was typed is what `next` stores (this view's own save): the fields hold `next` as stored.
  if (goalEditOf(next, next.lesson.sha256, fields, false).unchanged) return goalEditorOf(next);
  return { fields, from: next, elsewhere: !own };
}

/** The editor after the student types: the change applied; once the fields hold the goal they stand on again, nothing is said. */
export function goalEditorOnEdit(state: GoalEditorState, patch: Partial<Pick<GoalFields, "goal" | "criteria">>): GoalEditorState {
  const fields = { ...state.fields, ...patch };
  const unchanged = goalEditOf(state.from, state.from?.lesson.sha256 ?? "", fields, false).unchanged;
  return { fields, from: state.from, elsewhere: state.elsewhere && !unchanged };
}

/**
 * Whether the fields can be saved, and the request if so. The request starts from the revision the fields were loaded
 * from, never from a newer goal that reached the screen since: an edit made before another view's save is then refused
 * as `stale` instead of silently replacing that save. Nothing to save (the fields hold the stored goal), past the
 * bounds the host would refuse, or a save of this view still unanswered: no request.
 */
export function goalEditOf(view: StudentGoalView | null | undefined, lesson: string, fields: GoalFields, pending: boolean): GoalEdit {
  const criteria = goalCriteriaFromText(fields.criteria);
  const unchanged = fields.goal.trim() === (view?.goal ?? "") && criteria.join("\n") === (view?.criteria ?? []).join("\n");
  const tooMany = criteria.length > GOAL_CRITERIA_MAX;
  const tooLong = fields.goal.trim().length > GOAL_TEXT_MAX || criteria.some((c) => c.length > GOAL_CRITERION_MAX);
  const save = unchanged || tooMany || tooLong || pending ? null : { lesson, goal: fields.goal, criteria, base: fields.base };
  return { save, unchanged, tooMany, tooLong };
}

/** What the student is told when a save is refused or not stored. Screen copy: no numbers (SX-59). */
export const GOAL_REFUSAL_SENTENCES: Record<GoalRefusal | "not_stored", string> = {
  // Also the answer when the App lost its lesson connection while the screen still shows the lesson (a failed profile
  // refresh): the refusal leaves the screen and the typed text as they are.
  no_lesson: "수업 연결을 확인하지 못해 목표를 저장하지 않았어요. 적은 내용은 그대로 있으니 잠시 뒤 다시 저장해 주세요.",
  other_lesson: "수업이 바뀌어서 저장하지 않았어요. 지금 수업에서 다시 적어 주세요.",
  invalid: "목표를 읽지 못해 저장하지 않았어요. 다시 저장해 주세요.",
  too_long: "목표나 완료 기준이 너무 길어요. 조금 줄여서 다시 저장해 주세요.",
  too_many: "내 완료 기준은 다섯 줄까지 적을 수 있어요.",
  stale: "다른 화면에서 목표가 먼저 바뀌었어요. 지금 목표를 확인하고 다시 고쳐 주세요.",
  not_stored: "목표를 저장하지 못했어요. 적은 내용은 그대로 있으니 다시 저장해 주세요.",
};

/**
 * Said under the editor while it keeps text the student typed before another chat view's save
 * (`GoalEditorState.elsewhere`): the goal above is now the other screen's, and saving replaces it. No numbers (SX-59).
 */
export const GOAL_CHANGED_ELSEWHERE = "다른 화면에서 목표가 바뀌었어요. 적던 내용은 그대로 있으니, 저장하면 이 내용으로 바뀌어요.";
