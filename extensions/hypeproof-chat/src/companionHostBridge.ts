/** DEV host policy/consent composition. Verified pairing transports data; it never grants file authority. */
import { createHash } from 'node:crypto';
import { CompanionHostDispatcher, type CompanionDispatchResult, type CompanionHostContext, type CompanionHostRequest } from './companionHostDispatch.ts';
import type { JournalStore } from './classroomOpsCommands.ts';
import type { AccountPassBinding } from './accountSession.ts';
import type { CompanionPreparation } from './companionWorkspace.ts';
import type { ResolvedProfile } from './protocol.ts';
import { packCompanionPreviewPayload, COMPANION_PREVIEW_ENVELOPE_BYTES } from './companionPreviewPayload.ts';
import { isMinorProfile } from './sdkCoachHelpers.ts';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export interface CompanionVerifiedPair {
  schema: 'hps-companion-pairing-preview/2'; id: string; status: 'paired'; account_id: string;
  host_session_id: string; device_session_id: string; host_id: string; device_id: string;
  workspace_id: string; project_id: string; invitation_digest: string; claim_digest: string;
  grant_expires_at: number; capability: 'preview.read'; execution_authorized: false;
}
export interface CompanionAuthoritySnapshot {
  preparation: CompanionPreparation; pair: CompanionVerifiedPair;
  accountId: string; accountSessionId: string; binding: AccountPassBinding;
  /** Actual fresh Service response, after the existing folder-consent narrowing. */
  profile: ResolvedProfile;
  taskId: string; version: number; epoch: number; consentRevision: number;
  folderReadAllowed: boolean; host: 'online' | 'offline' | 'unknown';
  artifact: { id: string; version: string; path: string; label: string };
}
export interface VerifiedCompanionMessage {
  sender: 'device'; invitationId: string; invitationDigest: string; claimDigest: string;
  messageId: string; text: string;
}
export interface CompanionConsentPrompt {
  requestId: string; deviceId: string; artifact: string; artifactVersion: string;
  workspace: string; taskId: string; version: number;
}
export interface CompanionHostBridgePorts {
  /** Resolves existing account/pass/profile, prepared scope, paired endpoint and selected saved artifact. */
  snapshot(): Promise<CompanionAuthoritySnapshot | null>;
  confirm(prompt: CompanionConsentPrompt): Promise<boolean>;
  journal: JournalStore;
  now(): number;
}
export interface CompanionEncryptedReply {
  /** Reviewed relay client: signs/encrypts and caches exact wire bytes locally, without sending. */
  prepare(plaintext: string, id: string): Promise<string>;
  /** Sends only the exact previously prepared ciphertext; never receives plaintext. */
  send(id: string): Promise<unknown>;
  /** Terminally discard ephemeral keys and every cached prepared packet; a new pairing is required. */
  close(): void;
  /** Optional bounded backpressure pause; the bridge rechecks current scope before the next send. */
  waitForCapacity?(): Promise<void>;
}
function context(s: CompanionAuthoritySnapshot, authorized: boolean): CompanionHostContext {
  return { actorId: s.accountId, deviceId: s.pair.device_id, hostId: s.preparation.hostId,
    workspaceId: hash('hps-companion-workspace/1:' + s.preparation.scope), projectId: s.preparation.projectId,
    taskId: s.taskId, version: s.version, epoch: s.epoch, consentRevision: s.consentRevision,
    access: 'active', host: s.host, executionAuthorized: authorized, capability: 'preview.read',
    profile: s.profile, instructor: false, folderReadAllowed: s.folderReadAllowed,
    artifact: { id: s.artifact.id, version: s.artifact.version, path: s.artifact.path }, workspaceRoot: s.preparation.workspace };
}
export function validCompanionAuthority(s: CompanionAuthoritySnapshot, now: number): boolean {
  const p = s.pair;
  return p.schema === 'hps-companion-pairing-preview/2' && p.status === 'paired' && p.execution_authorized === false
    && p.capability === 'preview.read' && p.grant_expires_at > Math.floor(now / 1000)
    && s.accountId === p.account_id && s.accountSessionId === p.host_session_id
    && s.binding.sessionId === p.host_session_id && !!s.binding.passId
    && p.host_id === s.preparation.hostId && p.project_id === s.preparation.projectId
    && p.workspace_id === hash('hps-companion-workspace/1:' + s.preparation.scope)
    && s.profile.sdk_tools?.read === true && !isMinorProfile(s.profile)
    && !!s.profile.pass && (s.profile.pass.expires_at === undefined
      || (Number.isSafeInteger(s.profile.pass.expires_at) && s.profile.pass.expires_at > Math.floor(now / 1000)))
    && s.folderReadAllowed === true;
}
/** Stable policy identity excludes changing display/usage counters; all authority/scope inputs are bound. */
export function companionAuthorityIdentity(s: CompanionAuthoritySnapshot): string {
  return hash(JSON.stringify([s.preparation, s.pair, s.accountId, s.accountSessionId, s.binding,
    s.profile.profile_id, s.profile.activity_id, s.profile.activity_kind, s.profile.sdk_tools,
    s.profile.minor_cohort, s.profile.pass?.expires_at, s.taskId, s.version, s.epoch,
    s.consentRevision, s.folderReadAllowed, s.host, s.artifact]));
}
export function companionSelectionRequest(s: CompanionAuthoritySnapshot, requestId: string): CompanionHostRequest {
  const c = context(s, false);
  return { schema: 'hps-companion-host-request/1', requestId,
    actorId: c.actorId, deviceId: c.deviceId, hostId: c.hostId, workspaceId: c.workspaceId, projectId: c.projectId,
    taskId: c.taskId, version: c.version, epoch: c.epoch, consentRevision: c.consentRevision,
    artifactId: c.artifact.id, artifactVersion: c.artifact.version, operation: 'preview.read' };
}
export class CompanionHostBridge {
  private readonly ports: CompanionHostBridgePorts;
  private readonly dispatcher: CompanionHostDispatcher;
  private consent: { request: string; scope: string } | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(ports: CompanionHostBridgePorts) {
    this.ports = ports;
    this.dispatcher = new CompanionHostDispatcher({ journal: ports.journal, now: ports.now, context: async () => {
      const current = await this.current();
      return current && this.consent && companionAuthorityIdentity(current) === this.consent.scope ? context(current, true) : null;
    } });
  }
  async recover(): Promise<void> { this.consent = null; await this.dispatcher.recover(); }
  /** Explicit desktop publication of selected version metadata only; contains neither path nor content nor authority. */
  async describe(requestId: string): Promise<CompanionHostRequest | null> {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(requestId)) return null;
    const current = await this.current(); return current ? companionSelectionRequest(current, requestId) : null;
  }
  private async current(): Promise<CompanionAuthoritySnapshot | null> {
    try { const s = await this.ports.snapshot(); return s && validCompanionAuthority(s, this.ports.now()) ? s : null; } catch { return null; }
  }
  handle(message: VerifiedCompanionMessage): Promise<CompanionDispatchResult> {
    const next = this.queue.then(() => this.run(message)); this.queue = next.catch(() => {}); return next;
  }
  /** The caller supplies the reviewed encrypted relay client; this seam never sends plaintext over a transport. */
  handleAndReply(message: VerifiedCompanionMessage, encryptedReply: CompanionEncryptedReply): Promise<CompanionDispatchResult> {
    const next = this.queue.then(() => this.runAndReply(message, encryptedReply));
    this.queue = next.catch(() => {}); return next;
  }
  private async runAndReply(message: VerifiedCompanionMessage, encryptedReply: CompanionEncryptedReply): Promise<CompanionDispatchResult> {
    let outcome = await this.run(message);
    const requestId = typeof message?.messageId === 'string' ? message.messageId : '';
    const encode = () => JSON.stringify({ schema: 'hps-companion-host-result/1', requestId, outcome });
    if (Buffer.byteLength(encode()) > COMPANION_PREVIEW_ENVELOPE_BYTES) {
      outcome = { state: 'denied', code: 'result_too_large', requestId };
    }
    let packets: readonly string[];
    try { packets = await packCompanionPreviewPayload(encode(), requestId); }
    catch { this.consent = null; encryptedReply.close(); return { state: 'denied', code: 'preview_transfer_unavailable' }; }
    const fresh = async () => {
      const current = await this.current();
      return !outcome.artifact || !!(current && this.consent && this.consent.request === hash(message.text) && this.consent.scope === companionAuthorityIdentity(current));
    };
    for (let index = 0; index < packets.length; index++) {
      const text = packets[index];
      const id = hash((packets.length === 1 ? 'hps-companion-host-result/1:' : 'hps-companion-host-result-part/1:' + index + ':') + requestId + ':' + hash(text));
      try { await encryptedReply.prepare(text, id); }
      catch { this.consent = null; encryptedReply.close(); return { state: 'denied', code: 'relay_unavailable' }; }
      let sent = false;
      for (let attempt = 0; attempt < 8; attempt++) {
        if (!await fresh()) {
          this.consent = null; encryptedReply.close();
          return { state: 'denied', code: 'authority_changed' };
        }
        try { await encryptedReply.send(id); sent = true; break; }
        catch (error) {
          if (!error || typeof error !== 'object' || (error as { message?: unknown }).message !== 'relay_backpressure' || attempt === 7) break;
          // Retry only the already prepared ciphertext. A request-local bounded wait is not a background scheduler.
          try {
            if (encryptedReply.waitForCapacity) {
              let timer: ReturnType<typeof setTimeout> | undefined;
              try {
                await Promise.race([encryptedReply.waitForCapacity(), new Promise<never>((_, reject) => {
                  timer = setTimeout(() => reject(Error('relay_capacity_timeout')), 1_000);
                })]);
              } finally { if (timer) clearTimeout(timer); }
            } else await new Promise(resolve => setTimeout(resolve, 100));
          } catch { break; }
        }
      }
      if (!sent) { this.consent = null; encryptedReply.close(); return { state: 'denied', code: 'relay_unavailable' }; }
    }
    return outcome;
  }
  private async run(message: VerifiedCompanionMessage): Promise<CompanionDispatchResult> {
    const deny = (code: string): CompanionDispatchResult => ({ state: 'denied', code });
    if (!message || message.sender !== 'device' || typeof message.text !== 'string' || Buffer.byteLength(message.text) > 2032) return deny('invalid_relay_request');
    const before = await this.current(); if (!before) return deny('current_runtime_authority_required');
    if (message.invitationId !== before.pair.id || message.invitationDigest !== before.pair.invitation_digest || message.claimDigest !== before.pair.claim_digest) return deny('paired_sender_mismatch');
    let request: CompanionHostRequest;
    try { request = JSON.parse(message.text); } catch { return deny('invalid_request'); }
    if (!request || typeof request.requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(request.requestId) || message.messageId !== request.requestId) return deny('invalid_request');
    const expected = companionSelectionRequest(before, request.requestId);
    if (Object.keys(request).length !== Object.keys(expected).length || !Object.entries(expected).every(([k, v]) => request[k as keyof CompanionHostRequest] === v)) return deny('request_scope_mismatch');
    if (before.host !== 'online') return { state: 'wait_for_host', code: 'host_unavailable', requestId: request.requestId };
    const binding = { request: hash(message.text), scope: companionAuthorityIdentity(before) };
    if (!this.consent || this.consent.request !== binding.request || this.consent.scope !== binding.scope) {
      this.consent = null;
      const approved = await this.ports.confirm({ requestId: request.requestId, deviceId: before.pair.device_id,
        artifact: before.artifact.label, artifactVersion: before.artifact.version, workspace: before.preparation.workspace,
        taskId: before.taskId, version: before.version });
      const after = await this.current();
      if (!approved || !after || companionAuthorityIdentity(after) !== binding.scope) return deny(approved ? 'consent_scope_changed' : 'host_consent_required');
      this.consent = binding;
    }
    const result = await this.dispatcher.dispatch(message.text);
    const after = await this.current();
    if (!after || companionAuthorityIdentity(after) !== binding.scope) { this.consent = null; return deny('authority_changed'); }
    return result;
  }
}
