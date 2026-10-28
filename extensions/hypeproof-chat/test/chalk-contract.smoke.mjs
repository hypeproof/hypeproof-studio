// Chalk command contract v0, studio side. A stub command bus stands in for the Chalk extension,
// and a stub runner stands in for the local executor. No vscode module is loaded.
import assert from "node:assert/strict";
import {
  ChalkContractHost,
  CONTRACT_VERSION,
  NO_LOCAL_RUNTIME_MESSAGE,
  connectionFor,
  needsChalkPrompt,
  reportSourceLabel,
  resolveInstructorRuntime,
} from "../src/chalkContract.ts";

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
const tick = () => new Promise((r) => setTimeout(r, 0));


function makeOps(over = {}) {
  const calls = [];
  const rec = (name, v) => { calls.push([name, v]); return v; };
  return {
    calls,
    openExternal: async (url) => rec("openExternal", { ok: true, url }),
    openReport: async (source) => rec("openReport", { ok: true, source }),
    inboxView: async () => rec("inboxView", { run: "r1", cards: [] }),
    inboxOpened: async (objectId, generation) => { rec("inboxOpened", { objectId, generation }); },
    inboxLink: async (objectId, url, generation, action) => rec("inboxLink", { ok: true, objectId, url, generation, action }),
    reviewPrepare: async (week) => rec("reviewPrepare", { ok: true, week }),
    ...over,
  };
}

function makeBus(activateReply = { ok: true }) {
  const handlers = new Map();
  const calls = [];
  return {
    calls,
    handlers,
    registerCommand(id, handler) {
      handlers.set(id, handler);
      return { dispose() { handlers.delete(id); } };
    },
    async executeCommand(id, ...args) {
      calls.push({ id, args });
      if (id === "hypeproof.chalk.activateInstructor") return activateReply;
      return undefined;
    },
    call(id, arg) { return handlers.get(id)(arg); },
  };
}

function makeRunner({ available = true, executorModel = "claude-test", behaviour } = {}) {
  const runs = [];
  return {
    runs,
    available: () => available,
    executorModel: () => executorModel,
    previewCalls: [],
    async run(input) {
      runs.push(input);
      if (behaviour) return behaviour(input);
      await input.emit({ kind: "delta", text: "안녕" });
    },
    async previewOpen(webPath) { this.previewCalls.push(webPath); return { ok: true }; },
  };
}

async function activated(bus, runner) {
  let n = 0;
  const host = new ChalkContractHost(bus, runner, makeOps(), () => `nonce-${++n}`);
  host.register();
  const r = await host.activate({ issuerToken: "tok-value", verifiedServerUrl: "https://api.example/v1", connection: "server" });
  assert.equal(r.ok, true);
  return host;
}

console.log("=== activation ===");
await t("activateInstructor carries version, nonce, token, verified url and connection", async () => {
  const bus = makeBus();
  await activated(bus, makeRunner());
  const call = bus.calls.find((c) => c.id === "hypeproof.chalk.activateInstructor");
  assert.deepEqual(call.args[0], {
    contractVersion: CONTRACT_VERSION,
    sessionNonce: "nonce-1",
    issuerToken: "tok-value",
    verifiedServerUrl: "https://api.example/v1",
    connection: "server",
  });
});

await t("a refused activation leaves the host inactive and passes the reason", async () => {
  const bus = makeBus({ ok: false, reason: "serverChanged" });
  const host = new ChalkContractHost(bus, makeRunner(), makeOps(), () => "n");
  host.register();
  const r = await host.activate({ issuerToken: "x", verifiedServerUrl: "u", connection: "server" });
  assert.deepEqual(r, { ok: false, reason: "serverChanged" });
  assert.equal(host.active, false);
});

