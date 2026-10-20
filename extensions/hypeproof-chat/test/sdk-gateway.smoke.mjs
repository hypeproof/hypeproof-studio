// Smoke tests for the Agent SDK → worker gateway wiring (#282 Phase 1).
// Pure — no vscode. Locks REQ-M6 (gateway routing + env preservation) and
// REQ-M13 (no-local-API-key invariant), plus the two flag/dependency
// invariants of this slice: coachRuntime still defaults to "proxy" (Phase-3
// flip is Jay-gated) and @anthropic-ai/claude-agent-sdk is genuinely
// installed and loadable.
// Run: node --experimental-strip-types test/sdk-gateway.smoke.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

const {
  anthropicBaseUrlFor,
  buildSdkGatewayEnv,
  buildSdkQueryOptions,
  profileToAgentOptions,
  sdkConfigDirFor,
  SDK_CONFIG_DIR_NAME,
} = await import("../src/sdkCoachHelpers.ts");
const { MCP_BROWSER_TOOLS } = await import("../src/browserMcp.ts");

// ─── anthropicBaseUrlFor — proxyUrl (/v1 base) → SDK base URL ────────────────
// The SDK appends /v1/messages to ANTHROPIC_BASE_URL; passing the proxyUrl
// setting through unmodified would hit /v1/v1/messages (404).
{
  assert.equal(
    anthropicBaseUrlFor("https://api.hypeproof-ai.xyz/v1"),
    "https://api.hypeproof-ai.xyz",
    "prod default: /v1 suffix stripped",
  );
  assert.equal(
    anthropicBaseUrlFor("http://localhost:8787/v1"),
    "http://localhost:8787",
    "wrangler dev base works too",
  );
  assert.equal(
    anthropicBaseUrlFor("https://api.hypeproof-ai.xyz/v1/"),
    "https://api.hypeproof-ai.xyz",
    "trailing slash tolerated",
  );
  assert.equal(
    anthropicBaseUrlFor("https://gateway.example.com"),
    "https://gateway.example.com",
    "a URL without /v1 passes through unchanged",
  );
  assert.equal(
    anthropicBaseUrlFor("  https://api.hypeproof-ai.xyz/V1 "),
    "https://api.hypeproof-ai.xyz",
    "whitespace + case-insensitive /v1",
  );
}

// ─── buildSdkGatewayEnv — REQ-M6 routing + REQ-M13 key scrub ─────────────────
{
  const env = buildSdkGatewayEnv(
    {
      PATH: "/usr/bin:/bin",
      HOME: "/Users/student",
      // A dev machine's ambient credentials/provider switches — all of these
      // could shadow the gateway (API key outranks AUTH_TOKEN; Bedrock/Vertex
      // switches ignore ANTHROPIC_BASE_URL entirely).
      ANTHROPIC_API_KEY: "sk-ant-dev-machine-key",
      CLAUDE_CODE_USE_BEDROCK: "1",
      CLAUDE_CODE_USE_VERTEX: "1",
      ANTHROPIC_BASE_URL: "https://api.anthropic.com",
      ANTHROPIC_AUTH_TOKEN: "stale-token",
      CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-dev-machine-oauth",
    },
    { proxyUrl: "https://api.hypeproof-ai.xyz/v1", token: "hps-workshop-token" },
  );

  // Gateway routing: the SDK-recognized vars point at the worker.
  assert.equal(env.ANTHROPIC_BASE_URL, "https://api.hypeproof-ai.xyz");
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, "hps-workshop-token");

  // No-local-API-key invariant: the workshop token is the ONLY credential.
  assert.equal("ANTHROPIC_API_KEY" in env, false, "ambient ANTHROPIC_API_KEY must be scrubbed");
  assert.equal("CLAUDE_CODE_USE_BEDROCK" in env, false, "Bedrock switch must be scrubbed");
  assert.equal("CLAUDE_CODE_USE_VERTEX" in env, false, "Vertex switch must be scrubbed");

  // The SDK REPLACES the subprocess env with options.env — inherited vars the
  // spawned CLI needs (PATH/HOME) must survive the construction.
  assert.equal(env.PATH, "/usr/bin:/bin", "PATH preserved");
  assert.equal(env.HOME, "/Users/student", "HOME preserved");

  assert.equal(
    "CLAUDE_CODE_OAUTH_TOKEN" in env,
    false,
    "an ambient OAuth token outranks AUTH_TOKEN exactly like an API key — scrub it too",
  );

  // Works with NO local credentials at all (clean classroom machine).
  const clean = buildSdkGatewayEnv({ PATH: "/bin" }, { proxyUrl: "http://localhost:8787/v1", token: "t" });
  assert.equal(clean.ANTHROPIC_BASE_URL, "http://localhost:8787");
  assert.equal(clean.ANTHROPIC_AUTH_TOKEN, "t");
  assert.equal("ANTHROPIC_API_KEY" in clean, false, "no API key is ever required or invented");
}

