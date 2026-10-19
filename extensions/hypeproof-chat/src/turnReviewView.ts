// The per-turn review bar's data (AE-15, CGP-ART-R-002, CGP-AGENT-R-026). Shared by host and webview;
// no imports, so the webview can take it without pulling Node modules.

export type TurnReviewState = "open" | "restoring" | "restored" | "failed";

export interface TurnReviewView {
  /** The turn whose restore point this bar offers. */
  turnId: string;
  state: TurnReviewState;
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
  /** Why nothing was changed at all (the pre-revert point could not be recorded, or the folder is too large). */
  nothingChanged?: boolean;
  /** A one-line refusal for the last button press (e.g. a turn is running); the bar stays as it was. */
  notice?: string;
}

export function turnReviewCount(v: Pick<TurnReviewView, "added" | "changed" | "deleted">): number {
  return v.added.length + v.changed.length + v.deleted.length;
}
