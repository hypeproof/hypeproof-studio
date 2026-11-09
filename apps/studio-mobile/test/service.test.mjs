import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import handler from "../api/service.mjs";

const turn = "2e3582ee-361e-4112-a890-b82d103f1868";
function request(
  action = "chat",
  body = {
    turn_id: turn,
    messages: [{ role: "user", content: "관찰한 장면" }],
  },
) {
  return {
    method: "POST",
    headers: {
      host: "studio.test",
      origin: "https://studio.test",
      authorization: "Bearer test-token-not-a-real-secret",
    },
    query: { action },
    body,
  };
}
function response() {
  const res = new EventEmitter();
  res.setHeader = () => {};
  res.status = (n) => {
    res.statusCode = n;
    return res;
  };
  res.json = (value) => {
    res.value = value;
    res.writableEnded = true;
    return res;
  };
  return res;
}

test("proxy retains Service admission and native turn accounting without client policy overrides", async (t) => {
  let outgoing;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    outgoing = { url, options, body: JSON.parse(options.body) };
    return Response.json({
      content: [{ type: "text", text: "누구의 경험인가요?" }],
      stop_reason: "end_turn",
    });
  });
  const req = request();
  req.body.system = "untrusted policy";
  req.body.model = "expensive-model";
  req.body.max_tokens = 100000;
  const res = response();
  await handler(req, res);
  assert.equal(outgoing.url, "https://api.hypeproof-ai.xyz/v1/messages");
  assert.equal(outgoing.options.headers["x-hps-turn-id"], turn);
  assert.ok(outgoing.options.headers["x-hps-trial-request-id"]);
  assert.equal(outgoing.body.model, "hypeproof-fast");
  assert.equal(outgoing.body.max_tokens, 700);
  assert.equal(outgoing.body.system, undefined);
  assert.equal(outgoing.body.tools, undefined);
  assert.deepEqual(res.value, {
    content: "누구의 경험인가요?",
    truncated: false,
  });
});

test("invalid origin, authorization and malformed message are rejected before Service dispatch", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw Error("unexpected");
  });
  const foreign = request();
  foreign.headers.origin = "https://foreign.test";
  const unauth = request();
  delete unauth.headers.authorization;
  const malformed = request("chat", { turn_id: turn, messages: [null] });
  for (const [req, status] of [
    [foreign, 403],
    [unauth, 401],
    [malformed, 400],
  ]) {
    const res = response();
    await handler(req, res);
    assert.equal(res.statusCode, status);
  }
  assert.equal(calls, 0);
});

test("Service refusals and refill time survive; no success substitute is generated", async (t) => {
  const refusal = {
    error: { code: "trial_cost_exhausted", refills_at: 1794236400000 },
  };
  t.mock.method(globalThis, "fetch", async () =>
    Response.json(refusal, { status: 429 }),
  );
  const res = response();
  await handler(request(), res);
  assert.equal(res.statusCode, 429);
  assert.deepEqual(res.value, refusal);
});

test("empty provider output is not represented as an answer", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ content: [{ type: "tool_use", name: "unavailable" }] }),
  );
  const res = response();
  await handler(request(), res);
  assert.equal(res.statusCode, 502);
  assert.equal(res.value.error.code, "empty_response");
});

test("a disconnected response aborts the pending upstream request", async (t) => {
  let signal;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) =>
      signal.addEventListener("abort", () => reject(new Error("aborted")), {
        once: true,
      }),
    );
  });
  const res = response();
  const pending = handler(request(), res);
  res.emit("close");
  await pending;
  assert.equal(signal.aborted, true);
  assert.equal(res.listenerCount("close"), 0);
});
