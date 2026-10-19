// Per-turn restore points for the work folder (AE-15, CGP-ART-R-002, CGP-AGENT-R-026, #673). vscode-free.
//
// Before a coach turn the host records the work folder as a restore point: a manifest of
// every file (relative path, size, sha256) plus a byte copy of each file. After the turn
// it compares the folder with the point (added / changed / deleted). "되돌리기" first
// records the current folder as its own point ("복구 직전", AE-15), then puts back the
// exact pre-turn bytes, removes what the turn added, and verifies every restored file's
// sha256 against the manifest. Nothing is ever claimed restored that was not verified.
//
// Where the copies live: the extension's storage, never the work folder. A store inside
// the folder would be listed, read and rewritten by the coach's own file tools (the
// '이전 세상' listing contamination of #644 is the same shape), and would ride along with
// a site publish or a git commit of the folder. The extension storage is outside every
// coach tool's reach and is not gated by seat age, so it works for minors too
// (adultArchive is adult-only).
//
// Layout of one store (one work folder x one task):
//   <store>/points/<id>.json      manifest
//   <store>/blobs/<aa>/<sha256>   content-addressed byte copies, shared between points
// Pruning keeps the newest `keep` points and removes blobs no remaining point names.
//
// Bounds: a file above `fileMax`, files past `filesMax` or `totalMax`, links and
// unreadable entries are recorded in `notCovered` (named, never silently dropped). A
// folder walk that passes `entriesMax` marks the point incomplete; the host then offers
// no revert for that turn, because an unvisited file would look "added".

import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { WORLD_ARCHIVE_DIR } from "./chatPanelHelpers.ts";

/** Folder names never recorded: VCS data, installed packages, Studio's own archives. */
export const TURN_RESTORE_SKIP_DIRS: readonly string[] = [".git", "node_modules", ".hypeproof", WORLD_ARCHIVE_DIR];
/** File names never recorded (OS noise). */
export const TURN_RESTORE_SKIP_FILES: readonly string[] = [".DS_Store", "Thumbs.db"];
/** Restore points kept per store (one work folder x one task). */
export const TURN_RESTORE_KEEP = 10;

export interface TurnRestoreLimits {
  /** A single file above this many bytes is not copied. */
  fileMax: number;
  /** Bytes copied per point. */
  totalMax: number;
  /** Files copied per point. */
  filesMax: number;
  /** Directory entries visited before the walk gives up (the point is then incomplete). */
  entriesMax: number;
}

export const TURN_RESTORE_LIMITS: TurnRestoreLimits = {
  fileMax: 20 * 1024 * 1024,
  totalMax: 200 * 1024 * 1024,
  filesMax: 5000,
  entriesMax: 20000,
};

export interface ManifestFile { path: string; size: number; sha256: string }
export type NotCoveredReason = "too_large" | "total_cap" | "file_cap" | "link" | "unreadable";
export interface NotCovered { path: string; reason: NotCoveredReason; size?: number }

export interface RestoreManifest {
  version: 1;
  id: string;
  /** `turn`: taken before a coach turn. `before_restore`: the state just before a revert (AE-15). */
  kind: "turn" | "before_restore";
  turnId: string;
  createdAt: number;
  /** Every recorded file, sorted by path, posix separators. */
  files: ManifestFile[];
  /** Every directory seen (posix, sorted), so a revert can remove only directories the turn created. */
  dirs: string[];
  notCovered: NotCovered[];
  /** False when the walk passed `entriesMax`. */
  complete: boolean;
  /** sha256 over the sorted `path size sha256` lines: one value per folder state, no contents. */
  digest: string;
}

export interface FolderScan {
  files: ManifestFile[];
  dirs: string[];
  notCovered: NotCovered[];
  complete: boolean;
  digest: string;
}

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const SHA = /^[a-f0-9]{64}$/;

export function validRestoreId(id: unknown): id is string {
  return typeof id === "string" && ID.test(id);
}

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

export function manifestDigest(files: readonly ManifestFile[]): string {
  return sha256(files.map((f) => `${f.path}\u0000${f.size}\u0000${f.sha256}\n`).join(""));
}

/** The store of one work folder and one task under `base` (the extension's storage). */
export function turnRestoreStoreDir(base: string, folderRealPath: string, taskKey: string | null | undefined): string {
  const folder = sha256(path.resolve(folderRealPath)).slice(0, 24);
  const task = taskKey && ID.test(taskKey) ? taskKey : "default";
  return path.join(base, "turn-restore", folder, task);
}

