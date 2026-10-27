// CGP-ART-D-015 (DES-ART-15): the present-mode look, measured on the real deck.html in headless Chromium.
// The CGP-ART-R-015 smoke proves keys, buttons, notes and fit. This one proves the design clauses it left
// unmeasured: the letterbox is black in rendered pixels (top/bottom bands and left/right bands, light and dark
// scheme), the position text sits in the bottom-right corner, the controls stay up for the whole 2 s and are gone
// after it, every kind of input restarts the 2 s, and a refused fullscreen in a top-level window says so and fills
// the window (the maximized fallback), not only inside the preview iframe.
//
// Run: node --experimental-strip-types test/deck-present-letterbox-browser.smoke.mjs
// Fails under FOCUS_REQUIRE_BROWSER=1 without a browser; prints NOT RUN otherwise.
// DECK_PRESENT_EVIDENCE=<dir> saves PNGs.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { findChromium, launch } from "./lib/headless-chromium.mjs";

const deck = await import("../src/deckGenerator.ts");
const { SERVICE_CONTRACT_FIXTURES } = await import("./fixtures/service-contracts/index.mjs");
const PLAN = SERVICE_CONTRACT_FIXTURES.plan;

const state = {
  team: "길잡이팀", sessions: [1, 2], dropped: [],
  E: [{ id: "E-1", state: "real", text: "할아버지가 다음 버튼이 작다고 하심" }],
  deck: {
    "1": { headline: "첫째 장 주장", visual: { type: "statement", value: "어르신이 길을 헷갈린다" }, support: ["직접 들음"], notes: "노트", refs: ["E-1"], gaps: [], session: 1 },
    "2": { headline: "둘째 장 주장", visual: { type: "quote", value: "다음 버튼이 작다", label: "할아버지" }, support: [], notes: "노트", refs: ["E-1"], gaps: [], session: 2 },
  },
};
const html = deck.renderDeck(state, PLAN.deck, PLAN)["deck.html"];

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER === "1") throw new Error("Chromium required");
  console.log("NOT RUN deck present letterbox: Chromium missing");
  process.exit(0);
}
const evidence = process.env.DECK_PRESENT_EVIDENCE;
if (evidence) mkdirSync(evidence, { recursive: true });
const IDLE = deck.PRESENT_IDLE_MS;
assert.equal(IDLE, 2000, "DES-ART-15 names 2 s");

// Minimal PNG reader for Chromium's own screenshots: 8-bit RGB or RGBA, non-interlaced, filters 0-4.
function decodePng(buf) {
  let p = 8, w = 0, h = 0, type = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), kind = buf.toString("latin1", p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (kind === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); assert.equal(data[8], 8, "8-bit PNG"); type = data[9]; assert.equal(data[12], 0, "non-interlaced PNG"); }
    else if (kind === "IDAT") idat.push(data);
    else if (kind === "IEND") break;
    p += 12 + len;
  }
  const bpp = type === 6 ? 4 : type === 2 ? 3 : assert.fail(`PNG colour type ${type}`);
  const raw = inflateSync(Buffer.concat(idat)), stride = w * bpp, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[row + x - bpp] : 0, b = y ? out[row - stride + x] : 0, c = x >= bpp && y ? out[row - stride + x - bpp] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      out[row + x] = (src[x] + pred) & 255;
    }
  }
  return { w, h, px: (x, y) => [...out.subarray(y * stride + x * bpp, y * stride + x * bpp + 3)] };
}

const browser = await launch(bin);
const delay = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const click = async (x, y) => { for (const type of ["mousePressed", "mouseReleased"]) await browser.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); await delay(150); };
const key = async (k, code = k, vk) => { for (const type of ["keyDown", "keyUp"]) await browser.send("Input.dispatchKeyEvent", { type, key: k, code, windowsVirtualKeyCode: vk }); };
const shot = async () => decodePng(Buffer.from((await browser.send("Page.captureScreenshot", { format: "png" })).data, "base64"));
const save = async (name) => { if (evidence) writeFileSync(`${evidence}/${name}.png`, Buffer.from((await browser.send("Page.captureScreenshot", { format: "png" })).data, "base64")); };
const present = async () => {
  const at = await browser.evaluate(`(()=>{const r=document.getElementById('present-open').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()`);
  await click(at[0], at[1]);
  assert.equal(await browser.evaluate(`document.body.classList.contains('presenting')`), true, "발표하기 enters present mode");
};
const READ = `(()=>{const f=document.querySelector('article.slide.on .frame').getBoundingClientRect(),pos=document.getElementById('present-pos'),p=pos.getBoundingClientRect(),ctl=document.querySelector('.present-ctl'),c=ctl.getBoundingClientRect();
return {vw:innerWidth,vh:innerHeight,frame:{l:f.left,t:f.top,r:f.right,b:f.bottom},pos:{l:p.left,t:p.top,r:p.right,b:p.bottom,text:pos.textContent,font:parseFloat(getComputedStyle(pos).fontSize),opacity:getComputedStyle(ctl).opacity},
 ctl:{r:c.right,b:c.bottom},toast:document.getElementById('present-toast').textContent,toastOpacity:getComputedStyle(document.getElementById('present-toast')).opacity,full:!!document.fullscreenElement}})()`;
