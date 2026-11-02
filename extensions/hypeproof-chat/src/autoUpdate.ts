// #3411 — automatic updates without a click (Chrome-style). Pure policy plus a small
// file-based window registry; no vscode import so the rules are unit-tested directly.
//
// A newer release is downloaded, verified and staged in the background. It is applied
//   1. on the next committed app quit (the existing CGP-SHELL-R-002 hook), or
//   2. by an idle restart, only when nothing can be interrupted (idleApplyBlocker).
// After the new version starts, one Korean line says it updated, with the release link.
import * as fs from "fs";
import * as path from "path";

/** Machine setting `hypeproofChat.autoUpdate` (default true). Manual commands work either way. */
export const AUTO_UPDATE_SETTING = "autoUpdate";
/** Check cadence while auto-update is on: startup (+30 s), then every 4 hours. */
export const AUTO_UPDATE_CHECK_INTERVAL_MS = 4 * 3600 * 1000;
/** How long the window must be in the background, and the chat untouched, before an idle restart. */
export const IDLE_APPLY_AFTER_MS = 30 * 60 * 1000;
/** Idle monitor tick. */
export const IDLE_POLL_MS = 60 * 1000;
/** A window's presence record older than this is a closed or crashed window. */
export const PRESENCE_STALE_MS = 3 * IDLE_POLL_MS;
/** globalState: the update this app staged automatically, announced once the new version runs. */
export const AUTO_UPDATE_NOTICE_KEY = "hypeproofChat.autoUpdateNotice";
export const AUTO_UPDATE_RELEASE_LABEL = "변경 내용 보기";

export function autoUpdateAppliedCopy(version: string): string {
  return `Studio를 v${version}(으)로 자동 업데이트했어요.`;
}

/** Everything that can be interrupted by an idle restart, read at each tick. */
export interface IdleApplySnapshot {
  autoUpdate: boolean;
  /** A verified update is staged and newer than the running app. */
  staged: boolean;
  /** A coach turn is streaming, settling or waiting on an approval (provider.hasActiveStream). */
  turnRunning: boolean;
  /** A queued message has not been sent. */
  queuedUnsent: boolean;
  /** The composer holds typed text, images, an inline edit or a recovered request. */
  unsentDraft: boolean;
  /** A process the coach or learner started is still running. */
  processRunning: boolean;
  /** The preview server is serving. */
  previewRunning: boolean;
  /** Class seat (CGP-SHELL-R-001): no download, install or restart. */
  classHeld: boolean;
  /** Any other Studio window is open: a restart would quit it too. */
  otherWindows: number;
  windowFocused: boolean;
  /** How long the window has been in the background (0 while focused). */
  unfocusedMs: number;
  /** Time since the last chat-panel interaction. */
  chatIdleMs: number;
}

export type IdleApplyBlocker =
  | "auto-update-off" | "nothing-staged" | "class" | "turn" | "queued" | "draft" | "process"
  | "preview" | "other-window" | "focused" | "recently-used";

/**
 * Why an idle restart must not happen now, or null when it may. The order is the
 * priority of the reason; any one blocks. A running turn always blocks (never mid-turn).
 */
export function idleApplyBlocker(s: IdleApplySnapshot): IdleApplyBlocker | null {
  if (!s.autoUpdate) return "auto-update-off";
  if (!s.staged) return "nothing-staged";
  if (s.classHeld) return "class";
  if (s.turnRunning) return "turn";
  if (s.queuedUnsent) return "queued";
  if (s.unsentDraft) return "draft";
  if (s.processRunning) return "process";
  if (s.previewRunning) return "preview";
  if (s.otherWindows > 0) return "other-window";
  if (s.windowFocused) return "focused";
  if (!(s.unfocusedMs >= IDLE_APPLY_AFTER_MS) || !(s.chatIdleMs >= IDLE_APPLY_AFTER_MS)) return "recently-used";
  return null;
}

/** Whether a found release should be downloaded in the background now. */
export function shouldStageInBackground(input: { autoUpdate: boolean; classHeld: boolean; available: boolean; version: string; stagedVersion: string | null }): boolean {
  return input.autoUpdate && !input.classHeld && input.available && input.stagedVersion !== input.version;
}

/** True when the composer state would be lost or surprising after a restart. */
export function draftHasContent(draft: unknown): boolean {
  if (!draft || typeof draft !== "object") return false;
  const d = draft as { text?: unknown; images?: unknown; queued?: unknown; inlineEdit?: unknown; recovered?: unknown };
  return (typeof d.text === "string" && d.text.trim().length > 0) ||
    (Array.isArray(d.images) && d.images.length > 0) ||
    (typeof d.queued === "string" && d.queued.trim().length > 0) ||
    (!!d.inlineEdit && typeof d.inlineEdit === "object") ||
    (Array.isArray(d.recovered) && d.recovered.length > 0);
}

export interface AutoUpdateNotice { version: string; releaseUrl: string }

/**
 * What to say at activation for a stored notice: "show" once the running version reached
 * it, "keep" while it is still pending, "drop" for a malformed record.
 */
export function autoUpdateNoticeAction(
  stored: unknown,
  currentVersion: string,
  compare: (a: string, b: string) => number,
): "show" | "keep" | "drop" | "none" {
  if (stored === undefined || stored === null) return "none";
  const n = stored as Partial<AutoUpdateNotice>;
  if (typeof n.version !== "string" || typeof n.releaseUrl !== "string" || !/^https:\/\//.test(n.releaseUrl)) return "drop";
  try { return compare(currentVersion, n.version) >= 0 ? "show" : "keep"; } catch { return "drop"; }
}

/**
 * Per-app registry of open Studio windows (each window runs its own extension host).
 * Each window rewrites its record every idle tick; stale records are ignored and removed.
 */
export class WindowPresence {
  private readonly file: string;
  private readonly directory: string;
  private readonly id: string;
  constructor(directory: string, id: string) {
    this.directory = directory;
    this.id = id;
    this.file = path.join(directory, `${id}.json`);
  }

  beat(now: number = Date.now()): void {
    try {
      fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      const temporary = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify({ at: now }), { mode: 0o600 });
      fs.renameSync(temporary, this.file);
    } catch { /* presence is best effort; an unreadable registry counts others conservatively below */ }
  }

  /** Other live windows. An unreadable registry counts as one, so it never permits a restart. */
  others(now: number = Date.now()): number {
    let names: string[];
    try { names = fs.readdirSync(this.directory); } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT" ? 0 : 1;
    }
    let count = 0;
    for (const name of names) {
      if (!name.endsWith(".json") || name === `${this.id}.json`) continue;
      const file = path.join(this.directory, name);
      try {
        const at = JSON.parse(fs.readFileSync(file, "utf8"))?.at;
        if (typeof at === "number" && now - at < PRESENCE_STALE_MS && at - now < PRESENCE_STALE_MS) count++;
        else fs.rmSync(file, { force: true });
      } catch { count++; }
    }
    return count;
  }

  dispose(): void {
    try { fs.rmSync(this.file, { force: true }); } catch { /* ignore */ }
  }
}
