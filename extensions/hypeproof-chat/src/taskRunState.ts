/**
 * REQ-STUDIO-TASK-RUN-STATE (AE-03, CGP-AGENT-R-022 recast) — the run state the personal task
 * rail shows next to the ACTIVE task. Pure and vscode-free: the webview derives it from what it
 * already knows (send pending, stream open, approval modal raised by the host, last terminal
 * event of this view's turn). Tasks never run concurrently, so only the active task has a state;
 * an inactive task's stored transcript carries no stop/error marker, so it shows none.
 */

/** How this view's last turn ended. `null` = no turn ended in this view yet (no evidence). */
export type TaskTurnOutcome = 'done' | 'stopped' | 'access' | 'error' | null;

export type TaskRunState = 'preparing' | 'running' | 'approval' | 'stopped' | 'access' | 'error' | 'done';

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

/** The stroke icons (webview ChatIcon kinds) a run state may draw. */
export type TaskRunIcon = 'dots' | 'dot' | 'hand' | 'stop' | 'alert' | 'ticket' | 'check';

/**
 * One short Korean label and an icon per state. The words are always drawn; the icon is decoration,
 * drawn from the stroke set (REQ-STUDIO-STROKE-ICONS) instead of a Unicode symbol.
 */
export const TASK_RUN_STATE_LABELS: Record<TaskRunState, { label: string; icon: TaskRunIcon }> = {
  preparing: { label: '응답 준비 중', icon: 'dots' },
  // A dot, not a play triangle: in the rail ▶ reads as a disclosure triangle or a play control (REQ-STUDIO-UI-POLISH-1).
  running: { label: '작업 중', icon: 'dot' },
  approval: { label: '승인 기다리는 중', icon: 'hand' },
  stopped: { label: '멈춤', icon: 'stop' },
  access: { label: '이용권 확인 필요', icon: 'ticket' },
  error: { label: '오류', icon: 'alert' },
  done: { label: '끝남', icon: 'check' },
};

/** The rail button's accessible name: the task title, then the state in words. */
export function taskRunAccessibleName(title: string, state: TaskRunState | null): string | undefined {
  return state ? `${title}, ${TASK_RUN_STATE_LABELS[state].label}` : undefined;
}

/**
 * REQ-STUDIO-UI-POLISH-1: the rail card's count line. A task with no stored message reads "시작 전",
 * except while it has a run state: the first turn is not stored until it ends, and "작업 중" next to
 * "시작 전" says two things at once. Then the line keeps only the date.
 */
export function taskCountLine(messageCount: number, state: TaskRunState | null): string {
  if (messageCount) return `대화 ${messageCount}`;
  return state ? '' : '시작 전';
}
