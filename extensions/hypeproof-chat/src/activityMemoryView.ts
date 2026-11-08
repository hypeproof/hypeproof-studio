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
 * CGP-KNOW-D-005 (DES-KNOW-07) — the scope words of the activity header and settings line, after the state. The one scope
 * the store enforces (CGP-KNOW-R-005): this personal or trial activity. There is no class wording because a class seat has
 * no memory store and therefore no line.
 */
export const MEMORY_SCOPE_HEADER = "이 작업 공간 안에서만";

/** CGP-KNOW-D-005 — the one sentence the header line's tooltip and accessible text give for the scope. */
/** CGP-KNOW-D-005 / R-029: a "기록 없이 묻기" task reads memory but writes none; the header says so (agent-chosen copy). */
export const MEMORY_TEMPORARY_NOTE = "이 작업은 기억에 남기지 않아요";
export const MEMORY_TEMPORARY_SENTENCE = "이 작업은 기억을 읽기만 하고 새로 남기지 않아요.";
export const MEMORY_SCOPE_SENTENCE = `AI 기억은 이 작업 공간의 ${MEMORY_FOLDER_LABEL} 폴더에만 남고, 수업 활동에서는 이 기억을 읽거나 쓰지 않아요.`;

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
export interface ActivityMemoryItem {
  name: string; at: number; text: string | null; source?: MemorySource;
  /**
   * CGP-KNOW-D-023 — the file's identity as listed (a digest of device, inode, change and birth time, size and content). A
   * delete the learner confirmed in the chat's own dialog names it; the host deletes only that exact file.
   */
  pin?: string;
}

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
  /** REQ-STUDIO-MEMORY-CAPACITY (CGP-KNOW-R-024) — how many files the store takes before new writes are refused. */
  limit?: number;
}

/**
 * `correct` (REQ-STUDIO-MEMORY-OVERVIEW) replaces one item with the learner's own words. `deleteAll`
 * (REQ-STUDIO-MEMORY-MANAGER) removes the listed files the learner saw, after two native confirms.
 */
export type ActivityMemoryAction = "open" | "delete" | "correct" | "deleteAll" | "deleteOld";

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
  if (result.action === "deleteOld") {
    const kept = result.kept ? ` ${result.kept}개는 지우지 못했어요. 목록에서 확인해 주세요.` : "";
    return `오래된 기억 ${result.removed ?? 0}개를 지웠어요.${kept}`;
  }
  if (result.action === "deleteAll") {
    const kept = result.kept ? ` ${result.kept}개는 남아 있어요. 목록에서 확인해 주세요.` : "";
    return `기억 파일 ${result.removed ?? 0}개를 지웠어요.${kept}`;
  }
  return result.action === "delete" ? `기억 파일 “${result.name ?? ""}”을 지웠어요.` : "";
}

/**
 * REQ-STUDIO-MEMORY-CAPACITY (CGP-KNOW-R-024 / REQ-KNOW-42) — memory capacity as used/limit, never a purchase. Every
 * file in the folder counts (the store refuses a new one at the limit). From 90% a notice offers 오래된 기억 정리, which
 * picks the oldest items until the store is back at 80%; the learner can change the pick, and the host deletes only
 * listed files after its own two native confirms (the R-023 delete).
 */
export const MEMORY_CAPACITY = { near: 0.9, after: 0.8 } as const;
export type MemoryCapacityLevel = "ok" | "near" | "full";
export function memoryCapacity(used: number, limit: number): { used: number; limit: number; level: MemoryCapacityLevel; percent: number } {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 1;
  const count = Math.max(0, Math.floor(used));
  const level: MemoryCapacityLevel = count >= safeLimit ? "full" : count >= Math.ceil(safeLimit * MEMORY_CAPACITY.near) ? "near" : "ok";
  return { used: count, limit: safeLimit, level, percent: Math.min(100, Math.round((count / safeLimit) * 100)) };
}
/** How many of the oldest items 오래된 기억 정리 picks first: enough to bring the store back to 80%, at least one. */
export function memoryCleanupCount(used: number, limit: number): number {
  return Math.max(1, used - Math.floor(limit * MEMORY_CAPACITY.after));
}
export const MEMORY_CAPACITY_COPY = {
  line: (used: number, limit: number) => `기억 ${used}/${limit}개`,
  near: (used: number, limit: number) => `기억이 거의 찼어요. ${limit}개까지 남길 수 있고 지금 ${used}개예요.`,
  full: (limit: number, canCorrect: boolean) => `기억이 가득 찼어요. ${limit}개가 다 차서 새 기억은 남지 않아요. 있는 기억은 ${canCorrect ? '고치거나 ' : ''}지울 수 있어요.`,
  cleanup: "오래된 기억 정리",
  pickTitle: "지울 오래된 기억",
  pickNote: (n: number) => `오래된 것부터 ${n}개를 골라 두었어요. 남길 기억은 체크를 풀어 주세요.`,
  confirm: (n: number) => `고른 기억 ${n}개 지우기…`,
  cancel: "취소",
} as const;

/** CGP-KNOW-D-023 (DES-KNOW-41) — the "AI가 기억하는 것" list in 대화 설정, in the learner's words. */
export const MEMORY_SETTINGS_COPY = {
  title: "AI가 기억하는 것",
  empty: "아직 기억하는 게 없어요",
  noMatch: "찾는 기억이 없어요",
  search: "기억 찾기",
  delete: "지우기",
  confirmTitle: "이 기억을 지울까요?",
  confirmNote: "지운 기억은 되돌릴 수 없어요. 다음 질문부터 AI에게 보내지 않아요.",
  cancel: "취소",
  deleted: "기억을 지웠어요.",
} as const;
