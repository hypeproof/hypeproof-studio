import { useEffect, useId, useRef, useState } from 'react';
import type { ChatConfig, WebviewMessage } from '../../src/protocol';
import { PolicyRequestForm, lowAllowance } from './AccessControl';

/**
 * CGP-SHELL-R-030 (Jay, 2026-11-16) — "선생님께 더 요청하기" where the learner meets the problem. When the class allowance has
 * run out, or is too low to send (10% or less of a metered allowance), the chat shows one card: "AI를 더 쓰려면 선생님께
 * 요청할 수 있어요" and a large 요청하기 button. The button opens the Service's fixed reasons (no text field on a minor seat;
 * an adult keeps the optional note of at most 200), and sending uses the existing request (hypeproof-service#544). Its
 * states read plainly in the same card: pending, the 10-minute repeat block, the instructor's answer. No token or meter
 * figure is shown here, for any seat; the usage panel keeps them for adults and instructors.
 */
export function BudgetRequestCard({ config, post }: { config: ChatConfig; post: (m: WebviewMessage) => void }) {
  const a = config.access, choice = a?.view?.choices.find(c => c.id === a?.selected);
  const [open, setOpen] = useState(false);
  // The clock is read on every render (a new policy may arrive at any time); the timer only re-renders at the end.
  const [, setTick] = useState(0);
  const now = Date.now();
  const headingId = useId();
  const requestButton = useRef<HTMLButtonElement>(null);
  const policy = choice?.request_policy;
  const until = policy?.cooldown_until ?? null;
  const cooling = until !== null && until > now;
  useEffect(() => { if (!cooling) return; const t = setTimeout(() => setTick(n => n + 1), Math.min(until! - Date.now() + 50, 600_000)); return () => clearTimeout(t); });
  const pending = choice?.pending_request?.state === 'pending';
  // A new pending request closes the picker; the card then says so.
  useEffect(() => { if (pending) setOpen(false); }, [pending]);
  if (a?.status !== 'ready' || !choice || !choice.can_request || !policy) return null;
  if (!pending && !cooling && !lowAllowance(choice)) return null;
  const resolved = choice.pending_request && choice.pending_request.state !== 'pending' ? choice.pending_request : null;
  const state = pending ? '요청했어요 · 선생님 확인 기다리는 중'
    : cooling ? `방금 요청했어요. ${new Date(until!).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 이후에 다시 요청할 수 있어요.`
    : '';
  return <section className="hps-request-card" aria-labelledby={headingId} data-request-card="">
    <h3 id={headingId} className="hps-request-card-title">AI를 더 쓰려면 선생님께 요청할 수 있어요</h3>
    <p className="hps-request-card-state" role="status" aria-live="polite" data-request-state="">{state}</p>
    {resolved && !pending && <p className="hps-request-card-answer" data-request-answer="">선생님이 확인했어요{resolved.resolution ? `: ${resolved.resolution}` : '.'}</p>}
    {!pending && !cooling && (open
      ? <div className="hps-request-card-form hps-budget-request-notice">
          <PolicyRequestForm policy={policy} post={post} submitLabel="보내기" onCancel={() => { setOpen(false); requestAnimationFrame(() => requestButton.current?.focus()); }} />
        </div>
      : <button ref={requestButton} type="button" className="hps-request-card-open" data-request-open="" onClick={() => setOpen(true)}>요청하기</button>)}
  </section>;
}
