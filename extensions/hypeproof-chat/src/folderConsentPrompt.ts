import type { FolderConsentLevel } from './folderConsent';

export interface FolderConsentPrompt { id: string; folder: string }
export interface FolderConsentPromptPorts {
  id(): string;
  scope(): string;
  present(prompt: FolderConsentPrompt | null): Promise<boolean | void>;
}

/** Presentation only. The existing host remains responsible for scope, storage and grant narrowing. */
export class FolderConsentRequest {
  private pending?: { id: string; scope: string; finish(value: FolderConsentLevel | undefined): void };
  private readonly ports: FolderConsentPromptPorts;
  private readonly timeoutMs: number;
  constructor(ports: FolderConsentPromptPorts, timeoutMs = 180_000) { this.ports = ports; this.timeoutMs = timeoutMs; }

  ask(folder: string): Promise<FolderConsentLevel | undefined> {
    if (this.pending || !folder) return Promise.resolve(undefined);
    const prompt = { id: this.ports.id(), folder }, scope = this.ports.scope();
    return new Promise(resolve => {
      const timer = setTimeout(() => this.cancel(), this.timeoutMs);
      this.pending = { id: prompt.id, scope, finish: value => {
        clearTimeout(timer); this.pending = undefined;
        void this.ports.present(null).catch(() => {}); resolve(value);
      } };
      const refuse = () => { if (this.pending?.id === prompt.id) this.cancel(); };
      void this.ports.present(prompt).then(shown => { if (shown !== true) refuse(); }).catch(refuse);
    });
  }

  respond(id: unknown, level: unknown): void {
    const pending = this.pending;
    if (!pending || id !== pending.id) return;
    if (pending.scope !== this.ports.scope()) return this.cancel();
    if (level !== 'full' && level !== 'read' && level !== 'none') return this.cancel();
    pending.finish(level);
  }
  invalidateIfScopeChanged(): void { if (this.pending && this.pending.scope !== this.ports.scope()) this.cancel(); }
  cancel(): void { this.pending?.finish(undefined); }
}
