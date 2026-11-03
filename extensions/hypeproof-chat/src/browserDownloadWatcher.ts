// CGP-KNOW-R-021 (REQ-STUDIO-BROWSER-DOWNLOADS) — one long-lived CDP session per integrated
// browser tab that pins where downloads go and reports how each one ended.
//
// Chromium keeps the download behaviour per browser context while a session that set it is
// attached; a session that detaches may put the context back to the default (Electron's save
// dialog). So every remaining session re-applies the current policy whenever a tab closes,
// the workspace changes or the cohort profile changes.
//
// Typed structurally (no `vscode` import) so the headless-Chromium smoke drives this exact
// class against a real browser.
import { CdpSession, type CdpTab } from "./cdpSession.ts";
import { DownloadTracker, downloadBehaviorCommand, type DownloadNotice, type DownloadPolicy } from "./browserDownloads.ts";

interface Watched<D> {
  session: CdpSession;
  /** null until the browser accepted a behaviour: events are then not ours to report. */
  applied: DownloadPolicy | null;
  tracker: DownloadTracker<D>;
}

export interface DownloadWatcherDeps<T extends CdpTab, D> {
  /** The policy right now (cohort safety + the activity's workspace root). */
  policy: () => DownloadPolicy;
  /** Where a line for a download that begins now belongs (activity, task). */
  capture: () => D;
  notify: (notice: DownloadNotice, dest: D) => void;
  /** Is `tab` still open? A tab closed while attaching gets no session. */
  isOpen: (tab: T) => boolean;
  attach?: (tab: T) => Promise<CdpSession>;
}

export class BrowserDownloadWatcher<T extends CdpTab, D> {
  private readonly sessions = new Map<T, Watched<D>>();
  private readonly attaching = new Map<T, Promise<void>>();
  private disposed = false;

  private readonly deps: DownloadWatcherDeps<T, D>;

  constructor(deps: DownloadWatcherDeps<T, D>) {
    this.deps = deps;
  }

  /** Start watching `tab` (idempotent). Failures leave the tab on the browser's default. */
  watch(tab: T): Promise<void> {
    if (this.disposed || this.sessions.has(tab)) return Promise.resolve();
    const pending = this.attaching.get(tab);
    if (pending) return pending;
    const run = (async () => {
      let session: CdpSession | undefined;
      try {
        session = await (this.deps.attach ?? ((t: T) => CdpSession.attach(t)))(tab);
        if (this.disposed || !this.deps.isOpen(tab)) { await session.close().catch(() => undefined); return; }
        let applied: DownloadPolicy | null = null;
        const watched: Watched<D> = {
          session,
          get applied() { return applied; },
          set applied(next) { applied = next; },
          tracker: new DownloadTracker<D>({ policy: () => applied, capture: this.deps.capture, notify: this.deps.notify }),
        };
        session.onEvent((event) => watched.tracker.handle(event));
        session.onDidClose(() => {
          if (this.sessions.get(tab) !== watched) return;
          this.sessions.delete(tab);
          watched.tracker.flush();
        });
        await session.send("Page.enable");
        if (this.disposed || !this.deps.isOpen(tab)) { await session.close().catch(() => undefined); return; }
        this.sessions.set(tab, watched);
        await this.apply(watched);
      } catch {
        this.sessions.delete(tab);
        await session?.close().catch(() => undefined);
      }
    })();
    this.attaching.set(tab, run);
    return run.finally(() => this.attaching.delete(tab));
  }

  /** The tab closed: drop its session, then re-apply on the others (see header). */
  async unwatch(tab: T): Promise<void> {
    await this.attaching.get(tab);
    const watched = this.sessions.get(tab);
    this.sessions.delete(tab);
    if (watched) {
      watched.tracker.flush();
      await watched.session.close().catch(() => undefined);
    }
    await this.reapply();
  }

  private reapplying: Promise<void> = Promise.resolve();

  /** Re-read the policy and send it to every watched tab. Calls run one after another, so the last policy wins. */
  reapply(): Promise<void> {
    this.reapplying = this.reapplying.then(() => Promise.all([...this.sessions.values()].map((w) => this.apply(w)))).then(() => undefined, () => undefined);
    return this.reapplying;
  }

  /** The policy last sent to `tab` (tests and diagnostics). */
  appliedFor(tab: T): DownloadPolicy | null | undefined {
    return this.sessions.get(tab)?.applied;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const all = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(all.map((w) => w.session.close().catch(() => undefined)));
  }

  private async apply(watched: Watched<D>): Promise<void> {
    const policy = this.deps.policy();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await watched.session.send("Page.setDownloadBehavior", downloadBehaviorCommand(policy));
        watched.applied = policy;
        return;
      } catch {
        // Retry once; after that the browser keeps whatever it had and lines stay checked
        // against the last accepted policy (none: the browser's default handles it).
      }
    }
  }
}
