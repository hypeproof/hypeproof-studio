// REQ-STUDIO-DECK-PDF (CGP-ART-R-023) — "PDF로 저장" for the deck skill's deck.html: one PDF page per drafted
// slide, never the notes layer. Pure and vscode-free: the caller hands in a CDP `send` for a page that already
// shows the served deck.html (an integrated browser tab in Studio, headless Chromium in tests).
//
// How it stays honest:
// - Each page is a screenshot of exactly one slide frame (clip = the frame), laid out at 1280x720.
// - Before the first capture the notes layer (notes, citations, gaps, not-yet-drafted slides, lint checks) and the
//   deck toolbar are removed from the DOM, and every capture re-checks that none of it came back and that the
//   export mode is still the one this run installed (a live reload would drop it).
// - The page count must equal the number of drafted slides the page holds; any slide that cannot be captured
//   fails the whole export and names that slide's file (deck/NN.md), so no partial PDF is written.
// - The PDF is always the LIGHT theme (owner decision 2026-10-26): export mode pins the deck's light palette on <body>,
//   over the dark `prefers-color-scheme` palette on :root, whatever the editor or system theme is.
// - The PDF holds only the slide images (DCTDecode), so no text layer can carry the notes.

export const DECK_PDF_WIDTH = 1280;
export const DECK_PDF_HEIGHT = 720;
/** PDF page size in points (1280x720 px at 96 dpi). */
const PAGE_W = 960, PAGE_H = 540;
const MAX_SLIDES = 60;
const MAX_JPEG_BYTES = 8_000_000;

export const DECK_PDF_COPY = {
  command: "PDF로 저장",
  started: (total: number) => `덱을 PDF로 저장하고 있어요 (0 / ${total}장)`,
  progress: (done: number, total: number) => `덱을 PDF로 저장하고 있어요 (${done} / ${total}장)`,
  saved: (file: string, pages: number) => `덱을 PDF로 저장했어요: ${file} (${pages}장, 발표자 노트 없이)`,
  busy: "이미 덱을 PDF로 저장하고 있어요. 끝난 뒤 다시 눌러 주세요.",
  noDeck: "아직 덱이 없어요. 먼저 \"팀 브레인으로 덱 만들기\"로 덱을 만들어 주세요.",
  empty: "아직 만든 장이 없어서 PDF로 저장할 게 없어요.",
  otherPreview: "미리보기가 다른 폴더를 보여 주고 있어서 PDF를 만들 수 없어요. 이 덱이 있는 폴더를 미리보기로 연 뒤 다시 해 주세요.",
  openFailed: "덱을 그릴 창을 열지 못해 PDF를 만들지 못했어요. 잠시 뒤 다시 해 주세요.",
  slideFailed: (file: string) => `${file} 장을 PDF로 옮기지 못해 저장하지 않았어요. 덱 미리보기가 열리는지 확인한 뒤 다시 해 주세요.`,
  changed: "저장하는 동안 덱이 바뀌어서 PDF를 저장하지 않았어요. 다시 해 주세요.",
  notLoaded: "덱을 다 불러오지 못해 PDF를 만들지 못했어요. 잠시 뒤 다시 해 주세요.",
  writeFailed: "PDF 파일을 쓰지 못했어요. 폴더에 쓸 수 있는지 확인해 주세요.",
} as const;

export type CdpSend = (method: string, params?: Record<string, unknown>) => Promise<any>;

export type DeckPdfFailure =
  | { ok: false; reason: "not-loaded" | "empty" | "changed" }
  | { ok: false; reason: "slide"; slide: number; file: string };
export type DeckPdfResult = { ok: true; pdf: Uint8Array; pages: number } | DeckPdfFailure;

/** The deck file a slide comes from: article id "s3" is template slide 3, drafted to deck/03.md. */
export function slideFile(id: unknown, index: number): string {
  const m = typeof id === "string" ? /^s(\d{1,3})$/.exec(id) : null;
  const no = m ? Number(m[1]) : index + 1;
  return `deck/${String(no).padStart(2, "0")}.md`;
}

/** Width, height and colour components of a baseline or progressive JPEG, or null when it is not one. */
export function jpegInfo(buf: Uint8Array): { width: number; height: number; components: 1 | 3 } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = (buf[i + 2] << 8) | buf[i + 3];
    if (len < 2) return null;
    // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (buf[i + 5] << 8) | buf[i + 6], width = (buf[i + 7] << 8) | buf[i + 8], components = buf[i + 9];
      if (!width || !height || (components !== 1 && components !== 3)) return null;
      return { width, height, components };
    }
    if (marker === 0xda) return null; // scan data before any frame header
    i += 2 + len;
  }
  return null;
}

