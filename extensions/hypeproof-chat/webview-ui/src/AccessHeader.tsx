import type { ChatConfig } from '../../src/protocol';
import { stateLabels } from './AccessControl';

/**
 * REQ-L9 / CGP-SHELL-R-029: before sending, a pass or class seat sees the remaining requests of the
 * selected funding source and when Service confirmed that number (DEC-35: pass and class seats;
 * never a free seat).
 *
 * The line only states what the host actually holds. There is no "checking" state: the host does
 * not tell the webview a request is in flight, so a "확인 중" here could never resolve.
 * - Free seats (activity.free or studio-open-trial): no line, whatever the access data says.
 * - No access state, access contracts off (`configured:false`), or no source chosen: no line.
 *   The host never auto-selects a source, and AccessControl explains those states.
 * - Service could not be reached, or the ledger is missing/invalid: "미확인" (as AccessControl says).
 * - A selected source that cannot be used now (not `available`, or a state other than `ready`)
 *   shows no count: the usage panel's state word (ended, exhausted, paused, review_required, ...)
 *   or, when the panel itself would say "사용 가능", no line.
 * - Class/organisation funding is named and shows its own remaining count and nothing else.
 */
export function AccessHeader({ config }: { config: ChatConfig | null | undefined }) {
  if (!config || config.activity?.free || config.profile?.profile_id === 'studio-open-trial') return null;
  const access = config.access;
  if (!access) return null;
  const classroom = config.activity?.kind === 'classroom' || config.profile?.activity_kind === 'classroom';
  // The seats DEC-35 covers. Any other seat gets a line only once Service names its source.
  const covered = classroom || !!(config.activity?.pass || config.profile?.pass);
  if (access.status !== 'ready') return covered ? <Line parts={['남은 요청 미확인']} /> : null;
  const view = access.view;
  if (!view || view.configured !== true || !access.selected) return null;
  const choice = view.choices.find(item => item.id === access.selected);
  if (!choice) return null;
  const classSource = choice.source_kind === 'cohort' || choice.source_kind === 'organization';
  if (!classSource && choice.source_kind !== 'account') return covered ? <Line parts={['남은 요청 미확인']} /> : null;
  const confirmed = view.as_of;
  const validTime = typeof confirmed === 'string' && Number.isFinite(Date.parse(confirmed));
  const time = validTime ? new Date(confirmed).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit', hour12: false }) : null;
  const named = classSource ? ['수업·기관 지원'] : [];
  if (choice.state !== 'ready') {
    // Service refuses a send from this source: name its state, never a count it will not honour.
    return <Line parts={[...named, stateLabels[choice.state] ?? '상태 미확인', ...(time ? [`${time} 확인`] : [])]} />;
  }
  // `ready` but not available: the panel would still say "사용 가능", which is not true; say nothing.
  if (choice.available !== true) return null;
  const meters = choice.resources.filter(item => item.meter === 'requests:count');
  const meter = meters.length === 1 ? meters[0] : undefined;
  const n = (value: number) => value.toLocaleString('ko-KR');
  if (classSource) {
    // A class source shows its own remaining count only: no limit, use, reservation or personal number.
    if (!meter || !Number.isSafeInteger(meter.remaining) || meter.remaining < 0 || !time) return <Line parts={[...named, '남은 요청 미확인']} />;
    return <Line parts={[...named, `${meter.shared ? '함께 쓰는 ' : ''}남은 요청 ${n(meter.remaining)}회`, `${time} 확인`]} />;
  }
  const validCount = !!meter && (['remaining', 'held', 'unresolved'] as const).every(key => Number.isSafeInteger(meter[key]) && meter[key] >= 0);
  if (!meter || !validCount || !time) return <Line parts={['남은 요청 미확인']} />;
  return <Line parts={[`남은 요청 ${n(meter.remaining)}회`, `${time} 확인`, `예약 ${n(meter.held)}회`, `미확인 ${n(meter.unresolved)}건`]} />;
}

/**
 * Each part stays whole (its separator travels with it); the space after a separator is the only
 * place the line wraps, so on a narrow heading it breaks between parts, never inside one.
 */
function Line({ parts }: { parts: string[] }) {
  const text = parts.join(' · ');
  return <span className="hps-access-header" role="status" title={text}>
    {parts.map((part, i) => <span key={i}>{i ? ' ' : ''}<span className="hps-access-part">{part}{i < parts.length - 1 ? ' ·' : ''}</span></span>)}
  </span>;
}
