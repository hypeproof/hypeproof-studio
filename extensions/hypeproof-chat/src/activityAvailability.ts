/** REQ-KNOW-68: display only causes supported by transport or access evidence. */
export type ActivityCause = 'auth' | 'expired' | 'ended' | 'paused' | 'exhausted' | 'forbidden' | 'not_started' | 'outage' | 'limited' | 'unknown' | 'revoked';
export interface ActivityUnavailable { cause: ActivityCause; audience: 'solo' | 'classroom' }
export interface FailureEvidence { status?: number; code?: string; type?: string; kind?: string }
export function responseEvidence(status: number, body: string): FailureEvidence {
  let error: unknown;
  try { error = JSON.parse(body)?.error; } catch { /* no unverified reason */ }
  const e = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const safe = (v: unknown) => typeof v === 'string' && /^[a-z_]{1,64}$/.test(v) ? v : undefined;
  return { status, code: safe(e.code), type: safe(e.type) };
}
export function activityFailure(e: FailureEvidence, audience: ActivityUnavailable['audience']): ActivityUnavailable | null {
  const codes = [e.code, e.type, e.kind];
  const has = (...values: string[]) => codes.some(c => c !== undefined && values.includes(c));
  let cause: ActivityCause | undefined;
  if (has('trial_revoked_or_reissued')) cause = 'revoked';
  else if (has('expired', 'token_expired', 'trial_expired')) cause = 'expired';
  else if (has('session_window', 'class_ended')) cause = 'ended';
  else if (has('cohort_paused', 'paused')) cause = 'paused';
  else if (has('budget_exhausted', 'trial_exhausted', 'trial_cost_exhausted', 'exhausted', 'open_trial_daily_cap')) cause = 'exhausted';
  else if (has('session_inactive')) cause = 'not_started';
  else if (e.status === 401 || has('missing', 'wrong_role')) cause = 'auth';
  else if (e.status === 403 || has('not_in_roster', 'other')) cause = 'forbidden';
  else if (e.status === 429) cause = 'limited';
  else if (e.status !== undefined && e.status >= 500 && e.status <= 599) cause = 'outage';
  return cause ? { cause, audience } : null;
}
export function accessFailure(state: string | undefined, audience: ActivityUnavailable['audience']): ActivityUnavailable | null {
  if (state === 'ended' || state === 'paused' || state === 'exhausted') return { cause: state, audience };
  return null;
}
export const ACTIVITY_CAUSE_COPY: Record<ActivityCause, string> = {
  revoked: '이 참여 코드는 취소되었거나 다시 발급되어 더 이상 AI를 실행할 수 없습니다.',
  unknown: 'AI 실행을 완료하지 못했습니다. 원인이 확인되지 않아 담당자의 확인이 필요합니다.',
  auth: '참여 인증을 확인하지 못해 AI를 실행할 수 없습니다. 참여 코드를 확인해 주세요.',
  expired: '참여 인증의 이용 기간이 끝나 AI를 실행할 수 없습니다.',
  ended: '이 활동의 이용 시간이 끝나 AI를 실행할 수 없습니다.',
  paused: '활동이 일시정지되어 새 AI 실행을 할 수 없습니다.',
  exhausted: '이 활동에 배정된 AI 자원을 모두 사용했습니다.',
  forbidden: '현재 참여·수업·이용 정책에서 AI 실행을 허용하지 않습니다. 담당자의 확인이 필요합니다.',
  not_started: '현재 열린 수업이 없어 AI를 실행할 수 없습니다. 강사에게 수업 시작을 확인해 주세요.',
  outage: '서비스에 연결하지 못해 AI를 실행할 수 없습니다. 잠시 후 연결을 다시 확인해 주세요.',
  limited: 'AI 요청이 일시적으로 제한되었습니다. 잠시 후 다시 시도해 주세요. 자원 소진 여부는 확인되지 않았습니다.',
};
