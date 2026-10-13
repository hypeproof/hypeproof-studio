// Codex SDK coach — the host half (hypeproof-studio#1611, local trial).
//
// Drop-in for runSdkCoach: same SdkCoachArgs, same callbacks, same SdkTurnEnd, so the
// chat panel draws a Codex turn with the code it already has. Differences from the
// Claude path, on purpose:
//   - Model calls go to the Service's POST /v1/responses with the workshop token; the
//     Service swaps in the cohort blocks exactly as /v1/messages does.
//   - Built-in file/shell tools are Codex's (apply_patch, shell). There is no per-call
//     approval hook in `codex exec`, so writes are confined by Codex's OS sandbox
//     (workspace-write, network off) instead of canUseTool. The Claude path auto-allows
//     workspace writes by policy today, so the learner sees no modal on either path.
//   - The hypeproof MCP tools (preview, browser, publish) are the Claude path's own
//     definitions — descriptions and handlers come from buildHypeproofMcpServer through
//     a capturing factory — served over Studio's loopback MCP transport. Each call still
//     goes through evaluateSdkToolUse and the approval modal, as on the Claude path.

import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { crMcpRegistration } from "./crHostWiring";
import {
  buildHypeproofMcpServer,
  crBrowserOpenRefusal,
  MCP_BROWSER_OPEN,
  resolveAlreadyOpen,
  type McpToolResult,
  type ZodLike,
} from "./browserMcp";
import { ProxyAuthError } from "./proxyClient";
import { GATEWAY_AUTH_FAILED_FRIENDLY, GATEWAY_BAD_REQUEST_FRIENDLY } from "./proxyClientHelpers";
import { stallNotice } from "./coachIdentity.ts";
import {
  canonicalizeFsPath,
  CoachStallError,
  coachVisibleWorkspaceFiles,
  SdkUnavailableError,
  type SdkCoachArgs,
} from "./sdkCoach";
import {
  coachSeatKeyFor,
  evaluateSdkToolUse,
  profileToAgentOptions,
  resolveZodModule,
  SDK_STREAM_STALL_MS,
  sdkConfigDirFor,
  type SdkTurnEnd,
} from "./sdkCoachHelpers";
import {
  CODEX_MCP_SERVER,
  codexConfig,
  codexEnv,
  codexErrorStatus,
  codexEventEffect,
  codexHeaders,
  codexPrompt,
} from "./codexRuntime";
import { startToolServer } from "./localRuntime/toolServer.mjs";

const CODEX_SDK_PACKAGE = "@openai/codex-sdk";

interface CodexThread {
  runStreamed(input: string, opts?: { signal?: AbortSignal }): Promise<{ events: AsyncGenerator<Record<string, unknown>> }>;
}
interface CodexSdkModule {
  Codex: new (opts: {
    codexPathOverride?: string;
    config?: Record<string, unknown>;
    env?: Record<string, string>;
  }) => {
    startThread(opts: Record<string, unknown>): CodexThread;
  };
}

function extensionDistDir(): string | undefined {
  return typeof __dirname === "string" && __dirname ? __dirname : undefined;
}

/** Where the SDK entry is: vendored next to dist (packaged), a trial override, or node_modules. */
function codexSdkSpecifier(): string {
  const entry = (root: string) => path.join(root, "@openai", "codex-sdk", "dist", "index.js");
  const dist = extensionDistDir();
  const vendored = dist ? entry(path.join(dist, "vendor", "node_modules")) : undefined;
  if (vendored && fs.existsSync(vendored)) return pathToFileURL(vendored).href;
  // Packaging the SDK and its platform binary (328 MB, like the seeded claude binary) is a
  // follow-up; until then only a node_modules checkout resolves it.
  return CODEX_SDK_PACKAGE;
}

