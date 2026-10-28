/** Explicit native DEV lifecycle. No automatic registration, listener, browser execution endpoint or receive start. */
import {CompanionReceivingLifetime, type CompanionReceivingView} from './companionReceivingLifetime.ts';
import { createDevCompanionAuthoringHost } from './companionAuthoringHostNative.ts';
import * as vscode from 'vscode';
import { createCompanionExecutionTransport, type CompanionExecutionTransportRequest } from './companionExecutionTransport.ts';
import { CompanionExecutionHost, type CompanionExecutionClientPort, type CompanionExecutionGrantScope, type CompanionExecutionModel } from './companionExecutionHost.ts';
import type { PreparedCompanionNormalTurn, CompanionNormalTurnResult } from './companionNormalTurn.ts';
import { folderConsentState } from './folderConsentHost.ts';
import type { CompanionAuthoringHostPorts } from './companionAuthoringHost.ts';
import type { CompanionAuthoringResult } from './companionAuthoringResult.ts';
import { ExtensionMode } from 'vscode';
import { accountPreviewEnabled, type AccountSession } from './accountSession.ts';
import type { ActivityConnections } from './activityConnections.ts';
import { readPreparedCompanionWorkspace } from './companionWorkspaceHost.ts';
import { companionDigest, type CompanionPreparation } from './companionWorkspace.ts';
import { createCompanionAuthenticatedTransport } from './companionAuthenticatedTransport.ts';
import type { CompanionAdapterPairingTransport, CompanionAdapterRelayTransport } from './companionClientAdapter.ts';
import { createDevCompanionHostBridge, createDevCompanionAuthoritySnapshot, type CompanionNativeBridgePorts } from './companionHostBridgeNative.ts';
import { CompanionHostSession, type CompanionHostSessionClient, type CompanionHostSessionPair, type CompanionHostTurn } from './companionHostSession.ts';
import type { CompanionHostRequest } from './companionHostDispatch.ts';
import type { CompanionTransportBudget } from './companionTransportBudget.ts';
import { createCompanionSelection, type CompanionSelectionPublication } from './companionSelection.ts';

/** Native-only QR challenge. It is never included in view()/selected-file descriptors. */
export interface CompanionHostChallenge {
  schema: string; id: string; invite_secret: string; host_key: string;
  invitation_digest: string; host_invite_proof: string; challenge_expires_at: number;
}
export interface CompanionHostPairingClient {
  invitation: object | null;
  keys?: unknown; qr?: unknown; claim?: unknown; frozenClaim?: unknown;
  start(scope: { host_id: string; workspace_id: string; project_id: string }): Promise<CompanionHostChallenge>;
  refresh(): Promise<unknown>;
  approve(comparedCode: string): Promise<unknown>;
  revoke(): Promise<unknown>;
}
export interface CompanionDevHostOwnerPorts extends Omit<CompanionNativeBridgePorts, 'paired'> {
  receivingBusy?(): boolean;
  authoring?: Pick<CompanionAuthoringHostPorts,'store'> & Required<Pick<CompanionAuthoringHostPorts,'reviewDraft'>>;
  execution?: { submit(input: PreparedCompanionNormalTurn): Promise<CompanionNormalTurnResult> };
  accounts: AccountSession;
  connections: ActivityConnections;
  configured(): { service: string; site: string };
  identity: Readonly<{ accountId: string; sessionId: string }>;
  /** Shared and caller-owned. This owner admits actual HTTP only; do not wrap its client methods again. */
  budget: Pick<CompanionTransportBudget, 'run'>;
  fetch?: typeof fetch;
  clients: {
    pairing(options: { role: 'host'; sessionId: string; transport: CompanionAdapterPairingTransport }): CompanionHostPairingClient;
    relay(options: { pairing: CompanionHostPairingClient; transport: CompanionAdapterRelayTransport }): CompanionHostSessionClient & {
      publishOffer(): Promise<unknown>; connect(): Promise<unknown>;
    };
    execution?(options: {host: CompanionHostPairingClient; grant: Readonly<CompanionExecutionGrantScope>; model: Readonly<CompanionExecutionModel>;
      current(): boolean; nativeTransport(request: CompanionExecutionTransportRequest): Promise<unknown>;
      modelTransport(request: CompanionExecutionTransportRequest): Promise<unknown>}): CompanionExecutionClientPort;
  };
}
export interface CompanionDevHostView {
  state: 'idle' | 'inviting' | 'claimed' | 'approved' | 'connected' | 'closed' | 'revoked';
  pairingId?: string; comparisonCode?: string; expiresAt?: number;
  reason?: 'local_close' | 'scope_changed' | 'cancelled' | 'revocation_unconfirmed';
  executionAuthorized: false;
  receiving?: Readonly<CompanionReceivingView>;
  scopedExecution?: ReturnType<CompanionExecutionHost['view']>;
  publication?: Readonly<CompanionSelectionPublication>;
}
type PairRow = Omit<CompanionHostSessionPair, 'status' | 'device_session_id' | 'device_id' | 'claim_digest'> & {
  status: string; device_session_id: string | null; device_id: string | null; claim_digest: string | null; compare_code?: string | null;
};
type Binding = { preparation: CompanionPreparation; config: { service: string; site: string }; activity: string };
const failure = (code: string) => Error(`companion_dev_host_${code}`);

