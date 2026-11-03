// CGP-ART-R-017 / REQ-STUDIO-PREVIEW-FOLLOW — "따라 보기" in the live-server preview.
//
// While a coach turn is running, a reload caused by a file change in the served root is
// sent as `reload:follow`. The page script below snapshots a signature of every element
// in <body>, reloads, and after the new document has loaded scrolls to the first element
// whose signature is new (document order) and outlines it for a moment. The learner's
// toggle lives on the page itself (the integrated browser's toolbar is VS Code chrome that
// Studio does not own), inside a closed shadow root appended after <body>, so the page's
// CSS cannot restyle it and the change detection never sees it.
//
// - On by default; the state is kept in the tab's sessionStorage.
// - A manual scroll (wheel, touch, scroll keys, scrollbar press) while the coach is
//   editing turns it off; the toggle shows that and a polite live region says so.
// - While browser automation acts on the page (CR-68 indicator on), the toggle is hidden,
//   no follow scroll runs and input is not read as the learner's.
// - Off means the page keeps the scroll position the browser restores on reload.
//
// The client is a self-contained function serialised with Function.prototype.toString,
// so it must not reference anything outside its own body.

// The extension compiles without the DOM lib; the page globals the client touches are typed
// loosely here, module-local, so nothing leaks into the rest of the host program.
/* eslint-disable @typescript-eslint/no-explicit-any */
type El = any;
declare const window: any;
declare const document: any;
declare const location: any;
declare const EventSource: any;

/** What the page needs to know from the host; pushed on SSE as `state:<json>` and embedded at serve time. */
export interface FollowState {
  /** A coach turn is running (the toggle is shown and file changes are followed). */
  coach: boolean;
  /** Browser automation is acting on the page (CR-68): no follow, no toggle, no manual-scroll reading. */
  automation: boolean;
  /** The learner's 따라 보기 choice, kept by the host; embedded at serve time only (never pushed on SSE). */
  on?: boolean;
}

export const FOLLOW_IDLE: FollowState = { coach: false, automation: false, on: true };

/** Session key for the pre-reload snapshot (tab-scoped; a page can only steer a scroll it could do itself). */
export const FOLLOW_KEYS = { snap: "__hpFollowSnap" } as const;
/** Where the client posts the learner's choice (`{on, t}`; `t` is the live server's token). */
export const FOLLOW_CHOICE_PATH = "/__hp_follow";
/** Smooth-scroll length (DES-ART-17: at most 300 ms); reduced motion jumps instantly. */
export const FOLLOW_SCROLL_MS = 250;
/** How long the changed element stays outlined (DES-ART-17: 1 s). */
export const FOLLOW_FLASH_MS = 1000;
/** Elements signed per document; a larger page is compared on its first N elements. */
export const FOLLOW_MAX_ELEMENTS = 4000;

/** SSE data lines the live server sends. `reload` stays what the pre-follow client understood. */
export const SSE_RELOAD = "reload";
export const SSE_RELOAD_FOLLOW = "reload:follow";
export const SSE_STATE_PREFIX = "state:";

export function stateMessage(state: FollowState): string {
  return SSE_STATE_PREFIX + JSON.stringify({ coach: !!state.coach, automation: !!state.automation });
}

