/** Native controls for external instruction snapshots. Markdown is opened as source, never executed or previewed as HTML. */
import * as vscode from 'vscode';
import { realpathSync } from 'node:fs';
import { ExternalInstructionSkillStore, PublicSkillTransport, downloadExternalSkill, externalSkillDiff, externalSkillSource, ExternalSkillError, type ExternalSkillSnapshot, type ExternalSkillManifest, type ExternalSkillListing } from './externalInstructionSkills';

export const EXTERNAL_SKILLS_COMMAND = 'hypeproof-chat.externalSkills';
function workspaceRoot(): string {
  if (!vscode.workspace.isTrusted) throw new ExternalSkillError('작업 폴더를 신뢰한 뒤 지침 스킬을 선택해 주세요.');
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder || folder.uri.scheme !== 'file') throw new ExternalSkillError('로컬 작업 폴더를 먼저 열어 주세요.');
  return folder.uri.fsPath;
}
function storeFor(context: vscode.ExtensionContext, root: string): ExternalInstructionSkillStore {
  const state = {
    get: <T>(key: string, fallback?: T) => context.workspaceState.get<T>(key, fallback as T),
    update: async (key: string, value: unknown) => {
      if (realpathSync(workspaceRoot()) !== realpathSync(root)) throw new ExternalSkillError('작업 폴더가 바뀌었습니다. 새 폴더에서 다시 선택해 주세요.');
      await context.workspaceState.update(key, value);
    },
  };
  return new ExternalInstructionSkillStore(state, context.globalStorageUri.fsPath, root);
}
/** Append to the existing user-turn context for SDK and proxy. No system prompt or permission is changed here. */
export async function selectedExternalInstructions(context: vscode.ExtensionContext, root: string): Promise<{ text: string; provenance: ExternalSkillManifest[] }> {
  if (!vscode.workspace.isTrusted || !vscode.workspace.workspaceFolders?.[0] || vscode.workspace.workspaceFolders[0].uri.scheme !== 'file') return { text: '', provenance: [] };
  if (realpathSync(workspaceRoot()) !== realpathSync(root)) throw new ExternalSkillError('현재 작업 폴더와 스킬 선택 폴더가 다릅니다.');
  return storeFor(context, root).selected();
}
export async function showExternalSkillPreview(snapshot: ExternalSkillSnapshot, diff?: string): Promise<void> {
  const m = snapshot.manifest;
  const content = `# 외부 지침 스킬 · ${m.name}\n\n${m.description}\n\n출처: ${m.sourceUrl}\n고정 revision: ${m.revision}\nmanifest SHA-256: ${m.digest}\n라이선스: ${m.license}\n요구 capability: ${m.capabilities.join(', ') || '미선언'}\n\n권한은 현재 수업·프로필·사용자 승인 범위를 따릅니다. 이 지침은 권한이나 커리큘럼 스킬을 추가하지 않습니다. 설치·스크립트·hook·MCP 실행은 지원하지 않습니다. 확인용 문서에서 편집한 내용은 고정본에 적용되지 않습니다.\n\n파일:\n${m.files.map(f => `- ${f.path} · ${f.bytes} bytes · SHA-256 ${f.sha256}`).join('\n')}\n\n${diff ? '# 업데이트 변경 내용\n\n' + diff + '\n\n' : ''}# 가져올 지침과 정적 참조\n\n${Object.entries(snapshot.files).map(([name, text]) => `## ${name}\n\n${text}`).join('\n\n')}`;
  const document = await vscode.workspace.openTextDocument({ content, language: 'markdown' });
  await vscode.window.showTextDocument(document, { preview: true, preserveFocus: false });
}
async function download(context: vscode.ExtensionContext, store: ExternalInstructionSkillStore, previous?: ExternalSkillSnapshot): Promise<void> {
  const root = workspaceRoot();
  const url = await vscode.window.showInputBox({ title: previous ? '지침 스킬 업데이트' : '공개 GitHub 지침 스킬 가져오기', prompt: '공개 저장소 주소 또는 전체 commit SHA가 포함된 SKILL.md/폴더 주소', value: previous?.manifest.repository, ignoreFocusOut: true });
  if (url === undefined) return;
  let source;
  if (/\/\w+\/[a-f0-9]{40}(?:\/|$)/.test(url)) source = externalSkillSource(url);
  else {
    const ref = await vscode.window.showInputBox({ title: '고정할 revision', prompt: 'branch·tag·전체 commit SHA를 명시하세요. slash가 있는 branch도 여기에 전체 입력합니다.', value: previous?.manifest.requestedRef ?? 'main', ignoreFocusOut: true });
    if (ref === undefined) return;
    const directory = await vscode.window.showInputBox({ title: 'SKILL.md가 있는 폴더', prompt: '저장소 기준 상대 경로. 저장소 루트라면 비워 두세요.', value: previous?.manifest.directory ?? '', ignoreFocusOut: true });
    if (directory === undefined) return;
    source = externalSkillSource(url, ref, directory);
  }
  const snapshot = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '지침 스킬 검사 중', cancellable: true }, async (_progress, token) => {
    const controller = new AbortController();
    const subscription = token.onCancellationRequested(() => controller.abort());
    if (token.isCancellationRequested) controller.abort();
    try { return await downloadExternalSkill(source, new PublicSkillTransport(fetch, controller.signal)); }
    finally { subscription.dispose(); }
  });
  if (realpathSync(workspaceRoot()) !== realpathSync(root)) throw new ExternalSkillError('다운로드 중 작업 폴더가 바뀌었습니다. 새 폴더에서 다시 선택해 주세요.');
  if (previous && previous.manifest.id !== snapshot.manifest.id) throw new ExternalSkillError('업데이트는 같은 저장소·폴더의 revision만 지원합니다. 새 스킬로 가져와 주세요.');
  await showExternalSkillPreview(snapshot, previous ? externalSkillDiff(previous, snapshot) : undefined);
  const action = await vscode.window.showInformationMessage('출처·고정 revision·라이선스·요구 capability와 지침 내용을 확인했나요? 외부 지침은 권한을 늘리지 않습니다.', { modal: true }, '선택하여 사용', '저장만 하기');
  if (action !== '선택하여 사용' && action !== '저장만 하기') return;
  if (realpathSync(workspaceRoot()) !== realpathSync(root)) throw new ExternalSkillError('작업 폴더가 바뀌었습니다. 새 폴더에서 다시 선택해 주세요.');
  await store.save(snapshot, action === '선택하여 사용');
  void vscode.window.showInformationMessage(action === '선택하여 사용' ? '이 작업 폴더의 다음 요청부터 선택한 지침을 사용합니다.' : '고정본을 저장했습니다. 아직 사용하도록 선택하지 않았습니다.');
}
async function manageEntry(context: vscode.ExtensionContext, store: ExternalInstructionSkillStore, entry: ExternalSkillListing): Promise<void> {
  const action = await vscode.window.showQuickPick(entry.problem ? ['사용 해제', '목록에서 제거'] : ['내용과 출처 보기', entry.selected ? '사용 해제' : '선택하여 사용', '업데이트 확인', '이전 revision 복구', '목록에서 제거'], { title: entry.manifest?.name ?? '검증 실패한 지침 스킬', placeHolder: '스킬은 이 작업 폴더에만 적용됩니다. 저장된 고정본은 오프라인에서도 사용할 수 있습니다.' });
  if (!action) return;
  if (action === '내용과 출처 보기') return showExternalSkillPreview(await store.snapshot(entry.selected ?? entry.latest));
  if (action === '사용 해제') { await store.select(entry.id); return; }
  if (action === '선택하여 사용') {
    const snapshot = await store.snapshot(entry.latest); await showExternalSkillPreview(snapshot);
    const confirm = await vscode.window.showInformationMessage('이 작업 폴더의 다음 요청에 이 고정본을 사용할까요?', { modal: true }, '선택하여 사용');
    if (confirm === '선택하여 사용') await store.select(entry.id, entry.latest); return;
  }
  if (action === '업데이트 확인') return download(context, store, await store.snapshot(entry.latest));
  if (action === '목록에서 제거') {
    const confirm = await vscode.window.showInformationMessage('스킬 선택과 목록에서 제거합니다. 작업 결과 파일은 삭제하지 않습니다.', { modal: true }, '제거');
    if (confirm === '제거') await store.remove(entry.id); return;
  }
  const revisions = await Promise.all(entry.versions.map(async id => { const snapshot = await store.snapshot(id); return { label: snapshot.manifest.revision.slice(0, 12), description: id === entry.selected ? '현재 사용 중' : '저장된 고정본', id, snapshot }; }));
  const selected = await vscode.window.showQuickPick(revisions, { title: '복구할 고정 revision 선택' });
  if (!selected) return;
  await showExternalSkillPreview(selected.snapshot, externalSkillDiff(await store.snapshot(entry.selected ?? entry.latest), selected.snapshot));
  const confirm = await vscode.window.showInformationMessage('선택한 이전 고정본을 다음 요청부터 사용할까요?', { modal: true }, '이 revision 사용');
  if (confirm === '이 revision 사용') await store.select(entry.id, selected.id);
}
export function registerExternalSkillCommands(context: vscode.ExtensionContext): void {
  let busy = false;
  context.subscriptions.push(vscode.commands.registerCommand(EXTERNAL_SKILLS_COMMAND, async () => {
    if (busy) return;
    busy = true;
    try {
      const root = workspaceRoot(), store = storeFor(context, root), list = await store.list();
      const picked = await vscode.window.showQuickPick([{ label: 'GitHub에서 가져오기', description: '공개 Markdown 지침과 정적 텍스트만 지원', id: null }, ...list.map(e => ({ label: `${e.selected ? '✓ ' : ''}${e.manifest?.name ?? '검증 실패한 지침 스킬 · ' + e.id.slice(0, 8)}`, description: e.problem ?? `${e.manifest!.repository} · ${e.manifest!.revision.slice(0, 12)}`, id: e.id }))], { title: 'GitHub 지침 스킬', placeHolder: '커리큘럼 스킬과 별개입니다. 외부 지침은 권한을 부여하지 않습니다.' });
      if (!picked) return;
      if (realpathSync(workspaceRoot()) !== realpathSync(root)) throw new ExternalSkillError('작업 폴더가 바뀌었습니다. 다시 선택해 주세요.');
      if (picked.id === null) await download(context, store);
      else await manageEntry(context, store, list.find(e => e.id === picked.id)!);
    } catch (error) { void vscode.window.showWarningMessage(error instanceof ExternalSkillError ? error.message : '지침 스킬을 처리하지 못했습니다. 기존 선택과 작업 결과는 보존됩니다.'); }
    finally { busy = false; }
  }));
}
