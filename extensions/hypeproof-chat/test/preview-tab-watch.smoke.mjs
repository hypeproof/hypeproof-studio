// The live preview server stops when the last tab showing it closes (lead decision 2026-10-29; Jay asked why
// "라이브 서버 · 실행 중" stayed after the answer). It stays while any tab shows it, and it is not touched at turn end.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerHooks } from "node:module";
import { PreviewTabWatch, PREVIEW_CLOSE_GRACE_MS } from "../src/previewTabWatch.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const URL0 = "http://127.0.0.1:43299/";

function fake({ tabs, url = URL0, listening = true }) {
  const state = { tabs, url, listening, stops: 0, timers: [] };
  const watch = new PreviewTabWatch({
    tabUrls: () => state.tabs, previewUrl: () => state.url, listening: () => state.listening,
    stop: async () => { state.stops++; state.listening = false; },
    schedule: (run, ms) => { const t = { run, ms, cancelled: false }; state.timers.push(t); return { cancel: () => { t.cancelled = true; } }; },
  });
  return { state, watch };
}

// Positive: the last preview tab closed → stop after the grace.
{
  const { state, watch } = fake({ tabs: ["https://example.com/"] });
  watch.tabClosed();
  assert.equal(state.timers.length, 1); assert.equal(state.timers[0].ms, PREVIEW_CLOSE_GRACE_MS); assert.equal(state.stops, 0, "nothing stops before the grace");
  state.timers[0].run(); await new Promise((r) => setImmediate(r));
  assert.equal(state.stops, 1, "no tab shows the preview: it stops");
}
// Negative controls: a tab still shows it (any path on the same origin), the server already stopped, or no server.
for (const tabs of [[URL0], ["http://127.0.0.1:43299/report.html?x=1"], ["https://a.test/", "http://127.0.0.1:43299/deck.html"]]) {
  const { state, watch } = fake({ tabs });
  assert.equal(await watch.check(), false, JSON.stringify(tabs)); assert.equal(state.stops, 0);
}
assert.equal(await fake({ tabs: [], listening: false }).watch.check(), false);
assert.equal(await fake({ tabs: [], url: null }).watch.check(), false);
// Another port on the same host is not this preview.
{ const { state, watch } = fake({ tabs: ["http://127.0.0.1:5173/"] }); assert.equal(await watch.check(), true); assert.equal(state.stops, 1); }
// Close then reopen within the grace: the later check sees the new tab and keeps the server.
{
  const { state, watch } = fake({ tabs: [] });
  watch.tabClosed(); watch.tabClosed();
  assert.equal(state.timers[0].cancelled, true, "a second close restarts the grace");
  state.tabs = [URL0]; state.timers[1].run(); await new Promise((r) => setImmediate(r));
  assert.equal(state.stops, 0);
}
// dispose cancels a pending check.
{ const { state, watch } = fake({ tabs: [] }); watch.tabClosed(); watch.dispose(); assert.equal(state.timers[0].cancelled, true); }

// Real LiveServer: started, no tab shows it → the watch stops it and it stops listening.
{
  // Same stub as shell-process-host: live reload's file watcher is a no-op here.
  registerHooks({ resolve(specifier, context, next) {
    if (specifier === "vscode") return { url: `data:text/javascript,${encodeURIComponent("const on = () => ({ dispose() {} }); export const Uri = { file: fsPath => ({ fsPath }) }; export class RelativePattern { constructor(base, pattern) { Object.assign(this, { base, pattern }); } } export const workspace = { createFileSystemWatcher: () => ({ onDidChange: on, onDidCreate: on, onDidDelete: on, dispose() {} }) };")}`, shortCircuit: true };
    if (specifier.startsWith(".") && !/\.[a-z0-9]+$/i.test(specifier)) return next(`${specifier}.ts`, context);
    return next(specifier, context);
  } });
  const { LiveServer } = await import("../src/liveServer.ts");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hps-preview-watch-"));
  fs.writeFileSync(path.join(root, "index.html"), "<!doctype html><title>t</title>");
  const live = new LiveServer();
  try {
    const url = await live.ensure(root);
    let tabs = [url];
    const watch = new PreviewTabWatch({ tabUrls: () => tabs, previewUrl: () => live.currentUrl(), listening: () => live.isListening(), stop: () => live.stop() });
    assert.equal(await watch.check(), false, "an open preview tab keeps the real server");
    assert.equal(live.isListening(), true);
    tabs = [];
    assert.equal(await watch.check(), true);
    assert.equal(live.isListening(), false, "the real server stopped");
  } finally { await live.stop(); live.dispose(); fs.rmSync(root, { recursive: true, force: true }); }
}

// Wiring: the provider stops it only from the tab-close event (never from a turn end).
const host = fs.readFileSync(path.join(here, "../src/chatPanelProvider.ts"), "utf8");
assert.match(host, /vscode\.window\.onDidCloseBrowserTab\?\.\(\(\) => previewWatch\.tabClosed\(\)\)/);
assert.equal((host.match(/previewWatch\./g) ?? []).length, 2, "tabClosed and dispose only");
console.log("preview-tab-watch: ok");
