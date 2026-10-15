// The orchestrator seat's SDK hooks (spec §6.1–§6.3, §14) and the stream observer that
// records failure events (§7). Pure over their ports and vscode-free.
//
// The hooks report; they never decide. They return `additionalContext` and nothing else:
// no permissionDecision, no `decision`, no rewritten input or output. (A2's
// guardOrchestratorHooks strips anything granting on top of that.) canUseTool and
// evaluateSdkToolUse stay the only gate for every call.
//
// PreToolUse (Write|Edit|MultiEdit of an existing workspace file):
// - keeps the file as it is, for the diff guard;
// - for a coach Write that replaces an existing .html on an adult seat, archives it first
//   to .hypeproof/history (A3 adultArchive.ts), one timeline line.
// PostToolUse (the same tools, after a successful call):
// - the diff guard's summary of what the save changed (A3 diffGuard.ts);
// - for a workspace .html, one site check at 390 and 1280 (A3 siteCheck.ts over
//   siteCheckRunner.ts), one timeline line. It adds zero model requests: the result rides
//   on the write's own tool result;
// - both in one `additionalContext` of at most 400 characters (HOOK_CONTEXT_MAX).
// A hook that fails inside returns no context rather than throwing: a throw would block a
// call that already happened (PostToolUse) or one the learner may approve (PreToolUse).
//
// The stream observer reads the SDK messages of the turn, never changing them, and records
// F3 (Edit or MultiEdit failing twice on one file), F4 (an HTML-writing request cut at
// max_tokens) and the end of the turn (F5 on the next one).

import * as path from "node:path";
import type { HookCallback, HookCallbackMatcher, HookEvent, HookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { archiveBeforeOverwrite, type AdultArchiveOutcome, type AdultArchiveRequest } from "./adultArchive.ts";
import type { ServedRoster } from "./agentRoster.ts";
import { canonicalPath, readWorkspaceText, type OrchestratorEvent, type OrchestratorSession } from "./consultTool.ts";
import { diffGuard } from "./diffGuard.ts";
import { validateAndRepairHtml } from "./htmlStructure.ts";
import { isPathContained } from "./sdkCoachHelpers.ts";
import { siteCheckSummary, siteCheckTarget, siteCheckTimelineLabel, type SiteCheckResult } from "./siteCheck.ts";
import { runSiteCheck, type SiteCheckPort } from "./siteCheckRunner.ts";
import type { ResolvedProfile } from "./protocol";

/** The tools whose calls the hooks look at (spec §14). */
export const ORCHESTRATOR_HOOK_MATCHER = "Write|Edit|MultiEdit";
/** The PostToolUse `additionalContext` limit (spec §6.1), in UTF-16 units as A3 counts it. */
export const HOOK_CONTEXT_MAX = 400;
/**
 * Seconds the CLI gives each hook (HookCallbackMatcher.timeout). Explicit, so a shorter
 * CLI default can never cut the site check (5 s budget plus CDP slack) into a silent nothing.
 */
export const ORCHESTRATOR_HOOK_TIMEOUT_S = 30;

const WRITE_TOOL_NAMES = new Set(["Write", "Edit", "MultiEdit"]);
const EDIT_TOOL_NAMES = new Set(["Edit", "MultiEdit"]);
/** Largest file kept for the diff guard; diffGuard estimates beyond its exact range. */
const SNAPSHOT_MAX_BYTES = 2 * 1024 * 1024;
/** Calls a PreToolUse saw but PostToolUse never did (denied, failed): kept this many at most. */
const SNAPSHOTS_MAX = 16;

const isHtml = (rel: string) => /\.html?$/i.test(rel);

/**
 * The workspace-relative (posix) path of a tool's `file_path`, or null when it is not a
 * file inside the workspace. Both sides are canonicalized first, as evaluateSdkToolUse
 * does, so a symlinked workspace (/var → /private/var) still matches.
 */
export function workspaceRelative(
  workspaceRoot: string | undefined,
  filePath: unknown,
  canonicalize: (p: string) => string = canonicalPath,
): { abs: string; rel: string } | null {
  if (!workspaceRoot || typeof filePath !== "string" || !filePath.trim() || filePath.includes("\0")) return null;
  const abs = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(workspaceRoot, filePath);
  const root = canonicalize(workspaceRoot);
  const target = canonicalize(abs);
  if (!isPathContained(root, target)) return null;
  const rel = path.relative(root, target).split(path.sep).join("/");
  return rel ? { abs: target, rel } : null;
}

/** At most `max` UTF-16 units, cut at a separator where possible and marked with "…". */
function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return "";
  let head = text.slice(0, max - 1);
  if (/[\uD800-\uDBFF]$/.test(head)) head = head.slice(0, -1);
  const cut = Math.max(head.lastIndexOf(" · "), head.lastIndexOf(". "), head.lastIndexOf(", "));
  return (cut > max / 2 ? head.slice(0, cut) : head) + "…";
}

