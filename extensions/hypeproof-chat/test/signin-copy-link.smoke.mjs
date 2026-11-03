// REQ-L13 ⑧ (CGP-SHELL-R-022, DES-SHELL-21): while the learner approves the sign-in in a browser,
// the start page offers 링크 복사. It copies the device verification URL the flow already opens,
// never a credential; a clipboard failure is said plainly; no link means no button.
//   node --experimental-strip-types test/signin-copy-link.smoke.mjs
//
// 1-4 drive the real AccountSession against a fake Service. 5 runs the real StartPage (bundled
// with esbuild) against a fake VS Code surface, so the message reaches vscode.env.clipboard.
import assert from "node:assert/strict";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { AccountSession } from "../src/accountSession.ts";
import { copyableSignInLink, SIGN_IN_LINK_COPY } from "../src/signInLink.ts";

const SERVICE = "http://127.0.0.1:8793/v1", SITE = "http://localhost:3193";
const CODE = "HPDX-4K7Q", LINK = `${SITE}/studio/connect?code=${CODE}`;
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ok = (label) => console.log(`  ok   ${label}`);

function session({ start = {}, opens = true } = {}) {
  const world = { opened: [], store: new Map() };
  const secrets = { get: async (k) => world.store.get(k), store: async (k, v) => { world.store.set(k, v); }, delete: async (k) => { world.store.delete(k); } };
  const fetch = async (url) => {
    const p = new URL(url).pathname;
    if (p.endsWith("/device/start")) return reply(200, { device_code: "device-secret", user_code: CODE, verification_uri_complete: LINK, expires_in: 600, interval: 3, ...start });
    if (p.endsWith("/device/poll")) return reply(202, { status: "pending" });
    throw new Error("Unexpected request " + p);
  };
  const client = new AccountSession({ service: SERVICE, site: SITE, secrets, label: "Test Studio", fetch, openBrowser: async (u) => { world.opened.push(u); return opens; } });
  return { world, client };
}

// ── 1. The copied value is the URL the flow opens, and carries no credential ───────────────────
{
  const { world, client } = session({ opens: false });
  await client.start();
  assert.equal(client.view().status, "waiting");
  assert.equal(client.view().link, "ready", "a waiting sign-in with a verification URL offers the copy");
  assert.match(client.view().message, /링크를 복사해/, "a failed auto-open points at the copy");
  const copied = [];
  await client.copyLink(async (text) => { copied.push(text); });
  assert.deepEqual(copied, [world.opened[0]], "the copy is exactly the verification URL the flow opened");
  assert.equal(copied[0], LINK);
  for (const secret of ["device-secret", "access_token", "refresh", "token"]) assert.equal(copied[0].includes(secret), false, `no ${secret} in the copied link`);
  assert.deepEqual([...new URL(copied[0]).searchParams.keys()], ["code"], "only the on-screen user code");
  assert.equal(client.view().userCode, CODE, "the user code stays on screen");
  assert.equal(client.view().link, "copied");
  assert.equal(client.view().linkText, undefined, "a successful copy does not put the link in the view");
  client.dispose();
  ok("copy: the verification URL the flow opens, with only the user code, no credential");
}

// ── 2. A clipboard failure is reported honestly ────────────────────────────────────────────────
{
  const { client } = session();
  await client.start();
  await client.copyLink(async () => { throw new Error("clipboard unavailable"); });
  assert.equal(client.view().link, "failed", "the failure is not reported as a copy");
  assert.equal(client.view().linkText, LINK, "the link is shown so it can be typed elsewhere");
  assert.match(SIGN_IN_LINK_COPY.failed, /복사하지 못했어요/);
  // Positive control: a retry that works says copied again and drops the shown link.
  await client.copyLink(async () => {});
  assert.equal(client.view().link, "copied"); assert.equal(client.view().linkText, undefined);
  client.dispose();
  ok("copy: a refused clipboard says it failed and shows the link; a retry recovers");
}

