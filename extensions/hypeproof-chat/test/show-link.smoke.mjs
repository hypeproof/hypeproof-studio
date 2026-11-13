// REQ-STUDIO-SHOW-LINK (#3794 slice 2) — "링크로 보여주기".
// 1. Contract with hypeproof-service: the template digest for fixed inputs, the consent item and version, the
//    vendored pins, the routes the account client may call, the link shape it accepts.
// 2. The share step reducer: stale events change nothing; counts are presses only.
// 3. The bundle: exactly six files, the vendored ones still matching their pins; a changed copy or a picture
//    over the Service cap is refused before anything is sent.
// 4. The host (vscode stubbed) against a temp work folder and a recording Service: nothing is sent before the
//    press, the review lists the exact bytes, no consent no upload, the upload carries the bytes that played,
//    copy, 링크 끄기, share.json without the person's words, the flag and sign-in gates, error lines.
// Each positive case has a negative control beside it (verification.md §2).

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { SHOW_COPY, showComposition } from "../src/showWhatIMade.ts";
import {
  SHOW_CONSENT_ITEM, SHOW_CONSENT_VERSION, SHOW_LINK_COPY, SHOW_LINK_MATERIAL_BYTES, SHOW_LINK_VENDORED, SHOW_TEMPLATE_FIXTURE, SHOW_TEMPLATE_FIXTURE_SHA256,
  safeShowLink, shareInitialState, shareReduce, showBundle, showLinkMessage, wireFiles,
} from "../src/showLink.ts";
import { SHOW_LINK_ROUTE } from "../src/accountSession.ts";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const extRoot = path.join(here, "..");
const media = path.join(extRoot, "media", "show");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const pins = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(media, "VENDORED.json"), "utf8")).files.map((f) => [f.path, f.sha256]));
const vendored = Object.fromEntries(SHOW_LINK_VENDORED.map((n) => [n, new Uint8Array(fs.readFileSync(path.join(media, n)))]));

