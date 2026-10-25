// CGP-ART-R-006 (REQ-ART-06) page side, in a real headless Chromium: the picked node's facts
// are read, the chosen values show live on that node only, a reset restores its style
// attribute exactly, and the page's source file is never written.
//
// Run: node --experimental-strip-types test/style-tweak-page.smoke.mjs
// FOCUS_REQUIRE_BROWSER=1 fails when no browser is found (CI); otherwise it prints NOT RUN.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { findChromium, launch } from "./lib/headless-chromium.mjs";
import { STYLE_TWEAK_APPLY, STYLE_TWEAK_PROPS, STYLE_TWEAK_READ, buildStyleTweak, chooseStyle, previewValues } from "../src/styleTweak.ts";

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER === "1") throw new Error("Chromium required");
  console.log("NOT RUN style tweak page: no Chromium");
  process.exit(0);
}
let browser;
try { browser = await launch(bin); } catch (error) {
  if (process.env.FOCUS_REQUIRE_BROWSER === "1") throw error;
  console.log(`NOT RUN style tweak page: ${error.message}`);
  process.exit(0);
}
const dir = mkdtempSync(join(tmpdir(), "hp-style-tweak-"));
try {
  const html = `<!doctype html><html><body style="background: rgb(250, 250, 250); color: rgb(20, 20, 20)">
<h1 id="title" style="padding-left: 3px; color: rgb(0, 0, 128) !important">안녕</h1>
<p class="a" style="color: rgb(200, 30, 30)">하나</p><p class="a" style="color: rgb(200, 30, 30)">둘</p>
<button id="other" style="border-radius: 2px">다른 요소</button>
</body></html>`;
  const file = join(dir, "index.html");
  writeFileSync(file, html);
  const before = { bytes: readFileSync(file), mtime: statSync(file).mtimeMs };
  await browser.send("Page.navigate", { url: pathToFileURL(file).href });
  await new Promise((r) => setTimeout(r, 300));
  const { root } = await browser.send("DOM.getDocument", { depth: -1 });
  const { nodeId } = await browser.send("DOM.querySelector", { nodeId: root.nodeId, selector: "#title" });
  const { node } = await browser.send("DOM.describeNode", { nodeId });
  const { object } = await browser.send("DOM.resolveNode", { backendNodeId: node.backendNodeId });
  const call = async (fn, args) => (await browser.send("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: fn, arguments: args.map((value) => ({ value })), returnByValue: true })).result.value;
  const computed = () => browser.evaluate(`(() => { const s = getComputedStyle(document.getElementById('title')); return { color: s.color, fontSize: s.fontSize, padding: s.padding, paddingLeft: s.paddingLeft, radius: s.borderTopLeftRadius, attr: document.getElementById('title').getAttribute('style'), other: document.getElementById('other').getAttribute('style'), bodyAttr: document.body.getAttribute('style') }; })()`);

  const facts = await call(STYLE_TWEAK_READ, [[...STYLE_TWEAK_PROPS]]);
  assert.equal(facts.styleAttr, "padding-left: 3px; color: rgb(0, 0, 128) !important");
  assert.equal(facts.current.color, "rgb(0, 0, 128)");
  let state = buildStyleTweak("t1", { backendNodeId: node.backendNodeId, documentGeneration: "L" }, facts);
  assert.ok(state.rows[0].options.includes("rgb(200, 30, 30)") && state.rows[0].options.includes("rgb(20, 20, 20)"), `page colours offered: ${state.rows[0].options}`);
  const original = await computed();
  console.log("✓ read: the node's computed values, its style attribute and the page's colours");

  for (const [p, v] of [["color", "rgb(200, 30, 30)"], ["font-size", "24px"], ["padding", "16px"], ["border-radius", "8px"]]) {
    const r = chooseStyle(state, "t1", p, v); assert.ok(r.ok, p); state = r.state;
  }
  const times = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    await call(STYLE_TWEAK_APPLY, [state.styleAttr, previewValues(state)]);
    times.push(performance.now() - t0);
  }
  const live = await computed();
  assert.equal(live.color, "rgb(200, 30, 30)", "beats the page's own !important inline colour");
  assert.equal(live.fontSize, "24px"); assert.equal(live.padding, "16px"); assert.equal(live.radius, "8px");
  assert.equal(live.other, "border-radius: 2px", "another element is untouched");
  assert.equal(live.bodyAttr, original.bodyAttr);
  const median = times.sort((a, b) => a - b)[2];
  assert.ok(median < 100, `live preview within 100 ms (median ${median.toFixed(1)} ms)`);
  console.log(`✓ preview: the chosen values show on the picked node only (median ${median.toFixed(1)} ms per update)`);

  const back = chooseStyle(state, "t1", "font-size", null); assert.ok(back.ok); state = back.state;
  await call(STYLE_TWEAK_APPLY, [state.styleAttr, previewValues(state)]);
  const one = await computed();
  assert.equal(one.fontSize, original.fontSize, "font size reset"); assert.equal(one.color, "rgb(200, 30, 30)", "other choices stay");
  await call(STYLE_TWEAK_APPLY, [state.styleAttr, {}]);
  const restored = await computed();
  assert.deepEqual(restored, original, "a full reset restores the style attribute exactly, including the page's own !important and longhand");
  console.log("✓ reset: per property, and the whole preview restores the original style attribute exactly");

  assert.ok(readFileSync(file).equals(before.bytes), "the page's file is byte-identical");
  assert.equal(statSync(file).mtimeMs, before.mtime, "and was not rewritten");
  await browser.send("Page.reload", {});
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await browser.evaluate(`document.getElementById('title').getAttribute('style')`), "padding-left: 3px; color: rgb(0, 0, 128) !important", "a reload shows the file as it was");
  console.log("✓ no file write: the source file is untouched and a reload shows it unchanged");

  // A hostile page overrides the DOM methods the tweak calls. In the page's own world the apply is
  // subverted; in the Studio isolated world (what BrowserControl resolves into) it is not.
  await browser.evaluate(`Element.prototype.setAttribute = function(){ throw new Error('page says no'); }; CSSStyleDeclaration.prototype.setProperty = function(){};`);
  const { root: r2 } = await browser.send("DOM.getDocument", { depth: 0 });
  const { nodeId: hId } = await browser.send("DOM.querySelector", { nodeId: r2.nodeId, selector: "#title" });
  const { node: hNode } = await browser.send("DOM.describeNode", { nodeId: hId });
  const main = (await browser.send("DOM.resolveNode", { backendNodeId: hNode.backendNodeId })).object.objectId;
  const subverted = await browser.send("Runtime.callFunctionOn", { objectId: main, functionDeclaration: STYLE_TWEAK_APPLY, arguments: [{ value: "x: y" }, { value: { color: "rgb(1, 2, 3)" } }], returnByValue: true });
  assert.ok(subverted.exceptionDetails, "control: in the page's world the override wins");
  const { frameTree } = await browser.send("Page.getFrameTree");
  const world = await browser.send("Page.createIsolatedWorld", { frameId: frameTree.frame.id, worldName: "hps-style-tweak" });
  const iso = (await browser.send("DOM.resolveNode", { backendNodeId: hNode.backendNodeId, executionContextId: world.executionContextId })).object.objectId;
  const done = await browser.send("Runtime.callFunctionOn", { objectId: iso, functionDeclaration: STYLE_TWEAK_APPLY, arguments: [{ value: null }, { value: { color: "rgb(200, 30, 30)" } }], returnByValue: true });
  assert.equal(done.exceptionDetails, undefined);
  assert.equal(await browser.evaluate(`getComputedStyle(document.getElementById('title')).color`), "rgb(200, 30, 30)", "the isolated world's DOM methods are the browser's own");
  console.log("✓ isolated world: a page that overrides setAttribute/setProperty cannot subvert the preview");
  await browser.send("Page.reload", {});
  await new Promise((r) => setTimeout(r, 300));

  // Without a style attribute, a reset removes the attribute again.
  const { nodeId: otherId } = await browser.send("DOM.querySelector", { nodeId: (await browser.send("DOM.getDocument", { depth: 0 })).root.nodeId, selector: "p" });
  await browser.send("DOM.removeAttribute", { nodeId: otherId, name: "style" });
  const { object: p } = await browser.send("DOM.resolveNode", { nodeId: otherId });
  const onP = async (args) => (await browser.send("Runtime.callFunctionOn", { objectId: p.objectId, functionDeclaration: STYLE_TWEAK_APPLY, arguments: args.map((value) => ({ value })), returnByValue: true })).result.value;
  await onP([null, { "font-size": "20px" }]);
  assert.match(await browser.evaluate(`document.querySelector('p').getAttribute('style')`), /font-size: 20px !important/);
  await onP([null, {}]);
  assert.equal(await browser.evaluate(`document.querySelector('p').hasAttribute('style')`), false);
  console.log("✓ reset on a node that had no style attribute leaves none");
} finally {
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
}
