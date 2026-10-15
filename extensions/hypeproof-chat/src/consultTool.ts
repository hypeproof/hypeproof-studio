// consult: the coach's one way to ask a roster helper (ADR 0011 §2; spec §3.2, §3.3, §4.4,
// §5.2, §7). Pure over its ports and vscode-free.
//
// `mcp__hypeproof__consult({ agent, question ≤400, focus? })` runs on the learner's
// machine, inside the coach's turn. The host, not a model, decides everything around the
// one helper request:
// 1. Refusals, before any request: an unknown or disabled agent, a spent cap (counted
//    here per seat, per turn and per session), and the advisor without a recorded
//    deterministic failure this turn (§7). A minor seat never gets the tool at all; the
//    handler refuses one anyway.
// 2. One helper at a time per seat (`withConsultMutex`), even when the CLI runs two tool
//    calls in parallel (CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY=2). Caps and triggers are
//    checked again inside the mutex, so a parallel pair cannot both pass a cap of one.
// 3. The context is assembled from the agent's declared keys only: contained, scrubbed
//    file excerpts (≤3 files, ≤40 KB), a section outline, this turn's site check, the last
//    diff summary, the recorded failures, the learner's own goal and the lesson step.
//    Never the transcript, other turns' tool output, or a file outside the workspace.
// 4. One `POST /v1/agents/:agent/run` (§4.4) through an injectable fetch. Nothing is
//    retried, except one wait of up to 20 s while the pass seat's one request lease is
//    held (`trial_busy`).
// 5. The answer is the Service's contract-validated `output`, as JSON text of at most
//    2,000 characters, or a typed refusal in Korean. Nothing is written back. An answer
//    too long for that keeps its `must` findings before `should` and `should` before
//    `could`, and says what it left out (A5, `consultSuccessText`).
// 6. One timeline event per consult (running → done | error), and the cap is counted.

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { agentLabel, rosterAgent, rosterKey, type HostContextKey, type ServedAgent, type ServedRoster } from "./agentRoster.ts";
import {
  anthropicBaseUrlFor,
  CONSULT_TOOL_NAME,
  isMinorTier,
  isPathContained,
  ORCHESTRATOR_FORMAT,
} from "./sdkCoachHelpers.ts";
import { scrubSecrets } from "./shellPolicy.ts";
import type { DiffGuardResult } from "./diffGuard.ts";
import type { SiteCheckResult } from "./siteCheck.ts";
import type { McpToolResult, SdkMcpFactory, ZodLike } from "./browserMcp.ts";
import type { ResolvedProfile } from "./protocol";

// ── Limits (spec §3.2, §3.3, §4.4) ──────────────────────────────────────────

export const CONSULT_QUESTION_MIN = 4;
export const CONSULT_QUESTION_MAX = 400;
export const CONSULT_FILES_MAX = 3;
export const CONSULT_ANCHORS_MAX = 5;
const FOCUS_PATH_MAX = 200;
const FOCUS_ANCHOR_MAX = 80;
/** File excerpts in total, in UTF-8 bytes. */
export const CONSULT_EXCERPT_BYTES_MAX = 40 * 1024;
/** The whole request body, in UTF-8 bytes. */
export const CONSULT_BODY_BYTES_MAX = 48 * 1024;
/** Lines kept on each side of an anchor when a file is larger than its share. */
export const ANCHOR_WINDOW_LINES = 40;
/** The tool result, in characters. */
export const CONSULT_RESULT_MAX = 2000;
/** The one wait for a held pass lease. */
export const CONSULT_BUSY_WAIT_MS = 20_000;
/** When to ask again within that wait. Each ask while busy reserves nothing (native-trial-budget). */
export const CONSULT_BUSY_RETRY_DELAYS_MS: readonly number[] = [2000, 4000, 6000, 8000];
/** Client-side ceiling for one agent run; the Service's own upstream timeout is 60 s. */
export const CONSULT_HTTP_TIMEOUT_MS = 75_000;
/** A file larger than this is excerpted from its first bytes only. */
const READ_LIMIT_BYTES = 2 * 1024 * 1024;
/** The page a consult reads when the coach names none. */
export const CONSULT_DEFAULT_PAGE = "index.html";

// ── Events (spec §5.2, §14) ─────────────────────────────────────────────────

/**
 * What the host shows (A5 renders each as one `toolLog` line: `id`, `icon`, `label`,
 * `state`). A consult event repeats its `id` from running to done or error, so the line is
 * updated in place.
 */
export type OrchestratorEvent =
  | {
      kind: "consult";
      id: string;
      agent: string;
      title: string;
      model: string | null;
      state: "running" | "done" | "error";
      summary: string;
      code?: ConsultCode;
      icon: string;
      label: string;
      at: number;
    }
  | {
      kind: "check";
      id: string;
      name: "site_check" | "archive" | "diff";
      verdict: string;
      summary: string;
      path: string;
      state: "done";
      icon: string;
      label: string;
      at: number;
    }
  | { kind: "notice"; id: string; text: string; at: number };

// ── Failure events (spec §7) ────────────────────────────────────────────────

/**
 * F1 site_check fails at a width twice in a row on one file, with a coach edit between;
 * F2 the HTML structure guard blocks twice in one turn; F3 Edit or MultiEdit errors at
 * least twice on one file in one turn; F4 an HTML-writing request ends at max_tokens;
 * F5 the previous turn ended with error_max_turns.
 */
export type FailureId = "F1" | "F2" | "F3" | "F4" | "F5";
export interface FailureEvent {
  id: FailureId;
  detail: string;
  path?: string;
  at: number;
}
const FAILURES_PER_TURN_MAX = 10;

// ── Codes and words ─────────────────────────────────────────────────────────

export type ConsultCode =
  | "agent_unknown"
  | "agent_disabled"
  | "cap_reached"
  | "not_triggered"
  | "context_invalid"
  | "busy"
  | "roster_changed"
  | "agent_model_unavailable"
  | "agent_output_invalid"
  | "upstream"
  | "offline"
  | "trial_exhausted"
  | "orchestrator_off";

/** One line each, for the coach (the tool result goes to the coach only). */
export const CONSULT_MESSAGES: Record<ConsultCode, string> = {
  agent_unknown: "이 수업에 그런 도우미는 없어요. 코치 혼자 이어서 해 주세요.",
  agent_disabled: "이 도우미는 지금 쓸 수 없어요. 코치 혼자 이어서 해 주세요.",
  cap_reached: "이 도우미에게 물을 수 있는 횟수를 다 썼어요. 코치 혼자 이어서 해 주세요.",
  not_triggered: "이 도우미는 확인 도구가 같은 실패를 기록한 턴에만 부를 수 있어요. 코치 혼자 이어서 해 주세요.",
  context_invalid: "도우미에게 보낼 수 없는 요청이에요. 질문과 파일 경로를 확인해 주세요.",
  busy: "지금 다른 요청이 끝나지 않아 도우미에게 묻지 못했어요. 코치 혼자 이어서 해 주세요.",
  roster_changed: "도우미 구성이 바뀌어 이번에는 묻지 못했어요. 다음 메시지부터 새 구성으로 물을 수 있어요.",
  agent_model_unavailable: "이 수업에서는 이 도우미의 모델을 쓸 수 없어요. 다른 모델로 바꾸지 않았어요.",
  agent_output_invalid: "도우미의 답이 약속한 형식이 아니어서 쓰지 않았어요. 코치 혼자 이어서 해 주세요.",
  upstream: "도우미가 답하지 못했어요. 코치 혼자 이어서 해 주세요.",
  offline: "서비스에 연결하지 못해 도우미에게 묻지 못했어요. 코치 혼자 이어서 해 주세요.",
  trial_exhausted: "이용권의 AI 요청 횟수를 모두 썼어요. 만든 파일과 대화는 그대로 남아 있어요.",
  orchestrator_off: "이 수업에서는 도우미를 쓸 수 없어요. 코치 혼자 이어서 해 주세요.",
};

