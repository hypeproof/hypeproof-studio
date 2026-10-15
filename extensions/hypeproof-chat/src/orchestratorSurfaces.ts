// The front-line orchestrator's switch and its one wiring point (ADR 0011; spec §2.3, §5.4,
// §13.2 row A4). Pure over its ports and vscode-free.
//
// The switch is the served roster. The orchestrator is on for a turn only when all hold:
// - the host passed the orchestrator host arguments (A5: the app that declared
//   `x-hps-orchestrator` on /v1/profile);
// - the cohort is an adult one: never a minor, a `minor_cohort` flag or an unknown tier
//   (spec §5.4; REQ-M23 extended), whatever was served;
// - the profile carries a well-formed `orchestrator` roster (agentRoster.ts);
// - A2's orchestratorBindingFor binds it (sdkCoachHelpers.ts), which runSdkCoach checks.
// Otherwise runSdkCoach runs exactly as before A4: nothing below is called, and the
// switch smoke compares the whole turn with digests taken before A4.
//
// `ORCHESTRATOR_SURFACES` is the switch-off inventory: every surface the orchestrator
// adds. test/orchestrator-switch.smoke.mjs walks it with the switch off and on. A surface
// that is not listed is not checked, so listing is not optional.

import type { HookCallbackMatcher, HookEvent } from "@anthropic-ai/claude-agent-sdk";
import { ADULT_ARCHIVE_DIR } from "./adultArchive.ts";
import { consultableAgents, parseServedRoster, type ServedRoster } from "./agentRoster.ts";
import type { McpToolResult, SdkMcpFactory, ZodLike } from "./browserMcp.ts";
import {
  canonicalPath,
  consultMcpTool,
  orchestratorSessionFor,
  readWorkspaceText,
  runConsult,
  type OrchestratorEvent,
  type OrchestratorSession,
} from "./consultTool.ts";
import { buildOrchestratorHooks, checkPage, ORCHESTRATOR_HOOK_MATCHER, OrchestratorStreamObserver } from "./orchestratorHooks.ts";
import {
  CONSULT_HELPER_KIND,
  isMinorTier,
  MCP_CONSULT,
  MCP_ORCHESTRATOR_TOOLS,
  MCP_SITE_CHECK,
  ORCHESTRATOR_HOOK_EVENTS,
  SITE_CHECK_TOOL_NAME,
  type OrchestratorBinding,
  type SdkTurnEnd,
} from "./sdkCoachHelpers.ts";
import { SITE_CHECK_TOOL_DESCRIPTION, siteCheckToolText, type SiteCheckPort } from "./siteCheckRunner.ts";
import type { ResolvedProfile } from "./protocol";

export type { OrchestratorEvent } from "./consultTool.ts";

/** The switch-off inventory: with the switch off, none of these exists. */
export const ORCHESTRATOR_SURFACES = {
  /** MCP tools on the in-process hypeproof server (spec §3.2, §6.1). */
  mcpTools: [...MCP_ORCHESTRATOR_TOOLS] as string[],
  /** SDK hook events (spec §14), each with `hookMatcher`. */
  hookEvents: [...ORCHESTRATOR_HOOK_EVENTS] as string[],
  hookMatcher: ORCHESTRATOR_HOOK_MATCHER,
  /** Lines A2 adds to ANTHROPIC_CUSTOM_HEADERS on every CLI request (spec §4.1). */
  cliHeaders: ["x-hps-orchestrator", "x-hps-agent", "x-hps-roster"],
  /** Env pins A2 adds for the CLI (spec §4.1). */
  cliEnv: ["CLAUDE_CODE_GATEWAY_HINT_HEADERS", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "CLAUDE_CODE_DISABLE_BACKGROUND_TASKS"],
  /** Service routes the app calls (spec §4.4). */
  serviceRoutes: ["POST /v1/agents/:agent/run"],
  /** Headers on that route (spec §4.1). */
  agentRunHeaders: ["x-hps-orchestrator", "x-hps-roster", "x-hps-agent-call"],
  /** Approval kinds (spec §5.1). */
  approvalKinds: [CONSULT_HELPER_KIND],
  /** Host events for the timeline (spec §5.2, §14): consult, the three checks, the busy notice. */
  events: ["consult", "check:site_check", "check:diff", "check:archive", "notice"],
  /** What the learner's workspace gains (spec §6.3). */
  workspacePaths: [ADULT_ARCHIVE_DIR],
  /** SDK options a served roster removes (ADR 0011 §2: no SDK subagents for roster agents). */
  removedOptions: ["agents"],
};

