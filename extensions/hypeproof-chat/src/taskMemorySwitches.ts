// CGP-KNOW-R-028 / DES-KNOW-46 (REQ-KNOW-46) — two per-task memory switches, vscode-free so a test drives what
// the host runs:
//   - "이 작업에서 기억 쓰기" (use): whether this task's requests carry the activity's memory (REQ-STUDIO-MEMORY-USE).
//     It is fixed once the task has a sent message, so a conversation never changes what it was built on halfway.
//   - "이 작업을 기억에 남기기" (keep): whether anything from this task may be written to memory. Off: the remember tool is
//     not offered and every memory write from this task's turns is refused (the same path as REQ-KNOW-47).
// Both default on, which is today's behaviour. No Service profile key serves other defaults yet (DEC-01: memory is
// always on); a key can be read here later without changing the ledger.
//
// The ledger lives in workspaceState next to the memory-use ledger: per activity scope, per task id, two booleans.
// No memory text, no task title, nothing outside this device.

import * as fs from "node:fs";
import * as path from "node:path";

export const TASK_MEMORY_KEY = "hps.taskMemory.v1";
/** Ledger bounds: activity scopes kept, tasks per scope (oldest entries go first). */
export const TASK_MEMORY_MAX = { scopes: 50, tasks: 200 } as const;

export interface TaskMemorySwitches { use: boolean; keep: boolean }
export type TaskMemoryLedger = Record<string, Record<string, TaskMemorySwitches>>;

export const TASK_MEMORY_DEFAULT: TaskMemorySwitches = Object.freeze({ use: true, keep: true });

export const TASK_MEMORY_COPY = {
  legend: "이 작업의 기억",
  use: "이 작업에서 기억 쓰기",
  useHint: "켜 두면 이 작업의 질문에 기억 파일의 내용을 함께 보내요.",
  useLocked: "첫 메시지를 보낸 뒤에는 바꿀 수 없어요. 새 작업에서 다시 정할 수 있어요.",
  keep: "이 작업을 기억에 남기기",
  keepHint: "끄면 이 작업에서는 새 기억을 남기지 않아요.",
  /** The refusal a memory write from a no-keep task gets (timeline line and the remember tool). */
  keepRefusal: "이 작업은 기억에 남기지 않게 해 두었어요",
  /** The refusal a coach tool reading the memory files gets in a task with use off. */
  useRefusal: "이 작업에서는 기억을 쓰지 않게 해 두었어요",
} as const;

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A stored ledger, or an empty one. Anything malformed is dropped entry by entry (fail to the default: on). */
export function acceptTaskMemory(value: unknown): TaskMemoryLedger {
  const out: TaskMemoryLedger = {};
  if (!isRecord(value)) return out;
  for (const [scope, tasks] of Object.entries(value).slice(-TASK_MEMORY_MAX.scopes)) {
    if (typeof scope !== "string" || !scope || scope.length > 256 || !isRecord(tasks)) continue;
    const kept: Record<string, TaskMemorySwitches> = {};
    for (const [task, sw] of Object.entries(tasks).slice(-TASK_MEMORY_MAX.tasks)) {
      if (!ID.test(task) || !isRecord(sw) || typeof sw.use !== "boolean" || typeof sw.keep !== "boolean") continue;
      kept[task] = { use: sw.use, keep: sw.keep };
    }
    if (Object.keys(kept).length) out[scope] = kept;
  }
  return out;
}

export function switchesFor(ledger: TaskMemoryLedger, scope: string, taskId: string | null | undefined): TaskMemorySwitches {
  if (!taskId) return { ...TASK_MEMORY_DEFAULT };
  const sw = ledger[scope]?.[taskId];
  return sw ? { ...sw } : { ...TASK_MEMORY_DEFAULT };
}

/** The use switch is fixed once the task has a sent message. */
export function useLocked(messageCount: number): boolean {
  return messageCount > 0;
}

export type SetResult = { ok: true; ledger: TaskMemoryLedger } | { ok: false; reason: "locked" | "invalid" };

/**
 * One change from the settings dialog. `use` is refused while locked (the host decides the lock from the task's
 * own message count, never from the webview). Entries equal to the default are removed, so the ledger stays small.
 */
export function setSwitches(ledger: TaskMemoryLedger, scope: string, taskId: string, change: Partial<TaskMemorySwitches>, locked: boolean): SetResult {
  if (!scope || !ID.test(taskId)) return { ok: false, reason: "invalid" };
  const keys = Object.keys(change);
  if (!keys.length || keys.some((k) => (k !== "use" && k !== "keep") || typeof (change as Record<string, unknown>)[k] !== "boolean")) return { ok: false, reason: "invalid" };
  const current = switchesFor(ledger, scope, taskId);
  if (change.use !== undefined && change.use !== current.use && locked) return { ok: false, reason: "locked" };
  const next = { ...current, ...change };
  const tasks = { ...(ledger[scope] ?? {}) };
  delete tasks[taskId];
  if (next.use !== TASK_MEMORY_DEFAULT.use || next.keep !== TASK_MEMORY_DEFAULT.keep) tasks[taskId] = next;
  const bounded = Object.fromEntries(Object.entries(tasks).slice(-TASK_MEMORY_MAX.tasks));
  const out: TaskMemoryLedger = { ...ledger };
  delete out[scope];
  if (Object.keys(bounded).length) out[scope] = bounded;
  return { ok: true, ledger: Object.fromEntries(Object.entries(out).slice(-TASK_MEMORY_MAX.scopes)) };
}

/** What the settings dialog draws for the open task. */
export interface TaskMemoryView { taskId: string; use: boolean; keep: boolean; useLocked: boolean }

/**
 * A path as the file system will resolve it: the real path of its deepest existing ancestor (links followed), then the
 * rest of the segments. So `<root>/link/a.md` with `link -> .hypeproof/memory` lands inside the memory folder.
 */
export function canonicalPath(p: string): string {
  let cur = path.resolve(p);
  const rest: string[] = [];
  for (;;) {
    try { return path.join(fs.realpathSync.native(cur), ...rest.reverse()); } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return path.resolve(p);
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

/** macOS (APFS default) and Windows compare names without case: `.HYPEPROOF/MEMORY` is the same folder there. */
export function foldsCase(platform: string = process.platform): boolean {
  return platform === "darwin" || platform === "win32";
}

/** True when `target` is the memory folder or inside it, after links are resolved and case is folded where the OS does. */
export function insideFolder(folder: string, target: string, platform: string = process.platform): boolean {
  const fold = (p: string) => (foldsCase(platform) ? p.toLowerCase() : p);
  const rel = path.relative(fold(canonicalPath(folder)), fold(canonicalPath(target)));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
