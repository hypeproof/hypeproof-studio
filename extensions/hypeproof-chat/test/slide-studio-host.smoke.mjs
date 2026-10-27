// CGP-ART-D-016: the "덱 장 다듬기" panel host (slideStudioHost.ts) with VS Code replaced. A message counts only
// with the panel's nonce, only in the step waiting for it, a chip only when the posted view offers it, and a
// decision only for the current proposal's request id; closing the panel answers what is waiting with undefined.
//
// Run: node --experimental-strip-types test/slide-studio-host.smoke.mjs
import assert from "node:assert/strict";
import { build } from "esbuild";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = fileURLToPath(new URL("..", import.meta.url));
const bundle = await build({
  stdin: { contents: "export { openSlideStudio, validChip } from './src/slideStudioHost';", resolveDir: here, loader: "ts" },
  bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false, logLevel: "silent",
});
let panels = [];
const vscode = {
  ViewColumn: { Active: -1 },
  window: {
    createWebviewPanel: (id, title, col, opts) => {
      const p = { id, title, opts, posted: [], html: "", listeners: [], disposers: [], revealed: 0,
        webview: { set html(v) { p.html = v; }, get html() { return p.html; }, postMessage: async (m) => { p.posted.push(m); return true; }, onDidReceiveMessage: (fn) => { p.listeners.push(fn); return { dispose() {} }; } },
        onDidDispose: (fn) => { p.disposers.push(fn); return { dispose() {} }; },
        reveal: () => { p.revealed++; },
        dispose: () => { for (const fn of p.disposers) fn(); },
        send: (m) => { for (const fn of p.listeners) fn(m); } };
      panels.push(p);
      return p;
    },
  },
};
const module = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: (id) => (id === "vscode" ? vscode : require(id)), console, Buffer, process, setTimeout, clearTimeout, URL, TextEncoder, TextDecoder });
const { openSlideStudio, validChip } = module.exports;
let passed = 0;
const ok = (name) => { passed++; console.log(`✓ ${name}`); };
const plain = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v))); // objects from the vm realm
const tick = () => new Promise((r) => setTimeout(r, 0));

const CHIPS = [{ id: "simplify", label: "쉽게 줄이기", hint: "" }, { id: "visual", label: "그림으로 보이기", hint: "" }, { id: "highlight", label: "핵심 강조", hint: "" }];
const view = { heading: "덱", selected: 2, status: "", slides: [{ no: 2, title: "문제", headline: "h", visual: "v", chips: CHIPS }] };
const proposal = (req) => ({ req, no: 2, title: "문제", chip: "쉽게 줄이기", rows: [], confidence: "observed", confidenceLabel: "확인한 것", basis: "근거: 실제 관찰 1" });

// validChip
assert.deepEqual(plain(validChip(view, { no: 2, chip: "visual" })), { no: 2, chip: "visual" });
for (const bad of [{ no: 3, chip: "visual" }, { no: 2, chip: "zoom" }, { no: "2", chip: "visual" }, { no: 2.5, chip: "visual" }, { no: 2, chip: ["visual"] }, null, {}])
  assert.equal(validChip(view, bad), undefined, JSON.stringify(bad));
ok("validChip: only a slide and chip the view offers");

// pick: nonce, step and view gate
{
  panels = [];
  const ui = openSlideStudio();
  const picked = ui.pick(view);
  const p = panels[0];
  assert.equal(p.opts.enableScripts, true);
  assert.deepEqual(plain(p.opts.localResourceRoots), [], "the panel loads no local resource");
  const nonce = p.html.match(/data-nonce="([0-9a-f]+)"/)[1];
  assert.match(p.html, new RegExp(`script-src 'nonce-${nonce}'`));
  let done = false; picked.then(() => { done = true; });
  p.send({ nonce: "x", type: "chip", no: 2, chip: "visual" });
  p.send({ nonce, type: "decide", req: "2-1", accept: true });
  p.send({ nonce, type: "chip", no: 9, chip: "visual" });
  await tick();
  assert.equal(done, false, "wrong nonce, wrong step and an unoffered slide are ignored");
  p.send({ nonce, type: "chip", no: 2, chip: "visual" });
  assert.deepEqual(plain(await picked), { no: 2, chip: "visual" });

  // propose: only the current request id, only a boolean
  const answer = ui.propose(proposal("2-1"));
  assert.deepEqual(plain(p.posted.at(-1)), { nonce, type: "proposal", proposal: proposal("2-1") });
  let decided; answer.then((v) => { decided = v; });
  p.send({ nonce, type: "decide", req: "2-0", accept: true });
  p.send({ nonce, type: "decide", req: "2-1", accept: "true" });
  p.send({ nonce, type: "chip", no: 2, chip: "visual" });
  await tick();
  assert.equal(decided, undefined, "a stale request id, a non-boolean or a chip press decides nothing");
  p.send({ nonce, type: "decide", req: "2-1", accept: false });
  assert.equal(await answer, false);
  p.send({ nonce, type: "decide", req: "2-1", accept: true });
  await tick();
  assert.equal(await answer, false, "a double press cannot turn 그대로 into 반영");

  // the next pick reuses the panel and posts the view
  const again = ui.pick({ ...view, status: "그대로 두었어요." });
  assert.equal(panels.length, 1, "one panel");
  assert.equal(p.posted.at(-1).type, "view");
  assert.equal(p.posted.at(-1).view.status, "그대로 두었어요.");
  p.dispose();
  assert.equal(await again, undefined, "closing the panel answers the waiting pick with undefined");
  assert.equal(ui.closed, true);
  assert.equal(await ui.pick(view), undefined);
  assert.equal(await ui.propose(proposal("2-2")), undefined);
  assert.equal(panels.length, 1, "a closed panel is not reopened by the same run");
}
ok("panel: nonce, step and request id bind every message; closing answers undefined");

{
  panels = [];
  const ui = openSlideStudio();
  const picked = ui.pick(view);
  const nonce = panels[0].html.match(/data-nonce="([0-9a-f]+)"/)[1];
  panels[0].send({ nonce, type: "chip", no: 2, chip: "simplify" });
  await picked;
  const answer = ui.propose(proposal("2-1"));
  panels[0].dispose();
  assert.equal(await answer, undefined, "closing during a proposal writes nothing (undefined, not 반영)");
}
ok("panel: closing while a proposal is open answers undefined");

console.log(`\n${passed} slide-studio-host checks passed`);
