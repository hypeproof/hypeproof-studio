// CGP-ART-D-017 / DES-ART-17 — the 따라 보기 toggle's design, measured on the shipped LiveServer
// and the real injected page script in headless Chromium (REQ-STUDIO-PREVIEW-FOLLOW built the
// behaviour; this file proves the design row's numbers frame by frame):
//   - the toggle is a button named "따라 보기" with a drawn eye icon (slashed when off);
//   - the follow scroll is smooth (intermediate frames) and ends within 300 ms, even on a page
//     with `scroll-behavior: smooth`; under reduced motion it is one instant jump;
//   - the changed element gets a 2 px outline that hugs it and goes after about 1 s;
//   - every toggle change is announced (a polite live region) and exposed as aria-pressed.
// A test-only hook on attachShadow (installed before the client runs) records the closed root so
// a rAF sampler can read the outline per frame. Without a browser it prints NOT RUN, and fails
// under FOCUS_REQUIRE_BROWSER=1.
//   node --experimental-strip-types test/live-follow-design.smoke.mjs

import assert from "node:assert/strict";
import * as fs from "node:fs";
import { registerHooks } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { findChromium, launch } from "./lib/headless-chromium.mjs";

const watchers = [];
globalThis.__hpFollowWatchers = watchers;
const stub =
  "export const workspace={createFileSystemWatcher(){const w={c:[],onDidChange(f){w.c.push(f)},onDidCreate(f){w.c.push(f)},onDidDelete(f){w.c.push(f)},dispose(){}};globalThis.__hpFollowWatchers.push(w);return w;}};" +
  "export class RelativePattern{constructor(b,p){this.base=b;this.pattern=p;}}export const Uri={file:(p)=>({fsPath:p})};";
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "vscode") return { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true };
    if (specifier.startsWith(".") && !/\.[a-z0-9]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error("live-follow-design: no headless Chromium and FOCUS_REQUIRE_BROWSER=1"); process.exit(1); }
  console.log("live-follow-design browser NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)");
  process.exit(0);
}

const { LiveServer } = await import("../src/liveServer.ts");
const fire = () => { for (const w of watchers.at(-1).c) w({ fsPath: "x" }); };
const tick = () => new Promise((r) => setTimeout(r, 25));

