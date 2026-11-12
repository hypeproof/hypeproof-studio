// REQ-STUDIO-DOCTOR — Studio 진단 checks, under plain Node with real probes where a probe exists.
// Run: node --experimental-strip-types test/studio-doctor.smoke.mjs
//
// Every finding has a positive control (a healthy sample passes) and a negative control (a planted fault is found):
//   SDK         a missing binary, a binary that exits 1, and one that exits 0
//   Service     a closed port, a server answering 503, and one answering 200 on /health (the real route is /v1/health)
//   work folder a writable temp folder, a missing folder, a read-only folder; macOS EPERM is the privacy setting
//   login       no token, expired, server error (the only one with a reconnect fix), drained allowance, healthy
//   output      the quiet line is once per check per KST day; account states never raise it; signals and the report
//               attachment carry codes only (planted paths and tokens do not survive)
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";

const D = await import("../src/studioDoctor.ts");
const { problemDiagnostic, autoReportBody, problemReportBody, parseProblemAnswer, PROBLEM_STEPS } = await import("../src/problemReport.ts");
const { reportManifestItems } = await import("../src/reportProblemHelpers.ts");

let fail = 0;
const t = async (name, fn) => { try { await fn(); console.log(`✅ ${name}`); } catch (e) { fail++; console.log(`❌ ${name}\n   ${e?.stack ?? e}`); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hps-doctor-"));
const posix = process.platform !== "win32";

await t("SDK: missing binary is found (fail when the seat needs it, warn otherwise) and offers the re-seed", () => {
  assert.deepEqual(D.classifySdk({ available: false, run: "skipped", required: true }), { id: "sdk", status: "fail", code: "sdk_missing", fix: "reseed_sdk" });
  assert.equal(D.classifySdk({ available: false, run: "skipped", required: false }).status, "warn");
  assert.equal(D.classifySdk({ available: true, source: "node-modules", run: "skipped", required: true }).status, "ok");
});

await t("SDK: a real binary that exits 1 is not runnable; one that exits 0 passes", async () => {
  if (!posix) return console.log("   NOT RUN on win32: shell-script fixtures");
  const bad = path.join(tmp, "claude-bad"), good = path.join(tmp, "claude-good");
  fs.writeFileSync(bad, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  fs.writeFileSync(good, "#!/bin/sh\necho 0.3.299\n", { mode: 0o755 });
  assert.equal(await D.runBinaryVersion(bad), "failed");
  assert.equal(await D.runBinaryVersion(good), "ok");
  assert.equal(await D.runBinaryVersion(path.join(tmp, "absent")), "failed");
  const slow = path.join(tmp, "claude-slow"); fs.writeFileSync(slow, "#!/bin/sh\nsleep 5\n", { mode: 0o755 });
  assert.equal(await D.runBinaryVersion(slow, 300), "timeout");
  assert.equal(D.classifySdk({ available: true, source: "seeded", run: "failed", required: true }).code, "sdk_not_runnable");
});

const serve = (status) => new Promise((resolve) => {
  const s = http.createServer((req, res) => { res.statusCode = req.url === "/v1/health" ? status : 404; res.end("{}"); });
  s.listen(0, "127.0.0.1", () => resolve(s));
});
await t("Service: closed port is unreachable; 503 is a server error; 200 on {proxy}/health passes", async () => {
  const closed = await serve(200); const port = closed.address().port; await new Promise((r) => closed.close(r));
  const down = await D.probeService(`http://127.0.0.1:${port}/v1`);
  assert.equal(down.status, 0); assert.equal(down.errorCode, "ECONNREFUSED");
  assert.equal(D.classifyService(down).code, "service_unreachable");
  const s503 = await serve(503), s200 = await serve(200);
  try {
    assert.equal(D.classifyService(await D.probeService(`http://127.0.0.1:${s503.address().port}/v1`)).code, "service_error");
    // Positive control, and the path control: /v1 + /health, the route that answers in production (bare /health is 404).
    assert.equal(D.classifyService(await D.probeService(`http://127.0.0.1:${s200.address().port}/v1/`)).status, "ok");
    assert.equal(D.classifyService(await D.probeService(`http://127.0.0.1:${s200.address().port}`)).code, "service_error");
  } finally { s503.close(); s200.close(); }
  assert.equal(D.classifyService({ status: 0, errorCode: "SELF_SIGNED_CERT_IN_CHAIN" }).code, "service_tls");
  assert.equal(D.classifyService({ status: 0, errorCode: "ENOTFOUND" }).code, "service_offline");
  assert.equal(D.classifyService({ status: 407 }).code, "service_proxy_auth");
  assert.equal(D.fetchErrorCode({ name: "TimeoutError" }), "timeout");
  assert.equal(D.fetchErrorCode({ cause: { code: "/Users/kim secret" } }), "unknown");
});

await t("Work folder: writable passes; missing and read-only are found; nothing is left behind", async () => {
  const ok = path.join(tmp, "work"); fs.mkdirSync(ok);
  assert.equal(await D.probeWorkFolder(ok), "ok");
  assert.equal(await D.probeWorkFolder(ok, "win32"), "ok");
  assert.deepEqual(fs.readdirSync(ok), [], "the write probe removed its file");
  assert.equal(D.classifyWorkFolder({ folder: true, platform: process.platform, probe: await D.probeWorkFolder(path.join(tmp, "gone")) }).code, "folder_missing");
  const file = path.join(tmp, "a-file"); fs.writeFileSync(file, "");
  assert.equal(await D.probeWorkFolder(file), "ENOTDIR");
  if (posix && process.getuid?.() !== 0) {
    const ro = path.join(tmp, "readonly"); fs.mkdirSync(ro, { mode: 0o555 });
    const c = D.classifyWorkFolder({ folder: true, platform: "linux", probe: await D.probeWorkFolder(ro) });
    assert.deepEqual(c, { id: "workfolder", status: "fail", code: "folder_not_writable", fix: "open_folder" });
    fs.chmodSync(ro, 0o755);
  }
  assert.equal(D.classifyWorkFolder({ folder: false, platform: "darwin", probe: "ok" }).status, "skip");
});

await t("Work folder: macOS EPERM is the privacy setting (opens Mac settings); EACCES on macOS is not", () => {
  assert.deepEqual(D.classifyWorkFolder({ folder: true, platform: "darwin", probe: "EPERM" }), { id: "workfolder", status: "fail", code: "folder_mac_privacy", fix: "mac_privacy" });
  assert.equal(D.classifyWorkFolder({ folder: true, platform: "darwin", probe: "EACCES" }).code, "folder_not_writable");
  assert.equal(D.classifyWorkFolder({ folder: true, platform: "linux", probe: "EPERM" }).code, "folder_not_writable");
  assert.equal(D.probeOutcome(Object.assign(new Error("x"), { code: "EPERM" })), "EPERM");
});

await t("Work folder: Windows protected folders are hinted (Controlled Folder Access), others are not", () => {
  const home = "C:\\Users\\kim";
  assert.equal(D.isProtectedWindowsFolder("C:\\Users\\kim\\Documents\\HypeProofTrial", home), true);
  assert.equal(D.isProtectedWindowsFolder("C:\\Users\\kim\\OneDrive\\문서\\work", home), true);
  assert.equal(D.isProtectedWindowsFolder("C:\\Users\\kim\\HypeProofTrial", home), false);
  assert.equal(D.isProtectedWindowsFolder("C:\\Users\\kim\\DocumentsOld", home), false);
  assert.equal(D.classifyWorkFolder({ folder: true, platform: "win32", probe: "EPERM", protectedWindowsFolder: true }).code, "folder_windows_protected");
  assert.equal(D.classifyWorkFolder({ folder: true, platform: "win32", probe: "EPERM", protectedWindowsFolder: false }).code, "folder_not_writable");
  assert.ok(!/windowsdefender:|Set-MpPreference/.test(JSON.stringify(D.DOCTOR_TEXT)), "never automates the Defender setting");
});

await t("Login: states are named; only a server-side failure offers reconnect", () => {
  const now = Date.UTC(2026, 10, 3);
  assert.equal(D.classifyLogin({ hasToken: false, now }).code, "login_missing");
  assert.equal(D.classifyLogin({ hasToken: true, now }).status, "skip");
  assert.equal(D.classifyLogin({ hasToken: true, now, profile: { ok: true, trial: null, pass: null } }).status, "ok");
  assert.equal(D.classifyLogin({ hasToken: true, now, profile: { ok: true, trial: { state: "exhausted" } } }).code, "quota_exhausted");
  assert.equal(D.classifyLogin({ hasToken: true, now, profile: { ok: true, pass: { request_limit: 10, requests_used: 10 } } }).code, "quota_exhausted");
  assert.equal(D.classifyLogin({ hasToken: true, now, profile: { ok: true, pass: { request_limit: 10, requests_used: 3, expires_at: now - 1 } } }).code, "seat_ended");
  assert.equal(D.classifyLogin({ hasToken: true, now, profile: { ok: true, pass: { request_limit: 10, requests_used: 3, expires_at: now + 1 } } }).code, "login_ok");
  assert.equal(D.classifyLogin({ hasToken: true, now, profile: { ok: false, reason: "expired" } }).code, "login_expired");
  assert.equal(D.classifyLogin({ hasToken: true, now, profile: { ok: false, reason: "expired", code: "trial_expired" } }).code, "seat_ended");
  assert.deepEqual(D.classifyLogin({ hasToken: true, now, profile: { ok: false, reason: "server" } }), { id: "login", status: "fail", code: "login_unverified", fix: "reconnect" });
  assert.equal(D.classifyLogin({ hasToken: true, now, profile: { ok: false, reason: "network" } }).status, "skip");
  for (const code of ["login_expired", "login_rejected", "seat_ended"]) assert.equal(D.classifyLogin({ hasToken: true, now, profile: { ok: false, reason: code === "login_rejected" ? "rejected" : "expired" } }).fix, undefined);
});

await t("Disk: low is a warning, unknown is skipped, enough passes", () => {
  assert.equal(D.classifyDisk({ free: 100, threshold: 500 }).code, "disk_low");
  assert.equal(D.classifyDisk({ free: null, threshold: 500 }).status, "skip");
  assert.equal(D.classifyDisk({ free: 900, threshold: 500 }).status, "ok");
});

const allOk = { checks: [{ id: "sdk", status: "ok", code: "sdk_ok" }, { id: "service", status: "ok", code: "service_ok" }, { id: "login", status: "ok", code: "login_ok" }, { id: "workfolder", status: "ok", code: "folder_ok" }, { id: "disk", status: "ok", code: "disk_ok" }], duration_ms: 12 };

await t("runDoctor: all-healthy probes are silent; planted faults are all found; a throwing probe is skipped", async () => {
  const now = Date.UTC(2026, 10, 3, 3);
  const healthy = await D.runDoctor({ sdk: async () => ({ available: true, source: "seeded", run: "ok", required: true }), service: async () => ({ status: 200 }), login: async (r) => ({ hasToken: true, now, profile: r ? { ok: true } : undefined }), workFolder: async () => ({ folder: true, platform: "darwin", probe: "ok" }), disk: async () => ({ free: 9e9, threshold: 5e8 }) });
  assert.deepEqual(healthy.checks.map((c) => c.status), ["ok", "ok", "ok", "ok", "ok"]);
  assert.equal(D.doctorSummary(healthy), "모두 정상이에요.");
  assert.deepEqual(D.dueChecks(healthy, {}, now, true), [], "silent when everything passes");
  let loginSawReachable;
  const broken = await D.runDoctor({ sdk: async () => ({ available: false, run: "skipped", required: true }), service: async () => ({ status: 0, errorCode: "ECONNREFUSED" }), login: async (r) => { loginSawReachable = r; return { hasToken: true, now }; }, workFolder: async () => ({ folder: true, platform: "darwin", probe: "EPERM" }), disk: async () => { throw new Error("statfs"); } });
  assert.equal(loginSawReachable, false, "login is not probed against an unreachable Service");
  assert.deepEqual(broken.checks.map((c) => c.code), ["sdk_missing", "service_unreachable", "login_unknown", "folder_mac_privacy", "disk_unknown"]);
  assert.equal(D.doctorSummary(broken), "확인할 것이 3개 있어요.");
  const rows = D.doctorRows(broken);
  assert.equal(rows[0].mark, "⚠"); assert.equal(rows[0].fix.label, "AI 작업 도구 다시 받기");
  assert.equal(rows[3].fix.label, "Mac 설정 열기"); assert.equal(rows[4].mark, "–");
});

await t("Quiet line: once per check per KST day, fail before warn, account states and disk never raise it", () => {
  const r = { checks: [{ id: "disk", status: "warn", code: "disk_low" }, { id: "login", status: "warn", code: "quota_exhausted" }, { id: "service", status: "fail", code: "service_offline" }, { id: "sdk", status: "warn", code: "sdk_missing", fix: "reseed_sdk" }], duration_ms: 1 };
  const t0 = Date.UTC(2026, 10, 3, 14, 0); // 23:00 KST
  const due = D.dueChecks(r, {}, t0, true);
  assert.deepEqual(due.map((c) => c.id), ["service", "sdk"], "fail first; quota and disk excluded");
  const log = D.markShown({}, [due[0]], t0);
  assert.deepEqual(D.dueChecks(r, log, t0 + 30 * 60_000, true).map((c) => c.id), ["sdk"], "same day: not again");
  assert.deepEqual(D.dueChecks(r, log, t0 + 61 * 60_000, true).map((c) => c.id), ["service", "sdk"], "after KST midnight: due again");
  assert.deepEqual(D.dueChecks(r, {}, t0, false).map((c) => c.id), ["service", "disk", "sdk"], "signals count disk_low too");
  const n = D.doctorNotice(due[1], "doctor-x");
  assert.deepEqual(n, { id: "doctor-x", check: "sdk", code: "sdk_missing", text: D.DOCTOR_TEXT.sdk_missing, fix: { id: "reseed_sdk", label: "AI 작업 도구 다시 받기" } });
  assert.equal(D.doctorNotice(undefined, "x"), null);
});

await t("Signals: doctor_<code> is a Service-valid machine word with an allowed step; body is the exact allowlist", () => {
  const SERVICE_CODE_RE = /^[a-z][a-z0-9_]{0,47}$/;
  const codes = Object.keys(D.DOCTOR_TEXT);
  for (const code of codes) assert.match(`doctor_${code}`, SERVICE_CODE_RE);
  for (const step of Object.values(D.DOCTOR_STEP)) assert.ok(PROBLEM_STEPS.includes(step), step);
  const facts = D.doctorSignalFacts([{ id: "workfolder", status: "fail", code: "folder_mac_privacy" }, { id: "sdk", status: "fail", code: "/Users/kim/claude" }]);
  assert.deepEqual(facts, [{ code: "doctor_folder_mac_privacy", step: "workspace" }], "a non-word code is dropped");
  const body = autoReportBody(problemDiagnostic({ ...facts[0], status: 0 }, { appVersion: "0.1.60", platform: "darwin", arch: "arm64" }));
  assert.deepEqual(Object.keys(body).sort(), ["app_version", "code", "fingerprint", "http_status", "os", "step"]);
  assert.equal(body.code, "doctor_folder_mac_privacy"); assert.equal(body.http_status, 0);
});

await t("Report attachment: codes only, planted paths/tokens dropped, ticked box attaches, unticked does not", () => {
  const planted = { checks: [...allOk.checks, { id: "workfolder", status: "fail", code: "/Users/kim/Desktop" }, { id: "evil", status: "ok", code: "hps_tok_abc" }, { id: "sdk", status: "fail", code: "not_a_known_code" }], duration_ms: 42.7 };
  const a = D.doctorAttachment(planted);
  assert.equal(a.v, 1); assert.equal(a.duration_ms, 43); assert.equal(a.checks.length, 5);
  const json = JSON.stringify(a);
  for (const bad of ["/Users", "Desktop", "hps_tok", "evil", "not_a_known_code"]) assert.ok(!json.includes(bad), bad);
  for (const c of a.checks) assert.deepEqual(Object.keys(c).sort(), ["code", "id", "status"]);
  const answer = (includeDoctor) => parseProblemAnswer({ description: "", contact: "", includeRecentTurns: false, includeLogs: false, includeDoctor });
  assert.equal(parseProblemAnswer({ description: "", contact: "", includeRecentTurns: false, includeDoctor: "yes" }), null);
  const ctx = { recentTurns: [], metadata: { studio_version: "0.1.60", extension: "hypeproof-chat", os: "darwin", locale: "ko", vscode_version: "1", profile_id: "p", jti_hash: "h", last_request_id: "r", ts_client: "t" }, reason: "manual", uiState: { entry: "command", chat_surface: "sidebar" }, doctor: a };
  const on = problemReportBody(answer(true), ctx), off = problemReportBody(answer(false), ctx);
  assert.deepEqual(on.attachments.doctor, a); assert.equal(off.attachments.doctor, undefined);
  // Service limits (worker/src/routes/report.ts): ≤20 attachment keys, ≤8192 serialized chars.
  assert.ok(Object.keys(on.attachments).length <= 20); assert.ok(JSON.stringify(on.attachments).length <= 8192);
  assert.ok(reportManifestItems(on).some((i) => i.name === "진단 결과 (확인한 항목과 결과 코드)"));
  assert.ok(!reportManifestItems(off).some((i) => i.name.startsWith("진단 결과")));
});

await t("Copy: every code has one Korean sentence without paths, versions or HTTP numbers", () => {
  for (const [code, text] of Object.entries(D.DOCTOR_TEXT)) {
    assert.match(text, /[가-힣]/, code);
    assert.ok(!/\/|\\|https?:|\b\d{3}\b|v\d/.test(text), `${code}: ${text}`);
  }
});

fs.rmSync(tmp, { recursive: true, force: true });
if (fail) { console.log(`\n${fail} failed`); process.exit(1); }
console.log("\nPASS studio-doctor");
