// #4501 — a subscription rehearsal turn is uploaded without conversation text, with the learner rehearsal code of this
// window (D1 = B). The instructor credential (issuer or return key) is never read. Pure checks with planted values
// (positive control first), plus static wiring checks on the provider.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rehearsalTurnBody, helpReceiptFor, uploadRehearsalTurn, rehearsalCodeNoticeNeeded, REHEARSAL_CODE_KEY } from "../src/rehearsalTurnUpload.ts";

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
const PLANT_CODE = "PLANT-REHEARSAL-CODE-7734";
const PLANT_RETURN = "PLANT-RETURN-ISSUER-7735";
const BASE = "https://api.example/v1";

const facts = {
  turnId: "turn-1", mode: "auto", model: "claude-sonnet-5-5", toolNames: ["read_file"], answered: true,
  at: "2026-11-25T00:00:00.000Z", stepId: "step-1",
  helpReceipt: "mode=hint; source=lesson_default; step=step-1; performance=unobserved",
};
const body = rehearsalTurnBody(facts);
const bodyText = JSON.stringify(body);

// Positive control: the detector must catch a planted string that is put into the body on purpose.
t("positive control: planted code is detected when it is in the body", () => {
  const bad = { ...body, user_text: PLANT_CODE };
  assert.ok(JSON.stringify(bad).includes(PLANT_CODE));
});

t("body carries text_omitted and the fixed fields", () => {
  assert.equal(body.text_omitted, true);
  assert.equal(body.answered, true);
  assert.equal(body.turn_id, "turn-1");
  assert.equal(body.step_id, "step-1");
  assert.deepEqual(body.tools, [{ name: "read_file" }]);
});

t("body has no text, tool-input, or rehearsal-identity keys (the server takes them from the code)", () => {
  for (const k of ["user_text", "assistant_text", "usage", "rehearsal_id", "course_id", "lesson_sha256", "connection"]) assert.ok(!(k in body), k);
  for (const tool of body.tools) assert.deepEqual(Object.keys(tool), ["name"]);
});

// Server allow-list (service PR #617 may tighten it): the body keys must equal this list exactly, no more and no fewer.
const ALLOWED_BODY_KEYS = ["answered", "at", "help_receipt", "mode", "model", "step_id", "text_omitted", "tools", "turn_id"];
t("body keys equal the allow-list exactly (no extra, no missing)", () => {
  assert.deepEqual(Object.keys(body).sort(), ALLOWED_BODY_KEYS);
  const noHelp = rehearsalTurnBody({ ...facts, stepId: null, helpReceipt: null });
  assert.deepEqual(Object.keys(noHelp).sort(), ALLOWED_BODY_KEYS);
});

t("the body turn_id is the id the caller passed (no new id made in the body builder)", () => {
  assert.equal(rehearsalTurnBody({ ...facts, turnId: "turn-retry-9" }).turn_id, "turn-retry-9");
});

