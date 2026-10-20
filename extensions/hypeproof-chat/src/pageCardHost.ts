// REQ-STUDIO-PAGE-CARD (CGP-ART-R-010) — host side of the page card: which rows a turn's folder diff
// yields, the in-memory cards per task, and the gate every 열기 / 폴더에서 보기 press passes.
// Node fs only, no vscode: the caller supplies open (Studio preview) and reveal (revealFileInOS).
//
// A path is acted on only when it is a row of a card this host issued for the current task, and it
// still resolves to a regular file inside that card's work folder: every segment is checked with
// lstat (a link anywhere is refused, inside or not), and the real path must stay inside the
// canonical folder (folderConsent.ts canonicalFolder / isInsideFolder).
//
// Check-then-use: a process the coach left running can swap the file (or a directory on its path)
// for a link between the check and the use. 열기 therefore never reads by name: it opens the final
// component with O_NOFOLLOW, fstats the handle, requires the same dev+ino as the checked file and
// reads from that handle, so the bytes shown are the checked inode's. 폴더에서 보기 hands a path to the
// OS, so the best available is to walk the path again right before the call and refuse on any link
// or a different inode. The preview's reload-on-save reads through the same handle-based read.

import * as fs from "node:fs";
import * as path from "node:path";
import { canonicalFolder, isInsideFolder } from "./folderConsent.ts";
import { isPagePath, pageCandidates, PAGE_CARD_COPY, type PageCardView } from "./pageCard.ts";

export type PageRefusal = "not-page" | "outside" | "link" | "missing" | "not-file" | "changed";
export type PageResolve =
  | { ok: true; abs: string; dev: number; ino: number }
  | { ok: false; cause: PageRefusal };

/**
 * Test seam: runs between the path check and the use (open or reveal), so a test can swap the file
 * for a link at exactly that moment. Production never sets it.
 */
export const pageCardSeam: { afterCheck: ((abs: string) => void) | null } = { afterCheck: null };

