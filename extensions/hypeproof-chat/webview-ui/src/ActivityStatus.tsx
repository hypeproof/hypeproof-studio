import type { ReactNode } from 'react';
import { ACTIVITY_CAUSE_COPY, type ActivityUnavailable } from '../../src/activityAvailability';
export function ActivityStatus({ status, onOpen, onExport, onRecover, onSupport, onToken, children }: {
  status: ActivityUnavailable; onOpen: () => void; onExport: () => void; onRecover: () => void; onSupport: () => void; onToken?: () => void; children?: ReactNode;
}) {
  return <section className="hps-activity-status" role="status" aria-label="AI 이용 상태">
    <h3>지금은 AI를 사용할 수 없습니다</h3>
    <p>{ACTIVITY_CAUSE_COPY[status.cause] ?? ACTIVITY_CAUSE_COPY.unknown}</p>
    <p>이 컴퓨터에 저장된 내 파일은 계속 열고 편집·저장·내보내기 할 수 있습니다. 새 AI 요청은 실행되지 않습니다.</p>
    <p>{status.audience === 'classroom' ? '문의: 강사에게 활동 상태와 참여 코드를 확인해 주세요. 서비스 장애는 HypeProof 지원팀에 문의해 주세요.' : '문의: HypeProof 지원팀에서 이용 상태를 확인할 수 있습니다.'}</p>
    <div className="hps-activity-status-actions">
      <button type="button" onClick={onOpen}>내 파일 열기</button>
      <button type="button" onClick={onExport}>내 파일 내보내기</button>
      {(status.cause === 'auth' || status.cause === 'expired') && onToken && <button type="button" onClick={onToken}>참여 코드 확인</button>}
      <button type="button" onClick={onRecover}>상태 다시 확인</button>
      <button type="button" onClick={onSupport}>HypeProof 지원 문의</button>
    </div>
    {status.audience === 'solo' && children}
  </section>;
}
