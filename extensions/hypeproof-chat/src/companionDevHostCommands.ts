/** Explicit native DEV gestures. The supplied owner retains all authority and cipher lifecycle. */
import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import type { CompanionHostRequest } from './companionHostDispatch.ts';
import type { CompanionHostTurn } from './companionHostSession.ts';
import type { CompanionSelectionPublication } from './companionSelection.ts';

export const DEV_COMPANION_HOST_COMMAND = 'hypeproofChat.devCompanionHost';
export interface CompanionDevHostCommandView {
  state: 'idle' | 'inviting' | 'claimed' | 'approved' | 'connected' | 'closed' | 'revoked';
  comparisonCode?: string;
  executionAuthorized: false;
  publication?: Readonly<CompanionSelectionPublication>;
}
/** Structural port implemented by CompanionDevHostOwner; no account or key material crosses it. */
export interface CompanionDevHostCommandOwner {
  view(): Readonly<CompanionDevHostCommandView>;
  startInvitation(signal?: AbortSignal): Promise<{ challenge: object; view: Readonly<CompanionDevHostCommandView> }>;
  inspectClaim(signal?: AbortSignal): Promise<Readonly<CompanionDevHostCommandView>>;
  confirmComparedCode(code: string, signal?: AbortSignal): Promise<Readonly<CompanionDevHostCommandView>>;
  connectCipher(signal?: AbortSignal): Promise<Readonly<CompanionDevHostCommandView>>;
  describeSelected(requestId: string, signal?: AbortSignal): Promise<CompanionHostRequest | null>;
  publishSelected(requestId:string,signal?:AbortSignal):Promise<Readonly<CompanionSelectionPublication>>;
  receiveAndHandle(signal?: AbortSignal): Promise<CompanionHostTurn>;
  close(): void;
  revoke(signal?: AbortSignal): Promise<Readonly<CompanionDevHostCommandView>>;
}
export interface CompanionDevHostCommandPorts {
  createOwner(signal?: AbortSignal): CompanionDevHostCommandOwner | Promise<CompanionDevHostCommandOwner>;
  /** Required account/configuration/task/workspace lifecycle invalidation supplied by the native caller. */
  onDidInvalidate(listener: () => void): vscode.Disposable;
}
type Action = 'prepare' | 'copy' | 'inspect' | 'compare' | 'connect' | 'describe' | 'publish' | 'receive' | 'close' | 'revoke';
interface Item extends vscode.QuickPickItem { action: Action }
const labels: Record<CompanionDevHostCommandView['state'], string> = {
  idle: '초대 전', inviting: '기기 참여 기다리는 중', claimed: '기기 참여 확인 · 코드 비교 필요',
  approved: '코드 확인 완료 · 암호화 연결 전', connected: '암호화 연결됨 · 파일 읽기는 별도 승인',
  closed: '이 컴퓨터 연결 닫힘', revoked: '연결 권한 철회 확인됨',
};
const terminal = (v: CompanionDevHostCommandView) => v.state === 'closed' || v.state === 'revoked';
const codeText = (v: CompanionDevHostCommandView) => typeof v.comparisonCode === 'string'
  && /^[A-Za-z0-9 -]{4,64}$/.test(v.comparisonCode) ? v.comparisonCode : undefined;
const safeId = (value: string) => /^[A-Za-z0-9._:-]{1,96}$/.test(value) ? value : '확인된 선택';

