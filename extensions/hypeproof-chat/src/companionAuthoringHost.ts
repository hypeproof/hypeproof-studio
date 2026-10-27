/** Verified mobile text -> explicit desktop review -> existing task draft. No execution port. */
import { createHash } from 'node:crypto';
import { parseCompanionAuthoringIntent, type CompanionAuthoringIntent } from './companionAuthoringIntent.ts';
import { validCompanionAuthority, companionAuthorityIdentity, companionSelectionRequest,
  type CompanionAuthoritySnapshot, type VerifiedCompanionMessage } from './companionHostBridge.ts';
import type { CompanionDesktopHandoffCheckpoint } from './companionDesktopHandoff.ts';
import type { TaskWorkspaceStore } from './taskWorkspaceStore.ts';
export interface CompanionAuthoringOutcome {
  state: 'imported_draft' | 'cancelled' | 'denied' | 'outcome_unknown';
  code: string; requestId?: string; executionAuthorized: false;
}
export interface CompanionDraftReview {
  check(): Promise<void>;
  imported(taskId: string, revision: number, text: string): Promise<void>;
  close(): void;
}
export interface CompanionAuthoringHostPorts {
  snapshot(): Promise<CompanionAuthoritySnapshot | null>;
  store(): TaskWorkspaceStore | null;
  lifecycle: { capture(): number; isCurrent(revision: number): boolean };
  confirm(intent: Readonly<CompanionAuthoringIntent>): Promise<boolean>;
  /** Refresh/reveal the existing normal draft; never send it. Must retain any newer unsaved UI input. */
  imported(taskId: string, revision: number): Promise<void>;
  reviewDraft?(taskId: string, isCurrent: () => boolean): Promise<CompanionDraftReview>;
  now(): number;
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const outcome = (state: CompanionAuthoringOutcome['state'], code: string, requestId?: string): CompanionAuthoringOutcome =>
  ({state,code,...(requestId?{requestId}:{}),executionAuthorized:false});
export class CompanionAuthoringHost {
  private busy = false;
  private closed = false;
  private lastOwnerRevision = -1;
  private readonly ports: CompanionAuthoringHostPorts;
  constructor(ports: CompanionAuthoringHostPorts) { this.ports = ports; }
  close(): void { this.closed = true; }
  async handle(message: VerifiedCompanionMessage): Promise<CompanionAuthoringOutcome> {
    if (this.closed || this.busy) return outcome('denied','owner_unavailable');
    const request = parseCompanionAuthoringIntent(message?.text);
    if (!request || message.sender !== 'device' || message.messageId !== request.requestId) return outcome('denied','invalid_authoring_intent');
    this.busy = true;
    const requestHash = hash(message.text);
    let importing = false;
    let review: CompanionDraftReview | undefined;
    try {
      const revision = this.ports.lifecycle.capture();
      if (!Number.isSafeInteger(revision) || revision < 0 || revision < this.lastOwnerRevision) return outcome('denied','invalid_owner_revision');
      this.lastOwnerRevision = revision;
      const alive = () => !this.closed && this.ports.lifecycle.isCurrent(revision);
      const before = await this.ports.snapshot();
      if (!alive() || !before || !validCompanionAuthority(before,this.ports.now()) || before.host !== 'online') return outcome('denied','current_authority_required');
      if (request.pairingId !== before.pair.id || message.invitationId !== before.pair.id
        || message.invitationDigest !== before.pair.invitation_digest || message.claimDigest !== before.pair.claim_digest)
        return outcome('denied','paired_sender_mismatch');
      const store = this.ports.store(), expected = {taskId:before.taskId,revision:before.version};
      if (!store) return outcome('denied','current_task_required');
      const held = await store.readCompanionHandoff(expected);
      if (!alive() || store !== this.ports.store()) return outcome('denied','owner_changed');
      const selected = companionSelectionRequest(before,request.selection.requestId);
      const matches = (allowImportedRevision: boolean) => Object.entries(selected).every(([key,value]) =>
        allowImportedRevision && key === 'version' ? held?.authoringImport?.state === 'imported' : request.selection[key as keyof typeof selected] === value);
      if (held?.checkpoint.id === request.requestId && held.authoringImport
        && held.checkpoint.target.taskId === before.taskId) {
        if (held.authoringImport.requestHash !== requestHash) return outcome('denied','request_id_conflict',request.requestId);
        if (held.authoringImport.state === 'prepared') return outcome('outcome_unknown','draft_import_reconciliation_required',request.requestId);
        if (held.authoringImport.state === 'imported' && matches(true)) return held.authoringImport.presented
          ? outcome('imported_draft','already_imported',request.requestId)
          : outcome('outcome_unknown','draft_import_reconciliation_required',request.requestId);
      }
      if (!matches(false)) return outcome('denied','selection_changed',request.requestId);
      const checkpoint: CompanionDesktopHandoffCheckpoint = {schema:'hps-companion-desktop-handoff-local/1',id:request.requestId,createdAt:0,
        target:{actorId:selected.actorId,deviceId:selected.deviceId,pairingId:request.pairingId,hostId:selected.hostId,
          workspaceId:selected.workspaceId,projectId:selected.projectId,taskId:selected.taskId,version:selected.version,
          epoch:selected.epoch,consentRevision:selected.consentRevision,artifactId:selected.artifactId,artifactVersion:selected.artifactVersion},
        originalDraft:request.text,reviewedIntent:request.text,attachments:[{artifactId:selected.artifactId,artifactVersion:selected.artifactVersion}],run:{id:null,state:'not_started'}};
      await store.stageCompanionHandoff(checkpoint,expected,requestHash,alive);
      const draft = store.getDraft();
      review = await this.ports.reviewDraft?.(before.taskId,alive);
      if (!alive()) return outcome('denied','owner_changed');
      const approved = await this.ports.confirm(structuredClone(request));
      if (!alive()) return outcome('denied','owner_changed');
      if (!approved) return outcome('cancelled','desktop_import_cancelled',request.requestId);
      const after = await this.ports.snapshot();
      if (!alive() || store !== this.ports.store() || !after || !validCompanionAuthority(after,this.ports.now())
        || companionAuthorityIdentity(before) !== companionAuthorityIdentity(after)) return outcome('denied','review_scope_changed',request.requestId);
      await review?.check();
      if (!alive()) return outcome('denied','owner_changed');
      importing = true;
      const receipt = await store.importCompanionAuthoringDraft(request.requestId,requestHash,expected,draft,
        ()=>alive() && store === this.ports.store());
      if (!alive()) return outcome('outcome_unknown','draft_import_reconciliation_required',request.requestId);
      if (review) await review.imported(before.taskId,receipt.authoringImport!.revision!,request.text);
      else await this.ports.imported(before.taskId,receipt.authoringImport!.revision!);
      if (!alive()) return outcome('outcome_unknown','draft_import_reconciliation_required',request.requestId);
      const presented = store.getView();
      await store.presentCompanionAuthoringDraft(request.requestId,requestHash,{taskId:presented.activeTaskId,revision:presented.revision},alive);
      if (!alive()) return outcome('outcome_unknown','draft_import_reconciliation_required',request.requestId);
      return outcome('imported_draft','desktop_draft_imported',request.requestId);
    } catch {
      return outcome(importing?'outcome_unknown':'denied',importing?'draft_import_unconfirmed':'draft_preserved',request.requestId);
    } finally { review?.close(); this.busy = false; }
  }
}