/** The browser half. Runs in the learner's page; serialised, so keep it self-contained. */
export function followClient(endpoint: string, choicePath: string, token: string, initial: FollowState, cfg: { keys: { snap: string }; scrollMs: number; flashMs: number; max: number }): void {
  try {
    // ── Captured now: the snippet is the first script in the document, so no page script has
    // run yet. Every later call on the control's own nodes goes through these references, so a
    // page that replaces a prototype method afterwards never sees (or gets `this` on) them.
    var W = window, D = document, J = W.JSON;
    var apply = W.Reflect.apply;
    var gopd = W.Object.getOwnPropertyDescriptor;
    var getter = function (proto: El, name: string): El { var d = gopd(proto, name); return d && d.get; };
    var setter = function (proto: El, name: string): El { var d = gopd(proto, name); return d && d.set; };
    var EP = W.Element.prototype, NP = W.Node.prototype, DP = W.Document.prototype, EvP = W.Event.prototype;
    var fAttach = EP.attachShadow, fSetAttr = EP.setAttribute, fRemAttr = EP.removeAttribute, fGetAttr = EP.getAttribute;
    var fRect = EP.getBoundingClientRect, fQsa = EP.querySelectorAll, fAppend = NP.appendChild, fRemove = NP.removeChild;
    var fCreate = DP.createElement, fCreateNS = DP.createElementNS, fListen = W.EventTarget.prototype.addEventListener;
    var gParent = getter(NP, "parentNode"), sText = setter(NP, "textContent"), gDocEl = getter(DP, "documentElement");
    var gBody = getter(DP, "body"), gReady = getter(DP, "readyState"), gStyle = getter(W.HTMLElement.prototype, "style");
    var fSetProp = W.CSSStyleDeclaration.prototype.setProperty;
    var gTarget = getter(EvP, "target"), gPrevented = getter(EvP, "defaultPrevented"), gKey = getter(W.KeyboardEvent.prototype, "key");
    var gClientX = getter(W.MouseEvent.prototype, "clientX"), gClientWidth = getter(EP, "clientWidth"), gData = getter(W.MessageEvent.prototype, "data");
    var MO = W.MutationObserver, fObserve = MO.prototype.observe, fDisconnect = MO.prototype.disconnect;
    var ES = W.EventSource, fFetch = W.fetch, fThen = W.Promise.prototype.then, fParse = J.parse, fStringify = J.stringify;
    var fScrollTo = W.scrollTo, fRaf = W.requestAnimationFrame, fTimeout = W.setTimeout, fMatch = W.matchMedia;
    var store: El = null;
    try { store = W.sessionStorage; } catch (e) { store = null; }
    var SP = W.Storage.prototype, fGetItem = SP.getItem, fSetItem = SP.setItem, fRemoveItem = SP.removeItem;
    var loc = W.location;
    // Absolute now: a later <base href> must not redirect the stream or the choice.
    var streamUrl = new W.URL(endpoint, loc.href).href, choiceUrl = new W.URL(choicePath, loc.href).href;
    var me = D.currentScript;
    if (me && apply(gParent, me, [])) apply(fRemove, apply(gParent, me, []), [me]);

    var call = function (f: El, self: El, args?: El[]): El { return apply(f, self, args || []); };
    var attr = function (el: El, n: string, v: string): void { call(fSetAttr, el, [n, v]); };
    var unattr = function (el: El, n: string): void { call(fRemAttr, el, [n]); };
    var text = function (el: El, v: string): void { call(sText, el, [v]); };
    var css = function (el: El, p: string, v: string): void { call(fSetProp, call(gStyle, el), [p, v, ""]); };
    var mk = function (tag: string): El { return call(fCreate, D, [tag]); };
    var add = function (parent: El, child: El): void { call(fAppend, parent, [child]); };
    var listen = function (t: El, type: string, fn: El, opts: El): void { call(fListen, t, [type, fn, opts]); };
    var later = function (fn: El, ms: number): void { call(fTimeout, W, [fn, ms]); };
    var frame = function (fn: El): void { call(fRaf, W, [fn]); };
    var get = function (k: string): string | null { try { return store ? call(fGetItem, store, [k]) : null; } catch (e) { return null; } };
    var put = function (k: string, v: string | null): void { try { if (store) { if (v === null) call(fRemoveItem, store, [k]); else call(fSetItem, store, [k, v]); } } catch (e) { /* storage refused */ } };

    var state = { coach: !!initial.coach, automation: !!initial.automation };
    // The learner's choice: this closure is the source of truth for the document; the host keeps it across reloads.
    var on = initial.on !== false;
    var pending: El = null;
    var host: El = null;
    var bar: El = null;
    var button: El = null;
    var live: El = null;
    var flash: El = null;
    var animating = 0;

    var hash = function (s: string): string {
      var h = 0x811c9dc5;
      for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
      return h.toString(36);
    };
    var signature = function (el: El): string {
      var parts: string[] = [];
      for (var i = 0; i < el.attributes.length; i++) parts.push(el.attributes[i].name + "=" + el.attributes[i].value);
      parts.sort();
      var txt = "";
      for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) txt += n.nodeValue || "";
      return hash(el.tagName + "|" + parts.join("&") + "|" + txt.replace(/\s+/g, " ").trim());
    };
    var elements = function (): El[] {
      var body = call(gBody, D);
      var list = body ? call(fQsa, body, ["*"]) : [];
      var out: El[] = [];
      for (var i = 0; i < list.length && out.length < cfg.max; i++) {
        var t = list[i].tagName;
        if (t !== "SCRIPT" && t !== "STYLE" && t !== "NOSCRIPT" && t !== "TEMPLATE") out.push(list[i]);
      }
      return out;
    };

    var announce = function (msg: string): void {
      if (!live) return;
      text(live, "");
      var l = live;
      later(function () { text(l, msg); }, 30);
    };
    var hideFlash = function (): void { if (flash) attr(flash, "hidden", ""); };
    var render = function (): void {
      if (!bar || !button) return;
      // Only Studio's coach-turn signal shows the toggle, and it is decided inside the closed root.
      if (state.coach && !state.automation) unattr(bar, "hidden"); else attr(bar, "hidden", "");
      attr(button, "aria-pressed", on ? "true" : "false");
      attr(button, "data-on", on ? "1" : "0");
    };
    var persist = function (value: boolean): void {
      try {
        var req = call(fFetch, W, [choiceUrl, { method: "POST", body: call(fStringify, J, [{ on: value, t: token }]), keepalive: true, cache: "no-store" }]);
        var mine = req;
        var done = function (): void { if (pending === mine) pending = null; };
        pending = req;
        call(fThen, req, [done, done]);
      } catch (e) { pending = null; }
    };
    var setOn = function (value: boolean, why: string): void {
      if (on === value) return;
      on = value;
      persist(value);
      if (!value) { animating = 0; hideFlash(); }
      render();
      announce(value ? "따라 보기를 켰어요. 코치가 고친 곳으로 화면이 따라가요." : why);
    };

    // Inline !important on the host (beats page author !important); the :host rule below beats both.
    var HOST_STYLE = "display:inline!important;visibility:visible!important;opacity:1!important;position:static!important;" +
      "filter:none!important;transform:none!important;clip-path:none!important;mask:none!important;contain:none!important;" +
      "content-visibility:visible!important;will-change:auto!important;mix-blend-mode:normal!important;pointer-events:auto!important;zoom:1!important";
    /** Puts the host back where it was drawn, with its own styles. True when it had to repair something. */
    var guardHost = function (): boolean {
      var docEl = call(gDocEl, D);
      if (!host || !docEl) return false;
      var fixed = false;
      if (call(gParent, host) !== docEl) { add(docEl, host); fixed = true; }
      if (call(fGetAttr, host, ["style"]) !== HOST_STYLE) { attr(host, "style", HOST_STYLE); fixed = true; }
      if (call(fGetAttr, host, ["hidden"]) !== null) { unattr(host, "hidden"); fixed = true; }
      return fixed;
    };

    var build = function (): void {
      var docEl = call(gDocEl, D);
      if (host || !docEl) return;
      host = mk("hp-follow");
      attr(host, "data-hp-follow", "");
      var root = call(fAttach, host, [{ mode: "closed" }]);
      var style = mk("style");
      text(style,
        ":host{all:initial !important;display:inline !important;visibility:visible !important;opacity:1 !important;position:static !important;" +
        "filter:none !important;transform:none !important;clip-path:none !important;mask:none !important;contain:none !important;" +
        "content-visibility:visible !important;will-change:auto !important;mix-blend-mode:normal !important;pointer-events:auto !important;zoom:1 !important}" +
        "[hidden]{display:none !important}" +
        ".bar{position:fixed;top:8px;right:8px;z-index:2147483647;visibility:visible;opacity:1;font-family:system-ui,-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif}" +
        "button{display:inline-flex;align-items:center;gap:6px;box-sizing:border-box;min-width:44px;min-height:44px;padding:0 14px;border-radius:8px;" +
        "font-family:inherit;font-size:14px;font-weight:600;line-height:1.2;cursor:pointer;border:1px solid #6b7280;background:#ffffff;color:#1f2937;box-shadow:0 1px 3px rgba(0,0,0,.25)}" +
        "button[data-on='1']{background:#1d4ed8;border-color:#1d4ed8;color:#ffffff}" +
        // The page behind is the learner's, light or dark: the ring carries its own white halo.
        "button:focus-visible{outline:2px solid #1d4ed8;outline-offset:2px;box-shadow:0 0 0 6px #ffffff}" +
        "svg{width:18px;height:18px;flex:none}" +
        ".slash{display:none}button[data-on='0'] .slash{display:inline}" +
        ".sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}" +
        ".flash{position:fixed;z-index:2147483646;pointer-events:none;outline:2px solid #1d4ed8;outline-offset:2px;box-shadow:0 0 0 4px #ffffff;border-radius:2px}" +
        "@media (prefers-color-scheme:dark){button{background:#1f2937;color:#f9fafb;border-color:#9ca3af}button[data-on='1']{background:#93c5fd;border-color:#93c5fd;color:#0b1220}}" +
        // Forced colours: no Highlight fill (Chrome's text backplate would hide the label); the
        // on state is the open eye plus a Highlight border, the off state the slashed eye.
        "@media (forced-colors:active){button,button[data-on='1']{background:ButtonFace;color:ButtonText;border-color:ButtonText;box-shadow:none}" +
        "button[data-on='1']{border:3px solid Highlight}button:focus-visible{outline-color:Highlight;box-shadow:none}.flash{outline-color:Highlight;box-shadow:none}}");
      bar = mk("div");
      attr(bar, "class", "bar");
      attr(bar, "hidden", "");
      button = mk("button");
      attr(button, "type", "button");
      var NS = "http://www.w3.org/2000/svg";
      var svg = call(fCreateNS, D, [NS, "svg"]);
      var svgAttrs: Record<string, string> = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false" };
      for (var a in svgAttrs) attr(svg, a, svgAttrs[a]);
      var shapes: Array<[string, Record<string, string>]> = [
        ["path", { d: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" }],
        ["circle", { cx: "12", cy: "12", r: "3" }],
        ["path", { d: "M4 4l16 16", class: "slash" }],
      ];
      for (var si = 0; si < shapes.length; si++) {
        var shape = call(fCreateNS, D, [NS, shapes[si][0]]);
        for (var k in shapes[si][1]) attr(shape, k, shapes[si][1][k]);
        add(svg, shape);
      }
      add(button, svg);
      var label = mk("span");
      text(label, "따라 보기");
      add(button, label);
      listen(button, "click", function (e: El) {
        if (!e || e.isTrusted !== true) return;
        setOn(!on, "따라 보기를 껐어요. 코치가 고쳐도 지금 보던 곳에 머물러요.");
      }, false);
      live = mk("span");
      attr(live, "class", "sr");
      attr(live, "role", "status");
      attr(live, "aria-live", "polite");
      flash = mk("div");
      attr(flash, "class", "flash");
      attr(flash, "hidden", "");
      add(bar, button);
      add(root, style);
      add(root, bar);
      add(root, live);
      add(root, flash);
      guardHost();
      render();
      var repairs = 0;
      var mo: El = new MO(function () {
        // Our own writes come back here too, but then nothing differs and nothing is counted.
        if (guardHost() && ++repairs > 200) call(fDisconnect, mo);
      });
      call(fObserve, mo, [docEl, { childList: true }]);
      call(fObserve, mo, [host, { attributes: true }]);
    };

    var reduced = function (): boolean {
      try { return call(fMatch, W, ["(prefers-reduced-motion: reduce)"]).matches; } catch (e) { return false; }
    };
    var outline = function (el: El): void {
      if (!flash) return;
      var r = call(fRect, el);
      css(flash, "left", r.left + "px");
      css(flash, "top", r.top + "px");
      css(flash, "width", r.width + "px");
      css(flash, "height", r.height + "px");
      unattr(flash, "hidden");
      later(hideFlash, cfg.flashMs);
    };
    var scrollTo = function (el: El): void {
      var r = call(fRect, el);
      var vh = W.innerHeight;
      var top = r.height < vh ? r.top + W.scrollY - (vh - r.height) / 2 : r.top + W.scrollY - 16;
      var max = Math.max(0, call(gDocEl, D).scrollHeight - vh);
      var target = Math.max(0, Math.min(max, Math.round(top)));
      var from = W.scrollY;
      // behavior "instant": a page with `scroll-behavior: smooth` must not stretch the bounded animation.
      if (reduced() || Math.abs(target - from) < 1) { call(fScrollTo, W, [{ top: target, behavior: "instant" }]); outline(el); return; }
      var id = ++animating;
      var start = 0;
      var step = function (t: number): void {
        if (id !== animating) return;
        if (!start) start = t;
        var p = Math.min(1, (t - start) / cfg.scrollMs);
        var e = 1 - Math.pow(1 - p, 3);
        call(fScrollTo, W, [{ top: Math.round(from + (target - from) * e), behavior: "instant" }]);
        if (p < 1) frame(step); else { animating = 0; outline(el); }
      };
      frame(step);
    };
    var follow = function (): void {
      var raw = get(cfg.keys.snap);
      put(cfg.keys.snap, null);
      if (!on || state.automation || raw === null) return;
      var before: Record<string, number> = {};
      try { var arr = call(fParse, J, [raw]); for (var i = 0; i < arr.length; i++) before[arr[i]] = (before[arr[i]] || 0) + 1; } catch (e) { return; }
      var now = elements();
      for (var j = 0; j < now.length; j++) {
        var s = signature(now[j]);
        if (before[s]) { before[s]--; continue; }
        var r = call(fRect, now[j]);
        if (r.width === 0 && r.height === 0) continue;
        scrollTo(now[j]);
        return;
      }
    };

    // Only the learner's own input counts: synthetic events from page script are not trusted.
    var manual = function (e: El): void {
      if (!e || e.isTrusted !== true) return;
      if (animating) animating = 0;
      hideFlash();
      if (on && state.coach && !state.automation) setOn(false, "직접 스크롤해서 따라 보기를 껐어요.");
    };
    var SCROLL_KEYS: Record<string, 1> = { PageUp: 1, PageDown: 1, ArrowUp: 1, ArrowDown: 1, Home: 1, End: 1, " ": 1 };
    // Capture listeners on window, registered before any page script: they run first.
    listen(W, "wheel", manual, { capture: true, passive: true });
    listen(W, "touchmove", manual, { capture: true, passive: true });
    listen(W, "keydown", function (e: El) {
      if (!e || e.isTrusted !== true) return;
      if (!SCROLL_KEYS[call(gKey, e)] || call(gPrevented, e)) return;
      var t = call(gTarget, e) as El | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName) || t === host)) return;
      manual(e);
    }, true);
    listen(W, "pointerdown", function (e: El) {
      if (!e || e.isTrusted !== true) return;
      var docEl = call(gDocEl, D);
      if (call(gTarget, e) === docEl && call(gClientX, e) >= call(gClientWidth, docEl)) manual(e);
    }, true);

    /** A reload waits (briefly) for the learner's choice to reach the host, so the next document carries it. */
    var reloadAfterChoice = function (): void {
      var go = function (): void { if (go) { go = null as El; loc.reload(); } };
      if (!pending) { go(); return; }
      call(fThen, pending, [function () { if (go) go(); }, function () { if (go) go(); }]);
      later(function () { if (go) go(); }, 500);
    };
    var es = new ES(streamUrl);
    listen(es, "message", function (e: El) {
      if (!e || e.isTrusted !== true) return;
      var data = "" + call(gData, e);
      if (data.indexOf("state:") === 0) {
        try { var next = call(fParse, J, [data.slice(6)]); state = { coach: !!next.coach, automation: !!next.automation }; } catch (err) { return; }
        if (state.automation) { animating = 0; hideFlash(); }
        render();
        return;
      }
      if (data === "reload:follow" && on && !state.automation) {
        var sigs: string[] = [];
        var els = elements();
        for (var i = 0; i < els.length; i++) sigs.push(signature(els[i]));
        put(cfg.keys.snap, call(fStringify, J, [sigs]));
        reloadAfterChoice();
        return;
      }
      if (data === "reload" || data === "reload:follow") { put(cfg.keys.snap, null); reloadAfterChoice(); }
    }, false);

    var ready = function (): void {
      build();
      // After load, so the browser's own scroll restoration on reload has happened first.
      frame(function () { follow(); });
    };
    if (call(gReady, D) === "complete") ready(); else listen(W, "load", ready, { once: true, capture: true });
  } catch (e) { /* the preview must never break the learner's page */ }
}

/** The `<script>` the live server injects into served HTML. */
export function followSnippet(endpoint: string, state: FollowState, token = ""): string {
  const cfg = { keys: FOLLOW_KEYS, scrollMs: FOLLOW_SCROLL_MS, flashMs: FOLLOW_FLASH_MS, max: FOLLOW_MAX_ELEMENTS };
  const args = [endpoint, FOLLOW_CHOICE_PATH, token, { coach: !!state.coach, automation: !!state.automation, on: state.on !== false }, cfg].map((a) => JSON.stringify(a)).join(",");
  // `<` is escaped so no argument can close the script element.
  return `<script>(${followClient.toString()})(${args.replace(/</g, "\\u003c")});</script>`;
}
