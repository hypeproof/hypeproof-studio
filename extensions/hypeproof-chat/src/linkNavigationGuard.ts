/**
 * CGP-SHELL-R-026 — links inside the browser panel (VS Code's integrated browser). Navigation inside a browser tab
 * belongs to VS Code core, so the extension holds it through the tab's CDP session instead (no core patch). Every
 * hold happens at the network layer, before the request leaves:
 *
 *   - `Fetch.enable` pauses every main-frame http(s) Document request at the request stage.
 *   - A request to ANOTHER origin than the page (or the hop before it) is decided by `decide(url)` (the same route and
 *     dialog as a chat link) when it is (a) a navigation the page asked for (`Page.frameRequestedNavigation`: a link,
 *     a script, a meta refresh, a form submission), or (b) a server redirect hop (`redirectedRequestId`), whoever
 *     started the chain. Same-origin moves and hops continue at once; `decide` itself answers allowlisted and
 *     loopback addresses with no dialog.
 *   - Popups (`window.open`, `target=_blank`), two layers:
 *     1. With `interceptPopups` (minor seats) the page's own `window.open`, every link or form aimed at another
 *        window, and the script paths to them (anchor `click()`, a dispatched click, `form.submit`/`requestSubmit`)
 *        are replaced, before the page's scripts run, by a call to a CDP binding: no popup is created at all; the
 *        address is decided like a link and, if allowed, `openPopup` opens it as a Studio tab.
 *     2. `Target.setAutoAttach` with `waitForDebuggerOnStart` (on the root session, and on the page session) makes a
 *        page this page opens anyway (for example from a script-built frame) start PAUSED. Its own Page and Fetch
 *        holds go in before it runs, and it keeps the page's main-frame rules for its whole life: its first document
 *        is decided against its opener (a refusal fails it and closes the popup; `onPopup` reports both), and every
 *        later page-requested move or redirect hop to another origin is decided like the page's. Targets that are
 *        not this page's popups are let go.
 *   - Navigations Studio starts from outside the page (the address bar, a confirmed chat link, the coach's approved
 *     browser actions) are not page-requested and not redirects, so they are not held.
 *   - Allowed: `Fetch.continueRequest`. Refused: `Fetch.failRequest` (Aborted); the page stays where it was.
 *
 * Structurally typed against CdpSession (`send`, `sendIn` for a child session, events with their sessionId) so it runs
 * under node with a fake session and against a real headless Chromium (test/link-confirm-browser.smoke.mjs).
 */
export interface GuardCdp {
  send(method: string, params?: Record<string, unknown>): Promise<any>;
  /** A command in an auto-attached child session (a popup). Optional: without it popups are not held here. */
  sendIn?(sessionId: string, method: string, params?: Record<string, unknown>): Promise<any>;
  /** A command on the root session, where popups of the tab are auto-attached. Optional. */
  sendRoot?(method: string, params?: Record<string, unknown>): Promise<any>;
  /** This page's target id: a popup's `openerId`. */
  targetId?: string;
  /** Events of the page session (no sessionId), of child sessions (`sessionId`) and of the root session (`root`). */
  onEvent(listener: (event: { method: string; params: Record<string, any>; sessionId?: string; root?: boolean }) => void): { dispose(): void };
}
export interface GuardOptions {
  now?: () => number;
  onPopup?: (url: string, allowed: boolean) => void;
  /** Minor seats: replace the page's popup paths with a binding (layer 1 above). */
  interceptPopups?: boolean;
  /** Opens an allowed popup address as a Studio tab (layer 1). */
  openPopup?: (url: string) => void;
  /** A main-frame navigation committed (the fallback when the network hold is unavailable). */
  onCommit?: (url: string) => void;
}
const BINDING = "__hpsOpenLink";
/**
 * Runs in the page before its scripts (minor seats): every way a page script can open another window goes to the
 * binding instead — `window.open`, a click (real or scripted, `HTMLAnchorElement.prototype.click`, a dispatched click
 * event) on a link aimed at another window or with a modifier, and `form.submit()` / `requestSubmit()` or a submit
 * aimed at another window (a form is stopped: its POST cannot be replayed safely). The prototypes are wrapped and
 * locked, so a detached anchor or form behaves the same. Without the binding (inside a popup) the paths are stopped.
 */
