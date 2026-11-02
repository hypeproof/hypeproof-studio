// studio#3225 — the coach reads large documents as local text copies, never as inlined binaries.
// Run: node --experimental-strip-types test/document-read.smoke.mjs
//
// Positive: a ~300 KB PDF (macOS PDFKit; elsewhere the refusal below), a 2 MB HTML page and
// DOCX/PPTX/XLSX files built here are read through text copies whose first Read page is far
// under the Service's 200,000-byte request limit; Grep follows the same copy; a second read is a
// cache hit (no second extraction).
// Negative controls: small HTML, images, small text and directories are untouched; a document
// that cannot be extracted is refused, never passed through as the binary.
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import { documentReadRewrite, pdfjsText, READ_LINES, HTML_INLINE_BYTES, TEXT_LIMIT_BYTES } from "../src/documentRead.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hps-docread-"));
const cacheDir = path.join(root, "cache");
const ws = path.join(root, "ws");
fs.mkdirSync(ws);
const put = (name, data) => { const p = path.join(ws, name); fs.writeFileSync(p, data); return p; };
const LIMIT = 200_000;
/** Bytes a Read of the rewritten input returns at most: its first `limit` lines. */
const firstPage = (input) => Buffer.byteLength(fs.readFileSync(input.file_path, "utf8").split("\n").slice(0, input.limit).join("\n"));
let failures = 0;
const check = async (name, fn) => { try { await fn(); console.log(`ok  ${name}`); } catch (e) { failures++; console.error(`FAIL ${name}\n${e.stack}`); } };

/** A minimal zip (deflate) with the given entries. */
function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const data = Buffer.from(text), packed = deflateRawSync(data), n = Buffer.from(name), crc = crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, n, packed); centrals.push(central, n);
    offset += 30 + n.length + packed.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** A text PDF (Helvetica, uncompressed) of `pages` pages, padded to about `bytes` with a comment stream. */
function pdf(pages, bytes) {
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`];
  const font = 3 + pages.length * 2;
  pages.forEach((t, i) => {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`);
    const s = `BT /F1 12 Tf 72 700 Td (${t}) Tj ET`;
    objs.push(`<< /Length ${s.length} >>\nstream\n${s}\nendstream`);
  });
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pad = Math.max(0, bytes - 2000 - pages.length * 200);
  objs.push(`<< /Length ${pad} >>\nstream\n${"x".repeat(pad)}\nendstream`); // unreferenced filler, like an embedded image
  let out = "%PDF-1.4\n";
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  return out + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
}

await check("300 KB PDF → text copy under the request limit (bundled pdfjs)", async () => {
  const p = put("report.pdf", pdf(Array.from({ length: 12 }, (_, i) => `Chapter ${i + 1} SALES-REPORT-MARKER`), 300_000));
  assert(fs.statSync(p).size >= 290_000, "fixture is ~300 KB");
  const r = await documentReadRewrite({ toolName: "Read", input: { file_path: p }, cacheDir });
  assert.equal(r.action, "rewrite");
  assert.notEqual(r.input.file_path, p, "the binary is never what Read gets");
  assert.equal(r.input.limit, READ_LINES);
  const copy = fs.readFileSync(r.input.file_path, "utf8");
  assert.match(copy, /=== page 12 ===/);
  assert.match(copy, /Chapter 7 SALES-REPORT-MARKER/);
  assert(!copy.includes("xxxxxxxxxx") && !/JVBERi0/.test(copy), "no binary or base64 in the copy");
  assert(firstPage(r.input) < LIMIT / 10, `first page ${firstPage(r.input)} B`);
  assert(Buffer.byteLength(copy) < 20_000, "a 300 KB PDF is a few KB of text");
});

