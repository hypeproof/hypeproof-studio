// REQ-STUDIO-PROBLEM-REPORT — pure checks for src/problemReport.ts.
// Run: node --experimental-strip-types test/problem-report.smoke.mjs
//
// Design requirements, each with a positive and a negative control:
//   level 1  the automatic report carries exactly the allowlisted fields; prose, paths and tokens in an error never
//            reach it, and it is sent without an Authorization header
//   level 2  recent messages go only with the explicit opt-in
//   level 3  a repeated failure or a short frustrated message offers the form; ordinary messages and one-off
//            failures do not, and an offer is not repeated
import assert from "node:assert/strict";

const {
  problemDiagnostic, autoReportBody, postAutoReport, ProblemTracker, soundsFrustrated, problemOs,
  parseProblemAnswer, problemReportBody, problemDetailRows, PROBLEM_STEPS,
} = await import("../src/problemReport.ts");

let fail = 0;
const t = async (name, fn) => { try { await fn(); console.log(`✅ ${name}`); } catch (e) { fail++; console.log(`❌ ${name}\n   ${e?.stack ?? e}`); } };
const ENV = { appVersion: "0.1.60", platform: "darwin", arch: "arm64" };
const SECRET_BITS = ["/Users/kim", "secret.txt", "hps_tok", "Bearer", "토큰 붙여넣었는데", "my essay"];
const ALLOWED = ["app_version", "code", "fingerprint", "http_status", "os", "request_id", "step"];

await t("level 1: a Service failure becomes code/step/status/version/os/fingerprint/request id only", () => {
  const d = problemDiagnostic({ status: 409, code: "trial_model_unpriced", step: "agent", requestId: "a1b2c3d4" }, ENV);
  assert.deepEqual(autoReportBody(d), {
    code: "trial_model_unpriced", step: "agent", http_status: 409, app_version: "0.1.60", os: "macos-arm64",
    fingerprint: "trial_model_unpriced:agent:0.1.60", request_id: "a1b2c3d4",
  });
});

await t("level 1 negative control: prose, paths and tokens in the failure never reach the body", () => {
  const facts = [
    { status: 500, code: "/Users/kim/Desktop/secret.txt", step: "chat" },
    { status: 403, code: "토큰 붙여넣었는데 '틀리다'고 떠요", step: "access", requestId: "Bearer hps_tok.abc def" },
    { code: "my essay text about the war", type: "Invalid Request", kind: "x".repeat(60), step: "chat" },
  ];
  for (const f of facts) {
    const body = autoReportBody(problemDiagnostic(f, { ...ENV, appVersion: "/Users/kim/app" }));
    const wire = JSON.stringify(body);
    for (const bit of SECRET_BITS) assert.ok(!wire.includes(bit), `${bit} leaked: ${wire}`);
    assert.ok(Object.keys(body).every(k => ALLOWED.includes(k)), wire);
    assert.match(body.code, /^(http_\d{3}|unknown)$/, "a non-machine code falls back to the status");
    assert.equal(body.app_version, "unknown");
  }
});

await t("level 1: posted without Authorization, to /problems/auto, body exactly the allowlist", async () => {
  const seen = [];
  const ok = await postAutoReport("https://api.example.test/v1/", problemDiagnostic({ status: 502, step: "chat" }, ENV), async (url, init) => {
    seen.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return new Response(null, { status: 204 });
  });
  assert.equal(ok, true);
  assert.equal(seen[0].url, "https://api.example.test/v1/problems/auto");
  assert.deepEqual(Object.keys(seen[0].headers), ["content-type"], "no authorization header");
  assert.deepEqual(Object.keys(seen[0].body).sort(), ["app_version", "code", "fingerprint", "http_status", "os", "step"]);
  assert.equal(seen[0].body.code, "http_502");
  // A refusal or a network error is swallowed.
  assert.equal(await postAutoReport("https://x.test/v1", problemDiagnostic({ step: "chat" }, ENV), async () => { throw new TypeError("offline"); }), false);
});

await t("os family and arch only, never the kernel release", () => {
  assert.equal(problemOs("darwin", "arm64"), "macos-arm64");
  assert.equal(problemOs("win32", "x64"), "windows-x64");
  assert.equal(problemOs("freebsd", "x64"), "other");
  assert.equal(problemOs("darwin", "ppc"), "other");
});

await t("steps match the Service contract (worker/src/lib/problem-signals.ts PROBLEM_STEPS)", () => {
  assert.deepEqual([...PROBLEM_STEPS], ["chat", "agent", "profile", "access", "safety", "workspace", "update", "attachment", "other"]);
});