/**
 * What the host gives runSdkCoach for the orchestrator (A5 builds it). Everything is
 * optional except its presence: passing it is the app saying it runs the orchestrator.
 */
export interface OrchestratorHostArgs {
  /** State across turns (caps per session, last checks, failures). Default: this seat's (orchestratorSessionFor). */
  session?: OrchestratorSession;
  /** fetch for POST /v1/agents/:agent/run. Default: globalThis.fetch. */
  fetch?: typeof fetch;
  /** One timeline line per consult and per check, and the busy notice. A5 posts them as toolLog. */
  onEvent?: (event: OrchestratorEvent) => void;
  /** The learner's own goal for this step (studentGoal.ts), read when a consult declares learner_goal. */
  learnerGoal?: () => string | null | undefined;
  /** Test seams. */
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  newId?: () => string;
  siteCheckBudgetMs?: number;
  busyWaitMs?: number;
  busyRetryDelaysMs?: readonly number[];
  httpTimeoutMs?: number;
}

export type OrchestratorResolution = { on: true; roster: ServedRoster } | { on: false; reason: string };

/**
 * Is the orchestrator on for this seat, and with which roster? Fails closed. The reason
 * is for the developer log ("absent" is the normal case and is not worth a line).
 */
export function resolveOrchestrator(
  profile: ResolvedProfile | null | undefined,
  host: OrchestratorHostArgs | null | undefined,
): OrchestratorResolution {
  if (!host) return { on: false, reason: "no host" };
  if (!profile) return { on: false, reason: "no profile" };
  // MINOR-SAFETY INVARIANT (spec §5.4): a minor or unknown tier never gets the roster.
  if (isMinorTier(profile) || profile.minor_cohort === true) return { on: false, reason: "minor or unknown tier" };
  const parsed = parseServedRoster((profile as { orchestrator?: unknown }).orchestrator);
  return parsed.ok ? { on: true, roster: parsed.roster } : { on: false, reason: parsed.reason };
}

export interface OrchestratorTurnArgs {
  roster: ServedRoster;
  /** A2's binding for this seat (profileToAgentOptions → `orchestrator`): what is granted. */
  binding: OrchestratorBinding;
  profile: ResolvedProfile;
  host: OrchestratorHostArgs;
  /** coachSeatKeyFor(…). */
  seatKey: string;
  turnId?: string;
  gateway: { url: string; token: string; lessonBinding?: string; fundingSource?: string };
  workspaceRoot?: string;
  lessonStep?: string;
  /** The host's browser capabilities; the site check uses livePreviewUrl and viewportPage. */
  sitePort?: SiteCheckPort | null;
  signal?: AbortSignal;
  canonicalize?: (p: string) => string;
}

/** One turn of an orchestrator seat: its tools, hooks, notice, stream tap and end. */
export interface OrchestratorTurn {
  readonly roster: ServedRoster;
  readonly session: OrchestratorSession;
  /** The orchestrator tools of `granted` (full names), as built by `factory`; `names` are what registered. */
  mcpTools(factory: SdkMcpFactory, z: ZodLike, granted: readonly string[]): { tools: unknown[]; names: string[] };
  readonly hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> | undefined;
  /** A2's busy notice (sdkBusyPolicyFor), as a timeline notice. */
  notice(text: string): void;
  /** The SDK stream, read for failure events and otherwise passed through untouched. */
  tap<T>(stream: AsyncIterable<T>): AsyncIterable<T>;
  /** True while a consult or a site check runs: the stream's silence then is not a stall. */
  isWorking(): boolean;
  /** The turn ended (or threw: null). */
  end(result: SdkTurnEnd | null): void;
}

function optionalSchema(schema: unknown): unknown {
  const opt = (schema as { optional?: () => unknown } | null)?.optional;
  return typeof opt === "function" ? opt.call(schema) : schema;
}