/** The timeline's short reason after the agent label. */
const CONSULT_ERROR_LABELS: Record<ConsultCode, string> = {
  agent_unknown: "없는 도우미",
  agent_disabled: "쓸 수 없는 도우미",
  cap_reached: "횟수를 다 씀",
  not_triggered: "부를 조건이 아님",
  context_invalid: "보낼 수 없는 요청",
  busy: "다른 요청 처리 중",
  roster_changed: "구성이 바뀜",
  agent_model_unavailable: "모델을 쓸 수 없음",
  agent_output_invalid: "형식이 맞지 않는 답",
  upstream: "답을 받지 못함",
  offline: "연결 안 됨",
  trial_exhausted: "요청 횟수를 다 씀",
  orchestrator_off: "쓸 수 없음",
};

export const CONSULT_ICON = "🔎";

// ── The seat's orchestrator state ───────────────────────────────────────────

interface TurnState {
  id: string;
  uses: Map<string, number>;
  failures: FailureEvent[];
  checks: Array<{ path: string; result: SiteCheckResult }>;
  structureBlocks: number;
  editErrors: Map<string, number>;
}

function newTurn(id: string): TurnState {
  return { id, uses: new Map(), failures: [], checks: [], structureBlocks: 0, editErrors: new Map() };
}

/**
 * What one seat's orchestrator remembers between turns: uses per session, the last check
 * of each page (F1 compares two in a row), the last diff summary, and whether the
 * previous turn ran out of turns (F5). Everything else is per turn and reset by
 * `beginTurn`. The host owns its lifetime: one per seat by default
 * (`orchestratorSessionFor`), reset when the conversation is cleared.
 */
export class OrchestratorSession {
  private turn: TurnState = newTurn("");
  private readonly sessionUses = new Map<string, number>();
  private readonly lastCheck = new Map<string, SiteCheckResult>();
  private readonly editsSinceCheck = new Map<string, number>();
  private lastDiffResult: DiffGuardResult | null = null;
  private endedWithMaxTurns = false;
  private readonly now: () => number;

  constructor(opts: { now?: () => number } = {}) {
    this.now = opts.now ?? (() => Date.now());
  }

  /** Start a coach turn. The same id twice keeps the turn's state. */
  beginTurn(turnId: string): void {
    if (turnId && turnId === this.turn.id) return;
    this.turn = newTurn(turnId || randomUUID());
    if (this.endedWithMaxTurns) {
      this.endedWithMaxTurns = false;
      this.recordFailure({ id: "F5", detail: "지난 턴이 작업량 한도(error_max_turns)로 끝났어요." });
    }
  }

  get turnId(): string {
    return this.turn.id;
  }

  /** How the turn ended, as the SDK said it (only error_max_turns is kept, for F5). */
  noteTurnEnd(subtype: string | undefined): void {
    this.endedWithMaxTurns = subtype === "error_max_turns";
  }

  usage(agent: string): { turn: number; session: number } {
    return { turn: this.turn.uses.get(agent) ?? 0, session: this.sessionUses.get(agent) ?? 0 };
  }

  recordUse(agent: string): void {
    this.turn.uses.set(agent, (this.turn.uses.get(agent) ?? 0) + 1);
    this.sessionUses.set(agent, (this.sessionUses.get(agent) ?? 0) + 1);
  }

  /** The Service said the cap is spent: refuse locally from now on, without asking again. */
  exhaust(agent: string, caps: { per_turn: number; per_session: number }): void {
    this.turn.uses.set(agent, Math.max(this.turn.uses.get(agent) ?? 0, caps.per_turn));
    this.sessionUses.set(agent, Math.max(this.sessionUses.get(agent) ?? 0, caps.per_session));
  }

  /** Record one failure event this turn; the same id on the same path is kept once. */
  recordFailure(event: Omit<FailureEvent, "at"> & { at?: number }): FailureEvent | null {
    if (this.turn.failures.some((f) => f.id === event.id && f.path === event.path)) return null;
    if (this.turn.failures.length >= FAILURES_PER_TURN_MAX) return null;
    const stored: FailureEvent = {
      id: event.id,
      detail: event.detail.slice(0, 200),
      ...(event.path ? { path: event.path } : {}),
      at: event.at ?? this.now(),
    };
    this.turn.failures.push(stored);
    return stored;
  }

  failuresThisTurn(): readonly FailureEvent[] {
    return this.turn.failures;
  }

  /** A coach save of `path` (F1 needs an edit between two checks). */
  recordEdit(relPath: string): void {
    this.editsSinceCheck.set(relPath, (this.editsSinceCheck.get(relPath) ?? 0) + 1);
  }

  /**
   * A site check of `path`. Returns the F1 event when the same width failed on the
   * previous check of this page and the coach saved the page in between.
   */
  recordSiteCheck(relPath: string, result: SiteCheckResult): FailureEvent | null {
    this.turn.checks.push({ path: relPath, result });
    if (this.turn.checks.length > 20) this.turn.checks.shift();
    const previous = this.lastCheck.get(relPath);
    const edits = this.editsSinceCheck.get(relPath) ?? 0;
    this.lastCheck.set(relPath, result);
    this.editsSinceCheck.set(relPath, 0);
    if (!previous || edits === 0 || previous.verdict !== "fail" || result.verdict !== "fail") return null;
    const failingWidths = (r: SiteCheckResult) =>
      new Set(r.fail_reasons.filter((x) => /^(overflow|clipped)@\d+$/.test(x)).map((x) => x.split("@")[1]));
    const before = failingWidths(previous);
    const repeated = [...failingWidths(result)].filter((w) => before.has(w));
    if (repeated.length === 0) return null;
    return this.recordFailure({
      id: "F1",
      path: relPath,
      detail: `${relPath}: 고친 뒤에도 ${repeated.map((w) => `${w}px`).join("·")}에서 다시 넘침`,
    });
  }

  /** This turn's latest check of `path`, or of any page when `path` is omitted. */
  latestCheck(relPath?: string): SiteCheckResult | null {
    for (let i = this.turn.checks.length - 1; i >= 0; i--) {
      const c = this.turn.checks[i];
      if (!relPath || c.path === relPath) return c.result;
    }
    return null;
  }

  recordDiff(result: DiffGuardResult): void {
    this.lastDiffResult = result;
  }

  lastDiff(): DiffGuardResult | null {
    return this.lastDiffResult;
  }

  /** The structure guard blocked a save (F2 at the second in one turn). */
  recordStructureBlock(relPath: string): FailureEvent | null {
    this.turn.structureBlocks += 1;
    return this.turn.structureBlocks >= 2
      ? this.recordFailure({ id: "F2", detail: `HTML 구조 검사가 이번 턴에 ${this.turn.structureBlocks}번 막았어요 (${relPath}).` })
      : null;
  }

  /** An Edit or MultiEdit of `path` failed (F3 at the second on one file in one turn). */
  recordEditError(relPath: string): FailureEvent | null {
    const n = (this.turn.editErrors.get(relPath) ?? 0) + 1;
    this.turn.editErrors.set(relPath, n);
    return n >= 2 ? this.recordFailure({ id: "F3", path: relPath, detail: `${relPath}: 이번 턴에 수정이 ${n}번 실패했어요.` }) : null;
  }

