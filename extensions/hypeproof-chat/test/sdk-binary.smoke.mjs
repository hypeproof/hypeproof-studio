// Smoke tests for the SDK native-binary resolution + integrity gate
// (#282 W4a, docs/sdk-bundling.md §5, REQ-M24). Pure — no vscode, no fs
// probes (all injected). Locks:
//   1. seededSdkBinaryPath — the ONE definition of the seeded location per
//      platform (the seed script must write exactly here);
//   2. resolveSdkBinary — resolution order: setting > HPS_SDK_BINARY env >
//      seeded (integrity-gated) > node_modules > unavailable;
//   3. isSeededBinaryTrusted — marker/size gate (seed-time sha512 is trusted
//      via the marker; runtime checks existence + executability + exact size
//      + coarse floor);
//   4. buildSdkQueryOptions — pathToClaudeCodeExecutable passed when resolved,
//      OMITTED otherwise (dev keeps node_modules resolution);
//   5. minor-safety unaffected — binary presence never widens tool policy;
//   6. pinned-manifest consistency — package.json (exact pin) ===
//      package-lock.json === sdkBinaryManifest.ts === scripts/seed-sdk-binary.sh
//      === scripts/seed-sdk-binary.ps1 (version + sha512 per platform), each
//      judge with positive and negative controls.
// Run: node --experimental-strip-types test/sdk-binary.smoke.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

const {
  buildSdkQueryOptions,
  isSeededBinaryTrusted,
  parseSdkBinaryMarker,
  profileToAgentOptions,
  resolveSdkBinary,
  sdkBinaryMarkerPath,
  seededSdkBinaryPath,
} = await import("../src/sdkCoachHelpers.ts");
const { SDK_BINARY_MANIFEST, SDK_BINARY_MIN_BYTES, SDK_BINARY_VERSION } = await import(
  "../src/sdkBinaryManifest.ts"
);

const profile = (tier, extra = {}) => ({ game: tier ? { template_tier: tier } : undefined, ...extra });

// ─── seededSdkBinaryPath — one path definition per platform ─────────────────
{
  assert.equal(
    seededSdkBinaryPath({ platform: "darwin", homeDir: "/Users/kid" }),
    `/Users/kid/Library/Application Support/HypeProof-Studio/sdk/${SDK_BINARY_VERSION}/claude`,
    "darwin path is app-support/HypeProof-Studio, versioned",
  );
  assert.equal(
    seededSdkBinaryPath({ platform: "win32", homeDir: "C:\\Users\\kid", env: {} }),
    `C:\\Users\\kid\\AppData\\Roaming\\HypeProof-Studio\\sdk\\${SDK_BINARY_VERSION}\\claude.exe`,
    "win32 defaults to AppData/Roaming + claude.exe",
  );
  assert.equal(
    seededSdkBinaryPath({
      platform: "win32",
      homeDir: "C:\\Users\\kid",
      env: { APPDATA: "D:\\Roaming" },
    }),
    `D:\\Roaming\\HypeProof-Studio\\sdk\\${SDK_BINARY_VERSION}\\claude.exe`,
    "win32 honors APPDATA",
  );
  assert.equal(
    seededSdkBinaryPath({ platform: "linux", homeDir: "/home/kid", env: {} }),
    `/home/kid/.config/HypeProof-Studio/sdk/${SDK_BINARY_VERSION}/claude`,
    "linux defaults to ~/.config",
  );
  assert.equal(
    seededSdkBinaryPath({ platform: "linux", homeDir: "/home/kid", env: { XDG_CONFIG_HOME: "/xdg" } }),
    `/xdg/HypeProof-Studio/sdk/${SDK_BINARY_VERSION}/claude`,
    "linux honors XDG_CONFIG_HOME",
  );
  assert.equal(
    seededSdkBinaryPath({ platform: "darwin", homeDir: "/Users/kid", version: "9.9.9" }),
    "/Users/kid/Library/Application Support/HypeProof-Studio/sdk/9.9.9/claude",
    "version segment isolates SDK releases (stale binary never resolves after a bump)",
  );
  assert.equal(
    sdkBinaryMarkerPath("/x/claude"),
    "/x/claude.verified.json",
    "marker sits next to the binary",
  );
}

