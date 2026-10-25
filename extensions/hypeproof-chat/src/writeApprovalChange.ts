// REQ-STUDIO-WRITE-APPROVAL-CHANGE (CGP-ART-R-021 / REQ-ART-21) — before the learner approves a write that
// overwrites an existing workspace file, the write approval says how much of it will change. Pure apart from the
// injectable file reader; no vscode.
//
// The numbers come from `diffGuard` (the same comparison the PostToolUse hook reports after a save), run on the
// file as it is on disk now and on the text the tool call would leave behind:
//   Write                      → the call's `content`;
//   Edit / MultiEdit           → the call's replacements applied to the current text, with the CLI's rules
//                                (old_string must occur exactly once unless replace_all; edits apply in order);
//   NotebookEdit / anything else → not computed.
// When the result cannot be computed (the file is too large, not UTF-8 text, unreadable, the call's text is
// missing, or a replacement does not match), the approval says so in the same warning style as a rewrite. It never
// shows an overwrite without either numbers or that warning.
//
// A file that does not exist yet gets no summary (it is a new file, not an overwrite).

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { diffGuard, REWRITE_RATIO } from "./diffGuard.ts";
import { ALMOST_ALL_RATIO, type WriteChangeUnknownReason, type WriteChangeView } from "./writeApprovalPrompt.ts";

export { ALMOST_ALL_RATIO, WRITE_CHANGE_TEXT, writeChangeDetail, writeChangeWarning, type WriteChangeUnknownReason, type WriteChangeView } from "./writeApprovalPrompt.ts";

/** Same cap as the diff guard's snapshot (orchestratorHooks SNAPSHOT_MAX_BYTES). */
export const WRITE_CHANGE_MAX_BYTES = 2 * 1024 * 1024;
/**
 * Files up to this size are hashed whole for the re-check after the answer even when they are too large to diff;
 * beyond it only size and modification time are compared (a same-size, same-mtime change is not seen).
 */
export const WRITE_CHANGE_HASH_MAX_BYTES = 64 * 1024 * 1024;

/** What the tool call would write, read from its input. Host-built only: never taken from the webview. */
export type WriteEdit =
  | { tool: "write"; content: string }
  | { tool: "edit"; edits: Array<{ old_string: string; new_string: string; replace_all: boolean }> };

const WRITE_TOOLS = new Set(["write"]);
const EDIT_TOOLS = new Set(["edit", "multiedit"]);

/** The text a write call carries, or null when it carries none this module can apply. */
export function writeEditOf(toolName: string, input: unknown): WriteEdit | null {
  if (!input || typeof input !== "object") return null;
  const name = String(toolName ?? "").toLowerCase();
  const rec = input as Record<string, unknown>;
  if (WRITE_TOOLS.has(name)) return typeof rec.content === "string" ? { tool: "write", content: rec.content } : null;
  if (!EDIT_TOOLS.has(name)) return null;
  const raw: unknown[] = name === "edit" ? [rec] : Array.isArray(rec.edits) ? rec.edits : [];
  if (raw.length === 0) return null;
  const edits: Array<{ old_string: string; new_string: string; replace_all: boolean }> = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") return null;
    const { old_string, new_string, replace_all } = e as Record<string, unknown>;
    if (typeof old_string !== "string" || typeof new_string !== "string") return null;
    edits.push({ old_string, new_string, replace_all: replace_all === true });
  }
  return { tool: "edit", edits };
}

/** Accepts only the exact shape `writeEditOf` produces (the payload crosses a function boundary as `unknown`). */
export function asWriteEdit(value: unknown): WriteEdit | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.tool === "write") return typeof v.content === "string" ? { tool: "write", content: v.content } : null;
  if (v.tool !== "edit" || !Array.isArray(v.edits) || v.edits.length === 0) return null;
  return writeEditOf("multiedit", { edits: v.edits });
}

/**
 * The text after the call, or why the CLI would refuse it: no match (or an empty old_string on an existing file),
 * old_string found more than once without replace_all, or old_string equal to new_string. The CLI's own quote
 * normalisation is not reproduced: a call that only matches after it reads "no-match" (a warning, never a number).
 */
