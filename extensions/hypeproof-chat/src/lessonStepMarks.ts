// CGP-CHAT-R-023 (CGP-CHAT-R56, REQ-STUDIO-LESSON-STEP-DIVIDER) — lesson step boundaries in the transcript.
//
// The served step is the one the host captured at turn start (`turnLesson`, sent as `x-hps-lesson-step`).
// The host stamps it on the turn's user message id as a mark: lesson digest, step id, its 1-based number
// and its title, exactly as served then (like `assistantName`, never backfilled, never re-read from a
// later lesson). Marks live beside the transcript, not inside the task file, so the task file keeps the
// shape older builds accept (taskWorkspaceStore `validMessage`).
//
// The webview draws a read-only divider "n단계: {title}" before the first user message of every run of
// turns served under the same step. "지금 단계로" scrolls to the divider of the step on screen. Neither
// moves the rail: the rail stays the source of truth for the current step.
//
// Node-free: the webview imports this file.

export interface LessonStepMark {
  /** sha256 of the served lesson. */
  lesson: string;
  /** The served step id. */
  id: string;
  /** 1-based position of the step in the served lesson. */
  n: number;
  /** The step title as served, cleaned for display. */
  title: string;
}

export type LessonStepMarks = Record<string, LessonStepMark>;

/** At most this many marks are kept per workspace; the oldest go first. */
export const STEP_MARKS_MAX = 400;
export const STEP_TITLE_MAX = 60;
const ID_MAX = 128;
const MESSAGE_ID_MAX = 256;

// C0/C1 controls, bidi embeddings/overrides/isolates and marks, zero-width joiners, BOM.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;

/** A served step title as one display line: no controls or bidi overrides, NFC, collapsed spaces, capped. */
export function cleanStepTitle(value: string): string {
  const line = value.normalize("NFC").replace(/[\u2028\u2029\r\n\t]/g, " ").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
  const chars = [...line];
  return chars.length > STEP_TITLE_MAX ? `${chars.slice(0, STEP_TITLE_MAX - 1).join("").trimEnd()}…` : line;
}

type ServedLesson = { sha256: string; content: { steps: ReadonlyArray<{ id: string; title: string }> } };

/** The mark for the step served on this turn, or undefined (no lesson, no step, or a step the lesson lacks). */
export function servedStepMark(lesson: ServedLesson | null | undefined, stepId: string | undefined): LessonStepMark | undefined {
  if (!lesson || !stepId) return undefined;
  const steps = lesson.content?.steps ?? [];
  const index = steps.findIndex((step) => step.id === stepId);
  if (index < 0) return undefined;
  const title = cleanStepTitle(typeof steps[index].title === "string" ? steps[index].title : "");
  const mark = { lesson: lesson.sha256, id: stepId, n: index + 1, title: title || "이름 없는 단계" };
  return validStepMark(mark) ? mark : undefined;
}

export function validStepMark(value: unknown): value is LessonStepMark {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v);
  if (keys.length !== 4 || !["lesson", "id", "n", "title"].every((k) => keys.includes(k))) return false;
  return typeof v.lesson === "string" && /^[0-9a-f]{64}$/.test(v.lesson) &&
    typeof v.id === "string" && v.id.length > 0 && v.id.length <= ID_MAX && v.id === v.id.replace(INVISIBLE, "") &&
    typeof v.n === "number" && Number.isInteger(v.n) && v.n >= 1 && v.n <= 999 &&
    typeof v.title === "string" && v.title.length > 0 && v.title === cleanStepTitle(v.title);
}

/** A marks map from storage or the host: only valid entries survive, newest last, capped. */
export function acceptStepMarks(value: unknown): LessonStepMarks {
  const out: LessonStepMarks = Object.create(null);
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([id, mark]) => id.length > 0 && id.length <= MESSAGE_ID_MAX && id !== "__proto__" && validStepMark(mark));
  for (const [id, mark] of entries.slice(-STEP_MARKS_MAX)) out[id] = mark as LessonStepMark;
  return out;
}

/** Records (or replaces, for a retry under the same id) the mark of one user message. */
export function rememberStepMark(marks: LessonStepMarks, messageId: string, mark: LessonStepMark): LessonStepMarks {
  const rest = Object.entries(acceptStepMarks(marks)).filter(([id]) => id !== messageId);
  return acceptStepMarks(Object.fromEntries([...rest, [messageId, mark]]));
}

/** Drops the marks of these user message ids (a re-send clears its old mark before the turn decides its path). */
export function forgetStepMarks(marks: LessonStepMarks, messageIds: Iterable<string>): LessonStepMarks {
  const drop = new Set(messageIds);
  return acceptStepMarks(Object.fromEntries(Object.entries(acceptStepMarks(marks)).filter(([id]) => !drop.has(id))));
}

/**
 * The webview's marks after a host `lessonStepMarks` post. Without `forget` the post is the whole set for the
 * transcript on screen (history post: replace). With `forget` it is a delta: those ids lose their mark (a
 * re-sent prompt whose old boundary no longer holds) and `marks` are merged in. Both fields are untrusted.
 */
export function nextStepMarks(prev: LessonStepMarks, post: { marks?: unknown; forget?: unknown }): LessonStepMarks {
  const marks = acceptStepMarks(post.marks);
  if (!Array.isArray(post.forget)) return marks;
  const forget = post.forget.filter((id): id is string => typeof id === "string").slice(0, STEP_MARKS_MAX);
  return acceptStepMarks({ ...forgetStepMarks(prev, forget), ...marks });
}

/** The marks of the given message ids only (what a host post sends for the transcript on screen). */
export function marksFor(marks: LessonStepMarks, ids: Iterable<string>): LessonStepMarks {
  const out: LessonStepMarks = Object.create(null);
  for (const id of ids) if (Object.prototype.hasOwnProperty.call(marks, id)) out[id] = marks[id];
  return out;
}

const sameStep = (a: LessonStepMark, b: LessonStepMark) => a.lesson === b.lesson && a.id === b.id;

/**
 * The dividers for a transcript in display order: user message id → the step that begins there. A
 * divider goes before the first marked user message and before every marked user message whose served
 * step differs from the previous marked one. Unmarked lines (older history, app-answered shortcuts,
 * tool lines) neither start nor break a run.
 */
export function stepDividers(items: ReadonlyArray<{ id: string; role: string }>, marks: LessonStepMarks | null | undefined): Map<string, LessonStepMark> {
  const out = new Map<string, LessonStepMark>();
  if (!marks) return out;
  let previous: LessonStepMark | null = null;
  for (const item of items) {
    if (item.role !== "user" || !Object.prototype.hasOwnProperty.call(marks, item.id)) continue;
    const mark = marks[item.id];
    if (!validStepMark(mark)) continue;
    if (!previous || !sameStep(previous, mark)) out.set(item.id, mark);
    previous = mark;
  }
  return out;
}

/** "지금 단계로": the last divider of the step on screen in this lesson, or null when it has none yet. */
export function currentDividerId(dividers: Map<string, LessonStepMark>, lesson: string | null | undefined, stepId: string | null | undefined): string | null {
  if (!lesson || !stepId) return null;
  let found: string | null = null;
  for (const [id, mark] of dividers) if (mark.lesson === lesson && mark.id === stepId) found = id;
  return found;
}

export const stepDividerLabel = (mark: LessonStepMark) => `${mark.n}단계: ${mark.title}`;
export const STEP_JUMP_LABEL = "지금 단계로";
