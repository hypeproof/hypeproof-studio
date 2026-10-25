import { randomBytes, timingSafeEqual } from "node:crypto";
import * as http from "node:http";
import * as path from "node:path";
import * as vscode from "vscode";
import { LIVERELOAD_PATH, serveStatic, staticResponseHeaders } from "./liveServerHelpers";
import { FOLLOW_CHOICE_PATH, SSE_RELOAD, SSE_RELOAD_FOLLOW, stateMessage, type FollowState } from "./liveFollow.ts";

// #278 Phase 1 — in-process live server for the "live_server" preview path.
//
// Why: a real (multi-file) homepage needs a real HTTP origin — relative asset
// paths (`./styles.css`, `./img/x.png`), same-origin `fetch`, storage, and page
// navigation all fail inside the sandboxed opaque-origin iframe used by
// PreviewProvider. This serves the workspace root over http://127.0.0.1:PORT so
// the native integrated browser (openBrowserTab) can load it like a real site.
//
// Live reload: served HTML gets a tiny SSE client injected (see
// liveServerHelpers.injectLiveReload); a FileSystemWatcher on the served root
// pushes a "reload" event whenever any file changes (the coach regenerating
// index.html, or the user editing a sibling file), so the browser refreshes
// itself. No CDP / browser-tab plumbing needed for reload.
//
// Security: binds 127.0.0.1 only; path traversal is rejected in serveStatic;
// every static response carries a Permissions-Policy denying camera, microphone,
// geolocation and display capture (#1403, staticResponseHeaders).
// Every request whose Host is not 127.0.0.1:<port> or localhost:<port> for this server's own port
// gets 403 (DNS rebinding). The only state a page can write is the learner's 따라 보기 choice
// (POST /__hp_follow, a boolean, at most 256 bytes, refused without this server's random token or
// with a foreign Origin; CGP-ART-R-017).
// Lifecycle is owned by the extension — dispose() on deactivate closes the
// server + watcher + open SSE streams.

const SERVED_ORIGINS_KEPT = 20;
/** A remembered address older than this is forgotten: an OS ephemeral port may meanwhile belong to another tool. */
export const SERVED_ORIGIN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** One remembered preview address and when Studio last served it (ms since epoch). */
export interface ServedOrigin { o: string; t: number }
type ServedMemory = { get(): readonly unknown[]; set(origins: ServedOrigin[]): void };
const asServed = (x: unknown): x is ServedOrigin => !!x && typeof x === "object" && typeof (x as ServedOrigin).o === "string" && typeof (x as ServedOrigin).t === "number";
/** "http://127.0.0.1:5123" for either loopback spelling; undefined for anything else. */
function loopbackOrigin(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") return undefined;
    return `${u.protocol}//127.0.0.1:${u.port}`;
  } catch { return undefined; }
}

export class LiveServer {
  private readonly listeners = new Set<() => void>();
  onChange(listener: () => void): { dispose(): void } { this.listeners.add(listener); return { dispose: () => { this.listeners.delete(listener); } }; }
  private changed(): void { for (const listener of this.listeners) listener(); }
  private server: http.Server | undefined;
  private root: string | undefined;
  private baseUrl: string | undefined;
  private startPromise: Promise<string> | undefined;
  private readonly sseClients = new Set<http.ServerResponse>();
  private watcher: vscode.FileSystemWatcher | undefined;
  private reloadTimer: ReturnType<typeof setTimeout> | undefined;
  /** CGP-ART-R-017 — a coach turn is running: file changes in the root are followed (따라 보기). */
  private coachEditing = false;
  /** CR-68 — sources whose browser automation is acting on the page right now. */
  private readonly automation = new Set<string>();
  /** A change seen while the coach was editing is waiting in the debounce. */
  private followPending = false;
  /**
   * The learner's 따라 보기 choice, kept here rather than in the page's storage so page script
   * cannot overwrite it; the page posts it with `followToken`, which only served HTML carries.
   */
  private learnerFollow = true;
  private readonly followToken = randomBytes(18).toString("base64url");

  /**
   * REQ-STUDIO-PREVIEW-RECOVERY — addresses this Studio's preview server has served. `served` is kept across restarts
   * by the caller (at most 20, each forgotten after 7 days), so a tab restored on an old port is still known as the
   * learner's preview; `sessionOrigins` are the ones this process served, the only ones a tab may be closed for.
   */
  private readonly served: ServedMemory | undefined;
  private readonly now: () => number;
  private readonly sessionOrigins = new Set<string>();
  constructor(served?: ServedMemory, now: () => number = Date.now) {
    this.served = served;
    this.now = now;
  }

