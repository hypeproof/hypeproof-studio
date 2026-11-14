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
import { MEMORY_FOLDER, MEMORY_LIMITS, memoryFileName, observeMemoryChanges } from "./activityMemory.ts";

/**
 * Bounds of one snapshot, from the store's own limits. Every entry's NAME is listed (up to NAMES_MAX), so anything new
 * the turn adds is always found and moved out (fail closed). Contents are read for at most `files` entries, the
 * store's memory-named files first, and only up to the item size; an entry past that is tracked by name only, and a
 * change inside it cannot be seen (the turn says so). Past NAMES_MAX every entry is name-only.
 */
export const SNAPSHOT_MAX = { files: MEMORY_LIMITS.items + 50, keepBytes: MEMORY_LIMITS.bytes, names: 10_000 } as const;
/**
 * The quarantine of a keep-off turn's writes, bounded by the store's limits too: per seat activity at most the store's
 * item count and that many full items' bytes, oldest removed first, and nothing older than seven days. It lives in the
 * extension's global storage (this OS account only, folders 0700, files 0600), one folder per activity scope and task;
 * a task's folder goes when the task is archived or moved. Nothing reads it back into memory, uploads it or logs it.
 */
// Three pools, each under the seven-day retention:
// - originals (`orig-…`): the learner's own bytes the revert had to set aside: the state at turn start (or the
//   learner's save during the turn) of an item that could not be put back (swapped for a folder) or that was still on
//   disk when the target differed. Never evicted by count: at most `originals` per activity, and when that is reached
//   the revert leaves the item as it is (reported) instead of dropping an original. One exception: bytes that exist
//   nowhere else any more (the item was swapped for a folder) are written past the cap, since refusing would lose them.
//   Known residual: a real entry stamped more than `clockSkewMs` ahead (written while the clock ran fast, then
//   corrected) counts as planted and ages out at the next prune;
// - copies: what the turn wrote, under the `files` count and `bytes` caps, oldest first;
// - moves (`moved-…`, the turn's or the learner's non-memory files): their own `moved` count cap.
// Nothing the turn writes can take an original's place. `clockSkewMs`: how far ahead of the clock a stamp may be and
// still count as now (see quarantinedAt).
export const QUARANTINE_LIMITS = { files: MEMORY_LIMITS.items, moved: MEMORY_LIMITS.items, originals: MEMORY_LIMITS.items * 5, bytes: MEMORY_LIMITS.items * MEMORY_LIMITS.bytes, retentionMs: 7 * 24 * 3600_000, movesPerTurn: MEMORY_LIMITS.items, clockSkewMs: 60_000 } as const;
/** Files moved (renamed, never copied) out of the store: kept under the count and age caps, outside the byte cap. */
export const MOVED_PREFIX = "moved-";
/** The learner's own earlier bytes set aside by a revert: the protected pool (see QUARANTINE_LIMITS). */
export const ORIGINAL_PREFIX = "orig-";

/** `digest` NAME_ONLY: listed but not read (past the bounds); its content changes are not seen. */
export interface SnapEntry { size: number; digest: string; bytes: Buffer | null }
export const NAME_ONLY = "name-only";
export type Snapshot = Map<string, SnapEntry> & { partial?: boolean };

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

/** One regular file's entry: digest and bytes up to the item size; a larger file by its stat. null: not a regular file. */
async function readEntry(file: string): Promise<SnapEntry | null> {
  const stat = await fs.lstat(file).catch(() => null);
  if (!stat?.isFile()) return null;
  if (stat.size > SNAPSHOT_MAX.keepBytes) return { size: stat.size, digest: `stat:${stat.size}:${stat.mtimeMs}:${stat.ino}`, bytes: null };
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => null);
  if (!handle) return null;
  try {
    const bytes = await handle.readFile();
    if (bytes.length > SNAPSHOT_MAX.keepBytes) return { size: bytes.length, digest: `stat:${bytes.length}:${stat.mtimeMs}:${stat.ino}`, bytes: null };
    return { size: bytes.length, digest: digestOf(bytes), bytes };
  } finally { await handle.close(); }
}

/** Every entry by name; contents for the bounded set (memory-named files first). `partial` when some are name-only. */
export async function snapshotMemoryFolder(root: string): Promise<Snapshot> {
  const dir = await folderOf(root);
  const snap = new Map<string, SnapEntry>() as Snapshot;
  if (!dir) return snap;
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const readable = names.length <= SNAPSHOT_MAX.names;
  // Memory-named files first, then by name: deterministic, so the read set is the same at both ends of the turn.
  const ordered = [...names].sort((a, b) => Number(memoryFileName(b)) - Number(memoryFileName(a)) || (a < b ? -1 : a > b ? 1 : 0));
  let read = 0;
  for (const name of ordered) {
    if (!readable || read >= SNAPSHOT_MAX.files) { snap.set(name, { size: -1, digest: NAME_ONLY, bytes: null }); snap.partial = true; continue; }
    const entry = await readEntry(path.join(dir, name));
    if (entry) { snap.set(name, entry); read++; }
  }
  return snap;
}