const intercept = (withBinding: boolean) => `(()=>{if(window.__hpsPopupGuard)return;window.__hpsPopupGuard=1;var b=${withBinding ? `window.${BINDING};delete window.${BINDING}` : "null"};
var send=function(u){try{if(b)b(String(new URL(u,location.href)))}catch(_){}};
var other=function(t){return !!t&&t!=="_self"&&t!=="_top"&&t!=="_parent"};
var lock=function(o,k,v){try{Object.defineProperty(o,k,{value:v,writable:false,configurable:false})}catch(_){try{o[k]=v}catch(__){}}};
var A=HTMLAnchorElement.prototype,F=HTMLFormElement.prototype,E=EventTarget.prototype;
var aClick=A.click,dispatch=E.dispatchEvent,fSubmit=F.submit,fRequest=F.requestSubmit;
var away=function(a,e){return /^https?:/i.test(a.href)&&(other(a.target)||(e&&(e.ctrlKey||e.metaKey||e.shiftKey||e.button===1)))};
lock(window,"open",function(u){if(u)send(u);return null});
lock(A,"click",function(){if(away(this))return send(this.href);return aClick.call(this)});
lock(E,"dispatchEvent",function(e){var a=this instanceof Element&&e&&(e.type==="click"||e.type==="auxclick")?this.closest("a[href]"):null;if(a&&away(a,e))return send(a.href),false;return dispatch.call(this,e)});
lock(F,"submit",function(){if(other(this.target))return;return fSubmit.call(this)});
if(fRequest)lock(F,"requestSubmit",function(s){if(other(this.target)||(s&&other(s.getAttribute&&s.getAttribute("formtarget"))))return;return fRequest.apply(this,arguments)});
document.addEventListener("click",function(e){var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(!a||!away(a,e))return;e.preventDefault();e.stopImmediatePropagation();send(a.href)},true);
document.addEventListener("auxclick",function(e){var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(a&&/^https?:/i.test(a.href)){e.preventDefault();e.stopImmediatePropagation();send(a.href)}},true);
document.addEventListener("submit",function(e){var f=e.target,s=e.submitter;if(f&&(other(f.target)||(s&&other(s.getAttribute("formtarget"))))){e.preventDefault();e.stopImmediatePropagation()}},true)})();`;
export const POPUP_INTERCEPT = intercept(true);
const POPUP_INTERCEPT_NO_BINDING = intercept(false);

const noHash = (u: string) => { const i = u.indexOf("#"); return i < 0 ? u : u.slice(0, i); };

export function sameOrigin(a: string, b: string): boolean {
  try { return new URL(a).origin === new URL(b).origin; } catch { return false; }
}

/** How long a page-requested navigation stays matchable to its paused request. */
const REQUEST_WINDOW_MS = 10_000;
const DOCUMENTS = { patterns: [{ urlPattern: "http*", resourceType: "Document", requestStage: "Request" }] };

/** The main-frame rules' state for one page session: the tab's page, or a popup it opened (for its whole life). */
interface FrameState {
  sessionId?: string;
  targetId?: string;
  mainFrame: string | undefined;
  current: string;
  /** Page-requested navigations by address, matched to their paused request. */
  requested: Map<string, number>;
  /** The address of each paused main-frame request, so a redirect hop is compared with the hop before it. */
  hops: Map<string, string>;
  /** A popup's first document request is decided against its opener's address; a page's is not held. */
  popupFirst: boolean;
}
const frameState = (current: string, sessionId?: string, targetId?: string, popupFirst = false): FrameState =>
  ({ sessionId, targetId, mainFrame: undefined, current, requested: new Map(), hops: new Map(), popupFirst });

export class LinkNavigationGuard {
  private readonly page: FrameState = frameState("");
  /** Auto-attached popups, each with the same main-frame rules as the page for as long as it lives. */
  private readonly popups = new Map<string, FrameState>();
  private sub: { dispose(): void } | undefined;
  private scriptId: string | undefined;
  /** The main frame's address when the guard attached (or after the last main-frame navigation). */
  get currentUrl(): string { return this.page.current; }
  /** Paused requests handled (for tests and logs: counts only). */
  readonly stats = { held: 0, continued: 0, refused: 0, popups: 0 };
  /**
   * What the tab's session supports, known after `start`. The host fails closed on a minor seat when any is false:
   * `fetch` (the network hold), `autoAttach` (paused popups) or `page` (navigation events).
   */
  readonly capabilities = { page: false, fetch: false, autoAttach: false };

  private readonly cdp: GuardCdp;
  private readonly decide: (url: string) => Promise<boolean>;
  private readonly now: () => number;
  private readonly onPopup: (url: string, allowed: boolean) => void;
  private readonly options: GuardOptions;
  constructor(cdp: GuardCdp, decide: (url: string) => Promise<boolean>, options: GuardOptions = {}) {
    this.cdp = cdp; this.decide = decide; this.options = options;
    this.now = options.now ?? Date.now; this.onPopup = options.onPopup ?? (() => {});
  }

