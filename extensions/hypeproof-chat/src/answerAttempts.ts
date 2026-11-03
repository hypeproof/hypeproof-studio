// CGP-CHAT-R-006: request ids remain distinct for accounting; the transcript groups retries.
import type { ChatMessage } from './protocol';

export const ATTEMPT_HISTORY_NOTE = '다음 질문에는 지금 보고 있는 답변만 대화 기록으로 보내요. 답이 없는 시도라면 가장 최근 답변을 보내요.';
export type AttemptMeta = Pick<ChatMessage, 'retryOf' | 'visibleAttemptId' | 'chosenAttemptId'>;
export const ATTEMPT_KEYS = ['retryOf', 'visibleAttemptId', 'chosenAttemptId'] as const;
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export function validAttemptMeta(value: unknown): value is AttemptMeta {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.entries(value).every(([key, value]) => (ATTEMPT_KEYS as readonly string[]).includes(key) && id(value));
}
export interface AnswerAttempt { user: ChatMessage; lines: ChatMessage[] }
export interface AnswerAttemptGroup { root: ChatMessage; attempts: AnswerAttempt[]; index: number }

/** A whole runtime response (including tool-separated text segments) is one attempt. */
export function attemptGroups(items: readonly ChatMessage[]): AnswerAttemptGroup[] {
  const groups: AnswerAttemptGroup[] = [];
  let active: AnswerAttempt | undefined;
  for (const message of items) {
    if (message.role !== 'user') { active?.lines.push(message); continue; }
    const group = message.retryOf && groups.find(group => group.root.id === message.retryOf &&
      (group.root.toolMode ?? 'auto') === (message.toolMode ?? 'auto'));
    active = { user: message, lines: [] };
    if (group) group.attempts.push(active);
    else groups.push({ root: message, attempts: [active], index: 0 });
  }
  for (const group of groups) {
    const selected = group.attempts.findIndex(attempt => attempt.user.id === group.root.visibleAttemptId);
    group.index = selected < 0 ? group.attempts.length - 1 : selected;
  }
  return groups;
}

const hasAnswer = (attempt: AnswerAttempt) => attempt.lines.some(message => message.role === 'assistant' && message.content.trim());

/**
 * No call or content copying: only the selected attempt survives this projection. With `forModel`, a
 * selected attempt that produced no answer (a failed retry shown with its error) yields to the newest
 * attempt that did, so the next request still carries the last good answer, as before retries were kept.
 */
export function visibleAttempts(items: readonly ChatMessage[], forModel = false): { items: ChatMessage[]; groups: AnswerAttemptGroup[] } {
  const groups = attemptGroups(items);
  if (forModel) for (const group of groups) {
    if (hasAnswer(group.attempts[group.index])) continue;
    for (let i = group.attempts.length - 1; i >= 0; i--) if (hasAnswer(group.attempts[i])) { group.index = i; break; }
  }
  const first = items.findIndex(message => message.role === 'user');
  const out = first < 0 ? [...items] : items.slice(0, first);
  for (const group of groups) out.push(group.root, ...group.attempts[group.index].lines);
  return { items: out, groups };
}

/** A retry sees only the conversation before its original prompt, never its previous answer. */
export function attemptHistory(items: readonly ChatMessage[], retrySourceId?: string): ChatMessage[] {
  const shown = visibleAttempts(items, true);
  if (!retrySourceId) return shown.items;
  const group = shown.groups.find(group => group.attempts.some(attempt => attempt.user.id === retrySourceId));
  return group ? shown.items.slice(0, shown.items.findIndex(message => message.id === group.root.id)) : shown.items;
}

export function selectAttempt(items: readonly ChatMessage[], rootId: string, attemptId: string, choose: boolean): ChatMessage | null {
  const group = attemptGroups(items).find(group => group.root.id === rootId);
  const target = group?.attempts.find(attempt => attempt.user.id === attemptId);
  if (!group || !target || (choose && !hasAnswer(target))) return null;
  return { ...group.root, visibleAttemptId: attemptId, ...(choose ? { chosenAttemptId: attemptId } : {}) };
}

/** Metadata-only acknowledgement preserves same-session REQ-C5 image bytes. */
export function applyAttemptSelection(items: readonly ChatMessage[], root: ChatMessage): ChatMessage[] {
  return items.map(message => message.id === root.id && message.role === 'user'
    ? { ...message, visibleAttemptId: root.visibleAttemptId, chosenAttemptId: root.chosenAttemptId } : message);
}
