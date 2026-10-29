// REQ-STUDIO-ACTIVITY-MEMORY-FILES (CGP-KNOW-R-030) — the activity's memory files as the 내 작품
// panel sees them. Dependency-free, so both the host (activityMemoryHost.ts) and the webview import it.

/** The store folder as the learner reads it, relative to the activity folder. */
export const MEMORY_FOLDER_LABEL = ".hypeproof/memory/";

/** REQ-STUDIO-ACTIVITY-MEMORY-STATE (CGP-KNOW-R-022) — memory is always on (DEC-01, DEC-02); there is no off label. */
export const MEMORY_STATE_LABEL = "AI 기억: 켜짐";

/** One memory file. `text` is null when it is too large or not text: it is listed, opened and deleted, never shown inline. */
export interface ActivityMemoryItem { name: string; at: number; text: string | null }

/** REQ-STUDIO-MEMORY-OVERVIEW (CGP-KNOW-R-025) — one remembered item as the overview shows it. */
export interface MemoryOverviewItem { name: string; at: number; text: string }
/** The items kept from one task. `task` is null for items with no recorded task; `title` is what the learner reads. */
export interface MemoryOverviewGroup { task: string | null; title: string; items: MemoryOverviewItem[] }
/** Stated facts grouped by task. `withheld` counts items left out because they read as an ability, personality or capability statement. */
export interface MemoryOverview { groups: MemoryOverviewGroup[]; withheld: number }

/** `scope` binds every action to the task and activity it was listed for. */
export interface ActivityMemoryView {
  scope: string;
  folder: string;
  entries: ActivityMemoryItem[];
  /** Files in the folder that are not listed (unsafe names, links, folders, past the cap). */
  other: number;
  /** The folder is a link or not a folder: Studio read nothing from it. */
  unsafe: boolean;
  /** REQ-STUDIO-MEMORY-OVERVIEW — null on a minor or unknown cohort, where there is no overview. */
  overview: MemoryOverview | null;
}

/** `correct` (REQ-STUDIO-MEMORY-OVERVIEW) replaces one item with the learner's own words. */
export type ActivityMemoryAction = "open" | "delete" | "correct";

/**
 * A host answer to one press. `cancelled`: the learner closed the native confirm; nothing changed. `unchanged`: a
 * correction that says the same thing as the item; nothing changed.
 */
export interface ActivityMemoryResult { action: ActivityMemoryAction; name?: string; cancelled?: boolean; unchanged?: boolean; error?: string }

/** The longest correction the webview sends and the host accepts (characters; the store caps an item at 2,000). */
export const MEMORY_CORRECTION_MAX = 2000;
export const MEMORY_NO_CHANGE = "바뀐 기억이 없어요.";

export function memoryResultNotice(result: ActivityMemoryResult): string {
  if (result.action === "correct") return result.unchanged ? MEMORY_NO_CHANGE : "기억을 고쳤어요.";
  return result.action === "delete" ? `기억 파일 “${result.name ?? ""}”을 지웠어요.` : "";
}
