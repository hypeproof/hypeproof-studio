// studio-sdk-seed-on-demand (REQ-M46) — PURE judges for fetching the public
// native SDK seed into the seeded location. No `vscode`, no fs, no network:
// the orchestration lives in sdkSeedFetch.ts (fs + fetch) and the confirm
// modal in chatPanelProvider.ts.
//
// Source: every public release since studio-public-sdk-seed carries, beside
// the zips, `claude-agent-sdk-<platform>-<version>.tgz` (the unmodified npm
// tarball), a `.sha256` file and `sdk-seed.json` (schema `hps-sdk-seed/1`, see
// scripts/release/sdk-seed-assets.mjs). The App reads the release of its own
// tag, so the seed always matches the SDK JS it vendors.
//
// Trust: the release is only a transport. A seed is installed only when its
// bytes match BOTH the manifest's sha256 AND the sha512 pinned in this App
// (sdkBinaryManifest.ts, the same SRI value npm enforces). A tampered or
// stale release cannot pass the pinned check, so the download origin carries
// no trust of its own.

import { SDK_BINARY_MANIFEST, SDK_BINARY_MIN_BYTES, SDK_BINARY_VERSION } from "./sdkBinaryManifest.ts";
import type { SdkBinaryResolution } from "./sdkCoachHelpers.ts";

export const SDK_SEED_MANIFEST_NAME = "sdk-seed.json";
export const SDK_SEED_MANIFEST_SCHEMA = "hps-sdk-seed/1";
/** The public release that ships the zips (hosted-shell e2e reads the same repo). */
export const SDK_SEED_RELEASE_BASE = "https://github.com/hypeproof/hypeproof-studio/releases/download";
/** Upper bound for a seed tarball; real ones are well under 150 MB. */
export const SDK_SEED_MAX_TARBALL_BYTES = 512 * 1024 * 1024;
/** Marker `seededBy` value so a support log can tell an in-app seed from the scripts. */
export const SDK_SEED_SEEDED_BY = "studio-sdk-seed-on-demand";

/** `<platform>-<arch>` key with a pinned manifest entry, or null (no offer). */
export function sdkSeedPlatformKey(platform: string, arch: string): string | null {
  const key = `${platform}-${arch}`;
  return Object.prototype.hasOwnProperty.call(SDK_BINARY_MANIFEST, key) ? key : null;
}

export function sdkSeedAssetName(platformKey: string, version: string): string {
  return `claude-agent-sdk-${platformKey}-${version}.tgz`;
}

/** The entry inside the npm tarball (same as the seed scripts extract). */
export function sdkSeedTarEntry(platformKey: string): string {
  return platformKey.startsWith("win32-") ? "package/claude.exe" : "package/claude";
}

/**
 * URLs of the release that matches this App. `appVersion` is the extension
 * package.json version, which the release build stamps from the tag
 * (scripts/resolve-version.sh), so the tag is `v<appVersion>`.
 */
export function sdkSeedUrls(args: { baseUrl?: string; appVersion: string; platformKey: string; version?: string }):
  { manifestUrl: string; tarballUrl: string } | null {
  if (!/^\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$/.test(args.appVersion ?? "")) return null;
  const base = (args.baseUrl ?? SDK_SEED_RELEASE_BASE).replace(/\/+$/, "");
  const tag = `v${args.appVersion}`;
  const version = args.version ?? SDK_BINARY_VERSION;
  return {
    manifestUrl: `${base}/${tag}/${SDK_SEED_MANIFEST_NAME}`,
    tarballUrl: `${base}/${tag}/${sdkSeedAssetName(args.platformKey, version)}`,
  };
}

export interface SdkSeedEntry {
  platform: string;
  name: string;
  size: number;
  sha256: string;
  npmIntegrity: string;
}

export type SdkSeedVerdict<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * Judges `sdk-seed.json` for this platform. `pinnedSha512` defaults to the
 * App's pinned manifest; a test injects its fixture's.
 */
