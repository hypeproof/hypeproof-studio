// REQ-STUDIO-ACTIVITY-TRASH: local retention for learner file deletion gestures.
//
// Where the bytes live: the extension's global storage, one store per activity folder,
// never the work folder. The store is keyed by the folder's real path AND its identity
// (dev, inode, birth time), so a new folder created later at the same path is a different
// activity and never sees or restores the old one's trash.
//
// At rest everything a learner deleted is encrypted (AES-256-GCM) with a random key per
// store held in VS Code SecretStorage (the OS keychain), never on disk. An auto-allowed
// coach shell has no path confinement (#2157) and can find the store; it then gets only
// ciphertext under opaque names: no original name, extension or byte. A missing or wrong
// key, or a tampered file, is refused and logged; nothing falls back to plaintext.
//
// Layout of one store:
//   <store>/root.json         { path, identity } of the activity folder (orphan sweep)
//   <store>/lock/owner.json   cross-window lock with owner pid, time and token
//   <store>/items/<id>.meta   sealed entry metadata (original path, time, sha256, mode)
//   <store>/items/<id>.blob   sealed byte copy
// Sealed file: "HPT1" | 12-byte IV | ciphertext | 16-byte GCM tag; the additional data
// binds it to its store, entry id and kind, so files cannot be swapped between entries.
//
// Robustness: one damaged or foreign entry is skipped and logged, never fatal to the
// list. A lock whose owner is gone, or that is older than LOCK_STALE_MS, is taken over.
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID, randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';

export interface TrashEntry { id: string; originalPath: string; deletedAt: number; sha256: string; mode?: number; pending?: boolean }
export interface TrashFingerprint { dev: number; ino: number; size: number; mtimeMs: number; mode: number; sha256: string }
export interface TrashPlan { files: string[]; bytes: number; over: boolean; skipped: number }
export interface TrashLimits { files: number; bytes: number; entries: number }
/** What one gesture has used of TRASH_LIMITS so far; shared across every item of the gesture. */
export interface TrashBudget { visited: number; files: number; bytes: number }
/** The subset of vscode.SecretStorage the trash needs (context.secrets). */
export interface TrashKeyring { get(name: string): PromiseLike<string | undefined>; store(name: string, value: string): PromiseLike<void>; delete(name: string): PromiseLike<void> }
/** Test seams only: called mid-copy (after the first source chunk), after a blob is written, and between restore's verification and its decrypt. */
export interface TrashHooks { sourceRead?(source: string): void | Promise<void>; blobWritten?(blob: string): void | Promise<void>; restoreVerified?(blob: string): void | Promise<void> }
/** One gesture (all selected items together) is archived only when it stays under these; above them nothing is archived. */
export const TRASH_LIMITS: TrashLimits = { files: 5000, bytes: 200 * 1024 * 1024, entries: 20000 };
/** A lock older than this is free, whoever holds it. Transactions are per gesture and bounded by TRASH_LIMITS. */
export const LOCK_STALE_MS = 120_000;
/** A pending Explorer copy whose original is still identical is collected after this. */
export const PENDING_GC_MS = 10 * 60_000;
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
// C0/C1 controls, line/paragraph separators and every bidi control (ALM, LRM, RLM,
// embeddings, overrides, isolates), the same set browserTargetHost.ts refuses.
const invalid = /[\x00-\x1f\x7f-\x9f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
const INTERNAL = ['.hypeproof', '.git'];
const internal = (name: string) => INTERNAL.includes(name.normalize('NFKC').toLowerCase());
const CHUNK = 256 * 1024;
const MAGIC = Buffer.from('HPT1'), IV = 12, TAG = 16, HEADER = MAGIC.length + IV;
const META = '.meta', BLOB = '.blob';

function relativeName(value: string): string {
  if (typeof value !== 'string' || !value || value.length > 2048 || invalid.test(value) || value.includes('\\') || path.isAbsolute(value)) throw new Error('invalid_path');
  const parts = value.split('/');
  if (parts.some(p => !p || ['.', '..'].includes(p) || internal(p) || /[:]/.test(p))) throw new Error('invalid_path');
  return value;
}
function absent(file: string): boolean {
  try { fs.lstatSync(file); return false; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return true; throw e; }
}
/** Never follow links, including dangling final links. `directories` creates missing components (restore parents). */
function walk(root: string, rel: string, directories = false): string {
  let current = root;
  const parts = rel.split('/');
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    if (directories && absent(current)) fs.mkdirSync(current, { mode: 0o755 });
    if (!absent(current)) {
      const st = fs.lstatSync(current);
      if (st.isSymbolicLink() || ((directories || i < parts.length - 1) && !st.isDirectory())) throw new Error('unsafe_path');
    }
  }
  return current;
}
const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;
async function writeAll(handle: fsp.FileHandle, data: Buffer): Promise<void> {
  for (let off = 0; off < data.length;) off += (await handle.write(data, off, data.length - off)).bytesWritten;
}
async function fingerprint(file: string): Promise<TrashFingerprint> {
  const handle = await fsp.open(file, fs.constants.O_RDONLY | NOFOLLOW);
  try {
    const before = await handle.stat();
    // A hard-linked file has another name the trash would not remove or restore.
    if (!before.isFile() || before.nlink !== 1) throw new Error('not_regular_file');
    const hash = createHash('sha256'), buffer = Buffer.alloc(CHUNK);
    let total = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      total += bytesRead; hash.update(buffer.subarray(0, bytesRead));
    }
    const after = await handle.stat(), named = await fsp.lstat(file);
    if (named.isSymbolicLink() || named.dev !== before.dev || named.ino !== before.ino || total !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error('file_changed');
    return { dev: before.dev, ino: before.ino, size: before.size, mtimeMs: before.mtimeMs, mode: before.mode & 0o777, sha256: hash.digest('hex') };
  } finally { await handle.close(); }
}
function same(a: TrashFingerprint, b: TrashFingerprint): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.sha256 === b.sha256;
}
function seal(key: Buffer, aad: string, plain: Buffer): Buffer {
  const iv = randomBytes(IV), cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG });
  cipher.setAAD(Buffer.from(aad));
  return Buffer.concat([MAGIC, iv, cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
}
function unseal(key: Buffer, aad: string, sealed: Buffer): Buffer {
  if (sealed.length < HEADER + TAG || !sealed.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('invalid_metadata');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(MAGIC.length, HEADER), { authTagLength: TAG });
    decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(sealed.subarray(sealed.length - TAG));
    return Buffer.concat([decipher.update(sealed.subarray(HEADER, sealed.length - TAG)), decipher.final()]);
  } catch { throw new Error('invalid_metadata'); }
}
/**
 * Decrypt one sealed blob, optionally into `sink`, and return the SHA-256 of the plaintext.
 * The GCM tag is checked at the end; a caller writing to `sink` must discard it on a throw.
 */
