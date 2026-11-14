// CGP-AGENT-R-031 (REQ-CGP-AGENT-66): Studio asks the Service whether it is busy and tells the panel.
//
// 1 is pure (serviceStatus.ts): the URL, the parse (only an explicit `busy: true` is busy), and the
//   fetch: no token means no request, and an error, a timeout, a 401 or a 404 reads as not busy
//   (positive and negative controls for the parse and the fail-quiet rule).
// 2 runs the real ChatPanelProvider.handleMessage against a fake VS Code: a busy answer posts
//   `serviceStatus: true`, an unchanged answer is not re-posted, recovery posts `false`, a remount
//   re-posts, a seat without a token asks nothing, and the request carries the seat token only.
//
// Run: node --experimental-strip-types test/service-status.smoke.mjs

import assert from "node:assert/strict";
import * as path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";
import { build } from "esbuild";

const S = await import("../src/serviceStatus.ts");
const here = path.dirname(fileURLToPath(import.meta.url));
const extRoot = path.join(here, "..");
const require = createRequire(import.meta.url);
let passed = 0;
const ok = (name) => { passed++; console.log(`✓ ${name}`); };
const J = (x) => JSON.parse(JSON.stringify(x));

const reply = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => (typeof body === "function" ? body() : body) });

// ── 1. Pure ──
{
  assert.equal(S.serviceStatusUrl("https://api.hypeproof-ai.xyz/v1"), "https://api.hypeproof-ai.xyz/v1/service-status");
  assert.equal(S.serviceStatusUrl("https://api.hypeproof-ai.xyz/v1/"), "https://api.hypeproof-ai.xyz/v1/service-status");
  assert.equal(S.parseServiceStatus({ busy: true }), true, "positive control: an explicit true is busy");
  for (const b of [{ busy: false }, { busy: "true" }, { busy: 1 }, {}, null, undefined, "busy", [true], { error: { code: "missing" } }]) {
    assert.equal(S.parseServiceStatus(b), false, `negative control: ${JSON.stringify(b)} is not busy`);
  }
  assert.equal(S.SERVICE_STATUS_POLL_MS, 60_000);
  ok("pure: URL and parse");

  const calls = [];
  const rec = (status, body) => async (url, init) => { calls.push({ url, init }); return reply(status, body)(); };
  assert.equal(await S.fetchServiceBusy(rec(200, { busy: true }), { proxyUrl: "https://s/v1", token: undefined }), false);
  assert.equal(calls.length, 0, "no token: no request");
  assert.equal(await S.fetchServiceBusy(rec(200, { busy: true }), { proxyUrl: "https://s/v1", token: "seat-tok" }), true);
  assert.equal(calls[0].url, "https://s/v1/service-status");
  assert.deepEqual(Object.keys(calls[0].init.headers).sort(), ["accept", "authorization"], "only the seat token and accept are sent");
  assert.equal(calls[0].init.headers.authorization, "Bearer seat-tok");
  assert.ok(calls[0].init.signal instanceof AbortSignal, "the request has a timeout");
  assert.equal(await S.fetchServiceBusy(rec(200, { busy: false }), { proxyUrl: "https://s/v1", token: "t" }), false);
  assert.equal(await S.fetchServiceBusy(rec(401, { busy: true }), { proxyUrl: "https://s/v1", token: "t" }), false, "a refused token reads as not busy");
  assert.equal(await S.fetchServiceBusy(rec(404, { error: "not found" }), { proxyUrl: "https://s/v1", token: "t" }), false, "a Service without the route reads as not busy");
  assert.equal(await S.fetchServiceBusy(async () => { throw new TypeError("fetch failed"); }, { proxyUrl: "https://s/v1", token: "t" }), false, "a network error reads as not busy");
  assert.equal(await S.fetchServiceBusy(rec(200, () => { throw new SyntaxError("bad json"); }), { proxyUrl: "https://s/v1", token: "t" }), false, "a bad body reads as not busy");
  const hung = (_u, init) => new Promise((_r, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
  const t0 = Date.now();
  assert.equal(await S.fetchServiceBusy(hung, { proxyUrl: "https://s/v1", token: "t", timeoutMs: 50 }), false, "a hung request times out as not busy");
  assert.ok(Date.now() - t0 < 2000, "the timeout ends the wait");
  ok("pure: fetch is fail-quiet and sends only the seat token");
}

// ── 2. The real chat host ──
{
  const bundle = await build({ stdin: { contents: "export {ChatPanelProvider} from './src/chatPanelProvider';", resolveDir: extRoot, loader: "ts" }, bundle: true, platform: "node", format: "cjs", external: ["vscode", "@anthropic-ai/claude-agent-sdk", "zod"], write: false, logLevel: "error" });
  const toUri = (p) => ({ fsPath: p, path: p, scheme: "file" });
  const vscode = {
    ViewColumn: { One: 1, Two: 2, Beside: 2 }, ProgressLocation: { Window: 10, Notification: 15 },
    Uri: { file: toUri, joinPath: (u, ...parts) => toUri(path.join(u.fsPath, ...parts)), parse: (x) => toUri(x) },
    commands: { executeCommand: async () => undefined },
    env: { appName: "HypeProof Studio" },
    window: { showWarningMessage: async () => undefined, showInformationMessage: async () => undefined, showErrorMessage: async () => undefined, withProgress: async (_o, f) => f() },
    workspace: { workspaceFolders: undefined, getConfiguration: () => ({ get: (_k, fallback) => fallback }) },
  };
  const mod = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module: mod, exports: mod.exports, require: (id) => (id === "vscode" ? vscode : require(id)), console: { ...console, log() {}, warn() {}, error() {} }, fetch: () => Promise.reject(new Error("no network in tests")), process, Buffer, URL, URLSearchParams, TextEncoder, TextDecoder, AbortSignal, AbortController, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, crypto: webcrypto, structuredClone });
  const { ChatPanelProvider } = mod.exports;
  const make = (token) => {
    const h = Object.create(ChatPanelProvider.prototype);
    const posts = [], asked = [];
    const state = { busy: false };
    Object.assign(h, {
      context: { globalState: { get: () => undefined, update: async () => {} }, workspaceState: { get: () => undefined, update: async () => {} }, secrets: { get: async () => token } },
      post: async (m) => { posts.push(J(m)); return true; },
    });
    h.serviceStatusFetch = async (url, init) => { asked.push({ url, auth: init.headers.authorization }); return { ok: true, status: 200, json: async () => ({ busy: state.busy }) }; };
    const statuses = () => posts.filter((m) => m.type === "serviceStatus").map((m) => m.busy);
    return { h, state, statuses, asked };
  };

  const { h, state, statuses, asked } = make("seat-tok");
  await h.handleMessage({ type: "serviceStatusRequest", mount: true });
  assert.deepEqual(statuses(), [false], "mount posts the calm state");
  assert.equal(asked[0].url, "https://api.hypeproof-ai.xyz/v1/service-status");
  assert.equal(asked[0].auth, "Bearer seat-tok");
  state.busy = true;
  await h.handleMessage({ type: "serviceStatusRequest" });
  assert.deepEqual(statuses(), [false, true], "busy is posted");
  await h.handleMessage({ type: "serviceStatusRequest" });
  assert.deepEqual(statuses(), [false, true], "an unchanged answer is not re-posted");
  state.busy = false;
  await h.handleMessage({ type: "serviceStatusRequest" });
  assert.deepEqual(statuses(), [false, true, false], "recovery clears it");
  await h.handleMessage({ type: "serviceStatusRequest", mount: true });
  assert.deepEqual(statuses(), [false, true, false, false], "a remounted panel is told again");
  await Promise.all([h.refreshServiceStatus(), h.refreshServiceStatus()]);
  assert.equal(asked.length, 5, "concurrent asks share one request");
  ok("host: busy, dedupe, recovery, remount, shared request");

  const anon = make(undefined);
  anon.state.busy = true;
  await anon.h.handleMessage({ type: "serviceStatusRequest", mount: true });
  assert.equal(anon.asked.length, 0, "no token: the Service is not asked");
  assert.deepEqual(anon.statuses(), [false], "no token: no banner");
  ok("host: a seat without a token asks nothing and shows nothing");
}

console.log(`service-status: ${passed} checks passed`);