export interface SnapDiff { added: string[]; changed: string[]; removed: string[] }

export function diffSnapshots(before: Snapshot, after: Snapshot): SnapDiff {
  const added: string[] = [], changed: string[] = [], removed: string[] = [];
  for (const [name, entry] of after) {
    const old = before.get(name);
    if (!old) added.push(name);
    else if (old.digest !== NAME_ONLY && entry.digest !== NAME_ONLY && old.digest !== entry.digest) changed.push(name);
  }
  for (const name of before.keys()) if (!after.has(name)) removed.push(name);
  return { added: added.sort(), changed: changed.sort(), removed: removed.sort() };
}

// ---- The journal of Studio's own memory-folder changes ----
// Each entry keeps the file's state after Studio's change: its digest and (up to the item size) its bytes, or a removal.
// At the turn end the last such state wins over the snapshot, so a learner's save during the turn is what is put back.
type JournalEntry = { dir: string; name: string; digest: string | null; bytes: Buffer | null; at: number };
const journal: JournalEntry[] = [];
const JOURNAL_MAX = 200;

function journalPush(dir: string, name: string, bytes: Buffer | null, at: number): void {
  journal.push({ dir, name, digest: bytes ? digestOf(bytes) : null, bytes: bytes && bytes.length <= SNAPSHOT_MAX.keepBytes ? Buffer.from(bytes) : null, at });
  while (journal.length > JOURNAL_MAX) journal.shift();
}

/**
 * Studio made this change to a memory file (its memory list, an undo, the learner's save in the editor). `bytes` is
 * the file as it now is on disk (read from disk for an editor save, so a byte-order mark or line endings count), or
 * null for a removal.
 */
export async function noteStudioMemoryChange(dir: string, name: string, bytes: Buffer | null, at = Date.now()): Promise<void> {
  journalPush(await fs.realpath(dir).catch(() => dir), name, bytes, at);
}

/** The editor saved this file: journal the bytes on disk now (not the editor's text, which drops a BOM). */
export async function noteStudioMemorySave(file: string, at = Date.now()): Promise<void> {
  const entry = await readEntry(file);
  if (!entry || !entry.bytes) return;
  journalPush(await fs.realpath(path.dirname(file)).catch(() => path.dirname(file)), path.basename(file), entry.bytes, at);
}

/** The last state Studio left this file in during the turn, or undefined when Studio did not touch it. */
function studioState(dir: string, name: string, since: number): JournalEntry | undefined {
  for (let i = journal.length - 1; i >= 0; i--) {
    const e = journal[i];
    if (e.at < since) break;
    if (e.dir === dir && e.name === name) return e;
  }
  return undefined;
}

// Every change ActivityMemory makes is journaled synchronously (its folder path is already the real one).
observeMemoryChanges((dir, name, bytes) => journalPush(dir, name, bytes, Date.now()));

/** For tests only: start from an empty journal. */
export function clearStudioMemoryJournal(): void { journal.length = 0; }

export interface RevertResult { reverted: number; kept: number; failed: number; unchecked: boolean }

/**
 * When a quarantined file was put there: the stamp its name starts with (`<stamp>-…`, `moved-<stamp>-…` or
 * `orig-<stamp>-…`), never its
 * mtime, which a move keeps from the original (a photo copied in from the file manager keeps its old date) and a turn
 * can set to anything. A name without a stamp counts as oldest. The result is never later than `now`: a stamp up to
 * `clockSkewMs` ahead (a clock adjusted backwards) is clamped to `now`; one further ahead was not written by Studio
 * (the coach's shell can reach the folder) and counts as oldest, so it can neither outrank real copies nor escape the
 * retention. Clamping a far-future stamp to `now` instead would re-clamp on every prune and never age.
 */
