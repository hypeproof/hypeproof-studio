// A4 (spec §6.1, FO-09): the site-check runner over CDP. A3's siteCheck.ts owns the script
// and the verdict; this proves the runner sends exactly that script once, in the wrapper
// page of the live server only, and that every way it can fail is `unverified`, never
// `pass` ("no claim it did not observe").
//
// Controls: a good page passes and a planted 390px overflow fails (both through the
// runner); a page of another origin is never measured, and a hung or throwing CDP ends
// within the budget as unverified.
//
// The page here is a scripted CDP stand-in. The script itself was measured in headless
// Chromium by A3 (orch-a3-report.md §2); this smoke is about the runner around it.
//
// Run: node --experimental-strip-types test/site-check-runner.smoke.mjs

import assert from "node:assert/strict";

const { runSiteCheck, siteCheckToolText, SITE_CHECK_CDP_SLACK_MS, SITE_CHECK_TOOL_RESULT_MAX } = await import("../src/siteCheckRunner.ts");
const { siteCheckExpression, siteCheckSummary, SITE_CHECK_BUDGET_MS, SITE_CHECK_SUMMARY_MAX } = await import("../src/siteCheck.ts");

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`✓ ${name}`);
};

const BASE = "http://127.0.0.1:5173/";
const WRAPPER = "http://127.0.0.1:5173/__hp_viewport?path=%2Findex.html";

/** One measured width, in the shape the script returns (siteCheck.ts SITE_CHECK_PROGRAM). */
const W = (w, extra = {}) => ({
  w, inner: w, scroll: w, root_clips: false, offenders: [], offender_count: 0, clipped: 0,
  viewport_meta: true, img_without_alt: 0, external_urls: 0, external_hosts: [], body_font_px: 16,
  small_targets: 0, small_target_sample: [], ...extra,
});
const GOOD = { path: "/index.html", widths: [W(390), W(1280)] };
const OVERFLOW = {
  path: "/index.html",
  widths: [W(390, { scroll: 512, offenders: ["table.prices", ".hero h1"], offender_count: 2 }), W(1280)],
};

/** A scripted wrapper page: a cheap location read, Page.navigate, and the measurement. */
function fakePage({ href = WRAPPER, measure = GOOD, evaluate } = {}) {
  const calls = [];
  const state = { href, ready: "complete", released: 0 };
  const cdp = {
    async send(method, params = {}, timeoutMs) {
      calls.push({ method, params, timeoutMs });
      if (method === "Runtime.evaluate" && !params.awaitPromise) {
        return { result: { type: "string", value: JSON.stringify({ href: state.href, ready: state.ready }) } };
      }
      if (method === "Page.navigate") {
        state.href = params.url;
        state.ready = "loading";
        setTimeout(() => (state.ready = "complete"), 5);
        return { frameId: "f" };
      }
      if (method === "Runtime.evaluate" && params.awaitPromise) {
        if (evaluate) return evaluate(params);
        return { result: { type: "object", value: structuredClone(measure) } };
      }
      throw new Error(`unexpected CDP ${method}`);
    },
  };
  return {
    calls,
    state,
    page: { cdp, release: () => void state.released++ },
    measurements: () => calls.filter((c) => c.method === "Runtime.evaluate" && c.params.awaitPromise),
  };
}

/** A host port: the live server's address and the viewport page. */
function port(page, { live = BASE, asked = [] } = {}) {
  return {
    asked,
    livePreviewUrl: async () => live,
    viewportPage: async (url) => {
      asked.push(url);
      return page ? page.page : null;
    },
  };
}

const still = { now: () => 1_000 }; // the clock does not move: the script gets the whole budget

