// REQ-STUDIO-ACTIVITY-MEMORY-FILES (CGP-KNOW-R-030) — the activity's memory files as the 내 작품
// panel sees them. Dependency-free, so both the host (activityMemoryHost.ts) and the webview import it.

/** The store folder as the learner reads it, relative to the activity folder. */
export const MEMORY_FOLDER_LABEL = ".hypeproof/memory/";

/** REQ-STUDIO-ACTIVITY-MEMORY-STATE (CGP-KNOW-R-022) — memory is always on (DEC-01, DEC-02); there is no off label. */
export const MEMORY_STATE_LABEL = "AI 기억: 켜짐";

/**
 * REQ-STUDIO-ACTIVITY-MEMORY-SCOPE (CGP-KNOW-R-005) — the one scope a memory view has: this personal activity. A class
 * activity has no personal memory view, so there is no class wording and no way to change the scope.
 */
export const MEMORY_SCOPE_LABEL = "기억 범위: 이 작업 공간 안에서만 · 수업 활동에서는 이 기억을 읽거나 쓰지 않아요.";

/**
 * REQ-STUDIO-MEMORY-MANAGER (CGP-KNOW-R-023 / REQ-KNOW-41) — the task an item was kept from, as the host resolved it on
 * this listing. `task`: a listed task the learner can open (`id` is sent back with `taskSelect`); `archived`: the task is
 * in 보관함, which only 다시 열기 opens; `gone`: the file names a task this activity no longer has; `none`: no task recorded.
 */
export type MemorySource =
  | { kind: "task"; id: string; title: string }
  | { kind: "archived"; title: string }
  | { kind: "gone" }
  | { kind: "none" };

/** The words for a source that is not a link (and the prefix of the one that is). */
export const MEMORY_SOURCE_TEXT = {
  label: "남긴 작업",
  archived: (title: string) => `‘${title}’ · 보관함에 있는 작업이에요. 보관함에서 다시 열 수 있어요.`,
  gone: "작업을 찾을 수 없어요. 작업이 지워졌거나 다른 곳으로 옮겨졌을 수 있어요.",
  none: "어느 작업에서 남겼는지 기록이 없어요.",
} as const;

/**
 * One memory file. `text` is null when it is too large or not text: it is listed, opened and deleted, never shown inline.
 * `source` (REQ-STUDIO-MEMORY-MANAGER) is the task it was kept from; absent on an older host.
 */
export interface ActivityMemoryItem { name: string; at: number; text: string | null; source?: MemorySource }

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

/**
 * `correct` (REQ-STUDIO-MEMORY-OVERVIEW) replaces one item with the learner's own words. `deleteAll`
 * (REQ-STUDIO-MEMORY-MANAGER) removes the listed files the learner saw, after two native confirms.
 */
export type ActivityMemoryAction = "open" | "delete" | "correct" | "deleteAll";

/**
 * A host answer to one press. `cancelled`: the learner closed the native confirm; nothing changed. `unchanged`: a
 * correction that says the same thing as the item; nothing changed.
 */
export interface ActivityMemoryResult { action: ActivityMemoryAction; name?: string; cancelled?: boolean; unchanged?: boolean; error?: string; removed?: number; kept?: number }

/** The longest correction the webview sends and the host accepts (characters; the store caps an item at 2,000). */
export const MEMORY_CORRECTION_MAX = 2000;
export const MEMORY_NO_CHANGE = "바뀐 기억이 없어요.";

export function memoryResultNotice(result: ActivityMemoryResult): string {
  if (result.action === "correct") return result.unchanged ? MEMORY_NO_CHANGE : "기억을 고쳤어요.";
  if (result.action === "deleteAll") {
    const kept = result.kept ? ` ${result.kept}개는 남아 있어요. 목록에서 확인해 주세요.` : "";
    return `기억 파일 ${result.removed ?? 0}개를 지웠어요.${kept}`;
  }
  return result.action === "delete" ? `기억 파일 “${result.name ?? ""}”을 지웠어요.` : "";
}
