// CGP-ART-D-016 (DES-ART-16): the "덱 장 다듬기" panel page measured in headless Chromium on the real markup
// (slideStudio.ts). Chips sit under the selected slide thumbnail, are at most three and wrap at 320 px without
// horizontal scroll; the proposal is side by side (지금 / 바꾼 안) and stacks vertically under 640 px; a changed
// claim is highlighted with its evidence label visible; 반영 / 그대로 / Esc send a decision bound to the request id.
//
// Run: node --experimental-strip-types test/slide-studio-computed.smoke.mjs
// Fails under FOCUS_REQUIRE_BROWSER=1 without a browser; prints NOT RUN otherwise.
// SLIDE_STUDIO_EVIDENCE=<dir> saves PNGs.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { findChromium, launch } from "./lib/headless-chromium.mjs";

const studio = await import("../src/slideStudio.ts");
const { SERVICE_CONTRACT_FIXTURES } = await import("./fixtures/service-contracts/index.mjs");
const PLAN = SERVICE_CONTRACT_FIXTURES.plan;
const template = PLAN.deck;

const state = {
  team: "길잡이팀", sessions: [1, 2], dropped: [], H: [], D: [{ id: "D-1", therefore: "다음 버튼을 52px로 키운다", ai_choice: "" }],
  E: [{ id: "E-1", state: "real", text: "할아버지가 다음 버튼이 작다고 하심", provenance: "" }],
  deck: {
    "1": { headline: "어르신은 다음에 어디서 꺾는지 몰라 가족에게 전화한다", visual: { type: "statement", value: "어르신이 길을 헷갈린다" }, support: ["직접 들음"], notes: "", refs: ["E-1"], gaps: [], session: 1 },
    "2": { headline: "다음 버튼은 바로 통했다", visual: { type: "quote", value: "다음 버튼이 작다", label: "할아버지" }, support: ["직접 보여 드림", "직접 만남"], notes: "", refs: ["E-1"], gaps: [], session: 2 },
    "3": { headline: "버튼을 52px로 키웠다", visual: { type: "number", value: "52px", label: "다음 버튼" }, support: [], notes: "", refs: ["D-1"], gaps: [], session: 2 },
  },
};
const patch = { no: 2, chip: "simplify", before: state.deck["2"], after: { ...state.deck["2"], headline: "다음 버튼이 통했다", support: ["직접 보여 드림"] }, refs: ["E-1"], basis: "" };
const proposal = studio.slideStudioProposal(state, template, patch, "2-1");
assert.equal(proposal.confidenceLabel, "확인한 것");
const NONCE = "abc123";
const STUB = `<script nonce="${NONCE}">window.__sent=[];window.acquireVsCodeApi=function(){return{postMessage:function(m){window.__sent.push(m);}}};</script>`;
const page = (selected) => studio.slideStudioHtml(studio.slideStudioView(state, template, PLAN, selected, ""), NONCE).replace("<h1", `${STUB}<h1`);

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER === "1") throw new Error("Chromium required");
  console.log("NOT RUN slide studio: Chromium missing");
  process.exit(0);
}
const evidence = process.env.SLIDE_STUDIO_EVIDENCE;
if (evidence) mkdirSync(evidence, { recursive: true });
const browser = await launch(bin);
let passed = 0;
const ok = (name) => { passed++; console.log(`✓ ${name}`); };
const shot = async (name) => {
  if (!evidence) return;
  const s = await browser.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  writeFileSync(`${evidence}/${name}.png`, Buffer.from(s.data, "base64"));
};
// headless-chromium's evaluate does not await promises, so the waits go through Runtime.evaluate with awaitPromise.
// Waits on conditions, not delays: resize resolves once the layout viewport has the new width and two frames have
// painted; send resolves once the page's own message listener (registered first) has run for this message.
const until = async (expression) => {
  const r = await browser.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "wait failed");
  return r.result.value;
};
const resize = async (width, height = 800) => {
  await browser.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await until(`new Promise((res, rej) => { const t0 = Date.now(); (function w() { if (innerWidth === ${width}) requestAnimationFrame(() => requestAnimationFrame(() => res(true))); else if (Date.now() - t0 > 10000) rej(new Error("viewport never reached ${width}")); else setTimeout(w, 10); })(); })`);
};
const send = (m) => until(`new Promise((res) => { addEventListener("message", () => res(true), { once: true }); window.postMessage(${JSON.stringify({ nonce: NONCE, ...m })}, "*"); })`);