// ─── marker parsing + the seeded integrity gate ──────────────────────────────
{
  const BOM = "\uFEFF"; // PS 5.1 Out-File -Encoding utf8 prefix
  const SIZE = 240_245_936; // plausible real binary size (doc §2.2)
  const marker = JSON.stringify({
    sdkVersion: SDK_BINARY_VERSION,
    size: SIZE,
    tarballSha512: "sha512-abc",
    verifiedAt: "2026-07-14T00:00:00Z",
  });
  const stat = { exists: true, executable: true, size: SIZE };

  assert.deepEqual(parseSdkBinaryMarker(marker), {
    sdkVersion: SDK_BINARY_VERSION,
    size: SIZE,
    tarballSha512: "sha512-abc",
    verifiedAt: "2026-07-14T00:00:00Z",
  });
  // Windows PowerShell 5.1 `Out-File -Encoding utf8` prefixes EF BB BF. The
  // marker written by an older seed-sdk-binary.ps1 must still parse, or the
  // seeded claude.exe is rejected and Studio silently drops to proxy-only.
  assert.deepEqual(
    parseSdkBinaryMarker(BOM + marker),
    {
      sdkVersion: SDK_BINARY_VERSION,
      size: SIZE,
      tarballSha512: "sha512-abc",
      verifiedAt: "2026-07-14T00:00:00Z",
    },
    "UTF-8 BOM (PS 5.1 Out-File) must not break the marker",
  );
  assert.deepEqual(
    isSeededBinaryTrusted({ stat, markerRaw: BOM + marker }),
    { ok: true },
    "a BOM-prefixed marker must still trust the seeded binary",
  );

  assert.equal(parseSdkBinaryMarker(null), null);
  assert.equal(parseSdkBinaryMarker("not json"), null);
  assert.equal(parseSdkBinaryMarker(JSON.stringify({ sdkVersion: "x" })), null, "missing fields");
  assert.equal(
    parseSdkBinaryMarker(JSON.stringify({ sdkVersion: "x", size: -1, tarballSha512: "sha512-a" })),
    null,
    "non-positive size rejected",
  );
  assert.equal(
    parseSdkBinaryMarker(JSON.stringify({ sdkVersion: "x", size: 1, tarballSha512: "md5-oops" })),
    null,
    "non-sha512 SRI rejected",
  );

  assert.deepEqual(isSeededBinaryTrusted({ stat, markerRaw: marker }), { ok: true });
  assert.equal(
    isSeededBinaryTrusted({ stat: { ...stat, exists: false }, markerRaw: marker }).ok,
    false,
    "absent binary",
  );
  assert.equal(
    isSeededBinaryTrusted({ stat: { ...stat, executable: false }, markerRaw: marker }).ok,
    false,
    "non-executable binary",
  );
  assert.equal(isSeededBinaryTrusted({ stat, markerRaw: null }).ok, false, "no marker → untrusted");
  assert.equal(
    isSeededBinaryTrusted({ stat: { ...stat, size: SIZE - 1 }, markerRaw: marker }).ok,
    false,
    "size drift vs seed-time marker → untrusted",
  );
  assert.equal(
    isSeededBinaryTrusted({
      stat: { exists: true, executable: true, size: 1024 },
      markerRaw: JSON.stringify({ sdkVersion: SDK_BINARY_VERSION, size: 1024, tarballSha512: "sha512-a" }),
    }).ok,
    false,
    "coarse floor: a tiny 'binary' is untrusted even with a matching marker",
  );
  assert.equal(
    isSeededBinaryTrusted({
      stat,
      markerRaw: JSON.stringify({ sdkVersion: "0.0.1", size: SIZE, tarballSha512: "sha512-a" }),
    }).ok,
    false,
    "marker for a different SDK version → untrusted",
  );
  assert.ok(SDK_BINARY_MIN_BYTES < SIZE, "floor stays below real binary sizes");
}