/** One part of the hook context; `tail` (an archive path) survives a cut when it fits. */
export interface HookContextPart {
  text: string;
  tail?: string;
}

/**
 * The parts joined by newlines in at most `max` units. When they do not fit, each gets a
 * fair share (the shorter ones first, their unused share to the rest) and is cut at a
 * separator, keeping its tail. Never longer than `max`.
 */
export function fitHookContext(parts: readonly HookContextPart[], max: number = HOOK_CONTEXT_MAX): string {
  const live = parts.filter((p) => p.text);
  if (live.length === 0) return "";
  const joined = live.map((p) => p.text).join("\n");
  if (joined.length <= max) return joined;
  const room = max - (live.length - 1);
  const order = live.map((p, i) => ({ p, i })).sort((a, b) => a.p.text.length - b.p.text.length);
  const share = new Array<number>(live.length).fill(0);
  let remaining = Math.max(0, room);
  order.forEach(({ p, i }, k) => {
    share[i] = Math.min(p.text.length, Math.floor(remaining / (order.length - k)));
    remaining -= share[i];
  });
  const cut = live
    .map((p, i) => {
      const n = share[i];
      if (p.text.length <= n) return p.text;
      const tail = p.tail && p.text.endsWith(p.tail) && p.tail.length <= n / 2 ? p.tail : "";
      return clampText(p.text.slice(0, p.text.length - tail.length), n - tail.length) + tail;
    })
    .filter(Boolean)
    .join("\n");
  return cut.length <= max ? cut : clampText(cut, max);
}

export interface OrchestratorHookDeps {
  roster: Pick<ServedRoster, "checks">;
  session: OrchestratorSession;
  /** The served profile: the archive applies to adult seats only (adultArchiveApplies). */
  profile: ResolvedProfile;
  workspaceRoot?: string;
  sitePort?: SiteCheckPort | null;
  emit?: (event: OrchestratorEvent) => void;
  now?: () => number;
  newId?: () => string;
  canonicalize?: (p: string) => string;
  readText?: (absPath: string, maxBytes: number) => string | null;
  /** Test seam; archiveBeforeOverwrite by default. */
  archive?: (req: AdultArchiveRequest) => AdultArchiveOutcome;
  siteCheckBudgetMs?: number;
  /** Marks host work in progress (the stall watchdog reads it). */
  track?: <T>(work: Promise<T>) => Promise<T>;
}

interface Snapshot {
  rel: string;
  tool: string;
  before: string | null;
  archivedPath: string | null;
}

/** Run one site check of `rel` and record it: the shared path of the hook and the on-demand tool. */
export async function checkPage(
  deps: Pick<OrchestratorHookDeps, "session" | "sitePort" | "emit" | "now" | "newId" | "siteCheckBudgetMs">,
  rel: string,
  signal?: AbortSignal,
): Promise<SiteCheckResult> {
  const result = await runSiteCheck(deps.sitePort, {
    path: rel,
    ...(signal ? { signal } : {}),
    ...(deps.siteCheckBudgetMs !== undefined ? { budgetMs: deps.siteCheckBudgetMs } : {}),
    ...(deps.now ? { now: deps.now } : {}),
  });
  deps.session.recordSiteCheck(rel, result);
  const label = siteCheckTimelineLabel(result);
  emitSafely(deps.emit, {
    kind: "check",
    id: `check:${deps.newId?.() ?? `${rel}:${result.measured_at}`}`,
    name: "site_check",
    verdict: result.verdict,
    summary: label,
    path: rel,
    state: "done",
    icon: "📏",
    label,
    at: (deps.now ?? Date.now)(),
  });
  return result;
}

function emitSafely(emit: ((e: OrchestratorEvent) => void) | undefined, event: OrchestratorEvent): void {
  try {
    emit?.(event);
  } catch {
    /* the timeline is the host's; its failure must not change a tool result */
  }
}

/**
 * The `hooks` option of an orchestrator seat, or undefined when the roster lists none of
 * the three checks. Hand it to buildSdkQueryOptions, which passes it through
 * guardOrchestratorHooks.
 */
