// A5 (ADR 0011; orchestrator spec §5.1, §5.2, §5.4, §6.3, §13.2 row A5, §14, §15):
// the panel and visibility of the front-line orchestrator.
//
// 1. Old-profile render identity: a /v1/profile answer with no `orchestrator` key renders
//    exactly as it did on Studio main before A5. The real webview components are rendered
//    (as test/sx-render.mjs does) and their markup is compared with digests taken on main
//    21bd15ba with this same file (BASE). A served roster changes nothing on the screen by
//    itself (control), and an attributed request row is noticed (control).
//
// Run: node --experimental-strip-types test/orchestrator-panel.smoke.mjs
// Record the base digests (only on a main tree without A5, with this file copied in):
//   HPS_A5_RECORD_BASE=1 node --experimental-strip-types test/orchestrator-panel.smoke.mjs

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import vm from "node:vm";
import { build } from "esbuild";
import { chatPanelProps, resolvedProfile } from "./sx-screen-fixtures.mjs";

const RECORD = process.env.HPS_A5_RECORD_BASE === "1";
let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`✓ ${name}`);
};
const sha = (s) => createHash("sha256").update(String(s)).digest("hex");

// ── The render instrument: the real components, bundled once ────────────────

const webviewDir = new URL("../webview-ui/", import.meta.url);
const webviewRequire = createRequire(new URL("package.json", webviewDir));
const nodeRequire = createRequire(import.meta.url);

function rendererStatus() {
  for (const id of ["react", "react/jsx-runtime", "react-dom/server"]) {
    try {
      webviewRequire.resolve(id);
    } catch (error) {
      return { available: false, detail: `${id} is not installed under webview-ui (${error.message.split("\n")[0]})` };
    }
  }
  return { available: true, detail: "react found under webview-ui/node_modules" };
}

let renderApi = null;
async function render(name, props) {
  if (!renderApi) {
    const entry = [
      `import { createElement } from "react";`,
      `import { renderToStaticMarkup } from "react-dom/server";`,
      `import { ChatPanel } from "./src/ChatPanel.tsx";`,
      `import * as Effort from "./src/EffortControl.tsx";`,
      `const registry = { ChatPanel, EffortControl: Effort.EffortControl };`,
      `export function render(name, props) { return renderToStaticMarkup(createElement(registry[name], props || {})); }`,
      `export const effort = Effort;`,
    ].join("\n");
    const bundle = await build({
      stdin: { contents: entry, resolveDir: webviewDir.pathname, loader: "tsx", sourcefile: "orchestrator-panel-entry.tsx" },
      bundle: true,
      platform: "node",
      format: "cjs",
      jsx: "automatic",
      loader: { ".css": "text", ".svg": "text", ".png": "dataurl" },
      define: { "process.env.NODE_ENV": '"production"' },
      write: false,
      logLevel: "silent",
    });
    const windowStub = { addEventListener() {}, removeEventListener() {}, postMessage() {} };
    const module = { exports: {} };
    vm.runInNewContext(bundle.outputFiles[0].text, {
      module, exports: module.exports, require: nodeRequire, console, process, Buffer,
      setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, queueMicrotask,
      TextEncoder, TextDecoder, URL, window: windowStub, self: windowStub,
    });
    renderApi = module.exports;
  }
  return renderApi.render(name, props);
}

// ── The host: chatPanelProvider bundled with a scripted `vscode` ─────────────
// The clear-history.smoke.mjs idiom. esbuild's CJS interop reads `vscode`'s top-level keys
// through getters taken at load time, so every key the tests touch exists from the start and
// the tests change what is under it.

const fakeVscode = {
  ViewColumn: { One: 1, Two: 2, Beside: -2 },
  Uri: { file: (p) => ({ fsPath: p, path: p, scheme: "file", toString: () => `file://${p}` }), parse: (s) => ({ toString: () => s }), joinPath: (u, ...parts) => ({ fsPath: [u.fsPath, ...parts].join("/") }) },
  window: {
    browserTabs: [],
    activeBrowserTab: undefined,
    activeTextEditor: undefined,
    tabGroups: { all: [] },
    showWarningMessage: async () => undefined,
    showInformationMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    openBrowserTab: async () => {
      throw new Error("fake vscode: openBrowserTab not scripted");
    },
  },
  workspace: {
    workspaceFolders: undefined,
    getConfiguration: () => ({ get: (_key, fallback) => fallback, update: async () => {} }),
    fs: { readFile: async () => { throw new Error("fake vscode: fs.readFile not scripted"); }, writeFile: async () => {}, createDirectory: async () => {}, readDirectory: async () => [] },
  },
  commands: { executeCommand: async () => undefined, registerCommand: () => ({ dispose() {} }) },
  env: { appName: "HypeProof Studio", openExternal: async () => true },
};

