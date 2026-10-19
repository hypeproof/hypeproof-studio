/**
 * REQ-STUDIO-TASK-RUN-STATE (AE-03, CGP-AGENT-R-022 recast) — the run state the personal task
 * rail shows next to the ACTIVE task. Pure and vscode-free: the webview derives it from what it
 * already knows (send pending, stream open, approval modal raised by the host, last terminal
 * event of this view's turn). Tasks never run concurrently, so only the active task has a state;
 * an inactive task's stored transcript carries no stop/error marker, so it shows none.
 */

/** How this view's last turn ended. `null` = no turn ended in this view yet (no evidence). */
export type TaskTurnOutcome = 'done' | 'stopped' | 'error' | null;

export type TaskRunState = 'preparing' | 'running' | 'approval' | 'stopped' | 'error' | 'done';

export interface TaskRunInputs {
  /** A send left the composer and the host has not opened its stream yet. */
  preparing: boolean;
  /** A turn (or the verify run) is streaming. */
  running: boolean;
  /** The host raised a tool approval modal for this turn and it is still open. */
  approvalPending: boolean;
  lastOutcome: TaskTurnOutcome;
}

/** Precedence: approval > running > preparing; only then the last terminal outcome. */
export function deriveTaskRunState(input: TaskRunInputs): TaskRunState | null {
  if (input.approvalPending) return 'approval';
  if (input.running) return 'running';
  if (input.preparing) return 'preparing';
  return input.lastOutcome;
}

/** One short Korean label and a symbol per state. The words are always drawn; the symbol is decoration. */
export const TASK_RUN_STATE_LABELS: Record<TaskRunState, { label: string; symbol: string }> = {
  preparing: { label: '응답 준비 중', symbol: '⋯' },
  running: { label: '작업 중', symbol: '▶' },
  approval: { label: '승인 기다리는 중', symbol: '!' },
  stopped: { label: '멈춤', symbol: '■' },
  error: { label: '오류', symbol: '⚠' },
  done: { label: '끝남', symbol: '✓' },
};

/** The rail button's accessible name: the task title, then the state in words. */
export function taskRunAccessibleName(title: string, state: TaskRunState | null): string | undefined {
  return state ? `${title}, ${TASK_RUN_STATE_LABELS[state].label}` : undefined;
}
