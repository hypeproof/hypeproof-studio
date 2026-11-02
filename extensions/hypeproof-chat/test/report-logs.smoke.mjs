// REQ-STUDIO-REPORT-LOGS — crash records and session log tails in a problem report.
// Run: node --experimental-strip-types test/report-logs.smoke.mjs
//
// Design requirements, with positive and negative controls:
//   redaction   tokens, JWTs, key=value secrets, emails and the home user name never survive; ordinary log lines do
//   tail        only the last LOG_TAIL_BYTES of a file are read and sent, starting at a line, with a cut note
//   paths       renderer.log and exthost.log are found from the extension's own log folder (no fixed paths)
//   body        crash records always go; log tails only when the box is ticked; the confirmation lists each part
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { redactLog, logTail, webviewErrorRecord, rememberWebviewError, validWebviewErrors, LOG_TAIL_BYTES, WEBVIEW_ERROR_LIMIT } = await import("../src/reportLogs.ts");
const { sessionLogPaths, readLogTail, readSessionLogs, logsAvailable } = await import("../src/reportLogsHost.ts");
const { problemReportBody, parseProblemAnswer } = await import("../src/problemReport.ts");
const { reportManifestItems } = await import("../src/reportProblemHelpers.ts");

let fail = 0;
const t = async (name, fn) => { try { await fn(); console.log(`✅ ${name}`); } catch (e) { fail++; console.log(`❌ ${name}\n   ${e?.stack ?? e}`); } };

const SECRETS = [
  "Authorization: Bearer hps_9f8e7d6c5b4a39281706f5e4d3c2b1a0",
  "token=hps_live_abcdef1234567890",
  "github token ghs_ABCDEFGHIJKLMNOPQRSTUVWX123456",
  "anthropic sk-ant-api03-AbCdEfGhIjKlMnOpQrSt",
  "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
  "student token eyJ1IjoiazAxIiwiYyI6ImNvaG9ydCJ9.c2lnbmF0dXJlLXNpZ25hdHVyZS1zaWdu",
  '{"password":"hunter2hunter2"}',
  "mail me at kim.minji@school.example.kr",
  "open /Users/minji/Desktop/숙제.html failed",
  "C:\\Users\\minji\\AppData\\Roaming\\HypeProof Studio\\logs",
  "/home/minji/.config/x",
];
const LEAKS = ["9f8e7d6c5b4a", "hps_live_abcdef", "ghs_ABCDEF", "sk-ant-api03", "eyJhbGciOiJIUzI1NiJ9", "eyJ1IjoiazAx", "hunter2", "kim.minji", "minji"];