const READ_LIST = `(()=>{const r=e=>{const b=e.getBoundingClientRect();return{l:b.left,t:b.top,r:b.right,b:b.bottom,w:b.width,h:b.height}};
const sel=document.querySelector('.thumb[aria-pressed="true"]');const item=sel&&sel.closest('li');
const chips=[...document.querySelectorAll('.chip')];
return{scrollW:document.documentElement.scrollWidth,vw:innerWidth,sel:sel&&{no:sel.getAttribute('data-no'),...r(sel)},
groups:document.querySelectorAll('.chips').length,wrap:(()=>{const g=document.querySelector('.chips');if(!g)return null;const cs=getComputedStyle(g);return{flexWrap:cs.flexWrap,inner:g.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight),gap:parseFloat(cs.columnGap)||0}})(),inSel:chips.every(c=>item&&item.contains(c)),
chips:chips.map(c=>({...r(c),x:c.textContent,font:parseFloat(getComputedStyle(c).fontSize),dis:c.getAttribute('aria-disabled')})),
thumbs:[...document.querySelectorAll('.thumb')].map(t=>({...r(t),font:Math.min(...[...t.querySelectorAll('span')].map(s=>parseFloat(getComputedStyle(s).fontSize)))})),
sent:window.__sent,status:document.getElementById('studio-status').textContent}})()`;
const READ_PROP = `(()=>{const r=e=>{const b=e.getBoundingClientRect();return{l:b.left,t:b.top,r:b.right,b:b.bottom,w:b.width,h:b.height}};
const p=document.getElementById('proposal');const vis=e=>e.checkVisibility({opacityProperty:true,visibilityProperty:true});
const before=p.querySelector('.pane.before'),after=p.querySelector('.pane.after');
const rows=[...p.querySelectorAll('.after .row')].map(x=>({changed:x.classList.contains('changed'),text:x.innerText,bg:getComputedStyle(x).backgroundColor,border:getComputedStyle(x).borderInlineStartColor,borderW:getComputedStyle(x).borderInlineStartWidth,label:(()=>{const l=x.querySelector('.claim-label');return l?{text:l.textContent,vis:vis(l),conf:l.getAttribute('data-confidence')}:null})()}));
return{shown:vis(p),scrollW:document.documentElement.scrollWidth,vw:innerWidth,before:before&&r(before),after:after&&r(after),rows,
heads:[...p.querySelectorAll('h3')].map(h=>h.textContent),buttons:[...p.querySelectorAll('.actions button')].map(b=>({...r(b),x:b.textContent,font:parseFloat(getComputedStyle(b).fontSize)})),
active:document.activeElement&&document.activeElement.textContent,sent:window.__sent,chipsDisabled:[...document.querySelectorAll('.chip,.thumb')].every(c=>c.getAttribute('aria-disabled')==='true')}})()`;

