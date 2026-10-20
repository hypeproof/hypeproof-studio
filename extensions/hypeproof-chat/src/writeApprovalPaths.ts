// REQ-E1 / CGP-AGENT-R-005 — a write approval lists every path the tool call will write. Pure: no vscode.
//
// Only reachable when `writeFile` is in `hypeproofChat.requireApprovalFor` (it is not in the default list).
//
// What the learner reads, one line per path:
//   작업 폴더/src/app.js · 바꿈      — inside the work folder, relative to it;
//   작업 폴더 밖 · secrets.txt       — outside it, including a `..` escape and a symlink that resolves outside.
// Paths are compared after canonicalization (symlinks resolved on the nearest existing ancestor, the #2065
// `canonicalFolder` spelling), so `작업 폴더/link/x` where `link` points elsewhere is outside.
// Names are cleaned with the #2136 `cleanName` (C0/C1 controls, DEL, U+2028/2029, bidi controls), so a file name
// cannot fake a line or reorder the list.
//
// 새 파일 / 바꿈 are shown only when the tool input itself says so, never guessed from the disk:
//   Edit / MultiEdit whose edits all replace existing text (non-empty old_string)  → 바꿈
//   Edit / MultiEdit whose first edit has an empty old_string (the SDK's "create")  → 새 파일
//   NotebookEdit (edits a notebook that exists)                                    → 바꿈
//   Write (creates or overwrites; the input does not say which)                     → nothing
//
// The approval covers exactly the listed paths: `writeScopeKeys` is the canonical key set the modal was built
// from, and the gate re-derives it after the answer (`writeScopeCovered`) so a path that changed while the modal
// was open (a symlink swapped in) is refused instead of written.

import * as fs from "node:fs";
import * as path from "node:path";
import { OUTSIDE_WORK_FOLDER_TEXT, WORK_FOLDER_TEXT, workFolderPathDisplay } from "./browserTargetHost.ts";
import { canonicalFolder } from "./folderConsent.ts";

export { OUTSIDE_WORK_FOLDER_TEXT, WORK_FOLDER_TEXT };

/** Shown when a write call names no path at all (malformed input). */
export const UNNAMED_WRITE_TEXT = "이름 없는 파일";
/** How many paths the modal lists before "외 N개". */
export const WRITE_PATHS_SHOWN = 8;
export const WRITE_CHANGE_TEXT = { new: "새 파일", changed: "바꿈" } as const;
export type WriteChange = keyof typeof WRITE_CHANGE_TEXT;

export interface WriteTarget {
  path: string;
  change?: WriteChange;
}

const WRITE_TOOL_NAMES = new Set(["write", "edit", "multiedit", "notebookedit"]);
const PATH_KEYS = ["file_path", "path", "notebook_path"] as const;

export const isWriteToolName = (toolName: string): boolean => WRITE_TOOL_NAMES.has(toolName.toLowerCase());

function changeOf(toolName: string, input: Record<string, unknown>): WriteChange | undefined {
  const name = toolName.toLowerCase();
  if (name === "notebookedit") return "changed";
  const edits: unknown[] =
    name === "edit" ? [input] : name === "multiedit" && Array.isArray(input.edits) ? input.edits : [];
  if (edits.length === 0) return undefined;
  const olds = edits.map((e) => (e && typeof e === "object" ? (e as Record<string, unknown>).old_string : undefined));
  if (olds.some((o) => typeof o !== "string")) return undefined;
  if (olds[0] === "") return "new";
  return olds.every((o) => o !== "") ? "changed" : undefined;
}

/**
 * Every path a write tool call names, in input order, without duplicates. Today each SDK write tool names one
 * path (`file_path` / `notebook_path`); a payload that carries several is listed whole.
 */
export function writeTargetsOf(toolName: string, input: unknown): WriteTarget[] {
  if (!isWriteToolName(toolName) || !input || typeof input !== "object") return [];
  const rec = input as Record<string, unknown>;
  const change = changeOf(toolName, rec);
  const out: WriteTarget[] = [];
  for (const key of PATH_KEYS) {
    const v = rec[key];
    if (typeof v === "string" && v.trim() && !out.some((t) => t.path === v)) out.push(change ? { path: v, change } : { path: v });
  }
  return out;
}

