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

import { createHash } from "node:crypto";
import { middleEllipsis } from "./taskActivity.ts";

/** Minimal shape of the fields we read off a resolved profile. Kept structural
 *  so tests don't need the full ResolvedProfile type. */
export interface BrowserSafetyProfileLike {
  browser_session?: {
    mode?: string;
    allowlist?: unknown;
    /** REQ-N11 — the served switch for `hypeproof.browser.hardenedSessionEnabled` (absent → off). */
    hardened?: unknown;
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
/**
 * CGP-SHELL-R-026 (Jay, 2026-11-14, #4090; supersedes CGP-ART-D-008's block for this scope). `integrated` / `system`
 * open with no dialog; `confirm` asks first (LinkConfirmDialog) and then opens `where`.
 */
export type ExternalLinkRoute =
  | { kind: "refuse" }
  | { kind: "integrated"; url: string }
  | { kind: "system"; url: string }
  | { kind: "confirm"; url: string; host: string; where: "integrated" | "system" };
/** Where the click came from. A link from the preview (generated HTML) always asks, for every seat. */
export type LinkSource = "chat" | "preview" | "browser";

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
  /** From `safeLinkEnforced`: the lesson allowlist is trusted, so an admitted link opens with no dialog. */
  enforceAllowlist?: boolean;
  /** `hypeproofChat.confirmExternalLinks` (default false): an adult seat asks before the system browser opens. */
  confirmAdult?: boolean;
  source?: LinkSource;
}

/**
 * CGP-ART-D-008 (Jay, 2026-11-04) — is the minor allowlist block on for this seat? The served profile decides:
 * on only when it marks the seat minor (`minor_cohort: true`), in the safe session, with a non-empty allowlist.
 * An empty served list (or one with no usable entry) leaves today's integrated route instead of blocking every link.
 * Without a loaded profile, the seat's saved copy (`learnerLinkPolicy`, REQ-N11) decides as its profile did; with no
 * copy, the persisted `hypeproof.browser.safeSession` / `safeAllowlist` decide (registered only by the core patch
 * `hps-safe-session.patch`; on builds without it nothing is persisted and the block is off until the profile loads,
 * while the link still opens only in the integrated browser).
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
 * REQ-N11 (2026-11-05) — the extension-owned copy of the last served link safety. Kept in the
 * extension's globalState (never in settings.json, which the learner and any workspace settings
 * file can edit) and used only while no profile is loaded: first load, refetch, token expiry.
 */
export const SAVED_LINK_SAFETY_KEY = "hypeproofChat.savedLinkSafety";

export interface SavedLinkSafety {
  v: 1;
  /** `linkSeatKey` of the credential the profile was served for. */
  seat: string;
  /** The served `minor_cohort`. */
  minor: boolean;
  /** The served `browser_session.mode === "safe"`. */
  safeSession: boolean;
  /** The served `browser_session.allowlist` (strings only; safe sessions only). */
  allowlist: string[];
  savedAt: number;
}

/**
 * A one-way key for the seat behind a credential: its cohort (`c`) when the token names one, so a
 * renewed token for the same class keeps the copy; otherwise the credential itself. Unverified
 * decode: it only selects which saved copy may apply, and a mismatch means "no copy".
 */
export function linkSeatKey(token: string | null | undefined): string | null {
  if (typeof token !== "string" || !token) return null;
  let cohort: string | undefined;
  const head = token.split(".");
  if (head.length === 2) {
    try {
      const payload = JSON.parse(Buffer.from(head[0].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { c?: unknown };
      if (typeof payload?.c === "string" && payload.c.trim()) cohort = payload.c;
    } catch { /* not a cohort token: key on the credential */ }
  }
  const basis = cohort !== undefined ? `c\u0000${cohort}` : `t\u0000${token}`;
  return createHash("sha256").update(`hps-link-seat/1\u0000${basis}`).digest("hex").slice(0, 32);
}

/** What to save from a served profile. */
export function savedLinkSafetyFrom(
  profile: BrowserSafetyProfileLike & { minor_cohort?: boolean },
  seat: string,
  now: number,
): SavedLinkSafety {
  const { safeSession, safeAllowlist } = resolveBrowserSafety(profile);
  return { v: 1, seat, minor: profile.minor_cohort === true, safeSession, allowlist: safeAllowlist, savedAt: now };
}

/** The saved copy, only when it is well formed and was saved for this seat; anything else is "no copy". */
export function savedLinkSafetyFor(saved: unknown, seat: string | null): SavedLinkSafety | null {
  if (!seat || !saved || typeof saved !== "object") return null;
  const r = saved as Partial<SavedLinkSafety>;
  if (r.v !== 1 || r.seat !== seat || typeof r.minor !== "boolean" || typeof r.safeSession !== "boolean" || !Array.isArray(r.allowlist)) return null;
  return {
    v: 1, seat, minor: r.minor, safeSession: r.safeSession,
    allowlist: r.allowlist.filter((e): e is string => typeof e === "string" && e.length > 0),
    savedAt: typeof r.savedAt === "number" ? r.savedAt : 0,
  };
}

/** Sign-out (no credential) or a seat change: the saved copy no longer belongs here and is removed. */
export function savedLinkSafetyStale(saved: unknown, seat: string | null): boolean {
  return saved !== undefined && saved !== null && savedLinkSafetyFor(saved, seat) === null;
}

/**
 * REQ-N11 (Jay 2026-11-07) — the settings lock: the three hardened-session settings for a minor or safe seat,
 * as the served profile set them. Kept in the extension's globalState, which the core patch
 * (`hps-safe-session.patch`, `hpBrowserSettingsLock`) reads directly, so the workbench and the main process
 * follow it even when settings.json says otherwise, before this extension activates, and in a new VS Code
 * profile. Only a served profile replaces or removes it (sign-out keeps it: the Mac stays locked until
 * another seat's profile is served). Support override: change the cohort's served profile on the Service.
 */
export const BROWSER_SETTINGS_LOCK_KEY = "hypeproofChat.browserSettingsLock";

export interface BrowserSettingsLock {
  v: 1;
  /** `hypeproof.browser.hardenedSessionEnabled`: served `browser_session.hardened`, or the registered default. */
  hardened: boolean;
  /** `hypeproof.browser.safeSession`: served `browser_session.mode === "safe"`. */
  safeSession: boolean;
  /** `hypeproof.browser.safeAllowlist`: the served list (strings only). */
  allowlist: string[];
  savedAt: number;
}

/** The lock a served profile asks for: a minor or safe seat gets one; any other seat (adult) gets none. */
export function browserSettingsLockFrom(
  profile: BrowserSafetyProfileLike & { minor_cohort?: boolean },
  registeredHardenedDefault: unknown,
  now: number,
): BrowserSettingsLock | null {
  const { safeSession, safeAllowlist } = resolveBrowserSafety(profile);
  if (!safeSession && profile.minor_cohort !== true) return null;
  return { v: 1, hardened: profile.browser_session?.hardened === true || registeredHardenedDefault === true, safeSession, allowlist: safeAllowlist, savedAt: now };
}

/** The saved lock when well formed; anything else is "no lock". */
export function browserSettingsLockOf(saved: unknown): BrowserSettingsLock | null {
  if (!saved || typeof saved !== "object") return null;
  const r = saved as Partial<BrowserSettingsLock>;
  if (r.v !== 1 || typeof r.hardened !== "boolean" || typeof r.safeSession !== "boolean" || !Array.isArray(r.allowlist)) return null;
  return {
    v: 1, hardened: r.hardened, safeSession: r.safeSession,
    allowlist: r.allowlist.filter((e): e is string => typeof e === "string" && e.length > 0),
    savedAt: typeof r.savedAt === "number" ? r.savedAt : 0,
  };
}

export type BrowserSettingKey = "hardenedSessionEnabled" | "safeSession" | "safeAllowlist";

/**
 * The settings writes that put a locked seat back: a setting looser than the lock is reverted; a stricter
 * one (`true` where the lock says `false`) is left alone. The allowlist is always exactly the served one.
 * No lock → nothing (adult seats keep their own settings). Equal values → nothing, so a write never loops.
 */
export function browserSettingsReverts(
  lock: BrowserSettingsLock | null,
  current: { hardenedSessionEnabled: unknown; safeSession: unknown; safeAllowlist: unknown },
): Array<[BrowserSettingKey, boolean | string[]]> {
  if (!lock) return [];
  const out: Array<[BrowserSettingKey, boolean | string[]]> = [];
  if (lock.hardened && current.hardenedSessionEnabled !== true) out.push(["hardenedSessionEnabled", true]);
  if (lock.safeSession && current.safeSession !== true) out.push(["safeSession", true]);
  const list = current.safeAllowlist;
  const same = Array.isArray(list) && list.length === lock.allowlist.length && list.every((e, i) => e === lock.allowlist[i]);
  if (!same) out.push(["safeAllowlist", [...lock.allowlist]]);
  return out;
}

/**
 * REQ-N11 — the settings file is shared by every window; two windows in different VS Code profiles can hold
 * different locks and would rewrite each other's allowlist forever. A key written less than `windowMs` ago is
 * not written again (the workbench enforces the lock either way; this only stops the settings-file ping-pong).
 */
export const BROWSER_SETTINGS_REWRITE_MS = 5000;
export function browserSettingsWritable(lastWrite: number | undefined, now: number, windowMs = BROWSER_SETTINGS_REWRITE_MS): boolean {
  return lastWrite === undefined || now - lastWrite >= windowMs;
}

/**
 * REQ-N11 / CGP-ART-D-008 — the safety and the minor allowlist block for one link click. A loaded
 * profile decides. Without one, this seat's saved copy decides exactly as its profile did (a minor
 * seat with a usable list stays blocked outside it). Without either, the persisted settings decide
 * as before (`linkSafety`: unknown fails closed to the integrated browser).
 * `hypeproofChat.safeLinkAllowlistEnabled === false` stays the support override in every case.
 */
export function learnerLinkPolicy(input: {
  profile: (BrowserSafetyProfileLike & { minor_cohort?: boolean }) | null | undefined;
  saved: SavedLinkSafety | null;
  persistedSafeSession: unknown;
  persistedAllowlist: unknown;
  setting: unknown;
}): { safety: BrowserSafetyConfig; enforceAllowlist: boolean } {
  const served = input.profile ?? (input.saved
    ? { minor_cohort: input.saved.minor, browser_session: { mode: input.saved.safeSession ? "safe" : "browse", allowlist: input.saved.allowlist } }
    : null);
  const safety = linkSafety(served, input.persistedSafeSession, input.persistedAllowlist);
  return { safety, enforceAllowlist: safeLinkEnforced(served, safety, input.setting) };
}

/**
 * CGP-ART-R-008 / CGP-SHELL-R-026. Order:
 *   1. anything but an absolute http(s) URL with a host is refused (javascript:, file:, data:, blob:, about:, vscode:…);
 *      userinfo (`user@`) is stripped, so the host shown and opened is the real one;
 *   2. the learner's own loopback preview opens in the integrated browser, with no dialog, for everyone;
 *   3. a safe session (minor seat) stays in the integrated browser (CGP-ART-R-008): a link the trusted lesson allowlist
 *      admits opens with no dialog, every other link asks first. Without `enforceAllowlist` (no minor flag, no usable
 *      list, or the support override `safeLinkAllowlistEnabled: false`) the list is not trusted and every link asks;
 *   4. an adult seat opens the system browser, asking first only when `confirmAdult` is on;
 *   5. a link from the preview (generated HTML) always asks, whatever the seat or setting.
 */
export function routeExternalLink(raw: unknown, safety: BrowserSafetyConfig, opts: LinkRouteOptions = {}): ExternalLinkRoute {
  if (typeof raw !== "string" || !/^https?:\/\//i.test(raw)) return { kind: "refuse" };
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return { kind: "refuse" }; }
  if (!parsed.hostname || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) return { kind: "refuse" };
  parsed.username = ""; parsed.password = "";
  const url = parsed.toString(), host = parsed.hostname;
  if (isLoopbackHost(host)) return { kind: "integrated", url };
  const preview = opts.source === "preview";
  if (safety.safeSession) {
    if (!preview && opts.enforceAllowlist && hostAllowed(parsed, safety.safeAllowlist)) return { kind: "integrated", url };
    return { kind: "confirm", url, host, where: "integrated" };
  }
  if (preview || opts.confirmAdult) return { kind: "confirm", url, host, where: "system" };
  return { kind: "system", url };
}

/** CGP-ART-D-008 — the host as the dialog and banner show it: whole up to 48 characters, middle ellipsis beyond. */
export const LINK_HOST_MAX = 48;

/**
 * CGP-SHELL-R-026 — the host as the confirm dialog shows it. `ascii` is the WHATWG hostname (IDN labels in punycode,
 * `xn--…`), middle-ellipsized past LINK_HOST_MAX; `unicode` is the decoded form when it differs; `warning` is set
 * when the host has an IDN label or a label that mixes scripts (Latin with Cyrillic, Greek, Hangul…), the usual
 * shape of a look-alike. `toUnicode` is injected (node:url `domainToUnicode` on the host) so this stays pure.
 */
export function linkHostDisplay(hostname: string, toUnicode: (h: string) => string): { ascii: string; unicode: string | null; warning: boolean } {
  const host = hostname.toLowerCase();
  let unicode: string | null = null;
  try { const u = toUnicode(host); if (u && u !== host) unicode = u; } catch { /* keep ascii */ }
  const idn = host.split(".").some((label) => label.startsWith("xn--"));
  const mixed = (unicode ?? host).split(".").some(mixedScripts);
  return { ascii: middleEllipsis(host, LINK_HOST_MAX), unicode: unicode && middleEllipsis(unicode, LINK_HOST_MAX), warning: idn || mixed };
}
const SCRIPTS: Array<[string, RegExp]> = [["Latin", /\p{Script=Latin}/u], ["Cyrillic", /\p{Script=Cyrillic}/u], ["Greek", /\p{Script=Greek}/u],
  ["Hangul", /\p{Script=Hangul}/u], ["Han", /\p{Script=Han}/u], ["Kana", /[\p{Script=Hiragana}\p{Script=Katakana}]/u], ["Arabic", /\p{Script=Arabic}/u],
  ["Hebrew", /\p{Script=Hebrew}/u], ["Armenian", /\p{Script=Armenian}/u], ["Thai", /\p{Script=Thai}/u]];
function mixedScripts(label: string): boolean {
  let n = 0;
  for (const [, re] of SCRIPTS) if (re.test(label)) n++;
  return n > 1;
}

/** CGP-SHELL-R-026 — at most one preview-originated open per `windowMs` (2 s): a generated page cannot queue prompts. */
export class LinkOpenLimiter {
  private last = -Infinity;
  private readonly windowMs: number;
  private readonly now: () => number;
  constructor(windowMs = 2000, now: () => number = Date.now) { this.windowMs = windowMs; this.now = now; }
  take(): boolean {
    const t = this.now();
    if (t - this.last < this.windowMs) return false;
    this.last = t;
    return true;
  }
}