console.log("=== runLocalTurn refusals ===");
await t("no local executor → noLocalRuntime with the exact operating message", async () => {
  const bus = makeBus();
  const runner = makeRunner({ available: false });
  const host = await activated(bus, runner);
  const r = await bus.call("hypeproof.runtime.runLocalTurn", {
    contractVersion: 1, sessionNonce: "nonce-1", turnId: "t1", policy: "chalk-instructor",
    messages: [], tools: [], systemBrief: "", cwd: "/w",
  });
  assert.equal(r.accepted, false);
  assert.equal(r.reason, "noLocalRuntime");
  assert.equal(r.message, NO_LOCAL_RUNTIME_MESSAGE);
  assert.equal(NO_LOCAL_RUNTIME_MESSAGE, "강사 채팅은 지금 내 Claude 구독 연결에서만 됩니다.");
  assert.equal(runner.runs.length, 0);
  assert.equal(host.active, true);
});

await t("wrong session nonce is refused and the runner is not called", async () => {
  const bus = makeBus();
  const runner = makeRunner();
  await activated(bus, runner);
  const r = await bus.call("hypeproof.runtime.runLocalTurn", {
    contractVersion: 1, sessionNonce: "old", turnId: "t1", policy: "chalk-instructor",
    messages: [], tools: [],
  });
  assert.equal(r.accepted, false);
  assert.equal(runner.runs.length, 0);
});

await t("a policy outside the enum is refused", async () => {
  const bus = makeBus();
  const runner = makeRunner();
  await activated(bus, runner);
  const r = await bus.call("hypeproof.runtime.runLocalTurn", {
    contractVersion: 1, sessionNonce: "nonce-1", turnId: "t1", policy: "student",
    messages: [], tools: [],
  });
  assert.deepEqual(r, { accepted: false, reason: "policy" });
  assert.equal(runner.runs.length, 0);
});

await t("a different contractVersion is refused", async () => {
  const bus = makeBus();
  const runner = makeRunner();
  await activated(bus, runner);
  const r = await bus.call("hypeproof.runtime.runLocalTurn", {
    contractVersion: 2, sessionNonce: "nonce-1", turnId: "t1", policy: "chalk-instructor",
    messages: [], tools: [],
  });
  assert.deepEqual(r, { accepted: false, reason: "contractVersion" });
});

console.log("=== runLocalTurn accepted ===");
await t("accepted turn records the requested model, reports the executor model, streams events by turn id", async () => {
  const bus = makeBus();
  const runner = makeRunner({ executorModel: "claude-test" });
  await activated(bus, runner);
  const r = await bus.call("hypeproof.runtime.runLocalTurn", {
    contractVersion: 1, sessionNonce: "nonce-1", turnId: "t1", policy: "chalk-instructor",
    model: "some-free-text-model",
    messages: [{ role: "user", content: "hi" }], tools: [], systemBrief: "brief", cwd: "/w",
  });
  assert.deepEqual(r, { accepted: true, requestedModel: "some-free-text-model", executorModel: "claude-test" });
  assert.equal(runner.runs[0].model, "some-free-text-model");
  await tick();
  const events = bus.calls.filter((c) => c.id === "hypeproof.chalk.onTurnEvent").map((c) => c.args[0]);
  assert.equal(events[0].turnId, "t1");
  assert.equal(events[0].sessionNonce, "nonce-1");
  assert.deepEqual(events[0].event, { kind: "delta", text: "안녕" });
  assert.equal(events.at(-1).event.kind, "done");
  assert.equal(events.at(-1).event.status, "ok");
});

await t("cancelTurn aborts the open turn and reports done(cancelled)", async () => {
  const bus = makeBus();
  const runner = makeRunner({
    behaviour: (input) => new Promise((_, reject) => {
      input.signal.addEventListener("abort", () => reject(new Error("aborted")));
    }),
  });
  await activated(bus, runner);
  await bus.call("hypeproof.runtime.runLocalTurn", {
    contractVersion: 1, sessionNonce: "nonce-1", turnId: "t2", policy: "chalk-instructor",
    messages: [], tools: [],
  });
  const c = await bus.call("hypeproof.runtime.cancelTurn", { contractVersion: 1, sessionNonce: "nonce-1", turnId: "t2" });
  assert.deepEqual(c, { cancelled: true });
  await tick(); await tick();
  const done = bus.calls.filter((x) => x.id === "hypeproof.chalk.onTurnEvent").map((x) => x.args[0]).find((e) => e.event.kind === "done");
  assert.equal(done.event.status, "cancelled");
});

