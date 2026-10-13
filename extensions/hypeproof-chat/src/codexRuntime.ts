// Codex SDK coach — the pure half (hypeproof-studio#1611, local trial).
//
// When the learner's chosen model is a GPT model, the agent-sdk seat runs on the Codex
// SDK instead of the Claude Agent SDK. This module owns every decision that does not
// need the vscode API or a process: which runtime a turn takes, the Codex CLI config
// (provider = the Service's /v1/responses, MCP = Studio's loopback tool server), the env
// the CLI gets, and the mapping from Codex thread events to the SdkActivity lines the
// chat panel already draws for the Claude path. The host half is codexCoach.ts.

import type { ResolvedProfile } from "./protocol";
import type { SdkActivity } from "./sdkCoachHelpers";

/** The MCP server name Codex sees — the same name the Claude path registers. */
export const CODEX_MCP_SERVER = "hypeproof";
/** Env var the CLI reads the workshop token from (model_providers.hypeproof.env_key). */
export const CODEX_TOKEN_ENV = "HPS_CODEX_TOKEN";
/** Env var the CLI reads the loopback MCP bearer from. */
export const CODEX_MCP_TOKEN_ENV = "HPS_CODEX_MCP_TOKEN";

type ModelSelection = NonNullable<ResolvedProfile["model_selection"]>;
type ModelChoice = ModelSelection["choices"][number] & { codex_model?: string };

/**
 * Does this turn run on the Codex SDK? Only an agent-sdk seat whose chosen model is a
 * GPT model does; everything else keeps the Claude Agent SDK. `HPS_CODEX_RUNTIME=off`
 * forces the Claude path (A/B runs on the same seat), `=on` forces Codex.
 */
export function codexRuntimeFor(args: {
  runtime: "proxy" | "agent-sdk";
  selection: ModelSelection | undefined;
  model: string;
  env?: Record<string, string | undefined>;
}): { codex: false } | { codex: true; model: string } {
  if (args.runtime !== "agent-sdk") return { codex: false };
  const choice = args.selection?.choices.find((c) => c.alias === args.model || c.id === args.model) as ModelChoice | undefined;
  const override = args.env?.HPS_CODEX_RUNTIME?.trim().toLowerCase();
  if (override === "off") return { codex: false };
  const provider = choice?.provider ?? args.selection?.provider;
  if (override !== "on" && provider !== "openai") return { codex: false };
  return { codex: true, model: choice?.codex_model ?? choice?.id ?? args.model };
}

/** Service base for the Codex provider: the extension's proxyUrl already ends in /v1. */
export function codexBaseUrlFor(proxyUrl: string): string {
  return proxyUrl.trim().replace(/\/+$/, "");
}

/**
 * The per-turn headers the Claude path sends through ANTHROPIC_CUSTOM_HEADERS, so the
 * Service builds the same cohort blocks (workspace, file list, preview address) and
 * records the same turn. Values are percent-encoded like the Claude path's: a Korean
 * folder name is not a valid header byte.
 */
export function codexHeaders(args: {
  turnId?: string;
  effort?: string;
  fundingSource?: string;
  lessonBinding?: string;
  lessonStep?: string;
  helpMode?: string;
  workspace?: string;
  workspaceFiles?: readonly string[];
  previewUrl?: string;
}): Record<string, string> {
  const h: Record<string, string> = {};
  if (args.fundingSource && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(args.fundingSource)) h["x-hps-funding-source"] = args.fundingSource;
  if (args.effort) h["x-hps-effort"] = args.effort;
  if (args.lessonBinding && /^(token:[a-f0-9]{16}|[a-f0-9]{32})$/.test(args.lessonBinding)) h["x-hps-lesson-binding"] = args.lessonBinding;
  if (args.lessonStep && /^[A-Za-z0-9_.:-]{1,64}$/.test(args.lessonStep)) {
    h["x-hps-lesson-step"] = args.lessonStep;
    if (args.helpMode && /^[a-z_]{1,32}$/.test(args.helpMode)) h["x-hps-help-mode"] = args.helpMode;
  }
  if (args.turnId && /^[a-zA-Z0-9_-]{1,128}$/.test(args.turnId)) h["x-hps-turn-id"] = args.turnId;
  if (args.workspace?.trim()) h["x-hps-workspace"] = encodeURIComponent(args.workspace.trim());
  if (args.workspaceFiles && args.workspaceFiles.length > 0) {
    h["x-hps-workspace-files"] = encodeURIComponent(args.workspaceFiles.slice(0, 80).join("\n"));
  }
  if (args.previewUrl?.trim()) h["x-hps-preview-url"] = encodeURIComponent(args.previewUrl.trim());
  return h;
}

