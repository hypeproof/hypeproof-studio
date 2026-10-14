// #282 W4a — pinned manifest for the Claude Agent SDK native `claude` binary
// (docs/sdk-bundling.md §5 sketch step 3). PURE constants: no `vscode`, no
// imports — a leaf module loadable standalone by the smoke tests.
//
// All values are PUBLIC (npm registry URLs + SRI integrity hashes) — no
// secrets, no SecretStorage. They are pinned to the exact SDK version in
// extensions/hypeproof-chat/package-lock.json; a smoke test
// (test/sdk-binary.smoke.mjs) fails the build if this table drifts from the
// lockfile, and scripts/seed-sdk-binary.sh and scripts/seed-sdk-binary.ps1
// embed the same values (both locked by the smoke test). Bump this file ONLY
// together with the @anthropic-ai/claude-agent-sdk dependency, which
// package.json pins exactly (no ^range) — never float (doc §6 "Upstream
// layout drift").
//
// TRUST MODEL (doc §5 step 4 + W4a integrity gate):
// - The tarball's sha512 is verified ONCE, at seed time, against `sha512`
//   below (the same SRI value npm itself enforces via package-lock.json).
// - The seeder then writes a `<binary>.verified.json` marker recording the
//   verified size. At runtime we trust marker + exact size match + the
//   coarse SDK_BINARY_MIN_BYTES floor — re-hashing ~229 MiB on every coach
//   turn is too slow, and the threat model here is corruption/truncation,
//   not an attacker with write access to the user's own app-support dir
//   (who could equally rewrite the marker).

/**
 * The exact @anthropic-ai/claude-agent-sdk version whose platform binaries
 * this manifest describes. Must equal the version resolved in
 * package-lock.json (smoke-tested).
 */
export const SDK_BINARY_VERSION = "0.3.299";

export interface SdkBinaryManifestEntry {
  /** npm platform package that carries the binary. */
  packageName: string;
  /** Direct, unauthenticated registry tarball URL (doc §2.3). */
  url: string;
  /** SRI sha512 of the tarball — identical to package-lock integrity. */
  sha512: string;
  /**
   * Registry `dist.unpackedSize` for the platform package (4 files; the
   * `claude` binary dominates). Used only for operator-facing disk-size
   * messaging — the runtime size gate uses the seed-time marker, not this.
   */
  unpackedSize: number;
}

/** `<platform>-<arch>` keys matching Node's process.platform/process.arch. */
export const SDK_BINARY_MANIFEST: Readonly<Record<string, SdkBinaryManifestEntry>> = {
  "darwin-arm64": {
    packageName: "@anthropic-ai/claude-agent-sdk-darwin-arm64",
    url: `https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-darwin-arm64/-/claude-agent-sdk-darwin-arm64-${SDK_BINARY_VERSION}.tgz`,
    sha512:
      "sha512-KfkR3Ve7Eku1QuxT3LhC5e9Oj7c8UXvLJFFLbCw0u3OrhpzJUQ0ldd9ArmYNU3J47gpaqYgafnk9ztVPLdcajA==",
    unpackedSize: 247932280,
  },
  "darwin-x64": {
    packageName: "@anthropic-ai/claude-agent-sdk-darwin-x64",
    url: `https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-darwin-x64/-/claude-agent-sdk-darwin-x64-${SDK_BINARY_VERSION}.tgz`,
    sha512:
      "sha512-7G6qjn+xNCmyewcQ/XG/ElBoEGr8uDD4D8X33bqXEbNZ4vXbssiOzmcyxfuWLa7YqR8g9cJnmaWB6UzFEwiC6Q==",
    unpackedSize: 257765648,
  },
  "win32-x64": {
    packageName: "@anthropic-ai/claude-agent-sdk-win32-x64",
    url: `https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-win32-x64/-/claude-agent-sdk-win32-x64-${SDK_BINARY_VERSION}.tgz`,
    sha512:
      "sha512-PWHbjAdrecVlmR0kdgsX20QvUiFgWQl4zskuWd6Ieg3e5w+Ol0FZGXYRLS+Erd+pYUEZBNjDCqK2yd2KdBbDQw==",
    unpackedSize: 269231840,
  },
  "win32-arm64": {
    packageName: "@anthropic-ai/claude-agent-sdk-win32-arm64",
    url: `https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-win32-arm64/-/claude-agent-sdk-win32-arm64-${SDK_BINARY_VERSION}.tgz`,
    sha512:
      "sha512-sKvddLLYlXzk0FwjT9gNZDzmdzupI7qI0Dok7uu/KYGFgMGiSEGIsB9bfg+31HMDDftaT16P80MLzH+F8zQBFA==",
    unpackedSize: 255381736,
  },
  "linux-x64": {
    packageName: "@anthropic-ai/claude-agent-sdk-linux-x64",
    url: `https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-linux-x64/-/claude-agent-sdk-linux-x64-${SDK_BINARY_VERSION}.tgz`,
    sha512:
      "sha512-Q+sweKF/ruNq4Gmf4CzglwaKJmtQjhBK5MT3U1oUhlNStwHejgBg1GLa/KrQMRE0R4u0ayapLyVNrfu0hQYGkQ==",
    unpackedSize: 265342725,
  },
  "linux-arm64": {
    packageName: "@anthropic-ai/claude-agent-sdk-linux-arm64",
    url: `https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-linux-arm64/-/claude-agent-sdk-linux-arm64-${SDK_BINARY_VERSION}.tgz`,
    sha512:
      "sha512-8b5apRvHageZ/9xDfoIu8tJ6lpPAGjg4tD9JYef4SjpsY4KM/gvR6qC+Kqq5JHiH/Tq/mjgGYZjMkTZS8TOnsQ==",
    unpackedSize: 264626765,
  },
};

/**
 * Coarse floor for a plausible `claude` binary (every platform's real binary
 * is ~230–270 MB; darwin-arm64 0.3.299 is 247,931,696 bytes). Guards against
 * a truncated download / corrupt marker even if the marker's own size field
 * was damaged the same way. Deliberately loose — the EXACT check is
 * `size === marker.size` (isSeededBinaryTrusted).
 */
export const SDK_BINARY_MIN_BYTES = 150 * 1024 * 1024;