async function loadCodexSdk(): Promise<CodexSdkModule> {
  try {
    // Variable specifier: esbuild leaves it a runtime import, so the SDK resolves its
    // platform binary package from the node_modules it sits in (never bundled).
    const spec: string = codexSdkSpecifier();
    const mod = (await import(spec)) as CodexSdkModule;
    if (typeof mod.Codex !== "function") throw new Error("Codex export missing");
    return mod;
  } catch (err) {
    throw new SdkUnavailableError(`codex runtime selected but ${CODEX_SDK_PACKAGE} could not be loaded: ${String(err)}`);
  }
}

async function loadZod(): Promise<(ZodLike & { object?: (s: unknown) => unknown; toJSONSchema?: (s: unknown) => unknown }) | null> {
  const resolution = resolveZodModule({ distDir: extensionDistDir(), fileExists: (p) => fs.existsSync(p) });
  try {
    const spec: string = resolution.source === "vendored" ? pathToFileURL(resolution.entryPath).href : resolution.specifier;
    const mod = (await import(spec)) as Record<string, unknown> & { z?: unknown; default?: unknown };
    const z = (mod.z ?? (mod.default as { z?: unknown } | undefined)?.z ?? mod.default ?? mod) as ZodLike & {
      object?: (s: unknown) => unknown;
      toJSONSchema?: (s: unknown) => unknown;
    };
    return typeof z.string === "function" ? z : null;
  } catch (err) {
    console.warn("[codex-coach] failed to load zod for the hypeproof MCP tools:", err);
    return null;
  }
}

interface CapturedTool {
  name: string;
  description: string;
  inputSchema: unknown;
  handler: (args: Record<string, unknown>, extra: unknown) => Promise<McpToolResult>;
}

/** The Claude path's hypeproof MCP tools, captured instead of handed to the Claude SDK. */
function captureHypeproofTools(
  z: NonNullable<Awaited<ReturnType<typeof loadZod>>>,
  host: NonNullable<SdkCoachArgs["browserHost"]>,
  permittedMcpTools: readonly string[],
): CapturedTool[] {
  const captured: CapturedTool[] = [];
  buildHypeproofMcpServer(
    {
      tool: (name, description, shape, handler) => {
        let inputSchema: unknown = { type: "object", properties: {} };
        if (typeof z.object === "function" && typeof z.toJSONSchema === "function") {
          const schema = z.toJSONSchema(z.object(shape)) as Record<string, unknown>;
          delete schema.$schema;
          inputSchema = schema;
        }
        const t = { name, description, inputSchema, handler };
        captured.push(t);
        return t;
      },
      createSdkMcpServer: (o) => o,
    },
    z,
    host,
    // The same registration flags runSdkCoach passes on this base.
    crMcpRegistration(permittedMcpTools),
  );
  // Serve only what the profile granted — the same names canUseTool would let through.
  return captured.filter((t) => permittedMcpTools.includes(`mcp__${CODEX_MCP_SERVER}__${t.name}`));
}

const CODEX_FAILED_FRIENDLY = "응답을 끝까지 받지 못했어요. 작업 파일은 그대로 있어요. 같은 말을 한 번 더 보내 주세요.";

