/** Unregistered DEV local acceptance/navigation seam. No transport, auth store or execution port. */
import * as vscode from 'vscode';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { inspectWorkspaceTextFile } from './fileAttachment.ts';
import { TaskWorkspaceStore } from './taskWorkspaceStore.ts';
import { sameCompanionDesktopHandoffTarget, validCompanionDesktopHandoff, type CompanionDesktopHandoffCheckpoint,
  type CompanionDesktopHandoffRun, type CompanionDesktopHandoffTarget } from './companionDesktopHandoff.ts';
export interface CompanionDesktopHandoffSnapshot {
  target: CompanionDesktopHandoffTarget; run: CompanionDesktopHandoffRun;
  access: 'active' | 'expired' | 'revoked'; host: 'online' | 'offline' | 'unknown';
  workspaceRoot: string; artifactPath: string;
}
export interface CompanionDesktopHandoffPorts {
  context: Pick<vscode.ExtensionContext, 'extensionMode'>; store: TaskWorkspaceStore;
  /** Existing account/preparation/profile/task/selection owner. Checkpoint bytes cannot supply this authority. */
  snapshot(): Promise<CompanionDesktopHandoffSnapshot | null>;
  /** REQUIRED existing native-owner invalidation lease, synchronous and fail-closed; never a new auth store.
   * Invalidate on account/session/pass/profile/policy/task/preparation/config/workspace changes or observed denial.
   * Remote changes remain unknown until the native owner receives authoritative invalidation. */
  lifecycle: { capture(): number; isCurrent(revision: number): boolean };
  /** Reveal the already active exact task through the existing provider. Never send/execute a request. */
  revealTask(taskId: string): Promise<void>;
}
export interface CompanionDesktopHandoffOutcome {
  state: 'pending' | 'opened' | 'discarded' | 'cancelled' | 'wait_for_host' | 'denied' | 'stale' | 'failed';
  code: string; handoffId?: string; executionAuthorized: false;
}
const result = (state: CompanionDesktopHandoffOutcome['state'], code: string, handoffId?: string): CompanionDesktopHandoffOutcome =>
  ({ state, code, ...(handoffId ? { handoffId } : {}), executionAuthorized: false });
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const escape = (s: string) => s.replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
class Refused extends Error { constructor(readonly state: 'denied' | 'stale' | 'wait_for_host', code: string) { super(code); } }
export class CompanionDesktopHandoffHost {
  private readonly ports: CompanionDesktopHandoffPorts;
  private closed = false;
  private busy = false;
  private panel?: vscode.WebviewPanel;
  private operationRevision?: number;
  private lastOwnerRevision?: number;
  constructor(ports: CompanionDesktopHandoffPorts) { this.ports = ports; }
  private check(): void {
    if (this.closed || this.ports.context.extensionMode !== vscode.ExtensionMode.Development) throw new Refused('denied','development_session_required');
    if (this.operationRevision === undefined || this.ports.lifecycle.isCurrent(this.operationRevision) !== true)
      throw new Refused('stale','native_owner_changed');
  }
  private async current(checkpoint: CompanionDesktopHandoffCheckpoint): Promise<CompanionDesktopHandoffSnapshot> {
    this.check(); const snapshot = structuredClone(await this.ports.snapshot()); this.check();
    if (!snapshot || snapshot.access !== 'active') throw new Refused('denied','current_authority_required');
    if (!sameCompanionDesktopHandoffTarget(checkpoint.target,snapshot.target)
      || JSON.stringify(checkpoint.run) !== JSON.stringify(snapshot.run)) throw new Refused('stale','scope_version_or_run_changed');
    if (snapshot.host !== 'online') throw new Refused('wait_for_host','host_unavailable');
    const view = this.ports.store.getView();
    if (view.error || view.activeTaskId !== checkpoint.target.taskId || view.revision !== checkpoint.target.version)
      throw new Refused('stale','task_version_changed');
    if (!/\.html?$/i.test(snapshot.artifactPath) || !inspectWorkspaceTextFile(snapshot.workspaceRoot,snapshot.artifactPath).ok)
      throw new Refused('stale','selected_html_unavailable');
    return snapshot;
  }
  private async run(work: () => Promise<CompanionDesktopHandoffOutcome>): Promise<CompanionDesktopHandoffOutcome> {
    if (this.closed || this.ports.context.extensionMode !== vscode.ExtensionMode.Development) return result('denied','development_session_required');
    if (this.busy) return result('failed','operation_in_progress');
    this.busy = true; const priorPanel = this.panel;
    try {
      const revision = this.ports.lifecycle.capture();
      if (!Number.isSafeInteger(revision) || revision < 0 || (this.lastOwnerRevision !== undefined && revision < this.lastOwnerRevision))
        throw new Refused('denied','invalid_native_owner_revision');
      this.lastOwnerRevision = revision; this.operationRevision = revision;
      this.check(); const outcome = await work(); this.check(); return outcome;
    } catch (error) {
      if (this.panel && this.panel !== priorPanel) { this.panel.dispose(); this.panel = undefined; }
      return error instanceof Refused ? result(error.state,error.message) : result('failed','handoff_unconfirmed');
    } finally { this.operationRevision = undefined; this.busy = false; }
  }
  stage(value: CompanionDesktopHandoffCheckpoint): Promise<CompanionDesktopHandoffOutcome> {
    if (!validCompanionDesktopHandoff(value)) return Promise.resolve(result('denied','invalid_local_checkpoint'));
    const checkpoint = structuredClone(value);
    return this.run(async()=>{
      await this.current(checkpoint);
      await this.ports.store.stageCompanionHandoff(checkpoint,{taskId:checkpoint.target.taskId,revision:checkpoint.target.version});
      await this.current(checkpoint);
      return result('pending','checkpoint_persisted',checkpoint.id);
    });
  }
  /** Explicit human acceptance opens a saved artifact + readonly request; ALL desktop draft fields stay unchanged. */
  accept(handoffId: string): Promise<CompanionDesktopHandoffOutcome> {
    return this.run(async()=>{
      const view = this.ports.store.getView();
      const held = await this.ports.store.readCompanionHandoff({taskId:view.activeTaskId,revision:view.revision});
      this.check();
      if (!held || held.checkpoint.id !== handoffId) return result('denied','checkpoint_not_found');
      const checkpoint = held.checkpoint, before = await this.current(checkpoint);
      const desktopDraft = this.ports.store.getDraft();
      const detail = [`컴퓨터: ${checkpoint.target.hostId}`,`이어갈 요청 ID: ${checkpoint.id}`,`프로젝트: ${checkpoint.target.projectId}`,`작업: ${checkpoint.target.taskId} · 버전 ${checkpoint.target.version}`,
        `선택한 파일: ${basename(before.artifactPath)}`,`파일 버전: ${checkpoint.target.artifactVersion}`,
        `이어갈 요청: ${checkpoint.reviewedIntent}`,`휴대폰 원래 초안: ${checkpoint.originalDraft}`,
        `기존 실행: ${checkpoint.run.id ?? '아직 실행하지 않음'} · ${checkpoint.run.state}`,
        '컴퓨터의 기존 입력과 첨부는 모두 그대로 둬요. 요청은 별도 읽기 화면에 열고, 보내기·AI·명령·파일 수정은 실행하지 않아요.'].join('\n\n');
      const approved = await vscode.window.showInformationMessage('이 작업과 이어갈 요청을 컴퓨터에서 열까요?',{modal:true,detail},'검토한 요청 열기');
      this.check(); if (approved !== '검토한 요청 열기') return result('cancelled','desktop_acceptance_required',checkpoint.id);
      await this.current(checkpoint);
      if (JSON.stringify(this.ports.store.getDraft()) !== JSON.stringify(desktopDraft)) throw new Refused('stale','desktop_draft_changed');
      const accepted = await this.ports.store.acceptCompanionHandoff(checkpoint.id,held.digest,{taskId:checkpoint.target.taskId,revision:checkpoint.target.version});
      const retained = async () => {
        const record = await this.ports.store.readCompanionHandoff({taskId:checkpoint.target.taskId,revision:checkpoint.target.version});
        this.check();
        const view = this.ports.store.getView();
        if (!record || record.checkpoint.id !== checkpoint.id || record.digest !== held.digest || record.status !== 'accepted'
          || record.acceptedAt !== accepted.acceptedAt || view.activeTaskId !== checkpoint.target.taskId || view.revision !== checkpoint.target.version)
          throw new Refused('stale','retained_checkpoint_changed');
      };
      const fresh = await this.current(checkpoint); await retained();
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(fresh.artifactPath));
      await this.current(checkpoint); await retained();
      const documentCurrent = () => {
        if (document.isClosed || document.isDirty || document.isUntitled || document.uri.scheme !== 'file' || document.uri.fsPath !== fresh.artifactPath
          || digest(document.getText()) !== checkpoint.target.artifactVersion) throw new Refused('stale','saved_artifact_changed');
      };
      documentCurrent();
      await this.ports.revealTask(checkpoint.target.taskId); await this.current(checkpoint); await retained(); documentCurrent();
      const editor = await vscode.window.showTextDocument(document,{viewColumn:vscode.ViewColumn.One,preserveFocus:false});
      await this.current(checkpoint); await retained(); documentCurrent();
      if (editor.document !== document) throw new Refused('stale','opened_document_changed');
      this.check(); this.panel?.dispose(); this.check();
      const panel = vscode.window.createWebviewPanel('hypeproofCompanionPendingIntent','컴퓨터에서 이어갈 요청',vscode.ViewColumn.Beside,{enableScripts:false,localResourceRoots:[]});
      this.panel = panel;
      panel.webview.html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>body{font:16px system-ui;padding:20px;color:var(--vscode-foreground);background:var(--vscode-editor-background);overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>검토한 요청</h1><pre>${escape(checkpoint.reviewedIntent)}</pre><h2>휴대폰 원래 초안</h2><pre>${escape(checkpoint.originalDraft)}</pre><p>작업 ${escape(checkpoint.target.taskId)} · ${escape(basename(fresh.artifactPath))}</p><p>파일 버전 ${escape(checkpoint.target.artifactVersion)}</p><p>기존 실행 ${escape(checkpoint.run.id ?? '없음')} · ${escape(checkpoint.run.state)}</p><p>컴퓨터 입력과 첨부는 그대로예요. 이 화면은 보내거나 실행하지 않아요.</p></html>`;
      this.check(); return result('opened','accepted_and_opened',checkpoint.id);
    });
  }
  /** Local stale-data cleanup is not execution/delivery: require current OWNER identity, not old artifact/epoch/run. */
  private async discardCurrent(checkpoint: CompanionDesktopHandoffCheckpoint): Promise<void> {
    this.check(); const snapshot = structuredClone(await this.ports.snapshot()); this.check();
    if (!snapshot || snapshot.access !== 'active') throw new Refused('denied','current_authority_required');
    if (!['actorId','hostId','workspaceId','projectId','taskId'].every(key =>
      checkpoint.target[key as keyof CompanionDesktopHandoffTarget] === snapshot.target[key as keyof CompanionDesktopHandoffTarget]))
      throw new Refused('stale','checkpoint_owner_changed');
    const view = this.ports.store.getView();
    if (view.error || view.activeTaskId !== checkpoint.target.taskId || view.revision !== snapshot.target.version)
      throw new Refused('stale','task_version_changed');
  }
  discard(handoffId: string, expectedDigest: string): Promise<CompanionDesktopHandoffOutcome> {
    return this.run(async()=>{
      const view = this.ports.store.getView(), expected = {taskId:view.activeTaskId,revision:view.revision};
      const held = await this.ports.store.readCompanionHandoff(expected); this.check();
      if (!held || held.checkpoint.id !== handoffId || held.digest !== expectedDigest) return result('denied','checkpoint_not_found');
      await this.discardCurrent(held.checkpoint);
      const approved = await vscode.window.showWarningMessage('이 컴퓨터의 보관 요청만 지울까요?',{modal:true,
        detail:`요청: ${handoffId}\n프로젝트: ${held.checkpoint.target.projectId}\n작업: ${held.checkpoint.target.taskId}\n보관한 지문: ${held.digest}\n컴퓨터 파일·입력·첨부·기존 실행과 휴대폰 초안은 그대로예요. 새 요청을 자동으로 보내지 않아요.`},'이 보관 요청만 지우기');
      this.check(); if (approved !== '이 보관 요청만 지우기') return result('cancelled','discard_confirmation_required',handoffId);
      await this.discardCurrent(held.checkpoint);
      await this.ports.store.discardCompanionHandoff(handoffId,expectedDigest,expected);
      await this.discardCurrent(held.checkpoint);
      this.panel?.dispose(); this.panel = undefined;
      return result('discarded','local_checkpoint_discarded',handoffId);
    });
  }
  /** Future registration must call this on account/config/task/workspace invalidation, including while idle. */
  dispose(): void { this.closed = true; this.panel?.dispose(); this.panel = undefined; }
}
