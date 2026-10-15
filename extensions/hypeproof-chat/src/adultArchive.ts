// Archive-before-overwrite for adults (orchestrator spec §6.3, FO-10). vscode-free.
//
// On an orchestrator seat, before `revealBuilt` saves index.html and before a
// coach Write replaces an existing .html (A4 and A5 call this), the current file
// is copied to `.hypeproof/history/<name>-<YYYYMMDD-HHmmss>.html`:
// - content identical to what is about to be written, or to the newest copy,
//   is not archived again (the `shouldArchiveWorld` rule);
// - the newest 20 copies of each page are kept;
// - the outcome names the copy, so the diff summary can point the coach at it,
//   and gives the one timeline line.
// No model call and no modal. A failure is reported, never thrown: an archive
// must not stop the learner's save.
//
// Adults only. Kids' world cohorts archive their worlds their own way
// (chatPanelProvider archiveCurrentWorld). The gate fails closed for a minor
// flag and for kids, teen and unknown tiers, as permittedAgentToolsFor does.

import * as fs from "node:fs";
import * as path from "node:path";
import { isWorldCohort, shouldArchiveWorld } from "./chatPanelHelpers.ts";
import { isMinorTier, isPathContained } from "./sdkCoachHelpers.ts";
import type { ResolvedProfile } from "./protocol";

/** Workspace-relative folder of the copies. */
export const ADULT_ARCHIVE_DIR = ".hypeproof/history";
/** Copies kept per page. */
export const ADULT_ARCHIVE_KEEP = 20;

export interface ArchiveSeat {
  profile: ResolvedProfile | null | undefined;
  /** The served roster is on for this seat (decided by the caller from `/v1/profile`). */
  orchestrator: boolean;
}

/** Adults on an orchestrator seat only; everything else is false. */
export function adultArchiveApplies(seat: ArchiveSeat | null | undefined): boolean {
  const profile = seat?.profile;
  if (!profile || seat?.orchestrator !== true) return false;
  if (profile.minor_cohort === true) return false;
  if (isMinorTier(profile)) return false; // kids, teen and unknown tiers
  return !isWorldCohort(profile);
}

const ARCHIVE_NAME = /^(.+)-(\d{8})-(\d{6})(?:-(\d{1,3}))?\.html$/i;

function two(n: number): string {
  return String(n).padStart(2, "0");
}

/** The page part of an archive name: the workspace-relative path without `.html`, separators as `-`. */
export function adultArchiveBase(relPath: string): string {
  return relPath.replace(/\.html?$/i, "").split(/[\\/]+/).filter(Boolean).join("-");
}

/**
 * `index.html` at 2026-10-14 15:30:12 local time → `index-20261014-153012.html`.
 * When that name is taken (compared case-insensitively, as on macOS and
 * Windows), `-2`, `-3` … are added.
 */
export function adultArchiveName(relPath: string, now: Date, taken: readonly string[] = []): string {
  const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  const used = new Set(taken.map((n) => n.toLowerCase()));
  const base = `${adultArchiveBase(relPath)}-${stamp}`;
  let name = `${base}.html`;
  for (let seq = 2; used.has(name.toLowerCase()) && seq <= 999; seq++) name = `${base}-${seq}.html`;
  return name;
}

export function parseAdultArchiveName(name: string): { base: string; stamp: string; seq: number } | null {
  const m = ARCHIVE_NAME.exec(name);
  return m ? { base: m[1], stamp: `${m[2]}-${m[3]}`, seq: m[4] ? Number(m[4]) : 1 } : null;
}

/** Newest first: by time, then by the same-second sequence. */
function newestFirst(names: readonly string[], base: string): string[] {
  return names
    .map((name) => ({ name, parsed: parseAdultArchiveName(name) }))
    .filter((x) => x.parsed && x.parsed.base.toLowerCase() === base.toLowerCase())
    .sort((x, y) => (y.parsed!.stamp.localeCompare(x.parsed!.stamp)) || (y.parsed!.seq - x.parsed!.seq))
    .map((x) => x.name);
}

/** The copies of `base` to delete so that only the newest `keep` remain, oldest last. Other files are never named. */
export function adultArchivePrune(names: readonly string[], base: string, keep: number = ADULT_ARCHIVE_KEEP): string[] {
  return newestFirst(names, base).slice(Math.max(0, keep));
}

export type AdultArchiveSkip =
  | "not_adult_seat" | "outside_workspace" | "not_html" | "in_history"
  | "missing" | "empty" | "identical" | "already_archived" | "error";

