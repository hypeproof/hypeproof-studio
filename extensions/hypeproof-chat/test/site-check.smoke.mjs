// site_check (orchestrator spec §6.1, FO-09): the measurement script and the verdict.
//
// The script runs in the live server's /__hp_viewport wrapper. Here it runs in
// node:vm against a small DOM with planted layouts, so the answer is known
// before the run (verification rule 3). The layouts follow what Chromium
// reported for the same pages served by liveServerHelpers.serveStatic:
//   - a classic scrollbar leaves 375 of a 390 frame visible (innerWidth 390,
//     documentElement.clientWidth 375);
//   - `overflow-x: hidden|clip` on body still reports the overflow in
//     documentElement.scrollWidth (496 for a 480px table), so the band-aid is
//     overflow; only a wrapper's hidden/clip keeps scrollWidth at 375.
//
// Run: node --experimental-strip-types test/site-check.smoke.mjs

import assert from "node:assert/strict";
import vm from "node:vm";

const {
  SITE_CHECK_WIDTHS, SITE_CHECK_SUMMARY_MAX, siteCheckTarget, viewportWrapperPath,
  siteCheckExpression, siteCheckResult, siteCheckSummary, siteCheckTimelineLabel,
} = await import("../src/siteCheck.ts");

const ORIGIN = "http://127.0.0.1:5555";

// ── A DOM just big enough for the script ─────────────────────────────────────

const STYLE = { overflowX: "visible", position: "static", display: "block", visibility: "visible", opacity: "1", fontSize: "16px" };

/** el(tag, attrs, spec, ...children). spec.box(w) → {left, width, height, scrollWidth?}; spec.style → computed style. */
function el(tag, attrs = {}, spec = {}, ...children) {
  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    attrs,
    spec,
    childNodes: [],
    parentNode: null,
    parentElement: null,
    getAttribute: (n) => (n in attrs ? String(attrs[n]) : null),
    hasAttribute: (n) => n in attrs,
    contains(other) { for (let p = other; p; p = p.parentNode) if (p === node) return true; return false; },
    querySelectorAll() { const out = []; const walk = (n) => n.childNodes.forEach((c) => { if (c.nodeType === 1) { out.push(c); walk(c); } }); walk(node); return out; },
  };
  for (const child of children) {
    const c = typeof child === "string" ? { nodeType: 3, textContent: child } : child;
    c.parentNode = node;
    if (c.nodeType === 1) c.parentElement = node;
    node.childNodes.push(c);
  }
  return node;
}

/** A block that fills the visible width with 16px gutters, or a fixed box. */
const fill = (h = 40) => ({ box: (w, shown) => ({ left: 16, width: shown - 32, height: h }) });
const fixed = (left, width, height = 40) => ({ box: () => ({ left, width, height }) });

/** A page: head and body element trees plus the numbers Chromium would report. */
function page({ head = [], body = [], bodyStyle = {}, scroll, shown = (w) => w - 15, resources = [], status = 200 }) {
  return (win) => {
    const headEl = el("head", {}, {}, ...head);
    const bodyEl = el("body", {}, { style: bodyStyle, box: (w, s) => ({ left: 0, width: s, height: 2000 }) }, ...body);
    const html = el("html", {}, {}, headEl, bodyEl);
    const all = () => [headEl, ...headEl.querySelectorAll(), bodyEl, ...bodyEl.querySelectorAll()];
    const layout = (node) => {
      const w = win.innerWidth;
      const s = shown(w);
      const b = node.spec.box ? node.spec.box(w, s) : { left: 0, width: 0, height: 0 };
      return { b, s };
    };
    for (const node of [html, ...all()]) {
      node.getBoundingClientRect = () => { const { b } = layout(node); return { left: b.left, right: b.left + b.width, width: b.width, height: b.height, top: 0, bottom: b.height }; };
      Object.defineProperty(node, "clientWidth", { get: () => layout(node).b.width, configurable: true });
      Object.defineProperty(node, "scrollWidth", { get: () => layout(node).b.scrollWidth ?? layout(node).b.width, configurable: true });
    }
    Object.defineProperty(html, "scrollWidth", { get: () => scroll(win.innerWidth) });
    Object.defineProperty(html, "clientWidth", { get: () => shown(win.innerWidth) });
    Object.defineProperty(bodyEl, "scrollWidth", { get: () => shown(win.innerWidth) });
    const doc = {
      documentElement: html, body: bodyEl, readyState: "complete", contentType: "text/html",
      querySelectorAll: () => all(),
    };
    return { doc, resources, status };
  };
}

