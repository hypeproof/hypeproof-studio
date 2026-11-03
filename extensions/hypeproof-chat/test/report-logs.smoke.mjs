// REQ-STUDIO-REPORT-LOGS — crash records and session log tails in a problem report.
// Run: node --experimental-strip-types test/report-logs.smoke.mjs
//
// Design requirements, with positive and negative controls:
//   redaction   tokens, JWTs, key=value secrets, emails and the home user name never survive; ordinary log lines do
//   tail        only the last LOG_TAIL_BYTES of a file are read and sent, starting at a line, with a cut note
//   paths       renderer.log and exthost.log are found from the extension's own log folder (no fixed paths)
//   noise       (#3426) a flood of one line (the i18n warning, or any frequent/consecutive duplicate) is collapsed to
//               one line with its count before the tail is taken, so a real error before the flood survives; masking
//               still applies; the coach output channel rides in exthost_log within the same byte cap
//   ui state    (#3426) a report says where it was sent from and what was on screen, without conversation content
//   body        crash records always go; log tails only when the box is ticked; the confirmation lists each part
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { redactLog, logTail, webviewErrorRecord, rememberWebviewError, validWebviewErrors, LOG_TAIL_BYTES, WEBVIEW_ERROR_LIMIT, LOG_SCAN_BYTES, COACH_LOG_HEADER, COACH_LOG_TAIL_BYTES, FREQUENT_LINE_MIN, collapseLogNoise, LogLineBuffer } = await import("../src/reportLogs.ts");
const { sessionLogPaths, readLogTail, readSessionLogs, logsAvailable } = await import("../src/reportLogsHost.ts");
const { problemReportUiState } = await import("../src/problemReport.ts");
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
  // Unique filler (repeats would be collapsed, #3426) longer than the scan window, so the head is never read.
  let filler = ""; for (let i = 0; filler.length <= LOG_SCAN_BYTES; i++) filler += `filler line ${i}\n`;
  fs.writeFileSync(p.renderer, head + filler + "React error #185 at /Users/minji/x\nBearer hps_tail_secret_abcdefgh1234\n");
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

const I18N = (k) => `2026-11-03 09:12:${String(k % 60).padStart(2, "0")}.123 [warning] Using default string since no string found in i18n bundle that has the key: key.${k}`;

await t("noise: 1,000 i18n warnings plus one real error keep the error in the attached tail, masked (#3426 acceptance)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hps-report-noise-"));
  const extDir = path.join(root, "s", "window1", "exthost", "hypeproof.hypeproof-chat");
  fs.mkdirSync(extDir, { recursive: true });
  const p = sessionLogPaths(extDir);
  const before = Array.from({ length: 400 }, (_, i) => I18N(i));
  const after = Array.from({ length: 600 }, (_, i) => I18N(400 + i));
  const error = "2026-11-03 09:12:40.000 [error] [hypeproof-chat] stream failed for C:\\Users\\minji\\homepage: Bearer hps_live_secret_abcdef123456";
  fs.writeFileSync(p.exthost, ["2026-11-03 09:00:00.000 [info] Extension host started", ...before, error, ...after, ""].join("\n"));
  // Negative control: the pre-#3426 tail (no collapse) loses the error, the way the real report did.
  const raw = fs.readFileSync(p.exthost, "utf8");
  assert.ok(!logTail(raw, LOG_TAIL_BYTES).includes("stream failed"), "control: a plain tail of the flood has no error");
  const got = await readSessionLogs(extDir, undefined, "C:\\Users\\minji");
  assert.match(got.exthost_log, /\[error\] \[hypeproof-chat\] stream failed/);
  assert.match(got.exthost_log, /Extension host started/);
  assert.ok(!got.exthost_log.includes("hps_live_secret"), "masking still applies");
  assert.ok(!got.exthost_log.includes("minji"), "masking still applies to the home folder");
  const i18n = got.exthost_log.split("\n").filter((l) => l.includes("i18n bundle"));
  assert.equal(i18n.length, 1, "the warning is kept once");
  assert.match(i18n[0], /^\[×1000\] 2026-11-03 09:12:39\.123 \[warning\] Using default string/, "with its count, at its last position");
  assert.ok(got.exthost_log.indexOf("stream failed") < got.exthost_log.indexOf("[×1000]"), "order kept: the error came before the last warning");
  // Even with a tail smaller than the flood, the error stays.
  assert.match(await readLogTail(p.exthost, "C:\\Users\\minji", 1024), /stream failed/);
  fs.rmSync(root, { recursive: true, force: true });
});

