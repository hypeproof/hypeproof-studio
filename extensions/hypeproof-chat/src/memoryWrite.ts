// REQ-STUDIO-MEMORY-WRITE-LINE (CGP-KNOW-R-027 / REQ-KNOW-45; DEC-01, DEC-02) — the one write path for a memory item a
// turn makes, with the receipt that lets exactly that write be undone. vscode-free, so a smoke drives what the host runs.
//
// Every turn write goes through `MemoryWriteLedger.write()`, which returns the receipt the host turns into a timeline
// line: no write without a receipt. `undo()` touches only the files that write made:
//   - an added item: the new file is removed, and only if it is still the exact file written (identity pinned right
//     after the write: device, inode, change and birth time, size, content digest);
//   - a changed item: the new file is removed (same check) and the prior file is put back with its exact bytes under
//     its own name, an exclusive create. If the prior name is taken again, or the new file changed, nothing is touched.

import { ActivityMemory, MemoryStoreError, MEMORY_LIMITS, type MemoryFileId } from "./activityMemory.ts";
import { memoryWriteItem } from "./memoryWriteLine.ts";

export interface MemoryWriteReceipt {
  /** Row id of the timeline line (`memwrite-…`). */
  id: string;
  /** The file this write made. */
  name: string;
  /** The item as the line quotes it. */
  item: string;
  /** Set when the write changed an existing item: the file it replaced. */
  replaced?: string;
}

export type MemoryUndoResult =
  | { ok: true; kind: "undone" | "restored"; item: string }
  | { ok: false; reason: "unknown" | "changed" | "failed" };

interface Entry { receipt: MemoryWriteReceipt; after: MemoryFileId; prior?: { name: string; bytes: Buffer }; used: boolean }

const LEDGER_MAX = 64;

export class MemoryWriteLedger {
  private readonly entries = new Map<string, Entry>();
  readonly store: ActivityMemory;
  private readonly newId: () => string;
  constructor(store: ActivityMemory, newId: () => string) { this.store = store; this.newId = newId; }

  /**
   * Adds an item, or with `replacing` changes one (a new file, then the old one goes). `task` is the task the turn belongs to.
   * Refusals (empty, too long, full, unsafe folder) throw MemoryStoreError and leave the store as it was.
   */
  async write(text: string, opts: { task?: string | null; replacing?: string; now?: number } = {}): Promise<MemoryWriteReceipt> {
    let prior: Entry["prior"];
    let priorId: MemoryFileId | undefined;
    if (opts.replacing !== undefined) {
      priorId = await this.store.identify(opts.replacing);
      prior = { name: opts.replacing, bytes: await this.store.readRaw(opts.replacing) };
      // restore() puts back at most MEMORY_LIMITS.bytes, the size the store lists and reads as an item. A larger file (readRaw
      // reads up to the 1 MiB pin) could not be undone, so such a replacement is refused before anything is written.
      if (prior.bytes.length > MEMORY_LIMITS.bytes) throw new MemoryStoreError("invalid");
    }
    const name = await this.store.append(text, opts.now ?? Date.now(), opts.task, opts.replacing);
    if (prior && priorId) {
      try { await this.store.remove(prior.name, priorId); } catch (error) {
        // The old item changed under the write: keep it, drop the new copy.
        await this.store.remove(name).catch(() => undefined);
        throw error;
      }
    }
    const after = await this.store.identify(name);
    const item = memoryWriteItem((await this.store.list()).entries.find(entry => entry.name === name)?.text ?? text);
    const receipt: MemoryWriteReceipt = { id: `memwrite-${this.newId()}`, name, item, ...(prior ? { replaced: prior.name } : {}) };
    this.entries.set(receipt.id, { receipt, after, prior, used: false });
    while (this.entries.size > LEDGER_MAX) this.entries.delete(this.entries.keys().next().value as string);
    return receipt;
  }

  /** Reverts exactly one write; a second press, an unknown id and a changed file are refusals that touch nothing. */
  async undo(id: string): Promise<MemoryUndoResult> {
    const entry = this.entries.get(id);
    if (!entry || entry.used) return { ok: false, reason: "unknown" };
    const { receipt, after, prior } = entry;
    try {
      // The file written must still be the file written.
      const now = await this.store.identify(receipt.name);
      if (now.digest !== after.digest || now.ino !== after.ino || now.size !== after.size || now.ctimeNs !== after.ctimeNs) return { ok: false, reason: "changed" };
      if (prior) {
        // Put the prior item back first, so a failure never leaves neither; its name must be free.
        await this.store.restore(prior.name, prior.bytes);
        try { await this.store.remove(receipt.name, after); } catch (error) {
          await this.store.remove(prior.name).catch(() => undefined);
          throw error;
        }
      } else {
        await this.store.remove(receipt.name, after);
      }
    } catch (error) {
      if (error instanceof MemoryStoreError && (error.code === "changed" || error.code === "missing" || error.code === "not_file")) return { ok: false, reason: "changed" };
      return { ok: false, reason: "failed" };
    }
    entry.used = true;
    return { ok: true, kind: prior ? "restored" : "undone", item: receipt.item };
  }
}