  /** An HTML-writing request stopped at max_tokens (F4). */
  recordTruncatedHtmlWrite(detail: string): FailureEvent | null {
    return this.recordFailure({ id: "F4", detail });
  }
}

const sessions = new Map<string, OrchestratorSession>();

/** The seat's session (created on first use). The seat key is coachSeatKeyFor's. */
export function orchestratorSessionFor(seatKey: string): OrchestratorSession {
  let s = sessions.get(seatKey);
  if (!s) {
    s = new OrchestratorSession();
    sessions.set(seatKey, s);
  }
  return s;
}

/** Forget a seat's session: the host calls this when the learner clears the conversation. */
export function resetOrchestratorSession(seatKey: string): void {
  sessions.delete(seatKey);
}

// ── One helper at a time per seat ───────────────────────────────────────────

const consultQueues = new Map<string, Promise<void>>();

/**
 * Run `fn` when every earlier consult of this seat has finished, in call order. A
 * failing `fn` does not block the next one.
 */
export async function withConsultMutex<T>(seatKey: string, fn: () => Promise<T>): Promise<T> {
  const previous = consultQueues.get(seatKey) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => (release = resolve));
  const tail = previous.then(() => mine);
  consultQueues.set(seatKey, tail);
  try {
    await previous;
    return await fn();
  } finally {
    release();
    if (consultQueues.get(seatKey) === tail) consultQueues.delete(seatKey);
  }
}

// ── Input ───────────────────────────────────────────────────────────────────

export interface ConsultInput {
  agent: string;
  question: string;
  focus?: { files?: string[]; anchors?: string[] };
}

/** Re-check the tool input the SDK validated with the zod schema (a fake or a direct call never was). */
export function readConsultInput(raw: unknown): { ok: true; input: ConsultInput } | { ok: false; message: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, message: "agent 와 question 을 주세요." };
  const r = raw as Record<string, unknown>;
  const agent = typeof r.agent === "string" ? r.agent.trim() : "";
  if (!agent) return { ok: false, message: "agent 에 도우미 이름을 적어 주세요." };
  const question = typeof r.question === "string" ? r.question.trim() : "";
  if (question.length < CONSULT_QUESTION_MIN || question.length > CONSULT_QUESTION_MAX) {
    return { ok: false, message: `question 은 ${CONSULT_QUESTION_MIN}~${CONSULT_QUESTION_MAX}자로 적어 주세요.` };
  }
  const input: ConsultInput = { agent, question };
  if (r.focus !== undefined && r.focus !== null) {
    if (typeof r.focus !== "object" || Array.isArray(r.focus)) return { ok: false, message: "focus 는 { files, anchors } 로 주세요." };
    const f = r.focus as Record<string, unknown>;
    const list = (v: unknown, max: number, each: number, name: string): string[] | string => {
      if (v === undefined || v === null) return [];
      if (!Array.isArray(v) || v.length > max) return `focus.${name} 는 ${max}개까지예요.`;
      const out: string[] = [];
      for (const s of v) {
        if (typeof s !== "string" || !s.trim() || s.length > each) return `focus.${name} 의 값이 올바르지 않아요.`;
        out.push(s.trim());
      }
      return out;
    };
    const files = list(f.files, CONSULT_FILES_MAX, FOCUS_PATH_MAX, "files");
    if (typeof files === "string") return { ok: false, message: files };
    const anchors = list(f.anchors, CONSULT_ANCHORS_MAX, FOCUS_ANCHOR_MAX, "anchors");
    if (typeof anchors === "string") return { ok: false, message: anchors };
    if (files.length || anchors.length) {
      input.focus = { ...(files.length ? { files } : {}), ...(anchors.length ? { anchors } : {}) };
    }
  }
  return { ok: true, input };
}

// ── Context assembly (spec §3.2 step 3) ─────────────────────────────────────

export interface ConsultContextSources {
  /** The workspace root (the SDK cwd). Without one, no file is ever read. */
  workspaceRoot?: string;
  /** realpath-style canonicalizer (symlinks), the coach's own containment twin. */
  canonicalize?: (p: string) => string;
  /** Text of a regular file up to `maxBytes`, or null (missing, not a file, binary). */
  readText?: (absPath: string, maxBytes: number) => string | null;
  session: OrchestratorSession;
  learnerGoal?: string | null;
  lessonStep?: string;
}

export interface FileExcerpt {
  path: string;
  start_line: number;
  text: string;
  truncated?: true;
}

/** Canonicalize through the nearest existing ancestor (a file may not exist yet). */
export function canonicalPath(p: string): string {
  let base = path.resolve(p);
  const tail: string[] = [];
  for (;;) {
    try {
      const real = fs.realpathSync(base);
      return tail.length === 0 ? real : path.join(real, ...tail.reverse());
    } catch {
      const parent = path.dirname(base);
      if (parent === base) return path.resolve(p);
      tail.push(path.basename(base));
      base = parent;
    }
  }
}

/** A regular, non-binary file's UTF-8 text, at most `maxBytes`; null otherwise. */
export function readWorkspaceText(absPath: string, maxBytes: number): string | null {
  let fd: number | undefined;
  try {
    const st = fs.statSync(absPath);
    if (!st.isFile()) return null;
    const size = Math.min(st.size, Math.max(0, maxBytes));
    const buf = Buffer.alloc(size);
    fd = fs.openSync(absPath, "r");
    const read = fs.readSync(fd, buf, 0, size, 0);
    const bytes = buf.subarray(0, read);
    if (bytes.subarray(0, 8192).includes(0)) return null;
    return bytes.toString("utf8");
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* closed already */
      }
    }
  }
}

/**
 * A workspace-relative path the coach named → the file, or why it may not be read. The
 * rule is the coach's own (isPathContained, as in evaluateSdkToolUse), on the path as
 * given and again after symlinks are resolved.
 */
export function resolveWorkspaceFile(
  workspaceRoot: string,
  relPath: string,
  canonicalize: (p: string) => string = canonicalPath,
): { ok: true; abs: string; rel: string } | { ok: false; why: string } {
  const p = String(relPath ?? "").trim().replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
  if (!p || p.includes("\0")) return { ok: false, why: "empty" };
  if (p.startsWith("/") || /^[a-z]:/i.test(p) || path.isAbsolute(p)) return { ok: false, why: "absolute" };
  const parts = p.split("/");
  if (parts.some((s) => s === "" || s === "." || s === "..")) return { ok: false, why: "outside" };
  const abs = path.resolve(workspaceRoot, ...parts);
  if (!isPathContained(workspaceRoot, abs)) return { ok: false, why: "outside" };
  if (!isPathContained(canonicalize(workspaceRoot), canonicalize(abs))) return { ok: false, why: "outside" };
  return { ok: true, abs, rel: parts.join("/") };
}

const bytesOf = (s: string) => Buffer.byteLength(s, "utf8");

/** The longest prefix of `s` that fits in `maxBytes`, never cutting a surrogate pair. */
function sliceToBytes(s: string, maxBytes: number): string {
  if (bytesOf(s) <= maxBytes) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (bytesOf(s.slice(0, mid)) <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  let out = s.slice(0, lo);
  if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1);
  return out;
}

function anchorNeedles(anchor: string): string[] {
  const a = anchor.trim();
  if (!a) return [];
  const id = /^#([A-Za-z][\w:.-]*)$/.exec(a)?.[1];
  return id ? [a, `id="${id}"`, `id='${id}'`, `id=${id}`] : [a];
}

/** Long single lines (a page written on one line) are cut around the match instead. */
const LONG_LINE_CHARS = 4000;
const LONG_LINE_WINDOW = 2000;

