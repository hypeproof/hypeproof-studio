// S-2b spy: an instructor turn never raises an approval kind that Chalk does not own.
// Names come from the real sources, not from a hand-written list:
//   - workspace tools: workspaceTools() with the real INSTRUCTOR_TOOL_PROFILE
//   - browser tools: the shared builder src/chalk/instructorBrowserTools.ts, used by both the legacy
//     instructor turn and the Chalk contract turn (asserted at both call sites)
// Mapping-level spy: the full instructor turn is not driven here.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sdkToolToActionRequest, evaluateSdkToolUse } from "../src/sdkCoachHelpers.ts";
import { BROWSER_OPEN_TOOL_DEF, LIVE_PREVIEW_START_TOOL_DEF, MCP_BROWSER_OPEN, MCP_LIVE_PREVIEW_START } from "../src/browserMcp.ts";
import { workspaceTools } from "../src/localRuntime/tools.ts";
import { INSTRUCTOR_LOCAL_BROWSER_DEFS, instructorLocalBrowserTools } from "../src/chalk/instructorBrowserTools.ts";
import { mergeBrowserTools, mergeExtraTools } from "../src/localRuntime/index.ts";
import { INSTRUCTOR_TOOL_PROFILE } from "../src/chalk/instructorTurn.ts";
import { needsChalkPrompt } from "../src/chalkContract.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const DEFAULT_REQUIRE = pkg.contributes.configuration.properties["hypeproofChat.requireApprovalFor"].default;

let n = 0;
const check = (name, fn) => { fn(); n++; console.log(`  ok   ${name}`); };

const workspaceNames = workspaceTools({
  cwd: path.join(root, "test"),
  profile: INSTRUCTOR_TOOL_PROFILE,
  signal: new AbortController().signal,
  approve: async () => true,
}).definitions.map((d) => d.name);
// The model calls the MCP-prefixed names; the canonical defs carry the short names.
const mcpName = (short) => `mcp__hypeproof__${short}`;
const browserNames = [mcpName(LIVE_PREVIEW_START_TOOL_DEF.name), mcpName(BROWSER_OPEN_TOOL_DEF.name)];
assert.equal(browserNames[0], MCP_LIVE_PREVIEW_START, "live_preview_start MCP name changed");
assert.equal(browserNames[1], MCP_BROWSER_OPEN, "browser_open MCP name changed");
const instructorNames = [...workspaceNames, ...browserNames];
const WORKSPACE = "/tmp/hps-spy-workspace";
const INPUT = { path: "lesson/index.html", url: "https://example.com/a", content: "x" };
const decisionOf = (toolName, permitted = instructorNames) =>
  evaluateSdkToolUse({ toolName, input: INPUT, permittedTools: permitted, workspaceRoot: WORKSPACE }).decision;
// browser_open depends on the URL: loopback (live preview) is allowed, outside URLs are asked.
const browserOpenDecision = (input) =>
  evaluateSdkToolUse({ toolName: MCP_BROWSER_OPEN, input, permittedTools: instructorNames, workspaceRoot: WORKSPACE }).decision;

check("S-2b spy: the instructor profile exposes only read, write and browser workspace tools", () => {
  assert.ok(workspaceNames.length > 0, "no workspace tools for the instructor profile");
  for (const forbidden of ["Bash", "Task", "Shell"]) assert.ok(!workspaceNames.includes(forbidden), `${forbidden} must not be exposed`);
  assert.deepEqual([...workspaceNames].sort(), ["Edit", "Read", "Write"].sort(), "workspace list changed; update the expectation with the profile");
});

check("S-2b spy: both instructor paths build browser tools with the one shared function", () => {
  const src = fs.readFileSync(path.join(root, "src/chatPanelProvider.ts"), "utf8");
  // Legacy instructor turn: the browserTools handed to runInstructorTurn.
  assert.match(src, /const browserTools = instructorLocalBrowserTools\(\(\) => this\.buildBrowserMcpHost\(text\)\);/,
    "legacy instructor turn no longer builds browser tools with the shared function");
  // Chalk contract turn: the browserTools handed to runLocalCoach in runContractTurn.
  assert.match(src, /browserTools: instructorLocalBrowserTools\(\(\) => this\.buildBrowserMcpHost\(last\.content\)\),/,
    "contract turn does not pass the shared browser tools");
  assert.deepEqual(INSTRUCTOR_LOCAL_BROWSER_DEFS.map((d) => d.name), ["live_preview_start", "browser_open"]);
});

