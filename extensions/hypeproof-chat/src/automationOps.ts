import type { AutomationQuestSnapshot } from './automationQuest';
import type { AutomationQuestion } from './automationProtocol';
import type { RuntimeStatus } from './classroomOps';

export const AUTOMATION_OPS_CAPABILITY = 'observe_automation';
export const AUTOMATION_OPS_STEPS = ['goal', 'skill', 'connect', 'sheet', 'prepare', 'upload', 'deploy', 'preview', 'send', 'publish'] as const;
export type AutomationOpsPhase = 'idle' | 'planned' | 'running' | 'waiting_user' | 'waiting_approval' | 'blocked' | 'failed' | 'completed';
export interface AutomationOpsProgress {
  phase: AutomationOpsPhase;
  step_id?: typeof AUTOMATION_OPS_STEPS[number];
  completed: number;
  total: number;
}
/** Ownership is used locally to match a paired seat; it is never part of the event. */
export interface AutomationOpsObservation { owner: { u?: string; c?: string }; progress: AutomationOpsProgress }

/** Construct a new allowlisted object; no title, label, question, source or result escapes. */
export function automationOpsProgress(snapshot?: AutomationQuestSnapshot, question?: Pick<AutomationQuestion, 'kind'>): AutomationOpsProgress {
  if (!snapshot) return { phase: 'idle', completed: 0, total: 0 };
  if (!snapshot.nodes.length || snapshot.nodes.length > 10 || snapshot.nodes.some(node => !(AUTOMATION_OPS_STEPS as readonly string[]).includes(node.id))) return { phase: 'idle', completed: 0, total: 0 };
  const completed = snapshot.nodes.filter(node => node.status === 'succeeded').length;
  const active = snapshot.nodes.find(node => node.status === 'running') ?? snapshot.nodes.find(node => node.status === 'failed' || node.status === 'blocked') ?? snapshot.nodes.find(node => node.status === 'current');
  const phase: AutomationOpsPhase = question ? ['text', 'choice', 'sheet', 'preview_review'].includes(question.kind) ? 'waiting_user' : 'waiting_approval'
    : completed === snapshot.nodes.length ? 'completed'
    : active?.status === 'running' ? 'running' : active?.status === 'failed' ? 'failed' : active?.status === 'blocked' ? 'blocked' : 'planned';
  const questionStep: Partial<Record<AutomationQuestion['kind'], AutomationOpsProgress['step_id']>> = {
    connect: 'connect', sheet: 'sheet', preview_review: 'preview', preview: 'send', publish: 'publish', unpublish: 'publish', install: 'skill',
  };
  const step = question && questionStep[question.kind] || active?.id as AutomationOpsProgress['step_id'];
  return { phase, ...(step ? { step_id: step } : {}), completed, total: snapshot.nodes.length };
}

export function automationOpsRuntime(progress: AutomationOpsProgress | null, fallback: RuntimeStatus): RuntimeStatus {
  if (!progress) return fallback;
  if (progress.phase === 'waiting_user' || progress.phase === 'blocked') return 'waiting_user';
  if (progress.phase === 'waiting_approval') return 'waiting_approval';
  if (progress.phase === 'failed') return 'error';
  if (progress.phase === 'running') return 'running';
  return fallback;
}
