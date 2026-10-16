// Smoke tests for the SDK-coach stall watchdog (#403, REQ-M26). Pure — no
// vscode, no SDK. The #320 fast-fail only covers 400/401; everything else the
// gateway answers with (429/529/5xx/connection drops) is retried by the SDK CLI
// up to 10x with backoff, and a first turn that simply never produces a token
// emits nothing at all. Both left the student on "생각하는 중… ✨" forever with
// no error and no way out (observed 4/4 on heavy-design-prompt runs).
// consumeSdkStream must therefore abort the query and throw a friendly error
// after `stallMs` without progress — while never mistaking legitimate silence
// (an open approval modal, a tool the SDK is still running) for a stall.
// Run: node --experimental-strip-types test/sdk-stall-watchdog.smoke.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { consumeSdkStream, isSdkRetryEvent, SDK_STALL_FRIENDLY, SDK_STREAM_STALL_MS } =
  await import("../src/sdkCoachHelpers.ts");

const here = dirname(fileURLToPath(import.meta.url));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const apiRetry = (error_status) => ({
  type: "system",
  subtype: "api_retry",
  attempt: 1,
  max_retries: 10,
  error_status,
  error: "overloaded",
});
const assistantMsg = (text) => ({ type: "assistant", message: { content: [{ type: "text", text }] } });

function handlers(overrides = {}) {
  const calls = { deltas: [], aborted: 0, stalls: 0 };
  const h = {
    isAborted: () => false,
    makeAbortError: () => Object.assign(new Error("Aborted"), { name: "AbortError" }),
    abortQuery: () => {
      calls.aborted++;
    },
    makeFatalAuthError: (status) => Object.assign(new Error("auth"), { name: "FatalAuth", status }),
    onDelta: (d) => calls.deltas.push(d),
    makeStallError: () => {
      calls.stalls++;
      return Object.assign(new Error(SDK_STALL_FRIENDLY), { name: "CoachStallError" });
    },
    ...overrides,
  };
  return { h, calls };
}

/** A stream that never yields anything — the observed "무한 생각하는 중" shape. */
function silentStream(state) {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () => new Promise(() => {}), // never settles
      return: async () => {
        state.closed = true;
        return { done: true, value: undefined };
      },
    }),
  };
}

/** Yields each event after `gapMs`, then completes. */
function pacedStream(events, gapMs, state = {}) {
  return (async function* () {
    try {
      for (const e of events) {
        await sleep(gapMs);
        yield e;
      }
    } finally {
      state.closed = true;
    }
  })();
}

// ─── a stream that never produces anything stalls out (the #403 bug) ─────────
{
  const state = {};
  const { h, calls } = handlers({ stallMs: 40 });
  const started = Date.now();
  const err = await consumeSdkStream(silentStream(state), h).then(
    () => null,
    (e) => e,
  );
  assert.ok(err, "a silent stream must reject, not hang forever");
  assert.equal(err.name, "CoachStallError", "throws the injected stall error");
  assert.equal(err.message, SDK_STALL_FRIENDLY, "student sees the Korean retry copy");
  assert.equal(calls.aborted, 1, "SDK query aborted exactly once (kills the CLI retry loop)");
  assert.deepEqual(calls.deltas, [], "no deltas from a stalled turn");
  assert.ok(Date.now() - started >= 35, "waited out the budget before declaring a stall");
  assert.equal(state.closed, true, "iterator closed on the early exit (no leaked generator)");
}

// ─── api_retry ticks do NOT renew the budget ────────────────────────────────
// The SDK's backoff emits a retry event every few hundred ms. If those counted
// as progress the watchdog would re-arm forever — exactly the hang it exists to
// catch. Retry ticks are the pathology, not progress.
{
  const retries = Array.from({ length: 20 }, () => apiRetry(529));
  const { h, calls } = handlers({ stallMs: 60 });
  const err = await consumeSdkStream(pacedStream(retries, 10), h).then(
    () => null,
    (e) => e,
  );
  assert.equal(err?.name, "CoachStallError", "a retry storm still stalls out");
  assert.equal(calls.aborted, 1);
}

// ─── real progress DOES renew the budget ────────────────────────────────────
{
  const events = Array.from({ length: 8 }, (_, i) => assistantMsg(String(i)));
  const { h, calls } = handlers({ stallMs: 60 });
  await consumeSdkStream(pacedStream(events, 15), h);
  assert.deepEqual(calls.deltas, ["0", "1", "2", "3", "4", "5", "6", "7"]);
  assert.equal(calls.aborted, 0, "a slow-but-progressing stream is never aborted");
  assert.equal(calls.stalls, 0);
}

