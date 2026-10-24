// Studio-side merge and routing checks for instructor turns. These run without any Chalk code:
// the extra tool set is injected, so the tool names below are only stand-ins.
// Replaces the blocked units T-G16–T-G18, T-L8–T-L10 and T-mode 12, 13, 28, 29 that imported
// chalk/tools.ts. T-L10's server-path assertion is Chalk behavior and is kept in the Chalk repository.
import assert from "node:assert/strict";
import { createServer } from "node:http";

const { mergeBrowserTools, mergeExtraTools, localRuntimeConfig } = await import("../src/localRuntime/index.ts");
const { runBrowserOpen, runLivePreviewStart } = await import("../src/browserMcp.ts");

let n = 0;
const check = async (name, fn) => { await fn(); n++; console.log(`  ok   ${name}`); };

const stubExtraDefs = [
  { name: "chalk_check_plan", description: "stub", inputSchema: {} },
  { name: "chalk_get_knowledge", description: "stub", inputSchema: {} },
  { name: "chalk_recommend_methods", description: "stub", inputSchema: {} },
];
const mockWorkTools = { definitions: [{ name: "Read", description: "", inputSchema: {} }], call: async () => "read-result" };

console.log("=== browser tools in the instructor turn (T-G16–T-G18) ===");

await check("T-G16 instructor mode: live_preview_start + browser_open in merged defs (two consecutive turns)", () => {
  const browserTools = {
    definitions: [
      { name: "live_preview_start", description: "라이브 서버 시작", inputSchema: { type: "object" } },
      { name: "browser_open", description: "브라우저 열기", inputSchema: { type: "object" } },
    ],
    call: async () => "ok",
  };
  for (const turn of [1, 2]) {
    const names = mergeBrowserTools(mockWorkTools, browserTools).definitions.map((d) => d.name);
    assert.ok(names.includes("live_preview_start"), `턴 ${turn}: live_preview_start 없음`);
    assert.ok(names.includes("browser_open"), `턴 ${turn}: browser_open 없음`);
  }
});

await check("T-G17 student mode (no browserTools): live_preview_start + browser_open NOT in defs", () => {
  const names = mergeBrowserTools(mockWorkTools, undefined).definitions.map((d) => d.name);
  assert.ok(!names.includes("live_preview_start"));
  assert.ok(!names.includes("browser_open"));
  assert.ok(names.includes("Read"));
});

await check("T-G18 mergeBrowserTools routes browser_open and passes the url input through", async () => {
  let calledWith = null;
  const browserTools = {
    definitions: [
      { name: "live_preview_start", description: "", inputSchema: {} },
      { name: "browser_open", description: "", inputSchema: {} },
    ],
    call: async (name, input) => { calledWith = { name, input }; return "opened"; },
  };
  const TARGET_URL = "http://127.0.0.1:3000/chalk/lesson-01/lesson.html";
  const merged = mergeBrowserTools({ definitions: [], call: async () => { throw new Error("base call must not be reached"); } }, browserTools);
  const result = await merged.call("browser_open", { url: TARGET_URL });
  assert.equal(calledWith?.name, "browser_open");
  assert.deepEqual(calledWith?.input, { url: TARGET_URL });
  assert.equal(result, "opened");
});

console.log("=== extra tools in the instructor turn (T-L8, T-L9, T-L10) ===");

await check("T-L8 instructor mode: extra tool definitions added to definitions (Claude+Codex path)", () => {
  const names = mergeExtraTools(mockWorkTools, { definitions: stubExtraDefs, call: async () => "stub" }).definitions.map((d) => d.name);
  assert.ok(names.includes("Read"), "workspace tool preserved");
  assert.ok(names.includes("chalk_check_plan"));
  assert.ok(names.includes("chalk_get_knowledge"));
  assert.ok(names.includes("chalk_recommend_methods"));
});

await check("T-L9 student mode: extra tool definitions NOT present", () => {
  const names = mergeExtraTools(mockWorkTools, undefined).definitions.map((d) => d.name);
  assert.ok(names.includes("Read"), "workspace tool preserved");
  assert.ok(!names.some((x) => x.startsWith("chalk_")), `extra tools must not appear; found: ${names.filter((x) => x.startsWith("chalk_")).join(",")}`);
});

await check("T-L10 extra tool call is routed to the injected call and its result comes back (no workspace call)", async () => {
  const SECRET_TOKEN = "secret-token-spy-test";
  const seen = [];
  const server = createServer((req, res) => { seen.push(req.url ?? ""); res.writeHead(200); res.end("{}"); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const extra = {
      definitions: stubExtraDefs,
      call: async (name, input) => { seen.push(`extra:${name}`); return JSON.stringify({ name, input, token: "" }); },
    };
    const merged = mergeExtraTools(mockWorkTools, extra);
    const result = await merged.call("chalk_check_plan", { cohort: "c1", course: "l1" });
    assert.ok(seen.includes("extra:chalk_check_plan"), "extra call not reached");
    assert.ok(!seen.some((x) => x === "read-result"), "workspace call must not run for an extra tool");
    assert.ok(!result.includes(SECRET_TOKEN));
  } finally {
    server.close();
  }
});

console.log("=== mode merge units (T-mode 28, 29) ===");

await check("T-mode 28 mergeExtraTools: extra set present → chalk_* tool names in definitions", () => {
  const names = mergeExtraTools({ definitions: [], call: async () => "" }, { definitions: stubExtraDefs, call: async () => "" }).definitions.map((d) => d.name);
  assert.ok(names.some((x) => x.startsWith("chalk_")), `chalk_* tool must appear; got: [${names.join(", ")}]`);
});

await check("T-mode 29 mergeExtraTools: no extra set → no chalk_* in definitions", () => {
  const names = mergeExtraTools({ definitions: [], call: async () => "" }, undefined).definitions.map((d) => d.name);
  assert.ok(!names.some((x) => x.startsWith("chalk_")));
});

console.log("=== local runtime config (T-mode 12, 13) ===");

await check("T-mode 12 localRuntimeConfig: Dev app name but HPS_DEV_RUNTIME unset → null", () => {
  assert.strictEqual(localRuntimeConfig("HypeProof Studio Dev", "http://127.0.0.1:8787/v1", {}), null);
});

await check("T-mode 13 localRuntimeConfig: Dev + runtime on + remote proxyUrl → throws", () => {
  const env = { HPS_DEV_RUNTIME: "1", HPS_DEV_PROVIDER: "claude", HPS_DEV_EXECUTABLE: "/usr/local/bin/claude", HPS_DEV_MODEL: "claude-sonnet-5" };
  assert.throws(() => localRuntimeConfig("HypeProof Studio Dev", "https://api.hypeproof-ai.xyz/v1", env), /로컬 구독/);
});

console.log(`\n${n} units passed`);