// ─── REQ-M13, the part an env scrub cannot reach: credentials on DISK ────────
// Measured 2026-07-28 (Windows, api.hypeproof-ai.xyz): with the default config
// dir the CLI authenticated as the machine's Claude account
// (`Bearer sk-ant-oat01-…` + `anthropic-beta: …,oauth-2025-04-20,…`) and the
// gateway answered 401 `authentication_failed` nine times, even though the
// workshop token was valid for another 9.7 h and succeeded on a direct call.
// Isolating CLAUDE_CONFIG_DIR made the SAME token succeed on attempt 1.
{
  const env = buildSdkGatewayEnv(
    { PATH: "/bin", HOME: "/Users/student" },
    { proxyUrl: "https://api.hypeproof-ai.xyz/v1", token: "hps-workshop-token" },
  );
  assert.ok(env.CLAUDE_CONFIG_DIR, "the coach must never inherit the user's ~/.claude");
  assert.ok(
    env.CLAUDE_CONFIG_DIR.includes(SDK_CONFIG_DIR_NAME),
    "config dir is our own, not the CLI default",
  );
  assert.ok(
    !/(^|\/)\.claude(\/|$)/.test(env.CLAUDE_CONFIG_DIR),
    "must not resolve back onto ~/.claude",
  );

  // Windows uses %APPDATA%; POSIX falls back to $HOME. Both stay under our
  // per-user state so wiping Studio data removes the coach's CLI state with it.
  assert.equal(
    sdkConfigDirFor({ APPDATA: "C:/Users/s/AppData/Roaming" }),
    `C:/Users/s/AppData/Roaming/HypeProof-Studio/${SDK_CONFIG_DIR_NAME}`,
  );
  assert.equal(
    sdkConfigDirFor({ HOME: "/Users/student" }),
    `/Users/student/.hypeproof-studio/${SDK_CONFIG_DIR_NAME}`,
  );
  assert.equal(
    sdkConfigDirFor({ USERPROFILE: "C:/Users/s" }),
    `C:/Users/s/.hypeproof-studio/${SDK_CONFIG_DIR_NAME}`,
    "USERPROFILE is the fallback when APPDATA/HOME are absent",
  );
  assert.ok(
    !sdkConfigDirFor({}).includes(".claude"),
    "even with no home at all we never fall back to the CLI default",
  );

  // An explicit override (the host passes the dir it actually created) wins.
  const pinned = buildSdkGatewayEnv(
    { PATH: "/bin" },
    { proxyUrl: "http://localhost:8787/v1", token: "t", configDir: "/tmp/coach-cfg" },
  );
  assert.equal(pinned.CLAUDE_CONFIG_DIR, "/tmp/coach-cfg");
}

// ─── buildSdkQueryOptions — full option threading to query() ─────────────────
{
  const profile = { game: { template_tier: "kids-basic" } };
  const agent = profileToAgentOptions(profile, { model: "hypeproof-default", systemPrompt: "" });
  const options = buildSdkQueryOptions(agent, {
    proxyUrl: "https://api.hypeproof-ai.xyz/v1",
    token: "hps-token",
    baseEnv: { PATH: "/bin", ANTHROPIC_API_KEY: "leak-me-not" },
  });

  assert.equal(options.model, "hypeproof-default", "model threaded to the SDK");
  assert.deepEqual(options.allowedTools, [], "REQ-M5: nothing bypasses canUseTool");
  assert.deepEqual(options.settingSources, [], "REQ-M5: workspace settings cannot inject allow-rules");
  assert.deepEqual(options.tools, [], "REQ-M16: chat-only cohort disables ALL built-in tools (tools: [])");
  assert.equal(options.permissionMode, "default");
  assert.equal(options.maxTurns, 20, "minor cohort loop bound (2026-08-19: 6 → 20, 편집 예산)");
  assert.equal(options.env.ANTHROPIC_BASE_URL, "https://api.hypeproof-ai.xyz");
  assert.equal(options.env.ANTHROPIC_AUTH_TOKEN, "hps-token");
  assert.equal("ANTHROPIC_API_KEY" in options.env, false, "REQ-M13 holds through the full option build");
  assert.equal("cwd" in options, false, "cwd omitted when not provided");

  const withCwd = buildSdkQueryOptions(agent, {
    proxyUrl: "https://api.hypeproof-ai.xyz/v1",
    token: "hps-token",
    cwd: "/ws/student",
    baseEnv: {},
  });
  assert.equal(withCwd.cwd, "/ws/student", "workspace root threaded for file tools");

  // #282 Phase 2 (REQ-M16): profile.sdk_tools → Options.tools (base tool set,
  // availability ONLY — approval still runs through canUseTool). allowedTools
  // must stay [] even for the widest cohort: an allowedTools entry would
  // AUTO-APPROVE and bypass canUseTool, defeating the write modal.
  const copyclone = {
    game: { template_tier: "website" },
    sdk_tools: { read: true, write: true },
  };
  const adult = profileToAgentOptions(copyclone, { model: "hypeproof-default", systemPrompt: "" });
  const adultOptions = buildSdkQueryOptions(adult, {
    proxyUrl: "https://api.hypeproof-ai.xyz/v1",
    token: "hps-token",
    cwd: "/ws/clinic",
    baseEnv: {},
  });
  assert.deepEqual(
    adultOptions.tools,
    ["Read", "Grep", "Glob", "Write", "Edit", "MultiEdit"],
    "adult copyclone cohort: sdk_tools maps to the exact SDK tool names",
  );
  assert.deepEqual(adultOptions.allowedTools, [], "REQ-M5 holds for tooled cohorts too — no auto-approval");
  assert.ok(!adultOptions.tools.includes("Bash"), "no profile flag can put Bash in the tool set");

  // #282 P2 slice 2 (REQ-M19): the browser grant lives in permittedMcpTools,
  // NEVER in Options.tools (that field filters BUILT-INS; MCP tools arrive
  // via mcpServers, attached by the orchestration layer only when granted).
  // strictMcpConfig is pinned true so ambient MCP configs (.mcp.json, user
  // settings, plugins) can never add tools behind the cohort profile's back.
  const browserCohort = {
    game: { template_tier: "website" },
    sdk_tools: { read: true, write: true, browser: true },
  };
  const browserAgent = profileToAgentOptions(browserCohort, { model: "hypeproof-default", systemPrompt: "" });
  assert.deepEqual(
    browserAgent.permittedMcpTools,
    ["mcp__hypeproof__browser_open", "mcp__hypeproof__browser_screenshot", "mcp__hypeproof__live_preview_start",
     "mcp__hypeproof__browser_read", "mcp__hypeproof__browser_click", "mcp__hypeproof__browser_type"],
    "browser grant → the three hypeproof MCP tool names on the agent options",
  );
  const browserOptions = buildSdkQueryOptions(browserAgent, {
    proxyUrl: "https://api.hypeproof-ai.xyz/v1",
    token: "hps-token",
    cwd: "/ws/clinic",
    baseEnv: {},
  });
  assert.deepEqual(
    browserOptions.tools,
    ["Read", "Grep", "Glob", "Write", "Edit", "MultiEdit"],
    "REQ-M19: MCP names never leak into Options.tools (built-in base set only)",
  );
  assert.ok(!("mcpServers" in browserOptions), "mcpServers is host-bound — attached by sdkCoach, never by the pure builder");
  assert.equal(options.strictMcpConfig, true, "strictMcpConfig pinned for chat-only cohorts");
  assert.equal(browserOptions.strictMcpConfig, true, "strictMcpConfig pinned for browser cohorts too");
  assert.deepEqual(browserOptions.allowedTools, [], "REQ-M5: browser MCP tools also route through canUseTool");

  // 2026-10-05 — the profile flag decides at any tier: a kids tier that opts in gets the grant.
  const kidsOptIn = profileToAgentOptions(
    { game: { template_tier: "kids-rich" }, sdk_tools: { browser: true } },
    { model: "hypeproof-default", systemPrompt: "" },
  );
  assert.deepEqual(kidsOptIn.permittedMcpTools, [...MCP_BROWSER_TOOLS], "kids tier: the browser grant follows the flag");
}

