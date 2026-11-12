// REQ-N11 (Jay 2026-11-07) — the three hardened-session settings are locked for a minor or safe seat.
// `hypeproof.browser.hardenedSessionEnabled`, `.safeSession` and `.safeAllowlist` come from the served profile:
// 1. Extension: a served minor/safe profile saves a lock in the extension's globalState; a learner's edit that
//    loosens a setting is put back (on every configuration change and at startup); a stricter edit stays;
//    an adult profile removes the lock and adult settings are left alone; sign-out keeps the lock.
// 2. Core patch (hps-safe-session.patch): the workbench computes the value it pushes to the main process from
//    that same lock, so settings.json saying "off" (edited while running, before the extension activates, in
//    another VS Code profile, or with the extension disabled) does not turn the hardened session off or widen
//    the list. The patched functions are compiled from the patched file and run against stand-ins.
//   node --experimental-strip-types test/browser-settings-lock.smoke.mjs
import assert from "node:assert/strict";
import { build } from "esbuild";
import vm from "node:vm";
import { createRequire } from "node:module";
import { webcrypto } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const {
  BROWSER_SETTINGS_LOCK_KEY, browserSettingsLockFrom, browserSettingsLockOf, browserSettingsReverts, browserSettingsWritable,
} = await import("../src/browserSafetyHelpers.ts");

const kidProfile = { minor_cohort: true, browser_session: { mode: "safe", allowlist: ["https://hypeproof-ai.xyz/live/x/gallery", 7, ""] } };
const kidHardened = { minor_cohort: true, browser_session: { mode: "safe", allowlist: ["hypeproof-ai.xyz"], hardened: true } };
const minorBrowse = { minor_cohort: true, browser_session: { mode: "browse" } };
const adultProfile = { minor_cohort: false, browser_session: { mode: "browse" } };

// ---- 1a. Pure: which seats are locked, and to what ----
assert.equal(browserSettingsLockFrom(adultProfile, false, 1), null, "adult seat: no lock");
assert.equal(browserSettingsLockFrom({}, false, 1), null, "no browser_session: no lock");
assert.deepEqual(browserSettingsLockFrom(kidProfile, false, 5), { v: 1, hardened: false, safeSession: true, allowlist: ["https://hypeproof-ai.xyz/live/x/gallery"], savedAt: 5 }, "strings only; flag off until served");
assert.equal(browserSettingsLockFrom(kidHardened, false, 1).hardened, true, "served hardened: true turns the flag on");
assert.equal(browserSettingsLockFrom(kidProfile, true, 1).hardened, true, "a registered default of true is kept");
assert.equal(browserSettingsLockFrom({ ...kidProfile, browser_session: { ...kidProfile.browser_session, hardened: "yes" } }, false, 1).hardened, false, "only a boolean true");
assert.deepEqual(browserSettingsLockFrom(minorBrowse, false, 1), { v: 1, hardened: false, safeSession: false, allowlist: [], savedAt: 1 }, "a minor in browse mode is locked to what was served");
assert.deepEqual(browserSettingsLockFrom({ browser_session: { mode: "safe", allowlist: ["a.example"] } }, false, 1)?.safeSession, true, "a safe seat not marked minor is locked too");
for (const bad of [undefined, null, 1, "x", [], { v: 2, hardened: true, safeSession: true, allowlist: [] }, { v: 1, hardened: 1, safeSession: true, allowlist: [] }, { v: 1, hardened: true, safeSession: true, allowlist: "a" }]) {
  assert.equal(browserSettingsLockOf(bad), null, JSON.stringify(bad));
}

