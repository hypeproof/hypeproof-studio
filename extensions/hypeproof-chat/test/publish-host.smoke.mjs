// One-click publish — the coach-tool side: grant, registration, approval policy, and the
// endpoint overrides that must never redirect a real participant's GitHub token.
//
// The pipeline itself is test/publish-site.smoke.mjs. This file locks what decides whether
// the coach SEES `mcp__hypeproof__publish_site`, when it is asked about it, and what the
// model's arguments become.
//
// Run: node --experimental-strip-types test/publish-host.smoke.mjs

import assert from "node:assert/strict";

const { permittedMcpToolsFor, evaluateSdkToolUse, sdkToolToActionRequest, isClassifiedSdkToolName, isMinorProfile } = await import("../src/sdkCoachHelpers.ts");
const { buildHypeproofMcpServer, hypeproofMcpRegistration, publishInputFromArgs, MCP_PUBLISH_SITE, MCP_BROWSER_TOOLS, MCP_BROWSER_EXTRA_TOOLS, HYPEPROOF_MCP_SERVER_NAME } = await import("../src/browserMcp.ts");
const { resolvePublishEndpoints, toolBudgetMs } = await import("../src/publish/publishConfig.ts");
const { resultChatText } = await import("../src/publish/publishSite.ts");

const ok = (name) => console.log(`✓ ${name}`);
const profile = (tier, extra = {}) => ({ game: tier ? { template_tier: tier } : undefined, ...extra });
const ON = { enabled: true, strategy: "per_user_github_pages" };

// ── the name is the contract with the Service skill ──────────────────────────
assert.equal(MCP_PUBLISH_SITE, `mcp__${HYPEPROOF_MCP_SERVER_NAME}__publish_site`);
assert.ok(isClassifiedSdkToolName(MCP_PUBLISH_SITE), "a known tool, not SDK drift");
ok("tool name: mcp__hypeproof__publish_site, classified");

// ── grant: the publishing block owns it, independent of the browser flag ─────
{
  assert.deepEqual(permittedMcpToolsFor(profile("website", { publishing: ON })), [MCP_PUBLISH_SITE], "publish without browser");
  assert.deepEqual(
    permittedMcpToolsFor(profile("website", { publishing: ON, sdk_tools: { browser: true } })),
    [...MCP_BROWSER_TOOLS, ...MCP_BROWSER_EXTRA_TOOLS, MCP_PUBLISH_SITE],
    "browser and publish side by side",
  );
  for (const [p, why] of [
    [profile("website", { publishing: { enabled: true, strategy: "hypeproof_gallery" } }), "gallery strategy"],
    [profile("website", { publishing: { enabled: false, strategy: "per_user_github_pages" } }), "disabled"],
    [profile("website"), "no publishing block"],
    [profile("kids-quest", { publishing: ON }), "minor tier"],
    [profile("website", { publishing: ON, minor_cohort: true }), "explicit minor flag"],
  ]) assert.ok(!permittedMcpToolsFor(p).includes(MCP_PUBLISH_SITE), why);
  assert.equal(isMinorProfile(profile("website", { minor_cohort: true })), true);
  ok("grant: per_user_github_pages + enabled + adult only, independent of sdk_tools.browser");
}

// ── registration: the server carries only what was granted ───────────────────
{
  function build(opts) {
    // What the SERVER carries (createSdkMcpServer's tools), not every tool() definition made.
    const server = buildHypeproofMcpServer(
      { tool: (name, _d, schema) => ({ name, schema }), createSdkMcpServer: (o) => o },
      { string: () => ({ s: 1 }), boolean: () => ({ b: 1 }) },
      { openBrowser: async () => {}, screenshot: async () => null, startLivePreview: async () => null },
      opts,
    );
    return server.tools.map((t) => t.name);
  }
  assert.deepEqual(hypeproofMcpRegistration([MCP_PUBLISH_SITE]), { browser: false, publishSite: true });
  assert.deepEqual(build(hypeproofMcpRegistration([MCP_PUBLISH_SITE])), ["publish_site"], "publish-only cohort: no browser tool on the server");
  assert.ok(!build(hypeproofMcpRegistration([...MCP_BROWSER_TOOLS])).includes("publish_site"), "browser-only cohort: no publish tool");
  assert.ok(build({}).includes("browser_open") && !build({}).includes("publish_site"), "old callers keep today's server");

  // The handler forwards to the host and reports a missing host as an error, never a success.
  let tool;
  buildHypeproofMcpServer(
    { tool: (name, _d, _s, handler) => (name === "publish_site" && (tool = handler), {}), createSdkMcpServer: (o) => o },
    { string: () => ({}), boolean: () => ({}) },
    { openBrowser: async () => {}, screenshot: async () => null, startLivePreview: async () => null },
    { browser: false, publishSite: true },
  );
  const r = await tool({ stage: "save" }, {});
  assert.equal(r.isError, true);
  ok("registration: server parts follow the grants");
}

