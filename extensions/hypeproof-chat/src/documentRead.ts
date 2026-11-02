// studio#3225 — the coach reads large documents as local text, never as a base64 binary.
//
// The SDK's Read inlines a PDF (and other binaries) into the request. A 288 KB PDF became about
// 385 KB of base64 and the seat's 200 KB request limit refused the turn (2026-10-29). Instead:
//
//   1. Local extraction. A Read or Grep of a document (PDF, DOCX, PPTX, XLSX, or HTML over
//      HTML_INLINE_BYTES) is pointed at a plain-text copy made on this device with no network:
//      HTML by stripping markup, the Office formats from their zipped XML (node:zlib), PDF through
//      the bundled pdfjs-dist (pdfjsText). The copy is cached by the source's SHA-256, so reading
//      it again extracts nothing.
//   2. Size-aware reads. The copy starts with an outline (pages, slides or sheets, headings,
//      sizes) and a line telling the coach to page with Read offset/limit and search with Grep.
//      A Read without a limit gets READ_LINES lines. A plain text file over TEXT_LIMIT_BYTES
//      gets the same limit, in place.
//
// The rewrite runs in canUseTool after the policy allowed the original call (the workspace
// containment check saw the real path), as `updatedInput`. A document that cannot be extracted
// is refused with a sentence, never passed through as a binary. Images are not touched: the
// coach looks at them.

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { inflateRawSync } from "node:zlib";

/** Lines a Read of a document copy or a large text file returns when it names no limit. */
export const READ_LINES = 400;
/** A plain text file above this many bytes is read in READ_LINES pages. */
export const TEXT_LIMIT_BYTES = 60_000;
/** HTML at or below this many bytes is read as is (it is small enough to be useful markup). */
export const HTML_INLINE_BYTES = 60_000;
/** Largest source read for extraction; above it the coach is told to split the file. */
export const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
/** Zip bombs: the most bytes one archive may inflate to. */
const MAX_INFLATED_BYTES = 64 * 1024 * 1024;
/** Outline entries listed in the header. */
const OUTLINE_ITEMS = 40;

export type DocumentKind = "pdf" | "docx" | "pptx" | "xlsx" | "html";
const KINDS: Record<string, DocumentKind> = {
  ".pdf": "pdf", ".docx": "docx", ".pptx": "pptx", ".xlsx": "xlsx", ".html": "html", ".htm": "html",
};
export const documentKind = (file: string): DocumentKind | null => KINDS[path.extname(file).toLowerCase()] ?? null;

/** Section markers in a copy, so Grep can find a page and the outline can name it. */
export type Extracted = { text: string; sections: { label: string; title?: string }[]; unit?: "page" | "slide" | "sheet" };
/** Page texts of a PDF, or null when it cannot be read. */
export type PdfExtractor = (bytes: Uint8Array) => Promise<string[] | null>;

/** Longest a PDF extraction may take before the read is refused instead. */
const PDF_TIMEOUT_MS = 60_000;

/**
 * Where pdfjs-dist's cmaps/ are: next to the bundle in the packaged extension (dist/pdfjs,
 * scripts/copy-pdfjs-data.mjs), else the installed package (tests, dev). Character maps are what
 * turn CID fonts (Korean PDFs) into text. Standard font data is not shipped: text extraction
 * does not need glyph shapes.
 */
function pdfjsDataDir(): string | null {
  const bundled = typeof __dirname === "string" ? path.join(__dirname, "pdfjs") : null;
  if (bundled && fs.existsSync(path.join(bundled, "cmaps"))) return bundled;
  try {
    const from = typeof __filename === "string" ? __filename : import.meta.url;
    return path.dirname(createRequire(from).resolve("pdfjs-dist/package.json"));
  } catch { return null; }
}

/**
 * pdfjs-dist (Apache-2.0, pinned 6.4.299, its pre-minified builds: neither pdf.mjs nor pdf.worker.mjs calls eval or
 * new Function, the CVE-2024-4367 path), bundled: same result on every platform, no network.
 * Loaded on the first PDF only, so the extension does not parse it at activation.
 */