// ---- 1b. Pure: what gets put back ----
const lock = browserSettingsLockFrom(kidHardened, false, 1);
const cur = (o) => ({ hardenedSessionEnabled: true, safeSession: true, safeAllowlist: ["hypeproof-ai.xyz"], ...o });
assert.deepEqual(browserSettingsReverts(lock, cur({})), [], "equal values: no write (no loop)");
assert.deepEqual(browserSettingsReverts(lock, cur({ safeSession: false })), [["safeSession", true]]);
assert.deepEqual(browserSettingsReverts(lock, cur({ hardenedSessionEnabled: false })), [["hardenedSessionEnabled", true]]);
assert.deepEqual(browserSettingsReverts(lock, cur({ safeAllowlist: ["hypeproof-ai.xyz", "news.example.com"] })), [["safeAllowlist", ["hypeproof-ai.xyz"]]], "a widened list goes back");
assert.deepEqual(browserSettingsReverts(lock, cur({ safeAllowlist: "news.example.com" })), [["safeAllowlist", ["hypeproof-ai.xyz"]]], "a malformed list goes back");
const offLock = browserSettingsLockFrom(kidProfile, false, 1);
assert.deepEqual(browserSettingsReverts(offLock, { hardenedSessionEnabled: true, safeSession: true, safeAllowlist: offLock.allowlist }), [], "stricter (flag on before rollout) stays");
assert.deepEqual(browserSettingsReverts(null, { hardenedSessionEnabled: false, safeSession: false, safeAllowlist: ["x"] }), [], "adult: nothing");
assert.equal(browserSettingsWritable(undefined, 10), true);
assert.equal(browserSettingsWritable(10_000, 14_999), false, "written under 5 s ago: not again");
assert.equal(browserSettingsWritable(10_000, 15_000), true);
console.log("PASS browser settings lock: pure lock and reverts");

// ---- 1c. The real provider, bundled with a scripted `vscode` ----
const require = createRequire(import.meta.url);
const bundle = await build({ entryPoints: [new URL("../src/chatPanelProvider.ts", import.meta.url).pathname], bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false, logLevel: "silent" });
const DEFAULTS = { hardenedSessionEnabled: false, safeSession: false, safeAllowlist: [] };
let settings = {};
const writes = [];
const vscode = {
  env: { appName: "HypeProof Studio", openExternal: async () => true, clipboard: { writeText: async () => {} } },
  Uri: { parse: (s) => s },
  ViewColumn: { Beside: -2 },
  ConfigurationTarget: { Global: 1 },
  commands: { executeCommand: async () => undefined },
  window: { showInformationMessage: async () => undefined, showWarningMessage: async () => undefined },
  workspace: {
    getConfiguration: (section) => ({
      get: (key, fallback) => (section === "hypeproof.browser" ? (key in settings ? settings[key] : DEFAULTS[key]) : fallback),
      inspect: (key) => (section === "hypeproof.browser" ? { key, defaultValue: DEFAULTS[key], globalValue: settings[key] } : undefined),
      update: async (key, value) => { assert.equal(section, "hypeproof.browser"); writes.push([key, value]); settings[key] = value; },
    }),
  },
};
const tok = (payload) => Buffer.from(JSON.stringify(payload)).toString("base64url") + ".sig";
let token = tok({ c: "kids-class", u: "learner-1" });
let profileReply = () => new Response("{}", { status: 503 });
const mod = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, {
  module: mod, exports: mod.exports, require: (id) => (id === "vscode" ? vscode : require(id)), console, Buffer, process, setTimeout, clearTimeout,
  setInterval, clearInterval, AbortController, AbortSignal, URL, TextEncoder, TextDecoder, crypto: webcrypto, Response,
  fetch: async (url) => { assert.match(String(url), /\/profile$/); return profileReply(); },
});
const proto = mod.exports.ChatPanelProvider.prototype;
const state = new Map();
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
    post: async () => {},
    refreshSitePublishContext() {}, clearElementContext() {}, refreshCrBytesContext: async () => {}, startLiveness() {}, stopLiveness() {},
    refreshFunnelTarget: async () => {}, migrateLegacyStateForActiveCohort: async () => {},
  };
  for (const [key, value] of Object.entries(fields)) Object.defineProperty(h, key, { value, writable: true, configurable: true });
  return h;
}
// Values written inside the vm realm: compare as plain JSON.
const plain = (v) => JSON.parse(JSON.stringify(v));
const minimal = (extra) => ({ ux: { coach: {} }, ...extra });

