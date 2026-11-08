import { createContractWaits, type ContractWaits, type HumanWait, type WaitSignalResult } from "./localRuntime/humanWait.ts";
// Studio side of the Chalk command contract v0 (docs/contract/studio-chalk.md).
// Kept free of the vscode module: the command bus, the local runner and the studio
// operations are injected, so the contract is testable with stubs. The extension wires
// the real ones in extension.ts and chatPanelProvider.ts.

export const CONTRACT_VERSION = 1;
export const CHALK_EXTENSION_ID = "hypeproof.hypeproof-chalk";
export const NO_LOCAL_RUNTIME_MESSAGE = "강사 채팅은 지금 내 Claude 구독 연결에서만 됩니다.";

export type InstructorRuntime = "legacy" | "chalk-extension";
export type ConnectionKind = "server" | "subscription-claude" | "subscription-codex";

/**
 * Optional model choices for the Chalk instructor band (#3564). Studio sends them only when a local
 * runner exists, and they are the same values the legacy panel shows (`localModelSelection`). They do
 * not change the model that runs a turn: that stays `local.model`.
 */
export interface ContractModels {
  default: string;
  choices: Array<{ alias: string; id: string; label: string }>;
}

/** Narrows a model selection to the contract shape. Absent selection means no field is sent. */
export function contractModels(sel: { default: string; choices: Array<{ alias: string; id: string; label: string }> } | null | undefined): ContractModels | undefined {
  if (!sel) return undefined;
  return { default: sel.default, choices: sel.choices.map((c) => ({ alias: c.alias, id: c.id, label: c.label })) };
}
// "runtimeChanged" (#3578): the instructor runtime left chalk-extension. A Chalk that does not know a
// reason ends the session the same way as before, so the value is backward-compatible.
export type DeactivateReason = "issuerRemoved" | "rejected" | "studentSlotWins" | "superseded" | "runtimeChanged";
export type TurnEvent =
  | { kind: "delta"; text: string }
  | { kind: "activity"; activity: unknown }
  | { kind: "refusal" }
  | { kind: "toolCall"; callId: string; name: string; input: unknown }
  | { kind: "approvalRequest"; callId: string; action: unknown }
  | { kind: "done"; status: "ok" | "cancelled" | "error"; message?: string; requestId?: string; runbookUrl?: string };

export interface CommandBus {
  registerCommand(id: string, handler: (...args: unknown[]) => unknown): { dispose(): void };
  executeCommand<T = unknown>(id: string, ...args: unknown[]): Thenable<T> | Promise<T>;
}

export interface ToolDefinition { name: string; description: string; inputSchema: unknown }

export interface ChalkPrompt {
  kind: string;
  toolName: string;
  input: unknown;
  title: string;
  verb: string;
  files: string[];
}

export interface RunTurnInput {
  turnId: string;
  messages: Array<{ role: string; content: string }>;
  model?: string;
  tools: ToolDefinition[];
  systemBrief: string;
  cwd: string;
  signal: AbortSignal;
  emit(event: TurnEvent): Promise<unknown>;
  /** Asks the instructor through Chalk. Resolves false unless Chalk explicitly approves. */
  askApproval(prompt: ChalkPrompt): Promise<boolean>;
  /** Waits Chalk announced for this turn (#3601). The stall watch reads it as a pause. */
  humanWait: HumanWait;
}

export interface LocalRunner {
  /** Non-null only where a local executor exists (the Dev app with HPS_DEV_RUNTIME=1). */
  available(): boolean;
  /** The executor's own model (local.model). `model?` from Chalk is recorded, never used to run. */
  executorModel(): string | undefined;
  run(input: RunTurnInput): Promise<void>;
  previewOpen(webPath: string): Promise<{ ok: boolean; error?: string }>;
}

/** Studio operations that Chalk asks for (M-4). The provider implements them with its existing paths. */
export interface ContractOps {
  openExternal(url: string): Promise<{ ok: boolean; reason?: string }>;
  openReport(source: string | undefined): Promise<{ ok: boolean }>;
  inboxView(): Promise<unknown | null>;
  inboxOpened(objectId: string, generation: number): Promise<void>;
  inboxLink(objectId: string, url: string, generation: number, action: "open" | "copy"): Promise<{ ok: boolean }>;
  reviewPrepare(week: number | undefined): Promise<{ ok: boolean; message?: string }>;
}

/** Approval kinds that Chalk shows as its own prompt, and only when the studio policy asks for one. */
// Only writeFile. browser_open never reaches this gate: on both instructor paths it is a
// browser tool with no approve call (see src/chalk/instructorBrowserTools.ts). Gating outside URLs is studio#3464.
export const CHALK_PROMPT_KINDS = ["writeFile"] as const;

