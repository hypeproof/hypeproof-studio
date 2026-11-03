// studio-sdk-seed-on-demand (REQ-M46) — fetch the public native SDK seed into
// the seeded location. Orchestration only (fetch + fs); every judgement is in
// sdkSeedHelpers.ts. No `vscode`: the confirm modal and progress live in
// chatPanelProvider.ts, and test/sdk-seed-fetch.smoke.mjs drives this module
// against a local fixture server.
//
// Order matters for crash safety: the binary is renamed into place first and
// the `.verified.json` marker is written LAST, so an interrupted run leaves no
// marker and isSeededBinaryTrusted keeps rejecting it (the offer reappears).

import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { createGunzip } from "node:zlib";
import {
  judgeSdkSeedBinary,
  judgeSdkSeedManifest,
  judgeSdkSeedTarball,
  sdkSeedMarkerJson,
  sdkSeedTarEntry,
  sdkSeedUrls,
  TarEntryReader,
  type SdkSeedEntry,
} from "./sdkSeedHelpers.ts";
import { sdkBinaryMarkerPath } from "./sdkCoachHelpers.ts";

export type SdkSeedFetchResult =
  | { ok: true; path: string; size: number }
  | { ok: false; stage: "manifest" | "download" | "verify" | "install"; reason: string };

export interface SdkSeedFetchArgs {
  appVersion: string;
  platformKey: string;
  /** seededSdkBinaryPath() for this platform. */
  destBinary: string;
  baseUrl?: string;
  version?: string;
  /** Test seam: the fixture's sha512 SRI. Production uses the pinned manifest. */
  pinnedSha512?: string;
  /** Test seam: a small fixture binary. Production uses SDK_BINARY_MIN_BYTES. */
  minBinaryBytes?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  onProgress?: (received: number, total: number) => void;
  now?: () => Date;
}

function signalFor(args: SdkSeedFetchArgs): AbortSignal {
  const timeout = AbortSignal.timeout(args.timeoutMs ?? 15 * 60_000);
  return args.signal ? AbortSignal.any([args.signal, timeout]) : timeout;
}

function tmpName(dir: string, suffix: string): string {
  return path.join(dir, `.seed-${randomBytes(6).toString("hex")}${suffix}`);
}

function rmQuiet(p: string): void {
  try {
    fs.rmSync(p, { force: true });
  } catch {
    // best effort
  }
}

async function downloadTarball(
  url: string,
  entry: SdkSeedEntry,
  dest: string,
  args: SdkSeedFetchArgs,
  signal: AbortSignal,
): Promise<{ size: number; sha256Hex: string; sha512Base64: string }> {
  const response = await (args.fetchImpl ?? fetch)(url, { redirect: "follow", signal });
  if (!response.ok || !response.body) throw new Error(`seed download failed: HTTP ${response.status}`);
  const sha256 = createHash("sha256");
  const sha512 = createHash("sha512");
  let size = 0;
  const fd = fs.openSync(dest, "w", 0o600);
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      // Never write more than the release says: a hostile or broken server
      // cannot fill the disk.
      if (size > entry.size) throw new Error(`seed download exceeds the listed ${entry.size} bytes`);
      sha256.update(chunk);
      sha512.update(chunk);
      fs.writeSync(fd, chunk);
      args.onProgress?.(size, entry.size);
    }
  } finally {
    fs.closeSync(fd);
  }
  return { size, sha256Hex: sha256.digest("hex"), sha512Base64: sha512.digest("base64") };
}

async function extractEntry(tarball: string, entryName: string, dest: string): Promise<number> {
  const fd = fs.openSync(dest, "w", 0o700);
  let written = 0;
  const reader = new TarEntryReader(entryName, (chunk) => {
    fs.writeSync(fd, chunk);
    written += chunk.length;
  });
  try {
    const gunzip = fs.createReadStream(tarball).pipe(createGunzip());
    for await (const chunk of gunzip as AsyncIterable<Buffer>) {
      reader.write(chunk);
      if (reader.error) throw new Error(reader.error);
    }
  } finally {
    fs.closeSync(fd);
  }
  if (!reader.found || written !== reader.size) return 0;
  return written;
}

/**
 * Fetch, verify and install the seed. Never throws: every failure is a
 * reason the host logs and turns into one Korean message.
 */
export async function fetchSdkSeed(args: SdkSeedFetchArgs): Promise<SdkSeedFetchResult> {
  const urls = sdkSeedUrls({ baseUrl: args.baseUrl, appVersion: args.appVersion, platformKey: args.platformKey, version: args.version });
  if (!urls) return { ok: false, stage: "manifest", reason: `no release tag for App version ${args.appVersion}` };
  const signal = signalFor(args);

  let entry: SdkSeedEntry;
  try {
    const response = await (args.fetchImpl ?? fetch)(urls.manifestUrl, { redirect: "follow", signal });
    if (!response.ok) return { ok: false, stage: "manifest", reason: `sdk-seed.json: HTTP ${response.status}` };
    const verdict = judgeSdkSeedManifest(await response.json(), {
      platformKey: args.platformKey,
      version: args.version,
      pinnedSha512: args.pinnedSha512,
    });
    if (!verdict.ok) return { ok: false, stage: "verify", reason: verdict.reason };
    entry = verdict.value;
  } catch (error) {
    return { ok: false, stage: "manifest", reason: (error as Error).message };
  }

  const dir = path.dirname(args.destBinary);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (error) {
    return { ok: false, stage: "install", reason: (error as Error).message };
  }
  const tgz = tmpName(dir, ".tgz");
  const bin = tmpName(dir, ".bin");
  try {
    let digests;
    try {
      digests = await downloadTarball(urls.tarballUrl, entry, tgz, args, signal);
    } catch (error) {
      return { ok: false, stage: "download", reason: (error as Error).message };
    }
    const tarball = judgeSdkSeedTarball(digests, entry, args.pinnedSha512 ?? entry.npmIntegrity);
    if (!tarball.ok) return { ok: false, stage: "verify", reason: tarball.reason };

    let size: number;
    try {
      size = await extractEntry(tgz, sdkSeedTarEntry(args.platformKey), bin);
    } catch (error) {
      return { ok: false, stage: "verify", reason: `tarball could not be read: ${(error as Error).message}` };
    }
    const binary = judgeSdkSeedBinary(size, args.minBinaryBytes);
    if (!binary.ok) return { ok: false, stage: "verify", reason: binary.reason };

    try {
      fs.chmodSync(bin, 0o755);
      rmQuiet(sdkBinaryMarkerPath(args.destBinary));
      fs.renameSync(bin, args.destBinary);
      fs.writeFileSync(
        sdkBinaryMarkerPath(args.destBinary),
        sdkSeedMarkerJson({
          version: args.version,
          size,
          tarballSha512: tarball.value.tarballSha512,
          verifiedAt: (args.now?.() ?? new Date()).toISOString(),
        }),
      );
    } catch (error) {
      return { ok: false, stage: "install", reason: (error as Error).message };
    }
    return { ok: true, path: args.destBinary, size };
  } finally {
    rmQuiet(tgz);
    rmQuiet(bin);
  }
}
