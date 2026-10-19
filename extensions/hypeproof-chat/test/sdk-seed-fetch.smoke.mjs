// studio-sdk-seed-on-demand (REQ-M46). Locks the in-app fetch of the public
// native SDK seed:
//   1. pure judges — manifest, tarball digests, extracted binary, offer gate,
//      each with positive and negative controls;
//   2. TarEntryReader — finds the binary in ustar / prefix / pax layouts and
//      across 1-byte chunks, and reports a tarball without it;
//   3. fetchSdkSeed against a LOCAL fixture server (no network): a good seed
//      lands at the seeded path with a marker isSeededBinaryTrusted accepts;
//      a sha256 mismatch, a pinned-sha512 mismatch, an oversize body, a
//      tarball without the binary and a missing manifest are all refused and
//      leave neither binary nor marker behind.
// Run: node --experimental-strip-types test/sdk-seed-fetch.smoke.mjs

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

const H = await import("../src/sdkSeedHelpers.ts");
const { fetchSdkSeed } = await import("../src/sdkSeedFetch.ts");
const { isSeededBinaryTrusted, sdkBinaryMarkerPath, parseSdkBinaryMarker } = await import("../src/sdkCoachHelpers.ts");
const { SDK_BINARY_MANIFEST, SDK_BINARY_VERSION } = await import("../src/sdkBinaryManifest.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`  ok ${name}`);
}

