// CGP-KNOW-D-006 — the host side of the in-panel outbound dialog over an R-006 manifest.
//   A1  the prompt is frozen from the manifest: every section/item, sizes, the fixed exclusion line; invalid manifests open nothing
//   A2  only the exact full item set of the open prompt sends; partial, foreign, duplicate or malformed answers deny
//   A3  single flight, stale ids ignored, one completion; scope change, timeout and cancel deny
//   A4  a panel that cannot show it resolves null (so the caller falls back), never true
//   A5  confirmOutbound: a shown dialog's answer is final (no second ask); with no visible panel the R-006 VS Code modal asks
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { OutboundApproval, outboundPrompt, outboundPromptItemIds } from "../src/outboundApproval.ts";

const manifest = () => ({ recipient: "갤러리 · site.invalid", public: true, notes: ["서버가 이름을 붙여요"], items: [{ name: "index.html", bytes: 12 }],
  also: [{ recipient: "활동 기록 서버 · service.invalid", items: [{ name: "events.jsonl", bytes: 30 }, { name: "manifest.json", bytes: 4 }] }] });
function fixture(present, timeoutMs = 20) {
  let scope = "task-a", n = 0; const shown = [];
  const gate = new OutboundApproval({ scope: () => scope, id: () => `req-${++n}`, present: async p => { shown.push(p); return present ? present(p) : true; } }, timeoutMs);
  return { gate, shown, scope: s => scope = s };
}
const tick = () => new Promise(r => setImmediate(r));

// A1
{
  const p = outboundPrompt("x", manifest());
  assert.deepEqual(p.sections.map(s => s.recipient), ["갤러리 · site.invalid", "활동 기록 서버 · service.invalid"]);
  assert.deepEqual(outboundPromptItemIds(p), ["0:0", "1:0", "1:1"]);
  assert.equal(p.sections[1].items[0].bytes, 30); assert.equal(p.public, true); assert.deepEqual(p.notes, ["서버가 이름을 붙여요"]);
  assert.equal(p.excluded, "포함하지 않는 것: AI 기억, 개인 메모");
  assert.equal(outboundPrompt("x", { recipient: "r", items: [{ name: "a\u202ex", bytes: 1 }] }).sections[0].items[0].label, "a\ufffdx", "bidi isolated");
  for (const bad of [{ recipient: " ", items: [{ name: "a", bytes: 1 }] }, { recipient: "r", items: [] }, { recipient: "r", items: [{ name: "memory/x.md", bytes: 1 }] }, { recipient: "r", items: [{ name: "a", bytes: -1 }] }]) {
    const f = fixture(); assert.equal(await f.gate.confirm(bad), false); assert.equal(f.shown.length, 0, "invalid manifest opens nothing");
  }
  const m = manifest(), f = fixture(), pending = f.gate.confirm(m); m.recipient = "changed"; m.items[0].bytes = 999;
  assert.equal(f.shown[0].sections[0].recipient, "갤러리 · site.invalid"); assert.equal(f.shown[0].sections[0].items[0].bytes, 12, "frozen");
  f.gate.cancel(); assert.equal(await pending, false);
  console.log("  ok   A1 frozen prompt, sections, exclusion, invalid manifests");
}
// A2
for (const selected of [null, [], ["0:0"], ["0:0", "1:0"], ["0:0", "1:0", "1:1", "1:1"], ["0:0", "1:0", "9:9"], [1, 2, 3], {}, "0:0"]) {
  const f = fixture(), pending = f.gate.confirm(manifest()); f.gate.respond("req-1", selected);
  assert.equal(await pending, false, JSON.stringify(selected)); assert.equal(f.shown.at(-1), null, "dialog cleared");
}
{
  const f = fixture(), pending = f.gate.confirm(manifest()); f.gate.respond("req-1", ["1:1", "0:0", "1:0"]); assert.equal(await pending, true, "any order of the full set");
  console.log("  ok   A2 only the full item set sends");
}
// A3
{
  const f = fixture(), first = f.gate.confirm(manifest());
  assert.equal(await f.gate.confirm(manifest()), false, "concurrent request denied");
  f.gate.respond("foreign", ["0:0", "1:0", "1:1"]); assert.equal(f.shown.length, 1, "stale answer ignored");
  f.gate.respond("req-1", ["0:0", "1:0", "1:1"]); assert.equal(await first, true);
  const next = f.gate.confirm(manifest()); f.gate.respond("req-1", ["0:0", "1:0", "1:1"]); f.gate.respond("req-2", null); assert.equal(await next, false, "old id cannot answer the next prompt");
  // A long timeout, so only the scope check itself can end the prompt.
  for (const mode of ["reply", "invalidate"]) {
    const g = fixture(undefined, 60_000); let settled = false; const p = g.gate.confirm(manifest()).then(x => { settled = true; return x; });
    g.scope("task-b"); if (mode === "reply") g.gate.respond("req-1", ["0:0", "1:0", "1:1"]); else g.gate.invalidateIfScopeChanged();
    await tick(); assert.equal(settled, true, mode + " ends the prompt at once"); assert.equal(await p, false, mode);
  }
  { const g = fixture(undefined, 60_000); let settled = false; const p = g.gate.confirm(manifest()).then(x => { settled = true; return x; });
    g.gate.invalidateIfScopeChanged(); await tick(); assert.equal(settled, false, "an unchanged scope keeps the prompt open"); g.gate.cancel(); assert.equal(await p, false); }
  const t = fixture(); assert.equal(await t.gate.confirm(manifest()), false, "timeout denies");
  console.log("  ok   A3 single flight, stale ids, scope, timeout");
}
// A4
for (const present of [async () => false, async () => undefined, async () => { throw Error("closed"); }]) {
  const f = fixture(present, 10_000); let settled = false; const p = f.gate.confirm(manifest()).then(x => { settled = true; return x; });
  await tick(); assert.equal(settled, true, "no panel resolves immediately"); assert.equal(await p, null);
}
console.log("  ok   A4 an unshown dialog resolves null, never true");

