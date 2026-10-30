// The live preview server stops when the last tab showing it closes (lead decision 2026-10-29, after Jay asked
// why "라이브 서버 · 실행 중" stayed after the answer ended). It is not stopped at turn end: the preview the person
// is looking at needs it. Window close already stops it (extension deactivate → LiveServer.dispose).
//
// A short grace absorbs a tab that closes while another opens (a reload into a new tab, the deck PDF export's
// background tab); the check runs on the tabs open then. Pure: tabs and the server are passed in.

import { isOwnPreviewTab } from "./voiceShowThis.ts";

export const PREVIEW_CLOSE_GRACE_MS = 3_000;
type Schedule = (run: () => void, ms: number) => { cancel(): void };
const defaultSchedule: Schedule = (run, ms) => { const t = setTimeout(run, ms); (t as { unref?: () => void }).unref?.(); return { cancel: () => clearTimeout(t) }; };

export interface PreviewTabWatchDeps {
  /** URLs of every browser tab open now (site-check and export tabs included: they keep the server in use). */
  tabUrls(): readonly (string | undefined)[];
  /** The preview server's address, or undefined when it is not running. */
  previewUrl(): string | undefined;
  listening(): boolean;
  stop(): Promise<void>;
  schedule?: Schedule;
}

export class PreviewTabWatch {
  private pending: { cancel(): void } | undefined;
  private readonly deps: PreviewTabWatchDeps;
  constructor(deps: PreviewTabWatchDeps) { this.deps = deps; }
  /** A browser tab closed: after the grace, stop the server if no open tab shows it. */
  tabClosed(): void {
    this.pending?.cancel();
    this.pending = (this.deps.schedule ?? defaultSchedule)(() => { this.pending = undefined; void this.check(); }, PREVIEW_CLOSE_GRACE_MS);
  }
  /** True when it stopped the server. */
  async check(): Promise<boolean> {
    const url = this.deps.previewUrl();
    if (!url || !this.deps.listening()) return false;
    if (this.deps.tabUrls().some((tab) => isOwnPreviewTab(tab, url))) return false;
    // The address may have changed while waiting (a restart): only the server that is unseen now stops.
    if (this.deps.previewUrl() !== url) return false;
    await this.deps.stop();
    return true;
  }
  dispose(): void { this.pending?.cancel(); this.pending = undefined; }
}
