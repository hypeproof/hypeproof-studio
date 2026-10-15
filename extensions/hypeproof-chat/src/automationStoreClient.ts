import { createHash } from 'node:crypto';
import type { AutomationRecipe, AutomationStoreItem } from './automationProtocol';
import { validateEmailRecipe } from './googleAutomation.ts';
import { scanFile } from '@hypeproof/service-contracts/publish-scan';
export class AutomationPublicationWithdrawnError extends Error {
  constructor() { super('이전에 철회한 게시 요청이에요. 내용을 다시 확인한 뒤 공유를 요청해 주세요.'); }
}
export interface AutomationStoreClient {
  list(): Promise<{ items: AutomationStoreItem[] }>;
  versions(id: string): Promise<{ items: AutomationStoreItem[] }>;
  detail(id: string): Promise<{ item: AutomationStoreItem; recipe: AutomationRecipe }>;
  publish(recipe: AutomationRecipe, requestId: string, parentId?: string, sourceId?: string): Promise<{ item: AutomationStoreItem }>;
  unpublish(id: string): Promise<{ ok: true }>;
}
export function createAutomationStoreClient(deps: { baseUrl: string; getToken(): Promise<string>; fetchImpl?: typeof fetch }): AutomationStoreClient {
  const base = new URL(deps.baseUrl);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) throw new Error('스토어 연결 주소를 확인해 주세요.');
  if (base.username || base.password || base.search || base.hash) throw new Error('스토어 연결 주소를 확인해 주세요.');
  const fetcher = deps.fetchImpl ?? fetch;
  async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const token = await deps.getToken();
    if (!token) throw new Error('수업 이용권을 연결한 뒤 스토어를 열어 주세요.');
    const response = await fetcher(`${base.origin}/v1/automations${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      if (response.status === 409) {
        // Only this exact server reason permits preparing a new publication
        // intent. Never expose provider text or treat every conflict as withdrawal.
        const failure = await response.json().catch(() => null) as { error?: { code?: unknown } } | null;
        if (failure?.error?.code === 'publication_unpublished') throw new AutomationPublicationWithdrawnError();
      }
      const messages: Record<number, string> = { 401: '수업 이용권이 만료됐어요. 다시 연결해 주세요.', 403: '이 수업에서는 스토어를 사용할 수 없어요.', 404: '이 자동화를 찾을 수 없거나 우리 반에 공유되지 않았어요.', 409: '같은 게시 요청의 내용이 달라요. 목록을 확인하고 다시 시도해 주세요.', 413: '공유할 내용이 너무 커요.', 429: '게시 한도에 도달했어요. 잠시 후 다시 시도해 주세요.' };
      throw new Error(messages[response.status] ?? '스토어 요청을 완료하지 못했어요. 템플릿에 실제 주소나 비밀값이 없는지 확인해 주세요.');
    }
    try { return await response.json() as T; }
    catch { throw new Error('스토어 응답 형식을 확인할 수 없어요. 다시 시도해 주세요.'); }
  }
  const itemPath = (id: string) => { if (!id || id.length > 200) throw new Error('자동화 번호를 확인해 주세요.'); return `/${encodeURIComponent(id)}`; };
  async function detail(id: string): Promise<{ item: AutomationStoreItem; recipe: AutomationRecipe }> {
    const value = await request<{ item: AutomationStoreItem; recipe: unknown }>(itemPath(id));
    try {
      if (!value || value.item?.id !== id) throw new Error('Invalid publication');
      const release = value.item;
      if (release.formatVersion === undefined) { if (release.version !== 1) throw new Error('Unknown legacy format'); }
      else if (release.formatVersion !== 1 || !Number.isInteger(release.version) || release.version < 1 || release.version > 50
        || typeof release.familyId !== 'string' || !release.familyId || release.familyId.length > 200
        || !/^[a-f0-9]{64}$/.test(release.recipeSha256 ?? '')
        || (release.version > 1 && (typeof release.parentId !== 'string' || !release.parentId || release.parentId.length > 200))) throw new Error('Invalid release');
      if (release.sourceId != null && (typeof release.sourceId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(release.sourceId))) throw new Error('Invalid source');
      const recipe = validateEmailRecipe(value.recipe);
      const serialized = JSON.stringify(recipe);
      if (release.formatVersion === 1 && createHash('sha256').update(serialized).digest('hex') !== release.recipeSha256) throw new Error('Changed content');
      // Local authoring can contain private drafts. A distributed recipe cannot.
      // Apply publication restrictions before either UI can install remote data.
      if (/[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/i.test(serialized)
        || /https?:\/\/|\b(?:authorization|access_token|refresh_token|client_secret)\b/i.test(serialized)
        || scanFile('recipe.json', serialized, { projectId: 'automation', testOrigin: null }).length) throw new Error('Private content');
      for (const text of [recipe.title, recipe.description, recipe.subjectTemplate, recipe.bodyTemplate, ...Object.values(recipe.columns)]) {
        if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new Error('Invalid text');
      }
      for (const template of [recipe.subjectTemplate, recipe.bodyTemplate]) {
        if (/[{}]/.test(template.replace(/\{\{(?:name|document|dueDate)\}\}/g, ''))) throw new Error('Invalid placeholder');
      }
      return { item: value.item, recipe };
    } catch {
      // Never include remote values or validator diagnostics in a model/UI error.
      throw new Error('스토어 스킬의 형식이나 공유 내용을 확인할 수 없어요. 설치하지 않았어요.');
    }
  }
  async function unpublish(id: string): Promise<{ ok: true }> {
    const result = await request<{ ok?: unknown }>(itemPath(id), 'DELETE');
    if (result?.ok !== true) throw new Error('게시 철회 결과를 확인할 수 없어요. 스토어 목록을 확인해 주세요.');
    return { ok: true };
  }
  return { list: () => request(''), versions: id => request(`${itemPath(id)}/versions`), detail, publish: async (recipe, requestId, parentId, sourceId) => {
    if (parentId && sourceId) throw new Error('새 버전과 새 출처를 함께 지정할 수 없어요.');
    const result = await request<{ item: AutomationStoreItem }>('', 'POST', { recipe, requestId, ...(parentId ? { parentId } : {}), ...(sourceId ? { sourceId } : {}) });
    if (sourceId && result?.item?.sourceId !== sourceId) throw new Error('게시물의 출처 저장을 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.');
    return result;
  }, unpublish };
}