let providerApi = null;
async function provider() {
  if (!providerApi) {
    const bundle = await build({
      entryPoints: [new URL("../src/chatPanelProvider.ts", import.meta.url).pathname],
      bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false, logLevel: "silent",
    });
    const module = { exports: {} };
    vm.runInNewContext(bundle.outputFiles[0].text, {
      module, exports: module.exports, require: (id) => (id === "vscode" ? fakeVscode : nodeRequire(id)),
      console, Buffer, process, setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, queueMicrotask,
      AbortSignal, AbortController, URL, URLSearchParams, TextEncoder, TextDecoder, fetch, Response, Headers,
      structuredClone, crypto: globalThis.crypto,
    });
    providerApi = module.exports;
  }
  return providerApi;
}

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
const ADULT = { profile_id: "homepage-practice-s1", game: { template_tier: "website" }, coach_runtime: "agent-sdk", sdk_tools: { read: true, write: true } };
const SEATS = {
  adultOld: ADULT,
  adultRoster: { ...ADULT, orchestrator: ROSTER },
  adultDisabled: { ...ADULT, orchestrator: { enabled: false, reason: "flag_off" } },
  adultMalformed: { ...ADULT, orchestrator: { ...ROSTER, format: "hps-agent-roster/2" } },
  kidsRoster: { profile_id: "kids-s1", game: { template_tier: "kids-basic" }, orchestrator: ROSTER },
  minorFlagRoster: { ...ADULT, profile_id: "teen-s1", minor_cohort: true, orchestrator: ROSTER },
  unknownTierRoster: { profile_id: "odd-s1", orchestrator: ROSTER },
};

// ── Old-profile fixtures (no `orchestrator` key anywhere) ────────────────────

