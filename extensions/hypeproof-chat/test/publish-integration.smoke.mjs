// One-click publish — the real module with the shipped REST transport (`gh api`), executing a
// fake `gh` that forwards each `gh api` call to the mock GitHub over real HTTP. Nothing is
// injected below the process boundary: real `execFile`, real stdin/stdout, real timers
// (shortened intervals).
//
// This is the layer between the scripted smoke (publish-site.smoke.mjs, fake fetch/clock) and
// the in-app e2e (e2e/one-click-publish/): it proves the pieces that the smoke fakes — the
// `gh api` argument vector, the JSON body on stdin, reading status and headers from
// `--include` output, the gh process contract — work for real.
//
// Run: node --experimental-strip-types test/publish-integration.smoke.mjs

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createMockGitHub } from "./fixtures/mock-github.mjs";

const { runPublishSite } = await import("../src/publish/publishSite.ts");
const { createGhCliAuthProvider } = await import("../src/publish/githubAuth.ts");
const { createGhTransport, parseGhInclude } = await import("../src/publish/githubApi.ts");

// `--include` output as gh 2.89 prints it (captured 2026-10-14): status line, headers, blank
// line, body. CRLF is accepted too.
{
  const r = parseGhInclude('HTTP/2.0 404 Not Found\nX-Oauth-Scopes: repo, workflow\nRetry-After: 7\n\n{"message":"Not Found"}\n');
  assert.equal(r.status, 404);
  assert.equal(r.headers.get("x-oauth-scopes"), "repo, workflow");
  assert.equal(r.headers.get("retry-after"), "7");
  assert.deepEqual(r.json, { message: "Not Found" });
  const empty = parseGhInclude("HTTP/1.1 204 No Content\r\nX-A: 1\r\n\r\n");
  assert.equal(empty.status, 204);
  assert.equal(empty.json, null);
  assert.equal(parseGhInclude("error connecting to api.github.com\n"), null, "no status line → not a response");
  console.log("✓ gh api --include output parses (status, headers, body)");
}

if (process.platform === "win32") {
  console.log("SKIP publish-integration: the fake gh is a POSIX shell script");
  process.exit(0);
}

const gh = createMockGitHub({ pagesReadyAfter: 2, runPollsToComplete: 2, cdnLagPolls: 1 });
const origin = await gh.listen();
const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hps-publish-int-")));
const fakeGh = path.join(dir, "gh");
const ghCalls = path.join(dir, "gh-calls.log");
// A node script standing in for gh: `--version`, `auth token`, and `api`, which it answers by
// forwarding to the mock over HTTP and printing what `gh api --include` prints. It logs each
// argument vector so the test can check what the extension asked gh to do.
fs.writeFileSync(
  fakeGh,
  `#!${process.execPath}
const fs = require("node:fs");
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(ghCalls)}, JSON.stringify(a) + "\\n");
if (a[0] === "--version") { console.log("gh version 2.89.0 (fake)"); process.exit(0); }
if (a[0] === "auth" && a[1] === "token") { console.log(${JSON.stringify(gh.state.token)}); process.exit(0); }
if (a[0] !== "api") { console.error("unexpected: " + a.join(" ")); process.exit(1); }
const opt = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
const headers = { authorization: "Bearer " + ${JSON.stringify(gh.state.token)} };
a.forEach((v, i) => { if (v === "-H") { const [k, ...rest] = a[i + 1].split(":"); headers[k.trim().toLowerCase()] = rest.join(":").trim(); } });
const endpoint = a[a.length - 1];
(async () => {
  const body = opt("--input") === "-" ? fs.readFileSync(0, "utf8") : undefined;
  const res = await fetch(${JSON.stringify(origin + "/api")} + endpoint, { method: opt("--method") || "GET", headers, body });
  let out = "HTTP/2.0 " + res.status + " " + res.statusText + "\\n";
  res.headers.forEach((v, k) => { out += k + ": " + v + "\\n"; });
  process.stdout.write(out + "\\n" + (await res.text()));
  if (res.status >= 400) { console.error("gh: (HTTP " + res.status + ")"); process.exitCode = 1; }
})();
`,
  { mode: 0o755 },
);
const ws = path.join(dir, "ws");
fs.mkdirSync(path.join(ws, "img"), { recursive: true });
fs.writeFileSync(path.join(ws, "index.html"), '<!doctype html><title>가상 치과</title><link rel="stylesheet" href="shared.css"><img src="img/a.png">');
fs.writeFileSync(path.join(ws, "shared.css"), "body{color:#123}");
fs.writeFileSync(path.join(ws, "img/a.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]));

const auth = createGhCliAuthProvider({ execFile, platform: process.platform, ghPath: fakeGh });
const steps = [];
try {
  const r = await runPublishSite({}, {
    previewVisitor: async () => true,
    confirmContent: async () => true,
    fetch,
    sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
    now: () => Date.now(),
    auth,
    transport: () => createGhTransport({ execFile, bin: () => auth.bin() }),
    pagesBase: `${origin}/site`,
    workspaceRoot: ws,
    profileDefaultRepo: "e2e-clinic",
    customDomainAllowed: false,
    nonce: () => "0123456789abcdef0123456789abcdef",
    userAuthWaitMs: 0,
    budgetMs: 60_000,
    timing: { pagesIntervalMs: 20, runIntervalMs: 20, verifyIntervalMs: 20, runAppearMs: 2_000 },
    onStep: (s) => steps.push(`${s.id}:${s.status}`),
  });
  assert.equal(r.ok, true, JSON.stringify(r, null, 2));
  assert.equal(r.verified, true);
  assert.equal(r.url, `${origin}/site/octo-clinic/e2e-clinic/`);
  // Independent check (verification.md rule 5): fetch the site ourselves.
  const live = await fetch(r.url);
  assert.equal(live.status, 200);
  assert.match(await live.text(), /가상 치과/);
  const png = Buffer.from(await (await fetch(`${r.url}img/a.png`)).arrayBuffer());
  assert.deepEqual([...png], [0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255], "binary bytes survive base64 → blob → site");
  assert.ok(steps.indexOf("pages:ok") < steps.indexOf("commit:ok"));
  // Every REST call went through `gh api`, and the token never appeared on an argument vector.
  const calls = fs.readFileSync(ghCalls, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const apiCalls = calls.filter((c) => c[0] === "api");
  assert.ok(apiCalls.length >= 10, `the pipeline's REST calls ran as gh api (${apiCalls.length})`);
  assert.ok(apiCalls.every((c) => c.includes("--include") && c.includes("github.com")), "gh api --hostname github.com --include");
  assert.ok(apiCalls.some((c) => c.includes("--method") && c[c.indexOf("--method") + 1] === "POST" && c.includes("--input")), "writes send their JSON on stdin");
  assert.ok(!calls.some((c) => c.join(" ").includes(gh.state.token)), "the token is never passed to gh");
  console.log(`✓ gh api transport: verified ${r.url} (${apiCalls.length} gh api calls, ${steps.length} step events)`);
} finally {
  gh.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log("\n✓ publish-integration smoke 통과");