// ─── coachRuntime flag still defaults to "proxy" (Phase-3 flip is Jay-gated) ─
{
  const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
  const flag = pkg.contributes.configuration.properties["hypeproofChat.coachRuntime"];
  assert.equal(flag.default, "proxy", "#282 Phase 1 must NOT flip the default runtime");
  assert.deepEqual(flag.enum, ["proxy", "agent-sdk"]);
  // #349 — the SDK must be a devDependency, NEVER a prod dependency: the
  // injected built-in ships without node_modules (runtime loads dist/vendor,
  // #343), and a declared prod dep makes vscode-min-prepack's
  // `npm list --production` hard-fail the whole tag build (killed v0.1.17).
  // Actual loadability is asserted by the dynamic-import block below.
  assert.equal(
    "@anthropic-ai/claude-agent-sdk" in (pkg.devDependencies ?? {}),
    true,
    "the Agent SDK is declared as a devDependency (dev installs get it)",
  );
  assert.equal(
    "@anthropic-ai/claude-agent-sdk" in (pkg.dependencies ?? {}),
    false,
    "the Agent SDK must NOT be a prod dependency — breaks vscode-min-prepack on the node_modules-less injected copy (#349)",
  );
}

// ─── the installed SDK is genuinely loadable and exposes query() ─────────────
// Import the real package the way sdkCoach's loadSdk() does (dynamic import).
// This is what separates Phase 1 from the #284 stub: a missing/broken install
// fails HERE, not silently at classroom time via the proxy fallback.
{
  const mod = await import("@anthropic-ai/claude-agent-sdk");
  assert.equal(typeof mod.query, "function", "SDK exports query()");
}

