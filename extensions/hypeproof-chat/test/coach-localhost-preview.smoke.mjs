// #3425 — the coach can open the learner's own localhost server and is told what it serves.
//
// Member report (v2026.1102.2): a server on localhost:9000 served `homepage/`, which had no index.html.
// The coach said "브라우저 도구는 9000번을 열지 못합니다" — browser_open rewrote every loopback port that
// was not Studio's live server to the live server (#507), or started the live server instead — and it
// did not know which file the server served, so it asked the learner to describe the screen.
//
// Measured here, with real HTTP servers on 127.0.0.1 and a real temp folder (no app, no network):
//   1. a loopback port that answers is opened as asked; a port nobody listens on keeps the #507 fix;
//   2. an external disallowed address keeps its previous verdict (denied / asked, never probed);
//   3. the coach-facing line names the served folder and the file at `/` — including a folder with no
//      index.html — for Studio's own server and for another server (directory listing or a page).
// Run: node --experimental-strip-types test/coach-localhost-preview.smoke.mjs

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";

const { runBrowserOpen, runLivePreviewStart, MCP_BROWSER_OPEN } = await import("../src/browserMcp.ts");
const { evaluateSdkToolUse } = await import("../src/sdkCoachHelpers.ts");
const { describeLoopbackServer, studioServerFact, previewServerFactText, parseDirectoryListing } = await import("../src/previewServerFacts.ts");

// ── Fixture: the reported work folder. `homepage/` has no index.html, only a backup and a trimmed copy.
const work = fs.mkdtempSync(path.join(os.tmpdir(), "hps-3425-"));
const home = path.join(work, "homepage");
fs.mkdirSync(home);
const FULL = "<!doctype html><title>full</title>" + "<section>s</section>".repeat(10);
const TRIM = "<!doctype html><title>trim</title><section>hero</section>";
fs.writeFileSync(path.join(home, "index_full_20261030.html"), FULL);
fs.writeFileSync(path.join(home, "home.html"), TRIM);
fs.writeFileSync(path.join(home, "style.css"), "body{}");
fs.writeFileSync(path.join(work, "notes.txt"), "x");

// A Python-http.server-like server rooted at `homepage/` (directory listing at `/`).
function listingHtml(dir) {
  const items = fs.readdirSync(dir).map((n) => `<li><a href="${encodeURIComponent(n)}">${n}</a></li>`).join("");
  return `<!DOCTYPE HTML><html><head><title>Directory listing for /</title></head><body><h1>Directory listing for /</h1><ul>${items}</ul></body></html>`;
}
async function serve(handler) {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, port: server.address().port };
}
const listing = await serve((req, res) => {
  if (req.url === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(req.method === "HEAD" ? "" : listingHtml(home)); return; }
  const f = path.join(home, decodeURIComponent(req.url.slice(1)));
  if (fs.existsSync(f)) { res.writeHead(200, { "content-type": "text/html" }); res.end(req.method === "HEAD" ? "" : fs.readFileSync(f)); return; }
  res.writeHead(404); res.end();
});
// A server whose `/` is the trimmed page itself (e.g. `npx serve` with a rewrite to home.html).
const page = await serve((req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(req.method === "HEAD" ? "" : TRIM); });
// A port nobody listens on: bind and close, so the OS just released it.
const dead = await serve(() => {});
await new Promise((r) => dead.server.close(r));

const realFetchHead = async (url) => {
  try {
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(2000) });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
};
const fetchRoot = async (origin) => {
  try {
    const res = await fetch(`${origin}/`, { signal: AbortSignal.timeout(2000) });
    return { status: res.status, contentType: res.headers.get("content-type") ?? "", body: await res.text() };
  } catch {
    return null;
  }
};
const LIVE = "http://127.0.0.1:58085/";

function host({ live = LIVE, liveRoot = work } = {}) {
  const calls = { opened: [], previews: 0, heads: [] };
  return {
    calls,
    host: {
      openBrowser: async (url) => { calls.opened.push(url); },
      screenshot: async () => null,
      startLivePreview: async () => { calls.previews += 1; return LIVE; },
      livePreviewUrl: async () => live,
      // The live server at LIVE is not a real socket here: it answers as Studio's server would.
      fetchHead: async (url) => { calls.heads.push(url); return url.startsWith(LIVE) ? { ok: true, status: 200 } : realFetchHead(url); },
      previewServerFacts: (url) => describeLoopbackServer(url, { liveUrl: live, liveRoot, workRoot: work, fetchRoot }),
    },
  };
}

