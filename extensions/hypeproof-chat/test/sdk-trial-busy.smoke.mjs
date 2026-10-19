// REQ-STUDIO-TRIAL-BUSY — a native-trial seat gets the bounded SDK busy policy (A2's copy).
//
// The Service holds one atomic lease per native-trial grant and refuses an overlapping
// request with `429 trial_busy` (native-trial-budget.ts). It sets no `x-should-retry`, so
// the CLI retries it like any rate limit. Observed 2026-10-18 against a gateway that held
// the lease (scratchpad p1-app/sdk-busy.json, SDK 0.3.299): 11 `api_retry` 429 events over
// 186 s, then the CLI's raw "API Error: Request rejected (429) · …" line as the chat bubble.
// The trial profile has `orchestrator.enabled: false`, and the busy policy was attached to
// orchestrator seats only, so none of A2's bounded copy ever reached a trial.
//
// This smoke replays that stream through the real runSdkCoach with a scripted CLI:
// - negative: the lease is held forever → the turn ends on the third busy retry with
//   SDK_BUSY_ABORT_FRIENDLY, after one SDK_BUSY_NOTICE, and the raw line is never read;
// - positive: the lease is released after one retry → the answer flows, one notice;
// - control: the same forever-busy replay on a classroom seat keeps today's behavior
//   (no policy), so the gate is the trial seat and not a global change.
//
// Run: node --experimental-strip-types test/sdk-trial-busy.smoke.mjs

import assert from "node:assert/strict";
import * as fs from "node:fs";
import { registerHooks } from "node:module";
import * as os from "node:os";
import * as path from "node:path";