export async function runCodexCoach(args: SdkCoachArgs): Promise<SdkTurnEnd> {
  if (args.signal.aborted) throw new DOMException("aborted", "AbortError");
  const opts = profileToAgentOptions(args.profile, { model: args.model, systemPrompt: args.systemPrompt });
  // Codex always holds a shell and file writes; a cohort that is not granted both stays
  // on the Claude path, where canUseTool can withhold them (fail closed).
  if (!opts.permittedTools.includes("Bash") || !opts.permittedTools.includes("Write")) {
    throw new SdkUnavailableError("codex runtime needs the shell and write grants; this profile keeps the Claude Agent SDK");
  }
  if (!args.cwd) throw new SdkUnavailableError("codex runtime needs a workspace folder");
  const sdk = await loadCodexSdk();

  const turn = new AbortController();
  const onAbort = () => turn.abort();
  args.signal.addEventListener("abort", onAbort, { once: true });

  // Stall watchdog bookkeeping (the Claude path's #403 contract): silence only counts
  // while nothing is legitimately running — a modal or a tool call is not a stall.
  let lastProgress = Date.now();
  let awaitingUser = 0;
  const inFlight = new Set<string>();

  // ── hypeproof MCP tools over the loopback transport ──
  let toolServer: { url: string; token: string; close(): void } | null = null;
  if (opts.permittedMcpTools.length > 0 && args.browserHost) {
    const z = await loadZod();
    const tools = z ? captureHypeproofTools(z, args.browserHost, opts.permittedMcpTools) : [];
    if (tools.length > 0) {
      const host = args.browserHost;
      const byName = new Map(tools.map((t) => [t.name, t]));
      toolServer = await startToolServer(
        tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
        async (name: string, raw: unknown) => {
          const tool = byName.get(name);
          if (!tool) return { content: [{ type: "text", text: "이 도구는 지금 쓸 수 없어요." }], isError: true };
          const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
          const full = `mcp__${CODEX_MCP_SERVER}__${name}`;
          const callId = `mcp-${name}-${Date.now()}`;
          const decided = (allowed: boolean, actor: "user" | "policy" = "policy") =>
            args.onActivity?.({ kind: "approval", id: callId, name: full, input, allowed, actor, at: Date.now() });
          inFlight.add(callId);
          try {
            const verdict = evaluateSdkToolUse({
              toolName: full,
              input,
              permittedTools: [...opts.permittedTools, ...opts.permittedMcpTools],
              workspaceRoot: args.cwd,
              canonicalize: canonicalizeFsPath,
            });
            if (verdict.decision === "deny") {
              decided(false);
              return { content: [{ type: "text", text: verdict.friendly }], isError: true };
            }
            if (verdict.decision === "ask") {
              let skipModal = false;
              if (full === MCP_BROWSER_OPEN) {
                const { url, alreadyOpen } = await resolveAlreadyOpen(host, input.url);
                const refused = url ? await crBrowserOpenRefusal(host, url) : null;
                if (refused) {
                  decided(false);
                  return { content: [{ type: "text", text: refused }], isError: true };
                }
                skipModal = alreadyOpen;
              }
              if (!skipModal) {
                awaitingUser += 1;
                let ok: boolean;
                try {
                  const approval = await args.requestApproval({
                    toolName: full,
                    input,
                    ...(verdict.destructive ? { destructive: true } : {}),
                  });
                  ok = typeof approval === "boolean" ? approval : approval.approved;
                  decided(ok, typeof approval === "boolean" ? "policy" : approval.actor);
                } finally {
                  awaitingUser -= 1;
                  lastProgress = Date.now();
                }
                if (!ok) return { content: [{ type: "text", text: "사용자가 이 작업을 허용하지 않았어요." }], isError: true };
              } else decided(true);
            } else decided(true);
            return await tool.handler(input, {});
          } finally {
            inFlight.delete(callId);
            lastProgress = Date.now();
          }
        },
        turn.signal,
      );
    }
  }

  // REQ-M13 twin — the CLI gets a Codex home of its own, so the learner's personal Codex
  // login, config, MCP servers and AGENTS.md never reach the coach.
  const codexHome = sdkConfigDirFor(process.env, `codex-${coachSeatKeyFor(args)}`);
  fs.mkdirSync(codexHome, { recursive: true });

  const headers = codexHeaders({
    turnId: args.turnId,
    effort: args.effort,
    fundingSource: args.fundingSource,
    lessonBinding: args.lessonBinding,
    lessonStep: args.lessonStep,
    helpMode: args.helpMode,
    workspace: args.cwd,
    workspaceFiles: coachVisibleWorkspaceFiles(args.cwd, args.profile),
    previewUrl: args.previewUrl,
  });
  const codex = new sdk.Codex({
    ...(process.env.HPS_CODEX_BINARY?.trim() ? { codexPathOverride: process.env.HPS_CODEX_BINARY.trim() } : {}),
    config: codexConfig({ proxyUrl: args.gatewayUrl, headers, mcpUrl: toolServer?.url }) as never,
    env: codexEnv(process.env, { codexHome, token: args.token, mcpToken: toolServer?.token }),
  });
  const thread = codex.startThread({
    model: args.model,
    workingDirectory: path.resolve(args.cwd),
    skipGitRepoCheck: true,
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
    networkAccessEnabled: false,
    webSearchMode: "disabled",
  });

  const stallMs = args.stallTimeoutMs ?? SDK_STREAM_STALL_MS;
  let stalled = false;
  const watchdog =
    stallMs > 0
      ? setInterval(() => {
          if (awaitingUser > 0 || inFlight.size > 0) return;
          if (Date.now() - lastProgress > stallMs) {
            stalled = true;
            turn.abort();
          }
        }, 2_000)
      : null;

  let wroteText = false;
  let failure: string | undefined;
  const started = new Set<string>();
  try {
    const { events } = await thread.runStreamed(codexPrompt(args.history, args.userText), { signal: turn.signal });
    for await (const event of events) {
      lastProgress = Date.now();
      const item = event.item as { id?: string; type?: string } | undefined;
      if (event.type === "item.started" && item?.id && item.type !== "agent_message" && item.type !== "reasoning") inFlight.add(item.id);
      if (event.type === "item.completed" && item?.id) inFlight.delete(item.id);
      const effect = codexEventEffect(event, started);
      for (const a of effect.activities) args.onActivity?.(a);
      if (effect.text) {
        args.onDelta((wroteText ? "\n\n" : "") + effect.text);
        wroteText = true;
      }
      if (effect.usage) args.onUsage?.({ kind: "turn_total", usage: { runtime: "codex", ...effect.usage }, totalCostUsd: null });
      if (effect.failure) failure = effect.failure;
      if (effect.recovered) failure = undefined;
    }
  } catch (err) {
    if (args.signal.aborted) throw new DOMException("aborted", "AbortError");
    if (stalled) throw new CoachStallError(stallNotice(args.coachName));
    failure = failure ?? (err instanceof Error ? err.message : String(err));
  } finally {
    if (watchdog) clearInterval(watchdog);
    args.signal.removeEventListener("abort", onAbort);
    toolServer?.close();
  }
  if (args.signal.aborted) throw new DOMException("aborted", "AbortError");
  if (stalled) throw new CoachStallError(stallNotice(args.coachName));
  if (failure) {
    const status = codexErrorStatus(failure);
    console.warn(`[codex-coach] turn failed (status ${status ?? "none"}): ${failure.slice(0, 600)}`);
    if (status === 401) throw new ProxyAuthError("missing", GATEWAY_AUTH_FAILED_FRIENDLY);
    if (status === 400) throw new ProxyAuthError("other", GATEWAY_BAD_REQUEST_FRIENDLY);
    if (wroteText) {
      // The learner already read part of the turn: keep it, add the notice (the #751 U4 shape).
      args.onDelta(`\n\n${CODEX_FAILED_FRIENDLY}`);
      return { failed: true, subtype: "codex_turn_failed", ...(status ? { status } : {}) };
    }
    throw new CoachStallError(
      status === 429
        ? "요청 한도에 도달해 응답을 받지 못했습니다. 잠시 후 다시 시도하거나 강사에게 체험 한도를 확인해 주세요. (429)"
        : status && status >= 500
          ? `AI 서비스 오류로 응답을 받지 못했습니다. 작업 파일은 보존돼 있습니다. (${status})`
          : CODEX_FAILED_FRIENDLY,
      status,
    );
  }
  return { failed: false };
}
