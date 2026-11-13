// DEC-24 (Jay, 2026-11-12): a seat's Studio is behind when its heartbeat version is below the latest published formal
// (non-rc) Studio release. CGP-SHELL-R-034 / CGP-SHELL-D-033 draw that on /manage as 업데이트 필요.
//
// Source: the public release that Studio's own update checker reads anonymously
// (extensions/hypeproof-chat/src/updateTransport.ts PUBLIC_RELEASES_API). GitHub's /releases/latest skips drafts and
// prereleases, and the release pipeline marks every hyphen tag as a prerelease (scripts/tag-is-prerelease.sh). This
// module still refuses anything but a plain x.y.z tag with draft:false and prerelease:false, so an rc never becomes the
// floor. No credential is sent. A failure (offline, rate limit, odd answer) is null: unknown, and nobody gets flagged.

export const LATEST_RELEASE_API = "https://api.github.com/repos/hypeproof/hypeproof-studio/releases/latest";
/** A good answer is reused for 10 minutes; a failed read is retried after 1 minute. */
export const LATEST_RELEASE_TTL_MS = 10 * 60_000;
export const LATEST_RELEASE_RETRY_MS = 60_000;
const FORMAL_TAG = /^v?(\d{1,4}\.\d{1,4}\.\d{1,5})$/;

/** The formal version a GitHub release body names, or null when it is not one (draft, prerelease, rc tag, junk). */
export function formalReleaseVersion(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const release = body as Record<string, unknown>;
  if (release.draft !== false || release.prerelease !== false || typeof release.tag_name !== "string") return null;
  const match = FORMAL_TAG.exec(release.tag_name.trim());
  return match?.[1] ?? null;
}

/**
 * CGP-SHELL-R-003 — a release whose notes carry this line on its own is security-critical: a cohort's update freeze
 * does not hold it in Studio, and Chalk labels it so. The same line Studio's update checker reads
 * (extensions/hypeproof-chat/src/updateCheckerHelpers.ts SECURITY_CRITICAL_MARKER). Agent choice, "Confirmed by Jay: no".
 */
export const SECURITY_CRITICAL_MARKER = "<!-- hps-update: security-critical -->";
export function isSecurityCriticalRelease(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const notes = (body as Record<string, unknown>).body;
  return typeof notes === "string" && notes.split(/\r?\n/).some(line => line.trim() === SECURITY_CRITICAL_MARKER);
}

export interface LatestRelease {
  /** The latest formal release, e.g. "2026.1109.0", or null when it is not known right now. */
  version: string | null;
  /** When the source was last read (ISO), or null before the first read. */
  checked_at: string | null;
  /** CGP-SHELL-R-003: that release is marked security-critical (false while the version is unknown). */
  security_critical: boolean;
}

let memo: { version: string | null; security: boolean; at: number; until: number } | null = null;

/** Tests only: forget the per-isolate answer. */
export function resetLatestReleaseMemo(): void {
  memo = null;
}

export async function latestFormalRelease(
  now: number = Date.now(),
  fetchImpl: typeof fetch = fetch,
): Promise<LatestRelease> {
  if (memo && now < memo.until) return { version: memo.version, checked_at: new Date(memo.at).toISOString(), security_critical: memo.security };
  let version: string | null = null;
  let security = false;
  try {
    const init = {
      method: "GET",
      headers: { accept: "application/vnd.github+json", "user-agent": "hypeproof-chalk" },
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
      // Workers: one read per colo per 10 minutes at most, shared by every isolate there.
      cf: { cacheTtl: LATEST_RELEASE_TTL_MS / 1000, cacheEverything: true },
    } as RequestInit;
    const response = await fetchImpl(LATEST_RELEASE_API, init);
    if (response.ok) {
      const body = await response.json();
      version = formalReleaseVersion(body);
      security = version !== null && isSecurityCriticalRelease(body);
    }
  } catch {
    version = null;
    security = false;
  }
  memo = { version, security, at: now, until: now + (version ? LATEST_RELEASE_TTL_MS : LATEST_RELEASE_RETRY_MS) };
  return { version, checked_at: new Date(now).toISOString(), security_critical: security };
}