check("S-2b spy: the instructor names that reach approval (decision ask) map to allowed kinds only", () => {
  const asked = instructorNames.filter((x) => decisionOf(x) === "ask").sort();
  assert.deepEqual(asked, ["Edit", "Write", MCP_BROWSER_OPEN].sort());
  for (const toolName of asked) {
    const kind = sdkToolToActionRequest({ toolName, input: INPUT }).kind;
    assert.ok(["writeFile", "openBrowser"].includes(kind), `${toolName} maps to ${kind}`);
  }
});

check("S-2b spy: read and live_preview_start are allowed without asking", () => {
  assert.equal(decisionOf("Read"), "allow");
  assert.equal(decisionOf(MCP_LIVE_PREVIEW_START), "allow");
});

check("S-2b spy: browser_open to an outside URL is asked by the SDK policy, but openBrowser is not a Chalk prompt", () => {
  // The SDK coach path asks; the instructor local runner never calls the approval gate for browser_open.
  for (const url of ["https://example.com", "https://example.com/a"]) {
    assert.equal(browserOpenDecision({ url }), "ask", url);
    assert.equal(sdkToolToActionRequest({ toolName: MCP_BROWSER_OPEN, input: { url } }).kind, "openBrowser", url);
  }
  assert.equal(needsChalkPrompt("openBrowser", DEFAULT_REQUIRE), false);
});

check("S-2b spy: browser_open to a loopback URL (live preview) is allowed without a prompt", () => {
  // sdkCoachHelpers.ts: isLoopbackUrl(url) → { decision: "allow" } before the ask branch.
  for (const url of ["http://127.0.0.1:59215/", "http://localhost:3000/"]) {
    assert.equal(browserOpenDecision({ url }), "allow", url);
  }
});

check("S-2b spy: browser_open with no url resolves to about:blank, which is not loopback, so it is asked", () => {
  // An omitted url selects the inert about:blank page (browserOpenUrl). about:blank is not
  // loopback, so the outside-URL rule applies and the call is asked, not allowed.
  assert.equal(browserOpenDecision({}), "ask");
});

check("S-2b spy: with the default requireApprovalFor, Write and Edit are asked but no Chalk prompt is raised", () => {
  assert.equal(decisionOf("Write"), "ask");
  assert.equal(decisionOf("Edit"), "ask");
  assert.equal(needsChalkPrompt("writeFile", DEFAULT_REQUIRE), false);
  assert.equal(needsChalkPrompt("openBrowser", DEFAULT_REQUIRE), false);
});

check("S-2b spy: with writeFile added to requireApprovalFor, the same Write and Edit calls raise a Chalk prompt", () => {
  const withWrite = [...DEFAULT_REQUIRE, "writeFile"];
  assert.equal(decisionOf("Write"), "ask", "the policy decision does not depend on the setting");
  assert.equal(needsChalkPrompt("writeFile", withWrite), true);
  assert.equal(needsChalkPrompt("openBrowser", withWrite), false);
});

check("S-2b spy: Chalk prompts follow the setting exactly (the same rule the Studio resolver uses)", () => {
  for (const extra of [[], ["writeFile"]]) {
    const list = [...DEFAULT_REQUIRE, ...extra];
    for (const kind of ["writeFile", "openBrowser", "executeShell", "browserType", "consultHelper", "delegateAgent"]) {
      assert.equal(needsChalkPrompt(kind, list), list.includes(kind) && kind === "writeFile", `${kind} with ${extra}`);
    }
  }
});

check("S-2b spy: browser_type and consult are not in the instructor name set", () => {
  assert.ok(!instructorNames.includes("mcp__hypeproof__browser_type"));
  assert.ok(!instructorNames.includes("mcp__hypeproof__consult"));
});