async function openBlob(file: string, key: Buffer, aad: string, sink?: fsp.FileHandle): Promise<string> {
  const handle = await fsp.open(file, fs.constants.O_RDONLY | NOFOLLOW);
  try {
    const st = await handle.stat();
    if (!st.isFile() || st.nlink !== 1 || st.size < HEADER + TAG) throw new Error('invalid_content');
    const head = Buffer.alloc(HEADER), tag = Buffer.alloc(TAG);
    if ((await handle.read(head, 0, HEADER, 0)).bytesRead !== HEADER || !head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('invalid_content');
    if ((await handle.read(tag, 0, TAG, st.size - TAG)).bytesRead !== TAG) throw new Error('invalid_content');
    const decipher = createDecipheriv('aes-256-gcm', key, head.subarray(MAGIC.length), { authTagLength: TAG });
    decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(tag);
    const hash = createHash('sha256'), buffer = Buffer.alloc(CHUNK), end = st.size - TAG;
    for (let pos = HEADER; pos < end;) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(CHUNK, end - pos), pos);
      if (!bytesRead) throw new Error('invalid_content');
      pos += bytesRead;
      const plain = decipher.update(buffer.subarray(0, bytesRead));
      hash.update(plain); if (sink) await writeAll(sink, plain);
    }
    let last: Buffer;
    try { last = decipher.final(); } catch { throw new Error('invalid_content'); }
    hash.update(last); if (sink) await writeAll(sink, last);
    return hash.digest('hex');
  } finally { await handle.close(); }
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}
/** Free when its owner process is gone, it is older than LOCK_STALE_MS, or it never got an owner record and is that old. */
async function staleLock(lock: string, now = Date.now()): Promise<boolean> {
  let owner: { pid?: unknown; at?: unknown } | null = null;
  try { owner = JSON.parse(await fsp.readFile(path.join(lock, 'owner.json'), 'utf8')); } catch { owner = null; }
  if (owner && Number.isInteger(owner.pid) && Number.isFinite(owner.at)) {
    if (now - (owner.at as number) > LOCK_STALE_MS) return true;
    return owner.pid !== process.pid && !alive(owner.pid as number);
  }
  try { return now - (await fsp.lstat(lock)).mtimeMs > LOCK_STALE_MS; } catch { return false; }
}
/** The cross-window store lock. Exported for its tests; callers go through ActivityTrash. */
export async function acquireTrashLock(lock: string): Promise<() => Promise<void>> {
  const token = randomUUID();
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await fsp.mkdir(lock, { mode: 0o700 });
      await fsp.writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, at: Date.now(), token }), { mode: 0o600 });
      return async () => {
        // Release only our own lock: a stale takeover may have replaced it.
        try { if (JSON.parse(await fsp.readFile(path.join(lock, 'owner.json'), 'utf8')).token === token) await fsp.rm(lock, { recursive: true, force: true }); }
        catch { /* already gone */ }
      };
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    if (await staleLock(lock)) {
      const aside = `${lock}.stale-${randomUUID()}`;
      try { await fsp.rename(lock, aside); await fsp.rm(aside, { recursive: true, force: true }); console.warn('[activity-trash] took over a stale lock'); }
      catch { /* another window took it first */ }
      continue;
    }
    await sleep(50);
  }
  throw new Error('trash_busy');
}
/** In-process order per store; the lock directory orders windows. */
const queues = new Map<string, Promise<void>>();

