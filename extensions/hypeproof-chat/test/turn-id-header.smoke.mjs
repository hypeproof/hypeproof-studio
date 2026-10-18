// studio-turn-id (svc-turn-allowance contract) — the App sends ONE `x-hps-turn-id`
// per user message, and every request of that message carries it: each tool step,
// every automatic retry, and the CLI's own side calls. A new user message gets a new id.
//
// The Service counts distinct turn ids for the open-trial allowance
// (docs/design/open-trial-conversion.md §3.4). Counting is only as good as this join
// key, so the smoke captures the headers that actually leave the process:
//   1. agent-sdk path — the real Agent SDK + its bundled CLI against a local fake
//      gateway that answers 529 once (CLI retry), then a tool_use (tool loop), then text
//   2. proxy path — proxyClient.proxyChat driven the way runBrowserLoop drives it
//      (tool_use → tool_result → final text) against a local server
//   3. the id grammar matches the Service's validTurnId (/^[a-zA-Z0-9_-]{1,128}$/) on
//      both paths: a malformed id is NOT sent (negative control), a UUID is (positive)
//
// No model, no production Service, no window. Run:
//   node --experimental-strip-types test/turn-id-header.smoke.mjs

import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { proxyChat } = await import("../src/proxyClient.ts");
const { buildSdkQueryOptions, buildSdkGatewayEnv, profileToAgentOptions } = await import("../src/sdkCoachHelpers.ts");
const { clientTurnIdHeader, validClientTurnId } = await import("../src/proxyClientHelpers.ts");

const TURN = "turn_header_smoke_1";
const sse = (res, events) => {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  res.end();
};

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

// ─── 3. grammar: the pure helper both paths use ─────────────────────────────
{
  const uuid = crypto.randomUUID();
  assert.equal(validClientTurnId(uuid), true, "positive: a UUID (streamId) is a valid turn id");
  assert.equal(validClientTurnId("a".repeat(128)), true, "positive: 128 chars is the Service's upper bound");
  for (const bad of ["", "a".repeat(129), "has space", "x\ny", "turn:1", undefined, null, 42]) {
    assert.equal(validClientTurnId(bad), false, `negative: ${JSON.stringify(bad)} is not a turn id`);
  }
  assert.deepEqual(clientTurnIdHeader(uuid), { "x-hps-turn-id": uuid });
  assert.deepEqual(clientTurnIdHeader("x\r\nx-hps-funding-source: other"), {}, "negative: header injection never goes out");
  assert.deepEqual(clientTurnIdHeader(undefined), {});
  // SDK path uses the same rule: an invalid id is dropped, never forwarded.
  const env = buildSdkGatewayEnv({}, { proxyUrl: "https://synthetic.invalid/v1", token: "t", turnId: "bad id" });
  assert.equal(/x-hps-turn-id/.test(env.ANTHROPIC_CUSTOM_HEADERS ?? ""), false, "negative: SDK path drops a malformed id");
}

// ─── 4. host wiring: one id per user message, threaded to every runtime ─────
// chatPanelProvider needs VS Code to run, so its wiring is locked from source: the turn id
// is minted once per send, and every model-request call site passes that same id.
{
  const src = fs.readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
  assert.equal((src.match(/const streamId = crypto\.randomUUID\(\);/g) ?? []).length, 1, "one UUID per user message");
  const block = (start) => {
    const out = [];
    for (let i = src.indexOf(start); i !== -1; i = src.indexOf(start, i + 1)) out.push(src.slice(i, src.indexOf("});", i)));
    return out;
  };
  const sdk = block("runSdkCoach({"), proxy = block("proxyChat({"), loop = block("this.runBrowserLoop({");
  assert.equal(sdk.length, 1, "one agent-sdk call site");
  assert.equal(proxy.length, 2, "two proxy call sites (plain + browser loop)");
  assert.equal(loop.length, 1, "one browser-loop entry");
  assert.match(sdk[0], /turnId: streamId,/, "agent-sdk runtime gets the turn id");
  assert.ok(proxy.some((b) => /turnId: streamId,/.test(b)), "plain proxy runtime gets the turn id");
  assert.ok(proxy.some((b) => /turnId: p\.streamId,/.test(b)), "every browser-loop step reuses the turn id");
  assert.match(loop[0], /\bstreamId,/, "the browser loop is handed the turn's id");
}

// ─── 2. proxy path over a tool loop ─────────────────────────────────────────
{
  let step = 0;
  const srv = await server((_req, res) => {
    step++;
    const chunk = (delta, finish) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    res.writeHead(200, { "content-type": "text/event-stream" });
    if (step <= 2) res.write(chunk({ hps_tool_use: { id: `tu_${step}`, name: "browser_screenshot", input: {} } }, "tool_calls"));
    else res.write(chunk({ content: "끝" }, "stop"));
    res.end("data: [DONE]\n\n");
  });
  try {
    const runTurn = async (turnId) => {
      const scratch = [];
      for (let iter = 0; iter < 5; iter++) {
        const r = await proxyChat({
          proxyUrl: `${srv.url}/v1`, model: "m", token: "synthetic-token", turnId,
          history: [], userText: "hi", toolTurns: scratch, signal: new AbortController().signal, onDelta: () => {},
        });
        if (!r.toolUses.length) return;
        scratch.push({ role: "assistant", content: r.toolUses.map((t) => ({ type: "tool_use", ...t })) });
        scratch.push({ role: "user", content: r.toolUses.map((t) => ({ type: "tool_result", tool_use_id: t.id, content: "ok" })) });
      }
    };
    const first = crypto.randomUUID();
    await runTurn(first);
    assert.equal(srv.requests.length, 3, "the loop made two tool steps and a final call");
    assert.deepEqual(srv.requests.map((r) => r.headers["x-hps-turn-id"]), [first, first, first],
      "proxy: every tool step of one user message carries the same turn id");
    step = 2; // next user message answers directly
    const second = crypto.randomUUID();
    await runTurn(second);
    assert.equal(srv.requests.at(-1).headers["x-hps-turn-id"], second, "proxy: the next user message has its own id");
    assert.notEqual(first, second);
    // Negative controls: no id → no header; a malformed id → no header (not a 403 invalid_turn_id).
    step = 2;
    await runTurn(undefined);
    assert.equal("x-hps-turn-id" in srv.requests.at(-1).headers, false, "proxy: absent id is not invented");
    step = 2;
    await runTurn("bad id");
    assert.equal("x-hps-turn-id" in srv.requests.at(-1).headers, false, "proxy: malformed id is not sent");
  } finally {
    await srv.close();
  }
}