// ── 3. No URL, no button ───────────────────────────────────────────────────────────────────────
{
  const { client } = session();
  assert.equal(client.view().link, undefined, "signed out: nothing to copy");
  let writes = 0;
  await client.copyLink(async () => { writes++; });
  assert.equal(writes, 0, "no copy without a sign-in in progress");
  await client.start(); client.cancel();
  await client.copyLink(async () => { writes++; });
  assert.equal(writes, 0, "a cancelled sign-in copies nothing");
  assert.equal(client.view().link, undefined);
  client.dispose();
  ok("copy: no link before start or after cancel, and nothing is written");
}

// ── 4. Only a link that carries nothing but the on-screen code is copyable ─────────────────────
{
  // Positive controls.
  assert.equal(copyableSignInLink(LINK, SITE, CODE, ["device-secret"]), LINK);
  // L1: the copy is the parsed, normalised URL, never the server's raw string (whitespace, a backslash
  // or a tab would split or disguise the link in a chat app or QR tool on the other device).
  assert.equal(copyableSignInLink(` ${SITE}\\studio/con\tnect?code=${CODE}\n`, SITE, CODE, ["device-secret"]), LINK, "normalised href");
  assert.equal(copyableSignInLink(`http://LOCALHOST:3193/studio/connect?code=${CODE}`, SITE, CODE, []), LINK, "host case normalised");
  // Negative controls: each must refuse.
  const bad = [
    `${SITE}/studio/connect?code=OTHER-CODE`,            // a code that is not the one on screen
    `${SITE}/studio/connect?code=${CODE}&code=${CODE}`,   // a repeated parameter
    `${SITE}/studio/connect?code=${CODE}&token=x`,        // any other parameter
    `${SITE}/studio/connect?access_token=leak`,
    `${SITE}/studio/connect?code=device-secret`,          // the device code itself
    `${SITE}/studio/connect#code=${CODE}`,
    `http://user:pw@localhost:3193/studio/connect?code=${CODE}`,
    `https://other.test/studio/connect?code=${CODE}`,
    `${SITE}/account?code=${CODE}`,
    "not a url",
    // L2: the link must carry the on-screen code (REQ-L13 ⑧); a bare or empty code is refused.
    `${SITE}/studio/connect`,
    `${SITE}/studio/connect?`,
    `${SITE}/studio/connect?code=`,
    // M1: lookalike hosts, subdomains, another port and another scheme — each alone.
    `http://evil-localhost:3193/studio/connect?code=${CODE}`,
    `http://localhost.evil.test:3193/studio/connect?code=${CODE}`,
    `http://sub.localhost:3193/studio/connect?code=${CODE}`,
    `http://localhost:3194/studio/connect?code=${CODE}`,
    `http://localhost/studio/connect?code=${CODE}`,
    `https://localhost:3193/studio/connect?code=${CODE}`,
  ];
  for (const url of bad) assert.equal(copyableSignInLink(url, SITE, CODE, ["device-secret"]), undefined, url);
  // M1 on the production origin: https with the default port only.
  const PROD = "https://hypeproof-ai.xyz", PROD_LINK = `${PROD}/studio/connect?code=${CODE}`;
  assert.equal(copyableSignInLink(PROD_LINK, PROD, CODE, []), PROD_LINK, "positive control: the production link");
  const prodBad = [
    `https://evil-hypeproof-ai.xyz/studio/connect?code=${CODE}`,
    `https://hypeproof-ai.xyz.evil.com/studio/connect?code=${CODE}`,
    `https://www.hypeproof-ai.xyz/studio/connect?code=${CODE}`,
    `https://hypeproof-ai.xyz:8443/studio/connect?code=${CODE}`,
    `http://hypeproof-ai.xyz/studio/connect?code=${CODE}`,
  ];
  for (const url of prodBad) assert.equal(copyableSignInLink(url, PROD, CODE, []), undefined, url);
  assert.equal(copyableSignInLink(`${SITE}/studio/connect?code=device-secret`, SITE, "device-secret", ["device-secret"]), undefined, "a secret never leaves even when it equals the code");
  // The session follows the guard: a start whose verification URL carries a different code offers no copy.
  const { client } = session({ opens: false, start: { verification_uri_complete: `${SITE}/studio/connect?code=OTHER-CODE` } });
  await client.start();
  assert.equal(client.view().status, "waiting");
  assert.equal(client.view().link, undefined, "no button for a link that does not match the screen");
  assert.doesNotMatch(client.view().message ?? "", /링크를 복사해/, "no copy is promised when there is none");
  let writes = 0; await client.copyLink(async () => { writes++; }); assert.equal(writes, 0);
  client.dispose();
  ok(`copy guard: 5 positive controls, ${bad.length + prodBad.length + 1} refusals, and the session offers no button for a mismatched link`);
}

