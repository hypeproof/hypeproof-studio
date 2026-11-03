// CGP-ART-R-017 / REQ-STUDIO-PREVIEW-FOLLOW — 따라 보기 on a hostile page. The served page is
// coach-written and runs in the same realm as the control, so it must not be able to hide the
// control during a coach turn, show it outside one, read its closed shadow root, or change the
// learner's choice with synthetic input or by writing storage. Each attack below is a page the
// real LiveServer serves with the real injected snippet, in headless Chromium. Without a browser
// it prints NOT RUN, and fails under FOCUS_REQUIRE_BROWSER=1.
//   node --experimental-strip-types test/live-follow-hostile.smoke.mjs

import assert from "node:assert/strict";
import * as fs from "node:fs";
import { registerHooks } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { findChromium, launch } from "./lib/headless-chromium.mjs";

const stub =
  "export const workspace={createFileSystemWatcher(){return {onDidChange(){},onDidCreate(){},onDidDelete(){},dispose(){}};}};" +
  "export class RelativePattern{constructor(b,p){this.base=b;this.pattern=p;}}export const Uri={file:(p)=>({fsPath:p})};";
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "vscode") return { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true };
    if (specifier.startsWith(".") && !/\.[a-z0-9]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});
const { LiveServer } = await import("../src/liveServer.ts");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error("live-follow-hostile: no headless Chromium and FOCUS_REQUIRE_BROWSER=1"); process.exit(1); }
  console.log("live-follow-hostile NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)");
  process.exit(0);
}

