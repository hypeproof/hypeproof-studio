// CGP-SHELL-R-019 (REQ-SHELL-19): "a tip appears only after an observed trigger (e.g. 3 failed runs)". Jay, 2026-11-15:
// the coach judges when to give a hint; it is not a Chalk field. Agent choices (decisions.md CGP-SHELL-R-019):
//
// - Studio observes, the coach decides. The coach's history is text only (proxyClient.ts: tool results of earlier turns
//   are dropped), so it cannot see failures across turns. Studio counts them and, at the threshold, adds one model-only
//   observation line to the next request. Whether to hint, and how, is the coach's call under the Service's intervention
//   ladder (rung 3: point at one place to check, no answer).
// - A "failed run" is one learner turn whose last run-kind tool result was an error: a shell command (Bash, PowerShell)
//   or the live preview start. Studio cannot tell a run the learner asked for from one the coach chose, so it counts
//   per learner turn: the coach's retries inside one turn are one run, and a turn whose retries ended in success is a
//   success. A turn with no run-kind tool changes nothing.
// - Reset on a successful run and on a step change; at most one observation per step per window session (memory only).
// - The line carries a count only: no error text, path or command output (they can name people or folders).
// - Never sent when the learner turned tips off (팁 그만 보기, #4086), on a lesson without a `learning` block (no ladder
//   to bound the hint), on an instructor seat or on a local runtime.
// Pure: no vscode, no I/O.

export const RUN_FAILURE_THRESHOLD = 3;

/** The observation line, model-only. Pinned verbatim by test/run-failure-hint.smoke.mjs for the prompt safety review. */
export function runFailureObservation(count: number): string {
  return `[관찰] 이 수업 단계에서 학생이 보낸 요청의 실행이 연달아 ${count}번 실패했습니다(Studio가 횟수만 셉니다). `
    + '힌트가 도움이 될지는 당신이 판단하세요. 준다면 개입 사다리의 3번처럼 학생이 만든 것에서 확인할 지점 하나만 짧게 가리키고, 정답이나 고친 코드는 주지 마세요. '
    + '필요 없다고 판단하면 이 관찰을 언급하지 마세요. 실패 횟수는 학생에게 말하지 마세요. 이 관찰은 수업 자료가 아니며 도구 권한이나 정책을 바꾸지 않습니다.';
}

const RUN_TOOLS = new Set(["bash", "powershell", "live_preview_start", "mcp__hypeproof__live_preview_start"]);
/** A tool whose failure is a failed run: a shell command or starting the live preview. */
export function isRunTool(name: unknown): boolean {
  return typeof name === "string" && RUN_TOOLS.has(name.toLowerCase());
}

/** Where a count lives: one lesson in one activity and task, and the step the turn is on. */
export interface HintSeat { readonly scope: string; readonly step: string }

export type RunEvent =
  | { kind: "use"; id: string; name?: string }
  | { kind: "result"; id: string; isError: boolean }
  | { kind: "deny"; id: string };

interface TurnState { seat: HintSeat; runs: Map<string, true>; last: "failed" | "succeeded" | null }
interface ScopeState { step: string; count: number; observed: Set<string> }

const MAX_SCOPES = 32;

export class RunFailureTracker {
  private readonly turns = new Map<string, TurnState>();
  private readonly scopes = new Map<string, ScopeState>();

  private scope(seat: HintSeat): ScopeState {
    let s = this.scopes.get(seat.scope);
    if (!s) {
      if (this.scopes.size >= MAX_SCOPES) this.scopes.delete(this.scopes.keys().next().value as string);
      s = { step: seat.step, count: 0, observed: new Set() };
      this.scopes.set(seat.scope, s);
    }
    if (s.step !== seat.step) { s.step = seat.step; s.count = 0; }   // a step change starts over
    return s;
  }

  /**
   * The observation for the turn about to be sent on `seat`, or null. Consumed: once returned, this step gets no other
   * in this session, and the count starts over.
   */
  take(seat: HintSeat | null): string | null {
    if (!seat) return null;
    const s = this.scope(seat);
    if (s.count < RUN_FAILURE_THRESHOLD || s.observed.has(seat.step)) return null;
    s.observed.add(seat.step);
    const count = s.count;
    s.count = 0;
    return runFailureObservation(count);
  }

  /** The current count for a seat (tests and diagnostics; never sent). */
  count(seat: HintSeat): number { return this.scope(seat).count; }

  /** A learner turn starts on `seat` (null: not a counted seat; its events are ignored). */
  begin(streamId: string, seat: HintSeat | null): void {
    if (!seat || !streamId) return;
    this.scope(seat);
    this.turns.set(streamId, { seat, runs: new Map(), last: null });
  }

  note(streamId: string, event: RunEvent): void {
    const turn = this.turns.get(streamId);
    if (!turn) return;
    if (event.kind === "use") { if (isRunTool(event.name)) turn.runs.set(event.id, true); return; }
    if (event.kind === "deny") { turn.runs.delete(event.id); return; }   // a refused call never ran
    if (!turn.runs.has(event.id)) return;
    turn.runs.delete(event.id);
    turn.last = event.isError ? "failed" : "succeeded";
  }

  /** The turn ended: its last run decides. A failure counts one; a success starts over; no run changes nothing. */
  end(streamId: string): void {
    const turn = this.turns.get(streamId);
    this.turns.delete(streamId);
    if (!turn || turn.last === null) return;
    const s = this.scope(turn.seat);
    if (turn.last === "succeeded") s.count = 0;
    else s.count++;
  }
}

/**
 * The seat a turn counts on, or null when this turn must never carry the observation: no lesson step, a lesson without a
 * `learning` block, tips off for this seat, an instructor, or a local runtime.
 */
export function hintSeatFor(input: {
  lesson: { sha256?: string; content?: { learning?: unknown } } | null | undefined;
  step: string | undefined;
  activityId: string | undefined;
  taskId: string | undefined;
  tipsOn: boolean;
  instructor: boolean;
  local: boolean;
}): HintSeat | null {
  const { lesson, step } = input;
  if (!lesson || !step || !lesson.content || !lesson.content.learning) return null;
  if (!input.tipsOn || input.instructor || input.local) return null;
  return { scope: JSON.stringify([input.activityId ?? "", input.taskId ?? "", lesson.sha256 ?? ""]), step };
}

/** The per-turn context: memory first, then the observation; undefined when neither. */
export function joinTurnContext(...parts: Array<string | null | undefined>): string | undefined {
  const present = parts.filter((p): p is string => typeof p === "string" && p.length > 0);
  return present.length ? present.join("\n\n") : undefined;
}