// ── 5. The real StartPage hands the copy to vscode.env.clipboard ───────────────────────────────
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const extRoot = path.resolve(here, "..");
  const require = createRequire(import.meta.url);
  const bundle = await build({ stdin: { contents: "export * from './src/startPage.ts';", resolveDir: extRoot, loader: "ts" }, bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false, logLevel: "error" });
  let failClipboard = false;
  const clipboard = [], states = [];
  const ctx = { workspaceState: { keys: () => [], get: (_k, d) => d, update: async () => {} }, globalState: { get: () => undefined, update: async () => {} }, secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} }, extension: { packageJSON: { version: "test" } }, extensionUri: {}, subscriptions: [] };
  const chat = { openInEditor: async () => {}, ensureProfile: async () => null, profileFailure: () => null, invalidateProfile() {}, refreshConfig() {}, hasActiveStream: () => false, setConnectionChanging() {}, coachDisplayName: () => "Coach", coachNameIsChosen: () => true, renderHtml: () => "<html></html>" };
  const vscode = { workspace: { workspaceFolders: [], getConfiguration: () => ({ get: (_k, d) => d }) }, window: { createWebviewPanel: () => { throw Error("panel is attached by the test"); } }, commands: { executeCommand: async () => {} }, env: { openExternal: async () => {}, clipboard: { writeText: async (t) => { if (failClipboard) throw new Error("denied"); clipboard.push(t); } } }, Uri: { joinPath: () => ({}), parse: (u) => u }, ViewColumn: { One: 1 } };
  const mod = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module: mod, exports: mod.exports, require: (id) => (id === "vscode" ? vscode : require(id)), console, Buffer, AbortSignal, URL, URLSearchParams, process, TextEncoder, setTimeout, clearTimeout, fetch: async () => { throw new Error("no network in this test"); } });
  const { client } = session({ opens: false });
  await client.start();
  const page = new mod.exports.StartPage(ctx, chat, async () => false, undefined, client);
  page.panel = { reveal() {}, webview: { postMessage: async (m) => states.push(m) } };
  page.offerWaited = true; page.trialOffer = null; page.products = null;
  await page.handle({ type: "accountCopyLink" });
  assert.deepEqual(clipboard, [LINK], "the start page copies through the VS Code clipboard");
  assert.equal(states.at(-1).state.account.link, "copied");
  failClipboard = true;
  await page.handle({ type: "accountCopyLink" });
  assert.equal(states.at(-1).state.account.link, "failed", "a refused clipboard reaches the screen as a failure");
  assert.equal(JSON.stringify(states).includes("device-secret"), false, "the device code never reaches the webview");
  client.dispose();
  ok("StartPage: accountCopyLink writes the link to vscode.env.clipboard and reports a refusal");
}
console.log("PASS signin-copy-link: copy is the verification URL, failure is honest, no URL means no button");
