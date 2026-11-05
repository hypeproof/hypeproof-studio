// REQ-N11 (2026-11-05) — the extension-owned copy of the last served link safety. A minor seat's
// allowlist block holds while the profile loads, refetches or the token has expired; the copy lives
// in globalState (not settings.json), belongs to one seat, and is removed on sign-out or a seat change.
// Pure helpers first, then the real ChatPanelProvider bundled with a scripted `vscode`: a real
// ensureProfile over a fake /v1/profile saves the copy, and the real link route uses it.
//   node --experimental-strip-types test/saved-link-safety-host.smoke.mjs
import assert from "node:assert/strict";
import { build } from "esbuild";
import vm from "node:vm";
import { createRequire } from "node:module";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";

const {
  SAVED_LINK_SAFETY_KEY, learnerLinkPolicy, linkSeatKey, routeExternalLink, savedLinkSafetyFor, savedLinkSafetyFrom, savedLinkSafetyStale,
} = await import("../src/browserSafetyHelpers.ts");

const tok = (payload) => Buffer.from(JSON.stringify(payload)).toString("base64url") + ".sig";
const kidToken = tok({ c: "kids-class", u: "learner-1" });
const kidRenewed = tok({ c: "kids-class", u: "learner-1", exp: 9 });
const otherToken = tok({ c: "adult-class", u: "learner-2" });
const kidProfile = { minor_cohort: true, browser_session: { mode: "safe", allowlist: ["https://hypeproof-ai.xyz/live/x/gallery", 42, ""] } };
const adultProfile = { minor_cohort: false, browser_session: { mode: "browse" } };

// ---- Pure: seat keys ----
assert.equal(linkSeatKey(null), null);
assert.equal(linkSeatKey(""), null);
assert.match(linkSeatKey(kidToken), /^[0-9a-f]{32}$/);
assert.equal(linkSeatKey(kidToken), linkSeatKey(kidRenewed), "a renewed token for the same class keeps the copy");
assert.notEqual(linkSeatKey(kidToken), linkSeatKey(otherToken), "another class is another seat");
assert.notEqual(linkSeatKey("opaque-a"), linkSeatKey("opaque-b"), "a token without a cohort keys on the credential");
assert.ok(!linkSeatKey(kidToken).includes("kids"), "one-way: the key never carries the cohort id");

// ---- Pure: what is saved and when it applies ----
const seat = linkSeatKey(kidToken);
const saved = savedLinkSafetyFrom(kidProfile, seat, 1000);
assert.deepEqual(saved, { v: 1, seat, minor: true, safeSession: true, allowlist: ["https://hypeproof-ai.xyz/live/x/gallery"], savedAt: 1000 }, "strings only");
assert.deepEqual(savedLinkSafetyFrom(adultProfile, seat, 1), { v: 1, seat, minor: false, safeSession: false, allowlist: [], savedAt: 1 });
assert.deepEqual(savedLinkSafetyFor(saved, seat), saved);
// Negative controls: another seat, no seat, malformed copies are "no copy".
assert.equal(savedLinkSafetyFor(saved, linkSeatKey(otherToken)), null);
assert.equal(savedLinkSafetyFor(saved, null), null);
for (const bad of [undefined, null, "x", 1, [], { ...saved, v: 2 }, { ...saved, minor: "yes" }, { ...saved, safeSession: 1 }, { ...saved, allowlist: "example.org" }]) {
  assert.equal(savedLinkSafetyFor(bad, seat), null, JSON.stringify(bad));
}
assert.equal(savedLinkSafetyStale(undefined, null), false, "nothing saved: nothing to remove");
assert.equal(savedLinkSafetyStale(saved, seat), false);
assert.equal(savedLinkSafetyStale(saved, null), true, "sign-out removes it");
assert.equal(savedLinkSafetyStale(saved, linkSeatKey(otherToken)), true, "a seat change removes it");

