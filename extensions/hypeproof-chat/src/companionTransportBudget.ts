/** One caller-owned authenticated session, one process. The server remains the rate authority. */
export const COMPANION_TRANSPORT_BUDGET_WINDOW_MS = 60_000;
export const COMPANION_TRANSPORT_BUDGET_MAX_QUEUE = 32;
export const COMPANION_TRANSPORT_BUDGET_MAX_WAIT_MS = 65_000;
type Sleep = (milliseconds: number, signal: AbortSignal) => Promise<void>;
interface Options {
  /** May lower the local default of 50; never increases the server's limit. */
  maxRequests?: number;
  now?: () => number;
  sleep?: Sleep;
}
interface Entry {
  operation: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  enqueued: number;
  signal?: AbortSignal;
  onAbort: () => void;
}
const error = (code: string) => Error(`companion_transport_budget_${code}`);
const sleep: Sleep = (milliseconds, signal) => new Promise((resolve, reject) => {
  if (signal.aborted) { reject(error('cancelled')); return; }
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
  const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(error('cancelled')); };
  signal.addEventListener('abort', abort, { once: true });
});
/**
 * Share this instance across pairing/status/relay adapters for ONE session.
 * FIFO admission, not serialized network completion. Failed requests consume a slot;
 * no HTTP retries, credentials, transport, recurring polling or durable coordination.
 * Abort/dispose cancel queued calls only; admitted operations own their cancellation.
 */
export class CompanionTransportBudget {
  private readonly maxRequests: number;
  private readonly now: () => number;
  private readonly sleep: Sleep;
  private readonly admitted: number[] = [];
  private readonly queue: Entry[] = [];
  private pumping = false;
  private disposed = false;
  private sleeper: AbortController | undefined;
  constructor(options: Options = {}) {
    this.maxRequests = options.maxRequests ?? 50;
    if (!Number.isSafeInteger(this.maxRequests) || this.maxRequests < 1 || this.maxRequests > 50) throw error('invalid_limit');
    this.now = options.now ?? (() => performance.now());
    this.sleep = options.sleep ?? sleep;
  }
  run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.disposed) return Promise.reject(error('disposed'));
    if (signal?.aborted) return Promise.reject(error('cancelled'));
    if (this.queue.length >= COMPANION_TRANSPORT_BUDGET_MAX_QUEUE) return Promise.reject(error('overloaded'));
    return new Promise<T>((resolve, reject) => {
      const entry: Entry = { operation, resolve: value => resolve(value as T), reject, enqueued: this.now(), signal,
        onAbort: () => {
          const index = this.queue.indexOf(entry);
          if (index < 0) return;
          this.queue.splice(index, 1); this.detach(entry); reject(error('cancelled'));
          this.sleeper?.abort();
        } };
      this.queue.push(entry);
      signal?.addEventListener('abort', entry.onAbort, { once: true });
      this.start();
    });
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.queue.splice(0)) { this.detach(entry); entry.reject(error('disposed')); }
    this.sleeper?.abort();
  }
  private detach(entry: Entry): void { entry.signal?.removeEventListener('abort', entry.onAbort); }
  private start(): void {
    if (this.pumping || this.disposed || this.queue.length === 0) return;
    this.pumping = true;
    // Attach both handlers: a failed injected clock/sleep must not leave an unhandled pump rejection.
    void this.pump().then(() => { this.start(); }, () => {
      this.pumping = false;
      for (const entry of this.queue.splice(0)) { this.detach(entry); entry.reject(error('clock_failed')); }
    });
  }
  private async pump(): Promise<void> {
    while (!this.disposed && this.queue.length) {
      const now = this.now();
      while (this.admitted.length && this.admitted[0] <= now - COMPANION_TRANSPORT_BUDGET_WINDOW_MS) this.admitted.shift();
      const entry = this.queue[0];
      if (now - entry.enqueued >= COMPANION_TRANSPORT_BUDGET_MAX_WAIT_MS) {
        this.queue.shift(); this.detach(entry); entry.reject(error('wait_expired')); continue;
      }
      if (this.admitted.length < this.maxRequests) {
        this.queue.shift(); this.detach(entry); this.admitted.push(now);
        // Reserve before invocation, including synchronous throws and failed operations.
        void Promise.resolve().then(entry.operation).then(entry.resolve, entry.reject);
        continue;
      }
      const controller = new AbortController();
      this.sleeper = controller;
      try {
        await this.sleep(Math.min(this.admitted[0] + COMPANION_TRANSPORT_BUDGET_WINDOW_MS - now,
          entry.enqueued + COMPANION_TRANSPORT_BUDGET_MAX_WAIT_MS - now), controller.signal);
      } catch (reason) { if (!controller.signal.aborted) throw reason; }
      finally { if (this.sleeper === controller) this.sleeper = undefined; }
    }
    this.pumping = false;
  }
}
