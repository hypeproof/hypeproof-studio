// Smoke tests for the SDK-coach gateway 4xx fast-fail (#320, REQ-M15). Pure —
// no vscode, no SDK. e2e finding: the SDK CLI retries 401/400 up to 10x with
// backoff, so a rejected workshop token was a multi-minute SILENT hang for
// a kid. consumeSdkStream must abort the query on the FIRST api_retry event
// carrying error_status 400/401 and surface student-friendly copy.
//
// 2026-07-28 — the copy must NOT be the proxy path's "만료됐어요". An api_retry
// event carries a status and nothing else: 401 can be expiry, a rejected
// credential, or roster trouble, and the SDK path has no `error.code` to tell
// them apart. Naming expiry there sent a real investigation down the wrong
// path for days AND (via kind:"expired") deleted a perfectly valid token on
// every turn. See proxyClientHelpers.GATEWAY_AUTH_FAILED_FRIENDLY.
// Run: node --experimental-strip-types test/sdk-fastfail.smoke.mjs

import assert from "node:assert/strict";

const { sdkFatalAuthStatus, consumeSdkStream, extractSdkText, SDK_FATAL_AUTH_STATUSES } =
  await import("../src/sdkCoachHelpers.ts");
const {
  TOKEN_EXPIRED_FRIENDLY,
  TOKEN_MISSING_FRIENDLY,
  GATEWAY_AUTH_FAILED_FRIENDLY,
  GATEWAY_BAD_REQUEST_FRIENDLY,
} = await import("../src/proxyClientHelpers.ts");

// Mirrors sdkCoach.ts's makeFatalAuthError so the status→copy mapping is
// exercised here rather than only in the (vscode-adjacent) orchestration layer.
const fatalCopyFor = (status) =>
  status === 401 ? GATEWAY_AUTH_FAILED_FRIENDLY : GATEWAY_BAD_REQUEST_FRIENDLY;

// Real SDKAPIRetryMessage shape (sdk.d.ts): type system / subtype api_retry /
// error_status number|null / error SDKAssistantMessageError.
const apiRetry = (error_status, error = "authentication_failed") => ({
  type: "system",
  subtype: "api_retry",
  attempt: 1,
  max_retries: 10,
  retry_delay_ms: 500,
  error_status,
  error,
});
const assistantMsg = (text) => ({
  type: "assistant",
  message: { content: [{ type: "text", text }] },
});

// Mock stream that records how many events the loop actually pulled.
function mockStream(events, pulled) {
  return (async function* () {
    for (const e of events) {
      pulled.push(e);
      yield e;
    }
  })();
}

function handlers(overrides = {}) {
  const calls = { deltas: [], aborted: 0 };
  const h = {
    isAborted: () => false,
    makeAbortError: () => Object.assign(new Error("Aborted"), { name: "AbortError" }),
    abortQuery: () => {
      calls.aborted++;
    },
    makeFatalAuthError: (status) =>
      Object.assign(new Error(fatalCopyFor(status)), { name: "FatalAuth", status }),
    onDelta: (d) => calls.deltas.push(d),
    ...overrides,
  };
  return { h, calls };
}

// ─── sdkFatalAuthStatus — only api_retry with 400/401 is fatal ───────────────
{
  assert.equal(sdkFatalAuthStatus(apiRetry(401)), 401, "401 api_retry is fatal");
  assert.equal(sdkFatalAuthStatus(apiRetry(400, "invalid_request")), 400, "400 api_retry is fatal");

  // Retryable statuses stay with the SDK's backoff (correct behavior there).
  assert.equal(sdkFatalAuthStatus(apiRetry(429, "rate_limit")), null, "429 keeps retrying");
  assert.equal(sdkFatalAuthStatus(apiRetry(529, "overloaded")), null, "529 keeps retrying");
  assert.equal(sdkFatalAuthStatus(apiRetry(500, "server_error")), null, "500 keeps retrying");
  assert.equal(sdkFatalAuthStatus(apiRetry(null)), null, "connection error (null status) keeps retrying");

  // Non-retry events are never classified fatal.
  assert.equal(sdkFatalAuthStatus(assistantMsg("hi")), null);
  assert.equal(sdkFatalAuthStatus({ type: "system", subtype: "init" }), null);
  assert.equal(sdkFatalAuthStatus({}), null);

  assert.deepEqual([...SDK_FATAL_AUTH_STATUSES].sort(), [400, 401], "fatal set is exactly {400, 401}");
}

