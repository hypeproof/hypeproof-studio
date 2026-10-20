// REQ-STUDIO-PREVIEW-RECOVERY (CGP-ART-R-009) — the host's measurement against a real LiveServer and real HTTP:
// which tab is the learner's preview (servedBefore), what the page answered, and the cause that follows. Planted
// answers: a page that exists, a missing file, a crashed server, an old port after a restart, another process on
// a port our server used, and a localhost tool Studio never served.
//   node --experimental-strip-types test/preview-recovery-host.smoke.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { registerHooks } from "node:module";

const watcherStub =
  "export const workspace={createFileSystemWatcher(){return{onDidChange(){},onDidCreate(){},onDidDelete(){},dispose(){}};}};" +
  "export class RelativePattern{constructor(base,pattern){this.base=base;this.pattern=pattern;}}" +
  "export const Uri={file:(p)=>({fsPath:p})};";
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "vscode") return { url: `data:text/javascript,${encodeURIComponent(watcherStub)}`, shortCircuit: true };
    if (specifier.startsWith(".") && !/\.[a-z0-9]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});
const { LiveServer } = await import("../src/liveServer.ts");
const { measurePreview, previewCause, previewRecoveryView, runPreviewRecoveryAction } = await import("../src/previewFailure.ts");

const statusOf = async (url) => (await fetch(url, { signal: AbortSignal.timeout(3000), redirect: "manual" })).status;
const listen = (handler) => new Promise((resolve) => { const s = http.createServer(handler); s.listen(0, "127.0.0.1", () => resolve(s)); });
const close = (s) => new Promise((resolve) => { s.closeAllConnections?.(); s.close(() => resolve()); });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hp-preview-recovery-"));
let memory = [];
const server = new LiveServer({ get: () => memory, set: (o) => { memory = o; } });
try {
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><html><body>hi</body></html>");
  const base = await server.ensure(dir);
  const port = new URL(base).port;
  assert.deepEqual(memory, [`http://127.0.0.1:${port}`], "the started address is remembered");

  // The page exists: no card (positive control).
  let s = await measurePreview(base, server.currentUrl(), statusOf);
  assert.deepEqual([s.server, s.status], ["running", 200]);
  assert.equal(previewCause(s, true), null);
  assert.ok(server.servedBefore(`http://localhost:${port}/x.html`), "either loopback spelling is our server");

  // A missing file: 404 from our own running server names that file only.
  s = await measurePreview(`${base}levels/boss.html`, server.currentUrl(), statusOf);
  assert.deepEqual([s.server, s.status], ["running", 404]);
  assert.equal(previewRecoveryView(s, true).text, "boss.html 파일이 없어서 페이지를 열 수 없어요.");

  // A crashed server (the #751 U4 fault hook): our address no longer answers.
  server.simulateCrashForTest();
  s = await measurePreview(`${base}index.html`, server.currentUrl(), statusOf);
  assert.deepEqual([s.server, s.status], ["stopped", null]);
  assert.equal(previewCause(s, true), "server_down");

  // 다시 켜기 through the handler: the start path brings a server back (new port), the old tab's address stays known.
  let restarted;
  const outcome = await runPreviewRecoveryAction("restart_preview", {
    signals: () => measurePreview(`${base}index.html`, server.currentUrl(), statusOf),
    restart: async () => { server.dispose(); await new Promise((r) => setTimeout(r, 50)); restarted = await server.ensure(dir); },
    showFiles: async () => assert.fail("not the action for a stopped server"),
    retry: async () => assert.fail("not the action for a stopped server"),
    post: async () => {},
  });
  assert.equal(outcome, "done");
  assert.notEqual(restarted, base, "a new port");
  assert.ok(server.servedBefore(base), "the old address is still the learner's preview");
  s = await measurePreview(restarted, server.currentUrl(), statusOf);
  assert.equal(previewCause(s, true), null, "the page answers on the new address");
  s = await measurePreview(`${base}index.html`, server.currentUrl(), statusOf);
  assert.deepEqual([s.server, s.status], ["stopped", null], "a tab left on the old port: server off for that tab");
  // The handler refuses a stale press: 파일 목록 보기 for a stopped server runs nothing.
  const refused = await runPreviewRecoveryAction("show_files", {
    signals: () => measurePreview(`${base}index.html`, server.currentUrl(), statusOf),
    restart: async () => assert.fail("refused"), showFiles: async () => assert.fail("refused"), retry: async () => assert.fail("refused"),
    post: async () => {},
  });
  assert.equal(refused, "refused");

  // Another process now answers on the old port: its 404 is not the learner's file (generic).
  const oldPort = Number(new URL(base).port);
  const squatter = await new Promise((resolve, reject) => {
    const sq = http.createServer((_q, r) => { r.writeHead(404); r.end("nope"); });
    sq.once("error", reject); sq.listen(oldPort, "127.0.0.1", () => resolve(sq));
  }).catch(() => null);
  if (squatter) {
    try {
      s = await measurePreview(`${base}game.html`, server.currentUrl(), statusOf);
      assert.deepEqual([s.server, s.status], ["other", 404]);
      const v = previewRecoveryView(s, true);
      assert.equal(v.cause, "unknown");
      assert.ok(!v.text.includes("game.html"), "never names a file another process did not serve");
    } finally { await close(squatter); }
  } else console.log("  (old port taken by the OS meanwhile; squatter case skipped)");

  // A localhost tool Studio never served is not the learner's preview (no card is ever drawn for it).
  const tool = await listen((_q, r) => { r.writeHead(500); r.end(); });
  try {
    assert.equal(server.servedBefore(`http://127.0.0.1:${tool.address().port}/`), false);
    assert.equal(server.servedBefore("https://example.com/"), false);
  } finally { await close(tool); }

  // Memory survives a new LiveServer (an app restart): the restored tab's address is still known.
  const after = new LiveServer({ get: () => memory, set: () => {} });
  assert.ok(after.servedBefore(base) && after.servedBefore(restarted), "both addresses known after a restart");
  assert.equal(new LiveServer().servedBefore(base), false, "without memory nothing is claimed (negative control)");

  console.log("✓ preview recovery host: running/404/crash/restart/old port/other process measured from real HTTP; stale action refused");
} finally {
  server.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(0);