export function needsChalkPrompt(kind: string, requireApprovalFor: readonly string[]): boolean {
  return (CHALK_PROMPT_KINDS as readonly string[]).includes(kind) && requireApprovalFor.includes(kind);
}

const SOURCE_LABEL = /^[a-z0-9-]{1,32}$/;

/** Only a short lowercase label survives. Every other key in the arguments is dropped. */
export function reportSourceLabel(context: unknown): string | undefined {
  if (!context || typeof context !== "object") return undefined;
  const source = (context as { source?: unknown }).source;
  return typeof source === "string" && SOURCE_LABEL.test(source) ? source : undefined;
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

function errorDetail(err: unknown): { requestId?: string; runbookUrl?: string } | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as { requestId?: unknown; runbookUrl?: unknown };
  const detail: { requestId?: string; runbookUrl?: string } = {};
  if (typeof e.requestId === "string" && e.requestId.length > 0) detail.requestId = e.requestId;
  if (typeof e.runbookUrl === "string" && e.runbookUrl.length > 0) detail.runbookUrl = e.runbookUrl;
  return Object.keys(detail).length > 0 ? detail : undefined;
}

interface OpenTurn { controller: AbortController; done: boolean; waits: ContractWaits }

export class ChalkContractHost {
  private nonce: string | null = null;
  private readonly turns = new Map<string, OpenTurn>();
  // Turns that closed in this activation: a late humanWait signal for them is refused as turn-ended (#3601).
  private readonly endedTurns = new Set<string>();

  private readonly bus: CommandBus;
  private readonly runner: LocalRunner;
  private readonly ops: ContractOps;
  private readonly newId: () => string;

  constructor(bus: CommandBus, runner: LocalRunner, ops: ContractOps, newId: () => string = () => crypto.randomUUID()) {
    this.bus = bus;
    this.runner = runner;
    this.ops = ops;
    this.newId = newId;
  }

  register(): Array<{ dispose(): void }> {
    return [
      this.bus.registerCommand("hypeproof.runtime.runLocalTurn", (args) => this.runLocalTurn(args)),
      this.bus.registerCommand("hypeproof.runtime.cancelTurn", (args) => this.cancelTurn(args)),
      this.bus.registerCommand("hypeproof.runtime.previewOpen", (args) => this.previewOpen(args)),
      this.bus.registerCommand("hypeproof.runtime.openExternal", (args) => this.openExternal(args)),
      this.bus.registerCommand("hypeproof.runtime.openReport", (args) => this.openReport(args)),
      this.bus.registerCommand("hypeproof.runtime.inboxView", (args) => this.inboxView(args)),
      this.bus.registerCommand("hypeproof.runtime.inboxOpen", (args) => this.inboxOpen(args)),
      this.bus.registerCommand("hypeproof.runtime.inboxLink", (args) => this.inboxLink(args)),
      this.bus.registerCommand("hypeproof.runtime.reviewPrepare", (args) => this.reviewPrepare(args)),
      this.bus.registerCommand("hypeproof.runtime.humanWait", (args) => this.humanWait(args)),
    ];
  }

  get active(): boolean { return this.nonce !== null; }

  async activate(input: {
    issuerToken: string;
    verifiedServerUrl: string;
    connection: ConnectionKind;
    models?: ContractModels;
  }): Promise<{ ok: boolean; reason?: string }> {
    const sessionNonce = this.newId();
    const reply = await this.bus.executeCommand<{ ok?: boolean; reason?: string }>("hypeproof.chalk.activateInstructor", {
      contractVersion: CONTRACT_VERSION,
      sessionNonce,
      issuerToken: input.issuerToken,
      verifiedServerUrl: input.verifiedServerUrl,
      connection: input.connection,
      // Optional and omitted when absent, so a Chalk that does not know the field is unaffected.
      ...(input.models ? { models: input.models } : {}),
    });
    if (reply?.ok !== true) return { ok: false, reason: reply?.reason };
    this.nonce = sessionNonce;
    this.endedTurns.clear();
    return { ok: true };
  }

  async deactivate(reason: DeactivateReason): Promise<void> {
    if (this.nonce === null) return;
    const sessionNonce = this.nonce;
    for (const turn of this.turns.values()) {
      turn.waits.endAll();
      turn.controller.abort();
    }
    this.turns.clear();
    this.nonce = null;
    await this.bus.executeCommand("hypeproof.chalk.deactivateInstructor", {
      contractVersion: CONTRACT_VERSION,
      sessionNonce,
      reason,
    });
  }

