// The Mission header's pure decisions (SX-01, SX-02). No JSX — `node
// --experimental-strip-types` cannot read a `.tsx`, so anything a test calls directly
// lives here. Same place and same reason as `sendQueue.ts` · `runner.ts`.

import type { ResolvedProfile } from "../../src/protocol";

type Lesson = NonNullable<ResolvedProfile["lesson"]>;
export type LessonStep = Lesson["content"]["steps"][number];

/**
 * The maximum number of actions placed in the center of home (SX-02 "중앙 1~3개 action").
 *
 * This is the **size of the window**, not a cap on the design file. The session design
 * schema has no separate action array, only steps, and up to 30 steps are valid
 * (`worker/src/lib/session-design.ts`). SX-02's negative ("a design file with 4 or more
 * actions is not shown truncated but is rejected by design-file validation") assumes the
 * design file declares actions directly, which the actual schema does not —
 * raised under "요구 개정 제안" in `.claude/hypeproof/ux/STATE.md`.
 * Until then, **show only three, starting from the current step**. This is not hiding the
 * later steps but putting what to do now up front, and the number of steps remaining is
 * stated alongside it as a sentence.
 */
export const MAX_ACTIONS = 3;

/** Position of the current step. An unknown id falls back to the first step — never produce an empty screen. */
export function stepIndex(steps: readonly LessonStep[], currentStepId: string | null): number {
  if (!steps.length) return -1;
  const at = steps.findIndex((s) => s.id === currentStepId);
  return at < 0 ? 0 : at;
}

/** Up to MAX_ACTIONS steps, starting from the current one. If fewer remain, only as many as there are. */
export function actionsFrom(steps: readonly LessonStep[], currentStepId: string | null): LessonStep[] {
  const at = stepIndex(steps, currentStepId);
  return at < 0 ? [] : steps.slice(at, at + MAX_ACTIONS);
}

/**
 * The number of steps not yet passed, including the current one.
 *
 * **This is a position, not a progress rate.** What was completed is shown by the
 * completion marks (`completionMet`, from the host's gate verdict), never by this count.
 * Do not pretend to count completions here.
 */
export function stepsRemaining(steps: readonly LessonStep[], currentStepId: string | null): number {
  const at = stepIndex(steps, currentStepId);
  return at < 0 ? 0 : steps.length - at;
}

/**
 * SX-02 — the lesson step "지난번 이어서" names, or null.
 *
 * The host sends a step id only while the task record still stands where an earlier session
 * left it (`resumeOf`, taskFlowHelpers.ts). The webview does not judge that again; it only
 * refuses to invent: an id that is not one of this lesson's steps (a record of another version,
 * a malformed message) draws no entry, never a fallback step.
 */
export function resumeStepOf(steps: readonly LessonStep[], resume: { step?: unknown } | null | undefined): LessonStep | null {
  const id = resume?.step;
  if (typeof id !== "string" || !id) return null;
  return steps.find((s) => s.id === id) ?? null;
}

/**
 * Is one completion condition met, by the host's own verdict (SX-01, SX-50; SX-55)?
 *
 * `missing` is the SX-14 gate's list the host sent down as `learningState.complete.missing`.
 * The webview does not recompute the gate; it only reads which conditions the gate named.
 *
 * Conservative on purpose. A miss that names no condition but names this condition's event
 * (`criterion_after_artifact` names `criterion_set`) leaves it unchecked: "기대 조건을 시험
 * 전에 적었다" must not get a ☑ while the gate says the criterion came after the draft.
 */
export function completionMet(
  item: { id: string; event: string },
  missing: ReadonlyArray<{ item?: string; event?: string }>,
): boolean {
  return !missing.some((m) => m.item === item.id || (m.item === undefined && m.event === item.event));
}
