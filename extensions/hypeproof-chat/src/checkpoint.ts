// CGP-AGENT-R-027 / REQ-CGP-AGENT-53 — "저장 지점 남기기": an adult on a website track saves the
// work folder as a named checkpoint whose message the AI suggested and the learner reviewed. vscode-free.
//
// - A checkpoint is a restore point (turnRestore.ts manifest + content-addressed copies) in its own
//   store, `<turn store>/checkpoints`, in the extension's global storage. Nothing is written into the
//   work folder: no `.git`, no commit, no publish, no network. "Nothing is pushed" holds because there
//   is nothing a push or a site publish could carry.
// - Its own store means turn pruning (newest 10) never removes a checkpoint; checkpoints keep 20.
// - The suggestion comes from the AI's own answer for the turn (its first prose line), never from a new
//   model request. A turn without usable answer text falls back to the measured file names, and the
//   view says which source filled the field.
// - Every message is learner-reviewed before it is stored: the host stores only what the learner sent
//   with the save action, cleaned and bounded here.

import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { ResolvedProfile } from "./protocol";
import { isMinorProfile } from "./sdkCoachHelpers.ts";
import { dropRestorePoint, listRestorePoints, pruneRestorePoints, takeRestorePoint, turnRestoreStoreDir, type TurnRestoreLimits } from "./turnRestore.ts";
import { CHECKPOINT_MESSAGE_MAX, type CheckpointEntryView, type CheckpointSource } from "./turnReviewView.ts";

/** Checkpoints kept per work folder and task. */
export const CHECKPOINT_KEEP = 20;
/** Longest stored message, in code points. */
export { CHECKPOINT_MESSAGE_MAX };
/** Longest suggested message, in code points (a short subject line). */
export const CHECKPOINT_SUGGESTION_MAX = 72;

/**
 * Adults on a website track only. A minor flag, a minor or unknown tier (isMinorTier fails closed),
 * a non-website tier, the instructor surface and a seat with no profile are all refused.
 */
export function checkpointApplies(profile: ResolvedProfile | null | undefined, instructor: boolean | null | undefined): boolean {
  if (!profile || instructor !== false) return false;
  if (isMinorProfile(profile)) return false;
  return profile.game?.template_tier === "website";
}

/** The checkpoint store of one work folder and task: beside, never inside, the turn points. */
export function checkpointStoreDir(base: string, folderRealPath: string, taskKey: string | null | undefined): string {
  return path.join(turnRestoreStoreDir(base, folderRealPath, taskKey), "checkpoints");
}

// C0/C1 controls (newline and tab handled separately), bidi marks/embeddings/overrides/isolates (U+061C
// included), zero-width space/non-joiner, invisible operators, interlinear annotation, tag characters and
// the BOM. U+200D (ZWJ) is kept so emoji sequences survive. U+2028/2029 become newlines first.
const UNSAFE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u180e\u200b\u200c\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\ufff9-\ufffb\u{e0000}-\u{e007f}]/gu;

/**
 * A message the learner sent (or the suggestion before it is shown): NFC, line separators to `\n`,
 * tabs to spaces, controls and bidi characters removed, trailing spaces trimmed per line, at most one
 * blank line in a row, trimmed, capped at `max` code points. Empty → null (nothing to save).
 */
export function cleanCheckpointMessage(raw: unknown, max: number = CHECKPOINT_MESSAGE_MAX): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.length > 20_000 ? raw.slice(0, 20_000) : raw;
  s = s.normalize("NFC").replace(/\r\n?|[\u2028\u2029\u0085]/g, "\n").replace(/\t/g, " ").replace(UNSAFE, "");
  s = s.split("\n").map((line) => line.replace(/[ \u00a0\u3000]+$/u, "")).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!s) return null;
  const points = Array.from(s);
  return points.length > max ? points.slice(0, max).join("").trimEnd() : s;
}