// A served minor profile with the flag on: lock saved, all three settings asserted.
{
  const h = host();
  profileReply = () => Response.json(minimal(kidHardened));
  await h.ensureProfile();
  assert.deepEqual(plain(browserSettingsLockOf(state.get(BROWSER_SETTINGS_LOCK_KEY))), { v: 1, hardened: true, safeSession: true, allowlist: ["hypeproof-ai.xyz"], savedAt: state.get(BROWSER_SETTINGS_LOCK_KEY).savedAt });
  assert.deepEqual(plain(settings), { safeSession: true, safeAllowlist: ["hypeproof-ai.xyz"], hardenedSessionEnabled: true });
}
// The learner edits settings.json while the app runs (the change event calls this): put back.
{
  const h = host();
  settings = { hardenedSessionEnabled: false, safeSession: false, safeAllowlist: ["hypeproof-ai.xyz", "*"] };
  writes.length = 0;
  await h.reassertBrowserSettings();
  assert.deepEqual(plain(settings), { hardenedSessionEnabled: true, safeSession: true, safeAllowlist: ["hypeproof-ai.xyz"] }, "every loosened value is put back");
  writes.length = 0;
  await h.reassertBrowserSettings();
  assert.deepEqual(plain(writes), [], "already locked: no further write (the change event does not loop)");
}
// Two windows in different VS Code profiles with different locks share one settings file: no ping-pong.
{
  const h = host();
  settings = { hardenedSessionEnabled: true, safeSession: true, safeAllowlist: ["other-window.example"] };
  writes.length = 0;
  await h.reassertBrowserSettings();
  assert.deepEqual(plain(writes), [["safeAllowlist", ["hypeproof-ai.xyz"]]]);
  settings.safeAllowlist = ["other-window.example"]; // the other window wrote its lock's list back
  writes.length = 0;
  await h.reassertBrowserSettings();
  assert.deepEqual(plain(writes), [], "the allowlist is not rewritten within 5 s");
  assert.ok(h.browserSettingsRecheck, "a re-check is scheduled for when the 5 s have passed");
  clearTimeout(h.browserSettingsRecheck); h.browserSettingsRecheck = undefined;
  // The booleans never ping-pong (they only go to true): a second loosening within 5 s is still put back.
  settings.safeSession = false;
  await h.reassertBrowserSettings();
  settings.safeSession = false;
  await h.reassertBrowserSettings();
  assert.equal(settings.safeSession, true, "two safeSession:false saves within 5 s: still put back");
  // After the window the re-check puts the list back.
  h.browserSettingsWrites.set("safeAllowlist", Date.now() - 6000);
  await h.reassertBrowserSettings();
  assert.deepEqual(plain(settings.safeAllowlist), ["hypeproof-ai.xyz"]);
}
// Link fallback after sign-out (lock kept, no saved copy, no profile): the lock, not the settings file, decides.
{
  const h = host();
  const signedIn = token; token = undefined;
  settings = { hardenedSessionEnabled: false, safeSession: false, safeAllowlist: [] };
  h.cachedProfile = null;
  const route = await h.learnerLinkRoute("https://news.example.com/story");
  assert.equal(route.kind, "blocked", "outside the served list: blocked, not the adult dialog");
  assert.equal((await h.learnerLinkRoute("https://hypeproof-ai.xyz/x")).kind, "integrated");
  token = signedIn;
}
// Edited before the extension activated (the startup call): put back from the saved lock, before any profile.
{
  settings = { safeSession: false, safeAllowlist: [] };
  profileReply = () => new Response("{}", { status: 503 });
  const h = host();
  await h.reassertBrowserSettings();
  assert.deepEqual(plain(settings), { safeSession: true, safeAllowlist: ["hypeproof-ai.xyz"], hardenedSessionEnabled: true });
  // A failed profile fetch writes nothing and keeps the lock.
  writes.length = 0;
  assert.equal(await h.ensureProfile(), null);
  assert.deepEqual(plain(writes), []);
  assert.ok(state.has(BROWSER_SETTINGS_LOCK_KEY));
}
// Sign-out keeps the lock (only another seat's served profile replaces it).
{
  token = undefined;
  const h = host();
  await h.reconcileSavedLinkSafety();
  assert.ok(state.has(BROWSER_SETTINGS_LOCK_KEY), "sign-out does not unlock");
  settings.safeSession = false;
  await h.reassertBrowserSettings();
  assert.equal(settings.safeSession, true);
}
// Another seat's adult profile: the lock is removed and the adult's own settings are left alone.
{
  token = tok({ c: "adult-class", u: "learner-2" });
  const h = host();
  profileReply = () => Response.json(minimal(adultProfile));
  await h.ensureProfile();
  assert.equal(state.has(BROWSER_SETTINGS_LOCK_KEY), false, "adult seat: no lock");
  settings = { hardenedSessionEnabled: false, safeSession: false, safeAllowlist: ["anything.example"] };
  writes.length = 0;
  await h.reassertBrowserSettings();
  assert.deepEqual(plain(writes), [], "adult seats are not touched");
}
// A minor seat before rollout (flag not served): a stricter learner choice stays.
{
  token = tok({ c: "kids-class", u: "learner-1" });
  const h = host();
  profileReply = () => Response.json(minimal(kidProfile));
  await h.ensureProfile();
  assert.equal(state.get(BROWSER_SETTINGS_LOCK_KEY)?.hardened, false);
  settings.hardenedSessionEnabled = true;
  writes.length = 0;
  await h.reassertBrowserSettings();
  assert.deepEqual(plain(writes), [], "turning the hardened session on is not reverted");
}
console.log("PASS browser settings lock host: served lock, edits while running and before activation put back, sign-out keeps, adult untouched");