// ─── resolveSdkBinary — the REQ-M24 order matrix ─────────────────────────────
{
  const SIZE = 240_000_000;
  const goodMarker = JSON.stringify({
    sdkVersion: SDK_BINARY_VERSION,
    size: SIZE,
    tarballSha512: "sha512-abc",
  });
  const trustedSeed = {
    path: "/seed/claude",
    stat: { exists: true, executable: true, size: SIZE },
    markerRaw: goodMarker,
  };
  const base = {
    seeded: trustedSeed,
    nodeModulesAvailable: true,
    fileExists: () => true,
  };

  // 1. setting beats everything.
  assert.deepEqual(
    resolveSdkBinary({ ...base, settingPath: "/setting/claude", envPath: "/env/claude" }),
    { available: true, source: "setting", path: "/setting/claude" },
  );
  // 2. env beats seeded + node_modules.
  assert.deepEqual(resolveSdkBinary({ ...base, envPath: "/env/claude" }), {
    available: true,
    source: "env",
    path: "/env/claude",
  });
  // 3. trusted seeded beats node_modules.
  assert.deepEqual(resolveSdkBinary(base), {
    available: true,
    source: "seeded",
    path: "/seed/claude",
  });
  // 4. node_modules → NO explicit path (SDK's own lookup runs in dev).
  {
    const r = resolveSdkBinary({ ...base, seeded: undefined });
    assert.equal(r.available, true);
    assert.equal(r.source, "node-modules");
    assert.equal(r.path, undefined, "no pathToClaudeCodeExecutable for dev/node_modules");
  }
  // 5. nothing → unavailable with a reason trail (→ SdkUnavailableError → proxy fallback).
  {
    const r = resolveSdkBinary({
      settingPath: "/missing",
      envPath: "/also-missing",
      seeded: { ...trustedSeed, markerRaw: null },
      nodeModulesAvailable: false,
      fileExists: () => false,
    });
    assert.equal(r.available, false);
    assert.equal(r.reasons.length, 4, "every skipped tier leaves a diagnosable reason");
    assert.ok(r.reasons[0].includes("sdkBinaryPath"));
    assert.ok(r.reasons[1].includes("HPS_SDK_BINARY"));
    assert.ok(r.reasons[2].includes("marker"));
  }
  // A stale/missing setting FALLS THROUGH (never disables dev node_modules).
  {
    const r = resolveSdkBinary({
      settingPath: "/stale/claude",
      nodeModulesAvailable: true,
      fileExists: (p) => p !== "/stale/claude",
    });
    assert.equal(r.available, true);
    assert.equal(r.source, "node-modules");
  }
  // An untrusted seed (size drift) falls through too.
  {
    const r = resolveSdkBinary({
      ...base,
      seeded: { ...trustedSeed, stat: { exists: true, executable: true, size: SIZE - 7 } },
    });
    assert.equal(r.available, true);
    assert.equal(r.source, "node-modules");
  }
  // Whitespace/empty settings are "unset", not candidates.
  assert.equal(
    resolveSdkBinary({ ...base, settingPath: "  ", envPath: "" }).source,
    "seeded",
  );
}