/** The identity of a folder: device, inode and birth time. A folder re-created at the same path differs. */
export function folderIdentity(folder: string): string {
  const st = fs.lstatSync(folder, { bigint: true });
  if (!st.isDirectory()) throw new Error('activity_changed');
  return `${st.dev}:${st.ino}:${st.birthtimeNs}`;
}
/** The store of one activity folder (real path plus identity) under `base` (the extension's global storage). */
export function activityTrashStoreDir(base: string, folderRealPath: string, identity: string): string {
  return path.join(base, 'activity-trash', createHash('sha256').update(`${path.resolve(folderRealPath)}\0${identity}`).digest('hex').slice(0, 24));
}
/** The SecretStorage name of a store's key. */
export const activityTrashKeyName = (store: string) => `hypeproof.activityTrash.${path.basename(store)}`;

export class ActivityTrash {
  readonly root: string;
  readonly store: string;
  private readonly items: string;
  private readonly identity: string;
  private readonly keyring: TrashKeyring;
  private readonly hooks: TrashHooks;
  constructor(root: string, base: string, keyring: TrashKeyring, hooks: TrashHooks = {}) {
    if (typeof base !== 'string' || !path.isAbsolute(base)) throw new Error('no_storage');
    if (!keyring || typeof keyring.get !== 'function' || typeof keyring.store !== 'function') throw new Error('no_keyring');
    this.keyring = keyring; this.hooks = hooks;
    this.root = fs.realpathSync(root); this.identity = folderIdentity(this.root);
    this.store = activityTrashStoreDir(base, this.root, this.identity);
    this.items = path.join(this.store, 'items');
  }
  private assertRoot(): void {
    if (fs.lstatSync(this.root).isSymbolicLink() || folderIdentity(this.root) !== this.identity) throw new Error('activity_changed');
  }
  private prepareStore(): void {
    fs.mkdirSync(this.items, { recursive: true, mode: 0o700 });
    for (const dir of [this.store, this.items]) {
      const st = fs.lstatSync(dir);
      if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('unsafe_store');
    }
    const marker = path.join(this.store, 'root.json');
    try { fs.writeFileSync(marker, JSON.stringify({ path: this.root, identity: this.identity }), { flag: 'wx', mode: 0o600 }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  }
  /**
   * The store key from SecretStorage. A store that already holds entries never gets a new
   * key (that would hide them for good): its key is missing, so the call is refused. A
   * read on a key-less store returns null; a write on an empty one creates the key.
   */
  private async key(dir: string, create: boolean): Promise<Buffer | null> {
    const name = activityTrashKeyName(this.store);
    const raw = await this.keyring.get(name);
    if (raw !== undefined) {
      const key = Buffer.from(raw, 'base64');
      if (key.length !== 32 || key.toString('base64') !== raw) { console.warn('[activity-trash] store key is malformed; refusing'); throw new Error('trash_key_invalid'); }
      return key;
    }
    if (fs.readdirSync(dir).some(n => n.endsWith(META) || n.endsWith(BLOB))) {
      console.warn('[activity-trash] store key is missing for a store with entries; refusing');
      if (create) throw new Error('trash_key_missing');
      return null;
    }
    if (!create) return null;
    const fresh = randomBytes(32).toString('base64');
    await this.keyring.store(name, fresh);
    if (await this.keyring.get(name) !== fresh) throw new Error('trash_key_unavailable');
    return Buffer.from(fresh, 'base64');
  }
  private async transaction<T>(fn: (dir: string, key: Buffer | null) => Promise<T>, create = false): Promise<T> {
    const prior = queues.get(this.store) ?? Promise.resolve();
    let done!: () => void;
    const gate = new Promise<void>(resolve => { done = resolve; });
    const mine = prior.then(() => gate);
    queues.set(this.store, mine);
    await prior;
    try {
      this.assertRoot(); this.prepareStore();
      const release = await acquireTrashLock(path.join(this.store, 'lock'));
      try { return await fn(this.items, await this.key(this.items, create)); } finally { await release(); }
    } finally {
      done();
      if (queues.get(this.store) === mine) queues.delete(this.store);
    }
  }
  private aad(id: string, kind: 'meta' | 'blob'): string { return `${path.basename(this.store)}/${id}/${kind}`; }
  async inspect(relativePath: string): Promise<TrashFingerprint> {
    this.assertRoot(); return fingerprint(walk(this.root, relativeName(relativePath)));
  }
  /**
   * Expand one item of a gesture without following links. Counts every regular file,
   * installed packages included, against `budget`, which a multi-item gesture shares, and
   * stops as soon as `limits` is passed (`over`). Links, hard-linked files, special files,
   * unsafe names and internal stores are counted in `skipped`.
   */
  async expand(relativePath: string, limits: TrashLimits = TRASH_LIMITS, budget: TrashBudget = { visited: 0, files: 0, bytes: 0 }): Promise<TrashPlan> {
    relativeName(relativePath); this.assertRoot();
    const plan: TrashPlan = { files: [], bytes: 0, over: false, skipped: 0 };
    const parent = path.posix.dirname(relativePath);
    if (parent !== '.') walk(this.root, parent, false);
    const visit = async (rel: string): Promise<void> => {
      if (plan.over) return;
      if (++budget.visited > limits.entries) { plan.over = true; return; }
      // Parents were checked as real directories on the way down; the entry itself is never followed.
      const st = await fsp.lstat(path.join(this.root, ...rel.split('/')));
      if (st.isFile()) {
        if (st.nlink !== 1) { plan.skipped++; return; }
        plan.files.push(rel); plan.bytes += st.size; budget.files++; budget.bytes += st.size;
        if (budget.files > limits.files || budget.bytes > limits.bytes) plan.over = true;
        return;
      }
      if (st.isSymbolicLink() || !st.isDirectory()) { plan.skipped++; return; }
      for (const child of await fsp.readdir(path.join(this.root, rel))) {
        const next = path.posix.join(rel, child);
        try { relativeName(next); } catch { plan.skipped++; continue; }
        await visit(next);
        if (plan.over) return;
      }
    };
    await visit(relativePath);
    return plan;
  }
  private async read(dir: string, id: string, key: Buffer | null): Promise<TrashEntry> {
    if (!ID.test(id)) throw new Error('invalid_id');
    if (!key) throw new Error('trash_key_missing');
    const meta = walk(dir, `${id}${META}`), stat = fs.lstatSync(meta);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 8192) throw new Error('invalid_metadata');
    const entry = JSON.parse(unseal(key, this.aad(id, 'meta'), fs.readFileSync(meta)).toString('utf8')) as TrashEntry;
    if (!entry || entry.id !== id || !Number.isFinite(entry.deletedAt) || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)
      || (entry.pending !== undefined && typeof entry.pending !== 'boolean')
      || (entry.mode !== undefined && !(Number.isInteger(entry.mode) && entry.mode >= 0 && entry.mode <= 0o777))) throw new Error('invalid_metadata');
    relativeName(entry.originalPath);
    if (await openBlob(walk(dir, `${id}${BLOB}`), key, this.aad(id, 'blob')) !== entry.sha256) throw new Error('invalid_content');
    return entry;
  }
  private writeMetadata(dir: string, entry: TrashEntry, key: Buffer): void {
    const temporary = path.join(dir, `${randomUUID()}.tmp`);
    fs.writeFileSync(temporary, seal(key, this.aad(entry.id, 'meta'), Buffer.from(JSON.stringify(entry))), { flag: 'wx', mode: 0o600 });
    try { fs.renameSync(temporary, path.join(dir, `${entry.id}${META}`)); }
    finally { if (!absent(temporary)) fs.unlinkSync(temporary); }
  }
  private discard(dir: string, id: string): void {
    for (const name of [`${id}${BLOB}`, `${id}${META}`]) if (!absent(path.join(dir, name))) fs.unlinkSync(path.join(dir, name));
  }
  /** The original is still in place with the archived bytes (the delete has not happened, or never will). */
  private async originalIntact(entry: TrashEntry): Promise<boolean> {
    try {
      const original = walk(this.root, entry.originalPath);
      return !absent(original) && (await fingerprint(original)).sha256 === entry.sha256;
    } catch { return false; }
  }
  /**
   * Seal one work-folder file into the store in a single pass over one open descriptor, then
   * verify the sealed copy before anything else happens. For an Explorer snapshot (`pending`)
   * a source that VS Code deletes while the copy is running keeps the copy: the descriptor
   * still reads the bytes the learner deleted.
   */
  private async copyIn(dir: string, rel: string, pending: boolean, key: Buffer, expected?: TrashFingerprint): Promise<{ entry: TrashEntry; source: string; before: TrashFingerprint }> {
    const source = walk(this.root, rel);
    const id = randomUUID(), blob = path.join(dir, `${id}${BLOB}`);
    let before: TrashFingerprint;
    try {
      const input = await fsp.open(source, fs.constants.O_RDONLY | NOFOLLOW);
      try {
        const start = await input.stat();
        if (!start.isFile() || start.nlink !== 1) throw new Error('not_regular_file');
        const output = await fsp.open(blob, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, 0o600);
        try {
          const iv = randomBytes(IV), cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG });
          cipher.setAAD(Buffer.from(this.aad(id, 'blob')));
          await writeAll(output, Buffer.concat([MAGIC, iv]));
          const hash = createHash('sha256'), buffer = Buffer.alloc(CHUNK);
          let total = 0, first = true;
          for (;;) {
            const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
            if (!bytesRead) break;
            total += bytesRead; hash.update(buffer.subarray(0, bytesRead));
            await writeAll(output, cipher.update(buffer.subarray(0, bytesRead)));
            if (first) { first = false; await this.hooks.sourceRead?.(source); }
          }
          await writeAll(output, Buffer.concat([cipher.final(), cipher.getAuthTag()]));
          const end = await input.stat();
          if (total !== start.size || end.size !== start.size || end.mtimeMs !== start.mtimeMs) throw new Error('file_changed');
          before = { dev: start.dev, ino: start.ino, size: start.size, mtimeMs: start.mtimeMs, mode: start.mode & 0o777, sha256: hash.digest('hex') };
        } finally { await output.close(); }
      } finally { await input.close(); }
      // The name must still be this file, unless Explorer's own delete already removed it.
      let named: fs.Stats | null = null;
      try { named = await fsp.lstat(source); } catch (e) { if (!pending || (e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      if (named ? (named.isSymbolicLink() || named.dev !== before.dev || named.ino !== before.ino) : !pending) throw new Error('file_changed');
      if (expected && !same(expected, before)) throw new Error('file_changed');
      await this.hooks.blobWritten?.(blob);
      if (await openBlob(blob, key, this.aad(id, 'blob')) !== before.sha256) throw new Error('file_changed');
      const entry: TrashEntry = { id, originalPath: rel, deletedAt: Date.now(), sha256: before.sha256, mode: before.mode };
      if (pending) entry.pending = true;
      this.writeMetadata(dir, entry, key);
      return { entry, source, before };
    } catch (e) { if (!absent(blob)) fs.unlinkSync(blob); throw e; }
  }
  async list(): Promise<{ entries: TrashEntry[]; damaged: number }> {
    return this.transaction(async (dir, key) => {
      const entries: TrashEntry[] = [];
      let damaged = 0;
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith(META)) continue;
        try {
          const entry = await this.read(dir, name.slice(0, -META.length), key);
          if (entry.pending) {
            if (await this.originalIntact(entry)) {
              // VS Code still deletes after a cancelled or timed-out participant, so an
              // intact original is collected late, never at cancellation.
              if (Date.now() - entry.deletedAt > PENDING_GC_MS) this.discard(dir, entry.id);
              continue;
            }
            // A crash may prevent the did-delete event: the source is gone or changed.
            delete entry.pending; this.writeMetadata(dir, entry, key!);
          }
          entries.push(entry);
        } catch (error) {
          // One damaged or foreign entry never hides the rest. Its files stay on disk.
          damaged++;
          console.warn(`[activity-trash] skipped entry ${JSON.stringify(name)}: ${(error as Error).message}`);
        }
      }
      return { entries: entries.sort((a, b) => b.deletedAt - a.deletedAt), damaged };
    });
  }
  async delete(relativePath: string, expected?: TrashFingerprint): Promise<TrashEntry> {
    return (await this.deleteMany([{ path: relativePath, expected }]))[0];
  }
  /** Explicit gesture: copy, verify, then remove each original. A failure stops before its original goes. */
  async deleteMany(items: { path: string; expected?: TrashFingerprint }[]): Promise<TrashEntry[]> {
    for (const item of items) relativeName(item.path);
    return this.transaction(async (dir, key) => {
      const done: TrashEntry[] = [];
      for (const item of items) {
        const { entry, source, before } = await this.copyIn(dir, item.path, false, key!, item.expected);
        try {
          if (!same(before, await fingerprint(source))) throw new Error('file_changed');
          fs.unlinkSync(source);
        } catch (e) { this.discard(dir, entry.id); throw e; }
        done.push(entry);
      }
      return done;
    }, true);
  }
  /** Copy only: Explorer still owns the actual delete and its own confirmation. */
  async prepareNativeDelete(paths: string[], token?: { isCancellationRequested: boolean }): Promise<{ ids: string[]; failed: number }> {
    for (const rel of paths) relativeName(rel);
    return this.transaction(async (dir, key) => {
      const ids: string[] = [];
      let failed = 0;
      for (const rel of paths) {
        // A copy already running finishes and is kept; only copies not yet started are skipped.
        if (token?.isCancellationRequested) { failed += paths.length - ids.length - failed; break; }
        try { ids.push((await this.copyIn(dir, rel, true, key!)).entry.id); }
        catch { failed++; }
      }
      return { ids, failed };
    }, true);
  }
  /** After did-delete: an entry whose original is gone or changed becomes visible. */
  async finishNativeDelete(ids: string[]): Promise<void> {
    await this.transaction(async (dir, key) => {
      for (const id of ids) {
        const entry = await this.read(dir, id, key);
        if (!entry.pending || await this.originalIntact(entry)) continue;
        delete entry.pending; this.writeMetadata(dir, entry, key!);
      }
    });
  }
  async restore(id: string): Promise<{ path: string; renamed: boolean }> {
    return this.transaction(async (dir, key) => {
      const entry = await this.read(dir, id, key);
      if (entry.pending) throw new Error('delete_pending');
      const parsed = path.posix.parse(entry.originalPath), blob = path.join(dir, `${id}${BLOB}`);
      await this.hooks.restoreVerified?.(blob);
      for (let i = 0; i < 10000; i++) {
        const rel = i ? path.posix.join(parsed.dir, `${parsed.name} (${i})${parsed.ext}`) : entry.originalPath;
        // An occupied final link is a collision, never a path to follow.
        const parent = parsed.dir ? walk(this.root, parsed.dir, true) : this.root;
        const target = path.join(parent, path.posix.basename(rel));
        let output: fsp.FileHandle;
        try { output = await fsp.open(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, 0o600); }
        catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') continue; throw e; }
        try {
          // Decrypted straight into the new file; a tag that fails at the end removes it.
          if (await openBlob(blob, key!, this.aad(id, 'blob'), output) !== entry.sha256) throw new Error('restore_changed');
          await output.chmod(entry.mode ?? 0o644);
        } catch (e) { await output.close(); fs.unlinkSync(target); throw e; }
        await output.close();
        if ((await fingerprint(target)).sha256 !== entry.sha256) throw new Error('restore_changed');
        this.discard(dir, id);
        return { path: rel, renamed: i !== 0 };
      }
      throw new Error('name_limit');
    });
  }
  async purge(id: string): Promise<void> {
    await this.transaction(async (dir, key) => {
      if ((await this.read(dir, id, key)).pending) throw new Error('delete_pending');
      this.discard(dir, id);
    });
  }
  /** Plain permanent delete for a folder the trash cannot hold. Components are walked without following links. */
  async removePermanently(relativePath: string): Promise<void> {
    relativeName(relativePath); this.assertRoot();
    await fsp.rm(walk(this.root, relativePath), { recursive: true });
  }
  /** After a folder's files went to the trash: remove its now-empty directories, deepest first. */
  async removeEmptyDirectories(relativePath: string): Promise<boolean> {
    relativeName(relativePath); this.assertRoot();
    const prune = async (abs: string): Promise<boolean> => {
      const st = await fsp.lstat(abs);
      if (!st.isDirectory() || st.isSymbolicLink()) return false;
      let empty = true;
      for (const child of await fsp.readdir(abs)) if (!await prune(path.join(abs, child))) empty = false;
      if (!empty) return false;
      try { await fsp.rmdir(abs); return true; } catch { return false; }
    };
    return prune(walk(this.root, relativePath));
  }
}

