// S-2a (#2556): the instructor verdict follows the server address as well as the token.
// A stub bus stands in for the Chalk extension and a stub fetch for the Service.
import assert from "node:assert/strict";
import { InstructorModeManager } from "../src/instructorMode.ts";
import { ChalkContractHost, resolveInstructorRuntime, syncInstructorSession } from "../src/chalkContract.ts";

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

const A = "https://a.test/v1";
const B = "https://b.test/v1";

// status: an HTTP code, or "throw" for a network failure. Calls are the whoami URLs asked.
async function withFetch(status, fn) {
  const orig = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (status === "throw") throw new Error("network");
    return { ok: status < 400, status };
  };
  try { await fn(calls); } finally { globalThis.fetch = orig; }
}

function makeBus(activateReply = { ok: true }) {
  const handlers = new Map();
  const calls = [];
  return {
    calls,
    registerCommand(id, handler) { handlers.set(id, handler); return { dispose() { handlers.delete(id); } }; },
    async executeCommand(id, ...args) {
      calls.push({ id, args });
      if (id === "hypeproof.chalk.activateInstructor") return activateReply;
      return undefined;
    },
  };
}

const stubRunner = {
  available: () => false,
  executorModel: () => undefined,
  async run() {},
  async previewOpen() { return { ok: false, error: "none" }; },
};

function makeHost(bus) {
  let n = 0;
  const host = new ChalkContractHost(bus, stubRunner, () => `nonce-${++n}`);
  host.register();
  return host;
}

// One judgment step as chatPanelProvider runs it on the new path: judge, then sync the contract.
async function judgeAndSync(mgr, host, view, token, url) {
  const isInstructor = await mgr.checkInstructorMode(token, url);
  return syncInstructorSession(host, view, {
    isInstructor,
    panelMode: "instructor",
    issuerToken: token,
    url: mgr.verifiedServerUrl ?? url,
    connection: "server",
  });
}

const ids = (bus) => bus.calls.map((c) => c.id);
const ACTIVATE = "hypeproof.chalk.activateInstructor";
const DEACTIVATE = "hypeproof.chalk.deactivateInstructor";

console.log("=== judgment keyed by token and address ===");

await t("(a) a new server address is judged again against the new admin base", async () => {
  const mgr = new InstructorModeManager();
  await withFetch(200, async (calls) => {
    await mgr.checkInstructorMode("tok", A);
    await mgr.checkInstructorMode("tok", B);
    assert.deepEqual(calls, ["https://a.test/admin/chalk/whoami", "https://b.test/admin/chalk/whoami"]);
  });
});

await t("(b) the same token and address are not judged again, with or without the /v1 suffix", async () => {
  const mgr = new InstructorModeManager();
  await withFetch(200, async (calls) => {
    await mgr.checkInstructorMode("tok", A);
    await mgr.checkInstructorMode("tok", A);
    await mgr.checkInstructorMode("tok", "https://a.test/v1/");
    assert.equal(calls.length, 1);
  });
});

console.log("=== contract sync on the new path ===");

await t("(c) a new address judged as instructor activates once more with the new address and a new nonce", async () => {
  const bus = makeBus();
  const host = makeHost(bus);
  const mgr = new InstructorModeManager();
  await withFetch(200, async () => {
    let view = await judgeAndSync(mgr, host, {}, "tok", A);
    view = await judgeAndSync(mgr, host, view, "tok", B);
    assert.deepEqual(ids(bus), [ACTIVATE, ACTIVATE], "no deactivation between the two activations");
    assert.equal(bus.calls[1].args[0].verifiedServerUrl, B);
    assert.notEqual(bus.calls[1].args[0].sessionNonce, bus.calls[0].args[0].sessionNonce);
    assert.equal(view.url, B);
  });
});

await t("(c') a new address judged as not instructor deactivates with reason rejected", async () => {
  const bus = makeBus();
  const host = makeHost(bus);
  const mgr = new InstructorModeManager();
  await withFetch(200, async () => {
    let view = await judgeAndSync(mgr, host, {}, "tok", A);
    await withFetch(401, async () => { view = await judgeAndSync(mgr, host, view, "tok", B); });
    assert.deepEqual(ids(bus), [ACTIVATE, DEACTIVATE]);
    assert.equal(bus.calls[1].args[0].reason, "rejected");
    assert.equal(host.active, false);
    assert.deepEqual(view, {});
  });
});

await t("(d) a failed judgment at the new address leaves no instructor authority", async () => {
  const bus = makeBus();
  const host = makeHost(bus);
  const mgr = new InstructorModeManager();
  await withFetch(200, async () => {
    let view = await judgeAndSync(mgr, host, {}, "tok", A);
  });
  await withFetch("throw", async () => {
    const view = await judgeAndSync(mgr, host, { token: "tok", url: A, connection: "server" }, "tok", B);
    assert.notEqual(mgr.isInstructor, true, "unreachable whoami does not grant instructor");
    assert.equal(host.active, false, "the session is gone");
    assert.deepEqual(view, {});
  });
  assert.deepEqual(ids(bus), [ACTIVATE, DEACTIVATE], "after the failure no activation follows");
  assert.equal(bus.calls[1].args[0].reason, "rejected");
});

await t("the same verdict on the same session makes no further contract calls", async () => {
  const bus = makeBus();
  const host = makeHost(bus);
  const mgr = new InstructorModeManager();
  await withFetch(200, async () => {
    let view = await judgeAndSync(mgr, host, {}, "tok", A);
    view = await judgeAndSync(mgr, host, view, "tok", A);
    assert.deepEqual(ids(bus), [ACTIVATE]);
  });
});

await t("a changed token still ends the old session first, as before", async () => {
  const bus = makeBus();
  const host = makeHost(bus);
  const mgr = new InstructorModeManager();
  await withFetch(200, async () => {
    let view = await judgeAndSync(mgr, host, {}, "tok-1", A);
    view = await judgeAndSync(mgr, host, view, "tok-2", A);
    assert.deepEqual(ids(bus), [ACTIVATE, DEACTIVATE, ACTIVATE]);
    assert.equal(bus.calls[1].args[0].reason, "superseded");
  });
});

console.log("=== default runtime ===");

await t("(e) the default runtime is legacy and a steady address is judged once", async () => {
  assert.equal(resolveInstructorRuntime(undefined), "legacy");
  assert.equal(resolveInstructorRuntime("legacy"), "legacy");
  const mgr = new InstructorModeManager();
  await withFetch(200, async (calls) => {
    await mgr.checkInstructorMode("tok", A);
    await mgr.checkInstructorMode("tok", A);
    assert.equal(calls.length, 1);
    assert.equal(mgr.isInstructor, true);
  });
});

if (failed > 0) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall chalk-instructor-rejudge checks passed");
