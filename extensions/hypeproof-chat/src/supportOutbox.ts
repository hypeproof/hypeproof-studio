// Durable, bounded delivery of already-approved reports. No credentials are persisted here.
export interface SupportItem { id: string; endpoint: string; body: string; createdAt: number; attempts: number; nextAt: number; kind: "manual" | "auto"; lastError?: string }
export interface SupportStore { load(): Promise<SupportItem[]>; save(items: SupportItem[]): Promise<void>; lock?<T>(run: () => Promise<T>): Promise<T> }
export type Delivery = { ok: true; reportId: string } | { ok: false; reason: string; httpStatus?: number };
export type SupportResult = Delivery | { ok: false; queued: true; localId: string; reason: string; retryable: boolean };
const MAX_ITEMS = 20, MAX_BYTES = 32768, RETENTION = 7 * 86400000;
export class SupportOutbox {
  private chain: Promise<unknown> = Promise.resolve();
  private store: SupportStore;
  private send: (item: SupportItem) => Promise<Delivery>;
  private now: () => number;
  constructor(store: SupportStore, send: (item: SupportItem) => Promise<Delivery>, now = Date.now) {
    this.store = store; this.send = send; this.now = now;
  }
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.chain.then(() => this.store.lock ? this.store.lock(run) : run()); this.chain = next.catch(() => {}); return next;
  }
  enqueue(endpoint: string, body: string, kind: SupportItem["kind"] = "manual"): Promise<SupportResult> {
    return this.serial(async () => {
      const items = await this.store.load();
      if (items.length >= MAX_ITEMS || (kind === "auto" && items.filter(i => i.kind === "auto").length >= 10) || new TextEncoder().encode(body).length > MAX_BYTES)
        return { ok: false, reason: "보관함이 가득 찼거나 신고가 너무 커요. 보관된 신고를 먼저 확인해 주세요." };
      const id = crypto.randomUUID();
      const frozen = kind === "manual" ? JSON.stringify({ ...JSON.parse(body), client_report_id: id }) : body;
      if (new TextEncoder().encode(frozen).length > MAX_BYTES) return { ok: false, reason: "신고가 너무 커요. 첨부 내용을 줄여 주세요." };
      const item: SupportItem = { id, endpoint, body: frozen, kind, createdAt: this.now(), attempts: 0, nextAt: 0 };
      items.push(item);
      await this.store.save(items); // Never send if durable storage failed.
      return this.deliver(items, item);
    });
  }
  private async deliver(items: SupportItem[], item: SupportItem): Promise<SupportResult> {
    let result: Delivery;
    try { result = await this.send(item); } catch { result = { ok: false, reason: "네트워크 연결을 확인해 주세요." }; }
    if (result.ok) {
      // Receipt is authoritative even if local cleanup fails. A retry uses the same frozen id.
      try { await this.store.save(items.filter(row => row.id !== item.id)); } catch { /* preserve the receipt */ }
      return result;
    }
    item.attempts++;
    item.lastError = result.reason;
    // A permanent refusal remains visible for manual recovery; never loop on a 4xx.
    item.nextAt = result.httpStatus && result.httpStatus < 500 && ![408, 429].includes(result.httpStatus)
      ? Number.MAX_SAFE_INTEGER : this.now() + Math.min(3600000, 60000 * 2 ** Math.min(item.attempts, 6));
    await this.store.save(items);
    return { ok: false, queued: true, localId: item.id, reason: result.reason, retryable: item.nextAt !== Number.MAX_SAFE_INTEGER };
  }
  flush(autoEnabled: boolean): Promise<Array<{ id: string; result: SupportResult }>> {
    return this.serial(async () => {
      const results: Array<{ id: string; result: SupportResult }> = [];
      const items = await this.store.load();
      // Automatic diagnostics carry no user text and expire. Manual reports never silently disappear.
      let pending = items.filter(i => i.kind !== "auto" || (autoEnabled && this.now() - i.createdAt < RETENTION));
      await this.store.save(pending);
      for (const item of [...pending].filter(i => i.nextAt <= this.now()).slice(0, 2)) {
        const result = await this.deliver(pending, item); results.push({ id: item.id, result });
        if (result.ok) pending = pending.filter(i => i.id !== item.id);
      }
      return results;
    });
  }
  remove(id: string): Promise<void> { return this.serial(async () => { await this.store.save((await this.store.load()).filter(i => i.id !== id)); }); }
  retry(id: string): Promise<SupportResult> { return this.serial(async () => {
    const items = await this.store.load(), item = items.find(i => i.id === id);
    return item ? this.deliver(items, item) : { ok: false, reason: "보관된 요청이 없어요." };
  }); }
  list(): Promise<SupportItem[]> { return this.serial(() => this.store.load()); }
}
