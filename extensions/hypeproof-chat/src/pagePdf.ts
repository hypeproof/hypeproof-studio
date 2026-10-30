// #3221 part 2 — "PDF로 저장" for an HTML page in the work folder, made by Studio's own browser instead of running
// another app's program (Chrome's binary made macOS ask for App Management, 2026-10-29). Pure and vscode-free: the
// caller hands in a CDP `send` for a tab that shows the served page (an integrated browser tab in Studio, headless
// Chromium in tests).
//
// The page is printed with CDP `Page.printToPDF` (A4, backgrounds on, the page's own @page size when it sets one), so
// text stays text. When the browser refuses printToPDF, the page is captured as A4-shaped screenshots and written as
// an image PDF with the deck exporter's writer, so the person still gets a file; the result says which way it went.

import { jpegInfo, pdfFromJpegs, type CdpSend } from "./deckPdf.ts";

export const PAGE_PDF_COPY = {
  command: "PDF로 저장",
  started: (name: string) => `${name}을(를) PDF로 저장하고 있어요`,
  saved: (rel: string) => `PDF로 저장했어요: ${rel}`,
  savedAsImages: (rel: string, pages: number) => `PDF로 저장했어요: ${rel} (${pages}쪽, 글자를 고를 수 없는 그림 PDF예요)`,
  notHtml: "HTML 파일만 PDF로 저장할 수 있어요.",
  outside: "작업 폴더 안의 파일만 PDF로 저장할 수 있어요.",
  notLoaded: "페이지를 열지 못해 PDF를 만들지 못했어요. 미리보기에서 페이지가 열리는지 확인해 주세요.",
  openFailed: "PDF를 만들 창을 열지 못했어요. 잠시 후 다시 해 주세요.",
  writeFailed: "PDF 파일을 저장하지 못했어요. 작업 폴더에 쓸 수 있는지 확인해 주세요.",
  busy: "다른 PDF를 만드는 중이에요. 끝나면 다시 해 주세요.",
} as const;

/** A4 at 96 CSS px per inch. */
export const A4_CSS = { width: 794, height: 1123 } as const;
const MAX_PDF_BYTES = 50_000_000;
const MAX_PAGES = 60;
const MAX_JPEG_BYTES = 8_000_000;

export type PagePdfResult =
  | { ok: true; pdf: Uint8Array; method: "print"; }
  | { ok: true; pdf: Uint8Array; method: "images"; pages: number }
  | { ok: false; reason: "not-loaded" | "failed" };

export function isPdf(bytes: Uint8Array | null): bytes is Uint8Array {
  return !!bytes && bytes.length > 8 && Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-";
}

function base64Bytes(data: unknown, max: number): Uint8Array | null {
  if (typeof data !== "string" || !data || data.length > max * 2 || !/^[A-Za-z0-9+/]+=*$/.test(data)) return null;
  return new Uint8Array(Buffer.from(data, "base64"));
}

async function evaluate(send: CdpSend, expression: string): Promise<any> {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (!r || r.exceptionDetails) throw new Error("evaluate failed");
  return r.result?.value;
}

/** Prints the page `send` talks to. `expectedUrl` is the served page the caller opened; the tab must still show it. */
export async function exportPagePdf(send: CdpSend, opts: {
  expectedUrl: string;
  loadTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<PagePdfResult> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = Date.now() + (opts.loadTimeoutMs ?? 10_000);
  let loaded = false;
  while (Date.now() < deadline) {
    const where = await evaluate(send, `[location.href,document.readyState]`).catch(() => null);
    if (Array.isArray(where) && where[0] === opts.expectedUrl && where[1] === "complete") { loaded = true; break; }
    await sleep(100);
  }
  if (!loaded) return { ok: false, reason: "not-loaded" };
  // Web fonts and images settle before printing.
  await evaluate(send, `document.fonts ? document.fonts.ready.then(()=>true) : true`).catch(() => null);

  const printed = await send("Page.printToPDF", {
    printBackground: true, preferCSSPageSize: true, paperWidth: 8.27, paperHeight: 11.69,
    marginTop: 0.4, marginBottom: 0.4, marginLeft: 0.4, marginRight: 0.4,
  }).catch(() => null);
  const pdf = base64Bytes(printed?.data, MAX_PDF_BYTES);
  if (isPdf(pdf)) return { ok: true, pdf, method: "print" };

  // Fallback: A4-shaped captures of the whole page, top to bottom.
  let emulated = false;
  try {
    await send("Emulation.setDeviceMetricsOverride", { width: A4_CSS.width, height: A4_CSS.height, deviceScaleFactor: 1, mobile: false });
    emulated = true;
  } catch { /* the page keeps its own width */ }
  try {
    const size = await evaluate(send, `[document.documentElement.scrollWidth, Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)]`).catch(() => null);
    const width = Array.isArray(size) ? Math.max(1, Math.min(Number(size[0]) || A4_CSS.width, 4000)) : A4_CSS.width;
    const height = Array.isArray(size) ? Math.max(1, Number(size[1]) || 1) : 1;
    const pageHeight = Math.round(width * A4_CSS.height / A4_CSS.width);
    const pages = Math.min(MAX_PAGES, Math.ceil(height / pageHeight));
    const images: Uint8Array[] = [];
    for (let i = 0; i < pages; i++) {
      const shot = await send("Page.captureScreenshot", {
        format: "jpeg", quality: 90, captureBeyondViewport: true,
        clip: { x: 0, y: i * pageHeight, width, height: Math.min(pageHeight, height - i * pageHeight), scale: 1 },
      }).catch(() => null);
      const jpeg = base64Bytes(shot?.data, MAX_JPEG_BYTES);
      if (!jpeg || !jpegInfo(jpeg)) return { ok: false, reason: "failed" };
      images.push(jpeg);
    }
    if (!images.length) return { ok: false, reason: "failed" };
    return { ok: true, pdf: pdfFromJpegs(images), method: "images", pages: images.length };
  } finally {
    if (emulated) await send("Emulation.clearDeviceMetricsOverride").catch(() => {});
  }
}

/** `report.html` → `report.pdf`; only .html/.htm pages are exported. */
export function pdfNameFor(file: string): string | null {
  const m = /^(.*)\.html?$/i.exec(file);
  return m && m[1] ? `${m[1]}.pdf` : null;
}