// ---------------------------------------------------------------------------------------------------------------
// 1. Contract
{
  assert.equal(sha(showComposition(SHOW_TEMPLATE_FIXTURE)), SHOW_TEMPLATE_FIXTURE_SHA256,
    "the template Studio writes is the one the Service regenerates (hypeproof-service lib/show-template.ts); change both together");
  assert.notEqual(sha(showComposition({ ...SHOW_TEMPLATE_FIXTURE, headline: SHOW_TEMPLATE_FIXTURE.headline + "!" })), SHOW_TEMPLATE_FIXTURE_SHA256, "the digest sees a change");
  assert.equal(SHOW_CONSENT_ITEM, "내가 만든 것을 영상·링크로 공유");
  assert.equal(SHOW_CONSENT_VERSION, "2026-11-12.5");
  assert.deepEqual(Object.keys(pins).sort(), [...SHOW_LINK_VENDORED].sort(), "every vendored file the bundle sends is pinned");
  for (const ok of ["/me/show-links", "/me/show-links/0123456789abcdef/revoke", "/me/consents/show-share"]) assert.ok(SHOW_LINK_ROUTE.test(ok), ok);
  for (const bad of ["/me", "/me/passes", "/me/show-links/../passes", "/me/show-links/0123/revoke", "/me/show-links/0123456789abcdef", "/me/consents/current", "/me/show-links?x=1"])
    assert.ok(!SHOW_LINK_ROUTE.test(bad), bad);
  const prod = "https://show-0123456789abcdef-try.hypeproof-ai.xyz/0123456789abcdef0123456789abcdef/";
  assert.ok(safeShowLink(prod, true) && safeShowLink(prod, false));
  for (const bad of ["http://show-0123456789abcdef-try.hypeproof-ai.xyz/0123456789abcdef0123456789abcdef/", "https://show-0123456789abcdef-try.evil.example/0123456789abcdef0123456789abcdef/",
    "https://prj-0123456789abcdef-try.hypeproof-ai.xyz/0123456789abcdef0123456789abcdef/", prod + "x", prod.replace(/\/$/, ""), "javascript:alert(1)", 42, null])
    assert.ok(!safeShowLink(bad, true), String(bad));
  const dev = "http://show-0123456789abcdef.test.invalid:8799/0123456789abcdef0123456789abcdef/";
  assert.ok(safeShowLink(dev, false) && !safeShowLink(dev, true), "a local preview link only off production");
  assert.equal(showLinkMessage("show_link_limit"), SHOW_LINK_COPY.linkLimit);
  assert.equal(showLinkMessage("html_not_template"), SHOW_LINK_COPY.changed);
  assert.equal(showLinkMessage("rate_limited"), SHOW_LINK_COPY.daily);
  assert.equal(showLinkMessage("http_401"), SHOW_LINK_COPY.signIn);
  assert.equal(showLinkMessage("anything_else"), SHOW_LINK_COPY.failed);
  console.log("PASS show link contract: template digest, consent item, pins, routes, link shape, error lines");
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Reducer
{
  let s = shareInitialState();
  for (const e of [{ type: "back" }, { type: "copied" }, { type: "revoked" }, { type: "shared", link: { id: "a", url: "u" } }]) assert.equal(shareReduce(s, e), s, `${e.type} before open is ignored`);
  s = shareReduce(s, { type: "open", consentGiven: false });
  assert.deepEqual([s.step, s.consentGiven, s.counts.open], ["review", false, 1]);
  assert.equal(shareReduce(s, { type: "open", consentGiven: true }), s, "open twice is one open");
  assert.equal(shareReduce(s, { type: "back" }).step, "closed");
  s = shareReduce(s, { type: "shared", link: { id: "0123456789abcdef", url: "u" } });
  assert.deepEqual([s.step, s.consentGiven, s.counts.share], ["shared", true, 1]);
  s = shareReduce(shareReduce(s, { type: "copied" }), { type: "copied" });
  s = shareReduce(s, { type: "revoked" });
  assert.deepEqual(s.counts, { open: 1, share: 1, copy: 2, revoke: 1 });
  assert.equal(shareReduce(s, { type: "open", consentGiven: true }).step, "review", "a new link after 링크 끄기");
  console.log("PASS show link reducer: stale events ignored, presses counted");
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Bundle
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
{
  const html = showComposition({ headline: "내 그림", audience: "엄마", materialFile: "material-1.png" });
  const b = showBundle({ html, materialFile: "material-1.png", material: PNG, vendored, pins });
  assert.ok(Array.isArray(b));
  assert.deepEqual(b.map((f) => f.path), ["index.html", "material-1.png", ...SHOW_LINK_VENDORED]);
  const wire = wireFiles(b);
  for (const f of wire) assert.equal(Buffer.from(f.data, "base64").length, f.bytes);
  assert.equal(wire.find((f) => f.path === "anime.umd.min.js").sha256, pins["anime.umd.min.js"]);
  const changed = { ...vendored, "anime.umd.min.js": new Uint8Array([...vendored["anime.umd.min.js"].subarray(0, 10), 32]) };
  assert.deepEqual(showBundle({ html, materialFile: "material-1.png", material: PNG, vendored: changed, pins }), { error: "changed" });
  assert.deepEqual(showBundle({ html, materialFile: "material-1.png", material: new Uint8Array(SHOW_LINK_MATERIAL_BYTES + 1), vendored, pins }), { error: "tooLarge" });
  assert.equal(showBundle({ html, materialFile: "material-1.png", material: new Uint8Array(SHOW_LINK_MATERIAL_BYTES), vendored, pins }).length, 6, "at the cap");
  console.log("PASS show link bundle: six files, pinned vendored bytes, cap");
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Host (vscode stubbed) with a recording Service
{
  // Match canonicalFolder: Windows temp paths can have short-name aliases.
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "hp-show-link-")));
  fs.mkdirSync(path.join(root, "art")); fs.writeFileSync(path.join(root, "art", "drawing.png"), PNG);
  let panel, picks = [];
  const Uri = { file: (p) => ({ scheme: "file", fsPath: p, toString: () => "file://" + p }), joinPath: (u, ...p) => Uri.file(path.join(u.fsPath, ...p)) };
  const vscode = { Uri, ViewColumn: { Active: -1 }, window: {
    showInformationMessage: async () => {},
    showOpenDialog: async () => { const p = picks.shift(); return p ? [Uri.file(p)] : undefined; },
    createWebviewPanel(...args) {
      let received, closed;
      panel = { args, disposed: false, webview: { html: "", cspSource: "https://res.test", asWebviewUri: (u) => ({ toString: () => "https://res.test" + u.fsPath }),
        onDidReceiveMessage(fn) { received = fn; return { dispose() {} }; } },
        onDidDispose(fn) { closed = fn; return { dispose() {} }; }, reveal() {}, dispose() { panel.disposed = true; closed?.(); },
        async send(m) { await received(m); } };
      return panel;
    } } };
  const built = await build({ entryPoints: [path.join(here, "..", "src", "showWhatIMadeHost.ts")], bundle: true, platform: "node", format: "cjs", write: false, external: ["vscode"] });
  const mod = { exports: {} };
  new Function("require", "module", "exports", built.outputFiles[0].text)((id) => (id === "vscode" ? vscode : require(id)), mod, mod.exports);
  const { runShowWhatIMade } = mod.exports;

  // A recording Service. `answers` decides each reply; every call is kept.
  const calls = [];
  const LINK = { id: "0123456789abcdef", url: "https://show-0123456789abcdef-try.hypeproof-ai.xyz/0123456789abcdef0123456789abcdef/" };
  let consentGiven = false, uploadReply = () => ({ already: false, link: LINK });
  const service = async (p, body) => {
    calls.push({ path: p, body });
    if (p === "/me/show-links" && body === undefined) return { consent: { item: SHOW_CONSENT_ITEM, version: SHOW_CONSENT_VERSION, given: consentGiven }, quota: {}, links: [] };
    if (p === "/me/consents/show-share") { consentGiven = body.granted; return { consent: body.granted, version: body.version, revoked: 0 }; }
    if (p === "/me/show-links") return uploadReply(body);
    if (/^\/me\/show-links\/[0-9a-f]{16}\/revoke$/.test(p)) return { already: false, link: { ...LINK, url: null } };
    throw Object.assign(new Error("unexpected"), { code: "unexpected" });
  };
  let shareEnabled = true, signedIn = true;
  const clip = [];
  const ports = { enabled: () => true, root: () => root, refusal: () => null, capturePage: async () => null, now: () => new Date(2026, 10, 12, 21, 5, 0),
    share: { enabled: () => shareEnabled, request: () => (signedIn ? service : undefined), production: true, copy: async (t) => { clip.push(t); } } };
  const ext = Uri.file(extRoot);
  const shown = () => panel.webview.html;
  const nonce = () => /'nonce-([a-f0-9]+)'/.exec(panel.webview.html)[1];
  const send = (m) => panel.send({ nonce: nonce(), ...m });
  const toAccepted = async () => {
    await send({ type: "answer", text: "우리 반 친구들" });
    await send({ type: "answer", text: "내가 만든 투표 앱" });
    picks.push(path.join(root, "art", "drawing.png")); await send({ type: "pick" });
    await send({ type: "accept" });
    assert.ok(shown().includes(SHOW_COPY.acceptedHeading));
  };

  // Flag off: no share button, and a forged share message sends nothing.
  shareEnabled = false;
  let done = runShowWhatIMade(ext, ports);
  await toAccepted();
  assert.ok(!shown().includes(SHOW_LINK_COPY.open), "flag off: no 링크로 보여주기");
  await send({ type: "share" }); await send({ type: "shareCreate", consent: true });
  assert.equal(calls.length, 0, "flag off: nothing sent");
  await send({ type: "close" }); await done;

  shareEnabled = true;
  done = runShowWhatIMade(ext, ports);
  // Before 이대로 할래요 a share message is ignored.
  await send({ type: "share" }); assert.equal(calls.length, 0, "no share before accept");
  await toAccepted();
  const dir = path.join(root, ".hypeproof", "show", fs.readdirSync(path.join(root, ".hypeproof", "show")).sort().at(-1));
  assert.ok(shown().includes(SHOW_LINK_COPY.open) && shown().includes(SHOW_COPY.notShared));
  assert.equal(calls.length, 0, "nothing is sent by reaching the accepted step");
  // Signed out: the line says so; nothing is sent.
  signedIn = false; await send({ type: "share" }); assert.ok(shown().includes(SHOW_LINK_COPY.signIn)); assert.equal(calls.length, 0); signedIn = true;
  // Press 링크로 보여주기: one read of the person's own list, no upload.
  await send({ type: "share" });
  assert.deepEqual(calls.map((c) => [c.path, c.body]), [["/me/show-links", undefined]]);
  const review = shown();
  assert.ok(review.includes(SHOW_LINK_COPY.heading) && review.includes(SHOW_LINK_COPY.consentLabel) && review.includes(SHOW_LINK_COPY.consentDetail));
  for (const f of ["index.html", "material-1.png", ...SHOW_LINK_VENDORED]) assert.ok(review.includes(`<code>${f}</code>`), `review lists ${f}`);
  const indexBytes = fs.readFileSync(path.join(dir, "index.html"));
  assert.ok(review.includes(`<code>index.html</code> · ${SHOW_LINK_COPY.fileScene} · ${SHOW_LINK_COPY.size(indexBytes.length)}`), "the exact size of the scene");
  assert.ok(review.includes(SHOW_LINK_COPY.textHeadline("내가 만든 투표 앱")) && review.includes(SHOW_LINK_COPY.textClosing("우리 반 친구들")), "the words the viewer will read");
  assert.ok(review.includes("<hyperframes-player"), "the scene plays in the review");
  assert.ok(/connect-src 'none'/.test(review), "the panel itself still makes no request");
  // 링크 만들기 without the consent box: refused, nothing sent.
  await send({ type: "shareCreate", consent: false });
  assert.ok(shown().includes(SHOW_LINK_COPY.consentNeeded)); assert.equal(calls.length, 1);
  // A hand-edited scene is not uploaded.
  fs.appendFileSync(path.join(dir, "index.html"), "<script>x()</script>");
  await send({ type: "shareCreate", consent: true });
  assert.ok(shown().includes(SHOW_LINK_COPY.changed)); assert.equal(calls.length, 1, "changed scene: nothing sent");
  fs.writeFileSync(path.join(dir, "index.html"), indexBytes);
  // With consent: the consent first, then the upload of exactly the bytes that played.
  await send({ type: "shareCreate", consent: true });
  assert.deepEqual(calls.map((c) => c.path), ["/me/show-links", "/me/consents/show-share", "/me/show-links"]);
  assert.deepEqual(calls[1].body, { version: SHOW_CONSENT_VERSION, granted: true });
  const up = calls[2].body;
  assert.equal(up.consent_version, SHOW_CONSENT_VERSION); assert.match(up.request_id, /^show_[0-9a-f]{24}$/);
  const sent = Object.fromEntries(up.files.map((f) => [f.path, Buffer.from(f.data, "base64")]));
  assert.deepEqual(Object.keys(sent), ["index.html", "material-1.png", ...SHOW_LINK_VENDORED]);
  assert.ok(sent["index.html"].equals(indexBytes), "the scene on disk, byte for byte");
  assert.ok(sent["material-1.png"].equals(fs.readFileSync(path.join(dir, "material-1.png"))), "the picture copy that played");
  for (const n of SHOW_LINK_VENDORED) assert.equal(sha(sent[n]), pins[n], `${n} pinned`);
  for (const f of up.files) assert.equal(sha(Buffer.from(f.data, "base64")), f.sha256);
  // Shared: the link, copy, 링크 끄기.
  assert.ok(shown().includes(SHOW_LINK_COPY.sharedHeading) && shown().includes(`value="${LINK.url}"`));
  assert.ok(!shown().includes(SHOW_COPY.notShared), "no longer says nothing was sent");
  await send({ type: "shareCopy" }); assert.deepEqual(clip, [LINK.url]); assert.ok(shown().includes(SHOW_LINK_COPY.copied));
  await send({ type: "shareRevoke" });
  assert.equal(calls.at(-1).path, `/me/show-links/${LINK.id}/revoke`);
  assert.ok(shown().includes(SHOW_LINK_COPY.revokedHeading) && shown().includes(SHOW_LINK_COPY.revokedHint));
  const record = JSON.parse(fs.readFileSync(path.join(dir, "share.json"), "utf8"));
  assert.equal(record.schema, "hps-show-share/1");
  assert.deepEqual(record.counts, { open: 1, share: 1, copy: 1, revoke: 1 });
  assert.deepEqual(record.links.map((l) => [l.id, l.url, typeof l.revoked]), [[LINK.id, LINK.url, "string"]]);
  const raw = fs.readFileSync(path.join(dir, "share.json"), "utf8");
  assert.ok(!raw.includes("투표") && !raw.includes("친구들"), "no person text in the record");
  // A new link: consent is remembered, so no second consent call; a bad link from the Service is not shown.
  await send({ type: "share" });
  assert.ok(shown().includes(SHOW_LINK_COPY.consentGiven), "consent already given");
  uploadReply = () => ({ already: false, link: { id: LINK.id, url: "javascript:alert(1)" } });
  const before = calls.length;
  await send({ type: "shareCreate", consent: false });
  assert.deepEqual(calls.slice(before).map((c) => c.path), ["/me/show-links"], "no second consent call");
  assert.ok(shown().includes(SHOW_LINK_COPY.failed) && !shown().includes("javascript:alert"), "a bad link is never shown");
  // A Service refusal reads as its line.
  uploadReply = () => { throw Object.assign(new Error("limit"), { code: "show_link_limit" }); };
  await send({ type: "shareCreate", consent: false }); assert.ok(shown().includes(SHOW_LINK_COPY.linkLimit));
  // A retry of the same press reuses its request id (a resend is the same link).
  const ids = calls.filter((c) => c.path === "/me/show-links" && c.body).map((c) => c.body.request_id);
  assert.equal(ids.at(-1), ids.at(-2), "same press, same request id");
  assert.notEqual(ids[0], ids.at(-1), "a new 링크로 보여주기 gets a new id");
  await send({ type: "shareBack" }); assert.ok(shown().includes(SHOW_COPY.acceptedHeading));
  await send({ type: "close" }); await done;
  fs.rmSync(root, { recursive: true, force: true });
  console.log("PASS show link host: flag and sign-in gates, nothing before the press, exact files listed, consent gate, upload bytes, copy, 링크 끄기, share.json, bad link, error lines, idempotent retry");
}
