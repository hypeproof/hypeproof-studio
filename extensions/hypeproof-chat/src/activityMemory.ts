// REQ-STUDIO-ACTIVITY-MEMORY-FILES (CGP-KNOW-R-030 / REQ-KNOW-48; DEC-01, DEC-02) — personal
// memory as readable files inside the activity folder, `.hypeproof/memory/`. vscode-free, so a
// smoke drives exactly what the host runs.
//
// One item is one file. Studio only ever adds a new file (exclusive create, never an overwrite)
// and removes one on an explicit learner delete; it has no edit path. Reading never leaves the
// activity: the folder is walked one component at a time from the real activity root, a link at
// any step refuses the whole store, and each file is opened without following links. Nothing is
// cached, so a deleted file is absent from the next listing and the next `contextItems()` call.

import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";

/** The store, relative to the activity root. */
export const MEMORY_FOLDER = [".hypeproof", "memory"] as const;
export const MEMORY_LIMITS = { items: 200, bytes: 16 * 1024, chars: 2000 } as const;

/** One listed file. `text` is null when the file is too large or is not UTF-8 text. */
export interface MemoryFile { name: string; at: number; bytes: number; text: string | null }

export interface MemoryListing {
  entries: MemoryFile[];
  /** Files left out of the list: unsafe names, links, folders, and anything past the item cap. */
  other: number;
  /** The folder (or `.hypeproof`) is a link or not a folder: nothing was read. */
  unsafe: boolean;
}

export type MemoryStoreCode = "unsafe" | "invalid" | "empty" | "full" | "missing" | "not_file" | "changed";
export interface MemoryFileId { file: string; dev: number; ino: number }
export class MemoryStoreError extends Error {
  readonly code: MemoryStoreCode;
  constructor(code: MemoryStoreCode) { super(code); this.code = code; }
}

// Letters, digits, Hangul, space, `.`, `_` and `-`; never a leading dot or space; `.md` or `.txt`.
const NAME = /^[A-Za-z0-9가-힣_-][A-Za-z0-9가-힣 ._-]{0,99}\.(?:md|txt)$/;
/** A file name Studio lists, reads and deletes. Anything else stays on disk and is only counted. */
export function memoryFileName(name: unknown): name is string {
  return typeof name === "string" && name === name.normalize("NFC") && NAME.test(name) && !name.includes("..");
}

// C0/C1 controls except tab and newline, bidi controls, zero-width and line/paragraph separators.
const UNSAFE_TEXT = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u061C\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF]/g;
/** Text as shown and as handed to a later request: no control, bidi or separator characters. */
export function memoryText(raw: string): string {
  return raw.normalize("NFC").replace(/\r\n?/g, "\n").replace(UNSAFE_TEXT, "");
}

const missing = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";

export class ActivityMemory {
  readonly root: string;
  constructor(root: string) { this.root = root; }

  /** The store folder, walked from the real root. null when it does not exist (and `create` is false). */
  private async folder(create: boolean): Promise<string | null> {
    const real = await fs.realpath(this.root);
    let dir = real;
    for (const part of MEMORY_FOLDER) {
      dir = path.join(dir, part);
      let stat = await fs.lstat(dir).catch(error => { if (missing(error)) return null; throw error; });
      if (!stat) {
        if (!create) return null;
        await fs.mkdir(dir).catch(error => { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; });
        stat = await fs.lstat(dir);
      }
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new MemoryStoreError("unsafe");
    }
    // A component swapped for a link between the checks above still lands here.
    if (await fs.realpath(dir) !== dir) throw new MemoryStoreError("unsafe");
    return dir;
  }

