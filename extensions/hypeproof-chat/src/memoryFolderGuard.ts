// CGP-KNOW-R-028 follow-up (#4014) — the turn-end check of a keep-off task's memory folder. vscode-free.
//
// With "이 작업을 기억에 남기기" off, the host already refuses every memory write it can see (the remember tool, the
// memory write path, the SDK file tools and shell commands naming `.hypeproof`). A shell command that builds the path
// at run time, or the local CLI runtime's shell, can still reach `.hypeproof/memory/`. So a keep-off turn takes a
// snapshot of the folder when it starts and compares it when it ends. Whatever the turn added, changed or deleted is
// put back:
//   - an added file is moved out of the store into a quarantine folder (nothing is deleted);
//   - a changed file gets its earlier bytes back, and the turn's version goes to the quarantine;
//   - a deleted file is restored from the snapshot.
// Changes Studio itself made during the turn (its memory list, an undo, the learner's own save in the editor) are
// recorded in the journal below and are left alone. Nothing here reads or sends memory text anywhere else.

import { createHash } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import * as path from "node:path";
import { MEMORY_FOLDER, MEMORY_LIMITS, observeMemoryChanges } from "./activityMemory.ts";

/**
 * Bounds of one snapshot, from the store's own limits: at most this many entries (the item count plus room for stray
 * files; more and the turn is not checked, and says so), and file bytes are read only up to the item size. A larger
 * file is compared by its size, change time and inode, never read.
 */
export const SNAPSHOT_MAX = { files: MEMORY_LIMITS.items + 50, keepBytes: MEMORY_LIMITS.bytes } as const;
/**
 * The quarantine of a keep-off turn's writes, bounded by the store's limits too: per seat activity at most the store's
 * item count and that many full items' bytes, oldest removed first, and nothing older than seven days. It lives in the
 * extension's global storage (this OS account only, folders 0700, files 0600), one folder per activity scope and task;
 * a task's folder goes when the task is archived or moved. Nothing reads it back into memory, uploads it or logs it.
 */
export const QUARANTINE_LIMITS = { files: MEMORY_LIMITS.items, bytes: MEMORY_LIMITS.items * MEMORY_LIMITS.bytes, retentionMs: 7 * 24 * 3600_000 } as const;

export interface SnapEntry { size: number; digest: string; bytes: Buffer | null }
export type Snapshot = Map<string, SnapEntry>;
/** More entries than SNAPSHOT_MAX.files: the turn is not checked (and the turn says so). */
export const TOO_MANY = "too_many" as const;

const digestOf = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** The real memory folder of a work folder root, or null when it is missing or not a plain folder (never followed). */
async function folderOf(root: string): Promise<string | null> {
  let dir = await fs.realpath(root).catch(() => null);
  if (!dir) return null;
  for (const part of MEMORY_FOLDER) {
    dir = path.join(dir, part);
    const stat = await fs.lstat(dir).catch(() => null);
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) return null;
  }
  return dir;
}

/** The folder's regular files with size, digest and (up to the item size) bytes; TOO_MANY past the entry bound. */
export async function snapshotMemoryFolder(root: string): Promise<Snapshot | typeof TOO_MANY> {
  const dir = await folderOf(root);
  const snap: Snapshot = new Map();
  if (!dir) return snap;
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  if (names.length > SNAPSHOT_MAX.files) return TOO_MANY;
  for (const name of names) {
    const file = path.join(dir, name);
    const stat = await fs.lstat(file).catch(() => null);
    if (!stat?.isFile()) continue;
    if (stat.size > SNAPSHOT_MAX.keepBytes) {
      // Never read: too large to be a memory item or to be kept. Compared by its stat only.
      snap.set(name, { size: stat.size, digest: `stat:${stat.size}:${stat.mtimeMs}:${stat.ino}`, bytes: null });
      continue;
    }
    const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => null);
    if (!handle) continue;
    try {
      const bytes = await handle.readFile();
      if (bytes.length > SNAPSHOT_MAX.keepBytes) { snap.set(name, { size: bytes.length, digest: `stat:${bytes.length}:${stat.mtimeMs}:${stat.ino}`, bytes: null }); continue; }
      snap.set(name, { size: bytes.length, digest: digestOf(bytes), bytes });
    } finally { await handle.close(); }
  }
  return snap;
}

