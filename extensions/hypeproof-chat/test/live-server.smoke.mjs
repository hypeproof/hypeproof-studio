// Smoke tests for the live-server core (#278 Phase 1). Covers the security
// boundary (path-traversal guard) + the serving behavior that the homepage
// live-preview depends on: index fallback, live-reload injection into HTML,
// content-type mapping, and 404/403. Pure helpers, vscode-free; the #1403 block
// at the end runs the real LiveServer over HTTP with an inline vscode stub. Run:
//   node --experimental-strip-types test/live-server.smoke.mjs

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as http from "node:http";
import { registerHooks } from "node:module";
import * as os from "node:os";
import * as path from "node:path";

const { resolveWithinRoot, injectLiveReload, contentTypeFor, serveStatic, LIVERELOAD_PATH } =
  await import("../src/liveServerHelpers.ts");

// ─── resolveWithinRoot: the traversal guard (security) ──────────────
{
  const root = path.resolve("/tmp/hp-root");
  // Normal paths resolve under root.
  assert.equal(resolveWithinRoot(root, "/index.html"), path.join(root, "index.html"));
  assert.equal(resolveWithinRoot(root, "/css/site.css"), path.join(root, "css/site.css"));
  // Empty / "/" → index.html.
  assert.equal(resolveWithinRoot(root, "/"), path.join(root, "index.html"));
  assert.equal(resolveWithinRoot(root, ""), path.join(root, "index.html"));
  // Query string stripped.
  assert.equal(resolveWithinRoot(root, "/index.html?v=2"), path.join(root, "index.html"));

  // Traversal MUST be rejected.
  assert.equal(resolveWithinRoot(root, "/../secret.txt"), null);
  assert.equal(resolveWithinRoot(root, "/../../etc/passwd"), null);
  assert.equal(resolveWithinRoot(root, "/css/../../secret"), null);
  // Encoded traversal (%2e%2e = "..").
  assert.equal(resolveWithinRoot(root, "/%2e%2e/secret"), null);
  // NUL byte injection.
  assert.equal(resolveWithinRoot(root, "/index.html%00.png"), null);
  // A sibling dir that shares a name prefix must NOT be treated as inside.
  assert.equal(resolveWithinRoot(root, "/../hp-root-evil/x"), null);

  console.log("✓ resolveWithinRoot: normal paths under root, traversal/NUL/encoded rejected");
}

// ─── injectLiveReload ───────────────────────────────────────────────
{
  const withBody = "<html><body><h1>hi</h1></body></html>";
  const out = injectLiveReload(withBody);
  assert.ok(out.includes(LIVERELOAD_PATH), "snippet references the live-reload endpoint");
  assert.ok(out.includes("loc.reload()"), "snippet reloads on message");
  // CGP-ART-R-017: first in the document, so it runs before any page script.
  assert.ok(out.startsWith("<script>"), "injected before any page markup");
  const withDoctype = "<!DOCTYPE html>\n<html><head><script>window.x=1</script></head><body></body></html>";
  const outD = injectLiveReload(withDoctype);
  assert.ok(outD.startsWith("<!DOCTYPE html><script>"), "right after the doctype (standards mode kept)");
  assert.ok(outD.indexOf(LIVERELOAD_PATH) < outD.indexOf("window.x=1"), "before the page's own scripts");

  // A fragment: still present, first.
  const noBody = "<h1>fragment</h1>";
  assert.ok(injectLiveReload(noBody).includes(LIVERELOAD_PATH));
  assert.ok(injectLiveReload(noBody).endsWith("<h1>fragment</h1>"));

  console.log("✓ injectLiveReload: SSE client injected first (after the doctype), before page scripts");
}

// ─── contentTypeFor ─────────────────────────────────────────────────
{
  assert.equal(contentTypeFor("/a/index.html"), "text/html");
  assert.equal(contentTypeFor("styles.CSS"), "text/css"); // case-insensitive
  assert.equal(contentTypeFor("app.js"), "text/javascript");
  assert.equal(contentTypeFor("logo.png"), "image/png");
  assert.equal(contentTypeFor("icon.svg"), "image/svg+xml");
  assert.equal(contentTypeFor("data.json"), "application/json");
  assert.equal(contentTypeFor("weird.xyz"), "application/octet-stream");
  console.log("✓ contentTypeFor: known extensions mapped, unknown → octet-stream");
}