// ─── A2: non-orchestrator builds are byte-identical to the A1 tip ────────────
// Everything A2 adds for the orchestrator rides on a served roster. Without
// one, what the CLI receives must not move. This locks it: the matrix below
// covers chat-only, read/write, browser+shell+web, subagent, Curriculum
// Runtime and polluted-minor profiles with full and minimal arguments, plus
// four env-only builds. The digests are of JSON.stringify(entry) — key order
// included — computed with this same matrix at ea9ba109 (A1: SDK 0.3.299
// pinned, before any A2 change). The one deliberate difference,
// CLAUDE_CODE_AUTO_COMPACT_WINDOW, is asserted and removed before hashing (see
// SDK_AUTO_COMPACT_WINDOW_TOKENS: it keeps 0.3.207's compaction point).
// <matrix>
const SNAPSHOT_PROFILES = {
  kidsChat: { game: { template_tier: "kids-basic" } },
  kidsRW: { game: { template_tier: "kids-rich" }, sdk_tools: { read: true, write: true } },
  adultRW: { game: { template_tier: "website" }, sdk_tools: { read: true, write: true } },
  adultWide: { game: { template_tier: "website" }, sdk_tools: { read: true, write: true, browser: true, shell: true }, tools: { web_search: true } },
  adultSubagents: { game: { template_tier: "search-webapp" }, sdk_tools: { read: true, subagents: true } },
  adultCR: { game: { template_tier: "website" }, sdk_tools: { browser: true }, curriculum_runtime: { enabled: true } },
  pollutedTeen: { game: { template_tier: "teen" }, sdk_tools: { read: true, write: true, browser: true, subagents: true, shell: true } },
  minorFlagAdultTier: { minor_cohort: true, game: { template_tier: "website" }, sdk_tools: { read: true, browser: true } },
};
const SNAPSHOT_FULL_ARGS = {
  effort: "medium", turnId: "turn_1", fundingSource: "pass:abc", lessonBinding: "token:0123456789abcdef",
  lessonStep: "s1", helpMode: "hint", proxyUrl: "https://api.hypeproof-ai.xyz/v1", token: "hps-token",
  cwd: "/ws/student", baseEnv: { PATH: "/bin", HOME: "/Users/s", ANTHROPIC_CUSTOM_HEADERS: "x-test: kept\nx-hps-effort: high" },
  pathToClaudeCodeExecutable: "/opt/claude", workspaceFiles: ["index.html", "css/a.css"],
  previewUrl: "http://127.0.0.1:5173/", configDir: "/cfg/seat",
};
const SNAPSHOT_MIN_ARGS = { proxyUrl: "http://localhost:8787/v1", token: "t", baseEnv: {} };
/** Every non-orchestrator build this file locks, as plain JSON values keyed by case name. */
function snapshotEntries({ buildSdkQueryOptions, buildSdkGatewayEnv, profileToAgentOptions }) {
  const plain = (v) => JSON.parse(JSON.stringify(v));
  const out = {};
  for (const [name, p] of Object.entries(SNAPSHOT_PROFILES)) {
    const agent = profileToAgentOptions(p, { model: "hypeproof-default", systemPrompt: "P" });
    out[`agent.${name}`] = plain(agent);
    out[`options.${name}`] = plain(buildSdkQueryOptions(agent, SNAPSHOT_FULL_ARGS));
    out[`optionsMin.${name}`] = plain(buildSdkQueryOptions(agent, SNAPSHOT_MIN_ARGS));
  }
  out["env.devMachine"] = plain(buildSdkGatewayEnv(
    { PATH: "/usr/bin", HOME: "/Users/s", ANTHROPIC_API_KEY: "k", CLAUDE_CODE_USE_BEDROCK: "1", CLAUDE_CODE_USE_VERTEX: "1", CLAUDE_CODE_OAUTH_TOKEN: "o", CLAUDE_CODE_EFFORT_LEVEL: "max", ANTHROPIC_BASE_URL: "https://api.anthropic.com", ANTHROPIC_AUTH_TOKEN: "stale" },
    { proxyUrl: "https://api.hypeproof-ai.xyz/v1", token: "hps" },
  ));
  out["env.ambientHeaders"] = plain(buildSdkGatewayEnv(
    { ANTHROPIC_CUSTOM_HEADERS: "x-hps-effort: high\nx-hps-turn-id: old\nx-hps-funding-source: x\nx-hps-lesson-binding: y\nx-hps-lesson-step: z\nx-hps-help-mode: w\nx-test: retained" },
    { proxyUrl: "https://api.hypeproof-ai.xyz/v1", token: "t", effort: "low", turnId: "t2" },
  ));
  out["env.minimal"] = plain(buildSdkGatewayEnv({}, { proxyUrl: "http://localhost:8787/v1", token: "t" }));
  out["env.concurrency"] = plain(buildSdkGatewayEnv(
    { HOME: "/h" },
    { proxyUrl: "http://localhost:8787/v1", token: "t", maxToolConcurrency: 1, workspace: "/한글 폴더", workspaceFiles: Array.from({ length: 90 }, (_, i) => `f${i}.html`) },
  ));
  return out;
}
// </matrix>
{
  const { createHash } = await import("node:crypto");
  const helpers = await import("../src/sdkCoachHelpers.ts");
  const A1_TIP_DIGESTS = {
    "agent.kidsChat": "3e2a5c25fd37fb7b",
    "options.kidsChat": "b37c0950c446e1bf",
    "optionsMin.kidsChat": "00ab84048f616fc9",
    "agent.kidsRW": "b1a986eb858e7400",
    "options.kidsRW": "956e08c78a60c075",
    "optionsMin.kidsRW": "23429b83f6f981e8",
    "agent.adultRW": "d4cfac125171a652",
    "options.adultRW": "ec5d90a5e7810921",
    "optionsMin.adultRW": "de34a46d094343e7",
    "agent.adultWide": "22a8790a57382140",
    "options.adultWide": "c503f02a87d7368a",
    "optionsMin.adultWide": "a092a427aa0b37e1",
    "agent.adultSubagents": "a9ffb7ae70941bf0",
    "options.adultSubagents": "d81a757b8223f4fc",
    "optionsMin.adultSubagents": "990e41a54fe10ca1",
    "agent.adultCR": "d655444c68289f8a",
    "options.adultCR": "cc54b52021206102",
    "optionsMin.adultCR": "fd98e08d36a5f3de",
    // #1527 (2026-10-15): age no longer strips the browser grant, so the teen tier's own
    // browser flag now adds the browser MCP tools. The only deliberate drift from the A1 tip.
    "agent.pollutedTeen": "335abfd7e95652c0",
    "options.pollutedTeen": "7e8106e55d6b42ea",
    "optionsMin.pollutedTeen": "3ba774bae646543d",
    "agent.minorFlagAdultTier": "182a98ce189d34ae",
    "options.minorFlagAdultTier": "d99d40dd1268a1cb",
    "optionsMin.minorFlagAdultTier": "259d69535bf780de",
    "env.devMachine": "56b91ed2a688b3f8",
    "env.ambientHeaders": "fec192bc85f1e7c5",
    "env.minimal": "1d38b66498d92735",
    "env.concurrency": "ebf07480b7a59f73",
  };
  const digest = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);
  const withoutCompactionPin = (name, value) => {
    const env = name.startsWith("env.") ? value : value.env;
    if (env) {
      assert.equal(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, "200000", `${name}: the compaction pin is the one deliberate env change`);
      delete env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
      // REQ-STUDIO-DELEGATION-ROW — a build that may delegate pins helpers to the foreground; the
      // second deliberate env change, on exactly the builds that carry `agents`.
      if (value.agents) {
        assert.equal(env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS, "1", `${name}: helpers stay in the foreground`);
        delete env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS;
      } else {
        assert.equal(env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS, undefined, `${name}: no helper pin without helpers`);
      }
    }
    return value;
  };

  const entries = snapshotEntries(helpers);
  assert.deepEqual(Object.keys(entries), Object.keys(A1_TIP_DIGESTS), "the matrix covers the locked cases");
  const drifted = Object.entries(entries).filter(([name, value]) => digest(withoutCompactionPin(name, value)) !== A1_TIP_DIGESTS[name]);
  assert.deepEqual(
    drifted.map(([name]) => name),
    [],
    `non-orchestrator builds drifted from the A1 tip:\n${drifted.map(([n, v]) => `${n}: ${JSON.stringify(v)}`).join("\n")}`,
  );

  // Negative control — the comparison notices a one-name change in one build.
  const tampered = snapshotEntries({
    ...helpers,
    buildSdkQueryOptions: (agent, args) => {
      const built = helpers.buildSdkQueryOptions(agent, args);
      return { ...built, tools: [...built.tools, "PowerShell"] };
    },
  });
  assert.notEqual(
    digest(withoutCompactionPin("options.adultWide", tampered["options.adultWide"])),
    A1_TIP_DIGESTS["options.adultWide"],
    "a widened tool list must change the locked digest",
  );
  console.log("✓ A2: 28 non-orchestrator builds byte-identical to the A1 tip (compaction pin aside)");
}

