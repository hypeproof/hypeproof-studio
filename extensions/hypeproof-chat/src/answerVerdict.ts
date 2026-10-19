// CGP-CHAT-R-005 (REQ-STUDIO-ANSWER-VERDICT, DEC-09) — the learner's verdict on a finished answer:
// "맞아요" or "고쳐야 해요" with an optional reason and a short note.
//
// Pure: no vscode, no React. The webview (where the controls go) and the host (what is accepted,
// stored and recorded) apply the same rules, so they live here once.
//
// Data model: an append-only list of verdict events per task, kept ONLY in the task's local verdict
// file (taskWorkspaceStore `<scope>.verdicts.json`). The latest event for a message wins for display;
// an event with `verdict: null` removes the verdict. Earlier events are kept, so a changed mind stays
// as history: that list is the evidence record.
//
// DEC-09: nothing here goes to the session spool. The spool is uploaded ("오늘 활동 기록 보내기") and
// collected for class records (evidenceSnapshot.ts), the verdict file is read by neither, so a verdict
// is not uploaded, not collected and not shown to instructors or Chalk (AE-20). It is not a score:
// nothing here is summed, averaged or ranked.

import type { ChatMessage } from "./protocol";

export type AnswerVerdict = "right" | "fix";
export const VERDICT_REASONS = ["wrong", "not_wanted", "too_hard", "other"] as const;
export type VerdictReason = typeof VERDICT_REASONS[number];

export const VERDICT_LABELS: Record<AnswerVerdict, string> = { right: "맞아요", fix: "고쳐야 해요" };
export const REASON_LABELS: Record<VerdictReason, string> = {
  wrong: "틀렸어요",
  not_wanted: "내가 원한 게 아니에요",
  too_hard: "너무 어려워요",
  other: "기타",
};

/** Optional free text under a reason. */
export const VERDICT_NOTE_MAX = 300;
/** Events kept per task. Superseded events are dropped first, so every message keeps its latest. */
export const VERDICT_HISTORY_MAX = 500;

export interface VerdictEvent {
  messageId: string;
  /** The user line that asked for this answer (the turn's request id), when there is one. */
  promptId?: string;
  /** The coach turn's id (the spool streamId) when this window produced the answer; absent after reopening. */
  turnId?: string;
  verdict: AnswerVerdict | null;
  reason?: VerdictReason;
  note?: string;
  at: number;
}

export interface VerdictState { verdict: AnswerVerdict; reason?: VerdictReason; note?: string }
export type VerdictMap = Record<string, VerdictState>;

/** What the webview may ask for. Everything else is filled in by the host. */
export interface VerdictRequest { requestId?: string; messageId: string; verdict: AnswerVerdict | null; reason?: VerdictReason; note?: string }

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const onlyKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every((key) => keys.includes(key));

/** Message ids as the chat stores them (`abc123`, `abc123#2` for a later segment, `local-<uuid>`). */
export const validMessageId = (value: unknown): value is string =>
  typeof value === "string" && /^[^\s\u0000-\u001f\u007f]{1,256}$/.test(value);
const validVerdict = (value: unknown): value is AnswerVerdict | null => value === null || value === "right" || value === "fix";
const validReason = (value: unknown): value is VerdictReason => typeof value === "string" && (VERDICT_REASONS as readonly string[]).includes(value);

/**
 * A reason (and a note) only belong to "고쳐야 해요"; a note only belongs under a reason. The note is
 * trimmed by the caller and is never empty here.
 */
function consistent(verdict: AnswerVerdict | null, reason: unknown, note: unknown): boolean {
  if (reason !== undefined && (verdict !== "fix" || !validReason(reason))) return false;
  if (note !== undefined && (reason === undefined || typeof note !== "string" || !note.trim() || note !== note.trim() || note.length > VERDICT_NOTE_MAX)) return false;
  return true;
}

/** Validates a webview request. Returns null for anything malformed (the host then ignores it). */
export function parseVerdictRequest(value: unknown): VerdictRequest | null {
  if (!isRecord(value) || !validMessageId(value.messageId) || !validVerdict(value.verdict)) return null;
  if (value.requestId !== undefined && !validMessageId(value.requestId)) return null;
  const note = typeof value.note === "string" ? value.note.trim() || undefined : value.note;
  if (!consistent(value.verdict, value.reason, note)) return null;
  return {
    ...(value.requestId !== undefined ? { requestId: value.requestId as string } : {}),
    messageId: value.messageId,
    verdict: value.verdict,
    ...(value.reason !== undefined ? { reason: value.reason as VerdictReason } : {}),
    ...(note !== undefined ? { note: note as string } : {}),
  };
}

