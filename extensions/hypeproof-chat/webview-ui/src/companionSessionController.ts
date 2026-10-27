/** Browser-side orchestration only. Authenticated transport and computer selection remain caller-owned. */
import { CompanionPreviewResultReceiver } from '../../src/companionPreviewResult.ts';
import type { CompanionHostRequest, CompanionDispatchResult } from '../../src/companionHostDispatch';
import { companionSelectionIdentity } from './companionSessionPresentation.ts';
import type { CompanionSessionController, CompanionSessionSelection, CompanionSessionSnapshot } from './companionSessionPresentation.ts';

export interface CompanionSessionDescriptor {
  computerName: string;
  online: boolean;
  selection: CompanionSessionSelection | null;
}
export interface CompanionSessionPorts {
  /** Resolve through the existing current authenticated session; no credentials belong in snapshots. */
  descriptor(signal: AbortSignal): Promise<CompanionSessionDescriptor | null>;
  transport: {
    prepare(text: string, messageId: string, signal: AbortSignal): Promise<unknown>;
    send(messageId: string, signal: AbortSignal): Promise<unknown>;
    /** Only authenticated/decrypted peer messages from the existing client. */
    receive(signal: AbortSignal): Promise<readonly { message_id: string; text: string }[]>;
    /** Transport receipt only, never host durable acceptance or execution consent. */
    acknowledge(messageId: string, signal: AbortSignal): Promise<unknown>;
  };
}
export interface CompanionSessionClock {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
const clock: CompanionSessionClock = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};
const terminal = (result: CompanionDispatchResult) => ['completed', 'denied', 'failed', 'desktop_handoff'].includes(result.state);
const stopped = () => Error('companion_session_stopped');

