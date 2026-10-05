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
 *   assigned  → working    the student's first learning event for this task, or the first coach turn
 *                          that answered. The event is read from the batch on every signal (a level,
 *                          not an edge), so a `work` signal that was lost cannot leave a started task
 *                          closed.
 *   working, step move     forward only when every step before the target has its `gate` event as
 *                          the student's own (the core's `nextStep`, walked in the design's order);
 *                          back always (SX-16). No step move before work starts or after the submit.
 *   working   → submitted  the host accepted a completion submit (the SX-14 gate, judged on the host)
 *   submitted → reflected  NOT here. It needs the boundary reflection (`reflection_submitted`, and the
 *                          `reflection_skipped` record SX-26 adds), which is sx-p2-boundary-reflection.
 *                          No signal in this file can produce it.
 *
 * Storage: the `hps-local-record/1` Task the design names, on the App's one measurement-core
 * record (the store the local review and CR-10's browser results already share). No new store
 * and no new record kind (SX-48). The gate result is never stored; it is computed from the
 * events every time. Only the phase, the step and their history are stored, under a record id
 * scoped like the events the gate reads (`taskRecordIdOf`).
 */
import { createHash } from "node:crypto";
import {
  isLearningEventKind,
  nextStep,
  updateCurriculum,
  type LearningEventKind,
  type LocalRecord,
  type ObservationEvent,
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

/**
 * The id the task's record is stored under: the design's task id plus the identity of the
 * observation batch the gate reads.
 *
 * The record lives in the App's globalStorage, which every seat and every folder on this OS
 * account shares. The learning events the gate judges do not: they live in the folder's
 * workspaceState, in the batch of one observation scope (class, student, token or session,
 * session: worker/src/lib/native-observation-scope.ts), stored under format + scope + program.
 * Keyed by the design's id alone, a second seat, the same student on a re-issued token, or the
 * same lesson in another folder would read this task's phase next to none of its events:
 * "submitted" in region D while region A checks nothing off, and no way to submit its own work.
 * The events, the screen and the submit keep the design's id (`learningTaskIdOf`).
 */
export function taskRecordIdOf(taskId: string, batch: { workspace: string; format: string; scope: string; program: string }): string {
  const seat = createHash("sha256").update(JSON.stringify([batch.workspace, batch.format, batch.scope, batch.program])).digest("hex");
  return taskId + "." + seat.slice(0, 16);
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
  /** The design's step order. `gate`: the event that has to exist, as the student's own, before the step can be left. */
  steps: ReadonlyArray<{ id: string; gate?: LearningEventKind }>;
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
 * turning into a storage error on every screen refresh. A step `gate` that is not a learning
 * event kind is malformed too (the frozen design never has one: learning-design.ts refuses it):
 * no flow, rather than a gate nothing can ever meet.
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
  const steps: FlowLesson["steps"][number][] = [];
  for (const s of Array.isArray(rawSteps) ? rawSteps : []) {
    const { id, gate } = (s && typeof s === "object" ? s : {}) as { id?: unknown; gate?: unknown };
    if (!nonEmpty(id, 200) || (gate !== undefined && !isLearningEventKind(gate))) return null;
    steps.push(gate === undefined ? { id } : { id, gate });
  }
  if (!steps.length) return null;
  return { course_id: l.course_id, version: l.version, sha256: l.sha256, week, steps };
}

/**
 * Has the student worked on this task? Their learning event for it in the batch says so.
 *
 * Read on every signal, not only when the record is first made: a seat that used the drawer
 * before this flow shipped must not reopen as "not started" with its work in plain view, and
 * neither may a task whose `work` signal was lost (another Studio window held the record's
 * lock) or never sent (the CR-12 verify path records learning events without one). A coach turn
 * cannot be read back this way (a turn's events carry the turn id, not the task), so only
 * learning events count; the next turn that answers moves the phase anyway.
 */
export function startedBefore(events: ReadonlyArray<{ task?: unknown; kind?: unknown }>, taskId: string): boolean {
  return events.some((e) => e.task === taskId && isLearningEventKind(e.kind));
}

export type FlowRefusal = "not_started" | "unknown_step" | "gate_not_met";

export type FlowDecision =
  | { kind: "none" }
  | { kind: "patch"; patch: Partial<TaskCurriculum> }
  | { kind: "refused"; code: FlowRefusal; gate?: LearningEventKind };

/**
 * What one signal asks of the current curriculum. Pure.
 *
 * `events` are THIS task's events (the caller filters by the design's task id); the step gate
 * is judged on them, on the host, never on what the webview says.
 *
 * The patch is applied by the core's `updateCurriculum`, which refuses any move its own
 * transition table forbids, so this table cannot widen what the core allows.
 */
export function decideFlow(current: TaskCurriculum, signal: FlowSignal, lesson: FlowLesson, events: readonly ObservationEvent[]): FlowDecision {
  switch (signal.kind) {
    case "seen":
      return { kind: "none" };
    case "work":
      return current.phase === "assigned" ? { kind: "patch", patch: { phase: "working" } } : { kind: "none" };
    case "start_step": {
      // The step must be one of this lesson's. A string the webview made up is not stored as the
      // task's step — later nobody could tell which step the record was standing on.
      const to = lesson.steps.findIndex((s) => s.id === signal.stepId);
      if (to < 0) return { kind: "refused", code: "unknown_step" };
      // A step move is a `working` transition (design table: "working, 단계 이동"). Before any work
      // the task has not started; after the submit there is nothing left to move through, and a
      // second press says nothing, as a second submit does.
      if (current.phase === "assigned") return { kind: "refused", code: "not_started" };
      if (current.phase !== "working" || signal.stepId === current.current_step) return { kind: "none" };
      // Back is always allowed (SX-16), and leaves the later step's visit on the record.
      const from = lesson.steps.findIndex((s) => s.id === current.current_step);
      if (from >= 0 && to < from) return { kind: "patch", patch: { current_step: signal.stepId } };
      // Forward: walk the design's order from the first step with the core's own step rule
      // (`nextStep`), so every step before the target must have its gate met by the student's own
      // event. A gate not met keeps the task where it is ("단계 gate 미충족이면 제자리").
      let at = lesson.steps[0]!.id;
      while (at !== signal.stepId) {
        const next = nextStep({ steps: lesson.steps, current: at, events });
        if (!next.ok) return { kind: "refused", code: next.code === "gate_not_met" ? "gate_not_met" : "unknown_step", ...(next.gate ? { gate: next.gate } : {}) };
        at = next.step;
      }
      return { kind: "patch", patch: { current_step: signal.stepId } };
    }
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
 * SAME record (`taskRecordIdOf`: the same task, seat and folder). Never a default: falling back
 * to "working" would put the completion button back on a task that was already submitted.
 * null when nothing was ever read for this record; the screen then shows the gate alone, as a
 * seat without the flow does.
 */
export function screenFlow(
  outcome: FlowOutcome | null,
  last: { recordId: string; curriculum: TaskCurriculum } | null,
  recordId: string,
): TaskCurriculum | null {
  if (outcome) return outcome.curriculum;
  return last && last.recordId === recordId ? last.curriculum : null;
}

/**
 * Read, decide, write: one task, one signal, on the measurement-core record.
 *
 * `taskId` is the design's id, the one the learning events name; `recordId` is where this
 * seat's record of it is stored (`taskRecordIdOf`). `events` is the observation batch the gate
 * reads; only the events naming `taskId` count.
 *
 * The caller holds the record's lock (`FileRecordStorage.exclusive`), so a read and a write
 * from two Studio windows cannot interleave. A storage failure is thrown by name
 * (`storage_busy`, `storage_failure`, `capacity_exceeded`, ...) and nothing is claimed.
 *
 * Who acted: `user` for what the student did (work, a step, a submit, a learning event that
 * started the task), `adapter_explicit` for the record the host opens when the task first
 * appears on screen.
 */
export async function applyTaskFlow(
  record: LocalRecord,
  input: { taskId: string; recordId: string; lesson: FlowLesson; signal: FlowSignal; events: readonly ObservationEvent[]; at: number },
): Promise<FlowOutcome> {
  const { lesson, signal, at } = input;
  const mine = input.events.filter((e) => e.task === input.taskId);
  const started = startedBefore(mine, input.taskId);
  let task: Task;
  let changed = false;
  try {
    task = await record.getTask(input.recordId);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "unknown_task") throw error;
    task = await record.createTask({ id: input.recordId, project: lesson.course_id, at });
    changed = true;
  }
  if (!task.curriculum) {
    task = updateCurriculum(
      task,
      {
        module: { course_id: lesson.course_id, version: lesson.version, sha256: lesson.sha256 },
        week: lesson.week,
        phase: started || signal.kind === "work" ? "working" : "assigned",
        current_step: lesson.steps[0]!.id,
      },
      { by: signal.kind === "seen" ? "adapter_explicit" : "user", at },
    );
    changed = true;
  } else if (task.curriculum.phase === "assigned" && started) {
    // A level, not an edge: the student's own learning event for this task is on record, so the
    // task has started whatever signal arrives now.
    task = updateCurriculum(task, { phase: "working" }, { by: "user", at });
    changed = true;
  }
  const decision = decideFlow(task.curriculum!, signal, lesson, mine);
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

// ── What the student is told (region D, beside the completion button) ────────────────────────

/** A submit before any work, refused by name. It says what starts the task. */
export const SUBMIT_NOT_STARTED_SENTENCE = "아직 시작 전이라 제출할 수 없어요. 코치와 이야기하거나 기록을 남기면 시작돼요";
/** A submit the record could not store. The button stays, so the student can press it again. */
export const submitNotStoredSentence = (code: string): string => "제출을 저장하지 못했어요 (" + code + "). 다시 한 번 눌러 주세요.";
/** Any other read or write of the task record that failed. Work goes on; nothing was claimed. */
export const flowNotStoredSentence = (code: string): string => "과제 진행 기록을 읽거나 저장하지 못했어요 (" + code + "). 작업은 계속할 수 있어요.";

/** A storage failure as the notice may name it: the store's own code, never a message or a path. */
export function flowErrorCode(error: unknown): string {
  return error instanceof Error && /^[a-z_0-9]{1,80}$/.test(error.message) ? error.message : "storage_failure";
}

/**
 * The one task-flow line waiting for the next `learningState`, after one signal ran: `outcome`
 * when the record answered, `error` (a `flowErrorCode`) when it could not be read or written.
 * `pending` is the line still waiting; the host clears it when it sends a state.
 *
 * A step start that the record refuses (not started, a gate not met, a foreign step) says
 * nothing: the step the student is LOOKING AT is the webview's view state and still moves; only
 * the record keeps the task where the events put it.
 */
export function flowNotice(pending: string | null, signal: FlowSignal, result: { outcome: FlowOutcome } | { error: string }): string | null {
  if ("error" in result) {
    if (signal.kind === "submit") return submitNotStoredSentence(result.error);
    // The refresh that follows a failed submit usually fails for the same reason; it must not
    // replace the sentence that tells the student their submit was not stored.
    if (signal.kind === "seen" && pending) return pending;
    return flowNotStoredSentence(result.error);
  }
  if (signal.kind === "submit" && result.outcome.refused === "not_started") return SUBMIT_NOT_STARTED_SENTENCE;
  return pending;
}
