// REQ-STUDIO-ACTIVITY-MEMORY-FILES (CGP-KNOW-R-030) — the activity's memory files as the 내 작품
// panel sees them. Dependency-free, so both the host (activityMemoryHost.ts) and the webview import it.

/** The store folder as the learner reads it, relative to the activity folder. */
export const MEMORY_FOLDER_LABEL = ".hypeproof/memory/";

/** REQ-STUDIO-ACTIVITY-MEMORY-STATE (CGP-KNOW-R-022) — memory is always on (DEC-01, DEC-02); there is no off label. */
export const MEMORY_STATE_LABEL = "AI 기억: 켜짐";

/** One memory file. `text` is null when it is too large or not text: it is listed, opened and deleted, never shown inline. */
export interface ActivityMemoryItem { name: string; at: number; text: string | null }

/** `scope` binds every action to the task and activity it was listed for. */
export interface ActivityMemoryView {
  scope: string;
  folder: string;
  entries: ActivityMemoryItem[];
  /** Files in the folder that are not listed (unsafe names, links, folders, past the cap). */
  other: number;
  /** The folder is a link or not a folder: Studio read nothing from it. */
  unsafe: boolean;
}

export type ActivityMemoryAction = "open" | "delete";

/** A host answer to one press. `cancelled`: the learner closed the native confirm; nothing changed. */
export interface ActivityMemoryResult { action: ActivityMemoryAction; name?: string; cancelled?: boolean; error?: string }

export function memoryResultNotice(result: ActivityMemoryResult): string {
  return result.action === "delete" ? `기억 파일 “${result.name ?? ""}”을 지웠어요.` : "";
}