await check("2 MB HTML → text copy without scripts or styles; outline lists headings", async () => {
  const section = (i) => `<h2>Section ${i}</h2><p>Paragraph ${i} with <b>bold</b> &amp; text.</p><script>var junk${i}="${"j".repeat(400)}";</script><style>.c${i}{color:red}</style>`;
  const html = `<html><head><title>Big page</title><style>body{}</style></head><body><h1>Main title</h1>${Array.from({ length: 4000 }, (_, i) => section(i)).join("\n")}</body></html>`;
  const p = put("big.html", html);
  assert(fs.statSync(p).size > 2_000_000);
  const r = await documentReadRewrite({ toolName: "Read", input: { file_path: p }, cacheDir });
  assert.equal(r.action, "rewrite");
  const copy = fs.readFileSync(r.input.file_path, "utf8");
  assert.match(copy, /목차:\n  - h1: Main title/);
  assert.match(copy, /## Section 3999/);
  assert.match(copy, /Paragraph 5 with bold & text\./);
  assert(!copy.includes("var junk") && !copy.includes("color:red"));
  assert(firstPage(r.input) < LIMIT / 4, `first page ${firstPage(r.input)} B`);
});

await check("Grep of a document searches its copy; a second read is a cache hit (one extraction)", async () => {
  const p = put("cached.pdf", "%PDF-1.4 not used");
  let extractions = 0;
  const fake = async () => { extractions++; return ["first page NEEDLE", "second page"]; };
  const a = await documentReadRewrite({ toolName: "Read", input: { file_path: p, offset: 5, limit: 10 }, cacheDir, pdf: fake });
  const b = await documentReadRewrite({ toolName: "Grep", input: { pattern: "NEEDLE", path: p }, cacheDir, pdf: fake });
  assert.equal(extractions, 1, "the second call reuses the copy");
  assert.deepEqual([a.input.offset, a.input.limit], [5, 10], "an explicit range is kept");
  assert.equal(b.input.path, a.input.file_path);
  assert.equal(b.input.limit, undefined, "Grep gets no limit");
  assert.match(fs.readFileSync(b.input.path, "utf8"), /NEEDLE/);
});

await check("DOCX, PPTX and XLSX → text with headings, slides and sheets", async () => {
  const docx = put("plan.docx", zip({ "word/document.xml":
    '<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>개요</w:t></w:r></w:p><w:p><w:r><w:t>첫 문단 &amp; 내용</w:t></w:r></w:p></w:body></w:document>' }));
  const pptx = put("deck.pptx", zip({
    "ppt/slides/slide2.xml": "<p:sld><a:p><a:r><a:t>Second slide</a:t></a:r></a:p></p:sld>",
    "ppt/slides/slide1.xml": "<p:sld><a:p><a:r><a:t>Title slide</a:t></a:r></a:p></p:sld>",
    "ppt/slides/slide10.xml": "<p:sld><a:p><a:r><a:t>Tenth</a:t></a:r></a:p></p:sld>" }));
  const xlsx = put("data.xlsx", zip({
    "xl/workbook.xml": '<workbook><sheets><sheet name="매출" sheetId="1"/></sheets></workbook>',
    "xl/sharedStrings.xml": "<sst><si><t>지점</t></si><si><t>합계</t></si></sst>",
    "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>서울</t></is></c><c r="B2"><v>42</v></c></row></sheetData></worksheet>' }));
  const text = async (p) => fs.readFileSync((await documentReadRewrite({ toolName: "Read", input: { file_path: p }, cacheDir })).input.file_path, "utf8");
  const d = await text(docx);
  assert.match(d, /# 개요\n첫 문단 & 내용/);
  const s = await text(pptx);
  assert(s.indexOf("Title slide") < s.indexOf("Second slide") && s.indexOf("Second slide") < s.indexOf("Tenth"), "slides in number order");
  assert.match(s, /=== slide 3 ===\nTenth/);
  const x = await text(xlsx);
  assert.match(x, /=== sheet 1: 매출 ===\n지점\t합계\n서울\t42/);
});

await check("negative controls: small HTML, images, small text and directories are untouched", async () => {
  const small = put("small.html", "<p>hi</p>");
  assert(fs.statSync(small).size <= HTML_INLINE_BYTES);
  const png = put("shot.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
  const txt = put("notes.txt", "short");
  for (const file_path of [small, png, txt, ws, path.join(ws, "missing.pdf")])
    assert.deepEqual(await documentReadRewrite({ toolName: "Read", input: { file_path }, cacheDir }), { action: "keep" }, file_path);
  assert.deepEqual(await documentReadRewrite({ toolName: "Write", input: { file_path: put("w.pdf", "x") }, cacheDir }), { action: "keep" }, "only Read and Grep");
});

await check("a large plain text file is paged in place; an explicit limit is kept", async () => {
  const p = put("log.txt", "line\n".repeat(Math.ceil(TEXT_LIMIT_BYTES / 5) + 10));
  const r = await documentReadRewrite({ toolName: "Read", input: { file_path: p }, cacheDir });
  assert.deepEqual([r.action, r.input.file_path, r.input.limit], ["rewrite", p, READ_LINES]);
  assert.deepEqual(await documentReadRewrite({ toolName: "Read", input: { file_path: p, limit: 50 }, cacheDir }), { action: "keep" });
});

await check("a document that cannot be extracted is refused, never passed through", async () => {
  const p = put("scan.pdf", "%PDF-1.4 broken");
  const r = await documentReadRewrite({ toolName: "Read", input: { file_path: p }, cacheDir, pdf: async () => null });
  assert.equal(r.action, "deny");
  assert.match(r.message, /원본을 그대로 보내지는 않아요/);
  const bad = await documentReadRewrite({ toolName: "Read", input: { file_path: put("broken.docx", "not a zip") }, cacheDir });
  assert.equal(bad.action, "deny");
});

await check("pdfjsText: page texts, Korean CID fonts through the bundled character maps, null for a broken file", async () => {
  assert.deepEqual((await pdfjsText(Buffer.from(pdf(["alpha ONE", "beta TWO"], 3000)))).map((t) => t.trim()), ["alpha ONE", "beta TWO"]);
  // An AppKit-made PDF whose Korean glyphs are a CID font: without cmaps only "PDF HELLO" survives.
  const ko = await pdfjsText(fs.readFileSync(new URL("./fixtures/document-read/ko-cid.pdf", import.meta.url)));
  assert.match(ko.join(""), /안녕하세요 한국어 PDF 테스트 문장입니다 HELLO/);
  assert.equal(await pdfjsText(Buffer.from("%PDF-1.4 broken")), null);
});

await check("packaged layout: the bundle carries pdfjs and reads character maps from pdfjs/ beside it", async () => {
  const { build } = await import("esbuild");
  const { createRequire } = await import("node:module");
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), "hps-docread-dist-")); // outside any node_modules
  await build({ entryPoints: ["src/documentRead.ts"], outfile: path.join(dist, "doc.cjs"), bundle: true, platform: "node", target: "node18",
    format: "cjs", logLevel: "silent" });
  const pkg = path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
  for (const d of ["cmaps"]) fs.cpSync(path.join(pkg, d), path.join(dist, "pdfjs", d), { recursive: true });
  const bundled = createRequire(import.meta.url)(path.join(dist, "doc.cjs"));
  const ko = await bundled.pdfjsText(fs.readFileSync(new URL("./fixtures/document-read/ko-cid.pdf", import.meta.url)));
  assert.match(ko.join(""), /안녕하세요 한국어/);
  fs.rmSync(path.join(dist, "pdfjs"), { recursive: true, force: true });
  // Negative control: without the data beside the bundle (and no package to fall back on), CID text is lost.
  const lost = await bundled.pdfjsText(fs.readFileSync(new URL("./fixtures/document-read/ko-cid.pdf", import.meta.url)));
  assert.doesNotMatch(lost.join(""), /안녕하세요/);
  fs.rmSync(dist, { recursive: true, force: true });
});

await check("real runSdkCoach: canUseTool hands Read the text copy; containment still decides first", async () => {
  const { build } = await import("esbuild");
  const { createRequire } = await import("node:module");
  const out = path.join(root, "sdk.cjs");
  await build({ entryPoints: ["src/sdkCoach.ts"], outfile: out, bundle: true, platform: "node", format: "cjs", logLevel: "silent",
    external: ["@anthropic-ai/claude-agent-sdk", "zod"],
    plugins: [{ name: "vscode-stub", setup(b) { b.onResolve({ filter: /^vscode$/ }, () => ({ path: "vscode", namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "module.exports={window:{},workspace:{},Uri:{file:p=>({fsPath:p})}}", loader: "js" })); } }] });
  const { runSdkCoach } = createRequire(import.meta.url)(out);
  const docx = put("brief.docx", zip({ "word/document.xml": "<w:document><w:body><w:p><w:r><w:t>BRIEF-TEXT</w:t></w:r></w:p></w:body></w:document>" }));
  const outside = path.join(root, "outside.docx");
  fs.writeFileSync(outside, fs.readFileSync(docx));
  const results = {};
  const sdk = { query({ options }) { return (async function* () {
    results.inside = await options.canUseTool("Read", { file_path: docx }, { toolUseID: "r1" });
    results.outside = await options.canUseTool("Read", { file_path: outside }, { toolUseID: "r2" });
    yield { type: "result", subtype: "success", is_error: false };
  })(); } };
  const prevConfig = process.env.CLAUDE_CONFIG_DIR;
  await runSdkCoach({ sdk, binaryResolution: { available: true, reasons: [] }, gatewayUrl: "http://127.0.0.1:1/v1", token: "t", model: "m",
    profile: { sdk_tools: { read: true } }, cwd: ws, systemPrompt: "", history: [], userText: "q", signal: new AbortController().signal,
    stallTimeoutMs: 0, onDelta() {} });
  if (prevConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prevConfig;
  assert.equal(results.inside.behavior, "allow", JSON.stringify(results.inside));
  assert.notEqual(results.inside.updatedInput.file_path, docx, "Read never gets the binary");
  assert.match(fs.readFileSync(results.inside.updatedInput.file_path, "utf8"), /BRIEF-TEXT/);
  assert.equal(results.inside.updatedInput.limit, READ_LINES);
  assert.equal(results.outside.behavior, "deny", "a document outside the workspace is still refused by containment");
});

fs.rmSync(root, { recursive: true, force: true });
if (failures) { console.error(`document-read: ${failures} failed`); process.exit(1); }
console.log("document-read: all passed");