const page = (sections) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>내 페이지</title>
<style>html{scroll-behavior:smooth}body{margin:0;font:16px system-ui}section{height:300px;border-bottom:1px solid #ccc;padding:8px}</style></head><body>
${sections.map((s) => `<section id="${s.id}"><h2>${s.title}</h2><p>내용</p></section>`).join("\n")}
</body></html>`;

// Runs in every new document before the follow client: keeps the closed root for the test and
// samples [time, scrollY, outline shown] on every animation frame from document start.
const SAMPLER = `(() => {
  const orig = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (o) { const r = orig.call(this, o); if (this.tagName === "HP-FOLLOW") window.__hpRoot = r; return r; };
  const s = window.__hpSamples = [];
  const loop = (t) => {
    const f = window.__hpRoot && window.__hpRoot.querySelector(".flash");
    s.push([t, window.scrollY, f && !f.hasAttribute("hidden") ? 1 : 0]);
    if (s.length < 900) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
})();`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hp-follow-design-"));
const server = new LiveServer();
const browser = await launch(bin);
const { send, evaluate } = browser;
try {
  let sections = Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, title: `섹션 ${i}` }));
  fs.writeFileSync(path.join(dir, "index.html"), page(sections));
  const base = await server.ensure(dir);
  const media = (reduce) => send("Emulation.setEmulatedMedia", { features: [
    { name: "prefers-color-scheme", value: "light" },
    { name: "prefers-reduced-motion", value: reduce ? "reduce" : "no-preference" },
  ] });
  await send("Emulation.setDeviceMetricsOverride", { width: 1420, height: 800, deviceScaleFactor: 1, mobile: false });
  await media(false);
  await send("Page.addScriptToEvaluateOnNewDocument", { source: SAMPLER });
  await send("Accessibility.enable");

  /** Polls a page expression until it is truthy (a condition, never a fixed delay). */
  const waitFor = async (expr, what, limit = 4000) => {
    const end = Date.now() + limit;
    for (;;) {
      const v = await evaluate(expr).catch(() => null);
      if (v) return v;
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await tick();
    }
  };
  const inRoot = (body) => `(() => { const r = window.__hpRoot; if (!r) return null; ${body} })()`;
  const ready = () => waitFor("document.readyState === 'complete' && !window.__hpMark && !!window.__hpRoot", "the reloaded page");

  await send("Page.navigate", { url: base });
  await ready();
  server.setCoachEditing(true);
  await waitFor(inRoot("return !r.querySelector('.bar').hasAttribute('hidden');"), "the toggle to show");

  // 1. A button named 따라 보기 with a drawn eye; the slash appears only when off.
  const { nodes } = await send("Accessibility.getFullAXTree");
  const ax = nodes.find((n) => n.role?.value === "button" && n.name?.value === "따라 보기");
  assert.ok(ax, "an accessible button named exactly 따라 보기");
  assert.equal(ax.properties?.find((p) => p.name === "pressed")?.value?.value, "true", "exposed as a pressed toggle, on by default");
  const icon = () => evaluate(inRoot(`
    const b = r.querySelector("button"), svg = b.querySelector("svg"), label = b.querySelector("span");
    const box = (e) => { const x = e.getBoundingClientRect(); return { l: x.left, r: x.right, w: x.width, h: x.height }; };
    const shown = (e) => getComputedStyle(e).display !== "none" && e.getBoundingClientRect().width > 0;
    return { svg: box(svg), label: box(label), text: label.textContent, hidden: svg.getAttribute("aria-hidden"),
      eye: shown(svg.querySelector('path[d^="M2 12"]')) && shown(svg.querySelector("circle")), slash: shown(svg.querySelector("path.slash")) };`));
  let ic = await icon();
  assert.equal(ic.text, "따라 보기", "the visible label");
  assert.ok(ic.svg.w >= 16 && ic.svg.h >= 16, `the eye is drawn at icon size (got ${ic.svg.w}x${ic.svg.h})`);
  assert.ok(ic.svg.r <= ic.label.l, "the icon sits before the label");
  assert.equal(ic.hidden, "true", "the icon is decorative; the label names the button");
  assert.ok(ic.eye, "an open eye (outline and pupil) is painted");
  assert.equal(ic.slash, false, "no slash while on");

  // 2. Smooth scroll, at most 300 ms, then a 2 px outline that hugs the element for about 1 s.
  const change = async (mutate) => {
    await evaluate("window.scrollTo({ top: 0, behavior: 'instant' })");
    await waitFor("window.scrollY === 0", "the page at the top");
    sections = mutate(sections);
    await evaluate("window.__hpMark = 1");
    fs.writeFileSync(path.join(dir, "index.html"), page(sections));
    fire();
    await ready();
  };
  const insertAfter = (afterId, s) => (list) => { const i = list.findIndex((x) => x.id === afterId); return [...list.slice(0, i + 1), s, ...list.slice(i + 1)]; };
  await change(insertAfter("s30", { id: "new1", title: "새로 만든 부분" }));
  await waitFor(inRoot("return r.querySelector('.flash') && !r.querySelector('.flash').hasAttribute('hidden');"), "the outline");
  const hug = await evaluate(inRoot(`
    const f = r.querySelector(".flash"), cs = getComputedStyle(f), a = f.getBoundingClientRect(), e = document.getElementById("new1").getBoundingClientRect();
    return { ow: cs.outlineWidth, os: cs.outlineStyle, off: cs.outlineOffset, d: Math.max(Math.abs(a.left - e.left), Math.abs(a.top - e.top), Math.abs(a.width - e.width), Math.abs(a.height - e.height)), top: e.top, bottom: e.bottom };`));
  assert.equal(hug.ow, "2px", "a 2 px outline");
  assert.equal(hug.os, "solid");
  assert.ok(hug.d <= 1, `the outline hugs the changed element (off by ${hug.d}px)`);
  assert.ok(hug.top >= 0 && hug.bottom <= 800, "the changed element is in view");
  await waitFor(inRoot("const s = window.__hpSamples, i = s.findIndex((x) => x[2] === 1); return i >= 0 && s.slice(i).some((x) => x[2] === 0);"), "the outline to go", 3000);
  const samples = await evaluate("window.__hpSamples");
  const moves = [];
  for (let i = 1; i < samples.length; i++) if (samples[i][1] !== samples[i - 1][1]) moves.push(i);
  assert.ok(moves.length > 0, "the page scrolled");
  const startT = samples[moves[0] - 1][0], endT = samples[moves.at(-1)][0];
  const positions = new Set(moves.map((i) => Math.round(samples[i][1])));
  assert.ok(positions.size >= 3, `smooth: ${positions.size} distinct positions on the way (a jump has 1)`);
  assert.ok(endT - startT <= 300 + 20, `the scroll takes at most 300 ms (took ${Math.round(endT - startT)} ms)`);
  const on = samples.findIndex((x) => x[2] === 1);
  const off = samples.findIndex((x, i) => i > on && x[2] === 0);
  assert.ok(samples[on][0] >= endT - 1, "the outline is drawn once the scroll has arrived");
  const shownMs = samples[off][0] - samples[on][0];
  assert.ok(shownMs >= 950 && shownMs <= 1150, `the outline lasts about 1 s (got ${Math.round(shownMs)} ms)`);

  // 3. Reduced motion: one instant jump, still outlined.
  await media(true);
  await change(insertAfter("s34", { id: "new2", title: "줄인 움직임" }));
  await waitFor(inRoot("return !r.querySelector('.flash').hasAttribute('hidden');"), "the outline under reduced motion");
  // A few frames after the jump, so the sampler has seen the frame it landed on.
  await waitFor("window.__hpSamples.length >= 6", "frames after the jump");
  const rs = await evaluate("window.__hpSamples");
  const rMoves = [];
  for (let i = 1; i < rs.length; i++) if (rs[i][1] !== rs[i - 1][1]) rMoves.push(i);
  assert.equal(rMoves.length, 1, `reduced motion jumps in one frame (moved on ${rMoves.length} frames)`);
  const r2 = await evaluate("(() => { const r = document.getElementById('new2').getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; })()");
  assert.ok(r2.top >= 0 && r2.bottom <= 800, "the jump lands on the changed element");
  await media(false);

  // 4. Every change of the toggle is announced and reflected: a real click off, then on.
  const press = async () => {
    const b = await evaluate(inRoot("const x = r.querySelector('button').getBoundingClientRect(); return { x: x.left + x.width / 2, y: x.top + x.height / 2 };"));
    for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: b.x, y: b.y, button: "left", clickCount: 1 });
  };
  const status = inRoot("const s = r.querySelector('[role=status]'); return { live: s.getAttribute('aria-live'), text: s.textContent, pressed: r.querySelector('button').getAttribute('aria-pressed') };");
  await press();
  await waitFor(inRoot("return /껐어요/.test(r.querySelector('[role=status]').textContent);"), "the off announcement");
  let st = await evaluate(status);
  assert.equal(st.live, "polite");
  assert.equal(st.pressed, "false", "aria-pressed follows the click");
  assert.match(st.text, /^따라 보기를 껐어요/, "turning it off with the toggle is announced");
  ic = await icon();
  assert.equal(ic.slash, true, "the eye is slashed while off");
  await press();
  await waitFor(inRoot("return /켰어요/.test(r.querySelector('[role=status]').textContent);"), "the on announcement");
  st = await evaluate(status);
  assert.equal(st.pressed, "true");
  assert.match(st.text, /^따라 보기를 켰어요/, "turning it on is announced");
  assert.equal((await icon()).slash, false);

  console.log("✓ live-follow-design: 따라 보기 button with an eye icon, smooth scroll ≤300 ms, instant under reduced motion, 2 px outline for ~1 s, toggle changes announced");
} finally {
  await browser.close();
  server.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
}