// A5 — confirmOutbound with VS Code replaced at the bundle boundary.
{
  const here = path.dirname(fileURLToPath(import.meta.url)), ext = path.resolve(here, "..");
  const require = createRequire(path.join(ext, "package.json"));
  const out = await require("esbuild").build({ entryPoints: [path.join(ext, "src/outboundConsentHost.ts")], bundle: true, platform: "node", format: "cjs", write: false, external: ["vscode"], logLevel: "silent" });
  const modals = []; let answer;
  const vscode = { window: { showWarningMessage: async (message, options, ...actions) => { modals.push({ message, options, actions }); return answer; } } };
  const mod = { exports: {} }; vm.runInNewContext(out.outputFiles[0].text, { module: mod, exports: mod.exports, require: id => id === "vscode" ? vscode : require(id), TextEncoder });
  const { confirmOutbound, setOutboundPresenter } = mod.exports;
  answer = "확인하고 보내기"; assert.equal(await confirmOutbound(manifest()), true); assert.equal(modals.length, 1, "no presenter: R-006 modal");
  let shown = null; const reg = setOutboundPresenter(async () => shown);
  assert.equal(await confirmOutbound(manifest()), true); assert.equal(modals.length, 2, "panel hidden: falls back to the modal");
  shown = false; assert.equal(await confirmOutbound(manifest()), false); assert.equal(modals.length, 2, "a cancelled dialog never asks again");
  shown = true; assert.equal(await confirmOutbound(manifest()), true); assert.equal(modals.length, 2);
  assert.equal(await confirmOutbound({ recipient: "r", items: [] }), false, "invalid manifest refused before any dialog");
  const thrower = setOutboundPresenter(async () => { throw Error("x"); }); assert.equal(await confirmOutbound(manifest()), false, "a failing panel denies"); thrower.dispose();
  reg.dispose(); answer = undefined; assert.equal(await confirmOutbound(manifest()), false); assert.equal(modals.length, 3, "disposed presenter: modal again");
  console.log("  ok   A5 confirmOutbound presenter precedence and fallback");
}
console.log("PASS outbound-approval");
