// CGP-KNOW-R-021 (REQ-STUDIO-BROWSER-DOWNLOADS) — downloads started in the Studio browser.
//
// The integrated browser (VS Code's WebContentsView browser, reached through the `browser`
// proposed API) has no download hook the extension can use, and the fork core is not patched
// for it. What the extension does have is a per-tab CDP session: `Page.setDownloadBehavior`
// points Chromium at a folder (or denies the download), and `Page.downloadWillBegin` /
// `Page.downloadProgress` report what happened. Chromium names the file itself (path
// separators in a server-sent name are replaced), creates the folder when it is missing and
// never opens the file.
//
// This module is the vscode-free part: which behaviour applies (policy), how a host event
// becomes one line in the chat timeline (tracker) and what the line says. It is unit-tested
// with a real temp folder and driven against headless Chromium in the browser smoke.
import * as fs from "node:fs";
import * as path from "node:path";
import { downloadDoneNotice, downloadFailedNotice, type DownloadDenyCause, type DownloadNotice } from "./browserDownloadNotice.ts";

export * from "./browserDownloadNotice.ts";

/** The activity's download folder, directly under the workspace root. */
export const DOWNLOADS_DIR = "downloads";

/** What the browser is told. `dir` is canonical: the real workspace root joined with `downloads`. */
export type DownloadPolicy =
  | { behavior: "allow"; dir: string }
  | { behavior: "deny"; cause: DownloadDenyCause };

type FsLike = Pick<typeof fs, "realpathSync" | "lstatSync" | "statSync">;

/**
 * Where browser downloads may go right now.
 *
 * - Without a loaded cohort profile the cohort is unknown: deny (it may be a minor cohort).
 * - A safe-session (minor) cohort gets no downloads at all (native-browser-spec §5.2).
 * - Without a workspace root that resolves to a real folder there is nowhere to save: deny.
 * - `downloads` that exists but is a symlink, a file, or resolves anywhere other than
 *   `<real root>/downloads` is refused: Chromium would follow it out of the workspace.
 * - A missing `downloads` is allowed; Chromium creates it on the first download.
 */
export function downloadPolicy(
  input: { profileKnown?: boolean; safeSession: boolean; workspaceRoot: string | undefined | null },
  fsx: FsLike = fs,
): DownloadPolicy {
  if (input.profileKnown === false) return { behavior: "deny", cause: "profile-unknown" };
  if (input.safeSession) return { behavior: "deny", cause: "safe-session" };
  if (typeof input.workspaceRoot !== "string" || !path.isAbsolute(input.workspaceRoot)) return { behavior: "deny", cause: "no-workspace" };
  let root: string;
  try {
    root = fsx.realpathSync(input.workspaceRoot);
    if (!fsx.statSync(root).isDirectory()) return { behavior: "deny", cause: "no-workspace" };
  } catch {
    return { behavior: "deny", cause: "no-workspace" };
  }
  const dir = path.join(root, DOWNLOADS_DIR);
  return downloadsFolderState(dir, fsx) === "bad" ? { behavior: "deny", cause: "bad-folder" } : { behavior: "allow", dir };
}

/** `missing` (Chromium may create it), `ok` (a real folder at exactly that path) or `bad`. */
function downloadsFolderState(dir: string, fsx: FsLike): "missing" | "ok" | "bad" {
  let st: fs.Stats;
  try {
    st = fsx.lstatSync(dir);
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === "ENOENT" ? "missing" : "bad";
  }
  if (st.isSymbolicLink() || !st.isDirectory()) return "bad";
  try {
    return fsx.realpathSync(dir) === dir ? "ok" : "bad";
  } catch {
    return "bad";
  }
}

/** The on-disk name to look for: one plain path component, or null when it cannot be one. */
export function plainBaseName(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 255) return null;
  if (raw === "." || raw === ".." || /[\/\\\u0000]/.test(raw)) return null;
  return raw;
}

