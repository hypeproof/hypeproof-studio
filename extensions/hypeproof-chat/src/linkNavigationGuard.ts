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
 *   - Subframes (#4128, minor seats, `decideFrame`): a document of another origin than the top page it is drawn in is
 *     decided with no dialog on every load and hop: first in its container's session, then in the out-of-process
 *     iframe's own session, which is auto-attached paused and given the same hold (and its own auto-attach). A session
 *     that cannot attach its iframes refuses cross-site frames. Subresources are not held (accepted residual).
 *   - Every other cross-origin main-frame Document is decided too (existing-window fix): a form a popup submits into
 *     its opener by name, or the page into an existing popup, fires no `frameRequestedNavigation` in the window it
 *     moves, and looks exactly like a browser-started load. Only navigations Studio itself started are let go:
 *     `studioNavigate` records each of its `Page.navigate` calls for that tab, claimed once by the navigation's shape
 *     (`StudioNavigationLedger`), and a tab `openStudioTab` opened may load its own first page once. A popup has no
 *     Studio-started navigations, so in a popup nothing is exempt.
 *     The cost: an address typed in the bar, or back/forward across origins (VS Code core, not Studio), is decided —
 *     with no dialog for loopback, the lesson list, or an adult without the confirm setting.
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
  /**
   * Layer 1 stopped a form aimed at another window (its submission cannot be replayed safely). Gets the form's
   * resolved action address, at most once per `FORM_NOTICE_MS` per action origin, so a page looping `submit()` cannot
   * flood the host and a stop to one site does not hide a stop to another (the host caps the lines it shows).
   */
  onFormStopped?: (url: string) => void;
  /**
   * #4128 (minor seats): decides a cross-site subframe document with no dialog — an iframe of the page, of a popup or
   * of another iframe, on its first load and on every later load or redirect hop. Unset (adults): subframes load.
   */
  decideFrame?: (url: string) => Promise<boolean>;
  /**
   * #4128 fail closed without the network hold: a cross-site subframe committed off the list and could not be sent
   * back to `about:blank`, or a frame went out of process where it cannot be watched. The host closes the tab.
   */
  onFrameUnheld?: () => void;
  /** Did Studio start this paused main-frame request? Default: this tab's records in `studioNavigations`. */
  studioStarted?: (request: { url: string; method?: string; headers?: Record<string, unknown> }) => boolean;
  /**
   * The address of a tab Studio opened with `openStudioTab`: only this guard's first paused main-frame Document, and
   * only while the tab has not committed a page yet, may go undecided as that tab's own first load.
   */
  studioFirstDocument?: string;
}
const BINDING = "__hpsOpenLink";
/**
 * Runs in the page before its scripts (minor seats): every way a page script can open another window goes to the
 * binding instead — `window.open`, a click (real or scripted, `HTMLAnchorElement.prototype.click`, a dispatched click
 * event) on a link aimed at another window or with a modifier, and `form.submit()` / `requestSubmit()` or a submit
 * aimed at another window (a form is stopped: its POST cannot be replayed safely, and the host is told, so the learner
 * is not left with a button that does nothing). The prototypes are wrapped and locked, so a detached anchor or form
 * behaves the same. Without the binding (inside a popup) the paths are stopped. The binding carries
 * `{"k":"open"|"form","u":<absolute url>}`; only this script holds it (it is taken off `window` before the page runs).
 * A form's target and address, and a submitter's `formtarget`/`formaction`, are read with the prototypes' getters
 * (verify-r027): `form.target`, `form.action`, `form.submit` and the like are shadowed by fields of those names.
 * The listeners are also put in every shadow root, open or closed, as it is made (`attachShadow` is wrapped and locked):
 * a submit event does not leave its root, and a click in a root is retargeted to the host. A declarative shadow root
 * (`<template shadowrootmode>`) is made by the parser, not by `attachShadow`; its popups are held by layer 2.
 * The effective target is the element's own (the submitter's `formtarget` first), else the page's `<base target>`;
 * the browsing-context keywords are ASCII case-insensitive, as in the HTML spec (verify-r027 on #4187).
 * A named target is resolved like the browser does, by the child browsing context's name (`frames[i].name`), not the
 * iframe's attribute; a cross-origin frame's name cannot be read, so it is not in-page. An empty `target=""` is no
 * target, so `<base target>` applies. A page listener that runs after these checks and changes the page (removes the
 * named frame, adds a base target) is not seen here; layer 2 holds the window that opens (pinned by a test).
 * A same-origin form or link aimed at a named iframe of this page is an in-page pattern, not another window: it goes
 * through (the frame's load is a subframe document, held by the subframe rule where that applies).
 */