  private remembered(): ServedOrigin[] {
    const cutoff = this.now() - SERVED_ORIGIN_TTL_MS;
    return (this.served?.get() ?? []).filter(asServed).filter((e) => e.t >= cutoff).slice(0, SERVED_ORIGINS_KEPT);
  }

  /** True when `url` is on an address a Studio preview server served (this run, or a remembered one under 7 days old). */
  servedBefore(url: string | undefined): boolean {
    const origin = loopbackOrigin(url);
    if (!origin) return false;
    return this.sessionOrigins.has(origin) || this.remembered().some((e) => e.o === origin);
  }

  /** True only for addresses this process's server served. Tabs on other loopback addresses are never closed by Studio. */
  servedThisSession(url: string | undefined): boolean {
    const origin = loopbackOrigin(url);
    return !!origin && this.sessionOrigins.has(origin);
  }

  /** The server's socket is accepting connections now (false after a close or a crash, even while the object is kept). */
  isListening(): boolean {
    return !!this.server?.listening;
  }

  /**
   * Ensure a server is running rooted at `root`. Returns its base URL. If a
   * server is already running for a different root it is restarted. Concurrent
   * calls for the same root share one start.
   */
  async ensure(root: string): Promise<string> {
    const resolvedRoot = path.resolve(root);
    // A server object whose socket no longer listens (closed or crashed) is not reused: it is dropped and started again.
    if (this.server && this.root === resolvedRoot && this.baseUrl && this.server.listening) return this.baseUrl;
    if (this.startPromise && this.root === resolvedRoot) return this.startPromise;
    this.startPromise = this.start(resolvedRoot).finally(() => {
      this.startPromise = undefined;
    });
    return this.startPromise;
  }

  /**
   * #507 — the base URL of the RUNNING server, or undefined when nothing is
   * serving. Never starts anything: callers that only need to tell the coach
   * "the preview lives here" must not have the side effect of booting a server.
   *
   * This is the single source of truth for the preview address. The port is
   * chosen by the OS on every start (`listen(0)`), so anyone who does not read
   * it here is guessing — which is exactly how the coach ended up navigating
   * to a dead `127.0.0.1:3000`.
   */
  currentUrl(): string | undefined {
    return this.server ? this.baseUrl : undefined;
  }

  /** The root being served, or undefined when no server is up (CR-09/CR-10 source mapping and versions). */
  currentRoot(): string | undefined {
    return this.server ? this.root : undefined;
  }

  /**
   * #751 — bring the preview back for the SAME root without touching any file.
   * A healthy server only gets a reload push (its port, and so every open
   * preview URL, stays valid). A dead one is started again; the OS picks a new
   * port, which the caller must report instead of claiming the old tab works.
   */
  async recover(probe: (url: string) => Promise<boolean>): Promise<{ state: "no_preview" | "reloaded" | "restarted"; url?: string }> {
    const root = this.root;
    if (!root) return { state: "no_preview" };
    if (this.server && this.baseUrl && (await probe(this.baseUrl))) { this.reload(); return { state: "reloaded", url: this.baseUrl }; }
    const url = await this.start(root);
    return { state: "restarted", url };
  }

  /**
   * #751 U4 — test builds only (extension.ts arms it under HPS_TEST_PREVIEW_FAULT). The listening socket and every open
   * connection die the way a crashed server's do, while root and address are kept — so `recover` meets a dead server and
   * has to start one on a new port, as it would in class. No file, process or port outside this server is touched.
   */
  simulateCrashForTest(): void {
    const server = this.server;
    if (!server) return;
    for (const res of this.sseClients) res.destroy();
    this.sseClients.clear();
    server.close();
    server.closeAllConnections();
  }

  /**
   * Push a reload to all connected browser pages. `follow` asks the page to scroll to what
   * changed (CGP-ART-R-017); only a file change made while a coach turn runs passes it.
   */
  reload(follow = false): void {
    this.broadcast(follow ? SSE_RELOAD_FOLLOW : SSE_RELOAD);
  }

  /** The state a served page needs for 따라 보기 (embedded at serve time, then pushed on change). */
  followState(): FollowState {
    return { coach: this.coachEditing, automation: this.automation.size > 0, on: this.learnerFollow };
  }

  /** CGP-ART-R-017 — the host says whether a coach turn is running. */
  setCoachEditing(on: boolean): void {
    if (this.coachEditing === on) return;
    this.coachEditing = on;
    this.broadcast(stateMessage(this.followState()));
  }