export function judgeSdkSeedManifest(
  raw: unknown,
  args: { platformKey: string; version?: string; pinnedSha512?: string },
): SdkSeedVerdict<SdkSeedEntry> {
  const version = args.version ?? SDK_BINARY_VERSION;
  const pinned = args.pinnedSha512 ?? SDK_BINARY_MANIFEST[args.platformKey]?.sha512;
  if (!pinned) return { ok: false, reason: `no pinned sha512 for ${args.platformKey}` };
  if (!raw || typeof raw !== "object") return { ok: false, reason: `${SDK_SEED_MANIFEST_NAME} is not an object` };
  const m = raw as Record<string, unknown>;
  if (m.schema !== SDK_SEED_MANIFEST_SCHEMA) return { ok: false, reason: `${SDK_SEED_MANIFEST_NAME} schema is ${String(m.schema)}` };
  if (m.sdkVersion !== version) {
    return { ok: false, reason: `${SDK_SEED_MANIFEST_NAME} is for SDK ${String(m.sdkVersion)}, this App needs ${version}` };
  }
  const seeds = Array.isArray(m.seeds) ? m.seeds : [];
  const entry = seeds.find((s) => s && typeof s === "object" && (s as Record<string, unknown>).platform === args.platformKey) as
    | Record<string, unknown>
    | undefined;
  if (!entry) return { ok: false, reason: `${SDK_SEED_MANIFEST_NAME} has no ${args.platformKey} seed` };
  const name = sdkSeedAssetName(args.platformKey, version);
  if (entry.name !== name) return { ok: false, reason: `seed name ${String(entry.name)} is not ${name}` };
  if (typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
    return { ok: false, reason: "seed sha256 is missing or malformed" };
  }
  if (typeof entry.size !== "number" || !Number.isSafeInteger(entry.size) || entry.size <= 0 || entry.size > SDK_SEED_MAX_TARBALL_BYTES) {
    return { ok: false, reason: "seed size is missing or out of range" };
  }
  if (entry.npmIntegrity !== pinned) return { ok: false, reason: "seed npm integrity does not match the sha512 pinned in this App" };
  return { ok: true, value: { platform: args.platformKey, name, size: entry.size, sha256: entry.sha256, npmIntegrity: pinned } };
}

/** Judges the downloaded tarball bytes against the manifest entry and the pinned sha512. */
export function judgeSdkSeedTarball(
  actual: { size: number; sha256Hex: string; sha512Base64: string },
  entry: SdkSeedEntry,
  pinnedSha512: string = entry.npmIntegrity,
): SdkSeedVerdict<{ tarballSha512: string }> {
  if (actual.size !== entry.size) return { ok: false, reason: `downloaded ${actual.size} bytes, the release lists ${entry.size}` };
  if (actual.sha256Hex !== entry.sha256) return { ok: false, reason: "sha256 of the download does not match the release" };
  const sri = `sha512-${actual.sha512Base64}`;
  if (sri !== pinnedSha512) return { ok: false, reason: "sha512 of the download does not match the value pinned in this App" };
  return { ok: true, value: { tarballSha512: sri } };
}

/** The `.verified.json` marker isSeededBinaryTrusted reads (same shape as the seed scripts write). */
export function sdkSeedMarkerJson(args: { version?: string; size: number; tarballSha512: string; verifiedAt: string }): string {
  return `${JSON.stringify(
    {
      sdkVersion: args.version ?? SDK_BINARY_VERSION,
      size: args.size,
      tarballSha512: args.tarballSha512,
      verifiedAt: args.verifiedAt,
      seededBy: SDK_SEED_SEEDED_BY,
    },
    null,
    2,
  )}\n`;
}

/** The extracted binary must be plausible before it gets a marker. */
export function judgeSdkSeedBinary(size: number, minBytes: number = SDK_BINARY_MIN_BYTES): SdkSeedVerdict<number> {
  if (!Number.isSafeInteger(size) || size <= 0) return { ok: false, reason: "tarball did not contain the binary" };
  if (size < minBytes) return { ok: false, reason: `extracted binary is ${size} bytes, below the ${minBytes} floor` };
  return { ok: true, value: size };
}

/**
 * Default-off gate. The offer exists only when the machine setting
 * `hypeproofChat.sdkSeedOnDemand` is true or the Service advertises it on the
 * profile (`sdk_seed_on_demand: true`; no Service sends it today).
 */
export function sdkSeedOnDemandEnabled(args: { setting: unknown; profile: unknown }): boolean {
  if (args.setting === true) return true;
  return !!args.profile && typeof args.profile === "object" &&
    (args.profile as Record<string, unknown>).sdk_seed_on_demand === true;
}

export type SdkSeedOfferDecision =
  | "offer"
  | "disabled"
  | "binary-available"
  | "unsupported-platform"
  | "no-release"
  | "declined"
  | "in-flight";

/** Whether to show the confirm modal before an Agent SDK turn. */
export function sdkSeedOfferDecision(args: {
  enabled: boolean;
  resolution: SdkBinaryResolution;
  platformKey: string | null;
  urls: unknown;
  declined: boolean;
  inFlight: boolean;
}): SdkSeedOfferDecision {
  if (!args.enabled) return "disabled";
  if (args.resolution.available) return "binary-available";
  if (!args.platformKey) return "unsupported-platform";
  if (!args.urls) return "no-release";
  if (args.inFlight) return "in-flight";
  if (args.declined) return "declined";
  return "offer";
}

