// CGP-ART-R-011 — the real ChatPanelProvider publish handler, with only VS Code I/O and the network replaced.
// Locks what the unit tests cannot: the switch is checked first for every message, copy writes the host-read
// URL to the clipboard, the read gate sits on the provider's post path (a late read cannot reopen a closed panel),
// and a failed or malformed Service read is marked unknown and stale, never "공개하지 못했어요" and never an
// old "live" label without a stale marker.
import { build } from "esbuild";
import vm from "node:vm";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";

const require = createRequire(import.meta.url);
const here = fileURLToPath(new URL("..", import.meta.url));
const bundle = await build({
  stdin: { contents: "export { ChatPanelProvider } from './src/chatPanelProvider'; export { PublishSession } from './src/publishSession'; export { PublishReadGate } from './src/publishReadGate';", resolveDir: here, loader: "ts" },
  bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false, logLevel: "silent",
});
const clipboard = [];
const vscode = {
  workspace: { workspaceFolders: [], getConfiguration: () => ({ get: (_k, fallback) => fallback }) },
  Uri: { file: (p) => ({ fsPath: p }) },
  env: { clipboard: { writeText: async (t) => { clipboard.push(t); } } },
  window: { createOutputChannel: () => ({ appendLine: () => {} }) },
};
const module = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: (id) => (id === "vscode" ? vscode : require(id)), console, Buffer, process, setTimeout, clearTimeout, setInterval, clearInterval, AbortSignal, AbortController, URL, TextEncoder, TextDecoder, Response, Request, Headers, crypto: webcrypto });
const { ChatPanelProvider, PublishSession, PublishReadGate } = module.exports;

const now = 1800000000000;
const link = (id, extra = {}) => ({ id, experiment_id: "e1", channel: null, state: "live", expires_at: now + 3600000, share_url: `https://test.invalid/l/${id}/`, ...extra });
const goodState = () => ({ project: { id: "p", title: "page", members: ["a"] }, test_origin: "https://test.invalid", versions: [], hypotheses: [], links: [link("a")], experiments: [{ id: "e1", week: 1, question: "q", method: "task_test", success_criteria: [], hypothesis_id: null, product_version_id: "v1", status: "running" }] });
let mode = "ok", gate = null, fetches = 0, enabled = true, scope = "s1", state = goodState();
const fetchImpl = async () => {
  fetches++;
  if (gate) await gate;
  if (mode === "503") return new Response(JSON.stringify({ error: "down" }), { status: 503 });
  if (mode === "empty") return new Response("{}", { status: 200 });
  if (mode === "html") return new Response("<html>bad gateway</html>", { status: 200 });
  return new Response(JSON.stringify(state), { status: 200 });
};
const session = new PublishSession({ switchOn: () => enabled, token: async () => "tok", scopeKey: () => scope, base: () => "https://api.test/v1/curriculum", root: () => null, entry: () => null, events: async () => [], projectId: () => "p", setProjectId: async () => {}, week: () => 1, defaultTitle: () => "page", qr: (u) => u, now: () => now, fetchImpl });

let posted = [], denials = 0;
const h = Object.create(ChatPanelProvider.prototype);
Object.assign(h, {
  publishSession: session, publishReadGate: new PublishReadGate(), lastGoodPublish: null,
  isCurriculumRuntimeEnabled: () => enabled, getSeatAudience: () => "personal",
  postDenialNotice: async () => { denials++; },
  post: async (m) => { posted.push(m); return true; },
});
const states = () => posted.filter((m) => m.type === "publishState");
const reset = () => { posted = []; clipboard.length = 0; fetches = 0; denials = 0; mode = "ok"; gate = null; enabled = true; scope = "s1"; state = goodState(); h.publishReadGate = new PublishReadGate(); h.lastGoodPublish = null; };
let n = 0; const ok = (l) => { n++; console.log("  ok   " + l); };

// H1 the served switch is the first step for every message type; nothing reaches the Service
for (const msg of [{ type: "publishOpen" }, { type: "publishRefresh" }, { type: "publishClose" }, { type: "publishCopy", versionId: "v1" }, { type: "publishSubmit", form: {} }, { type: "publishLink", experimentId: "e1" }, { type: "publishRevoke", linkId: "a" }]) {
  reset(); enabled = false;
  await h.handlePublishMessage(msg);
  assert.equal(fetches, 0, `${msg.type}: no Service call with the switch off`);
  assert.equal(denials, 1, `${msg.type}: the denial notice`);
  assert.equal(states().length, 1); assert.equal(states()[0].view, null, `${msg.type}: the panel is hidden`);
  assert.deepEqual(clipboard, []);
}
ok("H1 switch off: every publish message is refused first, nothing is read or copied");