// ─── fast-fail: aborts within ONE event, maps to the auth error ──────────────
{
  const pulled = [];
  const { h, calls } = handlers();
  // A poisoned turn: first retry event, then chunks that would arrive minutes
  // later if we waited out the backoff. The loop must never reach them.
  const stream = mockStream([apiRetry(401), assistantMsg("늦은 응답"), apiRetry(401)], pulled);

  const err = await consumeSdkStream(stream, h).then(
    () => null,
    (e) => e,
  );
  assert.ok(err, "fatal 401 must reject the turn");
  assert.equal(err.name, "FatalAuth", "throws the injected auth error, not a raw error");
  assert.equal(err.status, 401);
  assert.equal(err.message, GATEWAY_AUTH_FAILED_FRIENDLY, "401 copy does not claim expiry");
  assert.equal(calls.aborted, 1, "SDK query aborted exactly once (kills the CLI retry loop)");
  assert.equal(pulled.length, 1, "aborts within one event — no further stream consumption");
  assert.deepEqual(calls.deltas, [], "no delta flushed from the poisoned turn");
}

// ─── 400 takes the same fast-fail path ───────────────────────────────────────
{
  const pulled = [];
  const { h, calls } = handlers();
  const err = await consumeSdkStream(mockStream([apiRetry(400, "invalid_request")], pulled), h).then(
    () => null,
    (e) => e,
  );
  assert.equal(err?.status, 400);
  assert.equal(calls.aborted, 1);
}

// ─── healthy stream: deltas flow, no abort ───────────────────────────────────
{
  const pulled = [];
  const { h, calls } = handlers();
  await consumeSdkStream(
    mockStream([assistantMsg("안녕"), { type: "text", text: "하세요" }, { type: "result" }], pulled),
    h,
  );
  assert.deepEqual(calls.deltas, ["안녕", "하세요"], "text extracted across message shapes");
  assert.equal(calls.aborted, 0, "no abort on a healthy stream");
  assert.equal(pulled.length, 3, "stream fully consumed");
}

// ─── a retryable 529 does NOT abort — the SDK's backoff handles it ───────────
{
  const { h, calls } = handlers();
  await consumeSdkStream(mockStream([apiRetry(529, "overloaded"), assistantMsg("복구됨")], []), h);
  assert.deepEqual(calls.deltas, ["복구됨"], "stream continues past a retryable event");
  assert.equal(calls.aborted, 0);
}

// ─── user stop still wins: AbortError before any processing (REQ-M8) ─────────
{
  const { h } = handlers({ isAborted: () => true });
  const err = await consumeSdkStream(mockStream([assistantMsg("x")], []), h).then(
    () => null,
    (e) => e,
  );
  assert.equal(err?.name, "AbortError", "user stop surfaces as AbortError (proxy parity)");
}

// ─── extractSdkText — candidate shapes ───────────────────────────────────────
{
  assert.equal(extractSdkText({ text: "a" }), "a");
  assert.equal(extractSdkText({ delta: { text: "b" } }), "b");
  assert.equal(extractSdkText(assistantMsg("c")), "c");
  assert.equal(extractSdkText({ message: { content: [{ type: "tool_use" }] } }), "");
  assert.equal(extractSdkText({}), "");
}