// ---- Pure: the click policy ----
const policy = (o) => learnerLinkPolicy({ profile: null, saved: null, persistedSafeSession: undefined, persistedAllowlist: undefined, setting: undefined, ...o });
const route = (o, url) => { const { safety, enforceAllowlist } = policy(o); return routeExternalLink(url, safety, { enforceAllowlist }).kind; };
// Loading / refetch / expiry with this seat's copy: the minor block holds.
assert.equal(route({ saved }, "https://news.example.com/story"), "blocked", "copy: outside the list is blocked");
assert.equal(route({ saved }, "https://hypeproof-ai.xyz/live/x/gallery/abc"), "integrated", "copy: the class gallery opens");
assert.equal(route({ saved }, "http://127.0.0.1:5500/"), "integrated", "copy: the learner's own preview opens");
// The copy outranks the settings a failed fetch or a learner can change.
assert.equal(route({ saved, persistedSafeSession: false, persistedAllowlist: [] }, "https://news.example.com/story"), "blocked");
// The support override still wins.
assert.equal(route({ saved, setting: false }, "https://news.example.com/story"), "integrated");
// A loaded profile wins over the copy in both directions.
assert.equal(route({ saved, profile: adultProfile }, "https://news.example.com/story"), "confirm");
assert.equal(route({ saved: savedLinkSafetyFrom(adultProfile, seat, 1), profile: kidProfile }, "https://news.example.com/story"), "blocked");
// An adult copy keeps the adult path; a minor copy with an empty list keeps the integrated route (not block-all).
assert.equal(route({ saved: savedLinkSafetyFrom(adultProfile, seat, 1) }, "https://news.example.com/story"), "confirm");
assert.equal(route({ saved: savedLinkSafetyFrom({ minor_cohort: true, browser_session: { mode: "safe", allowlist: [] } }, seat, 1) }, "https://news.example.com/story"), "integrated");
// No copy: unchanged from before this row (negative control for the gap it closes).
assert.equal(route({}, "https://news.example.com/story"), "integrated", "no copy, nothing persisted: integrated, not blocked");
assert.equal(route({ persistedSafeSession: true, persistedAllowlist: ["example.org"] }, "https://news.example.com/story"), "blocked");
console.log("PASS saved link safety: seat keys, copies, stale removal, click policy");

// ---- Real provider ----
const require = createRequire(import.meta.url);
const bundle = await build({ entryPoints: [new URL("../src/chatPanelProvider.ts", import.meta.url).pathname], bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false, logLevel: "silent" });
const settings = { "hypeproof.browser": {}, hypeproofChat: {} };
const updates = [];
const posted = [], opened = [];
const vscode = {
  env: { appName: "HypeProof Studio", openExternal: async (u) => opened.push(["system", String(u)]) , clipboard: { writeText: async () => {} } },
  Uri: { parse: (s) => s },
  ViewColumn: { Beside: -2 },
  ConfigurationTarget: { Global: 1 },
  commands: { executeCommand: async () => undefined },
  window: {
    openBrowserTab: async (url) => opened.push(["integrated", url]),
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
  },
  workspace: {
    getConfiguration: (section) => ({
      get: (key, fallback) => (settings[section]?.[key] ?? fallback),
      update: async (key, value) => { updates.push([section, key, value]); settings[section][key] = value; },
    }),
  },
};
let profileReply = () => new Response("{}", { status: 503 });
const mod = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, {
  module: mod, exports: mod.exports, require: (id) => (id === "vscode" ? vscode : require(id)), console, Buffer, process, setTimeout, clearTimeout,
  setInterval, clearInterval, AbortController, AbortSignal, URL, TextEncoder, TextDecoder, crypto: webcrypto, Response,
  fetch: async (url) => { assert.match(String(url), /\/profile$/); return profileReply(); },
});
const proto = mod.exports.ChatPanelProvider.prototype;
const state = new Map();
let token = kidToken;
function host() {
  const h = Object.create(proto);
  const fields = {
    context: {
      secrets: { get: async () => token },
      globalState: { get: (k, d) => (state.has(k) ? state.get(k) : d), update: async (k, v) => { if (v === undefined) state.delete(k); else state.set(k, v); } },
      workspaceState: { get: () => undefined },
    },
    cachedProfile: null, profileFetchPromise: null, profileGeneration: 0, lastProfileFailure: null, servedWorkspaceRoot: null,
    funnel: { active: false, setTarget() {} }, preview: { setLabels() {} },
    post: async (m) => { posted.push(m); },
    refreshSitePublishContext() {}, clearElementContext() {}, refreshCrBytesContext: async () => {}, startLiveness() {}, stopLiveness() {},
    refreshFunnelTarget: async () => {}, migrateLegacyStateForActiveCohort: async () => {},
  };
  for (const [key, value] of Object.entries(fields)) Object.defineProperty(h, key, { value, writable: true, configurable: true });
  return h;
}
const NEWS = "https://news.example.com/story";
const GALLERY = "https://hypeproof-ai.xyz/live/x/gallery/abc";
const minimalProfile = (extra) => ({ ux: { coach: {} }, ...extra });