/** Targets from an ActionRequest payload: `paths` when present, else the single `path`. */
export function writeTargetsFromPayload(payload: unknown): WriteTarget[] {
  if (!payload || typeof payload !== "object") return [];
  const rec = payload as { path?: unknown; paths?: unknown };
  if (Array.isArray(rec.paths)) {
    return rec.paths.flatMap((t): WriteTarget[] => {
      if (typeof t === "string") return t.trim() ? [{ path: t }] : [];
      if (!t || typeof t !== "object" || typeof (t as WriteTarget).path !== "string" || !(t as WriteTarget).path.trim()) return [];
      const c = (t as WriteTarget).change;
      return [c === "new" || c === "changed" ? { path: (t as WriteTarget).path, change: c } : { path: (t as WriteTarget).path }];
    });
  }
  return typeof rec.path === "string" && rec.path.trim() ? [{ path: rec.path }] : [];
}

type Realpath = (p: string) => string;

/**
 * One spelling of a write target: the nearest EXISTING ancestor through `canonicalFolder` (#2065: symlinks
 * resolved, on-disk case, upper-case drive), the not-yet-existing tail re-appended. A new file has no realpath
 * of its own, so the folder it lands in decides where it really goes.
 */
export function canonicalWriteTarget(p: string, realpath: Realpath = fs.realpathSync.native): string {
  let base = path.resolve(p);
  const tail: string[] = [];
  for (;;) {
    try {
      const real = canonicalFolder(base, realpath);
      return tail.length ? path.join(real, ...tail.reverse()) : real;
    } catch {
      const parent = path.dirname(base);
      if (parent === base) return path.resolve(p);
      tail.push(path.basename(base));
      base = parent;
    }
  }
}

export interface WritePathEntry {
  /** What the learner reads, without the change tag. */
  display: string;
  outside: boolean;
  change?: WriteChange;
  /** Canonical absolute path: what the approval covers. */
  key: string;
}

/** Each target relative to the work folder, marked when it is outside. No work folder → every path is outside. */
export function writePathEntries(
  targets: readonly WriteTarget[],
  workspaceRoot: string | null | undefined,
  realpath: Realpath = fs.realpathSync.native,
): WritePathEntry[] {
  let root: string | null = null;
  if (workspaceRoot) {
    try { root = canonicalFolder(workspaceRoot, realpath); } catch { root = path.resolve(workspaceRoot); }
  }
  return targets.map((t) => {
    const abs = root && !path.isAbsolute(t.path) ? path.resolve(root, t.path) : path.resolve(t.path);
    const key = canonicalWriteTarget(abs, realpath);
    const shown = workFolderPathDisplay(key, root);
    return { display: shown.text, outside: !shown.inside, ...(t.change ? { change: t.change } : {}), key };
  });
}

export const writePathLine = (e: WritePathEntry): string => (e.change ? `${e.display} · ${WRITE_CHANGE_TEXT[e.change]}` : e.display);

/** The "see all" button, naming the real total. */
export const writePathsAllLabel = (total: number): string => `전체 목록 보기 (${total}개)`;

export interface WriteApprovalCopy {
  /** Modal message: title, blank line, up to `max` paths, then "외 N개" when some are hidden. */
  message: string;
  /** Present only when paths are hidden: the button that opens the full list. */
  allLabel?: string;
  /** Message of the full-list modal (every path), present with `allLabel`. */
  allMessage?: string;
  hidden: number;
}

export function writeApprovalCopy(title: string, entries: readonly WritePathEntry[], max = WRITE_PATHS_SHOWN): WriteApprovalCopy {
  const lines = entries.map(writePathLine);
  if (lines.length === 0) return { message: `${title}\n\n${UNNAMED_WRITE_TEXT}`, hidden: 0 };
  const shown = lines.slice(0, max);
  const hidden = lines.length - shown.length;
  if (hidden <= 0) return { message: `${title}\n\n${shown.join("\n")}`, hidden: 0 };
  return {
    message: `${title}\n\n${shown.join("\n")}\n외 ${hidden}개`,
    allLabel: writePathsAllLabel(lines.length),
    allMessage: `${title}\n\n모두 ${lines.length}개:\n${lines.join("\n")}`,
    hidden,
  };
}

/** The canonical paths an approval for this call covers, in order. */
export function writeScopeKeys(toolName: string, input: unknown, workspaceRoot: string | null | undefined, realpath?: Realpath): string[] {
  return writePathEntries(writeTargetsOf(toolName, input), workspaceRoot, realpath).map((e) => e.key);
}

/** The tool result when a write no longer matches what was approved. */
export const WRITE_SCOPE_CHANGED_MESSAGE = "승인한 파일 목록에 없는 곳에 쓰려고 해서 막았어요. 다시 요청해 주세요.";

/** True when every path the call would write now is one the approval listed. */
export function writeScopeCovered(approved: readonly string[], now: readonly string[]): boolean {
  return now.length > 0 && now.every((k) => approved.includes(k));
}