await t("cancelTurn with a stale nonce does nothing", async () => {
  const bus = makeBus();
  await activated(bus, makeRunner());
  const c = await bus.call("hypeproof.runtime.cancelTurn", { contractVersion: 1, sessionNonce: "old", turnId: "t9" });
  assert.deepEqual(c, { cancelled: false });
});

console.log("=== M-4 commands (S-2b) ===");
const sessionArgs = { contractVersion: 1, sessionNonce: "nonce-1" };
await t("openExternal passes url through the ops and refuses without a session", async () => {
  const bus = makeBus();
  const ops = makeOps();
  const host = new ChalkContractHost(bus, makeRunner(), ops, () => "nonce-1");
  host.register();
  await host.activate({ issuerToken: "x", verifiedServerUrl: "u", connection: "server" });
  assert.deepEqual(await bus.call("hypeproof.runtime.openExternal", { ...sessionArgs, url: "https://runbook.example/x" }), { ok: true });
  assert.deepEqual(await bus.call("hypeproof.runtime.openExternal", { contractVersion: 1, sessionNonce: "old", url: "https://x" }), { ok: false, reason: "noSession" });
  assert.deepEqual(await bus.call("hypeproof.runtime.openExternal", { ...sessionArgs, url: "" }), { ok: false, reason: "invalidArgs" });
  assert.equal(ops.calls.length, 1);
});

await t("openReport keeps only a short lowercase source label and drops every other key (token keys too)", async () => {
  assert.equal(reportSourceLabel({ source: "chalk" }), "chalk");
  assert.equal(reportSourceLabel({ source: "Chalk Ext" }), undefined);
  assert.equal(reportSourceLabel({ source: "a".repeat(33) }), undefined);
  assert.equal(reportSourceLabel({ source: "a".repeat(32) }), "a".repeat(32));
  assert.equal(reportSourceLabel(undefined), undefined);
  const bus = makeBus();
  const ops = makeOps();
  const host = new ChalkContractHost(bus, makeRunner(), ops, () => "nonce-1");
  host.register();
  await host.activate({ issuerToken: "x", verifiedServerUrl: "u", connection: "server" });
  const reply = await bus.call("hypeproof.runtime.openReport", { ...sessionArgs, context: { source: "chalk", issuerToken: "tok-value", token: "secret" } });
  assert.deepEqual(reply, { ok: true });
  assert.deepEqual(ops.calls, [["openReport", { ok: true, source: "chalk" }]]);
  assert.ok(!JSON.stringify(reply).includes("tok-value"));
});

await t("inboxView returns the view or null, and never passes a token to the ops", async () => {
  const bus = makeBus();
  const ops = makeOps({ inboxView: async () => null });
  const host = new ChalkContractHost(bus, makeRunner(), ops, () => "nonce-1");
  host.register();
  await host.activate({ issuerToken: "x", verifiedServerUrl: "u", connection: "server" });
  assert.equal(await bus.call("hypeproof.runtime.inboxView", sessionArgs), null);
  assert.equal(await bus.call("hypeproof.runtime.inboxView", { contractVersion: 1, sessionNonce: "old" }), null);
});

await t("inboxOpen and inboxLink validate arguments and call the ops once", async () => {
  const bus = makeBus();
  const ops = makeOps();
  const host = new ChalkContractHost(bus, makeRunner(), ops, () => "nonce-1");
  host.register();
  await host.activate({ issuerToken: "x", verifiedServerUrl: "u", connection: "server" });
  assert.deepEqual(await bus.call("hypeproof.runtime.inboxOpen", { ...sessionArgs, objectId: "o1", generation: 3 }), { ok: true });
  assert.deepEqual(await bus.call("hypeproof.runtime.inboxOpen", { ...sessionArgs, objectId: "o1", generation: "3" }), { ok: false });
  assert.deepEqual(await bus.call("hypeproof.runtime.inboxLink", { ...sessionArgs, objectId: "o1", url: "https://a.example", generation: 3, action: "copy" }), { ok: true });
  assert.deepEqual(await bus.call("hypeproof.runtime.inboxLink", { ...sessionArgs, objectId: "o1", url: "https://a.example", generation: 3, action: "delete" }), { ok: false });
  assert.deepEqual(ops.calls.map(c => c[0]), ["inboxOpened", "inboxLink"]);
});