// ── tar fixture writer (ustar, optional prefix / pax path) ──────────────────
function header(name, size, type = "0", prefix = "") {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, "utf8");
  h.write("0000755\0", 100);
  h.write("0000000\0", 108);
  h.write("0000000\0", 116);
  h.write(size.toString(8).padStart(11, "0") + "\0", 124);
  h.write("00000000000\0", 136);
  h.write("        ", 148);
  h.write(type, 156);
  h.write("ustar\0", 257);
  h.write("00", 263);
  if (prefix) h.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return h;
}
function pad(buf) {
  const rem = buf.length % 512;
  return rem ? Buffer.concat([buf, Buffer.alloc(512 - rem)]) : buf;
}
function tar(entries) {
  const parts = [];
  for (const e of entries) {
    if (e.pax) {
      const rec = (k, v) => {
        const body = ` ${k}=${v}\n`;
        let len = body.length + 1;
        while (String(len).length + body.length !== len) len = String(len).length + body.length;
        return `${len}${body}`;
      };
      const paxBody = Buffer.from(rec("path", e.pax));
      parts.push(header("PaxHeader/x", paxBody.length, "x"), pad(paxBody));
    }
    parts.push(header(e.name, e.data.length, e.type ?? "0", e.prefix ?? ""), pad(e.data));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

const BIN = Buffer.alloc(70_000, 7); // fixture "binary" (crosses many 512-byte blocks)
const PKG = Buffer.from('{"name":"fixture"}');
const PLATFORM = H.sdkSeedPlatformKey(process.platform, process.arch) ?? "darwin-arm64";
const ENTRY = H.sdkSeedTarEntry(PLATFORM);

function readEntry(tarBytes, target, chunk = 4096) {
  const out = [];
  const r = new H.TarEntryReader(target, (c) => out.push(Buffer.from(c)));
  for (let i = 0; i < tarBytes.length; i += chunk) r.write(tarBytes.subarray(i, i + chunk));
  return { found: r.found, error: r.error, data: Buffer.concat(out), size: r.size };
}

console.log("sdk-seed-fetch");

await test("platform key: pinned platforms only", () => {
  assert.equal(H.sdkSeedPlatformKey("darwin", "arm64"), "darwin-arm64");
  assert.equal(H.sdkSeedPlatformKey("win32", "x64"), "win32-x64");
  assert.equal(H.sdkSeedPlatformKey("freebsd", "x64"), null);
  assert.equal(H.sdkSeedTarEntry("win32-x64"), "package/claude.exe");
  assert.equal(H.sdkSeedTarEntry("darwin-arm64"), "package/claude");
});

await test("urls: release of the App's own tag; no tag for a non-version", () => {
  const u = H.sdkSeedUrls({ appVersion: "2026.1017.0", platformKey: "darwin-arm64" });
  assert.equal(u.manifestUrl, "https://github.com/hypeproof/hypeproof-studio/releases/download/v2026.1017.0/sdk-seed.json");
  assert.equal(
    u.tarballUrl,
    `https://github.com/hypeproof/hypeproof-studio/releases/download/v2026.1017.0/claude-agent-sdk-darwin-arm64-${SDK_BINARY_VERSION}.tgz`,
  );
  assert.equal(H.sdkSeedUrls({ appVersion: "unknown", platformKey: "darwin-arm64" }), null);
  assert.equal(H.sdkSeedUrls({ appVersion: "", platformKey: "darwin-arm64" }), null);
});

const pinned = SDK_BINARY_MANIFEST["darwin-arm64"].sha512;
const goodManifest = () => ({
  schema: "hps-sdk-seed/1",
  sdkVersion: SDK_BINARY_VERSION,
  seeds: [{ platform: "darwin-arm64", name: `claude-agent-sdk-darwin-arm64-${SDK_BINARY_VERSION}.tgz`, size: 1000, sha256: "a".repeat(64), npmIntegrity: pinned }],
});

await test("manifest judge: positive control passes", () => {
  const v = H.judgeSdkSeedManifest(goodManifest(), { platformKey: "darwin-arm64" });
  assert.equal(v.ok, true, v.reason);
  assert.equal(v.value.size, 1000);
});

await test("manifest judge: negative controls each refuse", () => {
  const cases = [
    [(m) => { m.schema = "other/1"; }, /schema/],
    [(m) => { m.sdkVersion = "0.0.1"; }, /this App needs/],
    [(m) => { m.seeds = []; }, /no darwin-arm64 seed/],
    [(m) => { m.seeds[0].name = "evil.tgz"; }, /seed name/],
    [(m) => { m.seeds[0].sha256 = "xyz"; }, /sha256/],
    [(m) => { m.seeds[0].size = -1; }, /size/],
    [(m) => { m.seeds[0].size = 10 * 1024 ** 3; }, /size/],
    [(m) => { m.seeds[0].npmIntegrity = "sha512-AAAA"; }, /pinned/],
  ];
  for (const [mutate, re] of cases) {
    const m = goodManifest();
    mutate(m);
    const v = H.judgeSdkSeedManifest(m, { platformKey: "darwin-arm64" });
    assert.equal(v.ok, false);
    assert.match(v.reason, re);
  }
  assert.equal(H.judgeSdkSeedManifest(null, { platformKey: "darwin-arm64" }).ok, false);
  assert.equal(H.judgeSdkSeedManifest(goodManifest(), { platformKey: "plan9-x" }).ok, false);
});

await test("tarball judge: good passes; size, sha256 and pinned sha512 mismatches refuse", () => {
  const bytes = Buffer.from("seed");
  const sha256Hex = createHash("sha256").update(bytes).digest("hex");
  const sha512Base64 = createHash("sha512").update(bytes).digest("base64");
  const entry = { platform: "darwin-arm64", name: "x", size: 4, sha256: sha256Hex, npmIntegrity: `sha512-${sha512Base64}` };
  assert.equal(H.judgeSdkSeedTarball({ size: 4, sha256Hex, sha512Base64 }, entry).ok, true);
  assert.match(H.judgeSdkSeedTarball({ size: 5, sha256Hex, sha512Base64 }, entry).reason, /bytes/);
  assert.match(H.judgeSdkSeedTarball({ size: 4, sha256Hex: "b".repeat(64), sha512Base64 }, entry).reason, /sha256/);
  assert.match(H.judgeSdkSeedTarball({ size: 4, sha256Hex, sha512Base64 }, entry, pinned).reason, /sha512/);
});

await test("binary judge: floor", () => {
  assert.equal(H.judgeSdkSeedBinary(200 * 1024 * 1024).ok, true);
  assert.equal(H.judgeSdkSeedBinary(10).ok, false);
  assert.equal(H.judgeSdkSeedBinary(0).ok, false);
  assert.equal(H.judgeSdkSeedBinary(10, 5).ok, true);
});

await test("marker: same shape the runtime trusts", () => {
  const raw = H.sdkSeedMarkerJson({ size: 123, tarballSha512: pinned, verifiedAt: "2026-10-19T00:00:00.000Z" });
  const m = parseSdkBinaryMarker(raw);
  assert.equal(m.sdkVersion, SDK_BINARY_VERSION);
  assert.equal(m.size, 123);
  assert.equal(JSON.parse(raw).seededBy, "studio-sdk-seed-on-demand");
});

await test("offer gate: default off; on only with no binary on a pinned platform", () => {
  assert.equal(H.sdkSeedOnDemandEnabled({ setting: undefined, profile: {} }), false);
  assert.equal(H.sdkSeedOnDemandEnabled({ setting: false, profile: { sdk_seed_on_demand: "true" } }), false);
  assert.equal(H.sdkSeedOnDemandEnabled({ setting: true, profile: null }), true);
  assert.equal(H.sdkSeedOnDemandEnabled({ setting: false, profile: { sdk_seed_on_demand: true } }), true);
  const none = { available: false, reasons: ["x"] };
  const base = { enabled: true, resolution: none, platformKey: "darwin-arm64", urls: {}, declined: false, inFlight: false };
  assert.equal(H.sdkSeedOfferDecision(base), "offer");
  assert.equal(H.sdkSeedOfferDecision({ ...base, enabled: false }), "disabled");
  assert.equal(H.sdkSeedOfferDecision({ ...base, resolution: { available: true, source: "seeded", path: "/p" } }), "binary-available");
  assert.equal(H.sdkSeedOfferDecision({ ...base, platformKey: null }), "unsupported-platform");
  assert.equal(H.sdkSeedOfferDecision({ ...base, urls: null }), "no-release");
  assert.equal(H.sdkSeedOfferDecision({ ...base, declined: true }), "declined");
  assert.equal(H.sdkSeedOfferDecision({ ...base, inFlight: true }), "in-flight");
});

await test("tar reader: ustar, prefix, pax path, 1-byte chunks; absent entry reported", () => {
  const plain = tar([{ name: "package/package.json", data: PKG }, { name: ENTRY, data: BIN }]);
  const a = readEntry(plain, ENTRY);
  assert.equal(a.found, true);
  assert.ok(a.data.equals(BIN));
  const small = Buffer.from("tiny-binary");
  const b = readEntry(tar([{ name: "claude", prefix: "package", data: small }]), "package/claude", 1);
  assert.ok(b.data.equals(small));
  const c = readEntry(tar([{ name: "short", pax: ENTRY, data: BIN }]), ENTRY, 777);
  assert.ok(c.data.equals(BIN));
  const d = readEntry(tar([{ name: "package/package.json", data: PKG }]), ENTRY);
  assert.equal(d.found, false);
  assert.equal(d.data.length, 0);
  // A directory or symlink with the target name is never written out.
  const e = readEntry(tar([{ name: ENTRY, type: "2", data: Buffer.alloc(0) }]), ENTRY);
  assert.equal(e.found, false);
});

// ── fixture server ───────────────────────────────────────────────────────────
const APP_VERSION = "2026.1019.0";
const ASSET = H.sdkSeedAssetName(PLATFORM, SDK_BINARY_VERSION);
function seedFixture(entries) {
  const tgz = gzipSync(tar(entries));
  return {
    tgz,
    sha256: createHash("sha256").update(tgz).digest("hex"),
    sri: `sha512-${createHash("sha512").update(tgz).digest("base64")}`,
  };
}
const routes = new Map();
const hits = [];
const server = http.createServer((req, res) => {
  hits.push(req.url);
  const body = routes.get(req.url);
  if (body === undefined) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": "application/octet-stream" }).end(body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const baseUrl = `http://127.0.0.1:${server.address().port}/dl`;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "hps-seed-fetch-"));

function publish(fixture, manifestPatch = (m) => m) {
  routes.clear();
  const manifest = manifestPatch({
    schema: "hps-sdk-seed/1",
    sdkVersion: SDK_BINARY_VERSION,
    seeds: [{ platform: PLATFORM, name: ASSET, size: fixture.tgz.length, sha256: fixture.sha256, npmIntegrity: fixture.sri }],
  });
  routes.set(`/dl/v${APP_VERSION}/sdk-seed.json`, JSON.stringify(manifest));
  routes.set(`/dl/v${APP_VERSION}/${ASSET}`, fixture.tgz);
}
function destFor(name) {
  return path.join(scratch, name, "sdk", SDK_BINARY_VERSION, PLATFORM.startsWith("win32") ? "claude.exe" : "claude");
}
function assertNothingInstalled(dest) {
  assert.equal(fs.existsSync(dest), false, "no binary after a refusal");
  assert.equal(fs.existsSync(sdkBinaryMarkerPath(dest)), false, "no marker after a refusal");
  const dir = path.dirname(dest);
  if (fs.existsSync(dir)) assert.deepEqual(fs.readdirSync(dir), [], "no temp files left");
}
const run = (fixture, dest, extra = {}) =>
  fetchSdkSeed({
    appVersion: APP_VERSION,
    platformKey: PLATFORM,
    destBinary: dest,
    baseUrl,
    pinnedSha512: fixture.sri,
    minBinaryBytes: 1000,
    timeoutMs: 10_000,
    now: () => new Date("2026-10-19T00:00:00.000Z"),
    ...extra,
  });

try {
  await test("fetch: good seed installs binary + marker the runtime trusts", async () => {
    const fx = seedFixture([{ name: "package/package.json", data: PKG }, { name: ENTRY, data: BIN }]);
    publish(fx);
    const dest = destFor("good");
    const progress = [];
    const r = await run(fx, dest, { onProgress: (n, t) => progress.push([n, t]) });
    assert.equal(r.ok, true, r.reason);
    assert.ok(fs.readFileSync(dest).equals(BIN));
    if (process.platform !== "win32") assert.equal(fs.statSync(dest).mode & 0o777, 0o755);
    const markerRaw = fs.readFileSync(sdkBinaryMarkerPath(dest), "utf8");
    assert.equal(JSON.parse(markerRaw).tarballSha512, fx.sri);
    const st = fs.statSync(dest);
    const verdict = isSeededBinaryTrusted({ stat: { exists: true, executable: true, size: st.size }, markerRaw, minBytes: 1000 });
    assert.equal(verdict.ok, true, verdict.reason);
    assert.deepEqual(fs.readdirSync(path.dirname(dest)).sort(), [path.basename(dest), `${path.basename(dest)}.verified.json`].sort());
    assert.equal(progress.at(-1)[0], fx.tgz.length);
  });

  await test("fetch: sha256 mismatch refuses", async () => {
    const fx = seedFixture([{ name: ENTRY, data: BIN }]);
    publish(fx, (m) => { m.seeds[0].sha256 = "0".repeat(64); return m; });
    const dest = destFor("bad-sha256");
    const r = await run(fx, dest);
    assert.equal(r.ok, false);
    assert.equal(r.stage, "verify");
    assert.match(r.reason, /sha256/);
    assertNothingInstalled(dest);
  });

  await test("fetch: bytes that disagree with the pinned sha512 refuse (tampered release)", async () => {
    const fx = seedFixture([{ name: ENTRY, data: BIN }]);
    const tampered = seedFixture([{ name: ENTRY, data: Buffer.alloc(70_000, 9) }]);
    // The release is internally consistent (sha256 + integrity of the tampered
    // bytes), but the App pins the original.
    publish(tampered);
    const dest = destFor("bad-pin");
    const r = await run(fx, dest);
    assert.equal(r.ok, false);
    assert.match(r.reason, /pinned/);
    assertNothingInstalled(dest);
  });

  await test("fetch: bytes that match the release sha256 but not the pinned sha512 refuse", async () => {
    const fx = seedFixture([{ name: ENTRY, data: BIN }]);
    const tampered = seedFixture([{ name: ENTRY, data: Buffer.alloc(70_000, 9) }]);
    // The manifest copies the pinned integrity but lists the tampered bytes.
    publish(tampered, (m) => { m.seeds[0].npmIntegrity = fx.sri; return m; });
    const dest = destFor("bad-bytes");
    const r = await run(fx, dest);
    assert.equal(r.ok, false);
    assert.equal(r.stage, "verify");
    assert.match(r.reason, /sha512 of the download/);
    assertNothingInstalled(dest);
  });

  await test("fetch: a body larger than listed is cut off", async () => {
    const fx = seedFixture([{ name: ENTRY, data: BIN }]);
    publish(fx, (m) => { m.seeds[0].size = 100; return m; });
    const dest = destFor("oversize");
    const r = await run(fx, dest);
    assert.equal(r.ok, false);
    assert.equal(r.stage, "download");
    assertNothingInstalled(dest);
  });

  await test("fetch: tarball without the binary refuses", async () => {
    const fx = seedFixture([{ name: "package/package.json", data: PKG }]);
    publish(fx);
    const dest = destFor("no-entry");
    const r = await run(fx, dest);
    assert.equal(r.ok, false);
    assert.match(r.reason, /did not contain/);
    assertNothingInstalled(dest);
  });

  await test("fetch: binary below the floor refuses", async () => {
    const fx = seedFixture([{ name: ENTRY, data: Buffer.from("x") }]);
    publish(fx);
    const dest = destFor("tiny");
    const r = await run(fx, dest);
    assert.equal(r.ok, false);
    assert.match(r.reason, /floor/);
    assertNothingInstalled(dest);
  });

  await test("fetch: a release without sdk-seed.json is a manifest failure", async () => {
    routes.clear();
    const dest = destFor("no-release");
    const r = await run({ sri: pinned }, dest);
    assert.equal(r.ok, false);
    assert.equal(r.stage, "manifest");
    assert.match(r.reason, /404/);
    assertNothingInstalled(dest);
  });

  await test("fetch: a refusal leaves an existing verified seed untouched", async () => {
    const dest = destFor("good");
    const before = fs.readFileSync(sdkBinaryMarkerPath(dest), "utf8");
    publish(seedFixture([{ name: ENTRY, data: BIN }]), (m) => { m.sdkVersion = "0.0.1"; return m; });
    const r = await run({ sri: pinned }, dest);
    assert.equal(r.ok, false);
    // A refusal before install never touches the existing, verified seed.
    assert.equal(fs.readFileSync(sdkBinaryMarkerPath(dest), "utf8"), before);
  });

  assert.ok(hits.every((u) => u.startsWith("/dl/")), "only the fixture server was contacted");
} finally {
  server.close();
  fs.rmSync(scratch, { recursive: true, force: true });
}

console.log(`sdk-seed-fetch: ${passed} passed`);
