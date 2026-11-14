// CGP-AGENT-R-031 (REQ-CGP-AGENT-66): Studio asks the Service whether it is busy and tells the panel.
//
// 1 is pure (serviceStatus.ts): the URL, the parse (only an explicit `busy: true` is busy), and the
//   fetch: no token means no request, and an error, a timeout, a 401 or a 404 reads as not busy
//   (positive and negative controls for the parse and the fail-quiet rule).
// 2 runs the real ChatPanelProvider.handleMessage against a fake VS Code: a busy answer posts
//   `serviceStatus: true`, an unchanged answer is not re-posted, recovery posts `false`, a remount
//   re-posts, asks closer than a minute do not go out, errors back off (capped) and recover, a
//   404 stops asking for that seat until its token changes while 401/403 back off and are asked again
//   (a 403 session_inactive clears when the class opens), a seat without a token asks nothing, and the
//   request carries the seat token only.
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
  const keepAlive = setInterval(() => {}, 1000); // AbortSignal.timeout does not hold the process open
  assert.equal(await S.fetchServiceBusy(hung, { proxyUrl: "https://s/v1", token: "t", timeoutMs: 50 }), false, "a hung request times out as not busy");
  assert.ok(Date.now() - t0 < 2000, "the timeout ends the wait");
  clearInterval(keepAlive);
  for (const [code, outcome] of [[401, "error"], [403, "error"], [404, "unserved"], [500, "error"], [503, "error"]]) {
    assert.equal((await S.askServiceStatus(rec(code, {}), { proxyUrl: "https://s/v1", token: "t" })).outcome, outcome, `${code} is ${outcome}`);
  }
  assert.equal(S.nextServiceStatusAt(0, "unserved", 0), Infinity);
  assert.equal(S.nextServiceStatusAt(0, "error", 0), S.SERVICE_STATUS_POLL_MS);
  assert.equal(S.nextServiceStatusAt(0, "error", 3), S.SERVICE_STATUS_POLL_MS * 8);
  assert.equal(S.nextServiceStatusAt(0, "error", 30), S.SERVICE_STATUS_MAX_BACKOFF_MS);
  assert.ok(S.nextServiceStatusAt(0, "ok", 5) < S.SERVICE_STATUS_POLL_MS, "a good answer allows the next minute's ask");
  ok("pure: fetch is fail-quiet and sends only the seat token; outcomes and backoff");
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
  const posts = (h) => h.__posts;
  const make = (token) => {
    const h = Object.create(ChatPanelProvider.prototype);
    const posts = [], asked = [];
    const state = { busy: false, status: 200, now: 1_000_000 };
    Object.assign(h, {
      context: { globalState: { get: () => undefined, update: async () => {} }, workspaceState: { get: () => undefined, update: async () => {} }, secrets: { get: async () => token } },
      post: async (m) => { posts.push(J(m)); return true; },
    });
    h.__posts = posts;
    h.serviceStatusNow = () => state.now;
    h.serviceStatusFetch = async (url, init) => { asked.push({ url, auth: init.headers.authorization, at: state.now }); if (state.status === 0) throw new TypeError("fetch failed"); return { ok: state.status === 200, status: state.status, json: async () => ({ busy: state.busy }) }; };
    const statuses = () => posts.filter((m) => m.type === "serviceStatus").map((m) => m.busy);
    const tick = async (ms = S.SERVICE_STATUS_POLL_MS) => { state.now += ms; await h.handleMessage({ type: "serviceStatusRequest" }); };
    return { h, state, statuses, asked, tick };
  };

  {
    const { h, state, statuses, asked, tick } = make("seat-tok");
    await h.handleMessage({ type: "serviceStatusRequest", mount: true });
    assert.deepEqual(statuses(), [false], "mount posts the calm state");
    assert.equal(asked[0].url, "https://api.hypeproof-ai.xyz/v1/service-status");
    assert.equal(asked[0].auth, "Bearer seat-tok");
    state.busy = true;
    await tick();
    assert.deepEqual(statuses(), [false, true], "busy is posted");
    await tick();
    assert.deepEqual(statuses(), [false, true], "an unchanged answer is not re-posted");
    state.busy = false;
    await tick();
    assert.deepEqual(statuses(), [false, true, false], "recovery clears it");
    const before = asked.length;
    await tick(5_000); await tick(5_000);
    assert.equal(asked.length, before, "asks closer than a minute apart (focus, back in view) do not reach the Service");
    const beforeRemount = asked.length;
    await h.handleMessage({ type: "serviceStatusRequest", mount: true });
    assert.deepEqual(statuses(), [false, true, false, false], "a remounted panel is told again");
    assert.equal(asked.length, beforeRemount, "a remount inside the interval re-posts the last answer without a Service request");
    state.now += S.SERVICE_STATUS_POLL_MS;
    await Promise.all([h.refreshServiceStatus(), h.refreshServiceStatus()]);
    assert.equal(asked.length, before + 1, "concurrent asks share one request");
    ok("host: busy, dedupe, recovery, minimum interval, remount, shared request");
  }
  {
    const { h, state, asked, tick } = make("seat-tok");
    state.status = 0;
    await h.handleMessage({ type: "serviceStatusRequest", mount: true });
    const gaps = [];
    for (let i = 0; i < 40; i++) { const n = asked.length; await tick(); if (asked.length > n) gaps.push(asked.at(-1).at); }
    const waits = gaps.map((t, i) => t - (i ? gaps[i - 1] : asked[0].at));
    assert.ok(waits.length >= 3, `errors still retry (${waits.length})`);
    for (let i = 1; i < waits.length; i++) assert.ok(waits[i] >= waits[i - 1], `the wait grows after each error: ${waits}`);
    assert.ok(Math.max(...waits) <= S.SERVICE_STATUS_MAX_BACKOFF_MS + S.SERVICE_STATUS_POLL_MS, `capped: ${waits}`);
    assert.ok(waits.at(-1) > S.SERVICE_STATUS_POLL_MS * 4, `backed off: ${waits}`);
    state.status = 200;
    const n = asked.length;
    for (let i = 0; i < 20 && asked.length === n; i++) await tick();
    const m = asked.length;
    await tick(); await tick();
    assert.equal(asked.length, m + 2, "a good answer returns to once a minute");
    ok("host: errors back off, capped, and recover to the normal minute");
  }
  {
    const { h, state, asked, statuses, tick } = make("seat-tok");
    state.status = 404;
    state.busy = true;
    await h.handleMessage({ type: "serviceStatusRequest", mount: true });
    for (let i = 0; i < 30; i++) await tick();
    assert.equal(asked.length, 1, "404: a Service without the route is not asked again");
    assert.deepEqual(statuses(), [false], "404: and shows nothing");
    await h.handleMessage({ type: "serviceStatusRequest", mount: true });
    assert.equal(asked.length, 1, "404: a remount does not ask again (a task switch adds no Service request)");
    h.context.secrets.get = async () => "new-seat-tok";
    state.status = 200; state.busy = false;
    await tick();
    assert.equal(asked.length, 2, "404: a new token is asked once");
    assert.equal(asked.at(-1).auth, "Bearer new-seat-tok");
  }
  for (const code of [401, 403]) {
    // A 403 session_inactive (or a 401) is not a verdict on the seat: the class opens later with the same token.
    const { h, state, asked, statuses, tick } = make("seat-tok");
    state.status = code;
    await h.handleMessage({ type: "serviceStatusRequest", mount: true });
    for (let i = 0; i < 3; i++) await tick();
    const refused = asked.length;
    assert.ok(refused >= 2, `${code}: asked again after backoff (${refused})`);
    state.status = 200; state.busy = true;   // the session opens; same token
    for (let i = 0; i < 40 && statuses().at(-1) !== true; i++) await tick();
    assert.equal(statuses().at(-1), true, `${code}: a later ask with the same token succeeds and shows busy`);
    assert.ok(asked.every((a) => a.auth === "Bearer seat-tok"), `${code}: the same token throughout`);
  }
  ok("host: 404 stops asking for that seat until its token changes; 401/403 back off and are asked again");
  {
    // Instructor and issuer seats: the route answers 401 to an issuer token every time, so they are never asked.
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    for (const token of [b64({ role: "issuer", u: "t1" }) + ".sig", b64({ u: "t1", c: "__issuer__", p: "__issuer__" }) + ".sig"]) {
      const x = make(token); x.state.busy = true;
      await x.h.handleMessage({ type: "serviceStatusRequest", mount: true });
      for (let i = 0; i < 5; i++) await x.tick();
      assert.equal(x.asked.length, 0, "issuer token: the Service is not asked");
      assert.deepEqual(x.statuses(), [false], "issuer token: no banner, posted once");
    }
    const inst = make("seat-tok"); inst.state.busy = true; inst.h._instructorMode = { isInstructor: true };
    await inst.h.handleMessage({ type: "serviceStatusRequest", mount: true });
    for (let i = 0; i < 5; i++) await inst.tick();
    assert.equal(inst.asked.length, 0, "instructor mode: the Service is not asked");
    // Control: the same token on a participant seat is asked.
    inst.h._instructorMode = { isInstructor: false };
    await inst.tick();
    assert.equal(inst.asked.length, 1, "control: a participant seat with the same token is asked");
    ok("host: instructor and issuer seats never ask the route (control: a participant seat does)");
  }
  {
    // Dismissal is kept by the host for the busy episode: a remount re-posts it closed; the next episode shows it again.
    const { h, state, asked, tick } = make("seat-tok");
    const shown = () => posts(h).filter((m) => m.type === "serviceStatus").map((m) => [m.busy, m.dismissed === true]);
    state.busy = true;
    await h.handleMessage({ type: "serviceStatusRequest", mount: true });
    assert.deepEqual(shown().at(-1), [true, false], "busy shows the banner");
    await h.handleMessage({ type: "serviceStatusDismiss" });
    assert.deepEqual(shown().at(-1), [true, true], "closing it is posted back as dismissed");
    const n = asked.length;
    await h.handleMessage({ type: "serviceStatusRequest", mount: true });
    assert.deepEqual(shown().at(-1), [true, true], "a remount (task switch) re-posts it closed");
    assert.equal(asked.length, n, "the remount adds no Service request");
    const p = shown().length; await tick(); await tick();
    assert.equal(shown().length, p, "still busy: it stays closed and nothing is re-posted");
    await h.handleMessage({ type: "serviceStatusRequest", mount: true });
    assert.deepEqual(shown().at(-1), [true, true], "a second remount: still closed");
    state.busy = false; await tick();
    assert.deepEqual(shown().at(-1), [false, false], "the episode ends when the Service reads not busy");
    state.busy = true; await tick();
    assert.deepEqual(shown().at(-1), [true, false], "the next busy episode shows the banner again");
    const before = shown().length;
    state.busy = false; await tick();
    await h.handleMessage({ type: "serviceStatusDismiss" });
    assert.equal(shown().length, before + 1, "closing while not busy changes nothing");
    ok("host: dismissal survives remounts for the busy episode and ends when the Service reads not busy");
  }
  {
    // A transient error mid-episode is not the end of the episode: the closed banner stays closed when busy is seen again.
    for (const code of [0, 500, 401, 403]) {
      const { h, state, tick } = make("seat-tok");
      const shown = () => posts(h).filter((m) => m.type === "serviceStatus").map((m) => [m.busy, m.dismissed === true]);
      state.busy = true;
      await h.handleMessage({ type: "serviceStatusRequest", mount: true });
      await h.handleMessage({ type: "serviceStatusDismiss" });
      assert.deepEqual(shown().at(-1), [true, true], `${code}: closed`);
      state.status = code; await tick();
      assert.deepEqual(shown().at(-1), [false, false], `${code}: the error reads as not busy (fail quiet)`);
      state.status = 200; state.busy = true;
      for (let i = 0; i < 40 && shown().at(-1)[0] !== true; i++) await tick();
      assert.deepEqual(shown().at(-1), [true, true], `${code}: busy again after the error: still closed for this episode`);
    }
    // Control: a confirmed healthy answer does end it, so the next busy shows the banner.
    const { h, state, tick } = make("seat-tok");
    const shown = () => posts(h).filter((m) => m.type === "serviceStatus").map((m) => [m.busy, m.dismissed === true]);
    state.busy = true; await h.handleMessage({ type: "serviceStatusRequest", mount: true }); await h.handleMessage({ type: "serviceStatusDismiss" });
    state.busy = false; await tick(); state.busy = true; await tick();
    assert.deepEqual(shown().at(-1), [true, false], "control: after a healthy answer the next busy shows the banner");
    ok("host: an error mid-episode keeps the dismissal; only a healthy answer ends the episode");
  }
  {
    const anon = make(undefined);
    anon.state.busy = true;
    await anon.h.handleMessage({ type: "serviceStatusRequest", mount: true });
    await anon.tick();
    assert.equal(anon.asked.length, 0, "no token: the Service is not asked");
    assert.deepEqual(anon.statuses(), [false], "no token: no banner");
    ok("host: a seat without a token asks nothing and shows nothing");
  }
}

console.log(`service-status: ${passed} checks passed`);