export function quarantinedAt(name: string, now = Date.now()): number {
  const m = /^(?:moved-|orig-)?(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-/.exec(name);
  if (!m) return 0;
  const t = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
  if (Number.isNaN(t) || t > now + QUARANTINE_LIMITS.clockSkewMs) return 0;
  return Math.min(t, now);
}

/** The prune order within a pool: newest stamp first; equal stamps (one turn) by path, so readdir order never decides. */
export function quarantineOrder(a: { file: string; at: number }, b: { file: string; at: number }): number {
  return b.at - a.at || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0);
}

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
        const at = quarantinedAt(name, now);
        if (!stat.isFile() || now - at > QUARANTINE_LIMITS.retentionMs) { await fs.rm(file, { force: true }).catch(() => undefined); continue; }
        files.push({ file, at, size: stat.size });
      }
      if (!(await fs.readdir(taskDir).catch(() => [])).length) await fs.rmdir(taskDir).catch(() => undefined);
    }
    // Two pools, each newest first: copies (memory items and displaced originals) under the count and byte caps, and
    // moved files under their own count cap. A move never takes a copy's place, whatever its stamp, so junk a later turn
    // moves out cannot evict an original an earlier turn saved. Equal stamps (one turn) fall back to the path, so the
    // order never depends on readdir.
    const newestFirst = quarantineOrder;
    const isMoved = (f: { file: string }) => path.basename(f.file).startsWith(MOVED_PREFIX);
    // Originals are bounded at write time (revertTurnChanges) and only age out here: never removed by count.
    const isOriginal = (f: { file: string }) => path.basename(f.file).startsWith(ORIGINAL_PREFIX);
    let count = 0, bytes = 0;
    for (const f of files.filter((x) => !isMoved(x) && !isOriginal(x)).sort(newestFirst)) {
      count++; bytes += f.size;
      if (count > QUARANTINE_LIMITS.files || bytes > QUARANTINE_LIMITS.bytes) await fs.rm(f.file, { force: true }).catch(() => undefined);
    }
    // A moved file costs no extra disk (it left the workspace), so only the count caps it.
    let moved = 0;
    for (const f of files.filter(isMoved).sort(newestFirst)) if (++moved > QUARANTINE_LIMITS.moved) await fs.rm(f.file, { force: true }).catch(() => undefined);
    if (!(await fs.readdir(scopeDir).catch(() => [])).length) await fs.rmdir(scopeDir).catch(() => undefined);
  }
}

/** Removes one task's quarantine (the task was archived or moved). */
export async function purgeTaskQuarantine(base: string, scopeKey: string, taskKey: string): Promise<void> {
  if (!/^[0-9a-f]{24}$/.test(scopeKey) || !/^[A-Za-z0-9_-]{1,128}$/.test(taskKey)) return;
  await fs.rm(path.join(base, scopeKey, taskKey), { recursive: true, force: true }).catch(() => undefined);
}

/**
 * Puts each file back to what it should be after the turn: the last state Studio left it in during the turn (the
 * learner's save, the memory list, an undo), else its state at turn start. Anything else the turn wrote is moved or
 * copied into `quarantine` first, so nothing is lost. A new name is always moved out, whatever the bounds (fail
 * closed). A file whose target bytes were not kept (past the item size) counts as failed. `unchecked`: some entries
 * were tracked by name only, so a change inside them could not be seen.
 */
