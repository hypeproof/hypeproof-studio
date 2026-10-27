/** Explicit native DEV lifecycle. No registration, listener, browser execution endpoint or poll. */
import { ExtensionMode } from 'vscode';
import { accountPreviewEnabled, type AccountSession } from './accountSession.ts';
import type { ActivityConnections } from './activityConnections.ts';
import { readPreparedCompanionWorkspace } from './companionWorkspaceHost.ts';
import { companionDigest, type CompanionPreparation } from './companionWorkspace.ts';
import { createCompanionAuthenticatedTransport } from './companionAuthenticatedTransport.ts';
import type { CompanionAdapterPairingTransport, CompanionAdapterRelayTransport } from './companionClientAdapter.ts';
import { createDevCompanionHostBridge, type CompanionNativeBridgePorts } from './companionHostBridgeNative.ts';
import { CompanionHostSession, type CompanionHostSessionClient, type CompanionHostSessionPair, type CompanionHostTurn } from './companionHostSession.ts';
import type { CompanionHostRequest } from './companionHostDispatch.ts';
import type { CompanionTransportBudget } from './companionTransportBudget.ts';

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
  };
}
export interface CompanionDevHostView {
  state: 'idle' | 'inviting' | 'claimed' | 'approved' | 'connected' | 'closed' | 'revoked';
  pairingId?: string; comparisonCode?: string; expiresAt?: number;
  reason?: 'local_close' | 'scope_changed' | 'cancelled' | 'revocation_unconfirmed';
  executionAuthorized: false;
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
  private state: CompanionDevHostView = { state: 'idle', executionAuthorized: false };
  private active: { name: string; promise: Promise<unknown>; abort: AbortController; interrupt(): void } | undefined;
  private signal: AbortSignal | undefined;

  constructor(ports: CompanionDevHostOwnerPorts) { this.ports = ports; this.identity = Object.freeze({ ...ports.identity }); }
  view(): Readonly<CompanionDevHostView> { return Object.freeze({ ...this.state }); }
  private check(): void { if (this.state.state === 'closed' || this.state.state === 'revoked') throw failure('closed'); }
  private erase(pairing = this.pairing): void {
    if (pairing) { pairing.keys = null; pairing.qr = null; pairing.claim = null; pairing.frozenClaim = null; }
  }
  private release(): void {
    if (this.session) this.session.close(); else this.relay?.close();
    this.erase(); this.pairing = undefined; this.relay = undefined; this.session = undefined; this.bridge = undefined; this.binding = undefined;
    this.authenticatedRelay = async () => { throw failure('closed'); };
  }
  private async current(): Promise<Binding> {
    this.check();
    const configured = this.ports.configured();
    if (this.ports.context.extensionMode !== ExtensionMode.Development || !this.ports.accounts.matches(configured.service, configured.site)
      || !accountPreviewEnabled(true, configured.service, configured.site)) { this.close('scope_changed'); throw failure('scope_changed'); }
    const stored = await this.ports.accounts.sessionIdentity(); this.check();
    const token = await this.ports.accounts.accessToken(); this.check();
    const prepared = await readPreparedCompanionWorkspace(this.ports.context, this.ports.connections); this.check();
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
    const abort = () => this.close('cancelled');
    const underlying = (async () => {
      try { await this.current(); this.check(); const value = await work(); if (this.state.state !== 'revoked') { await this.current(); this.check(); } return value; }
      finally { if (this.state.state === 'closed' || this.state.state === 'revoked') this.erase(); }
    })();
    const promise = Promise.race([underlying, stopped]).finally(() => { signal?.removeEventListener('abort', abort); this.signal = undefined; this.active = undefined; });
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
        dispatch: (url, init) => this.ports.budget.run(async () => { await this.current(); const value = await (this.ports.fetch ?? fetch)(url, init);
          try { await this.current(); return value; } catch (error) { void value.body?.cancel().catch(() => {}); throw error; } }, init?.signal ?? undefined) });
      await transport.resolveIdentity(this.signal); await this.current();
      this.authenticatedRelay = (role, id, action, raw) => transport.relay(role, id, action, raw, this.signal);
      const pairing = this.ports.clients.pairing({ role: 'host', sessionId: this.identity.sessionId,
        transport: (role, id, action, payload) => transport.pairing(role, id, action, payload, this.signal) });
      this.pairing = pairing; ownedPair = pairing;
      this.bridge = createDevCompanionHostBridge({ ...this.ports, paired: async () => { const row = await this.refreshPaired(); return row ? { ...row, execution_authorized: false } : null; } });
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
      this.session = new CompanionHostSession({ client: this.relay, currentPair: () => this.refreshPaired(), bridge: this.bridge! });
      this.state = { ...this.state, state: 'connected' }; return this.view();
    });
  }
  private authenticatedRelay: CompanionAdapterRelayTransport = async () => { throw failure('transport_unavailable'); };
  describeSelected(requestId: string, signal?: AbortSignal): Promise<CompanionHostRequest | null> {
    return this.run('describe', signal, async () => {
      if (this.state.state !== 'connected') throw failure('cipher_required');
      return this.bridge!.describe(requestId);
    });
  }
  receiveAndHandle(signal?: AbortSignal): Promise<CompanionHostTurn> {
    return this.run('receive', signal, async () => {
      if (this.state.state !== 'connected') throw failure('cipher_required');
      return this.session!.receiveAndHandle();
    });
  }
  revoke(signal?: AbortSignal): Promise<Readonly<CompanionDevHostView>> {
    return this.run('revoke', signal, async () => {
      if (!this.pairing) throw failure('invitation_required');
      try { await this.pairing.revoke(); await this.current(); this.row(); }
      catch (error) { this.close('revocation_unconfirmed'); throw error; }
      this.state = { state: 'revoked', executionAuthorized: false }; this.release(); return this.view();
    });
  }
  /** Local disposal is not a signed remote revoke. Caller owns budget/stores and their disposal. */
  close(reason: CompanionDevHostView['reason'] = 'local_close'): void {
    if (this.state.state === 'closed' || this.state.state === 'revoked') return;
    this.state = { state: 'closed', reason, executionAuthorized: false };
    this.release(); this.active?.abort.abort(); this.active?.interrupt();
  }
}
