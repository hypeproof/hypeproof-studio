/**
 * SX-55 — the task-flow state machine, driven by the host (design §과제 흐름 상태 기계).
 *
 * The machine itself already ships in the measurement core: `updateCurriculum()`
 * (worker/src/lib/measurement-core/local-record.ts) moves `Task.curriculum.phase` forward
 * one step at a time, refuses a skip or a move back by name, and writes every move into the
 * Task's `history`. What was missing is a caller (STATE.md revision proposal 12: the
 * transition table shipped, "없는 것은 호출부 하나다"). This file holds that caller's rules.
 * It imports no `vscode`, so the rules run under `node --experimental-strip-types`;
 * chatPanelProvider.ts only orchestrates.
 *
 * What moves the phase, and nothing else. SX-55: the state moves only by the session
 * design's step order and the SX-47 events, never by a UI button alone.
 *   assigned  → working    the student's first learning event, or the first coach turn that answered
 *   working   → submitted  the host accepted a completion submit (the SX-14 gate, judged on the host)
 *   submitted → reflected  NOT here. It needs the boundary reflection (`reflection_submitted`, and the
 *                          `reflection_skipped` record SX-26 adds), which is sx-p2-boundary-reflection.
 *                          No signal in this file can produce it.
 *
 * Storage: the `hps-local-record/1` Task the design names, on the App's one measurement-core
 * record (the store the local review and CR-10's browser results already share). No new store
 * and no new record kind (SX-48). The gate result is never stored; it is computed from the
 * events every time. Only the phase, the step and their history are stored.
 */
import {
  isLearningEventKind,
  updateCurriculum,
  type LocalRecord,
  type Task,
  type TaskCurriculum,
} from "../../../worker/src/lib/measurement-core/index.ts";
import { submittableIn } from "./learningStateHelpers.ts";

/**
 * One Task per session design file and activity (design §과제 흐름 상태 기계):
 * `task-<first 16 chars of the module sha256>-<first 8 chars of the activity id>`.
 * Two tasks are never merged just because they share a folder (MC-08).
 */
export function learningTaskIdOf(lessonSha: string | undefined, activityId: string | undefined): string {
  return "task-" + String(lessonSha ?? "").slice(0, 16) + "-" + String(activityId ?? "").slice(0, 8);
}

export type FlowSignal =
  /** The task is on screen. Creates its record once; changes nothing after that. */
  | { kind: "seen" }
  /** The student stored a learning event, or a coach turn answered them. */
  | { kind: "work" }
  /** The student started a step (region A's "지금 할 것"). */
  | { kind: "start_step"; stepId: string }
  /** The host accepted a completion submit: the SX-14 gate held when the host judged it again. */
  | { kind: "submit" };

/** The fields of the served lesson the flow reads. */
export interface FlowLesson {
  course_id: string;
  version: string;
  sha256: string;
  week: number;
  steps: ReadonlyArray<{ id: string }>;
}

const SHA256 = /^[a-f0-9]{64}$/;
const nonEmpty = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;

/**
 * The lesson this seat runs the task flow on, or null when it runs none.
 *
 * SX-01 negative: when the design file has no mission, the header says "미션이 정해지지
 * 않았습니다" and the task flow (SX-55) does NOT start. So no mission, no Task record. The
 * other checks are what `updateCurriculum` would refuse anyway (a module it cannot name, a
 * week below one, no step to stand on); refusing them here keeps a malformed lesson from
 * turning into a storage error on every screen refresh.
 */
export function flowLessonOf(lesson: unknown): FlowLesson | null {
  if (!lesson || typeof lesson !== "object") return null;
  const l = lesson as { course_id?: unknown; version?: unknown; sha256?: unknown; content?: { steps?: unknown; learning?: { week?: unknown; mission?: unknown } } };
  const learning = l.content?.learning;
  if (!learning || !nonEmpty(learning.mission, 2000)) return null;
  const week = learning.week;
  if (typeof week !== "number" || !Number.isSafeInteger(week) || week < 1) return null;
  if (!nonEmpty(l.course_id, 200) || !nonEmpty(l.version, 100) || typeof l.sha256 !== "string" || !SHA256.test(l.sha256)) return null;
  const rawSteps = l.content?.steps;
  const steps: unknown[] = Array.isArray(rawSteps) ? rawSteps : [];
  const ids = steps.map((s) => (s && typeof s === "object" ? (s as { id?: unknown }).id : undefined));
  if (!ids.length || !ids.every((id) => nonEmpty(id, 200))) return null;
  return { course_id: l.course_id, version: l.version, sha256: l.sha256, week, steps: (ids as string[]).map((id) => ({ id })) };
}