await t("noise: frequent and consecutive duplicates collapse with a count; stacks and rare lines are untouched", () => {
  const frequent = Array.from({ length: FREQUENT_LINE_MIN }, (_, i) => [`2026-11-03 10:00:${String(i).padStart(2, "0")} [info] heartbeat ok`, `unique ${i}`]).flat();
  const out = collapseLogNoise(frequent.join("\n")).split("\n");
  assert.equal(out.filter((l) => l.includes("heartbeat ok")).length, 1);
  assert.match(out.at(-2), /^\[×20\] .*heartbeat ok$/);
  assert.equal(out.filter((l) => l.startsWith("unique ")).length, FREQUENT_LINE_MIN, "rare lines all stay, in order");
  const consecutive = ["start", "retrying connect", "retrying connect", "retrying connect", "Error: boom", "    at a (x.ts:1)", "    at a (x.ts:1)", "Error: boom", "    at a (x.ts:1)", "", "", "end"].join("\n");
  assert.equal(collapseLogNoise(consecutive), ["start", "[×3] retrying connect", "Error: boom", "[×2]     at a (x.ts:1)", "Error: boom", "    at a (x.ts:1)", "", "", "end"].join("\n"));
  // Positive control: an ordinary log is returned unchanged.
  const plain = "a line one\nb line two\n    at frame\nc line three\n";
  assert.equal(collapseLogNoise(plain), plain);
});

await t("coach channel: its lines ride at the end of exthost_log inside the same byte cap, collapsed and masked", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hps-report-coach-"));
  const extDir = path.join(root, "s", "window1", "exthost", "hypeproof.hypeproof-chat");
  fs.mkdirSync(extDir, { recursive: true });
  const p = sessionLogPaths(extDir);
  let big = ""; for (let i = 0; big.length < 200 * 1024; i++) big += `exthost line ${i}\n`;
  fs.writeFileSync(p.exthost, big);
  const buf = new LogLineBuffer();
  buf.push("[coach] SdkUnavailableError: token=hps_coach_secret_123456 at /Users/minji/x", Date.parse("2026-11-03T00:00:00Z"));
  for (let i = 0; i < 50; i++) buf.push("[heartbeat] skipped");
  assert.equal(logsAvailable(undefined, buf.text()), true, "the coach log alone makes logs available");
  assert.equal(logsAvailable(undefined, ""), false);
  const got = await readSessionLogs(extDir, buf.text(), "/Users/minji");
  assert.ok(new TextEncoder().encode(got.exthost_log).byteLength <= LOG_TAIL_BYTES + 64, "same cap as before");
  const [ext, coach] = got.exthost_log.split(COACH_LOG_HEADER);
  assert.match(ext, /exthost line \d+\n+$/);
  assert.match(coach, /2026-11-03T00:00:00.000Z \[coach\] SdkUnavailableError/);
  assert.ok(!coach.includes("hps_coach_secret") && !coach.includes("minji"), "masked");
  assert.equal(coach.split("\n").filter((l) => l.includes("[heartbeat] skipped")).length, 1, "collapsed");
  assert.ok(new TextEncoder().encode(coach).byteLength <= COACH_LOG_TAIL_BYTES + 64);
  const names = reportManifestItems({ logs: { webview_errors: [], exthost_log: got.exthost_log } }).map((i) => i.name);
  assert.ok(names.includes("확장 로그 (exthost.log·코치 기록 마지막 부분)"), "the confirmation says the coach log is inside");
  // No log folder, only the coach channel: still attached.
  assert.match((await readSessionLogs(undefined, buf.text(), "/Users/minji")).exthost_log, /SdkUnavailableError/);
  // The in-memory buffer is bounded.
  const small = new LogLineBuffer(1024);
  for (let i = 0; i < 500; i++) small.push(`line ${i}`);
  assert.ok(small.text().length <= 1024 && small.text().endsWith("line 499"));
  fs.rmSync(root, { recursive: true, force: true });
});

await t("ui state: a manual report with no description still says where it came from, without conversation content", () => {
  const ui = problemReportUiState({ entry: "start_page", chatSurface: "hidden", activeTab: { kind: "text", fileName: "C:\\Users\\minji\\homepage\\index_full_20261030.html" }, lastProblem: { diagnostic: { code: "network_unreachable", step: "chat" }, at: 1_000 }, now: 61_000 });
  assert.deepEqual(ui, { entry: "start_page", chat_surface: "hidden", active_tab: "text:.html", last_error: { code: "network_unreachable", step: "chat", age_s: 60 } });
  assert.ok(!JSON.stringify(ui).includes("index_full") && !JSON.stringify(ui).includes("minji"), "no file name or path");
  assert.deepEqual(problemReportUiState({ entry: "nonsense", chatSurface: "sidebar", activeTab: { kind: "webview", viewType: "mainThreadWebview-hypeproof.preview" } }), { entry: "unknown", chat_surface: "sidebar", active_tab: "webview:mainThreadWebview-hypeproof.preview" });
  const body = problemReportBody({ description: "", contact: "", includeRecentTurns: false, includeLogs: false }, { recentTurns: [{ role: "user", content: "secret turn" }], metadata: {}, reason: "manual", uiState: ui });
  assert.equal(body.attachments.report_source, "manual");
  assert.deepEqual(body.attachments.ui_state, ui);
  assert.equal(body.description, "(설명 없음) 시작 화면에서 보냄");
  assert.ok(!JSON.stringify(body).includes("secret turn"), "no conversation content unless ticked");
});

if (fail) { console.error(`report-logs: ${fail} failed`); process.exit(1); }
console.log("report-logs.smoke.mjs — all assertions passed");
