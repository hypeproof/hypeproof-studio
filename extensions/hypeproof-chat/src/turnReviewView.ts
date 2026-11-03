// The per-turn review bar's data (AE-15, CGP-ART-R-002, CGP-AGENT-R-026). Shared by host and webview;
// no imports, so the webview can take it without pulling Node modules.

export type TurnReviewState = "open" | "restoring" | "restored" | "failed";

export interface TurnReviewView {
  /** The turn whose restore point this bar offers. */
  turnId: string;
  state: TurnReviewState;
  /** Bounded, hash-verified text comparisons; unavailable files never get invented counts. */
  files?: TurnFileReview[];
  added: string[];
  changed: string[];
  deleted: string[];
  /** Paths not copied (too large, over the folder caps, links, unreadable): never offered as restored. */
  notCovered: string[];
  /** After a revert: files whose pre-turn bytes were written and verified, plus added files removed. */
  restoredCount?: number;
  /** After a failed revert: the files that did not come back exactly. */
  failed?: string[];
  /** The "복구 직전" point was recorded, so the state before the revert can still be recovered. */
  beforeRestoreKept?: boolean;
  /** After a revert attempt: no file in the folder was written or removed (from the restore outcome, not inferred). */
  nothingChanged?: boolean;
  /** The revert was refused because the folder has more entries than a restore point covers. */
  tooLarge?: boolean;
  /** A one-line refusal for the last button press (e.g. a turn is running); the bar stays as it was. */
  notice?: string;
  /** CGP-AGENT-R-027 — present only on an adult website-track seat (checkpoint.ts checkpointApplies). */
  checkpoint?: CheckpointView;
}

/** Longest checkpoint message, in code points (the webview field and the host share it). */
export const CHECKPOINT_MESSAGE_MAX = 200;

/** Where the prefilled checkpoint message came from: the AI's answer, or the measured file names. */
export type CheckpointSource = "ai" | "files";

export interface CheckpointEntryView {
  id: string;
  /** The learner-reviewed message, cleaned and bounded by the host. Rendered as text only. */
  message: string;
  createdAt: number;
  fileCount: number;
}

export interface CheckpointView {
  /** The prefilled message; the learner reads and may edit it before saving. */
  suggestion: string;
  source: CheckpointSource;
  /** Saved checkpoints of this work folder and task, newest first. */
  history: CheckpointEntryView[];
  saving?: boolean;
  /** The id of the checkpoint the last save created (closes the form). */
  savedId?: string;
  /** One line about the last save (saved, refused, failed). */
  notice?: string;
}

export function turnReviewCount(v: Pick<TurnReviewView, "added" | "changed" | "deleted">): number {
  return v.added.length + v.changed.length + v.deleted.length;
}

export interface TurnFileReview {
  path: string;
  added?: number;
  removed?: number;
  lines?: { kind: "same" | "added" | "removed"; text: string }[];
  unavailable?: string;
}

/** Physical-line LCS, bounded by the host before invocation. A trailing newline is part of its line. */
export function compareTurnText(before: string, after: string): Omit<TurnFileReview, "path"> {
  const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const a = lines(before), b = lines(after);
  if (a.length > 500 || b.length > 500) return { unavailable: "500줄을 넘는 파일은 비교를 생략해요." };
  const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    table[i][j] = a[i] === b[j] ? 1 + table[i + 1][j + 1] : Math.max(table[i + 1][j], table[i][j + 1]);
  const result: NonNullable<TurnFileReview["lines"]> = [];
  let i = 0, j = 0, added = 0, removed = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { result.push({ kind: "same", text: a[i++] }); j++; }
    else if (j < b.length && (i === a.length || table[i][j + 1] > table[i + 1][j])) { result.push({ kind: "added", text: b[j++] }); added++; }
    else { result.push({ kind: "removed", text: a[i++] }); removed++; }
  }
  return { added, removed, lines: result };
}
