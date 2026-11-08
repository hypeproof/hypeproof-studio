// #3464: browser_open on the instructor local runner follows the student rule. An outside address is asked
// once (the host remembers an origin the learner chose to remember); loopback, an already open page and
// live_preview_start are not asked; a refused or policy-denied address is not opened. The judgement is
// evaluateSdkToolUse, the same function the student path uses.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHumanWait, answerUnlessTurnEnds } from "../src/localRuntime/humanWait.ts";
import { localTurnBudget } from "../src/localRuntime/emailTools.ts";
import { withBrowserOpenApproval } from "../src/localRuntime/browserOpenApproval.ts";
import { decideBrowserOpen } from "../src/browserOpenDecision.ts";

let failed = 0;
async function t(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${name}\n       ${err && err.message}`);
  }
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
const WS = "/tmp/hps-browser-open-ws";

// A host stub for the already-open check: the open pages are the only state the decision reads.
function hostWith(openUrls = []) {
  return {
    openPages: async () => openUrls.map((url) => ({ url })),
    currentPage: async () => null,
    livePreviewUrl: async () => null,
    crEnabled: () => false,
  };
}

// The base tool stands in for runBrowserOpen: it records what would be opened.
function baseTools() {
  const opened = [];
  return {
    opened,
    definitions: [{ name: "live_preview_start", description: "", inputSchema: {} }, { name: "browser_open", description: "", inputSchema: {} }],
    call: async (name, input) => { opened.push({ name, input }); return "opened"; },
  };
}

// The approval gate stands in for runLocalCoach's approve (#3582): a counted wait for a person.
function gate(answer) {
  const asked = [];
  const ask = async (action) => { asked.push(action); return answer(action); };
  return { asked, ask };
}

console.log("=== browser_open on the instructor local runner (#3464) ===");

await t("loopback addresses open without a prompt (127.0.0.1 with port, localhost, [::1], bare 127.0.0.1)", async () => {
  for (const url of ["http://127.0.0.1:59215/", "http://localhost:3000/", "http://[::1]:8080/x", "http://127.0.0.1"]) {
    const base = baseTools();
    const g = gate(() => true);
    const tools = withBrowserOpenApproval(base, { host: hostWith(), workspaceRoot: WS });
    await tools.call("browser_open", { url }, g.ask);
    assert.equal(g.asked.length, 0, `${url} must not ask`);
    assert.deepEqual(base.opened.map((o) => o.name), ["browser_open"], `${url} opens`);
  }
});

await t("an outside address asks once; picking open opens it", async () => {
  const base = baseTools();
  const g = gate(() => true);
  await withBrowserOpenApproval(base, { host: hostWith(), workspaceRoot: WS }).call("browser_open", { url: "https://example.com/" }, g.ask);
  assert.equal(g.asked.length, 1);
  assert.equal(g.asked[0].toolName, "mcp__hypeproof__browser_open", "the gate sees the student tool name, so the Studio modal is openBrowser");
  assert.equal(base.opened.length, 1);
});

await t("an outside address refused by the learner is not opened", async () => {
  const base = baseTools();
  const g = gate(() => false);
  await assert.rejects(withBrowserOpenApproval(base, { host: hostWith(), workspaceRoot: WS }).call("browser_open", { url: "https://example.com/" }, g.ask), /허용하지 않았어요/);
  assert.equal(g.asked.length, 1);
  assert.equal(base.opened.length, 0, "a refused address is not opened");
});

await t("an address already open in the browser is not asked again (REQ-M28)", async () => {
  const base = baseTools();
  const g = gate(() => false);
  await withBrowserOpenApproval(base, { host: hostWith(["https://example.com/"]), workspaceRoot: WS }).call("browser_open", { url: "https://example.com/" }, g.ask);
  assert.equal(g.asked.length, 0);
  assert.equal(base.opened.length, 1);
});

await t("live_preview_start is not asked", async () => {
  const base = baseTools();
  const g = gate(() => false);
  await withBrowserOpenApproval(base, { host: hostWith(), workspaceRoot: WS }).call("live_preview_start", {}, g.ask);
  assert.equal(g.asked.length, 0);
  assert.deepEqual(base.opened.map((o) => o.name), ["live_preview_start"]);
});

await t("a policy-denied address (javascript:, ftp:) is refused without a prompt and not opened", async () => {
  for (const url of ["javascript:alert(1)", "ftp://127.0.0.1/"]) {
    const base = baseTools();
    const g = gate(() => true);
    await assert.rejects(withBrowserOpenApproval(base, { host: hostWith(), workspaceRoot: WS }).call("browser_open", { url }, g.ask), /열 수 없는 주소/);
    assert.equal(g.asked.length, 0, `${url} must not prompt`);
    assert.equal(base.opened.length, 0);
  }
});

await t("known, unchanged: 0.0.0.0 is asked (the loopback rule does not cover it)", async () => {
  const base = baseTools();
  const g = gate(() => true);
  await withBrowserOpenApproval(base, { host: hostWith(), workspaceRoot: WS }).call("browser_open", { url: "http://0.0.0.0:8000/" }, g.ask);
  assert.equal(g.asked.length, 1);
});

await t("a lookalike host (127.0.0.1.evil.com, localhost.evil.com) is asked, not allowed as loopback", async () => {
  for (const url of ["https://127.0.0.1.evil.com/", "http://localhost.evil.com/"]) {
    const base = baseTools();
    const g = gate(() => false);
    await assert.rejects(withBrowserOpenApproval(base, { host: hostWith(), workspaceRoot: WS }).call("browser_open", { url }, g.ask));
    assert.equal(g.asked.length, 1, `${url} asks`);
  }
});

await t("the same origin remembered by the learner is not asked again (host memory, the local path too)", async () => {
  const remembered = new Set();
  let prompts = 0;
  const confirm = async () => { prompts++; return "remember"; };
  const ask = (action) => decideBrowserOpen({ rawUrl: action.input.url, forget: false, remembered, workspaceRoot: WS, confirm });
  const tools = withBrowserOpenApproval(baseTools(), { host: hostWith(), workspaceRoot: WS });
  await tools.call("browser_open", { url: "https://example.com/a" }, ask);
  await tools.call("browser_open", { url: "https://example.com/b" }, ask);
  assert.equal(prompts, 1, "the second page of the same origin is not prompted");
});

await t("without remembering, each outside open is asked", async () => {
  const remembered = new Set();
  let prompts = 0;
  const confirm = async () => { prompts++; return "open"; };
  const ask = (action) => decideBrowserOpen({ rawUrl: action.input.url, forget: false, remembered, workspaceRoot: WS, confirm });
  const tools = withBrowserOpenApproval(baseTools(), { host: hostWith(), workspaceRoot: WS });
  await tools.call("browser_open", { url: "https://example.com/a" }, ask);
  await tools.call("browser_open", { url: "https://example.com/b" }, ask);
  assert.equal(prompts, 2);
});

await t("a 200 s wait for the learner's browser answer does not stop the turn (#3582 budget)", async () => {
  let t0 = 0;
  let tick = null;
  const clock = { now: () => t0, setInterval: (fn) => { tick = fn; return 1; }, clearInterval: () => { tick = null; } };
  const humanWait = createHumanWait();
  const budget = localTurnBudget(() => humanWait.active(), 180000, clock);
  let release;
  const ask = (action) => humanWait.track(() => new Promise((resolve) => { release = resolve; }));
  const tools = withBrowserOpenApproval(baseTools(), { host: hostWith(), workspaceRoot: WS });
  const call = tools.call("browser_open", { url: "https://example.com/" }, ask);
  // The checks before the question (verdict, already-open) are awaited first; the wait starts after them.
  for (let i = 0; i < 20; i++) await flush();
  assert.equal(humanWait.active(), true, "the learner's answer is being waited for");
  for (let i = 0; i < 200; i++) { t0 += 1000; tick?.(); }
  assert.equal(budget.signal.aborted, false, "the browser answer wait is not charged");
  release(true);
  await call;
  budget.dispose();
});

await t("a turn that ends while the browser dialog is open denies the late answer and opens nothing", async () => {
  const base = baseTools();
  const ctrl = new AbortController();
  let answer;
  const pending = new Promise((resolve) => { answer = resolve; });
  // The runner's gate: a late answer after the turn ended is denied (#3582).
  const ask = (action) => answerUnlessTurnEnds(pending, ctrl.signal, false);
  const tools = withBrowserOpenApproval(base, { host: hostWith(), workspaceRoot: WS });
  const call = tools.call("browser_open", { url: "https://example.com/" }, ask).then(() => "opened", () => "refused");
  await flush();
  ctrl.abort();
  answer(true);
  assert.equal(await call, "refused");
  assert.equal(base.opened.length, 0, "a late approval opens nothing");
});

await t("both instructor paths build browser tools with the one helper, which applies the gate", () => {
  const src = readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
  assert.equal((src.match(/withBrowserOpenApproval\(/g) ?? []).length, 1, "the gate is applied once, in the shared helper");
  assert.equal((src.match(/this\.instructorBrowserTools\(/g) ?? []).length, 2, "legacy turn and Chalk contract turn both use the helper");
  assert.match(src, /browserTools: this\.instructorBrowserTools\(last\.content, cwd\)/);
  assert.match(src, /const browserTools = this\.instructorBrowserTools\(text, cwd\)/);
  assert.match(src, /return decideBrowserOpen\(\{/, "the provider's open decision is the shared function");
});

await t("the tool names of the two paths are the same set", () => {
  const legacy = withBrowserOpenApproval(baseTools(), { host: hostWith(), workspaceRoot: WS }).definitions.map((d) => d.name).sort();
  const contract = withBrowserOpenApproval(baseTools(), { host: hostWith(), workspaceRoot: WS }).definitions.map((d) => d.name).sort();
  assert.deepEqual(contract, legacy);
  assert.deepEqual(legacy, ["browser_open", "live_preview_start"]);
});

if (failed > 0) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall local-browser-open-approval checks passed");
