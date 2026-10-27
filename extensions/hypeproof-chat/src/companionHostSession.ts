/** Explicit, bounded desktop receive turn. Pairing is transport identity, never file authority. */
import type { CompanionDispatchResult } from './companionHostDispatch.ts';
import type { CompanionEncryptedReply, CompanionVerifiedPair, VerifiedCompanionMessage } from './companionHostBridge.ts';

/** The pairing client's row omits the response-envelope execution_authorized flag. */
export type CompanionHostSessionPair = Omit<CompanionVerifiedPair, 'execution_authorized'>;
export interface CompanionHostSessionClient extends CompanionEncryptedReply {
  role: 'host';
  row: Readonly<CompanionHostSessionPair>;
  receive(): Promise<readonly { message_id: string; message_hash: string; text: string }[]>;
  acknowledge(messageId: string): Promise<unknown>;
}
export interface CompanionHostSessionPorts {
  /** Already paired reviewed client. Its HTTP transports own the shared per-session request budget. */
  client: CompanionHostSessionClient;
  /** Refresh the verified pairing identity; host bridge separately resolves current runtime/file authority. */
  currentPair(): Promise<CompanionHostSessionPair | null>;
  bridge: { handleAndReply(message: VerifiedCompanionMessage, reply: CompanionEncryptedReply): Promise<CompanionDispatchResult> };
}
export interface CompanionHostTurn {
  state: 'idle' | 'processed' | 'waiting' | 'closed';
  processed: number;
  pending: number;
  reason?: 'transport_unavailable' | 'session_closed';
}
type Entry = { message_id: string; message_hash: string; text: string; replied: boolean };
const identity = (p: CompanionHostSessionPair) => JSON.stringify([p.schema, p.id, p.status, p.account_id,
  p.host_session_id, p.device_session_id, p.host_id, p.device_id, p.workspace_id, p.project_id,
  p.invitation_digest, p.claim_digest, p.grant_expires_at, p.capability]);
const activePair = (p: CompanionHostSessionPair | null): p is CompanionHostSessionPair => !!p
  && p.schema === 'hps-companion-pairing-preview/2' && p.status === 'paired'
  && (!('execution_authorized' in p) || p.execution_authorized === false) && p.capability === 'preview.read'
  && Number.isSafeInteger(p.grant_expires_at) && p.grant_expires_at > Math.floor(Date.now() / 1000);
const stop = () => Error('companion_host_session_closed');

/**
 * No timers/polls/listeners run until the caller explicitly asks for a turn.
 * A failed ACK retains the replied entry, so the next turn only ACKs it.
 * A deadline/close destroys the cipher client; no cold key restart is implied.
 */
export class CompanionHostSession {
  private readonly ports: CompanionHostSessionPorts;
  private readonly binding: Readonly<CompanionHostSessionPair>;
  private readonly bindingIdentity: string;
  private readonly deadlineMs: number;
  private readonly pending: Entry[] = [];
  private readonly acknowledged = new Map<string, string>();
  private closed = false;
  private active: Promise<CompanionHostTurn> | null = null;
  private interrupt: (() => void) | null = null;

