import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ACTIVITY_CAUSE_COPY, ACTIVITY_CAUSE_HEADLINE, TAKEAWAY_CAUSES, type ActivityUnavailable } from '../../src/activityAvailability';
/**
 * REQ-KNOW-68 / CGP-KNOW-D-036: the activity status screen. ChatPanel draws it in the composer area
 * (the input card is hidden, the draft is kept) instead of a banner in the message list: a one-line
 * cause headline, the evidenced sentence, "아직 할 수 있는 것" with one button per local action, and a
 * "다시 쓰려면" contact line. Nothing here buys anything; the solo trial card arrives as children.
 */
export function ActivityStatus({ status, onOpen, onExport, onRecover, onSupport, onToken, onTakeaway, children }: {
  status: ActivityUnavailable; onOpen: () => void; onExport: () => void; onRecover: () => void; onSupport: () => void; onToken?: () => void; onTakeaway?: () => void; children?: ReactNode;
}) {
  const headingId = useId();
  const headline = ACTIVITY_CAUSE_HEADLINE[status.cause] ?? ACTIVITY_CAUSE_HEADLINE.unknown;
  // The live region exists empty first and is filled after mount, so assistive technology announces the
  // screen when it appears (a region inserted together with its text is often read silently).
  const [announced, setAnnounced] = useState('');
  useEffect(() => {
    setAnnounced('');
    const timer = setTimeout(() => setAnnounced(`지금은 AI를 사용할 수 없습니다. ${headline}`), 100);
    return () => clearTimeout(timer);
  }, [headline]);
  // The composer card is hidden while this screen shows; if focus was in it (or nowhere), move it to the headline.
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const active = typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null;
    if (!active || active === document.body || active.closest?.('.hps-input[hidden]')) headingRef.current?.focus?.({ preventScroll: true });
  }, []);
  const takeaway = onTakeaway && TAKEAWAY_CAUSES.includes(status.cause);
  const token = (status.cause === 'auth' || status.cause === 'expired') && onToken;
  return <section className="hps-activity-status" aria-label="AI 이용 상태" aria-describedby={headingId} data-testid="activity-status">
    <p className="hps-sr-only" role="status" aria-live="polite" data-testid="activity-status-announcer">{announced}</p>
    <h3 id={headingId} ref={headingRef} tabIndex={-1} className="hps-activity-status-headline">{headline}</h3>
    <p>{ACTIVITY_CAUSE_COPY[status.cause] ?? ACTIVITY_CAUSE_COPY.unknown} 새 AI 요청은 실행되지 않습니다.</p>
    <h4 className="hps-activity-status-subhead">아직 할 수 있는 것</h4>
    <ul className="hps-activity-status-can">
      <li><span>이 컴퓨터에 저장된 내 파일을 열고 편집·저장할 수 있습니다.</span><button type="button" onClick={onOpen}>내 파일 열기</button></li>
      <li><span>내 파일을 새 이름으로 다른 곳에 저장할 수 있습니다.</span><button type="button" onClick={onExport}>내 파일 내보내기</button></li>
      {takeaway && <li><span>이 활동에서 만든 작업을 내 컴퓨터로 가져갈 수 있습니다.</span><button type="button" onClick={onTakeaway}>내 작업 가져가기</button></li>}
      {token && <li><span>참여 코드를 다시 확인할 수 있습니다.</span><button type="button" onClick={onToken}>참여 코드 확인</button></li>}
    </ul>
    <p className="hps-activity-status-contact"><strong>다시 쓰려면</strong> {status.audience === 'classroom' ? '강사에게 활동 상태와 참여 코드를 확인해 주세요. 서비스 장애는 HypeProof 지원팀에 문의해 주세요.' : 'HypeProof 지원팀에 이용 상태를 문의해 주세요.'}</p>
    <div className="hps-activity-status-actions">
      <button type="button" onClick={onRecover}>상태 다시 확인</button>
      <button type="button" onClick={onSupport}>HypeProof 지원 문의</button>
    </div>
    {status.audience === 'solo' && children}
  </section>;
}