const intercept = (withBinding: boolean) => `(()=>{if(window.__hpsPopupGuard)return;window.__hpsPopupGuard=1;var b=${withBinding ? `window.${BINDING};delete window.${BINDING}` : "null"};
var send=function(u,k){try{if(b)b(JSON.stringify({k:k||"open",u:String(new URL(u,location.href))}))}catch(_){}};
var G=function(P,k){var d=Object.getOwnPropertyDescriptor(P,k);return d&&d.get?function(o){return d.get.call(o)}:function(o){return o[k]}};
var FP=HTMLFormElement.prototype,IP=HTMLInputElement.prototype,BP=HTMLButtonElement.prototype,EP=Element.prototype;
var fAction=G(FP,"action"),iTarget=G(IP,"formTarget"),bTarget=G(BP,"formTarget"),iAction=G(IP,"formAction"),bAction=G(BP,"formAction");
var hasAttr=EP.hasAttribute,closest=EP.closest,isInput=function(s){return Object.getPrototypeOf(s)===IP};
var sTarget=function(s){return s&&hasAttr.call(s,"formtarget")?(isInput(s)?iTarget:bTarget)(s):null};
var sAction=function(s){return s&&hasAttr.call(s,"formaction")?(isInput(s)?iAction:bAction)(s):null};
var getAttr=EP.getAttribute,qsa=Document.prototype.querySelectorAll;
var low=function(t){return String(t).replace(/[A-Z]/g,function(c){return String.fromCharCode(c.charCodeAt(0)+32)})};
var other=function(t){if(!t)return false;t=low(t);return t!=="_self"&&t!=="_top"&&t!=="_parent"};
var baseTarget=function(){var l=qsa.call(document,"base[target]");return l.length?getAttr.call(l[0],"target"):""};
var own=function(el){var t=hasAttr.call(el,"target")?getAttr.call(el,"target"):"";return t!==""?t:baseTarget()};
var W=window,wlen=Object.getOwnPropertyDescriptor(W,"length")||Object.getOwnPropertyDescriptor(Window.prototype,"length");
var namedFrame=function(t){var n=wlen&&wlen.get?wlen.get.call(W):W.length;for(var i=0;i<n;i++){try{if(W[i].name===t)return true}catch(_){}}return false};
var sameSite=function(u){try{return new URL(u,location.href).origin===location.origin}catch(_){return false}};
var inPage=function(t,u){return namedFrame(t)&&sameSite(u)};
var aimsAway=function(f,s){var t=sTarget(s);t=t!==null?t:own(f);return other(t)&&!inPage(t,actionOf(f,s))};
var actionOf=function(f,s){try{var a=sAction(s);return a!==null?a:fAction(f)}catch(_){return location.href}};
var stopForm=function(f,s){send(actionOf(f,s),"form")};
var lock=function(o,k,v){try{Object.defineProperty(o,k,{value:v,writable:false,configurable:false})}catch(_){try{o[k]=v}catch(__){}}};
var A=HTMLAnchorElement.prototype,F=HTMLFormElement.prototype,E=EventTarget.prototype;
var aClick=A.click,dispatch=E.dispatchEvent,fSubmit=F.submit,fRequest=F.requestSubmit;
var near=function(el){return el&&el instanceof Element?closest.call(el,"a[href]"):null};
var away=function(a,e){var t=own(a);return /^https?:/i.test(a.href)&&((other(t)&&!inPage(t,a.href))||(e&&(e.ctrlKey||e.metaKey||e.shiftKey||e.button===1)))};
lock(window,"open",function(u){if(u)send(u);return null});
lock(A,"click",function(){if(away(this))return send(this.href);return aClick.call(this)});
lock(E,"dispatchEvent",function(e){var a=e&&(e.type==="click"||e.type==="auxclick")?near(this):null;if(a&&away(a,e))return send(a.href),false;return dispatch.call(this,e)});
lock(F,"submit",function(){if(aimsAway(this))return stopForm(this);return fSubmit.call(this)});
if(fRequest)lock(F,"requestSubmit",function(s){if(aimsAway(this,s))return stopForm(this,s);return fRequest.apply(this,arguments)});
var onClick=function(e){var a=near(e.target);if(!a||!away(a,e))return;e.preventDefault();e.stopImmediatePropagation();send(a.href)};
var onAux=function(e){var a=near(e.target);if(a&&/^https?:/i.test(a.href)){e.preventDefault();e.stopImmediatePropagation();send(a.href)}};
var onSubmit=function(e){var f=e.target,s=e.submitter;if(f instanceof HTMLFormElement&&aimsAway(f,s)){e.preventDefault();e.stopImmediatePropagation();stopForm(f,s)}};
var listen=E.addEventListener,guardRoot=function(r){listen.call(r,"click",onClick,true);listen.call(r,"auxclick",onAux,true);listen.call(r,"submit",onSubmit,true)};
var attach=EP.attachShadow;if(attach)lock(EP,"attachShadow",function(){var r=attach.apply(this,arguments);guardRoot(r);return r});
guardRoot(document)})();`;
export const POPUP_INTERCEPT = intercept(true);
const POPUP_INTERCEPT_NO_BINDING = intercept(false);

