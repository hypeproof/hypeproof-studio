// REQ-STUDIO-DECK-PDF (CGP-ART-R-023) — "덱 PDF로 저장": one PDF page per drafted slide, never the notes layer.
// Pure checks (PDF structure, JPEG parsing, slide file names) always run. The export itself runs against the real
// deck.html from renderDeck, served over loopback HTTP, in headless Chromium (test/lib/headless-chromium.mjs): it
// fails when FOCUS_REQUIRE_BROWSER=1 and no browser is found, and prints NOT RUN otherwise.
// The notes are planted as a red overlay on top of every slide, with the deck's own notes switch on, and every
// capture is re-taken as PNG and scanned for red: a notes layer that reached a page cannot hide.
import assert from "node:assert/strict";
import { findChromium, launch } from "./lib/headless-chromium.mjs";
import { deckFixture, decodePng, NOTES_MARK, pdfPages, plantNotes, redShare, serve, watched } from "./lib/deck-pdf-fixture.mjs";

const pdf = await import("../src/deckPdf.ts");
const wiki = await import("../src/learningWiki.ts");
const deckGen = await import("../src/deckGenerator.ts");
const { SERVICE_CONTRACT_FIXTURES } = await import("./fixtures/service-contracts/index.mjs");
const PLAN = SERVICE_CONTRACT_FIXTURES.plan;
let passed = 0;
const ok = (name) => { passed++; console.log("PASS " + name); };

// A 1x1 baseline JPEG (SOF0) and a grey one; enough for structure checks without a browser.
const TINY = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z", "base64");
{
  assert.deepEqual(pdf.jpegInfo(TINY), { width: 1, height: 1, components: 1 });
  assert.equal(pdf.jpegInfo(Buffer.from("89504e470d0a1a0a", "hex")), null, "a PNG is not a JPEG");
  assert.equal(pdf.jpegInfo(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 4, 0, 0])), null, "scan data before a frame header is refused");
  assert.equal(pdfPages(pdf.pdfFromJpegs([TINY, TINY, TINY])), 3);
  assert.equal(pdfPages(pdf.pdfFromJpegs([TINY])), 1);
  assert.throws(() => pdf.pdfFromJpegs([Buffer.from("not a jpeg")]), /not a JPEG/);
  assert.equal(pdf.slideFile("s3", 0), "deck/03.md");
  assert.equal(pdf.slideFile("s12", 0), "deck/12.md");
  assert.equal(pdf.slideFile("evil‮", 4), "deck/05.md", "an unexpected id falls back to the position");
  ok("pdf writer: one page per JPEG, xref offsets exact, images only; slide ids name deck/NN.md");
}

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER === "1") { console.error("FAIL deck-pdf: FOCUS_REQUIRE_BROWSER=1 and no headless Chromium was found"); process.exit(1); }
  console.log("NOT RUN deck-pdf export (no headless Chromium); pure checks passed: " + passed);
  process.exit(0);
}

