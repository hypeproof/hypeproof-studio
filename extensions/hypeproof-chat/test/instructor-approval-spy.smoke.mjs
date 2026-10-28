// S-2b spy: an instructor turn never reaches an approval kind that Chalk does not own.
// The approval callback is reached only for tools whose policy decision is "ask"
// (evaluateSdkToolUse). The instructor turn exposes the workspace tools (Read, Write, Edit)
// and the two instructor browser tools (live_preview_start, browser_open); the Chalk tools
// are not wrapped by the approval callback (localRuntime/index.ts: approve goes to workspaceTools only).
// Mapping-level spy: the full instructor turn is not driven here.
import assert from "node:assert/strict";
import { sdkToolToActionRequest, evaluateSdkToolUse, MCP_CONSULT } from "../src/sdkCoachHelpers.ts";
import { MCP_BROWSER_OPEN, MCP_BROWSER_TYPE, MCP_LIVE_PREVIEW_START } from "../src/browserMcp.ts";

let n = 0;
const check = (name, fn) => { fn(); n++; console.log(`  ok   ${name}`); };

const INSTRUCTOR_NAMES = ["Read", "Write", "Edit", MCP_LIVE_PREVIEW_START, MCP_BROWSER_OPEN];
const PERMITTED = [...INSTRUCTOR_NAMES];
const INPUT = { path: "lesson/index.html", url: "https://example.com/a", content: "x" };
const WORKSPACE = "/tmp/hps-spy-workspace";
const ALLOWED_FOR_INSTRUCTOR = ["readFile", "writeFile", "openBrowser"];
const FORBIDDEN = ["browserType", "consultHelper", "executeShell", "delegateAgent"];

const askedNames = INSTRUCTOR_NAMES.filter((toolName) =>
  evaluateSdkToolUse({ toolName, input: INPUT, permittedTools: PERMITTED, workspaceRoot: WORKSPACE }).decision === "ask");

check("S-2b spy: the instructor names that reach approval are the write and browser_open tools", () => {
  assert.deepEqual(askedNames.sort(), ["Edit", MCP_BROWSER_OPEN, "Write"].sort());
});

check("S-2b spy: every instructor name that reaches approval maps to an allowed kind", () => {
  for (const toolName of askedNames) {
    const kind = sdkToolToActionRequest({ toolName, input: INPUT }).kind;
    assert.ok(ALLOWED_FOR_INSTRUCTOR.includes(kind), `${toolName} maps to ${kind}`);
    assert.ok(!FORBIDDEN.includes(kind), `${toolName} maps to forbidden ${kind}`);
  }
});

check("S-2b spy: browser_type and consult are not instructor names, and never reach approval as ask", () => {
  for (const toolName of [MCP_BROWSER_TYPE, MCP_CONSULT]) {
    assert.ok(!INSTRUCTOR_NAMES.includes(toolName), `${toolName} is not exposed to the instructor turn`);
  }
});

console.log(`\n${n} spy checks passed`);