// ─── buildSdkQueryOptions — pathToClaudeCodeExecutable threading ─────────────
{
  const workshop = profile("website", { sdk_tools: { read: true, write: true } });
  const agent = profileToAgentOptions(workshop, { model: "m", systemPrompt: "s" });
  const argsBase = { proxyUrl: "http://localhost:8787/v1", token: "t", baseEnv: {} };

  const withPath = buildSdkQueryOptions(agent, {
    ...argsBase,
    pathToClaudeCodeExecutable: "/seed/claude",
  });
  assert.equal(withPath.pathToClaudeCodeExecutable, "/seed/claude", "resolved path is passed to the SDK");

  const withoutPath = buildSdkQueryOptions(agent, argsBase);
  assert.ok(
    !("pathToClaudeCodeExecutable" in withoutPath),
    "no resolution → option OMITTED so the SDK's node_modules lookup runs (dev)",
  );
}

// ─── 바이너리 존재가 도구 정책을 바꾸지 않는다 (REQ-M18/M21/M23) ──────────────
// 시드된 바이너리는 CLI 가 **어디서** 도는지를 바꿀 뿐 코호트가 **무엇을** 할 수
// 있는지는 건드리지 않는다.
//
// 2026-08-11 — 이전에는 "아동은 무엇을 주든 tools: []" 였다. 지금은 도구 정책의
// owner 가 프로필이므로(ADR 0003) write 는 프로필이 열면 열린다. 대신 **아동에게
// 여전히 닫힌 것**(browser·subagents)으로 이 불변식을 검사한다 — 바이너리가
// 있어도 그 둘은 새어나오지 않아야 한다.
{
  const pollutedMinor = profile("kids-rich", {
    sdk_tools: { read: false, write: false, browser: true, subagents: true },
  });
  const agent = profileToAgentOptions(pollutedMinor, { model: "m", systemPrompt: "s" });
  const opts = buildSdkQueryOptions(agent, {
    proxyUrl: "http://localhost:8787/v1",
    token: "t",
    baseEnv: {},
    pathToClaudeCodeExecutable: "/seed/claude",
  });
  assert.deepEqual(
    opts.tools,
    [],
    "바이너리가 있어도 아동에게 browser/subagents 는 새지 않는다",
  );
  assert.equal(opts.agents, undefined, "no subagents for minors regardless of binary");
  assert.deepEqual(opts.allowedTools, [], "allowedTools stays [] (no auto-approve)");
  assert.equal(opts.pathToClaudeCodeExecutable, "/seed/claude");
  assert.deepEqual(agent.permittedMcpTools, [], "no browser MCP for minors regardless of binary");
}

// ─── pinned-manifest consistency ─────────────────────────────────────────────
// package.json === package-lock.json === sdkBinaryManifest.ts === both seed
// scripts, per platform. Each judge below returns the problems it finds. The
// shipped files must yield none (positive control), and a copy broken on
// purpose must yield exactly the planted problem (negative control), so a
// judge that quietly stopped measuring fails here instead of passing
// (.claude/rules/verification.md rules 2 and 3).
const SDK_PKG = "@anthropic-ai/claude-agent-sdk";
// Platform packages the SDK ships that Studio deliberately does not seed: the
// seed scripts detect glibc Linux, macOS and Windows only.
const UNSEEDED_PLATFORMS = new Set(["linux-x64-musl", "linux-arm64-musl"]);