// ─── A2: compaction stays at 200K on every seat (spec §4.1, A1 note E8) ──────
{
  const { SDK_AUTO_COMPACT_WINDOW_TOKENS } = await import("../src/sdkCoachHelpers.ts");
  assert.equal(SDK_AUTO_COMPACT_WINDOW_TOKENS, 200_000, "the pre-1M compaction point");
  const plain = buildSdkGatewayEnv({}, { proxyUrl: "http://localhost:8787/v1", token: "t" });
  assert.equal(plain.CLAUDE_CODE_AUTO_COMPACT_WINDOW, "200000", "pinned with no ambient value");
  // Negative control — an ambient value (a dev machine's 1M) cannot move it.
  const ambient = buildSdkGatewayEnv(
    { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "1000000" },
    { proxyUrl: "http://localhost:8787/v1", token: "t" },
  );
  assert.equal(ambient.CLAUDE_CODE_AUTO_COMPACT_WINDOW, "200000", "an ambient window is overwritten");
  // It reaches query() through the full option build too.
  const agent = profileToAgentOptions({ game: { template_tier: "website" } }, { model: "claude-sonnet-5-5", systemPrompt: "" });
  const options = buildSdkQueryOptions(agent, { proxyUrl: "http://localhost:8787/v1", token: "t", baseEnv: {} });
  assert.equal(options.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, "200000", "a real 5.5 id compacts where 0.3.207 did");
  console.log("✓ A2: CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000 on every seat, ambient values overwritten");
}

// ─── A2: orchestrator header names are reserved on every seat (spec §4.1, §14) ─
{
  const env = buildSdkGatewayEnv(
    {
      ANTHROPIC_CUSTOM_HEADERS: [
        "x-hps-agent: coach@9.9.9",
        "X-HPS-Roster: homepage@9.9.9",
        "  x-hps-orchestrator : hps-agent-roster/1",
        "x-hps-agent-call: 11111111-1111-1111-1111-111111111111",
        "x-hps-agentic: retained",
        "x-team: retained",
      ].join("\n"),
    },
    { proxyUrl: "http://localhost:8787/v1", token: "t" },
  );
  const lines = (env.ANTHROPIC_CUSTOM_HEADERS ?? "").split("\n");
  for (const reserved of ["x-hps-agent", "x-hps-roster", "x-hps-orchestrator", "x-hps-agent-call"]) {
    assert.ok(
      !lines.some((l) => new RegExp(`^\\s*${reserved}\\s*:`, "i").test(l)),
      `an ambient ${reserved} line never reaches the CLI`,
    );
  }
  // Positive controls — unrelated ambient headers survive, including a look-alike name.
  assert.deepEqual(lines, ["x-hps-agentic: retained", "x-team: retained"], "only the reserved names are dropped");
  console.log("✓ A2: ambient x-hps-agent / roster / orchestrator / agent-call lines are dropped, others kept");
}