const noHash = (u: string) => { const i = u.indexOf("#"); return i < 0 ? u : u.slice(0, i); };

export function sameOrigin(a: string, b: string): boolean {
  try { return new URL(a).origin === new URL(b).origin; } catch { return false; }
}

/** How long a page-requested navigation stays matchable to its paused request. */
const REQUEST_WINDOW_MS = 10_000;
/** At most one stopped-form report per this many ms per tab. */
export const FORM_NOTICE_MS = 3_000;
const DOCUMENTS = { patterns: [{ urlPattern: "http*", resourceType: "Document", requestStage: "Request" }] };

/**
 * One session the guard holds requests in: the tab's page, a popup it opened (main-frame rules for its whole life), or
 * an out-of-process iframe (#4128: subframe rules only, judged against the top page that contains it).
 */
interface FrameState {
  kind: "page" | "popup" | "frame";
  /** A frame's container: the page, a popup, or another frame. */
  owner?: FrameState;
  /** This session auto-attaches its own out-of-process iframes (paused), so their later loads can be held too. */
  framesAttached: boolean;
  /** `Fetch.enable` worked in this session: its requests are held before they leave. */
  fetchHeld: boolean;
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
const frameState = (kind: FrameState["kind"], current: string, sessionId?: string, targetId?: string, owner?: FrameState): FrameState =>
  ({ kind, owner, framesAttached: false, fetchHeld: false, sessionId, targetId, mainFrame: kind === "page" ? undefined : targetId, current, requested: new Map(), hops: new Map(), popupFirst: kind === "popup" });
/** The page (or popup) a frame state is drawn in: subframes are compared with its address. */
const topOf = (state: FrameState): FrameState => { let s = state; while (s.kind === "frame" && s.owner) s = s.owner; return s; };
const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true };

export class LinkNavigationGuard {
  private readonly page: FrameState = frameState("page", "");
  /** Auto-attached sessions by sessionId: popups (main-frame rules for life) and out-of-process iframes (#4128). */
  private readonly children = new Map<string, FrameState>();
  private sub: { dispose(): void } | undefined;
  private scriptId: string | undefined;
  /** The main frame's address when the guard attached (or after the last main-frame navigation). */
  get currentUrl(): string { return this.page.current; }
  /** Paused requests handled (for tests and logs: counts only). */
  readonly stats = { held: 0, continued: 0, refused: 0, popups: 0, frames: 0, framesRefused: 0 };
  /** The last stopped-form report per action origin (the cap is per origin: one site cannot hide another). */
  private readonly lastFormNotice = new Map<string, number>();
  /**
   * What the tab's session supports, known after `start`. The host fails closed on a minor seat when any is false:
   * `fetch` (the network hold), `autoAttach` (paused popups) or `page` (navigation events).
   */
  readonly capabilities = { page: false, fetch: false, autoAttach: false };