// ─── copy single-source: constants are the REQ-B5 sentences ──────────────────
// If someone rewords proxyClient's token copy without updating the shared
// constants (or vice versa), this pins the contract.
{
  assert.equal(TOKEN_EXPIRED_FRIENDLY, "참여 코드가 만료되었습니다. 코드 발급 담당자에게 새 코드를 요청해 주세요.");
  assert.equal(TOKEN_MISSING_FRIENDLY, "참여 코드가 필요합니다. 코드 발급 담당자에게 받은 코드를 입력해 주세요.");

  // The SDK path may not diagnose a cause it cannot observe.
  assert.ok(
    !GATEWAY_AUTH_FAILED_FRIENDLY.includes("만료"),
    "a bare 401 is not evidence of expiry — never say it is",
  );
  assert.notEqual(
    GATEWAY_AUTH_FAILED_FRIENDLY,
    TOKEN_EXPIRED_FRIENDLY,
    "the proxy path reads error.code and MAY say 만료; the SDK path cannot",
  );
  // 400 is a malformed request. Mentioning the token there sends a student
  // (and whoever they escalate to) after the wrong thing entirely.
  assert.ok(
    !GATEWAY_BAD_REQUEST_FRIENDLY.includes("토큰"),
    "400 is not an auth failure — keep tokens out of its copy",
  );
  assert.notEqual(GATEWAY_BAD_REQUEST_FRIENDLY, GATEWAY_AUTH_FAILED_FRIENDLY);
}

console.log("✓ #320: sdk fast-fail — 401/400 api_retry aborts within one event + proxy-path token copy");