  async start(): Promise<void> {
    this.sub = this.cdp.onEvent((event) => { void this.onEvent(event).catch(() => undefined); });
    this.capabilities.page = await this.cdp.send("Page.enable").then(() => true, () => false);
    const tree = await this.cdp.send("Page.getFrameTree").catch(() => null);
    this.page.mainFrame = tree?.frameTree?.frame?.id;
    this.page.current = tree?.frameTree?.frame?.url ?? "";
    this.capabilities.fetch = await this.cdp.send("Fetch.enable", DOCUMENTS).then(() => true, () => false);
    if (this.options.interceptPopups) {
      await this.cdp.send("Runtime.enable").catch(() => undefined);
      await this.cdp.send("Runtime.addBinding", { name: BINDING }).catch(() => undefined);
      this.scriptId = (await this.cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: POPUP_INTERCEPT }).catch(() => null))?.identifier;
      await this.cdp.send("Runtime.evaluate", { expression: POPUP_INTERCEPT }).catch(() => undefined);
    }
    if (this.cdp.sendIn) {
      const auto = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true };
      const page = await this.cdp.send("Target.setAutoAttach", auto).then(() => true, () => false);
      const root = this.cdp.sendRoot ? await this.cdp.sendRoot("Target.setAutoAttach", auto).then(() => true, () => false) : false;
      this.capabilities.autoAttach = page || root;
    }
  }

  dispose(): void {
    this.sub?.dispose();
    this.sub = undefined;
    void this.cdp.send("Fetch.disable").catch(() => undefined);
    void this.cdp.send("Target.setAutoAttach", { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }).catch(() => undefined);
    void this.cdp.sendRoot?.("Target.setAutoAttach", { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }).catch(() => undefined);
    if (this.scriptId) void this.cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: this.scriptId }).catch(() => undefined);
    void this.cdp.send("Runtime.removeBinding", { name: BINDING }).catch(() => undefined);
  }

  /** A command in the page session, or in a popup's session. */
  private sendTo(state: FrameState, method: string, params?: Record<string, unknown>): Promise<any> {
    return state.sessionId && this.cdp.sendIn ? this.cdp.sendIn(state.sessionId, method, params) : this.cdp.send(method, params);
  }

  private async hold(url: string, go: () => Promise<unknown>, stop: () => Promise<unknown>): Promise<boolean> {
    this.stats.held++;
    let allowed = false;
    try { allowed = await this.decide(url); } catch { allowed = false; }
    if (allowed) { this.stats.continued++; await go(); } else { this.stats.refused++; await stop(); }
    return allowed;
  }

  private async onEvent(event: { method: string; params: Record<string, any>; sessionId?: string; root?: boolean }): Promise<void> {
    const p = event.params ?? {};
    if (event.method === "Runtime.bindingCalled" && !event.sessionId && !event.root && p.name === BINDING && typeof p.payload === "string") {
      // Layer 1: the page asked for a popup; none was created. Decide, and open it as a Studio tab if allowed.
      const url = p.payload;
      if (!/^https?:\/\//i.test(url)) return;
      const allowed = await this.hold(url, async () => { this.options.openPopup?.(url); }, async () => undefined);
      this.onPopup(url, allowed);
      return;
    }
    if (event.method === "Target.attachedToTarget" && !event.sessionId && this.cdp.sendIn) {
      // Layer 2: a target this page created (root or page auto-attach). A popup gets the page's main-frame rules for
      // its whole life, installed before it runs; a target that is not this page's popup is let go at once.
      const sid: string = p.sessionId, info = p.targetInfo ?? {};
      const mine = info.type === "page" && info.targetId !== this.cdp.targetId && (!event.root || !this.cdp.targetId || info.openerId === this.cdp.targetId);
      if (event.root && !mine) {
        if (p.waitingForDebugger) await this.cdp.sendIn(sid, "Runtime.runIfWaitingForDebugger").catch(() => undefined);
        await this.cdp.sendRoot?.("Target.detachFromTarget", { sessionId: sid }).catch(() => undefined);
        return;
      }
      if (mine) {
        this.stats.popups++;
        const state = frameState(this.page.current, sid, info.targetId, true);
        this.popups.set(sid, state);
        // Sent together, in order, with the resume last: a session processes its commands in order, so the hold is in
        // place before the popup runs. Awaiting each reply first would deadlock a `noopener` popup, whose
        // `Page.enable` does not answer until the popup is resumed.
        const sendIn = this.cdp.sendIn;
        await Promise.all([
          sendIn(sid, "Page.enable"),
          sendIn(sid, "Fetch.enable", DOCUMENTS),
          // The same popup paths inside the popup, on a minor seat (a popup must not open a further popup unseen).
          this.options.interceptPopups ? sendIn(sid, "Page.addScriptToEvaluateOnNewDocument", { source: POPUP_INTERCEPT_NO_BINDING }) : undefined,
          p.waitingForDebugger ? sendIn(sid, "Runtime.runIfWaitingForDebugger") : undefined,
        ].map((r) => Promise.resolve(r).catch(() => undefined)));
        return;
      }
      if (p.waitingForDebugger) await this.cdp.sendIn(sid, "Runtime.runIfWaitingForDebugger").catch(() => undefined);
      return;
    }
    if (event.method === "Target.detachedFromTarget" && !event.sessionId && typeof p.sessionId === "string") { this.popups.delete(p.sessionId); return; }
    const state = event.sessionId ? this.popups.get(event.sessionId) : event.root ? undefined : this.page;
    if (!state) return;
    if (event.method === "Page.frameNavigated" && p.frame && !p.frame.parentId) {
      state.mainFrame = p.frame.id; state.current = p.frame.url ?? state.current;
      if (state === this.page) this.options.onCommit?.(state.current);
      return;
    }
    if (event.method === "Page.frameRequestedNavigation" && (!state.mainFrame || p.frameId === state.mainFrame) && typeof p.url === "string") {
      state.requested.set(noHash(p.url), this.now());
      return;
    }
    if (event.method !== "Fetch.requestPaused") return;
    await this.mainFrameRequest(state, p);
  }

  /** The main-frame rules, the same for the page and for every popup it opened, for every request of their lives. */
  private async mainFrameRequest(state: FrameState, p: Record<string, any>): Promise<void> {
    const requestId: string = p.requestId, url: string = p.request?.url ?? "";
    const go = () => this.sendTo(state, "Fetch.continueRequest", { requestId });
    const stop = async () => {
      await this.sendTo(state, "Fetch.failRequest", { requestId, errorReason: "Aborted" });
      // A popup refused before it showed anything is closed.
      if (state !== this.page && state.popupFirst && state.targetId) await this.cdp.send("Target.closeTarget", { targetId: state.targetId }).catch(() => undefined);
    };
    const mainFrame = !state.mainFrame || p.frameId === state.mainFrame;
    if (!mainFrame || p.resourceType !== "Document") { this.stats.continued++; await go(); return; }
    const redirectFrom = typeof p.redirectedRequestId === "string" ? state.hops.get(p.redirectedRequestId) : undefined;
    state.hops.set(requestId, url);
    if (state.hops.size > 200) state.hops.delete(state.hops.keys().next().value as string);
    const at = state.requested.get(noHash(url));
    const pageAsked = at !== undefined && this.now() - at <= REQUEST_WINDOW_MS;
    if (pageAsked) state.requested.delete(noHash(url));
    const redirect = typeof p.redirectedRequestId === "string";
    const first = state.popupFirst;
    const from = redirect ? (redirectFrom ?? state.current) : state.current;
    // A popup's first document is judged against its opener, like a page-requested move; after that it is a page.
    if ((!pageAsked && !redirect && !first) || sameOrigin(url, from)) {
      if (!redirect) state.popupFirst = false;
      this.stats.continued++; await go(); return;
    }
    const allowed = await this.hold(url, go, stop);
    if (first && !redirect) { state.popupFirst = false; this.onPopup(url, allowed); }
  }
}

