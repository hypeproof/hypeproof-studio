// REQ-STUDIO-MEMORY-USE (CGP-KNOW-R-026; DEC-01) — memory lives only in the activity folder, so a memory-carrying turn on
// the agent-sdk runtime leaves no copy in the CLI's session transcripts under the seat's config dir.
//   1. runSdkCoach with a scripted SDK: `ephemeralSession` sets `persistSession: false`; without it the option is absent
//      (every other turn unchanged).
//   2. the real vendored CLI, run by the real runSdkCoach against a local stub gateway with HOME in a scratch folder:
//      after a memory-carrying turn a unique marker is in no file under the seat's claude-config; the same turn without
//      the flag (control) does write it, so the check is not vacuous. NOT RUN when the vendored binary is absent.
//   3. The Service's prompt record: it takes the last user message's text (`lastUserMessageText`, copied below from
//      hypeproof-service worker/src/lib/chat-extract.ts) as the turn's prompt, screens it and stores it on cohorts with
//      `analytics.log_user_messages`. On both runtimes the request that reaches the gateway carries the memory for the
//      model, and that extracted text carries none: proxy (real proxyChat, captured fetch body) and agent-sdk (the real
//      CLI's request body at the stub gateway).
// Run: node --experimental-strip-types test/memory-use-sdk.smoke.mjs
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as http from "node:http";
import { registerHooks } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const stub = new URL("./fixtures/vscode-stub.mjs", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "vscode") return { url: stub, shortCircuit: true };
    if (specifier.startsWith(".") && !/\.[a-z0-9]+$/i.test(specifier)) {
      try { return nextResolve(`${specifier}.ts`, context); } catch { return nextResolve(specifier, context); }
    }
    return nextResolve(specifier, context);
  },
});

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hps-memory-sdk-")));
const HOME = path.join(scratch, "home"), WS = path.join(scratch, "ws");
fs.mkdirSync(HOME, { recursive: true });
fs.mkdirSync(WS, { recursive: true });
process.env.HOME = HOME;
delete process.env.APPDATA;
process.on("exit", () => fs.rmSync(scratch, { recursive: true, force: true }));

const { runSdkCoach } = await import("../src/sdkCoach.ts");
const { sdkConfigDirFor, coachSeatKeyFor } = await import("../src/sdkCoachHelpers.ts");
const { memoryUseContext } = await import("../src/memoryUse.ts");
const { proxyChat } = await import("../src/proxyClient.ts");

// Copied verbatim (types dropped) from hypeproof-service origin/main worker/src/lib/chat-extract.ts, lastUserMessageText.
function lastUserMessageText(body) {
  if (!body || typeof body !== "object") return "";
  const msgs = body.messages;
  if (!Array.isArray(msgs)) return "";
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (!m || m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
      let s = "";
      for (const part of m.content) {
        const t = part?.text;
        if (typeof t === "string") s += t;
      }
      return s;
    }
    return "";
  }
  return "";
}

const TRIAL = { profile_id: "studio-native-trial", activity_kind: "trial", game: { template_tier: "website" }, sdk_tools: { read: true, write: true }, orchestrator: { enabled: false, reason: "orchestrator_off" } };
const MARK = `MEMMARK-${Math.random().toString(36).slice(2)}`;
const memory = memoryUseContext([{ name: "a.md", text: `좋아하는 색은 초록이에요 ${MARK}` }], new Set()).text;
const base = (extra) => ({
  token: "hps-token-memory-sdk", model: "claude-sonnet-5-5", turnId: "turn_memory", profile: TRIAL, systemPrompt: "",
  history: [], userText: "오늘 할 일을 정리해 줘", signal: new AbortController().signal, cwd: WS, stallTimeoutMs: 0,
  onDelta: () => {}, onCitations: () => {}, onAssetScore: () => {}, requestApproval: async () => ({ approved: true, actor: "policy" }),
  ...extra,
});

// ── 1. The option, through the real runSdkCoach with a scripted SDK ──────────
{
  const captured = [];
  const sdk = {
    createSdkMcpServer: (o) => ({ name: o.name, tools: o.tools ?? [] }),
    tool: (name) => ({ name }),
    query({ options }) {
      captured.push(options);
      return (async function* () {
        yield { type: "system", subtype: "init" };
        yield { type: "assistant", message: { id: "m1", model: "claude-sonnet-5-5", content: [{ type: "text", text: "네" }] } };
        yield { type: "result", subtype: "success", stop_reason: "end_turn" };
      })();
    },
  };
  const binaryResolution = { available: true, source: "setting", path: "/opt/claude", reasons: [] };
  const prompts = [];
  const sdkRecording = { ...sdk, query(a) { prompts.push(a.prompt); return sdk.query(a); } };
  await runSdkCoach(base({ gatewayUrl: "https://api.hypeproof-ai.xyz/v1", sdk: sdkRecording, binaryResolution, ephemeralSession: true, memoryContext: memory }));
  await runSdkCoach(base({ gatewayUrl: "https://api.hypeproof-ai.xyz/v1", sdk: sdkRecording, binaryResolution }));
  assert.equal(captured[0].persistSession, false, "a memory-carrying turn runs without a session transcript");
  assert.ok(!String(prompts[0]).includes(MARK), "memory is not in the prompt (the last user message)");
  const hook = captured[0].hooks?.UserPromptSubmit?.at(-1)?.hooks?.[0];
  assert.equal(typeof hook, "function", "memory rides the UserPromptSubmit hook");
  assert.ok((await hook({}, undefined, {})).hookSpecificOutput.additionalContext.includes(MARK), "as its additionalContext");
  assert.ok(!captured[1].hooks?.UserPromptSubmit, "no hook on a turn without memory");
  assert.ok(!("persistSession" in captured[1]), "any other turn is unchanged");
  console.log("✓ memory sdk: ephemeralSession sets persistSession: false, and only then");
}