function skipDir(name: string): boolean {
  return TURN_RESTORE_SKIP_DIRS.includes(name);
}

/**
 * Walk the folder. `onFile` receives each covered file's bytes as it is read (so a restore point
 * copies one file at a time instead of holding the whole folder in memory).
 */
export async function scanFolder(root: string, opts: { limits?: Partial<TurnRestoreLimits>; onFile?: (sha256: string, data: Buffer) => Promise<void> } = {}): Promise<FolderScan> {
  const limits = { ...TURN_RESTORE_LIMITS, ...opts.limits };
  const files: ManifestFile[] = [];
  const dirs: string[] = [];
  const notCovered: NotCovered[] = [];
  let total = 0;
  let entries = 0;
  let complete = true;
  const walk = async (absDir: string, relDir: string): Promise<void> => {
    let names: string[];
    try { names = (await fs.readdir(absDir)).sort(); }
    catch { if (relDir) notCovered.push({ path: relDir, reason: "unreadable" }); return; }
    for (const name of names) {
      if (!complete) return;
      if (++entries > limits.entriesMax) { complete = false; return; }
      const rel = relDir ? `${relDir}/${name}` : name;
      const abs = path.join(absDir, name);
      let st: import("node:fs").Stats;
      try { st = await fs.lstat(abs); } catch { notCovered.push({ path: rel, reason: "unreadable" }); continue; }
      if (st.isSymbolicLink()) { notCovered.push({ path: rel, reason: "link" }); continue; }
      if (st.isDirectory()) {
        if (skipDir(name)) continue;
        dirs.push(rel);
        await walk(abs, rel);
        continue;
      }
      if (!st.isFile()) continue; // sockets, fifos: not part of the work
      if (TURN_RESTORE_SKIP_FILES.includes(name)) continue;
      if (st.size > limits.fileMax) { notCovered.push({ path: rel, reason: "too_large", size: st.size }); continue; }
      if (files.length >= limits.filesMax) { notCovered.push({ path: rel, reason: "file_cap", size: st.size }); continue; }
      if (total + st.size > limits.totalMax) { notCovered.push({ path: rel, reason: "total_cap", size: st.size }); continue; }
      let data: Buffer;
      try { data = await fs.readFile(abs); } catch { notCovered.push({ path: rel, reason: "unreadable", size: st.size }); continue; }
      if (data.length > limits.fileMax) { notCovered.push({ path: rel, reason: "too_large", size: data.length }); continue; }
      const hash = sha256(data);
      total += data.length;
      files.push({ path: rel, size: data.length, sha256: hash });
      if (opts.onFile) await opts.onFile(hash, data);
    }
  };
  await walk(path.resolve(root), "");
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  dirs.sort();
  return { files, dirs, notCovered, complete, digest: manifestDigest(files) };
}

const blobPath = (store: string, hash: string) => path.join(store, "blobs", hash.slice(0, 2), hash);
const pointPath = (store: string, id: string) => path.join(store, "points", `${id}.json`);

