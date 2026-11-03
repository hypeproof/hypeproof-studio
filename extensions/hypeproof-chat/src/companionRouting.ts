/** DMC-04/05/07/12: navigation advice only, never an execution authorization. */
export const COMPANION_CAPABILITIES = [
  'read_cached', 'edit_draft', 'create_web', 'build_web', 'edit_desktop',
] as const;
export type CompanionCapability = typeof COMPANION_CAPABILITIES[number];

export interface CompanionRouteInput {
  request: { workspaceId: string; projectId: string; version: number; capability: CompanionCapability };
  /** Supplied by the host policy adapter, never accepted as a mobile-auth claim. */
  context: {
    workspaceId: string; projectId: string; version: number;
    access: 'active' | 'expired' | 'revoked';
    host: 'online' | 'offline' | 'unknown';
    allowedCapabilities: readonly CompanionCapability[];
  } | null;
}

export type CompanionRoute = 'setup_required' | 'denied' | 'review_version'
  | 'local_mobile' | 'renew_connection' | 'wait_for_host' | 'host_execution' | 'desktop_handoff';
export interface CompanionRouteDecision {
  route: CompanionRoute;
  message: string;
  /** This planner cannot release a tool call or authorize a side effect. */
  executionAuthorized: false;
}

const decision = (route: CompanionRoute, message: string): CompanionRouteDecision =>
  ({ route, message, executionAuthorized: false });
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const version = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const capability = (value: unknown): value is CompanionCapability =>
  typeof value === 'string' && (COMPANION_CAPABILITIES as readonly string[]).includes(value);

/** Reject malformed context rather than interpreting unknown state as connected. */
export function planCompanionRoute(input: CompanionRouteInput): CompanionRouteDecision {
  const request = input?.request;
  if (!request || !identifier(request.workspaceId) || !identifier(request.projectId)
    || !version(request.version) || !capability(request.capability)) {
    return decision('denied', '요청을 확인하지 못했습니다. 작업을 다시 열어 주세요.');
  }
  const context = input.context;
  if (context === null) {
    return decision('setup_required', '컴퓨터에서 작업 공간을 준비하고 이 기기를 연결해 주세요.');
  }
  if (!context || !identifier(context.workspaceId) || !identifier(context.projectId)
    || !version(context.version) || !['active', 'expired', 'revoked'].includes(context.access)
    || !['online', 'offline', 'unknown'].includes(context.host)
    || !Array.isArray(context.allowedCapabilities) || !context.allowedCapabilities.every(capability)) {
    return decision('denied', '연결 정보를 확인하지 못했습니다. 다시 연결해 주세요.');
  }
  // Denial precedes offline/desktop routing: changing surfaces cannot widen access.
  if (context.access === 'revoked' || request.workspaceId !== context.workspaceId
    || request.projectId !== context.projectId
    || !context.allowedCapabilities.includes(request.capability)) {
    return decision('denied', '이 작업에 접근할 수 없습니다. 연결과 허용된 작업을 확인해 주세요.');
  }
  if (request.version !== context.version) {
    return decision('review_version', '작업 버전이 달라졌습니다. 최신 내용을 확인한 뒤 이어가 주세요.');
  }
  // Expired network authentication does not by itself erase an already authorized
  // local cache/draft. The adapter separately enforces shared-device local access.
  if (request.capability === 'read_cached' || request.capability === 'edit_draft') {
    return decision('local_mobile', '이 기기에 있는 자료를 보거나 초안을 작성할 수 있어요.');
  }
  if (context.access === 'expired') {
    return decision('renew_connection', '실행하려면 연결을 갱신해 주세요. 새 요청은 아직 실행되지 않았어요.');
  }
  if (context.host !== 'online') {
    return decision('wait_for_host', '컴퓨터 연결을 기다리고 있어요. 새 요청은 아직 실행되지 않았어요.');
  }
  if (request.capability === 'edit_desktop') {
    return decision('desktop_handoff', '이 작업은 컴퓨터에서 이어갈 수 있어요. 같은 작품과 수정 요청을 확인해 주세요.');
  }
  return decision('host_execution', '연결된 컴퓨터에서 처리하고, 이 화면에서 결과를 확인할 수 있어요.');
}