export async function revertTurnChanges(root: string, before: Snapshot, since: number, quarantine: string, now = Date.now()): Promise<RevertResult> {
  const dir = await folderOf(root);
  const result: RevertResult = { reverted: 0, kept: 0, failed: 0, unchecked: !!before.partial };
  if (!dir) {
    // The whole folder was removed or replaced by something that is not a plain folder: nothing is touched.
    if (before.size) result.failed = before.size;
    return result;
  }
  const after = await snapshotMemoryFolder(root);
  if (after.partial) result.unchecked = true;
  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
  let made = false;
  const ensureQuarantine = async () => {
    if (made) return;
    await fs.mkdir(quarantine, { recursive: true, mode: 0o700 });
    await fs.chmod(path.dirname(quarantine), 0o700).catch(() => undefined);
    made = true;
  };
  let seq = 0, moves = 0;
  // Originals already held for this activity (every task folder of its scope), counted once per revert.
  let originals = -1;
  const countOriginals = async () => {
    if (originals >= 0) return originals;
    originals = 0;
    const scopeDir = path.dirname(quarantine);
    for (const task of await fs.readdir(scopeDir).catch(() => [] as string[]))
      for (const n of await fs.readdir(path.join(scopeDir, task)).catch(() => [] as string[])) if (n.startsWith(ORIGINAL_PREFIX)) originals++;
    return originals;
  };
  class OriginalsFull extends Error {}
  // `learner`: the digests of the learner's own states of this item (turn start, the learner's save during the turn).
  // Bytes matching one go to the protected pool; anything else is what the turn wrote.
  // `mustKeep`: the bytes exist nowhere else any more (the item was swapped for a folder), so they are written even past
  // the cap; refusing would lose them. Every other original at the cap is refused, and the item stays as it is on disk.
  const keepCopy = async (name: string, bytes: Buffer, learner: Array<string | null | undefined>, mustKeep = false) => {
    const original = learner.includes(digestOf(bytes));
    if (original && !mustKeep && (await countOriginals()) >= QUARANTINE_LIMITS.originals) throw new OriginalsFull();
    await ensureQuarantine();
    const target = path.join(quarantine, `${original ? ORIGINAL_PREFIX : ""}${stamp}-${++seq}-${path.basename(name)}`);
    const handle = await fs.open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    if (original) originals++;
  };
  const putBack = async (name: string, bytes: Buffer) => {
    // Written beside it under a temporary name and renamed over it: never a half-written memory file.
    const tmp = path.join(dir, `.hps-restore-${stamp}-${++seq}-${path.basename(name)}`);
    const handle = await fs.open(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(tmp, path.join(dir, name));
  };
  const names = new Set([...before.keys(), ...after.keys()]);
  for (const name of [...names].sort()) {
    const was = before.get(name), now_ = after.get(name), studio = studioState(dir, name, since);
    // What the file should be: Studio's last state in the turn, else the state at turn start.
    const target: { digest: string | null; bytes: Buffer | null } | null = studio ? { digest: studio.digest, bytes: studio.bytes } : was ? { digest: was.digest, bytes: was.bytes } : null;
    const targetAbsent = studio ? studio.digest === null : !was;
    // Read a name-only entry now when it matters: a new name, one Studio changed, or one whose content was tracked at turn
    // start (a flood of new files must not push it out of the end read set and hide a rewrite).
    let current = now_;
    if (current?.digest === NAME_ONLY && (!was || studio || was.digest !== NAME_ONLY)) {
      const file = path.join(dir, name);
      const read = await readEntry(file);
      // Not a regular file any more (an item swapped for a folder past the read bound): it is handled as a swap, so
      // the learner's bytes are set aside, instead of being skipped as "unseen" and lost.
      if (read) current = read;
      else if (!(await fs.lstat(file).catch(() => null))?.isFile()) current = undefined;
    }
    // A new name the store would never read as memory (not a memory file name) is removed without a copy: it cannot
    // carry memory, and a flood of such names must not fill the quarantine.
    if (!was && !studio && current && !memoryFileName(name)) {
      // Moved, not deleted and not copied: it may be the learner's own file (a photo dropped in from the file manager).
      // A rename costs no disk; at most movesPerTurn per turn, the rest is left in place and reported. A move across
      // volumes (EXDEV) is not attempted as a copy: the file is left where it is and reported.
      if (moves >= QUARANTINE_LIMITS.movesPerTurn) { result.failed++; continue; }
      try {
        await ensureQuarantine();
        const target = path.join(quarantine, `${MOVED_PREFIX}${stamp}-${++seq}-${path.basename(name)}`);
        await fs.rename(path.join(dir, name), target);
        // Belt and braces: the stamp in the name decides the age, and the file's own times say "now" as well.
        await fs.utimes(target, now / 1000, now / 1000).catch(() => undefined);
        moves++; result.reverted++;
      } catch { result.failed++; }
      continue;
    }
    if (!current && targetAbsent) { if (studio) result.kept++; continue; }
    if (current && target && !targetAbsent && current.digest === target.digest) { if (studio) result.kept++; continue; }
    // Unseen inside a name-only entry that existed at turn start and Studio did not touch: nothing to compare.
    if (current?.digest === NAME_ONLY && was && !studio) continue;
    const learner = [was?.digest, studio?.digest];
    // An item whose on-disk bytes are the learner's own and would need setting aside while the protected pool is full:
    // keepCopy refuses before anything is changed, so the item stays as it is and is reported; no original is dropped.
    try {
      if (current) {
        if (current.bytes) await keepCopy(name, current.bytes, learner);
        else if (!targetAbsent) { result.failed++; continue; }   // past the item size: cannot be copied, left as it is
      }
      if (targetAbsent) {
        if (current && current.bytes) await fs.unlink(path.join(dir, name));
        else if (current) { result.failed++; continue; }        // a new file past the item size: left, reported
      } else {
        if (!target!.bytes) { result.failed++; continue; }
        try { await putBack(name, target!.bytes); } catch (error) {
          // Cannot be put back (the item was swapped for a folder, say): its earlier bytes are kept aside first, never lost.
          await keepCopy(name, target!.bytes, learner, true).catch(() => undefined);
          throw error;
        }
      }
      result.reverted++;
    } catch { result.failed++; }
  }
  return result;
}

/** Counts only, never the memory content or a file name. */
export const FOLDER_GUARD_COPY = {
  reverted: (n: number) => `이 작업에서 기억에 쓴 내용 ${n}개를 되돌렸어요.`,
  failed: (n: number) => `기억 파일 ${n}개는 되돌리지 못했어요. 기억 목록에서 확인해 주세요.`,
  unchecked: "기억 폴더에 파일이 많아서 일부 파일의 바뀐 내용은 확인하지 못했어요. 새로 생긴 파일은 모두 옮겼어요. 기억 목록에서 확인해 주세요.",
} as const;