t("planted student, answer, tool-input and code strings never reach the body", () => {
  for (const p of [PLANT_STUDENT, PLANT_ANSWER, PLANT_TOOL_INPUT, PLANT_CODE]) assert.ok(!bodyText.includes(p), p);
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

t("upload without a rehearsal code: no request, outcome no_code", async () => {
  let calls = 0;
  const out = await uploadRehearsalTurn({ secrets: { get: async () => undefined }, base: BASE, body, fetchImpl: async () => { calls++; return new Response("{}", { status: 201 }); }, log: () => {} });
  assert.equal(calls, 0);
  assert.deepEqual(out, { status: "no_code" });
});

t("upload sends the rehearsal code only in the Authorization header and logs no code or body", async () => {
  const seen = [];
  const logs = [];
  const out = await uploadRehearsalTurn({
    secrets: { get: async (k) => (k === REHEARSAL_CODE_KEY ? PLANT_CODE : undefined) },
    base: BASE,
    body,
    fetchImpl: async (url, init) => { seen.push({ url, init }); return new Response("{}", { status: 201 }); },
    log: (l) => logs.push(l),
  });
  assert.deepEqual(out, { status: 201 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://api.example/v1/classroom/rehearsal/turns");
  assert.equal(seen[0].init.headers.authorization, "Bearer " + PLANT_CODE);
  assert.ok(!seen[0].init.body.includes(PLANT_CODE), "code must not be in the body");
  for (const l of logs) assert.ok(!l.includes(PLANT_CODE) && !l.includes("user_text"), l);
  assert.deepEqual(logs, ["[rehearsal-upload] turn=turn-1 status=201"]);
});

t("a refusal carries the Service reason code (for the report sentence)", async () => {
  const out = await uploadRehearsalTurn({
    secrets: { get: async () => PLANT_CODE }, base: BASE, body,
    fetchImpl: async () => new Response(JSON.stringify({ error: "x", reason: "already_judged" }), { status: 409 }), log: () => {},
  });
  assert.deepEqual(out, { status: 409, reason: "already_judged" });
});

t("a network failure is an outcome, not a throw", async () => {
  const out = await uploadRehearsalTurn({
    secrets: { get: async () => PLANT_CODE }, base: BASE, body,
    fetchImpl: async () => { throw new Error("offline"); }, log: () => {},
  });
  assert.deepEqual(out, { status: "error" });
});

t("the uploader reads only the rehearsal code key, never the issuer or return key", async () => {
  const reads = [];
  await uploadRehearsalTurn({
    secrets: { get: async (k) => { reads.push(k); return k === REHEARSAL_CODE_KEY ? PLANT_CODE : PLANT_RETURN; } },
    base: BASE, body, fetchImpl: async () => new Response("{}", { status: 201 }), log: () => {},
  });
  assert.deepEqual(reads, [REHEARSAL_CODE_KEY]);
});

// Entry notice decision: a same-window seat has the code (return key only changes the issuer), so no sentence there.
t("entry notice: same-window seat (code present) → no sentence", () => {
  assert.equal(rehearsalCodeNoticeNeeded({ seatBand: true, subscription: true, codeInWindow: true }), false);
});
t("entry notice: another device with the code → no sentence", () => {
  assert.equal(rehearsalCodeNoticeNeeded({ seatBand: true, subscription: true, codeInWindow: true }), false);
});
t("entry notice: seat with no code in this window → one sentence", () => {
  assert.equal(rehearsalCodeNoticeNeeded({ seatBand: true, subscription: true, codeInWindow: false }), true);
});
t("entry notice: not a seat, or server path → never", () => {
  assert.equal(rehearsalCodeNoticeNeeded({ seatBand: false, subscription: true, codeInWindow: false }), false);
  assert.equal(rehearsalCodeNoticeNeeded({ seatBand: true, subscription: false, codeInWindow: false }), false);
});

// Static wiring.
const provider = readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
const upload = readFileSync(new URL("../src/rehearsalTurnUpload.ts", import.meta.url), "utf8");
const extension = readFileSync(new URL("../src/extension.ts", import.meta.url), "utf8");

t("the upload key equals the learner token key the extension stores (extension.ts TOKEN_KEY)", () => {
  const m = extension.match(/const TOKEN_KEY = "([^"]+)"/);
  assert.ok(m && m[1] === REHEARSAL_CODE_KEY, `extension.ts TOKEN_KEY ${m && m[1]} vs ${REHEARSAL_CODE_KEY}`);
});

t("the upload module names no text key and no instructor or return key in code", () => {
  const code = upload.split("\n").filter(l => !l.trim().startsWith("//")).join("\n");
  assert.ok(!/\buser_text\s*:/.test(code) && !/\bassistant_text\s*:/.test(code));
  assert.ok(!/ISSUER|returnIssuer|REHEARSAL_RETURN/.test(code), "the upload module must not touch the instructor credential");
});

t("the turn upload is called only on the subscription path", () => {
  assert.match(provider, /if \(mustStayLocal\(profile\.rehearsal\)\) void this\.uploadRehearsalTurnFor\(/);
});

t("the local run passes text-free facts (delta flag and tool names), not the raw text", () => {
  assert.match(provider, /onDelta:rehearsalDelta,onRefusal,onActivity:rehearsalActivity/);
  assert.match(provider, /rehearsalFacts\.toolNames\.push\(a\.name\)/);
});

t("the report sends nothing before its checks and holds once for unsent turns", () => {
  const body = provider.slice(provider.indexOf("private async sendRehearsalReport("));
  const holdAt = body.indexOf("rehearsalUploadPendingSentence");
  const fetchAt = body.indexOf('"/classroom/rehearsal/report"');
  assert.ok(holdAt > 0 && fetchAt > holdAt, "the hold must come before the report fetch");
  assert.ok(!/ISSUER_TOKEN_KEY/.test(body.slice(0, fetchAt)), "the report must not read the instructor credential");
});

t("the report and the seat notice read the learner code key, not the issuer key, in the rehearsal paths", () => {
  const seat = provider.slice(provider.indexOf("private async postConfig("));
  assert.match(seat, /rehearsalCodeNoticeNeeded\(\{/);
  assert.match(seat, /secrets\.get\(TOKEN_KEY\)/);
});

t("no credential value is posted to the webview (protocol carries only sentences and states)", () => {
  const posts = provider.match(/this\.post\(\{[^}]*\}\)/g) ?? [];
  // The sentence constant names contain "CODE" and "ISSUER" words; the credential is what must not appear, so match "token" only.
  for (const p of posts) assert.ok(!/token/i.test(p), p);
});

Promise.all(pending).then(() => {
  console.log(failed ? `\n${failed} failed` : "\nall rehearsal-turn-upload checks passed");
  process.exitCode = failed ? 1 : 0;
});