export interface SnapDiff { added: string[]; changed: string[]; removed: string[] }

export function diffSnapshots(before: Snapshot, after: Snapshot): SnapDiff {
  const added: string[] = [], changed: string[] = [], removed: string[] = [];
  for (const [name, entry] of after) {
    const old = before.get(name);
    if (!old) added.push(name); else if (old.digest !== entry.digest) changed.push(name);
  }
  for (const name of before.keys()) if (!after.has(name)) removed.push(name);
  return { added: added.sort(), changed: changed.sort(), removed: removed.sort() };
}

// ---- The journal of Studio's own memory-folder changes ----
type JournalEntry = { dir: string; name: string; digest: string | null; at: number };
const journal: JournalEntry[] = [];
const JOURNAL_MAX = 500;

/**
 * Studio made this change to a memory file (its memory list, an undo, the learner's save in the editor).
 * `digest` is the file's content digest after the change, or null for a removal.
 */
export async function noteStudioMemoryChange(dir: string, name: string, bytes: Buffer | null, at = Date.now()): Promise<void> {
  const real = await fs.realpath(dir).catch(() => dir);
  journal.push({ dir: real, name, digest: bytes ? digestOf(bytes) : null, at });
  while (journal.length > JOURNAL_MAX) journal.shift();
}

function studioMade(dir: string, name: string, digest: string | null, since: number): boolean {
  return journal.some((e) => e.at >= since && e.dir === dir && e.name === name && e.digest === digest);
}

// Every change ActivityMemory makes is journaled synchronously (its folder path is already the real one).
observeMemoryChanges((dir, name, bytes) => {
  journal.push({ dir, name, digest: bytes ? digestOf(bytes) : null, at: Date.now() });
  while (journal.length > JOURNAL_MAX) journal.shift();
});

/** For tests only: start from an empty journal. */
export function clearStudioMemoryJournal(): void { journal.length = 0; }

export interface RevertResult { reverted: number; kept: number; failed: number }

/** Removes quarantined copies older than the retention, then the oldest past the per-activity count and byte caps. */
export async function pruneQuarantine(base: string, now = Date.now()): Promise<void> {
  const scopes = await fs.readdir(base).catch(() => [] as string[]);
  for (const scope of scopes) {
    const scopeDir = path.join(base, scope);
    const files: Array<{ file: string; at: number; size: number }> = [];
    for (const task of await fs.readdir(scopeDir).catch(() => [] as string[])) {
      const taskDir = path.join(scopeDir, task);
      for (const name of await fs.readdir(taskDir).catch(() => [] as string[])) {
        const file = path.join(taskDir, name);
        const stat = await fs.lstat(file).catch(() => null);
        if (!stat) continue;
        if (!stat.isFile() || now - stat.mtimeMs > QUARANTINE_LIMITS.retentionMs) { await fs.rm(file, { force: true }).catch(() => undefined); continue; }
        files.push({ file, at: stat.mtimeMs, size: stat.size });
      }
      if (!(await fs.readdir(taskDir).catch(() => [])).length) await fs.rmdir(taskDir).catch(() => undefined);
    }
    files.sort((a, b) => b.at - a.at);
    let count = 0, bytes = 0;
    for (const f of files) {
      count++; bytes += f.size;
      if (count > QUARANTINE_LIMITS.files || bytes > QUARANTINE_LIMITS.bytes) await fs.rm(f.file, { force: true }).catch(() => undefined);
    }
    if (!(await fs.readdir(scopeDir).catch(() => [])).length) await fs.rmdir(scopeDir).catch(() => undefined);
  }
}