// ── Positive and negative controls through the runner ───────────────────────
{
  const page = fakePage({ measure: GOOD });
  const p = port(page);
  const r = await runSiteCheck(p, { path: "index.html", ...still });
  assert.equal(r.verdict, "pass");
  assert.deepEqual(p.asked, [WRAPPER], "the host is asked for the wrapper of this page on the live server");
  const m = page.measurements();
  assert.equal(m.length, 1, "exactly one measurement evaluate");
  assert.equal(m[0].params.expression, siteCheckExpression("/index.html", { budgetMs: SITE_CHECK_BUDGET_MS }), "A3's script, verbatim, with the whole budget");
  assert.equal(m[0].params.returnByValue, true);
  assert.equal(m[0].timeoutMs, SITE_CHECK_BUDGET_MS + SITE_CHECK_CDP_SLACK_MS, "the CDP timeout is a little above the script's budget");
  assert.ok(SITE_CHECK_CDP_SLACK_MS > 0 && SITE_CHECK_CDP_SLACK_MS <= 2000, "a little: at most 2 s past the 5 s budget (A3's runner contract)");
  assert.equal(page.state.released, 1, "the session is released");
  assert.ok(!page.calls.some((c) => c.method === "Page.navigate"), "a page already on the wrapper is not navigated");

  const bad = fakePage({ measure: OVERFLOW });
  const f = await runSiteCheck(port(bad), { path: "index.html", ...still });
  assert.equal(f.verdict, "fail");
  assert.deepEqual(f.fail_reasons, ["overflow@390"]);
  assert.deepEqual(f.widths[0].offenders, ["table.prices", ".hero h1"]);
  assert.equal(f.widths[0].overflow_px, 122);
  assert.ok(siteCheckSummary(f).length <= SITE_CHECK_SUMMARY_MAX);
  assert.match(siteCheckSummary(f), /390px 가로 122px 넘침/);

  // A nested page measures its own path.
  const nested = fakePage({ measure: { ...GOOD, path: "/pages/about.html" } });
  const pn = port(nested);
  assert.equal((await runSiteCheck(pn, { path: "pages/about.html", ...still })).verdict, "pass");
  assert.deepEqual(pn.asked, ["http://127.0.0.1:5173/__hp_viewport?path=%2Fpages%2Fabout.html"]);
  ok("controls: a good page passes and a planted 390px overflow fails, through one evaluate of A3's script in the wrapper");
}

// ── The floor: every missing piece is unverified, never pass ────────────────
{
  const noLive = fakePage();
  const pl = port(noLive, { live: null });
  const r1 = await runSiteCheck(pl, { ...still });
  assert.equal(r1.verdict, "unverified");
  assert.equal(r1.unverified_reason, "no_preview");
  assert.deepEqual(pl.asked, [], "no page is asked for without a live server");

  assert.equal((await runSiteCheck(null, still)).unverified_reason, "no_preview");
  assert.equal((await runSiteCheck({}, still)).unverified_reason, "no_preview");
  assert.equal((await runSiteCheck({ livePreviewUrl: async () => BASE }, still)).unverified_reason, "no_cdp", "a host without viewportPage");
  assert.equal((await runSiteCheck(port(null), still)).unverified_reason, "no_cdp", "no page");
  assert.equal(
    (await runSiteCheck({ livePreviewUrl: async () => BASE, viewportPage: async () => { throw new Error("no tab"); } }, still)).unverified_reason,
    "no_cdp",
  );
  assert.equal((await runSiteCheck({ livePreviewUrl: async () => { throw new Error("x"); } }, still)).unverified_reason, "no_preview");
  assert.equal((await runSiteCheck(port(fakePage(), { live: "https://example.com/" }), still)).unverified_reason, "no_preview", "a live server that is not loopback is not a preview");

  const thrown = fakePage({ evaluate: () => { throw new Error("Target closed"); } });
  assert.equal((await runSiteCheck(port(thrown), still)).unverified_reason, "error");
  assert.equal(thrown.state.released, 1, "released after a throw too");
  const exc = fakePage({ evaluate: () => ({ exceptionDetails: { text: "Uncaught" } }) });
  assert.equal((await runSiteCheck(port(exc), still)).unverified_reason, "error");
  const cdpTimeout = fakePage({ evaluate: () => Promise.reject(new Error("CDP Runtime.evaluate timed out")) });
  assert.equal((await runSiteCheck(port(cdpTimeout), still)).unverified_reason, "timeout", "the session's own timeout is a timeout");
  const garbage = fakePage({ measure: "not a measurement" });
  assert.equal((await runSiteCheck(port(garbage), still)).unverified_reason, "invalid");
  const half = fakePage({ measure: { path: "/index.html", widths: [W(390)] } });
  const rh = await runSiteCheck(port(half), still);
  assert.equal(rh.verdict, "unverified", "one width measured is not a pass");
  assert.equal(rh.unverified_reason, "partial");
  const scriptError = fakePage({ measure: { error: "no_frame" } });
  assert.equal((await runSiteCheck(port(scriptError), still)).unverified_reason, "no_frame");

  for (const bad of ["../secret.html", "/etc/x.html", "style.css", ".hypeproof/history/index-1.html", "a\\b.html", "C:/x.html"]) {
    const p = port(fakePage());
    const r = await runSiteCheck(p, { path: bad, ...still });
    assert.equal(r.unverified_reason, "bad_target", bad);
    assert.deepEqual(p.asked, [], `${bad}: the host is never asked`);
  }
  ok("floor: no live server, no host capability, no page, a throw, an exception, a CDP timeout, a bad value, one width, a bad path → unverified, never pass");
}