/** The /__hp_viewport wrapper: its #site iframe loads `pages[path]` a few ms after src is set. */
function wrapper(pages, { neverLoads = false } = {}) {
  const fetches = [];
  let width = "";
  let current = null;
  const win = {
    innerWidth: 390,
    location: { origin: ORIGIN },
    getComputedStyle: (node) => ({ ...STYLE, ...(node.spec?.style ?? {}) }),
    performance: { getEntriesByType: (t) => (t === "resource" ? current.resources.map((name) => ({ name })) : [{ responseStatus: current.status }]) },
  };
  const frame = { tagName: "IFRAME", contentWindow: win, contentDocument: null, offsetWidth: 0 };
  frame.style = {};
  Object.defineProperty(frame.style, "width", {
    get: () => width,
    set: (v) => { width = v; win.innerWidth = parseInt(v, 10) || 390; },
  });
  Object.defineProperty(frame, "src", {
    set: (url) => {
      const pathname = new URL(url, ORIGIN).pathname;
      setTimeout(() => {
        const built = (pages[pathname] ?? page({ scroll: (w) => w }))(win);
        current = built;
        const d = built.doc;
        d.location = { pathname };
        d.baseURI = ORIGIN + pathname;
        if (neverLoads) d.readyState = "loading";
        win.document = d;
        frame.contentDocument = d;
      }, 3);
    },
  });
  const top = {
    document: { getElementById: (id) => (id === "site" ? frame : null) },
    location: { href: `${ORIGIN}/__hp_viewport?path=%2Findex.html` },
  };
  const trap = (name) => () => { fetches.push(name); throw new Error(`${name} called`); };
  const context = {
    window: top, setTimeout, Date, URL, Promise, Map, Set, Array, Number, String, Math, JSON, Object, parseFloat,
    fetch: trap("fetch"), XMLHttpRequest: trap("XMLHttpRequest"), WebSocket: trap("WebSocket"), EventSource: trap("EventSource"),
  };
  return { frame, context, fetches };
}

// CDP's returnByValue hands the value over as JSON; so does this.
const byValue = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

async function run(pages, target = "/index.html", opts = {}) {
  const w = wrapper(pages, opts);
  const value = byValue(await vm.runInNewContext(siteCheckExpression(target, opts), w.context));
  return { value, frame: w.frame, fetches: w.fetches };
}

// The template the homepage harness writes (homepage-sections.md): nav links
// are 44px tall, the phone link sits inside a sentence.
const head = [el("meta", { charset: "utf-8" }), el("meta", { name: "viewport", content: "width=device-width,initial-scale=1" })];
const nav = () => el("nav", {}, fill(60),
  el("a", { href: "#about" }, { ...fixed(16, 56, 44), style: { display: "inline-flex" } }, "소개"),
  el("a", { href: "#info" }, { ...fixed(80, 120, 44), style: { display: "inline-flex" } }, "영업시간·위치"));
const contact = () => el("section", { id: "contact", class: "sec" }, fill(120),
  el("p", {}, fill(26), "전화 ", el("a", { href: "tel:0200000000" }, { ...fixed(50, 100, 25), style: { display: "inline" } }, "02-000-0000")),
  el("a", { class: "btn", href: "tel:0200000000" }, { ...fixed(16, 150, 44), style: { display: "inline-flex" } }, "전화로 예약하기"));
const good = page({ head, body: [nav(), el("main", {}, fill(900), el("header", { class: "hero" }, fill(200), el("h1", {}, fill(60), "망원 꽃방")), contact())], scroll: (w) => w - 15 });