async function writeAtomic(file: string, data: Buffer | string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

async function exists(p: string): Promise<boolean> {
  try { await fs.lstat(p); return true; } catch { return false; }
}

export interface TakeRestorePointRequest {
  store: string;
  root: string;
  id: string;
  turnId: string;
  kind: RestoreManifest["kind"];
  now?: number;
  keep?: number;
  /** Points pruning must never remove (besides the new one). */
  protect?: readonly string[];
  limits?: Partial<TurnRestoreLimits>;
}

export interface TakeRestorePointResult {
  point: RestoreManifest;
  /** Points removed by pruning. */
  pruned: string[];
}

/** Record the folder as a restore point: copy every covered file into the store, then write the manifest. Throws on store failure. */
export async function takeRestorePoint(req: TakeRestorePointRequest): Promise<TakeRestorePointResult> {
  if (!validRestoreId(req.id)) throw new Error("invalid restore point id");
  const scan = await scanFolder(req.root, {
    limits: req.limits,
    onFile: async (hash, data) => {
      const target = blobPath(req.store, hash);
      if (!(await exists(target))) await writeAtomic(target, data);
    },
  });
  const point: RestoreManifest = {
    version: 1, id: req.id, kind: req.kind, turnId: req.turnId, createdAt: req.now ?? Date.now(),
    files: scan.files, dirs: scan.dirs, notCovered: scan.notCovered, complete: scan.complete, digest: scan.digest,
  };
  await writeAtomic(pointPath(req.store, req.id), JSON.stringify(point));
  const pruned = await pruneRestorePoints(req.store, req.keep ?? TURN_RESTORE_KEEP, [req.id, ...(req.protect ?? [])]);
  return { point, pruned };
}

function validManifest(value: unknown): value is RestoreManifest {
  const m = value as RestoreManifest;
  return !!m && m.version === 1 && validRestoreId(m.id) && (m.kind === "turn" || m.kind === "before_restore") &&
    typeof m.createdAt === "number" && Array.isArray(m.files) && Array.isArray(m.dirs) && Array.isArray(m.notCovered) &&
    m.files.every((f) => f && typeof f.path === "string" && safeRel(f.path) && typeof f.size === "number" && SHA.test(f.sha256)) &&
    m.dirs.every((d) => typeof d === "string" && safeRel(d));
}

/** A manifest path may never leave the folder. */
function safeRel(rel: string): boolean {
  if (!rel || rel.includes("\\") || rel.startsWith("/") || /^[A-Za-z]:/.test(rel)) return false;
  return rel.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

export async function loadRestorePoint(store: string, id: string): Promise<RestoreManifest | null> {
  if (!validRestoreId(id)) return null;
  try {
    const parsed = JSON.parse(await fs.readFile(pointPath(store, id), "utf8"));
    return validManifest(parsed) && parsed.id === id ? parsed : null;
  } catch { return null; }
}

/** Every readable point of the store, newest first. */
export async function listRestorePoints(store: string): Promise<RestoreManifest[]> {
  let names: string[] = [];
  try { names = await fs.readdir(path.join(store, "points")); } catch { return []; }
  const points: RestoreManifest[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const p = await loadRestorePoint(store, name.slice(0, -5));
    if (p) points.push(p);
  }
  return points.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
}

/**
 * Keep the newest `keep` points (protected ones count toward `keep` and are never removed),
 * then remove blobs no remaining point names. Returns the removed point ids.
 */
export async function pruneRestorePoints(store: string, keep: number = TURN_RESTORE_KEEP, protect: readonly string[] = []): Promise<string[]> {
  const points = await listRestorePoints(store);
  const kept = new Set(protect);
  for (const p of points) {
    if (kept.size >= Math.max(keep, protect.length)) break;
    kept.add(p.id);
  }
  const removed: string[] = [];
  for (const old of points.filter((p) => !kept.has(p.id))) {
    try { await fs.unlink(pointPath(store, old.id)); removed.push(old.id); } catch { /* stays; pruned next time */ }
  }
  if (removed.length) await collectBlobs(store);
  return removed;
}

/** Remove one point (a turn that changed nothing has nothing to go back to). */
export async function dropRestorePoint(store: string, id: string): Promise<void> {
  if (!validRestoreId(id)) return;
  try { await fs.unlink(pointPath(store, id)); } catch { /* already gone */ }
  await collectBlobs(store);
}

async function collectBlobs(store: string): Promise<void> {
  const live = new Set((await listRestorePoints(store)).flatMap((p) => p.files.map((f) => f.sha256)));
  const root = path.join(store, "blobs");
  let shards: string[] = [];
  try { shards = await fs.readdir(root); } catch { return; }
  for (const shard of shards) {
    let names: string[] = [];
    try { names = await fs.readdir(path.join(root, shard)); } catch { continue; }
    for (const name of names) {
      if (live.has(name)) continue;
      try { await fs.unlink(path.join(root, shard, name)); } catch { /* stays */ }
    }
  }
}

export interface TurnChanges {
  added: string[];
  changed: string[];
  deleted: string[];
  /** Paths whose change cannot be told or undone because they were not copied (either side). */
  notCovered: NotCovered[];
}

export function changeCount(c: TurnChanges): number {
  return c.added.length + c.changed.length + c.deleted.length;
}

/** What differs between a restore point and a later scan of the same folder. */
export function diffRestorePoint(point: Pick<RestoreManifest, "files" | "notCovered">, now: Pick<FolderScan, "files" | "notCovered">): TurnChanges {
  const before = new Map(point.files.map((f) => [f.path, f]));
  const after = new Map(now.files.map((f) => [f.path, f]));
  const uncoveredBefore = new Set(point.notCovered.map((n) => n.path));
  const added: string[] = [];
  const changed: string[] = [];
  const deleted: string[] = [];
  for (const [p, f] of after) {
    const b = before.get(p);
    if (!b) { if (!uncoveredBefore.has(p)) added.push(p); }
    else if (b.sha256 !== f.sha256 || b.size !== f.size) changed.push(p);
  }
  for (const p of before.keys()) if (!after.has(p)) deleted.push(p);
  const seen = new Set<string>();
  const notCovered: NotCovered[] = [];
  for (const n of [...now.notCovered, ...point.notCovered]) {
    if (seen.has(n.path)) continue;
    seen.add(n.path);
    notCovered.push(n);
  }
  return { added, changed, deleted, notCovered };
}

export interface RestoreFailure {
  path: string;
  /** `unsafe_path`: a component of the path (or the file itself) is a link, not a directory, or leaves the folder; nothing was written through it. */
  reason: "snapshot_damaged" | "write_failed" | "remove_failed" | "verify_mismatch" | "unsafe_path";
}

export interface RestoreOutcome {
  ok: boolean;
  /** The point recorded just before the revert (AE-15); absent only when it could not be taken (then nothing was changed). */
  beforeRestore?: RestoreManifest;
  /** Paths whose pre-turn bytes were written and verified. */
  restored: string[];
  /** Paths the turn added that were removed (verified absent). */
  removed: string[];
  failed: RestoreFailure[];
  /** Named, never claimed restored. */
  notCovered: NotCovered[];
  /** Digest of the folder after the revert, from a fresh scan. */
  afterDigest?: string;
  /** Whether anything in the folder was changed (a file written or removed, a directory made or removed). */
  touched: boolean;
  error?: string;
}

export interface RestoreRequest {
  store: string;
  root: string;
  /** The point to go back to. */
  point: RestoreManifest;
  /** Id for the "복구 직전" point. */
  beforeRestoreId: string;
  now?: number;
  keep?: number;
  limits?: Partial<TurnRestoreLimits>;
}

function inside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

const errCode = (e: unknown) => (e as NodeJS.ErrnoException)?.code;

/**
 * Is it safe to change `rel` under `realRoot` (already a real path)? Every existing parent
 * component must be a real directory (lstat: not a link) whose real path stays inside the
 * folder; the target itself, when it exists, must be of `kind` and not a link. A missing
 * component ends the walk: everything below it will be created by us, one level at a time.
 */
async function safeToChange(realRoot: string, rel: string, kind: "file" | "dir"): Promise<boolean> {
  if (!safeRel(rel)) return false;
  const parts = rel.split("/");
  let cur = realRoot;
  for (let i = 0; i < parts.length; i++) {
    cur = path.join(cur, parts[i]);
    const last = i === parts.length - 1;
    let st: import("node:fs").Stats;
    try { st = await fs.lstat(cur); } catch (e) { return errCode(e) === "ENOENT"; }
    if (st.isSymbolicLink()) return false;
    if (!last && !st.isDirectory()) return false;
    if (last && (kind === "file" ? !st.isFile() : !st.isDirectory())) return false;
    try { if (!inside(realRoot, await fs.realpath(cur))) return false; } catch { return false; }
  }
  return true;
}

/** Create the missing parents of `rel` one level at a time, refusing any component that is not a real directory. */
async function makeParents(realRoot: string, rel: string, onMade: () => void): Promise<boolean> {
  const parts = rel.split("/").slice(0, -1);
  let cur = realRoot;
  for (const part of parts) {
    cur = path.join(cur, part);
    try { await fs.mkdir(cur); onMade(); } catch (e) { if (errCode(e) !== "EEXIST") return false; }
    let st: import("node:fs").Stats;
    try { st = await fs.lstat(cur); } catch { return false; }
    if (st.isSymbolicLink() || !st.isDirectory()) return false;
    try { if (!inside(realRoot, await fs.realpath(cur))) return false; } catch { return false; }
  }
  return true;
}

/**
 * Put the folder back to `point`. Order: record "복구 직전" (a failure there stops
 * everything), remove files the point does not have, write every file whose bytes differ
 * (each copy is checked against its manifest hash before it is written), remove
 * directories the point did not have and are now empty, then rescan and verify.
 */
export async function restoreToPoint(req: RestoreRequest): Promise<RestoreOutcome> {
  const failed: RestoreFailure[] = [];
  let root: string;
  try { root = await fs.realpath(path.resolve(req.root)); }
  catch { return { ok: false, restored: [], removed: [], failed: [], notCovered: [], touched: false, error: "before_restore_failed: work folder unreadable" }; }
  let touched = false;
  const mark = () => { touched = true; };
  let before: RestoreManifest;
  try {
    // The "복구 직전" point must survive this revert's own pruning, and so must the target
    // (its blobs are about to be read).
    before = (await takeRestorePoint({ store: req.store, root, id: req.beforeRestoreId, turnId: req.point.turnId, kind: "before_restore", now: req.now, keep: req.keep, protect: [req.point.id], limits: req.limits })).point;
  } catch (e) {
    return { ok: false, restored: [], removed: [], failed: [], notCovered: [], touched: false, error: `before_restore_failed: ${String((e as Error)?.message ?? e).slice(0, 160)}` };
  }
  if (!before.complete) {
    return { ok: false, beforeRestore: before, restored: [], removed: [], failed: [], notCovered: [], touched: false, error: "folder_too_large" };
  }
  const target = new Map(req.point.files.map((f) => [f.path, f]));
  const uncoveredInPoint = new Set(req.point.notCovered.map((n) => n.path));
  const notCovered = diffRestorePoint(req.point, before).notCovered;

  // 1. Files the point does not have (and did not skip) were added since: remove them.
  //    Their bytes are in "복구 직전", so nothing is lost.
  const removed: string[] = [];
  for (const f of before.files) {
    if (target.has(f.path) || uncoveredInPoint.has(f.path)) continue;
    const abs = path.join(root, ...f.path.split("/"));
    if (!inside(root, abs) || !(await safeToChange(root, f.path, "file"))) { failed.push({ path: f.path, reason: "unsafe_path" }); continue; }
    try { await fs.unlink(abs); mark(); removed.push(f.path); } catch { failed.push({ path: f.path, reason: "remove_failed" }); }
  }

  // 2. Files whose bytes differ, or that are gone: write the pre-turn bytes.
  const current = new Map(before.files.map((f) => [f.path, f]));
  const restored: string[] = [];
  for (const f of req.point.files) {
    const now = current.get(f.path);
    if (now && now.sha256 === f.sha256 && now.size === f.size) continue;
    const abs = path.join(root, ...f.path.split("/"));
    // Never write through a link: a folder or file swapped for a link (to anywhere) is refused and named.
    if (!inside(root, abs) || !(await safeToChange(root, f.path, "file"))) { failed.push({ path: f.path, reason: "unsafe_path" }); continue; }
    let data: Buffer;
    try { data = await fs.readFile(blobPath(req.store, f.sha256)); } catch { failed.push({ path: f.path, reason: "snapshot_damaged" }); continue; }
    if (sha256(data) !== f.sha256 || data.length !== f.size) { failed.push({ path: f.path, reason: "snapshot_damaged" }); continue; }
    if (!(await makeParents(root, f.path, mark))) { failed.push({ path: f.path, reason: "unsafe_path" }); continue; }
    // Re-check right before writing: the parents were just made or verified.
    if (!(await safeToChange(root, f.path, "file"))) { failed.push({ path: f.path, reason: "unsafe_path" }); continue; }
    const tmp = `${abs}.hps-restore-${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, data, { flag: "wx" }); // never through an existing entry
      await fs.rename(tmp, abs);
      mark();
      restored.push(f.path);
    } catch {
      try { await fs.unlink(tmp); } catch (e) { if (errCode(e) !== "ENOENT") mark(); }
      failed.push({ path: f.path, reason: "write_failed" });
    }
  }

  // 3. Directories the point did not have, deepest first, only when empty.
  const keepDirs = new Set(req.point.dirs);
  for (const d of [...before.dirs].sort((a, b) => b.length - a.length)) {
    if (keepDirs.has(d) || uncoveredInPoint.has(d)) continue;
    if (!(await safeToChange(root, d, "dir"))) continue; // a link is never followed; it stays, and the scan names it
    try { await fs.rmdir(path.join(root, ...d.split("/"))); mark(); } catch { /* not empty (uncovered content) or gone: leave it */ }
  }

  // 4. Verify from a fresh scan: every point file has its manifest hash, every removed file is gone.
  const after = await scanFolder(root, { limits: req.limits });
  const afterFiles = new Map(after.files.map((f) => [f.path, f]));
  const failedPaths = new Set(failed.map((x) => x.path));
  for (const f of req.point.files) {
    const got = afterFiles.get(f.path);
    if (got && got.sha256 === f.sha256 && got.size === f.size) continue;
    if (!failedPaths.has(f.path)) { failed.push({ path: f.path, reason: "verify_mismatch" }); failedPaths.add(f.path); }
  }
  for (const p of removed) {
    if (afterFiles.has(p) && !failedPaths.has(p)) { failed.push({ path: p, reason: "verify_mismatch" }); failedPaths.add(p); }
  }
  return {
    ok: failed.length === 0,
    beforeRestore: before,
    restored: restored.filter((p) => !failedPaths.has(p)),
    removed: removed.filter((p) => !failedPaths.has(p)),
    failed,
    notCovered,
    afterDigest: after.digest,
    touched,
  };
}
