/** Presentation only. Shell policy and the exact-command allow store stay in the host. */
/**
 * The heading is fixed app copy chosen by request kind, never request text. The SDK's
 * description is `${toolName}: ${command}` (English tool name, the command repeated, no purpose),
 * and a model-written description in an approval heading would be a persuasion vector.
 */
export type CommandApprovalPurpose = 'shell' | 'destructive' | 'unrecognized';
export const COMMAND_APPROVAL_PURPOSE: Readonly<Record<CommandApprovalPurpose, string>> = {
  shell: '코치가 명령을 실행하려고 해요',
  destructive: '코치가 위험한 명령을 실행하려고 해요',
  unrecognized: '코치가 알 수 없는 도구를 쓰려고 해요',
};
/** Any value the table does not know reads as the unrecognized phrase: fail toward caution. */
export const commandApprovalPurposeText = (purpose: unknown): string =>
  typeof purpose === 'string' && Object.prototype.hasOwnProperty.call(COMMAND_APPROVAL_PURPOSE, purpose)
    ? COMMAND_APPROVAL_PURPOSE[purpose as CommandApprovalPurpose] : COMMAND_APPROVAL_PURPOSE.unrecognized;
/** The kind comes from the request shape: a shell request without a string command is an unrecognized tool. */
export const commandApprovalPurposeFor = (payload: unknown, destructive: boolean): CommandApprovalPurpose =>
  typeof (payload as { command?: unknown } | null | undefined)?.command !== 'string' ? 'unrecognized' : destructive ? 'destructive' : 'shell';
export interface CommandApprovalPrompt { id: string; purpose: CommandApprovalPurpose; command: string; destructive: boolean; rememberAllowed: boolean }
export type CommandApprovalChoice = 'allow' | 'deny' | 'remember';
export class CommandApprovalRequest {
  private pending?: { prompt: CommandApprovalPrompt; scope: string; finish(choice: CommandApprovalChoice): void };
  private readonly ports: { scope(): string; present(prompt: CommandApprovalPrompt | null): Promise<boolean | void> };
  private readonly timeoutMs: number;
  constructor(ports: { scope(): string; present(prompt: CommandApprovalPrompt | null): Promise<boolean | void> }, timeoutMs = 180_000) { this.ports=ports; this.timeoutMs=timeoutMs; }
  confirm(prompt: CommandApprovalPrompt): Promise<CommandApprovalChoice> {
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
    if (choice === 'deny' || choice === 'allow') pending.finish(choice);
    else if (choice === 'remember' && pending.prompt.rememberAllowed && !pending.prompt.destructive) pending.finish('remember');
  }
  invalidate(): void { if (this.pending && this.pending.scope !== this.ports.scope()) this.cancel(); }
  cancel(): void { this.pending?.finish('deny'); }
}