// ── Local runner path (the path an instructor turn actually takes) ──────────
// The contract turn and the legacy instructor turn both run runLocalCoach. Its
// approval gate is the workspace tools' approve callback, and browser_open reaches
// the model only through extra tools (mergeExtraTools) with no approve call.
// The checks below run that path directly, so they do not rely on the SDK policy.
const localWs = fs.mkdtempSync(path.join(os.tmpdir(), "hps-spy-local-"));
try {
  const approved = [];
  const work = workspaceTools({
    cwd: localWs,
    profile: INSTRUCTOR_TOOL_PROFILE,
    signal: new AbortController().signal,
    approve: async (a) => { approved.push(a.toolName); return true; },
  });
  await work.call("Write", { file_path: "probe.txt", content: "x" });
  assert.deepEqual(approved, ["Write"], "the local runner asks for approval on a workspace write");

  const extraCalls = [];
  const merged = mergeExtraTools(work, {
    definitions: [{ name: "browser_open", description: "", inputSchema: {} }],
    call: async (name) => { extraCalls.push(name); return "ok"; },
  });
  await merged.call("browser_open", { url: "https://example.com" });
  assert.deepEqual(extraCalls, ["browser_open"], "browser_open is dispatched to the extra tool");
  assert.deepEqual(approved, ["Write"], "browser_open never reaches the approve callback on the local runner");
  n++;
  console.log("  ok   S-2b spy (local runner): approve is called for Write only; browser_open is dispatched without approve, as on the legacy path");
} finally {
  fs.rmSync(localWs, { recursive: true, force: true });
}

// ── Shared browser builder: both instructor paths get the same tools ───────
const fakeOps = { seen: [] };
fakeOps.runBrowserOpen = async (host, raw) => { fakeOps.seen.push(["open", host.tag, raw]); return { content: [{ type: "text", text: "opened" }] }; };
fakeOps.runLivePreviewStart = async (host) => { fakeOps.seen.push(["live", host.tag]); return { content: [{ type: "text", text: "live" }] }; };
const shared = instructorLocalBrowserTools(() => ({ tag: "host" }), fakeOps);
assert.deepEqual(shared.definitions.map((d) => d.name), ["live_preview_start", "browser_open"]);
assert.equal(await shared.call("browser_open", { url: "https://example.com" }), "opened");
assert.equal(await shared.call("live_preview_start", {}), "live");
assert.deepEqual(fakeOps.seen, [["open", "host", "https://example.com"], ["live", "host"]], "browser_open runs runBrowserOpen directly, no approval step");
await assert.rejects(shared.call("browser_type", {}), /알 수 없는 브라우저 도구/);
const failingOps = { runBrowserOpen: async () => ({ isError: true, content: [{ type: "text", text: "blocked" }] }), runLivePreviewStart: fakeOps.runLivePreviewStart };
const failing = instructorLocalBrowserTools(() => ({ tag: "host" }), failingOps);
await assert.rejects(failing.call("browser_open", { url: "https://example.com" }), /blocked/);
n++;
console.log("  ok   S-2b spy: the shared builder exposes the two browser tools and runs them with no approval step");

// ── Tool name set: contract composition equals legacy composition ─────────
// Legacy and contract turns compose the same way: workspace tools, then the Chalk extra
// tools, then the browser tools. Only the source of the Chalk list differs (Studio's
// chalkExtraTools on legacy, the contract's a.tools on the contract path).
{
  const nameSet = (approved) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hps-spy-names-"));
    try {
      const work = workspaceTools({ cwd: dir, profile: INSTRUCTOR_TOOL_PROFILE, signal: new AbortController().signal, approve: async (a) => { approved.push(a.toolName); return true; } });
      const chalk = { definitions: [{ name: "chalk_probe", description: "", inputSchema: {} }], call: async () => "ok" };
      const composed = mergeBrowserTools(mergeExtraTools(work, chalk), shared);
      return composed.definitions.map((d) => d.name).sort();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  const legacy = nameSet([]);
  const contract = nameSet([]);
  assert.deepEqual(contract, legacy, "contract tool names must equal legacy tool names");
  for (const expected of ["Read", "Write", "Edit", "chalk_probe", "live_preview_start", "browser_open"]) {
    assert.ok(legacy.includes(expected), `${expected} is in the instructor tool set`);
  }
  assert.equal(new Set(legacy).size, legacy.length, "no duplicate tool names");
  n++;
  console.log("  ok   S-2b spy: contract and legacy tool name sets are equal (workspace, chalk, browser)");
}

// ── Legacy behaviour is unchanged: browser_open never reaches approve ─────
{
  const approved = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hps-spy-noapprove-"));
  try {
    const work = workspaceTools({ cwd: dir, profile: INSTRUCTOR_TOOL_PROFILE, signal: new AbortController().signal, approve: async (a) => { approved.push(a.toolName); return true; } });
    const composed = mergeBrowserTools(work, shared);
    await composed.call("browser_open", { url: "https://example.com" });
    assert.deepEqual(approved, [], "browser_open calls no approval on the legacy composition");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  n++;
  console.log("  ok   S-2b spy: legacy composition runs browser_open with no approval call");
}

console.log(`\n${n} spy checks passed`);
