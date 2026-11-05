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

import { middleEllipsis } from "./taskActivity.ts";

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
  | { kind: "blocked"; url: string; host: string }
  | { kind: "confirm"; url: string; host: string };

/** CGP-ART-D-008 — the learner's own machine (live preview, local server). WHATWG-normalized hostnames only. */
export function isLoopbackHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

/**
 * CGP-ART-D-008 — does the cohort allowlist admit this URL? A bare entry (`example.org`, `*.example.org`, `.example.org`)
 * admits that host and its subdomains on any scheme and port. An entry with a scheme (`https://ok.org/docs`) admits the
 * same origin and that path prefix on a segment boundary. Unparseable entries admit nothing, so a malformed list can
 * only narrow access.
 */
export function hostAllowed(url: URL, allowlist: readonly string[]): boolean {
  const host = url.hostname.toLowerCase().replace(/\.$/, ""); // `example.org.` is the same host
  for (const raw of allowlist) {
    if (typeof raw !== "string") continue;
    const entry = raw.trim().toLowerCase();
    if (!entry) continue;
    if (entry.includes("://")) {
      let e: URL;
      try { e = new URL(entry); } catch { continue; }
      if (e.origin !== url.origin) continue;
      const base = e.pathname.endsWith("/") ? e.pathname : e.pathname + "/";
      if (e.pathname === "/" || url.pathname === e.pathname || url.pathname.startsWith(base)) return true;
      continue;
    }
    const bare = entry.replace(/^\*?\./, "");
    if (!bare || /[\/?#@\s]/.test(bare)) continue;
    if (host === bare || host.endsWith("." + bare)) return true;
  }
  return false;
}

export interface LinkRouteOptions {
  /** From `safeLinkEnforced`: a safe-session link outside the allowlist is blocked. */
  enforceAllowlist?: boolean;
}

/**
 * CGP-ART-D-008 (Jay, 2026-11-04) — is the minor allowlist block on for this seat? The served profile decides:
 * on only when it marks the seat minor (`minor_cohort: true`), in the safe session, with a non-empty allowlist.
 * An empty served list (or one with no usable entry) leaves today's integrated route instead of blocking every link.
 * Without a loaded profile, the persisted `hypeproof.browser.safeSession` / `safeAllowlist` decide; those settings
 * are registered only by the fork core patch, which the pinned fork base lacks, so on shipped builds nothing is
 * persisted and the block is off until the profile loads (the link still opens only in the integrated browser).
 * `hypeproofChat.safeLinkAllowlistEnabled` (machine, default true) is the support override: only an explicit `false`
 * turns it off.
 */
export function safeLinkEnforced(
  profile: (BrowserSafetyProfileLike & { minor_cohort?: boolean }) | null | undefined,
  safety: BrowserSafetyConfig,
  setting: unknown,
): boolean {
  if (setting === false) return false;
  if (!safety.safeSession || !safety.safeAllowlist.some(allowlistEntryUsable)) return false;
  return profile ? profile.minor_cohort === true : true;
}

/** An entry `hostAllowed` can match at all; a list of only unusable entries counts as empty. */
export function allowlistEntryUsable(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const entry = raw.trim().toLowerCase();
  if (!entry) return false;
  if (entry.includes("://")) {
    try { const e = new URL(entry); return /^https?:$/.test(e.protocol) && !!e.hostname; } catch { return false; }
  }
  const bare = entry.replace(/^\*?\./, "");
  return !!bare && !/[\/?#@\s]/.test(bare);
}

/**
 * The safety used for a link click. A loaded profile decides. Without one (before the first
 * load, during a refetch, after token expiry) the last persisted `hypeproof.browser.safeSession`
 * decides, and an unknown value fails closed to the safe session: a minor must never get the
 * adult path just because the profile is momentarily absent.
 */
export function linkSafety(
  profile: BrowserSafetyProfileLike | null | undefined,
  persistedSafeSession: unknown,
  persistedAllowlist?: unknown,
): BrowserSafetyConfig {
  if (profile) return resolveBrowserSafety(profile);
  const safeAllowlist = Array.isArray(persistedAllowlist)
    ? persistedAllowlist.filter((e): e is string => typeof e === "string" && e.length > 0)
    : [];
  return { safeSession: persistedSafeSession !== false, safeAllowlist };
}

/**
 * CGP-ART-R-008 / CGP-ART-D-008. Order: refuse non-web input; the learner's own loopback preview opens in the integrated
 * browser for everyone, with no dialog; a safe session opens the integrated browser, or, with `enforceAllowlist`, is
 * blocked when the allowlist does not admit the URL (an empty list admits nothing: fail closed); everyone else confirms.
 */
export function routeExternalLink(raw: unknown, safety: BrowserSafetyConfig, opts: LinkRouteOptions = {}): ExternalLinkRoute {
  if (typeof raw !== "string" || !/^https?:\/\//i.test(raw)) return { kind: "refuse" };
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return { kind: "refuse" }; }
  if (!parsed.hostname) return { kind: "refuse" };
  const url = parsed.toString();
  if (isLoopbackHost(parsed.hostname)) return { kind: "integrated", url };
  if (safety.safeSession) {
    if (opts.enforceAllowlist && !hostAllowed(parsed, safety.safeAllowlist)) return { kind: "blocked", url, host: parsed.hostname };
    return { kind: "integrated", url };
  }
  return { kind: "confirm", url, host: parsed.hostname };
}

/** CGP-ART-D-008 — the host as the dialog and banner show it: whole up to 48 characters, middle ellipsis beyond. */
export const LINK_HOST_MAX = 48;

/** The adult confirmation. The host is the dialog's (bold) message line; the full address is the plain detail. */
export function externalLinkDialog(route: { url: string; host: string }): { message: string; detail: string; open: string; copy: string } {
  return { message: `바깥 사이트를 열까요?\n${middleEllipsis(route.host, LINK_HOST_MAX)}`, detail: route.url, open: "열기", copy: "링크 복사" };
}
