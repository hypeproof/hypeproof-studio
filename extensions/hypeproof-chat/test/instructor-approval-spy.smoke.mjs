// S-2b spy: an instructor turn never raises an approval kind that Chalk does not own.
// Names come from the real sources, not from a hand-written list:
//   - workspace tools: workspaceTools() with the real INSTRUCTOR_TOOL_PROFILE
//   - browser tools: the canonical defs from browserMcp.ts, and an assertion that the provider's
//     INSTRUCTOR_LOCAL_BROWSER_DEFS names the same two defs
// Mapping-level spy: the full instructor turn is not driven here.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sdkToolToActionRequest, evaluateSdkToolUse } from "../src/sdkCoachHelpers.ts";
import { BROWSER_OPEN_TOOL_DEF, LIVE_PREVIEW_START_TOOL_DEF, MCP_BROWSER_OPEN, MCP_LIVE_PREVIEW_START } from "../src/browserMcp.ts";
import { workspaceTools } from "../src/localRuntime/tools.ts";
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

check("S-2b spy: the provider's instructor browser list names the same two canonical defs", () => {
  const src = fs.readFileSync(path.join(root, "src/chatPanelProvider.ts"), "utf8");
  assert.match(src, /const INSTRUCTOR_LOCAL_BROWSER_DEFS = \[LIVE_PREVIEW_START_TOOL_DEF, BROWSER_OPEN_TOOL_DEF\]/,
    "the provider's instructor browser list changed; this spy must follow it");
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

check("S-2b spy: browser_open to an outside URL is asked and maps to openBrowser (Chalk prompt)", () => {
  for (const url of ["https://example.com", "https://example.com/a"]) {
    assert.equal(browserOpenDecision({ url }), "ask", url);
    assert.equal(sdkToolToActionRequest({ toolName: MCP_BROWSER_OPEN, input: { url } }).kind, "openBrowser", url);
  }
  assert.equal(needsChalkPrompt("openBrowser", DEFAULT_REQUIRE), true);
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
  assert.equal(needsChalkPrompt("openBrowser", DEFAULT_REQUIRE), true);
});

check("S-2b spy: with writeFile added to requireApprovalFor, the same Write and Edit calls raise a Chalk prompt", () => {
  const withWrite = [...DEFAULT_REQUIRE, "writeFile"];
  assert.equal(decisionOf("Write"), "ask", "the policy decision does not depend on the setting");
  assert.equal(needsChalkPrompt("writeFile", withWrite), true);
  assert.equal(needsChalkPrompt("openBrowser", withWrite), true);
});

check("S-2b spy: Chalk prompts follow the setting exactly (the same rule the Studio resolver uses)", () => {
  for (const extra of [[], ["writeFile"]]) {
    const list = [...DEFAULT_REQUIRE, ...extra];
    for (const kind of ["writeFile", "openBrowser", "executeShell", "browserType", "consultHelper", "delegateAgent"]) {
      assert.equal(needsChalkPrompt(kind, list), list.includes(kind) && ["openBrowser", "writeFile"].includes(kind), `${kind} with ${extra}`);
    }
  }
});

check("S-2b spy: browser_type and consult are not in the instructor name set", () => {
  assert.ok(!instructorNames.includes("mcp__hypeproof__browser_type"));
  assert.ok(!instructorNames.includes("mcp__hypeproof__consult"));
});

console.log(`\n${n} spy checks passed`);
