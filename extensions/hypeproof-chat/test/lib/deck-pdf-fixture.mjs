// Shared fixtures for the deck PDF tests (CGP-ART-R-023): the real renderDeck deck with planted notes, a loopback
// server, a PNG decoder to scan captures, a CDP wrapper that re-takes every capture as PNG, and a PDF page counter.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { inflateSync } from "node:zlib";

const wiki = await import("../../src/learningWiki.ts");
const deckGen = await import("../../src/deckGenerator.ts");
const { SERVICE_CONTRACT_FIXTURES } = await import("../fixtures/service-contracts/index.mjs");
const PLAN = SERVICE_CONTRACT_FIXTURES.plan;

// ── PDF structure: one page per image, valid xref, images only ──
export function pdfPages(bytes) {
  const text = Buffer.from(bytes).toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4"), "a PDF header");
  const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)?.[1]);
  assert.equal(text.slice(start, start + 4), "xref", "startxref points at the xref table");
  const count = Number(/^xref\n0 (\d+)\n/.exec(text.slice(start))?.[1]);
  const rows = text.slice(start).split("\n").slice(3, 2 + count);
  rows.forEach((row, k) => { const off = Number(row.slice(0, 10)); assert.equal(text.slice(off, off + `${k + 1} 0 obj`.length), `${k + 1} 0 obj`, `xref row ${k + 1} points at its object`); });
  const kids = /\/Type \/Pages \/Count (\d+) \/Kids \[([^\]]*)\]/.exec(text);
  const pages = (text.match(/\/Type \/Page \/Parent/g) ?? []).length;
  assert.equal(Number(kids[1]), pages, "the page tree counts every page");
  assert.ok(!/\/(Font|JavaScript|JS|URI|Annots|OpenAction)\b/.test(text), "images only: no text, scripts, links or actions");
  return pages;
}
// ── fixtures: a real deck from renderDeck with three drafted slides (2, 3, 5) and notes on each ──
export const NOTES_MARK = "NOTES-ONLY-발표자-메모";
export function deckFixture() {
  const s = { ...wiki.newState("A · 어르신 길찾기"), sessions: [1, 2] };
  s.E = [{ id: "E-1", kind: "observation", state: "real", outcome: "supported", text: "3명 중 2명이 혼자 도착", provenance: "현장 관찰" }];
  const slide = (headline, visual, notes) => ({ headline, visual, support: ["직접 만났다"], notes, refs: ["E-1"], gaps: ["표본이 작다"], session: 2 });
  s.deck = {
    "2": slide("어르신이 혼자 길을 찾았다", { type: "number", value: "2 / 3", label: "혼자 도착" }, NOTES_MARK + " 2"),
    "3": slide("세 단계면 충분했다", { type: "steps", items: ["사진 찍기", "길 듣기", "도착"] }, NOTES_MARK + " 3"),
    "5": slide("복지관에서 바로 만났다", { type: "quote", value: "혼자 갈 수 있겠다", label: "70대 사용자" }, NOTES_MARK + " 5"),
  };
  return deckGen.renderDeck(s, PLAN.deck, PLAN)["deck.html"];
}
// Planted fault: the notes layer, switched on, painted red over the whole slide.
export const RED_NOTES = `<style>.notes,.notes-only{display:block!important;position:fixed!important;inset:0!important;z-index:2147483647!important;background:#ff0000!important;color:#ff0000!important}</style>`;
export function plantNotes(html) { return html.replace("</head>", RED_NOTES + "</head>").replace("<body>", '<body class="show-notes">'); }

export function serve(routes) {
  const server = createServer((req, res) => {
    const body = routes[decodeURIComponent(new URL(req.url, "http://x").pathname)];
    if (body === undefined) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(body);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ base: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((c) => server.close(c)) })));
}

// Minimal PNG decoder (8-bit RGB/RGBA, non-interlaced, as Chromium writes them).
export function decodePng(buf) {
  let i = 8, w = 0, h = 0, type = 0; const idat = [];
  while (i < buf.length) {
    const len = buf.readUInt32BE(i), kind = buf.toString("latin1", i + 4, i + 8), data = buf.subarray(i + 8, i + 8 + len);
    if (kind === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); type = data[9]; assert.equal(data[8], 8); assert.equal(data[12], 0); }
    if (kind === "IDAT") idat.push(data);
    i += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3, raw = inflateSync(Buffer.concat(idat)), stride = w * bpp, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0, b = y ? out[(y - 1) * stride + x] : 0, c = x >= bpp && y ? out[(y - 1) * stride + x - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      out[y * stride + x] = (src[x] + pred) & 255;
    }
  }
  return { w, h, bpp, px: out };
}
export function redShare({ w, h, bpp, px }) {
  let red = 0;
  for (let k = 0; k < w * h; k++) { const r = px[k * bpp], g = px[k * bpp + 1], b = px[k * bpp + 2]; if (r > 200 && g < 60 && b < 60) red++; }
  return red / (w * h);
}

/**
 * Wraps a page's `send`: every JPEG capture the exporter takes is re-taken as PNG with the same clip and kept, so
 * the test sees exactly what each PDF page shows. `hook(method, params, n)` may fail or disturb a call.
 */
export function watched(send, hook = () => {}) {
  const shots = []; let n = 0;
  const wrapped = async (method, params = {}) => {
    if (method === "Page.captureScreenshot") {
      n++;
      await hook(method, params, n);
      const r = await send(method, params);
      const png = await send(method, { ...params, format: "png", quality: undefined });
      shots.push(decodePng(Buffer.from(png.data, "base64")));
      return r;
    }
    await hook(method, params, n);
    return send(method, params);
  };
  return { send: wrapped, shots };
}

