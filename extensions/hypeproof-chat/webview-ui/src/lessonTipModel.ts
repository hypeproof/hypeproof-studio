/**
 * CGP-CHAT-R-021 (REQ-CGP-CHAT-R19, CGP-CHAT-019, PI#4) — the one lesson tip above the composer.
 *
 * The only source is the served lesson step's Chalk-authored `hint`. The served step schema
 * (`hps-session-design/1`) rejects unknown step keys, so there is no separate tip field to read,
 * and nothing in Studio may add product-promotion tips. Pure helpers, testable without a DOM.
 */
import type { ResolvedProfile } from "../../src/protocol";

type Lesson = NonNullable<ResolvedProfile["lesson"]>;

/** The Service's own cap on a step text field. Longer input is not a served hint: show nothing. */
export const LESSON_TIP_MAX = 8000;
/** At most this many dismissed steps are remembered per panel; the oldest drop first. */
export const LESSON_TIP_DISMISS_MAX = 200;
export const LESSON_TIP_STATE_KEY = "lessonTipDismissed";

// C0/C1 controls (except tab/newline/CR, folded below), soft hyphen, zero-width and joiner
// characters, bidi marks/embeddings/isolates (incl. the Arabic letter mark), Hangul and braille
// blanks, interlinear annotation controls, tag characters and BOM. They can reorder text or make a
// tip that looks empty. Line/paragraph separators are
// whitespace in JS regexes, so the fold below turns them into one space.
const UNSAFE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2069\u2800\u3164\uFEFF\uFFA0\uFFF9-\uFFFB\u{E0000}-\u{E007F}]/gu;

export function cleanTipText(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > LESSON_TIP_MAX) return "";
  return raw.replace(UNSAFE, "").normalize("NFC").replace(/\s+/g, " ").trim();
}

export type LessonTip = { key: string; stepId: string; text: string };

/** The tip for the step the learner is on (the first step before any is picked), or null. */
export function lessonTipFor(lesson: Lesson | null | undefined, stepId: string | null): LessonTip | null {
  const steps = lesson?.content && Array.isArray(lesson.content.steps) ? lesson.content.steps : [];
  const step = steps.find((s) => s && s.id === stepId) ?? steps[0];
  if (!lesson || !step || typeof step.id !== "string") return null;
  const text = cleanTipText(step.hint);
  if (!text) return null;
  return { key: JSON.stringify([lesson.course_id, lesson.version, lesson.sha256, step.id]), stepId: step.id, text };
}

export function readDismissed(state: Record<string, unknown>): string[] {
  const list = state[LESSON_TIP_STATE_KEY];
  return Array.isArray(list) ? list.filter((k): k is string => typeof k === "string").slice(-LESSON_TIP_DISMISS_MAX) : [];
}

export function withDismissed(list: readonly string[], key: string): string[] {
  return [...list.filter((k) => k !== key), key].slice(-LESSON_TIP_DISMISS_MAX);
}

/**
 * The tip's action only edits the draft: an empty draft becomes the tip text, a draft that
 * already holds it is left alone (a double press adds nothing), and other text is kept with
 * the tip on a new line after it. Nothing here sends.
 */
export function prefillWithTip(draft: string, text: string): string {
  if (!draft.trim()) return text;
  if (draft.includes(text)) return draft;
  return draft.replace(/\s+$/, "") + "\n" + text;
}