// ── 2. The real vendored CLI writes nothing of the memory under the seat's config dir ──
const extension = fileURLToPath(new URL("..", import.meta.url));
const binary = path.join(extension, "node_modules/@anthropic-ai", `claude-agent-sdk-${process.platform}-${process.arch}`, process.platform === "win32" ? "claude.exe" : "claude");
if (!fs.existsSync(binary)) {
  if (process.env.MEMORY_SDK_REQUIRE_CLI === "1") throw new Error("vendored CLI required");
  console.log(`NOT RUN memory sdk real CLI: no vendored binary at ${binary}`);
} else {
  const sse = (events) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("");
  let requests = 0;
  const bodies = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      try { bodies.push(JSON.parse(raw)); } catch { /* not JSON */ }
      if (!req.url.includes("/messages")) { res.writeHead(404, { "content-type": "application/json" }); res.end("{}"); return; }
      requests++;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(sse([
        ["message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } }],
        ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
        ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "네" } }],
        ["content_block_stop", { type: "content_block_stop", index: 0 }],
        ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } }],
        ["message_stop", { type: "message_stop" }],
      ]));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const gatewayUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const configDir = sdkConfigDirFor(process.env, coachSeatKeyFor(base({}))).replace(/\\/g, "/");
  const holding = () => {
    const hits = [];
    const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (e.isFile() && fs.readFileSync(p).includes(MARK)) hits.push(path.relative(configDir, p)); } };
    if (fs.existsSync(configDir)) walk(configDir);
    return hits;
  };
  // The memory turn as the provider runs it (no session file, memory beside the prompt); the control prepends it to the
  // prompt with persistence on, as the first build did.
  const run = (memoryTurn) => runSdkCoach(base({ gatewayUrl, binaryResolution: { available: true, source: "setting", path: binary, reasons: [] },
    ...(memoryTurn ? { ephemeralSession: true, memoryContext: memory } : { userText: `${memory}\n\n오늘 할 일을 정리해 줘` }) }));
  try {
    assert.ok(configDir.startsWith(HOME.replace(/\\/g, "/")), "the seat's config dir is inside the scratch HOME");
    await run(true);
    assert.ok(requests >= 1, "control: the CLI reached the stub gateway");
    assert.ok(fs.existsSync(configDir), "control: the CLI used the seat's config dir");
    assert.deepEqual(holding(), [], "after a memory-carrying turn no file under the seat's claude-config holds the memory");
    // Every request of the turn (the CLI also sends side requests, e.g. a title from the prompt): the model request carries
    // the memory, and no request's last user message holds it.
    const turn = bodies.filter((b) => JSON.stringify(b).includes("오늘 할 일을 정리해 줘"));
    assert.ok(turn.length > 0, "control: the turn's requests reached the gateway");
    assert.ok(turn.some((b) => JSON.stringify(b.messages).includes(MARK) && lastUserMessageText(b).includes("오늘 할 일을 정리해 줘")), "the model request carries the memory beside the learner's message");
    for (const b of turn) assert.ok(!lastUserMessageText(b).includes(MARK), "no request's last user message (the Service's prompt record) holds memory");
    await run(false);
    assert.ok(holding().length > 0, "control: without the flag the CLI transcript does hold it, so the check above is not vacuous");
    console.log("✓ memory sdk: the real CLI leaves no memory copy under the seat's claude-config, and none in the Service's prompt record");
  } finally {
    server.close();
  }
}

// ── 3. The proxy runtime: memory is its own user message, before the last one ──
{
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push(JSON.parse(init.body));
    return new Response("data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  try {
    const args = { proxyUrl: "https://api.hypeproof-ai.xyz/v1", model: "hypeproof-default", token: "hps-token-memory", history: [{ role: "user", content: "어제 질문" }, { role: "assistant", content: "어제 답" }],
      userText: "오늘 할 일을 정리해 줘", signal: new AbortController().signal, onDelta: () => {}, onCitations: () => {}, onAssetScore: () => {} };
    await proxyChat({ ...args, contextText: memory }).catch(() => undefined);
    await proxyChat(args).catch(() => undefined);
  } finally { globalThis.fetch = realFetch; }
  assert.equal(sent.length, 2, "control: both requests were sent");
  assert.ok(JSON.stringify(sent[0].messages).includes(MARK), "the model request carries the memory");
  assert.equal(lastUserMessageText(sent[0]), "오늘 할 일을 정리해 줘", "the Service's prompt record is the learner's message only");
  assert.deepEqual(sent[0].messages.map((m) => m.role), ["user", "assistant", "user", "user"], "memory is its own user message right before the turn");
  assert.ok(!JSON.stringify(sent[1]).includes(MARK) && sent[1].messages.length === 3, "a turn without memory is unchanged");
  console.log("✓ memory proxy: the Service's prompt record (last user message) holds no memory");
}