  private readonly cdp: GuardCdp;
  private readonly decide: (url: string) => Promise<boolean>;
  private readonly now: () => number;
  private readonly onPopup: (url: string, allowed: boolean) => void;
  private readonly studioStarted: (request: { url: string; method?: string; headers?: Record<string, unknown> }) => boolean;
  private firstDocument: string | undefined;
  private readonly options: GuardOptions;
  constructor(cdp: GuardCdp, decide: (url: string) => Promise<boolean>, options: GuardOptions = {}) {
    this.cdp = cdp; this.decide = decide; this.options = options;
    this.now = options.now ?? Date.now; this.onPopup = options.onPopup ?? (() => {});
    this.studioStarted = options.studioStarted ?? ((r) => studioNavigations.claim(this.cdp.targetId, r));
    this.firstDocument = options.studioFirstDocument;
  }

  async start(): Promise<void> {
    this.sub = this.cdp.onEvent((event) => { void this.onEvent(event).catch(() => undefined); });
    this.capabilities.page = await this.cdp.send("Page.enable").then(() => true, () => false);
    const tree = await this.cdp.send("Page.getFrameTree").catch(() => null);
    this.page.mainFrame = tree?.frameTree?.frame?.id;
    this.page.current = tree?.frameTree?.frame?.url ?? "";
    this.capabilities.fetch = await this.cdp.send("Fetch.enable", DOCUMENTS).then(() => true, () => false);
    this.page.fetchHeld = this.capabilities.fetch;
    if (this.options.interceptPopups) {
      await this.cdp.send("Runtime.enable").catch(() => undefined);
      await this.cdp.send("Runtime.addBinding", { name: BINDING }).catch(() => undefined);
      this.scriptId = (await this.cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: POPUP_INTERCEPT }).catch(() => null))?.identifier;
      await this.cdp.send("Runtime.evaluate", { expression: POPUP_INTERCEPT }).catch(() => undefined);
    }
    if (this.cdp.sendIn) {
      const page = await this.cdp.send("Target.setAutoAttach", AUTO_ATTACH).then(() => true, () => false);
      const root = this.cdp.sendRoot ? await this.cdp.sendRoot("Target.setAutoAttach", AUTO_ATTACH).then(() => true, () => false) : false;
      this.capabilities.autoAttach = page || root;
      // The page session's auto-attach is what brings out-of-process iframes in (paused); the root's brings popups.
      this.page.framesAttached = page;
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
      let msg: { k?: unknown; u?: unknown } = {};
      try { msg = JSON.parse(p.payload); } catch { return; }
      const url = typeof msg.u === "string" ? msg.u : "";
      if (!/^https?:\/\//i.test(url)) return;
      if (msg.k === "form") {
        // A form aimed at another window was stopped: report it (rate-limited), never replay it.
        const t = this.now();
        let origin = url; try { origin = new URL(url).origin; } catch { /* keep the address */ }
        const last = this.lastFormNotice.get(origin);
        if (last === undefined || t - last >= FORM_NOTICE_MS) {
          this.lastFormNotice.set(origin, t);
          if (this.lastFormNotice.size > 50) this.lastFormNotice.delete(this.lastFormNotice.keys().next().value as string);
          this.options.onFormStopped?.(url);
        }
        return;
      }
      if (msg.k !== "open") return;
      const allowed = await this.hold(url, async () => { this.options.openPopup?.(url); }, async () => undefined);
      this.onPopup(url, allowed);
      return;
    }
    if (event.method === "Target.attachedToTarget" && this.cdp.sendIn) {
      const sid: string = p.sessionId, info = p.targetInfo ?? {};
      // The session that auto-attached it: the page, the root, or a popup or frame the guard already holds.
      const parent = event.sessionId ? this.children.get(event.sessionId) : event.root ? undefined : this.page;
      if (info.type === "iframe" && parent) {
        // #4128: an out-of-process iframe (its first load was decided in its container). On a minor seat its later
        // loads and redirect hops are held in its own session, and its own iframes are attached the same way; the
        // hold goes in before it runs (sent in order, resume last). Adults: let go, as before.
        if (this.options.decideFrame) {
          const state = frameState("frame", "", sid, info.targetId, parent);
          this.children.set(sid, state);
          this.stats.frames++;
          const sendIn = this.cdp.sendIn;
          await Promise.all([
            // Page events too: without the network hold, a commit is the fallback (sent back to about:blank).
            sendIn(sid, "Page.enable"),
            sendIn(sid, "Fetch.enable", DOCUMENTS).then(() => { state.fetchHeld = true; }),
            sendIn(sid, "Target.setAutoAttach", AUTO_ATTACH).then(() => { state.framesAttached = true; }),
            p.waitingForDebugger ? sendIn(sid, "Runtime.runIfWaitingForDebugger") : undefined,
          ].map((r) => Promise.resolve(r).catch(() => undefined)));
          return;
        }
        if (p.waitingForDebugger) await this.cdp.sendIn(sid, "Runtime.runIfWaitingForDebugger").catch(() => undefined);
        return;
      }
      if (event.sessionId) {
        // Anything else a popup or frame attached (a worker): let it run.
        if (p.waitingForDebugger) await this.cdp.sendIn(sid, "Runtime.runIfWaitingForDebugger").catch(() => undefined);
        return;
      }
      // Layer 2: a target this page created (root or page auto-attach). A popup gets the page's main-frame rules for
      // its whole life, installed before it runs; a target that is not this page's popup is let go at once.
      const mine = info.type === "page" && info.targetId !== this.cdp.targetId && (!event.root || !this.cdp.targetId || info.openerId === this.cdp.targetId);
      if (event.root && !mine) {
        if (p.waitingForDebugger) await this.cdp.sendIn(sid, "Runtime.runIfWaitingForDebugger").catch(() => undefined);
        await this.cdp.sendRoot?.("Target.detachFromTarget", { sessionId: sid }).catch(() => undefined);
        return;
      }
      if (mine) {
        this.stats.popups++;
        const state = frameState("popup", this.page.current, sid, info.targetId);
        this.children.set(sid, state);
        // Sent together, in order, with the resume last: a session processes its commands in order, so the hold is in
        // place before the popup runs. Awaiting each reply first would deadlock a `noopener` popup, whose
        // `Page.enable` does not answer until the popup is resumed.
        const sendIn = this.cdp.sendIn;
        await Promise.all([
          sendIn(sid, "Page.enable"),
          sendIn(sid, "Fetch.enable", DOCUMENTS).then(() => { state.fetchHeld = true; }),
          // The same popup paths inside the popup, on a minor seat (a popup must not open a further popup unseen).
          this.options.interceptPopups ? sendIn(sid, "Page.addScriptToEvaluateOnNewDocument", { source: POPUP_INTERCEPT_NO_BINDING }) : undefined,
          // A popup's own out-of-process iframes (#4128), on a minor seat.
          this.options.decideFrame ? sendIn(sid, "Target.setAutoAttach", AUTO_ATTACH).then(() => { state.framesAttached = true; }) : undefined,
          p.waitingForDebugger ? sendIn(sid, "Runtime.runIfWaitingForDebugger") : undefined,
        ].map((r) => Promise.resolve(r).catch(() => undefined)));
        return;
      }
      if (p.waitingForDebugger) await this.cdp.sendIn(sid, "Runtime.runIfWaitingForDebugger").catch(() => undefined);
      return;
    }
    if (event.method === "Target.detachedFromTarget" && typeof p.sessionId === "string") { this.children.delete(p.sessionId); return; }
    const state = event.sessionId ? this.children.get(event.sessionId) : event.root ? undefined : this.page;
    if (!state) return;
    if (event.method === "Page.frameNavigated" && p.frame?.parentId) { await this.subframeCommitted(state, p.frame); return; }
    if (event.method === "Page.frameDetached" && p.reason === "swap" && this.options.decideFrame && !state.fetchHeld && !state.framesAttached) {
      // A frame of this session went out of process, where nothing here can hold or watch it: fail closed.
      this.options.onFrameUnheld?.();
      return;
    }
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
    if (p.resourceType !== "Document") { this.stats.continued++; await go(); return; }
    // #4128: a subframe document (an iframe in this page or popup, or any document of an out-of-process iframe).
    if (state.kind === "frame" || (state.mainFrame && p.frameId !== state.mainFrame)) { await this.subframeRequest(state, requestId, url, p.frameId); return; }
    const redirectFrom = typeof p.redirectedRequestId === "string" ? state.hops.get(p.redirectedRequestId) : undefined;
    state.hops.set(requestId, url);
    if (state.hops.size > 200) state.hops.delete(state.hops.keys().next().value as string);
    const at = state.requested.get(noHash(url));
    const pageAsked = at !== undefined && this.now() - at <= REQUEST_WINDOW_MS;
    if (pageAsked) state.requested.delete(noHash(url));
    const redirect = typeof p.redirectedRequestId === "string";
    const first = state.popupFirst;
    const from = redirect ? (redirectFrom ?? state.current) : state.current;
    // A popup's first document is judged against its opener; after that, like every later move, it is decided when it
    // leaves the origin. Only the page has Studio-started navigations to exempt (recorded before Studio sends them).
    // The tab's own first load (openStudioTab), once and only before anything committed; else this tab's record.
    let studio = false;
    const firstLoad = state === this.page && !redirect ? this.firstDocument : undefined;
    if (state === this.page && !redirect) this.firstDocument = undefined;
    if (state === this.page && !pageAsked && !redirect && !sameOrigin(url, from)) {
      const blank = !this.page.current || this.page.current === "about:blank";
      studio = (firstLoad !== undefined && blank && noHash(firstLoad) === noHash(url)) || this.studioStarted({ url, method: p.request?.method, headers: p.request?.headers });
    }
    if (studio || sameOrigin(url, from)) {
      if (!redirect) state.popupFirst = false;
      this.stats.continued++; await go(); return;
    }
    const allowed = await this.hold(url, go, stop);
    if (first && !redirect) { state.popupFirst = false; this.onPopup(url, allowed); }
  }

  /**
   * #4128 — the subframe rule (minor seats): a document of another origin than the top page it is drawn in is decided
   * by `decideFrame`, with no dialog; every load and every redirect hop is judged the same way. Refused: the request
   * fails (`BlockedByClient`, the frame shows Chromium's blocked page) and the page stays. Fail closed: when the
   * container cannot attach its out-of-process iframes, a cross-site frame's later loads could not be held, so a
   * cross-site subframe is refused there even when the list admits it. Same-origin frames, and adults, load.
   */
  /**
   * #4128 fail closed when this session has no network hold (a minor seat only): a cross-site subframe that committed
   * off the list is sent back to `about:blank` (`Page.navigate` with its frameId; for an out-of-process iframe this is
   * its own session). It may have loaded for a moment, which is why the network hold is the rule and this the fallback.
   * If the frame cannot be sent back, the host closes the tab.
   */
  private async subframeCommitted(state: FrameState, frame: { id?: string; url?: string }): Promise<void> {
    const url = frame.url ?? "";
    if (!this.options.decideFrame || state.fetchHeld || !/^https?:/i.test(url) || sameOrigin(url, topOf(state).current)) return;
    let allowed = false;
    try { allowed = await this.options.decideFrame(url); } catch { allowed = false; }
    if (allowed) return;
    this.stats.framesRefused++;
    const ok = await this.sendTo(state, "Page.navigate", { url: "about:blank", frameId: frame.id }).then(() => true, () => false);
    if (!ok) this.options.onFrameUnheld?.();
  }

  private async subframeRequest(state: FrameState, requestId: string, url: string, frameId: unknown): Promise<void> {
    const go = () => this.sendTo(state, "Fetch.continueRequest", { requestId });
    const top = topOf(state);
    if (!this.options.decideFrame || sameOrigin(url, top.current)) { this.stats.continued++; await go(); return; }
    let allowed = false;
    // Allowing a cross-site frame is safe only if its later loads can be held too. An out-of-process iframe moving
    // itself is held right here (its own session). A new frame inside this session is held later only if this
    // session attaches its out-of-process iframes.
    const ownMove = state.kind === "frame" && frameId === state.targetId;
    if (ownMove || state.framesAttached) { try { allowed = await this.options.decideFrame(url); } catch { allowed = false; } }
    if (allowed) { this.stats.continued++; await go(); return; }
    this.stats.framesRefused++;
    await this.sendTo(state, "Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }).catch(() => undefined);
  }
}

