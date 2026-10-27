/** Read-only observation after one explicit submission. No prepare/send or execution port exists. */
export type AuthoringReceiptWaitState = 'waiting' | 'received' | 'unconfirmed' | 'closed';
interface Clock { setTimeout(callback: () => void, ms: number): unknown; clearTimeout(handle: unknown): void }
interface Ports {
 current(): boolean;
 received(): boolean;
 receive(signal: AbortSignal): Promise<void>;
 changed(state: AuthoringReceiptWaitState): void;
}
const clock: Clock = { setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms), clearTimeout: handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>) };
const stopped = () => Error('authoring_receipt_observer_stopped');
export class CompanionAuthoringReceiptObserver {
 private readonly ports: Ports;
 private readonly owner = new AbortController();
 private reading: Promise<void> | null = null;
 private active: Promise<AuthoringReceiptWaitState> | null = null;
 private readonly timeoutMs: number;
 private readonly pollMs: number;
 private readonly maxPolls: number;
 private readonly timer: Clock;
 constructor(ports: Ports, options: { timeoutMs?: number; pollMs?: number; maxPolls?: number; clock?: Clock } = {}) {
  this.ports = ports;
  this.timeoutMs = options.timeoutMs ?? 60_000; this.pollMs = options.pollMs ?? 1_500; this.maxPolls = options.maxPolls ?? 40; this.timer = options.clock ?? clock;
  if(!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 60_000 || !Number.isSafeInteger(this.pollMs) || this.pollMs < 1 || this.pollMs > 5_000 || !Number.isSafeInteger(this.maxPolls) || this.maxPolls < 1 || this.maxPolls > 40) throw Error('authoring_receipt_observer_bounds');
 }
 private changed(state: AuthoringReceiptWaitState): void { try { this.ports.changed(state); } catch { /* Presentation cannot restart or poison observation. */ } }
 private checkCurrent(signal: AbortSignal): void { if(this.owner.signal.aborted || signal.aborted || !this.ports.current()) throw stopped(); }
 private async bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  this.checkCurrent(signal); let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => { abort = () => reject(stopped()); signal.addEventListener('abort', abort, { once: true }); this.owner.signal.addEventListener('abort', abort, { once: true }); });
  try { const value = await Promise.race([work, cancelled]); this.checkCurrent(signal); return value; }
  finally { signal.removeEventListener('abort', abort); this.owner.signal.removeEventListener('abort', abort); }
 }
 /** Manual checks join an existing read. A completed/failed automatic wait never resubmits. */
 check(signal: AbortSignal): Promise<void> {
  try { this.checkCurrent(signal); if(this.ports.received()) return Promise.resolve(); } catch(error) { return Promise.reject(error); }
  if(!this.reading) {
   const read = new AbortController(), abort = () => read.abort();
   signal.addEventListener('abort', abort, { once: true }); this.owner.signal.addEventListener('abort', abort, { once: true });
   const work = Promise.resolve().then(async () => { this.checkCurrent(read.signal); await this.ports.receive(read.signal); this.checkCurrent(read.signal); }).finally(() => {
    signal.removeEventListener('abort', abort); this.owner.signal.removeEventListener('abort', abort); if(this.reading === work) this.reading = null;
   });
   this.reading = work; void work.catch(() => {});
  }
  // Retain an underlying read that ignores abort; another gesture cannot overlap it.
  return this.bounded(this.reading, signal);
 }
 private delay(signal: AbortSignal): Promise<void> {
  let handle: unknown, abort!: () => void;
  const waiting = new Promise<void>((resolve, reject) => { abort = () => { this.timer.clearTimeout(handle); reject(stopped()); }; handle = this.timer.setTimeout(resolve, this.pollMs); signal.addEventListener('abort', abort, { once: true }); });
  return this.bounded(waiting, signal).finally(() => { this.timer.clearTimeout(handle); signal.removeEventListener('abort', abort); });
 }
 /** Start exactly once, only from the explicit Submit caller. Duration and receive count are both bounded. */
 start(signal: AbortSignal): Promise<AuthoringReceiptWaitState> {
  if(this.active) return this.active;
  const waiting = new AbortController(), abort = () => waiting.abort();
  signal.addEventListener('abort', abort, { once: true }); this.owner.signal.addEventListener('abort', abort, { once: true });
  const deadline = this.timer.setTimeout(abort, this.timeoutMs);
  this.active = Promise.resolve().then(async (): Promise<AuthoringReceiptWaitState> => {
   this.checkCurrent(signal); this.changed('waiting');
   for(let count = 0; count < this.maxPolls; count++) {
    this.checkCurrent(waiting.signal); if(this.ports.received()) return 'received';
    await this.check(waiting.signal); this.checkCurrent(waiting.signal); if(this.ports.received()) return 'received';
    if(count + 1 < this.maxPolls) await this.delay(waiting.signal);
   }
   return 'unconfirmed';
  }).catch((): AuthoringReceiptWaitState => this.owner.signal.aborted || signal.aborted ? 'closed' : 'unconfirmed').finally(() => {
   waiting.abort(); this.timer.clearTimeout(deadline); signal.removeEventListener('abort', abort); this.owner.signal.removeEventListener('abort', abort);
  }).then(state => { this.changed(state); return state; });
  return this.active;
 }
 close(): void { this.owner.abort(); }
}
