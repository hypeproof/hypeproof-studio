// #306 — pure helpers for the hardened native-browser session.
//
// The worker's /v1/profile response carries a per-cohort `browser_session`
// ({ mode, allowlist }). Minor cohorts send `mode: "safe"`. The host maps that
// to two VS Code settings the fork core patch reads
// (`hypeproof.browser.safeSession` + `hypeproof.browser.safeAllowlist`) so the
// integrated browser uses the locked-down `persist:hp-safe` Electron session.
//
// This module is vscode-free so it is Node-unit-testable (see
// extension-pure-orchestration-split); the actual settings write lives in the
// orchestration layer (chatPanelProvider) which owns the vscode API surface.

/** Minimal shape of the fields we read off a resolved profile. Kept structural
 *  so tests don't need the full ResolvedProfile type. */
export interface BrowserSafetyProfileLike {
  browser_session?: {
    mode?: string;
    allowlist?: unknown;
  } | null;
}

/** The two settings values the host applies for the active cohort. */
export interface BrowserSafetyConfig {
  /** `hypeproof.browser.safeSession` — true only for a `mode: "safe"` cohort. */
  safeSession: boolean;
  /** `hypeproof.browser.safeAllowlist` — the cohort's URL allowlist (safe only). */
  safeAllowlist: string[];
}

/**
 * Resolve the hardened-browser settings for a cohort profile.
 *
 * Fail-safe: anything other than an explicit `mode === "safe"` (including a
 * missing profile, missing field, or an unknown mode) yields `safeSession:false`
 * — i.e. the normal browser, which is the correct default for adult cohorts and
 * for older builds whose worker doesn't send the field yet.
 *
 * The allowlist is only surfaced for safe cohorts; non-string entries are
 * dropped so a malformed profile can never widen access.
 */
export function resolveBrowserSafety(
  profile: BrowserSafetyProfileLike | null | undefined,
): BrowserSafetyConfig {
  const safe = profile?.browser_session?.mode === "safe";
  if (!safe) {
    return { safeSession: false, safeAllowlist: [] };
  }
  const raw = profile?.browser_session?.allowlist;
  const safeAllowlist = Array.isArray(raw)
    ? raw.filter((e): e is string => typeof e === "string" && e.length > 0)
    : [];
  return { safeSession: true, safeAllowlist };
}

/**
 * CGP-ART-R-008 — where a link the learner clicks in chat (citation chip, inbox
 * link) may open. Minor cohorts (`safeSession`) stay inside the integrated
 * browser, whose hardened session enforces the cohort allowlist; the system
 * browser would bypass it. Every other cohort opens the system browser only
 * after a confirmation that names the host. Anything but an absolute http(s) URL
 * is refused.
 */
export type ExternalLinkRoute =
  | { kind: "refuse" }
  | { kind: "integrated"; url: string }
  | { kind: "confirm"; url: string; host: string };

/**
 * The safety used for a link click. A loaded profile decides. Without one (before the first
 * load, during a refetch, after token expiry) the last persisted `hypeproof.browser.safeSession`
 * decides, and an unknown value fails closed to the safe session: a minor must never get the
 * adult path just because the profile is momentarily absent.
 */
export function linkSafety(
  profile: BrowserSafetyProfileLike | null | undefined,
  persistedSafeSession: unknown,
): BrowserSafetyConfig {
  if (profile) return resolveBrowserSafety(profile);
  return { safeSession: persistedSafeSession !== false, safeAllowlist: [] };
}

export function routeExternalLink(raw: unknown, safety: BrowserSafetyConfig): ExternalLinkRoute {
  if (typeof raw !== "string" || !/^https?:\/\//i.test(raw)) return { kind: "refuse" };
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return { kind: "refuse" }; }
  if (!parsed.hostname) return { kind: "refuse" };
  const url = parsed.toString();
  if (safety.safeSession) return { kind: "integrated", url };
  return { kind: "confirm", url, host: parsed.hostname };
}
