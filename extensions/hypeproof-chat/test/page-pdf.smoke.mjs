// #3221 part 2 — "PDF로 저장" for an HTML page, printed by Studio's own browser (CDP Page.printToPDF) instead of running
// Chrome's binary (which made macOS ask for App Management). When the browser refuses printToPDF, the page is captured
// as A4-shaped screenshots and written as an image PDF. Pure checks always run; the export runs in headless Chromium
// (test/lib/headless-chromium.mjs): FAIL with FOCUS_REQUIRE_BROWSER=1 and no browser, NOT RUN otherwise.
import assert from "node:assert/strict";
import { findChromium, launch } from "./lib/headless-chromium.mjs";
import { pdfPages, serve } from "./lib/deck-pdf-fixture.mjs";
// Chromium's own PDFs: count page objects (the fixture's pdfPages reads only the deck writer's layout).
const pageObjects = (bytes) => (Buffer.from(bytes).toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;

const pdf = await import("../src/pagePdf.ts");
assert.equal(pdf.pdfNameFor("report-src.htm"), "report-src.pdf");
assert.equal(pdf.pdfNameFor("CLOiD_CES_작업보고서.HTML"), "CLOiD_CES_작업보고서.pdf");
assert.equal(pdf.pdfNameFor("notes.md"), null); assert.equal(pdf.pdfNameFor(".html"), null);
assert.equal(pdf.isPdf(new TextEncoder().encode("%PDF-1.7\n...")), true);
assert.equal(pdf.isPdf(new TextEncoder().encode("<html>")), false); assert.equal(pdf.isPdf(null), false);
// A page that never loads (or another document) is refused without printing.
{
  let printed = 0;
  const send = async (m) => { if (m === "Page.printToPDF") printed++; return { result: { value: ["http://127.0.0.1:1/other.html", "complete"] } }; };
  const r = await pdf.exportPagePdf(send, { expectedUrl: "http://127.0.0.1:1/report.html", loadTimeoutMs: 50, sleep: async () => {} });
  assert.deepEqual(r, { ok: false, reason: "not-loaded" }); assert.equal(printed, 0);
}
console.log("PASS page-pdf pure checks");

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER === "1") { console.error("FAIL page-pdf: FOCUS_REQUIRE_BROWSER=1 and no headless Chromium was found"); process.exit(1); }
  console.log("NOT RUN page-pdf export (no headless Chromium)"); process.exit(0);
}
const browser = await launch(bin);
const MARK = "보고서-본문-텍스트-REPORT-BODY";
const tall = `<!doctype html><meta charset=utf-8><title>보고서</title><style>body{font-family:sans-serif} section{height:1400px;border-bottom:4px solid #2c6b55}</style>` +
  `<h1>CLOiD CES 작업 보고서</h1><p>${MARK}</p><section>1</section><section>2</section><section>3</section>`;
const srv = await serve({ "/report.html": tall });
const url = srv.base + "report.html";
const open = async () => {
  await browser.send("Page.navigate", { url });
  for (let i = 0; i < 100; i++) { if ((await browser.evaluate("document.readyState")) === "complete" && (await browser.evaluate("location.href")) === url) break; await new Promise((r) => setTimeout(r, 50)); }
};
try {
  // Positive: printToPDF — a real PDF, several A4 pages, text kept.
  await open();
  const printed = await pdf.exportPagePdf(browser.send, { expectedUrl: url });
  assert.equal(printed.ok, true, JSON.stringify(printed)); assert.equal(printed.method, "print");
  assert.ok(pdf.isPdf(printed.pdf)); assert.ok(pageObjects(printed.pdf) >= 3, `tall page spans pages (${pageObjects(printed.pdf)})`);
  console.log(`PASS print: ${printed.pdf.length} bytes`);
  // Fallback: the browser refuses printToPDF → A4-shaped JPEG pages covering the whole page.
  await open();
  const refusing = (m, p) => m === "Page.printToPDF" ? Promise.reject(new Error("PrintToPDF is not implemented")) : browser.send(m, p);
  const images = await pdf.exportPagePdf(refusing, { expectedUrl: url });
  assert.equal(images.ok, true, JSON.stringify(images)); assert.equal(images.method, "images");
  assert.ok(pdf.isPdf(images.pdf)); assert.equal(pdfPages(images.pdf), images.pages);
  assert.ok(images.pages >= 4, `4200px+ page in A4 slices (${images.pages})`);
  console.log(`PASS images fallback: ${images.pages} pages`);
  // Negative: printToPDF returns something that is not a PDF → not accepted as one (falls back).
  await open();
  const junk = (m, p) => m === "Page.printToPDF" ? Promise.resolve({ data: Buffer.from("<html>not a pdf</html>").toString("base64") }) : browser.send(m, p);
  const fell = await pdf.exportPagePdf(junk, { expectedUrl: url });
  assert.equal(fell.ok && fell.method, "images", "non-PDF bytes are never written as the PDF");
  console.log("PASS non-PDF print result falls back");
} finally { await srv.close(); await browser.close?.(); }
console.log("page-pdf: ok");