// 1. A served minor profile is saved, for this seat, in extension-owned state.
{
  const h = host();
  profileReply = () => Response.json(minimalProfile(kidProfile));
  const p = await h.ensureProfile();
  assert.equal(p?.minor_cohort, true);
  const copy = state.get(SAVED_LINK_SAFETY_KEY);
  assert.equal(copy?.seat, seat);
  assert.deepEqual([copy.minor, copy.safeSession, copy.allowlist], [true, true, ["https://hypeproof-ai.xyz/live/x/gallery"]]);
  assert.ok(!JSON.stringify(copy).includes(kidToken), "the credential is never stored");
}

// 2. Profile gone (refetch / token expiry): the fetch fails, nothing is cached, and the minor block holds.
{
  const h = host();
  profileReply = () => new Response(JSON.stringify({ error: "token_expired" }), { status: 401 });
  updates.length = 0;
  assert.equal(await h.ensureProfile(), null);
  assert.deepEqual(updates, [], "a failed fetch writes no hypeproof.browser setting (it used to write safeSession=false)");
  posted.length = 0; opened.length = 0;
  await h.openLearnerLink(NEWS);
  assert.deepEqual(opened, [], "outside the saved list: nothing opens");
  assert.deepEqual(posted.map((m) => [m.type, m.host]), [["externalLinkBlocked", "news.example.com"]]);
  await h.openLearnerLink(GALLERY);
  assert.deepEqual(opened, [["integrated", GALLERY]], "inside the saved list: the integrated browser");
  // Even when the persisted settings say "adult" (an older build wrote that on a failed fetch).
  settings["hypeproof.browser"] = { safeSession: false, safeAllowlist: [] };
  assert.equal((await h.learnerLinkRoute(NEWS)).kind, "blocked");
  // Chalk's contract op agrees.
  assert.equal(JSON.stringify(await h.chalkOps().openExternal(NEWS)), JSON.stringify({ ok: false, reason: "blocked" }));
  settings["hypeproof.browser"] = {};
}

// 3. The support override still turns the block off.
{
  const h = host();
  settings.hypeproofChat = { safeLinkAllowlistEnabled: false };
  assert.equal((await h.learnerLinkRoute(NEWS)).kind, "integrated");
  settings.hypeproofChat = {};
}

// 4. Seat change: another seat's token never uses the copy, and reconciling removes it.
{
  const h = host();
  token = otherToken;
  assert.equal((await h.learnerLinkRoute(NEWS)).kind, "integrated", "another seat: no copy (fail closed to the integrated browser, as before)");
  await h.reconcileSavedLinkSafety();
  assert.equal(state.has(SAVED_LINK_SAFETY_KEY), false, "seat change removes the copy");
}

// 5. Sign-out removes the copy.
{
  token = kidToken;
  state.set(SAVED_LINK_SAFETY_KEY, saved);
  const h = host();
  await h.reconcileSavedLinkSafety();
  assert.equal(state.has(SAVED_LINK_SAFETY_KEY), true, "same seat keeps it");
  token = undefined;
  await h.reconcileSavedLinkSafety();
  assert.equal(state.has(SAVED_LINK_SAFETY_KEY), false, "sign-out removes it");
}

// 6. An adult profile replaces a minor copy (one install, several seats over time).
{
  token = kidToken;
  state.set(SAVED_LINK_SAFETY_KEY, saved);
  const h = host();
  profileReply = () => Response.json(minimalProfile(adultProfile));
  await h.ensureProfile();
  assert.equal(state.get(SAVED_LINK_SAFETY_KEY)?.minor, false);
}
console.log("PASS saved link safety host: real ensureProfile saves the copy; refetch/expiry keeps the block; override, seat change and sign-out");

// Wiring: sign-out and token changes reconcile; the copy is written only from a served profile.
const src = readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
assert.match(src, /invalidateProfile\(\): void \{[\s\S]{0,1200}void this\.reconcileSavedLinkSafety\(\);/, "invalidateProfile reconciles");
assert.match(src, /if \(e\.key === TOKEN_KEY\) \{[^\n]*void this\.reconcileSavedLinkSafety\(\); \}/, "a token change reconciles");
assert.equal((src.match(/rememberLinkSafety\(p, token\)/g) ?? []).length, 2, "saved from the served profile (fetch and lesson adoption) only");
console.log("PASS saved link safety wiring");