// ─── an open approval modal is not a stall ──────────────────────────────────
// canUseTool blocks the stream for as long as the human takes to decide. That
// silence is CORRECT; aborting it would kill the turn the kid just approved.
{
  let awaiting = true;
  const { h, calls } = handlers({ stallMs: 40, isTurnBlocked: () => awaiting });
  setTimeout(() => {
    awaiting = false; // the student clicked Approve at ~100ms
  }, 100);
  await consumeSdkStream(pacedStream([assistantMsg("승인 후 응답")], 130), h);
  assert.deepEqual(calls.deltas, ["승인 후 응답"], "turn survives a long modal wait");
  assert.equal(calls.aborted, 0);
  assert.equal(calls.stalls, 0);
}

// ─── …but the grace after a modal is ONE window, not a free pass ────────────
// A turn that wedges right after an approval must still end in a message.
{
  let awaiting = true;
  const { h, calls } = handlers({ stallMs: 30, isTurnBlocked: () => awaiting });
  setTimeout(() => {
    awaiting = false;
  }, 60);
  const err = await consumeSdkStream(silentStream({}), h).then(
    () => null,
    (e) => e,
  );
  assert.equal(err?.name, "CoachStallError", "silence after the modal closes still stalls out");
  assert.equal(calls.aborted, 1);
}

// ─── stallMs: 0 disables the watchdog (escape hatch) ────────────────────────
{
  const { h, calls } = handlers({ stallMs: 0 });
  await consumeSdkStream(pacedStream([assistantMsg("느림")], 80), h);
  assert.deepEqual(calls.deltas, ["느림"]);
  assert.equal(calls.aborted, 0);
}

// ─── the fatal 400/401 fast-fail still wins (no #320 regression) ────────────
{
  const { h, calls } = handlers({ stallMs: 5_000 });
  const err = await consumeSdkStream(pacedStream([apiRetry(401)], 1), h).then(
    () => null,
    (e) => e,
  );
  assert.equal(err?.name, "FatalAuth", "401 keeps its own fast-fail path");
  assert.equal(err.status, 401);
  assert.equal(calls.aborted, 1);
}

// ─── no makeStallError wired → still a friendly error, never a hang ─────────
{
  const { h } = handlers({ stallMs: 20, makeStallError: undefined });
  const err = await consumeSdkStream(silentStream({}), h).then(
    () => null,
    (e) => e,
  );
  assert.equal(err?.message, SDK_STALL_FRIENDLY, "defaults to the shared Korean copy");
}

// ─── isSdkRetryEvent classification ─────────────────────────────────────────
{
  assert.equal(isSdkRetryEvent(apiRetry(529)), true);
  assert.equal(isSdkRetryEvent(apiRetry(null)), true);
  assert.equal(isSdkRetryEvent(assistantMsg("x")), false);
  assert.equal(isSdkRetryEvent({ type: "system", subtype: "init" }), false);
  assert.equal(isSdkRetryEvent({}), false);
}

// ─── manifest ↔ code single source: the setting default IS the constant ─────
{
  const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
  const prop = pkg.contributes.configuration.properties["hypeproofChat.sdkStallTimeoutMs"];
  assert.ok(prop, "hypeproofChat.sdkStallTimeoutMs declared");
  assert.equal(prop.type, "number");
  assert.equal(prop.default, SDK_STREAM_STALL_MS, "manifest default matches SDK_STREAM_STALL_MS");
  assert.equal(prop.scope, "machine");
  assert.equal(SDK_STREAM_STALL_MS, 240_000, "3x the measured worst-case silent gap (86s) on a healthy 286s turn");
  assert.equal(SDK_STALL_FRIENDLY, "코치 응답이 너무 오래 걸려요. 다시 한 번 보내주세요. 🕐");
}

// ─── wiring: the orchestration layer actually arms the watchdog ─────────────
// The helper contract above is worthless if runSdkCoach forgets to pass a
// budget, or if chatPanelProvider stops threading the setting. sdkCoach.ts
// can't be imported here (extensionless relative imports don't resolve under
// --experimental-strip-types), so this is a source-level lock — same pattern
// as sdk-vendor.smoke's inject-script assertions.
{
  const coach = readFileSync(join(here, "..", "src", "sdkCoach.ts"), "utf8");
  assert.match(coach, /stallMs,/, "runSdkCoach passes stallMs to consumeSdkStream");
  assert.match(coach, /makeStallError:/, "…and a CoachStallError factory");
  assert.match(coach, /isTurnBlocked:/, "…and the modal/tool-in-flight predicate");
  assert.match(
    coach,
    /args\.stallTimeoutMs \?\? SDK_STREAM_STALL_MS/,
    "budget defaults to the shared constant when the host passes nothing",
  );
  assert.match(coach, /class CoachStallError/, "distinct error class for the stall exit");

  const provider = readFileSync(join(here, "..", "src", "chatPanelProvider.ts"), "utf8");
  assert.match(
    provider,
    /stallTimeoutMs: cfg\.get<number>\("sdkStallTimeoutMs"\)/,
    "the host threads hypeproofChat.sdkStallTimeoutMs into the coach",
  );
}