function lockPinProblems({ pkg, lock, manifest, version }) {
  const problems = [];
  const declared = pkg.devDependencies?.[SDK_PKG];
  if (declared !== version) {
    problems.push(`package.json devDependencies ${SDK_PKG} is "${declared}", not the exact pin "${version}"`);
  }
  if (pkg.dependencies?.[SDK_PKG] !== undefined) {
    problems.push(`${SDK_PKG} is a prod dependency (#349: breaks vscode-min-prepack)`);
  }
  if (lock.packages?.[""]?.devDependencies?.[SDK_PKG] !== declared) {
    problems.push("package-lock.json root devDependencies disagree with package.json");
  }
  const sdk = lock.packages?.[`node_modules/${SDK_PKG}`];
  if (!sdk) return [...problems, `${SDK_PKG} missing from package-lock.json`];
  if (sdk.version !== version) problems.push(`package-lock.json ${SDK_PKG} is ${sdk.version}, manifest ${version}`);
  for (const name of Object.keys(sdk.optionalDependencies ?? {})) {
    const platform = name.slice(SDK_PKG.length + 1);
    if (!(platform in manifest) && !UNSEEDED_PLATFORMS.has(platform)) {
      problems.push(`${platform}: shipped by the SDK but neither seeded nor knowingly unseeded`);
    }
  }
  for (const [platform, entry] of Object.entries(manifest)) {
    if (entry.packageName !== `${SDK_PKG}-${platform}`) problems.push(`${platform}: packageName ${entry.packageName}`);
    if (sdk.optionalDependencies?.[entry.packageName] !== version) {
      problems.push(`${platform}: the locked SDK does not declare ${entry.packageName}@${version}`);
    }
    const locked = lock.packages?.[`node_modules/${entry.packageName}`];
    if (!locked) {
      problems.push(`${platform}: ${entry.packageName} missing from package-lock.json`);
      continue;
    }
    if (locked.version !== version) problems.push(`${platform}: package-lock.json version ${locked.version}`);
    if (locked.integrity !== entry.sha512) problems.push(`${platform}: manifest sha512 differs from lockfile integrity`);
    if (locked.resolved !== entry.url) problems.push(`${platform}: manifest url differs from lockfile resolved`);
    if (!(entry.unpackedSize > SDK_BINARY_MIN_BYTES)) problems.push(`${platform}: unpackedSize below the binary floor`);
  }
  return problems;
}

/** A seed script's platform → sha512 table against the expected one, both ways. */
function seedTableProblems(label, table, expected) {
  const problems = [];
  for (const [platform, sha512] of Object.entries(expected)) {
    if (table[platform] !== sha512) {
      problems.push(`${label} ${platform}: ${table[platform] ? "sha512 differs from the manifest" : "no pinned sha512"}`);
    }
  }
  for (const platform of Object.keys(table)) {
    if (!(platform in expected)) problems.push(`${label} ${platform}: pinned but not in the manifest`);
  }
  return problems;
}

function shSeedProblems(script, { manifest, version }) {
  const problems = [];
  const pinned = script.match(/^PINNED_VERSION="([^"]+)"/m)?.[1];
  if (pinned !== version) problems.push(`seed-sdk-binary.sh PINNED_VERSION is ${pinned}, manifest ${version}`);
  // The case arms of pinned_sha512(): `darwin-arm64) printf '%s' "sha512-…" ;;`.
  // The .sh keeps all six values even though it hands win32 to the .ps1.
  const table = {};
  for (const m of script.matchAll(/^\s*([a-z0-9]+-[a-z0-9]+)\)\s*printf '%s' "(sha512-[A-Za-z0-9+/=]+)"/gm)) {
    table[m[1]] = m[2];
  }
  const expected = Object.fromEntries(Object.entries(manifest).map(([p, e]) => [p, e.sha512]));
  return [...problems, ...seedTableProblems("seed-sdk-binary.sh", table, expected)];
}

function ps1SeedProblems(script, { manifest, version }) {
  const problems = [];
  const pinned = script.match(/^\$PinnedVersion\s*=\s*"([^"]+)"/m)?.[1];
  if (pinned !== version) problems.push(`seed-sdk-binary.ps1 $PinnedVersion is ${pinned}, manifest ${version}`);
  // `$PinnedSha512 = @{ "win32-x64" = "sha512-…" … }`. The file is CRLF with a
  // BOM (.gitattributes *.ps1 eol=crlf), which these patterns tolerate.
  const block = script.match(/^\$PinnedSha512\s*=\s*@\{([\s\S]*?)^\}/m)?.[1] ?? "";
  const table = {};
  for (const m of block.matchAll(/"([a-z0-9]+-[a-z0-9]+)"\s*=\s*"(sha512-[A-Za-z0-9+/=]+)"/g)) table[m[1]] = m[2];
  const expected = Object.fromEntries(
    Object.entries(manifest).filter(([p]) => p.startsWith("win32-")).map(([p, e]) => [p, e.sha512]),
  );
  return [...problems, ...seedTableProblems("seed-sdk-binary.ps1", table, expected)];
}

