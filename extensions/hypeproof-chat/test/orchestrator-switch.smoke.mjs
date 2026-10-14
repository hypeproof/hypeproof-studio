// A4 (ADR 0011; spec §2.3, §5.4, §13.2 A4, §15): the front-line orchestrator's switch.
//
// 1. Byte-identity: without a served roster this seat may use, runSdkCoach does exactly
//    what it did at Studio main 7b8a315 (before A4). A matrix of profiles × served values
//    × host arguments runs through the real runSdkCoach with a scripted CLI; what the CLI
//    would receive (prompt, options, the MCP server, canUseTool's answers, the stream's
//    callbacks) is hashed and compared with digests taken at 7b8a315 with this same
//    matrix. Cases with the orchestrator on must differ (positive control), and a
//    one-field change must be noticed (negative control).
// 2. The switch-off inventory (ORCHESTRATOR_SURFACES): with the switch off there is no
//    orchestrator tool, no hook, no header, no env pin, no agent-run request and no
//    event; with it on, every surface is there.
// 3. A full consult turn through runSdkCoach against a fake gateway.
//
// Run: node --experimental-strip-types test/orchestrator-switch.smoke.mjs
// Record the base digests (only on an unmodified 7b8a315 tree):
//   HPS_A4_RECORD_BASE=1 node --experimental-strip-types test/orchestrator-switch.smoke.mjs

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { registerHooks } from "node:module";
import * as os from "node:os";
import * as path from "node:path";

