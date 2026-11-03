// CGP-KNOW-R-009 (REQ-KNOW-14) — which activities a task may move to.
//
// A personal task moves only between personal activities; a class task never leaves its class
// activity. Pure: no vscode, no DOM, no Node imports, so the host and the tests share it.
//
// "Personal activity" is deliberately narrow (DEC-KNOW-R009): an activity of kind `personal`, or a
// bought pass, with no served lesson. A trial (not a pass) keeps its own carryover flow (REQ-L12),
// so its tasks do not move and no task moves into it. A classroom activity, or any seat with a
// served lesson, is a class activity. An unknown kind without a pass is treated as a class activity.
// The host lists only activities of the current service (ActivityConnections.list), so this rule
// does not look at the service.

export interface TaskMoveActivity {
  ref: string;
  id: string;
  name: string;
  kind?: string | null;
  pass?: boolean;
  /** Recorded when the activity was entered with a served lesson (see ActivityRecord.lesson). */
  lesson?: boolean;
}

export interface TaskMoveDestination { ref: string; name: string }

/** Host → webview: what the task menu may offer. The webview never decides eligibility. */
export type TaskMoveView =
  | { allowed: true; destinations: TaskMoveDestination[] }
  | { allowed: false; reason: string };

export const TASK_MOVE_CLASS_REASON = '수업 작업은 이 수업 활동 안에만 둘 수 있어요. 다른 활동으로 옮길 수 없어요.';
export const TASK_MOVE_TRIAL_REASON = '체험 활동의 작업은 다른 활동으로 옮길 수 없어요.';
export const TASK_MOVE_NONE_REASON = '옮길 수 있는 다른 개인 활동이 없어요.';
export const TASK_MOVE_UNKNOWN_REASON = '활동 정보를 아직 확인하지 못해 옮길 수 없어요. 잠시 뒤 다시 열어 주세요.';

export function isPersonalActivity(activity: Pick<TaskMoveActivity, 'kind' | 'pass' | 'lesson'>): boolean {
  if (activity.lesson) return false;
  if (activity.kind === 'classroom') return false;
  return activity.kind === 'personal' || activity.pass === true;
}

/**
 * The move state of the current activity's tasks. `current.lesson` comes from the live profile
 * (a served lesson makes it a class activity even when its kind says personal).
 */
export function taskMoveView(current: TaskMoveActivity, activities: readonly TaskMoveActivity[]): TaskMoveView {
  if (!isPersonalActivity(current)) {
    return { allowed: false, reason: current.kind === 'trial' && !current.lesson ? TASK_MOVE_TRIAL_REASON : TASK_MOVE_CLASS_REASON };
  }
  const seen = new Set<string>([current.id]);
  const destinations: TaskMoveDestination[] = [];
  for (const activity of activities) {
    if (seen.has(activity.id) || !isPersonalActivity(activity)) continue;
    seen.add(activity.id);
    destinations.push({ ref: activity.ref, name: activity.name });
  }
  destinations.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  return { allowed: true, destinations };
}

/** The destination the learner picked, re-derived on the host from a fresh list (never trusted from the webview). */
export function taskMoveTarget<T extends TaskMoveActivity>(current: TaskMoveActivity, activities: readonly T[], ref: unknown): T | undefined {
  if (typeof ref !== 'string' || ref.length > 512) return undefined;
  const view = taskMoveView(current, activities);
  if (!view.allowed || !view.destinations.some(destination => destination.ref === ref)) return undefined;
  return activities.find(activity => activity.ref === ref);
}