export function buildOrchestratorHooks(deps: OrchestratorHookDeps): Partial<Record<HookEvent, HookCallbackMatcher[]>> | undefined {
  const checks = new Set(deps.roster.checks);
  const diffOn = checks.has("diff_guard");
  const siteOn = checks.has("site_check");
  const archiveOn = checks.has("archive_before_overwrite");
  if (!diffOn && !siteOn && !archiveOn) return undefined;

  const now = deps.now ?? (() => Date.now());
  const canonicalize = deps.canonicalize ?? canonicalPath;
  const readText = deps.readText ?? readWorkspaceText;
  const archive = deps.archive ?? archiveBeforeOverwrite;
  const track = deps.track ?? (<T>(work: Promise<T>) => work);
  const snapshots = new Map<string, Snapshot>();
  let seq = 0;
  const id = (prefix: string) => `${prefix}:${deps.newId?.() ?? `${now()}-${++seq}`}`;

  const pre: HookCallback = async (input, toolUseID) => {
    try {
      const h = input as { hook_event_name?: unknown; tool_name?: unknown; tool_input?: unknown; tool_use_id?: unknown };
      if (h.hook_event_name !== "PreToolUse" || typeof h.tool_name !== "string" || !WRITE_TOOL_NAMES.has(h.tool_name)) return {};
      const ti = (h.tool_input ?? {}) as { file_path?: unknown; content?: unknown };
      const target = workspaceRelative(deps.workspaceRoot, ti.file_path, canonicalize);
      if (!target) return {}; // outside the workspace: the permission gate refuses it
      const before = readText(target.abs, SNAPSHOT_MAX_BYTES);
      let archivedPath: string | null = null;
      if (archiveOn && h.tool_name === "Write" && before !== null && isHtml(target.rel)) {
        const outcome = archive({
          seat: { profile: deps.profile, orchestrator: true },
          workspaceRoot: canonicalize(deps.workspaceRoot!),
          file: target.abs,
          nextContent: typeof ti.content === "string" ? ti.content : null,
          now: new Date(now()),
        });
        if (outcome.archived && outcome.path) {
          archivedPath = outcome.path;
          const label = outcome.timeline ?? `🗂 이전 버전 보관 — ${outcome.path}`;
          emitSafely(deps.emit, { kind: "check", id: id("archive"), name: "archive", verdict: "archived", summary: label, path: target.rel, state: "done", icon: "🗂", label, at: now() });
        } else if (outcome.reason === "already_archived" && outcome.path) {
          archivedPath = outcome.path;
        }
      }
      const key = String(toolUseID ?? h.tool_use_id ?? "");
      if (key) {
        snapshots.set(key, { rel: target.rel, tool: h.tool_name, before, archivedPath });
        while (snapshots.size > SNAPSHOTS_MAX) snapshots.delete(snapshots.keys().next().value as string);
      }
      return {};
    } catch {
      return {};
    }
  };

  const post: HookCallback = async (input, toolUseID, options) => {
    try {
      const h = input as { hook_event_name?: unknown; tool_name?: unknown; tool_input?: unknown; tool_use_id?: unknown };
      if (h.hook_event_name !== "PostToolUse" || typeof h.tool_name !== "string" || !WRITE_TOOL_NAMES.has(h.tool_name)) return {};
      const key = String(toolUseID ?? h.tool_use_id ?? "");
      const snap = key ? snapshots.get(key) : undefined;
      if (key) snapshots.delete(key);
      const ti = (h.tool_input ?? {}) as { file_path?: unknown };
      const target = workspaceRelative(deps.workspaceRoot, ti.file_path, canonicalize);
      if (!target) return {};
      deps.session.recordEdit(target.rel);
      const html = isHtml(target.rel);
      const after = (diffOn && snap?.before != null) || html ? readText(target.abs, SNAPSHOT_MAX_BYTES) : null;

      const parts: HookContextPart[] = [];
      if (diffOn && snap && snap.before !== null && after !== null) {
        const r = diffGuard({ path: target.rel, before: snap.before, after, tool: h.tool_name, archivedPath: snap.archivedPath });
        deps.session.recordDiff(r);
        const label = `✏️ 저장 비교 — ${target.rel}: ${r.verdict === "rewrite" ? `기존 내용의 ${Math.round(r.changed_ratio * 100)}% 바뀜` : r.verdict === "inside" ? "정보블록 안만 바뀜" : r.verdict === "unchanged" ? "변화 없음" : "일부 바뀜"}`;
        emitSafely(deps.emit, { kind: "check", id: id("diff"), name: "diff", verdict: r.verdict, summary: label, path: target.rel, state: "done", icon: "✏️", label, at: now() });
        parts.push({ text: r.summary, ...(snap.archivedPath ? { tail: ` 이전 버전: ${snap.archivedPath}` } : {}) });
      } else if (snap?.archivedPath) {
        parts.push({ text: `저장 전 내용을 보관했습니다: ${snap.archivedPath}`, tail: snap.archivedPath });
      }
      // F2 counts structure-guard blocks of HTML saves (validateAndRepairHtml, #359).
      if (html && after !== null && validateAndRepairHtml(after).blocked) deps.session.recordStructureBlock(target.rel);
      if (siteOn && siteCheckTarget(target.rel)) {
        const result = await track(checkPage({ ...deps, now }, target.rel, options?.signal));
        parts.push({ text: siteCheckSummary(result) });
      }
      const context = fitHookContext(parts, HOOK_CONTEXT_MAX);
      if (!context) return {};
      const out: HookJSONOutput = { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: context } };
      return out;
    } catch {
      return {};
    }
  };

  const hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {};
  if (diffOn || archiveOn) hooks.PreToolUse = [{ matcher: ORCHESTRATOR_HOOK_MATCHER, hooks: [pre], timeout: ORCHESTRATOR_HOOK_TIMEOUT_S }];
  hooks.PostToolUse = [{ matcher: ORCHESTRATOR_HOOK_MATCHER, hooks: [post], timeout: ORCHESTRATOR_HOOK_TIMEOUT_S }];
  return hooks;
}