/** Removes one task's quarantine (the task was archived or moved). */
export async function purgeTaskQuarantine(base: string, scopeKey: string, taskKey: string): Promise<void> {
  if (!/^[0-9a-f]{24}$/.test(scopeKey) || !/^[A-Za-z0-9_-]{1,128}$/.test(taskKey)) return;
  await fs.rm(path.join(base, scopeKey, taskKey), { recursive: true, force: true }).catch(() => undefined);
}

/**
 * Puts the folder back to `before` for every change not recorded as Studio's own since `since`. Anything the turn
 * wrote is moved or copied into `quarantine` first, so nothing is lost. A file too large to have been kept in the
 * snapshot cannot be restored: its current version is still quarantined and it counts as failed.
 */
export async function revertTurnChanges(root: string, before: Snapshot, since: number, quarantine: string, now = Date.now()): Promise<RevertResult | typeof TOO_MANY> {
  const dir = await folderOf(root);
  const result: RevertResult = { reverted: 0, kept: 0, failed: 0 };
  if (!dir) {
    // The whole folder was removed or replaced by something that is not a plain folder: nothing is touched.
    if (before.size) result.failed = before.size;
    return result;
  }
  const after = await snapshotMemoryFolder(root);
  if (after === TOO_MANY) return TOO_MANY;
  const diff = diffSnapshots(before, after);
  if (!diff.added.length && !diff.changed.length && !diff.removed.length) return result;
  await fs.mkdir(quarantine, { recursive: true, mode: 0o700 });
  await fs.chmod(path.dirname(quarantine), 0o700).catch(() => undefined);
  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
  const keepCopy = async (name: string, bytes: Buffer) => {
    const target = path.join(quarantine, `${stamp}-${path.basename(name)}`);
    const handle = await fs.open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  };
  const putBack = async (name: string, bytes: Buffer) => {
    // Written beside it under a temporary name and renamed over it: never a half-written memory file.
    const tmp = path.join(dir, `.hps-restore-${stamp}-${path.basename(name)}`);
    const handle = await fs.open(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(tmp, path.join(dir, name));
  };
  for (const name of diff.added) {
    const entry = after.get(name)!;
    if (studioMade(dir, name, entry.digest, since)) { result.kept++; continue; }
    // Past the item size: never read as memory, and not copied into the quarantine; left in place and reported.
    if (!entry.bytes) { result.failed++; continue; }
    try {
      await keepCopy(name, entry.bytes);
      await fs.unlink(path.join(dir, name));
      result.reverted++;
    } catch { result.failed++; }
  }
  for (const name of diff.changed) {
    const entry = after.get(name)!, old = before.get(name)!;
    if (studioMade(dir, name, entry.digest, since)) { result.kept++; continue; }
    if (!entry.bytes || !old.bytes) { result.failed++; continue; }
    try {
      await keepCopy(name, entry.bytes);
      await putBack(name, old.bytes);
      result.reverted++;
    } catch { result.failed++; }
  }
  for (const name of diff.removed) {
    const old = before.get(name)!;
    if (studioMade(dir, name, null, since)) { result.kept++; continue; }
    if (!old.bytes) { result.failed++; continue; }
    try { await putBack(name, old.bytes); result.reverted++; } catch { result.failed++; }
  }
  return result;
}

/** Counts only, never the memory content or a file name. */
export const FOLDER_GUARD_COPY = {
  reverted: (n: number) => `이 작업에서 기억에 쓴 내용 ${n}개를 되돌렸어요.`,
  failed: (n: number) => `기억 파일 ${n}개는 되돌리지 못했어요. 기억 목록에서 확인해 주세요.`,
  tooMany: "기억 폴더에 파일이 너무 많아서 이번에는 바뀐 내용을 확인하지 못했어요. 기억 목록에서 확인해 주세요.",
} as const;
