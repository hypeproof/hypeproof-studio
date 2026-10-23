import { workPower } from "./workPower.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const RELEASE_REPO = "hypeproof/hypeproof-studio-releases";
export const RELEASES_API = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`;
const ASSET_PATH = `/repos/${RELEASE_REPO}/releases/assets/`;

/**
 * The public release the Lab download and its code-free install kit already serve
 * (Lab `studioInstallAccess.ts PUBLIC_RELEASE_REPO`, D19). Read anonymously, and only
 * by a Studio with no member access to the private mirror while public updates are on.
 */
const PUBLIC_RELEASE_REPO = "hypeproof/hypeproof-studio";
export const PUBLIC_RELEASES_API = `https://api.github.com/repos/${PUBLIC_RELEASE_REPO}/releases/latest`;
const PUBLIC_ASSET_PATH = `/repos/${PUBLIC_RELEASE_REPO}/releases/assets/`;

/** Which release an update came from: the member mirror or the public release. */
export type UpdateSource = "member" | "public";

export interface ReleaseFetchOptions {
  /**
   * Non-members read the public release instead of failing with UpdateAccessError
   * (setting `hypeproofChat.publicUpdates`, or the free-start signal). Default false:
   * today's behaviour.
   */
  publicUpdates?: boolean;
}

const UPDATE_ACCESS_ERROR_CODE = "update_access_unavailable";
const UPDATE_DEFERRED_ERROR_CODE = "update_check_deferred";

/**
 * The private release mirror cannot be read with this machine's credentials
 * (REQ-I14). Retrying will not help; the UI points to the homepage download.
 */
export class UpdateAccessError extends Error {
  readonly code = UPDATE_ACCESS_ERROR_CODE;
  constructor(detail: string) {
    super(detail);
    this.name = "UpdateAccessError";
  }
}

export function isUpdateAccessError(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    (error as { code?: unknown }).code === UPDATE_ACCESS_ERROR_CODE;
}

/**
 * The anonymous public check was rate limited (GitHub allows 60 anonymous requests
 * per hour per IP; a classroom shares one IP). Not an error: check again later.
 */
export class UpdateDeferredError extends Error {
  readonly code = UPDATE_DEFERRED_ERROR_CODE;
  constructor(detail: string) {
    super(detail);
    this.name = "UpdateDeferredError";
  }
}

export function isUpdateDeferredError(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    (error as { code?: unknown }).code === UPDATE_DEFERRED_ERROR_CODE;
}

function assetPathFor(source: UpdateSource): string {
  return source === "public" ? PUBLIC_ASSET_PATH : ASSET_PATH;
}

/** The source an asset URL belongs to, or null when it is not a trusted release asset. */
export function updateUrlSource(value: string): UpdateSource | null {
  for (const source of ["member", "public"] as const) {
    if (trustedUpdateUrl(value, source)) return source;
  }
  return null;
}

/**
 * A GitHub API asset URL of the release repository for `source`. Without `source`,
 * either repository is accepted; the download then authenticates by the URL's own
 * repository (member mirror: member credential; public release: anonymous).
 */
export function trustedUpdateUrl(value: string, source?: UpdateSource): boolean {
  if (!source) return updateUrlSource(value) !== null;
  const assetPath = assetPathFor(source);
  try {
    const url = new URL(value);
    return url.origin === "https://api.github.com" && !url.username && !url.password &&
      url.pathname.startsWith(assetPath) && /^\d+$/.test(url.pathname.slice(assetPath.length)) &&
      !url.search && !url.hash;
  } catch { return false; }
}

/** Use the member's existing GitHub login; never bundle a shared release token. */
export async function releaseToken(): Promise<string> {
  const configured = process.env.HPS_RELEASE_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (configured?.trim()) return configured.trim();
  try {
    const { stdout } = await promisify(execFile)("gh", ["auth", "token", "--hostname", "github.com"], {
      timeout: 5_000, maxBuffer: 8192, windowsHide: true,
    });
    if (stdout.trim()) return stdout.trim();
  } catch { /* Do not surface command output: it can contain credentials. */ }
  // Not a member (or not logged in): the private mirror is unreadable. The UI
  // points to the homepage download instead of a developer instruction (REQ-I14).
  throw new UpdateAccessError("No member GitHub credential for the private release mirror");
}

