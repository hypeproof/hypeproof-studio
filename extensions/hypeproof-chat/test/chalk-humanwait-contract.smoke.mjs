// #3601 — 계약 경로의 사람 대기 신호 (hypeproof.runtime.humanWait) 시험.
// Chalk 쪽 신호를 받아 정지 감지의 일시정지를 만든다. vscode 모듈은 로드하지 않는다.
//
// 대조군 규율 (양방향):
//   정상 신호는 대기로 세고, 모르는 id·끝난 턴·잘못된 인자는 무시(거부)한다.
//   C1 시작·유지·끝 / C2 동시 4개 상한 / C3 keepalive 가 이어지면 15분도 유지
//   C4 keepalive 가 끊기면 90초 뒤 대기 종료 / C5 모르는 id 무시
//   C6 절전 복귀 (점프)에 끊기지 않음 / C7 끝 신호
//   H1~H8 명령 등록·인자 검사·턴 종료·deactivate·취소 정리·옛 Chalk(신호 없음)
import assert from "node:assert/strict";
import { ChalkContractHost, CONTRACT_VERSION } from "../src/chalkContract.ts";
import { createContractWaits, HUMAN_WAIT_MAX_CONCURRENT, HUMAN_WAIT_LIVENESS_MS } from "../src/localRuntime/humanWait.ts";