/**
 * Reads the turn's SDK messages for failure events (spec §7), without changing them:
 * F3 when an Edit or MultiEdit of one file fails twice this turn, F4 when a request that
 * was writing HTML stopped at max_tokens, and the turn's ending for F5.
 *
 * F4 is read from two places, because which one the CLI fills is not documented for
 * SDK sessions (inference, not observed): the stop_reason of the assistant message that
 * carried the HTML write, and the result's stop_reason in a turn that wrote HTML.
 */
export class OrchestratorStreamObserver {
  private readonly session: OrchestratorSession;
  private readonly workspaceRoot?: string;
  private readonly canonicalize: (p: string) => string;
  private readonly toolUses = new Map<string, { name: string; rel: string | null }>();
  private readonly htmlWriteMessages = new Set<string>();
  private sawHtmlWrite = false;

  constructor(opts: { session: OrchestratorSession; workspaceRoot?: string; canonicalize?: (p: string) => string }) {
    this.session = opts.session;
    this.workspaceRoot = opts.workspaceRoot;
    this.canonicalize = opts.canonicalize ?? canonicalPath;
  }

  observe(msg: unknown): void {
    try {
      this.read(msg);
    } catch {
      /* an odd message is not a failure event */
    }
  }

  private read(raw: unknown): void {
    if (!raw || typeof raw !== "object") return;
    const msg = raw as Record<string, unknown>;
    const type = msg.type;
    if (type === "result") {
      this.session.noteTurnEnd(typeof msg.subtype === "string" ? msg.subtype : undefined);
      if (msg.stop_reason === "max_tokens" && this.sawHtmlWrite) {
        this.session.recordTruncatedHtmlWrite("HTML 을 쓰던 턴이 길이 제한(max_tokens)에서 끝났어요.");
      }
      return;
    }
    if (type !== "assistant" && type !== "user") return;
    const message = (msg.message ?? {}) as { id?: unknown; content?: unknown; stop_reason?: unknown };
    const content = Array.isArray(message.content) ? message.content : [];
    if (type === "assistant") {
      const messageId = typeof message.id === "string" ? message.id : null;
      for (const b of content) {
        const block = (b ?? {}) as { type?: unknown; id?: unknown; name?: unknown; input?: unknown };
        if (block.type !== "tool_use" || typeof block.id !== "string" || typeof block.name !== "string") continue;
        if (!WRITE_TOOL_NAMES.has(block.name)) continue;
        const rel = workspaceRelative(this.workspaceRoot, (block.input as { file_path?: unknown } | undefined)?.file_path, this.canonicalize)?.rel ?? null;
        this.toolUses.set(block.id, { name: block.name, rel });
        if (rel && isHtml(rel)) {
          this.sawHtmlWrite = true;
          if (messageId) this.htmlWriteMessages.add(messageId);
        }
      }
      if (message.stop_reason === "max_tokens" && messageId && this.htmlWriteMessages.has(messageId)) {
        this.session.recordTruncatedHtmlWrite("HTML 을 쓰던 요청이 길이 제한(max_tokens)에서 끊겼어요.");
      }
      return;
    }
    for (const b of content) {
      const block = (b ?? {}) as { type?: unknown; tool_use_id?: unknown; is_error?: unknown };
      if (block.type !== "tool_result" || block.is_error !== true || typeof block.tool_use_id !== "string") continue;
      const use = this.toolUses.get(block.tool_use_id);
      if (use && EDIT_TOOL_NAMES.has(use.name) && use.rel) this.session.recordEditError(use.rel);
    }
  }
}