// H2 copy: the host re-reads and writes the URL it read, never one from the webview
reset();
await h.handlePublishMessage({ type: "publishOpen" });
assert.equal(states().at(-1).view.available, true);
await h.handlePublishMessage({ type: "publishCopy", versionId: "v1", url: "https://evil.invalid/" });
assert.deepEqual(clipboard, ["https://test.invalid/l/a/"], "the clipboard gets the live link of that version");
state.links[0].state = "revoked"; clipboard.length = 0;
await h.handlePublishMessage({ type: "publishCopy", versionId: "v1" });
assert.deepEqual(clipboard, [], "a link revoked in another window is not copied");
assert.ok(states().at(-1).error, "and the learner is told");
ok("H2 publishCopy writes the host-read URL to the clipboard and refuses a revoked link");

// H3 the read gate is on the provider's post path
reset();
await h.handlePublishMessage({ type: "publishOpen" });
posted = [];
let release; gate = new Promise((r) => { release = r; });
const slow = h.handlePublishMessage({ type: "publishRefresh" });
await h.handlePublishMessage({ type: "publishClose" });
release(); await slow; gate = null;
assert.equal(states().length, 0, "a read that finishes after close does not reopen the panel");
await h.handlePublishMessage({ type: "publishRefresh" });
assert.equal(states().length, 0, "a refresh on a closed panel reads nothing new");
await h.handlePublishMessage({ type: "publishOpen" });
posted = [];
gate = new Promise((r) => { release = r; });
const late = h.handlePublishMessage({ type: "publishRefresh" });
const action = h.handlePublishMessage({ type: "publishCopy", versionId: "v1" });
release(); await Promise.all([late, action]); gate = null;
assert.equal(states().length, 1, "an action started during a background read wins; the older read is dropped");
ok("H3 close and actions go through the read gate; a late read is dropped");

// H4 a failed read keeps the last good rows, marked stale with their time and read-specific copy
for (const bad of ["503", "empty", "html"]) {
  reset();
  const before = Date.now();
  await h.handlePublishMessage({ type: "publishOpen" });
  assert.match(states().at(-1).view.experiments[0].links[0].state, /live/);
  mode = bad; posted = [];
  await h.handlePublishMessage({ type: "publishRefresh" });
  const v = states().at(-1).view;
  assert.equal(v.read_failed, true, `${bad}: marked`);
  assert.ok(v.stale_at >= before && v.stale_at <= Date.now(), `${bad}: time of the last good read`);
  assert.equal(v.experiments.length, 1, `${bad}: last known rows kept`);
  assert.match(v.reason, /^공유 상태를 확인하지 못했어요/);
  assert.doesNotMatch(JSON.stringify(v), /공개하지 못했어요/, `${bad}: never a failed-publish message`);
  mode = "ok"; posted = [];
  await h.handlePublishMessage({ type: "publishRefresh" });
  assert.equal(states().at(-1).view.read_failed, undefined, `${bad}: the next good read clears the marker`);
}
ok("H4 503, {} and an HTML 200: last rows kept, read_failed + stale_at, no failed-publish copy, recovery clears it");

// H5 no earlier read, or another scope: unknown, with no rows borrowed
reset(); mode = "503";
await h.handlePublishMessage({ type: "publishOpen" });
let v = states().at(-1).view;
assert.equal(v.available, false); assert.equal(v.read_failed, true); assert.equal(v.stale_at, undefined); assert.equal(v.experiments.length, 0);
reset();
await h.handlePublishMessage({ type: "publishOpen" });
scope = "s2"; mode = "503"; posted = [];
await h.handlePublishMessage({ type: "publishRefresh" });
v = states().at(-1).view;
assert.equal(v.read_failed, true); assert.equal(v.experiments.length, 0, "another account/folder never sees the previous rows");
ok("H5 first read failing, or a scope change, shows unknown without borrowed rows");

// H6 PublishSession.view never throws on a malformed 200
for (const body of ["{}", "<html>", "null", JSON.stringify({ project: {} }), JSON.stringify({ project: { id: "p" }, experiments: {}, links: [], hypotheses: [] }), JSON.stringify({ ...goodState(), experiments: [null] })]) {
  reset();
  const s2 = new PublishSession({ switchOn: () => true, token: async () => "tok", scopeKey: () => "s", base: () => "https://api.test/v1/curriculum", root: () => null, entry: () => null, events: async () => [], projectId: () => "p", setProjectId: async () => {}, week: () => 1, defaultTitle: () => "page", qr: (u) => u, now: () => now, fetchImpl: async () => new Response(body, { status: 200 }) });
  const view = await s2.view();
  assert.equal(view.available, false, body); assert.equal(view.read_failed, true, body);
}
ok("H6 view() treats a malformed 200 as an unreadable state, never a throw");
console.log(`PASS publish sharing host: ${n} groups`);
