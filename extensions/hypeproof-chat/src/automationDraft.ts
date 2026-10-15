import { validateEmailRecipe } from './googleAutomation.ts';
import type { AutomationRecipe, AutomationSource } from './automationProtocol';

// One activity-scoped value keeps installed content and its exact origin atomic.
// This local envelope is never a distributable recipe or a credential container.
export function readAutomationDraft(value: unknown): { recipe: AutomationRecipe; source: AutomationSource | null } {
  const draft = value as { schema?: unknown; recipe?: unknown; source?: AutomationSource } | null;
  if (draft?.schema !== 'hps-local-automation-draft/1') return { recipe: validateEmailRecipe(value), source: null };
  const source = draft.source;
  if (!source || typeof source.id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(source.id)
    || typeof source.title !== 'string' || !source.title.trim() || source.title.length > 120
    || !Number.isInteger(source.version) || source.version < 1 || source.version > 50) {
    throw new Error('가져온 스킬의 출처 기록을 확인할 수 없어요. 스토어에서 다시 가져와 주세요.');
  }
  return { recipe: validateEmailRecipe(draft.recipe), source: { id: source.id, title: source.title, version: source.version } };
}

export function automationDraftValue(recipe: AutomationRecipe, source: AutomationSource | null) {
  return source ? { schema: 'hps-local-automation-draft/1', recipe, source } : recipe;
}
