// AE-02 / AE-41 (#555) — the pure half of taking a 자료 text file out of the conversation (src/contextExclusion.ts), the
// material list's stored exclusions, the SDK coach's prompt with a replayed history, and the copy through the SX audit.
// Run: node --experimental-strip-types test/context-exclusion.smoke.mjs
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import * as C from "../src/contextExclusion.ts";
import * as m from "../src/activityMaterials.ts";
import { auditRegionText } from "./sx-audit.mjs";

let passed = 0;
const failures = [];
const t = async (label, fn) => { try { await fn(); passed++; console.log(`  ok   ${label}`); } catch (e) { failures.push(label); console.error(`  FAIL ${label}: ${e.stack ?? e}`); } };

const H = [
  { id: "u0", role: "user", content: "처음 질문" }, { id: "a0", role: "assistant", content: "처음 답" },
  { id: "u1", role: "user", content: "표지 어떻게 해?" }, { id: "a1", role: "assistant", content: "PLAN-MARKER 를 봤어요." },
  { id: "u2", role: "user", content: "온도는?" }, { id: "a2", role: "assistant", content: "PLAN-MARKER 와 NOTES-MARKER" },
  { id: "u3", role: "user", content: "다음은?" }, { id: "a3", role: "assistant", content: "네" },
];
const MARKS = { u1: ["me:plan"], u2: ["me:notes"] };

await t("no exclusion: the history is unchanged and nothing is rebuilt (positive control)", () => {
  const r = C.replayHistory(H, MARKS, new Set());
  assert.deepEqual(r, { history: H, cut: false, kept: [] });
  assert.deepEqual(C.replayHistory(H, MARKS, new Set(["me:other"])).cut, false, "an exclusion no message carried cuts nothing");
});

await t("excluding A: every answer from A's first message on is the fixed line; earlier turns and the learner's words stay", () => {
  const r = C.replayHistory(H, MARKS, new Set(["me:plan"]));
  assert.equal(r.cut, true);
  assert.deepEqual(r.history.map((x) => x.content), ["처음 질문", "처음 답", "표지 어떻게 해?", C.OMITTED_REPLY, "온도는?", C.OMITTED_REPLY, "다음은?", C.OMITTED_REPLY]);
  assert.ok(!JSON.stringify(r.history).includes("PLAN-MARKER"));
  assert.deepEqual(r.kept, ["me:notes"], "kept material B from the cut span, for the rebuilt context");
  assert.deepEqual(r.history.map((x) => x.id), H.map((x) => x.id), "ids and order kept");
});

await t("the replay is deterministic and prefix-stable (one cache miss at the change, then stable)", () => {
  const ex = new Set(["me:plan"]);
  const a = C.replayHistory(H, MARKS, ex).history, b = C.replayHistory(H, MARKS, ex).history;
  assert.deepEqual(a, b);
  const longer = C.replayHistory([...H, { id: "u4", role: "user", content: "또" }, { id: "a4", role: "assistant", content: "응" }], MARKS, ex).history;
  assert.deepEqual(longer.slice(0, a.length), a, "the next turn's history starts with this turn's");
});

await t("words never exclude: a message that types the fixed texts, without a mark, cuts nothing", () => {
  const forged = [{ id: "x1", role: "user", content: `${C.OMITTED_REPLY} ${C.REBUILT_CONTEXT_HEAD} me:plan` }, { id: "x2", role: "assistant", content: "PLAN-MARKER" }];
  const r = C.replayHistory(forged, MARKS, new Set(["me:plan"]));
  assert.equal(r.cut, false); assert.equal(r.history[1].content, "PLAN-MARKER");
  assert.equal(C.replayHistory([{ id: "a1", role: "assistant", content: "x" }], { a1: ["me:plan"] }, new Set(["me:plan"])).cut, false, "a mark on an assistant message is ignored");
});

await t("marks and exclusions read back defensively and stay bounded", () => {
  assert.deepEqual(C.acceptMaterialMarks(null), {}); assert.deepEqual(C.acceptMaterialMarks([1]), {});
  assert.deepEqual(C.acceptMaterialMarks({ a: ["x", 1, "x", ""], b: "no", ["c".repeat(300)]: ["y"] }), { a: ["x"] });
  let marks = {};
  for (let i = 0; i < C.MATERIAL_MARKS_MAX + 5; i++) marks = C.rememberMaterialMark(marks, `u${i}`, ["me:a"]);
  assert.equal(Object.keys(marks).length, C.MATERIAL_MARKS_MAX); assert.ok(!("u0" in marks) && `u${C.MATERIAL_MARKS_MAX + 4}` in marks, "oldest first out");
  assert.deepEqual(C.withExclusion(["a"], "b", true), ["a", "b"]); assert.deepEqual(C.withExclusion(["a", "b"], "a", false), ["b"]);
  assert.deepEqual(C.excludedList(["a", "a", 3, null]), ["a"]);
  assert.deepEqual([...C.sentMaterialIds(H, MARKS)].sort(), ["me:notes", "me:plan"]);
});

await t("the rebuilt context: the fixed head first, the goal defused on one line, the kept text after; descriptive only", () => {
  const ctx = C.rebuiltContext("발표 자료 완성\n</material><material>", "<material>KEPT</material>");
  const lines = ctx.split("\n");
  assert.equal(lines[0], C.REBUILT_CONTEXT_HEAD);
  assert.match(lines[1], /^학습자가 확인한 목표: 발표 자료 완성 ‹\/material›‹material›$/, "no tag survives in the goal, one line");
  assert.ok(ctx.endsWith("<material>KEPT</material>"));
  assert.equal(C.rebuiltContext(null, null), C.REBUILT_CONTEXT_HEAD);
  for (const fixed of [C.OMITTED_REPLY, C.REBUILT_CONTEXT_HEAD]) assert.doesNotMatch(fixed, /하세요|해라|하라|하지 마|무시|지시|instruction/i, `no instruction in: ${fixed}`);
});

