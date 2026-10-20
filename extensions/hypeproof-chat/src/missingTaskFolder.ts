// REQ-STUDIO-MISSING-TASK-FOLDER (CGP-AGENT-R-028 / REQ-CGP-AGENT-57, DES-CGP-AGENT-57).
//
// A personal task runs in its activity's work folder. When that folder was moved, renamed
// or deleted (or cannot be read), Studio shows one calm notice in the chat with one action,
// 다시 고르기, instead of failing the send with a generic error. The draft and the
// conversation stay; no turn starts while the folder is missing.
//
// Classroom and lesson seats never get this notice: their folder is served by the class,
// and choosing another one is not the learner's call. They keep the existing refusal.
//
// Pure apart from the injectable stat: no vscode, no DOM. The host wiring is in
// chatPanelProvider.ts (missingTaskFolderPath / repickTaskFolder).

import * as fs from "node:fs";
import * as path from "node:path";

export const MISSING_TASK_FOLDER_COPY = "이 작업의 폴더를 찾을 수 없어요. 옮기거나 지웠다면 폴더를 다시 골라 주세요.";
export const MISSING_TASK_FOLDER_ACTION = "다시 고르기";
/** The folder picker's own button and title. */
export const MISSING_TASK_FOLDER_PICK_LABEL = "이 폴더로 이어서 하기";
export const MISSING_TASK_FOLDER_PICK_TITLE = "작업 폴더 다시 고르기";
/** One extra line under the notice when the pick did not move the task. */
export const MISSING_TASK_FOLDER_NOT_A_FOLDER = "고른 곳을 열 수 없어요. 다른 폴더를 골라 주세요.";
export const MISSING_TASK_FOLDER_UNDECIDED = "이 폴더에서 AI가 할 수 있는 일을 고르면 이 작업을 옮겨요. 입력은 그대로 두었어요.";
export const MISSING_TASK_FOLDER_FAILED = "이 폴더로 옮기지 못했어요. 다른 폴더를 골라 주세요. 입력은 그대로 두었어요.";

export interface MissingTaskFolderNotice {
  message: string;
  action: string;
  /** Why the last 다시 고르기 did not move the task, when it did not. */
  note?: string;
}

/** Is `p` a folder Studio can open right now? A missing path, a file or an unreadable entry is not. */
export function folderReachable(p: string, stat: (p: string) => { isDirectory(): boolean } = fs.statSync): boolean {
  try { return stat(p).isDirectory(); } catch { return false; }
}

/**
 * The task's folder when it is missing, else null. `applies` is false for classroom and
 * lesson seats, the instructor surface and any seat without personal tasks; `folder` is
 * the open folder, or the activity's recorded folder when none is open. No folder known
 * is not "missing": the existing entry path asks for one.
 */
export function missingTaskFolder(args: {
  applies: boolean;
  folder: string | null | undefined;
  reachable?: (p: string) => boolean;
}): string | null {
  if (!args.applies || !args.folder) return null;
  return (args.reachable ?? folderReachable)(args.folder) ? null : path.resolve(args.folder);
}

/** The webview's view of the notice: null hides it. */
export function missingTaskFolderNotice(missing: string | null, note?: string): MissingTaskFolderNotice | null {
  if (!missing) return null;
  return { message: MISSING_TASK_FOLDER_COPY, action: MISSING_TASK_FOLDER_ACTION, ...(note ? { note } : {}) };
}

export type RepickedFolder =
  | { kind: "cancel" }
  | { kind: "invalid" }
  | { kind: "ok"; folder: string };

/**
 * What the picker returned. A pick that is not an existing folder never moves the task;
 * a valid pick is returned in its canonical spelling (symlinks resolved, on-disk case,
 * upper-case drive letter) so the consent key and the activity binding name one folder.
 */
export function repickedFolder(
  picked: string | null | undefined,
  canonical: (p: string) => string,
  reachable: (p: string) => boolean = folderReachable,
): RepickedFolder {
  if (!picked) return { kind: "cancel" };
  if (!reachable(picked)) return { kind: "invalid" };
  try { return { kind: "ok", folder: canonical(picked) }; } catch { return { kind: "invalid" }; }
}
