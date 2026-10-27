import * as vscode from 'vscode';
import { hostname } from 'node:os';
import { canonicalRoot, type ActivityConnections } from './activityConnections.ts';
import { companionHostId, companionKey, companionState, type CompanionScope, type CompanionState } from './companionWorkspace.ts';
import { CompanionWorkspaceController } from './companionWorkspaceController.ts';

export const COMPANION_WORKSPACE_COMMAND = 'hypeproof-chat.prepareCompanionWorkspace';

function activeCompanionScope(connections: ActivityConnections): CompanionScope | undefined {
  const active = connections.current;
  const folders = vscode.workspace.workspaceFolders;
  if (!active || !connections.matchesService || !folders || folders.length !== 1) return;
  const folder = folders[0];
  if (vscode.env.remoteName || folder.uri.scheme !== 'file') return;
  let currentRoot: string;
  try { currentRoot = canonicalRoot(folder.uri.fsPath); } catch { return; }
  return {
    activityId: active.id, workspace: active.workspace, ownerLabel: active.name,
    hostId: companionHostId(vscode.env.machineId), hostLabel: hostname(),
    trusted: vscode.workspace.isTrusted, local: currentRoot === active.workspace,
  };
}

async function verifyCompanionBinding(connections: ActivityConnections, scope: CompanionScope): Promise<boolean> {
  const current = connections.current;
  const binding = await connections.forWorkspace(scope.workspace);
  return !!current && !!binding && binding.id === scope.activityId && binding.ref === current.ref && binding.workspace === scope.workspace;
}

/** Stable metadata read boundary for a future pairing consumer. A preparation grants no authority. */
export async function readPreparedCompanionWorkspace(context: vscode.ExtensionContext, connections: ActivityConnections): Promise<CompanionState> {
  try {
    const scope = activeCompanionScope(connections);
    const state = await companionState(scope, scope ? context.globalState.get(companionKey(scope)) : undefined);
    if (!scope || state.status !== 'UNPAIRED') return state;
    if (!await verifyCompanionBinding(connections, scope) || JSON.stringify(activeCompanionScope(connections)) !== JSON.stringify(scope))
      throw new Error('scope changed');
    return state;
  } catch {
    return { status: 'BLOCKED', message: '현재 활동과 작업 폴더의 준비 정보를 확인하지 못했어요.' };
  }
}

/** Explicit palette entry only; no activation-time reads, network calls, or folder switching. */
export function registerCompanionWorkspace(context: vscode.ExtensionContext, connections: ActivityConnections): void {
  const controller = new CompanionWorkspaceController({
    scope: () => activeCompanionScope(connections),
    verify: scope => verifyCompanionBinding(connections, scope),
    get: key => context.globalState.get(key),
    update: (key, value) => context.globalState.update(key, value),
    selectFolder: async () => {
      const selected = await vscode.window.showOpenDialog({
        title: '휴대폰 연결 준비: 현재 활동의 기존 작업 폴더 선택',
        openLabel: '이 작업 폴더 확인', canSelectFiles: false, canSelectFolders: true,
        canSelectMany: false, defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
      });
      return selected?.[0]?.scheme === 'file' ? selected[0].fsPath : undefined;
    },
    confirm: async detail => (await vscode.window.showInformationMessage(
      '이 컴퓨터에 작업 폴더 준비 정보를 저장할까요?', { modal: true, detail }, '준비 정보 저장',
    )) === '준비 정보 저장',
    show: async (state, detail) => {
      const message = `${state.status} · ${state.message}`;
      if (state.status === 'UNPAIRED') await vscode.window.showInformationMessage(message, { modal: true, detail }, '확인');
      else await vscode.window.showWarningMessage(message, { modal: true, detail }, '확인');
    },
    now: () => Date.now(),
  });
  context.subscriptions.push(vscode.commands.registerCommand(COMPANION_WORKSPACE_COMMAND, () => controller.run()));
}
