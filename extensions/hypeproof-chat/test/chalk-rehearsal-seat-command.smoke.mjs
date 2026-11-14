// #4048 (chalk#17) — the contract command that starts a same-window rehearsal: hypeproof.runtime.enterRehearsalSeat.
// Refused for a wrong nonce or when the instructor contract is not active; a good call enters once; the token
// never appears in a result. hasRehearsalReturn and endRehearsalSeat are not on the bus (Chalk is closed then).
import assert from "node:assert/strict";
import { ChalkContractHost, CONTRACT_VERSION } from "../src/chalkContract.ts";

let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${err && err.message}`); }
}

const TOKEN = "synthetic-student-token-4048-zz";
const REHEARSAL = { token: TOKEN, expiresAt: 1_700_000_000_000, rehearsalId: "rh-4048" };

// A bus with the contract's own activation answered, and a recorded set of seat-entry calls.
function makeBus() {
  const handlers = new Map();
  return {
    handlers,
    registerCommand(id, handler) { handlers.set(id, handler); return { dispose() { handlers.delete(id); } }; },
    async executeCommand(id, ...args) {
      if (id === "hypeproof.chalk.activateInstructor") return { ok: true };
      if (id === "hypeproof.runtime.stop") return undefined;
      const h = handlers.get(id);
      return h ? h(...args) : undefined;
    },
    call(id, args) { return handlers.get(id)(args); },
  };
}
const runner = () => ({ available: () => true, run: () => Promise.resolve({}), cancel: () => {}, dispose: () => {} });

async function activated({ enter } = {}) {
  const bus = makeBus();
  const calls = [];
  const ops = {
    openExternal: async () => ({ ok: true }), openReport: async () => ({ ok: true }),
    inboxView: async () => null, inboxOpened: async () => {}, inboxLink: async () => ({ ok: true }),
    reviewPrepare: async () => ({ ok: true }),
    enterRehearsalSeat: enter ?? (async (input) => { calls.push(input); }),
  };
  let n = 0;
  const host = new ChalkContractHost(bus, runner(), ops, () => `nonce-${++n}`);
  host.register();
  const r = await host.activate({ issuerToken: "tok-value", verifiedServerUrl: "https://api.example/v1", connection: "server" });
  assert.equal(r.ok, true, "activation");
  return { bus, calls };
}
const enterCall = (bus, args) => bus.call("hypeproof.runtime.enterRehearsalSeat", { contractVersion: CONTRACT_VERSION, sessionNonce: "nonce-1", ...args });

await t("the command is on the bus under the agreed id", async () => {
  const { bus } = await activated();
  assert.equal(typeof bus.handlers.get("hypeproof.runtime.enterRehearsalSeat"), "function");
});

await t("a wrong nonce is refused and nothing is entered", async () => {
  const { bus, calls } = await activated();
  const r = await enterCall(bus, { sessionNonce: "old", ...REHEARSAL });
  assert.deepEqual(r, { ok: false, reason: "stale" });
  assert.equal(calls.length, 0);
});

await t("with the instructor contract inactive the command is refused as inactive and nothing is entered", async () => {
  const bus = makeBus();
  const calls = [];
  const ops = { enterRehearsalSeat: async (i) => { calls.push(i); } };
  const host = new ChalkContractHost(bus, runner(), ops, () => "nonce-1");
  host.register();
  const r = await enterCall(bus, REHEARSAL);
  assert.deepEqual(r, { ok: false, reason: "inactive" });
  assert.equal(calls.length, 0);
});

await t("a good call enters the seat exactly once and returns ok", async () => {
  const { bus, calls } = await activated();
  const r = await enterCall(bus, REHEARSAL);
  assert.deepEqual(r, { ok: true });
  assert.equal(calls.length, 1, "enter is called once");
  assert.deepEqual(calls[0], REHEARSAL);
});

await t("a null expiry is passed as 0, which the seat treats as already expired on restart", async () => {
  const { bus, calls } = await activated();
  assert.deepEqual(await enterCall(bus, { ...REHEARSAL, expiresAt: null }), { ok: true });
  assert.equal(calls[0].expiresAt, 0);
});

await t("an empty token or a missing rehearsal id is refused as invalidArgs", async () => {
  const { bus, calls } = await activated();
  assert.deepEqual(await enterCall(bus, { ...REHEARSAL, token: "" }), { ok: false, reason: "invalidArgs" });
  assert.deepEqual(await enterCall(bus, { ...REHEARSAL, rehearsalId: "" }), { ok: false, reason: "invalidArgs" });
  assert.equal(calls.length, 0);
});

await t("a failed entry returns a short reason, and the token appears in no result", async () => {
  const { bus } = await activated({ enter: async () => { throw new Error("리허설 창을 열지 못했습니다. 강사 자격은 그대로입니다."); } });
  const r = await enterCall(bus, REHEARSAL);
  assert.deepEqual(r, { ok: false, reason: "failed" });
  assert.ok(!JSON.stringify(r).includes(TOKEN));
});

await t("the token never appears in a result, on any path", async () => {
  const { bus } = await activated();
  for (const args of [REHEARSAL, { ...REHEARSAL, token: "" }, { ...REHEARSAL, sessionNonce: "old" }]) {
    const r = await enterCall(bus, args);
    assert.ok(!JSON.stringify(r).includes(TOKEN), `leaked on ${JSON.stringify(r)}`);
  }
});

await t("a host without the seat entry answers unavailable, not a crash", async () => {
  const bus = makeBus();
  const ops = { enterRehearsalSeat: undefined };
  const host = new ChalkContractHost(bus, runner(), ops, () => "nonce-1");
  host.register();
  await bus.executeCommand("hypeproof.chalk.activateInstructor");
  // activation goes through the bus stub; the seat entry is absent in this host
  const r = await enterCall(bus, REHEARSAL);
  assert.ok(r.ok === false, "refused");
});

// The approved sentence is shown once on every failure path the command has (nonce, inactive, entry failure).
const ENTER_FAILED_TEXT = "리허설 창을 열지 못했습니다. 강사 자격은 그대로입니다.";
async function withNotify({ enter, noEnter } = {}) {
  const shown = [];
  const bus = makeBus();
  const ops = {
    openExternal: async () => ({ ok: true }), openReport: async () => ({ ok: true }),
    inboxView: async () => null, inboxOpened: async () => {}, inboxLink: async () => ({ ok: true }),
    reviewPrepare: async () => ({ ok: true }),
    enterRehearsalSeat: noEnter ? undefined : (enter ?? (async () => {})),
    notify: (m) => shown.push(m),
  };
  let n = 0;
  const host = new ChalkContractHost(bus, runner(), ops, () => `nonce-${++n}`);
  host.register();
  return { bus, shown, host, activate: () => host.activate({ issuerToken: "tok-value", verifiedServerUrl: "https://api.example/v1", connection: "server" }) };
}

await t("a stale nonce shows the approved sentence once and returns stale", async () => {
  const { bus, shown, activate } = await withNotify();
  await activate();
  assert.deepEqual(await enterCall(bus, { sessionNonce: "old", ...REHEARSAL }), { ok: false, reason: "stale" });
  assert.deepEqual(shown, [ENTER_FAILED_TEXT]);
});

await t("an inactive contract shows the approved sentence once and returns inactive", async () => {
  const { bus, shown } = await withNotify();
  assert.deepEqual(await enterCall(bus, REHEARSAL), { ok: false, reason: "inactive" });
  assert.deepEqual(shown, [ENTER_FAILED_TEXT]);
});

await t("an entry failure shows the approved sentence once, not twice, and returns failed", async () => {
  const { bus, shown, activate } = await withNotify({ enter: async () => { throw new Error("리허설 창을 열지 못했습니다. 강사 자격은 그대로입니다."); } });
  await activate();
  assert.deepEqual(await enterCall(bus, REHEARSAL), { ok: false, reason: "failed" });
  assert.deepEqual(shown, [ENTER_FAILED_TEXT], "one sentence, from the command path only");
});

await t("a good call shows nothing", async () => {
  const { bus, shown, activate } = await withNotify();
  await activate();
  assert.deepEqual(await enterCall(bus, REHEARSAL), { ok: true });
  assert.deepEqual(shown, []);
});

// #4052 — every result that is not ok shows the approved sentence exactly once, and the reason is a code.
const failureCases = [
  ["inactive", async () => withNotify(), (bus) => enterCall(bus, REHEARSAL), "inactive"],
  ["stale", async () => withNotify(), (bus) => enterCall(bus, { sessionNonce: "old", ...REHEARSAL }), "stale"],
  ["invalidArgs (no object)", async () => withNotify(), (bus) => bus.call("hypeproof.runtime.enterRehearsalSeat", null), "invalidArgs"],
  ["invalidArgs (empty token)", async () => withNotify(), (bus) => enterCall(bus, { ...REHEARSAL, token: "" }), "invalidArgs"],
  ["invalidArgs (no rehearsal id)", async () => withNotify(), (bus) => enterCall(bus, { ...REHEARSAL, rehearsalId: "" }), "invalidArgs"],
  ["invalidArgs (bad expiry)", async () => withNotify(), (bus) => enterCall(bus, { ...REHEARSAL, expiresAt: "soon" }), "invalidArgs"],
  ["contractVersion", async () => withNotify(), (bus) => bus.call("hypeproof.runtime.enterRehearsalSeat", { contractVersion: 999, sessionNonce: "nonce-1", ...REHEARSAL }), "contractVersion"],
  ["unavailable (no seat entry)", async () => withNotify({ noEnter: true }), (bus) => enterCall(bus, REHEARSAL), "unavailable"],
  ["failed (entry throws)", async () => withNotify({ enter: async () => { throw new Error("internal"); } }), (bus) => enterCall(bus, REHEARSAL), "failed"],
];
for (const [label, make, call, reason] of failureCases) {
  await t(`a non-ok result (${label}) returns ${reason} and shows the approved sentence exactly once`, async () => {
    const { bus, shown, activate } = await make();
    // Every case except inactive runs with an active contract, so the refusal comes from the reason under test.
    if (reason !== "inactive") await activate();
    const r = await call(bus);
    assert.deepEqual(r, { ok: false, reason });
    assert.deepEqual(shown, [ENTER_FAILED_TEXT], "one sentence");
    assert.ok(!JSON.stringify(r).includes(TOKEN), "no token in the result");
  });
}

await t("hasRehearsalReturn and endRehearsalSeat are not on the bus", async () => {
  const { bus } = await activated();
  assert.equal(bus.handlers.get("hypeproof.runtime.hasRehearsalReturn"), undefined);
  assert.equal(bus.handlers.get("hypeproof.runtime.endRehearsalSeat"), undefined);
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log("\nall chalk-rehearsal-seat-command checks passed");