// ─── A2: permissionMode is always the explicit "default" (0.3.286 auto hazard) ─
{
  const base = { systemPrompt: "", model: "m", permittedTools: [], permittedMcpTools: [], permittedAgentTools: [], maxTurns: 1 };
  const args = { proxyUrl: "http://localhost:8787/v1", token: "t", baseEnv: {} };
  for (const permissionMode of ["default", "bypassPermissions", "acceptEdits", "auto", undefined]) {
    const built = buildSdkQueryOptions({ ...base, permissionMode }, args);
    assert.ok(Object.prototype.hasOwnProperty.call(built, "permissionMode"), "the key is always present (never left to the CLI)");
    assert.equal(built.permissionMode, "default", `a caller's ${String(permissionMode)} cannot reach query()`);
  }
  console.log("✓ A2: permissionMode pinned to an explicit 'default' whatever the caller passes");
}

// ─── A2: an orchestrator seat — attribution headers and env pins (spec §4.1) ─
// The served roster of spec §2.2. Headers and pins appear only when it binds.
const SERVED_ROSTER = {
  format: "hps-agent-roster/1",
  id: "homepage",
  version: "1.0.0",
  digest: "sha256:00",
  coach_brief: "검토가 필요하면 도우미에게 물어보세요.",
  checks: ["site_check", "diff_guard", "archive_before_overwrite"],
  agents: [
    { name: "coach", title: "코치", role: "coach" },
    { name: "design-reviewer", title: "검토 도우미", role: "helper", enabled: true },
    { name: "design-advisor", title: "설계 자문", role: "advisor", enabled: false },
  ],
};
const ORCHESTRATOR_HEADER_NAMES = ["x-hps-orchestrator", "x-hps-agent", "x-hps-roster"];
const ORCHESTRATOR_ENV_PINS = ["CLAUDE_CODE_GATEWAY_HINT_HEADERS", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "CLAUDE_CODE_DISABLE_BACKGROUND_TASKS"];
const headerLines = (env) => (env.ANTHROPIC_CUSTOM_HEADERS ?? "").split("\n").filter(Boolean);
const headerValues = (env, name) =>
  headerLines(env)
    .filter((l) => l.toLowerCase().startsWith(`${name}:`))
    .map((l) => l.slice(name.length + 1).trim());
{
  const adult = { game: { template_tier: "website" }, sdk_tools: { read: true, write: true, subagents: true } };
  const served = profileToAgentOptions(adult, { model: "claude-sonnet-5-5", systemPrompt: "P", orchestrator: SERVED_ROSTER });
  assert.deepEqual(served.orchestrator, { rosterId: "homepage", rosterVersion: "1.0.0", consult: true, siteCheck: true });

  // The ambient env tries to claim an identity; ours replaces it.
  const options = buildSdkQueryOptions(served, {
    ...SNAPSHOT_FULL_ARGS,
    baseEnv: { ...SNAPSHOT_FULL_ARGS.baseEnv, ANTHROPIC_CUSTOM_HEADERS: "x-hps-agent: coach@9.9.9\nx-team: kept" },
  });
  assert.deepEqual(headerValues(options.env, "x-hps-orchestrator"), ["hps-agent-roster/1"]);
  assert.deepEqual(headerValues(options.env, "x-hps-agent"), ["coach@1.0.0"], "exactly one coach identity, ours");
  assert.deepEqual(headerValues(options.env, "x-hps-roster"), ["homepage@1.0.0"]);
  assert.deepEqual(headerValues(options.env, "x-team"), ["kept"], "unrelated ambient headers survive");
  assert.deepEqual(headerValues(options.env, "x-hps-turn-id"), ["turn_1"], "the existing turn join key still rides along");
  assert.equal(options.env.CLAUDE_CODE_GATEWAY_HINT_HEADERS, "1", "the CLI sends x-claude-code-request-class");
  assert.equal(options.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, "claude-haiku-5-5", "background calls do not name the coach's model");
  assert.equal(options.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS, "1", "no background work outside the watched turn");
  assert.equal(options.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, "200000");
  assert.ok(!/(^|\n)\s*[^:\n]+:[^\n]*\r/.test(options.env.ANTHROPIC_CUSTOM_HEADERS), "no CR in any header line");

  // The rest of the boundary on the same seat.
  assert.equal(options.permissionMode, "default");
  assert.equal("agents" in options, false, "no SDK subagents under the orchestrator");
  assert.deepEqual(options.tools, ["Read", "Grep", "Glob", "Write", "Edit", "MultiEdit"], "no Agent/Task invoker either");
  assert.deepEqual(options.allowedTools, [], "nothing bypasses canUseTool");
  assert.deepEqual(options.settingSources, []);
  assert.equal(options.strictMcpConfig, true);
  assert.equal("mcpServers" in options, false, "the MCP server stays host-bound (A4)");

  // Negative control — the same seat without a roster gets none of it, and keeps its subagents.
  const legacy = buildSdkQueryOptions(profileToAgentOptions(adult, { model: "claude-sonnet-5-5", systemPrompt: "P" }), SNAPSHOT_FULL_ARGS);
  for (const name of ORCHESTRATOR_HEADER_NAMES) assert.deepEqual(headerValues(legacy.env, name), [], `no ${name} without a roster`);
  // REQ-STUDIO-DELEGATION-ROW — the background pin also rides on the legacy helper grant this seat keeps.
  for (const key of ORCHESTRATOR_ENV_PINS) {
    if (key === "CLAUDE_CODE_DISABLE_BACKGROUND_TASKS" && legacy.agents) assert.equal(legacy.env[key], "1", "helpers stay in the foreground");
    else assert.equal(key in legacy.env, false, `no ${key} without a roster`);
  }
  assert.ok("agents" in legacy, "the legacy subagent path is unchanged (REQ-M22)");
  console.log("✓ A2: served roster → x-hps-orchestrator/agent/roster + hint, haiku, foreground pins; none without it");
}

