// REQ-STUDIO-PAGE-CARD (CGP-ART-R-010) — host side of the page card: which rows a turn's folder diff
// yields, the in-memory cards per task, and the gate every 열기 / 폴더에서 보기 press passes.
// Node fs only, no vscode: the caller supplies open (Studio preview) and reveal (revealFileInOS).
//
// A path is acted on only when it is a row of a card this host issued for the current task, and it
// still resolves to a regular file inside that card's work folder: every segment is checked with
// lstat (a link anywhere is refused, inside or not), and the real path must stay inside the
// canonical folder (folderConsent.ts canonicalFolder / isInsideFolder).

import * as fs from "node:fs";
import * as path from "node:path";
import { canonicalFolder, isInsideFolder } from "./folderConsent.ts";
import { isPagePath, pageCandidates, PAGE_CARD_COPY, type PageCardView } from "./pageCard.ts";

export type PageResolve =
  | { ok: true; abs: string }
  | { ok: false; cause: "not-page" | "outside" | "link" | "missing" | "not-file" };

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
    if (!fs.lstatSync(cur).isFile()) return { ok: false, cause: "not-file" };
    if (!isInsideFolder(canonicalFolder(cur), base)) return { ok: false, cause: "outside" };
  } catch (e) {
    return { ok: false, cause: (e as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "outside" };
  }
  return { ok: true, abs: cur };
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
  deps: { open(abs: string): void | Promise<void>; reveal(abs: string): void | Promise<void> },
): Promise<{ ok: true; abs: string } | { ok: false; notice?: string }> {
  const entry = registry.entry(taskKey, msg.turnId);
  if (!entry) return { ok: false };
  const listed = entry.view.pages.some((p) => p.path === msg.path);
  const resolved = listed ? resolvePageInFolder(entry.root, msg.path) : null;
  if (!resolved || !resolved.ok) {
    registry.setNotice(taskKey, msg.turnId, PAGE_CARD_COPY.refused);
    return { ok: false, notice: PAGE_CARD_COPY.refused };
  }
  registry.setNotice(taskKey, msg.turnId, undefined);
  try { await (msg.type === "pageCardOpen" ? deps.open(resolved.abs) : deps.reveal(resolved.abs)); } catch { /* the press passed the gate; a failed open adds no claim */ }
  return { ok: true, abs: resolved.abs };
}