  /** CR-68 — automation from `source` started or stopped acting on the page. */
  setAutomation(source: string, on: boolean): void {
    const before = this.automation.size > 0;
    if (on) this.automation.add(source);
    else this.automation.delete(source);
    if (before !== this.automation.size > 0) this.broadcast(stateMessage(this.followState()));
  }

  private broadcast(data: string): void {
    for (const res of this.sseClients) {
      try {
        res.write(`data: ${data}\n\n`);
      } catch {
        /* client gone; the 'close' handler removes it */
      }
    }
  }

  dispose(): void {
    void this.stop();
  }

  // ---- internals ----------------------------------------------------------

  private async start(root: string): Promise<string> {
    await this.stop();
    this.root = root;
    const server = http.createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    this.server = server;
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    this.baseUrl = `http://127.0.0.1:${port}/`;
    const origin = loopbackOrigin(this.baseUrl);
    if (origin) {
      this.sessionOrigins.add(origin);
      if (this.served) this.served.set([{ o: origin, t: this.now() }, ...this.remembered().filter((e) => e.o !== origin)].slice(0, SERVED_ORIGINS_KEPT));
    }
    this.startWatching(root);
    this.changed();
    return this.baseUrl;
  }

  async stop(): Promise<void> {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = undefined;
    }
    for (const res of this.sseClients) {
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }
    this.sseClients.clear();
    this.followPending = false;
    this.watcher?.dispose();
    this.watcher = undefined;
    const server = this.server;
    this.server = undefined;
    this.baseUrl = undefined;
    this.root = undefined;
    if (server) {
      await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
      this.changed();
    }
  }

  private startWatching(root: string): void {
    this.watcher?.dispose();
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(root), "**/*"),
    );
    const bump = () => {
      // Decided when the change happens, not when the debounce fires: the turn's last write may
      // land just before the turn ends.
      if (this.coachEditing) this.followPending = true;
      if (this.reloadTimer) clearTimeout(this.reloadTimer);
      this.reloadTimer = setTimeout(() => {
        const follow = this.followPending;
        this.followPending = false;
        this.reload(follow);
      }, 150);
    };
    watcher.onDidChange(bump);
    watcher.onDidCreate(bump);
    watcher.onDidDelete(bump);
    this.watcher = watcher;
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const root = this.root;
    if (!root) {
      res.writeHead(503);
      res.end("live server not ready");
      return;
    }
    // DNS rebinding: a page on evil.example resolved to 127.0.0.1 is same-origin to itself and could
    // read the served folder and the follow token. Only this server's own loopback Host is served.
    const port = req.socket.localPort;
    const host = req.headers.host;
    if (!port || (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)) {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      res.end("forbidden");
      return;
    }
    const urlPath = (req.url ?? "/").split("?")[0];
    if (urlPath === LIVERELOAD_PATH) {
      this.handleSse(res);
      return;
    }
    if (urlPath === FOLLOW_CHOICE_PATH) {
      this.handleFollowChoice(req, res);
      return;
    }
    const result = serveStatic(root, req.url ?? "/", this.followState(), this.followToken);
    res.writeHead(result.status, staticResponseHeaders(result.contentType));
    res.end(result.body);
  }

  /** CGP-ART-R-017 — the page client reports the learner's choice: `{on: boolean, t: token}`, POST only. */
  private handleFollowChoice(req: http.IncomingMessage, res: http.ServerResponse): void {
    const reply = (status: number) => { res.writeHead(status, { "cache-control": "no-store" }); res.end(); };
    if (req.method !== "POST") { reply(405); return; }
    // The Host was checked in handle(); a present Origin must be that same origin (a missing one stays
    // allowed: the token still gates it, and a same-origin fetch POST sends one anyway).
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== `http://${req.headers.host}`) { reply(403); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 256) { if (!res.headersSent) reply(413); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (size > 256) return;
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { reply(400); return; }
      const { on, t } = (body ?? {}) as { on?: unknown; t?: unknown };
      const want = Buffer.from(this.followToken);
      const got = Buffer.from(typeof t === "string" ? t : "");
      if (typeof on !== "boolean" || got.length !== want.length || !timingSafeEqual(got, want)) { reply(403); return; }
      this.learnerFollow = on;
      reply(204);
    });
  }

  private handleSse(res: http.ServerResponse): void {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(": connected\n\n");
    // The state may have changed between serving the page and its stream connecting.
    res.write(`data: ${stateMessage(this.followState())}\n\n`);
    this.sseClients.add(res);
    res.on("close", () => this.sseClients.delete(res));
  }
}