  /** Pushes the current inbox to Chalk. Does nothing outside an active session. */
  async pushInbox(): Promise<void> {
    const sessionNonce = this.nonce;
    if (sessionNonce === null) return;
    const view = await this.ops.inboxView().catch(() => null);
    await Promise.resolve(this.bus.executeCommand("hypeproof.chalk.onInboxState", {
      contractVersion: CONTRACT_VERSION,
      sessionNonce,
      view,
    })).catch(() => undefined);
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
    const waits = createContractWaits();
    this.turns.set(turnId, { controller, done: false, waits });
    const sessionNonce = this.nonce;
    const emit = (event: TurnEvent): Promise<unknown> => Promise.resolve(this.bus.executeCommand("hypeproof.chalk.onTurnEvent", {
      contractVersion: CONTRACT_VERSION,
      sessionNonce,
      turnId,
      event,
    }));
    const requested = typeof a.model === "string" && a.model.length > 0 ? a.model : undefined;
    const askApproval = async (prompt: ChalkPrompt): Promise<boolean> => {
      const callId = this.newId();
      const reply = await emit({
        kind: "approvalRequest",
        callId,
        action: {
          toolName: prompt.toolName,
          input: prompt.input,
          prompt: { id: callId, title: prompt.title, verb: prompt.verb, files: prompt.files },
        },
      }).catch(() => undefined) as { approved?: unknown } | undefined;
      return reply?.approved === true;
    };
    void this.runner.run({
      turnId,
      messages: a.messages as RunTurnInput["messages"],
      model: requested,
      tools: a.tools as ToolDefinition[],
      systemBrief: typeof a.systemBrief === "string" ? a.systemBrief : "",
      cwd: typeof a.cwd === "string" ? a.cwd : "",
      signal: controller.signal,
      emit,
      askApproval,
      humanWait: waits,
    }).then(
      () => this.closeTurn(turnId, "ok"),
      (err: unknown) => this.closeTurn(turnId, controller.signal.aborted ? "cancelled" : "error",
        err instanceof Error ? err.message : "runtime error", errorDetail(err)),
    );
    return {
      accepted: true,
      requestedModel: requested ?? null,
      executorModel: this.runner.executorModel() ?? null,
    };
  }

  private closeTurn(
    turnId: string,
    status: "ok" | "cancelled" | "error",
    message?: string,
    detail?: { requestId?: string; runbookUrl?: string },
  ): void {
    const turn = this.turns.get(turnId);
    if (!turn || turn.done) return;
    turn.done = true;
    turn.waits.endAll();
    this.endedTurns.add(turnId);
    // Bounded: only the most recent 64 closed turns are remembered for turn-ended refusals.
    if (this.endedTurns.size > 64) this.endedTurns.delete(this.endedTurns.values().next().value as string);
    this.turns.delete(turnId);
    const sessionNonce = this.nonce;
    if (sessionNonce === null) return;
    void Promise.resolve(this.bus.executeCommand("hypeproof.chalk.onTurnEvent", {
      contractVersion: CONTRACT_VERSION,
      sessionNonce,
      turnId,
      event: { kind: "done", status, ...(message ? { message } : {}), ...(detail ?? {}) },
    })).catch(() => undefined);
  }