export const pdfjsText: PdfExtractor = async (bytes) => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.min.mjs");
  const g = globalThis as { pdfjsWorker?: unknown };
  // The in-process "fake worker": pdfjs uses globalThis.pdfjsWorker instead of loading a file.
  g.pdfjsWorker ??= await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs");
  const dir = pdfjsDataDir();
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false, verbosity: 0,
    ...(dir ? { cMapUrl: path.join(dir, "cmaps") + path.sep, cMapPacked: true } : {}),
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const read = (async () => {
      const doc = await task.promise;
      const pages: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const content = await (await doc.getPage(i)).getTextContent();
        pages.push(content.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : "") : "")).join(""));
      }
      return pages;
    })();
    const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), PDF_TIMEOUT_MS); });
    return await Promise.race([read, timeout]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
    await task.destroy().catch(() => {});
  }
};

// ── HTML ──────────────────────────────────────────────────────────────────────
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] === "#") {
    const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
  }
  return ENTITIES[e.toLowerCase()] ?? m;
});

export function htmlText(html: string): Extracted {
  const sections: Extracted["sections"] = [];
  let body = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<head\b[\s\S]*?<\/head\s*>/i, (head) => {
      const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
      return title ? `\n# ${decode(title).trim()}\n` : "\n";
    });
  body = body.replace(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (_m, level: string, inner: string) => {
    const title = decode(inner.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    if (title) sections.push({ label: `h${level}`, title });
    return `\n${"#".repeat(Number(level))} ${title}\n`;
  });
  const text = decode(body
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|li|tr|section|article|header|footer|nav|main|aside|ul|ol|table|blockquote|pre|h[4-6])\s*>/gi, "\n")
    .replace(/<(td|th)\b[^>]*>/gi, "\t")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, ""))
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, sections };
}

// ── Zip (Office files) ────────────────────────────────────────────────────────
/** The named entries of a zip archive, inflated. Bounded against zip bombs. */
export function unzip(bytes: Uint8Array, wanted: (name: string) => boolean): Map<string, string> {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip archive");
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, string>();
  let inflated = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) throw new Error("bad central directory");
    const method = buf.readUInt16LE(at + 10);
    const compressed = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28), extraLen = buf.readUInt16LE(at + 30), commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString("utf8", at + 46, at + 46 + nameLen);
    at += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new Error("bad local header");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + compressed);
    const data = method === 0 ? raw : method === 8 ? inflateRawSync(raw, { maxOutputLength: MAX_INFLATED_BYTES - inflated }) : null;
    if (!data) continue;
    inflated += data.length;
    if (inflated > MAX_INFLATED_BYTES) throw new Error("archive too large");
    out.set(name, data.toString("utf8"));
  }
  return out;
}

const xmlText = (s: string) => decode(s);
const byNumber = (prefix: RegExp) => (a: string, b: string) => Number(prefix.exec(a)?.[1] ?? 0) - Number(prefix.exec(b)?.[1] ?? 0);

export function docxText(bytes: Uint8Array): Extracted {
  const xml = unzip(bytes, (n) => n === "word/document.xml").get("word/document.xml");
  if (xml === undefined) throw new Error("no word/document.xml");
  const sections: Extracted["sections"] = [];
  const paragraphs = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) => {
    const p = m[0];
    const text = xmlText([...p.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)].map((t) => t[1]).join("")
      + (/<w:tab\/>/.test(p) ? "" : ""));
    const heading = /<w:pStyle w:val="(?:Heading|heading|Title)(\d?)"/.exec(p);
    if (heading && text.trim()) {
      sections.push({ label: `h${heading[1] || 1}`, title: text.trim() });
      return `${"#".repeat(Math.min(3, Number(heading[1] || 1)))} ${text.trim()}`;
    }
    return text;
  });
  return { text: paragraphs.join("\n").replace(/\n{3,}/g, "\n\n").trim(), sections };
}