// ─── serveStatic (real files in a temp dir) ─────────────────────────
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hp-live-"));
  try {
    fs.writeFileSync(path.join(dir, "index.html"), "<html><body>home</body></html>");
    fs.writeFileSync(path.join(dir, "styles.css"), "body{color:red}");
    fs.mkdirSync(path.join(dir, "sub"));
    fs.writeFileSync(path.join(dir, "sub", "index.html"), "<html><body>sub</body></html>");

    // "/" serves index.html WITH the live-reload snippet injected.
    const home = serveStatic(dir, "/");
    assert.equal(home.status, 200);
    assert.ok(home.contentType.startsWith("text/html"));
    const homeBody = home.body.toString("utf8");
    assert.ok(homeBody.includes("home"));
    assert.ok(homeBody.includes(LIVERELOAD_PATH), "html served with live-reload injected");

    // CSS served verbatim (no injection), correct content-type.
    const css = serveStatic(dir, "/styles.css");
    assert.equal(css.status, 200);
    assert.ok(css.contentType.startsWith("text/css"));
    assert.equal(css.body.toString("utf8"), "body{color:red}");

    // Directory → index.html fallback.
    const sub = serveStatic(dir, "/sub");
    assert.equal(sub.status, 200);
    assert.ok(sub.body.toString("utf8").includes("sub"));

    // Missing file → 404.
    assert.equal(serveStatic(dir, "/nope.html").status, 404);

    // Traversal → 403 (never reads outside root).
    assert.equal(serveStatic(dir, "/../../etc/passwd").status, 403);

    console.log("✓ serveStatic: index fallback, css verbatim, dir→index, 404 miss, 403 traversal");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ─── #1403: every static response denies devices (real LiveServer over HTTP) ──
// The preview page is a top-level browser tab, so the header is the only page-level
// device policy it gets. Measured on the shipped LiveServer class (vscode stubbed for
// its file watcher), not on the helper alone, so a handler that stops using the
// helper fails here.
{
  // Undeclared-project text of the Service's published runtime (cr-publish, f5d5d74).
  const SERVICE_UNDECLARED = "camera=(), microphone=(), geolocation=(), display-capture=()";
  const DENIED = ["camera", "microphone", "geolocation", "display-capture"];

  /** null when the response denies every device in DENIED; otherwise what is wrong. */
  const devicePolicyProblem = (headers) => {
    const raw = headers["permissions-policy"];
    if (typeof raw !== "string") return "no permissions-policy header";
    const directives = new Map(raw.split(",").map((d) => d.trim().split("=")).map(([k, v]) => [k, v]));
    for (const feature of DENIED) {
      if (directives.get(feature) !== "()") return `${feature} is ${directives.get(feature) ?? "unset (browser default)"}`;
    }
    return null;
  };

  const get = (url) =>
    new Promise((resolve, reject) => {
      const req = http.get(url, { agent: false }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
      });
      req.on("error", reject);
    });

  // Negative control: a server writing the pre-#1403 header set must be caught,
  // and so must a policy that leaves the microphone to the page.
  {
    const legacy = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end("<html><body>legacy</body></html>");
    });
    await new Promise((resolve) => legacy.listen(0, "127.0.0.1", resolve));
    try {
      const r = await get(`http://127.0.0.1:${legacy.address().port}/`);
      assert.equal(r.status, 200);
      assert.equal(devicePolicyProblem(r.headers), "no permissions-policy header", "the check fails when the header is absent");
    } finally {
      await new Promise((resolve) => legacy.close(resolve));
    }
    assert.equal(devicePolicyProblem({ "permissions-policy": "camera=(), microphone=(self), geolocation=(), display-capture=()" }), "microphone is (self)");
    assert.equal(devicePolicyProblem({ "permissions-policy": "microphone=(), geolocation=(), display-capture=()" }), "camera is unset (browser default)");
  }

  const watcherStub =
    "export const workspace={createFileSystemWatcher(){return{onDidChange(){},onDidCreate(){},onDidDelete(){},dispose(){}};}};" +
    "export class RelativePattern{constructor(base,pattern){this.base=base;this.pattern=pattern;}}" +
    "export const Uri={file:(p)=>({fsPath:p})};";
  const stubUrl = `data:text/javascript,${encodeURIComponent(watcherStub)}`;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "vscode") return { url: stubUrl, shortCircuit: true };
      if (specifier.startsWith(".") && !/\.[a-z0-9]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
      return nextResolve(specifier, context);
    },
  });
  const { LiveServer } = await import("../src/liveServer.ts");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hp-live-pp-"));
  const server = new LiveServer();
  try {
    fs.writeFileSync(path.join(dir, "index.html"), "<html><body><script>navigator.mediaDevices</script></body></html>");
    fs.writeFileSync(path.join(dir, "styles.css"), "body{color:red}");
    const base = await server.ensure(dir);

    const page = await get(base);
    assert.equal(page.status, 200);
    assert.ok(page.headers["content-type"].startsWith("text/html"));
    assert.ok(page.body.includes(LIVERELOAD_PATH), "the HTML page is the generated one, live reload injected");
    assert.equal(devicePolicyProblem(page.headers), null, "HTML page denies every device");
    assert.equal(page.headers["permissions-policy"], SERVICE_UNDECLARED, "same text as the published runtime");
    assert.equal(page.headers["cache-control"], "no-store", "existing header kept");

    const css = await get(`${base}styles.css`);
    assert.equal(css.status, 200);
    assert.ok(css.headers["content-type"].startsWith("text/css"));
    assert.equal(devicePolicyProblem(css.headers), null, "asset response denies every device");

    const viewport = await get(`${base}__hp_viewport?path=${encodeURIComponent("/index.html")}`);
    assert.equal(viewport.status, 200);
    assert.equal(devicePolicyProblem(viewport.headers), null, "viewport inspection page denies every device");

    const missing = await get(`${base}nope.html`);
    assert.equal(missing.status, 404);
    assert.equal(devicePolicyProblem(missing.headers), null, "404 response denies every device");

    // The reload stream keeps its own headers (not a document; no policy needed).
    await new Promise((resolve, reject) => {
      const req = http.get(`${base.replace(/\/$/, "")}${LIVERELOAD_PATH}`, { agent: false }, (res) => {
        try {
          assert.equal(res.statusCode, 200);
          assert.equal(res.headers["content-type"], "text/event-stream");
          assert.equal(res.headers["cache-control"], "no-cache");
        } catch (err) {
          req.destroy();
          reject(err);
          return;
        }
        res.once("data", (chunk) => {
          assert.ok(chunk.toString("utf8").startsWith(": connected"));
          req.destroy();
          resolve();
        });
      });
      req.on("error", reject);
    });

    console.log("✓ LiveServer: HTML, asset, viewport and 404 responses send the cr-publish Permissions-Policy; SSE stream unchanged; absent header caught");
  } finally {
    server.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ─── CGP-ART-R-017: only this server's own loopback Host is served (DNS rebinding) ──
// A rebinding page (evil.example resolved to 127.0.0.1) is same-origin to itself: without a Host
// check it could read every file under the served root and the 따라 보기 token, then post the
// learner's choice. Every path refuses a Host other than 127.0.0.1:<port> / localhost:<port>;
// the choice endpoint also refuses a foreign Origin. All checks are collected, then asserted.
{
  const { LiveServer } = await import("../src/liveServer.ts");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hp-live-host-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><html><body><p>내 페이지</p></body></html>");
  fs.writeFileSync(path.join(dir, "secret.txt"), "learner notes");
  const server = new LiveServer();
  const failures = [];
  const expect = (what, ok, detail) => { if (!ok) failures.push(`${what}: ${detail}`); };
  const send = (port, { method = "GET", urlPath = "/", host, origin, body } = {}) => new Promise((resolve, reject) => {
    const headers = { host };
    if (origin !== undefined) headers.origin = origin;
    if (body !== undefined) { headers["content-type"] = "text/plain;charset=UTF-8"; headers["content-length"] = Buffer.byteLength(body); }
    const req = http.request({ host: "127.0.0.1", port, path: urlPath, method, headers, agent: false }, (res) => {
      if (res.headers["content-type"] === "text/event-stream") { const status = res.statusCode; req.destroy(); resolve({ status, body: "" }); return; }
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { text += c; });
      res.on("end", () => resolve({ status: res.statusCode, body: text }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
  try {
    const base = await server.ensure(dir);
    const port = Number(new URL(base).port);
    const own = `127.0.0.1:${port}`;

    // The correct Host passes, in both loopback spellings.
    const home = await send(port, { host: own });
    expect("GET / with Host 127.0.0.1:<port>", home.status === 200, `status ${home.status}`);
    expect("GET / with Host localhost:<port>", (await send(port, { host: `localhost:${port}` })).status === 200, "not 200");
    const token = /"\/__hp_follow","([^"]+)"/.exec(home.body)?.[1];
    assert.ok(token, "the served page carries the follow token");

    // A foreign Host is refused on every path (GET).
    for (const host of ["evil.example", `evil.example:${port}`, `127.0.0.1:${port + 1}`, `localhost:${port + 1}`, `127.0.0.1.nip.io:${port}`]) {
      for (const urlPath of ["/", "/index.html", "/secret.txt", "/__hp_viewport?path=%2Findex.html", "/__hp_livereload"]) {
        const r = await send(port, { host, urlPath });
        expect(`GET ${urlPath} with Host ${host}`, r.status === 403 && !r.body.includes(token) && !r.body.includes("learner notes"), `status ${r.status}`);
      }
    }

    const choice = () => server.followState().on;
    const post = (on, extra = {}) => send(port, { method: "POST", urlPath: "/__hp_follow", host: own, body: JSON.stringify({ on, t: token }), ...extra });
    // A foreign Host is refused on POST, with a valid token; the choice is unchanged.
    let r = await post(false, { host: `evil.example:${port}`, origin: `http://evil.example:${port}` });
    expect("POST with Host evil.example:<port>", r.status === 403 && choice() === true, `status ${r.status}, on=${choice()}`);
    r = await post(false, { host: `evil.example:${port}` });
    expect("POST with Host evil.example:<port>, no Origin", r.status === 403 && choice() === true, `status ${r.status}, on=${choice()}`);
    // A foreign Origin is refused on POST, with a valid token and the right Host.
    for (const origin of ["http://evil.example", `http://127.0.0.1:${port + 1}`, `https://127.0.0.1:${port}`, "null"]) {
      r = await post(false, { origin });
      expect(`POST with Origin ${origin}`, r.status === 403 && choice() === true, `status ${r.status}, on=${choice()}`);
    }
    // The server's own origin passes (both spellings, each with its own Host); no Origin passes (the token still gates it).
    r = await post(false, { origin: `http://${own}` });
    expect("POST with the server's own Origin", r.status === 204 && choice() === false, `status ${r.status}, on=${choice()}`);
    r = await post(true, { host: `localhost:${port}`, origin: `http://localhost:${port}` });
    expect("POST via localhost with its own Origin", r.status === 204 && choice() === true, `status ${r.status}, on=${choice()}`);
    r = await post(false);
    expect("POST without Origin", r.status === 204 && choice() === false, `status ${r.status}, on=${choice()}`);
  } finally {
    server.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.deepEqual(failures, [], `Host/Origin checks failed:\n  - ${failures.join("\n  - ")}`);
  console.log("✓ LiveServer: a foreign Host gets 403 on every path (GET and POST), a foreign Origin gets 403 on POST, the server's own Host and Origin pass");
}

console.log("All live-server smoke tests passed.");