const CHOICES = [
  { alias: "hypeproof-default", id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", effort: { default: "medium", allowed: ["low", "medium", "high"] } },
  { alias: "hypeproof-fast", id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
];
const MODEL_SELECTION = { revision: "hps-model-selection/1", runtime: "agent-sdk", provider: "anthropic", default: "hypeproof-default", source: "lesson", choices: CHOICES };
/** Two request rows as an older Service records them: no agent fields. */
const ROWS = [
  { request_id: "req_a1", model: "claude-sonnet-5-5", requested: null, applied: "medium", reason: "course_default", status: 200, created_at: "2026-10-15T01:00:00Z" },
  { request_id: "req_a2", model: "claude-haiku-5-5", requested: "low", applied: null, reason: "unsupported_model", status: 529, created_at: "2026-10-15T01:00:02Z" },
];
const POLICY = { value: "medium", allowed: ["low", "medium", "high"] };

function adultConfig(over = {}) {
  const base = chatPanelProps().config;
  return { ...base, model: "hypeproof-default", profile: { ...base.profile, game: { template_tier: "website" }, coach_runtime: "agent-sdk", model_selection: MODEL_SELECTION }, ...over };
}
const kidsConfig = () => {
  const base = chatPanelProps().config;
  return { ...base, profile: resolvedProfile(3, { game: { template_tier: "kids-basic" }, minor_cohort: true }) };
};
const TOOL_LINES = [
  { id: "toolu_1", role: "tool", content: "", createdAt: 1, tool: { icon: "🔧", label: "Write(index.html)", state: "done" } },
  { id: "toolu_2", role: "tool", content: "", createdAt: 2, tool: { icon: "🔧", label: "Edit(index.html) — 실패: 바꿀 문자열을 찾지 못함", state: "error" } },
  { id: "rev_1", role: "tool", content: "", createdAt: 3, tool: { icon: "🖼️", label: "미리보기 여는 중", state: "running" } },
];

/** name → props: every screen whose markup must not move for an old profile. */
const OLD_SCREENS = {
  "ChatPanel/adult-plain": () => ["ChatPanel", chatPanelProps({ config: adultConfig() })],
  "ChatPanel/adult-effort-observed": () => ["ChatPanel", chatPanelProps({ config: adultConfig({ effort: POLICY, effortResult: { state: "observed", requests: ROWS } }) })],
  "ChatPanel/adult-timeline": () => ["ChatPanel", chatPanelProps({ config: adultConfig(), messages: TOOL_LINES })],
  "ChatPanel/kids": () => ["ChatPanel", chatPanelProps({ config: kidsConfig() })],
  "EffortControl/policy-observed": () => ["EffortControl", { config: adultConfig({ effort: POLICY, effortResult: { state: "observed", requests: ROWS } }), post() {} }],
  "EffortControl/policy-loading": () => ["EffortControl", { config: adultConfig({ effort: POLICY, effortResult: { state: "loading", requests: [] } }), post() {} }],
  "EffortControl/unknown": () => ["EffortControl", { config: adultConfig({ effortResult: { state: "unknown", requests: [] } }), post() {} }],
  "EffortControl/observed-truncated": () => ["EffortControl", { config: adultConfig({ effortResult: { state: "observed", requests: ROWS, truncated: true } }), post() {} }],
  "EffortControl/nothing": () => ["EffortControl", { config: adultConfig(), post() {} }],
};

/** Taken on main 21bd15ba (before A5) with HPS_A5_RECORD_BASE=1; two runs gave the same digests. */
const BASE = {
  "ChatPanel/adult-plain": "10df95da41ec08638d40440233fc00c6f843bc6bcd35a9c328413b06d442fdb8",
  "ChatPanel/adult-effort-observed": "2ba790f80c7bdad44fe675b27e2d6973bb318f6e37fc15a40595991726c0dfd4",
  "ChatPanel/adult-timeline": "48fec8151b904cea8dc4df64d6801771bca33e170bd15545284ca8857d3f0a22",
  "ChatPanel/kids": "cba8c09433b9aa505124027b568348897a3ae0387a33be438612a0e39c8c7a44",
  "EffortControl/policy-observed": "caea5b1eab6f88d737a96c6dde5f67369dec99657c24d5b25dca26117cd7b9ba",
  "EffortControl/policy-loading": "5d88d9a6ac8f18b171024b26f107bee0c59db5d31f7c7201b5c079aa37b05598",
  "EffortControl/unknown": "eb4bfdda4154b27954e89c0875b2d1e12f7569c543454a74757f09e68fcf9118",
  "EffortControl/observed-truncated": "38784f908976a596bc7605c7cf68bf3238c8650b8c4272a495f91f42267d28c6",
  "EffortControl/nothing": "4a3c092bd66e1aa89b05f7e4c0444694fbaefce76613185e7cfdc18ea30feeef",
};

const status = rendererStatus();
if (!status.available) {
  // CI installs the webview's dependencies before the smokes (pr-ci.yml, `extension / smoke`).
  console.log(`NOT RUN orchestrator panel renders — ${status.detail}`);
} else {
  const digests = {};
  // HPS_A5_DUMP_DIR=<dir> also writes each markup there, to diff a failing screen by eye.
  const dumpDir = process.env.HPS_A5_DUMP_DIR;
  for (const [name, make] of Object.entries(OLD_SCREENS)) {
    const [component, props] = make();
    const html = await render(component, props);
    digests[name] = sha(html);
    if (dumpDir) {
      const fs = await import("node:fs");
      fs.mkdirSync(dumpDir, { recursive: true });
      fs.writeFileSync(`${dumpDir}/${name.replace(/\//g, "__")}.html`, html);
    }
  }
  if (RECORD) {
    console.log(JSON.stringify(digests, null, 2));
    process.exit(0);
  }
  for (const [name, digest] of Object.entries(digests)) {
    assert.equal(digest, BASE[name], `${name}: an old profile renders differently from main before A5`);
  }
  ok(`old-profile render identity: ${Object.keys(digests).length} screens equal main 21bd15ba`);
}

// ── 2. The capability header on GET /v1/profile (spec §2.2 condition 4, §4.1) ─

{
  const PC = await import("../src/proxyClient.ts");
  const { ORCHESTRATOR_FORMAT } = await import("../src/sdkCoachHelpers.ts");
  const { parseServedRoster } = await import("../src/agentRoster.ts");
  const OLD_PROFILE = resolvedProfile(3, { game: { template_tier: "website" } });
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), headers: { ...(init?.headers ?? {}) } });
    const body = String(url).endsWith("/activity") ? { activity_id: "act-1" } : OLD_PROFILE;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const r = await PC.fetchProfileResult({ proxyUrl: "https://api.example.test/v1/", token: "t0ken" });
    assert.equal(seen[0].url, "https://api.example.test/v1/profile");
    assert.equal(seen[0].headers["x-hps-orchestrator"], "hps-agent-roster/1", "the app declares the roster format it can run");
    assert.equal(seen[0].headers["x-hps-orchestrator"], ORCHESTRATOR_FORMAT, "the same value A2 sends on CLI requests");
    assert.equal(seen[0].headers.authorization, "Bearer t0ken");
    assert.equal(seen[0].headers["x-hps-observation-format"], "hps-observation/2", "the observation negotiation is kept");
    // An older Service answers without the key: the profile comes back as it was sent.
    assert.equal(r.ok, true);
    assert.deepEqual(r.profile, OLD_PROFILE);
    assert.equal("orchestrator" in r.profile, false);
    // The declared format is the one the bundled parser accepts (and only that one).
    const roster = { format: seen[0].headers["x-hps-orchestrator"], id: "homepage", version: "1.0.0", agents: [{ name: "coach", title: "코치", role: "coach" }] };
    assert.equal(parseServedRoster(roster).ok, true);
    assert.equal(parseServedRoster({ ...roster, format: "hps-agent-roster/2" }).ok, false);
    // Negative control: /v1/activity is not a roster route (spec §4.1 lists profile, messages, agents).
    await PC.verifyActivity({ proxyUrl: "https://api.example.test/v1", token: "t0ken" }, "act-1");
    assert.equal(seen[1].url, "https://api.example.test/v1/activity");
    assert.equal(seen[1].headers["x-hps-orchestrator"], undefined);
    assert.equal(seen[1].headers["x-hps-observation-format"], "hps-observation/2");
  } finally {
    globalThis.fetch = realFetch;
  }
  ok("GET /v1/profile declares x-hps-orchestrator: hps-agent-roster/1 (the parser's format); an answer without the key is unchanged; /v1/activity does not carry it");
}

// ── 3. A cut reviewer answer keeps must before should before could (spec §3.3) ─

