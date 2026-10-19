// Fixture: the task-file validator exactly as an older build ships it (origin/main at cf31558d,
// extensions/hypeproof-chat/src/taskWorkspaceStore.ts: validMessage, validDraft, validSurface,
// validTask, decode), with types stripped. CGP-CHAT-R-002 uses it to prove that a task file written
// by the edit-resend build still loads on a build that predates it. Do not update it to match the
// current store: it stands for the code already installed on learners' machines.
import { createHash } from 'node:crypto';
import { validActivityDraft } from '../../src/activityDraft.ts';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const isRecord = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => Object.keys(value).every(key => keys.includes(key));
const timestamp = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const nonempty = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };

function validMessage(value) {
  if (!isRecord(value) || !exactKeys(value, ['id', 'role', 'content', 'createdAt', 'tool', 'citations', 'images', 'assistantName', 'toolMode'])) return false;
  if (!nonempty(value.id, 256) || typeof value.role !== 'string' || !['user', 'assistant', 'system', 'tool'].includes(value.role) ||
      typeof value.content !== 'string' || !timestamp(value.createdAt)) return false;
  if (value.assistantName !== undefined && typeof value.assistantName !== 'string') return false;
  if (value.toolMode !== undefined && (value.role !== 'user' || !['auto', 'web-search'].includes(value.toolMode))) return false;
  if (value.images !== undefined && (!Array.isArray(value.images) || !value.images.every(image => typeof image === 'string' && image.startsWith('data:image/')))) return false;
  if (value.tool !== undefined && (!isRecord(value.tool) || !exactKeys(value.tool, ['icon', 'label', 'state']) ||
      typeof value.tool.icon !== 'string' || typeof value.tool.label !== 'string' || typeof value.tool.state !== 'string' || !['running', 'done', 'error'].includes(value.tool.state))) return false;
  if (value.citations !== undefined && (!Array.isArray(value.citations) || !value.citations.every(citation =>
    isRecord(citation) && exactKeys(citation, ['url', 'title', 'domain', 'tier']) &&
    typeof citation.url === 'string' && typeof citation.title === 'string' && typeof citation.domain === 'string' &&
    typeof citation.tier === 'number' && [1, 2, 3, 4].includes(citation.tier)))) return false;
  return true;
}

function validDraft(value) {
  return isRecord(value) && exactKeys(value, ['text', 'images', 'queued', 'imports', 'toolMode', 'queuedToolMode', 'queuedPaused', 'recovered']) && validActivityDraft(value);
}

function validSurface(value) {
  if (value === null) return true;
  if (!isRecord(value) || !exactKeys(value, ['url', 'pinned']) || typeof value.url !== 'string' || typeof value.pinned !== 'boolean') return false;
  try {
    const url = new URL(value.url);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

function validTask(value) {
  if (!isRecord(value) || !exactKeys(value, ['id', 'title', 'titleOrigin', 'createdAt', 'updatedAt', 'messageCount', 'messages', 'draft', 'sourceSelection', 'importedLegacy'])) return false;
  return nonempty(value.id, 256) && nonempty(value.title, 160) && timestamp(value.createdAt) && timestamp(value.updatedAt) &&
    (value.titleOrigin === undefined || ['default', 'automatic', 'manual'].includes(value.titleOrigin)) &&
    value.updatedAt >= value.createdAt && Array.isArray(value.messages) && value.messages.every(validMessage) &&
    new Set(value.messages.map(message => message.id)).size === value.messages.length && value.messageCount === value.messages.length &&
    validDraft(value.draft) && validSurface(value.sourceSelection) && typeof value.importedLegacy === 'boolean';
}

/** `scope` is the hashed scope (the store's `scope` property). Throws `{ code: 'corrupt' }` like the old build. */
export function decodeBeforeEditResend(text, scope) {
  let envelope;
  try { envelope = JSON.parse(text); } catch { return fail('corrupt', '작업 기록 파일을 읽을 수 없습니다. 원본을 보존했습니다.'); }
  if (!isRecord(envelope) || !exactKeys(envelope, ['checksum', 'data']) || !isRecord(envelope.data) ||
      typeof envelope.checksum !== 'string' || envelope.checksum !== hash(JSON.stringify(envelope.data))) {
    return fail('corrupt', '작업 기록의 무결성을 확인할 수 없습니다. 원본을 보존했습니다.');
  }
  const data = envelope.data;
  if (!exactKeys(data, ['version', 'scope', 'revision', 'activeTaskId', 'tasks']) || data.version !== 1 || data.scope !== scope ||
      !Number.isSafeInteger(data.revision) || Number(data.revision) < 1 || !Array.isArray(data.tasks) || !data.tasks.length ||
      !data.tasks.every(validTask) || new Set(data.tasks.map(task => task.id)).size !== data.tasks.length ||
      !data.tasks.some(task => task.id === data.activeTaskId)) {
    return fail('corrupt', '작업 기록의 형식이나 계정 범위가 일치하지 않습니다. 원본을 보존했습니다.');
  }
  return data;
}

/** Re-seal a task file after a test edits its data (used only for negative controls). */
export const seal = (data) => JSON.stringify({ checksum: hash(JSON.stringify(data)), data });