// ─── Planted pages: the verdict and the offenders are known before the run ───
{
  // Positive control: the harness template passes at both widths.
  const goodRun = await run({ "/index.html": good });
  const r = siteCheckResult({ path: "index.html", evaluation: goodRun.value });
  assert.equal(r.verdict, "pass", "the template must pass");
  assert.equal(goodRun.frame.style.width, "", "the wrapper is left at the width the learner had");
  assert.deepEqual(r.widths.map((w) => [w.w, w.measured, w.overflow_px, w.offenders.length]), [[390, true, 0, 0], [1280, true, 0, 0]]);
  assert.equal(r.checks.small_targets, 0, "44px nav links pass; a link inside a sentence is exempt");

  // Negative control: two planted offenders at 390 — a 480px table, and a long
  // word that runs out of a heading whose own box fits. Both fit at 1280.
  const wide = fixed(16, 480, 80).box;
  const longWord = (w, s) => ({ left: 16, width: s - 32, height: 60, scrollWidth: w === 390 ? 675 : s - 32 });
  const overflow = page({
    head,
    body: [nav(), el("main", {}, fill(900),
      el("section", { class: "sec" }, fill(300),
        el("h2", { class: "giant" }, { box: longWord }, "Supercalifragilisticexpialidocious"),
        el("table", { class: "prices" }, { box: wide }, el("tr", {}, { box: wide }, el("td", {}, { box: wide }, "꽃꽂이 클래스")))),
      contact())],
    scroll: (w) => (w === 390 ? 691 : w - 15),
  });
  const o = siteCheckResult({ path: "index.html", evaluation: (await run({ "/index.html": overflow })).value });
  assert.equal(o.verdict, "fail");
  assert.deepEqual(o.fail_reasons, ["overflow@390"]);
  const [w390, w1280] = o.widths;
  assert.equal(w390.overflow_px, 301);
  assert.deepEqual(w390.offenders, ["h2.giant", "table.prices"], "both planted offenders, outermost, in page order");
  assert.equal(w1280.overflow_px, 0, "1280 is measured too, and fits");
  assert.equal(siteCheckTimelineLabel(o), "📏 390px에서 2곳 넘침");

  // A wrapper that clips (main { overflow-x: clip }) keeps scrollWidth at 375
  // while the table is cut at the edge: still a fail, not a pass.
  const cut = page({
    head,
    body: [el("main", {}, { ...fill(900), style: { overflowX: "clip" } }, el("table", { class: "prices" }, { box: wide }))],
    scroll: (w) => w - 15,
  });
  const c = siteCheckResult({ path: "index.html", evaluation: (await run({ "/index.html": cut })).value });
  assert.deepEqual([c.verdict, c.fail_reasons, c.widths[0].offenders], ["fail", ["clipped@390"], ["table.prices"]]);

  // Positive control for what is NOT the page's overflow: an off-canvas drawer
  // wholly outside the visible 375px, cards in a scrolling carousel, a
  // decorative shape in an overflow-hidden hero. Body clips sideways.
  const exclusions = page({
    head,
    bodyStyle: { overflowX: "hidden" },
    body: [
      el("div", { class: "drawer" }, { box: (w, s) => ({ left: s, width: 280, height: 800 }), style: { position: "fixed" } },
        el("a", { href: "#about" }, { box: (w, s) => ({ left: s + 16, width: 30, height: 20 }), style: { display: "inline" } }, "소개")),
      el("div", { class: "slider" }, { ...fill(120), style: { overflowX: "auto" } },
        el("div", { class: "card" }, fixed(16, 300, 120)), el("div", { class: "card" }, fixed(328, 300, 120)), el("div", { class: "card" }, fixed(640, 300, 120))),
      el("header", { class: "hero" }, { ...fill(200), style: { overflowX: "hidden", position: "relative" } },
        el("div", { class: "blob" }, { box: (w, s) => ({ left: s - 130, width: 220, height: 220 }), style: { position: "absolute" } })),
    ],
    scroll: (w) => w - 15,
  });
  const x = siteCheckResult({ path: "index.html", evaluation: (await run({ "/index.html": exclusions })).value });
  assert.equal(x.verdict, "pass", `drawer, carousel and decoration are not overflow: ${JSON.stringify(x.widths)}`);
  assert.deepEqual(x.widths.map((w) => w.offenders), [[], []], "and none of them is named as an offender");
  assert.equal(x.checks.small_targets, 0, "a link in the closed drawer is off screen, not a small target");

  // Structure: every "must" of the quality floor that the DOM can prove.
  const structure = page({
    head: [el("meta", { charset: "utf-8" }), el("link", { rel: "stylesheet", href: "https://example.invalid/fonts.css" })],
    bodyStyle: { fontSize: "14px" },
    body: [el("img", { src: "https://example.invalid/photo.png" }, fixed(16, 200, 100)), el("img", { src: "img/ok.png", alt: "" }, fixed(16, 200, 100)),
      el("button", { class: "icon" }, fixed(16, 32, 32), "☰")],
    scroll: (w) => w - 15,
    resources: [`${ORIGIN}/img/ok.png`, "https://example.invalid/fonts.css"],
  });
  const s = siteCheckResult({ path: "index.html", evaluation: (await run({ "/index.html": structure })).value });
  assert.deepEqual([s.verdict, s.fail_reasons], ["fail", ["viewport_meta", "img_without_alt", "external_urls", "body_font"]]);
  assert.deepEqual([s.checks.img_without_alt, s.checks.external_urls, s.checks.body_font_px], [1, 2, 14], "alt=\"\" is a decorative image, same-origin loads are fine");

  // Small tap targets are advice: a page that is otherwise sound still passes.
  const smallOnly = page({ head, body: [nav(), el("button", { class: "icon" }, fixed(16, 32, 32), "☰")], scroll: (w) => w - 15 });
  const so = siteCheckResult({ path: "index.html", evaluation: (await run({ "/index.html": smallOnly })).value });
  assert.deepEqual([so.verdict, so.checks.small_targets, so.samples.small_targets], ["pass", 1, ["button.icon"]]);
  assert.match(siteCheckSummary(so), /참고: 44px보다 작은 누름 영역 1곳/);
  console.log("✓ planted pages — template passes; overflow, clip and structure defects fail with their offenders; drawer/carousel/decoration pass");
}