  constructor(ports: CompanionHostSessionPorts, options: { deadlineMs?: number } = {}) {
    if (ports.client.role !== 'host' || !activePair(ports.client.row)) throw Error('companion_host_pair_required');
    this.deadlineMs = options.deadlineMs ?? 120_000;
    if (!Number.isSafeInteger(this.deadlineMs) || this.deadlineMs < 1 || this.deadlineMs > 120_000) throw Error('companion_host_turn_bounds');
    this.ports = ports;
    this.binding = Object.freeze({ ...ports.client.row });
    this.bindingIdentity = identity(this.binding);
  }
  private check(): void { if (this.closed) throw stop(); }
  private async fresh(): Promise<void> {
    this.check();
    const pair = await this.ports.currentPair();
    this.check();
    if (!activePair(pair) || identity(pair) !== this.bindingIdentity) { this.close(); throw stop(); }
  }
  private accept(batch: readonly { message_id: string; message_hash: string; text: string }[]): void {
    if (!Array.isArray(batch) || batch.length > 8) throw Error('companion_host_batch_bound');
    const ids = new Set<string>();
    const entries: Entry[] = [];
    for (const message of batch) {
      if (!message || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(message.message_id)
        || !/^[a-f0-9]{64}$/.test(message.message_hash) || typeof message.text !== 'string'
        || new TextEncoder().encode(message.text).length > 2032 || ids.has(message.message_id)) throw Error('companion_host_invalid_batch');
      ids.add(message.message_id);
      const prior = this.acknowledged.get(message.message_id);
      if (prior !== undefined && prior !== message.message_hash) throw Error('companion_host_message_conflict');
      entries.push({ ...message, replied: prior !== undefined });
    }
    if (this.acknowledged.size + entries.filter(entry => !entry.replied).length > 64) throw Error('companion_host_session_bound');
    this.pending.push(...entries);
  }
  private result(state: CompanionHostTurn['state'], processed: number, reason?: CompanionHostTurn['reason']): CompanionHostTurn {
    return { state, processed, pending: this.pending.length, ...(reason ? { reason } : {}) };
  }
  /** Concurrent UI callbacks share one receive turn. No background retry is scheduled. */
  receiveAndHandle(): Promise<CompanionHostTurn> {
    if (this.closed) return Promise.resolve(this.result('closed', 0, 'session_closed'));
    if (this.active) return this.active;
    let timer: ReturnType<typeof setTimeout>;
    const interrupted = new Promise<never>((_, reject) => { this.interrupt = () => reject(stop()); });
    timer = setTimeout(() => this.close(), this.deadlineMs);
    const run = Promise.race([this.turn(), interrupted]).catch(() => this.result(this.closed ? 'closed' : 'waiting', 0,
      this.closed ? 'session_closed' : 'transport_unavailable')).finally(() => {
      clearTimeout(timer); this.interrupt = null; if (this.active === run) this.active = null;
    });
    this.active = run;
    return run;
  }
  private async turn(): Promise<CompanionHostTurn> {
    let processed = 0;
    try {
      await this.fresh();
      if (this.pending.length === 0) {
        const batch = await this.ports.client.receive();
        this.check();
        try { this.accept(batch); } catch (error) { this.close(); throw error; }
      }
      while (this.pending.length > 0) {
        await this.fresh();
        const entry = this.pending[0];
        if (!entry.replied) {
          const message: VerifiedCompanionMessage = { sender: 'device', invitationId: this.binding.id,
            invitationDigest: this.binding.invitation_digest, claimDigest: this.binding.claim_digest,
            messageId: entry.message_id, text: entry.text };
          const client = this.ports.client;
          const reply: CompanionEncryptedReply = {
            prepare: async (text, id) => { this.check(); const raw = await client.prepare(text, id); this.check(); return raw; },
            // The bridge refreshes runtime/pair authority before every send. Avoid a second HTTP refresh per part.
            send: async id => { this.check(); const result = await client.send(id); this.check(); return result; },
            close: () => this.close(),
            ...(client.waitForCapacity ? { waitForCapacity: async () => { this.check(); await client.waitForCapacity!(); this.check(); } } : {}),
          };
          await this.ports.bridge.handleAndReply(message, reply);
          this.check();
          entry.replied = true;
        }
        // Transport ACK follows the bridge's durable decision/reply, never substitutes for it.
        await this.fresh();
        await this.ports.client.acknowledge(entry.message_id);
        this.check();
        this.acknowledged.set(entry.message_id, entry.message_hash);
        this.pending.shift(); processed++;
      }
      return this.result(processed ? 'processed' : 'idle', processed);
    } catch {
      return this.result(this.closed ? 'closed' : 'waiting', processed, this.closed ? 'session_closed' : 'transport_unavailable');
    }
  }
  /** Stops delivery and new work. It cannot undo a read already approved and durably running. */
  close(): void {
    if (this.closed) return;
    this.closed = true; this.pending.length = 0; this.acknowledged.clear();
    this.interrupt?.();
    try { this.ports.client.close(); } catch { /* Terminal locally even if an injected close hook fails. */ }
  }
}
