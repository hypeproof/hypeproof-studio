// CGP-KNOW-D-013 (DES-KNOW-24) — the activity trash as the 내 작품 panel sees it. Dependency-free,
// so both the host (activityTrashCommands.ts) and the webview import it.

/** One restorable item: an opaque store id, its original relative path and deletion time. */
export interface ActivityTrashItem { id: string; path: string; at: number }

/** The current activity's trash. `scope` binds every action to the task and activity it was listed for. */
export interface ActivityTrashView { scope: string; entries: ActivityTrashItem[]; damaged: number }

export type ActivityTrashAction = "move" | "restore" | "purge";

/** A host answer to one press. `cancelled`: the learner closed the native confirm; nothing changed. */
export interface ActivityTrashResult {
  action: ActivityTrashAction;
  id?: string;
  path?: string;
  renamed?: boolean;
  cancelled?: boolean;
  error?: string;
}

/** The toast copy DES-KNOW-24 fixes, and how long it stays when nothing holds it. */
export const TRASH_TOAST_TEXT = "휴지통으로 옮겼어요";
export const TRASH_UNDO_LABEL = "되돌리기";
export const TRASH_TOAST_MS = 8000;

/** What the toast says after an answer. Undo only exists right after a move. */
export function trashResultNotice(result: ActivityTrashResult): string {
  if (result.action === "move") return TRASH_TOAST_TEXT;
  if (result.action === "purge") return "영구 삭제했어요.";
  return result.renamed
    ? `같은 이름의 파일이 있어 “${result.path ?? ""}” 이름으로 복원했어요.`
    : `“${result.path ?? ""}” 파일을 복원했어요.`;
}