console.log("✓ #403: sdk stall watchdog — silent/retry-storm turns abort with a friendly retry message");

// ─── A2: the busy wait is bounded in time too (spec §11.6 item 4) ────────────
// "abort after 3 retries or 90 s": the count is locked in sdk-fastfail.smoke;
// here is the clock, scaled down. It runs from the first busy retry of an
// episode, ends the turn with the busy line (not the stall line) and works
// even with the stall watchdog switched off.
{
  const {
    SDK_BUSY_ABORT_FRIENDLY,
    SDK_BUSY_MAX_WAIT_MS,
    SDK_CLI_STREAM_IDLE_MS,
    SdkBusyAbortError,
  } = await import("../src/sdkCoachHelpers.ts");
  const silentAfter = (events, state = {}) => {
    let i = 0;
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => (i < events.length ? Promise.resolve({ done: false, value: events[i++] }) : new Promise(() => {})),
        return: async () => {
          state.closed = true;
          return { done: true, value: undefined };
        },
      }),
    };
  };
  const notices = [];
  const busy = (maxWaitMs) => ({ onNotice: (t) => notices.push(t), maxWaitMs });

  // Negative control — one busy retry, then silence: the busy clock ends it, well before the stall budget.
  {
    const state = {};
    const { h, calls } = handlers({ stallMs: 5_000, busy: busy(40) });
    const started = Date.now();
    const err = await consumeSdkStream(silentAfter([apiRetry(429)], state), h).then(() => null, (e) => e);
    const took = Date.now() - started;
    assert.ok(err instanceof SdkBusyAbortError, "the busy deadline ends the turn");
    assert.equal(err.message, SDK_BUSY_ABORT_FRIENDLY, "…with the busy line, not the stall line");
    assert.equal(err.status, 429);
    assert.equal(calls.stalls, 0, "the stall factory is not used");
    assert.equal(calls.aborted, 1);
    assert.ok(took >= 35 && took < 2_000, `waited out the busy window (${took}ms), not the 5s stall budget`);
    assert.equal(state.closed, true, "iterator closed on the early exit");
  }

  // The busy clock works with the stall watchdog switched off (stallMs: 0).
  {
    const { h } = handlers({ stallMs: 0, busy: busy(30) });
    const err = await consumeSdkStream(silentAfter([apiRetry(529)]), h).then(() => null, (e) => e);
    assert.ok(err instanceof SdkBusyAbortError, "the busy bound does not depend on the stall budget");
  }

  // A real answer stops the busy clock: the later silence is the stall watchdog's business.
  {
    const { h, calls } = handlers({ stallMs: 60, busy: busy(40) });
    const err = await consumeSdkStream(
      pacedStream([apiRetry(429), assistantMsg("응답"), ...Array.from({ length: 4 }, (_, i) => assistantMsg(String(i)))], 15),
      h,
    ).then(() => null, (e) => e);
    assert.equal(err, null, "a progressing stream after one busy retry is never cut by the busy clock");
    assert.deepEqual(calls.deltas, ["응답", "0", "1", "2", "3"]);
  }

  // Without a busy policy, budget/concurrency rejection is actionable immediately.
  {
    const { h, calls } = handlers({ stallMs: 40 });
    const err = await consumeSdkStream(silentAfter([apiRetry(429)]), h).then(() => null, (e) => e);
    assert.equal(err?.name, "SdkApiError", "a budget rejection does not wait for a silence timeout");
    assert.equal(err?.status, 429);
    assert.equal(calls.stalls, 0);
    assert.equal(calls.aborted, 1);
  }

  // Deadline order (A1 note E5): busy (90 s) < Studio's stall (240 s) < the CLI's own idle floor (300 s, 2.1.299).
  assert.equal(SDK_BUSY_MAX_WAIT_MS, 90_000, "the spec's 90 s");
  assert.equal(SDK_CLI_STREAM_IDLE_MS, 300_000, "Claude Code 2.1.299's stream-idle floor behind a custom base URL");
  assert.ok(SDK_BUSY_MAX_WAIT_MS < SDK_STREAM_STALL_MS, "the busy line comes before the generic stall line");
  assert.ok(SDK_STREAM_STALL_MS < SDK_CLI_STREAM_IDLE_MS, "Studio's watchdog fires before the CLI gives up on its own");
  const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
  assert.ok(
    pkg.contributes.configuration.properties["hypeproofChat.sdkStallTimeoutMs"].default < SDK_CLI_STREAM_IDLE_MS,
    "the shipped default watchdog setting is below the CLI floor too",
  );
  console.log("✓ A2: busy clock bounds the wait (scaled 90 s), works with the watchdog off; 90 s < 240 s < 300 s");
}