/**
 * `--config` overrides for the Codex CLI. The provider is the Service (never OpenAI
 * directly — the workshop token is the only credential the seat holds), the MCP server
 * is Studio's loopback tool server, and nothing is read from the learner's own Codex
 * setup: CODEX_HOME is isolated by the host and AGENTS.md lookup is off, the twin of
 * the Claude path's `settingSources: []`.
 */
export function codexConfig(args: {
  proxyUrl: string;
  headers: Record<string, string>;
  mcpUrl?: string;
}): Record<string, unknown> {
  return {
    model_provider: "hypeproof",
    model_providers: {
      hypeproof: {
        name: "HypeProof",
        base_url: codexBaseUrlFor(args.proxyUrl),
        env_key: CODEX_TOKEN_ENV,
        wire_api: "responses",
        http_headers: args.headers,
        // A bad token or a refused request is not fixed by retrying (REQ-M15 on the Claude path).
        request_max_retries: 1,
        stream_max_retries: 1,
      },
    },
    project_doc_max_bytes: 0,
    history: { persistence: "none" },
    ...(args.mcpUrl
      ? {
          mcp_servers: {
            [CODEX_MCP_SERVER]: {
              url: args.mcpUrl,
              bearer_token_env_var: CODEX_MCP_TOKEN_ENV,
              startup_timeout_sec: 20,
              // publish_site waits on GitHub for minutes.
              tool_timeout_sec: 900,
              // Codex's own MCP approval cannot reach the learner in `exec`; Studio's tool
              // server runs evaluateSdkToolUse and the approval modal before every call.
              default_tools_approval_mode: "approve",
            },
          },
        }
      : {}),
  };
}

/** Env names that would route the CLI somewhere else or hand it another credential. */
const SCRUBBED_ENV = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_ORG_ID",
  "OPENAI_PROJECT_ID",
  "CODEX_API_KEY",
  "CODEX_HOME",
  "CODEX_SANDBOX",
  "CODEX_SANDBOX_NETWORK_DISABLED",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_CUSTOM_HEADERS",
  "CLAUDE_CODE_OAUTH_TOKEN",
];

/** The CLI process env: the host env minus foreign credentials, plus ours. */
export function codexEnv(
  baseEnv: Record<string, string | undefined>,
  args: { codexHome: string; token: string; mcpToken?: string },
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(baseEnv)) if (typeof v === "string" && !SCRUBBED_ENV.includes(k)) env[k] = v;
  env.CODEX_HOME = args.codexHome;
  env[CODEX_TOKEN_ENV] = args.token;
  if (args.mcpToken) env[CODEX_MCP_TOKEN_ENV] = args.mcpToken;
  return env;
}

/** The Claude path folds history into one prompt string; the Codex path does the same. */
export function codexPrompt(history: ReadonlyArray<{ role: string; content: string }>, userText: string): string {
  const transcript = history.map((m) => `${m.role}: ${m.content}`).join("\n");
  return transcript ? `${transcript}\nuser: ${userText}` : userText;
}

/** `/bin/zsh -lc "sed -n '1,80p' index.html"` → `sed -n '1,80p' index.html` for the tool line. */
export function displayCommand(command: string): string {
  const m = /^\S*?(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*)\1\s*$/.exec(command.trim());
  return m ? m[2] : command;
}

