import type { ResolvedProfile } from './protocol';
import { resolveCoachRuntime } from './chatPanelHelpers.ts';

export type ModelSelection = NonNullable<ResolvedProfile['model_selection']>;
export interface SavedModelChoice { scope: string; alias: string }

export function modelSelectionScope(profile: ResolvedProfile): string {
  return JSON.stringify([profile.profile_id, profile.lesson?.sha256 ?? null, profile.model_selection, ...(profile.observation?.scope ? [profile.observation.scope] : [])]);
}

export function availableModelSelection(profile: ResolvedProfile | null, settingRuntime: 'proxy' | 'agent-sdk'): ModelSelection | undefined {
  const model = profile?.model_selection;
  // Age does not hide the choice (2026-10-05); the runtime itself is resolved below and by the Worker's lesson policy.
  if (!profile || !model || !model.choices.length) return undefined;
  const runtime = resolveCoachRuntime({ settingRuntime, profileRuntime: profile.coach_runtime, minorCohort: profile.minor_cohort });
  // Frozen lesson runtime is binding; old profiles with a machine override keep their existing behavior.
  return model.source === 'lesson' || model.runtime === runtime ? model : undefined;
}

export function selectedModel(profile: ResolvedProfile, selection: ModelSelection, saved: SavedModelChoice | undefined, setting: string): string {
  const requested = saved?.scope === modelSelectionScope(profile) ? saved.alias : selection.source === 'lesson' ? selection.default : setting;
  return selection.choices.find(c => c.alias === requested || c.id === requested)?.alias ?? selection.default;
}

export interface SavedEffortChoice { scope: string; model: string; value: import('./protocol').CourseEffort }
export function selectedEffort(profile: ResolvedProfile, selection: ModelSelection, model: string, saved?: SavedEffortChoice) {
  const policy = selection.choices.find(c => c.alias === model)?.effort;
  if (!policy?.allowed.length || !policy.allowed.includes(policy.default)) return undefined;
  const value = saved?.scope === modelSelectionScope(profile) && saved.model === model && policy.allowed.includes(saved.value)
    ? saved.value : policy.default;
  return { value, allowed: policy.allowed };
}

/**
 * The `reason` values the details list can word. `no_receipt` (orchestrator S4,
 * hypeproof-service#88): a row written for its agent attribution alone. No effort receipt
 * exists, `requested` and `applied` are null, and nothing is claimed about the effort used.
 */
export const KNOWN_EFFORT_REASONS = ['selected', 'course_default', 'unsupported_model', 'no_receipt'] as const;

/**
 * Unknown/malformed Service data cannot become a claim of applied settings: the envelope and each
 * row's id, model, levels, status and time must be well formed, or the whole record reads unknown.
 * The reason is the one field read row by row. A reason this build does not know (a newer
 * Service, or none at all) becomes `unknown` on that row only: the row keeps its model and levels
 * and marks just its reason, so one new word never turns the whole list into 미확인. Rows with a
 * known reason are passed through as they came.
 */
export function observedEffortResult(data: unknown): import('./protocol').ChatConfig['effortResult'] {
  const unknown = { state: 'unknown' as const, requests: [] };
  if (!data || typeof data !== 'object') return unknown;
  const { requests, truncated } = data as Record<string, unknown>;
  const level = (v: unknown) => v === null || ['low', 'medium', 'high'].includes(v as string);
  if (!Array.isArray(requests) || !requests.length || requests.length > 100 || typeof truncated !== 'boolean') return unknown;
  if (!requests.every(r => r && typeof r === 'object' && typeof r.request_id === 'string'
    && typeof r.model === 'string' && level(r.requested) && level(r.applied)
    && Number.isInteger(r.status) && r.status >= 100 && r.status <= 599
    && typeof r.created_at === 'string')) return unknown;
  const known = KNOWN_EFFORT_REASONS as readonly unknown[];
  return { state: 'observed', requests: requests.map(r => (known.includes(r.reason) ? r : { ...r, reason: 'unknown' })), truncated };
}