/** A PDF with one page per JPEG, each image filling a 16:9 page. Images only: no text, no scripts, no links. */
export function pdfFromJpegs(images: readonly Uint8Array[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (part: Uint8Array | string) => { const b = typeof part === "string" ? enc.encode(part) : part; chunks.push(b); size += b.length; };
  push("%PDF-1.4\n%âãÏÓ\n");
  const n = images.length;
  // 1 catalog, 2 page tree, then per page: page, content, image.
  const pageId = (k: number) => 3 + k * 3;
  const obj = (id: number, body: string | Array<string | Uint8Array>) => {
    offsets[id] = size;
    push(`${id} 0 obj\n`);
    for (const part of Array.isArray(body) ? body : [body]) push(part);
    push("\nendobj\n");
  };
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Count ${n} /Kids [${images.map((_, k) => `${pageId(k)} 0 R`).join(" ")}] >>`);
  images.forEach((jpeg, k) => {
    const info = jpegInfo(jpeg);
    if (!info) throw new Error("not a JPEG");
    const id = pageId(k);
    const content = `q ${PAGE_W} 0 0 ${PAGE_H} 0 0 cm /Im0 Do Q`;
    obj(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`);
    obj(id + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    obj(id + 2, [`<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace /${info.components === 3 ? "DeviceRGB" : "DeviceGray"} /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, "\nendstream"]);
  });
  const count = 3 + n * 3;
  const xref = size;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id++) push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/**
 * Export-mode stylesheet: one slide at a time, pinned to the top-left at 1280x720 and scaled by --hps-export-k
 * to fit the viewport when the viewport cannot be set to 1280x720. Constant: no deck data is interpolated.
 */
const EXPORT_CSS = `body.hps-deck-export{margin:0;overflow:hidden;color-scheme:light;--bg:#eef1ea;--paper:#fbfcf8;--ink:#13221c;--ink-2:#3d4b44;--ink-3:#5f6c65;--brand:#153c32;--brand-2:#2c6b55;--line:#d8e1d1;--soft:#e8efe0;--warm:#fbf2e4;--warn:#7a4f0e}
body.hps-deck-export main{max-width:none;margin:0;padding:0;display:block}
body.hps-deck-export main > *{display:none!important}
body.hps-deck-export main > article.slide.hps-export-on{display:block!important;position:fixed;left:0;top:0;width:${DECK_PDF_WIDTH}px;height:${DECK_PDF_HEIGHT}px;margin:0;z-index:2147483647;transform-origin:0 0;transform:scale(var(--hps-export-k,1))}
body.hps-deck-export main > article.slide.hps-export-on .frame{width:${DECK_PDF_WIDTH}px;height:${DECK_PDF_HEIGHT}px;min-height:0;aspect-ratio:auto;border-radius:0;box-shadow:none;outline-style:none}
body.hps-deck-export .v-steps{grid-auto-flow:column}body.hps-deck-export .v-compare{grid-template-columns:1fr auto 1fr}body.hps-deck-export .v-compare .arrow{transform:none;justify-self:auto}`;

/** What is never exported: the notes layer, lint checks, not-yet-drafted slides and the deck's own controls. */
const STRIP = ".notes,.notes-only,.checks,.todo,.bar,.present-ui,.present-open";

/** Installs export mode once and returns the drafted slides. `token` marks this run (a reload drops it). */
function setupExpression(token: string): string {
  return `(function(){var d=document,b=d.body;if(!b||d.readyState!=="complete")return {ready:false};
d.querySelectorAll(${JSON.stringify(STRIP)}).forEach(function(e){e.remove();});
b.classList.remove("show-notes","presenting");
var st=d.getElementById("hps-deck-export");if(!st){st=d.createElement("style");st.id="hps-deck-export";(d.head||b).appendChild(st);}
st.textContent=${JSON.stringify(EXPORT_CSS)};b.classList.add("hps-deck-export");window.__hpsDeckExport=${JSON.stringify(token)};
var s=[].slice.call(d.querySelectorAll("main > article.slide"));return {ready:true,ids:s.map(function(x){return x.id||"";})};})()`;
}

/** Shows slide `index` alone, waits two frames (and its embedded product page, briefly), and reports the clip. */
function showExpression(token: string, index: number, scale: number): string {
  return `(function(){var d=document,b=d.body;
if(window.__hpsDeckExport!==${JSON.stringify(token)}||!b.classList.contains("hps-deck-export"))return Promise.resolve({ok:false,why:"mode"});
var s=[].slice.call(d.querySelectorAll("main > article.slide")),cur=s[${index}];if(!cur)return Promise.resolve({ok:false,why:"missing"});
if(d.querySelector(${JSON.stringify(STRIP)}))return Promise.resolve({ok:false,why:"notes"});
b.style.setProperty("--hps-export-k",String(${scale}));
s.forEach(function(x){x.classList.toggle("hps-export-on",x===cur);});
var frames=[].slice.call(cur.querySelectorAll("iframe")).map(function(f){f.loading="eager";return new Promise(function(r){var done=false,fin=function(){if(!done){done=true;r();}};try{if(f.contentDocument&&f.contentDocument.readyState==="complete")return fin();}catch(e){}f.addEventListener("load",fin,{once:true});setTimeout(fin,1500);});});
return Promise.all(frames).then(function(){return new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(r);});});}).then(function(){
var f=cur.querySelector(".frame");if(!f)return {ok:false,why:"frame"};var r=f.getBoundingClientRect();
var top=d.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
return {ok:!d.querySelector(${JSON.stringify(STRIP)})&&!!top&&cur.contains(top),x:r.left,y:r.top,width:r.width,height:r.height};});})()`;
}

function base64Bytes(data: unknown): Uint8Array | null {
  if (typeof data !== "string" || !data || data.length > MAX_JPEG_BYTES * 2 || !/^[A-Za-z0-9+/]+=*$/.test(data)) return null;
  return new Uint8Array(Buffer.from(data, "base64"));
}

async function evaluate(send: CdpSend, expression: string): Promise<any> {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (!r || r.exceptionDetails) throw new Error("evaluate failed");
  return r.result?.value;
}

/**
 * Exports the deck shown on the page `send` talks to. `expectedUrl` is the served deck.html the caller opened;
 * the page must still be on it. Progress is reported after each slide. Nothing is retried silently.
 */
export async function exportDeckPdf(send: CdpSend, opts: {
  expectedUrl: string;
  token: string;
  onProgress?: (done: number, total: number) => void;
  loadTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<DeckPdfResult> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = Date.now() + (opts.loadTimeoutMs ?? 10_000);
  let setup: { ready: boolean; ids?: unknown[] } | null = null;
  // The tab may still be loading: wait for the served deck itself, never another document.
  while (Date.now() < deadline) {
    const where = await evaluate(send, `[location.href,document.readyState]`).catch(() => null);
    if (Array.isArray(where) && where[0] === opts.expectedUrl && where[1] === "complete") {
      setup = await evaluate(send, setupExpression(opts.token)).catch(() => null);
      if (setup?.ready) break;
    }
    await sleep(100);
  }
  if (!setup?.ready || !Array.isArray(setup.ids)) return { ok: false, reason: "not-loaded" };
  const ids = setup.ids.slice(0, MAX_SLIDES + 1);
  if (!ids.length) return { ok: false, reason: "empty" };
  if (ids.length > MAX_SLIDES) return { ok: false, reason: "slide", slide: MAX_SLIDES + 1, file: slideFile(ids[MAX_SLIDES], MAX_SLIDES) };
  let emulated = false;
  try {
    await send("Emulation.setDeviceMetricsOverride", { width: DECK_PDF_WIDTH, height: DECK_PDF_HEIGHT, deviceScaleFactor: 1, mobile: false });
    emulated = true;
  } catch { /* a page that refuses emulation is scaled to fit instead */ }
  try {
    let scale = 1;
    if (!emulated) {
      const vp = await evaluate(send, `[innerWidth,innerHeight]`).catch(() => null);
      const w = Array.isArray(vp) ? Number(vp[0]) : 0, h = Array.isArray(vp) ? Number(vp[1]) : 0;
      // 1/m for a whole m: the clip is then an exact 1280x720 / m and its scale an exact m (no 719 px rounding).
      const fit = w > 0 && h > 0 ? Math.min(1, w / DECK_PDF_WIDTH, h / DECK_PDF_HEIGHT) : 1;
      scale = 1 / Math.ceil(1 / fit);
    }
    const images: Uint8Array[] = [];
    for (let i = 0; i < ids.length; i++) {
      const fail = { ok: false as const, reason: "slide" as const, slide: i + 1, file: slideFile(ids[i], i) };
      const shown = await evaluate(send, showExpression(opts.token, i, scale)).catch(() => null);
      if (shown?.why === "mode") return { ok: false, reason: "changed" };
      if (!shown?.ok || !(shown.width > 0) || !(shown.height > 0)) return fail;
      const shot = await send("Page.captureScreenshot", {
        format: "jpeg", quality: 90, fromSurface: true,
        clip: { x: shown.x, y: shown.y, width: DECK_PDF_WIDTH * scale, height: DECK_PDF_HEIGHT * scale, scale: 1 / scale },
      }).catch(() => null);
      const jpeg = base64Bytes(shot?.data);
      const info = jpeg ? jpegInfo(jpeg) : null;
      if (!jpeg || !info || jpeg.length > MAX_JPEG_BYTES) return fail;
      images.push(jpeg);
      opts.onProgress?.(i + 1, ids.length);
    }
    // The run's mode must have survived the last capture too (a reload after it would mean a changed deck).
    const still = await evaluate(send, `window.__hpsDeckExport===${JSON.stringify(opts.token)}`).catch(() => false);
    if (still !== true) return { ok: false, reason: "changed" };
    return { ok: true, pdf: pdfFromJpegs(images), pages: images.length };
  } finally {
    if (emulated) await send("Emulation.clearDeviceMetricsOverride").catch(() => {});
  }
}