async function fetchAsset(url: string, signal: AbortSignal): Promise<Response> {
  // Public release assets are fetched anonymously: no member token leaves the
  // machine for a repository that does not need it. Mirror assets keep the token.
  const headers: Record<string, string> = { accept: "application/octet-stream" };
  if (updateUrlSource(url) === "member") headers.authorization = `Bearer ${await releaseToken()}`;
  const response = await fetch(url, { headers, redirect: "manual", signal });
  if (![301, 302, 303, 307, 308].includes(response.status)) return response;
  const location = response.headers.get("location");
  let target: URL;
  try { target = new URL(location ?? ""); } catch { throw new Error("Invalid update redirect"); }
  if (target.protocol !== "https:" || target.username || target.password || target.port ||
      !["release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(target.hostname)) {
    throw new Error("Untrusted update redirect");
  }
  // Signed asset URLs authenticate themselves. Never forward the GitHub token.
  return fetch(target.href, { redirect: "error", signal });
}

export async function fetchLatestRelease(): Promise<unknown> {
  const response = await fetch(RELEASES_API, {
    headers: { accept: "application/vnd.github+json", authorization: `Bearer ${await releaseToken()}` },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  // A token without access to the private mirror gets 404 (hidden repo) or
  // 401 (rejected token). Neither recovers by retrying (REQ-I14).
  if (response.status === 401 || response.status === 404) {
    throw new UpdateAccessError(`Release mirror not readable: HTTP ${response.status}`);
  }
  if (!response.ok) throw new Error(`Update check failed: HTTP ${response.status}`);
  return response.json();
}

/**
 * GitHub marks a rate-limit 403 with `x-ratelimit-remaining: 0` (primary limit),
 * a `retry-after` header (secondary limit), or a "rate limit" message in the body.
 */
async function isRateLimitResponse(response: Response): Promise<boolean> {
  if (response.headers.get("x-ratelimit-remaining") === "0") return true;
  if (response.headers.has("retry-after")) return true;
  try {
    return /rate limit/i.test(await response.text());
  } catch { return false; }
}

/** Anonymous read of the public release (D19). Never carries a credential. */
export async function fetchPublicLatestRelease(): Promise<unknown> {
  const response = await fetch(PUBLIC_RELEASES_API, {
    headers: { accept: "application/vnd.github+json" },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  // Anonymous API budget exhausted: check later. A 403 that is not a rate limit
  // (an abuse block, a repository access change) must not defer forever; it gets
  // the same answer as no access, the homepage download.
  if (response.status === 429 || (response.status === 403 && await isRateLimitResponse(response))) {
    throw new UpdateDeferredError(`Public release check rate limited: HTTP ${response.status}`);
  }
  if (response.status === 403) throw new UpdateAccessError("Public release not readable: HTTP 403");
  // No public release yet (or the repository is not public): same answer as no access.
  if (response.status === 404) throw new UpdateAccessError("Public release not available: HTTP 404");
  if (!response.ok) throw new Error(`Update check failed: HTTP ${response.status}`);
  return response.json();
}

/**
 * The latest release and where it came from. Members read the private mirror exactly
 * as before. Without member access (no credential, or a token the mirror refuses),
 * the public release is read only when `publicUpdates` is on; otherwise the
 * UpdateAccessError stands (REQ-I14). The private mirror is never called anonymously.
 */
export async function fetchLatestUpdateRelease(
  options: ReleaseFetchOptions = {},
): Promise<{ release: unknown; source: UpdateSource }> {
  try {
    return { release: await fetchLatestRelease(), source: "member" };
  } catch (error) {
    if (!options.publicUpdates || !isUpdateAccessError(error)) throw error;
  }
  return { release: await fetchPublicLatestRelease(), source: "public" };
}

/** A GitHub asset digest detects corruption; it is not a code-signing identity. */
export async function downloadVerifiedUpdate(
  asset: { downloadUrl: string; sizeBytes: number; digest?: string },
  destination: string,
  options: { idleTimeoutMs?: number; totalTimeoutMs?: number } = {},
): Promise<void> {
  if (!trustedUpdateUrl(asset.downloadUrl)) throw new Error("Untrusted update download URL");
  if (!Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes <= 0 || asset.sizeBytes > 2 * 1024 ** 3) {
    throw new Error("Invalid update size");
  }
  if (!/^sha256:[a-f0-9]{64}$/i.test(asset.digest ?? "")) throw new Error("Update SHA-256 digest is missing");

  const controller = new AbortController();
  const abort = () => controller.abort(new Error("Update download timed out"));
  const total = setTimeout(abort, options.totalTimeoutMs ?? 10 * 60_000);
  let idle = setTimeout(abort, options.idleTimeoutMs ?? 60_000);
  let created = false;
  const releasePower = workPower.acquire("update-download");
  try {
    const response = await fetchAsset(asset.downloadUrl, controller.signal);
    if (!response.ok || !response.body) throw new Error(`Update download failed: HTTP ${response.status}`);
    const hash = createHash("sha256");
    let bytes = 0;
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        clearTimeout(idle);
        idle = setTimeout(abort, options.idleTimeoutMs ?? 60_000);
        bytes += chunk.length;
        if (bytes > asset.sizeBytes) { callback(new Error("Update exceeds declared size")); return; }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    const output = createWriteStream(destination, { flags: "wx", mode: 0o600 });
    output.once("open", () => { created = true; });
    await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), meter, output, { signal: controller.signal });
    if (bytes !== asset.sizeBytes) throw new Error("Incomplete update download");
    if (`sha256:${hash.digest("hex")}` !== asset.digest!.toLowerCase()) throw new Error("Update SHA-256 mismatch");
  } catch (error) {
    controller.abort();
    if (created) await rm(destination, { force: true });
    throw error;
  } finally {
    releasePower();
    clearTimeout(total);
    clearTimeout(idle);
  }
}
