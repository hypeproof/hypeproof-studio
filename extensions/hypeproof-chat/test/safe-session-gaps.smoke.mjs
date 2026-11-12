// REQ-N11 (2026-11-07) — the two gaps the #3557 verifier found in the persist:hp-safe core patch, closed.
// 1. A hardened-session tab has no way to the system browser: the upstream context-menu items
//    "Open Link in External Browser" and "Inspect" are not offered, and the toolbar/command
//    "Open in External Browser" is disabled and refuses to run while the hardened session is on.
// 2. Every tab follows the hardened session while it is on: CDP `Target.createTarget` (with or
//    without a browser context), context-menu tabs, and a reused view id; tabs opened before the
//    flip are closed and their pages reopened in the hardened session; off again, nothing changes.
// The main-process service is the patched file itself, compiled with TypeScript and run against
// stand-ins for Electron and the VS Code services it imports (behavior, not text).
//   node --experimental-strip-types test/safe-session-gaps.smoke.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const coreDir = path.join(repo, "scripts/patches/core");
const patch = path.join(coreDir, "hps-safe-session.patch");
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const MAIN = "src/vs/platform/browserView/electron-main/browserViewMainService.ts";
const MODEL = "src/vs/workbench/contrib/browserView/common/browserView.ts";
const CONTRIB = "src/vs/workbench/contrib/browserView/electron-browser/browserView.contribution.ts";
const ACTIONS = "src/vs/workbench/contrib/browserView/electron-browser/browserViewActions.ts";
const PLATFORM = "src/vs/platform/browserView/common/browserView.ts";

