import type { AutomationRecipe, AutomationStoreItem } from './automationProtocol';
export interface AutomationStoreClient {
  list(): Promise<{ items: AutomationStoreItem[] }>;
  detail(id: string): Promise<{ item: AutomationStoreItem; recipe: AutomationRecipe }>;
  publish(recipe: AutomationRecipe, requestId: string): Promise<{ item: AutomationStoreItem }>;
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
      const messages: Record<number, string> = { 401: '수업 이용권이 만료됐어요. 다시 연결해 주세요.', 403: '이 수업에서는 스토어를 사용할 수 없어요.', 404: '이 자동화를 찾을 수 없거나 우리 반에 공유되지 않았어요.', 409: '같은 게시 요청의 내용이 달라요. 목록을 확인하고 다시 시도해 주세요.', 413: '공유할 내용이 너무 커요.', 429: '게시 한도에 도달했어요. 잠시 후 다시 시도해 주세요.' };
      throw new Error(messages[response.status] ?? '스토어 요청을 완료하지 못했어요. 템플릿에 실제 주소나 비밀값이 없는지 확인해 주세요.');
    }
    return await response.json() as T;
  }
  const itemPath = (id: string) => { if (!id || id.length > 200) throw new Error('자동화 번호를 확인해 주세요.'); return `/${encodeURIComponent(id)}`; };
  return { list: () => request(''), detail: id => request(itemPath(id)), publish: (recipe, requestId) => request('', 'POST', { recipe, requestId }), unpublish: id => request(itemPath(id), 'DELETE') };
}