// sdkCoach.ts imports its siblings without extensions (esbuild resolves them); the smoke
// resolves them the same way, and `vscode` to the shared stub (cr-switch.smoke.mjs does too).
const stub = new URL("./fixtures/vscode-stub.mjs", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "vscode") return { url: stub, shortCircuit: true };
    if (specifier.startsWith(".") && !/\.[a-z0-9]+$/i.test(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        return nextResolve(specifier, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

// ── An environment that is the same on every machine ───────────────────────
// runSdkCoach spreads process.env into the CLI env and creates its config dir under HOME:
// both are pinned to a scratch directory, and every variable the env builder reads is cleared.
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hps-a4-switch-")));
const HOME = path.join(scratch, "home");
const WS = path.join(scratch, "ws");
fs.mkdirSync(HOME, { recursive: true });
fs.mkdirSync(WS, { recursive: true });
fs.writeFileSync(path.join(WS, "index.html"), "<!doctype html><title>t</title><p>홈</p>\n");
process.env.HOME = HOME;
for (const k of [
  "APPDATA", "USERPROFILE", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "ANTHROPIC_CUSTOM_HEADERS",
  "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_EFFORT_LEVEL",
  "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY", "CLAUDE_CODE_AUTO_COMPACT_WINDOW",
  "CLAUDE_CODE_GATEWAY_HINT_HEADERS", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "CLAUDE_CODE_DISABLE_BACKGROUND_TASKS", "HPS_SDK_BINARY",
]) delete process.env[k];
process.on("exit", () => fs.rmSync(scratch, { recursive: true, force: true }));

const { runSdkCoach } = await import("../src/sdkCoach.ts");

// ── A scripted CLI ──────────────────────────────────────────────────────────

/** A chainable stand-in for zod: every schema is a descriptor string, so its shape is hashable. */
function fakeZod() {
  const mk = (desc) => {
    const s = { __zod: desc };
    for (const m of ["min", "max", "optional", "describe"]) s[m] = (...a) => mk(`${desc}.${m}(${a.map((x) => JSON.stringify(x)).join(",")})`);
    return s;
  };
  return {
    string: () => mk("string"),
    boolean: () => mk("boolean"),
    number: () => mk("number"),
    enum: (values) => mk(`enum(${values.join("|")})`),
    object: (shape) => mk(`object{${Object.entries(shape).map(([k, v]) => `${k}:${v.__zod}`).join(",")}}`),
    array: (item) => mk(`array<${item.__zod}>`),
  };
}

/** The tool calls every case asks canUseTool about, in order. */
const PROBES = [
  ["Read", { file_path: "index.html" }],
  ["Write", { file_path: "index.html", content: "<p>새 홈</p>" }],
  ["Bash", { command: "ls" }],
  ["Bash", { command: "rm -rf site" }],
  ["mcp__hypeproof__consult", { agent: "design-reviewer", question: "첫 화면을 검토해 주세요" }],
  ["mcp__hypeproof__site_check", { path: "index.html" }],
  ["mcp__hypeproof__browser_open", { url: "http://127.0.0.1:5173/" }],
  ["mcp__hypeproof__browser_screenshot", {}],
  ["Agent", { subagent_type: "코드리뷰어", prompt: "검토" }],
  ["SendFeedback", {}],
];

/** What the CLI streams back, the same for every case: a busy retry, words, a write, the end. */
const EVENTS = [
  { type: "system", subtype: "init", timestamp: 1000 },
  { type: "system", subtype: "api_retry", error_status: 429, attempt: 1, max_retries: 10, retry_delay_ms: 1, error: "rate_limit", timestamp: 1001 },
  {
    type: "assistant",
    message: { id: "msg_1", model: "claude-sonnet-5-5", content: [{ type: "text", text: "안녕하세요" }], usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    timestamp: 1002,
  },
  {
    type: "assistant",
    message: { id: "msg_2", model: "claude-sonnet-5-5", stop_reason: "tool_use", content: [{ type: "tool_use", id: "toolu_1", name: "Write", input: { file_path: path.join(WS, "index.html"), content: "<p>새 홈</p>" } }] },
    timestamp: 1003,
  },
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", is_error: false, content: "ok" }] }, timestamp: 1004 },
  { type: "result", subtype: "success", stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 2 }, total_cost_usd: 0, timestamp: 1005 },
];

function fakeSdk(drive) {
  const calls = [];
  return {
    calls,
    createSdkMcpServer: (o) => ({ __server: true, name: o.name, version: o.version, tools: o.tools ?? [] }),
    tool: (name, description, inputSchema, handler) => ({ __tool: true, name, description, inputSchema, handler }),
    query({ prompt, options }) {
      const call = { prompt, options };
      calls.push(call);
      return (async function* () {
        await drive(call);
        for (const e of EVENTS) yield structuredClone(e);
      })();
    },
  };
}

const BROWSER_HOST = {
  openBrowser: async () => {},
  screenshot: async () => null,
  startLivePreview: async () => "http://127.0.0.1:5173/",
  livePreviewUrl: async () => "http://127.0.0.1:5173/",
  currentPage: async () => null,
  openPages: async () => [],
};

/** Every place the scratch paths show up, in every form a header or a prompt carries them. */
function normalize(s) {
  let out = s;
  for (const [p, name] of [[WS, "<WS>"], [HOME, "<HOME>"], [scratch, "<SCRATCH>"]]) {
    for (const form of [encodeURIComponent(p), p]) out = out.split(form).join(name);
  }
  return out;
}

function canon(value) {
  if (typeof value === "function") return "[function]";
  if (value instanceof AbortController) return "[AbortController]";
  if (Array.isArray(value)) return value.map(canon);
  if (value && typeof value === "object") {
    if (typeof value.__zod === "string") return `zod:${value.__zod}`;
    const out = {};
    for (const k of Object.keys(value)) out[k] = canon(value[k]);
    return out;
  }
  return typeof value === "string" ? normalize(value) : value;
}

/** The CLI env as a delta from process.env (which the builder spreads). */
function envDelta(env) {
  const set = {};
  for (const k of Object.keys(env)) if (env[k] !== process.env[k]) set[k] = normalize(String(env[k]));
  const removed = Object.keys(process.env).filter((k) => !(k in env));
  return { set, removed };
}

/**
 * One run of the real runSdkCoach with a scripted CLI. Returns everything observable: the
 * query input, canUseTool's answers to PROBES, the approvals asked, and the callbacks.
 */
async function observeTurn({ profile, served, host, browserHost = BROWSER_HOST }) {
  const seen = { approvals: [], deltas: [], activities: [], usage: [], events: [], fetches: [] };
  let decisions = [];
  const sdk = fakeSdk(async ({ options }) => {
    for (let i = 0; i < PROBES.length; i++) {
      const [name, input] = PROBES[i];
      const r = await options.canUseTool(name, structuredClone(input), { toolUseID: `probe_${i}`, signal: new AbortController().signal });
      decisions.push([name, r]);
    }
  });
  const fullProfile = served === undefined ? profile : { ...profile, orchestrator: served };
  const end = await runSdkCoach({
    gatewayUrl: "https://api.hypeproof-ai.xyz/v1",
    token: "hps-token-a4",
    model: "claude-sonnet-5-5",
    effort: "medium",
    turnId: "turn_a4",
    profile: fullProfile,
    systemPrompt: "",
    history: [{ role: "user", content: "이전 질문" }, { role: "assistant", content: "이전 답" }],
    userText: "홈페이지 첫 화면을 만들어 주세요",
    signal: new AbortController().signal,
    cwd: WS,
    previewUrl: "http://127.0.0.1:5173/",
    stallTimeoutMs: 0,
    binaryResolution: { available: true, source: "setting", path: "/opt/claude", reasons: [] },
    sdk,
    zod: fakeZod(),
    onDelta: (d) => seen.deltas.push(d),
    onActivity: (a) => seen.activities.push(a.kind === "approval" ? { ...a, at: 0 } : a),
    onUsage: (u) => seen.usage.push(u),
    onCitations: () => {},
    onAssetScore: () => {},
    requestApproval: async (action) => {
      seen.approvals.push(action);
      return { approved: true, actor: "policy" };
    },
    ...(browserHost ? { browserHost } : {}),
    ...(host
      ? {
          orchestrator: {
            ...host,
            fetch: async (url, init) => {
              seen.fetches.push({ url, init });
              return new Response(JSON.stringify({ error: { code: "unexpected" } }), { status: 500 });
            },
            onEvent: (e) => seen.events.push(e),
          },
        }
      : {}),
  });
  const call = sdk.calls[0];
  const { env, ...rest } = call.options;
  return {
    snapshot: canon({
      prompt: call.prompt,
      options: rest,
      env: envDelta(env),
      decisions,
      approvals: seen.approvals,
      deltas: seen.deltas,
      activities: seen.activities,
      usage: seen.usage,
      end,
    }),
    seen,
    call,
  };
}

// ── The matrix ──────────────────────────────────────────────────────────────

const PROFILES = {
  kidsChat: { profile_id: "kids-s1", game: { template_tier: "kids-basic" } },
  kidsPolluted: { profile_id: "kids-s2", game: { template_tier: "kids-rich" }, sdk_tools: { read: true, write: true, browser: true } },
  adultRW: { profile_id: "homepage-practice-s1", game: { template_tier: "website" }, sdk_tools: { read: true, write: true } },
  adultWide: { profile_id: "studio-native-trial", game: { template_tier: "website" }, sdk_tools: { read: true, write: true, browser: true, shell: true }, tools: { web_search: true } },
  adultSubagents: { profile_id: "clinic-s1", game: { template_tier: "search-webapp" }, sdk_tools: { read: true, subagents: true } },
  adultCR: { profile_id: "cr-s1", game: { template_tier: "website" }, sdk_tools: { browser: true }, curriculum_runtime: { enabled: true } },
  minorFlagAdultTier: { profile_id: "teen-s1", minor_cohort: true, game: { template_tier: "website" }, sdk_tools: { read: true, write: true, browser: true } },
  unknownTier: { profile_id: "odd-s1", sdk_tools: { read: true, write: true, browser: true } },
};

/** The served roster of spec §2.2 / §10.1 (the reviewer on, the advisor off). */
const ROSTER = {
  format: "hps-agent-roster/1",
  id: "homepage",
  version: "1.0.0",
  digest: "sha256:" + "a".repeat(64),
  coach_brief: "검토가 필요하면 검토 도우미에게 물어보세요. 도우미의 의견을 쓸 때는 누구의 의견인지 밝혀 말하세요.",
  checks: ["site_check", "diff_guard", "archive_before_overwrite"],
  agents: [
    { name: "coach", title: "코치", role: "coach" },
    {
      name: "design-reviewer", title: "검토 도우미", role: "helper", purpose: "첫 페이지나 새 섹션을 품질 기준으로 검토한다.",
      trigger: "coach_consult", context: ["file_excerpt", "site_outline", "site_check", "learner_goal"],
      caps: { per_turn: 1, per_session: 6 }, enabled: true, model: { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
    },
    {
      name: "design-advisor", title: "설계 자문", role: "advisor", trigger: "deterministic_failure",
      context: ["failure_evidence", "file_excerpt", "site_check", "diff_summary", "learner_goal"],
      caps: { per_turn: 1, per_session: 2 }, enabled: false, model: { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
    },
  ],
};
const SERVED = {
  none: undefined,
  roster: ROSTER,
  disabled: { enabled: false, reason: "flag_off" },
  wrongFormat: { ...ROSTER, format: "hps-agent-roster/2" },
  noCoach: { ...ROSTER, agents: ROSTER.agents.slice(1) },
};
const HOSTS = { none: null, host: {} };
const ADULTS = new Set(["adultRW", "adultWide", "adultSubagents", "adultCR"]);

/** Case name → is the orchestrator on? Only an adult, a well-formed roster and a host that asked for it. */
const CASES = [];
for (const p of Object.keys(PROFILES)) {
  for (const s of Object.keys(SERVED)) {
    for (const h of Object.keys(HOSTS)) {
      CASES.push({ name: `${p}/${s}/${h}`, profile: PROFILES[p], served: SERVED[s], host: HOSTS[h], on: ADULTS.has(p) && s === "roster" && h === "host" });
    }
  }
}

const digest = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);

/** Run `fn` with the coach's console lines captured instead of printed (48 turns are noisy). */
async function quietly(fn) {
  const saved = { info: console.info, warn: console.warn, error: console.error, log: console.log };
  const lines = [];
  for (const k of Object.keys(saved)) console[k] = (...a) => lines.push(`${k}: ${a.map(String).join(" ")}`);
  try {
    return { value: await fn(), lines };
  } finally {
    Object.assign(console, saved);
  }
}

const observed = {};
const matrixLog = (await quietly(async () => {
  for (const c of CASES) observed[c.name] = await observeTurn(c);
})).lines;

if (process.env.HPS_A4_RECORD_BASE === "1") {
  console.log(JSON.stringify(Object.fromEntries(CASES.map((c) => [c.name, digest(observed[c.name].snapshot)])), null, 2));
  process.exit(0);
}

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`✓ ${name}`);
};

// ── 1. Byte-identity with Studio main 7b8a315 ───────────────────────────────
// Taken with HPS_A4_RECORD_BASE=1 on 7b8a315 (A1+A2+A3 merged, no A4 change): all ten
// cases of a profile had the same digest there, because nothing before A4 reads the
// served `orchestrator` value or the host's `orchestrator` argument.
const BASE_7B8A315 = {
  kidsChat: "e4650ad1dc31c51b",
  kidsPolluted: "c6e30e39c05012d9",
  adultRW: "7ddfb7c2911645e8",
  adultWide: "df0a1ba6e0920f98",
  adultSubagents: "d07543df34fa6401",
  adultCR: "6cda00d7ffa4fdd6",
  minorFlagAdultTier: "99035f6bafb010d6",
  unknownTier: "3b83f67a44c1d4f3",
};
{
  assert.deepEqual(Object.keys(BASE_7B8A315), Object.keys(PROFILES), "every profile has a base digest");
  const offDrift = CASES.filter((c) => !c.on && digest(observed[c.name].snapshot) !== BASE_7B8A315[c.name.split("/")[0]]);
  assert.deepEqual(offDrift.map((c) => c.name), [], "a turn without the orchestrator drifted from 7b8a315");
  // Positive control: the cases that are on really differ, so the comparison can see A4.
  const onCases = CASES.filter((c) => c.on);
  assert.equal(onCases.length, 4, "four adult profiles with a roster and a host");
  for (const c of onCases) {
    assert.notEqual(digest(observed[c.name].snapshot), BASE_7B8A315[c.name.split("/")[0]], `${c.name}: the orchestrator changes the turn`);
  }
  // Negative control: one changed field in one snapshot is noticed.
  const tampered = structuredClone(observed["adultWide/none/none"].snapshot);
  tampered.options.hooks = { PostToolUse: [] };
  assert.notEqual(digest(tampered), BASE_7B8A315.adultWide, "an added hooks key changes the digest");
  const tampered2 = structuredClone(observed["adultRW/roster/none"].snapshot);
  tampered2.env.set.CLAUDE_CODE_GATEWAY_HINT_HEADERS = "1";
  assert.notEqual(digest(tampered2), BASE_7B8A315.adultRW, "an added env pin changes the digest");
  ok(`byte-identity: ${CASES.length - onCases.length} turns without the orchestrator equal 7b8a315 (no host, no roster, a disabled or malformed roster, minors and unknown tiers with a roster); the ${onCases.length} on-cases differ; a planted hook or env pin is caught`);
}

// ── 2. The switch-off inventory ─────────────────────────────────────────────
const { ORCHESTRATOR_SURFACES: SURF, resolveOrchestrator } = await import("../src/orchestratorSurfaces.ts");
const H2 = await import("../src/sdkCoachHelpers.ts");
const { orchestratorSessionFor, OrchestratorSession } = await import("../src/consultTool.ts");

/** What one observed turn shows of each inventoried surface. */
function surfacesOf({ call, seen }) {
  const opts = call.options;
  const tools = (opts.mcpServers?.hypeproof?.tools ?? []).map((t) => `mcp__hypeproof__${t.name}`);
  const headers = (opts.env.ANTHROPIC_CUSTOM_HEADERS ?? "").split("\n").map((l) => l.split(":")[0].trim().toLowerCase()).filter(Boolean);
  return {
    mcpTools: tools.filter((n) => SURF.mcpTools.includes(n)),
    hookEvents: Object.keys(opts.hooks ?? {}),
    cliHeaders: SURF.cliHeaders.filter((h) => headers.includes(h)),
    cliEnv: SURF.cliEnv.filter((k) => k in opts.env),
    serviceRoutes: seen.fetches.length ? SURF.serviceRoutes : [],
    approvalKinds: seen.approvals.some((a) => H2.sdkToolToActionRequest(a).kind === H2.CONSULT_HELPER_KIND) ? SURF.approvalKinds : [],
    events: [...new Set(seen.events.map((e) => (e.kind === "check" ? `check:${e.name}` : e.kind)))],
  };
}
{
  assert.deepEqual(SURF.mcpTools, ["mcp__hypeproof__consult", "mcp__hypeproof__site_check"]);
  assert.deepEqual(SURF.hookEvents, [...H2.ORCHESTRATOR_HOOK_EVENTS], "the hook events are A2's allowlist");
  assert.equal(SURF.hookMatcher, "Write|Edit|MultiEdit");
  assert.deepEqual(SURF.approvalKinds, ["consultHelper"]);
  const none = { mcpTools: [], hookEvents: [], cliHeaders: [], cliEnv: [], serviceRoutes: [], approvalKinds: [], events: [] };
  for (const c of CASES.filter((x) => !x.on)) {
    const o = observed[c.name];
    assert.deepEqual(surfacesOf(o), none, `${c.name}: switch off, no orchestrator surface`);
    // canUseTool denies both tools as ungranted (never asks, never runs them).
    for (const name of SURF.mcpTools) {
      const d = o.snapshot.decisions.find(([n]) => n === name)[1];
      assert.deepEqual(d, { behavior: "deny", message: H2.TOOL_DENIED_FRIENDLY }, `${c.name}: ${name} denied`);
    }
  }
  // The legacy subagents stay exactly where they were with the switch off (REQ-M22)…
  assert.equal("agents" in observed["adultSubagents/roster/none"].call.options, true);
  assert.equal("agents" in observed["adultSubagents/none/host"].call.options, true);
  // …and the served roster removes them (ADR 0011 §2).
  assert.equal("agents" in observed["adultSubagents/roster/host"].call.options, false);
  for (const c of CASES.filter((x) => x.on)) {
    const s = surfacesOf(observed[c.name]);
    assert.deepEqual(s.mcpTools, SURF.mcpTools, `${c.name}: both tools registered`);
    assert.deepEqual(s.hookEvents, SURF.hookEvents, `${c.name}: both hooks`);
    assert.deepEqual(s.cliHeaders, SURF.cliHeaders);
    assert.deepEqual(s.cliEnv, SURF.cliEnv);
    assert.deepEqual(s.approvalKinds, SURF.approvalKinds, `${c.name}: consult asked as consultHelper`);
    assert.deepEqual(s.events, ["notice"], `${c.name}: the busy retry in the stream gave one notice`);
    assert.equal(observed[c.name].seen.events.filter((e) => e.kind === "notice")[0].text, H2.SDK_BUSY_NOTICE);
    for (const [k, v] of Object.entries(observed[c.name].call.options.hooks)) {
      assert.deepEqual(v.map((m) => m.matcher), [SURF.hookMatcher], `${c.name}: ${k} matcher`);
    }
  }
  // Registration: with the browser grant the orchestrator tools follow the browser tools;
  // without it they register alone (the A2 open item).
  const names = (c) => observed[c].call.options.mcpServers.hypeproof.tools.map((t) => t.name);
  assert.deepEqual(names("adultWide/roster/host"), ["browser_open", "browser_screenshot", "live_preview_start", "browser_read", "browser_click", "browser_type", "consult", "site_check"]);
  assert.deepEqual(names("adultWide/none/host"), ["browser_open", "browser_screenshot", "live_preview_start", "browser_read", "browser_click", "browser_type"]);
  assert.deepEqual(names("adultRW/roster/host"), ["consult", "site_check"], "a seat without the browser grant gets the orchestrator tools only");
  assert.equal("mcpServers" in observed["adultRW/none/host"].call.options, false, "…and nothing without the roster");
  assert.deepEqual(names("adultCR/roster/host").slice(-2), ["consult", "site_check"]);
  assert.ok(names("adultCR/roster/host").includes("browser_observe"), "CR tools still follow their own switch");
  // canUseTool on the consult-only seat: the orchestrator tools are granted, the browser ones are not.
  const rw = Object.fromEntries(observed["adultRW/roster/host"].snapshot.decisions.map(([n, d]) => [n, d.behavior]));
  assert.equal(rw["mcp__hypeproof__consult"], "allow", "consult: asked (consultHelper), allowed by the default policy");
  assert.equal(rw["mcp__hypeproof__site_check"], "allow");
  assert.equal(rw["mcp__hypeproof__browser_open"], "deny");
  assert.equal(rw["mcp__hypeproof__browser_screenshot"], "deny");
  // resolveOrchestrator: the reasons the switch stays off.
  assert.equal(resolveOrchestrator(PROFILES.adultRW, null).on, false);
  assert.equal(resolveOrchestrator({ ...PROFILES.adultRW, orchestrator: ROSTER }, {}).on, true);
  for (const [p, why] of [
    [{ ...PROFILES.kidsChat, orchestrator: ROSTER }, "minor or unknown tier"],
    [{ ...PROFILES.minorFlagAdultTier, orchestrator: ROSTER }, "minor or unknown tier"],
    [{ ...PROFILES.unknownTier, orchestrator: ROSTER }, "minor or unknown tier"],
    [{ ...PROFILES.adultRW }, "absent"],
    [{ ...PROFILES.adultRW, orchestrator: SERVED.disabled }, "served off: flag_off"],
    [{ ...PROFILES.adultRW, orchestrator: SERVED.wrongFormat }, "unknown format"],
  ]) assert.deepEqual(resolveOrchestrator(p, {}), { on: false, reason: why });
  // A refused served roster leaves a trace in the developer log; an absent one does not.
  assert.ok(matrixLog.some((l) => /served orchestrator roster not used: unknown format/.test(l)));
  assert.ok(matrixLog.some((l) => /served orchestrator roster not used: minor or unknown tier/.test(l)), "a roster served to a minor is a Service bug worth a line");
  assert.ok(!matrixLog.some((l) => /roster not used: (absent|served off)/.test(l)));
  assert.equal(fs.existsSync(path.join(WS, ".hypeproof")), false, "no turn above created the archive folder");
  ok(`inventory: ${CASES.filter((x) => !x.on).length} switch-off turns show no orchestrator tool, hook, header, env pin, request, approval kind or event, and deny both tools; the ${CASES.filter((x) => x.on).length} on-turns show every one; the legacy subagents go only with the roster`);
}

// ── 3. A full consult turn through runSdkCoach against a fake gateway ───────
{
  const WS2 = path.join(scratch, "ws-turn");
  fs.mkdirSync(WS2, { recursive: true });
  const PAGE = [
    "<!doctype html><html lang=\"ko\"><head><meta name=\"viewport\" content=\"width=device-width\"><title>빵집</title></head><body>",
    "<header id=\"top\"><h1>동네 빵집</h1></header>",
    "<!-- 정보블록:시작 -->",
    "<section id=\"hours\"><h2>영업시간</h2><p>매일 9시–18시</p></section>",
    "<!-- 정보블록:끝 -->",
    "<section id=\"menu\"><h2>메뉴</h2><p>소금빵</p></section>",
    "</body></html>",
  ].join("\n");
  fs.writeFileSync(path.join(WS2, "index.html"), PAGE);
  const HISTORY_MARK = "TRANSCRIPT-MARKER-이전대화";
  const USER_MARK = "USERTEXT-MARKER-지금요청";
  const REVIEW = { verdict: "issues", findings: [{ rule: "contrast", where: "#top h1", severity: "must", fix: "대비를 높이세요" }, { rule: "alt", where: "#menu", severity: "should", fix: "alt 추가" }], unverified: [] };

  const fetches = [];
  const gateway = async (url, init) => {
    fetches.push({ url: String(url), init: { ...init, headers: { ...init.headers } } });
    return new Response(JSON.stringify({ ok: true, agent: "design-reviewer", version: "1.0.0", roster: "homepage@1.0.0", model: { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" }, capability: "text.fast", output: REVIEW, request_id: "req_full" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const W = (w) => ({ w, inner: w, scroll: w, root_clips: false, offenders: [], offender_count: 0, clipped: 0, viewport_meta: true, img_without_alt: 0, external_urls: 0, external_hosts: [], body_font_px: 16, small_targets: 0, small_target_sample: [] });
  const viewportAsks = [];
  const browserHost = {
    ...BROWSER_HOST,
    viewportPage: async (wrapperUrl) => {
      viewportAsks.push(wrapperUrl);
      return {
        cdp: {
          send: async (method, params = {}) =>
            method === "Runtime.evaluate" && !params.awaitPromise
              ? { result: { value: JSON.stringify({ href: wrapperUrl, ready: "complete" }) } }
              : { result: { value: { path: "/index.html", widths: [W(390), W(1280)] } } },
        },
      };
    },
  };
  const session = new OrchestratorSession();
  const events = [];
  const results = {};
  const sdk = fakeSdk(async ({ options }) => {
    const tool = (n) => options.mcpServers.hypeproof.tools.find((t) => t.name === n);
    const input = { agent: "design-reviewer", question: "첫 화면을 품질 기준으로 검토해 주세요", focus: { anchors: ["#hours"] } };
    results.decision = await options.canUseTool("mcp__hypeproof__consult", structuredClone(input), { toolUseID: "toolu_c1", signal: new AbortController().signal });
    results.consult = await tool("consult").handler(input, {});
    results.again = await tool("consult").handler({ ...input, question: "한 번 더 봐 주세요" }, {});
    // The coach acts on the finding: a Write of index.html, as the CLI runs it.
    const file = path.join(WS2, "index.html");
    const next = PAGE.replace("<h1>동네 빵집</h1>", "<h1 style=\"color:#111\">동네 빵집</h1>");
    const base = { session_id: "s", transcript_path: path.join(scratch, "t.jsonl"), cwd: WS2, tool_name: "Write", tool_use_id: "toolu_w1", tool_input: { file_path: file, content: next } };
    results.pre = await options.hooks.PreToolUse[0].hooks[0]({ ...base, hook_event_name: "PreToolUse" }, "toolu_w1", { signal: new AbortController().signal });
    fs.writeFileSync(file, next);
    results.post = await options.hooks.PostToolUse[0].hooks[0]({ ...base, hook_event_name: "PostToolUse", tool_response: {} }, "toolu_w1", { signal: new AbortController().signal });
    results.check = await tool("site_check").handler({ path: "index.html" }, {});
  });
  const quiet = await quietly(() => runSdkCoach({
    gatewayUrl: "https://api.hypeproof-ai.xyz/v1",
    token: "hps-token-full",
    model: "claude-sonnet-5-5",
    turnId: "turn_full_1",
    lessonBinding: "token:0123456789abcdef",
    lessonStep: "s2",
    profile: { ...PROFILES.adultWide, orchestrator: ROSTER },
    systemPrompt: "",
    history: [{ role: "user", content: HISTORY_MARK }, { role: "assistant", content: "네" }],
    userText: USER_MARK,
    signal: new AbortController().signal,
    cwd: WS2,
    stallTimeoutMs: 0,
    binaryResolution: { available: true, source: "setting", path: "/opt/claude", reasons: [] },
    sdk,
    zod: fakeZod(),
    onDelta: () => {},
    onCitations: () => {},
    onAssetScore: () => {},
    requestApproval: async (action) => ({ approved: H2.sdkToolToActionRequest(action).kind === "consultHelper", actor: "policy" }),
    browserHost,
    orchestrator: { session, fetch: gateway, onEvent: (e) => events.push(e), learnerGoal: () => "혼자 영업시간을 고칠 수 있게" },
  }));
  assert.deepEqual(quiet.value, { failed: false });

  // The consult: allowed without a modal, one request, the §3.3 answer.
  assert.equal(results.decision.behavior, "allow");
  assert.equal(fetches.length, 1, "one helper request for the turn");
  const req = fetches[0];
  assert.equal(req.url, "https://api.hypeproof-ai.xyz/v1/agents/design-reviewer/run");
  assert.equal(req.init.headers["x-hps-orchestrator"], "hps-agent-roster/1");
  assert.equal(req.init.headers["x-hps-roster"], "homepage@1.0.0");
  assert.equal(req.init.headers["x-hps-turn-id"], "turn_full_1");
  assert.equal(req.init.headers["x-hps-lesson-binding"], "token:0123456789abcdef");
  assert.equal(req.init.headers.authorization, "Bearer hps-token-full");
  const body = JSON.parse(req.init.body);
  assert.deepEqual(Object.keys(body.context).sort(), ["file_excerpt", "learner_goal", "site_check", "site_outline"]);
  assert.ok(!req.init.body.includes(HISTORY_MARK), "no transcript in the helper's context");
  assert.ok(!req.init.body.includes(USER_MARK), "nor the learner's message itself");
  assert.equal(body.context.learner_goal, "혼자 영업시간을 고칠 수 있게");
  assert.match(body.context.file_excerpt[0].text, /영업시간/);
  const answer = JSON.parse(results.consult.content[0].text);
  assert.deepEqual(answer, { ok: true, agent: "design-reviewer", title: "검토 도우미", version: "1.0.0", model: "Claude Haiku 5.5", request_id: "req_full", output: REVIEW });
  assert.equal(JSON.parse(results.again.content[0].text).code, "cap_reached", "per turn 1: the second consult never leaves the machine");

  // The write: archived first, then the diff and the site check in ≤ 400 characters.
  assert.deepEqual(results.pre, {});
  const ctx = results.post.hookSpecificOutput.additionalContext;
  assert.ok(ctx.length <= 400);
  assert.match(ctx, /^저장 비교\(index\.html\)/);
  assert.match(ctx, /📏 390·1280px 확인 — 통과 \(index\.html\)/);
  assert.equal(fs.readdirSync(path.join(WS2, ".hypeproof", "history")).length, 1, "the adult archive before the coach's Write");
  assert.deepEqual(viewportAsks, ["http://127.0.0.1:5173/__hp_viewport?path=%2Findex.html", "http://127.0.0.1:5173/__hp_viewport?path=%2Findex.html"]);
  assert.match(results.check.content[0].text, /^📏 390·1280px 확인 — 통과/);

  // The timeline: one consult line (running → done), the refused second, archive, diff, two checks, the busy notice.
  assert.deepEqual(events.map((e) => (e.kind === "consult" ? `consult:${e.state}` : e.kind === "check" ? `check:${e.name}` : e.kind)), [
    "consult:running", "consult:done", "consult:error", "check:archive", "check:diff", "check:site_check", "check:site_check", "notice",
  ]);
  assert.equal(events[1].label, "🔎 검토 도우미 · Claude Haiku 5.5 — 고칠 곳 2개");
  assert.equal(events[0].id, events[1].id, "the consult line is updated in place");
  assert.equal(events[2].label, "🔎 검토 도우미 · Claude Haiku 5.5 — 횟수를 다 씀");

  // The session carries over: a new turn resets the per-turn cap, the session cap counts on.
  assert.deepEqual(session.usage("design-reviewer"), { turn: 1, session: 1 });
  const sdk2 = fakeSdk(async ({ options }) => {
    results.turn2 = await options.mcpServers.hypeproof.tools.find((t) => t.name === "consult").handler({ agent: "design-reviewer", question: "새 섹션을 검토해 주세요" }, {});
  });
  // This turn's stream ends with error_max_turns: the next turn records F5.
  sdk2.query = ((orig) => (input) => {
    const it = orig(input);
    return (async function* () {
      for await (const e of it) yield e.type === "result" ? { ...e, subtype: "error_max_turns", is_error: true } : e;
    })();
  })(sdk2.query.bind(sdk2));
  const turn2 = await quietly(() => runSdkCoach({
    gatewayUrl: "https://api.hypeproof-ai.xyz/v1", token: "hps-token-full", model: "claude-sonnet-5-5", turnId: "turn_full_2",
    profile: { ...PROFILES.adultWide, orchestrator: ROSTER }, systemPrompt: "", history: [], userText: "다음", signal: new AbortController().signal,
    cwd: WS2, stallTimeoutMs: 0, binaryResolution: { available: true, source: "setting", path: "/opt/claude", reasons: [] }, sdk: sdk2, zod: fakeZod(),
    onDelta: () => {}, onCitations: () => {}, onAssetScore: () => {}, requestApproval: async () => ({ approved: true, actor: "policy" }),
    browserHost, orchestrator: { session, fetch: gateway, onEvent: () => {} },
  }));
  assert.equal(turn2.value.failed, true);
  assert.equal(JSON.parse(results.turn2.content[0].text).ok, true, "a new turn: the per-turn cap starts over");
  assert.deepEqual(session.usage("design-reviewer"), { turn: 1, session: 2 }, "the per-session count carries on");
  session.beginTurn("turn_full_3");
  assert.deepEqual(session.failuresThisTurn().map((f) => f.id), ["F5"], "runSdkCoach told the session how the turn ended");

  // Without an explicit session the seat's own registry entry is used.
  const seat = H2.coachSeatKeyFor({ token: "hps-token-full", profile: PROFILES.adultWide });
  assert.ok(orchestratorSessionFor(seat) instanceof OrchestratorSession);
  ok("full turn: consult allowed without a modal, one request with the §4.1 headers and only declared context (no transcript, no learner message), the §3.3 answer, the second consult capped; the coach's Write archived, diffed and checked in ≤ 400 characters; the timeline lines; caps and F5 carry across turns");
}

// ── 4. Without the host's CDP page, the on-demand check is unverified, never pass ─
{
  const fetches = [];
  const sdk = fakeSdk(async ({ options }) => {
    const t = options.mcpServers.hypeproof.tools.find((x) => x.name === "site_check");
    fetches.push(await t.handler({}, {}));
  });
  await quietly(() => runSdkCoach({
    gatewayUrl: "https://api.hypeproof-ai.xyz/v1", token: "t", model: "m", profile: { ...PROFILES.adultRW, orchestrator: ROSTER }, systemPrompt: "",
    history: [], userText: "q", signal: new AbortController().signal, cwd: WS, stallTimeoutMs: 0,
    binaryResolution: { available: true, source: "setting", path: "/opt/claude", reasons: [] }, sdk, zod: fakeZod(),
    onDelta: () => {}, onCitations: () => {}, onAssetScore: () => {}, requestApproval: async () => ({ approved: true, actor: "policy" }),
    orchestrator: { session: new OrchestratorSession(), fetch: async () => { throw new Error("no request expected"); } },
  }));
  assert.match(fetches[0].content[0].text, /^📏 390·1280px 확인 — 미확인\(미리보기 꺼짐\)/, "no browser host: no preview, unverified");
  ok("no browser host: site_check still registers on a consult-only seat and reads 미확인, never 통과");
}

console.log(`\n${passed} orchestrator-switch checks passed`);
