// Studio side of the Chalk command contract v0 (docs/contract/studio-chalk.md).
// Kept free of the vscode module: the command bus and the local runner are injected,
// so the contract is testable with stubs. The extension wires the real bus in extension.ts.

export const CONTRACT_VERSION = 1;
export const CHALK_EXTENSION_ID = "hypeproof.hypeproof-chalk";
export const NO_LOCAL_RUNTIME_MESSAGE = "강사 채팅은 지금 내 Claude 구독 연결에서만 됩니다.";

export type InstructorRuntime = "legacy" | "chalk-extension";
export type ConnectionKind = "server" | "subscription-claude" | "subscription-codex";
export type DeactivateReason = "issuerRemoved" | "rejected" | "studentSlotWins" | "superseded";
export type TurnEvent =
  | { kind: "delta"; text: string }
  | { kind: "activity"; activity: unknown }
  | { kind: "refusal" }
  | { kind: "toolCall"; callId: string; name: string; input: unknown }
  | { kind: "approvalRequest"; callId: string; action: unknown }
  | { kind: "done"; status: "ok" | "cancelled" | "error"; message?: string };

export interface CommandBus {
  registerCommand(id: string, handler: (...args: unknown[]) => unknown): { dispose(): void };
  executeCommand<T = unknown>(id: string, ...args: unknown[]): Thenable<T> | Promise<T>;
}

export interface ToolDefinition { name: string; description: string; inputSchema: unknown }

export interface RunTurnInput {
  turnId: string;
  messages: Array<{ role: string; content: string }>;
  model?: string;
  tools: ToolDefinition[];
  systemBrief: string;
  cwd: string;
  signal: AbortSignal;
  emit(event: TurnEvent): Promise<unknown>;
}

export interface LocalRunner {
  /** Non-null only where a local executor exists (the Dev app with HPS_DEV_RUNTIME=1). */
  available(): boolean;
  /** The executor's own model (local.model). `model?` from Chalk is recorded, never used to run. */
  executorModel(): string | undefined;
  run(input: RunTurnInput): Promise<void>;
  previewOpen(webPath: string): Promise<{ ok: boolean; error?: string }>;
}

export function resolveInstructorRuntime(value: unknown): InstructorRuntime {
  return value === "chalk-extension" ? "chalk-extension" : "legacy";
}

export function connectionFor(provider: string | undefined, hasLocal: boolean): ConnectionKind {
  if (!hasLocal) return "server";
  if (provider === "claude") return "subscription-claude";
  if (provider === "codex") return "subscription-codex";
  return "server";
}

interface OpenTurn { controller: AbortController; done: boolean }

export class ChalkContractHost {
  private nonce: string | null = null;
  private readonly turns = new Map<string, OpenTurn>();
  private readonly toolWaits = new Map<string, (r: { result: string; isError: boolean }) => void>();

  private readonly bus: CommandBus;
  private readonly runner: LocalRunner;
  private readonly newId: () => string;

  constructor(bus: CommandBus, runner: LocalRunner, newId: () => string = () => crypto.randomUUID()) {
    this.bus = bus;
    this.runner = runner;
    this.newId = newId;
  }

  register(): Array<{ dispose(): void }> {
    return [
      this.bus.registerCommand("hypeproof.runtime.runLocalTurn", (args) => this.runLocalTurn(args)),
      this.bus.registerCommand("hypeproof.runtime.cancelTurn", (args) => this.cancelTurn(args)),
      this.bus.registerCommand("hypeproof.runtime.previewOpen", (args) => this.previewOpen(args)),
    ];
  }

  get active(): boolean { return this.nonce !== null; }

  async activate(input: {
    issuerToken: string;
    verifiedServerUrl: string;
    connection: ConnectionKind;
  }): Promise<{ ok: boolean; reason?: string }> {
    const sessionNonce = this.newId();
    const reply = await this.bus.executeCommand<{ ok?: boolean; reason?: string }>("hypeproof.chalk.activateInstructor", {
      contractVersion: CONTRACT_VERSION,
      sessionNonce,
      issuerToken: input.issuerToken,
      verifiedServerUrl: input.verifiedServerUrl,
      connection: input.connection,
    });
    if (reply?.ok !== true) return { ok: false, reason: reply?.reason };
    this.nonce = sessionNonce;
    return { ok: true };
  }

