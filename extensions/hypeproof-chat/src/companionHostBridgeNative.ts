/** Native DEV-only authority producer. No activation hook, listener, or production remote permission. */
import * as vscode from 'vscode';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import type { AccountSession } from './accountSession.ts';
import type { ActivityConnections } from './activityConnections.ts';
import { readPreparedCompanionWorkspace } from './companionWorkspaceHost.ts';
import { fetchProfileResult, verifyActivity } from './proxyClient.ts';
import { folderConsentState } from './folderConsentHost.ts';
import { narrowForFolder } from './folderConsent.ts';
import type { TaskWorkspaceView } from './taskWorkspaceContract.ts';
import { CompanionHostBridge, type CompanionAuthoritySnapshot, type CompanionVerifiedPair } from './companionHostBridge.ts';
import type { JournalStore } from './classroomOpsCommands.ts';
import { inspectWorkspaceTextFile } from './fileAttachment.ts';
import { taskWorkspaceScope } from './trialCarryoverSource.ts';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function loopback(base: string): boolean {
  try { const u = new URL(base); return u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) && !u.username && !u.password && !u.search && !u.hash; } catch { return false; }
}
export interface CompanionNativeBridgePorts {
  context: vscode.ExtensionContext; connections: ActivityConnections; accounts: AccountSession;
  /** Existing verified pairing client refresh, including active endpoint/account Service checks. */
  paired(): Promise<CompanionVerifiedPair | null>;
  /** Existing active TaskWorkspaceStore view; do not create a parallel task/version store. */
  taskView(): TaskWorkspaceView | null;
  epoch(): number;
  journal: JournalStore;
  now?: () => number;
}
/** Construct explicitly in an isolated development session; the production extension does not register it. */
export function createDevCompanionAuthoritySnapshot(ports: CompanionNativeBridgePorts): () => Promise<CompanionAuthoritySnapshot | null> {
  const now = ports.now ?? Date.now;
  const local = () => {
    const active = ports.connections.current, document = vscode.window.activeTextEditor?.document;
    const task = ports.taskView();
    const service = vscode.workspace.getConfiguration('hypeproofChat').get<string>('proxyUrl', 'https://api.hypeproof-ai.xyz/v1');
    if (ports.context.extensionMode !== vscode.ExtensionMode.Development || !loopback(service)
      || !active?.accountPass || !ports.connections.matchesService || !task?.activeTaskId || task.error || task.scope !== hash(taskWorkspaceScope(active))
      || !document || document.uri.scheme !== 'file' || document.isDirty || document.isUntitled
      || !/\.html?$/i.test(document.uri.fsPath) || vscode.env.remoteName || !vscode.workspace.isTrusted) return null;
    const text = document.getText();
    // Keep the selected HTML bounded; the serialized result has its own 32KiB framing cap. Refuse, never truncate.
    if (Buffer.byteLength(text) > 24 * 1024) return null;
    return { active: { id: active.id, ref: active.ref, serverId: active.serverId, workspace: active.workspace, accountPass: { ...active.accountPass } },
      service, taskId: task.activeTaskId, revision: task.revision, taskScope: task.scope, epoch: ports.epoch(),
      file: document.uri.fsPath, documentVersion: document.version, digest: hash(text) };
  };
  const snapshot = async (): Promise<CompanionAuthoritySnapshot | null> => {
    const before = local(); if (!before) return null;
    const unchanged = () => JSON.stringify(local()) === JSON.stringify(before);
    const prepared = await readPreparedCompanionWorkspace(ports.context, ports.connections);
    if (!unchanged() || !prepared.preparation || prepared.status !== 'UNPAIRED') return null;
    const preparation = prepared.preparation;
    if (preparation.activityId !== before.active.id || preparation.workspace !== before.active.workspace) return null;
    if (!inspectWorkspaceTextFile(preparation.workspace, before.file).ok) return null;
    const passToken = await ports.accounts.resolvePass(before.active.accountPass);
    if (!unchanged() || !passToken) return null;
    const productToken = await ports.accounts.accessToken();
    if (!unchanged() || !productToken) return null;
    const meResponse = await fetch(before.service.replace(/\/$/, '') + '/me', { headers: { authorization: 'Bearer ' + productToken }, redirect: 'error', signal: AbortSignal.timeout(10_000) });
    if (!unchanged() || !meResponse.ok) return null;
    const me = await meResponse.json() as { account?: { id?: unknown }; session_id?: unknown };
    if (!unchanged() || typeof me.account?.id !== 'string' || me.session_id !== before.active.accountPass.sessionId) return null;
    const resolved = await fetchProfileResult({ proxyUrl: before.service, token: passToken });
    if (!unchanged() || !resolved.ok || resolved.profile.activity_id !== before.active.serverId) return null;
    await verifyActivity({ proxyUrl: before.service, token: passToken }, before.active.serverId);
    if (!unchanged()) return null;
    const profile = resolved.profile;
    const folder = folderConsentState(ports.context, profile, { servedRoot: profile.workspace_root, instructor: false });
    if (!['skip', 'read', 'full'].includes(folder.tag)) return null;
    const pair = await ports.paired();
    if (!unchanged() || !pair) return null;
    const finalFolder = folderConsentState(ports.context, profile, { servedRoot: profile.workspace_root, instructor: false });
    if (JSON.stringify(folder) !== JSON.stringify(finalFolder)) return null;
    const effective = folder.tag === 'read' ? narrowForFolder(profile, 'read') : profile;
    return { preparation, pair, accountId: me.account.id, accountSessionId: String(me.session_id), binding: before.active.accountPass,
      profile: effective, taskId: before.taskId, version: before.revision, epoch: before.epoch,
      consentRevision: parseInt(hash(JSON.stringify(folder)).slice(0, 12), 16), folderReadAllowed: true, host: 'online',
      artifact: { id: hash('hps-companion-artifact/1:' + before.file), version: before.digest, path: before.file, label: basename(before.file) } };
  };
  return snapshot;
}
export function createDevCompanionHostBridge(ports: CompanionNativeBridgePorts): CompanionHostBridge {
  const snapshot = createDevCompanionAuthoritySnapshot(ports), now = ports.now ?? Date.now;
  return new CompanionHostBridge({ journal: ports.journal, now, snapshot, confirm: async prompt => {
    const detail = [`연결된 휴대폰: ${prompt.deviceId}`, `선택한 파일: ${prompt.artifact}`, `작업 폴더: ${prompt.workspace}`,
      `작업: ${prompt.taskId} · 버전 ${prompt.version}`, `파일 버전: ${prompt.artifactVersion}`, `요청: ${prompt.requestId}`,
      '이 요청의 선택한 HTML 내용만 암호화해 이 휴대폰에 전달해요. 파일 수정·AI·명령 실행 권한은 주지 않아요.'].join('\n\n');
    return (await vscode.window.showInformationMessage('이 휴대폰에 선택한 미리보기를 한 번 전달할까요?', { modal: true, detail }, '이 요청만 전달')) === '이 요청만 전달';
  } });
}