/**
 * Excerpts of one file within `budget` bytes: the whole file when it fits; otherwise the
 * anchor windows (±40 lines), merged and in file order; otherwise its head.
 */
export function fileExcerpts(rel: string, text: string, anchors: readonly string[], budget: number): FileExcerpt[] {
  const clean = text.replace(/\r\n?/g, "\n");
  if (budget <= 0) return [];
  if (bytesOf(clean) <= budget) return [{ path: rel, start_line: 1, text: clean }];
  const lines = clean.split("\n");
  const windows: Array<{ from: number; to: number; at?: number; offset?: number }> = [];
  for (const anchor of anchors) {
    const needles = anchorNeedles(anchor);
    for (let i = 0; i < lines.length; i++) {
      const hit = needles.map((n) => lines[i].indexOf(n)).find((x) => x >= 0);
      if (hit === undefined) continue;
      windows.push(
        lines[i].length > LONG_LINE_CHARS
          ? { from: i, to: i, at: i, offset: hit }
          : { from: Math.max(0, i - ANCHOR_WINDOW_LINES), to: Math.min(lines.length - 1, i + ANCHOR_WINDOW_LINES) },
      );
    }
  }
  const out: FileExcerpt[] = [];
  let left = budget;
  const push = (startLine: number, body: string) => {
    const fitted = sliceToBytes(body, left);
    if (!fitted) return false;
    out.push({ path: rel, start_line: startLine, text: fitted, truncated: true });
    left -= bytesOf(fitted);
    return left > 0;
  };
  if (windows.length === 0) {
    push(1, clean);
    return out;
  }
  windows.sort((a, b) => a.from - b.from || (a.offset ?? 0) - (b.offset ?? 0));
  const merged: typeof windows = [];
  for (const w of windows) {
    const last = merged[merged.length - 1];
    if (last && w.at === undefined && last.at === undefined && w.from <= last.to + 1) last.to = Math.max(last.to, w.to);
    else if (!(last && w.at !== undefined && last.at === w.at && Math.abs((last.offset ?? 0) - (w.offset ?? 0)) < LONG_LINE_WINDOW)) merged.push({ ...w });
  }
  for (const w of merged) {
    const body =
      w.at !== undefined
        ? lines[w.at].slice(Math.max(0, (w.offset ?? 0) - LONG_LINE_WINDOW), (w.offset ?? 0) + LONG_LINE_WINDOW)
        : lines.slice(w.from, w.to + 1).join("\n");
    if (!push(w.from + 1, body)) break;
  }
  return out;
}

export interface SiteOutline {
  path: string;
  sections: Array<{ tag: string; id?: string; class?: string; line: number; heading?: string }>;
  headings: Array<{ level: number; text: string; line: number }>;
  /** The lines of the 정보블록 markers, when the page has exactly one well-formed block. */
  info_block: { start_line: number; end_line: number } | null;
  truncated?: true;
}

const OUTLINE_ITEMS_MAX = 30;
const SECTION_TAG = /<(section|header|footer|nav|main|article|aside)\b([^>]*)>/gi;
const HEADING_TAG = /<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi;
// The same markers diffGuard.ts reads (homepage harness: homepage-craft.md, homepage-sections.md).
const INFO_START = /<!--\s*정보블록\s*:\s*시작\s*-->/g;
const INFO_END = /<!--\s*정보블록\s*:\s*끝\s*-->/g;

function textOf(html: string): string {
  return scrubSecrets(
    html
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim(),
  ).slice(0, 80);
}

/** A deterministic outline of a page: sections with their first heading, headings, the 정보블록 lines. */
export function siteOutline(html: string, relPath: string): SiteOutline {
  const starts = [0];
  for (let i = 0; i < html.length; i++) if (html[i] === "\n") starts.push(i + 1);
  const lineAt = (offset: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const headings: SiteOutline["headings"] = [];
  const headingAt: Array<{ offset: number; text: string }> = [];
  for (const m of html.matchAll(HEADING_TAG)) {
    const text = textOf(m[2]);
    if (!text) continue;
    headingAt.push({ offset: m.index ?? 0, text });
    if (headings.length < OUTLINE_ITEMS_MAX) headings.push({ level: Number(m[1]), text, line: lineAt(m.index ?? 0) });
  }
  const sectionMatches = [...html.matchAll(SECTION_TAG)];
  const sections: SiteOutline["sections"] = [];
  for (let k = 0; k < sectionMatches.length && sections.length < OUTLINE_ITEMS_MAX; k++) {
    const m = sectionMatches[k];
    const at = m.index ?? 0;
    const next = sectionMatches[k + 1]?.index ?? html.length;
    const attrs = m[2] ?? "";
    const id = /\bid\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1];
    const cls = /\bclass\s*=\s*["']([^"']+)["']|\bclass\s*=\s*([^\s>]+)/i.exec(attrs);
    const heading = headingAt.find((h) => h.offset > at && h.offset < next)?.text;
    sections.push({
      tag: m[1].toLowerCase(),
      ...(id ? { id: scrubSecrets(id).slice(0, 60) } : {}),
      ...(cls ? { class: scrubSecrets((cls[1] ?? cls[2] ?? "").trim().split(/\s+/).slice(0, 2).join(" ")).slice(0, 60) } : {}),
      line: lineAt(at),
      ...(heading ? { heading } : {}),
    });
  }
  const s = [...html.matchAll(INFO_START)];
  const e = [...html.matchAll(INFO_END)];
  const info_block =
    s.length === 1 && e.length === 1 && (e[0].index ?? 0) > (s[0].index ?? 0)
      ? { start_line: lineAt(s[0].index ?? 0), end_line: lineAt(e[0].index ?? 0) }
      : null;
  const truncated = sectionMatches.length > OUTLINE_ITEMS_MAX || headingAt.length > OUTLINE_ITEMS_MAX;
  return { path: relPath, sections, headings, info_block, ...(truncated ? { truncated: true as const } : {}) };
}

function compactDiff(d: DiffGuardResult): Record<string, unknown> {
  return {
    path: d.path,
    ...(d.tool ? { tool: d.tool } : {}),
    verdict: d.verdict,
    changed_ratio: d.changed_ratio,
    changed_lines: d.changed_lines,
    added_lines: d.added_lines,
    inside_info_block: d.inside_info_block,
    touched_sections: d.touched_sections.slice(0, 10),
    outside_sections: d.outside_sections.slice(0, 10),
    ...(d.archived_path ? { archived_path: d.archived_path } : {}),
    summary: d.summary,
  };
}

export type AssembledContext =
  | { ok: true; context: Record<string, unknown>; files: string[] }
  | { ok: false; message: string };

const LESSON_STEP = /^[a-zA-Z0-9_-]{1,64}$/;
const GOAL_MAX = 300;

/**
 * The context of one consult: exactly the agent's declared keys, each filled from what
 * the host has (an empty one is left out). The transcript is not a key, so it can never
 * be attached; a named file outside the workspace refuses the whole consult.
 */
