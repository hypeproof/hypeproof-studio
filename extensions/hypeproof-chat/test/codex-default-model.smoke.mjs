// #3939: the release app's Codex subscription runner asks for the catalog default. The runner must not send the
// literal "default" (codex model/list has no such id, so every turn ends in codex_model_unavailable). After connect(),
// the client resolves "default" to the catalog entry with isDefault true, else the first entry. Real ids pass through,
// and an unknown id is still refused (the Dev path keeps its strict check).
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { CodexLocalClient } from "../src/localRuntime/codexClient.mjs";
import { releaseInstructorRuntime } from "../src/localRuntime/releaseInstructorRuntime.ts";
import { readFileSync } from "node:fs";

let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${err && err.message}`); }
}

// A fake `codex app-server`: answers each JSON-RPC request line with a result, from the given model catalog.
function fakeCodex(models) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let buf = "";
  stdin.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.id === undefined) continue; // notifications such as `initialized` get no reply
      const result = {
        "account/read": { account: { type: "chatgpt" } },
        "mcpServerStatus/list": { data: [] },
        "model/list": { data: models },
      }[msg.method] ?? {};
      stdout.write(JSON.stringify({ id: msg.id, result }) + "\n");
    }
  });
  return { stdin, stdout, stderr, pid: undefined, kill() {}, on() {}, once() {} };
}

async function connected(models) {
  const client = new CodexLocalClient({
    executable: "codex",
    spawnProcess: () => fakeCodex(models),
    listMcpNames: () => [],
  });
  await client.connect();
  return client;
}

const CATALOG = [
  { model: "gpt-a", displayName: "Alpha", isDefault: false },
  { model: "gpt-b", displayName: "Beta", isDefault: true },
  { model: "gpt-c", displayName: "Gamma", isDefault: false },
];

await t("the catalog default (isDefault true) is chosen for the release model 'default'", async () => {
  const client = await connected(CATALOG);
  assert.equal(client.resolveModel("default"), "gpt-b");
});

await t("without any isDefault flag, 'default' resolves to the first catalog entry", async () => {
  const client = await connected(CATALOG.map(({ isDefault, ...rest }) => rest));
  assert.equal(client.resolveModel("default"), "gpt-a");
});

await t("a real catalog id passes through unchanged", async () => {
  const client = await connected(CATALOG);
  assert.equal(client.resolveModel("gpt-c"), "gpt-c");
});

await t("an unknown id is not rewritten and complete still refuses it (Dev strictness kept)", async () => {
  const client = await connected(CATALOG);
  assert.equal(client.resolveModel("nope"), "nope");
  await assert.rejects(() => client.complete({ model: "nope", messages: [] }), /codex_model_unavailable/);
});

await t("the release codex config keeps the 'default' sentinel and its label does not show the word default", async () => {
  const deps = {
    locate: (provider) => (provider === "codex" ? "/Users/instructor/.local/bin/codex" : null),
    loginOk: async () => true,
  };
  const r = await releaseInstructorRuntime({ isInstructor: true, panelMode: "instructor", rehearsal: false, storedInstructorCredential: false, setting: true, env: {} }, deps);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.config.model, "default");
  assert.doesNotMatch(r.config.label, /default/);
});

await t("index.ts sends the resolved model on the codex branch, not the raw config value", () => {
  const src = readFileSync(new URL("../src/localRuntime/index.ts", import.meta.url), "utf8");
  assert.match(src, /await client\.connect\(\);\s*return await client\.complete\(\{\s*model: client\.resolveModel\(args\.config\.model\)/);
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log("\nall codex-default-model checks passed");
