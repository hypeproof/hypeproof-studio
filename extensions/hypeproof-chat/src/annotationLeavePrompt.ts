/** Presentation of a discard decision; the host still owns scope/revision validation. */
export interface AnnotationLeavePrompt { id: string; count: number }
export class AnnotationLeaveRequest {
  private pending?: { id: string; scope: string; finish(discard: boolean): void };
  private readonly ports: { scope(): string; id(): string; present(prompt: AnnotationLeavePrompt | null): Promise<boolean | void> };
  private readonly timeoutMs: number;
  constructor(ports: AnnotationLeaveRequest['ports'], timeoutMs = 180_000) { this.ports = ports; this.timeoutMs = timeoutMs; }
  confirm(count: number): Promise<boolean> {
    if (this.pending || !Number.isInteger(count) || count < 1 || count > 10) return Promise.resolve(false);
    const prompt = { id: this.ports.id(), count }, scope = this.ports.scope();
    return new Promise(resolve => {
      const timer = setTimeout(() => { if (this.pending?.id === prompt.id) this.cancel(); }, this.timeoutMs);
      this.pending = { id: prompt.id, scope, finish: discard => {
        clearTimeout(timer); this.pending = undefined;
        void this.ports.present(null).catch(() => {}); resolve(discard);
      } };
      void this.ports.present(prompt).then(shown => { if (shown !== true && this.pending?.id === prompt.id) this.cancel(); })
        .catch(() => { if (this.pending?.id === prompt.id) this.cancel(); });
    });
  }
  respond(id: unknown, discard: unknown): void {
    if (!this.pending || id !== this.pending.id) return;
    this.pending.finish(discard === true && this.pending.scope === this.ports.scope());
  }
  cancel(): void { this.pending?.finish(false); }
}