export function assembleConsultContext(
  agent: Pick<ServedAgent, "context">,
  input: ConsultInput,
  src: ConsultContextSources,
  excerptBudget: number = CONSULT_EXCERPT_BYTES_MAX,
): AssembledContext {
  const wants = (k: HostContextKey) => agent.context.includes(k);
  const canonicalize = src.canonicalize ?? canonicalPath;
  const readText = src.readText ?? readWorkspaceText;
  const named = input.focus?.files ?? [];

  // Every named file is checked, whichever keys the agent declared: an out-of-workspace
  // name is refused, never silently dropped.
  const resolved: Array<{ abs: string; rel: string }> = [];
  for (const rel of named) {
    if (!src.workspaceRoot) return { ok: false, message: "작업 폴더가 없어 파일을 보낼 수 없어요." };
    const r = resolveWorkspaceFile(src.workspaceRoot, rel, canonicalize);
    if (!r.ok) return { ok: false, message: `작업 폴더 밖의 파일은 도우미에게 보낼 수 없어요: ${rel.slice(0, 80)}` };
    if (!resolved.some((x) => x.rel === r.rel)) resolved.push({ abs: r.abs, rel: r.rel });
  }
  if (named.length === 0 && src.workspaceRoot) {
    const r = resolveWorkspaceFile(src.workspaceRoot, CONSULT_DEFAULT_PAGE, canonicalize);
    if (r.ok) resolved.push({ abs: r.abs, rel: r.rel });
  }

  const texts = new Map<string, string>();
  const textFor = (f: { abs: string; rel: string }): string | null => {
    if (texts.has(f.rel)) return texts.get(f.rel)!;
    const raw = readText(f.abs, READ_LIMIT_BYTES);
    if (raw === null) return null;
    const clean = scrubSecrets(raw);
    texts.set(f.rel, clean);
    return clean;
  };
  // A named file that cannot be read is refused too: the coach named something wrong.
  for (const f of resolved.slice(0, named.length)) {
    if ((wants("file_excerpt") || wants("site_outline")) && textFor(f) === null) {
      return { ok: false, message: `읽을 수 없는 파일이에요(없거나 텍스트가 아님): ${f.rel}` };
    }
  }

  const context: Record<string, unknown> = {};
  if (wants("file_excerpt")) {
    const files = resolved.map((f) => ({ rel: f.rel, text: textFor(f) })).filter((f): f is { rel: string; text: string } => f.text !== null);
    // Fair shares: the smallest files first, their unused share to the rest.
    const order = [...files].sort((a, b) => bytesOf(a.text) - bytesOf(b.text));
    const share = new Map<string, number>();
    let remaining = Math.max(0, excerptBudget);
    order.forEach((f, i) => {
      const s = Math.min(bytesOf(f.text), Math.floor(remaining / (order.length - i)));
      share.set(f.rel, s);
      remaining -= s;
    });
    const excerpts: FileExcerpt[] = [];
    for (const f of files) excerpts.push(...fileExcerpts(f.rel, f.text, input.focus?.anchors ?? [], share.get(f.rel) ?? 0));
    context.file_excerpt = excerpts;
  }
  if (wants("site_outline")) {
    const page = resolved.find((f) => /\.html?$/i.test(f.rel));
    const text = page ? textFor(page) : null;
    if (page && text !== null) context.site_outline = siteOutline(text, page.rel);
  }
  if (wants("site_check")) {
    const page = resolved.find((f) => /\.html?$/i.test(f.rel))?.rel;
    const latest = src.session.latestCheck(page) ?? src.session.latestCheck();
    context.site_check = latest ?? { verdict: "unverified", path: page ?? CONSULT_DEFAULT_PAGE };
  }
  if (wants("diff_summary")) {
    const d = src.session.lastDiff();
    if (d) context.diff_summary = compactDiff(d);
  }
  if (wants("failure_evidence")) {
    const f = src.session.failuresThisTurn();
    if (f.length) context.failure_evidence = f.map((e) => ({ id: e.id, detail: e.detail, ...(e.path ? { path: e.path } : {}) }));
  }
  if (wants("learner_goal")) {
    const goal = typeof src.learnerGoal === "string" ? scrubSecrets(src.learnerGoal.trim()).slice(0, GOAL_MAX) : "";
    if (goal) context.learner_goal = goal;
  }
  if (wants("lesson_step") && src.lessonStep && LESSON_STEP.test(src.lessonStep)) context.lesson_step = src.lessonStep;
  return { ok: true, context, files: resolved.map((f) => f.rel) };
}

/** The request body, shrunk to CONSULT_BODY_BYTES_MAX by shortening the excerpts, or null. */
export function consultBody(
  agent: Pick<ServedAgent, "context">,
  input: ConsultInput,
  src: ConsultContextSources,
): { ok: true; body: string } | { ok: false; message: string } {
  let budget = CONSULT_EXCERPT_BYTES_MAX;
  for (let attempt = 0; attempt < 4; attempt++) {
    const assembled = assembleConsultContext(agent, input, src, budget);
    if (!assembled.ok) return assembled;
    const body = JSON.stringify({ question: scrubSecrets(input.question), context: assembled.context });
    const over = bytesOf(body) - CONSULT_BODY_BYTES_MAX;
    if (over <= 0) return { ok: true, body };
    budget = Math.max(0, budget - over - 256);
  }
  return { ok: false, message: "도우미에게 보낼 자료가 너무 커요." };
}

// ── The request (spec §4.4) ─────────────────────────────────────────────────

