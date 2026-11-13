// #3586 — the real path: the instructor local runner (runLocalCoach) calls browser_open, the approval window
// runs out of time, and the row must carry exactly one 시간 초과 card. The model is a fake `claude` CLI that
// calls the studio tool server over HTTP (the same MCP call the real CLI makes); the browser wrapper is the
// real withBrowserOpenApproval; only the chat panel's answer (the approval closure) is a stub returning the
// timeout the panel gives. Card derivation mirrors the chat panel: the approval branch (chatPanelProvider.ts,
// `if (a.actor === 'policy')`) records the card by call id, the tool_result branch reuses it
// (`deniedCalls.get(a.id) ??`, chatPanelProvider.ts ~9771). A row with no activity events has no card.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runLocalCoach } from "../src/localRuntime/index.ts";
import { withBrowserOpenApproval, BROWSER_TIMEOUT_TEXT } from "../src/localRuntime/browserOpenApproval.ts";
import { taggedDenialSource, denialNotice, denialNoticeView } from "../src/denialNotice.ts";

let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${err && err.message}`); }
}

const scratch = mkdtempSync(path.join(tmpdir(), "instructor-browser-timeout-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

// A fake `claude`: answers `auth`, reads the --mcp-config, calls browser_open once on the studio tool server,
// and prints a stream-json result. It is the model's side of one tool call; the runtime does the rest.
const fakeCli = path.join(scratch, "fake-claude");
writeFileSync(fakeCli, `#!${process.execPath}
const args = process.argv.slice(2);
if (args[0] === "auth") { console.log(JSON.stringify({ loggedIn: true, authMethod: "claude.ai" })); process.exit(0); }
const cfg = JSON.parse(args[args.indexOf("--mcp-config") + 1]);
const s = cfg.mcpServers.studio;
const post = (body) => fetch(s.url, { method: "POST", headers: { "content-type": "application/json", authorization: s.headers.Authorization }, body: JSON.stringify(body) })
  .then((r) => (r.status === 202 ? null : r.json()));
process.stdin.resume();
process.stdin.on("end", async () => {
  await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
  const res = await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "browser_open", arguments: { url: "https://example.com/" } } });
  console.log(JSON.stringify({ type: "result", subtype: "success", stop_reason: "end_turn", result: JSON.stringify(res && res.result) }));
});
`);
chmodSync(fakeCli, 0o755);

const WS = path.join(scratch, "ws");
const hostWith = () => ({
  openPages: async () => [], currentPage: async () => null, livePreviewUrl: async () => null, crEnabled: () => false,
});
const opened = [];
const base = {
  definitions: [{ name: "browser_open", description: "", inputSchema: { type: "object" } }],
  call: async (name, input) => { opened.push({ name, input }); return "opened"; },
};

await t("a: a browser_open timeout in the instructor local runner gives one 시간 초과 card on its row", async () => {
  const activity = [];
  const panelAnswers = [];
  const browserTools = withBrowserOpenApproval(base, { host: hostWith(), workspaceRoot: WS });
  // The chat panel's approval closure answers a timed-out window like this (chatPanelProvider.ts, instructor
  // closure): not allowed, policy actor, timeout source.
  const requestApproval = async (action) => { panelAnswers.push(action.toolName); return { approved: false, actor: "policy", denialSource: "timeout" }; };
  await runLocalCoach({
    config: { provider: "claude", executable: fakeCli, model: "sonnet" },
    profile: { sdk_tools: {} },
    cwd: scratch,
    history: [],
    userText: "open the example page",
    signal: new AbortController().signal,
    onDelta: () => {},
    requestApproval,
    onActivity: (a) => activity.push(a),
    browserTools,
  });
  assert.equal(panelAnswers.length, 1, "the approval window was asked once");
  assert.match(panelAnswers[0], /browser_open$/, "asked for browser_open (the CLI prefixes the studio server name)");
  assert.equal(opened.length, 0, "the page was not opened");

  const rows = activity.filter((a) => a.name === "browser_open" || (a.kind === "tool_result"));
  const ids = [...new Set(activity.filter((a) => a.kind === "tool_use" && a.name === "browser_open").map((a) => a.id))];
  assert.equal(ids.length, 1, "one tool row for browser_open");
  const denied = activity.filter((a) => a.kind === "approval" && a.id === ids[0] && a.allowed === false && a.actor === "policy" && a.denialSource === "timeout");
  assert.equal(denied.length, 1, "the approval event carries the timeout (one card)");
  const result = activity.filter((a) => a.kind === "tool_result" && a.id === ids[0]);
  assert.equal(result.length, 1, "the row settles once");
  assert.equal(result[0].isError, true);
  assert.equal(taggedDenialSource(result[0].reason), "timeout", "the tool result is tagged 시간 초과");
  assert.equal(rows.length >= 2, true);
});

await t("d: a learner refusal on the instructor local browser_open gives one 거절함 card on its row, no report button", async () => {
  const activity = [];
  const browserTools = withBrowserOpenApproval(base, { host: hostWith(), workspaceRoot: WS });
  // The panel closure answers a learner refusal with actor user and the declined source (resolveActionApproval onDenied).
  const requestApproval = async () => ({ approved: false, actor: "user", denialSource: "declined" });
  await runLocalCoach({
    config: { provider: "claude", executable: fakeCli, model: "sonnet" },
    profile: { sdk_tools: {} },
    cwd: scratch,
    history: [],
    userText: "open the example page",
    signal: new AbortController().signal,
    onDelta: () => {},
    requestApproval,
    onActivity: (a) => activity.push(a),
    browserTools,
  });
  const ids = [...new Set(activity.filter((a) => a.kind === "tool_use" && a.name === "browser_open").map((a) => a.id))];
  assert.equal(ids.length, 1, "one tool row for browser_open");
  const refused = activity.filter((a) => a.kind === "approval" && a.id === ids[0] && a.allowed === false && a.actor === "user");
  assert.equal(refused.length, 1, "the learner's answer is recorded as a user refusal");
  const result = activity.filter((a) => a.kind === "tool_result" && a.id === ids[0]);
  assert.equal(result.length, 1, "the row settles once");
  assert.equal(result[0].isError, true);
  assert.match(result[0].reason, /^\[거절함\] /, "the refusal text is tagged 거절함, not unknown");
  assert.equal(taggedDenialSource(result[0].reason), "declined");
  assert.equal(opened.length, 0, "the page was not opened");
});

await t("b: the card the row gets is the timeout card, with no report button", async () => {
  const view = denialNoticeView(denialNotice("timeout", false));
  assert.equal(view.label, "시간 초과");
  assert.equal(view.action, undefined);
});

await t("c: the tagged browser text is what the model receives", async () => {
  assert.ok(BROWSER_TIMEOUT_TEXT.startsWith("[시간 초과] "), "tag first");
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log("\nall instructor-browser-timeout-card checks passed");