const text = fs.readFileSync(patch, "utf8");
const files = [...text.matchAll(/^diff --git a\/(\S+) /gm)].map((m) => m[1]);
assert.ok(files.includes(ACTIONS), "the patch edits browserViewActions.ts (the toolbar/command exit)");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hps-safe-gaps-"));
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

  // ---- The patched main-process service, compiled and run against stand-ins. ----
  const js = ts.transpileModule(read(MAIN), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, useDefineForClassFields: false },
  }).outputText;

  const log = { external: [], opened: [], safeLists: [], menus: [] };
  class Emitter {
    listeners = new Set();
    event = (cb) => { this.listeners.add(cb); return { dispose: () => this.listeners.delete(cb) }; };
    fire(v) { for (const cb of [...this.listeners]) cb(v); }
    dispose() { this.listeners.clear(); }
  }
  const Event = { once: (ev) => (cb) => { const d = ev((v) => { d.dispose(); cb(v); }); return d; } };
  class Disposable { _register(x) { return x; } dispose() {} }
  class DisposableMap extends Map { deleteAndDispose(k) { const v = this.get(k); this.delete(k); v?.dispose(); } dispose() {} }
  let safeSession;
  const sessions = new Map();
  const BrowserSession = {
    getOrCreateSafe(allowlist = []) {
      log.safeLists.push([...allowlist]);
      safeSession ??= { id: "hp-safe", sessionKind: "safe", connectStorage() {} };
      safeSession.allowlist = allowlist;
      return safeSession;
    },
    getOrCreate(id, scope, _home, _ws, safe) {
      return safe ? BrowserSession.getOrCreateSafe(safe.allowlist) : BrowserSession.getOrCreateGlobal();
    },
    getOrCreateGlobal() { return BrowserSession.make("global"); },
    getOrCreateEphemeral(id, prefix = "ephemeral") { return BrowserSession.make(`${prefix}:${id}`); },
    make(id) { if (!sessions.has(id)) sessions.set(id, { id, sessionKind: "browse", connectStorage() {} }); return sessions.get(id); },
    get(id) { return id === "hp-safe" ? safeSession : sessions.get(id); },
    getBrowserContextIds() { return [...sessions.keys()]; },
    isBrowserViewWebContents() { return false; },
  };
  class FakeView {
    constructor(id, session, createChild, openMenu, options) {
      Object.assign(this, { id, session, createChild, openMenu, options, url: "about:blank", disposed: false });
      this._close = new Emitter();
      this.onDidClose = this._close.event;
      this.webContents = { isDestroyed: () => false, navigationHistory: { canGoBack: () => true, canGoForward: () => true, goBack() {}, goForward() {} }, reload() {}, inspectElement() { log.external.push("devtools"); }, copyImageAt() {} };
    }
    getState() { return { url: this.url }; }
    getTopCodeWindow() { return { id: 7 }; }
    getElectronWindow() { return {}; }
    getWebContentsView() { return { getBounds: () => ({ x: 0, y: 0, width: 1, height: 1 }) }; }
    dispose() { if (this.disposed) return; this.disposed = true; this._close.fire(); }
  }
  class MenuItem { constructor(o) { Object.assign(this, o); } }
  class Menu { items = []; append(i) { this.items.push(i); } popup() { log.menus.push(this); } }
  let uuid = 0;
  const noopDecorator = () => () => {};
  const anyDecorators = new Proxy({}, { get: (_t, k) => (k === "__esModule" ? true : noopDecorator()) });
  const stubs = {
    "../../../base/common/event.js": { Emitter, Event },
    "../../../base/common/lifecycle.js": { Disposable, DisposableMap },
    "../../../base/common/buffer.js": {},
    "../../../base/common/cancellation.js": { CancellationToken: { None: {} }, CancellationTokenSource: class { token = {}; cancel() {} dispose() {} } },
    "../common/browserView.js": { BrowserViewStorageScope: { Global: "global", Workspace: "workspace", Ephemeral: "ephemeral" }, BrowserViewCommandId: {} },
    "electron": { clipboard: { write() {}, writeText() {} }, Menu, MenuItem },
    "../../instantiation/common/instantiation.js": { createDecorator: noopDecorator, IInstantiationService: noopDecorator() },
    "./browserView.js": { BrowserView: FakeView },
    "../../../base/common/uuid.js": { generateUuid: () => `id${++uuid}` },
    "../common/browserViewUri.js": { BrowserViewUri: { forId: (id) => `vscode-browser:${id}` } },
    "./browserSession.js": { BrowserSession },
    "../common/cdp/proxy.js": { CDPBrowserProxy: class {} },
    "../common/browserViewTelemetry.js": { logBrowserOpen() {} },
    "../../../nls.js": { localize: (_k, s) => s },
    "../../../base/common/strings.js": { htmlAttributeEncodeValue: (s) => s },
  };
  const fakeRequire = (spec) => stubs[spec] ?? anyDecorators;
  const mod = { exports: {} };
  new Function("require", "exports", "module", js)(fakeRequire, mod.exports, mod);
  const { BrowserViewMainService } = mod.exports;

  const instantiationService = { createInstance: (Ctor, ...args) => new Ctor(...args) };
  const windowsMainService = {
    getWindowById: (id) => ({ id, sendWhenReady: (_ch, _tok, req) => log.opened.push(req.args[1][1].viewState.url) }),
    getFocusedWindow: () => windowsMainService.getWindowById(7),
  };
  const nativeHostMainService = { openExternal: (_w, url) => log.external.push(url) };
  const svc = new BrowserViewMainService({ workspaceStorageHome: "/ws" }, instantiationService, windowsMainService, { nameShort: "Studio", version: "1" }, {}, nativeHostMainService, {});
  const views = () => [...svc.getTargets()];
  const menuFor = (view, params) => {
    svc.showContextMenu(view, { linkURL: "", srcURL: "", hasImageContents: false, isEditable: false, selectionText: "", editFlags: {}, x: 1, y: 1, ...params });
    return log.menus.at(-1);
  };
  const labels = (menu) => menu.items.map((i) => i.label ?? i.role ?? i.type);

  // Gap 1 — context menu of a hardened tab.
  await svc.getOrCreateBrowserView("safe-tab", "global", "ws", { allowlist: ["example.org"] });
  const safeTab = svc.tryGetBrowserView("safe-tab");
  assert.equal(safeTab.session.sessionKind, "safe");
  for (const params of [{ linkURL: "https://evil.example/" }, { hasImageContents: true, srcURL: "https://evil.example/i.png" }, { selectionText: "x" }, {}]) {
    const menu = menuFor(safeTab, params);
    assert.ok(!labels(menu).includes("Open Link in External Browser"), `no external-browser item in a hardened tab: ${JSON.stringify(params)}`);
    assert.ok(!labels(menu).includes("Inspect"), "no Inspect in a hardened tab");
    for (const item of menu.items) item.click?.();
  }
  assert.deepEqual(log.external, [], "no item of a hardened tab's menu reaches the system browser or devtools");
  assert.ok(views().every((v) => v.session.sessionKind === "safe"), "'Open Link/Image in New Tab' stay in the hardened session");
  // Control: a normal tab keeps upstream's menu.
  await svc.getOrCreateBrowserView("normal-tab", "global", "ws");
  const normal = menuFor(svc.tryGetBrowserView("normal-tab"), { linkURL: "https://example.org/" });
  assert.ok(labels(normal).includes("Open Link in External Browser") && labels(normal).includes("Inspect"), "normal tabs unchanged");
  await svc.destroyBrowserView("normal-tab");

  // Off: CDP targets keep upstream's ephemeral session.
  const offTarget = await svc.createTarget("https://example.org/", undefined, 7);
  assert.equal(offTarget.session.sessionKind, "browse", "flag off: CDP target unchanged upstream");
  offTarget.url = "https://example.org/page";
  await svc.getOrCreateBrowserView("pre-flip", "global", "ws");
  svc.tryGetBrowserView("pre-flip").url = "https://games.example.com/";
  await svc.getOrCreateBrowserView("pre-flip-blank", "global", "ws");
  // A reused id: a normal view is not handed back to a caller that asks for the hardened session.
  await svc.getOrCreateBrowserView("reuse", "global", "ws");
  const oldReuse = svc.tryGetBrowserView("reuse");
  await svc.getOrCreateBrowserView("reuse", "global", "ws", { allowlist: ["example.org"] });
  assert.ok(oldReuse.disposed && svc.tryGetBrowserView("reuse").session.sessionKind === "safe", "a reused normal view id is replaced by a hardened one");

  // Gap 2 — the flip: pre-flip tabs are closed and their pages reopened in the hardened session.
  log.opened.length = 0;
  await svc.setSafeSession({ allowlist: ["example.org"] });
  assert.ok(offTarget.disposed && svc.tryGetBrowserView("pre-flip") === undefined && svc.tryGetBrowserView("pre-flip-blank") === undefined, "every pre-flip tab is closed");
  assert.deepEqual(log.opened.sort(), ["https://example.org/page", "https://games.example.com/"], "pages are reopened (blank tabs are not); the allowlist then decides");
  assert.ok(views().length > 0 && views().every((v) => v.session.sessionKind === "safe"), "every open tab is in the hardened session after the flip");
  assert.deepEqual(log.safeLists.at(-1), ["example.org"], "the flip refreshes the shared session's allowlist");

  // CDP while on: with no context, with a CDP-made context, and with the global context.
  const cdp1 = await svc.createTarget("https://evil.example/", undefined, 7);
  const ctx = await svc.createBrowserContext();
  const cdp2 = await svc.createTarget("https://evil.example/", ctx, 7);
  const cdp3 = await svc.createTarget("https://evil.example/", "global", 7);
  for (const t of [cdp1, cdp2, cdp3]) assert.equal(t.session.sessionKind, "safe", "CDP targets take the hardened session");
  // An editor tab asked for without safe options (stale renderer) and a reused non-safe id.
  await svc.getOrCreateBrowserView("late-tab", "global", "ws");
  assert.equal(svc.tryGetBrowserView("late-tab").session.sessionKind, "safe", "a tab created while on is hardened even without per-call options");
  // A popup child whose contents Electron made in another session fails closed.
  assert.throws(() => svc.createBrowserView("child", BrowserSession.getOrCreateGlobal(), { webContents: {} }), /outside the hardened browser session/);
  // An allowlist change reaches the shared session at once.
  await svc.setSafeSession({ allowlist: ["kids.example"] });
  assert.deepEqual(safeSession.allowlist, ["kids.example"], "allowlist changes reach existing hardened tabs");

  // Off again: new tabs follow upstream; hardened tabs stay hardened.
  await svc.setSafeSession(undefined);
  const after = await svc.createTarget("https://example.org/", undefined, 7);
  assert.equal(after.session.sessionKind, "browse", "off again: upstream behavior");
  assert.equal(cdp1.session.sessionKind, "safe");

  // ---- Workbench side (renderer): the push and the toolbar/command exit. ----
  const model = read(MODEL);
  const fn = model.slice(model.indexOf("export function hpSafeSessionOptions("), model.indexOf("\n}\n", model.indexOf("export function hpSafeSessionOptions(")) + 3);
  const fnFile = path.join(tmp, "options.ts");
  fs.writeFileSync(fnFile, fn.replace(/: IConfigurationService/, ": any").replace(/, storageService: IStorageService/, ", storageService: any").replace(/: IBrowserSafeSessionOptions \| undefined/, "")
    + "\nfunction hpBrowserSettingsLock(_s: any) { return undefined; }\n");
  const { hpSafeSessionOptions: withLock } = await import(pathToFileURL(fnFile).href);
  // No REQ-N11 lock here (adult seat): the settings decide. The lock is covered by browser-settings-lock.smoke.mjs.
  const hpSafeSessionOptions = (c) => withLock(c, {});
  const conf = (o) => ({ getValue: (k) => o[k.replace("hypeproof.browser.", "")] });
  assert.equal(hpSafeSessionOptions(conf({ hardenedSessionEnabled: false, safeSession: true, safeAllowlist: ["a.example"] })), undefined, "flag off → upstream");
  assert.equal(hpSafeSessionOptions(conf({ hardenedSessionEnabled: true, safeSession: false })), undefined, "adult seat → upstream");
  assert.deepEqual(hpSafeSessionOptions(conf({ hardenedSessionEnabled: true, safeSession: true, safeAllowlist: ["a.example"] })), { allowlist: ["a.example"] });
  assert.deepEqual(hpSafeSessionOptions(conf({ hardenedSessionEnabled: true, safeSession: true, safeAllowlist: "a.example" })), { allowlist: [] }, "a malformed list narrows to local pages");

  assert.match(read(PLATFORM), /setSafeSession\(safe: IBrowserSafeSessionOptions \| undefined\): Promise<void>;/, "IPC surface");
  const contribution = read(CONTRIB);
  assert.match(contribution, /const push = \(\) => \{ const safe = hpSafeSessionOptions\(configurationService, storageService\); active\.set\(!!safe\); void browserViewService\.setSafeSession\(safe\); \};\n\t\tpush\(\);/, "pushed at startup");
  assert.match(contribution, /if \(e\.affectsConfiguration\('hypeproof\.browser'\)\) \{\n\t\t\t\tpush\(\);/, "pushed on every change");
  assert.match(contribution, /registerWorkbenchContribution2\(HpSafeSessionContribution\.ID, HpSafeSessionContribution, WorkbenchPhase\.BlockStartup\);/, "before editors restore");
  const actions = read(ACTIONS);
  const ext = actions.slice(actions.indexOf("class OpenInExternalBrowserAction"), actions.indexOf("class OpenBrowserSettingsAction"));
  assert.match(ext, /precondition: ContextKeyExpr\.and\(BROWSER_EDITOR_ACTIVE, CONTEXT_BROWSER_HAS_URL, ContextKeyExpr\.not\('hypeproofBrowserSafeSession'\)\),/, "toolbar button disabled while on");
  assert.match(ext, /async run\(accessor: ServicesAccessor, browserEditor = accessor\.get\(IEditorService\)\.activeEditorPane\): Promise<void> \{\n\t\t\/\/ Studio \(REQ-N11\)[^\n]*\n\t\tif \(hpSafeSessionOptions\(accessor\.get\(IConfigurationService\), accessor\.get\(IStorageService\)\)\) \{\n\t\t\treturn;\n\t\t\}/, "a direct command call refuses too");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log("safe-session gaps: no external-browser or Inspect item in hardened tabs, toolbar/command exit closed, CDP and pre-flip tabs hardened, allowlist refresh, off unchanged PASS");