export interface AgentRunRequest {
  fetch: typeof fetch;
  /** The extension's proxyUrl (the OpenAI-compatible base ending in /v1). */
  gatewayUrl: string;
  token: string;
  /** `<id>@<version>`: the roster the app expects (409 roster_changed otherwise). */
  roster: string;
  agent: string;
  /** `x-hps-agent-call`: idempotency and join key, the same on a busy retry. */
  callId: string;
  turnId?: string;
  lessonBinding?: string;
  fundingSource?: string;
  body: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type AgentRunAnswer =
  | { kind: "ok"; status: number; body: Record<string, unknown> }
  | { kind: "error"; status: number; code: string | null; message: string | null }
  | { kind: "offline" }
  | { kind: "timeout" }
  | { kind: "aborted" };

/** `POST {base}/v1/agents/:agent/run`, the base derived as the SDK's ANTHROPIC_BASE_URL is. */
export function agentRunUrl(gatewayUrl: string, agent: string): string {
  return `${anthropicBaseUrlFor(gatewayUrl)}/v1/agents/${encodeURIComponent(agent)}/run`;
}

// The same value rules buildSdkGatewayEnv applies to these headers on the coach's requests.
const TURN_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const LESSON_BINDING = /^(token:[a-f0-9]{16}|[a-f0-9]{32})$/;
const FUNDING_SOURCE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const CALL_ID = /^[0-9a-f-]{36}$/i;

/** The request headers (spec §4.1, §4.4). Values that fail their rule are left out. */
export function agentRunHeaders(req: Pick<AgentRunRequest, "token" | "roster" | "callId" | "turnId" | "lessonBinding" | "fundingSource">): Record<string, string> {
  const h: Record<string, string> = {
    authorization: `Bearer ${req.token}`,
    "content-type": "application/json",
    accept: "application/json",
    "x-hps-orchestrator": ORCHESTRATOR_FORMAT,
    "x-hps-roster": req.roster,
  };
  if (CALL_ID.test(req.callId)) h["x-hps-agent-call"] = req.callId;
  if (req.turnId && TURN_ID.test(req.turnId)) h["x-hps-turn-id"] = req.turnId;
  if (req.lessonBinding && LESSON_BINDING.test(req.lessonBinding)) h["x-hps-lesson-binding"] = req.lessonBinding;
  if (req.fundingSource && FUNDING_SOURCE.test(req.fundingSource)) h["x-hps-funding-source"] = req.fundingSource;
  return h;
}

/** One agent run. Never throws. */
export async function postAgentRun(req: AgentRunRequest): Promise<AgentRunAnswer> {
  if (req.signal?.aborted) return { kind: "aborted" };
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, req.timeoutMs ?? CONSULT_HTTP_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  req.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await req.fetch(agentRunUrl(req.gatewayUrl, req.agent), {
      method: "POST",
      headers: agentRunHeaders(req),
      body: req.body,
      signal: controller.signal,
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    const body = json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
    if (res.ok) return { kind: "ok", status: res.status, body };
    const err = body.error;
    const errObj = err && typeof err === "object" && !Array.isArray(err) ? (err as Record<string, unknown>) : null;
    const code = typeof body.code === "string" ? body.code : typeof errObj?.code === "string" ? errObj.code : typeof err === "string" ? err : null;
    const message = typeof body.message === "string" ? body.message : typeof errObj?.message === "string" ? errObj.message : null;
    return { kind: "error", status: res.status, code, message };
  } catch {
    if (req.signal?.aborted) return { kind: "aborted" };
    return timedOut ? { kind: "timeout" } : { kind: "offline" };
  } finally {
    clearTimeout(timer);
    req.signal?.removeEventListener("abort", onAbort);
  }
}

const SERVICE_CODES: Record<string, ConsultCode> = {
  agent_cap_reached: "cap_reached",
  not_triggered: "not_triggered",
  roster_changed: "roster_changed",
  agent_model_unavailable: "agent_model_unavailable",
  agent_output_invalid: "agent_output_invalid",
  context_invalid: "context_invalid",
  trial_exhausted: "trial_exhausted",
  trial_busy: "busy",
  agent_unknown: "agent_unknown",
  agent_disabled: "agent_disabled",
  orchestrator_off: "orchestrator_off",
  minor_cohort: "orchestrator_off",
  upstream: "upstream",
};

/** The tool-result code for an answer that is not a usable 200. */
export function consultCodeFor(answer: Exclude<AgentRunAnswer, { kind: "ok" }> | { kind: "invalid_ok" }): ConsultCode {
  if (answer.kind === "offline" || answer.kind === "aborted") return "offline";
  if (answer.kind === "timeout" || answer.kind === "invalid_ok") return "upstream";
  const known = answer.code ? SERVICE_CODES[answer.code] : undefined;
  if (known) return known;
  // An old Service has no /v1/agents route at all (spec §2.3 item 4).
  if (answer.status === 404) return "orchestrator_off";
  return "upstream";
}

/** Did the Service possibly run the agent (and so the cap is used)? */
function usedTheCap(answer: AgentRunAnswer): boolean {
  if (answer.kind === "ok" || answer.kind === "offline" || answer.kind === "timeout") return true;
  if (answer.kind === "aborted") return false;
  if (answer.code === "agent_output_invalid") return true;
  if (answer.code && SERVICE_CODES[answer.code]) return false;
  return answer.status >= 500;
}

// ── Result shaping (spec §3.3) ──────────────────────────────────────────────

function oneLine(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * `value` shrunk until `wrap(value)` serializes within `max` characters: the last item of
 * the largest array is dropped, or the longest string is halved, one step at a time.
 * Deterministic; gives up to `{}` after 200 steps.
 */
function fitJson(value: unknown, wrap: (v: unknown) => unknown, max: number): { value: unknown; cut: boolean } {
  let v: unknown = JSON.parse(JSON.stringify(value ?? null));
  let cut = false;
  for (let step = 0; step < 200 && JSON.stringify(wrap(v)).length > max; step++) {
    cut = true;
    let bestArr: unknown[] | null = null;
    let bestArrLen = 0;
    let bestStr: { holder: Record<string, unknown> | unknown[]; key: string | number; len: number } | null = null;
    const walk = (node: unknown, holder: Record<string, unknown> | unknown[] | null, key: string | number | null) => {
      if (Array.isArray(node)) {
        const len = JSON.stringify(node).length;
        if (node.length > 1 && len > bestArrLen) {
          bestArr = node;
          bestArrLen = len;
        }
        node.forEach((child, i) => walk(child, node, i));
      } else if (node && typeof node === "object") {
        for (const [k, child] of Object.entries(node as Record<string, unknown>)) walk(child, node as Record<string, unknown>, k);
      } else if (typeof node === "string" && holder && key !== null && node.length > 24 && (!bestStr || node.length > bestStr.len)) {
        bestStr = { holder, key, len: node.length };
      }
    };
    walk(v, null, null);
    const arr = bestArr as unknown[] | null;
    const str = bestStr as { holder: Record<string, unknown> | unknown[]; key: string | number; len: number } | null;
    if (arr && (!str || bestArrLen >= str.len)) arr.pop();
    else if (str) {
      const holder = str.holder as Record<string | number, unknown>;
      const s = String(holder[str.key]);
      holder[str.key] = `${s.slice(0, Math.floor(s.length / 2))}…`;
    } else {
      v = {};
    }
  }
  return { value: v, cut };
}

// ── Severity-aware cut (A5) ─────────────────────────────────────────────────
// A reviewer answer can be longer than the tool result: the largest valid S1 design review
// is 2,707 characters (A4 report §12). Cut from the end, it lost two of its four `must`
// findings while two `should` ones stayed. So when an answer with `findings` must be cut,
// findings go lowest severity first: unranked, then `could`, then `should`, the later one
// first within a severity. `must` findings are cut only after every other finding is gone,
// and then only by the general rule below. The kept findings keep the Service's order, and
// `cut` says what was left out, by severity, so the coach never reads a partial list as the
// whole review.

/** Highest first. A finding whose severity is none of these ranks below `could`. */
export const FINDING_SEVERITIES = ["must", "should", "could"] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

/** What a cut answer says it left out (spec §3.3 `truncated`, made specific). */
export interface ConsultCut {
  findings_total: number;
  findings_kept: number;
  /** Findings left out, by severity; `other` for one without a known severity. */
  dropped: Partial<Record<FindingSeverity | "other", number>>;
}

/** 0 must, 1 should, 2 could, 3 anything else. */
function severityRank(finding: unknown): number {
  const s = finding && typeof finding === "object" && !Array.isArray(finding) ? (finding as Record<string, unknown>).severity : undefined;
  const i = typeof s === "string" ? (FINDING_SEVERITIES as readonly string[]).indexOf(s) : -1;
  return i < 0 ? FINDING_SEVERITIES.length : i;
}

function severityName(finding: unknown): FindingSeverity | "other" {
  const r = severityRank(finding);
  return r < FINDING_SEVERITIES.length ? FINDING_SEVERITIES[r] : "other";
}

/** `total` findings, of which `kept` remain: the counts left out per severity. */
export function consultCutOf(total: readonly unknown[], kept: readonly unknown[]): ConsultCut {
  const count = (list: readonly unknown[]) => {
    const n: Record<string, number> = {};
    for (const f of list) n[severityName(f)] = (n[severityName(f)] ?? 0) + 1;
    return n;
  };
  const before = count(total);
  const after = count(kept);
  const dropped: ConsultCut["dropped"] = {};
  for (const key of [...FINDING_SEVERITIES, "other"] as const) {
    const d = (before[key] ?? 0) - (after[key] ?? 0);
    if (d > 0) dropped[key] = d;
  }
  return { findings_total: total.length, findings_kept: kept.length, dropped };
}

/**
 * The findings to keep, in the Service's order: the fewest drops, lowest severity first, for
 * which `fits` holds. Returns null when even the `must` findings alone do not fit.
 */
export function keepBySeverity(findings: readonly unknown[], fits: (kept: unknown[]) => boolean): unknown[] | null {
  const order = findings
    .map((f, i) => ({ i, r: severityRank(f) }))
    .filter((x) => x.r > 0)
    .sort((a, b) => b.r - a.r || b.i - a.i);
  const gone = new Set<number>();
  for (const d of order) {
    gone.add(d.i);
    const kept = findings.filter((_, i) => !gone.has(i));
    if (fits(kept)) return kept;
  }
  return null;
}

/** The success text: §3.3's object, within CONSULT_RESULT_MAX. */
export function consultSuccessText(agent: ServedAgent, body: Record<string, unknown>): string {
  const modelLabel =
    body.model && typeof body.model === "object" && typeof (body.model as Record<string, unknown>).label === "string"
      ? oneLine(String((body.model as Record<string, unknown>).label), 60)
      : agent.model?.label ?? null;
  const head = {
    ok: true,
    agent: agent.name,
    title: agent.title,
    version: typeof body.version === "string" ? body.version.slice(0, 40) : null,
    model: modelLabel,
    request_id: typeof body.request_id === "string" ? body.request_id.slice(0, 80) : null,
  };
  const wrap = (output: unknown) => ({ ...head, output });
  const output: unknown = JSON.parse(JSON.stringify(body.output ?? null));
  const findings =
    output && typeof output === "object" && !Array.isArray(output) && Array.isArray((output as Record<string, unknown>).findings)
      ? ((output as Record<string, unknown>).findings as unknown[])
      : null;
  const whole = JSON.stringify(wrap(output));
  if (!findings || whole.length <= CONSULT_RESULT_MAX - 20) {
    // An answer that fits goes whole; one without findings is cut the general way, as before.
    const fitted = fitJson(output, wrap, CONSULT_RESULT_MAX - 20);
    return JSON.stringify(fitted.cut ? { ...wrap(fitted.value), truncated: true } : wrap(fitted.value));
  }
  const cutText = (out: Record<string, unknown>, cut: ConsultCut) => JSON.stringify({ ...wrap(out), truncated: true, cut });
  const rest = output as Record<string, unknown>;
  const kept = keepBySeverity(findings, (k) => cutText({ ...rest, findings: k }, consultCutOf(findings, k)).length <= CONSULT_RESULT_MAX);
  if (kept) return cutText({ ...rest, findings: kept }, consultCutOf(findings, kept));
  // Only `must` findings are left and they still do not fit: shorten and drop the general way,
  // measured against the largest marker this answer could need, then report the real one.
  const mustOnly = { ...rest, findings: findings.filter((f) => severityRank(f) === 0) };
  const n = findings.length;
  const widest: ConsultCut = { findings_total: n, findings_kept: n, dropped: { must: n, should: n, could: n, other: n } };
  const fitted = fitJson(mustOnly, (v) => ({ ...wrap(v), truncated: true, cut: widest }), CONSULT_RESULT_MAX);
  const left = fitted.value && typeof fitted.value === "object" && Array.isArray((fitted.value as Record<string, unknown>).findings)
    ? ((fitted.value as Record<string, unknown>).findings as unknown[])
    : [];
  return JSON.stringify({ ...wrap(fitted.value), truncated: true, cut: consultCutOf(findings, left) });
}

export function consultErrorText(agentName: string, code: ConsultCode, message?: string): string {
  return JSON.stringify({ ok: false, agent: agentName.slice(0, 40), code, message: oneLine(message ?? CONSULT_MESSAGES[code], 200) });
}

/** The timeline's words for an answer (spec §5.2: `고칠 곳 2개`). */
export function consultOutcomeLabel(output: unknown): string {
  if (!output || typeof output !== "object" || Array.isArray(output)) return "답을 받음";
  const o = output as Record<string, unknown>;
  if (Array.isArray(o.findings)) {
    const n = o.findings.length;
    if (n > 0) return `고칠 곳 ${n}개`;
    if (o.verdict === "unverified") return "미확인";
    return o.verdict === "pass" ? "통과" : "고칠 곳 없음";
  }
  if (Array.isArray(o.plan)) return o.stop === true ? "멈추고 학습자에게 묻기" : `계획 ${o.plan.length}단계`;
  return "답을 받음";
}

// ── The handler ─────────────────────────────────────────────────────────────

export interface ConsultDeps {
  roster: ServedRoster;
  /** Re-checked here: a minor or unknown tier never consults, whatever was registered. */
  profile: Pick<ResolvedProfile, "game" | "minor_cohort">;
  session: OrchestratorSession;
  /** coachSeatKeyFor(…): the mutex key. */
  seatKey: string;
  gateway: { url: string; token: string; turnId?: string; lessonBinding?: string; fundingSource?: string };
  workspaceRoot?: string;
  lessonStep?: string;
  learnerGoal?: () => string | null | undefined;
  fetch: typeof fetch;
  emit?: (event: OrchestratorEvent) => void;
  /** The turn's signal: a stopped turn stops waiting. */
  signal?: AbortSignal;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  newId?: () => string;
  canonicalize?: (p: string) => string;
  readText?: (absPath: string, maxBytes: number) => string | null;
  busyWaitMs?: number;
  busyRetryDelaysMs?: readonly number[];
  httpTimeoutMs?: number;
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, Math.max(0, ms));
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/**
 * Run one consult. Returns the MCP tool result; never throws. Refusals carry their code
 * and touch no network; the cap is counted only when the Service may have run the agent.
 */
export async function runConsult(deps: ConsultDeps, raw: unknown): Promise<McpToolResult> {
  const now = deps.now ?? (() => Date.now());
  const newId = deps.newId ?? (() => randomUUID());
  const sleep = deps.sleep ?? abortableSleep;
  const emit = (event: OrchestratorEvent) => {
    try {
      deps.emit?.(event);
    } catch {
      /* the timeline is the host's; its failure must not change the answer */
    }
  };
  const answer = (text: string, isError: boolean): McpToolResult => ({
    content: [{ type: "text", text }],
    ...(isError ? { isError: true } : {}),
  });
  const refuse = (agentName: string, agent: ServedAgent | undefined, code: ConsultCode, message?: string): McpToolResult => {
    emit({
      kind: "consult",
      id: `consult:${newId()}`,
      agent: agentName,
      title: agent?.title ?? agentName,
      model: agent?.model?.label ?? null,
      state: "error",
      summary: CONSULT_ERROR_LABELS[code],
      code,
      icon: CONSULT_ICON,
      label: `${CONSULT_ICON} ${agent ? agentLabel(agent) : agentName} — ${CONSULT_ERROR_LABELS[code]}`,
      at: now(),
    });
    return answer(consultErrorText(agentName, code, message), true);
  };

  const rawAgent = raw && typeof raw === "object" && typeof (raw as Record<string, unknown>).agent === "string"
    ? String((raw as Record<string, unknown>).agent).slice(0, 40)
    : "";
  // MINOR-SAFETY INVARIANT (spec §5.4): never registered for minors; refused here as well.
  if (isMinorTier(deps.profile as ResolvedProfile) || deps.profile.minor_cohort === true) {
    return refuse(rawAgent, undefined, "orchestrator_off");
  }
  const read = readConsultInput(raw);
  if (!read.ok) return refuse(rawAgent, undefined, "context_invalid", read.message);
  const input = read.input;
  const agent = rosterAgent(deps.roster, input.agent);
  if (!agent || (agent.role !== "helper" && agent.role !== "advisor")) return refuse(input.agent, undefined, "agent_unknown");
  if (!agent.enabled || agent.caps.per_turn <= 0 || agent.caps.per_session <= 0) return refuse(agent.name, agent, "agent_disabled");

  return withConsultMutex(deps.seatKey, async () => {
    // Inside the mutex: a parallel pair cannot both pass a cap of one.
    const used = deps.session.usage(agent.name);
    if (used.turn >= agent.caps.per_turn || used.session >= agent.caps.per_session) return refuse(agent.name, agent, "cap_reached");
    if (agent.trigger === "deterministic_failure" && deps.session.failuresThisTurn().length === 0) {
      return refuse(agent.name, agent, "not_triggered");
    }
    let goal: string | null | undefined;
    try {
      goal = deps.learnerGoal?.();
    } catch {
      goal = null;
    }
    const body = consultBody(agent, input, {
      workspaceRoot: deps.workspaceRoot,
      ...(deps.canonicalize ? { canonicalize: deps.canonicalize } : {}),
      ...(deps.readText ? { readText: deps.readText } : {}),
      session: deps.session,
      learnerGoal: goal,
      lessonStep: deps.lessonStep,
    });
    if (!body.ok) return refuse(agent.name, agent, "context_invalid", body.message);

    const callId = newId();
    const eventId = `consult:${callId}`;
    const label = agentLabel(agent);
    emit({
      kind: "consult",
      id: eventId,
      agent: agent.name,
      title: agent.title,
      model: agent.model?.label ?? null,
      state: "running",
      summary: "묻는 중",
      icon: CONSULT_ICON,
      label: `${CONSULT_ICON} ${label} — 묻는 중`,
      at: now(),
    });
    const request: AgentRunRequest = {
      fetch: deps.fetch,
      gatewayUrl: deps.gateway.url,
      token: deps.gateway.token,
      roster: rosterKey(deps.roster),
      agent: agent.name,
      callId,
      turnId: deps.gateway.turnId,
      lessonBinding: deps.gateway.lessonBinding,
      fundingSource: deps.gateway.fundingSource,
      body: body.body,
      signal: deps.signal,
      timeoutMs: deps.httpTimeoutMs ?? CONSULT_HTTP_TIMEOUT_MS,
    };

    let result = await postAgentRun(request);
    // The one wait (spec §3.2, §11.6 item 4): the pass seat's lease is held, most likely
    // by the coach's own request still finishing. Ask again, with the same call id, until
    // it clears or the wait is over; nothing else is ever retried.
    if (result.kind === "error" && result.code === "trial_busy") {
      const waitMs = deps.busyWaitMs ?? CONSULT_BUSY_WAIT_MS;
      const delays = deps.busyRetryDelaysMs ?? CONSULT_BUSY_RETRY_DELAYS_MS;
      let waited = 0;
      for (const d of delays) {
        if (waited >= waitMs || deps.signal?.aborted) break;
        const step = Math.min(d, waitMs - waited);
        await sleep(step, deps.signal);
        waited += step;
        if (deps.signal?.aborted) break;
        result = await postAgentRun(request);
        if (!(result.kind === "error" && result.code === "trial_busy")) break;
      }
    }

    const done = (state: "done" | "error", summary: string, code?: ConsultCode) =>
      emit({
        kind: "consult",
        id: eventId,
        agent: agent.name,
        title: agent.title,
        model:
          result.kind === "ok" && result.body.model && typeof result.body.model === "object" &&
          typeof (result.body.model as Record<string, unknown>).label === "string"
            ? String((result.body.model as Record<string, unknown>).label).slice(0, 60)
            : agent.model?.label ?? null,
        state,
        summary,
        ...(code ? { code } : {}),
        icon: CONSULT_ICON,
        label: `${CONSULT_ICON} ${label} — ${summary}`,
        at: now(),
      });

    if (usedTheCap(result)) deps.session.recordUse(agent.name);
    if (result.kind === "ok") {
      const output = result.body.output;
      if (result.body.ok !== true || !output || typeof output !== "object" || Array.isArray(output) ||
        (typeof result.body.agent === "string" && result.body.agent !== agent.name)) {
        done("error", CONSULT_ERROR_LABELS.upstream, "upstream");
        return answer(consultErrorText(agent.name, consultCodeFor({ kind: "invalid_ok" })), true);
      }
      done("done", consultOutcomeLabel(output));
      return answer(consultSuccessText(agent, result.body), false);
    }
    const code = consultCodeFor(result);
    if (code === "cap_reached") deps.session.exhaust(agent.name, agent.caps);
    done("error", CONSULT_ERROR_LABELS[code], code);
    // The Service's own Korean line is the better one where it differs by seat (a pass and a
    // trial word an exhausted allowance differently).
    const serviceLine = result.kind === "error" && code === "trial_exhausted" && result.message ? result.message : undefined;
    return answer(consultErrorText(agent.name, code, serviceLine), true);
  });
}

// ── The tool definition (spec §3.2) ─────────────────────────────────────────

const TRIGGER_WORDS: Record<string, string> = {
  coach_consult: "",
  deterministic_failure: "확인 도구가 실패를 기록한 턴에만",
};

/**
 * The description the coach reads: the Service's coach brief, then each consultable
 * agent's name, title, purpose, trigger and caps, then the mechanics. Fixed per query, so
 * the cached prefix stays stable within a turn.
 */
export function consultToolDescription(roster: ServedRoster, agents: readonly ServedAgent[]): string {
  const lines: string[] = [];
  if (roster.coach_brief) lines.push(roster.coach_brief, "");
  lines.push("도우미에게 한 번 묻는다. agent 에 아래 이름 하나를, question 에 묻고 싶은 것을 4~400자로 적는다.");
  for (const a of agents) {
    const when = a.trigger ? TRIGGER_WORDS[a.trigger] ?? "" : "";
    const caps = `한 턴 ${a.caps.per_turn}번, 세션 ${a.caps.per_session}번`;
    lines.push(`- ${a.name} (${a.title})${a.purpose ? `: ${a.purpose}` : ""} [${[when, caps].filter(Boolean).join(" · ")}]`);
  }
  lines.push(
    "focus.files 는 작업 폴더 기준 경로(최대 3개, 없으면 index.html), focus.anchors 는 볼 곳의 id 나 표시(최대 5개, 예: \"#hours\", \"정보블록\")다.",
    "대화 기록은 보내지 않는다. 도우미는 위 파일의 발췌와 확인 결과만 보고, 도구를 쓰거나 파일을 고치지 않는다. 답은 코치에게만 온다.",
  );
  return lines.join("\n");
}

function call(schema: unknown, method: string, ...args: unknown[]): unknown {
  const fn = (schema as Record<string, unknown> | null)?.[method];
  return typeof fn === "function" ? (fn as (...a: unknown[]) => unknown).apply(schema, args) : schema;
}

/** The zod shape (spec §3.2 `ConsultInput`). Missing zod helpers degrade to plain strings. */
export function consultInputSchema(z: ZodLike, agents: readonly ServedAgent[]): Record<string, unknown> {
  const names = agents.map((a) => a.name);
  const agent = typeof z.enum === "function" && names.length > 0 ? z.enum(names as [string, ...string[]]) : z.string();
  const question = call(call(z.string(), "min", CONSULT_QUESTION_MIN), "max", CONSULT_QUESTION_MAX);
  const shape: Record<string, unknown> = { agent, question };
  if (typeof z.object === "function" && typeof z.array === "function") {
    shape.focus = call(
      z.object({
        files: call(call(z.array(z.string()), "max", CONSULT_FILES_MAX), "optional"),
        anchors: call(call(z.array(z.string()), "max", CONSULT_ANCHORS_MAX), "optional"),
      }),
      "optional",
    );
  }
  return shape;
}

/** The registered tool, or null when no agent is consultable. */
export function consultMcpTool(
  factory: SdkMcpFactory,
  z: ZodLike,
  roster: ServedRoster,
  agents: readonly ServedAgent[],
  handler: (args: Record<string, unknown>) => Promise<McpToolResult>,
): unknown | null {
  if (agents.length === 0) return null;
  return factory.tool(CONSULT_TOOL_NAME, consultToolDescription(roster, agents), consultInputSchema(z, agents), async (args) => handler(args));
}