/**
 * CGP-SHELL-R-026 — the browser tabs Studio itself opens (a confirmed link, the learner's preview, the coach's approved
 * browser actions). A tab that appears with an address Studio did not open was opened by a page (`window.open`, a
 * `target=_blank` link): on a minor seat it is closed and its address goes through the confirm dialog instead.
 * Origins are kept too, so a redirect inside the site Studio opened is not mistaken for a page-opened tab.
 */
export class StudioTabLedger {
  private readonly urls = new Map<string, number>();
  private readonly origins = new Map<string, number>();
  private readonly windowMs: number;
  private readonly now: () => number;
  constructor(windowMs = 30_000, now: () => number = Date.now) { this.windowMs = windowMs; this.now = now; }
  note(url: string): void {
    const t = this.now();
    this.urls.set(noHash(url), t);
    try { this.origins.set(new URL(url).origin, t); } catch { /* not a URL */ }
    for (const map of [this.urls, this.origins]) for (const [k, at] of map) if (t - at > this.windowMs) map.delete(k);
  }
  /** A popup the guard already refused (failed before its first request): its tab is closed with no second dialog. */
  private readonly refusedUrls = new Map<string, number>();
  refuse(url: string): void { this.refusedUrls.set(noHash(url), this.now()); }
  refused(url: string): boolean { const at = this.refusedUrls.get(noHash(url)); return at !== undefined && this.now() - at <= this.windowMs; }
  /** Studio opened this address, or another page of the same site, within the window. */
  opened(url: string): boolean {
    const t = this.now(), fresh = (at: number | undefined) => at !== undefined && t - at <= this.windowMs;
    if (fresh(this.urls.get(noHash(url)))) return true;
    try { return fresh(this.origins.get(new URL(url).origin)); } catch { return false; }
  }
}