const opacity = () => browser.evaluate(`getComputedStyle(document.querySelector('.present-ctl')).opacity`);
// Holds the controls up across the whole idle window: checked at several points before 2 s, then gone after it.
const holdsThenHides = async (since, label) => {
  for (const at of [300, 1000, IDLE - 400]) {
    await delay(Math.max(0, since + at - Date.now()));
    assert.equal(await opacity(), "1", `${label}: controls still shown ${at} ms after the last input`);
  }
  await delay(Math.max(0, since + IDLE + 350 - Date.now()));
  assert.equal(await opacity(), "0", `${label}: controls hidden after ${IDLE} ms idle`);
};

let cases = 0;
try {
  // Wide window → bands above and below; tall-narrow ratio inverted → bands left and right. Both schemes.
  for (const dark of [true, false]) for (const [width, height, bands] of [[1000, 900, "top-bottom"], [1600, 600, "left-right"], [1420, 800, "none"], [800, 800, "top-bottom"]]) {
    const tag = `${dark ? "dark" : "light"}-${width}x${height}`;
    await browser.load(html, { width, height, dark });
    await present();
    // Keep the controls out of the pixel samples: move the pointer far from them and wait out the idle window.
    await browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
    await delay(IDLE + 400);
    const r = await browser.evaluate(READ);
    const img = await shot();
    assert.equal(img.w, width, `${tag}: screenshot is the window`);
    // Letterbox bands: every sampled pixel outside the slide frame is black.
    const samples = [];
    if (bands === "top-bottom") {
      assert.ok(r.frame.t >= 4 && r.vh - r.frame.b >= 4, `${tag}: bands above and below (${JSON.stringify(r.frame)})`);
      for (const x of [2, width / 4, width / 2, width - 3]) samples.push([x, r.frame.t / 2], [x, (r.frame.b + r.vh) / 2]);
    } else if (bands === "left-right") {
      assert.ok(r.frame.l >= 4 && r.vw - r.frame.r >= 4, `${tag}: bands left and right (${JSON.stringify(r.frame)})`);
      for (const y of [2, height / 4, height / 2, height - 3]) samples.push([r.frame.l / 2, y], [(r.frame.r + r.vw) / 2, y]);
    }
    for (const [x, y] of samples) {
      const [R, G, B] = img.px(Math.floor(x), Math.floor(y));
      assert.ok(R <= 2 && G <= 2 && B <= 2, `${tag}: letterbox pixel (${Math.floor(x)},${Math.floor(y)}) is black, got rgb(${R},${G},${B})`);
    }
    // The slide face is painted (the dark scheme paper is about rgb(22,32,27)), so a black sample is the band, not a blank page.
    const mid = img.px(Math.floor((r.frame.l + r.frame.r) / 2), Math.floor(r.frame.t + 8));
    assert.ok(mid.some((v) => v > 12), `${tag}: the slide face is painted inside the frame, got rgb(${mid}) at ${JSON.stringify(r.frame)}`);
    await save(`letterbox-${tag}`);
    // Position text: bottom-right corner, the group hugging both edges with the 16px gutter, readable size.
    await browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 }); await delay();
    const s = await browser.evaluate(READ);
    assert.equal(s.pos.text, "1 / 2");
    assert.equal(s.pos.opacity, "1", `${tag}: mouse move brings the position text back`);
    assert.ok(Math.abs(s.vw - s.ctl.r - 16) <= 1 && Math.abs(s.vh - s.ctl.b - 16) <= 1, `${tag}: the control group sits 16px from the right and bottom edges (${JSON.stringify(s.ctl)})`);
    assert.ok(s.pos.l >= s.vw / 2 && s.pos.t >= s.vh * 0.75, `${tag}: the position text is in the bottom-right corner (${JSON.stringify(s.pos)})`);
    assert.ok(s.pos.font >= 14, `${tag}: position text at least 14px`);
    await save(`position-${tag}`);
    await key("Escape", "Escape", 27); await delay();
    cases++;
  }

  // Idle timing: up for the whole 2 s after entering, after a mouse move, after a key and after a pointer press;
  // a keyboard-focused control is never hidden.
  await browser.load(html, { width: 1420, height: 800 });
  await present();
  let t = Date.now();
  await holdsThenHides(t - 150, "after 발표하기");
  await browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 400, y: 300 }); t = Date.now();
  await holdsThenHides(t, "after a mouse move");
  await key("ArrowRight", "ArrowRight", 39); t = Date.now();
  assert.equal((await browser.evaluate(READ)).pos.text, "2 / 2");
  await holdsThenHides(t, "after a key");
  await browser.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 400, y: 300, button: "left", clickCount: 1 });
  await browser.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 400, y: 300, button: "left", clickCount: 1 }); t = Date.now();
  await holdsThenHides(t, "after a pointer press");
  await key("Tab", "Tab", 9); await delay();
  assert.ok(await browser.evaluate(`document.activeElement.closest('.present-ctl')&&document.activeElement.matches(':focus-visible')`), "Tab reaches a control with a visible focus ring");
  await delay(IDLE + 600);
  assert.equal(await opacity(), "1", "a keyboard-focused control is never hidden");
  await key("Escape", "Escape", 27); await delay();
  cases++;

  // Fullscreen refused in a top-level window (not only the preview iframe): a toast says so and the slide fills
  // the window (the maximized fallback); the toast idles away with the controls and returns on mouse move.
  for (const refusal of ["reject", "throw", "missing"]) {
    await browser.load(html, { width: 1000, height: 700, dark: false });
    await browser.evaluate(`(()=>{const P=Element.prototype;${refusal === "reject" ? "P.requestFullscreen=function(){return Promise.reject(new TypeError('denied'))}" : refusal === "throw" ? "P.requestFullscreen=function(){throw new TypeError('denied')}" : "delete P.requestFullscreen;P.requestFullscreen=undefined"};})()`);
    await present(); await delay();
    const r = await browser.evaluate(READ);
    assert.equal(r.full, false, `${refusal}: not fullscreen`);
    assert.equal(r.toast, "전체 화면을 열 수 없어 이 창을 가득 채워 발표해요.", `${refusal}: the refusal is said`);
    assert.equal(r.toastOpacity, "1", `${refusal}: the toast is shown`);
    const w = r.frame.r - r.frame.l, h = r.frame.b - r.frame.t;
    assert.ok(Math.abs(w - r.vw) < 1 || Math.abs(h - r.vh) < 1, `${refusal}: the slide fills the window (${w}x${h} in ${r.vw}x${r.vh})`);
    assert.ok(Math.abs((r.frame.l + r.frame.r) / 2 - r.vw / 2) < 1 && Math.abs((r.frame.t + r.frame.b) / 2 - r.vh / 2) < 1, `${refusal}: centred`);
    if (refusal === "reject") await save("fallback-toast-1000x700");
    await delay(IDLE + 400);
    assert.equal(await browser.evaluate(`getComputedStyle(document.getElementById('present-toast')).opacity`), "0", `${refusal}: the toast idles away with the controls`);
    await browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 50, y: 50 }); await delay();
    assert.equal(await browser.evaluate(`getComputedStyle(document.getElementById('present-toast')).opacity`), "1", `${refusal}: mouse move brings the toast back`);
    await key("Escape", "Escape", 27); await delay();
    assert.equal(await browser.evaluate(`document.body.classList.contains('presenting')`), false, `${refusal}: Esc exits the fallback`);
    cases++;
  }

  console.log(`PASS deck present letterbox: ${cases} cases — black letterbox pixels (top/bottom, left/right, dark/light), bottom-right position text, 2 s idle hold then hide after enter/mouse/key/pointer, focused control kept, top-level fullscreen refusal toast + window fill`);
} finally {
  await browser.close();
}