/** Start an orchestrator turn. Call only when resolveOrchestrator is on and A2 bound the roster. */
export function startOrchestratorTurn(args: OrchestratorTurnArgs): OrchestratorTurn {
  const host = args.host;
  const now = host.now ?? (() => Date.now());
  const session = host.session ?? orchestratorSessionFor(args.seatKey);
  // Without a turn id every call is a new turn (per-turn caps and failures start over).
  session.beginTurn(args.turnId ?? "");
  const canonicalize = args.canonicalize ?? canonicalPath;
  const emit = (event: OrchestratorEvent) => {
    try {
      host.onEvent?.(event);
    } catch {
      /* the host's timeline must not break a tool */
    }
  };
  let working = 0;
  const track = <T>(work: Promise<T>): Promise<T> => {
    working += 1;
    return work.finally(() => {
      working -= 1;
    });
  };
  let seq = 0;
  const newId = host.newId ?? (() => `${now()}-${++seq}`);
  const fetchImpl: typeof fetch = host.fetch ?? ((input, init) => globalThis.fetch(input, init));

  const consult = (input: Record<string, unknown>): Promise<McpToolResult> =>
    track(
      runConsult(
        {
          roster: args.roster,
          profile: args.profile,
          session,
          seatKey: args.seatKey,
          gateway: { ...args.gateway, ...(args.turnId ? { turnId: args.turnId } : {}) },
          workspaceRoot: args.workspaceRoot,
          lessonStep: args.lessonStep,
          learnerGoal: host.learnerGoal,
          fetch: fetchImpl,
          emit,
          signal: args.signal,
          now,
          canonicalize,
          readText: readWorkspaceText,
          ...(host.sleep ? { sleep: host.sleep } : {}),
          ...(host.newId ? { newId: host.newId } : {}),
          ...(host.busyWaitMs !== undefined ? { busyWaitMs: host.busyWaitMs } : {}),
          ...(host.busyRetryDelaysMs ? { busyRetryDelaysMs: host.busyRetryDelaysMs } : {}),
          ...(host.httpTimeoutMs !== undefined ? { httpTimeoutMs: host.httpTimeoutMs } : {}),
        },
        input,
      ),
    );

  const checkDeps = {
    session,
    sitePort: args.sitePort ?? null,
    emit,
    now,
    newId,
    ...(host.siteCheckBudgetMs !== undefined ? { siteCheckBudgetMs: host.siteCheckBudgetMs } : {}),
  };
  const siteCheck = async (input: Record<string, unknown>): Promise<McpToolResult> => {
    const rel = typeof input.path === "string" && input.path.trim() ? input.path.trim().replace(/^\.\//, "") : "index.html";
    const result = await track(checkPage(checkDeps, rel, args.signal));
    // A fail or an unverified page is an answer, not a tool error.
    return { content: [{ type: "text", text: siteCheckToolText(result) }] };
  };

  const hooks = buildOrchestratorHooks({
    roster: args.roster,
    session,
    profile: args.profile,
    workspaceRoot: args.workspaceRoot,
    sitePort: args.sitePort ?? null,
    emit,
    now,
    newId,
    canonicalize,
    track,
    ...(host.siteCheckBudgetMs !== undefined ? { siteCheckBudgetMs: host.siteCheckBudgetMs } : {}),
  });
  const observer = new OrchestratorStreamObserver({ session, workspaceRoot: args.workspaceRoot, canonicalize });

  return {
    roster: args.roster,
    session,
    hooks,
    mcpTools(factory, z, granted) {
      const tools: unknown[] = [];
      const names: string[] = [];
      if (args.binding.consult && granted.includes(MCP_CONSULT)) {
        const tool = consultMcpTool(factory, z, args.roster, consultableAgents(args.roster), consult);
        if (tool) {
          tools.push(tool);
          names.push(MCP_CONSULT);
        }
      }
      if (args.binding.siteCheck && granted.includes(MCP_SITE_CHECK)) {
        tools.push(factory.tool(SITE_CHECK_TOOL_NAME, SITE_CHECK_TOOL_DESCRIPTION, { path: optionalSchema(z.string()) }, siteCheck));
        names.push(MCP_SITE_CHECK);
      }
      return { tools, names };
    },
    notice(text) {
      emit({ kind: "notice", id: `notice:${newId()}`, text, at: now() });
    },
    tap<T>(stream: AsyncIterable<T>): AsyncIterable<T> {
      return {
        [Symbol.asyncIterator]() {
          const it = stream[Symbol.asyncIterator]();
          const wrapped: AsyncIterator<T> = {
            async next(...a: [] | [unknown]) {
              const r = await it.next(...(a as []));
              if (!r.done) observer.observe(r.value);
              return r;
            },
          };
          // return/throw go straight to the CLI's iterator, so closing the stream is unchanged.
          if (typeof it.return === "function") wrapped.return = (v?: unknown) => it.return!(v as never);
          if (typeof it.throw === "function") wrapped.throw = (e?: unknown) => it.throw!(e);
          return wrapped;
        },
      };
    },
    isWorking: () => working > 0,
    end(result) {
      if (result) session.noteTurnEnd(result.failed ? result.subtype : undefined);
    },
  };
}