/** A stored event (sidecar shape). */
export function validVerdictEvent(value: unknown): value is VerdictEvent {
  if (!isRecord(value) || !onlyKeys(value, ["messageId", "promptId", "turnId", "verdict", "reason", "note", "at"])) return false;
  if (!validMessageId(value.messageId) || !validVerdict(value.verdict)) return false;
  if (value.promptId !== undefined && !validMessageId(value.promptId)) return false;
  if (value.turnId !== undefined && !validMessageId(value.turnId)) return false;
  if (typeof value.at !== "number" || !Number.isSafeInteger(value.at) || value.at < 0) return false;
  return consistent(value.verdict, value.reason, value.note);
}

/** Latest event per message wins; `verdict: null` removes it. */
export function latestVerdicts(history: readonly VerdictEvent[]): VerdictMap {
  const out: VerdictMap = {};
  for (const event of history) {
    if (event.verdict === null) { delete out[event.messageId]; continue; }
    out[event.messageId] = {
      verdict: event.verdict,
      ...(event.reason ? { reason: event.reason } : {}),
      ...(event.note ? { note: event.note } : {}),
    };
  }
  return out;
}

/**
 * Appends one event. Over the cap, the oldest events that a later event for the same message
 * supersedes go first; only if that is not enough do the oldest events go. The latest state of
 * every message therefore survives trimming whenever the cap allows it.
 */
export function appendVerdict(history: readonly VerdictEvent[], event: VerdictEvent, max = VERDICT_HISTORY_MAX): VerdictEvent[] {
  const next = [...history, event];
  if (next.length <= max) return next;
  const lastIndex = new Map<string, number>();
  next.forEach((e, i) => lastIndex.set(e.messageId, i));
  let excess = next.length - max;
  const kept = next.filter((e, i) => {
    if (excess > 0 && lastIndex.get(e.messageId) !== i) { excess--; return false; }
    return true;
  });
  return kept.slice(Math.max(0, kept.length - max));
}

/** The state before `event` was applied, for the spool's `previous` field. */
export function previousVerdict(history: readonly VerdictEvent[], messageId: string): AnswerVerdict | "none" {
  return latestVerdicts(history)[messageId]?.verdict ?? "none";
}

/** The user line this answer replied to: the nearest user line above it. */
export function promptIdFor(messages: readonly ChatMessage[], messageId: string): string | undefined {
  const index = messages.findIndex((m) => m.id === messageId);
  for (let i = index - 1; i >= 0; i--) if (messages[i].role === "user") return messages[i].id;
  return undefined;
}

/**
 * The assistant lines that offer a verdict: the LAST answer bubble of each finished turn (a turn
 * with tool lines splits its answer into several bubbles; the learner judges the answer once), with
 * text, and never the turn that is still running.
 */
export function verdictTargets(messages: readonly ChatMessage[], streaming: boolean): Set<string> {
  const out = new Set<string>();
  let lastUser = -1;
  messages.forEach((m, i) => { if (m.role === "user") lastUser = i; });
  messages.forEach((m, i) => {
    if (m.role !== "assistant" || !m.content.trim()) return;
    if (streaming && i > lastUser) return;
    const next = messages.slice(i + 1).find((other) => other.role !== "tool");
    if (next?.role === "assistant") return;
    out.add(m.id);
  });
  return out;
}

/**
 * One stored event as an evidence row: ids, codes and the note's length. The note text itself stays
 * in the event for the learner's own screen; anything that summarises verdicts uses this shape.
 */
export function verdictEvidence(event: VerdictEvent, previous: AnswerVerdict | "none"): Record<string, unknown> {
  return {
    at: event.at,
    message_id: event.messageId,
    ...(event.promptId ? { prompt_id: event.promptId } : {}),
    ...(event.turnId ? { turn_id: event.turnId } : {}),
    verdict: event.verdict ?? "removed",
    previous,
    ...(event.reason ? { reason: event.reason } : {}),
    note_length: event.note?.length ?? 0,
  };
}
