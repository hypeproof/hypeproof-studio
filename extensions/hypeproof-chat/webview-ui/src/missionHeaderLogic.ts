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
 * SX-01, SX-02 — what has settled which step region A shows, for one task.
 *
 * The step on screen is a view state the webview keeps, but it does not start at the first
 * step: it starts where the task's record stands (`learningState.currentStep`). Drawn from the
 * first step, a reopened task put an earlier step's action in the Primary and counted the steps
 * remaining from there, and pressing that Primary moved the record back, because a move back is
 * always allowed (SX-16; review of 2026-10-05). Once the view of a task is settled, later states
 * for that task never move it: from then on the student's own choice holds.
 *
 *   - `{ task }`: the view of that task is settled, by its record or by the student.
 *   - `{ picked: true }`: the student chose a step before any state named the task (the header is
 *     drawn from the profile before the host's first state arrives). That choice is the view.
 *   - null: nothing is settled yet.
 */
export type StepViewSettled = { task: string } | { picked: true } | null;

/**
 * A learning state arrived. `step`: the step to show now, or null to keep the view as it is.
 *
 * A state that names no recorded step (a seat without the task flow, or a record not read this
 * time) settles nothing, so the next state that names the step still moves the view there.
 */
export function stepViewOnState(
  settled: StepViewSettled,
  state: { task: string; currentStep?: string | null },
): { settled: StepViewSettled; step: string | null } {
  if (settled && "picked" in settled) return { settled: { task: state.task }, step: null };
  if (settled && settled.task === state.task) return { settled, step: null };
  if (typeof state.currentStep !== "string" || !state.currentStep) return { settled, step: null };
  return { settled: { task: state.task }, step: state.currentStep };
}

/** The student chose a step. `task`: the task of the last learning state, or null before any arrived. */
export function stepViewOnPick(task: string | null): StepViewSettled {
  return task ? { task } : { picked: true };
}

/**
 * SX-01, SX-02 — does this seat run the task flow, as far as the screen can tell from the profile:
 * a `/2` learning-event profile whose lesson has a mission and at least one step.
 *
 * The host's own test (`runsTaskFlow`, src/taskFlowHelpers.ts) also checks the module's fields. A
 * lesson this calls a flow seat and the host does not is released by `recordShownBy`: the host's
 * state then carries no phase and no notice.
 */
export function taskFlowSeat(
  profile: { observation?: { format?: string } | null; lesson?: { content?: { steps?: readonly unknown[]; learning?: { mission?: unknown } | null } } | null } | null | undefined,
): boolean {
  const content = profile?.lesson?.content;
  const mission = content?.learning?.mission;
  return profile?.observation?.format === "hps-observation/2" && typeof mission === "string" && mission.trim().length > 0 && (content?.steps?.length ?? 0) > 0;
}

/**
 * SX-01, SX-02 — has this learning state shown the screen the task's record, so that region A's
 * Primary may start a step?
 *
 * Until the host's first state arrives, region A is drawn from the profile alone, at the first
 * step. A start pressed there reaches the host as a move onto the first step, and on a task left
 * mid-way that is a move back, which the flow always allows: the record lost its step before the
 * screen had shown it (review of 2026-10-05). So on a task-flow seat the Primary stays busy until a
 * state has shown the record:
 *
 *   - it names the step the record holds (`currentStep`), or
 *   - it carries no task-flow phase and no notice: the host runs no task flow for this lesson, and
 *     there is no record a start could move.
 *
 * A state with no phase but a notice is the record not read this time (another Studio window held
 * it): nothing is shown yet, and a later state names the step.
 */
export function recordShownBy(state: { currentStep?: string | null; phase?: string | null; notice?: string | null }): boolean {
  if (typeof state.currentStep === "string" && state.currentStep) return true;
  return !state.phase && !state.notice;
}

/**
 * Which task's record a learning state could show this screen: the lesson and the activity it is
 * open on. The task's id is made from the same two (`learningTaskIdOf`), and both come down in
 * `config`; a new lesson or activity is a new task whose record has not been shown yet.
 */
export function recordViewKey(config: { profile?: { lesson?: { sha256?: string } | null } | null; activity?: { id?: string } | null } | null | undefined): string {
  return `${config?.profile?.lesson?.sha256 ?? ""}|${config?.activity?.id ?? ""}`;
}

/**
 * SX-02 — the lesson step "지난번 이어서" names, or null.
 *
 * The host sends a step id only while the task record still stands where an earlier session
 * left it and the student has not acted on the task in this one (`FlowSession`,
 * taskFlowHelpers.ts). The webview does not judge that again; it only
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
