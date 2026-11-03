/** Presentation only. URL policy and the remembered origin set stay in the host. */
export interface BrowserApprovalPrompt { id: string; title: string; host: string; label: string; place: 'preview' | 'internet' | 'file' | 'blank'; rememberLabel: string | null }
export type BrowserApprovalChoice = 'open' | 'deny' | 'remember';
export class BrowserApprovalRequest {
  private pending?: { prompt: BrowserApprovalPrompt; scope: string; finish(choice: BrowserApprovalChoice): void };
  private readonly ports: { scope(): string; present(prompt: BrowserApprovalPrompt | null): Promise<boolean | void> };
  private readonly timeoutMs: number;
  constructor(ports: { scope(): string; present(prompt: BrowserApprovalPrompt | null): Promise<boolean | void> }, timeoutMs = 180_000) { this.ports=ports; this.timeoutMs=timeoutMs; }
  confirm(prompt: BrowserApprovalPrompt): Promise<BrowserApprovalChoice> {
    this.invalidate();
    if (this.pending || !prompt.id) return Promise.resolve('deny');
    const frozen = structuredClone(prompt), scope = this.ports.scope();
    return new Promise(resolve => {
      const timer = setTimeout(() => this.cancel(), this.timeoutMs);
      this.pending = { prompt: frozen, scope, finish: choice => { clearTimeout(timer); this.pending = undefined; void this.ports.present(null).catch(() => {}); resolve(choice); } };
      void this.ports.present(frozen).then(shown => { if (shown !== true && this.pending?.prompt.id === frozen.id) this.cancel(); }).catch(() => { if (this.pending?.prompt.id === frozen.id) this.cancel(); });
    });
  }
  respond(id: unknown, choice: unknown): void {
    const pending = this.pending;
    if (!pending || id !== pending.prompt.id) return;
    if (pending.scope !== this.ports.scope()) { this.cancel(); return; }
    if (choice === 'deny' || choice === 'open') pending.finish(choice);
    else if (choice === 'remember' && Boolean(pending.prompt.rememberLabel)) pending.finish('remember');
  }
  invalidate(): void { if (this.pending && this.pending.scope !== this.ports.scope()) this.cancel(); }
  cancel(): void { this.pending?.finish('deny'); }
}