/**
 * One prepared workspace and existing authenticated account session. Existing native lifecycle
 * callbacks must call close() on signout/config/workspace disposal; every explicit operation and
 * admitted HTTP also checks that binding. No new event subscription or timer is installed here.
 */
export class CompanionDevHostOwner {
  private readonly ports: CompanionDevHostOwnerPorts;
  private readonly identity: Readonly<{ accountId: string; sessionId: string }>;
  private binding: Binding | undefined;
  private pairing: CompanionHostPairingClient | undefined;
  private relay: ReturnType<CompanionDevHostOwnerPorts['clients']['relay']> | undefined;
  private bridge: ReturnType<typeof createDevCompanionHostBridge> | undefined;
  private session: CompanionHostSession | undefined;
  private authoring: ReturnType<typeof createDevCompanionAuthoringHost> | undefined;
  private execution: CompanionExecutionHost | undefined;
  private state: CompanionDevHostView = { state: 'idle', executionAuthorized: false };
  private active: { name: string; promise: Promise<unknown>; abort: AbortController; interrupt(): void } | undefined;
  private signal: AbortSignal | undefined;
  private publication: {text:string;messageId:string;request:Readonly<CompanionHostRequest>;revision:number;state:CompanionSelectionPublication['state']} | undefined;
  private publicationRevision = 0;
  private readonly receiving: CompanionReceivingLifetime;
  private readonly receivingListeners = new Set<() => void>();
  private semanticNeedsCheck = false;
  private receivingScope?: string;
  private revocation?: {pair: CompanionHostPairingClient; id: string; statusAdmitted: boolean; revokeAdmitted: boolean; controller: AbortController; promise: Promise<Readonly<CompanionDevHostView>>};

