// E5 #3777 — learners' names on the instructor's own device.
//
// The Service knows learners by handle only, and it must stay that way: a name is personal data the run does not need.
// The instructor still has to know "my learners" by name in a one-day class of 20–30 adults. So the handle→name mapping
// lives in this browser's localStorage, keyed by cohort, and is read only to label rows on screen. Nothing here builds a
// request body; the page never sends a name to the Service. The instructor can clear it at any time.
//
// Like roster-csv.ts, the whole kit is ONE self-contained factory that index.ts inlines into /manage with
// Function.prototype.toString(), so the page and the tests run the same code. Nothing inside may reference module scope.

export type NameRow = { handle: string; name: string; ok: boolean };
/** The part of Web Storage the kit uses (localStorage in the page, a Map-backed stand-in in tests). */
export type NameStore = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };

export function instructorNamesKit() {
  const PREFIX = "chalk.learner-names.v1.";
  /** A class, not a school. More entries than this is not a class roster and is not stored. */
  const MAX_ENTRIES = 500;
  const MAX_NAME = 40;
  const ID = /^[A-Za-z0-9_-]{1,128}$/;
  const FORMAT = /\p{Cf}/gu;
  const CONTROL = /[\u0000-\u001f\u007f]/;

  const keyOf = (cohort: string) => PREFIX + cohort;
  /** What a name may be: NFC, no invisible format characters (bidi, zero-width), no control characters, ≤40 chars. */
  function clean(name: unknown): string | null {
    if (typeof name !== "string") return null;
    const n = name.normalize("NFC").replace(FORMAT, "").trim();
    if (!n || CONTROL.test(n) || [...n].length > MAX_NAME) return null;
    return n;
  }

  /** The stored mapping for a cohort; anything unreadable or malformed reads as empty, never as a partial guess. */
  function load(storage: NameStore | null | undefined, cohort: string): Map<string, string> {
    const out = new Map<string, string>();
    if (!storage || !ID.test(cohort)) return out;
    let raw: string | null = null;
    try { raw = storage.getItem(keyOf(cohort)); } catch { return out; }
    if (!raw) return out;
    let v: unknown;
    try { v = JSON.parse(raw); } catch { return out; }
    if (!v || typeof v !== "object" || Array.isArray(v)) return out;
    for (const [h, n] of Object.entries(v as Record<string, unknown>)) {
      const name = clean(n);
      if (ID.test(h) && name) out.set(h, name);
      if (out.size >= MAX_ENTRIES) break;
    }
    return out;
  }

  function save(storage: NameStore | null | undefined, cohort: string, names: Map<string, string>): boolean {
    if (!storage || !ID.test(cohort) || names.size > MAX_ENTRIES) return false;
    try { storage.setItem(keyOf(cohort), JSON.stringify(Object.fromEntries(names))); return true; } catch { return false; }
  }

  function clear(storage: NameStore | null | undefined, cohort: string): boolean {
    if (!storage || !ID.test(cohort)) return false;
    try { storage.removeItem(keyOf(cohort)); return true; } catch { return false; }
  }

  /** Preview rows (handle + name) merged into the mapping. A row without a usable name changes nothing. */
  function merge(names: Map<string, string>, rows: NameRow[]): { names: Map<string, string>; added: number; changed: number; skipped: number } {
    const next = new Map(names);
    let added = 0, changed = 0, skipped = 0;
    for (const r of rows) {
      const name = clean(r.name);
      if (!r.ok || !ID.test(r.handle) || !name) { skipped++; continue; }
      if (!next.has(r.handle)) added++; else if (next.get(r.handle) !== name) changed++;
      next.set(r.handle, name);
    }
    return { names: next, added, changed, skipped };
  }

  /** The label for a handle: the stored name, else the handle itself. */
  const label = (names: Map<string, string>, handle: string) => names.get(handle) ?? handle;

  return { PREFIX, MAX_ENTRIES, keyOf, clean, load, save, clear, merge, label };
}

export const INSTRUCTOR_NAMES_SCRIPT =
  "const instructorNamesKit=((__name)=>(" + instructorNamesKit.toString() + ")())((f)=>f);";
