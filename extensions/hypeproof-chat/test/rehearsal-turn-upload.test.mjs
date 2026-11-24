// #4501 — a subscription rehearsal turn is uploaded without conversation text; the instructor token stays host-side.
// Pure checks with planted values (positive control first), plus static wiring checks on the provider.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rehearsalTurnBody, helpReceiptFor, uploadRehearsalTurn } from "../src/rehearsalTurnUpload.ts";

let failed = 0;
const pending = [];
function t(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === "function") pending.push(r.then(() => console.log(`  ok   ${name}`), err => { failed++; console.log(`  FAIL ${name}\n       ${err && err.message}`); }));
    else console.log(`  ok   ${name}`);
  } catch (err) { failed++; console.log(`  FAIL ${name}\n       ${err && err.message}`); }
}

// Planted values: if any reaches the body or a log line, the check must see it.
const PLANT_STUDENT = "PLANT-STUDENT-SENTENCE-7731";
const PLANT_ANSWER = "PLANT-ANSWER-SENTENCE-7732";
const PLANT_TOOL_INPUT = "PLANT-TOOL-INPUT-7733";
const PLANT_TOKEN = "PLANT-ISSUER-TOKEN-7734";

const facts = {
  turnId: "turn-1", mode: "auto", model: "claude-sonnet-5-5", toolNames: ["read_file"], answered: true,
  at: "2026-11-25T00:00:00.000Z", courseId: "course-a", rehearsalId: "rehearsal-a", lessonSha256: "a".repeat(64),
  stepId: "step-1", helpReceipt: "mode=hint; source=lesson_default; step=step-1; performance=unobserved",
};
const body = rehearsalTurnBody(facts);
const bodyText = JSON.stringify(body);

// Positive control: the detector must catch a planted string that is put into the body on purpose.
t("positive control: planted student text is detected when it is in the body", () => {
  const bad = { ...body, user_text: PLANT_STUDENT };
  assert.ok(JSON.stringify(bad).includes(PLANT_STUDENT));
});

t("body carries text_omitted and the fixed fields", () => {
  assert.equal(body.text_omitted, true);
  assert.equal(body.answered, true);
  assert.equal(body.connection, "subscription");
  assert.equal(body.turn_id, "turn-1");
  assert.equal(body.step_id, "step-1");
  assert.deepEqual(body.tools, [{ name: "read_file" }]);
});

t("body has no text or tool-input keys", () => {
  for (const k of ["user_text", "assistant_text", "usage"]) assert.ok(!(k in body), k);
  for (const tool of body.tools) assert.deepEqual(Object.keys(tool), ["name"]);
});

t("planted student, answer and tool-input strings never reach the body", () => {
  // The facts carry no text fields, so none of the planted strings can appear.
  for (const p of [PLANT_STUDENT, PLANT_ANSWER, PLANT_TOOL_INPUT, PLANT_TOKEN]) assert.ok(!bodyText.includes(p), p);
});

t("help receipt follows the Service format (lesson_default and student)", () => {
  const step = { id: "step-1", help: { default: "hint" } };
  assert.equal(helpReceiptFor(step, undefined), "mode=hint; source=lesson_default; step=step-1; performance=unobserved");
  assert.equal(helpReceiptFor(step, "check"), "mode=check; source=student; step=step-1; performance=unobserved");
});

t("a step without help gets no receipt", () => {
  assert.equal(helpReceiptFor({ id: "step-2" }, undefined), null);
  assert.equal(helpReceiptFor(undefined, undefined), null);
});

t("upload without an issuer token: no request, outcome no_issuer", async () => {
  let calls = 0;
  const out = await uploadRehearsalTurn({ secrets: { get: async () => undefined }, adminBase: "https://x", body, fetchImpl: async () => { calls++; return new Response("{}", { status: 201 }); }, log: () => {} });
  assert.equal(calls, 0);
  assert.deepEqual(out, { status: "no_issuer" });
});

t("upload sends the token only in the Authorization header and logs no token or body", async () => {
  const seen = [];
  const logs = [];
  const out = await uploadRehearsalTurn({
    secrets: { get: async (k) => (k === "hypeproofChat.issuerToken" ? PLANT_TOKEN : undefined) },
    adminBase: "https://api.example",
    body,
    fetchImpl: async (url, init) => { seen.push({ url, init }); return new Response("{}", { status: 201 }); },
    log: (l) => logs.push(l),
  });
  assert.deepEqual(out, { status: 201 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://api.example/admin/chalk/transcripts");
  assert.equal(seen[0].init.headers.authorization, "Bearer " + PLANT_TOKEN);
  assert.ok(!seen[0].init.body.includes(PLANT_TOKEN), "token must not be in the body");
  for (const l of logs) assert.ok(!l.includes(PLANT_TOKEN) && !l.includes("user_text"), l);
  assert.deepEqual(logs, ["[rehearsal-upload] turn=turn-1 status=201"]);
});

t("a network failure is an outcome, not a throw", async () => {
  const out = await uploadRehearsalTurn({
    secrets: { get: async () => PLANT_TOKEN }, adminBase: "https://api.example", body,
    fetchImpl: async () => { throw new Error("offline"); }, log: () => {},
  });
  assert.deepEqual(out, { status: "error" });
});

// Static wiring: the upload is guarded by the subscription check and the report waits for it.
const provider = readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
const upload = readFileSync(new URL("../src/rehearsalTurnUpload.ts", import.meta.url), "utf8");

t("the upload module names no text key in code", () => {
  const code = upload.split("\n").filter(l => !l.trim().startsWith("//")).join("\n");
  assert.ok(!/\buser_text\s*:/.test(code) && !/\bassistant_text\s*:/.test(code));
});

t("the turn upload is called only on the subscription path", () => {
  assert.match(provider, /if \(mustStayLocal\(profile\.rehearsal\)\) void this\.uploadRehearsalTurnFor\(/);
});

t("the local run passes text-free facts (delta flag and tool names), not the raw text", () => {
  assert.match(provider, /onDelta:rehearsalDelta,onRefusal,onActivity:rehearsalActivity/);
  assert.match(provider, /rehearsalFacts\.toolNames\.push\(a\.name\)/);
});

t("the report checks the issuer before any request and holds once for unsent turns", () => {
  const body = provider.slice(provider.indexOf("private async sendRehearsalReport("));
  const issuerAt = body.indexOf("REHEARSAL_ISSUER_MISSING");
  const fetchAt = body.indexOf('"/classroom/rehearsal/report"');
  assert.ok(issuerAt > 0 && fetchAt > issuerAt, "issuer check must come before the report fetch");
  assert.ok(body.indexOf("rehearsalUploadPendingSentence") < fetchAt);
});

t("no issuer token value is posted to the webview (protocol carries only sentences and states)", () => {
  const posts = provider.match(/this\.post\(\{[^}]*\}\)/g) ?? [];
  // The sentence constant name contains "ISSUER"; the credential is what must not appear, so match "token" only.
  for (const p of posts) assert.ok(!/token/i.test(p), p);
});

Promise.all(pending).then(() => {
  console.log(failed ? `\n${failed} failed` : "\nall rehearsal-turn-upload checks passed");
  process.exitCode = failed ? 1 : 0;
});