export function pptxText(bytes: Uint8Array): Extracted {
  const slide = /^ppt\/slides\/slide(\d+)\.xml$/;
  const files = unzip(bytes, (n) => slide.test(n));
  const names = [...files.keys()].sort(byNumber(slide));
  const sections: Extracted["sections"] = [];
  const parts = names.map((name, i) => {
    const xml = files.get(name)!;
    const lines = [...xml.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)]
      .map((p) => xmlText([...p[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => t[1]).join("")))
      .filter((l) => l.trim());
    sections.push({ label: `slide ${i + 1}`, ...(lines[0] ? { title: lines[0].trim().slice(0, 80) } : {}) });
    return `=== slide ${i + 1} ===\n${lines.join("\n")}`;
  });
  return { text: parts.join("\n\n"), sections, unit: "slide" };
}

export function xlsxText(bytes: Uint8Array): Extracted {
  const sheet = /^xl\/worksheets\/sheet(\d+)\.xml$/;
  const files = unzip(bytes, (n) => sheet.test(n) || n === "xl/sharedStrings.xml" || n === "xl/workbook.xml");
  const shared = [...(files.get("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((si) => xmlText([...si[1].matchAll(/<t(?: [^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
  const sheetNames = [...(files.get("xl/workbook.xml") ?? "").matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => xmlText(m[1]));
  const names = [...files.keys()].filter((n) => sheet.test(n)).sort(byNumber(sheet));
  const sections: Extracted["sections"] = [];
  const parts = names.map((name, i) => {
    const rows = [...files.get(name)!.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((row) =>
      [...row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => {
        const attrs = c[1], inner = c[2] ?? "";
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        if (/\bt="s"/.test(attrs) && v !== undefined) return shared[Number(v)] ?? "";
        if (/\bt="inlineStr"/.test(attrs)) return xmlText([...inner.matchAll(/<t(?: [^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""));
        return v !== undefined ? xmlText(v) : "";
      }).join("\t").replace(/\t+$/, ""));
    const title = sheetNames[i];
    sections.push({ label: `sheet ${i + 1}`, ...(title ? { title } : {}) });
    return `=== sheet ${i + 1}${title ? `: ${title}` : ""} ===\n${rows.filter((r) => r.trim()).join("\n")}`;
  });
  return { text: parts.join("\n\n"), sections, unit: "sheet" };
}

export async function extractDocument(kind: DocumentKind, bytes: Uint8Array, pdf: PdfExtractor = pdfjsText): Promise<Extracted | null> {
  switch (kind) {
    case "html": return htmlText(Buffer.from(bytes).toString("utf8"));
    case "docx": return docxText(bytes);
    case "pptx": return pptxText(bytes);
    case "xlsx": return xlsxText(bytes);
    case "pdf": {
      const pages = await pdf(bytes);
      if (!pages) return null;
      return { text: pages.map((p, i) => `=== page ${i + 1} ===\n${p.trim()}`).join("\n\n"), sections: pages.map((_, i) => ({ label: `page ${i + 1}` })), unit: "page" };
    }
  }
}

const kb = (n: number) => `${Math.max(1, Math.round(n / 1024)).toLocaleString("en-US")} KB`;

/** The text copy: an outline header, then the text. Line 1 of the text is header lines + 1. */
export function documentCopy(file: string, sourceBytes: number, x: Extracted): string {
  const units = x.unit ? `, ${x.sections.length} ${x.unit}${x.sections.length === 1 ? "" : "s"}` : "";
  const lines = x.text.split("\n").length;
  const outline = x.sections.filter((s) => !x.unit || s.title).slice(0, OUTLINE_ITEMS)
    .map((s) => `  - ${s.label}${s.title ? `: ${s.title}` : ""}`);
  const more = x.sections.length > OUTLINE_ITEMS ? [`  - … ${x.sections.length - OUTLINE_ITEMS} more`] : [];
  return [
    `[HypeProof 문서 읽기] ${path.basename(file)} 의 텍스트 사본입니다 (원본 ${kb(sourceBytes)}, 텍스트 ${kb(Buffer.byteLength(x.text))}, ${lines.toLocaleString("en-US")}줄${units}).`,
    `원본 바이너리는 보내지 않았어요. 길면 Read 의 offset/limit 으로 ${READ_LINES}줄씩 나눠 읽고, 특정 내용은 Grep 으로 이 파일 경로를 찾으세요.`,
    ...(x.unit ? [`쪽·슬라이드·시트는 "=== ${x.unit} N ===" 줄로 나뉘어 있어요.`] : []),
    ...(outline.length ? ["목차:", ...outline, ...more] : []),
    "---",
    x.text,
    "",
  ].join("\n");
}

export type RewriteResult =
  | { action: "keep" }
  | { action: "rewrite"; input: Record<string, unknown>; note: string }
  | { action: "deny"; message: string };

/**
 * What a Read or Grep of `input` should do. Only call it for a call the policy already allowed.
 * `cacheDir` holds the text copies, named by the source's SHA-256.
 */
export async function documentReadRewrite(args: {
  toolName: string;
  input: Record<string, unknown>;
  cacheDir: string;
  pdf?: PdfExtractor;
}): Promise<RewriteResult> {
  const { toolName, input } = args;
  const key = toolName === "Read" ? "file_path" : toolName === "Grep" ? "path" : null;
  const target = key ? input[key] : undefined;
  if (!key || typeof target !== "string" || !target) return { action: "keep" };
  let stat: fs.Stats;
  try { stat = fs.statSync(target); } catch { return { action: "keep" }; }
  if (!stat.isFile()) return { action: "keep" };
  const kind = documentKind(target);
  if (!kind || (kind === "html" && stat.size <= HTML_INLINE_BYTES)) {
    // A large plain text file: page it, in place.
    if (toolName === "Read" && !kind && stat.size > TEXT_LIMIT_BYTES && input.limit === undefined && !looksBinary(target))
      return { action: "rewrite", input: { ...input, limit: READ_LINES }, note: `large text ${stat.size} B, limit ${READ_LINES}` };
    return { action: "keep" };
  }
  if (stat.size > MAX_SOURCE_BYTES)
    return { action: "deny", message: `${path.basename(target)} 은(는) ${kb(stat.size)}라 한 번에 읽을 수 없어요. 더 작은 파일로 나눠 달라고 학습자에게 부탁해 주세요.` };
  const bytes = fs.readFileSync(target);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const copy = path.join(args.cacheDir, `${hash}.txt`);
  if (!fs.existsSync(copy)) {
    let extracted: Extracted | null;
    try { extracted = await extractDocument(kind, bytes, args.pdf); } catch { extracted = null; }
    if (!extracted)
      return { action: "deny", message: `${path.basename(target)} 을(를) 이 기기에서 텍스트로 바꾸지 못했어요. 원본을 그대로 보내지는 않아요. 텍스트나 HTML로 저장한 파일을 읽어 주세요.` };
    fs.mkdirSync(args.cacheDir, { recursive: true });
    const tmp = `${copy}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, documentCopy(target, stat.size, extracted));
    fs.renameSync(tmp, copy);
  }
  const next: Record<string, unknown> = { ...input, [key]: copy };
  if (toolName === "Read" && input.limit === undefined) next.limit = READ_LINES;
  return { action: "rewrite", input: next, note: `${kind} ${stat.size} B → text copy ${path.basename(copy)}` };
}

/** A NUL byte in the first 8 KB: treat as binary (not paged as text; Read handles it as before). */
function looksBinary(file: string): boolean {
  try {
    const fd = fs.openSync(file, "r");
    try {
      const head = Buffer.alloc(8192);
      const n = fs.readSync(fd, head, 0, head.length, 0);
      return head.subarray(0, n).includes(0);
    } finally { fs.closeSync(fd); }
  } catch { return true; }
}
