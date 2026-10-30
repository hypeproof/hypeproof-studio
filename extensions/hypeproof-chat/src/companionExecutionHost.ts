/** Bounded native execution owner. Pairing, transport ACKs and imported drafts never call it implicitly. */
import { createHash, randomUUID } from 'node:crypto';
import { parseCompanionAuthoringIntent } from './companionAuthoringIntent.ts';
import { companionSelectionRequest, validCompanionAuthority, type CompanionAuthoritySnapshot, type VerifiedCompanionMessage } from './companionHostBridge.ts';
import { verifyCompanionExecutionReservation } from './companionExecutionAuthority.ts';
import { createCompanionExecutionPolicy } from './companionExecutionPolicy.ts';
import { companionNormalTurnResult, type PreparedCompanionNormalTurn, type CompanionNormalTurnResult } from './companionNormalTurn.ts';

export interface CompanionExecutionModel {
  model_session_id: string; model_token_jti: string; model_profile_id: string;
}
export interface CompanionExecutionGrantScope {
  grant_id: string; task_id: string; artifact_id: string; epoch: number; consent_revision: number;
  selection_hash: string; max_turns: number; max_calls_per_turn: number; expires_at: number;
}
export interface CompanionExecutionRequest {
  turn_id: string; request_id: string; request_hash: string; selection_hash: string;
}
/** Structural adapter for the private shared client. No crypto or transport implementation here. */
export interface CompanionExecutionClientPort {
  issue(): Promise<unknown>;
  reserve(request: CompanionExecutionRequest): Promise<unknown>;
  complete(turnId: string, result: { state: 'completed' | 'failed'; result_hash: string } | { state: 'unknown'; result_hash: null }): Promise<unknown>;
  revoke(): Promise<unknown>;
}
export interface CompanionExecutionHostPorts {
  snapshot(): Promise<CompanionAuthoritySnapshot | null>;
  /** From the authenticated, unchanged activated-pass execution-context route; never a browser claim. */
  model(): Promise<CompanionExecutionModel | null>;
  /** Same owner/task/file path/profile/consent; file contents may change during the authorized turn. */
  current(snapshot: CompanionAuthoritySnapshot, model: CompanionExecutionModel): boolean;
  confirm(snapshot: CompanionAuthoritySnapshot, grant: Readonly<CompanionExecutionGrantScope>): Promise<boolean>;
  client(grant: Readonly<CompanionExecutionGrantScope>, model: Readonly<CompanionExecutionModel>, current: () => boolean): CompanionExecutionClientPort;
  submit(input: PreparedCompanionNormalTurn): Promise<CompanionNormalTurnResult>;
  now?(): number;
}
export interface CompanionExecutionHostResult {
  schema: 'hps-companion-execution-result/1'; requestId: string; requestHash: string;
  state: 'denied' | 'outcome_unknown' | 'completed' | 'failed'; code: string;
  turnId?: string; artifactVersion?: string;
}
type Lease = {
  snapshot: CompanionAuthoritySnapshot; model: Readonly<CompanionExecutionModel>;
  scope: Readonly<CompanionExecutionGrantScope>; client: CompanionExecutionClientPort;
  digest: string; controller: AbortController; unknown: boolean; completed: number;
};
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const sha = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const stableScope = (s: CompanionAuthoritySnapshot) => JSON.stringify([
  s.preparation, s.pair, s.accountId, s.accountSessionId, s.binding, s.profile.profile_id,
  s.profile.activity_id, s.profile.sdk_tools, s.profile.minor_cohort, s.profile.pass?.expires_at,
  s.taskId, s.epoch, s.consentRevision, s.folderReadAllowed, s.host, s.artifact.id, s.artifact.path,
]);

