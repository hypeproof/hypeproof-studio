import { classifyDenial, denialCopy, lessonFeatureOff, type DenialAudience, type DenialSource } from './denialSource.ts';
import { accessRemovedFeatures } from './accessClient.ts';
import { profileAudience } from './seatVocabulary.ts';
import type { ChatMessage, ResolvedProfile } from './protocol';

/** A request preference, never a capability grant. Missing values preserve legacy auto mode. */
export type TurnToolMode = 'auto' | 'web-search';
export interface TurnToolsAvailability { webSearch: { available: boolean; reason?: string } }
export const validTurnToolMode = (value: unknown): value is TurnToolMode => value === 'auto' || value === 'web-search';
export class TurnToolModeError extends Error {}
export function turnToolMode(value: unknown): TurnToolMode {
  if (value === undefined) return 'auto';
  if (!validTurnToolMode(value)) throw new TurnToolModeError('도구 선택을 확인할 수 없습니다. 입력은 보관했으니 도구를 다시 선택해 주세요.');
  return value;
}

export function turnToolsDenialSource(args: { profile: ResolvedProfile | null | undefined; runtime: 'proxy' | 'agent-sdk'; local?: boolean; instructor?: boolean }): DenialSource | undefined {
  if (args.local || args.instructor) return 'runtime';
  if (!args.profile) return 'unknown';
  if (args.profile.tools?.web_search !== true) return accessRemovedFeatures(args.profile).has('web_search') ? 'access' : 'lesson';
  return args.runtime !== 'agent-sdk' ? 'runtime' : undefined;
}

export function turnToolsAvailability(args: {
  profile: ResolvedProfile | null | undefined;
  runtime: 'proxy' | 'agent-sdk';
  local?: boolean;
  instructor?: boolean;
}): TurnToolsAvailability {
  // REQ-STUDIO-DENIAL-SOURCE — each reason names who decided: this connection/runtime
  // (앱 버전/환경), the selected 이용권 (accessProfile removed it), the served profile itself
  // (수업 설정), or no profile yet (확인 안 됨).
  const audience = profileAudience(args.profile);
  const feature = '웹 검색';
  const source = turnToolsDenialSource(args);
  const reason = args.local || args.instructor
    // No teacher sentence: the reader may be the instructor, or a local developer.
    ? denialCopy({ source: 'runtime', feature, reason: '이 로컬 구독 연결은 웹 검색 선택을 아직 지원하지 않아요', next: '웹 검색 없이 이어서 해 주세요' }, audience)
    : source === 'unknown'
      ? denialCopy({ source: 'unknown', feature, reason: '수업 정보를 아직 받지 못했어요' }, 'neutral')
      : source === 'access' || source === 'lesson'
        ? source === 'access'
          ? denialCopy({ source: classifyDenial('access_choice_narrowed'), feature }, audience)
          : lessonFeatureOff(feature, audience)
        : source === 'runtime'
          ? denialCopy({ source: 'runtime', feature, reason: '지금 실행 환경은 웹 검색 선택을 지원하지 않아요' }, audience)
          : undefined;
  return { webSearch: reason ? { available: false, reason } : { available: true } };
}

export function requireTurnTools(mode: TurnToolMode, availability: TurnToolsAvailability): void {
  if (mode === 'web-search' && !availability.webSearch.available) {
    throw new TurnToolModeError(availability.webSearch.reason ?? denialCopy({ source: 'unknown', feature: '웹 검색' }, 'neutral'));
  }
}

/** Retrying an identified persisted turn cannot borrow the current composer's mode. */
export function retryTurnToolMode(messages: readonly ChatMessage[], request: {
  sourceMessageId?: string; prompt: string; toolMode?: TurnToolMode;
}): TurnToolMode {
  const requested = turnToolMode(request.toolMode);
  if (!request.sourceMessageId) return requested;
  const original = messages.find(message => message.id === request.sourceMessageId && message.role === 'user');
  if (!original || original.content !== request.prompt) throw new TurnToolModeError('다시 보낼 원래 요청을 찾지 못했습니다. 현재 작업의 요청을 선택해 주세요.');
  const saved = turnToolMode(original.toolMode);
  if (request.toolMode !== undefined && requested !== saved) throw new TurnToolModeError('원래 요청의 도구 선택이 다릅니다. 입력창에서 새 요청으로 보내 주세요.');
  return saved;
}

/** Narrow both advertised tools and canUseTool's allowlist. No alternate MCP or agent route. */
export function toolsForTurn<T extends { permittedTools: string[]; permittedMcpTools: string[]; permittedAgentTools: string[]; orchestrator?: unknown }>(agent: T, mode: TurnToolMode, audience: DenialAudience = 'neutral'): T {
  if (mode === 'auto') return agent;
  const web = ['WebSearch', 'WebFetch'];
  // Backstop behind requireTurnTools, which already named the cause: reaching here, the
  // permitted set lacks web search for a reason this function cannot see (lesson or 이용권).
  if (!web.every(name => agent.permittedTools.includes(name))) throw new TurnToolModeError(denialCopy({ source: 'unknown', feature: '웹 검색' }, audience));
  return { ...agent, permittedTools: web, permittedMcpTools: [], permittedAgentTools: [], orchestrator: undefined };
}

/** User content survives the Service-owned system prompt replacement. */
export function userTextForTurn(text: string, mode: TurnToolMode): string {
  return mode === 'auto' ? text : `${text}\n\n[이번 요청의 도구 선택: 웹 검색]\n허용된 WebSearch와 WebFetch로 웹 자료를 확인한 뒤 답하세요. 검색하지 못했거나 출처를 확인하지 못했다면 그 사실을 밝히세요. 도구 실행 없이 검색했다고 말하지 마세요.`;
}

/** Only SDK events count; model prose and ordinary Markdown links never enter this record. */
export class WebSearchActivity {
  private readonly calls = new Map<string, 'pending' | 'failed' | 'done'>();
  private readonly denied = new Set<string>();
  observe(event: { kind: string; id?: string; name?: string; allowed?: boolean; isError?: boolean }): void {
    if (!event.id) return;
    if (event.kind === 'tool_use' && ['WebSearch', 'WebFetch'].includes(event.name ?? '') && !this.denied.has(event.id)) this.calls.set(event.id, 'pending');
    else if (event.kind === 'approval' && event.allowed === false && ['WebSearch', 'WebFetch'].includes(event.name ?? '')) { this.denied.add(event.id); this.calls.set(event.id, 'failed'); }
    else if (event.kind === 'tool_result' && this.calls.has(event.id) && !this.denied.has(event.id)) this.calls.set(event.id, event.isError ? 'failed' : 'done');
  }
  completion(citationCount: number): { label: string; state: 'done' | 'error' } | null {
    if ([...this.calls.values()].includes('done')) {
      return citationCount > 0 ? null : { label: '웹 도구 실행은 끝났지만 확인된 출처 링크를 받지 못했습니다.', state: 'done' };
    }
    return this.calls.size
      ? { label: '웹 검색 결과를 확인하지 못했습니다. 확인된 웹 출처가 없습니다.', state: 'error' }
      : { label: '웹 검색을 실행하지 않았습니다. 이번 답변에 확인된 웹 출처가 없습니다.', state: 'error' };
  }
}
