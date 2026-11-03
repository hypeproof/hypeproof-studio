// Chalk command contract v0, studio side. A stub command bus stands in for the Chalk extension,
// and a stub runner stands in for the local executor. No vscode module is loaded.
import assert from "node:assert/strict";
import {
  ChalkContractHost,
  CONTRACT_VERSION,
  NO_LOCAL_RUNTIME_MESSAGE,
  connectionFor,
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
  const host = new ChalkContractHost(bus, runner, () => `nonce-${++n}`);
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
  const host = new ChalkContractHost(bus, makeRunner(), () => "n");
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