  async deactivate(reason: DeactivateReason): Promise<void> {
    if (this.nonce === null) return;
    const sessionNonce = this.nonce;
    for (const turn of this.turns.values()) turn.controller.abort();
    this.turns.clear();
    this.nonce = null;
    await this.bus.executeCommand("hypeproof.chalk.deactivateInstructor", {
      contractVersion: CONTRACT_VERSION,
      sessionNonce,
      reason,
    });
  }

  private refusal(reason: string, message?: string): { accepted: false; reason: string; message?: string } {
    return { accepted: false, reason, ...(message ? { message } : {}) };
  }

  private checkSession(args: unknown): { ok: true; a: Record<string, unknown> } | null {
    if (!args || typeof args !== "object") return null;
    const a = args as Record<string, unknown>;
    if (a.contractVersion !== CONTRACT_VERSION) return null;
    if (this.nonce === null || a.sessionNonce !== this.nonce) return null;
    return { ok: true, a };
  }

  private async runLocalTurn(args: unknown): Promise<unknown> {
    if (!args || typeof args !== "object") return this.refusal("invalidArgs");
    const a = args as Record<string, unknown>;
    if (a.contractVersion !== CONTRACT_VERSION) return this.refusal("contractVersion");
    if (this.nonce === null || a.sessionNonce !== this.nonce) return this.refusal("noSession");
    if (a.policy !== "chalk-instructor") return this.refusal("policy");
    if (typeof a.turnId !== "string" || a.turnId.length === 0) return this.refusal("invalidArgs");
    if (!Array.isArray(a.messages) || !Array.isArray(a.tools)) return this.refusal("invalidArgs");
    if (!this.runner.available()) return this.refusal("noLocalRuntime", NO_LOCAL_RUNTIME_MESSAGE);

    const turnId = a.turnId;
    const controller = new AbortController();
    this.turns.set(turnId, { controller, done: false });
    const sessionNonce = this.nonce;
    const emit = (event: TurnEvent) => this.bus.executeCommand("hypeproof.chalk.onTurnEvent", {
      contractVersion: CONTRACT_VERSION,
      sessionNonce,
      turnId,
      event,
    });
    const requested = typeof a.model === "string" && a.model.length > 0 ? a.model : undefined;
    void this.runner.run({
      turnId,
      messages: a.messages as RunTurnInput["messages"],
      model: requested,
      tools: a.tools as ToolDefinition[],
      systemBrief: typeof a.systemBrief === "string" ? a.systemBrief : "",
      cwd: typeof a.cwd === "string" ? a.cwd : "",
      signal: controller.signal,
      emit,
    }).then(
      () => this.closeTurn(turnId, "ok"),
      (err: unknown) => this.closeTurn(turnId, controller.signal.aborted ? "cancelled" : "error",
        err instanceof Error ? err.message : "runtime error"),
    );
    return {
      accepted: true,
      requestedModel: requested ?? null,
      executorModel: this.runner.executorModel() ?? null,
    };
  }

  private closeTurn(turnId: string, status: "ok" | "cancelled" | "error", message?: string): void {
    const turn = this.turns.get(turnId);
    if (!turn || turn.done) return;
    turn.done = true;
    this.turns.delete(turnId);
    const sessionNonce = this.nonce;
    if (sessionNonce === null) return;
    void this.bus.executeCommand("hypeproof.chalk.onTurnEvent", {
      contractVersion: CONTRACT_VERSION,
      sessionNonce,
      turnId,
      event: { kind: "done", status, ...(message ? { message } : {}) },
    });
  }

  private async cancelTurn(args: unknown): Promise<{ cancelled: boolean }> {
    const session = this.checkSession(args);
    if (!session || typeof session.a.turnId !== "string") return { cancelled: false };
    const turn = this.turns.get(session.a.turnId);
    if (!turn) return { cancelled: false };
    turn.controller.abort();
    return { cancelled: true };
  }

  private async previewOpen(args: unknown): Promise<{ ok: boolean; error?: string }> {
    if (!args || typeof args !== "object") return { ok: false, error: "invalidArgs" };
    const a = args as Record<string, unknown>;
    if (a.contractVersion !== CONTRACT_VERSION) return { ok: false, error: "contractVersion" };
    if (typeof a.webPath !== "string" || a.webPath.length === 0) return { ok: false, error: "invalidArgs" };
    return this.runner.previewOpen(a.webPath);
  }
}
