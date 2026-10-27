import {
  companionDigest, companionKey, companionScope, companionState, inspectCompanionWorkspace,
  type CompanionPreparation, type CompanionScope, type CompanionState,
} from './companionWorkspace.ts';

export interface CompanionWorkspaceHost {
  scope(): CompanionScope | undefined;
  verify(scope: CompanionScope): Promise<boolean>;
  get(key: string): unknown;
  update(key: string, value: CompanionPreparation): PromiseLike<void>;
  selectFolder(): Promise<string | undefined>;
  confirm(detail: string): Promise<boolean>;
  show(state: CompanionState, detail: string): Promise<void>;
  now(): number;
}

/** Native UI and persistence share one scope snapshot, rechecked after each user interaction. */
export class CompanionWorkspaceController {
  private busy = false;
  private readonly host: CompanionWorkspaceHost;
  constructor(host: CompanionWorkspaceHost) { this.host = host; }
  async run(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try { await this.prepare(); }
    catch { await this.host.show({ status: 'BLOCKED', message: '준비 정보를 저장하거나 확인하지 못했어요. 원본 파일과 기존 기록은 보존돼요.' }, '다시 작업 폴더와 활동을 확인해 주세요.'); }
    finally { this.busy = false; }
  }
  private unchanged(scope: CompanionScope): boolean {
    const current = this.host.scope();
    return !!current && JSON.stringify(current) === JSON.stringify(scope);
  }
  private async prepare(): Promise<void> {
    const scope = this.host.scope();
    const stored = scope ? this.host.get(companionKey(scope)) : undefined;
    const state = await companionState(scope, stored);
    if (!scope || state.status !== 'UNPAIRED') { await this.host.show(state, state.message); return; }
    if (!await this.host.verify(scope)) throw new Error('activity binding changed');
    const detail = [
      `작업 폴더 (로컬 저장): ${scope.workspace}`,
      `현재 활동: ${scope.activityLabel}`,
      `컴퓨터: ${scope.hostLabel}`,
      '이 설정은 현재 컴퓨터의 활동 범위에만 적용돼요. 교실 이름이나 폴더 선택은 다른 사용자의 접근 권한을 주지 않아요.',
      '지원 범위: 로컬 준비 정보 저장·다시 확인. 휴대폰 연결·파일 전달·원격 실행은 아직 지원하지 않아요.',
      '파일 내용은 읽거나 업로드하지 않아요. 기존 대화와 파일은 그대로 보존돼요.',
    ].join('\n\n');
    if (state.preparation) { await this.host.show(state, detail); return; }
    const selected = await this.host.selectFolder();
    if (!selected) return;
    if (!this.unchanged(scope) || !await this.host.verify(scope)) throw new Error('scope changed');
    await inspectCompanionWorkspace(selected, scope);
    if (!await this.host.confirm(detail)) return;
    if (!this.unchanged(scope) || !await this.host.verify(scope)) throw new Error('scope changed');
    await inspectCompanionWorkspace(selected, scope);
    // Do not replace a preparation that appeared while the modal was open, even if corrupt.
    if (this.host.get(companionKey(scope)) !== undefined) throw new Error('metadata changed');
    const prepared: CompanionPreparation = {
      version: 1, scope: companionScope(scope), workspace: scope.workspace,
      projectId: companionDigest(companionScope(scope)), activityId: scope.activityId,
      hostId: scope.hostId, preparedAt: this.host.now(),
    };
    await this.host.update(companionKey(scope), prepared);
    if (!this.unchanged(scope) || !await this.host.verify(scope)) throw new Error('scope changed');
    const after = await companionState(scope, this.host.get(companionKey(scope)));
    if (!after.preparation) throw new Error('metadata persistence failed');
    await this.host.show(after, detail);
  }
}