{
  const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(here, "..", "package-lock.json"), "utf8"));
  const sh = readFileSync(join(here, "..", "..", "..", "scripts", "seed-sdk-binary.sh"), "utf8");
  const ps1 = readFileSync(join(here, "..", "..", "..", "scripts", "seed-sdk-binary.ps1"), "utf8");
  const pin = { manifest: SDK_BINARY_MANIFEST, version: SDK_BINARY_VERSION };

  // Positive controls: the shipped files agree with each other.
  assert.deepEqual(
    lockPinProblems({ pkg, lock, ...pin }),
    [],
    "package.json, package-lock.json and sdkBinaryManifest.ts pin the same SDK and platform binaries",
  );
  assert.deepEqual(shSeedProblems(sh, pin), [], "seed-sdk-binary.sh embeds the manifest version and sha512 per platform");
  assert.deepEqual(ps1SeedProblems(ps1, pin), [], "seed-sdk-binary.ps1 embeds the manifest version and win32 sha512 values");

  // Negative controls: each judge reports the drift it exists for.
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const shaA = SDK_BINARY_MANIFEST["darwin-arm64"].sha512;
  const shaB = SDK_BINARY_MANIFEST["darwin-x64"].sha512;
  {
    const ranged = clone(pkg);
    ranged.devDependencies[SDK_PKG] = `^${SDK_BINARY_VERSION}`;
    assert.match(lockPinProblems({ pkg: ranged, lock, ...pin }).join("\n"), /not the exact pin/, "a ^range is not an exact pin");
    const drifted = clone(lock);
    drifted.packages[`node_modules/${SDK_PKG}-darwin-arm64`].integrity = shaB;
    assert.deepEqual(
      lockPinProblems({ pkg, lock: drifted, ...pin }),
      ["darwin-arm64: manifest sha512 differs from lockfile integrity"],
      "a lockfile integrity the manifest does not carry is reported for that platform",
    );
    const newPlatform = clone(lock);
    newPlatform.packages[`node_modules/${SDK_PKG}`].optionalDependencies[`${SDK_PKG}-freebsd-x64`] = SDK_BINARY_VERSION;
    assert.deepEqual(
      lockPinProblems({ pkg, lock: newPlatform, ...pin }),
      ["freebsd-x64: shipped by the SDK but neither seeded nor knowingly unseeded"],
      "a platform package the SDK starts shipping is a decision, not silence",
    );
  }
  {
    // Two values swapped between case arms: both still occur in the file (the
    // former includes() check passed this), but each arm would now refuse the
    // real tarball at seed time.
    const swapped = sh.replace(shaA, "\u0000").replace(shaB, shaA).replace("\u0000", shaB);
    assert.ok(swapped !== sh && swapped.includes(shaA) && swapped.includes(shaB), "the control is a pure swap");
    assert.deepEqual(shSeedProblems(swapped, pin), [
      "seed-sdk-binary.sh darwin-arm64: sha512 differs from the manifest",
      "seed-sdk-binary.sh darwin-x64: sha512 differs from the manifest",
    ]);
    const stale = sh.replace(`PINNED_VERSION="${SDK_BINARY_VERSION}"`, 'PINNED_VERSION="0.3.207"');
    assert.deepEqual(shSeedProblems(stale, pin), [`seed-sdk-binary.sh PINNED_VERSION is 0.3.207, manifest ${SDK_BINARY_VERSION}`]);
  }
  {
    const winX64 = SDK_BINARY_MANIFEST["win32-x64"].sha512;
    assert.deepEqual(ps1SeedProblems(ps1.replace(winX64, "sha512-c3RhbGU="), pin), [
      "seed-sdk-binary.ps1 win32-x64: sha512 differs from the manifest",
    ]);
    assert.deepEqual(ps1SeedProblems(ps1.replace(/^\s*"win32-arm64"\s*=.*$/m, ""), pin), [
      "seed-sdk-binary.ps1 win32-arm64: no pinned sha512",
    ]);
    const stale = ps1.replace(`$PinnedVersion = "${SDK_BINARY_VERSION}"`, '$PinnedVersion = "0.3.207"');
    assert.deepEqual(ps1SeedProblems(stale, pin), [`seed-sdk-binary.ps1 $PinnedVersion is 0.3.207, manifest ${SDK_BINARY_VERSION}`]);
  }

  // Each seeder writes where seededSdkBinaryPath looks, plus the trusted marker.
  assert.ok(
    sh.includes('$HOME/Library/Application Support/HypeProof-Studio/sdk/$VERSION'),
    "seed-sdk-binary.sh darwin destination matches seededSdkBinaryPath",
  );
  assert.ok(
    sh.includes('${XDG_CONFIG_HOME:-$HOME/.config}/HypeProof-Studio/sdk/$VERSION'),
    "seed-sdk-binary.sh linux destination matches seededSdkBinaryPath",
  );
  assert.ok(sh.includes('.verified.json'), "seed-sdk-binary.sh writes the runtime-trusted marker");
  assert.ok(
    ps1.includes('Join-Path $env:APPDATA "HypeProof-Studio\\sdk\\$Version"') && ps1.includes('Join-Path $destDir "claude.exe"'),
    "seed-sdk-binary.ps1 win32 destination matches seededSdkBinaryPath",
  );
  assert.ok(ps1.includes('"$destBin.verified.json"'), "seed-sdk-binary.ps1 writes the runtime-trusted marker");
}