/** One selected request per instance. Reconnect receives/reconciles; it never prepares or sends again. */
export class CompanionMobileSessionController implements CompanionSessionController {
  private snapshot: CompanionSessionSnapshot = Object.freeze({ computerName: '내 컴퓨터', connection: 'waiting_for_computer', selection: null, receipt: null, busy: false });
  private readonly listeners = new Set<(snapshot: CompanionSessionSnapshot) => void>();
  private active: { abort: AbortController; promise: Promise<void> } | null = null;
  private closed = false;
  private request: Readonly<CompanionHostRequest> | null = null;
  private attempted = false;
  private receiver: CompanionPreviewResultReceiver | null = null;
  private readonly validated = new Map<string, string>();
  private readonly pendingAcks = new Set<string>();
  private verified: CompanionDispatchResult | null = null;
  private processing: Promise<void> | null = null;
  private inbox: Promise<readonly { message_id: string; text: string }[]> | null = null;
  private readonly timer: CompanionSessionClock;
  private readonly timeoutMs: number;
  private readonly pollMs: number;
  private readonly ports: CompanionSessionPorts;
  constructor(ports: CompanionSessionPorts, options: { timeoutMs?: number; pollMs?: number; clock?: CompanionSessionClock } = {}) {
    this.ports = ports;
    this.timeoutMs = options.timeoutMs ?? 25_000;
    this.pollMs = options.pollMs ?? 100;
    this.timer = options.clock ?? clock;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 60_000
      || !Number.isFinite(this.pollMs) || this.pollMs < 1 || this.pollMs > 1_000) throw Error('companion_session_invalid_bounds');
  }
  getSnapshot = (): CompanionSessionSnapshot => this.snapshot;
  subscribe = (listener: (snapshot: CompanionSessionSnapshot) => void): (() => void) => {
    if (this.closed) return () => {};
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private emit(change: Partial<CompanionSessionSnapshot>): void {
    if (this.closed) return;
    this.snapshot = Object.freeze({ ...this.snapshot, ...change });
    for (const listener of this.listeners) {
      if (this.closed) break;
      // A presentation subscriber cannot poison the request/ACK lifecycle.
      try { listener(this.snapshot); } catch { /* subscriber owns its rendering errors */ }
    }
  }
  private check(signal: AbortSignal): void { if (this.closed || signal.aborted) throw stopped(); }
  private async bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
    this.check(signal);
    let abort: () => void = () => {};
    const cancelled = new Promise<never>((_, reject) => { abort = () => reject(stopped()); signal.addEventListener('abort', abort, { once: true }); });
    try { const value = await Promise.race([work, cancelled]); this.check(signal); return value; }
    finally { signal.removeEventListener('abort', abort); }
  }
  private delay(signal: AbortSignal): Promise<void> {
    let handle: unknown;
    const cleanup = () => this.timer.clearTimeout(handle);
    const wait = new Promise<void>(resolve => { handle = this.timer.setTimeout(resolve, this.pollMs); });
    signal.addEventListener('abort', cleanup, { once: true });
    return this.bounded(wait, signal).finally(() => { cleanup(); signal.removeEventListener('abort', cleanup); });
  }
  private run(action: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (this.closed) return Promise.reject(stopped());
    if (this.active) return this.active.promise;
    const abort = new AbortController();
    const deadline = this.timer.setTimeout(() => abort.abort(), this.timeoutMs);
    // Defer work so reentrant subscriptions/gestures observe the same in-flight operation.
    const promise = Promise.resolve().then(() => action(abort.signal)).catch(() => {
      if (!this.closed) this.emit({ connection: 'waiting_for_computer' });
    }).finally(() => {
      this.timer.clearTimeout(deadline);
      if (this.active?.abort === abort) this.active = null;
      this.emit({ busy: false });
    });
    this.active = { abort, promise };
    return promise;
  }
  private async current(signal: AbortSignal): Promise<boolean> {
    this.check(signal);
    const descriptor = await this.bounded(this.ports.descriptor(signal), signal);
    if (!descriptor) return false;
    const selection = descriptor.selection ? Object.freeze({ ...descriptor.selection, request: Object.freeze({ ...descriptor.selection.request }) }) : null;
    if (this.request && companionSelectionIdentity(selection?.request) !== companionSelectionIdentity(this.request)) return false;
    this.emit({ computerName: descriptor.computerName, selection, connection: descriptor.online ? 'connected' : 'waiting_for_computer' });
    return descriptor.online;
  }
  reconnect = (expected: Readonly<CompanionHostRequest> | null = null): Promise<void> => this.run(async signal => {
    this.emit({ busy: true, connection: 'reconnecting' });
    if (expected && companionSelectionIdentity(expected) !== companionSelectionIdentity(this.request ?? this.snapshot.selection?.request)) throw stopped();
    if (!await this.current(signal)) throw stopped();
    if (this.attempted) await this.poll(signal);
  });
  requestPreview = (expected: Readonly<CompanionHostRequest>): Promise<void> => {
    // Snapshot the gesture before an awaiting caller can mutate it.
    const selected = Object.freeze({ ...expected });
    return this.run(async signal => {
      this.emit({ busy: true });
      if (this.attempted) {
        if (companionSelectionIdentity(selected) !== companionSelectionIdentity(this.request)) throw stopped();
        if (!await this.current(signal)) throw stopped();
        await this.poll(signal); return;
      }
      if (!await this.current(signal) || selected.operation !== 'preview.read'
        || companionSelectionIdentity(selected) !== companionSelectionIdentity(this.snapshot.selection?.request)) throw stopped();
      this.request = selected;
      this.receiver = new CompanionPreviewResultReceiver(selected);
      // Mark before any delivery await: uncertainty must never become automatic resubmission.
      this.attempted = true;
      await this.bounded(this.ports.transport.prepare(JSON.stringify(selected), selected.requestId, signal), signal);
      await this.bounded(this.ports.transport.send(selected.requestId, signal), signal);
      await this.poll(signal);
    });
  };
  private async flushAcks(signal: AbortSignal): Promise<void> {
    for (const id of this.pendingAcks) {
      this.check(signal);
      await this.bounded(this.ports.transport.acknowledge(id, signal), signal);
      this.pendingAcks.delete(id);
    }
    if (this.verified && this.request) {
      if (!await this.current(signal)) throw stopped();
      this.emit({ receipt: Object.freeze({ request: this.request, outcome: this.verified }) });
    }
  }
  private async poll(signal: AbortSignal): Promise<void> {
    if (this.processing) await this.bounded(this.processing, signal);
    await this.flushAcks(signal);
    if (this.verified && terminal(this.verified)) return;
    while (true) {
      this.check(signal);
      // An existing relay client may deduplicate on receive. Keep a late delivery for
      // reconnect instead of dropping it when a port ignores the poll's abort signal.
      if (!this.inbox) {
        const pending = this.ports.transport.receive(signal).catch(error => {
          if (this.inbox === pending) this.inbox = null;
          throw error;
        });
        this.inbox = pending;
      }
      const messages = await this.bounded(this.inbox, signal);
      this.inbox = null;
      if (messages.length > 64) throw Error('companion_session_inbox_bound');
      for (const message of messages) {
        this.check(signal);
        if (typeof message.message_id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(message.message_id)) throw Error('companion_session_invalid_message');
        const previous = this.validated.get(message.message_id);
        if (previous !== undefined && previous !== message.text) throw Error('companion_session_message_conflict');
        if (previous === undefined) {
          if (this.validated.size >= 64 || !this.receiver) throw Error('companion_session_inbox_bound');
          // Preserve in-flight verification across a timed-out poll; reconnect may finish it,
          // without requesting the already-ACKed partial bytes or resending the request.
          this.processing = this.receiver.accept(message.text).then(outcome => {
            if (this.closed) return;
            this.validated.set(message.message_id, message.text);
            this.pendingAcks.add(message.message_id);
            if (outcome) {
              this.verified = Object.freeze({ ...outcome, ...(outcome.artifact ? { artifact: Object.freeze({ ...outcome.artifact }) } : {}) });
              if (!terminal(outcome)) this.receiver?.reset();
            }
          });
          await this.bounded(this.processing, signal);
          this.processing = null;
        }
        if (!await this.current(signal)) throw stopped();
        this.pendingAcks.add(message.message_id);
        await this.flushAcks(signal);
        if (this.verified && terminal(this.verified)) return;
      }
      await this.delay(signal);
    }
  }
  /** Terminal cancellation. Ignored port cancellation cannot emit a late receipt or initiate an ACK. */
  dispose = (): void => {
    if (this.closed) return;
    this.closed = true;
    this.active?.abort.abort(); this.receiver?.discard(); this.receiver = null;
    this.inbox = null; this.processing = null;
    this.listeners.clear(); this.validated.clear(); this.pendingAcks.clear(); this.verified = null; this.request = null;
    this.snapshot = Object.freeze({ ...this.snapshot, selection: null, receipt: null, busy: false, connection: 'waiting_for_computer' });
  };
  cancel = (): void => this.dispose();
}