const stub = new URL("./fixtures/vscode-stub.mjs", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "vscode") return { url: stub, shortCircuit: true };
    if (specifier.startsWith(".") && !/\.[a-z0-9]+$/i.test(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        return nextResolve(specifier, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hps-trial-busy-")));
const WS = path.join(scratch, "ws");
fs.mkdirSync(path.join(scratch, "home"), { recursive: true });
fs.mkdirSync(WS, { recursive: true });
process.env.HOME = path.join(scratch, "home");
process.on("exit", () => fs.rmSync(scratch, { recursive: true, force: true }));

const { runSdkCoach } = await import("../src/sdkCoach.ts");
const H = await import("../src/sdkCoachHelpers.ts");
const { SDK_BUSY_NOTICE, SDK_BUSY_ABORT_FRIENDLY, SDK_BUSY_MAX_RETRIES, SdkBusyAbortError, sdkBusyPolicyFor } = H;

const RAW_BUSY_LINE = "API Error: Request rejected (429) · 이미 실행 중인 요청이 있습니다. 완료한 뒤 다시 시도해 주세요.";
const retry = (attempt) => ({ type: "system", subtype: "api_retry", error: "rate_limit", error_status: 429, attempt, max_retries: 10, retry_delay_ms: 1 });

/** The observed stream (sdk-busy.json rawTypes): init, 11 busy retries, the CLI's raw line, an error result. */
const HELD_FOREVER = [
  { type: "system", subtype: "init" },
  ...Array.from({ length: 11 }, (_, i) => retry(i + 1)),
  { type: "assistant", error: "rate_limit", message: { model: "<synthetic>", content: [{ type: "text", text: RAW_BUSY_LINE }] } },
  { type: "result", subtype: "success", is_error: true, result: RAW_BUSY_LINE },
];

/** The lease is released after one retry: the second request is answered. */
const RELEASED_AFTER_ONE = [
  { type: "system", subtype: "init" },
  retry(1),
  { type: "assistant", message: { id: "msg_1", model: "claude-sonnet-5-5", content: [{ type: "text", text: "다시 이어서 할게요" }] } },
  { type: "result", subtype: "success", stop_reason: "end_turn" },
];

const TRIAL = { profile_id: "studio-native-trial", activity_kind: "trial", game: { template_tier: "website" }, sdk_tools: { read: true, write: true }, orchestrator: { enabled: false, reason: "orchestrator_off" } };
const PASS = { ...TRIAL, pass: { kind: "pass" } };
const CLASSROOM = { profile_id: "homepage-practice-s1", activity_kind: "classroom", game: { template_tier: "website" }, sdk_tools: { read: true, write: true } };

async function turn(profile, events, { withNoticeSink = true } = {}) {
  const pulled = [];
  const notices = [];
  const deltas = [];
  const sdk = {
    createSdkMcpServer: (o) => ({ name: o.name, tools: o.tools ?? [] }),
    tool: (name) => ({ name }),
    query() {
      return (async function* () {
        for (const e of events) {
          pulled.push(e);
          yield structuredClone(e);
        }
      })();
    },
  };
  const outcome = await runSdkCoach({
    gatewayUrl: "https://api.hypeproof-ai.xyz/v1",
    token: "hps-token-trial-busy",
    model: "claude-sonnet-5-5",
    turnId: "turn_busy",
    profile,
    systemPrompt: "",
    history: [],
    userText: "할 일 목록을 정리해 주세요",
    signal: new AbortController().signal,
    cwd: WS,
    stallTimeoutMs: 0,
    binaryResolution: { available: true, source: "setting", path: "/opt/claude", reasons: [] },
    sdk,
    onDelta: (d) => deltas.push(d),
    onCitations: () => {},
    onAssetScore: () => {},
    requestApproval: async () => ({ approved: true, actor: "policy" }),
    ...(withNoticeSink ? { onNotice: (t) => notices.push(t) } : {}),
  }).then((end) => ({ end }), (err) => ({ err }));
  return { ...outcome, pulled, notices, deltas };
}

const busyRetriesPulled = (r) => r.pulled.filter((e) => e.subtype === "api_retry").length;

// ── The gate (pure) ─────────────────────────────────────────────────────────
{
  const onNotice = () => {};
  assert.equal(sdkBusyPolicyFor({ activityKind: "trial" }, onNotice)?.onNotice, onNotice, "a native-trial seat (trial or pass) gets the policy");
  assert.equal(sdkBusyPolicyFor({ activityKind: "classroom" }, onNotice), undefined, "a classroom seat without a roster does not");
  assert.equal(sdkBusyPolicyFor({ activityKind: "personal" }, onNotice), undefined, "a personal account seat does not");
  assert.equal(sdkBusyPolicyFor({}, onNotice), undefined, "an unknown seat does not");
  assert.equal(sdkBusyPolicyFor({ activityKind: null }, onNotice), undefined);
  console.log("✓ trial busy: sdkBusyPolicyFor attaches to native-trial seats");
}

// ── Negative: the lease is held forever ─────────────────────────────────────
for (const [name, profile] of [["trial", TRIAL], ["pass", PASS]]) {
  const r = await turn(profile, HELD_FOREVER);
  assert.ok(r.err instanceof SdkBusyAbortError, `${name}: a persistent trial_busy ends the turn with the bounded abort (got ${r.err?.name ?? "no error"})`);
  assert.equal(r.err.message, SDK_BUSY_ABORT_FRIENDLY, `${name}: …in A2's words`);
  assert.equal(r.err.status, 429);
  assert.equal(busyRetriesPulled(r), SDK_BUSY_MAX_RETRIES, `${name}: ended on retry ${SDK_BUSY_MAX_RETRIES}, not after 11`);
  assert.ok(!r.pulled.some((e) => e.type === "assistant"), `${name}: the CLI's raw "API Error" line is never read`);
  assert.deepEqual(r.deltas, [], `${name}: no raw text reaches the chat`);
  assert.deepEqual(r.notices, [SDK_BUSY_NOTICE], `${name}: one busy notice`);
}
// Without a host notice sink the bound still holds (the notice is optional, the abort is not).
{
  const r = await turn(TRIAL, HELD_FOREVER, { withNoticeSink: false });
  assert.ok(r.err instanceof SdkBusyAbortError, "no notice sink: still bounded");
  assert.equal(busyRetriesPulled(r), SDK_BUSY_MAX_RETRIES);
}
console.log("✓ trial busy (negative): lease held forever → SDK_BUSY_ABORT_FRIENDLY on retry 3, raw line never shown");

// ── Positive: released after one retry ──────────────────────────────────────
{
  const r = await turn(TRIAL, RELEASED_AFTER_ONE);
  assert.equal(r.err, undefined, `one busy retry does not end the turn (${r.err?.message})`);
  assert.deepEqual(r.deltas, ["다시 이어서 할게요"], "the answer flows");
  assert.deepEqual(r.notices, [SDK_BUSY_NOTICE], "one notice while it waited");
  assert.equal(r.end.failed, false);
}
console.log("✓ trial busy (positive): lease released after one retry → the answer flows after one notice");

// ── Control: a classroom seat keeps today's path ────────────────────────────
{
  const r = await turn(CLASSROOM, HELD_FOREVER);
  assert.ok(!(r.err instanceof SdkBusyAbortError), "a classroom seat gets no busy policy");
  assert.equal(busyRetriesPulled(r), 11, "…and waits the CLI's retries out, as before");
  assert.deepEqual(r.notices, [], "…without the notice");
}
console.log("✓ trial busy (control): classroom seat unchanged — no policy, all 11 retries read");
