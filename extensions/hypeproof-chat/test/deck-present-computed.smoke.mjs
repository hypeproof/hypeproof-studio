// CGP-ART-R-015 (REQ-ART-15 / DES-ART-15): present mode of the rendered deck, measured in headless Chromium on the
// real deck.html. Keys and buttons move one slide, "{n} / {total}" follows, Esc exits; the notes layer stays hidden
// in present mode even with the notes switch on; the slide is letterboxed and scaled to fit; controls auto-hide after
// 2 s idle and come back on mouse move; inside a frame that refuses fullscreen (the Studio preview iframe) a status
// line says so and the slide fills the frame instead.
//
// Run: node --experimental-strip-types test/deck-present-computed.smoke.mjs
// Fails under FOCUS_REQUIRE_BROWSER=1 without a browser; prints NOT RUN otherwise.
// DECK_PRESENT_EVIDENCE=<dir> saves PNGs.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { findChromium, launch } from "./lib/headless-chromium.mjs";

const deck = await import("../src/deckGenerator.ts");
const { SERVICE_CONTRACT_FIXTURES } = await import("./fixtures/service-contracts/index.mjs");
const PLAN = SERVICE_CONTRACT_FIXTURES.plan;
const template = PLAN.deck;

const NOTE = "발표자만 보는 문장";
const state = {
  team: "길잡이팀", sessions: [1, 2], dropped: [],
  E: [{ id: "E-1", state: "real", text: "할아버지가 다음 버튼이 작다고 하심" }],
  deck: {
    "1": { headline: "첫째 장 주장", visual: { type: "statement", value: "어르신이 길을 헷갈린다" }, support: ["직접 들음"], notes: NOTE, refs: ["E-1"], gaps: ["실제 어르신 3명"], session: 1 },
    "2": { headline: "둘째 장 주장", visual: { type: "quote", value: "다음 버튼이 작다", label: "할아버지" }, support: [], notes: NOTE, refs: ["E-1"], gaps: [], session: 2 },
    "4": { headline: "넷째 장 주장", visual: { type: "steps", items: ["보기", "누르기", "도착"] }, support: [], notes: NOTE, refs: ["E-1"], gaps: [], session: 2 },
  },
};
const html = deck.renderDeck(state, template, PLAN)["deck.html"];
const HEADS = ["첫째 장 주장", "둘째 장 주장", "넷째 장 주장"];

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER === "1") throw new Error("Chromium required");
  console.log("NOT RUN deck present: Chromium missing");
  process.exit(0);
}
const evidence = process.env.DECK_PRESENT_EVIDENCE;
if (evidence) mkdirSync(evidence, { recursive: true });
const browser = await launch(bin);
const delay = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const KEYS = { ArrowRight: 39, ArrowLeft: 37, PageDown: 34, PageUp: 33, Escape: 27, " ": 32 };
// `inputSession` is set while the deck runs in its own (out-of-process) target: input is then delivered to that target
// directly, in its own coordinates, instead of relying on the page routing it across the process boundary.
let inputSession;
const key = async (k) => {
  for (const type of ["keyDown", "keyUp"]) await browser.send("Input.dispatchKeyEvent", { type, key: k, code: k === " " ? "Space" : k, windowsVirtualKeyCode: KEYS[k], ...(k === " " && type === "keyDown" ? { text: " " } : {}) }, inputSession);
  await delay();
};
const click = async (x, y) => { for (const type of ["mousePressed", "mouseReleased"]) await browser.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }, inputSession); await delay(150); };
const shot = async (name) => {
  if (!evidence) return;
  const s = await browser.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${evidence}/${name}.png`, Buffer.from(s.data, "base64"));
};

// Everything the audience could see: visible elements' own text, and where the slide sits.
const READ = `(()=>{const vis=e=>e.checkVisibility({opacityProperty:false,visibilityProperty:true});
const shown=[...document.querySelectorAll('main article.slide')].filter(vis);
const f=shown[0]&&shown[0].querySelector('.frame').getBoundingClientRect();
const ctl=document.querySelector('.present-ctl');
return {presenting:document.body.classList.contains('presenting'),shown:shown.map(a=>a.querySelector('h2').textContent),
 notes:[...document.querySelectorAll('.notes,.todo,.checks,.bar')].filter(vis).length,
 text:document.body.innerText,pos:(document.getElementById('present-pos')||{}).textContent,
 frame:f&&{l:f.left,t:f.top,w:f.width,h:f.height},vw:innerWidth,vh:innerHeight,
 ctlOpacity:ctl&&getComputedStyle(ctl).opacity,ctlVisible:ctl?vis(ctl):false,
 buttons:[...document.querySelectorAll('.present-ctl button, .present-open')].filter(vis).map(b=>{const r=b.getBoundingClientRect();return{t:b.textContent,w:r.width,h:r.height,font:parseFloat(getComputedStyle(b).fontSize)}}),
 toast:(document.getElementById('present-toast')||{}).textContent,active:document.activeElement&&document.activeElement.id,
 full:!!document.fullscreenElement}})()`;

const fits = (r, label) => {
  const f = r.frame;
  assert.ok(f, `${label}: a slide is shown`);
  assert.ok(Math.abs(f.w / f.h - 16 / 9) < 0.01, `${label}: 16:9 (${f.w}x${f.h})`);
  assert.ok(f.l >= -0.5 && f.t >= -0.5 && f.l + f.w <= r.vw + 0.5 && f.t + f.h <= r.vh + 0.5, `${label}: inside the window`);
  assert.ok(Math.abs(f.w - r.vw) < 1 || Math.abs(f.h - r.vh) < 1, `${label}: scaled to fit (touches two edges)`);
  assert.ok(Math.abs(f.l + f.w / 2 - r.vw / 2) < 1 && Math.abs(f.t + f.h / 2 - r.vh / 2) < 1, `${label}: centred (letterbox)`);
};
const audienceSafe = (r, label) => {
  assert.equal(r.notes, 0, `${label}: no notes, citation, todo or check layer visible`);
  assert.ok(!r.text.includes(NOTE) && !/E-1|발표자 노트|아직 확인 못 한 것/.test(r.text), `${label}: notes and citation ids are not in the presented text`);
};

let cases = 0;
try {
  for (const dark of [true, false]) for (const [width, height] of [[1420, 800], [800, 800]]) {
    const tag = `${dark ? "dark" : "light"}-${width}`;
    await browser.load(html, { width, height, dark });
    let r = await browser.evaluate(READ);
    assert.equal(r.presenting, false);
    assert.deepEqual(r.shown, HEADS, "the scrolling deck shows every drafted slide");
    const openBtn = r.buttons.find((b) => b.t === "발표하기");
    assert.ok(openBtn && openBtn.w >= 44 && openBtn.h >= 44 && openBtn.font >= 14, `${tag}: 발표하기 is a 44px target at 14px`);
    // The notes switch is on: present mode must still hide the notes layer.
    await browser.evaluate(`(()=>{const c=document.querySelector('.toggle input');c.click();})()`);
    assert.ok(await browser.evaluate(`document.body.classList.contains('show-notes')&&document.querySelector('.notes').checkVisibility()`), "notes are visible on the deck with the switch on");
    const at = await browser.evaluate(`(()=>{const r=document.getElementById('present-open').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()`);
    await click(at[0], at[1]);
    r = await browser.evaluate(READ);
    assert.equal(r.presenting, true, `${tag}: 발표하기 enters present mode`);
    assert.deepEqual(r.shown, [HEADS[0]], `${tag}: one slide, the first`);
    assert.equal(r.pos, "1 / 3");
    audienceSafe(r, tag); fits(r, tag);
    assert.ok(r.buttons.filter((b) => b.t !== "발표하기").every((b) => b.w >= 44 && b.h >= 44 && b.font >= 14), `${tag}: controls are 44px targets at 14px`);
    assert.deepEqual(r.buttons.map((b) => b.t), ["이전", "다음", "발표 끝내기"]);
    await shot(`present-${tag}`);
    // Keys: → Space PageDown forward, ← PageUp back, clamped at both ends.
    const seq = [["ArrowRight", "2 / 3"], [" ", "3 / 3"], ["PageDown", "3 / 3"], ["ArrowLeft", "2 / 3"], ["PageUp", "1 / 3"], ["PageUp", "1 / 3"], ["PageDown", "2 / 3"]];
    for (const [k, want] of seq) {
      await key(k);
      r = await browser.evaluate(READ);
      assert.equal(r.pos, want, `${tag}: ${JSON.stringify(k)} → ${want}`);
      assert.deepEqual(r.shown, [HEADS[Number(want[0]) - 1]], `${tag}: the slide follows the position`);
      audienceSafe(r, `${tag} ${k}`);
    }
    // Buttons.
    const btn = async (t) => { const p = await browser.evaluate(`(()=>{const b=[...document.querySelectorAll('.present-ctl button')].find(b=>b.textContent===${JSON.stringify(t)});const r=b.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()`); await click(p[0], p[1]); return browser.evaluate(READ); };
    assert.equal((await btn("다음")).pos, "3 / 3");
    assert.equal((await btn("이전")).pos, "2 / 3");
    // Space on a focused control still advances, it does not press the control.
    await browser.evaluate(`[...document.querySelectorAll('.present-ctl button')].find(b=>b.textContent==='이전').focus()`);
    await key(" ");
    assert.equal((await browser.evaluate(READ)).pos, "3 / 3", "Space advances even with 이전 focused");
    await browser.evaluate(`document.activeElement.blur()`);
    // Auto-hide after 2 s idle; a mouse move brings the controls back.
    await delay(deck.PRESENT_IDLE_MS + 400);
    r = await browser.evaluate(READ);
    assert.equal(r.ctlOpacity, "0", `${tag}: controls hide after idle`);
    await browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 10, y: 10 }); await delay();
    assert.equal((await browser.evaluate(READ)).ctlOpacity, "1", `${tag}: mouse move shows the controls`);
    // Esc exits, back to the scrolling deck with the switch state kept and focus on 발표하기.
    await key("Escape");
    r = await browser.evaluate(READ);
    assert.equal(r.presenting, false, `${tag}: Esc exits`);
    assert.deepEqual(r.shown, HEADS);
    assert.equal(r.active, "present-open", "focus returns to 발표하기");
    assert.ok(r.notes > 0, "the notes switch still applies after present mode");
    assert.equal(r.full, false, "fullscreen is left on exit");
    // Re-entering starts at the first slide; the 발표 끝내기 button exits too.
    await click(at[0], at[1]);
    assert.equal((await browser.evaluate(READ)).pos, "1 / 3");
    assert.equal((await btn("발표 끝내기")).presenting, false, "발표 끝내기 exits");
    cases++;
  }

  // Forced colours: the controls keep a visible boundary and system colours.
  await browser.load(html, { width: 1420, height: 800, forcedColors: true });
  {
    const at = await browser.evaluate(`(()=>{const r=document.getElementById('present-open').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()`);
    await click(at[0], at[1]);
    const fc = await browser.evaluate(`(()=>{const b=document.querySelector('.present-ctl button');const s=getComputedStyle(b);return {bw:parseFloat(s.borderTopWidth),bs:s.borderTopStyle,pos:document.getElementById('present-pos').textContent}})()`);
    assert.ok(fc.bw >= 1 && fc.bs === "solid", "forced colours: buttons keep a border");
    assert.equal(fc.pos, "1 / 3");
    await shot("present-forced-colors");
    await key("Escape");
    cases++;
  }

  // A deck with no drafted slide has nothing to present.
  await browser.load(deck.renderDeck({ ...state, deck: {} }, template, PLAN)["deck.html"]);
  assert.equal(await browser.evaluate(`!!document.getElementById('present-open')`), false, "no 발표하기 without slides");

  // Inside a sandboxed iframe without fullscreen permission, as the Studio preview hosts it: a status line, then
  // the slide fills the frame.
  // Like the visitor-preview smokes (which pass on Linux): Page.setDocumentContent reuses the Document, and a frame
  // created inside such a reused document is not reliably reported by Page.getFrameTree on every Chromium build. So
  // the host page is a fresh navigation to an HTTP-served document, and the deck is the iframe's HTTP src.
  const pages = { "/host": `<!doctype html><html><body style="margin:0"><iframe id="f" sandbox="allow-scripts" style="border:0;width:100vw;height:100vh;display:block" src="/deck"></iframe></body></html>`, "/deck": html };
  const server = createServer((req, res) => { const body = pages[new URL(req.url, "http://x").pathname]; res.statusCode = body ? 200 : 404; res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(body ?? ""); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
  await browser.send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
  await browser.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "none" }, { name: "prefers-color-scheme", value: "light" }] });
  // The deck iframe is sandboxed without allow-same-origin, so with site isolation (Linux --headless=new) it is an
  // out-of-process iframe: Page.getFrameTree on the page never lists it, it is its own target. Auto-attach, and run
  // the deck measurements in that target's session. Where the frame stays in-process (chrome-headless-shell on
  // macOS) it is in the frame tree instead and an isolated world is used.
  await browser.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  const attached = browser.waitForEvent((m) => m.method === "Target.attachedToTarget" && m.params.targetInfo.type === "iframe", "the deck iframe target to attach", 5000).catch(() => null);
  await browser.send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/host` });
  // Wait on the condition, not a fixed pause. Bounded at 15 s; the failure says which step never happened.
  const until = async (fn, what, ms = 15000) => {
    const end = Date.now() + ms;
    for (;;) {
      try { const v = await fn(); if (v) return v; } catch { /* frame or context not ready yet: poll again */ }
      if (Date.now() > end) throw new Error(`timed out after ${ms} ms waiting for ${what}; frame tree: ${JSON.stringify((await browser.send("Page.getFrameTree").catch(() => ({}))).frameTree, (k, v) => (k === "frame" ? { url: v.url, id: v.id } : v))}`);
      await delay(100);
    }
  };
  const target = await attached;
  let child, sessionId = target?.params.sessionId, executionContextId;
  if (!sessionId) child = await until(async () => (await browser.send("Page.getFrameTree")).frameTree.childFrames?.[0]?.frame?.id, "the deck frame to attach");
  assert.ok(sessionId || child, "the deck frame loaded");
  const inFrame = async (expr) => {
    const x = sessionId ? await browser.send("Runtime.evaluate", { expression: expr, returnByValue: true }, sessionId) : await browser.send("Runtime.evaluate", { expression: expr, contextId: executionContextId, returnByValue: true });
    if (x.exceptionDetails) throw new Error(x.exceptionDetails.text);
    return x.result.value;
  };
  // The deck is ready once its own script has wired the 발표하기 button.
  await until(async () => {
    if (!sessionId) executionContextId = (await browser.send("Page.createIsolatedWorld", { frameId: child, worldName: "deck-present-probe" })).executionContextId;
    return inFrame(`!!document.getElementById('present-open')&&document.readyState!=='loading'`);
  }, "the deck inside the frame to finish loading");
  inputSession = sessionId;
  const fat = await inFrame(`(()=>{const r=document.getElementById('present-open').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()`);
  await click(fat[0], fat[1]);
  await until(async () => (await inFrame(READ)).presenting, "present mode to start inside the preview frame", 3000).catch(() => {});
  const fr = await inFrame(READ);
  assert.equal(fr.presenting, true, `present mode works inside the preview frame (state: ${JSON.stringify({ ...fr, text: undefined })})`);
  assert.equal(fr.full, false);
  assert.equal(fr.toast, "전체 화면을 열 수 없어 이 창을 가득 채워 발표해요.", "a refused fullscreen is said, not silent");
  audienceSafe(fr, "iframe"); fits(fr, "iframe");
  await shot("present-iframe-fallback");
  await key("ArrowRight");
  assert.equal((await inFrame(READ)).pos, "2 / 3", "keys work inside the preview frame");
  await key("Escape");
  assert.equal((await inFrame(READ)).presenting, false, "Esc exits inside the preview frame");
  cases++;
  } finally { server.close(); }

  console.log(`PASS deck present: ${cases} cases (dark/light × 1420/800, forced colours, preview iframe) — keys, buttons, n / total, notes hidden, letterbox fit, idle hide, Esc, fullscreen refusal`);
} finally {
  await browser.close();
}