const browser = await launch(bin);
const html = deckFixture();
assert.ok(html.includes(NOTES_MARK), "the fixture deck carries notes");
const srv = await serve({ "/venture/deck.html": plantNotes(html), "/venture/clean.html": html, "/index.html": "<!doctype html><title>제품</title><p>제품 화면</p>" });
const url = srv.base + "venture/deck.html";
const open = async (target, viewport = { width: 1420, height: 800 }) => {
  await browser.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: false });
  await browser.send("Page.navigate", { url: target });
  for (let i = 0; i < 100; i++) { if ((await browser.evaluate("document.readyState")) === "complete" && (await browser.evaluate("location.href")) === target) break; await new Promise((r) => setTimeout(r, 50)); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  // 1. Planted red notes with the switch on: three pages, 1280x720, no red, every slide different.
  {
    await open(url);
    const progress = [];
    const w = watched(browser.send);
    const r = await pdf.exportDeckPdf(w.send, { expectedUrl: url, token: "t1", onProgress: (d, t) => progress.push(`${d}/${t}`) });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.pages, 3, "one page per drafted slide; the five undrafted slides are not pages");
    assert.equal(pdfPages(r.pdf), 3);
    assert.deepEqual(progress, ["1/3", "2/3", "3/3"]);
    assert.equal(w.shots.length, 3);
    for (const shot of w.shots) {
      assert.deepEqual([shot.w, shot.h], [1280, 720], "each page is the 16:9 slide at 1280x720");
      assert.ok(redShare(shot) < 0.001, `no notes overlay on a page (red share ${redShare(shot)})`);
    }
    const sig = w.shots.map((s) => s.px.subarray(0, s.px.length).reduce((a, v, k) => (a + v * ((k % 251) + 1)) % 1e9, 0));
    assert.equal(new Set(sig).size, 3, "the three pages are three different slides");
    assert.ok(!Buffer.from(r.pdf).toString("latin1").includes("NOTES-ONLY"), "no notes text in the file");
    assert.equal(await browser.evaluate(`document.querySelectorAll(".notes,.notes-only,.checks,.todo,.bar").length`), 0, "the notes layer was removed from the exported document");
    ok("export: 3 drafted slides -> 3 pages at 1280x720; planted red notes (switch on) reach no page; progress per slide");
  }
  // 1b. Dark theme in the viewer (prefers-color-scheme: dark): the PDF is still the light theme.
  {
    await browser.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
    try {
      await open(srv.base + "venture/clean.html");
      assert.equal(await browser.evaluate(`matchMedia("(prefers-color-scheme: dark)").matches`), true, "the viewer really is dark");
      const w = watched(browser.send);
      const r = await pdf.exportDeckPdf(w.send, { expectedUrl: srv.base + "venture/clean.html", token: "t1b" });
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(w.shots.length, 3);
      for (const shot of w.shots) {
        let sum = 0; const n = shot.w * shot.h; const ch = shot.bpp;
        for (let k = 0; k < n; k++) sum += (shot.px[k * ch] + shot.px[k * ch + 1] + shot.px[k * ch + 2]) / 3;
        assert.ok(sum / n > 150, `a dark-theme viewer still exports a light page (mean luma ${(sum / n).toFixed(0)})`);
        const c = (x, y) => { const o = (y * shot.w + x) * ch; return shot.px[o] + shot.px[o + 1] + shot.px[o + 2]; };
        assert.ok(c(4, 4) > 600, "the page corner is the light paper, not the dark one");
      }
      ok("dark viewer theme: every exported page is light");
    } finally { await browser.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "" }] }); }
  }
  // 2. A page that refuses emulation, narrow window: still 1280x720 pages without notes.
  {
    await open(url, { width: 700, height: 500 });
    const w = watched(browser.send, (m) => { if (m === "Emulation.setDeviceMetricsOverride") throw new Error("refused"); });
    const r = await pdf.exportDeckPdf(w.send, { expectedUrl: url, token: "t2" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.pages, 3);
    for (const shot of w.shots) { assert.deepEqual([shot.w, shot.h], [1280, 720]); assert.ok(redShare(shot) < 0.001, "no notes in the fallback either"); }
    ok("fallback without emulation (700x500 window): pages still 1280x720, no notes");
  }
  // 3. One slide cannot be captured: the export fails and names that slide's file; no PDF.
  {
    await open(url);
    const w = watched(browser.send, (m, p, n) => { if (m === "Page.captureScreenshot" && n === 2) throw new Error("gone"); });
    const r = await pdf.exportDeckPdf(w.send, { expectedUrl: url, token: "t3" });
    assert.deepEqual(r, { ok: false, reason: "slide", slide: 2, file: "deck/03.md" }, "the second drafted slide is template slide 3");
    ok("a failed slide fails the export and names deck/03.md");
  }
  // 4. The deck reloads mid-export (a live reload after a save): export mode is gone, nothing is returned.
  {
    await open(url);
    const w = watched(browser.send, async (m, p, n) => {
      if (m === "Runtime.evaluate" && n === 1 && String(p.expression).includes("hps-export-on")) {
        await browser.send("Page.reload"); await sleep(400);
      }
    });
    const r = await pdf.exportDeckPdf(w.send, { expectedUrl: url, token: "t4" });
    assert.deepEqual(r, { ok: false, reason: "changed" });
    ok("a reload during export returns changed, never a mixed PDF");
  }
  // 5. The tab is on another document: not loaded, nothing captured.
  {
    await open(srv.base + "venture/clean.html");
    const w = watched(browser.send);
    const r = await pdf.exportDeckPdf(w.send, { expectedUrl: url, token: "t5", loadTimeoutMs: 600 });
    assert.deepEqual(r, { ok: false, reason: "not-loaded" });
    assert.equal(w.shots.length, 0);
    ok("another document in the tab: not-loaded, no capture");
  }
  // 6. A deck with no drafted slide: empty.
  {
    const empty = deckGen.renderDeck({ ...wiki.newState("빈 팀"), sessions: [1] }, PLAN.deck, PLAN)["deck.html"];
    const s2 = await serve({ "/d.html": empty });
    try {
      await open(s2.base + "d.html");
      const r = await pdf.exportDeckPdf(browser.send, { expectedUrl: s2.base + "d.html", token: "t6" });
      assert.deepEqual(r, { ok: false, reason: "empty" });
    } finally { await s2.close(); }
    ok("a deck without drafted slides is empty, not a blank PDF");
  }
} finally {
  await srv.close();
  browser.close?.();
}
console.log(`deck-pdf: ${passed} passed`);
