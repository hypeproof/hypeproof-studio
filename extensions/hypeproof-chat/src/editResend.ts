// CGP-CHAT-R-002 (REQ-STUDIO-CHAT-EDIT-RESEND) — edit the latest sent prompt and resend it.
//
// Pure: no vscode, no React. The webview (what to draw, when to offer "수정") and the host
// (what the model sees, what is accepted) apply the same rules, so they live here once.
//
// Data model, migration-free: the transcript stays one flat ChatMessage[]. A resent user line
// carries `editOf` = the id of the FIRST user line of its version group (the group root). A
// line without `editOf` is its own root, so every transcript written before this change reads
// as "one version per turn". A turn is a user line plus everything after it up to the next user
// line. A version group is a maximal run of consecutive turns with the same root; edit is only
// offered on the latest turn, so versions of one prompt are always adjacent.

import type { ChatMessage } from "./protocol";

/** Same shape the host accepts for a user-message id (rememberTurnRequest). */
const ID = /^[A-Za-z0-9_-]{1,128}$/;
export const validEditOf = (value: unknown): value is string => typeof value === "string" && ID.test(value);

interface Turn { start: number; end: number; user: ChatMessage | null }
export interface VersionRun { key: string; turns: Turn[] }
export interface VersionPager { key: string; index: number; count: number }

const rootOf = (user: ChatMessage): string => user.editOf ?? user.id;

function turns(items: readonly ChatMessage[]): Turn[] {
  const out: Turn[] = [];
  let current: Turn = { start: 0, end: 0, user: null };
  items.forEach((m, i) => {
    if (m.role === "user") {
      if (i > current.start || current.user) out.push({ ...current, end: i });
      current = { start: i, end: i, user: m };
    }
  });
  if (items.length > current.start || current.user) out.push({ ...current, end: items.length });
  return out;
}

/** Turns grouped into version runs. A preamble with no user line is its own run with key "". */
export function versionRuns(items: readonly ChatMessage[]): VersionRun[] {
  const runs: VersionRun[] = [];
  for (const turn of turns(items)) {
    const key = turn.user ? rootOf(turn.user) : "";
    const last = runs.at(-1);
    if (key && last && last.key === key) last.turns.push(turn);
    else runs.push({ key, turns: [turn] });
  }
  return runs;
}

/**
 * The transcript as drawn: one version per group (the chosen one, or the latest), plus the pager
 * state keyed by the visible user line's id. Switching versions is this function only: no request.
 */
export function visibleVersions(items: readonly ChatMessage[], chosen: Readonly<Record<string, number>> = {}): {
  items: ChatMessage[]; pagers: Record<string, VersionPager>;
} {
  const out: ChatMessage[] = [];
  const pagers: Record<string, VersionPager> = {};
  for (const run of versionRuns(items)) {
    const count = run.turns.length;
    const pick = chosen[run.key];
    const index = Number.isInteger(pick) && pick >= 0 && pick < count ? pick : count - 1;
    const turn = run.turns[index];
    out.push(...items.slice(turn.start, turn.end));
    if (count > 1 && turn.user) pagers[turn.user.id] = { key: run.key, index, count };
  }
  return { items: out, pagers };
}

/** What later turns continue from: the latest version of every group. The pager never changes this. */
export const currentVersions = (items: readonly ChatMessage[]): ChatMessage[] => visibleVersions(items).items;

/** The latest user line, if its group is the last group (it always is when a user line exists). */
export function latestUserTurn(items: readonly ChatMessage[]): { message: ChatMessage; key: string } | null {
  const run = versionRuns(items).at(-1);
  const user = run?.turns.at(-1)?.user;
  return run && user ? { message: user, key: run.key } : null;
}

/** The host accepts an edit only for the group the latest user line belongs to. */
export function validEditTarget(items: readonly ChatMessage[], editOf: unknown): editOf is string {
  if (!validEditOf(editOf)) return false;
  const latest = latestUserTurn(items);
  return !!latest && latest.key === editOf;
}

/**
 * History handed to the model for an edited request: everything before the group being edited.
 * None of the earlier versions (prompt or answer) goes along. Unknown key: unchanged.
 */
export function historyForEdit(items: readonly ChatMessage[], editOf: string): ChatMessage[] {
  const runs = versionRuns(items);
  const last = runs.at(-1);
  if (!last || last.key !== editOf) return currentVersions(items);
  return currentVersions(items.slice(0, last.turns[0].start));
}

export interface EditGate {
  streaming: boolean;
  sendPending?: boolean;
  /** A queued (다음에 보낼) or parked (보관한) message, or an unsent recovered request. */
  parked: boolean;
  instructor?: boolean;
  /** Composer unavailable: frozen activity, unverified seat, verify run, broken store. */
  locked?: boolean;
}

/** "수정" is offered on exactly one user line, and only while nothing else owns the next turn. */
export function editableUserId(items: readonly ChatMessage[], gate: EditGate): string | null {
  if (gate.streaming || gate.sendPending || gate.parked || gate.instructor || gate.locked) return null;
  const latest = latestUserTurn(items);
  return latest && latest.message.content.trim() ? latest.message.id : null;
}

/** DEC-08 — the `edit_resend` workflow payload. Ids, counts and lengths only; never text. */
export function editResendPayload(p: {
  editOf: string; fromMessageId: string; toMessageId: string; versions: number;
  originalLength: number; editedLength: number; images: number; toolMode: string;
}): Record<string, unknown> {
  return {
    group: p.editOf,
    from_message: p.fromMessageId,
    to_message: p.toMessageId,
    version: p.versions + 1,
    original_length: p.originalLength,
    edited_length: p.editedLength,
    images: p.images,
    tool_mode: p.toolMode,
  };
}

/** Number of versions the group `key` already has (0 when absent). */
export function versionCount(items: readonly ChatMessage[], key: string): number {
  return versionRuns(items).filter((run) => run.key === key).reduce((n, run) => n + run.turns.length, 0);
}