// ── arguments → input: invalid values become absent, never guessed ───────────
{
  assert.deepEqual(publishInputFromArgs({}), {});
  assert.deepEqual(publishInputFromArgs({ repo_name: " dental-demo ", stage: "save", check_only: true, custom_domain: "dental-demo.kr" }), {
    repo_name: "dental-demo",
    stage: "save",
    check_only: true,
    custom_domain: "dental-demo.kr",
  });
  assert.deepEqual(publishInputFromArgs({ stage: "deploy", check_only: "true", repo_name: "" }), {}, "unknown stage → default; string 'true' is not true");
  ok("arguments: exact input contract");
}

// ── approval policy ──────────────────────────────────────────────────────────
{
  const permitted = [MCP_PUBLISH_SITE];
  assert.equal(evaluateSdkToolUse({ toolName: MCP_PUBLISH_SITE, input: {}, permittedTools: permitted }).decision, "ask", "publishing asks");
  assert.equal(evaluateSdkToolUse({ toolName: MCP_PUBLISH_SITE, input: { stage: "save" }, permittedTools: permitted }).decision, "ask", "saving to a public repo asks too");
  assert.equal(evaluateSdkToolUse({ toolName: MCP_PUBLISH_SITE, input: { check_only: true }, permittedTools: permitted }).decision, "allow", "a status check uploads nothing");
  assert.equal(evaluateSdkToolUse({ toolName: MCP_PUBLISH_SITE, input: {}, permittedTools: [] }).decision, "deny", "not granted → denied");
  assert.equal(evaluateSdkToolUse({ toolName: MCP_PUBLISH_SITE, input: {}, permittedTools: [] }).drift, undefined, "a routine denial, not drift");
  const req = sdkToolToActionRequest({ toolName: MCP_PUBLISH_SITE, input: { repo_name: "dental-demo" } });
  assert.equal(req.kind, "publishSite");
  assert.deepEqual(req.payload, { repo_name: "dental-demo", stage: "publish" });
  assert.equal(sdkToolToActionRequest({ toolName: MCP_PUBLISH_SITE, input: { stage: "save" } }).payload.stage, "save");
  ok("policy: publish/save ask (own kind), check_only allowed, ungranted denied");
}

// ── endpoint overrides never redirect a real participant's token ─────────────
{
  const env = { HPS_GITHUB_API_BASE: "http://127.0.0.1:9999/api", HPS_GITHUB_PAGES_BASE: "http://127.0.0.1:9999/site", HPS_GH_PATH: "/tmp/fake-gh" };
  const shipped = resolvePublishEndpoints({ env, testRun: false, devHost: false });
  assert.equal(shipped.apiBase, undefined, "a shipped app ignores the override: REST stays on gh api");
  assert.equal(shipped.pagesBase, undefined);
  assert.equal(shipped.ghPath, undefined);
  assert.deepEqual(shipped.refused.sort(), ["HPS_GH_PATH", "HPS_GITHUB_API_BASE", "HPS_GITHUB_PAGES_BASE"]);
  const test = resolvePublishEndpoints({ env, testRun: true, devHost: false });
  assert.equal(test.apiBase, "http://127.0.0.1:9999/api");
  assert.equal(test.ghPath, "/tmp/fake-gh");
  const remote = resolvePublishEndpoints({ env: { HPS_GITHUB_API_BASE: "https://evil.example/api" }, testRun: true, devHost: true });
  assert.equal(remote.apiBase, undefined, "even in a test run only loopback is accepted");
  assert.equal(resolvePublishEndpoints({ env: { HPS_E2E: "1", HPS_GITHUB_API_BASE: "http://localhost:1/api" }, testRun: false, devHost: false }).apiBase, "http://localhost:1/api");
  const fromFile = resolvePublishEndpoints({ env: {}, testRun: true, devHost: false, testState: { githubApiBase: "http://127.0.0.1:1/api" } });
  assert.equal(fromFile.apiBase, "http://127.0.0.1:1/api", "the e2e test-state file works where env does not reach");
  ok("overrides: test/dev only, loopback only");
}