await t("reviewPrepare passes an integer week only and calls prepare once", async () => {
  const bus = makeBus();
  const ops = makeOps();
  const host = new ChalkContractHost(bus, makeRunner(), ops, () => "nonce-1");
  host.register();
  await host.activate({ issuerToken: "x", verifiedServerUrl: "u", connection: "server" });
  assert.deepEqual(await bus.call("hypeproof.runtime.reviewPrepare", { ...sessionArgs, week: 4 }), { ok: true });
  assert.deepEqual(await bus.call("hypeproof.runtime.reviewPrepare", { ...sessionArgs, week: "4" }), { ok: true });
  assert.deepEqual(ops.calls, [["reviewPrepare", { ok: true, week: 4 }], ["reviewPrepare", { ok: true, week: undefined }]]);
});

await t("done(error) carries requestId and runbookUrl when the runner error has them, and omits them otherwise", async () => {
  const bus = makeBus();
  const runner = makeRunner({
    behaviour: async () => { const e = new Error("fail"); e.requestId = "req-42"; e.runbookUrl = "https://runbook.example/x"; throw e; },
  });
  const host = new ChalkContractHost(bus, runner, makeOps(), () => "nonce-1");
  host.register();
  await host.activate({ issuerToken: "x", verifiedServerUrl: "u", connection: "server" });
  await bus.call("hypeproof.runtime.runLocalTurn", { ...sessionArgs, turnId: "t9", policy: "chalk-instructor", messages: [], tools: [] });
  await tick(); await tick();
  const done = bus.calls.filter((c) => c.id === "hypeproof.chalk.onTurnEvent").map((c) => c.args[0]).find((e) => e.event.kind === "done");
  assert.deepEqual(done.event, { kind: "done", status: "error", message: "fail", requestId: "req-42", runbookUrl: "https://runbook.example/x" });

  const bus2 = makeBus();
  const plain = makeRunner({ behaviour: async () => { throw new Error("plain"); } });
  const host2 = new ChalkContractHost(bus2, plain, makeOps(), () => "nonce-1");
  host2.register();
  await host2.activate({ issuerToken: "x", verifiedServerUrl: "u", connection: "server" });
  await bus2.call("hypeproof.runtime.runLocalTurn", { ...sessionArgs, turnId: "t10", policy: "chalk-instructor", messages: [], tools: [] });
  await tick(); await tick();
  const done2 = bus2.calls.filter((c) => c.id === "hypeproof.chalk.onTurnEvent").map((c) => c.args[0]).find((e) => e.event.kind === "done");
  assert.deepEqual(done2.event, { kind: "done", status: "error", message: "plain" });
});

await t("pushInbox sends onInboxState only in an active session, with the nonce and version", async () => {
  const bus = makeBus();
  const host = new ChalkContractHost(bus, makeRunner(), makeOps({ inboxView: async () => ({ run: "r1" }) }), () => "nonce-1");
  host.register();
  await host.pushInbox();
  assert.equal(bus.calls.filter((c) => c.id === "hypeproof.chalk.onInboxState").length, 0);
  await host.activate({ issuerToken: "x", verifiedServerUrl: "u", connection: "server" });
  await host.pushInbox();
  const sent = bus.calls.filter((c) => c.id === "hypeproof.chalk.onInboxState");
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].args[0], { contractVersion: 1, sessionNonce: "nonce-1", view: { run: "r1" } });
});

await t("needsChalkPrompt routes only openBrowser and writeFile, and only when the policy asks for them", async () => {
  const defaults = ["executeShell", "openBrowser", "delegateAgent", "browserType"];
  assert.equal(needsChalkPrompt("openBrowser", defaults), true);
  assert.equal(needsChalkPrompt("writeFile", defaults), false);
  assert.equal(needsChalkPrompt("writeFile", [...defaults, "writeFile"]), true);
  for (const kind of ["executeShell", "delegateAgent", "browserType", "consultHelper", "readFile"]) {
    assert.equal(needsChalkPrompt(kind, [...defaults, "writeFile", "consultHelper"]), false, `${kind} must stay in Studio`);
  }
});