try {
  // ── 1. The learner's own server on another port opens as asked, and the result names what it serves.
  {
    const { host: h, calls } = host();
    const url = `http://localhost:${listing.port}/`;
    const res = await runBrowserOpen(h, url);
    assert.equal(res.isError, undefined, JSON.stringify(res));
    assert.deepEqual(calls.opened, [url], "an answering loopback port is not rewritten to the live server");
    assert.equal(calls.previews, 0, "no live server is started in its place");
    const said = res.content.map((b) => b.text ?? "").join("\n");
    assert.match(said, new RegExp(`포트 ${listing.port}`));
    assert.match(said, /서빙 폴더: 작업 폴더\/homepage/, said);
    assert.match(said, /index\.html 이 없어요/, said);
    assert.match(said, /homepage\/index_full_20261030\.html/, "the served folder's HTML files are named");
  }
  // Same with no live server running: the answering port is opened, the live server is not started.
  {
    const { host: h, calls } = host({ live: null, liveRoot: null });
    const url = `http://127.0.0.1:${page.port}/`;
    const res = await runBrowserOpen(h, url);
    assert.deepEqual(calls.opened, [url]);
    assert.equal(calls.previews, 0);
    assert.match(res.content.map((b) => b.text ?? "").join("\n"), /\/ 에서 보이는 파일: homepage\/home\.html/, "a page at / is matched to the one file with its bytes");
  }

  // ── Negative control: a port nobody listens on keeps #507 (rewritten to the live server / live server started).
  {
    const { host: h, calls } = host();
    const res = await runBrowserOpen(h, `http://127.0.0.1:${dead.port}/`);
    assert.deepEqual(calls.opened, [LIVE], "a guessed dead port still goes to the real live server");
    assert.match(res.content.map((b) => b.text ?? "").join(" "), new RegExp(String(dead.port)));
  }
  {
    const { host: h, calls } = host({ live: null, liveRoot: null });
    await runBrowserOpen(h, `http://127.0.0.1:${dead.port}/`);
    assert.equal(calls.previews, 1, "with no live server, a dead guessed port starts it as before");
    assert.deepEqual(calls.opened, []);
  }

  // ── 2. An external disallowed address keeps its previous behaviour, and is never probed.
  {
    const evaluate = (url) => evaluateSdkToolUse({ toolName: MCP_BROWSER_OPEN, input: { url }, permittedTools: [MCP_BROWSER_OPEN], workspaceRoot: work }).decision;
    assert.equal(evaluate(`http://localhost:${listing.port}/`), "allow", "the learner's own machine stays auto-allowed");
    assert.equal(evaluate("https://example.com/"), "ask", "an external site still asks first");
    for (const bad of ["javascript:alert(1)", "vscode://settings", "data:text/html,hi"]) {
      assert.equal(evaluate(bad), "deny", bad);
      const { host: h, calls } = host();
      assert.equal((await runBrowserOpen(h, bad)).isError, true, bad);
      assert.deepEqual(calls.opened, [], bad);
    }
    // Look-alike hosts are external, not loopback: no probe, no served-folder line, opened as before.
    for (const ext of ["https://localhost.evil.com/", "http://127.0.0.1.nip.io:9000/"]) {
      const { host: h, calls } = host();
      const res = await runBrowserOpen(h, ext);
      assert.deepEqual(calls.opened, [ext], ext);
      assert.deepEqual(calls.heads, [], `${ext} is not probed`);
      assert.doesNotMatch(res.content.map((b) => b.text ?? "").join(" "), /미리보기 서버/, ext);
    }
    // CR-11: with the curriculum switch on, an out-of-scope loopback server is still refused.
    const { host: h, calls } = host();
    h.crEnabled = () => true;
    h.crScope = (u) => (u.startsWith(LIVE) ? { ok: true } : { ok: false, reason: "범위 밖" });
    const refused = await runBrowserOpen(h, `http://127.0.0.1:${listing.port}/`);
    assert.equal(refused.isError, true);
    assert.deepEqual(calls.opened, []);
  }

  // ── 3. Studio's own preview server: root known; a folder without index.html names its files.
  {
    const fact = studioServerFact("http://127.0.0.1:58085/homepage/", work, work);
    assert.equal(fact.folder, "homepage");
    assert.equal(fact.entry, null, "no index.html → nothing at /homepage/");
    assert.deepEqual(fact.htmlFiles, ["homepage/home.html", "homepage/index_full_20261030.html"]);
    const text = previewServerFactText(fact);
    assert.match(text, /Studio 미리보기 서버/);
    assert.match(text, /http:\/\/127\.0\.0\.1:58085\/home\.html/, "tells the coach how to open a file by name");
    fs.writeFileSync(path.join(work, "index.html"), "<p>root</p>");
    const root = studioServerFact(LIVE, work, work);
    assert.equal(root.entry, "index.html");
    assert.match(previewServerFactText(root), /\/ 에서 보이는 파일: index\.html/);
    // runLivePreviewStart carries the same line.
    const { host: h } = host();
    const started = await runLivePreviewStart(h);
    assert.match(started.content[0].text, /\[미리보기 서버\] 127\.0\.0\.1:58085/);
  }

  // A listing that matches no folder (or a page matching no file) says "unknown", never a guess.
  {
    const other = await serve((req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end("<p>elsewhere</p>"); });
    const line = await describeLoopbackServer(`http://127.0.0.1:${other.port}/`, { workRoot: work, fetchRoot });
    assert.match(line, /서빙 폴더: 확인 불가/);
    other.server.close();
    assert.equal(await describeLoopbackServer(`http://127.0.0.1:${dead.port}/`, { workRoot: work, fetchRoot }), null, "nothing answers → no line");
    assert.equal(await describeLoopbackServer("https://example.com/", { workRoot: work, fetchRoot }), null, "never for an external host");
    assert.equal(parseDirectoryListing("<title>Home</title><a href='a.html'>a</a>"), null, "an ordinary page is not a listing");
  }
} finally {
  listing.server.close();
  page.server.close();
  fs.rmSync(work, { recursive: true, force: true });
}

console.log("✓ #3425: coach opens the learner's own localhost server and is told the served folder and entry file");