  // #3601: Chalk announces a wait for a person (start / keepalive / end). Refusals change nothing.
  private humanWait(args: unknown): WaitSignalResult | { ok: false; reason: "contractVersion" | "stale" | "turn-ended" | "invalidArgs" } {
    if (!args || typeof args !== "object") return { ok: false, reason: "invalidArgs" };
    const a = args as Record<string, unknown>;
    if (a.contractVersion !== CONTRACT_VERSION) return { ok: false, reason: "contractVersion" };
    if (this.nonce === null || a.sessionNonce !== this.nonce) return { ok: false, reason: "stale" };
    if (typeof a.turnId !== "string" || a.turnId.length === 0) return { ok: false, reason: "invalidArgs" };
    if (typeof a.waitId !== "string" || a.waitId.length === 0) return { ok: false, reason: "invalidArgs" };
    if (a.state !== "start" && a.state !== "keepalive" && a.state !== "end") return { ok: false, reason: "invalidArgs" };
    const turn = this.turns.get(a.turnId);
    if (!turn) return { ok: false, reason: this.endedTurns.has(a.turnId) ? "turn-ended" : "stale" };
    if (a.state === "start") return turn.waits.start(a.waitId);
    if (a.state === "keepalive") return turn.waits.keepalive(a.waitId);
    return turn.waits.end(a.waitId);
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

  private async openExternal(args: unknown): Promise<{ ok: boolean; reason?: string }> {
    const session = this.checkSession(args);
    if (!session) return { ok: false, reason: "noSession" };
    if (typeof session.a.url !== "string" || session.a.url.length === 0) return { ok: false, reason: "invalidArgs" };
    const r = await this.ops.openExternal(session.a.url);
    return r.ok ? { ok: true } : { ok: false, reason: typeof r.reason === "string" ? r.reason : "refused" };
  }

  private async openReport(args: unknown): Promise<{ ok: boolean }> {
    const session = this.checkSession(args);
    if (!session) return { ok: false };
    const r = await this.ops.openReport(reportSourceLabel(session.a.context));
    return { ok: r.ok === true };
  }

  private async inboxView(args: unknown): Promise<unknown | null> {
    if (!this.checkSession(args)) return null;
    return this.ops.inboxView();
  }

  private async inboxOpen(args: unknown): Promise<{ ok: boolean }> {
    const session = this.checkSession(args);
    if (!session || typeof session.a.objectId !== "string" || !Number.isInteger(session.a.generation)) return { ok: false };
    await this.ops.inboxOpened(session.a.objectId, session.a.generation as number);
    return { ok: true };
  }

  private async inboxLink(args: unknown): Promise<{ ok: boolean }> {
    const session = this.checkSession(args);
    if (!session) return { ok: false };
    const a = session.a;
    if (typeof a.objectId !== "string" || typeof a.url !== "string" || !Number.isInteger(a.generation)) return { ok: false };
    if (a.action !== "open" && a.action !== "copy") return { ok: false };
    const r = await this.ops.inboxLink(a.objectId, a.url, a.generation as number, a.action);
    return { ok: r.ok === true };
  }

  private async reviewPrepare(args: unknown): Promise<{ ok: boolean; message?: string }> {
    const session = this.checkSession(args);
    if (!session) return { ok: false, message: "noSession" };
    const week = Number.isInteger(session.a.week) ? (session.a.week as number) : undefined;
    const r = await this.ops.reviewPrepare(week);
    return r.ok ? { ok: true } : { ok: false, ...(typeof r.message === "string" ? { message: r.message } : {}) };
  }
}

export interface ContractView { token?: string; url?: string; connection?: ConnectionKind }

export interface ContractWant {
  isInstructor: boolean;
  panelMode: string;
  issuerToken: string | undefined;
  url: string;
  connection: ConnectionKind;
  models?: ContractModels;
}

// #3578: the setting listener's handler. Leaving chalk-extension ends an active Chalk session FIRST,
// before any refresh, so a refresh that throws or returns early cannot keep the session alive.
// The refresh error is returned to the caller; the end has already been requested by then.
export async function applyInstructorRuntimeSetting(
  runtimeValue: unknown,
  deps: { endSession: () => void | Promise<void>; refresh: () => unknown },
): Promise<void> {
  if (resolveInstructorRuntime(runtimeValue) !== "chalk-extension") await deps.endSession();
  await deps.refresh();
}

// #3578: leaving the chalk-extension runtime ends an active Chalk session. With no active session
// nothing is sent, so a repeated refresh on the legacy runtime sends at most one deactivate.
export async function endSessionForRuntime(host: ChalkContractHost, current: ContractView, runtime: InstructorRuntime): Promise<ContractView> {
  if (runtime === "chalk-extension") return current;
  if (host.active) await host.deactivate("runtimeChanged").catch(() => undefined);
  return {};
}

// Keeps the Chalk session in step with the instructor verdict (#2556). A new server address
// re-activates over the existing session; a new token or connection ends the old one first.
export async function syncInstructorSession(host: ChalkContractHost, current: ContractView, want: ContractWant): Promise<ContractView> {
  if (want.isInstructor && want.issuerToken) {
    const sameSession = current.token === want.issuerToken && current.connection === want.connection;
    if (host.active && sameSession && current.url === want.url) return current;
    if (host.active && !sameSession) await host.deactivate("superseded").catch(() => undefined);
    // Models are not part of sameSession: the local model is fixed while the app runs (#3564).
    const reply = await host.activate({ issuerToken: want.issuerToken, verifiedServerUrl: want.url, connection: want.connection, models: want.models })
      .catch(() => ({ ok: false }));
    return reply.ok ? { token: want.issuerToken, url: want.url, connection: want.connection } : {};
  }
  if (host.active) {
    const reason: DeactivateReason = want.panelMode !== "instructor" ? "studentSlotWins" : want.issuerToken ? "rejected" : "issuerRemoved";
    await host.deactivate(reason).catch(() => undefined);
  }
  return {};
}