export class CompanionExecutionHost {
  private lease?: Lease;
  private busy = false;
  private closed = false;
  private readonly results = new Map<string, CompanionExecutionHostResult>();
  private readonly ports: CompanionExecutionHostPorts;
  constructor(ports: CompanionExecutionHostPorts) { this.ports=ports; }
  private now() { return (this.ports.now ?? Date.now)(); }
  private current(lease: Lease): boolean {
    try { return !this.closed && this.lease === lease && !lease.controller.signal.aborted
      && this.now() < lease.scope.expires_at * 1000 && this.ports.current(lease.snapshot, lease.model) === true; }
    catch { return false; }
  }
  view(): Readonly<{state: 'off' | 'ready' | 'busy' | 'unknown' | 'closed'; expiresAt?: number; remaining?: number}> {
    const l = this.lease;
    return Object.freeze({ state: this.closed ? 'closed' : !l ? 'off' : l.unknown ? 'unknown' : this.busy ? 'busy' : this.current(l) ? 'ready' : 'off',
      ...(l ? {expiresAt:l.scope.expires_at, remaining:Math.max(0,l.scope.max_turns-l.completed)} : {}) });
  }
  /** One actual native confirmation creates one short lease. Replacing an uncertain lease is refused. */
  async authorize(): Promise<boolean> {
    if (this.closed || this.busy || this.lease) return false;
    this.busy = true;
    try {
      const before = await this.ports.snapshot(), model = await this.ports.model();
      if (this.closed || !before || !model || !validCompanionAuthority(before,this.now())
        || before.profile.coach_runtime !== 'agent-sdk' || before.profile.sdk_tools?.write !== true
        || model.model_profile_id !== before.profile.profile_id || !this.ports.current(before,model)) return false;
      const scope = Object.freeze({grant_id:'ceg_'+randomUUID().replaceAll('-',''),task_id:before.taskId,artifact_id:before.artifact.id,
        epoch:before.epoch,consent_revision:before.consentRevision,selection_hash:before.artifact.version,
        max_turns:2,max_calls_per_turn:12,expires_at:Math.min(Math.floor(this.now()/1000)+600,before.pair.grant_expires_at)});
      if (!await this.ports.confirm(structuredClone(before),scope) || this.closed || !this.ports.current(before,model)) return false;
      const after = await this.ports.snapshot(), freshModel = await this.ports.model();
      if (!after || !freshModel || stableScope(after)!==stableScope(before) || after.version!==before.version
        || after.artifact.version!==before.artifact.version || JSON.stringify(freshModel)!==JSON.stringify(model)) return false;
      const lease: Lease = {snapshot:structuredClone(before),model:Object.freeze({...model}),scope,digest:'',
        client:undefined as unknown as CompanionExecutionClientPort,controller:new AbortController(),unknown:false,completed:0};
      this.lease = lease;
      lease.client=this.ports.client(scope,lease.model,()=>this.current(lease));
      // An ambiguous issue reply never permits another automatic issue or a model dispatch.
      lease.unknown=true;
      const result=await lease.client.issue();
      if (!this.current(lease) || !object(result) || !object(result.grant) || result.grant.id!==scope.grant_id
        || !sha(result.grant.grant_digest)) return false;
      lease.digest=result.grant.grant_digest;lease.unknown=false;return true;
    } catch { return false; } finally { this.busy=false; }
  }
  async handle(message: VerifiedCompanionMessage): Promise<CompanionExecutionHostResult> {
    const intent=parseCompanionAuthoringIntent(message?.text), requestHash=hash(message?.text ?? '');
    const base={schema:'hps-companion-execution-result/1' as const,requestId:intent?.requestId ?? message?.messageId ?? '',requestHash};
    const denied=(code:string):CompanionExecutionHostResult=>({...base,state:'denied',code});
    if (!intent || message.sender!=='device' || message.messageId!==intent.requestId) return denied('invalid_authoring_intent');
    const prior=this.results.get(intent.requestId);
    if (prior) return prior.requestHash===requestHash ? structuredClone(prior) : denied('request_id_conflict');
    const lease=this.lease;
    if (!lease || this.busy || lease.unknown || !this.current(lease) || lease.completed>=lease.scope.max_turns) return denied('execution_lease_unavailable');
    if (message.invitationId!==lease.snapshot.pair.id || message.invitationDigest!==lease.snapshot.pair.invitation_digest
      || message.claimDigest!==lease.snapshot.pair.claim_digest || intent.pairingId!==message.invitationId) return denied('paired_sender_mismatch');
    this.busy=true;
    let reserved=false;
    const turnId=randomUUID(), request={turn_id:turnId,request_id:intent.requestId,request_hash:requestHash,selection_hash:intent.selection.artifactVersion};
    const unknown=():CompanionExecutionHostResult=>({...base,state:'outcome_unknown',code:'execution_reconciliation_required',turnId});
    try {
      const selected=await this.ports.snapshot(), model=await this.ports.model();
      if (!this.current(lease) || !selected || !model || stableScope(selected)!==stableScope(lease.snapshot)
        || JSON.stringify(model)!==JSON.stringify(lease.model) || !validCompanionAuthority(selected,this.now())) return denied('current_authority_required');
      const selection=companionSelectionRequest(selected,intent.selection.requestId);
      if (JSON.stringify(selection)!==JSON.stringify(intent.selection)) {
        if (!Object.entries(selection).every(([k,v])=>intent.selection[k as keyof typeof selection]===v)) return denied('selection_changed');
      }
      const expected={packet:message.text,selection,pairingId:intent.pairingId,accountId:selected.accountId,hostSessionId:selected.accountSessionId,
        deviceSessionId:selected.pair.device_session_id,grantId:lease.scope.grant_id,grantDigest:lease.digest,turnId,
        modelSessionId:model.model_session_id,modelTokenJti:model.model_token_jti,modelProfileId:model.model_profile_id,
        expiresAt:lease.scope.expires_at,maxTurns:lease.scope.max_turns,maxCallsPerTurn:lease.scope.max_calls_per_turn};
      // Retain uncertainty before the request can leave this process. A lost reply cannot allocate another turn.
      reserved=true;lease.unknown=true;this.results.set(intent.requestId,unknown());
      const verify=async()=>{
        if (!this.current(lease)) throw Error('companion_execution_owner_changed');
        const raw=await lease.client.reserve(request);
        if (!this.current(lease)) throw Error('companion_execution_owner_changed');
        return verifyCompanionExecutionReservation(JSON.stringify(raw),expected,this.now());
      };
      const receipt=await verify();
      const policy=createCompanionExecutionPolicy({workspaceRoot:selected.preparation.workspace,artifactPath:selected.artifact.path,
        expiresAt:receipt.expiresAtMs,isCurrent:()=>this.current(lease),now:()=>this.now()});
      const result=await this.ports.submit({packet:message.text,createdAt:this.now(),reservation:receipt.reservation,
        executionBinding:receipt.sdkBinding,verifyReservation:async()=>(await verify()).reservation,
        current:()=>this.current(lease),executionPolicy:policy,signal:lease.controller.signal});
      const measured=companionNormalTurnResult({requestId:intent.requestId,requestHash,taskId:selection.taskId,text:intent.text,
        artifactId:selection.artifactId,artifactVersion:selection.artifactVersion},receipt.reservation,result.run);
      if (!this.current(lease) || result.requestId!==intent.requestId || result.requestHash!==requestHash
        || !result.run || measured.state!==result.state || !['completed','failed'].includes(result.state)
        || !sha(result.run.afterArtifactVersion)) return unknown();
      const completion=await lease.client.complete(turnId,{state:result.state as 'completed'|'failed',result_hash:result.run.afterArtifactVersion});
      if (!this.current(lease) || !object(completion) || !object(completion.turn) || completion.turn.turn_id!==turnId
        || completion.turn.state!==result.state || completion.turn.result_hash!==result.run.afterArtifactVersion) return unknown();
      const terminal:CompanionExecutionHostResult={...base,state:result.state as 'completed'|'failed',code:'normal_turn_measured',turnId,artifactVersion:result.run.afterArtifactVersion};
      lease.completed++;lease.unknown=false;this.results.set(intent.requestId,Object.freeze(terminal));return terminal;
    } catch { return reserved ? unknown() : denied('execution_not_started'); }
    finally { this.busy=false; }
  }
  /** Stops local effects immediately, even if the signed remote revocation is unavailable. */
  close(): void { this.closed=true;this.lease?.controller.abort(); }
}