  constructor(ports: CompanionDevHostOwnerPorts) {
    this.ports = ports; this.identity = Object.freeze({ ...ports.identity });
    this.receiving=new CompanionReceivingLifetime({remainingMs:()=>Math.min(this.state.expiresAt??0,this.execution?.view().expiresAt??Infinity)*1000-Date.now(),
      gate:()=>this.state.state!=='connected'||this.revocation||this.receivingScope!==this.localReceivingScope()?'closed':this.semanticNeedsCheck||this.execution?.view().state==='unknown'||this.execution?.view().remaining===0?'needs-check':this.active||this.ports.receivingBusy?.()?'busy':'ready',
      receive:signal=>this.receiveTurn(signal),changed:view=>{if(view.state==='closed'&&!this.revocation&&this.state.state==='connected')this.close('scope_changed');for(const listener of this.receivingListeners)try{listener();}catch{}}});
  }
  onReceivingChanged(listener:()=>void): {dispose():void} {this.receivingListeners.add(listener);return{dispose:()=>this.receivingListeners.delete(listener)};}
  private localReceivingScope(): string {
    const task=this.ports.taskView();return JSON.stringify([this.ports.epoch(),task?.scope,task?.activeTaskId,!!task?.error]);
  }
  startReceiving(): boolean {
    if(this.state.state!=='connected'||this.revocation||!this.ports.taskView()?.activeTaskId||this.ports.taskView()?.error)return false;
    if(!['listening','processing','awaiting-approval'].includes(this.receiving.view().state))this.receivingScope=this.localReceivingScope();
    return this.receiving.start();
  }
  stopReceiving(): void {this.receiving.stop();if(this.active?.name==='receive')this.close('cancelled');}
  approval(waiting:boolean): void {this.receiving.approval(waiting);}
  view(): Readonly<CompanionDevHostView> { return Object.freeze({ ...this.state, receiving:this.receiving.view(), ...(this.execution?{scopedExecution:this.execution.view()}:{}), ...(this.publication?{publication:Object.freeze({state:this.publication.state,requestId:this.publication.request.requestId,messageId:this.publication.messageId,revision:this.publication.revision})}:{}) }); }
  private check(allowRevoking=false): void { if (this.state.state === 'closed' || this.state.state === 'revoked' || (this.revocation&&!allowRevoking)) throw failure('closed'); }
  private erase(pairing = this.pairing): void {
    if (pairing) { pairing.keys = null; pairing.qr = null; pairing.claim = null; pairing.frozenClaim = null; }
  }
  private release(): void {
    this.execution?.close(); this.execution = undefined;
    this.publication = undefined; this.authoring?.close(); this.authoring = undefined;
    if (this.session) this.session.close(); else this.relay?.close();
    this.erase(); this.pairing = undefined; this.relay = undefined; this.session = undefined; this.bridge = undefined; this.binding = undefined;
    this.authenticatedRelay = async () => { throw failure('closed'); };
  }
  private async current(allowRevoking=false): Promise<Binding> {
    this.check(allowRevoking);
    const configured = this.ports.configured();
    if (this.ports.context.extensionMode !== ExtensionMode.Development || !this.ports.accounts.matches(configured.service, configured.site)
      || !accountPreviewEnabled(true, configured.service, configured.site)) { this.close('scope_changed'); throw failure('scope_changed'); }
    const stored = await this.ports.accounts.sessionIdentity(); this.check(allowRevoking);
    const token = await this.ports.accounts.accessToken(); this.check(allowRevoking);
    const prepared = await readPreparedCompanionWorkspace(this.ports.context, this.ports.connections); this.check(allowRevoking);
    const active = this.ports.connections.current;
    if (this.ports.context.extensionMode !== ExtensionMode.Development || !stored || !token
      || stored.sessionId !== this.identity.sessionId || stored.service !== configured.service
      || !this.ports.accounts.matches(configured.service, configured.site) || prepared.status !== 'UNPAIRED' || !prepared.preparation || !active) {
      this.close('scope_changed'); throw failure('scope_changed');
    }
    const value = { preparation: { ...prepared.preparation }, config: { ...configured },
      activity: JSON.stringify([active.id, active.ref, active.serverId, active.workspace, active.accountPass]) };
    if (this.binding && JSON.stringify(value) !== JSON.stringify(this.binding)) { this.close('scope_changed'); throw failure('scope_changed'); }
    return value;
  }
  private run<T>(name: string, signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
    try { this.check(); } catch (error) { return Promise.reject(error); }
    if (this.active) return name === 'receive' && this.active.name === name ? this.active.promise as Promise<T> : Promise.reject(failure('busy'));
    let interrupt!: () => void; const controller = new AbortController();
    const stopped = new Promise<never>((_, reject) => { interrupt = () => reject(failure('closed')); });
    const abort = () => {if(this.revocation){controller.abort();interrupt();}else this.close('cancelled');};
    const underlying = (async () => {
      try { await this.current(); this.check(); const value = await work(); if (this.state.state !== 'revoked') { await this.current(); this.check(); } return value; }
      finally { if (this.state.state === 'closed' || this.state.state === 'revoked') this.erase(); }
    })();
    const promise = Promise.race([underlying, stopped]).finally(() => { signal?.removeEventListener('abort', abort); if(this.active?.promise===promise){this.signal = undefined; this.active = undefined;} });
    this.signal = controller.signal; this.active = { name, promise, abort: controller, interrupt };
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    return promise;
  }
  private row(): PairRow {
    const row = this.pairing?.invitation as PairRow | null;
    const p = this.binding?.preparation;
    if (!row || !p || row.account_id !== this.identity.accountId || row.host_session_id !== this.identity.sessionId
      || row.host_id !== p.hostId || row.project_id !== p.projectId || row.workspace_id !== companionDigest('hps-companion-workspace/1:' + p.scope)) {
      this.close('scope_changed'); throw failure('pair_scope_changed');
    }
    return row;
  }
  private async refreshPaired(): Promise<CompanionHostSessionPair | null> {
    await this.current(); await this.pairing!.refresh(); await this.current();
    const row = this.row(); return row.status === 'paired' ? row as CompanionHostSessionPair : null;
  }
  startInvitation(signal?: AbortSignal): Promise<{ challenge: Readonly<CompanionHostChallenge>; view: Readonly<CompanionDevHostView> }> {
    return this.run('start', signal, async () => {
      if (this.state.state !== 'idle') throw failure('already_started');
      let ownedPair: CompanionHostPairingClient | undefined;
      try {
      this.binding = await this.current();
      const transport = createCompanionAuthenticatedTransport({ context: this.ports.context, accounts: this.ports.accounts,
        configured: this.ports.configured, identity: this.identity, role: 'host',
        dispatch: (url, init) => this.ports.budget.run(async () => { const revoking=!!this.revocation&&['status','revoke'].some(action=>new URL(String(url)).pathname==='/v1/companion/invitations/'+this.revocation!.id+'/'+action); await this.current(revoking); const value = await (this.ports.fetch ?? fetch)(url, init);
          try { await this.current(revoking); return value; } catch (error) { void value.body?.cancel().catch(() => {}); throw error; } }, init?.signal ?? undefined) });
      await transport.resolveIdentity(this.signal); await this.current();
      this.authenticatedRelay = (role, id, action, raw) => transport.relay(role, id, action, raw, this.signal);
      const pairing = this.ports.clients.pairing({ role: 'host', sessionId: this.identity.sessionId,
        transport: (role, id, action, payload) => {
          const revocation=this.revocation;
          if(revocation){
            if(role!=='host'||id!==revocation.id||(action!=='status'&&action!=='revoke')||action==='status'&&revocation.statusAdmitted||action==='revoke'&&revocation.revokeAdmitted)return Promise.reject(failure('closed'));
            if(action==='status')revocation.statusAdmitted=true;else revocation.revokeAdmitted=true;
            return transport.pairing(role,id,action,payload,revocation.controller.signal);
          }
          return transport.pairing(role,id,action,payload,this.signal);
        } });
      this.pairing = pairing; ownedPair = pairing;
      this.bridge = createDevCompanionHostBridge({ ...this.ports, approval:waiting=>this.approval(waiting), paired: async () => { const row = await this.refreshPaired(); return row ? { ...row, execution_authorized: false } : null; } });
      if(this.ports.authoring) this.authoring=createDevCompanionAuthoringHost({...this.ports,...this.ports.authoring,approval:waiting=>this.approval(waiting),
        paired:async()=>{const row=await this.refreshPaired();return row?{...row,execution_authorized:false}:null;},
        lifecycle:{capture:()=>this.ports.epoch(),isCurrent:revision=>!['closed','revoked'].includes(this.state.state)&&this.ports.epoch()===revision},
        imported:async()=>{throw failure('draft_review_required');}});
      await this.bridge.recover(); await this.current();
      const p = this.binding.preparation, challenge = await pairing.start({ host_id: p.hostId, workspace_id: companionDigest('hps-companion-workspace/1:' + p.scope), project_id: p.projectId });
      await this.current(); const row = this.row();
      this.state = { state: 'inviting', pairingId: row.id, expiresAt: row.grant_expires_at, executionAuthorized: false };
      return { challenge: Object.freeze({ schema: challenge.schema, id: challenge.id, invite_secret: challenge.invite_secret, host_key: challenge.host_key,
        invitation_digest: challenge.invitation_digest, host_invite_proof: challenge.host_invite_proof, challenge_expires_at: challenge.challenge_expires_at }), view: this.view() };
      } catch (error) { this.close(); throw error; }
      finally { if (this.state.state === 'closed') this.erase(ownedPair); }
    });
  }
  inspectClaim(signal?: AbortSignal): Promise<Readonly<CompanionDevHostView>> {
    return this.run('inspect', signal, async () => {
      if (!this.pairing || !['inviting', 'claimed'].includes(this.state.state)) throw failure('invitation_required');
      await this.pairing.refresh(); await this.current(); const row = this.row();
      if (row.status !== 'claimed' || typeof row.compare_code !== 'string' || !/^[a-f0-9]{12}$/.test(row.compare_code)) throw failure('claim_required');
      this.state = { ...this.state, state: 'claimed', comparisonCode: row.compare_code }; return this.view();
    });
  }
  confirmComparedCode(comparedCode: string, signal?: AbortSignal): Promise<Readonly<CompanionDevHostView>> {
    return this.run('confirm', signal, async () => {
      if (this.state.state !== 'claimed' || comparedCode !== this.state.comparisonCode) throw failure('explicit_comparison_required');
      await this.pairing!.approve(comparedCode); await this.current(); this.row();
      this.state = { ...this.state, state: 'approved', comparisonCode: undefined }; return this.view();
    });
  }
  connectCipher(signal?: AbortSignal): Promise<Readonly<CompanionDevHostView>> {
    return this.run('connect', signal, async () => {
      if (!this.pairing || this.state.state !== 'approved') throw failure('approval_required');
      const paired = await this.refreshPaired(); if (!paired) throw failure('device_consume_required');
      if (!this.relay) this.relay = this.ports.clients.relay({ pairing: this.pairing,
        transport: (role, id, action, raw) => this.authenticatedRelay(role, id, action, raw) });
      await this.relay.publishOffer(); await this.current(); await this.relay.connect(); await this.current();
      this.session = new CompanionHostSession({ shouldContinue:()=>!this.semanticNeedsCheck&&this.execution?.view().remaining!==0, client: this.relay, currentPair: () => this.refreshPaired(), onClosed:()=>{if(!this.revocation)this.close('scope_changed');}, bridge: {handleAndReply:async(message,reply)=>{
        let schema: unknown;try{schema=JSON.parse(message.text)?.schema;}catch{this.close();throw failure('invalid_message');}
        if(schema==='hps-companion-host-request/1'){const outcome=await this.bridge!.handleAndReply(message,reply);this.observeOutcome(outcome);return outcome;}
        if(schema!=='hps-companion-authoring-intent/1'||!this.authoring){this.close();throw failure('unsupported_message');}
        if(this.execution){
          const result=await this.execution.handle(message);this.observeOutcome(result);await this.current();this.check();
          const text=JSON.stringify(result),id='execution_result_'+companionDigest(text);
          await reply.prepare(text,id);await this.current();this.check();await reply.send(id);await this.current();this.check();
          return result;
        }
        const outcome=await this.authoring.handle(message);this.observeOutcome(outcome);await this.current();this.check();
        const result:CompanionAuthoringResult={schema:'hps-companion-authoring-result/1',requestId:message.messageId,
          requestHash:companionDigest(message.text),outcome};
        const text=JSON.stringify(result),id='authoring_result_'+companionDigest(text);
        await reply.prepare(text,id);await this.current();this.check();await reply.send(id);await this.current();this.check();
        return outcome;
      }} });
      this.state = { ...this.state, state: 'connected' }; return this.view();
    });
  }
  private authenticatedRelay: CompanionAdapterRelayTransport = async () => { throw failure('transport_unavailable'); };
  /** Explicit native gesture, separate from pairing and preview publication. No production registration. */
  authorizeSelectedExecution(signal?: AbortSignal): Promise<Readonly<CompanionDevHostView>> {
    return this.run('authorize_execution',signal,async()=>{
      if(this.state.state!=='connected'||!this.pairing||!this.ports.execution||!this.ports.clients.execution)throw failure('execution_unavailable');
      if(this.execution){await this.execution.authorize();await this.current();return this.view();}
      const transport=createCompanionExecutionTransport({context:this.ports.context,accounts:this.ports.accounts,
        configured:this.ports.configured,identity:this.identity,fetch:this.ports.fetch??fetch,budget:this.ports.budget,
        currentModel:async()=>{await this.current();const token=await this.ports.connections.token();await this.current();return token?{token}:undefined;}});
      await transport.resolveIdentity(this.signal);
      const token=await this.ports.connections.token();if(!token)throw failure('existing_model_required');
      const tokenDigest=companionDigest(token),model=await transport.resolveModel(this.signal),after=await this.ports.connections.token();
      if(!after||companionDigest(after)!==tokenDigest)throw failure('existing_model_required');
      const snapshot=createDevCompanionAuthoritySnapshot({...this.ports,paired:async()=>{
        const row=await this.refreshPaired();return row?{...row,execution_authorized:false}:null;
      }});
      this.execution=new CompanionExecutionHost({snapshot,model:async()=>{
        await this.current();const fresh=await this.ports.connections.token();await this.current();
        return fresh&&companionDigest(fresh)===tokenDigest?model:null;
      },current:(s)=>{
        const active=this.ports.connections.current,task=this.ports.taskView(),account=this.ports.accounts.view();
        // Chat focus may have no active text editor. An explicitly selected different
        // document or an unsaved/closed granted document revokes this local turn.
        const editor=vscode.window.activeTextEditor?.document;
        const document=vscode.workspace.textDocuments?.find(d=>d.uri.scheme==='file'&&d.uri.fsPath===s.artifact.path)??editor;
        const folder=folderConsentState(this.ports.context,s.profile,{servedRoot:s.profile.workspace_root,instructor:false});
        return this.state.state==='connected'&&this.ports.epoch()===s.epoch&&task?.activeTaskId===s.taskId
          &&!task.error&&task.scope===companionDigest(s.preparation.scope)&&!!document&&document.uri.scheme==='file'&&document.uri.fsPath===s.artifact.path
          &&!document.isDirty&&!document.isUntitled&&(!editor||editor.uri.fsPath===s.artifact.path)
          &&account.status==='signedIn'&&account.account?.id===s.accountId&&vscode.workspace.isTrusted&&!vscode.env.remoteName
          &&this.ports.connections.matchesService&&active?.id===s.preparation.activityId&&active.workspace===s.preparation.workspace
          &&active.accountPass?.sessionId===s.binding.sessionId&&active.accountPass?.passId===s.binding.passId
          &&['skip','full'].includes(folder.tag)&&parseInt(companionDigest(JSON.stringify(folder)).slice(0,12),16)===s.consentRevision;
      },confirm:async(s,grant)=>{
        return await vscode.window.showWarningMessage('이 휴대폰에서 선택한 HTML 수정을 요청하도록 허용할까요?',{modal:true,
          detail:[`파일: ${s.artifact.path}`,`휴대폰: ${s.pair.device_id}`,
            `최대 ${grant.max_turns}번 · ${Math.max(0,Math.floor((grant.expires_at*1000-Date.now())/60000))}분 동안 이 파일만 수정해요.`,
            '현재 컴퓨터의 이용권을 사용해요. 기존 폴더·도구 승인은 유지돼요. 컴퓨터를 닫거나 연결을 끊으면 실행하지 않아요.',
            '아직 자동으로 요청을 받지는 않아요. 준비 후 요청 받기를 직접 선택해 주세요.'].join('\n\n')},'이 파일 수정 허용')==='이 파일 수정 허용';
      },client:(grant,identity,current)=>this.ports.clients.execution!({host:this.pairing!,grant,model:identity,current,
        nativeTransport:request=>transport.native(request,this.signal),modelTransport:request=>transport.model(request,this.signal)}),
      submit:input=>this.ports.execution!.submit(input)});
      const allowed=await this.execution.authorize();
      // A cancelled modal produced no lease. Preserve the existing explicit draft-import path.
      // An uncertain issue receipt retains its lease and must never silently fall back.
      if(!allowed&&this.execution.view().expiresAt===undefined)this.execution=undefined;
      await this.current();return this.view();
    });
  }
  describeSelected(requestId: string, signal?: AbortSignal): Promise<CompanionHostRequest | null> {
    return this.run('describe', signal, async () => {
      if (this.state.state !== 'connected') throw failure('cipher_required');
      return this.bridge!.describe(requestId);
    });
  }
  /** Explicit encrypted declaration only. HTTP acceptance never claims phone receipt or file approval. */
  publishSelected(requestId:string,signal?:AbortSignal):Promise<Readonly<CompanionSelectionPublication>> {
    return this.run('publish',signal,async()=>{
      if(this.state.state!=='connected')throw failure('cipher_required');
      if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(requestId))throw failure('selection_request_id');
      const held=this.publication;
      if(held&&held.request.requestId!==requestId&&held.state==='delivery_unconfirmed')throw failure('selection_pending');
      const selected=await this.bridge!.describe(requestId);this.check();
      if(!selected){if(held)this.close('scope_changed');throw failure('selection_unavailable');}
      const pair=await this.refreshPaired();if(!pair)throw failure('paired_required');
      if(held&&held.request.requestId===requestId){
        if(JSON.stringify(selected)!==JSON.stringify(held.request)){this.close('scope_changed');throw failure('selection_changed');}
      }else{
        const encoded=await createCompanionSelection(selected,pair,++this.publicationRevision);this.check();
        this.publication={...encoded,revision:this.publicationRevision,state:'delivery_unconfirmed'};
      }
      const publication=this.publication!;
      // The reviewed client preserves prepared wire bytes for this immutable transport ID.
      await this.relay!.prepare(publication.text,publication.messageId);this.check();
      const fresh=await this.bridge!.describe(requestId);this.check();
      if(!fresh||JSON.stringify(fresh)!==JSON.stringify(publication.request)){this.close('scope_changed');throw failure('selection_changed');}
      try{await this.relay!.send(publication.messageId);this.check();publication.state='transport_accepted';}
      catch{this.check();publication.state='delivery_unconfirmed';}
      const after=await this.bridge!.describe(requestId);this.check();
      if(!after||JSON.stringify(after)!==JSON.stringify(publication.request)){this.close('scope_changed');throw failure('selection_changed');}
      return Object.freeze({state:publication.state,requestId,messageId:publication.messageId,revision:publication.revision});
    });
  }
  private observeOutcome(value: {state:string;code?:string}): void {
    if(['outcome_unknown','wait_for_host','running','accepted'].includes(value.state)||['journal_unavailable','authority_changed','runtime_authority_required','execution_lease_unavailable','current_authority_required'].includes(value.code??''))this.semanticNeedsCheck=true;
  }
  receiveAndHandle(signal?: AbortSignal): Promise<CompanionHostTurn> {
    if(['listening','processing','awaiting-approval'].includes(this.receiving.view().state))return Promise.reject(failure('receiving_active'));
    return this.receiveTurn(signal);
  }
  private receiveTurn(signal?: AbortSignal): Promise<CompanionHostTurn & {needsCheck?:boolean}> {
    return this.run('receive', signal, async () => {
      if (this.state.state !== 'connected') throw failure('cipher_required');
      const turn=await this.session!.receiveAndHandle();
      return {...turn,...(this.semanticNeedsCheck?{needsCheck:true}:{})};
    });
  }
  /** Fence effects immediately, retain only this pair's signer for one bounded revoke, then erase. */
  revoke(signal?: AbortSignal): Promise<Readonly<CompanionDevHostView>> {
    if(this.revocation)return this.revocation.promise;
    try{this.check();if(!this.pairing)throw failure('invitation_required');}catch(error){return Promise.reject(error);}
    const pair=this.pairing!,id=this.row().id,controller=new AbortController();
    const revocation={pair,id,statusAdmitted:false,revokeAdmitted:false,controller,promise:undefined as unknown as Promise<Readonly<CompanionDevHostView>>};this.revocation=revocation;
    this.receiving.close();this.execution?.close();this.authoring?.close();this.session?.close();this.active?.abort.abort();this.active?.interrupt();
    let timer: ReturnType<typeof setTimeout>;const abort=()=>controller.abort();
    const expired=new Promise<never>((_,reject)=>{const stop=()=>reject(failure('revocation_unconfirmed'));controller.signal.addEventListener('abort',stop,{once:true});timer=setTimeout(()=>controller.abort(),12000);});
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    const operation=(async()=>{await this.current(true);if(controller.signal.aborted)throw failure('cancelled');await pair.revoke();await this.current(true);
      if(controller.signal.aborted||this.row().status!=='revoked')throw failure('revocation_unconfirmed');return true;})();
    revocation.promise=Promise.race([operation,expired]).then(()=>{this.state={state:'revoked',executionAuthorized:false};return this.view();},()=>{
      this.state={state:'closed',reason:'revocation_unconfirmed',executionAuthorized:false};return this.view();
    }).finally(()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort();this.release();});
    return revocation.promise;
  }
  /** Local disposal is not a signed remote revoke. Caller owns budget/stores and their disposal. */
  close(reason: CompanionDevHostView['reason'] = 'local_close'): void {
    if (this.state.state === 'closed' || this.state.state === 'revoked') return;
    this.state = { state: 'closed', reason, executionAuthorized: false };
    this.receiving.close();this.revocation?.controller.abort();
    this.release(); this.active?.abort.abort(); this.active?.interrupt();
  }
}