/** A CDP event of the attached page session, structurally (no CdpSession import). */
export interface DownloadEvent {
  method: string;
  params: Record<string, unknown>;
}

interface Pending<D> {
  name: unknown;
  policy: DownloadPolicy;
  dest: D;
}

const TRACK_MAX = 64;

export interface DownloadTrackerDeps<D> {
  /** null: no behaviour is known to be in force, so the browser's own default handles it. */
  policy: () => DownloadPolicy | null;
  capture: () => D;
  notify: (notice: DownloadNotice, dest: D) => void;
  fsx?: FsLike;
}

/**
 * Turns the page session's download events into at most one line per download.
 *
 * `policy()` returns the behaviour last sent to THIS session, so the line is checked against
 * the folder Chromium was actually given, not whatever the workspace is by the time it ends.
 * `capture()` records the destination (activity/task) when the download begins; the line goes
 * there even if the learner switches tasks before it finishes.
 */
export class DownloadTracker<D> {
  private readonly pending = new Map<string, Pending<D>>();

  private readonly deps: DownloadTrackerDeps<D>;

  constructor(deps: DownloadTrackerDeps<D>) {
    this.deps = deps;
  }

  handle(event: DownloadEvent): void {
    const guid = event.params?.guid;
    if (typeof guid !== "string" || guid.length === 0 || guid.length > 128) return;
    if (event.method === "Page.downloadWillBegin") {
      if (this.pending.has(guid)) return;
      const policy = this.deps.policy();
      if (!policy) return;
      const dest = this.deps.capture();
      const name = event.params.suggestedFilename;
      if (policy.behavior === "deny") {
        // Chromium cancels it; the later `canceled` progress event finds no pending entry.
        this.deps.notify(downloadFailedNotice(name, policy.cause), dest);
        return;
      }
      this.pending.set(guid, { name, policy, dest });
      while (this.pending.size > TRACK_MAX) this.pending.delete(this.pending.keys().next().value as string);
      return;
    }
    if (event.method !== "Page.downloadProgress") return;
    const state = event.params.state;
    if (state !== "completed" && state !== "canceled") return;
    const item = this.pending.get(guid);
    if (!item) return; // began before this session attached, or already reported
    this.pending.delete(guid);
    if (state === "canceled") {
      this.deps.notify(downloadFailedNotice(item.name, "interrupted"), item.dest);
      return;
    }
    this.deps.notify(this.verify(item), item.dest);
  }

  /**
   * The session is going away (tab closed, session dropped) with downloads still running: the
   * browser may still finish them, but this session will not hear how. Say so, once each.
   */
  flush(): void {
    const items = [...this.pending.values()];
    this.pending.clear();
    for (const item of items) this.deps.notify(downloadFailedNotice(item.name, "unobserved"), item.dest);
  }

  /** The completed file must be a regular file whose real path is `<dir>/<name>`. */
  private verify(item: Pending<D>): DownloadNotice {
    const fsx = this.deps.fsx ?? fs;
    if (item.policy.behavior !== "allow") return downloadFailedNotice(item.name, "not-found");
    const dir = item.policy.dir;
    if (downloadsFolderState(dir, fsx) !== "ok") return downloadFailedNotice(item.name, "folder-changed");
    const base = plainBaseName(item.name);
    if (base === null) return downloadFailedNotice(item.name, "not-found");
    const file = path.join(dir, base);
    try {
      const st = fsx.lstatSync(file);
      if (st.isSymbolicLink() || !st.isFile() || fsx.realpathSync(file) !== file) return downloadFailedNotice(item.name, "not-found");
      return downloadDoneNotice(base, st.size);
    } catch {
      return downloadFailedNotice(item.name, "not-found");
    }
  }
}

/** The CDP command that applies `policy` to a page session. */
export function downloadBehaviorCommand(policy: DownloadPolicy): { behavior: "allow"; downloadPath: string } | { behavior: "deny" } {
  return policy.behavior === "allow" ? { behavior: "allow", downloadPath: policy.dir } : { behavior: "deny" };
}
