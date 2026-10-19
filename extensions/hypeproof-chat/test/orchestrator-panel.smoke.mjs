// A5 (ADR 0011; orchestrator spec §5.1, §5.2, §5.4, §6.3, §13.2 row A5, §14, §15):
// the panel and visibility of the front-line orchestrator.
//
// 1. Old-profile render identity: a /v1/profile answer with no `orchestrator` key renders
//    exactly as it did on Studio main before A5. The real webview components are rendered
//    (as test/sx-render.mjs does) and their markup is compared with digests taken on main
//    (21bd15ba, and fbde0482) with this same file (BASE). A served roster changes nothing on the screen by
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

/** What `fetch` is inside the bundle (the orchestrator's default agent-run transport). */
let bundleFetch = globalThis.fetch;
let providerApi = null;
/** chatPanelProvider's exports plus runSdkCoach, in ONE bundle: one copy of every module. */
async function provider() {
  if (!providerApi) {
    const bundle = await build({
      stdin: {
        contents: `export * from "./src/chatPanelProvider.ts";\nexport { runSdkCoach } from "./src/sdkCoach.ts";\nexport { SdkBusyAbortError } from "./src/sdkCoachHelpers.ts";`,
        resolveDir: new URL("../", import.meta.url).pathname, loader: "ts", sourcefile: "orchestrator-panel-host.ts",
      },
      bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false, logLevel: "silent",
    });
    const module = { exports: {} };
    vm.runInNewContext(bundle.outputFiles[0].text, {
      module, exports: module.exports, require: (id) => (id === "vscode" ? fakeVscode : nodeRequire(id)),
      console, Buffer, process, setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, queueMicrotask,
      AbortSignal, AbortController, URL, URLSearchParams, TextEncoder, TextDecoder, Response, Headers,
      fetch: (...args) => bundleFetch(...args),
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

/**
 * Taken on main before A5 with HPS_A5_RECORD_BASE=1: on 21bd15ba, and again on fbde0482 (#1527, the
 * branch's rebase base), where they were identical. Two runs on each gave the same digests.
 * The four ChatPanel digests were re-taken for trial diagnosis D9 (REQ-L14): the markup differs
 * from the earlier base only in the send button label, "Send" → "보내기" (diffed with HPS_A5_DUMP_DIR).
 * Re-taken again for CGP-CHAT-R-001: the only added markup is the empty response-announcer live
 * region `<div class="hps-sr-only" role="status" aria-live="polite" data-testid="response-announcer"></div>`
 * (diffed with HPS_A5_DUMP_DIR against origin/main).
 */
// Attachment guidance: only the persistent empty attachment-announcer is added;
// stripping that exact element reproduces all nine prior digests.
const BASE = {
  "ChatPanel/adult-plain": "1b432cef21b78698d76e284167581834f3d37b06e59c76e49a5821c9798010ff",
  "ChatPanel/adult-effort-observed": "d726134dde6fe8342e4b2258b5762a414429bcc01f01535913c95e4fa5db7747",
  "ChatPanel/adult-timeline": "6912f0204fb1a88483522bb496bb658bd255bd3370f52162ede3e3799ba132e4",
  "ChatPanel/kids": "fa914b1785cbb3a4fe84468ddfb93da76940cadf5a1c6cd61b81ebb31264aafc",
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
  ok(`old-profile render identity: ${Object.keys(digests).length} screens equal main before A5`);
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

  // A must too long on its own is shortened by the general rule, not dropped by the severity pass
  // (that pass never takes a must: here it would have left no finding at all).
  const longMust = shaped({ verdict: "issues", findings: [{ rule: "contrast", where: "#hero", severity: "must", fix: ko(3000) }, { rule: "alt", where: "img", severity: "must", fix: "alt 추가" }] });
  assert.deepEqual(longMust.json.output.findings.map((f) => f.rule), ["contrast"]);
  assert.ok(longMust.json.output.findings[0].fix.length < 3000 && longMust.json.output.findings[0].fix.endsWith("…"), "shortened, marked with …");
  assert.deepEqual(longMust.json.cut, { findings_total: 2, findings_kept: 1, dropped: { must: 1 } });

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
  // The kind is declared now, so A2's request builder needs no cast (typecheck is the real guard).
  const H = await import("../src/sdkCoachHelpers.ts");
  assert.equal(H.sdkToolToActionRequest({ toolName: "mcp__hypeproof__consult", input: { agent: "design-reviewer", question: "첫 화면을 검토해 주세요" } }).kind, "consultHelper");
  assert.doesNotMatch(readFileSync(new URL("../src/sdkCoachHelpers.ts", import.meta.url), "utf8"), /CONSULT_HELPER_KIND as string as/, "A2's temporary cast is gone");
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

// ── 6. Timeline lines, and the host passed into runSdkCoach (spec §5.2, §14) ──

{
  const P = await provider();
  const E = (event) => P.orchestratorToolEntry(event, "turn-1");
  const plain = (v) => (v === null ? null : { ...v });
  const consult = (state, label, extra = {}) => ({ kind: "consult", id: "consult:c1", agent: "design-reviewer", title: "검토 도우미", model: "Claude Haiku 5.5", state, summary: "", icon: "🔎", label, at: 1000, ...extra });
  const check = (name, verdict, label, icon, path = "index.html") => ({ kind: "check", id: `check:${name}:1`, name, verdict, summary: label, path, state: "done", icon, label, at: 2000 });

  // One line per consult, in place; the icon is drawn by the line, not repeated in the label.
  assert.deepEqual(plain(E(consult("running", "🔎 검토 도우미 · Claude Haiku 5.5 — 묻는 중"))), { id: "consult:c1", icon: "🔎", label: "검토 도우미 · Claude Haiku 5.5 — 묻는 중", state: "running", at: 1000 });
  assert.deepEqual(plain(E(consult("done", "🔎 검토 도우미 · Claude Haiku 5.5 — 고칠 곳 2개"))), { id: "consult:c1", icon: "🔎", label: "검토 도우미 · Claude Haiku 5.5 — 고칠 곳 2개", state: "done", at: 1000 });
  assert.equal(E(consult("error", "🔎 검토 도우미 · Claude Haiku 5.5 — 횟수를 다 씀")).state, "error");
  // The site check: one line per page per turn, the latest verdict in place. `done` whatever the
  // verdict (spec §5.2's table): the label says 통과, 넘침 or 미확인; error is for lines the learner acts on.
  const pass = E(check("site_check", "pass", "📏 390·1280px 확인 — 통과", "📏"));
  const fail = E({ ...check("site_check", "fail", "📏 390px에서 2곳 넘침", "📏"), id: "check:site_check:2" });
  const unverified = E(check("site_check", "unverified", "📏 미확인(미리보기 꺼짐)", "📏"));
  assert.deepEqual([pass.id, fail.id, unverified.id], ["check:site_check:turn-1:index.html", "check:site_check:turn-1:index.html", "check:site_check:turn-1:index.html"]);
  assert.deepEqual([pass.label, fail.label, unverified.label], ["390·1280px 확인 — 통과", "390px에서 2곳 넘침", "미확인(미리보기 꺼짐)"]);
  assert.deepEqual([pass.state, fail.state, unverified.state], ["done", "done", "done"]);
  assert.notEqual(E(check("site_check", "pass", "📏 390·1280px 확인 — 통과", "📏", "about.html")).id, pass.id, "another page, another line");
  assert.notEqual(P.orchestratorToolEntry(check("site_check", "pass", "📏 390·1280px 확인 — 통과", "📏"), "turn-2").id, pass.id, "another turn, another line");
  // The archive: its own line. The diff: none (the coach reads it in the save's result).
  assert.deepEqual(plain(E(check("archive", "archived", "🗂 이전 버전 보관 (.hypeproof/history) — index-20261015-101500.html", "🗂"))), { id: "check:archive:1", icon: "🗂", label: "이전 버전 보관 (.hypeproof/history) — index-20261015-101500.html", state: "done", at: 2000 });
  assert.equal(E(check("diff", "rewrite", "✏️ 저장 비교 — index.html: 기존 내용의 78% 바뀜", "✏️")), null);
  // The busy notice.
  assert.deepEqual(plain(E({ kind: "notice", id: "notice:1", text: "지금 요청이 많아 잠시 기다리는 중이에요. 자동으로 다시 시도합니다.", at: 3000 })), { id: "notice:1", icon: "⏳", label: "지금 요청이 많아 잠시 기다리는 중이에요. 자동으로 다시 시도합니다.", state: "done", at: 3000 });
  // A label without its icon in front is left alone (control for the icon strip).
  assert.equal(E(consult("done", "검토 도우미 — 고칠 곳 없음")).label, "검토 도우미 — 고칠 곳 없음");

  // The learner's goal, as a consult attaches it.
  assert.equal(P.learnerGoalText(null), null);
  assert.equal(P.learnerGoalText({ goal: "  ", criteria: ["x"] }), null);
  assert.equal(P.learnerGoalText({ goal: "영업시간을 혼자 고친다", criteria: [] }), "영업시간을 혼자 고친다");
  assert.equal(P.learnerGoalText({ goal: "영업시간을 혼자 고친다", criteria: ["휴대폰에서 보인다", " ", "정보블록 안만 바뀐다"] }), "영업시간을 혼자 고친다 (완료 기준: 휴대폰에서 보인다 · 정보블록 안만 바뀐다)");

  // One session per seat; another seat starts a new one; 대화 지우기 starts over.
  const seatHost = {};
  const s1 = P.ChatPanelProvider.prototype.orchestratorSessionFor.call(seatHost, "seat-a");
  assert.equal(P.ChatPanelProvider.prototype.orchestratorSessionFor.call(seatHost, "seat-a"), s1);
  const s2 = P.ChatPanelProvider.prototype.orchestratorSessionFor.call(seatHost, "seat-b");
  assert.notEqual(s2, s1);
  const clearHost = {
    ...seatHost, historyKey: () => "h", hasActiveStream: () => false,
    context: { workspaceState: { update: async () => {} } }, post: async () => {}, aiDisclosure: { noticeForHistoryClear: () => "AI" },
  };
  fakeVscode.window.showWarningMessage = async () => undefined;
  await P.ChatPanelProvider.prototype.clearHistory.call(clearHost);
  assert.ok(clearHost.orchestratorState, "cancelled: the session stays");
  fakeVscode.window.showWarningMessage = async () => "대화 지우기";
  await P.ChatPanelProvider.prototype.clearHistory.call(clearHost);
  assert.equal(clearHost.orchestratorState, undefined, "cleared: the next turn starts a new session");
  fakeVscode.window.showWarningMessage = async () => undefined;
  ok("timeline: one consult line in place (icon not repeated), one site-check line per page per turn whose label carries the verdict, one archive line, the busy notice, no diff line; the learner's goal text; one session per seat, reset by 대화 지우기");

  // ── The real runSdkCoach with the panel's host arguments ──
  const { sdkToolToActionRequest } = await import("../src/sdkCoachHelpers.ts");
  const os = await import("node:os");
  const fsm = await import("node:fs");
  const pathm = await import("node:path");
  const scratch = fsm.realpathSync(fsm.mkdtempSync(pathm.join(os.tmpdir(), "hps-a5-panel-")));
  const WS = pathm.join(scratch, "ws");
  fsm.mkdirSync(pathm.join(scratch, "home"), { recursive: true });
  fsm.mkdirSync(WS, { recursive: true });
  fsm.writeFileSync(pathm.join(WS, "index.html"), "<!doctype html><title>빵집</title><section id=\"hours\"><h2>영업시간</h2></section>\n");
  const savedEnv = { ...process.env };
  process.env.HOME = pathm.join(scratch, "home");
  for (const k of ["APPDATA", "USERPROFILE", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "ANTHROPIC_CUSTOM_HEADERS", "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_GATEWAY_HINT_HEADERS", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "CLAUDE_CODE_DISABLE_BACKGROUND_TASKS"]) delete process.env[k];
  const fakeZod = () => {
    const mk = (d) => {
      const s = { __zod: d };
      for (const m of ["min", "max", "optional", "describe"]) s[m] = () => mk(d);
      return s;
    };
    return { string: () => mk("string"), boolean: () => mk("boolean"), number: () => mk("number"), enum: () => mk("enum"), object: () => mk("object"), array: () => mk("array") };
  };
  const REVIEW = { verdict: "issues", findings: [{ rule: "contrast", where: "#hero .cta", severity: "must", fix: "글자색을 더 진하게" }, { rule: "alt", where: "img.logo", severity: "should", fix: "alt 추가" }], unverified: [] };
  const agentRuns = [];
  bundleFetch = async (url, init) => {
    agentRuns.push({ url: String(url), headers: { ...init.headers }, body: String(init.body) });
    return new Response(JSON.stringify({ ok: true, agent: "design-reviewer", version: "1.0.0", model: { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" }, output: REVIEW, request_id: "req_a5" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  // The approval path the panel uses: canUseTool → requestApproval → resolveActionApproval.
  const approvalHost = { coachDisplayName: () => "코치", cachedProfile: null };
  const modals = [];
  fakeVscode.window.showWarningMessage = async (m) => {
    modals.push(m);
    return undefined;
  };
  const turn = async (profile) => {
    approvalHost.cachedProfile = profile;
    const posted = [];
    const seen = {};
    const sdk = {
      createSdkMcpServer: (o) => ({ __server: true, name: o.name, tools: o.tools ?? [] }),
      tool: (name, description, inputSchema, handler) => ({ name, description, inputSchema, handler }),
      query({ options }) {
        seen.options = options;
        return (async function* () {
          const consultTool = options.mcpServers?.hypeproof?.tools?.find((t) => t.name === "consult");
          // (spread into this realm: the bundle made the array, with its own Array.prototype)
          seen.toolNames = [...(options.mcpServers?.hypeproof?.tools ?? [])].map((t) => t.name);
          if (consultTool) {
            const input = { agent: "design-reviewer", question: "첫 화면을 검토해 주세요" };
            seen.decision = await options.canUseTool("mcp__hypeproof__consult", { ...input }, { toolUseID: "toolu_c1", signal: new AbortController().signal });
            seen.result = await consultTool.handler(input, {});
          }
          yield { type: "system", subtype: "init", timestamp: 1 };
          yield { type: "system", subtype: "api_retry", error_status: 429, attempt: 1, max_retries: 10, retry_delay_ms: 1, error: "rate_limit", timestamp: 2 };
          yield { type: "assistant", message: { id: "m1", model: "claude-sonnet-5-5", content: [{ type: "text", text: "검토 도우미가 대비 부족을 짚었어요." }], usage: { input_tokens: 1, output_tokens: 1 } }, timestamp: 3 };
          yield { type: "result", subtype: "success", stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0, timestamp: 4 };
        })();
      },
    };
    const token = "hps-token-a5";
    // runSdkCoach logs where the binary came from, and A4 D14's line for a refused roster.
    const { info, warn } = console;
    const logged = [];
    console.info = (...a) => logged.push(a.join(" "));
    console.warn = (...a) => logged.push(a.join(" "));
    seen.logged = logged;
    const end = await P.runSdkCoach({
      gatewayUrl: "https://api.hypeproof-ai.xyz/v1", token, model: "claude-sonnet-5-5", turnId: "11111111-2222-4333-8444-555555555555",
      profile, systemPrompt: "", history: [], userText: "홈페이지 첫 화면을 검토해 줘", signal: new AbortController().signal, cwd: WS,
      stallTimeoutMs: 0, binaryResolution: { available: true, source: "setting", path: "/opt/claude", reasons: [] }, sdk, zod: fakeZod(),
      onDelta: () => {}, onCitations: () => {}, onAssetScore: () => {},
      // As chatPanelProvider's runSdkCoach call does it (sdkToolToActionRequest is pure).
      requestApproval: async (action) => {
        let prompted = false;
        const approved = await P.ChatPanelProvider.prototype.resolveActionApproval.call(approvalHost, { requestId: "r", ...sdkToolToActionRequest(action) }, () => { prompted = true; });
        return { approved, actor: prompted ? "user" : "policy" };
      },
      orchestrator: P.orchestratorHostArgs({
        session: P.ChatPanelProvider.prototype.orchestratorSessionFor.call(seatHost, `seat:${profile.profile_id}`),
        turnId: "11111111-2222-4333-8444-555555555555",
        post: (entry) => posted.push({ ...entry }),
        learnerGoal: () => P.learnerGoalText({ goal: "영업시간을 혼자 고친다", criteria: [] }),
      }),
    }).finally(() => {
      console.info = info;
      console.warn = warn;
    });
    const headers = String(seen.options.env.ANTHROPIC_CUSTOM_HEADERS ?? "").split("\n").filter(Boolean);
    return { end, posted, seen, headers };
  };
  try {
    const on = await turn(SEATS.adultRoster);
    assert.equal(on.end.failed, false);
    // Every CLI request of the turn carries the coach's label and the roster (A2 env, spec §4.1).
    assert.ok(on.headers.includes("x-hps-agent: coach@1.0.0"), on.headers.join(" | "));
    assert.ok(on.headers.includes("x-hps-roster: homepage@1.0.0"));
    assert.ok(on.headers.includes("x-hps-orchestrator: hps-agent-roster/1"));
    // The consult: allowed by the panel's own approval path without a modal, then one agent run.
    assert.deepEqual(on.seen.toolNames.filter((n) => n === "consult"), ["consult"]);
    assert.equal(on.seen.decision.behavior, "allow");
    assert.equal(modals.length, 0, "no modal for a consult by default");
    assert.equal(agentRuns.length, 1);
    assert.equal(agentRuns[0].url, "https://api.hypeproof-ai.xyz/v1/agents/design-reviewer/run", "the helper request names its agent");
    assert.match(agentRuns[0].headers["x-hps-agent-call"], /^[0-9a-f-]{36}$/);
    assert.equal(JSON.parse(agentRuns[0].body).context.learner_goal, "영업시간을 혼자 고친다", "the panel's goal reaches the declared context");
    assert.equal(JSON.parse(on.seen.result.content[0].text).ok, true);
    // The timeline: the consult line, running then done in place, and the busy notice.
    const lines = on.posted.map((e) => `${e.icon} ${e.label} [${e.state}]`);
    assert.deepEqual(lines, [
      "🔎 검토 도우미 · Claude Haiku 5.5 — 묻는 중 [running]",
      "🔎 검토 도우미 · Claude Haiku 5.5 — 고칠 곳 2개 [done]",
      "⏳ 지금 요청이 많아 잠시 기다리는 중이에요. 자동으로 다시 시도합니다. [done]",
    ]);
    assert.equal(on.posted[0].id, on.posted[1].id);

    // Negative controls: the same host arguments on an old profile, a minor or a disabled roster
    // change nothing: no label, no consult tool, no request, no line.
    for (const name of ["adultOld", "adultDisabled", "kidsRoster", "minorFlagRoster", "unknownTierRoster"]) {
      const before = agentRuns.length;
      const off = await turn(SEATS[name]);
      assert.equal(off.headers.some((h) => /^x-hps-(agent|roster|orchestrator):/.test(h)), false, `${name}: no orchestrator header`);
      assert.equal((off.seen.toolNames ?? []).includes("consult"), false, `${name}: no consult tool`);
      assert.equal(agentRuns.length, before, `${name}: no agent run`);
      assert.deepEqual(off.posted, [], `${name}: no orchestrator line`);
      // A roster served to a minor is a Service bug, and it leaves a trace (A4 D14); none for an old profile.
      const traced = off.seen.logged.some((l) => l.includes("served orchestrator roster not used"));
      assert.equal(traced, ["kidsRoster", "minorFlagRoster", "unknownTierRoster"].includes(name), `${name}: trace`);
    }
  } finally {
    bundleFetch = globalThis.fetch;
    fakeVscode.window.showWarningMessage = async () => undefined;
    for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
    Object.assign(process.env, savedEnv);
    fsm.rmSync(scratch, { recursive: true, force: true });
  }
  ok("runSdkCoach with the panel's host arguments: every CLI request labelled coach@1.0.0 with the roster, the consult allowed by the panel's approval path without a modal and sent as one design-reviewer run with a call id and the learner's goal, the timeline's consult line in place plus the busy notice; the same arguments on an old profile, a disabled roster, kids, a minor flag or an unknown tier add nothing");

  // The turn itself passes them. handleSend cannot run here, so its one runSdkCoach call is read
  // as source: the switch needs the host's argument (A4 D1), and without it nothing above runs.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
  const call = (s) => {
    const at = s.indexOf("const sdkEnd = await runSdkCoach({");
    return at < 0 ? "" : s.slice(at, s.indexOf("\n          });", at));
  };
  const WIRED = /\n\s*orchestrator: orchestratorHostArgs\(\{\s*session: this\.orchestratorSessionFor\(coachSeatKeyFor\(\{ token, profile \}\)\),\s*turnId: streamId,\s*post: \(entry\) => this\.postToolLog\(streamId, entry\),/;
  assert.match(call(src), WIRED, "the student SDK turn passes the orchestrator host");
  assert.equal((src.match(/await runSdkCoach\(\{/g) ?? []).length, 1, "one SDK turn call site");
  assert.doesNotMatch(call(src.replace(/\n\s*orchestrator: orchestratorHostArgs\(/, "\n            orchestratorOff: orchestratorHostArgs(")), WIRED, "planted: a turn without the host is caught");
  // An orchestrator seat reads the per-request record whatever its effort policy (the details list).
  assert.match(src, /if \(token && profile && \(selection\?\.choices\.some\(c=>c\.effort\) \|\| orchestratorRosterFor\(profile\)\)\) \{\s*this\.effortTurn = /);
  ok("the student SDK turn's runSdkCoach call passes orchestratorHostArgs with the seat's session, its turn and its timeline (control: a planted removal is caught); orchestrator seats fetch the per-request record");

  // A2's bounded busy wait ends the turn with SdkBusyAbortError: the generic banner shows its
  // Korean line (it is not an abort, so it is not swallowed as the learner's own stop).
  const banners = [];
  const errHost = { post: async (m) => banners.push({ ...m }), lastRequestId: undefined };
  await P.ChatPanelProvider.prototype.handleSendError.call(errHost, new P.SdkBusyAbortError(429), "s-busy");
  assert.equal(banners.length, 1);
  assert.equal(banners[0].type, "streamError");
  assert.equal(banners[0].error, "지금 사용하는 사람이 많아 답을 받지 못했어요. 30초 뒤에 다시 보내 주세요. 작업 파일은 그대로 있어요.");
  // Control: a real abort (the learner pressed stop) shows nothing.
  const abort = new Error("aborted");
  abort.name = "AbortError";
  await P.ChatPanelProvider.prototype.handleSendError.call(errHost, abort, "s-stop", { signal: AbortSignal.abort() });
  assert.equal(banners.length, 1);
  ok("SdkBusyAbortError reaches the learner as the generic banner with its Korean line (control: a stop shows none)");
}

// ── 7. The adult archive before revealBuilt overwrites index.html (spec §6.3, FO-10) ─

{
  const P = await provider();
  const os = await import("node:os");
  const fsm = await import("node:fs");
  const pathm = await import("node:path");
  const scratch = fsm.realpathSync(fsm.mkdtempSync(pathm.join(os.tmpdir(), "hps-a5-archive-")));
  const OLD = "<!doctype html><html lang=\"ko\"><title>빵집</title><p>예전 영업시간</p></html>\n";
  const NEW = "<!doctype html><html lang=\"ko\"><title>빵집</title><p>새 영업시간</p></html>\n";
  /** A workspace with the learner's page, and a host whose save records what was archived by then. */
  const seat = (profile, name) => {
    const ws = pathm.join(scratch, name);
    fsm.mkdirSync(ws, { recursive: true });
    fsm.writeFileSync(pathm.join(ws, "index.html"), OLD);
    const order = [];
    const lines = [];
    const history = () => {
      try {
        return fsm.readdirSync(pathm.join(ws, ".hypeproof", "history"));
      } catch {
        return null;
      }
    };
    const host = {
      cachedProfile: profile,
      opsLastArtifact: undefined,
      lastArchivedWorldFile: null,
      postToolLog: (_streamId, entry) => {
        lines.push({ ...entry });
        order.push(`line:${entry.icon}`);
      },
      surfaceStructureIssues: () => order.push("structure"),
      archiveCurrentWorld: async () => {
        order.push("world-archive");
        return null;
      },
      archiveAdultPage: P.ChatPanelProvider.prototype.archiveAdultPage,
      saveEngineToWorkspace: async () => order.push("engine"),
      saveGameToWorkspace: async (html) => {
        const kept = history();
        order.push(`save(archived=${kept ? kept.length : "none"})`);
        fsm.writeFileSync(pathm.join(ws, "index.html"), html);
      },
      isLiveServerPreview: () => false,
      openInLiveServer: async () => false,
      inlineEngineIfNeeded: async (html) => html,
      preview: { show: () => order.push("preview") },
    };
    const reveal = (html, opts) => {
      fakeVscode.workspace.workspaceFolders = [{ uri: { fsPath: ws } }];
      return P.ChatPanelProvider.prototype.revealBuilt.call(host, html, opts);
    };
    return { ws, host, order, lines, history, reveal };
  };
  try {
    // An adult orchestrator seat: the old page is copied before the save overwrites it.
    const a = seat(SEATS.adultRoster, "adult");
    assert.equal(await a.reveal(NEW, { streamId: "turn-a", artifactSource: "assistant_response" }), true);
    assert.deepEqual(a.order, ["line:🖼️", "line:🗂", "save(archived=1)", "preview", "line:🖼️"], "archived (with its line) before the save");
    const kept = a.history();
    assert.equal(kept.length, 1);
    assert.match(kept[0], /^index-\d{8}-\d{6}\.html$/);
    assert.equal(fsm.readFileSync(pathm.join(a.ws, ".hypeproof", "history", kept[0]), "utf8"), OLD, "the copy is the page as it was");
    assert.equal(fsm.readFileSync(pathm.join(a.ws, "index.html"), "utf8"), NEW);
    const archiveLine = a.lines.find((l) => l.icon === "🗂");
    assert.equal(archiveLine.label, `이전 버전 보관 (.hypeproof/history) — ${kept[0]}`);
    assert.equal(archiveLine.state, "done");
    // The same page again (the coach's own Write already saved it): nothing new is kept.
    a.order.length = 0;
    await a.reveal(NEW, { streamId: "turn-a", artifactSource: "assistant_tool" });
    assert.equal(a.history().length, 1);
    assert.deepEqual(a.order, ["line:🖼️", "save(archived=1)", "preview", "line:🖼️"], "no archive line for an identical page");
    // ▶ Run (no turn): the page is still kept, and no line is drawn anywhere.
    const run = seat(SEATS.adultRoster, "adult-run");
    await run.reveal(NEW, { artifactSource: "manual_preview" });
    assert.equal(run.history().length, 1);
    assert.equal(run.lines.length, 0);
    // A blocked page never reaches the save, so nothing is archived for it.
    const blocked = seat(SEATS.adultRoster, "adult-blocked");
    assert.equal(await blocked.reveal("<!doctype html><p>a</p><!-- 닫히지 않은 주석", { streamId: "turn-b" }), false);
    assert.equal(blocked.history(), null);

    // Never for minors or unknown tiers, and never without the roster (or its archive check).
    const noArchiveCheck = { ...ADULT, orchestrator: { ...ROSTER, checks: ["site_check", "diff_guard"] } };
    const worldKids = { profile_id: "kids-quest-s1", game: { template_tier: "kids-quest" }, minor_cohort: true, orchestrator: ROSTER };
    for (const [name, profile] of Object.entries({ ...SEATS, noArchiveCheck, worldKids })) {
      if (name === "adultRoster") continue;
      const s = seat(profile, `off-${name}`);
      await s.reveal(NEW, { streamId: "turn-c", artifactSource: "assistant_response" });
      assert.equal(s.history(), null, `${name}: no .hypeproof/history`);
      assert.equal(fsm.existsSync(pathm.join(s.ws, ".hypeproof")), false, `${name}: no .hypeproof at all`);
      assert.equal(s.lines.some((l) => l.icon === "🗂"), false, `${name}: no archive line`);
      assert.equal(fsm.readFileSync(pathm.join(s.ws, "index.html"), "utf8"), NEW, `${name}: the save itself still happens`);
      assert.equal(s.order.includes("world-archive"), name === "worldKids", `${name}: the kids' own world archive runs only for a world cohort`);
    }
  } finally {
    fakeVscode.workspace.workspaceFolders = undefined;
    fsm.rmSync(scratch, { recursive: true, force: true });
  }
  ok("revealBuilt: on an adult orchestrator seat the old index.html is copied to .hypeproof/history before the save, with one 🗂 line (identical pages and blocked pages keep nothing; ▶ Run keeps it without a line); never for kids, a minor flag, an unknown tier, an old profile, a disabled roster or a roster without the archive check, while the save itself is unchanged");
}

// ── 8. The details list names each request's agent; the lines render as designed (spec §5.2) ─

if (status.available) {
  const { visibleText } = await import("./sx-render.mjs");
  const row = (over) => ({ request_id: `req_${Math.random().toString(16).slice(2, 10)}`, model: "claude-sonnet-5-5", requested: null, applied: "medium", reason: "course_default", status: 200, created_at: "2026-10-15T02:00:00Z", ...over });
  const ATTRIBUTED = [
    row({ request_id: "r_coach", agent: "coach", agent_title: "코치", request_class: "main" }),
    row({ request_id: "r_rev", agent: "design-reviewer", agent_title: "검토 도우미", model: "claude-haiku-5-5", applied: "low", reason: "selected" }),
    row({ request_id: "r_aux", agent: "aux", request_class: "auxiliary", model: "claude-haiku-5-5", applied: null, reason: "unsupported_model" }),
    row({ request_id: "r_untitled", agent: "design-reviewer", model: "claude-haiku-5-5", applied: "low", reason: "selected", status: 502 }),
  ];
  const effortProps = (requests, profileOver = {}) => ({
    config: adultConfig({ effort: POLICY, effortResult: { state: "observed", requests }, profile: { ...adultConfig().profile, ...profileOver } }),
    post() {},
  });
  const items = (html) => [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => visibleText(m[1]));
  const html = await render("EffortControl", effortProps(ATTRIBUTED, { orchestrator: ROSTER }));
  assert.deepEqual(items(html), [
    "코치 · Claude Sonnet 5.5: 요청 수업 기본값 → 적용 Medium · 수업 기본값",
    "검토 도우미 · Claude Haiku 5.5: 요청 수업 기본값 → 적용 Low",
    "보조 작업 · Claude Haiku 5.5: 요청 수업 기본값 → 적용 처리 수준 미지원",
    "검토 도우미 · Claude Haiku 5.5: 요청 수업 기본값 → 적용 Low · 요청 실패",
  ], "one agent label per request, before the model (spec §5.2's copy)");
  assert.deepEqual([...html.matchAll(/data-agent="([^"]+)"/g)].map((m) => m[1]), ["coach", "design-reviewer", "aux", "design-reviewer"]);
  assert.match(html, /<details><summary>Effort 설정 확인<\/summary>/, "closed until opened: visible on demand");
  // The untitled row took its title from the served roster; without the roster it shows the wire name.
  assert.equal(items(await render("EffortControl", effortProps([ATTRIBUTED[3]])))[0], "design-reviewer · Claude Haiku 5.5: 요청 수업 기본값 → 적용 Low · 요청 실패");
  // A helper model the learner's menu does not list is named by the roster, else by its id (as before).
  const noHaiku = { model_selection: { ...MODEL_SELECTION, choices: [CHOICES[0]] } };
  assert.match(items(await render("EffortControl", effortProps([ATTRIBUTED[1]], { ...noHaiku, orchestrator: ROSTER })))[0], /^검토 도우미 · Claude Haiku 5\.5:/);
  assert.match(items(await render("EffortControl", effortProps([ATTRIBUTED[1]], noHaiku)))[0], /^검토 도우미 · claude-haiku-5-5:/);
  // Negative control: the same rows without the agent fields read exactly as today.
  const bare = ATTRIBUTED.map(({ agent, agent_title, request_class, ...r }) => r);
  assert.deepEqual(items(await render("EffortControl", effortProps(bare, { orchestrator: ROSTER }))), [
    "Claude Sonnet 5.5: 요청 수업 기본값 → 적용 Medium · 수업 기본값",
    "Claude Haiku 5.5: 요청 수업 기본값 → 적용 Low",
    "Claude Haiku 5.5: 요청 수업 기본값 → 적용 처리 수준 미지원",
    "Claude Haiku 5.5: 요청 수업 기본값 → 적용 Low · 요청 실패",
  ]);
  assert.doesNotMatch(await render("EffortControl", effortProps(bare)), /data-agent/);
  // A served roster changes no screen by itself (it is labels for attributed rows, never UI):
  // every old screen, with the roster or its disabled form added, still equals main.
  for (const served of [ROSTER, { enabled: false, reason: "flag_off" }]) {
    for (const [name, make] of Object.entries(OLD_SCREENS)) {
      const [component, props] = make();
      const withServed = { ...props, config: { ...props.config, profile: { ...props.config.profile, orchestrator: served } } };
      assert.equal(sha(await render(component, withServed)), BASE[name], `${name} with orchestrator=${served.enabled === false ? "disabled" : "roster"}`);
    }
  }
  // The timeline draws the host's lines as designed (spec §5.2 examples), through ChatPanel.
  const P = await provider();
  const toMessage = (entry, i) => ({ id: entry.id, role: "tool", content: "", createdAt: i + 1, tool: { icon: entry.icon, label: entry.label, state: entry.state } });
  const entries = [
    P.orchestratorToolEntry({ kind: "consult", id: "consult:c1", agent: "design-reviewer", title: "검토 도우미", model: "Claude Haiku 5.5", state: "done", summary: "고칠 곳 2개", icon: "🔎", label: "🔎 검토 도우미 · Claude Haiku 5.5 — 고칠 곳 2개", at: 1 }, "t"),
    P.orchestratorToolEntry({ kind: "check", id: "check:s1", name: "site_check", verdict: "pass", summary: "", path: "index.html", state: "done", icon: "📏", label: "📏 390·1280px 확인 — 통과", at: 2 }, "t"),
    P.orchestratorToolEntry({ kind: "check", id: "check:s2", name: "site_check", verdict: "fail", summary: "", path: "about.html", state: "done", icon: "📏", label: "📏 390px에서 2곳 넘침", at: 3 }, "t"),
    P.orchestratorToolEntry({ kind: "check", id: "check:s3", name: "site_check", verdict: "unverified", summary: "", path: "menu.html", state: "done", icon: "📏", label: "📏 미확인(미리보기 꺼짐)", at: 4 }, "t"),
    P.orchestratorToolEntry({ kind: "check", id: "check:a1", name: "archive", verdict: "archived", summary: "", path: "index.html", state: "done", icon: "🗂", label: "🗂 이전 버전 보관 (.hypeproof/history) — index-20261015-101500.html", at: 5 }, "t"),
  ];
  const panel = await render("ChatPanel", chatPanelProps({ config: adultConfig(), messages: entries.map(toMessage) }));
  const shown = [...panel.matchAll(/<div class="hps-tool-log-line hps-tool-(\w+)"[^>]*>([\s\S]*?)<\/div>/g)].map((m) => `${visibleText(m[2])} [${m[1]}]`);
  assert.deepEqual(shown, [
    "🔎검토 도우미 · Claude Haiku 5.5 — 고칠 곳 2개✓ [done]",
    "📏390·1280px 확인 — 통과✓ [done]",
    "📏390px에서 2곳 넘침✓ [done]",
    "📏미확인(미리보기 꺼짐)✓ [done]",
    "🗂이전 버전 보관 (.hypeproof/history) — index-20261015-101500.html✓ [done]",
  ]);
  assert.doesNotMatch(panel, /🔎\s*🔎|📏\s*📏|🗂\s*🗂/, "no icon twice");
  ok("details: each request row names its agent before the model (코치 · / 검토 도우미 · / 보조 작업 ·), from the Service's title, the roster's, or the wire name; rows without agents read exactly as today (control); a served roster alone changes none of the 9 old screens; the timeline renders consult, check and archive lines with one icon each, the verdict in the label");
} else {
  console.log(`NOT RUN orchestrator panel details/timeline renders — ${status.detail}`);
}

// ── 9. S4's rows (hypeproof-service#88): `no_receipt`, and a reason this build does not know ─

{
  const { observedEffortResult, KNOWN_EFFORT_REASONS } = await import("../src/modelSelection.ts");
  // The served shape of GET /v1/request-settings/:turn after S4: the seven old keys first, then the
  // attribution (agent, agent_title, non-null fields). A row written for its attribution alone has no
  // effort receipt: requested and applied null, reason `no_receipt`.
  const S4_ROWS = [
    { request_id: "8d0f6c1e-0001", model: "claude-haiku-5-5", requested: null, applied: null, reason: "no_receipt", status: 200, created_at: "2026-10-15 06:00:01",
      agent: "design-reviewer", agent_title: "검토 도우미", roster: "homepage@1.0.0", capability: "text.fast", resolution: "roster", stop_reason: "end_turn", agent_call_id: "5b1e2f6a-7c3d-4e8f-9a0b-1c2d3e4f5a6b" },
    { request_id: "8d0f6c1e-0002", model: "claude-sonnet-5-5", requested: null, applied: null, reason: "no_receipt", status: 200, created_at: "2026-10-15 06:00:02",
      agent: "coach", agent_title: "코치", request_class: "main", roster: "homepage@1.0.0", capability: "code.general", resolution: "learner_selection", stop_reason: "tool_use" },
    { request_id: "8d0f6c1e-0003", model: "claude-haiku-5-5", requested: null, applied: null, reason: "no_receipt", status: 200, created_at: "2026-10-15 06:00:03",
      agent: "aux", agent_title: "보조", request_class: "auxiliary", roster: "homepage@1.0.0", capability: "text.fast", resolution: "aux_fast", stop_reason: "end_turn" },
  ];
  const OLD_ROWS = [
    { request_id: "r1", model: "claude-sonnet-5-5", requested: "low", applied: "low", reason: "selected", status: 200, created_at: "2026-10-15 06:01:00" },
    { request_id: "r2", model: "claude-sonnet-5-5", requested: null, applied: "medium", reason: "course_default", status: 200, created_at: "2026-10-15 06:01:01" },
    { request_id: "r3", model: "claude-haiku-5-5", requested: "high", applied: null, reason: "unsupported_model", status: 529, created_at: "2026-10-15 06:01:02" },
  ];
  const FUTURE = { request_id: "r4", model: "claude-sonnet-5-5", requested: "low", applied: "high", reason: "provider_override", status: 200, created_at: "2026-10-15 06:01:03" };

  assert.deepEqual([...KNOWN_EFFORT_REASONS], ["selected", "course_default", "unsupported_model", "no_receipt"]);
  // An older Service's rows pass through as they came (the same objects).
  const old = observedEffortResult({ requests: OLD_ROWS, truncated: false });
  assert.equal(old.state, "observed");
  assert.ok(old.requests.every((r, i) => r === OLD_ROWS[i]), "known reasons are not copied or changed");
  // S4's no_receipt rows are read, not refused.
  const s4 = observedEffortResult({ requests: S4_ROWS, truncated: false });
  assert.equal(s4.state, "observed");
  assert.ok(s4.requests.every((r, i) => r === S4_ROWS[i]));
  // A reason this build does not know marks that row only; the list, and the row's model and levels, stay.
  const missing = { ...OLD_ROWS[0], request_id: "r5" };
  delete missing.reason;
  const nulled = { ...OLD_ROWS[1], request_id: "r6", reason: null };
  const mixed = observedEffortResult({ requests: [OLD_ROWS[0], S4_ROWS[0], FUTURE, missing, nulled], truncated: false });
  assert.equal(mixed.state, "observed", "one new word never turns the whole list into 미확인");
  assert.deepEqual(mixed.requests.map((r) => r.reason), ["selected", "no_receipt", "unknown", "unknown", "unknown"]);
  assert.deepEqual({ ...mixed.requests[2], reason: FUTURE.reason }, FUTURE, "only the reason is marked; model and levels are kept");
  assert.equal(FUTURE.reason, "provider_override", "the Service's row is not mutated");
  assert.equal(mixed.requests[0], OLD_ROWS[0]);
  // Negative controls: every other field is as strict as before, a known or unknown reason alike.
  for (const [why, rows, envelope = { truncated: false }] of [
    ["a level outside low/medium/high", [{ ...S4_ROWS[0], applied: "max" }]],
    ["a future reason with a string status", [{ ...FUTURE, status: "200" }]],
    ["a level that is not a level", [{ ...FUTURE, requested: "maximum" }]],
    ["no model", [(() => { const r = { ...S4_ROWS[1] }; delete r.model; return r; })()]],
    ["a time that is not text", [{ ...OLD_ROWS[0], created_at: 1760508060 }]],
    ["no truncated flag", S4_ROWS, {}],
    ["no rows", []],
    ["101 rows", Array.from({ length: 101 }, (_, i) => ({ ...OLD_ROWS[0], request_id: `x${i}` }))],
  ]) {
    assert.equal(observedEffortResult({ requests: rows, ...envelope }).state, "unknown", why);
  }

  if (status.available) {
    const { visibleText } = await import("./sx-render.mjs");
    const items = (html) => [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => visibleText(m[1]));
    const listOf = async (result, profile = adultConfig().profile) => render("EffortControl", { config: adultConfig({ effort: POLICY, effortResult: result, profile }), post() {} });
    // S4's rows read as what they are: no effort was recorded, so no level is claimed.
    assert.deepEqual(items(await listOf(s4, { ...adultConfig().profile, orchestrator: ROSTER })), [
      "검토 도우미 · Claude Haiku 5.5: 처리 수준 기록 없음",
      "코치 · Claude Sonnet 5.5: 처리 수준 기록 없음",
      "보조 작업 · Claude Haiku 5.5: 처리 수준 기록 없음",
    ]);
    const failed = observedEffortResult({ requests: [{ ...S4_ROWS[0], status: 502 }], truncated: false });
    assert.deepEqual(items(await listOf(failed)), ["검토 도우미 · Claude Haiku 5.5: 처리 수준 기록 없음 · 요청 실패"]);
    // The unknown reason marks its own row; the rows around it read as before.
    assert.deepEqual(items(await listOf(mixed)), [
      "Claude Sonnet 5.5: 요청 Low → 적용 Low",
      "검토 도우미 · Claude Haiku 5.5: 처리 수준 기록 없음",
      "Claude Sonnet 5.5: 요청 Low → 적용 High · 적용 이유 미확인",
      "Claude Sonnet 5.5: 요청 Low → 적용 Low · 적용 이유 미확인",
      "Claude Sonnet 5.5: 요청 수업 기본값 → 적용 Medium · 적용 이유 미확인",
    ]);
    // S4's own agent values, without a title: worded, never shown as English wire values.
    const worded = observedEffortResult({ requests: [
      { ...S4_ROWS[1], request_id: "w1", agent: "unknown", agent_title: undefined },
      { ...S4_ROWS[1], request_id: "w2", agent: "anomaly:subagent", agent_title: undefined, request_class: "subagent" },
      { ...S4_ROWS[1], request_id: "w3", agent_title: undefined },
    ], truncated: false });
    assert.deepEqual(items(await listOf(worded)).map((t) => t.split(" · ")[0]), ["담당 미확인", "예상 밖 요청", "코치"]);
    // Control: a list the envelope rule refuses still reads 미확인, so the instrument can tell them apart.
    const refused = observedEffortResult({ requests: [{ ...FUTURE, applied: "max" }], truncated: false });
    const refusedHtml = await listOf(refused);
    assert.match(visibleText(refusedHtml), /적용 기록 미확인/);
    assert.equal(items(refusedHtml).length, 0);
    assert.doesNotMatch(visibleText(await listOf(mixed)), /적용 기록 미확인/);
  }

  // The host reads the Service's answer through the same parser and keeps the list.
  const P = await provider();
  let configs = 0;
  const host = {
    effortTurn: { id: "turn-s4", url: "https://api.example.test/v1", token: "t0ken", scope: "s" },
    context: { secrets: { get: async () => "t0ken" } },
    postConfig: async () => configs++,
  };
  const asked = [];
  bundleFetch = async (url, init) => {
    asked.push({ url: String(url), auth: init?.headers?.authorization });
    return new Response(JSON.stringify({ requests: [...S4_ROWS, FUTURE], truncated: false }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    await P.ChatPanelProvider.prototype.refreshEffortResult.call(host);
  } finally {
    bundleFetch = globalThis.fetch;
  }
  assert.deepEqual(asked, [{ url: "https://api.example.test/v1/request-settings/turn-s4", auth: "Bearer t0ken" }]);
  assert.equal(host.effortResult.state, "observed");
  assert.deepEqual([...host.effortResult.requests].map((r) => `${r.agent ?? "-"}:${r.reason}`), ["design-reviewer:no_receipt", "coach:no_receipt", "aux:no_receipt", "-:unknown"]);
  assert.equal(configs, 1);
  ok("S4 rows: no_receipt is read (worded 처리 수준 기록 없음, no level claimed), a reason this build does not know marks only its row (적용 이유 미확인) while the list and the row's model stay; old rows pass through unchanged; S4's unknown and anomaly agents are worded; every other malformed field still turns the list 미확인 (controls); the host keeps the list");
}

console.log(`orchestrator-panel: ${passed} checks passed`);