// ─── A2: busy notice and bounded abort, by retry count (spec §11.6 item 4) ───
// With a busy policy (orchestrator seats): the first 429/503/529 retry of a
// turn posts ONE notice; the third busy retry of an episode aborts the query
// with the spec's line. A real response ends the episode. Without the policy,
// nothing changes — the retries stay silent, as the 529 test above shows.
{
  const {
    SDK_BUSY_NOTICE,
    SDK_BUSY_ABORT_FRIENDLY,
    SDK_BUSY_MAX_RETRIES,
    SDK_BUSY_STATUSES,
    SdkBusyAbortError,
    sdkBusyPolicyFor,
    isAbortError,
  } = await import("../src/sdkCoachHelpers.ts");

  // The copy is the spec's, verbatim.
  assert.equal(SDK_BUSY_NOTICE, "지금 요청이 많아 잠시 기다리는 중이에요. 자동으로 다시 시도합니다.");
  assert.equal(SDK_BUSY_ABORT_FRIENDLY, "지금 사용하는 사람이 많아 답을 받지 못했어요. 30초 뒤에 다시 보내 주세요. 작업 파일은 그대로 있어요.");
  assert.equal(SDK_BUSY_MAX_RETRIES, 3);
  assert.deepEqual([...SDK_BUSY_STATUSES].sort(), [429, 503, 529]);

  const busyRun = async (events, policy = {}) => {
    const notices = [];
    const pulled = [];
    const { h, calls } = handlers({ busy: { onNotice: (t) => notices.push(t), ...policy } });
    const result = await consumeSdkStream(mockStream(events, pulled), h).then(
      (end) => ({ end }),
      (err) => ({ err }),
    );
    return { ...result, notices, pulled, calls };
  };

  // Positive control — one busy retry, then the answer: one notice, no abort, text flows.
  {
    const r = await busyRun([apiRetry(429, "rate_limit"), assistantMsg("복구됨"), { type: "result" }]);
    assert.equal(r.err, undefined, "a single busy retry does not end the turn");
    assert.deepEqual(r.notices, [SDK_BUSY_NOTICE], "exactly one notice, with the spec's words");
    assert.deepEqual(r.calls.deltas, ["복구됨"]);
    assert.equal(r.calls.aborted, 0);
  }

  // Negative control — the third busy retry aborts, before a fourth is even read.
  {
    const r = await busyRun([apiRetry(429, "rate_limit"), apiRetry(529, "overloaded"), apiRetry(503, "unavailable"), apiRetry(429, "rate_limit"), assistantMsg("늦은 응답")]);
    assert.ok(r.err instanceof SdkBusyAbortError, "the bounded abort throws its own error");
    assert.equal(r.err.message, SDK_BUSY_ABORT_FRIENDLY, "…with the spec's line as the message the panel shows");
    assert.equal(r.err.status, 503, "…and the busy status that ended it");
    assert.equal(isAbortError(r.err), false, "it is not a user stop: the banner shows");
    assert.equal(r.calls.aborted, 1, "the CLI's retry loop is killed exactly once");
    assert.equal(r.pulled.length, 3, "no fourth event is consumed");
    assert.deepEqual(r.notices, [SDK_BUSY_NOTICE], "still a single notice");
    assert.deepEqual(r.calls.deltas, []);
  }

  // A real response ends the episode; the notice stays once per turn.
  {
    const r = await busyRun([
      apiRetry(429, "rate_limit"), apiRetry(429, "rate_limit"), assistantMsg("a"),
      apiRetry(529, "overloaded"), apiRetry(529, "overloaded"), assistantMsg("b"), { type: "result" },
    ]);
    assert.equal(r.err, undefined, "two short rushes with an answer between them are not three retries");
    assert.deepEqual(r.notices, [SDK_BUSY_NOTICE], "one notice for the whole turn");
    assert.deepEqual(r.calls.deltas, ["a", "b"]);
  }

  // The CLI's own "API Error" line is not an answer: it does not reset the count.
  {
    const r = await busyRun([
      apiRetry(429, "rate_limit"), apiRetry(429, "rate_limit"),
      { type: "assistant", error: "rate_limit", message: { model: "<synthetic>", content: [{ type: "text", text: "API Error: 429" }] } },
      apiRetry(429, "rate_limit"),
    ]);
    assert.ok(r.err instanceof SdkBusyAbortError, "a synthetic error message does not buy more retries");
  }

  // Not busy: other 5xx and first-byte-timeout retries (0.3.299 `no_response`, status null).
  {
    const r = await busyRun([apiRetry(500, "server_error"), apiRetry(502, "bad_gateway"), { ...apiRetry(null, "unknown"), no_response: true }, apiRetry(504), assistantMsg("ok")]);
    assert.equal(r.err, undefined, "non-busy retries never trigger the bounded abort");
    assert.deepEqual(r.notices, [], "…nor the notice");
    // …and they do not reset a busy count either: three busy among them still abort.
    const mixed = await busyRun([apiRetry(429), apiRetry(500), apiRetry(429), apiRetry(null), apiRetry(529), assistantMsg("x")]);
    assert.ok(mixed.err instanceof SdkBusyAbortError);
    assert.equal(mixed.pulled.length, 5, "aborted on the third busy retry, the fifth event");
  }

  // Negative control for the gate — no policy, three 429s: today's silent retries.
  {
    const pulled = [];
    const { h, calls } = handlers();
    await consumeSdkStream(mockStream([apiRetry(429), apiRetry(429), apiRetry(429), assistantMsg("결국 응답")], pulled), h);
    assert.deepEqual(calls.deltas, ["결국 응답"], "without the policy the turn waits the retries out");
    assert.equal(calls.aborted, 0);
  }

  // The 401 fast-fail still wins under the policy (#320 unchanged).
  {
    const r = await busyRun([apiRetry(429, "rate_limit"), apiRetry(401)]);
    assert.equal(r.err?.name, "FatalAuth", "a rejected token is not a busy upstream");
    assert.equal(r.calls.aborted, 1);
  }

  // A host's onNotice that throws does not end the turn; a custom error and count are honored.
  {
    const r = await busyRun([apiRetry(429), assistantMsg("계속")], { onNotice: () => { throw new Error("render failed"); } });
    assert.equal(r.err, undefined, "the notice is non-blocking");
    assert.deepEqual(r.calls.deltas, ["계속"]);
    const custom = await busyRun([apiRetry(529), apiRetry(529)], {
      maxRetries: 2,
      makeBusyError: (status) => Object.assign(new Error("custom"), { name: "Busy", status }),
    });
    assert.equal(custom.err?.name, "Busy");
    assert.equal(custom.err.status, 529);
  }

  // The gate itself: only an orchestrator seat gets a policy.
  {
    const onNotice = () => {};
    assert.equal(sdkBusyPolicyFor({}, onNotice), undefined, "no orchestrator → no busy policy");
    assert.equal(sdkBusyPolicyFor({ orchestrator: undefined }, onNotice), undefined);
    const policy = sdkBusyPolicyFor({ orchestrator: { rosterId: "homepage", rosterVersion: "1.0.0", consult: true, siteCheck: true } }, onNotice);
    assert.equal(policy?.onNotice, onNotice, "an orchestrator seat gets the notice hook");
  }
  console.log("✓ A2: busy — one notice on the first 429/503/529, abort on the third, reset by a real answer, gated");
}