/**
 * CGP-SHELL-R-026 — the browser tabs Studio itself opens (a confirmed link, the learner's preview, the coach's approved
 * browser actions). A tab that appears with an address Studio did not open was opened by a page (`window.open`, a
 * `target=_blank` link): on a minor seat it is closed and its address goes through the confirm dialog instead.
 * Origins are kept too, so a redirect inside the site Studio opened is not mistaken for a page-opened tab.
 */
/**
 * Existing-window fix — navigations Studio itself starts in a browser tab with `Page.navigate` (verify-r027 on #4192).
 * A record is keyed by the tab's target id, never globally. It is made just before the command is sent, because
 * Chromium may answer `Page.navigate` only after the paused request goes on, so the loaderId cannot be waited for.
 * A paused request claims it only when it is that navigation's shape: the same tab, the same address (without the
 * fragment), a GET, and no Referer or Origin header. A page's own request carries one of those (a form POST, a link or
 * a form with a referrer); the one shape left, a no-referrer GET to the very address Studio is loading in that tab at
 * that moment, takes the tab exactly where Studio was taking it. A record is claimed once; a failed or thrown
 * navigation removes it; a short TTL is only a backstop.
 */
export class StudioNavigationLedger {
  private readonly records = new Map<string, Array<{ url: string; at: number }>>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  constructor(ttlMs = 5_000, now: () => number = Date.now) { this.ttlMs = ttlMs; this.now = now; }
  /** Before sending; `fail()` removes the record (an error or throw). */
  begin(targetId: string | undefined, url: string): { fail(): void } {
    if (!targetId) return { fail() {} };
    const rec = { url: noHash(url), at: this.now() };
    const list = this.fresh(targetId); list.push(rec); this.records.set(targetId, list.slice(-8));
    return { fail: () => { const l = this.records.get(targetId); if (!l) return; const k = l.indexOf(rec); if (k >= 0) l.splice(k, 1); if (!l.length) this.records.delete(targetId); } };
  }
  /** A paused main-frame request of this tab: true once, only for the shape of a navigation Studio sent there. */
  claim(targetId: string | undefined, request: { url: string; method?: string; headers?: Record<string, unknown> }): boolean {
    if (!targetId) return false;
    if ((request.method ?? "GET").toUpperCase() !== "GET") return false;
    if (Object.keys(request.headers ?? {}).some((h) => /^(referer|origin)$/i.test(h))) return false;
    const list = this.fresh(targetId), k = list.findIndex((r) => r.url === noHash(request.url));
    if (k < 0) return false;
    list.splice(k, 1); if (!list.length) this.records.delete(targetId);
    return true;
  }
  private fresh(targetId: string): Array<{ url: string; at: number }> {
    const t = this.now(), list = (this.records.get(targetId) ?? []).filter((r) => t - r.at <= this.ttlMs);
    if (list.length) this.records.set(targetId, list); else this.records.delete(targetId);
    return list;
  }
}
export const studioNavigations = new StudioNavigationLedger();
/** Studio's own `Page.navigate` on a tab's session: recorded before it is sent, keyed by the tab's target id. */
export async function studioNavigate(cdp: { send(method: string, params?: any, ...rest: any[]): Promise<any>; targetId?: string }, url: string, ...rest: any[]): Promise<any> {
  const rec = studioNavigations.begin(cdp.targetId, url);
  try {
    const r = await cdp.send("Page.navigate", { url }, ...rest);
    if (r && typeof r.errorText === "string" && r.errorText) rec.fail();
    return r;
  } catch (e) { rec.fail(); throw e; }
}

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
  /** `openStudioTab` addresses whose new tab has not been seen yet: that tab's guard takes one, once (first load). */
  private readonly firstLoads = new Map<string, number>();
  noteFirstLoad(url: string): void { this.firstLoads.set(noHash(url), this.now()); }
  takeFirstLoad(url: string): boolean {
    const key = noHash(url), at = this.firstLoads.get(key);
    this.firstLoads.delete(key);
    return at !== undefined && this.now() - at <= this.windowMs;
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