let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${err && err.message}`); }
}

function fakeNow() {
  let now = 1_000_000;
  return { now: () => now, advance: (ms) => { now += ms; }, jump: (ms) => { now += ms; } };
}
const SEC = 1000;
// Real use polls active() every second (the stall tick does). Tests poll the same way.
function pollFor(clock, w, ms) { for (let i = 0; i < ms / SEC; i++) { clock.advance(SEC); w.active(); } }

console.log("=== C. 대기 묶음 (createContractWaits) ===");
await t("C1 start → 대기 중, end → 끝. 같은 id 의 중복 start 는 한 번으로 센다", () => {
  const clock = fakeNow();
  const w = createContractWaits(clock);
  assert.equal(w.start("a").ok, true);
  assert.equal(w.start("a").ok, true, "duplicate start is accepted");
  assert.equal(w.open(), 1, "counted once");
  assert.equal(w.active(), true);
  assert.equal(w.end("a").ok, true);
  assert.equal(w.active(), false);
});
await t("C2 동시 상한 4: 다섯 번째 start 는 limit, 하나 끝나면 다시 된다", () => {
  assert.equal(HUMAN_WAIT_MAX_CONCURRENT, 4);
  const w = createContractWaits(fakeNow());
  for (const id of ["a", "b", "c", "d"]) assert.equal(w.start(id).ok, true);
  assert.deepEqual(w.start("e"), { ok: false, reason: "limit" });
  assert.equal(w.end("a").ok, true);
  assert.equal(w.start("e").ok, true);
});
await t("C3 keepalive 가 30초마다 오면 15분 동안 대기가 유지된다", () => {
  const clock = fakeNow();
  const w = createContractWaits(clock);
  w.start("a");
  for (let i = 0; i < 30; i++) {
    pollFor(clock, w, 30 * SEC);
    assert.equal(w.keepalive("a").ok, true);
    assert.equal(w.active(), true, `still waiting at ${(i + 1) * 30}s`);
  }
});
await t("C4 keepalive 가 끊기면 90초가 지나 대기가 끝난다 (89초에는 아직 있다)", () => {
  assert.equal(HUMAN_WAIT_LIVENESS_MS, 90_000);
  const clock = fakeNow();
  const w = createContractWaits(clock);
  w.start("a");
  pollFor(clock, w, 89 * SEC);
  assert.equal(w.active(), true, "still counted at 89 s");
  pollFor(clock, w, 2 * SEC);
  assert.equal(w.active(), false, "ended after 90 s without keepalive");
});
await t("C5 모르는 waitId 의 keepalive·end 는 stale 로 무시한다 (이미 끝난 대기 포함)", () => {
  const clock = fakeNow();
  const w = createContractWaits(clock);
  assert.deepEqual(w.keepalive("zz"), { ok: false, reason: "stale" });
  assert.deepEqual(w.end("zz"), { ok: false, reason: "stale" });
  w.start("a");
  pollFor(clock, w, 100 * SEC); // expired by liveness
  assert.equal(w.active(), false);
  assert.deepEqual(w.end("a"), { ok: false, reason: "stale" }, "late end after expiry is ignored");
  assert.deepEqual(w.keepalive("a"), { ok: false, reason: "stale" }, "late keepalive after expiry is ignored");
  assert.equal(w.open(), 0, "no negative count");
});
await t("C6 절전 복귀: 시계가 크게 뛰어도 정상 대기는 끊기지 않는다 (음성 대조: 점프 없으면 끊긴다)", () => {
  const clock = fakeNow();
  const w = createContractWaits(clock);
  w.start("a");
  clock.jump(5 * 60 * SEC);
  assert.equal(w.active(), true, "no judgment on the wake");
  assert.equal(w.keepalive("a").ok, true, "keepalive resumes");
  const c2 = fakeNow();
  const neg2 = createContractWaits(c2);
  neg2.start("b");
  pollFor(c2, neg2, 100 * SEC);
  assert.equal(neg2.active(), false, "without a wake the same silence ends the wait");
});
await t("C7 끝 신호와 턴 정리: endAll 은 모든 대기를 끝낸다", () => {
  const w = createContractWaits(fakeNow());
  w.start("a"); w.start("b");
  w.endAll();
  assert.equal(w.active(), false);
  assert.equal(w.open(), 0);
});

console.log("=== H. 계약 명령 (ChalkContractHost) ===");
function makeBus() {
  const handlers = new Map();
  const calls = [];
  return {
    calls, handlers,
    registerCommand(id, handler) { handlers.set(id, handler); return { dispose() { handlers.delete(id); } }; },
    async executeCommand(id, ...args) {
      calls.push({ id, args });
      if (id === "hypeproof.chalk.activateInstructor") return { ok: true };
      return undefined;
    },
    call(id, arg) { return handlers.get(id)(arg); },
  };
}
function makeRunner(behaviour) {
  const runs = [];
  return {
    runs,
    available: () => true,
    executorModel: () => "claude-test",
    async run(input) { runs.push(input); if (behaviour) return behaviour(input); },
    async previewOpen() { return { ok: true }; },
  };
}
const ops = {};
async function activated(bus, runner) {
  let n = 0;
  const host = new ChalkContractHost(bus, runner, ops, () => `nonce-${++n}`);
  host.register();
  const r = await host.activate({ issuerToken: "tok-value", verifiedServerUrl: "https://api.example/v1", connection: "server" });
  assert.equal(r.ok, true);
  return host;
}
const hwCall = (bus, args) => bus.call("hypeproof.runtime.humanWait", { contractVersion: CONTRACT_VERSION, sessionNonce: "nonce-1", turnId: "t1", ...args });

await t("H1 humanWait 명령이 등록된다", async () => {
  const bus = makeBus();
  await activated(bus, makeRunner());
  assert.ok(bus.handlers.has("hypeproof.runtime.humanWait"));
});
await t("H2 인자 검사: 버전·nonce·state·waitId 가 틀리면 거부한다", async () => {
  const bus = makeBus();
  const host = await activated(bus, makeRunner(() => new Promise(() => {})));
  await bus.call("hypeproof.runtime.runLocalTurn", { contractVersion: 1, sessionNonce: "nonce-1", turnId: "t1", policy: "chalk-instructor", messages: [], tools: [], systemBrief: "", cwd: "/w" });
  assert.deepEqual(await hwCall(bus, { contractVersion: 2, waitId: "w", state: "start" }), { ok: false, reason: "contractVersion" });
  assert.deepEqual(await hwCall(bus, { sessionNonce: "old", waitId: "w", state: "start" }), { ok: false, reason: "stale" });
  assert.deepEqual(await hwCall(bus, { waitId: "w", state: "pause" }), { ok: false, reason: "invalidArgs" });
  assert.deepEqual(await hwCall(bus, { state: "start" }), { ok: false, reason: "invalidArgs" }, "missing waitId");
  assert.deepEqual(await hwCall(bus, { turnId: "never", waitId: "w", state: "start" }), { ok: false, reason: "stale" }, "turn never opened");
  void host;
});
await t("H3 열린 턴: start 는 입력의 humanWait 를 센다, end 는 푼다", async () => {
  const bus = makeBus();
  let seen;
  const runner = makeRunner((input) => { seen = input; return new Promise(() => {}); });
  await activated(bus, runner);
  await bus.call("hypeproof.runtime.runLocalTurn", { contractVersion: 1, sessionNonce: "nonce-1", turnId: "t1", policy: "chalk-instructor", messages: [], tools: [], systemBrief: "", cwd: "/w" });
  assert.equal(seen.humanWait.active(), false);
  assert.deepEqual(await hwCall(bus, { waitId: "w", state: "start" }), { ok: true });
  assert.equal(seen.humanWait.active(), true, "the runner's wait is counted");
  assert.deepEqual(await hwCall(bus, { waitId: "w", state: "end" }), { ok: true });
  assert.equal(seen.humanWait.active(), false);
});
await t("H4 턴이 끝난 뒤의 신호는 turn-ended 로 거부된다", async () => {
  const bus = makeBus();
  let seen;
  const runner = makeRunner((input) => { seen = input; return Promise.resolve(); });
  await activated(bus, runner);
  await bus.call("hypeproof.runtime.runLocalTurn", { contractVersion: 1, sessionNonce: "nonce-1", turnId: "t1", policy: "chalk-instructor", messages: [], tools: [], systemBrief: "", cwd: "/w" });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(await hwCall(bus, { waitId: "w", state: "start" }), { ok: false, reason: "turn-ended" });
  assert.equal(seen.humanWait.active(), false, "no effect after the turn ended");
});
await t("H5 턴이 끝나면 열린 대기는 모두 끝난다", async () => {
  const bus = makeBus();
  let seen;
  let finish;
  const runner = makeRunner((input) => { seen = input; return new Promise((resolve) => { finish = resolve; }); });
  await activated(bus, runner);
  await bus.call("hypeproof.runtime.runLocalTurn", { contractVersion: 1, sessionNonce: "nonce-1", turnId: "t1", policy: "chalk-instructor", messages: [], tools: [], systemBrief: "", cwd: "/w" });
  await hwCall(bus, { waitId: "w", state: "start" });
  assert.equal(seen.humanWait.active(), true);
  finish();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(seen.humanWait.active(), false, "waits are ended when the turn closes");
});
await t("H6 deactivate 하면 열린 대기가 모두 끝난다", async () => {
  const bus = makeBus();
  let seen;
  const runner = makeRunner((input) => { seen = input; return new Promise(() => {}); });
  const host = await activated(bus, runner);
  await bus.call("hypeproof.runtime.runLocalTurn", { contractVersion: 1, sessionNonce: "nonce-1", turnId: "t1", policy: "chalk-instructor", messages: [], tools: [], systemBrief: "", cwd: "/w" });
  await hwCall(bus, { waitId: "w", state: "start" });
  assert.equal(seen.humanWait.active(), true);
  await host.deactivate("issuerRemoved");
  assert.equal(seen.humanWait.active(), false, "deactivate ends the waits");
});
await t("H7 취소(cancelTurn) 하면 열린 대기가 끝난다", async () => {
  const bus = makeBus();
  let seen;
  const runner = makeRunner((input) => { seen = input; return new Promise((_, reject) => { input.signal.addEventListener("abort", () => reject(new Error("aborted"))); }); });
  await activated(bus, runner);
  await bus.call("hypeproof.runtime.runLocalTurn", { contractVersion: 1, sessionNonce: "nonce-1", turnId: "t1", policy: "chalk-instructor", messages: [], tools: [], systemBrief: "", cwd: "/w" });
  await hwCall(bus, { waitId: "w", state: "start" });
  await bus.call("hypeproof.runtime.cancelTurn", { contractVersion: 1, sessionNonce: "nonce-1", turnId: "t1" });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(seen.humanWait.active(), false, "cancel ends the waits");
});
await t("H8 옛 Chalk (신호 없음): 입력의 humanWait 는 비어 있다 — 정지 감지는 도구 규칙으로만 본다", async () => {
  const bus = makeBus();
  let seen;
  const runner = makeRunner((input) => { seen = input; return new Promise(() => {}); });
  await activated(bus, runner);
  await bus.call("hypeproof.runtime.runLocalTurn", { contractVersion: 1, sessionNonce: "nonce-1", turnId: "t1", policy: "chalk-instructor", messages: [], tools: [], systemBrief: "", cwd: "/w" });
  assert.equal(seen.humanWait.active(), false);
  assert.equal(seen.humanWait.open(), 0);
});

console.log("=== 정적: 계약 명령 등록 줄 ===");
// Registered once, next to the other runtime commands.
await t("H9 등록 목록에 humanWait 한 줄이 있다", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/chalkContract.ts", import.meta.url), "utf8");
  assert.ok(src.includes('"hypeproof.runtime.humanWait"'));
});

await t("H10 계약 턴이 humanWait 를 runLocalCoach 에 넘긴다, 옛 createHumanWait 연결(legacy)은 그대로다", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
  assert.ok(src.includes("humanWait: input.humanWait,"), "contract turn passes its wait counter");
  assert.ok(src.includes("const humanWait = createHumanWait();"), "legacy block is untouched");
});

if (failed > 0) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall chalk-humanwait-contract checks passed");
