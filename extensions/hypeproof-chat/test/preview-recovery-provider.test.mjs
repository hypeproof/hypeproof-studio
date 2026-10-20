// REQ-STUDIO-PREVIEW-RECOVERY (CGP-ART-R-009) — the real ChatPanelProvider (task-workspace harness: real provider and
// store, VS Code APIs as fixtures) measuring browser tabs over real loopback ports. Pins the own-server guard where it
// is used (learnerPreviewTab → liveServer.servedBefore): a localhost tab Studio never served is never judged, never
// gets a card and is never closed; a press answers with its result, also when the start path cannot run.
//   node --experimental-strip-types --test test/preview-recovery-provider.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTaskHarness } from "./task-workspace-harness.mjs";

// A loopback port nothing listens on (bound, then released).
const deadPort = () => new Promise((resolve) => { const s = http.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const ORIGIN = (port) => `http://127.0.0.1:${port}`;

async function harness(ownPorts, opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hp-preview-provider-"));
  const f = await createTaskHarness(root);
  f.h.siteCheckTabs = new Set();
  const own = new Set(ownPorts.map(ORIGIN));
  const origin = (u) => { try { const x = new URL(u); return `${x.protocol}//127.0.0.1:${x.port}`; } catch { return ""; } };
  const calls = [];
  f.h.liveServer = {
    servedBefore: (u) => own.has(origin(u)),
    servedThisSession: (u) => own.has(origin(u)),
    currentUrl: () => opts.base,
    isListening: () => !!opts.base,
    ensure: async () => { calls.push("ensure"); return opts.base ?? `${ORIGIN(ownPorts[0])}/`; },
    reload: () => calls.push("reload"),
  };
  const tab = (url) => { const t = { url, title: "t", close: async () => { calls.push(`close:${url}`); const i = f.browserState.tabs.indexOf(t); if (i >= 0) f.browserState.tabs.splice(i, 1); } }; f.browserState.tabs.push(t); return t; };
  const states = () => f.posts.filter((m) => m.type === "previewRecovery");
  return { f, tab, calls, states, root };
}

test("a localhost tab Studio never served is not judged: no card (guard at the call site)", async () => {
  const toolPort = await deadPort(), ownPort = await deadPort();
  const { f, tab, states } = await harness([ownPort]);
  tab(`${ORIGIN(toolPort)}/`); // the learner's own dev server, down
  await f.handle(f.scoped({ type: "previewRecoveryRequest" }));
  assert.equal(states().at(-1).signals, null, "another tool's dead tab gets no 서버가 꺼져 있어요");
  // Positive control: Studio's own address, nothing listening → server off.
  tab(`${ORIGIN(ownPort)}/index.html`);
  await f.handle(f.scoped({ type: "previewRecoveryRequest" }));
  const s = states().at(-1).signals;
  assert.deepEqual([s?.server, s?.status, s?.path], ["stopped", null, "/index.html"]);
});

test("다시 켜기 for another tool's tab is refused: nothing starts, nothing closes, and the press is answered", async () => {
  const toolPort = await deadPort(), ownPort = await deadPort();
  const { f, tab, calls, states } = await harness([ownPort]);
  tab(`${ORIGIN(toolPort)}/`);
  await f.handle(f.scoped({ type: "previewRecoveryAction", action: "restart_preview" }));
  const last = states().at(-1);
  assert.equal(last.result, "refused");
  assert.equal(last.signals, null);
  assert.deepEqual(calls, [], "no ensure, no close");
  assert.equal(f.opened.length, 0, "no tab opened");
});

test("다시 켜기 when the start path cannot run (no work folder) answers failed, so the button comes back", async () => {
  const ownPort = await deadPort();
  const { f, tab, states } = await harness([ownPort]);
  tab(`${ORIGIN(ownPort)}/`);
  await f.handle(f.scoped({ type: "previewRecoveryAction", action: "restart_preview" }));
  const last = states().at(-1);
  assert.equal(last.result, "failed");
  assert.equal(last.signals?.server, "stopped");
});

test("다시 켜기 opens one fresh tab and closes only tabs of addresses this run's server served", async () => {
  const toolPort = await deadPort(), oldOwn = await deadPort();
  const live = await new Promise((resolve) => { const s = http.createServer((_q, r) => { r.writeHead(200, { "content-type": "text/html" }); r.end("<p>ok</p>"); }); s.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `${ORIGIN(live.address().port)}/`;
  try {
    const { f, tab, calls, states, root } = await harness([oldOwn, live.address().port], { base: undefined });
    f.vscode.workspace.workspaceFolders = [{ uri: { fsPath: root } }];
    f.h.liveServer.ensure = async () => { calls.push("ensure"); f.h.liveServer.currentUrl = () => base; f.h.liveServer.isListening = () => true; return base; };
    tab(`${ORIGIN(toolPort)}/`);
    tab(`${ORIGIN(oldOwn)}/index.html`);
    await f.handle(f.scoped({ type: "previewRecoveryAction", action: "restart_preview" }));
    assert.ok(calls.includes("ensure"), "the start path ran");
    assert.ok(calls.includes(`close:${ORIGIN(oldOwn)}/index.html`), "Studio's stale tab is replaced");
    assert.ok(!calls.some((c) => c.startsWith(`close:${ORIGIN(toolPort)}`)), "another tool's tab is never closed");
    assert.deepEqual(f.opened.map((o) => o.url), [base], "exactly one fresh tab");
    assert.equal(states().at(-1).result, "done");
  } finally { await new Promise((r) => live.close(r)); }
});
