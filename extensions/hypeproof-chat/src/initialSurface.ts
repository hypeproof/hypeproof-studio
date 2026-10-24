import { looksLikeIssuerTokenUnverified } from './chatPanelHelpers';
import type { ActivityRecord } from './activityConnections';
import type { resumeDecision } from './studioNavigation';

/** A saved instructor credential never overrides a validated learner resume. */
export function resolveActivateBranch(storedIssuer: string | undefined, resume: boolean): 'resume' | 'skip' | 'show' {
  if (resume) return 'resume';
  if (storedIssuer && looksLikeIssuerTokenUnverified(storedIssuer)) return 'skip';
  return 'show';
}

/** Initial host surface only: no credential mutation, folder transition or AI turn. */
export async function restoreInitialSurface(host: {
  getStoredIssuer(): PromiseLike<string | undefined>;
  decision: ReturnType<typeof resumeDecision>;
  connections(): { current: ActivityRecord | undefined; matchesService: boolean } | undefined;
  notifyExpired(message: string): unknown;
  notifyMismatch(message: string): unknown;
  showStart(options?: { deferProfileUntilEntry: true }): PromiseLike<unknown>;
  ensureProfile(): PromiseLike<unknown>;
  openChat(): PromiseLike<unknown>;
}): Promise<void> {
  let storedIssuer: string | undefined;
  try { storedIssuer = await host.getStoredIssuer(); }
  catch {
    // An unreadable credential is not an absent credential. Keep the entry surface
    // available without resuming a connection or silently discarding saved secrets.
    void host.notifyMismatch('저장된 로그인 정보를 읽지 못했습니다. 기존 연결과 파일은 보존됩니다. 잠시 뒤 앱을 다시 열어 주세요.');
    await host.showStart({ deferProfileUntilEntry: true });
    return;
  }
  const decision = host.decision;
  const record = host.connections()?.current;
  if (decision === 'expired') void host.notifyExpired('폴더 전환 확인 시간이 지났습니다. 저장된 활동에서 이어가세요. 작업 파일과 연결은 보존됩니다.');
  if (decision === 'mismatch') void host.notifyMismatch('폴더 전환 정보가 현재 활동·서버·폴더와 일치하지 않습니다. 저장된 활동을 확인해 주세요.');
  const bound = record && host.connections()?.matchesService;
  const branch = resolveActivateBranch(storedIssuer, decision === 'valid' || (decision === 'absent' && !!bound));
  if (branch === 'resume') {
    await host.showStart();
    // Revalidate the saved credential before resuming. This never dispatches an AI turn.
    if (await host.ensureProfile()) await host.openChat();
  } else if (branch !== 'skip') {
    await host.showStart(decision === 'expired' || decision === 'mismatch' ? { deferProfileUntilEntry: true } : undefined);
  }
}