// ─── 1. agent-sdk path: real SDK + CLI over retry and a tool loop ───────────
let sdk;
try {
  sdk = await import("@anthropic-ai/claude-agent-sdk");
} catch {
  sdk = null;
}
if (!sdk) {
  // The SDK is a devDependency; `npm ci` installs it with the platform CLI.
  throw new Error("@anthropic-ai/claude-agent-sdk is not installed — run npm ci in extensions/hypeproof-chat");
}
{
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "hps-turn-id-ws-"));
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), "hps-turn-id-cfg-"));
  fs.writeFileSync(path.join(ws, "note.txt"), "turn id smoke\n");
  const mainCalls = new Map(); // turn id → main-loop requests seen
  const msg = (content, stop) => [
    { type: "message_start", message: { id: "msg_" + Math.random().toString(36).slice(2), type: "message", role: "assistant", model: "hypeproof-default", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } },
    ...content.flatMap((block, index) => block.type === "text"
      ? [
          { type: "content_block_start", index, content_block: { type: "text", text: "" } },
          { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } },
          { type: "content_block_stop", index },
        ]
      : [
          { type: "content_block_start", index, content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } },
          { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } },
          { type: "content_block_stop", index },
        ]),
    { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 1 } },
    { type: "message_stop" },
  ];
  const srv = await server((req, res) => {
    if (req.method !== "POST" || !req.url.startsWith("/v1/messages")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "not_found_error", message: "not here" } }));
      return;
    }
    let body = {};
    try { body = JSON.parse(req.body); } catch {}
    if (req.url.startsWith("/v1/messages/count_tokens")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ input_tokens: 10 }));
      return;
    }
    const isMain = Array.isArray(body.tools) && body.tools.some((t) => t.name === "Read");
    if (!isMain) { sse(res, msg([{ type: "text", text: "side" }], "end_turn")); return; }
    const turn = req.headers["x-hps-turn-id"] ?? "(none)";
    const n = (mainCalls.get(turn) ?? 0) + 1;
    mainCalls.set(turn, n);
    if (n === 1) {
      // Overloaded once: the CLI retries this request by itself.
      res.writeHead(529, { "content-type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }));
      return;
    }
    // The CLI may append its own non-user messages after the tool result, so look at the whole list.
    const hasResult = (body.messages ?? []).some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result"));
    if (!hasResult) sse(res, msg([{ type: "tool_use", id: `toolu_${n}`, name: "Read", input: { file_path: path.join(ws, "note.txt") } }], "tool_use"));
    else sse(res, msg([{ type: "text", text: "읽었어요" }], "end_turn"));
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
    let result;
    try {
      for await (const ev of sdk.query({
        prompt: "note.txt 읽어 줘",
        options: {
          ...options,
          abortController,
          canUseTool: async (_name, input) => ({ behavior: "allow", updatedInput: input }),
        },
      })) {
        if (ev.type === "result") result = ev;
      }
    } finally {
      clearTimeout(timer);
    }
    return { requests: srv.requests.slice(before), result };
  };
  try {
    const first = crypto.randomUUID();
    const a = await runTurn(first);
    const mainA = a.requests.filter((r) => { try { return JSON.parse(r.body).tools?.some((t) => t.name === "Read"); } catch { return false; } });
    const withResult = mainA.filter((r) => JSON.parse(r.body).messages.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result" && !b.is_error)));
    assert.ok(withResult.length >= 1, "the turn really ran a tool step: a successful tool_result came back to the gateway");
    assert.ok(mainA.length >= 3, `retry + tool_use + final answer reached the gateway (saw ${mainA.length})`);
    assert.equal(a.result?.subtype, "success", "the turn finished");
    const idsA = a.requests.map((r) => r.headers["x-hps-turn-id"]);
    assert.deepEqual([...new Set(idsA)], [first],
      `sdk: every request of the message (${a.requests.length}: retry, tool step, side calls) carries one turn id`);

    const second = crypto.randomUUID();
    const b = await runTurn(second);
    assert.deepEqual([...new Set(b.requests.map((r) => r.headers["x-hps-turn-id"]))], [second],
      "sdk: the next user message carries its own, different id");
    assert.notEqual(first, second);
    console.log(`sdk: ${a.requests.length} + ${b.requests.length} requests, ${mainA.length} main-loop requests in turn 1`);
  } finally {
    await srv.close();
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(cfg, { recursive: true, force: true });
  }
}

console.log("turn-id-header: OK");
