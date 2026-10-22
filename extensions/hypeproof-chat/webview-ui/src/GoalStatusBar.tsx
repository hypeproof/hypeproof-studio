import type { ChatConfig } from '../../src/protocol';
import { GOAL_STATUSES, type GoalSaveRequest, type StudentGoalView } from '../../src/studentGoal';
import './goalStatusBar.css';

/** Only a confirmed, selected class request ledger is a lesson budget. No estimate or personal balance. */
export function lessonBudget(config: ChatConfig): string {
  const access = config.access;
  const view = access?.view;
  const choice = view?.choices.find(item => item.id === access?.selected);
  if (access?.status !== 'ready' || !view?.configured || !Number.isFinite(Date.parse(view.as_of)) ||
      !choice || choice.active !== true || (choice.state === 'ready' && choice.available !== true) || !['cohort', 'organization'].includes(choice.source_kind) ||
      !['ready', 'exhausted'].includes(choice.state)) return '확인 안 됨';
  const meters = choice.resources.filter(item => item.meter === 'requests:count');
  const meter = meters.length === 1 ? meters[0] : undefined;
  if (!meter || !Number.isSafeInteger(meter.remaining) || meter.remaining < 0 || meter.unresolved !== 0) return '확인 안 됨';
  return `${meter.shared ? '함께 쓰는 ' : ''}${meter.remaining.toLocaleString('ko-KR')}회 · ${new Date(view.as_of).toLocaleString('ko-KR')} 확인`;
}

/** Learner self-report only: changing this never completes a task, unpauses a runtime or starts a turn. */
export function GoalStatusBar({ config, view, pending, onSave }: {
  config: ChatConfig; view: StudentGoalView | null; pending: boolean; onSave: (request: GoalSaveRequest) => void;
}) {
  if (!view) return null;
  return <section className="hps-goal-status" aria-label="내 목표 상태">
    <p>내 목표 · <bdi>{view.goal || '아직 적지 않았어요'}</bdi></p>
    <p role="status">{GOAL_STATUSES[view.status ?? 'active'] ?? GOAL_STATUSES.active} · {view.status ? '내가 표시한 상태' : '상태를 직접 표시해 주세요'}</p>
    {!config.activity?.free && config.profile?.profile_id !== 'studio-open-trial' && <p>남은 수업 예산 · {lessonBudget(config)}</p>}
    <div role="group" aria-label="목표 상태 직접 표시">
      {Object.entries(GOAL_STATUSES).map(([status, label]) => <button type="button" key={status}
        aria-pressed={(view.status ?? 'active') === status} disabled={pending || !view.goal.trim()}
        onClick={() => onSave({ lesson: view.lesson.sha256, goal: view.goal, criteria: view.criteria,
          base: view.revision, status: status as keyof typeof GOAL_STATUSES })}>{label}</button>)}
    </div>
    <p>상태 표시는 AI를 시작하거나 멈추지 않아요. AI에게 부탁하려면 메시지를 보내 주세요.</p>
  </section>;
}