try {
  for (const dark of [true, false]) {
    for (const forcedColors of [false, true]) {
      const tag = `${dark ? "dark" : "light"}${forcedColors ? "-forced" : ""}`;
      await browser.load(page(2), { width: 320, height: 800, dark, forcedColors });
      // ── chips under the selected thumbnail, ≤ 3, wrapping at 320 px ──
      let L = await browser.evaluate(READ_LIST);
      assert.equal(L.sel.no, "2", "the requested slide is selected");
      assert.equal(L.groups, 1, "chips only under the selected thumbnail");
      assert.ok(L.chips.length >= 1 && L.chips.length <= 3, `chips ≤ 3 (${L.chips.length})`);
      assert.ok(L.inSel, "the chips sit in the selected slide's item");
      assert.ok(L.chips.every((c) => c.t >= L.sel.b - 0.5), "the chips are under the thumbnail");
      assert.ok(L.scrollW <= L.vw, `no horizontal scroll at 320 px (${L.scrollW} > ${L.vw})`);
      // Wrapping is a rule, not a font accident: the row wraps, and it must break when the chips do not fit on one line.
      assert.equal(L.wrap && L.wrap.flexWrap, "wrap", "the chip row wraps at 320 px");
      const oneLine = L.chips.reduce((s, c) => s + c.w, 0) + L.wrap.gap * (L.chips.length - 1);
      const lines = new Set(L.chips.map((c) => Math.round(c.t))).size;
      assert.ok(oneLine <= L.wrap.inner + 0.5 || lines > 1, `chips that do not fit on one line wrap (${oneLine} > ${L.wrap.inner}, ${lines} line)`);
      assert.ok(L.chips.every((c) => c.r <= L.vw - 15.5 && c.l >= 15.5), "every chip stays inside the 16 px gutters");
      assert.ok(L.chips.every((c) => c.h >= 44 && c.w >= 44 && c.font >= 14), `44 px targets and ≥ 14 px text ${JSON.stringify(L.chips)}`);
      assert.ok(L.thumbs.every((t) => t.h >= 44 && t.font >= 14), "thumbnails are 44 px targets with ≥ 14 px text");
      await shot(`chips-320-${tag}`);
      // ── focus ring hugs the chip ──
      const ring = await browser.focusVisibleStyle(".chip");
      assert.equal(ring["outline-width"], "2px"); assert.equal(ring["outline-style"], "solid");
      await resize(1420);
      L = await browser.evaluate(READ_LIST);
      assert.equal(new Set(L.chips.map((c) => Math.round(c.t))).size, 1, "the chips share one line when there is room");
      await shot(`chips-1420-${tag}`);
      // ── selecting another thumbnail moves the chips ──
      await browser.evaluate(`document.querySelector('.thumb[data-no="3"]').click()`);
      L = await browser.evaluate(READ_LIST);
      assert.equal(L.sel.no, "3"); assert.equal(L.groups, 1); assert.ok(L.inSel, "the chips moved under slide 3");
      // ── a chip press locks the panel and posts the chip ──
      await browser.evaluate(`document.querySelector('.chip[data-chip="simplify"]').click()`);
      L = await browser.evaluate(READ_LIST);
      assert.deepEqual(L.sent, [{ nonce: NONCE, type: "chip", no: 3, chip: "simplify" }]);
      assert.ok(L.chips.every((c) => c.dis === "true"), "chips are locked while the request runs");
      assert.match(L.status, /3번 장을 다듬는 중이에요/);
      await browser.evaluate(`document.querySelector('.chip[data-chip="visual"]').click()`);
      assert.equal((await browser.evaluate(READ_LIST)).sent.length, 1, "a second press while busy sends nothing");
      // ── the proposal: side by side at 1420, stacked under 640 ──
      await send({ type: "proposal", proposal });
      await send({ type: "proposal", proposal, nonce: "forged" });
      let P = await browser.evaluate(READ_PROP);
      assert.ok(P.shown);
      assert.deepEqual(P.heads, ["지금", "바꾼 안"]);
      assert.ok(Math.abs(P.before.t - P.after.t) < 1 && P.after.l >= P.before.r, "지금 and 바꾼 안 side by side at 1420 px");
      const changed = P.rows.filter((r) => r.changed), same = P.rows.filter((r) => !r.changed);
      assert.ok(changed.length >= 1 && same.length >= 1);
      assert.ok(changed.every((r) => r.label && r.label.vis && r.label.text === "근거 종류: 확인한 것" && r.label.conf === "observed"), "every changed claim shows its evidence label");
      assert.ok(same.every((r) => !r.label), "an unchanged row carries no change label");
      assert.ok(changed.every((r) => r.borderW === "3px" && same.every((s) => s.border !== r.border)), "the changed row is marked by a border, not colour alone");
      if (!forcedColors) assert.ok(changed.every((r) => same.every((s) => s.bg !== r.bg)), "the changed row is highlighted");
      assert.ok(P.chipsDisabled, "chips and thumbnails are locked while a proposal is open");
      assert.deepEqual(P.buttons.map((b) => b.x), ["반영", "그대로"]);
      assert.ok(P.buttons.every((b) => b.h >= 44 && b.font >= 14));
      assert.equal(P.active, "그대로", "focus starts on 그대로");
      await shot(`proposal-1420-${tag}`);
      for (const w of [639, 320]) {
        await resize(w);
        P = await browser.evaluate(READ_PROP);
        assert.ok(P.after.t >= P.before.b - 0.5, `stacked vertically at ${w} px`);
        assert.ok(P.scrollW <= P.vw, `no horizontal scroll at ${w} px`);
        await shot(`proposal-${w}-${tag}`);
      }
      await resize(640);
      P = await browser.evaluate(READ_PROP);
      assert.ok(Math.abs(P.before.t - P.after.t) < 1, "side by side again at 640 px");
      await resize(800); await shot(`proposal-800-${tag}`);
      // ── Esc = 그대로, bound to the request id; a double press sends once ──
      await browser.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await browser.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await browser.evaluate(`document.querySelector('#proposal .accept').click()`);
      P = await browser.evaluate(READ_PROP);
      assert.deepEqual(P.sent.slice(1), [{ nonce: NONCE, type: "decide", req: "2-1", accept: false }], "Esc answers 그대로 once; a later 반영 press is ignored");
      // ── the next view unlocks the panel and returns focus to the pressed chip ──
      await send({ type: "view", view: studio.slideStudioView(state, template, PLAN, 3, "그대로 두었어요. 덱은 바뀌지 않았어요.") });
      L = await browser.evaluate(READ_LIST);
      assert.ok(L.chips.every((c) => c.dis === null), `unlocked ${JSON.stringify(L)}`);
      assert.equal(L.status, "그대로 두었어요. 덱은 바뀌지 않았어요.");
      assert.equal(await browser.evaluate(`document.activeElement.getAttribute('data-chip')`), "simplify", "focus returns to the pressed chip");
      assert.equal((await browser.evaluate(READ_PROP)).shown, false, "the proposal is closed");
      // ── 반영 sends accept: true for the current request ──
      await browser.evaluate(`document.querySelector('.chip[data-chip="highlight"]').click()`);
      await send({ type: "proposal", proposal: { ...proposal, req: "3-2" } });
      await browser.evaluate(`document.querySelector('#proposal .accept').click()`);
      assert.deepEqual((await browser.evaluate(READ_PROP)).sent.at(-1), { nonce: NONCE, type: "decide", req: "3-2", accept: true });
      ok(`panel ${tag}: chips under the selected thumbnail wrap at 320 px; the proposal stacks under 640 px with the evidence label; decisions bound to the request`);
    }
  }
  // ── hostile text stays text ──
  const evil = { ...state, team: "<img src=x onerror=window.__pwn=1>", deck: { ...state.deck, "1": { ...state.deck["1"], headline: "</script><b id=pwn>x</b> " } } };
  await browser.load(studio.slideStudioHtml(studio.slideStudioView(evil, template, PLAN, 1, ""), NONCE).replace("<h1", `${STUB}<h1`), { width: 800 });
  const H = await browser.evaluate(`({pwn:!!window.__pwn,b:!!document.getElementById('pwn'),imgs:document.images.length,head:document.getElementById('studio-heading').textContent,first:document.querySelector('.thumb .headline').textContent})`);
  assert.deepEqual([H.pwn, H.b, H.imgs], [false, false, 0], "slide and team text never become markup");
  assert.match(H.head, /<img src=x/); assert.match(H.first, /<\/script><b id=pwn>/);
  ok("hostile slide and team text render as text");
} finally {
  await browser.close();
}
console.log(`\n${passed} slide-studio computed checks passed`);