export function applyWriteEditResult(before: string, edit: WriteEdit): { text: string } | { refused: "no-match" | "ambiguous" | "no-change" } {
  if (edit.tool === "write") return { text: edit.content };
  let text = before;
  for (const e of edit.edits) {
    if (e.old_string === "") return { refused: "no-match" };
    if (e.old_string === e.new_string) return { refused: "no-change" };
    const pieces = text.split(e.old_string);
    if (pieces.length < 2) return { refused: "no-match" };
    if (pieces.length > 2 && !e.replace_all) return { refused: "ambiguous" };
    // split/join, not String.replace: `$&` and friends in new_string are literal text.
    text = pieces.join(e.new_string);
  }
  return { text };
}

/** The text after the call, or null when the CLI would refuse it. */
export function applyWriteEdit(before: string, edit: WriteEdit): string | null {
  const r = applyWriteEditResult(before, edit);
  return "text" in r ? r.text : null;
}

export type ExistingText =
  | { exists: false; fingerprint: string }
  | { exists: true; fingerprint: string; text: string }
  | { exists: true; fingerprint: string; text: null; reason: "large" | "binary" | "unreadable" };

export interface ExistingTextFs {
  lstat(p: string): { isFile(): boolean; isSymbolicLink(): boolean; size: number; mtimeMs?: number };
  readFile(p: string): Uint8Array;
}

const nodeFs: ExistingTextFs = { lstat: (p) => fs.lstatSync(p), readFile: (p) => fs.readFileSync(p) };
const ABSENT = "absent";

/**
 * The file at `abs` (already resolved through links by writePathEntries) as it is now. The fingerprint is what the
 * host compares after the answer: a file that appeared, vanished or changed while the dialog was open is refused,
 * because the learner approved a summary of something else.
 */
export function readExistingText(abs: string, io: ExistingTextFs = nodeFs, maxBytes = WRITE_CHANGE_MAX_BYTES): ExistingText {
  let st: ReturnType<ExistingTextFs["lstat"]>;
  try { st = io.lstat(abs); } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT" || code === "ENOTDIR") return { exists: false, fingerprint: ABSENT };
    return { exists: true, fingerprint: `error:${code ?? "?"}`, text: null, reason: "unreadable" };
  }
  if (!st.isFile()) return { exists: true, fingerprint: `kind:${st.isSymbolicLink() ? "link" : "other"}`, text: null, reason: "unreadable" };
  if (st.size > WRITE_CHANGE_HASH_MAX_BYTES) return { exists: true, fingerprint: `size:${st.size}:${st.mtimeMs ?? "?"}`, text: null, reason: "large" };
  let bytes: Uint8Array;
  try { bytes = io.readFile(abs); } catch { return { exists: true, fingerprint: "error:read", text: null, reason: "unreadable" }; }
  const fingerprint = crypto.createHash("sha256").update(bytes).digest("hex");
  if (bytes.length > maxBytes) return { exists: true, fingerprint, text: null, reason: "large" };
  if (bytes.includes(0)) return { exists: true, fingerprint, text: null, reason: "binary" };
  try {
    return { exists: true, fingerprint, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { exists: true, fingerprint, text: null, reason: "binary" };
  }
}

/** The fingerprint alone, for the re-check after the answer. */
export const existingFingerprint = (abs: string, io?: ExistingTextFs): string => readExistingText(abs, io).fingerprint;

/**
 * The summary for one target, or null when there is nothing to summarise (the file does not exist yet).
 * `edit` is null when the call's text is unknown (a webview-origin request, a NotebookEdit, or several targets).
 */
export function writeChangeView(existing: ExistingText, edit: WriteEdit | null, relPath: string): WriteChangeView | null {
  if (!existing.exists) return null;
  if (existing.text === null) return { kind: "unknown", reason: existing.reason };
  if (!edit) return { kind: "unknown", reason: "no-edit" };
  const applied = applyWriteEditResult(existing.text, edit);
  if ("refused" in applied) return { kind: "unknown", reason: applied.refused satisfies WriteChangeUnknownReason };
  const after = applied.text;
  const r = diffGuard({ path: relPath, before: existing.text, after });
  const pct = r.changed_ratio > 0 && r.changed_ratio < 0.005 ? "1% 미만" : `${Math.round(r.changed_ratio * 100)}%`;
  return {
    kind: "measured",
    percent: r.approximate ? `약 ${pct}` : pct,
    ratio: r.changed_ratio,
    changedLines: r.changed_lines,
    addedLines: r.added_lines,
    rewrite: r.changed_ratio > REWRITE_RATIO,
    almostAll: r.changed_ratio >= ALMOST_ALL_RATIO,
    spacingOnly: r.verdict === "unchanged" && existing.text !== after,
  };
}