/** A store whose folder has been missing this long (parent present) is removed. */
export const ORPHAN_GRACE_MS = 30 * 24 * 60 * 60_000;
/**
 * Retention is the life of the activity folder (its path and identity). A folder that is
 * gone while its parent is still there, or replaced by a different folder at the same path,
 * is first marked missing; the store and its key are removed only after ORPHAN_GRACE_MS, so
 * a renamed-back folder or a briefly empty mount point loses nothing. A missing parent keeps it.
 */
export async function sweepActivityTrash(base: string, keyring?: TrashKeyring, now = Date.now()): Promise<number> {
  const top = path.join(base, 'activity-trash');
  let names: string[];
  try { names = await fsp.readdir(top); } catch { return 0; }
  let removed = 0;
  for (const name of names) {
    if (!/^[a-f0-9]{24}$/.test(name)) continue;
    const store = path.join(top, name);
    try {
      const markerFile = path.join(store, 'root.json');
      const marker = JSON.parse(await fsp.readFile(markerFile, 'utf8')) as { path?: unknown; identity?: unknown; missingSince?: unknown };
      // A copied or forged marker never names this store, so it can never get it swept.
      if (typeof marker.path !== 'string' || !path.isAbsolute(marker.path) || typeof marker.identity !== 'string' || activityTrashStoreDir(base, marker.path, marker.identity) !== store) continue;
      const parent = await fsp.lstat(path.dirname(marker.path)).catch(() => null);
      let identity: string | null = null;
      try { identity = folderIdentity(marker.path); } catch { identity = null; }
      const present = identity === marker.identity;
      if (present || (absent(marker.path) && !parent?.isDirectory())) {
        if (marker.missingSince !== undefined) await fsp.writeFile(markerFile, JSON.stringify({ path: marker.path, identity: marker.identity }), { mode: 0o600 });
        continue;
      }
      if (typeof marker.missingSince !== 'number' || !Number.isFinite(marker.missingSince)) {
        await fsp.writeFile(markerFile, JSON.stringify({ path: marker.path, identity: marker.identity, missingSince: now }), { mode: 0o600 });
        continue;
      }
      if (now - marker.missingSince <= ORPHAN_GRACE_MS) continue;
      await fsp.rm(store, { recursive: true, force: true }); removed++;
      await keyring?.delete(activityTrashKeyName(store));
    } catch (error) { console.warn(`[activity-trash] sweep skipped ${name}: ${(error as Error).message}`); }
  }
  return removed;
}