export interface AdultArchiveOutcome {
  archived: boolean;
  /** Workspace-relative path of the copy that holds the current content (also for `already_archived`). */
  path?: string;
  reason?: AdultArchiveSkip;
  /** Older copies removed to keep the newest ones. */
  removed: string[];
  /** The timeline line (spec §5.2), when a copy was made. */
  timeline?: string;
  error?: string;
}

export interface AdultArchiveRequest {
  seat: ArchiveSeat;
  workspaceRoot: string;
  /** The .html about to be replaced: absolute, or relative to the workspace. */
  file: string;
  /** What is about to be written, when known. Identical content is not archived. */
  nextContent?: string | null;
  now?: Date;
  keep?: number;
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** The timeline line for a copy (spec §5.2). */
export function adultArchiveTimelineLabel(archivedPath: string): string {
  return `🗂 이전 버전 보관 (${ADULT_ARCHIVE_DIR}) — ${path.posix.basename(archivedPath)}`;
}

/** Copy the current file into .hypeproof/history before it is replaced. Synchronous; never throws. */
export function archiveBeforeOverwrite(req: AdultArchiveRequest): AdultArchiveOutcome {
  const skip = (reason: AdultArchiveSkip, extra: Partial<AdultArchiveOutcome> = {}): AdultArchiveOutcome => ({ archived: false, reason, removed: [], ...extra });
  if (!adultArchiveApplies(req.seat)) return skip("not_adult_seat");
  try {
    const root = path.resolve(req.workspaceRoot);
    const file = path.isAbsolute(req.file) ? path.resolve(req.file) : path.resolve(root, req.file);
    if (!isPathContained(root, file)) return skip("outside_workspace");
    const rel = path.relative(root, file).split(path.sep).join("/");
    if (!/\.html?$/i.test(rel)) return skip("not_html");
    if (rel.toLowerCase().startsWith(".hypeproof/")) return skip("in_history");

    let current: string;
    try {
      if (!isInside(fs.realpathSync(root), fs.realpathSync(file))) return skip("outside_workspace");
      if (!fs.statSync(file).isFile()) return skip("missing");
      current = fs.readFileSync(file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return skip("missing");
      throw e;
    }
    if (current.trim() === "") return skip("empty");
    if (typeof req.nextContent === "string" && !shouldArchiveWorld(current, req.nextContent)) return skip("identical");

    // Never create or write anything through a link that leaves the workspace:
    // check what exists before making the folder, and the folder after.
    const realRoot = fs.realpathSync(root);
    const dir = path.join(root, ...ADULT_ARCHIVE_DIR.split("/"));
    for (const p of [path.join(root, ".hypeproof"), dir]) {
      if (fs.existsSync(p) && !isInside(realRoot, fs.realpathSync(p))) return skip("outside_workspace");
    }
    fs.mkdirSync(dir, { recursive: true });
    if (!isInside(realRoot, fs.realpathSync(dir))) return skip("outside_workspace");

    const base = adultArchiveBase(rel);
    const names = fs.readdirSync(dir);
    const newest = newestFirst(names, base)[0];
    if (newest) {
      let previous: string | null = null;
      try { previous = fs.readFileSync(path.join(dir, newest), "utf8"); } catch { /* unreadable: archive again */ }
      if (previous !== null && previous.trim() === current.trim()) {
        return skip("already_archived", { path: `${ADULT_ARCHIVE_DIR}/${newest}` });
      }
    }

    const now = req.now ?? new Date();
    const taken = [...names];
    let name = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      name = adultArchiveName(rel, now, taken);
      try {
        fs.writeFileSync(path.join(dir, name), current, { encoding: "utf8", flag: "wx" }); // never over an existing copy
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST" || attempt === 4) throw e;
        taken.push(name);
      }
    }

    const removed: string[] = [];
    for (const old of adultArchivePrune([...names, name], base, req.keep ?? ADULT_ARCHIVE_KEEP)) {
      try {
        fs.unlinkSync(path.join(dir, old));
        removed.push(old);
      } catch { /* a copy that cannot be removed stays */ }
    }
    const archivedPath = `${ADULT_ARCHIVE_DIR}/${name}`;
    return { archived: true, path: archivedPath, removed, timeline: adultArchiveTimelineLabel(archivedPath) };
  } catch (e) {
    return skip("error", { error: String((e as Error)?.message ?? e).slice(0, 200) });
  }
}
