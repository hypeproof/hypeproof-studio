// REQ-STUDIO-PREVIEW-RECOVERY (CGP-ART-R-009) — the host's measurement against a real LiveServer and real HTTP:
// which tab is the learner's preview (servedBefore), what the page answered, and the cause that follows. Planted
// answers: a page that exists, a missing file, a slow page on a live server, a crashed server, the real restart
// path (`ensure`, what startLivePreview calls) after that crash, an old port after the restart, another process on a
// port our server used, a localhost tool Studio never served, and the remembered addresses' cap and expiry.
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
const { LiveServer, SERVED_ORIGIN_TTL_MS } = await import("../src/liveServer.ts");
const { measurePreview, probePreviewPage, previewCause, previewRecoveryView, runPreviewRecoveryAction } = await import("../src/previewFailure.ts");

const listen = (handler) => new Promise((resolve) => { const s = http.createServer(handler); s.listen(0, "127.0.0.1", () => resolve(s)); });
const close = (s) => new Promise((resolve) => { s.closeAllConnections?.(); s.close(() => resolve()); });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hp-preview-recovery-"));
let memory = [];
let clock = Date.parse("2026-10-20T00:00:00Z");
const server = new LiveServer({ get: () => memory, set: (o) => { memory = o; } }, () => clock);
const live = () => ({ base: server.currentUrl(), listening: server.isListening() });
const measure = (url, timeoutMs = 3000) => measurePreview(url, live, (u) => probePreviewPage(u, timeoutMs));
try {
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><html><body>hi</body></html>");
  const base = await server.ensure(dir);
  const port = new URL(base).port;
  assert.deepEqual(memory, [{ o: `http://127.0.0.1:${port}`, t: clock }], "the started address is remembered with its time");

  // The page exists: no card (positive control).
  let s = await measure(base);
  assert.deepEqual([s.server, s.status], ["running", 200]);
  assert.equal(previewCause(s, true), null);
  assert.ok(server.servedBefore(`http://localhost:${port}/x.html`), "either loopback spelling is our server");

  // A missing file: 404 from our own running server names that file only.
  s = await measure(`${base}levels/boss.html`);
  assert.deepEqual([s.server, s.status], ["running", 404]);
  assert.equal(previewRecoveryView(s, true).text, "boss.html 파일이 없어서 페이지를 열 수 없어요.");

  // F1: a slow page on a server that is still listening is "slow", never "off".
  const handle = server.handle;
  server.handle = (req, res) => setTimeout(() => handle.call(server, req, res), 800);
  try {
    s = await measure(`${base}index.html`, 200);
    assert.deepEqual([s.server, s.status], ["slow", null]);
    const v = previewRecoveryView(s, true);
    assert.equal(v.cause, "slow");
    assert.equal(v.text, "미리보기가 응답이 늦어요.");
    assert.equal(v.action, "retry", "다시 시도, not 다시 켜기");
    assert.ok(server.isListening(), "the server really was up");
  } finally { delete server.handle; }

  // A crashed server (the #751 U4 fault hook): its socket is closed while the object, root and address are kept.
  server.simulateCrashForTest();
  assert.equal(server.isListening(), false);
  s = await measure(`${base}index.html`);
  assert.deepEqual([s.server, s.status], ["stopped", null]);
  assert.equal(previewCause(s, true), "server_down");

  // F2: 다시 켜기 through the handler with the real start path. startLivePreview calls `ensure(root)`, nothing else on
  // the server, so the stub does exactly that: no dispose, no self-restart. A dead server must be dropped and started.
  let restarted;
  const outcome = await runPreviewRecoveryAction("restart_preview", {
    signals: () => measure(`${base}index.html`),
    restart: async () => { restarted = await server.ensure(dir); return true; },
    showFiles: async () => assert.fail("not the action for a stopped server"),
    retry: async () => assert.fail("not the action for a stopped server"),
    post: async () => {},
  });
  assert.equal(outcome, "done");
  assert.notEqual(restarted, base, "ensure() after a crash starts a new server on a new port");
  assert.ok(server.isListening(), "the new server listens");
  s = await measure(restarted);
  assert.equal(previewCause(s, true), null, "the page answers on the new address");
  assert.ok(server.servedBefore(base), "the old address is still the learner's preview");
  s = await measure(`${base}index.html`);
  assert.deepEqual([s.server, s.status], ["stopped", null], "a tab left on the old port: server off for that tab");
  assert.equal(await server.ensure(dir), restarted, "a healthy server is reused (no second start)");
  // The handler refuses a stale press: 파일 목록 보기 for a stopped server runs nothing.
  let result;
  const refused = await runPreviewRecoveryAction("show_files", {
    signals: () => measure(`${base}index.html`),
    restart: async () => assert.fail("refused"), showFiles: async () => assert.fail("refused"), retry: async () => assert.fail("refused"),
    post: async (_s, r) => { result = r; },
  });
  assert.equal(refused, "refused");
  assert.equal(result, "refused", "the press is answered with its result");

  // Another process now answers on the old port: its 404 is not the learner's file (generic).
  const oldPort = Number(new URL(base).port);
  const squatter = await new Promise((resolve, reject) => {
    const sq = http.createServer((_q, r) => { r.writeHead(404); r.end("nope"); });
    sq.once("error", reject); sq.listen(oldPort, "127.0.0.1", () => resolve(sq));
  }).catch(() => null);
  if (squatter) {
    try {
      s = await measure(`${base}game.html`);
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

  // Memory survives a new LiveServer (an app restart): the restored tab's address is still known, but only this run's
  // addresses may have a tab closed for them.
  const after = new LiveServer({ get: () => memory, set: () => {} }, () => clock);
  assert.ok(after.servedBefore(base) && after.servedBefore(restarted), "both addresses known after a restart");
  assert.equal(after.servedThisSession(base), false, "an earlier run's address never closes a tab");
  assert.ok(server.servedThisSession(base) && server.servedThisSession(restarted));
  assert.equal(new LiveServer().servedBefore(base), false, "without memory nothing is claimed (negative control)");
  // F5: remembered addresses expire after 7 days and are capped at 20.
  const later = new LiveServer({ get: () => memory, set: () => {} }, () => clock + SERVED_ORIGIN_TTL_MS + 1);
  assert.equal(later.servedBefore(base), false, "a week-old address is forgotten");
  const many = Array.from({ length: 30 }, (_, n) => ({ o: `http://127.0.0.1:${40000 + n}`, t: clock - n }));
  let stored = many;
  const capped = new LiveServer({ get: () => stored, set: (o) => { stored = o; } }, () => clock);
  assert.equal(capped.servedBefore("http://127.0.0.1:40019/"), true);
  assert.equal(capped.servedBefore("http://127.0.0.1:40020/"), false, "only the 20 newest count");
  assert.equal(new LiveServer({ get: () => ["http://127.0.0.1:41000"], set: () => {} }, () => clock).servedBefore("http://127.0.0.1:41000/"), false, "old untimed entries are ignored");
  const cdir = fs.mkdtempSync(path.join(os.tmpdir(), "hp-preview-recovery-cap-"));
  try { await capped.ensure(cdir); assert.ok(stored.length <= 20, `stored ${stored.length}`); } finally { capped.dispose(); fs.rmSync(cdir, { recursive: true, force: true }); }

  console.log("✓ preview recovery host: running/404/slow/crash/real restart/old port/other process measured from real HTTP; memory capped and expiring; stale action refused");
} finally {
  server.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(0);