{
  const C = await import("../src/consultTool.ts");
  const AGENT = { name: "design-reviewer", title: "검토 도우미", model: { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" } };
  const ko = (n, c = "가") => c.repeat(n);
  const bodyOf = (output) => ({ ok: true, agent: "design-reviewer", version: "1.0.0", model: { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" }, request_id: "req_0123456789abcdef", output });
  const shaped = (output) => {
    const text = C.consultSuccessText(AGENT, bodyOf(output));
    assert.ok(text.length <= C.CONSULT_RESULT_MAX, `≤ ${C.CONSULT_RESULT_MAX} characters (${text.length})`);
    return { text, json: JSON.parse(text) };
  };
  const finding = (rule, severity, i = 0) => ({ rule, where: `${ko(76)}#${String(i).padStart(2, "0")}`, severity, fix: ko(140, "나") });
  const rules = (json) => json.output.findings.map((f) => `${f.rule}/${f.severity}`);

  // The largest valid S1 design review (A4 report §12; the S1 contract: 8 findings, where ≤ 80,
  // fix ≤ 140, 5 unverified ≤ 80). Cut from the end it kept must, should, must, should.
  const S1_RULES = ["target-size", "external-url", "data-block", "font-size", "contrast", "overflow", "nav-link", "motion"];
  const S1_MAX = {
    verdict: "unverified",
    findings: S1_RULES.map((rule, i) => ({ rule, where: ko(80), severity: i % 2 ? "should" : "must", fix: ko(140) })),
    unverified: Array.from({ length: 5 }, () => ko(80)),
  };
  assert.equal(JSON.stringify(S1_MAX).length, 2707, "the fixture is the measured answer");
  const s1 = shaped(S1_MAX);
  assert.deepEqual(rules(s1.json), ["target-size/must", "data-block/must", "contrast/must", "nav-link/must"], "every must kept, in the Service's order");
  assert.equal(s1.json.truncated, true);
  assert.deepEqual(s1.json.cut, { findings_total: 8, findings_kept: 4, dropped: { should: 4 } }, "the cut says what it left out");
  assert.equal(s1.json.output.verdict, "unverified");
  assert.deepEqual(s1.json.output.unverified, S1_MAX.unverified);
  assert.ok(s1.json.output.findings.every((f) => f.fix.length === 140), "kept findings are whole");

  // The musts served last: a cut from the end would drop exactly them. Two shoulds go (the
  // later two), and the four musts stay.
  const lateMust = { verdict: "issues", findings: [...Array.from({ length: 4 }, (_, i) => finding(`s${i}`, "should", i)), ...Array.from({ length: 4 }, (_, i) => finding(`m${i}`, "must", 4 + i))] };
  const late = shaped(lateMust);
  assert.deepEqual(late.json.output.findings.map((f) => f.rule), ["s0", "s1", "m0", "m1", "m2", "m3"]);
  assert.deepEqual(late.json.cut, { findings_total: 8, findings_kept: 6, dropped: { should: 2 } });
  // Negative control (the instrument tells the two rules apart): the same answer with no
  // severities is cut from the end, the A4 rule, and loses the last two, the musts' places.
  const unranked = { verdict: "issues", findings: lateMust.findings.map(({ severity, ...f }) => f) };
  const u = shaped(unranked);
  assert.deepEqual(u.json.output.findings.map((f) => f.rule), ["s0", "s1", "s2", "s3", "m0", "m1"]);
  assert.deepEqual(u.json.cut.dropped, { other: 2 });

  // could goes before should, unranked before could, and the later one first within a severity.
  const mixed = {
    verdict: "issues",
    findings: [
      finding("a", "could", 0), finding("b", "must", 1), finding("c", "should", 2), finding("d", "high", 3),
      finding("e", "could", 4), finding("f", "should", 5), finding("g", "must", 6), finding("h", "could", 7),
    ],
  };
  const m = shaped(mixed);
  const keptRules = m.json.output.findings.map((f) => f.rule);
  assert.ok(!keptRules.includes("d"), "an unranked finding goes first");
  const rank = { must: 0, should: 1, could: 2 };
  const keptWorst = Math.max(...m.json.output.findings.map((f) => rank[f.severity] ?? 3));
  const droppedBest = Math.min(...mixed.findings.filter((f) => !keptRules.includes(f.rule)).map((f) => rank[f.severity] ?? 3));
  assert.ok(droppedBest >= keptWorst, `nothing dropped outranks anything kept (${keptRules.join(",")})`);
  assert.deepEqual(keptRules, [...keptRules].sort(), "the Service's order is kept");
  const cutCount = Object.values(m.json.cut.dropped).reduce((a, b) => a + b, 0);
  assert.equal(cutCount, 8 - m.json.output.findings.length, "the marker counts every dropped finding");
  // Within `could`, a, e, h: the later ones go first, so a cut that keeps one could keeps `a`.
  const coulds = keptRules.filter((r) => ["a", "e", "h"].includes(r));
  assert.deepEqual(coulds, ["a", "e", "h"].slice(0, coulds.length));
  assert.deepEqual(keptRules, ["a", "b", "c", "e", "f", "g"], "the unranked one, then the last could");
  assert.deepEqual(m.json.cut.dropped, { could: 1, other: 1 });
  // Deeper: with five unverified lines the cut takes every could before any should.
  const deep = shaped({ ...mixed, unverified: Array.from({ length: 5 }, () => ko(80)) });
  assert.deepEqual(rules(deep.json), ["b/must", "c/should", "f/should", "g/must"]);
  assert.deepEqual(deep.json.cut, { findings_total: 8, findings_kept: 4, dropped: { could: 3, other: 1 } });

  // Positive control: an answer that fits goes whole, exactly as before (no marker).
  const REVIEW = { verdict: "issues", findings: [{ rule: "contrast", where: "#hero .cta", severity: "must", fix: "글자색을 더 진하게" }, { rule: "alt", where: "img.logo", severity: "should", fix: "alt 추가" }], unverified: ["390px 실제 화면"] };
  const small = C.consultSuccessText(AGENT, bodyOf(REVIEW));
  assert.equal(small, JSON.stringify({ ok: true, agent: "design-reviewer", title: "검토 도우미", version: "1.0.0", model: "Claude Haiku 5.5", request_id: "req_0123456789abcdef", output: REVIEW }));

  // Only musts and still too long: the general cut, marked with the real count.
  const allMust = { verdict: "issues", findings: Array.from({ length: 40 }, (_, i) => finding("contrast", "must", i)) };
  const am = shaped(allMust);
  assert.equal(am.json.truncated, true);
  assert.ok(am.json.output.findings.length >= 1 && am.json.output.findings.length < 40);
  assert.deepEqual(am.json.cut, { findings_total: 40, findings_kept: am.json.output.findings.length, dropped: { must: 40 - am.json.output.findings.length } });

  // An answer without findings (the advisor's plan) is cut the general way, as before: no `cut`.
  const plan = { diagnosis: ko(300), plan: Array.from({ length: 30 }, (_, i) => ({ step: `${i} ${ko(90)}` })), stop: false };
  const p = shaped(plan);
  assert.equal(p.json.truncated, true);
  assert.equal("cut" in p.json, false);

  // Never past the cap, whatever the mix.
  for (const n of [1, 2, 5, 9, 17]) {
    for (const fixLen of [10, 140, 600]) {
      const out = { verdict: "issues", findings: Array.from({ length: n }, (_, i) => ({ rule: `r${i}`, where: ko(80), severity: ["must", "should", "could", "x"][i % 4], fix: ko(fixLen) })), unverified: [ko(80)] };
      shaped(out);
    }
  }
  ok("a cut answer keeps must before should before could (unranked first, later first), in the Service's order, marked with what it left out; the S1 maximum keeps all 4 musts (was 2 of 4); an answer that fits goes whole");

  // Through the consult handler: the coach sees the musts, the timeline counts all eight.
  const { parseServedRoster } = await import("../src/agentRoster.ts");
  const roster = parseServedRoster({
    format: "hps-agent-roster/1", id: "homepage", version: "1.0.0", checks: ["site_check"],
    agents: [
      { name: "coach", title: "코치", role: "coach" },
      { name: "design-reviewer", title: "검토 도우미", role: "helper", trigger: "coach_consult", context: ["learner_goal"], caps: { per_turn: 1, per_session: 6 }, enabled: true, model: { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" } },
    ],
  }).roster;
  const events = [];
  const res = await C.runConsult({
    roster, profile: { game: { template_tier: "website" } }, session: new C.OrchestratorSession(), seatKey: "seat-a5-sev",
    gateway: { url: "https://api.example.test/v1", token: "t0ken" },
    fetch: async () => new Response(JSON.stringify(bodyOf(S1_MAX)), { status: 200, headers: { "content-type": "application/json" } }),
    emit: (e) => events.push(e),
  }, { agent: "design-reviewer", question: "첫 화면을 검토해 주세요" });
  const tool = JSON.parse(res.content[0].text);
  assert.deepEqual(rules(tool), ["target-size/must", "data-block/must", "contrast/must", "nav-link/must"]);
  assert.equal(events.at(-1).label, "🔎 검토 도우미 · Claude Haiku 5.5 — 고칠 곳 8개");
  ok("consult: the S1 maximum reaches the coach with its 4 musts and the cut marker; the timeline line counts all 8 findings");
}

// ── 4. The switch, as the panel reads it; the consultHelper approval path (spec §5.1) ─

{
  const P = await provider();
  // The panel's switch is A4's: on for an adult with a well-formed roster, off for everything else.
  for (const [name, seat] of Object.entries(SEATS)) {
    const roster = P.orchestratorRosterFor(seat);
    assert.equal(roster ? `${roster.id}@${roster.version}` : null, name === "adultRoster" ? "homepage@1.0.0" : null, name);
  }
  assert.equal(P.orchestratorRosterFor(null), null);

  const { readFileSync } = await import("node:fs");
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const setting = manifest.contributes.configuration.properties["hypeproofChat.requireApprovalFor"];
  // VS Code serves the manifest default whenever the user has not set one (#499).
  const settings = {};
  fakeVscode.workspace.getConfiguration = () => ({ get: (key, fallback) => (key in settings ? settings[key] : key === "requireApprovalFor" ? setting.default : fallback) });
  const modals = [];
  let pick;
  fakeVscode.window.showWarningMessage = async (message, options, ...buttons) => {
    modals.push({ message, options, buttons });
    return pick;
  };
  const host = { coachDisplayName: () => "코치", cachedProfile: SEATS.adultRoster };
  const approve = async (req) => {
    let prompted = 0;
    const approved = await P.ChatPanelProvider.prototype.resolveActionApproval.call(host, { requestId: "r1", ...req }, () => prompted++);
    return { approved, prompted };
  };
  const consult = { kind: "consultHelper", description: "도우미에게 묻기 (design-reviewer): 첫 화면을 검토해 주세요", payload: { agent: "design-reviewer", question: "첫 화면을 검토해 주세요" } };

  // The default policy: no modal, allowed, and the actor is the policy (nothing was prompted).
  assert.equal(setting.default.includes("consultHelper"), false);
  assert.deepEqual(await approve(consult), { approved: true, prompted: 0 });
  assert.equal(modals.length, 0);
  // Control: the instrument does see a modal for a kind the default lists.
  pick = "맡기기";
  assert.deepEqual(await approve({ kind: "delegateAgent", description: "코드리뷰어에게 위임: 검토", payload: {} }), { approved: true, prompted: 1 });
  assert.equal(modals.length, 1);

  // A machine that lists consultHelper gets one modal per consult, naming the helper and its model.
  settings.requireApprovalFor = [...setting.default, "consultHelper"];
  pick = "묻기";
  assert.deepEqual(await approve(consult), { approved: true, prompted: 1 });
  const m = modals.at(-1);
  assert.equal(m.options.modal, true);
  assert.deepEqual(m.buttons, ["묻기"]);
  assert.equal(
    m.message,
    "코치가 도우미에게 물어보려고 해요:\n\n검토 도우미 · Claude Haiku 5.5에게: 첫 화면을 검토해 주세요\n\n도우미는 대화 기록 없이 작업 파일의 일부만 보고, 파일을 고치지 않아요.",
  );
  pick = undefined; // Esc or the close box
  assert.deepEqual(await approve(consult), { approved: false, prompted: 1 });
  // A name the roster does not know is shown as it came (the handler refuses it anyway).
  pick = "묻기";
  await approve({ ...consult, payload: { agent: "ghost", question: "누구세요" } });
  assert.match(modals.at(-1).message, /\n\nghost에게: 누구세요\n\n/);
  // No roster on this seat (an old profile): the wire id, never an invented title.
  host.cachedProfile = SEATS.adultOld;
  await approve(consult);
  assert.match(modals.at(-1).message, /\n\ndesign-reviewer에게: 첫 화면을 검토해 주세요\n\n/);
  delete settings.requireApprovalFor;
  fakeVscode.window.showWarningMessage = async () => undefined;
  ok("consultHelper: allowed without a modal by default (control: delegateAgent still asks); a machine that lists it asks once per consult, naming 검토 도우미 · Claude Haiku 5.5 and the question; Esc denies");
}

// ── 5. The site check's page (spec §6.1): 390 and 1280 measured, the preview untouched ─

{
  const { SiteCheckViewports, isViewportWrapperUrl } = await import("../src/browserMcp.ts");
  const { runSiteCheck } = await import("../src/siteCheckRunner.ts");
  const { siteCheckTimelineLabel } = await import("../src/siteCheck.ts");
  const LIVE = "http://127.0.0.1:5173/";
  const WRAPPER = "http://127.0.0.1:5173/__hp_viewport?path=%2Findex.html";
  /** One measured width, in the shape A3's script returns (as test/site-check-runner.smoke.mjs). */
  const W = (w, extra = {}) => ({
    w, inner: w, scroll: w, root_clips: false, offenders: [], offender_count: 0, clipped: 0,
    viewport_meta: true, img_without_alt: 0, external_urls: 0, external_hosts: [], body_font_px: 16,
    small_targets: 0, small_target_sample: [], ...extra,
  });
  const GOOD = { path: "/index.html", widths: [W(390), W(1280)] };
  const OVERFLOW = { path: "/index.html", widths: [W(390, { scroll: 512, offenders: ["table.prices", ".hero h1"], offender_count: 2 }), W(1280)] };

  /**
   * A scripted integrated browser. A tab has a page; a new tab shows about:blank for
   * `loadAfter` location reads, then the URL it was opened at, loaded. Everything that touches
   * a tab is logged, so "the learner's preview was never touched" is countable.
   */
  function browser({ measure = GOOD, loadAfter = 2, neverLoads = false, openFails = false, attachFails = false, learnerWrapper = false } = {}) {
    const log = [];
    const tabs = [{ name: "preview", url: LIVE, ready: "complete" }];
    if (learnerWrapper) tabs.push({ name: "learner-wrapper", url: WRAPPER, ready: "complete" });
    let openedSeq = 0;
    let openNow = 0;
    let maxOpen = 0;
    const port = {
      tabs: () => tabs.filter((t) => !t.closed),
      urlOf: (t) => t.url,
      async open(url, ...rest) {
        log.push(["open", url, ...rest]);
        if (openFails) throw new Error("the shell refused to open a tab");
        const t = { name: `check-${++openedSeq}`, url: "about:blank", target: url, ready: "complete", reads: 0, temp: true };
        tabs.push(t);
        maxOpen = Math.max(maxOpen, ++openNow);
        return t;
      },
      async close(t) {
        log.push(["close", t.name]);
        if (!t.closed && t.temp) openNow--;
        t.closed = true;
      },
      async attach(t) {
        log.push(["attach", t.name]);
        if (attachFails) throw new Error("CDP: no page target to attach to");
        return {
          async send(method, params = {}) {
            log.push([method + (params.awaitPromise ? "(measure)" : ""), t.name]);
            if (method === "Runtime.evaluate" && !params.awaitPromise) {
              if (t.temp && !neverLoads && ++t.reads > loadAfter) {
                t.url = t.target;
                t.ready = "complete";
              } else if (t.temp && t.url === "about:blank") {
                t.ready = t.reads > 1 ? "complete" : "loading";
              }
              return { result: { type: "string", value: JSON.stringify({ href: t.url, ready: t.ready }) } };
            }
            if (method === "Page.navigate") {
              t.url = params.url;
              return { frameId: "f" };
            }
            if (method === "Runtime.evaluate" && params.awaitPromise) return { result: { type: "object", value: structuredClone(measure) } };
            throw new Error(`unexpected CDP ${method}`);
          },
          async close() {
            log.push(["detach", t.name]);
          },
        };
      },
    };
    const touched = (name) => log.filter((e) => e[1] === name || e[2] === name);
    return { port, log, tabs, touched, maxOpen: () => maxOpen, openNow: () => openNow };
  }
  const fast = { pollMs: 5, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };
  const checkWith = (b, opts = fast) => {
    const pages = new SiteCheckViewports(b.port, opts);
    return { pages, run: (path = "index.html") => runSiteCheck({ livePreviewUrl: async () => LIVE, viewportPage: (u) => pages.page(u) }, { path }) };
  };

  // A page with nothing over the edge: measured at both widths in a check tab of its own.
  {
    const b = browser();
    const r = await checkWith(b).run();
    assert.equal(r.verdict, "pass", JSON.stringify(r));
    assert.deepEqual(r.widths.map((w) => [w.w, w.measured]), [[390, true], [1280, true]]);
    assert.equal(siteCheckTimelineLabel(r), "📏 390·1280px 확인 — 통과");
    const opens = b.log.filter((e) => e[0] === "open");
    assert.deepEqual(opens.map((e) => e[1]), [WRAPPER], "one tab, at the wrapper of the checked page");
    assert.deepEqual(b.touched("preview"), [], "the learner's preview tab is never attached, read or navigated");
    assert.equal(b.log.filter((e) => e[0] === "Page.navigate").length, 0, "the check tab opened at the wrapper: nothing to navigate");
    assert.deepEqual(b.log.slice(-2), [["detach", "check-1"], ["close", "check-1"]], "the session and the check tab go when the check is over");
    assert.equal(b.openNow(), 0);
  }
  // The page is handed over only once the wrapper has loaded (a slow tab: five blank reads).
  {
    const b = browser({ loadAfter: 5 });
    const page = await new SiteCheckViewports(b.port, fast).page(WRAPPER);
    const tab = b.tabs.find((t) => t.temp);
    assert.equal(tab.url, WRAPPER, "loaded when handed over");
    assert.equal(b.log.filter((e) => e[0] === "Runtime.evaluate").length, 6, "five reads of about:blank, then the wrapper");
    await page.release();
    assert.equal(tab.closed, true);
  }
  // The planted overflow fails, with its offenders, through the same page.
  {
    const b = browser({ measure: OVERFLOW });
    const r = await checkWith(b).run();
    assert.equal(r.verdict, "fail");
    assert.deepEqual(r.fail_reasons, ["overflow@390"]);
    assert.equal(siteCheckTimelineLabel(r), "📏 390px에서 2곳 넘침");
    assert.equal(b.openNow(), 0);
  }
  // The learner already shows this page's 화면 크기 검수: measured there, and the tab stays.
  {
    const b = browser({ learnerWrapper: true });
    const r = await checkWith(b).run();
    assert.equal(r.verdict, "pass");
    assert.equal(b.log.filter((e) => e[0] === "open" || e[0] === "close").length, 0, "nothing opened or closed");
    assert.deepEqual(b.log.at(-1), ["detach", "learner-wrapper"]);
    assert.deepEqual(b.touched("preview"), []);
  }
  // Negative control: without the host's page every check is 미확인, never 통과 (A4's floor).
  {
    const r = await runSiteCheck({ livePreviewUrl: async () => LIVE }, { path: "index.html" });
    assert.equal(r.verdict, "unverified");
    assert.equal(siteCheckTimelineLabel(r), "📏 미확인(브라우저 연결 없음)");
  }
  // Only the live server's own wrapper is ever opened.
  {
    const b = browser();
    const pages = new SiteCheckViewports(b.port, fast);
    for (const url of ["https://example.com/__hp_viewport?path=%2Findex.html", "http://127.0.0.1:5173/index.html", "file:///tmp/__hp_viewport", "http://127.0.0.1.evil.test/__hp_viewport", "not a url"]) {
      assert.equal(isViewportWrapperUrl(url), false, url);
      assert.equal(await pages.page(url), null, url);
    }
    assert.equal(isViewportWrapperUrl(WRAPPER), true);
    assert.equal(b.log.length, 0, "a refused address opens nothing");
  }
  // A page that never loads, a tab that cannot be opened, a session that cannot attach:
  // null in time, nothing left open, and the next check still runs.
  {
    const b = browser({ neverLoads: true });
    const pages = new SiteCheckViewports(b.port, { ...fast, readyMs: 120 });
    const t0 = Date.now();
    assert.equal(await pages.page(WRAPPER), null);
    assert.ok(Date.now() - t0 < 1000, "bounded by readyMs");
    assert.equal(b.openNow(), 0, "the check tab is closed");
    const r = await runSiteCheck({ livePreviewUrl: async () => LIVE, viewportPage: (u) => pages.page(u) }, { path: "index.html" });
    assert.equal(r.verdict, "unverified");
    for (const failing of [{ openFails: true }, { attachFails: true }]) {
      const f = browser(failing);
      const p = new SiteCheckViewports(f.port, fast);
      assert.equal(await p.page(WRAPPER), null, JSON.stringify(failing));
      assert.equal(f.openNow(), 0);
      const again = browser();
      assert.equal((await checkWith(again).run()).verdict, "pass");
    }
  }
  // One check page at a time, and a page the runner never releases is released anyway.
  {
    const b = browser();
    const pages = new SiteCheckViewports(b.port, { ...fast, holdMs: 60 });
    const first = await pages.page(WRAPPER);
    assert.ok(first);
    let secondDone = false;
    const second = pages.page(WRAPPER).then((p) => {
      secondDone = true;
      return p;
    });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(secondDone, false, "the second check waits for the first page");
    // The hold timer is unref'd (it must not keep a closing host alive), so this ref'd guard keeps
    // the test's event loop up while the hold releases the first page.
    const p2 = await Promise.race([second, new Promise((_, reject) => setTimeout(() => reject(new Error("the hold never released the first page")), 1000))]);
    assert.ok(p2);
    await p2.release();
    await first.release(); // a late release is harmless
    assert.equal(b.maxOpen(), 1, "never two check tabs at once");
    assert.equal(b.openNow(), 0);
  }
  ok("viewportPage: a background check tab at the wrapper, measured at 390 and 1280 once loaded, then closed; the learner's own 화면 크기 검수 tab is reused and kept; the preview tab is never touched; no host page → 미확인 (control); bad addresses, never-loading pages and failed opens give null with nothing left open; one page at a time; an unreleased page is released");

  // The host's own port (chatPanelProvider → vscode.window.openBrowserTab + CdpSession), through
  // the BrowserMcpHost that runSdkCoach hands to the runner.
  const P = await provider();
  const opened = [];
  /** A raw `vscode.BrowserCDPSession` for a tab: the attach handshake, location reads, the measurement. */
  const rawSession = (tab) => {
    const listeners = new Set();
    return {
      onDidReceiveMessage(l) {
        listeners.add(l);
        return { dispose: () => listeners.delete(l) };
      },
      onDidClose: () => ({ dispose() {} }),
      async sendMessage(msg) {
        const reply = (result) => queueMicrotask(() => [...listeners].forEach((l) => l({ id: msg.id, result, ...(msg.sessionId ? { sessionId: msg.sessionId } : {}) })));
        tab.cdp.push(msg.method + (msg.params?.awaitPromise ? "(measure)" : ""));
        if (msg.method === "Target.setDiscoverTargets") return reply({});
        if (msg.method === "Target.getTargets") return reply({ targetInfos: [{ type: "page", targetId: "T1" }] });
        if (msg.method === "Target.attachToTarget") return reply({ sessionId: "S1" });
        if (msg.method === "Runtime.evaluate" && !msg.params.awaitPromise) return reply({ result: { type: "string", value: JSON.stringify({ href: tab.url, ready: "complete" }) } });
        if (msg.method === "Runtime.evaluate") return reply({ result: { type: "object", value: structuredClone(GOOD) } });
        return reply({});
      },
      async close() {
        tab.detached++;
      },
    };
  };
  const preview = { url: LIVE, title: "우리 동네 빵집", cdp: [], detached: 0, startCDPSession: async () => rawSession(preview), close: async () => {} };
  fakeVscode.window.browserTabs = [preview];
  fakeVscode.window.openBrowserTab = async (url, options) => {
    const tab = { url, title: "화면 크기 검수", cdp: [], detached: 0, closed: false };
    tab.startCDPSession = async () => rawSession(tab);
    tab.close = async () => {
      tab.closed = true;
      fakeVscode.window.browserTabs = fakeVscode.window.browserTabs.filter((t) => t !== tab);
    };
    opened.push({ url, options, tab });
    fakeVscode.window.browserTabs = [...fakeVscode.window.browserTabs, tab];
    return tab;
  };
  const host = {
    siteCheckTabs: new Set(),
    editorChat: undefined,
    liveServer: { currentUrl: () => LIVE },
    coachBrowserTabs: P.ChatPanelProvider.prototype.coachBrowserTabs,
    siteCheckViewports: P.ChatPanelProvider.prototype.siteCheckViewports,
  };
  const mcpHost = P.ChatPanelProvider.prototype.buildBrowserMcpHost.call(host);
  let during = null;
  const realPage = mcpHost.viewportPage.bind(mcpHost);
  const r = await runSiteCheck(
    {
      livePreviewUrl: () => mcpHost.livePreviewUrl(),
      viewportPage: async (u) => {
        const page = await realPage(u);
        during = { held: host.siteCheckTabs.size, coachSees: host.coachBrowserTabs().map((t) => t.title) };
        return page;
      },
    },
    { path: "index.html" },
  );
  assert.equal(r.verdict, "pass", JSON.stringify(r));
  assert.deepEqual(r.widths.map((w) => w.w), [390, 1280]);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].url, WRAPPER);
  // (spread: the options object was made in the bundle's realm, whose Object.prototype differs)
  assert.deepEqual({ ...opened[0].options }, { viewColumn: 1, preserveFocus: true, background: true }, "in the background, without taking focus");
  assert.deepEqual(during, { held: 1, coachSees: ["우리 동네 빵집"] }, "while it runs, the coach's tab logic does not see the check tab");
  assert.equal(opened[0].tab.closed, true, "closed after the check");
  assert.equal(opened[0].tab.detached, 1);
  assert.equal(host.siteCheckTabs.size, 0);
  assert.deepEqual(preview.cdp, [], "the learner's preview got no CDP message");
  assert.ok(opened[0].tab.cdp.includes("Runtime.evaluate(measure)"));
  fakeVscode.window.browserTabs = [];
  ok("host: the BrowserMcpHost's viewportPage opens one background tab without focus at the wrapper, hides it from the coach's tab logic while it runs, measures 390 and 1280 through CdpSession, then detaches and closes it; the preview tab gets no CDP message");
}

console.log(`orchestrator-panel: ${passed} checks passed`);
