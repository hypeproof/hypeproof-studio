// CGP-ART-R-017 / REQ-STUDIO-PREVIEW-FOLLOW — 따라 보기 in the live-server preview, measured on
// the shipped LiveServer (vscode stubbed only for its file watcher) and the real injected page
// script in headless Chromium: what the page scrolls to after a reload, the manual-scroll
// switch-off, the off state's no-jump negative, the CR-68 pause, and the toggle's computed
// geometry, focus ring and forced colours. PNGs go to ~/.hypeproof/loop/cgp-artr017-while-the-coach-is/
// when HP_FOLLOW_PNG_DIR is set. Without a browser it prints NOT RUN, and fails under
// FOCUS_REQUIRE_BROWSER=1.
//   node --experimental-strip-types test/live-follow.smoke.mjs

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as http from "node:http";
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
const { LiveServer } = await import("../src/liveServer.ts");
const { SSE_RELOAD, SSE_RELOAD_FOLLOW } = await import("../src/liveFollow.ts");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fire = () => { for (const w of watchers.at(-1).c) w({ fsPath: "x" }); };

const page = (sections) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>내 페이지</title>
<style>html{scroll-behavior:smooth}body{margin:0;font:16px system-ui}section{height:300px;border-bottom:1px solid #ccc;padding:8px}</style></head><body>
${sections.map((s) => `<section id="${s.id}"><h2>${s.title}</h2><p>${s.text ?? "내용"}</p></section>`).join("\n")}
</body></html>`;
const base40 = Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, title: `섹션 ${i}` }));

// ── Host half (no browser): which reload a change sends ────────────────────────────────
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hp-follow-sse-"));
  fs.writeFileSync(path.join(dir, "index.html"), page(base40.slice(0, 2)));
  const server = new LiveServer();
  try {
    const base = await server.ensure(dir);
    const lines = [];
    const req = http.get(`${base}__hp_livereload`, { agent: false }, (res) => res.on("data", (c) => lines.push(...c.toString("utf8").split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)))));
    await sleep(100);
    assert.deepEqual(lines, ['state:{"coach":false,"automation":false}'], "the stream starts with the current state");
    fire(); await sleep(250);
    assert.equal(lines.at(-1), SSE_RELOAD, "a change with no coach turn is a plain reload");
    server.setCoachEditing(true); await sleep(50);
    assert.equal(lines.at(-1), 'state:{"coach":true,"automation":false}');
    fire(); await sleep(250);
    assert.equal(lines.at(-1), SSE_RELOAD_FOLLOW, "a change while the coach edits is followed");
    // The turn's last write lands, then the turn ends inside the debounce: still followed.
    fire(); server.setCoachEditing(false); await sleep(250);
    assert.equal(lines.at(-1), SSE_RELOAD_FOLLOW, "decided when the change happened");
    fire(); await sleep(250);
    assert.equal(lines.at(-1), SSE_RELOAD, "after the turn, plain reload again");
    server.setAutomation("browser", true); server.setAutomation("verify", true); server.setAutomation("browser", false); await sleep(50);
    assert.equal(lines.filter((l) => l.includes('"automation":true')).length, 1, "one state push while any source acts");
    assert.ok(!lines.at(-1).includes('"automation":false'), "still automation while verify acts");
    server.setAutomation("verify", false); await sleep(50);
    assert.equal(lines.at(-1), 'state:{"coach":false,"automation":false}');
    server.reload(); await sleep(50);
    assert.equal(lines.at(-1), SSE_RELOAD, "the host's own reload never follows");
    const html = await (await fetch(base)).text();
    assert.ok(html.includes('"coach":false') && html.includes("따라 보기"), "the page is served with the state and the toggle client");
    req.destroy();
    console.log("✓ live-follow host: reload:follow only for changes during a coach turn, state pushed, CR-68 sources counted");
  } finally {
    server.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ── Page half: the real script in headless Chromium ───────────────────────────────────
const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error("live-follow: no headless Chromium and FOCUS_REQUIRE_BROWSER=1"); process.exit(1); }
  console.log("live-follow browser NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)");
  process.exit(0);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hp-follow-page-"));
const server = new LiveServer();
const browser = await launch(bin);
const { send, evaluate } = browser;
const pngDir = process.env.HP_FOLLOW_PNG_DIR;
try {
  let sections = base40.slice();
  fs.writeFileSync(path.join(dir, "index.html"), page(sections));
  const base = await server.ensure(dir);
  const media = async ({ dark = false, forced = false, reduce = false } = {}) => send("Emulation.setEmulatedMedia", { features: [
    { name: "prefers-color-scheme", value: dark ? "dark" : "light" },
    { name: "forced-colors", value: forced ? "active" : "none" },
    { name: "prefers-reduced-motion", value: reduce ? "reduce" : "no-preference" },
  ] });
  await send("Emulation.setDeviceMetricsOverride", { width: 1420, height: 800, deviceScaleFactor: 1, mobile: false });
  await media();
  const waitReady = async () => {
    for (let i = 0; i < 100; i++) {
      const ok = await evaluate("document.readyState === 'complete' && !window.__hpMark").catch(() => false);
      if (ok) return;
      await sleep(50);
    }
    throw new Error("page did not reload");
  };
  await send("Page.navigate", { url: base });
  await waitReady();
  await sleep(200);

  /** The closed shadow root is reachable through CDP's piercing DOM only. */
  const parts = async () => {
    const { root } = await send("DOM.getDocument", { depth: -1, pierce: true });
    const found = {};
    const walk = (n, inHost) => {
      if (n.nodeName === "HP-FOLLOW") { found.host = n; inHost = true; }
      if (inHost && n.nodeName === "BUTTON") found.button = n;
      if (inHost && n.attributes?.includes("class") && n.attributes[n.attributes.indexOf("class") + 1] === "bar") found.bar = n;
      if (inHost && n.attributes?.includes("role") && n.attributes[n.attributes.indexOf("role") + 1] === "status") found.live = n;
      if (inHost && n.attributes?.includes("class") && n.attributes[n.attributes.indexOf("class") + 1] === "flash") found.flash = n;
      for (const c of [...(n.children ?? []), ...(n.shadowRoots ?? [])]) walk(c, inHost);
    };
    walk(root, false);
    return found;
  };
  const attr = (n, name) => { const i = n.attributes.indexOf(name); return i < 0 ? null : n.attributes[i + 1]; };
  const computed = async (n, props) => {
    const { computedStyle } = await send("CSS.getComputedStyleForNode", { nodeId: n.nodeId });
    return Object.fromEntries(props.map((p) => [p, computedStyle.find((c) => c.name === p)?.value]));
  };
  const box = async (n) => { const { model } = await send("DOM.getBoxModel", { nodeId: n.nodeId }); const [x1, y1, x2, , , y3] = model.border; return { x: x1, y: y1, w: x2 - x1, h: y3 - y1 }; };
  const toggleState = async () => {
    const p = await parts();
    // Measured on the cascade, not the attribute: `:host{all:initial}` once beat the hidden attribute.
    // Showing is decided inside the closed root (the bar); the host itself always renders.
    const shown = (await computed(p.host, ["display"])).display !== "none" && (await computed(p.bar, ["display"])).display !== "none";
    return { shown, pressed: attr(p.button, "aria-pressed"), live: p.live.children?.[0]?.nodeValue ?? "", p };
  };
  const scrollY = () => evaluate("Math.round(window.scrollY)");
  const rectOf = (id) => evaluate(`(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; })()`);
  const change = async (mutate) => {
    sections = mutate(sections);
    await evaluate("window.__hpMark = 1");
    fs.writeFileSync(path.join(dir, "index.html"), page(sections));
    fire();
    await sleep(300);
    await waitReady();
    await sleep(700); // smooth scroll (≤300 ms) has finished; the 1 s outline is still on
  };
  const wheel = async () => {
    await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 400, y: 400, deltaX: 0, deltaY: 120 });
    await sleep(150);
  };
  const insertAfter = (afterId, s) => (list) => { const i = list.findIndex((x) => x.id === afterId); return [...list.slice(0, i + 1), s, ...list.slice(i + 1)]; };
  const inView = (r) => r.top >= 0 && r.bottom <= 800;

  // 1. No coach turn: no toggle.
  let t = await toggleState();
  assert.equal(t.shown, false, "the toggle is hidden when the coach is not editing");

  // 2. Coach editing: the toggle shows, on by default, 44px target, 14px text.
  server.setCoachEditing(true);
  await sleep(150);
  t = await toggleState();
  assert.equal(t.shown, true, "the toggle shows while the coach edits");
  assert.equal(t.pressed, "true", "on by default");
  const b = await box(t.p.button);
  assert.ok(b.w >= 44 && b.h >= 44, `44px target (got ${b.w}x${b.h})`);
  const bs = await computed(t.p.button, ["font-size", "position"]);
  assert.ok(parseFloat(bs["font-size"]) >= 14, `text ≥14px (got ${bs["font-size"]})`);
  if (pngDir) { fs.mkdirSync(pngDir, { recursive: true }); fs.writeFileSync(path.join(pngDir, "follow-on-light-1420.png"), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64")); }

  // 3. A change far below the fold: the page scrolls to it and outlines it.
  assert.equal(await scrollY(), 0);
  await change(insertAfter("s30", { id: "new1", title: "새로 만든 부분", text: "코치가 넣었어요" }));
  const r1 = await rectOf("new1");
  assert.ok(inView(r1), `scrolled to the changed element (rect ${JSON.stringify(r1)}, scrollY ${await scrollY()})`);
  t = await toggleState();
  const flashStyle = await computed(t.p.flash, ["display", "outline-width", "outline-style"]);
  assert.notEqual(flashStyle.display, "none", "the changed element is outlined");
  assert.equal(flashStyle["outline-width"], "2px");
  if (pngDir) fs.writeFileSync(path.join(pngDir, "follow-flash-light-1420.png"), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  await sleep(600);
  assert.equal((await computed((await parts()).flash, ["display"])).display, "none", "the outline goes after about 1 s");

  // 4. A text edit in place (no insertion) is found too.
  await evaluate("window.scrollTo({ top: 0, behavior: 'instant' })");
  await change((list) => list.map((s) => (s.id === "s22" ? { ...s, text: "고친 문장" } : s)));
  assert.ok(inView(await rectOf("s22")), "an edited element is followed");

  // 5. Manual scroll turns it off; the toggle and the live region say so.
  await wheel();
  t = await toggleState();
  assert.equal(t.pressed, "false", "a manual scroll turns 따라 보기 off");
  assert.equal(server.followState().on, false, "the choice is kept by the host, not in page storage");
  assert.match(t.live, /직접 스크롤/, "the change is announced");
  if (pngDir) fs.writeFileSync(path.join(pngDir, "follow-off-light-1420.png"), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));

  // 6. Negative: while off, a change does not move the page.
  // "No jump" is what the learner sees: the same section stays under the viewport centre, even
  // though a section inserted above shifts scrollY (the browser's scroll anchoring keeps the view).
  const centre = () => evaluate("document.elementFromPoint(700, 400)?.closest('section')?.id ?? null");
  const before = await centre();
  await change(insertAfter("s3", { id: "new2", title: "위쪽 변경" }));
  assert.equal(t.pressed, "false");
  assert.equal(await centre(), before, `no jump while off (centre ${before} → ${await centre()})`);
  assert.ok(!inView(await rectOf("new2")), "the change is not brought into view while off");
  assert.equal((await toggleState()).pressed, "false", "off survives the reload");

  // 7. The learner turns it back on with the toggle (a real click).
  t = await toggleState();
  const bb = await box(t.p.button);
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: bb.x + bb.w / 2, y: bb.y + bb.h / 2, button: "left", clickCount: 1 });
  await sleep(150);
  t = await toggleState();
  assert.equal(t.pressed, "true", "the toggle turns it back on");
  assert.match(t.live, /켰어요/);
  await evaluate("window.scrollTo({ top: 0, behavior: 'instant' })");
  await change(insertAfter("s35", { id: "new3", title: "다시 따라가기" }));
  assert.ok(inView(await rectOf("new3")), "followed again after turning it on");

  // 8. CR-68: while automation acts, no toggle, no follow, and input is not the learner's.
  server.setAutomation("browser", true);
  await sleep(150);
  t = await toggleState();
  assert.equal(t.shown, false, "the toggle hides while automation acts");
  await wheel();
  assert.equal((await toggleState()).pressed, "true", "automation's scrolling does not turn it off");
  await evaluate("window.scrollTo({ top: 0, behavior: 'instant' })");
  await change(insertAfter("s38", { id: "new4", title: "자동화 중 변경" }));
  assert.equal(await scrollY(), 0, "no follow scroll while automation acts");
  server.setAutomation("browser", false);
  await sleep(150);
  assert.equal((await toggleState()).shown, true, "the toggle returns after automation");

  // 9. After the coach turn: hidden, and a change does not scroll.
  server.setCoachEditing(false);
  await sleep(150);
  assert.equal((await toggleState()).shown, false);
  await change(insertAfter("s37", { id: "new5", title: "턴 끝난 뒤" }));
  assert.equal(await scrollY(), 0, "no follow outside a coach turn");

  // 10. Reduced motion: the jump is instant (no intermediate frame needed to reach the element).
  server.setCoachEditing(true);
  await media({ reduce: true });
  await sleep(150);
  sections = sections.concat({ id: "new6", title: "끝에 추가" });
  await evaluate("window.__hpMark = 1");
  fs.writeFileSync(path.join(dir, "index.html"), page(sections));
  fire();
  await sleep(300);
  await waitReady();
  await sleep(80);
  assert.ok(inView(await rectOf("new6")), "reduced motion reaches the element at once");

  // 11. Focus ring hugs (2px, offset 2px), forced colours use system colours; both themes, two widths.
  for (const dark of [false, true]) {
    for (const width of [1420, 800]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
      await media({ dark });
      await sleep(100);
      t = await toggleState();
      await send("CSS.forcePseudoState", { nodeId: t.p.button.nodeId, forcedPseudoClasses: ["focus-visible"] });
      const ring = await computed(t.p.button, ["outline-width", "outline-style", "outline-offset", "background-color", "color", "box-shadow"]);
      assert.equal(ring["outline-width"], "2px"); assert.equal(ring["outline-style"], "solid"); assert.equal(ring["outline-offset"], "2px");
      assert.notEqual(ring["background-color"], ring.color, "label is readable");
      assert.match(ring["box-shadow"] ?? "", /rgb\(255, 255, 255\) 0px 0px 0px 6px/, "the ring has its own halo on any page colour");
      const bx = await box(t.p.button);
      assert.ok(bx.x + bx.w <= width && bx.x >= 0, "inside the viewport");
      if (pngDir) fs.writeFileSync(path.join(pngDir, `follow-focus-${dark ? "dark" : "light"}-${width}.png`), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
      await send("CSS.forcePseudoState", { nodeId: t.p.button.nodeId, forcedPseudoClasses: [] });
    }
  }
  await media({ forced: true });
  await sleep(100);
  t = await toggleState();
  const fc = await computed(t.p.button, ["border-top-style", "border-top-width", "forced-color-adjust", "background-color", "color"]);
  assert.equal(t.pressed, "true");
  // Chrome paints a Canvas backplate behind text in forced colours: a Highlight fill with
  // HighlightText made the label vanish. The on state must keep the button face.
  const probe = await evaluate("(() => { const d = document.createElement('div'); d.style.background = 'ButtonFace'; document.body.append(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; })()");
  assert.equal(fc["background-color"], probe, "on state keeps ButtonFace in forced colours (label stays readable)");
  assert.equal(fc["border-top-width"], "3px", "on state is marked by a thicker border, not colour alone");
  assert.equal(fc["border-top-style"], "solid", "forced colours keep a visible border");
  assert.notEqual(fc["forced-color-adjust"], "none");
  if (pngDir) fs.writeFileSync(path.join(pngDir, "follow-forced-colors.png"), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));

  console.log("✓ live-follow page: follows the changed element, manual scroll turns it off (announced), no jump while off, toggle back on, CR-68 pause, coach-only, reduced motion, 44px/14px, ring, forced colours");
} finally {
  await browser.close();
  server.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
}