// ─── No measurement is never a pass ──────────────────────────────────────────
{
  const path = "index.html";
  // The runner could not evaluate at all.
  for (const reason of ["no_preview", "no_cdp", "timeout", "error"]) {
    const r = siteCheckResult({ path, unverified: reason, evaluation: { path: "/index.html", widths: [] } });
    assert.equal(r.verdict, "unverified", reason);
    assert.equal(r.checks, null);
    assert.match(siteCheckSummary(r), /미확인.*통과라고 말하지 마세요/);
  }
  assert.equal(siteCheckTimelineLabel(siteCheckResult({ path, unverified: "no_preview" })), "📏 미확인(미리보기 꺼짐)", "spec §5.2 copy");

  // The script ran but could not measure: no wrapper frame, a page that never finishes loading.
  const noFrame = byValue(await vm.runInNewContext(siteCheckExpression("/index.html"), { window: { document: { getElementById: () => null }, location: { href: ORIGIN } }, Date, URL, setTimeout, Promise, String }));
  assert.deepEqual(noFrame, { error: "no_frame" });
  assert.equal(siteCheckResult({ path, evaluation: noFrame }).verdict, "unverified");
  const slow = await run({ "/index.html": good }, "/index.html", { neverLoads: true, budgetMs: 150 });
  assert.deepEqual(slow.value, { error: "timeout" });
  assert.equal(slow.frame.style.width, "", "the wrapper's width is put back even on failure");
  assert.equal(siteCheckResult({ path, evaluation: slow.value }).verdict, "unverified");

  // Any damage to a valid measurement removes the pass. Positive control first.
  const valid = (await run({ "/index.html": good })).value;
  assert.equal(siteCheckResult({ path, evaluation: valid }).verdict, "pass");
  assert.equal(siteCheckResult({ path, evaluation: JSON.stringify(valid) }).verdict, "pass", "JSON text of the same value reads the same");
  const fields = Object.keys(valid.widths[0]);
  const damaged = [
    null, "", "not json", 42, {}, { widths: valid.widths }, { ...valid, path: "/about.html" }, { ...valid, widths: [] },
    { ...valid, widths: [valid.widths[0]] },                                 // 1280 never measured
    { ...valid, widths: [valid.widths[0], { ...valid.widths[1], inner: 1100 }] }, // not measured at 1280
    ...fields.flatMap((f) => [
      { ...valid, widths: [{ ...valid.widths[0], [f]: undefined }, valid.widths[1]] },
      { ...valid, widths: [valid.widths[0], { ...valid.widths[1], [f]: "x" }] },
    ]),
  ];
  for (const d of damaged) {
    assert.notEqual(siteCheckResult({ path, evaluation: d }).verdict, "pass", `damaged measurement read as pass: ${JSON.stringify(d)?.slice(0, 120)}`);
  }
  const partial = siteCheckResult({ path, evaluation: { ...valid, widths: [valid.widths[0]] } });
  assert.deepEqual([partial.verdict, partial.unverified_reason], ["unverified", "partial"]);
  assert.equal(siteCheckTimelineLabel(partial), "📏 미확인(1280px 못 잼)");
  // …but a defect seen at the width that was measured is still reported.
  const seen = { ...valid.widths[0], scroll: 512 };
  assert.equal(siteCheckResult({ path, evaluation: { ...valid, widths: [seen] } }).verdict, "fail");
  console.log(`✓ unverified — runner failures, script errors and ${damaged.length} damaged measurements never read as pass`);
}