function lastLine(text: string | undefined, max = 120): string | undefined {
  const line = (text ?? "").trim().split("\n").filter(Boolean).pop()?.trim();
  if (!line) return undefined;
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

/** What one Codex thread event means to the chat panel. */
export interface CodexEventEffect {
  activities: SdkActivity[];
  /** Assistant text to append (an agent message, separated from the previous one). */
  text?: string;
  usage?: Record<string, unknown>;
  /** Thread-fatal error message (turn.failed / error). */
  failure?: string;
  /** The turn completed after all — an earlier stream error did not end it. */
  recovered?: boolean;
}

type Item = { id: string; type: string; [k: string]: unknown };

/**
 * Codex `exec --experimental-json` event → SdkActivity lines + text. Tool names are the
 * Claude path's (Bash / Write / Edit / mcp__hypeproof__*), so the panel's preview reveal,
 * the "고쳤어요" verdict (R0) and the observation records read a Codex turn exactly like
 * a Claude one. `started` keeps the ids of the items whose tool_use line was already
 * drawn, so an item that only ever completes still gets its pair.
 */
export function codexEventEffect(event: Record<string, unknown>, started: Set<string>, now = Date.now()): CodexEventEffect {
  const type = String(event.type ?? "");
  if (type === "turn.completed") return { activities: [], usage: (event.usage as Record<string, unknown>) ?? {}, recovered: true };
  if (type === "turn.failed") return { activities: [], failure: String((event.error as { message?: unknown })?.message ?? "turn failed") };
  // "Reconnecting... 1/2 (…)" is the CLI retrying, not the end of the turn.
  if (type === "error") return /^Reconnecting\b/i.test(String(event.message ?? "")) ? { activities: [] } : { activities: [], failure: String(event.message ?? "stream error") };
  if (type !== "item.started" && type !== "item.completed") return { activities: [] };
  const item = event.item as Item | undefined;
  if (!item?.id) return { activities: [] };
  const done = type === "item.completed";
  const acts: SdkActivity[] = [];
  const use = (name: string, input: unknown) => {
    if (started.has(item.id)) return;
    started.add(item.id);
    acts.push({ kind: "tool_use", id: item.id, name, input, at: now });
  };
  switch (item.type) {
    case "agent_message":
      return done && typeof item.text === "string" && item.text.trim() ? { activities: [], text: item.text } : { activities: [] };
    case "reasoning":
      return done && typeof item.text === "string" && item.text.trim()
        ? { activities: [{ kind: "thinking", text: item.text, at: now }] }
        : { activities: [] };
    case "command_execution": {
      use("Bash", { command: displayCommand(String(item.command ?? "")) });
      if (done) {
        const exit = typeof item.exit_code === "number" ? item.exit_code : 0;
        const failed = item.status === "failed" || exit !== 0;
        acts.push({ kind: "tool_result", id: item.id, isError: failed, ...(failed ? { reason: lastLine(item.aggregated_output as string) ?? `exit ${exit}` } : {}), at: now });
      }
      return { activities: acts };
    }
    case "file_change": {
      if (!done) return { activities: [] };
      // One patch can touch several files; each gets its own Write/Edit line, as on the Claude path.
      const changes = Array.isArray(item.changes) ? (item.changes as Array<{ path?: unknown; kind?: unknown }>) : [];
      changes.forEach((ch, i) => {
        const id = `${item.id}#${i}`;
        const name = ch.kind === "add" ? "Write" : ch.kind === "delete" ? "Delete" : "Edit";
        acts.push({ kind: "tool_use", id, name, input: { file_path: String(ch.path ?? "") }, at: now });
        acts.push({ kind: "tool_result", id, isError: item.status === "failed", ...(item.status === "failed" ? { reason: "patch failed" } : {}), at: now });
      });
      return { activities: acts };
    }
    case "mcp_tool_call": {
      use(`mcp__${String(item.server ?? CODEX_MCP_SERVER)}__${String(item.tool ?? "")}`, item.arguments ?? {});
      if (done) {
        const err = (item.error as { message?: unknown } | undefined)?.message;
        const failed = item.status === "failed" || typeof err === "string";
        // A tool that answers isError carries its reason in the result text, not in `error`;
        // show that sentence, as the Claude path does, instead of a bare "failed".
        const content = (item.result as { content?: Array<{ type?: string; text?: unknown }> } | undefined)?.content;
        const said = content?.find((b) => b?.type === "text" && typeof b.text === "string")?.text as string | undefined;
        acts.push({ kind: "tool_result", id: item.id, isError: failed, ...(failed ? { reason: String(err ?? lastLine(said, 160) ?? "failed") } : {}), at: now });
      }
      return { activities: acts };
    }
    case "web_search": {
      use("WebSearch", { query: String(item.query ?? "") });
      if (done) acts.push({ kind: "tool_result", id: item.id, isError: false, at: now });
      return { activities: acts };
    }
    default:
      return { activities: [] };
  }
}

/** HTTP status inside a Codex error message ("unexpected status 401 Unauthorized: …"). */
export function codexErrorStatus(message: string): number | undefined {
  const m = /\b(?:status|HTTP)\s*:?\s*(\d{3})\b/i.exec(message);
  if (m) return Number(m[1]);
  // The CLI reports a provider 429 in words ("rate limit exceeded: …").
  return /rate limit|too many requests/i.test(message) ? 429 : undefined;
}