// ─── A2: header safety and minors on the env path ───────────────────────────
{
  // A roster whose identity would break the header format never binds…
  for (const version of ["1.0.0\nx-evil: 1", "1.0.0\r", "1.0"]) {
    const agent = profileToAgentOptions(
      { game: { template_tier: "website" } },
      { model: "m", systemPrompt: "", orchestrator: { ...SERVED_ROSTER, version } },
    );
    assert.equal(agent.orchestrator, undefined, `version ${JSON.stringify(version)} does not bind`);
    const env = buildSdkQueryOptions(agent, SNAPSHOT_MIN_ARGS).env;
    for (const name of ORCHESTRATOR_HEADER_NAMES) assert.deepEqual(headerValues(env, name), []);
    assert.ok(!(env.ANTHROPIC_CUSTOM_HEADERS ?? "").includes("x-evil"), "nothing is injected");
  }
  // …and a forged binding handed to the exported env builder is refused outright.
  for (const forged of [{ rosterId: "home page", rosterVersion: "1.0.0" }, { rosterId: "homepage", rosterVersion: "1\n0" }]) {
    assert.throws(
      () => buildSdkGatewayEnv({}, { proxyUrl: "http://localhost:8787/v1", token: "t", orchestrator: { ...forged, consult: true, siteCheck: true } }),
      /invalid roster identity/,
      `forged binding ${JSON.stringify(forged)} is refused`,
    );
  }
  // Minors: whatever the Service served, no orchestrator headers, pins or consult.
  for (const p of [
    { game: { template_tier: "kids-rich" }, sdk_tools: { read: true, write: true } },
    { game: { template_tier: "teen" }, sdk_tools: { read: true, browser: true, subagents: true } },
    { game: { template_tier: "mystery-NEW" } },
    {},
    { minor_cohort: true, game: { template_tier: "website" }, sdk_tools: { read: true } },
  ]) {
    const agent = profileToAgentOptions(p, { model: "m", systemPrompt: "", orchestrator: SERVED_ROSTER });
    assert.equal(agent.orchestrator, undefined, `minor/unknown ${JSON.stringify(p)}: no binding`);
    assert.ok(!agent.permittedMcpTools.includes("mcp__hypeproof__consult"), "minors never get consult");
    const built = buildSdkQueryOptions(agent, SNAPSHOT_MIN_ARGS);
    const env = built.env;
    for (const name of ORCHESTRATOR_HEADER_NAMES) assert.deepEqual(headerValues(env, name), []);
    // REQ-STUDIO-DELEGATION-ROW — the teen tier's own helper grant brings the background pin, nothing else.
    for (const key of ORCHESTRATOR_ENV_PINS) assert.equal(key in env, key === "CLAUDE_CODE_DISABLE_BACKGROUND_TASKS" && !!built.agents);
  }
  console.log("✓ A2: unsafe roster identities never bind, forged bindings throw, minors get no orchestrator env");
}