await t("redaction: every planted secret, email and user name is removed (negative controls)", () => {
  const out = redactLog(SECRETS.join("\n"), "/Users/minji");
  for (const leak of LEAKS) assert.ok(!out.includes(leak), `${leak} survived:\n${out}`);
  assert.match(out, /\[redacted/);
  assert.match(out, /\[email\]/);
  assert.match(out, /\/Users\/<user>|~/);
});

await t("redaction: ordinary log lines stay readable (positive control)", () => {
  const lines = [
    "2026-11-02 10:01:02.123 [error] Minified React error #185; visit https://react.dev/errors/185 for the full message",
    "[hypeproof-chat] webview error: Maximum update depth exceeded",
    "    at ChatPanel (webview-ui/src/ChatPanel.tsx:2126:11)",
    "[info] Extension host started with pid 4242, version 0.1.60",
  ];
  assert.equal(redactLog(lines.join("\n"), "/Users/minji"), lines.join("\n"));
});

await t("redaction: a Windows home folder given as home becomes ~", () => {
  assert.equal(redactLog("read C:\\Users\\Minji Kim\\Desktop\\a.txt", "C:\\Users\\Minji Kim"), "read ~\\Desktop\\a.txt");
});

await t("tail: a short log is kept whole; a long one keeps the last bytes from a line start, with a note", () => {
  assert.equal(logTail("a\nb\n"), "a\nb\n");
  const long = Array.from({ length: 20000 }, (_, i) => `line ${i} ${"x".repeat(10)}`).join("\n");
  const tail = logTail(long, 4096);
  assert.ok(new TextEncoder().encode(tail).byteLength <= 4096 + 64);
  assert.match(tail, /^\[앞부분 생략, 마지막 4 KB\]\nline \d+ x{10}/);
  assert.ok(tail.endsWith("line 19999 xxxxxxxxxx"));
  assert.ok(!tail.includes("line 0 "), "the head is not sent");
});

await t("paths: logs are found from the extension's log folder; files are read from the tail only and redacted", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hps-report-logs-"));
  const extDir = path.join(root, "20261102T101010", "window1", "exthost", "hypeproof.hypeproof-chat");
  fs.mkdirSync(extDir, { recursive: true });
  const p = sessionLogPaths(extDir);
  assert.equal(p.renderer, path.join(root, "20261102T101010", "window1", "renderer.log"));
  assert.equal(p.exthost, path.join(root, "20261102T101010", "window1", "exthost", "exthost.log"));
  assert.equal(logsAvailable(extDir), false, "no files yet");
  const head = "OLD Bearer hps_head_secret_value_should_not_be_read\n";
  fs.writeFileSync(p.renderer, head + "filler line\n".repeat(LOG_TAIL_BYTES / 6) + "React error #185 at /Users/minji/x\nBearer hps_tail_secret_abcdefgh1234\n");
  fs.writeFileSync(p.exthost, "[hypeproof-chat] webview error: boom\n");
  assert.equal(logsAvailable(extDir), true);
  const got = await readSessionLogs(extDir);
  assert.ok(!got.renderer_log.includes("hps_head_secret"), "the head beyond the tail is never read");
  assert.ok(!got.renderer_log.includes("hps_tail_secret"), "the tail is redacted");
  assert.ok(!got.renderer_log.includes("minji"));
  assert.match(got.renderer_log, /React error #185/);
  assert.ok(new TextEncoder().encode(got.renderer_log).byteLength <= LOG_TAIL_BYTES + 64);
  assert.equal(got.exthost_log, "[hypeproof-chat] webview error: boom\n");
  assert.equal(await readLogTail(path.join(root, "missing.log")), undefined);
  assert.deepEqual(await readSessionLogs(undefined), {});
  fs.rmSync(root, { recursive: true, force: true });
});

await t("crash records: bounded, redacted, newest kept, malformed stored entries dropped", () => {
  const env = { appVersion: "0.1.70", os: "windows-x64", home: "C:\\Users\\minji" };
  const rec = webviewErrorRecord({ message: "Minified React error #185 token=hps_abcdefgh12345678", componentStack: "\n    at ChatPanel\n    at C:\\Users\\minji\\x".repeat(500) }, env);
  assert.ok(!rec.message.includes("hps_abcdefgh"));
  assert.ok(!rec.componentStack.includes("minji"));
  assert.ok(rec.componentStack.length <= 3000);
  let kept = [];
  for (let i = 0; i < WEBVIEW_ERROR_LIMIT + 3; i++) kept = rememberWebviewError(kept, { ...rec, message: `e${i}` });
  assert.equal(kept.length, WEBVIEW_ERROR_LIMIT);
  assert.equal(kept.at(-1).message, `e${WEBVIEW_ERROR_LIMIT + 2}`);
  assert.deepEqual(validWebviewErrors([{ at: 1 }, "x", null, rec]), [rec]);
  assert.deepEqual(validWebviewErrors("garbage"), []);
});

await t("body: crash records always go; log tails only with the box ticked (negative control: unticked)", () => {
  const rec = webviewErrorRecord({ message: "Minified React error #185", componentStack: "at ChatPanel" }, { appVersion: "0.1.70", os: "windows-x64" });
  const logs = { webview_errors: [rec], renderer_log: "R", exthost_log: "E" };
  const base = { recentTurns: [], metadata: {}, reason: "crash", logs };
  const off = problemReportBody({ description: "", contact: "", includeRecentTurns: false, includeLogs: false }, base);
  assert.deepEqual(off.logs, { webview_errors: [rec] });
  assert.equal(off.description, "(설명 없음) 화면이 멈췄어요");
  const on = problemReportBody({ description: "", contact: "", includeRecentTurns: false, includeLogs: true }, base);
  assert.deepEqual(on.logs, { webview_errors: [rec], renderer_log: "R", exthost_log: "E" });
  const none = problemReportBody({ description: "x", contact: "", includeRecentTurns: false, includeLogs: false }, { ...base, logs: { webview_errors: [] } });
  assert.equal(none.logs, undefined, "nothing to attach, no logs key");
  const names = reportManifestItems(on).map((i) => i.name);
  for (const want of ["최근 화면 오류 기록 1건", "화면 로그 (renderer.log 마지막 부분)", "확장 로그 (exthost.log 마지막 부분)"]) assert.ok(names.includes(want), names.join(" | "));
  assert.ok(!reportManifestItems(off).map((i) => i.name).some((n) => n.includes("renderer.log")));
});

await t("answer: includeLogs is a boolean; an older panel's answer attaches no log file", () => {
  assert.equal(parseProblemAnswer({ description: "", contact: "", includeRecentTurns: false }).includeLogs, false);
  assert.equal(parseProblemAnswer({ description: "", contact: "", includeRecentTurns: false, includeLogs: true }).includeLogs, true);
  assert.equal(parseProblemAnswer({ description: "", contact: "", includeRecentTurns: false, includeLogs: "yes" }), null);
});

if (fail) { console.error(`report-logs: ${fail} failed`); process.exit(1); }
console.log("report-logs.smoke.mjs — all assertions passed");