/** Markdown decoration of one line removed so the subject reads as prose. */
function plainLine(line: string): string {
  return line
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d{1,3}[.)]\s+)/, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|`+|~~)/g, "")
    .replace(/(^|\s)[*_](\S[^*_]*\S|\S)[*_](?=\s|$)/g, "$1$2")
    .trim();
}

export interface CheckpointSuggestion {
  message: string;
  source: CheckpointSource;
}

/**
 * The prefilled message. `ai`: the first prose line of the AI's answer for this turn (code fences,
 * tables, rules and bare emoji lines skipped). `files`: the answer had no usable line, so the
 * measured changed paths fill it.
 */
export function suggestCheckpointMessage(assistantText: unknown, changed: { added: readonly string[]; changed: readonly string[]; deleted: readonly string[] }): CheckpointSuggestion {
  if (typeof assistantText === "string" && assistantText.trim()) {
    let fenced = false;
    for (const raw of assistantText.slice(0, 20_000).split(/\r\n?|\n|[\u2028\u2029]/)) {
      if (/^\s{0,3}(```|~~~)/.test(raw)) { fenced = !fenced; continue; }
      if (fenced || /^\s*\|/.test(raw) || /^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(raw) || /^\s*<[^>]*>\s*$/.test(raw)) continue;
      const line = cleanCheckpointMessage(plainLine(raw), CHECKPOINT_SUGGESTION_MAX)?.replace(/\n/g, " ");
      if (line && /[\p{L}\p{N}]/u.test(line)) return { message: line, source: "ai" };
    }
  }
  const names = [...changed.changed, ...changed.added, ...changed.deleted].map((p) => p.split("/").pop() ?? p);
  const total = names.length;
  const shown = names.slice(0, 2).join(", ");
  const fallback = total === 0 ? "작업 저장" : total <= 2 ? `${shown} 바꿈` : `${shown} 외 ${total - 2}개 바꿈`;
  return { message: cleanCheckpointMessage(fallback, CHECKPOINT_SUGGESTION_MAX) ?? "작업 저장", source: "files" };
}

/** The panel history, newest first. Unreadable points and points of another kind are skipped. */
export async function listCheckpoints(store: string): Promise<CheckpointEntryView[]> {
  return (await listRestorePoints(store))
    .filter((p) => p.kind === "checkpoint" && typeof p.message === "string")
    .map((p) => ({ id: p.id, message: p.message as string, createdAt: p.createdAt, fileCount: p.files.length }));
}

export type SaveCheckpointResult =
  | { ok: true; id: string; digest: string; fileCount: number; notCovered: number }
  | { ok: false; error: "empty_message" | "too_long" | "folder_too_large" | "stale" | "store_failed" };

/**
 * Record the folder as a checkpoint with the learner's message. `stillCurrent` is asked after the
 * folder walk; when it says no (a turn started, the task or folder changed) the point is dropped.
 */
export async function saveCheckpoint(req: { store: string; root: string; turnId: string; message: unknown; now?: number; stillCurrent?: () => boolean; limits?: Partial<TurnRestoreLimits> }): Promise<SaveCheckpointResult> {
  const message = cleanCheckpointMessage(req.message, Infinity);
  if (!message) return { ok: false, error: "empty_message" };
  // Never store a shortened message the learner did not see: an over-long one is refused.
  if (Array.from(message).length > CHECKPOINT_MESSAGE_MAX) return { ok: false, error: "too_long" };
  const id = `cp-${randomUUID()}`;
  let point;
  try {
    ({ point } = await takeRestorePoint({ store: req.store, root: req.root, id, turnId: req.turnId, kind: "checkpoint", message, now: req.now, keep: Number.MAX_SAFE_INTEGER, limits: req.limits }));
  } catch {
    await dropRestorePoint(req.store, id).catch(() => undefined);
    return { ok: false, error: "store_failed" };
  }
  if (!point.complete) { await dropRestorePoint(req.store, id); return { ok: false, error: "folder_too_large" }; }
  if (req.stillCurrent && !req.stillCurrent()) { await dropRestorePoint(req.store, id); return { ok: false, error: "stale" }; }
  // Prune only after the new point is accepted, so a refused save never costs an older checkpoint.
  await pruneRestorePoints(req.store, CHECKPOINT_KEEP, [id]).catch(() => undefined);
  return { ok: true, id, digest: point.digest, fileCount: point.files.length, notCovered: point.notCovered.length };
}