// Page script runs after load (when the control exists), a few times, so a one-shot repair is not enough.
const afterLoad = (js) => `<script>addEventListener("load",()=>{let n=0;const go=()=>{try{${js}}catch(e){}if(++n<5)setTimeout(go,80)};setTimeout(go,60)});</script>`;
const page = (head = "", body = "") => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>코치가 만든 페이지</title>${head}
<style>body{margin:0;font:16px system-ui}section{height:300px;border-bottom:1px solid #ccc}</style></head><body>
${Array.from({ length: 20 }, (_, i) => `<section id="s${i}">섹션 ${i}</section>`).join("\n")}${body}
</body></html>`;
const H = "document.querySelector('hp-follow')";
const pages = {
  plain: page(),
  // CSS hide: author !important on the host, a universal visibility rule, and the host's own inline style.
  csshide: page(
    "<style>hp-follow{display:none!important;visibility:hidden!important;opacity:0!important}*{visibility:hidden}</style>",
    afterLoad(`const h=${H};h.style.setProperty('display','none','important');h.style.setProperty('visibility','hidden','important');h.style.setProperty('opacity','0','important');`),
  ),
  // Host removal (and a move into <body>, which detaches it from where it was drawn).
  remove: page("", afterLoad(`const h=${H};if(h)h.remove();`)),
  // Synthetic input: none of these is the learner's.
  synthetic: page("", afterLoad(
    "window.dispatchEvent(new WheelEvent('wheel',{deltaY:120,bubbles:true}));" +
    "document.body.dispatchEvent(new WheelEvent('wheel',{deltaY:120,bubbles:true}));" +
    "document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'PageDown',bubbles:true}));" +
    "window.dispatchEvent(new Event('touchmove'));" +
    "document.documentElement.dispatchEvent(new PointerEvent('pointerdown',{clientX:99999,bubbles:true}));" +
    `${H}.click();`,
  )),
  // Storage overwrite: every key the control could use, both values, plus a forged request.
  storageOn: page(
    "<script>try{for(const k of ['__hpFollowOn',...Object.keys(sessionStorage).filter(k=>/hp/i.test(k))])sessionStorage.setItem(k,'1');fetch('/__hp_follow',{method:'POST',body:JSON.stringify({on:true,t:'guess'})}).catch(()=>{});}catch(e){}</script>",
  ),
  storageOff: page(
    "<script>try{for(const k of ['__hpFollowOn',...Object.keys(sessionStorage).filter(k=>/hp/i.test(k))])sessionStorage.setItem(k,'0');fetch('/__hp_follow',{method:'POST',body:JSON.stringify({on:false,t:'guess'})}).catch(()=>{});}catch(e){}</script>",
  ),
  // Showing the control outside a coach turn.
  unhide: page(
    "<style>hp-follow{display:inline!important;visibility:visible!important}</style>",
    afterLoad(`const h=${H};h.hidden=false;h.removeAttribute('hidden');h.style.setProperty('display','inline','important');`),
  ),
  // DOM primitives overridden before the snippet: open the closed root, catch `this` on the control's own calls.
  primitives: page(
    "<script>window.__leak=[];const oa=Element.prototype.attachShadow;Element.prototype.attachShadow=function(i){const r=oa.call(this,{...i,mode:'open'});window.__r=r;return r};" +
    "const os=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){try{if(this.getRootNode()!==document)window.__leak.push(this)}catch(e){}return os.call(this,n,v)};" +
    "const oap=Node.prototype.appendChild;Node.prototype.appendChild=function(c){try{if(this.getRootNode&&this.getRootNode()!==document)window.__leak.push(this)}catch(e){}return oap.call(this,c)};</script>",
  ),
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hp-follow-hostile-"));
for (const [name, html] of Object.entries(pages)) fs.writeFileSync(path.join(dir, `${name}.html`), html);
const server = new LiveServer();
const browser = await launch(bin);
const { send, evaluate } = browser;
const failures = [];
const check = (attack, ok, detail) => { if (!ok) failures.push(`${attack}: ${detail}`); else console.log(`  ✓ ${attack}`); };
try {
  const base = await server.ensure(dir);
  await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
  const open = async (name) => {
    await send("Page.navigate", { url: `${base}${name}.html` });
    for (let i = 0; i < 100; i++) { if (await evaluate("document.readyState === 'complete'").catch(() => false)) break; await sleep(50); }
    await sleep(700); // the page's afterLoad attacks have run (5 × 80 ms)
  };
  /** The closed root is reached through CDP's piercing DOM only. */
  const parts = async () => {
    const { root } = await send("DOM.getDocument", { depth: -1, pierce: true });
    const found = { hosts: 0 };
    const walk = (n, inHost) => {
      if (n.nodeName === "HP-FOLLOW") { found.hosts++; found.host = n; inHost = true; }
      if (inHost && n.nodeName === "BUTTON") found.button = n;
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
  /** What the learner gets: a painted, opaque button that a press at its centre reaches. */
  const control = async () => {
    const p = await parts();
    if (!p.host || !p.button) return { visible: false, pressed: null, why: "no control in the document" };
    let model;
    try { ({ model } = await send("DOM.getBoxModel", { nodeId: p.button.nodeId })); } catch { return { visible: false, pressed: attr(p.button, "aria-pressed"), why: "button has no box" }; }
    const [x1, y1, x2, , , y3] = model.border;
    const cx = (x1 + x2) / 2, cy = (y1 + y3) / 2;
    const hs = await computed(p.host, ["display", "opacity", "visibility"]);
    const bs = await computed(p.button, ["visibility"]);
    const hit = await evaluate(`document.elementFromPoint(${cx}, ${cy})?.tagName ?? null`);
    const visible = x2 - x1 > 0 && hs.display !== "none" && hs.opacity === "1" && bs.visibility === "visible" && hit === "HP-FOLLOW";
    return { visible, pressed: attr(p.button, "aria-pressed"), why: JSON.stringify({ host: hs, button: bs, hit, hosts: p.hosts }) };
  };
  const realWheel = async () => { await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 400, y: 400, deltaX: 0, deltaY: 120 }); await sleep(200); };
  const realClick = async () => {
    const p = await parts();
    const { model } = await send("DOM.getBoxModel", { nodeId: p.button.nodeId });
    const [x1, y1, x2, , , y3] = model.border;
    for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: (x1 + x2) / 2, y: (y1 + y3) / 2, button: "left", clickCount: 1 });
    await sleep(250);
  };

  server.setCoachEditing(true);
  await open("plain");
  let c = await control();
  assert.ok(c.visible && c.pressed === "true", `baseline: the control shows, on, during a coach turn (${c.why})`);

  // 1. CSS hide.
  await open("csshide");
  c = await control();
  check("CSS hide (author !important, *{visibility:hidden}, inline !important)", c.visible, `control hidden during a coach turn ${c.why}`);

  // 2. Host removal.
  await open("remove");
  c = await control();
  check("host removal", c.visible, `control gone after the page removed it ${c.why}`);

  // 3. Synthetic input never turns it off.
  await open("synthetic");
  c = await control();
  check("synthetic wheel/key/touch/pointer/click", c.pressed === "true", `pressed=${c.pressed} after untrusted events`);

  // 4. Storage overwrite: the learner turns it off with a real wheel; a page writing '1' does not turn it back on…
  await open("plain");
  await realWheel();
  c = await control();
  assert.equal(c.pressed, "false", "a trusted wheel is the learner's and turns it off");
  // The page writes while it is open; what counts is the next document too (a coach reload).
  await open("storageOn");
  c = await control();
  await open("plain");
  const after = await control();
  check("storage overwrite to on", c.pressed === "false" && after.pressed === "false", `pressed=${c.pressed}, after reload ${after.pressed}: the page re-enabled what the learner turned off`);
  // …and after the learner turns it on again, a page writing '0' does not turn it off.
  await open("plain");
  if ((await control()).pressed !== "true") await realClick();
  assert.equal((await control()).pressed, "true", "a real click turns it back on");
  await open("storageOff");
  c = await control();
  await open("plain");
  const after2 = await control();
  check("storage overwrite to off", c.pressed === "true" && after2.pressed === "true", `pressed=${c.pressed}, after reload ${after2.pressed}: the page turned off what the learner turned on`);

  // 5. Only Studio's coach-turn signal shows the control.
  server.setCoachEditing(false);
  await sleep(100);
  await open("unhide");
  c = await control();
  check("shown outside a coach turn", !c.visible, `control visible with no coach turn ${c.why}`);
  server.setCoachEditing(true);

  // 6. Primitives overridden before the snippet runs.
  await open("primitives");
  const leak = await evaluate("({ open: !!(window.__r && window.__r.querySelector && window.__r.querySelector('button')), caught: (window.__leak || []).length })");
  c = await control();
  check("attachShadow / setAttribute / appendChild override", !leak.open && leak.caught === 0 && c.visible, `root opened=${leak.open}, control nodes caught=${leak.caught}, visible=${c.visible}`);

  if (failures.length) {
    console.error(`✗ live-follow-hostile: ${failures.length} attack(s) succeeded\n  - ${failures.join("\n  - ")}`);
    process.exitCode = 1;
  } else {
    console.log("✓ live-follow-hostile: CSS hide, host removal, synthetic input, storage overwrite, show outside a turn and primitive overrides all fail");
  }
} finally {
  await browser.close();
  server.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
}