// Wiring: every configuration change under hypeproof.browser, and startup, re-assert.
const src = fs.readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
assert.match(src, /vscode\.workspace\.onDidChangeConfiguration\?\.\(\(e\) => \{ if \(e\.affectsConfiguration\("hypeproof\.browser"\)\) void this\.reassertBrowserSettings\(\); \}\);\n    if \(lockSub\) context\.subscriptions\.push\(lockSub\);\n    void this\.reassertBrowserSettings\(\);/, "on change and at startup");
console.log("PASS browser settings lock wiring");

// ---- 2. Core patch: the workbench pushes the locked value, whatever settings.json says ----
const ts = require("typescript");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const coreDir = path.join(repo, "scripts/patches/core");
const patch = path.join(coreDir, "hps-safe-session.patch");
const MODEL = "src/vs/workbench/contrib/browserView/common/browserView.ts";
const CONTRIB = "src/vs/workbench/contrib/browserView/electron-browser/browserView.contribution.ts";
const ACTIONS = "src/vs/workbench/contrib/browserView/electron-browser/browserViewActions.ts";
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const files = [...fs.readFileSync(patch, "utf8").matchAll(/^diff --git a\/(\S+) /gm)].map((m) => m[1]);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hps-settings-lock-"));
try {
  const tree = path.join(tmp, "vscode");
  for (const rel of files) {
    fs.mkdirSync(path.dirname(path.join(tree, rel)), { recursive: true });
    fs.copyFileSync(path.join(coreDir, "upstream", rel), path.join(tree, rel));
  }
  run("git", ["init", "-q"], tree);
  run("git", ["add", "-A"], tree);
  run("git", ["-c", "user.name=t", "-c", "user.email=t@invalid", "commit", "-qm", "upstream"], tree);
  run("git", ["apply", "--check", "--ignore-whitespace", patch], tree);
  run("git", ["apply", patch], tree);
  const read = (rel) => fs.readFileSync(path.join(tree, rel), "utf8");

  // The Studio block of the patched workbench file (lock key, reader, options), compiled as is.
  const model = read(MODEL);
  const start = model.indexOf("export const HP_CHAT_EXTENSION_ID");
  assert.ok(start > 0, "the patch reads the chat extension's lock");
  const fnStart = model.indexOf("export function hpSafeSessionOptions(");
  const block = model.slice(start, model.indexOf("\n}\n", fnStart) + 3);
  const js = ts.transpileModule(`const StorageScope = { APPLICATION: -1, PROFILE: 0, WORKSPACE: 1 };\n${block}`, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const file = path.join(tmp, "lock.mjs");
  fs.writeFileSync(file, js);
  const wb = await import(pathToFileURL(file).href);
  assert.equal(wb.HP_CHAT_EXTENSION_ID, "hypeproof.hypeproof-chat", "the extension's publisher.name (its globalState key)");
  assert.equal(wb.HP_BROWSER_SETTINGS_LOCK_KEY, BROWSER_SETTINGS_LOCK_KEY, "the same key the extension writes");

  const conf = (o) => ({ getValue: (k) => o[k.replace("hypeproof.browser.", "")] });
  // The extension host stores globalState as one JSON object per extension (ExtensionStorageService).
  const storage = (byScope) => ({ get: (key, scope) => (key === wb.HP_CHAT_EXTENSION_ID ? byScope[scope] : undefined) });
  const memento = (lockValue) => JSON.stringify({ other: 1, [BROWSER_SETTINGS_LOCK_KEY]: lockValue });
  const kidLock = browserSettingsLockFrom(kidHardened, false, 1);
  const loosened = conf({ hardenedSessionEnabled: false, safeSession: false, safeAllowlist: ["news.example.com"] });

  // Negative control: no lock (adult seat, or before any profile) → settings decide as before.
  assert.equal(wb.hpSafeSessionOptions(loosened, storage({})), undefined, "no lock: settings decide");
  assert.deepEqual(wb.hpSafeSessionOptions(conf({ hardenedSessionEnabled: true, safeSession: true, safeAllowlist: ["a.example"] }), storage({})), { allowlist: ["a.example"] });
  // Locked seat, settings.json loosened in every way: still on, with the served list only.
  assert.deepEqual(wb.hpSafeSessionOptions(loosened, storage({ 0: memento(kidLock) })), { allowlist: ["hypeproof-ai.xyz"] }, "profile copy of the lock");
  // A new VS Code profile has no copy of its own: the default profile's (application) copy still locks.
  assert.deepEqual(wb.hpSafeSessionOptions(loosened, storage({ [-1]: memento(kidLock) })), { allowlist: ["hypeproof-ai.xyz"] }, "default profile copy");
  // Before rollout the lock carries hardened:false: settings can only tighten.
  const offLock = browserSettingsLockFrom(kidProfile, false, 1);
  assert.equal(wb.hpSafeSessionOptions(loosened, storage({ 0: memento(offLock) })), undefined, "flag not served: still off");
  assert.deepEqual(wb.hpSafeSessionOptions(conf({ hardenedSessionEnabled: true, safeSession: false, safeAllowlist: ["news.example.com"] }), storage({ 0: memento(offLock) })), { allowlist: ["https://hypeproof-ai.xyz/live/x/gallery"] }, "a tester's flag on: the served list, not the settings list");
  // Malformed lock values or JSON are "no lock" (settings decide), never a crash.
  for (const raw of ["{", memento({ v: 2 }), memento("x"), JSON.stringify(null)]) assert.equal(wb.hpSafeSessionOptions(loosened, storage({ 0: raw })), undefined, raw);

  // The contribution pushes the effective value at startup, on settings changes and on lock changes;
  // the model, the toolbar precondition and the command use the same value.
  const contribution = read(CONTRIB);
  assert.match(contribution, /const push = \(\) => \{ const safe = hpSafeSessionOptions\(configurationService, storageService\); active\.set\(!!safe\); void browserViewService\.setSafeSession\(safe\); \};\n\t\tpush\(\);/, "startup push of the effective value");
  assert.match(contribution, /storageService\.onDidChangeValue\(StorageScope\.PROFILE, HP_CHAT_EXTENSION_ID, this\._store\)\(\(\) => push\(\)\)/, "lock change (profile) pushes");
  assert.match(contribution, /storageService\.onDidChangeValue\(StorageScope\.APPLICATION, HP_CHAT_EXTENSION_ID, this\._store\)\(\(\) => push\(\)\)/, "lock change (default profile) pushes");
  assert.match(model, /const safe = hpSafeSessionOptions\(this\.configurationService, this\.storageService\);/, "new views use the effective value");
  assert.doesNotMatch(model, /const hpSafe = this\.configurationService/, "no settings-only gate left in the model");
  const actions = read(ACTIONS);
  assert.match(actions, /precondition: ContextKeyExpr\.and\(BROWSER_EDITOR_ACTIVE, CONTEXT_BROWSER_HAS_URL, ContextKeyExpr\.not\('hypeproofBrowserSafeSession'\)\),/, "toolbar follows the effective value");
  assert.doesNotMatch(actions, /config\.hypeproof\.browser/, "no settings context key a settings edit can clear");
  assert.match(actions, /if \(hpSafeSessionOptions\(accessor\.get\(IConfigurationService\), accessor\.get\(IStorageService\)\)\) \{/, "a direct command call checks the effective value");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log("PASS browser settings lock core patch: workbench pushes the locked value; settings only tighten; adult seats unchanged");