// ── tool budget stays inside the SDK stall watchdog ──────────────────────────
assert.equal(toolBudgetMs(240_000), 180_000);
assert.equal(toolBudgetMs(undefined), 180_000);
assert.equal(toolBudgetMs(0), 20 * 60_000, "watchdog off → the documented bound");
assert.equal(toolBudgetMs(30_000), 30_000);
ok("budget: below the stall watchdog");

// ── the transcript line never calls an unverified address verified ───────────
{
  const steps = [{ id: "verify", status: "pending", detail_ko: "아직 확인 중" }];
  const pending = resultChatText({ ok: true, verified: false, repo_name: "dental-demo", planned_url: "https://o.github.io/dental-demo/", steps });
  assert.doesNotMatch(pending, /확인했어요: /);
  assert.match(pending, /예정 주소/);
  const done = resultChatText({ ok: true, verified: true, url: "https://o.github.io/dental-demo/", repo_name: "dental-demo", steps });
  assert.match(done, /열리는 것을 확인했어요: https:\/\/o\.github\.io\/dental-demo\//);
  ok("chat transcript: verified wording only when verified");
}

// ── registration: persisted per login + repo, survives a "restart", resettable ──
{
  const { PublishRegistry, registrationPrompt, REGISTRY_KEY } = await import("../src/publish/publishRegistry.ts");
  // A Map-backed Memento; a "restart" is a new PublishRegistry over the same backing map.
  const backing = new Map();
  const store = { get: (k) => backing.get(k), update: async (k, v) => void backing.set(k, JSON.parse(JSON.stringify(v))) };
  let t = 1000;
  const a = new PublishRegistry(store, () => t++);
  assert.equal(a.isRegistered("JeHyeong2", "dental-demo"), false, "nothing registered at first");
  await a.register("JeHyeong2", "dental-demo");
  await a.setLastLogin("JeHyeong2");
  const b = new PublishRegistry(store); // next app session
  assert.equal(b.isRegistered("jehyeong2", "Dental-Demo"), true, "persisted, case-insensitive like GitHub names");
  assert.equal(b.lastLogin(), "JeHyeong2");
  assert.equal(b.isRegistered("someone-else", "dental-demo"), false, "another account on the same Mac asks again");
  assert.equal(b.isRegistered("JeHyeong2", "other-site"), false, "another repository asks again");
  await b.register("JeHyeong2", "other-site");
  assert.deepEqual(b.list().map((r) => r.repo), ["dental-demo", "other-site"]);
  assert.equal(await b.unregister("JeHyeong2", "dental-demo"), 1);
  assert.equal(new PublishRegistry(store).isRegistered("JeHyeong2", "dental-demo"), false, "reset persists too");
  assert.equal(await b.unregister("JeHyeong2", "missing"), 0);
  assert.equal(await b.unregister(), 1, "reset all");
  assert.deepEqual(backing.get(REGISTRY_KEY), {});
  const p = registrationPrompt("JeHyeong2", "dental-demo");
  assert.equal(p.title, "이 저장소(JeHyeong2/dental-demo)에 홈페이지를 공개합니다 — 이후 버튼을 누르면 확인 없이 바로 올라갑니다");
  assert.match(p.detail, /배포 등록 해제/);
  ok("registration: persisted per login+repo across sessions, reset one/all");
}

// ── token gate (user decision 2026-10-13): only a HypeProof-issued token publishes ──
{
  const { PublishRegistry, consentDecision } = await import("../src/publish/publishRegistry.ts");
  const { pressAccess } = await import("../src/publish/publishContract.ts");
  const ON = { enabled: true, strategy: "per_user_github_pages" };
  // Every press asks the Service about the token in this seat.
  assert.deepEqual(pressAccess({ kind: "profile", publishing: ON, minor: false }), { ok: true });
  assert.deepEqual(pressAccess({ kind: "no_token" }), { ok: false, code: "token_rejected", refreshProfile: true });
  assert.deepEqual(pressAccess({ kind: "failure", reason: "expired" }), { ok: false, code: "token_rejected", refreshProfile: true }, "an expired token publishes nothing and hides the button");
  assert.deepEqual(pressAccess({ kind: "failure", reason: "rejected" }), { ok: false, code: "token_rejected", refreshProfile: true });
  assert.deepEqual(pressAccess({ kind: "failure", reason: "network" }), { ok: false, code: "service_unreachable", refreshProfile: false }, "a dropped connection publishes nothing but keeps the cached profile");
  assert.deepEqual(pressAccess({ kind: "profile", publishing: { enabled: false, strategy: "local_only" }, minor: false }), { ok: false, code: "not_allowed", refreshProfile: true }, "the Service turned publishing off for this cohort");
  assert.deepEqual(pressAccess({ kind: "profile", publishing: ON, minor: true }), { ok: false, code: "not_allowed", refreshProfile: true });
  // A registration skips the question; it never stands in for the token.
  assert.equal(consentDecision({ registered: true, profileAllowed: false, toolApproved: false }), "not_allowed", "registered but no profile → refused");
  assert.equal(consentDecision({ registered: true, profileAllowed: true, toolApproved: false }), "go");
  assert.equal(consentDecision({ registered: false, profileAllowed: false, toolApproved: true }), "not_allowed");
  assert.equal(consentDecision({ registered: false, profileAllowed: true, toolApproved: true }), "register");
  assert.equal(consentDecision({ registered: false, profileAllowed: true, toolApproved: false }), "ask");
  // The last push is remembered for the divergence check.
  const backing = new Map();
  const reg = new PublishRegistry({ get: (k) => backing.get(k), update: async (k, v) => void backing.set(k, v) });
  await reg.register("JeHyeong2", "dental-demo", "/ws/clinic");
  await reg.recordPush("JeHyeong2", "dental-demo", "abc123", "/ws/clinic");
  assert.equal(reg.get("jehyeong2", "dental-demo").lastPushedSha, "abc123");
  await reg.recordPush("nobody", "x", "zzz");
  assert.equal(reg.get("nobody", "x"), undefined, "a push never creates a registration");
  ok("token gate: every press asks the Service; a registration never replaces the token");
}

// ── class folder only (user decision 2026-10-13: "수업 폴더에 있는 파일만") ─────────
{
  const { readFileSync } = await import("node:fs");
  const { classFolderCheck } = await import("../src/publish/publishContract.ts");
  const same = (a, b) => a === b;
  const CLASS = "/Users/x/HypeProofDentalSeminar";
  assert.deepEqual(classFolderCheck({ workspaceRoot: CLASS, classFolder: CLASS, same }), { ok: true });
  assert.deepEqual(classFolderCheck({ workspaceRoot: "/Users/x/Desktop", classFolder: CLASS, same }), { ok: false, code: "not_class_folder" }, "another open folder (seen: ~/Desktop) is refused");
  assert.deepEqual(classFolderCheck({ workspaceRoot: CLASS, classFolder: undefined, same }), { ok: false, code: "not_class_folder" }, "an unknown class folder publishes nothing");
  assert.deepEqual(classFolderCheck({ workspaceRoot: undefined, classFolder: CLASS, same }), { ok: false, code: "no_workspace" });
  const host = readFileSync(new URL("../src/publish/publishHost.ts", import.meta.url), "utf8");
  const gate = host.indexOf("pressAccess(await this.host.checkAccess())");
  const folder = host.indexOf("classFolderCheck({");
  const pipeline = host.indexOf("runPublishSite(input");
  assert.ok(gate > 0 && folder > gate && pipeline > folder, "token gate → class folder → pipeline (before sign-in and any upload)");
  ok("class folder: only the class folder publishes; any other open folder is refused before sign-in");
}

// ── manifest: the button is visible where the chat lives, only when allowed ──
{
  const { readFileSync } = await import("node:fs");
  const m = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const cmd = m.contributes.commands.find((c) => c.command === "hypeproof-chat.publishSite");
  assert.equal(cmd.enablement, "hypeproof-chat.sitePublishEnabled");
  const editorTitle = m.contributes.menus["editor/title"].find((e) => e.command === "hypeproof-chat.publishSite");
  assert.match(editorTitle.when, /activeWebviewPanelId == 'hypeproof\.start'/, "the unified layout's chat editor carries the button");
  assert.match(editorTitle.when, /hypeproof-chat\.sitePublishEnabled/);
  assert.ok(m.contributes.menus["view/title"].some((e) => e.command === "hypeproof-chat.publishSite" && /sitePublishEnabled/.test(e.when)));
  assert.ok(m.contributes.commands.some((c) => c.command === "hypeproof-chat.publishSiteUnregister" && c.title.includes("배포 등록 해제")));
  ok("manifest: editor-title + view-title button gated; unregister command present");
}

// ── where the button can appear: the chat header, on the profile gate alone ────
{
  const { readFileSync } = await import("node:fs");
  const host = readFileSync(new URL("../src/publish/publishHost.ts", import.meta.url), "utf8");
  assert.match(host, /available\(\): boolean \{\n\s+return this\.allowed\(\);\n\s+\}/, "visibility is the served profile only — no registration fallback");
  assert.match(host, /const gate = pressAccess\(await this\.host\.checkAccess\(\)\);/, "every press re-checks the token with the Service");
  const startTsx = readFileSync(new URL("../webview-ui/src/StartPage.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(startTsx, /인터넷에 올리기|startPublishSite|sitePublish/, "the start page, where a seat without a valid token lands, has no publish button");
  ok("button: chat header only, profile gate only, token re-checked per press");
}

// Exercise the actual button and chat-provider adapter, replacing only the publishing
// pipeline so a retry can be held at the point where stale feedback must be gone.
{
  const { build } = await import("esbuild");
  const { createRequire } = await import("node:module");
  const vm = await import("node:vm");
  const require = createRequire(import.meta.url);
  const bundle = await build({
    entryPoints: [new URL("../src/chatPanelProvider.ts", import.meta.url).pathname],
    bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false,
  });
  let progressCount = 0;
  let informationPick;
  const dialogs = [], copied = [], opened = [];
  const vscode = {
    ProgressLocation: { Notification: 15 },
    window: {
      withProgress: async (_options, task) => { progressCount++; return task({ report() {} }); },
      showWarningMessage: async () => { assert.fail("Publish failures must not leave an unmanaged warning toast"); },
      showInformationMessage: async (...args) => { dialogs.push(args); return informationPick; },
    },
    env: { clipboard: { writeText: async text => copied.push(text) }, openExternal: async uri => opened.push(uri) },
    Uri: { parse: value => value },
  };
  const mod = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, {
    module: mod, exports: mod.exports, require: id => id === "vscode" ? vscode : require(id),
    console, Buffer, process, setTimeout, clearTimeout, AbortSignal, URL, TextEncoder, TextDecoder,
  });
  const panel = Object.create(mod.exports.ChatPanelProvider.prototype);
  const messages = [], transcript = [];
  Object.assign(panel, {
    cachedProfile: profile("website", { publishing: ON }),
    context: { globalState: { get: (_key, fallback) => fallback, update: async () => {} } },
    hasActiveStream: () => false,
    post: async message => messages.push(message),
    postAppReply: async text => transcript.push(text),
  });
  const publisher = panel.sitePublisher();
  const failure = { ok: false, verified: false, steps: [], error: { code: "auth", message_ko: "GitHub에 로그인되어 있지 않아요.", next_action_ko: "화면의 여덟 글자 코드로 GitHub 로그인을 마쳐 주세요." } };
  publisher.run = async () => failure;
  await publisher.runFromButton();
  assert.match(panel.pendingPageNotice, /GitHub에 로그인되어 있지 않아요/);
  assert.match(transcript[0], /GitHub에 로그인되어 있지 않아요/);
  assert.equal(dialogs.length, 0, "failure does not become a modal or an unmanaged toast");

  let finish;
  publisher.run = () => new Promise(resolve => { finish = resolve; });
  const retry = publisher.runFromButton();
  assert.equal(panel.pendingPageNotice, "", "retry clears its old failure before the pending operation completes");
  assert.equal(messages.at(-1).label, "", "the mounted webview receives the clear, too");
  const beforeDuplicate = progressCount;
  await publisher.runFromButton();
  assert.equal(progressCount, beforeDuplicate, "an active attempt receives no second progress or busy failure");
  finish({ ok: true, verified: false, steps: [], repo_url: "https://github.com/example/dental-demo" });
  await retry;
  assert.match(panel.pendingPageNotice, /아직 주소가 열리는 것을 확인하지 못했어요/);
  assert.match(transcript.at(-1), /https:\/\/github.com\/example\/dental-demo/, "repository remains accessible in the transcript");

  panel.postPageNotice("다른 페이지를 첨부했어요.");
  const next = publisher.runFromButton();
  assert.equal(panel.pendingPageNotice, "다른 페이지를 첨부했어요.", "retry preserves a newer unrelated notice");
  finish({ ok: true, verified: true, steps: [], url: "https://example.github.io/dental-demo/" });
  informationPick = "주소 복사";
  await next;
  assert.equal(copied.at(-1), "https://example.github.io/dental-demo/");

  informationPick = "코드 복사하고 GitHub 열기";
  await publisher.showDeviceCode("ABCD-1234", "https://github.com/login/device");
  assert.equal(dialogs.at(-1)[0], "GitHub 코드: ABCD-1234");
  assert.equal(dialogs.at(-1)[1].modal, true);
  assert.equal(copied.at(-1), "ABCD-1234");
  assert.equal(opened.at(-1), "https://github.com/login/device");
  ok("button retry: clears owned feedback immediately, keeps newer notices and transcript links, ignores duplicates; code modal and success actions retained");
}

console.log("\n✓ publish-host smoke 통과");