// ─── A2: orchestrator hooks may report, never grant (A1 note E9) ─────────────
{
  const { sanitizeHookOutput, guardOrchestratorHooks, ORCHESTRATOR_HOOK_EVENTS } = await import("../src/sdkCoachHelpers.ts");
  assert.deepEqual([...ORCHESTRATOR_HOOK_EVENTS], ["PreToolUse", "PostToolUse"], "the two events spec §14 names");
  const pre = (o) => sanitizeHookOutput("PreToolUse", o);
  const post = (o) => sanitizeHookOutput("PostToolUse", o);

  // Negative controls — every way a hook could approve, or rewrite what was approved.
  assert.deepEqual(
    pre({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: { file_path: "/etc/passwd" } } }),
    {},
    "an allow and its input rewrite never leave the guard",
  );
  assert.deepEqual(pre({ decision: "approve", reason: "looks fine" }), { reason: "looks fine" }, "a legacy approve is dropped");
  assert.deepEqual(pre({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "defer" } }), {});
  assert.deepEqual(
    post({ hookSpecificOutput: { hookEventName: "PostToolUse", permissionDecision: "allow", updatedToolOutput: "x", updatedMCPToolOutput: "y", classifierContext: "the user agreed" } }),
    {},
    "PostToolUse cannot rewrite output or speak to the auto-mode classifier",
  );
  assert.deepEqual(pre({ async: true, asyncTimeout: 30 }), {}, "an async answer is no decision");
  assert.deepEqual(pre({ systemMessage: "x", terminalSequence: "\u001b]9;hi\u0007", suppressOutput: true }), {});
  for (const junk of [undefined, null, "allow", 1, [], true]) assert.deepEqual(pre(junk), {}, `junk ${JSON.stringify(junk)} → {}`);

  // Positive controls — what A4's hooks are for still gets through.
  assert.deepEqual(
    post({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "📏 390·1280px 확인 — 통과" } }),
    { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "📏 390·1280px 확인 — 통과" } },
  );
  assert.deepEqual(
    pre({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: "diff: 3줄", permissionDecision: "deny", permissionDecisionReason: "정보블록 밖" } }),
    { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: "diff: 3줄", permissionDecision: "deny", permissionDecisionReason: "정보블록 밖" } },
    "a hook may block",
  );
  assert.deepEqual(pre({ hookSpecificOutput: { permissionDecision: "ask" } }), { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask" } }, "a hook may send the call to the prompt");
  assert.deepEqual(pre({ decision: "block", reason: "x", continue: false, stopReason: "s" }), { continue: false, stopReason: "s", decision: "block", reason: "x" });
  assert.deepEqual(
    post({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: "c" } }),
    { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "c" } },
    "the event name is the one the hook is registered on",
  );

  // guardOrchestratorHooks — only the two events survive, every answer sanitized end to end.
  const seen = [];
  const approveAll = async (input) => {
    seen.push(input.hook_event_name);
    return { hookSpecificOutput: { hookEventName: input.hook_event_name, permissionDecision: "allow", additionalContext: "ctx" } };
  };
  const guarded = guardOrchestratorHooks({
    PreToolUse: [{ matcher: "Write|Edit|MultiEdit", timeout: 5, hooks: [approveAll] }],
    PostToolUse: [{ matcher: "Write|Edit|MultiEdit", hooks: [approveAll, "not a function"] }],
    PermissionRequest: [{ hooks: [async () => ({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } })] }],
    SessionStart: [{ hooks: [approveAll] }],
  });
  assert.deepEqual(Object.keys(guarded), ["PreToolUse", "PostToolUse"], "PermissionRequest and SessionStart are dropped");
  assert.equal(guarded.PreToolUse[0].matcher, "Write|Edit|MultiEdit");
  assert.equal(guarded.PreToolUse[0].timeout, 5);
  assert.equal(guarded.PostToolUse[0].hooks.length, 1, "a non-function callback is dropped");
  const signal = new AbortController().signal;
  const preOut = await guarded.PreToolUse[0].hooks[0]({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: {}, tool_use_id: "t1" }, "t1", { signal });
  assert.deepEqual(preOut, { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: "ctx" } }, "the allow is gone, the report stays");
  assert.deepEqual(seen, ["PreToolUse"], "the original hook did run");
  const thrower = guardOrchestratorHooks({ PreToolUse: [{ hooks: [async () => { throw new Error("hook failed"); }] }] });
  await assert.rejects(thrower.PreToolUse[0].hooks[0]({}, undefined, { signal }), /hook failed/, "a failing hook still fails (the CLI blocks the call)");
  assert.equal(guardOrchestratorHooks(undefined), undefined);
  assert.equal(guardOrchestratorHooks({ SessionStart: [{ hooks: [approveAll] }] }), undefined, "nothing allowed → no hooks option");

  // buildSdkQueryOptions — hooks only on an orchestrator seat, always guarded.
  const hooks = { PreToolUse: [{ matcher: "Write", hooks: [approveAll] }], PermissionRequest: [{ hooks: [approveAll] }] };
  const adult = { game: { template_tier: "website" }, sdk_tools: { read: true, write: true } };
  const orch = buildSdkQueryOptions(profileToAgentOptions(adult, { model: "m", systemPrompt: "", orchestrator: SERVED_ROSTER }), { ...SNAPSHOT_MIN_ARGS, hooks });
  assert.deepEqual(Object.keys(orch.hooks), ["PreToolUse"]);
  const viaOptions = await orch.hooks.PreToolUse[0].hooks[0]({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: {}, tool_use_id: "t2" }, "t2", { signal });
  assert.equal(viaOptions.hookSpecificOutput?.permissionDecision, undefined, "no allow reaches the CLI through the options");
  // Negative control — switch off: the same hooks on a seat without a roster are not attached.
  const legacy = buildSdkQueryOptions(profileToAgentOptions(adult, { model: "m", systemPrompt: "" }), { ...SNAPSHOT_MIN_ARGS, hooks });
  assert.equal("hooks" in legacy, false, "no roster → no hooks");
  console.log("✓ A2: hooks — only Pre/PostToolUse, no allow/approve/rewrite ever reaches the CLI, none without a roster");
}

console.log("✓ #282: agent-sdk gateway wiring — base-URL derivation, env/key invariants, flag default, real SDK loadable");