// ─── approval policy for the roster consult (ADR 0011 §5.1) ─────────────────
// The consult tool reaches tool-less, read-only roster helpers, so it runs
// without a modal by default, yet a machine must still be able to require
// one: `consultHelper` is offered in requireApprovalFor's enum and kept out of
// its default. It sits here because WP A1 owns package.json and this file;
// manifest-security-scope.smoke.mjs keeps the full approval-policy lock.
function consultApprovalProblems(pkg) {
  const setting = pkg.contributes?.configuration?.properties?.["hypeproofChat.requireApprovalFor"];
  if (!setting) return ["requireApprovalFor is not declared"];
  const problems = [];
  if (!(setting.items?.enum ?? []).includes("consultHelper")) {
    problems.push("enum does not offer consultHelper (a machine could not require the modal)");
  }
  if ((setting.default ?? []).includes("consultHelper")) {
    problems.push("default requires consultHelper (every consult would open a modal)");
  }
  return problems;
}

{
  const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
  assert.deepEqual(consultApprovalProblems(pkg), [], "consultHelper is offered in requireApprovalFor and kept out of its default");

  // Negative controls on copies: drop it from the enum, then add it to the default.
  const setting = pkg.contributes.configuration.properties["hypeproofChat.requireApprovalFor"];
  const withSetting = (patch) => {
    const copy = JSON.parse(JSON.stringify(pkg));
    Object.assign(copy.contributes.configuration.properties["hypeproofChat.requireApprovalFor"], patch);
    return copy;
  };
  assert.deepEqual(
    consultApprovalProblems(withSetting({ items: { ...setting.items, enum: setting.items.enum.filter((k) => k !== "consultHelper") } })),
    ["enum does not offer consultHelper (a machine could not require the modal)"],
  );
  assert.deepEqual(consultApprovalProblems(withSetting({ default: [...setting.default, "consultHelper"] })), [
    "default requires consultHelper (every consult would open a modal)",
  ]);
}

console.log("sdk-binary.smoke: all assertions passed");