// ── Never on a page of another origin; navigates its own preview once ───────
{
  const foreign = fakePage({ href: "https://example.com/prices" });
  const r = await runSiteCheck(port(foreign), still);
  assert.equal(r.unverified_reason, "no_frame");
  assert.equal(foreign.measurements().length, 0, "the script is never sent to a page of another origin");
  assert.ok(!foreign.calls.some((c) => c.method === "Page.navigate"), "nor is that page navigated");

  let t = 0;
  const clock = { now: () => t, sleep: async (ms) => { t += ms; await new Promise((res) => setTimeout(res, 2)); } };
  const preview = fakePage({ href: "http://127.0.0.1:5173/index.html" });
  const rp = await runSiteCheck(port(preview), clock);
  assert.equal(rp.verdict, "pass");
  const nav = preview.calls.filter((c) => c.method === "Page.navigate");
  assert.deepEqual(nav.map((c) => c.params.url), [WRAPPER], "the learner's own preview is taken to the wrapper, once");
  assert.equal(preview.measurements().length, 1);

  // A preview that never finishes loading ends at the budget, unverified.
  t = 0;
  const stuck = fakePage({ href: "http://127.0.0.1:5173/index.html" });
  const realSend = stuck.page.cdp.send;
  stuck.page.cdp.send = async (method, params = {}, timeoutMs) => {
    if (method === "Runtime.evaluate" && !params.awaitPromise && stuck.calls.some((c) => c.method === "Page.navigate")) {
      stuck.calls.push({ method, params, timeoutMs });
      return { result: { value: JSON.stringify({ href: stuck.state.href, ready: "loading" }) } };
    }
    return realSend(method, params, timeoutMs);
  };
  const rs = await runSiteCheck(port(stuck), { ...clock, budgetMs: 1000 });
  assert.equal(rs.unverified_reason, "timeout");
  assert.equal(stuck.measurements().length, 0);
  ok("origin: a foreign page is neither measured nor navigated; the learner's preview is navigated to the wrapper once; a page that never loads times out");
}

// ── The budget holds against a hung CDP, and an abort ends the check ────────
{
  const hung = fakePage({ evaluate: () => new Promise(() => {}) });
  const started = Date.now();
  const r = await runSiteCheck(port(hung), { budgetMs: 600 });
  const took = Date.now() - started;
  assert.equal(r.unverified_reason, "timeout");
  assert.ok(took < 600 + SITE_CHECK_CDP_SLACK_MS + 500, `bounded by the budget plus the slack (took ${took} ms)`);
  assert.equal(hung.state.released, 1);

  const controller = new AbortController();
  const slow = fakePage({ evaluate: () => new Promise(() => {}) });
  setTimeout(() => controller.abort(), 30);
  const t0 = Date.now();
  const ra = await runSiteCheck(port(slow), { signal: controller.signal });
  assert.equal(ra.verdict, "unverified");
  assert.equal(ra.unverified_reason, "error");
  assert.ok(Date.now() - t0 < 1000, "an abort ends the check at once");
  const pre = new AbortController();
  pre.abort();
  assert.equal((await runSiteCheck(port(fakePage()), { signal: pre.signal })).verdict, "unverified", "an aborted turn measures nothing");
  ok("budget: a hung evaluate ends as timeout within budget + slack; an abort (or an aborted turn) is unverified at once");
}

// ── The on-demand tool's text ───────────────────────────────────────────────
{
  const page = fakePage({ measure: OVERFLOW });
  const r = await runSiteCheck(port(page), still);
  const text = siteCheckToolText(r);
  assert.ok(text.startsWith(siteCheckSummary(r)), "the summary first");
  const json = JSON.parse(text.slice(text.indexOf("\n") + 1));
  assert.equal(json.verdict, "fail");
  assert.deepEqual(json.fail_reasons, ["overflow@390"]);
  assert.ok(text.length <= SITE_CHECK_TOOL_RESULT_MAX);
  // A result too large for the cap keeps its verdict, reasons and counts.
  const huge = structuredClone(r);
  huge.widths[0].offenders = Array.from({ length: 5 }, (_, i) => `section#very-long-section-name-${i}-${"x".repeat(60)}`);
  huge.samples = { small_targets: Array.from({ length: 5 }, () => "y".repeat(80)), external_hosts: ["a.example", "b.example", "c.example"] };
  huge.path = "p".repeat(900);
  const big = siteCheckToolText(huge);
  assert.ok(big.length <= SITE_CHECK_TOOL_RESULT_MAX, `capped (${big.length})`);
  ok("tool text: the ≤400-character summary, then the JSON result; capped at 2,000 characters");
}

console.log(`\n${passed} site-check-runner checks passed`);