/** Registers only in an actual Development host; contributes no manifest/product entry. */
export function registerDevCompanionHostCommands(
  context: Pick<vscode.ExtensionContext, 'extensionMode' | 'subscriptions'>,
  ports: CompanionDevHostCommandPorts,
): vscode.Disposable {
  if (context.extensionMode !== vscode.ExtensionMode.Development) return new vscode.Disposable(() => {});
  let owner: CompanionDevHostCommandOwner | undefined;
  let challenge: object | undefined;
  let generation = 0, disposed = false;
  type Lease = { generation: number; controller: AbortController };
  let running: Lease | undefined;
  const stopped = Symbol('stale companion host action');
  const close = (target: CompanionDevHostCommandOwner | undefined) => {
    try { target?.close(); } catch { /* Local invalidation stays terminal even if an injected hook fails. */ }
  };
  const invalidate = () => {
    generation++;
    const prior = running; running = undefined;
    prior?.controller.abort();
    const priorOwner = owner; owner = undefined; challenge = undefined;
    close(priorOwner);
  };
  const lifecycle = ports.onDidInvalidate(invalidate);
  const registration = vscode.commands.registerCommand(DEV_COMPANION_HOST_COMMAND, async () => {
    if (disposed || context.extensionMode !== vscode.ExtensionMode.Development) return;
    if (running) {
      await vscode.window.showInformationMessage('지금 진행 중인 확인이 끝난 뒤 다시 열어 주세요.');
      return;
    }
    const lease: Lease = { generation, controller: new AbortController() }; running = lease;
    const live = () => !disposed && running === lease && generation === lease.generation
      && !lease.controller.signal.aborted && context.extensionMode === vscode.ExtensionMode.Development;
    const check = () => { if (!live()) throw stopped; };
    const show = async (message: string) => { check(); await vscode.window.showInformationMessage(message); check(); };
    const progress = async <T>(work: () => Promise<T>): Promise<T> => vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification, title: '모바일 보기 연결 확인 중', cancellable: true,
    }, async (_progress, cancellation) => {
      const listener = cancellation.onCancellationRequested(() => { if (live()) invalidate(); });
      try { check(); const value = await work(); check(); return value; }
      finally { listener.dispose(); }
    });
    try {
      const view = owner?.view();
      const items: Item[] = [];
      if (!view || terminal(view) || view.state === 'idle') items.push({ label: '새 기기 초대 준비', action: 'prepare' });
      else {
        if (challenge && ['inviting', 'claimed'].includes(view.state)) items.push({ label: '초대 정보 복사', description: '직접 선택할 때만 클립보드에 복사', action: 'copy' });
        if (['inviting', 'claimed'].includes(view.state)) items.push({ label: '기기 참여와 비교 코드 확인', action: 'inspect' });
        if (view.state === 'claimed') items.push({ label: '두 화면의 코드 직접 확인', action: 'compare' });
        if (view.state === 'approved') items.push({ label: '암호화 연결 준비', action: 'connect' });
        if (view.state === 'connected') {
          items.push({ label: '현재 작업과 저장된 HTML 확인', action: 'describe' });
          items.push({ label: '선택한 작업을 휴대폰에 알리기', description: view.publication?.state==='delivery_unconfirmed'?'같은 알림을 직접 다시 확인 · 파일 승인은 별도':'작업 정보만 암호화해 전달 · 파일 승인은 별도', action:'publish' });
          items.push({ label: '요청 한 번 받기·확인', description: '자동 수신하지 않음 · 파일 읽기와 초안 가져오기는 별도 확인', action: 'receive' });
        }
        items.push({ label: '이 컴퓨터에서만 연결 닫기', description: '서버 권한 철회와 별개', action: 'close' });
        items.push({ label: '이 기기의 연결 권한 철회', description: '서버에 서명된 철회 요청', action: 'revoke' });
      }
      const picked = await vscode.window.showQuickPick(items, {
        title: `모바일 보기 연결 (DEV) · ${view ? labels[view.state] : '초대 전'}`,
        placeHolder: '컴퓨터 원본은 유지돼요. 기기 연결은 파일 실행 권한을 주지 않아요.', ignoreFocusOut: true,
      });
      check(); if (!picked) return;
      if (picked.action === 'prepare') {
        await progress(async () => {
          const created = await ports.createOwner(lease.controller.signal);
          if (!live()) { close(created); throw stopped; }
          close(owner); owner = created; challenge = undefined;
          const started = await created.startInvitation(lease.controller.signal); check();
          challenge = started.challenge;
        });
        await show('초대를 준비했어요. 초대 정보는 ‘초대 정보 복사’를 직접 선택해야 복사돼요.');
        return;
      }
      const target = owner; if (!target) throw stopped;
      if (picked.action === 'copy') {
        if (!challenge || !['inviting', 'claimed'].includes(target.view().state)) throw stopped;
        await vscode.env.clipboard.writeText(JSON.stringify(challenge)); check();
        await show('초대 정보를 복사했어요. 연결할 기기에만 직접 전달해 주세요.');
      } else if (picked.action === 'inspect') {
        const inspected = await progress(() => target.inspectClaim(lease.controller.signal));
        const code = codeText(inspected);
        await show(inspected.state === 'claimed' && code ? `기기 참여를 확인했어요. 컴퓨터 비교 코드: ${code}. 휴대기기 화면과 직접 비교해 주세요. 아직 승인하지 않았어요.` : '기기 참여가 아직 확인되지 않았어요. 필요할 때 다시 확인해 주세요.');
      } else if (picked.action === 'compare') {
        const inspected = await progress(() => target.inspectClaim(lease.controller.signal));
        const code = codeText(inspected);
        if (inspected.state !== 'claimed' || !code) { await show('비교할 기기 참여를 확인하지 못했어요. 다시 확인해 주세요.'); return; }
        const entered = await vscode.window.showInputBox({ title: `컴퓨터 비교 코드: ${code}`, prompt: '휴대기기 화면의 비교 코드를 직접 입력하고 두 화면이 같은지 확인해 주세요.', ignoreFocusOut: true,
          validateInput: value => value.length > 0 && value.length <= 64 ? undefined : '휴대기기에 표시된 비교 코드를 입력해 주세요.' });
        check(); if (entered === undefined) return;
        const confirmed = await vscode.window.showWarningMessage('두 화면의 비교 코드가 같은지 직접 확인했나요? 이 확인은 기기 연결만 승인하며 파일 읽기는 별도 승인이 필요해요.', { modal: true }, '두 화면의 코드가 같아요');
        check(); if (confirmed !== '두 화면의 코드가 같아요') return;
        await progress(() => target.confirmComparedCode(entered, lease.controller.signal));
        await show('기기 연결 코드 확인을 마쳤어요. 암호화 연결은 별도로 준비해 주세요.');
      } else if (picked.action === 'connect') {
        const connected = await progress(() => target.connectCipher(lease.controller.signal));
        await show(connected.state === 'connected' ? '암호화 연결을 준비했어요. 요청은 ‘요청 한 번 받기·확인’을 선택할 때만 받아요.' : '암호화 연결 완료를 확인하지 못했어요. 연결 상태를 다시 확인해 주세요.');
      } else if (picked.action === 'describe') {
        const selected = await progress(() => target.describeSelected(randomUUID(), lease.controller.signal));
        await show(selected ? `현재 작업: ${safeId(selected.taskId)} (버전 ${selected.version}). 저장된 HTML: ${safeId(selected.artifactId)} (파일 버전 ${selected.artifactVersion.slice(0, 12)}). 내용을 읽거나 요청을 실행하지 않았어요.` : '현재 선택된 저장 HTML을 확인하지 못했어요. 컴퓨터에서 작업과 파일 선택을 먼저 확인해 주세요.');
      } else if (picked.action === 'receive') {
        const turn = await progress(() => target.receiveAndHandle(lease.controller.signal));
        await show(turn.state === 'closed' ? '연결이 닫혀 이번 확인을 마치지 못했어요.'
          : `이번 수신 확인: 처리 ${turn.processed}건, 전송 확인 ${turn.acknowledged}건, 전송 만료 ${turn.expired}건, 대기 ${turn.pending}건.${turn.state === 'waiting' ? ' 연결 또는 확인이 아직 끝나지 않았어요.' : ''} 자동으로 다음 확인을 시작하지 않아요.`);
      } else if(picked.action==='publish'){
        const prior=target.view().publication;
        const published=await progress(()=>target.publishSelected(prior?.state==='delivery_unconfirmed'?prior.requestId:randomUUID(),lease.controller.signal));
        await show(published.state==='transport_accepted'?'작업 정보 전송을 서버가 접수했어요. 휴대폰 수신과 파일 전달 승인은 아직 확인하지 않았어요.':'작업 정보 전달 결과를 아직 확인하지 못했어요. 같은 알림을 다시 확인하려면 직접 선택해 주세요. 파일 전달 승인은 별도예요.');
      } else if (picked.action === 'close') {
        const confirmed = await vscode.window.showWarningMessage('이 컴퓨터의 연결과 암호화 키를 닫을까요? 서버 권한 철회와 별개이며 이미 승인한 작업을 되돌리지 않아요.', { modal: true }, '이 컴퓨터 연결 닫기');
        check(); if (confirmed !== '이 컴퓨터 연결 닫기') return;
        invalidate();
        await vscode.window.showInformationMessage('이 컴퓨터의 연결을 닫았어요. 서버의 연결 권한 철회는 확인하지 않았어요.');
      } else if (picked.action === 'revoke') {
        const confirmed = await vscode.window.showWarningMessage('이 기기의 연결 권한을 서버에 철회 요청할까요? 컴퓨터 원본은 유지되며 이미 승인한 작업을 되돌리지 않아요.', { modal: true }, '연결 권한 철회 요청');
        check(); if (confirmed !== '연결 권한 철회 요청') return;
        const revoked = await progress(() => target.revoke(lease.controller.signal));
        await show(revoked.state === 'revoked' ? '이 기기의 연결 권한 철회를 확인했어요.' : '서버 권한 철회를 확인하지 못했어요. 철회 완료로 표시하지 않았어요.');
      }
    } catch (error) {
      if (error !== stopped && live()) await vscode.window.showErrorMessage('이번 연결 확인을 마치지 못했어요. 완료나 권한 철회로 표시하지 않았어요. 현재 연결 상태를 확인한 뒤 직접 다시 시도해 주세요.');
    } finally { if (running === lease) running = undefined; }
  });
  const disposable = new vscode.Disposable(() => {
    if (disposed) return;
    disposed = true; invalidate(); lifecycle.dispose(); registration.dispose();
  });
  context.subscriptions.push(disposable);
  return disposable;
}
