/** Structural injection seam for private @hypeproof/companion-client; no crypto or account transport implementation. */
import type { CompanionSessionPorts } from '../webview-ui/src/companionSessionController';
import type { CompanionHostRequest } from './companionHostDispatch';
import type { CompanionTransportBudget } from './companionTransportBudget';
type Role = 'host' | 'device';
type PairingAction = null | 'publish' | 'inspect' | 'claim' | 'status' | 'approve' | 'consume' | 'revoke';
type RelayAction = 'offer' | 'keys' | 'send' | 'receive' | 'ack';
/** Optional fifth argument lets the injected authenticated dispatcher cancel admitted HTTP work. */
export type CompanionAdapterPairingTransport = (role: Role, id: string | null | undefined, action: PairingAction,
  payload: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;
export type CompanionAdapterRelayTransport = (role: Role, id: string, action: RelayAction,
  raw: string, signal?: AbortSignal) => Promise<unknown>;
export interface CompanionAdapterPairingClient {
  role: Role;
  sessionId?: string;
  invitation: { id: string; status: string; account_id?: string; device_session_id?: string | null; device_id?: string | null; workspace_id?: string } | null;
  refresh?(): Promise<unknown>;
  transport: CompanionAdapterPairingTransport;
}
/** Minimal public surface of the frozen package. Real client still validates/decrypts peer messages. */
export interface CompanionAdapterRelayClient {
  pairing: Pick<CompanionAdapterPairingClient, 'role' | 'invitation'>;
  row: Readonly<{ id: string; status: string }>;
  role: Role;
  transport: CompanionAdapterRelayTransport;
  prepare(text: string, messageId: string): Promise<string>;
  send(messageId: string): Promise<unknown>;
  receive(): Promise<readonly { message_id: string; text: string }[]>;
  acknowledge(messageId: string): Promise<unknown>;
  close(): void;
  diagnostics?(): { closed: boolean; context_digest: string | null };
}
export interface CompanionAdapterCheckpointContext {
  accountId: string; sessionId: string; deviceId: string; pairingId: string; cipherContext: string;
  workspaceId: string; artifactId: string; artifactVersion: string; epoch: number;
}
export interface CompanionAdapterReattach {
  context: Readonly<CompanionAdapterCheckpointContext>;
  request: Readonly<CompanionHostRequest>;
  messages: readonly { message_id: string; text: string }[];
}
export type CompanionAdapterReattachResult = 'same_live_transport_verified_bytes' | 'keys_lost' | 'unavailable';
export interface CompanionClientAdapterOptions {
  /** Exclusively owned, already paired device client; do not share this mutable client with another adapter. */
  relay: CompanionAdapterRelayClient;
  pairing: CompanionAdapterPairingClient;
  requestId: string;
  /** Same caller-owned instance across ALL account-session pairing/status/relay dispatchers. */
  budget: Pick<CompanionTransportBudget, 'run'>;
  /** Trusted live owner inputs, never copied from checkpoint data. No opt-in means no attestation. */
  checkpoint?: { context: Readonly<CompanionAdapterCheckpointContext>; currentContext(signal: AbortSignal): Promise<CompanionAdapterCheckpointContext | null> };
}
const failure = (code: string) => Error(`companion_client_adapter_${code}`);
const validId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(id);
const bytes = (text: string) => new TextEncoder().encode(text).length;

/** One selected request, one owned device relay. This adapter grants no runtime authority. */
type MobileTransport = CompanionSessionPorts['transport'];
const same = (a: object, b: object) => Object.keys(a).length === Object.keys(b).length
  && Object.keys(a).every(key => Object.hasOwn(b, key) && (a as Record<string, unknown>)[key] === (b as Record<string, unknown>)[key]);
export class CompanionClientAdapter implements MobileTransport {
  private readonly relay: CompanionAdapterRelayClient;
  private readonly pairing: CompanionAdapterPairingClient;
  private readonly requestId: string;
  private readonly budget: CompanionClientAdapterOptions['budget'];
  private readonly pending = new Set<AbortController>();
  private queue: Promise<void> = Promise.resolve();
  private activeSignal: AbortSignal | undefined;
  private closed = false;
  private requestText: string | null = null;
  private prepared: string | null = null;
  private sendAttempted = false;
  private requestSnapshot: Readonly<CompanionHostRequest> | null = null;
  private readonly checkpoint: CompanionClientAdapterOptions['checkpoint'];
  private readonly ledger = new Map<string, string>();
  private readonly inbox = new Map<string, string>();
  private readonly acknowledged = new Map<string, unknown>();
  constructor(options: CompanionClientAdapterOptions) {
    const relay = options.relay, pairing = options.pairing;
    if (!validId(options.requestId) || relay.role !== 'device' || pairing.role !== 'device' || relay.pairing !== pairing
      || relay.row.status !== 'paired' || pairing.invitation?.status !== 'paired'
      || pairing.invitation.id !== relay.row.id) throw failure('paired_device_required');
    this.relay = relay; this.pairing = pairing; this.requestId = options.requestId; this.budget = options.budget;
    this.checkpoint = options.checkpoint ? { context: Object.freeze({ ...options.checkpoint.context }), currentContext: options.checkpoint.currentContext } : undefined;
    const pairingTransport = pairing.transport.bind(pairing);
    const relayTransport = relay.transport.bind(relay);
    // Wrap actual dispatches, including the client's internal current-pair refreshes.
    pairing.transport = (role, id, action, payload) => this.dispatch(signal => pairingTransport(role, id, action, payload, signal));
    relay.transport = (role, id, action, raw) => this.dispatch(signal => relayTransport(role, id, action, raw, signal));
  }
  private check(signal?: AbortSignal): void { if (this.closed || signal?.aborted) throw failure('stopped'); }
  private dispatch(operation: (signal: AbortSignal) => Promise<unknown>): Promise<unknown> {
    const signal = this.activeSignal;
    if (!signal) return Promise.reject(failure('owned_operation_required'));
    return this.budget.run(async () => {
      this.check(signal); const result = await operation(signal); this.check(signal); return result;
    }, signal);
  }
  /** Queue bounds include cancelled-but-not-yet-settled work; no unbounded abandoned closures. */
  private run<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    if (this.closed || signal.aborted) return Promise.reject(failure('stopped'));
    if (this.pending.size >= 32) return Promise.reject(failure('overloaded'));
    const abort = new AbortController(); this.pending.add(abort);
    const forward = () => abort.abort(); signal.addEventListener('abort', forward, { once: true });
    let resolve!: (value: T) => void; let reject!: (reason: unknown) => void;
    const result = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    const stopped = () => reject(failure('stopped'));
    abort.signal.addEventListener('abort', stopped, { once: true });
    const work = this.queue.then(async () => {
      try {
        this.check(abort.signal); this.activeSignal = abort.signal;
        const value = await operation(); this.check(abort.signal); resolve(value);
      } catch (error) { reject(error); }
      finally {
        this.activeSignal = undefined; this.pending.delete(abort);
        signal.removeEventListener('abort', forward); abort.signal.removeEventListener('abort', stopped);
      }
    });
    // No client operation overlaps another, including after a caller stops waiting.
    this.queue = work.catch(() => {});
    return result;
  }
  /** Fresh status for the native descriptor owner; use this instead of calling the owned client directly. */
  refresh(signal: AbortSignal): Promise<unknown> {
    return this.run(signal, async () => {
      if (!this.pairing.refresh) throw failure('pairing_refresh_required');
      return this.pairing.refresh();
    });
  }
  prepare(text: string, messageId: string, signal: AbortSignal): Promise<unknown> {
    try {
      this.check(signal);
      if (messageId !== this.requestId || typeof text !== 'string' || bytes(text) > 2032) throw failure('request_mismatch');
      const request: unknown = JSON.parse(text);
      if (!request || typeof request !== 'object' || Array.isArray(request)
        || (request as Record<string, unknown>).schema !== 'hps-companion-host-request/1'
        || (request as Record<string, unknown>).requestId !== messageId
        || (this.requestText !== null && this.requestText !== text)) throw failure('request_mismatch');
      this.requestText = text;
      this.requestSnapshot = Object.freeze({ ...request }) as Readonly<CompanionHostRequest>;
    } catch (error) { return Promise.reject(error); }
    return this.run(signal, async () => {
      if (this.prepared !== null) return this.prepared;
      const prepared = await this.relay.prepare(text, messageId);
      this.check(); this.prepared = prepared; return prepared;
    });
  }
  send(messageId: string, signal: AbortSignal): Promise<unknown> {
    return this.run(signal, async () => {
      if (messageId !== this.requestId || this.prepared === null || this.sendAttempted) throw failure('send_not_ready');
      // Uncertain delivery never becomes automatic resubmission.
      this.sendAttempted = true;
      return this.relay.send(messageId);
    });
  }
  receive(signal: AbortSignal): Promise<readonly { message_id: string; text: string }[]> {
    return this.run(signal, async () => {
      if (this.inbox.size === 0) {
        const messages = await this.relay.receive(); this.check();
        if (!Array.isArray(messages) || messages.length > 64) throw failure('invalid_batch');
        const merged = new Map(this.ledger);
        for (const message of messages) {
          if (!message || !validId(message.message_id) || typeof message.text !== 'string' || bytes(message.text) > 2032
            || (merged.has(message.message_id) && merged.get(message.message_id) !== message.text)) throw failure('invalid_batch');
          merged.set(message.message_id, message.text);
        }
        if (merged.size > 64) throw failure('invalid_batch');
        // Retain a completed late receive even if its caller stopped during client crypto.
        for (const [id, text] of merged) {
          this.ledger.set(id, text);
          if (!this.acknowledged.has(id)) this.inbox.set(id, text);
        }
      }
      return Object.freeze(Array.from(this.inbox, ([message_id, text]) => Object.freeze({ message_id, text })));
    });
  }
  acknowledge(messageId: string, signal: AbortSignal): Promise<unknown> {
    return this.run(signal, async () => {
      if (this.acknowledged.has(messageId)) return this.acknowledged.get(messageId);
      if (!this.inbox.has(messageId)) throw failure('unreceived_message');
      const result = await this.relay.acknowledge(messageId); this.check();
      this.acknowledged.set(messageId, result); this.inbox.delete(messageId); return result;
    });
  }
  /** Same-live-client evidence only; checkpoint plaintext never creates ledger entries. */
  reattach = (value: CompanionAdapterReattach, signal: AbortSignal): Promise<CompanionAdapterReattachResult> => {
    if (this.closed) return Promise.resolve('keys_lost');
    if (!this.checkpoint || !this.relay.diagnostics || !this.pairing.refresh) return Promise.resolve('unavailable');
    if (!Array.isArray(value.messages) || value.messages.length > 128) return Promise.resolve('unavailable');
    const saved = { context: { ...value.context }, request: { ...value.request }, messages: value.messages.map(m => ({ ...m })) };
    return this.run(signal, async () => {
      const diagnostics = this.relay.diagnostics!();
      if (diagnostics.closed || diagnostics.context_digest === null) return 'keys_lost';
      const checkpoint = this.checkpoint!;
      if (!same(saved.context, checkpoint.context) || !this.requestSnapshot || !same(saved.request, this.requestSnapshot)
        || saved.request.requestId !== this.requestId || saved.request.workspaceId !== saved.context.workspaceId
        || saved.request.deviceId !== saved.context.deviceId || saved.request.artifactId !== saved.context.artifactId || saved.request.artifactVersion !== saved.context.artifactVersion
        || saved.request.epoch !== saved.context.epoch) return 'unavailable';
      for (const message of saved.messages) if (!validId(message.message_id) || typeof message.text !== 'string'
        || bytes(message.text) > 2032 || this.ledger.get(message.message_id) !== message.text) return 'unavailable';
      await this.pairing.refresh!();
      const current = await checkpoint.currentContext(this.activeSignal!); this.check(this.activeSignal);
      const live = this.pairing.invitation;
      const after = this.relay.diagnostics!();
      if (after.closed || after.context_digest === null) return 'keys_lost';
      if (!current || !same(current, checkpoint.context) || after.context_digest !== current.cipherContext
        || live?.status !== 'paired' || live.id !== current.pairingId || this.relay.row.id !== current.pairingId
        || live.account_id !== current.accountId || live.device_session_id !== current.sessionId
        || this.pairing.sessionId !== current.sessionId || live.device_id !== current.deviceId
        || live.workspace_id !== current.workspaceId) return 'unavailable';
      return 'same_live_transport_verified_bytes';
    });
  };
  /** Destructive in-memory clear closes the existing key/counter lifecycle; create a fresh client to repair. */
  clear(): void {
    if (this.closed) return;
    this.closed = true;
    for (const controller of this.pending) controller.abort();
    this.inbox.clear(); this.ledger.clear(); this.acknowledged.clear(); this.requestText = null; this.requestSnapshot = null; this.prepared = null;
    this.relay.close();
  }
  /** The shared account-session budget remains caller-owned. */
  dispose(): void { this.clear(); }
}