await t("tracker: first failure is sent, not offered; the second is offered once; resend waits; session cap holds", () => {
  const tr = new ProblemTracker({ resendMs: 1000, maxSends: 3 });
  const a = problemDiagnostic({ status: 409, code: "trial_model_unpriced", step: "agent" }, ENV);
  const b = problemDiagnostic({ status: 500, step: "chat" }, ENV);
  assert.deepEqual(tr.note(a, 0), { send: true, offer: false, count: 1 });
  assert.deepEqual(tr.note(a, 10), { send: false, offer: true, count: 2 });
  assert.deepEqual(tr.note(a, 20), { send: false, offer: false, count: 3 }, "an offer is made once per fingerprint");
  assert.equal(tr.note(a, 1500).send, true, "resent after the window");
  assert.equal(tr.note(b, 1600).send, true);
  assert.equal(tr.note(problemDiagnostic({ status: 503, step: "chat" }, ENV), 1700).send, false, "session cap of 3 sends");
});

await t("level 3: frustration — positive and negative controls", () => {
  for (const yes of ["안 돼", "왜 안 돼요?", "또 오류", "계속 에러 나요", "오류 떠요 ㅠㅠ", "먹통이에요"]) assert.equal(soundsFrustrated(yes), true, yes);
  for (const no of ["", "이 코드가 안 돼서 고치고 싶은 부분을 설명해 줄래? 반복문에서 i가 끝까지 안 돼요 라고 쓰면 어떻게 해?", "좋아요", "버튼 색 바꿔 줘", "돼지 그림 그려 줘"]) assert.equal(soundsFrustrated(no), false, no);
  const tr = new ProblemTracker({ offerGapMs: 1000 });
  assert.equal(tr.frustration("왜 안 돼", 0), true);
  assert.equal(tr.frustration("또 오류", 500), false, "not again within the gap");
  assert.equal(tr.frustration("또 오류", 1500), true);
});

await t("level 2: recent messages only with the opt-in (negative control: ticked off)", () => {
  const turns = [{ role: "user", content: "내 숙제 내용" }, { role: "assistant", content: "답" }];
  const d = problemDiagnostic({ status: 409, code: "trial_model_unpriced", step: "agent", requestId: "a1b2c3d4" }, ENV);
  const ctx = { diagnostic: d, recentTurns: turns, metadata: { studio_version: "0.1.60" }, reason: "error" };
  const off = problemReportBody({ description: "", contact: "", includeRecentTurns: false }, ctx);
  assert.equal(off.include_recent_turns, false);
  assert.equal(off.recent_turns, undefined);
  assert.ok(!JSON.stringify(off).includes("내 숙제 내용"), "no conversation without the opt-in");
  assert.equal(off.description, "(설명 없음) trial_model_unpriced · AI 작업");
  assert.equal(off.request_id, "a1b2c3d4");
  assert.deepEqual(off.attachments.diagnostic, autoReportBody(d));
  const on = problemReportBody({ description: "계속 막혀요", contact: "", includeRecentTurns: true }, ctx);
  assert.deepEqual(on.recent_turns, turns);
  assert.equal(on.description, "계속 막혀요");
});

await t("level 2: the webview answer is validated; malformed is a cancel", () => {
  assert.deepEqual(parseProblemAnswer({ description: "  두 줄\n설명  ", contact: " a@b.c ", includeRecentTurns: false }), { description: "두 줄 설명", contact: "a@b.c", includeRecentTurns: false });
  for (const bad of [null, {}, { description: "x", contact: "", includeRecentTurns: "yes" }, { description: "x".repeat(201), contact: "", includeRecentTurns: false }])
    assert.equal(parseProblemAnswer(bad), null, JSON.stringify(bad));
});

await t("form rows show what is sent; without a failure only version and OS", () => {
  const d = problemDiagnostic({ status: 413, code: "payload_too_large", step: "attachment", requestId: "r123abcd" }, ENV);
  assert.deepEqual(problemDetailRows(d, "0.1.60", "macos-arm64").map(r => r.label), ["오류 코드", "단계", "응답 상태", "앱 버전", "운영체제", "요청 번호"]);
  assert.deepEqual(problemDetailRows(undefined, "0.1.60", "macos-arm64").map(r => r.label), ["앱 버전", "운영체제"]);
});

if (fail) { console.error(`problem-report: ${fail} failed`); process.exit(1); }
console.log("problem-report.smoke.mjs — all assertions passed");