await t("askApproval sends an approvalRequest with the prompt and resolves false without an explicit approval", async () => {
  const bus = makeBus();
  let asked = null;
  const runner = makeRunner({
    behaviour: async (input) => {
      asked = await input.askApproval({ kind: "openBrowser", toolName: "browser_open", input: { url: "https://a.example" }, title: "브라우저 열기", verb: "열기", files: ["https://a.example"] });
    },
  });
  const host = new ChalkContractHost(bus, runner, makeOps(), () => "nonce-1");
  host.register();
  await host.activate({ issuerToken: "x", verifiedServerUrl: "u", connection: "server" });
  bus.handlers.get("hypeproof.runtime.runLocalTurn");
  await bus.call("hypeproof.runtime.runLocalTurn", { ...sessionArgs, turnId: "t11", policy: "chalk-instructor", messages: [], tools: [] });
  await tick(); await tick();
  const req = bus.calls.filter((c) => c.id === "hypeproof.chalk.onTurnEvent").map((c) => c.args[0]).find((e) => e.event.kind === "approvalRequest");
  assert.equal(req.event.action.prompt.title, "브라우저 열기");
  assert.equal(req.event.action.prompt.verb, "열기");
  assert.deepEqual(req.event.action.prompt.files, ["https://a.example"]);
  assert.equal(asked, false, "no reply from Chalk means not approved");
});

console.log("=== deactivate and preview ===");
await t("deactivate aborts open turns, sends the reason, and later turns are refused", async () => {
  const bus = makeBus();
  const runner = makeRunner({
    behaviour: (input) => new Promise((_, reject) => input.signal.addEventListener("abort", () => reject(new Error("x")))),
  });
  const host = await activated(bus, runner);
  await bus.call("hypeproof.runtime.runLocalTurn", {
    contractVersion: 1, sessionNonce: "nonce-1", turnId: "t3", policy: "chalk-instructor", messages: [], tools: [],
  });
  await host.deactivate("issuerRemoved");
  const deact = bus.calls.find((c) => c.id === "hypeproof.chalk.deactivateInstructor");
  assert.deepEqual(deact.args[0], { contractVersion: 1, sessionNonce: "nonce-1", reason: "issuerRemoved" });
  assert.equal(host.active, false);
  const r = await bus.call("hypeproof.runtime.runLocalTurn", {
    contractVersion: 1, sessionNonce: "nonce-1", turnId: "t4", policy: "chalk-instructor", messages: [], tools: [],
  });
  assert.equal(r.accepted, false);
});

await t("previewOpen takes the v0 shape (no nonce) and passes webPath to the runner", async () => {
  const bus = makeBus();
  const runner = makeRunner();
  await activated(bus, runner);
  const r = await bus.call("hypeproof.runtime.previewOpen", { contractVersion: 1, webPath: "lesson/index.html" });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(runner.previewCalls, ["lesson/index.html"]);
  const bad = await bus.call("hypeproof.runtime.previewOpen", { contractVersion: 9, webPath: "x" });
  assert.equal(bad.ok, false);
});

console.log("=== settings and connection values ===");
await t("instructorRuntime defaults to legacy; only the exact chalk-extension value switches", () => {
  assert.equal(resolveInstructorRuntime(undefined), "legacy");
  assert.equal(resolveInstructorRuntime("legacy"), "legacy");
  assert.equal(resolveInstructorRuntime("chalk-extension"), "chalk-extension");
  assert.equal(resolveInstructorRuntime("Chalk-Extension"), "legacy");
  assert.equal(resolveInstructorRuntime(""), "legacy");
});

await t("connection values follow the legacy label source (chatPanelProvider instructorConnection)", () => {
  assert.equal(connectionFor("claude", true), "subscription-claude");
  assert.equal(connectionFor("codex", true), "subscription-codex");
  assert.equal(connectionFor("claude", false), "server");
  assert.equal(connectionFor(undefined, true), "server");
});

if (failed > 0) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall chalk-contract checks passed");