/** Resolve a card row to the real file inside `root`, refusing links, climbs and non-files. */
export function resolvePageInFolder(root: string, rel: string): PageResolve {
  if (!isPagePath(rel)) return { ok: false, cause: path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..") ? "outside" : "not-page" };
  let base: string;
  try { base = canonicalFolder(root); } catch { return { ok: false, cause: "outside" }; }
  let cur = base;
  try {
    for (const part of rel.split("/")) {
      cur = path.join(cur, part);
      if (fs.lstatSync(cur).isSymbolicLink()) return { ok: false, cause: "link" };
    }
    const st = fs.lstatSync(cur);
    if (!st.isFile()) return { ok: false, cause: "not-file" };
    // Defense in depth: with every segment lstat-checked under the canonical base this cannot fail today.
    if (!isInsideFolder(canonicalFolder(cur), base)) return { ok: false, cause: "outside" };
    return { ok: true, abs: cur, dev: st.dev, ino: st.ino };
  } catch (e) {
    return { ok: false, cause: (e as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "outside" };
  }
}

/**
 * Read a card row's bytes from the checked inode only: O_NOFOLLOW open of the final component (a
 * swapped-in link fails with ELOOP), then the handle's dev+ino must equal the checked file's (a
 * directory on the path swapped for a link lands on another inode).
 */
export function readPageInFolder(root: string, rel: string): { ok: true; abs: string; text: string } | { ok: false; cause: PageRefusal } {
  const checked = resolvePageInFolder(root, rel);
  if (!checked.ok) return checked;
  pageCardSeam.afterCheck?.(checked.abs);
  let fd: number | undefined;
  try {
    fd = fs.openSync(checked.abs, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.dev !== checked.dev || st.ino !== checked.ino) return { ok: false, cause: "changed" };
    return { ok: true, abs: checked.abs, text: fs.readFileSync(fd).toString("utf8") };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return { ok: false, cause: code === "ELOOP" ? "link" : code === "ENOENT" ? "missing" : "changed" };
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** For 폴더에서 보기: the path is walked again right before the OS call and must still be the checked inode. */
export function recheckPageInFolder(root: string, rel: string): PageResolve {
  const first = resolvePageInFolder(root, rel);
  if (!first.ok) return first;
  pageCardSeam.afterCheck?.(first.abs);
  const again = resolvePageInFolder(root, rel);
  if (!again.ok) return again;
  return again.dev === first.dev && again.ino === first.ino ? again : { ok: false, cause: "changed" };
}

/**
 * The card for one coach turn, or null when the turn changed no page. Rows come from the turn-end
 * folder diff (added, then changed); a row that does not resolve inside the folder is dropped.
 */
export function buildPageCard(args: {
  root: string;
  turnId: string;
  anchorId: string;
  changes: { added: readonly string[]; changed: readonly string[]; deleted?: readonly string[] };
}): PageCardView | null {
  const pages = pageCandidates(args.changes).filter((p) => resolvePageInFolder(args.root, p.path).ok);
  return pages.length ? { turnId: args.turnId, anchorId: args.anchorId, pages } : null;
}

interface Entry { taskKey: string; root: string; view: PageCardView }

/** Cards issued this session, newest last, bounded. Nothing here is persisted. */
export class PageCardRegistry {
  private entries: Entry[] = [];
  private readonly max: number;
  constructor(max = 50) { this.max = max; }
  add(taskKey: string, root: string, view: PageCardView): void {
    this.entries = this.entries.filter((e) => !(e.taskKey === taskKey && e.view.turnId === view.turnId));
    this.entries.push({ taskKey, root, view });
    if (this.entries.length > this.max) this.entries = this.entries.slice(-this.max);
  }
  forTask(taskKey: string): PageCardView[] {
    return this.entries.filter((e) => e.taskKey === taskKey).map((e) => e.view);
  }
  get(taskKey: string, turnId: string): PageCardView | undefined {
    return this.entry(taskKey, turnId)?.view;
  }
  entry(taskKey: string, turnId: string): Entry | undefined {
    return this.entries.find((e) => e.taskKey === taskKey && e.view.turnId === turnId);
  }
  setNotice(taskKey: string, turnId: string, notice: string | undefined): void {
    const e = this.entry(taskKey, turnId);
    if (e) e.view = { ...e.view, notice };
  }
}

export type PageCardMessage = { type: "pageCardOpen" | "pageCardReveal"; turnId: string; path: string };

/**
 * The gate behind both buttons. Returns ok when the action was handed to `deps`; otherwise the
 * card carries a one-line notice (an unknown turn or another task's card changes nothing).
 */
export async function handlePageCardAction(
  registry: PageCardRegistry,
  taskKey: string,
  msg: PageCardMessage,
  deps: {
    /** Gets the bytes already read from the checked inode, and a reader for later reloads (null when refused). */
    open(abs: string, text: string, reload: () => string | null): void | Promise<void>;
    reveal(abs: string): void | Promise<void>;
  },
): Promise<{ ok: true; abs: string } | { ok: false; notice?: string }> {
  const entry = registry.entry(taskKey, msg.turnId);
  if (!entry) return { ok: false };
  const refuse = () => {
    registry.setNotice(taskKey, msg.turnId, PAGE_CARD_COPY.refused);
    return { ok: false as const, notice: PAGE_CARD_COPY.refused };
  };
  if (!entry.view.pages.some((p) => p.path === msg.path)) return refuse();
  const root = entry.root;
  const rel = msg.path;
  let abs: string;
  if (msg.type === "pageCardOpen") {
    const read = readPageInFolder(root, rel);
    if (!read.ok) return refuse();
    abs = read.abs;
    registry.setNotice(taskKey, msg.turnId, undefined);
    const reload = () => { const again = readPageInFolder(root, rel); return again.ok ? again.text : null; };
    try { await deps.open(abs, read.text, reload); } catch { /* the press passed the gate; a failed open adds no claim */ }
  } else {
    const checked = recheckPageInFolder(root, rel);
    if (!checked.ok) return refuse();
    abs = checked.abs;
    registry.setNotice(taskKey, msg.turnId, undefined);
    try { await deps.reveal(abs); } catch { /* as above */ }
  }
  return { ok: true, abs };
}