// ─── Limits: paths, summary length, zero model requests ─────────────────────
{
  assert.equal(siteCheckTarget(), "/index.html");
  assert.equal(siteCheckTarget("pages/소개.html"), "/pages/소개.html");
  for (const bad of ["../x.html", "/etc/x.html", "C:\\site\\index.html", "a\\b.html", "notes.md", ".hypeproof/history/index-20261014-120000.html", "a/../b.html", "index.html?x=1"]) {
    assert.equal(siteCheckTarget(bad), null, `not a workspace page: ${bad}`);
  }
  assert.equal(viewportWrapperPath("/pages/소개.html"), "/__hp_viewport?path=%2Fpages%2F%EC%86%8C%EA%B0%9C.html");
  assert.throws(() => siteCheckExpression("//evil.example/x.html"), TypeError);

  // The longest summary the shapes allow still fits the 400-character hook limit.
  const long = (n) => "section." + "x".repeat(n);
  const heavy = {
    path: "/index.html",
    widths: SITE_CHECK_WIDTHS.map((w) => ({
      w, inner: w, scroll: w + 900, root_clips: true, offenders: Array.from({ length: 5 }, () => long(80)), offender_count: 40, clipped: 3,
      viewport_meta: false, img_without_alt: 9, external_urls: 7, external_hosts: ["a".repeat(60) + ".example", "b".repeat(60) + ".example", "c.example"],
      body_font_px: 12, small_targets: 30, small_target_sample: Array.from({ length: 5 }, () => long(70)),
    })),
  };
  const h = siteCheckResult({ path: "index.html", evaluation: heavy });
  assert.equal(h.verdict, "fail");
  assert.ok(siteCheckSummary(h).length <= SITE_CHECK_SUMMARY_MAX, `summary is ${siteCheckSummary(h).length} characters`);
  assert.ok(siteCheckSummary(h).endsWith("…"), "a cut summary says so");

  // The script itself makes no network call: every network API in its realm is a trap.
  const r = await run({ "/index.html": good });
  assert.deepEqual(r.fetches, [], "no fetch/XHR/WebSocket/EventSource from the check");
  assert.doesNotMatch(siteCheckExpression("/index.html"), /\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|hypeproof-ai/);
  console.log("✓ limits — workspace pages only, summary ≤ 400 characters, zero network or model requests");
}
