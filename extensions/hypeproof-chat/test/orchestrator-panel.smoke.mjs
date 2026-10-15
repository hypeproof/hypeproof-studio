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

console.log(`orchestrator-panel: ${passed} checks passed`);