/**
 * Did the student already work on this task before its record existed?
 *
 * Their learning event for it in the batch says so: a seat that used the drawer before this
 * flow shipped must not reopen as "not started" with its work in plain view. A coach turn
 * cannot be read back this way (a turn's events carry the turn id, not the task), so only
 * learning events count; the next turn that answers moves the phase anyway.
 */
export function startedBefore(events: ReadonlyArray<{ task?: unknown; kind?: unknown }>, taskId: string): boolean {
  return events.some((e) => e.task === taskId && isLearningEventKind(e.kind));
}

export type FlowRefusal = "not_started" | "unknown_step";

export type FlowDecision =
  | { kind: "none" }
  | { kind: "patch"; patch: Partial<TaskCurriculum> }
  | { kind: "refused"; code: FlowRefusal };

/**
 * What one signal asks of the current curriculum. Pure.
 *
 * The patch is applied by the core's `updateCurriculum`, which refuses any move its own
 * transition table forbids, so this table cannot widen what the core allows.
 */
export function decideFlow(current: TaskCurriculum, signal: FlowSignal, lesson: FlowLesson): FlowDecision {
  switch (signal.kind) {
    case "seen":
      return { kind: "none" };
    case "work":
      return current.phase === "assigned" ? { kind: "patch", patch: { phase: "working" } } : { kind: "none" };
    case "start_step":
      // The step must be one of this lesson's. A string the webview made up is not stored as the
      // task's step — later nobody could tell which step the record was standing on.
      if (!lesson.steps.some((s) => s.id === signal.stepId)) return { kind: "refused", code: "unknown_step" };
      return signal.stepId === current.current_step ? { kind: "none" } : { kind: "patch", patch: { current_step: signal.stepId } };
    case "submit":
      if (submittableIn(current.phase)) return { kind: "patch", patch: { phase: "submitted" } };
      // assigned → submitted would skip working: a button pressed before any work.
      if (current.phase === "assigned") return { kind: "refused", code: "not_started" };
      // Already submitted (or reflected): a second press changes nothing and says nothing.
      return { kind: "none" };
  }
}

export interface FlowOutcome {
  curriculum: TaskCurriculum;
  /** True when this call wrote the record. */
  changed: boolean;
  refused?: FlowRefusal;
}

/**
 * The curriculum the screen is shown: this read's, or — when the record could not be read
 * this time (another Studio window holding its lock) — the last one this host read for the
 * SAME task. Never a default: falling back to "working" would put the completion button back
 * on a task that was already submitted. null when nothing was ever read for this task; the
 * screen then shows the gate alone, as a seat without the flow does.
 */
export function screenFlow(
  outcome: FlowOutcome | null,
  last: { taskId: string; curriculum: TaskCurriculum } | null,
  taskId: string,
): TaskCurriculum | null {
  if (outcome) return outcome.curriculum;
  return last && last.taskId === taskId ? last.curriculum : null;
}

/**
 * Read, decide, write: one task, one signal, on the measurement-core record.
 *
 * The caller holds the record's lock (`FileRecordStorage.exclusive`), so a read and a write
 * from two Studio windows cannot interleave. A storage failure is thrown by name
 * (`storage_busy`, `storage_failure`, `capacity_exceeded`, ...) and nothing is claimed.
 *
 * Who acted: `user` for what the student did (work, a step, a submit), `adapter_explicit`
 * for the record the host opens when the task first appears on screen.
 */
export async function applyTaskFlow(
  record: LocalRecord,
  input: { taskId: string; lesson: FlowLesson; signal: FlowSignal; started: boolean; at: number },
): Promise<FlowOutcome> {
  const { lesson, signal, at } = input;
  let task: Task;
  let changed = false;
  try {
    task = await record.getTask(input.taskId);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "unknown_task") throw error;
    task = await record.createTask({ id: input.taskId, project: lesson.course_id, at });
    changed = true;
  }
  if (!task.curriculum) {
    const started = input.started || signal.kind === "work";
    task = updateCurriculum(
      task,
      {
        module: { course_id: lesson.course_id, version: lesson.version, sha256: lesson.sha256 },
        week: lesson.week,
        phase: started ? "working" : "assigned",
        current_step: lesson.steps[0]!.id,
      },
      { by: signal.kind === "seen" ? "adapter_explicit" : "user", at },
    );
    changed = true;
  }
  const decision = decideFlow(task.curriculum!, signal, lesson);
  if (decision.kind === "patch") {
    task = updateCurriculum(task, decision.patch, { by: "user", at });
    changed = true;
  }
  if (changed) await record.saveTask(task);
  return {
    curriculum: task.curriculum!,
    changed,
    ...(decision.kind === "refused" ? { refused: decision.code } : {}),
  };
}