  /** Reads one file without following a link; null text when it is too large or not UTF-8. */
  private async readFile(file: string): Promise<{ at: number; bytes: number; text: string | null } | null> {
    // Only a regular file is ever opened: a FIFO or device would block open() on a libuv thread
    // (four of them stall every async fs call in the extension host). The lstat skips them without
    // opening; O_NONBLOCK covers a swap between the lstat and the open, and fstat decides.
    const seen = await fs.lstat(file).catch(() => null);
    if (!seen?.isFile()) return null;
    const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => null);
    if (!handle) return null;
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1) return null;
      if (stat.size > MEMORY_LIMITS.bytes) return { at: stat.mtimeMs, bytes: stat.size, text: null };
      const buffer = await handle.readFile();
      let text: string | null;
      try { text = memoryText(new TextDecoder("utf-8", { fatal: true }).decode(buffer)); } catch { text = null; }
      return { at: stat.mtimeMs, bytes: stat.size, text };
    } finally { await handle.close(); }
  }

  /** Every memory file, newest first, read from disk now. */
  async list(): Promise<MemoryListing> {
    let dir: string | null;
    try { dir = await this.folder(false); } catch (error) {
      if (error instanceof MemoryStoreError) return { entries: [], other: 0, unsafe: true };
      throw error;
    }
    if (!dir) return { entries: [], other: 0, unsafe: false };
    const names = await fs.readdir(dir);
    const entries: MemoryFile[] = [];
    let other = 0;
    for (const name of names) {
      const file = memoryFileName(name) ? await this.readFile(path.join(dir, name)) : null;
      if (file) entries.push({ name, ...file }); else other++;
    }
    entries.sort((a, b) => b.at - a.at || (a.name < b.name ? -1 : 1));
    other += Math.max(0, entries.length - MEMORY_LIMITS.items);
    return { entries: entries.slice(0, MEMORY_LIMITS.items), other, unsafe: false };
  }

  /** The items a request may carry: listed files with readable text, read fresh on every call. */
  async contextItems(): Promise<Array<{ name: string; text: string }>> {
    const { entries } = await this.list();
    return entries.flatMap(entry => entry.text?.trim() ? [{ name: entry.name, text: entry.text }] : []);
  }

  /** Adds one item as a new file; never touches an existing one. Returns the file name. */
  async append(raw: string, now = Date.now()): Promise<string> {
    const text = memoryText(raw).trim();
    if (!text) throw new MemoryStoreError("empty");
    if ([...text].length > MEMORY_LIMITS.chars) throw new MemoryStoreError("invalid");
    const dir = await this.folder(true);
    const { entries, other } = await this.list();
    if (entries.length + other >= MEMORY_LIMITS.items) throw new MemoryStoreError("full");
    const name = `${new Date(now).toISOString().replace(/[:.]/g, "-")}-${randomBytes(4).toString("hex")}.md`;
    // O_EXCL: an existing name is an error, never an overwrite.
    const handle = await fs.open(path.join(dir!, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(`${text}\n`, "utf8"); } finally { await handle.close(); }
    return name;
  }

  /** A listed file: its absolute path and identity, after a fresh walk of the store folder. */
  async identify(name: string): Promise<MemoryFileId> {
    if (!memoryFileName(name)) throw new MemoryStoreError("invalid");
    const dir = await this.folder(false);
    if (!dir) throw new MemoryStoreError("missing");
    const file = path.join(dir, name);
    const stat = await fs.lstat(file).catch(error => { if (missing(error)) throw new MemoryStoreError("missing"); throw error; });
    if (!stat.isFile() || stat.nlink !== 1) throw new MemoryStoreError("not_file");
    return { file, dev: stat.dev, ino: stat.ino };
  }

  /** The absolute path of a listed file, for opening it in the editor. */
  async pathOf(name: string): Promise<string> {
    return (await this.identify(name)).file;
  }

  /**
   * The learner's explicit delete: removes exactly that file, nothing else. With `expected` (the
   * identity pinned before the confirm) a file replaced or a folder relinked in between is refused.
   * The store is walked again right before the unlink; the remaining window between that lstat and
   * the unlink is accepted (Node has no unlinkat) and needs a concurrent writer inside the activity.
   */
  async remove(name: string, expected?: { dev: number; ino: number }): Promise<void> {
    const now = await this.identify(name);
    if (expected && (expected.dev !== now.dev || expected.ino !== now.ino)) throw new MemoryStoreError("changed");
    await fs.unlink(now.file);
  }
}
