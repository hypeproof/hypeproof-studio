// TC-0265..TC-0269 — one x-hps-turn-id per user message on every request, both runtimes.
//   node --experimental-strip-types test/turn-id-cases.smoke.mjs

import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { proxyChat } = await import("../src/proxyClient.ts");
const { buildSdkQueryOptions, buildSdkGatewayEnv, profileToAgentOptions } = await import("../src/sdkCoachHelpers.ts");
const { clientTurnIdHeader, validClientTurnId } = await import("../src/proxyClientHelpers.ts");
const sdk = await import("@anthropic-ai/claude-agent-sdk");

const H = "x-hps-turn-id";
const TURN = "turn_header_smoke_1";

async function server(handler) {
  const requests = [];
  const s = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const entry = { method: req.method, url: req.url, headers: req.headers, body };
      requests.push(entry);
      handler(entry, res, requests);
    });
  });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${s.address().port}`,
    requests,
    close: () => new Promise((r) => { s.closeAllConnections?.(); s.close(() => r()); }),
  };
}

// ── proxy fake: two tool_use steps, then text ──
async function proxyServer() {
  let step = 0;
  const srv = await server((_req, res) => {
    step++;
    const chunk = (delta, finish) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    res.writeHead(200, { "content-type": "text/event-stream" });
    if (step % 3 !== 0) res.write(chunk({ hps_tool_use: { id: `tu_${step}`, name: "browser_screenshot", input: {} } }, "tool_calls"));
    else res.write(chunk({ content: "끝" }, "stop"));
    res.end("data: [DONE]\n\n");
  });
  const runTurn = async (turnId) => {
    const scratch = [];
    for (let i = 0; i < 6; i++) {
      const r = await proxyChat({
        proxyUrl: `${srv.url}/v1`, model: "m", token: "synthetic-token", turnId,
        history: [], userText: "hi", toolTurns: scratch, signal: new AbortController().signal, onDelta: () => {},
      });
      if (!r.toolUses.length) return;
      scratch.push({ role: "assistant", content: r.toolUses.map((t) => ({ type: "tool_use", ...t })) });
      scratch.push({ role: "user", content: r.toolUses.map((t) => ({ type: "tool_result", tool_use_id: t.id, content: "ok" })) });
    }
  };
  return { srv, runTurn };
}

// ── agent-sdk fake gateway: 529, tool_use, text per turn id ──
const sse = (res, events) => {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  res.end();
};
const msg = (block, stop) => [
  { type: "message_start", message: { id: "msg_" + Math.random().toString(36).slice(2), type: "message", role: "assistant", model: "hypeproof-default", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } },
  ...(block.type === "text"
    ? [
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: block.text } },
        { type: "content_block_stop", index: 0 },
      ]
    : [
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } },
        { type: "content_block_stop", index: 0 },
      ]),
  { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 1 } },
  { type: "message_stop" },
];

async function sdkHarness() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "hps-tc-ws-"));
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), "hps-tc-cfg-"));
  fs.writeFileSync(path.join(ws, "note.txt"), "turn id\n");
  const mainCalls = new Map();
  const srv = await server((req, res) => {
    let body = {};
    try { body = JSON.parse(req.body); } catch {}
    if (req.url.startsWith("/v1/messages/count_tokens")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ input_tokens: 10 }));
      return;
    }
    if (req.method !== "POST" || !req.url.startsWith("/v1/messages")) { res.writeHead(404); res.end("{}"); return; }
    const isMain = Array.isArray(body.tools) && body.tools.some((t) => t.name === "Read");
    if (!isMain) { sse(res, msg({ type: "text", text: "side" }, "end_turn")); return; }
    const key = req.headers[H] ?? "(none)";
    const n = (mainCalls.get(key) ?? 0) + 1;
    mainCalls.set(key, n);
    if (n === 1) {
      res.writeHead(529, { "content-type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }));
      return;
    }
    const hasResult = (body.messages ?? []).some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result"));
    if (!hasResult) sse(res, msg({ type: "tool_use", id: `toolu_${n}`, name: "Read", input: { file_path: path.join(ws, "note.txt") } }, "tool_use"));
    else sse(res, msg({ type: "text", text: "읽었어요" }, "end_turn"));
  });
  const agent = profileToAgentOptions(
    { game: { template_tier: "website" }, sdk_tools: { read: true } },
    { model: "hypeproof-default", systemPrompt: "" },
  );
  const runTurn = async (turnId) => {
    const before = srv.requests.length;
    const options = buildSdkQueryOptions(agent, {
      proxyUrl: `${srv.url}/v1`, token: "synthetic-token", turnId, cwd: ws, configDir: cfg,
      baseEnv: { PATH: process.env.PATH, HOME: process.env.HOME, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", DISABLE_AUTOUPDATER: "1" },
    });
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), 90_000);
    try {
      for await (const _ev of sdk.query({
        prompt: "note.txt 읽어 줘",
        options: { ...options, abortController, canUseTool: async (_n, input) => ({ behavior: "allow", updatedInput: input }) },
      })) { /* drain */ }
    } finally { clearTimeout(timer); }
    return srv.requests.slice(before);
  };
  const close = async () => {
    await srv.close();
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(cfg, { recursive: true, force: true });
  };
  return { runTurn, close };
}

const tests = {
  async test_tc_0268_valid_client_turn_id_boundaries_and_header() {
    const uuid = crypto.randomUUID();
    assert.equal(validClientTurnId("a".repeat(128)), true);
    assert.equal(validClientTurnId("a".repeat(129)), false);
    assert.equal(validClientTurnId(""), false);
    assert.equal(validClientTurnId("bad id!"), false);
    assert.equal(validClientTurnId(uuid), true);
    assert.deepEqual(clientTurnIdHeader(uuid), { [H]: uuid });
    assert.deepEqual(clientTurnIdHeader("bad id!"), {});
    assert.deepEqual(clientTurnIdHeader("a".repeat(129)), {});
    assert.deepEqual(clientTurnIdHeader(""), {});
  },

  async test_tc_0266_proxy_chat_tool_loop_sends_same_turn_id() {
    const { srv, runTurn } = await proxyServer();
    try {
      await runTurn(TURN);
      assert.equal(srv.requests.length, 3, "tool_use, tool_result, final text");
      assert.deepEqual(srv.requests.map((r) => r.headers[H]), [TURN, TURN, TURN]);
    } finally { await srv.close(); }
  },

  async test_tc_0267_proxy_new_message_gets_new_turn_id() {
    const { srv, runTurn } = await proxyServer();
    try {
      await runTurn("turn_a");
      await runTurn("turn_b");
      const ids = srv.requests.map((r) => r.headers[H]);
      assert.deepEqual([...new Set(ids)], ["turn_a", "turn_b"]);
      assert.deepEqual(ids.slice(0, 3), ["turn_a", "turn_a", "turn_a"]);
      assert.ok(ids.slice(3).every((i) => i === "turn_b"));
    } finally { await srv.close(); }
  },

  async test_tc_0265_agent_sdk_retry_tool_and_text_share_turn_id() {
    const h = await sdkHarness();
    try {
      const reqs = await h.runTurn(TURN);
      const main = reqs.filter((r) => { try { return JSON.parse(r.body).tools?.some((t) => t.name === "Read"); } catch { return false; } });
      assert.ok(main.length >= 3, `529, tool_use and text reached the gateway (saw ${main.length})`);
      assert.deepEqual([...new Set(reqs.map((r) => r.headers[H]))], [TURN], "every request, including CLI side calls");
    } finally { await h.close(); }
  },

  async test_tc_0267_agent_sdk_new_message_gets_new_turn_id() {
    const h = await sdkHarness();
    try {
      const a = await h.runTurn("turn_a");
      const b = await h.runTurn("turn_b");
      assert.deepEqual([...new Set(a.map((r) => r.headers[H]))], ["turn_a"]);
      assert.deepEqual([...new Set(b.map((r) => r.headers[H]))], ["turn_b"]);
    } finally { await h.close(); }
  },

  async test_tc_0269_invalid_turn_id_header_is_not_sent_valid_is() {
    const stale = { ANTHROPIC_CUSTOM_HEADERS: `${H}: old\nx-test: kept` };
    const gw = { proxyUrl: "https://synthetic.invalid/v1", token: "t" };
    const bad = buildSdkGatewayEnv(stale, { ...gw, turnId: "bad id!" });
    assert.equal(bad.ANTHROPIC_CUSTOM_HEADERS.includes(H), false, "no stale or invalid header in SDK env");
    assert.match(bad.ANTHROPIC_CUSTOM_HEADERS, /x-test: kept/);
    const uuid = crypto.randomUUID();
    const good = buildSdkGatewayEnv(stale, { ...gw, turnId: uuid });
    assert.ok(good.ANTHROPIC_CUSTOM_HEADERS.split("\n").includes(`${H}: ${uuid}`));
    assert.equal(good.ANTHROPIC_CUSTOM_HEADERS.includes("old"), false);

    const { srv, runTurn } = await proxyServer();
    try {
      await runTurn("bad id!");
      assert.ok(srv.requests.length > 0);
      assert.ok(srv.requests.every((r) => !(H in r.headers)), "proxy: invalid id never sent");
      const before = srv.requests.length;
      await runTurn(uuid);
      assert.ok(srv.requests.slice(before).every((r) => r.headers[H] === uuid), "proxy: valid UUID sent unchanged");
    } finally { await srv.close(); }
  },
};

for (const [name, fn] of Object.entries(tests)) {
  await fn();
  console.log(`ok ${name}`);
}
console.log("turn-id-cases: OK");