// ── Streaming tar reader ─────────────────────────────────────────────────────
// npm tarballs are ustar (node-tar), optionally with pax `x` or GNU `L` long
// names. This reader hands the bytes of ONE named regular-file entry to
// `onData` as they stream through, so a ~250 MB binary is never buffered.

const BLOCK = 512;

function cString(buf: Uint8Array, start: number, length: number): string {
  let end = start;
  while (end < start + length && buf[end] !== 0) end++;
  return Buffer.from(buf.subarray(start, end)).toString("utf8");
}

function octal(buf: Uint8Array, start: number, length: number): number {
  const text = cString(buf, start, length).trim();
  if (!/^[0-7]*$/.test(text)) return Number.NaN;
  return text ? parseInt(text, 8) : 0;
}

function paxPath(records: Buffer): string | null {
  let off = 0;
  let found: string | null = null;
  while (off < records.length) {
    const space = records.indexOf(0x20, off);
    if (space < 0) break;
    const len = parseInt(records.subarray(off, space).toString("ascii"), 10);
    if (!Number.isFinite(len) || len <= 0) break;
    const record = records.subarray(space + 1, off + len - 1).toString("utf8");
    const eq = record.indexOf("=");
    if (eq > 0 && record.slice(0, eq) === "path") found = record.slice(eq + 1);
    off += len;
  }
  return found;
}

export class TarEntryReader {
  private header = Buffer.alloc(0);
  private remaining = 0;
  private padding = 0;
  private capture: "target" | "meta" | "skip" = "skip";
  private meta: Buffer[] = [];
  private metaType = "";
  private nextName: string | null = null;
  private done = false;
  /** Bytes handed to onData for the target entry; -1 until the entry is seen. */
  size = -1;
  error: string | null = null;

  private readonly target: string;
  private readonly onData: (chunk: Uint8Array) => void;

  constructor(target: string, onData: (chunk: Uint8Array) => void) {
    this.target = target;
    this.onData = onData;
  }

  get found(): boolean {
    return this.size >= 0;
  }

  write(chunk: Uint8Array): void {
    let off = 0;
    while (off < chunk.length && !this.done && !this.error) {
      if (this.remaining > 0) {
        const n = Math.min(this.remaining, chunk.length - off);
        const part = chunk.subarray(off, off + n);
        if (this.capture === "target") this.onData(part);
        else if (this.capture === "meta") this.meta.push(Buffer.from(part));
        this.remaining -= n;
        off += n;
        if (this.remaining === 0) this.finishEntry();
        continue;
      }
      if (this.padding > 0) {
        const n = Math.min(this.padding, chunk.length - off);
        this.padding -= n;
        off += n;
        continue;
      }
      const need = BLOCK - this.header.length;
      const n = Math.min(need, chunk.length - off);
      this.header = Buffer.concat([this.header, chunk.subarray(off, off + n)]);
      off += n;
      if (this.header.length === BLOCK) {
        const h = this.header;
        this.header = Buffer.alloc(0);
        this.startEntry(h);
      }
    }
  }

  private startEntry(h: Buffer): void {
    if (h.every((b) => b === 0)) {
      this.done = true;
      return;
    }
    const size = octal(h, 124, 12);
    if (!Number.isSafeInteger(size) || size < 0) {
      this.error = "malformed tar header";
      return;
    }
    const type = String.fromCharCode(h[156] || 0x30);
    let name = cString(h, 0, 100);
    if (cString(h, 257, 5) === "ustar") {
      const prefix = cString(h, 345, 155);
      if (prefix) name = `${prefix}/${name}`;
    }
    if (this.nextName !== null && type !== "x" && type !== "L") {
      name = this.nextName;
      this.nextName = null;
    }
    this.remaining = size;
    this.padding = (BLOCK - (size % BLOCK)) % BLOCK;
    if (type === "x" || type === "L") {
      this.capture = "meta";
      this.metaType = type;
      this.meta = [];
    } else if ((type === "0" || type === "\0") && name === this.target && !this.found) {
      this.capture = "target";
      this.size = size;
    } else {
      this.capture = "skip";
    }
    if (size === 0) this.finishEntry();
  }

  private finishEntry(): void {
    if (this.capture === "meta") {
      const body = Buffer.concat(this.meta);
      const name = this.metaType === "L" ? cString(body, 0, body.length) : paxPath(body);
      if (name) this.nextName = name;
      this.meta = [];
    }
    this.capture = "skip";
  }
}