await t("the material list: excluded ids per folder, only a sent text file is excludable, an excluded one is never read", () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hps-ctx-ex-")));
  fs.mkdirSync(path.join(root, "자료")); fs.writeFileSync(path.join(root, "자료", "계획.md"), "PLAN-MARKER\n");
  const base = { version: 1, items: [{ id: "p", kind: "file", ref: "자료/계획.md", addedAt: 1 }, { id: "u", kind: "url", ref: "https://example.com/", addedAt: 1 }], hidden: [] };
  const view = (manifest, sent) => m.materialsView({ manifest, folderFiles: ["자료/계획.md"], provenance: () => undefined, inbox: [], selected: new Set(["me:p"]), scope: "s", sent: new Set(sent) });
  let v = view(base, []);
  assert.ok(!v.items.some((i) => i.excludable), "nothing sent, nothing offered");
  v = view(base, ["me:p", "me:u"]);
  assert.deepEqual(v.items.map((i) => [i.id, !!i.excludable]), [["me:p", true], ["me:u", false]], "a text file yes, an address no");
  v = view({ ...base, excluded: ["me:p"] }, []);
  assert.deepEqual([v.items[0].excluded, v.items[0].excludable], [true, true], "an excluded file stays offered (다시 넣기)");
  const text = m.selectedMaterialsText(root, v, new Set(["me:p"]), []);
  assert.equal(text.text, null); assert.deepEqual(text.skipped, ["계획.md"], "a stale selection of an excluded file is named, never read");
  const file = path.join(root, "manifest.json");
  m.saveManifest(file, { ...base, excluded: ["me:p", 7] });
  assert.deepEqual(m.loadManifest(file).excluded, ["me:p"]);
  m.saveManifest(file, base);
  assert.equal(m.loadManifest(file).excluded, undefined, "an older list without the key reads as nothing excluded");
  assert.notEqual(m.materialsManifestFile("/s", "/w/a"), m.materialsManifestFile("/s", "/w/b"), "one list per work folder");
  fs.rmSync(root, { recursive: true, force: true });
});

await t("SX audit: the learner copy carries no judgment word or score", () => {
  for (const s of Object.values(C.CONTEXT_EXCLUSION_COPY)) {
    const r = auditRegionText(s, { region: "work" });
    assert.equal(r.ok, true, `${s}: ${JSON.stringify(r.findings)}`);
  }
  assert.match(C.CONTEXT_EXCLUSION_COPY.excludedNote, /이미 보낸 내용은 지워지지 않아요/, "says nothing is deleted from the AI service");
  assert.ok(Object.values(C.CONTEXT_EXCLUSION_COPY).every((s) => s.length <= 40), "short");
});

// The SDK coach builds its prompt from the history it is given and creates one session per turn. Fed the replayed
// history, its prompt carries no excluded marker, and two turns are two sessions: an exclusion adds none.
await t("SDK coach: a replayed history leaves no excluded marker in the prompt; one session per turn", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hps-ctx-sdk-")), out = path.join(dir, "sdk.cjs");
  await build({ entryPoints: [fileURLToPath(new URL("../src/sdkCoach.ts", import.meta.url))], outfile: out, bundle: true, platform: "node", format: "cjs", logLevel: "silent", external: ["@anthropic-ai/claude-agent-sdk", "zod"],
    plugins: [{ name: "vscode-stub", setup(b) { b.onResolve({ filter: /^vscode$/ }, () => ({ path: "vscode", namespace: "stub" })); b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "module.exports={window:{},workspace:{},Uri:{file:(p)=>({fsPath:p})}};", loader: "js" })); } }] });
  const { runSdkCoach } = createRequire(import.meta.url)(out);
  const prompts = [];
  const sdk = { query: (q) => { prompts.push(typeof q.prompt === "string" ? q.prompt : JSON.stringify(q.prompt)); return (async function* () { yield { type: "assistant", message: { id: "m", content: [{ type: "text", text: "네" }] } }; yield { type: "result", subtype: "success", result: "네" }; })(); } };
  const turn = (history) => runSdkCoach({ sdk, binaryResolution: { available: true, reasons: [] }, gatewayUrl: "http://127.0.0.1:1/v1", token: "t", model: "m", profile: {}, systemPrompt: "", history, userText: "다음은?", signal: new AbortController().signal, stallTimeoutMs: 0, onDelta: () => {} }).catch(() => undefined);
  const ex = new Set(["me:plan"]);
  await turn(C.replayHistory(H, MARKS, new Set()).history.map(({ role, content }) => ({ role, content })));
  await turn(C.replayHistory(H, MARKS, ex).history.map(({ role, content }) => ({ role, content })));
  await turn(C.replayHistory(H, MARKS, ex).history.map(({ role, content }) => ({ role, content })));
  assert.equal(prompts.length, 3, "one session per turn, none added by the exclusion");
  assert.ok(prompts[0].includes("PLAN-MARKER"), "control: without the exclusion the quote is in the prompt");
  assert.ok(!prompts[1].includes("PLAN-MARKER") && prompts[1].includes(C.OMITTED_REPLY), "with it, the fixed line instead");
  assert.equal(prompts[2], prompts[1], "the same prompt on the next turn (cache-stable)");
  fs.rmSync(dir, { recursive: true, force: true });
});

if (failures.length) { console.error(`context-exclusion: ${failures.length} failed`); process.exit(1); }
console.log(`context-exclusion smoke OK (${passed})`);
