/**
 * What the Service advertises about the personal trial before anyone enters (TUX-SP-12).
 * Pure: no VS Code API, no DOM. The host reads it; the start page renders the note.
 *
 * Contract: `GET {proxyUrl}/trial/offer`, unauthenticated, like `/purchase/products`.
 *   { entry: "code" | "open", duration_hours?: number, request_limit?: number }
 * The read carries no credential, so it can never start a trial clock or spend an attempt.
 *
 * Free start (SPEC iteration 4 §2.1): `entry: "open"` alone still means nothing to this build.
 * Only a full free-start advertisement — `entry: "open"`, `claim: "/v1/free/claim"` and an
 * `available` boolean — switches the start page to the free card (`freeStartAdvertised`). Anything
 * less (an older Service, `entry: "code"`, a failed read) leaves the free card off: the start page
 * then says free start could not be confirmed, offers a re-check, and keeps the class code entry
 * (#4193; there is no separate trial-code entry any more). Studio never prints an allowance it did not read.
 *
 * Extra fields (all optional, additive; a bad value drops that field, never the entry):
 *   unit: "turn" | "request", claim: "/v1/free/claim", min_app_version: "x.y.z",
 *   available: boolean, reason: "daily_cap" | "paused", resumes_at: ISO date.
 */

export interface TrialOffer {
  entry: "code" | "open";
  durationHours?: number;
  requestLimit?: number;
  unit?: "turn" | "request";
  /** Exactly `/v1/free/claim` when the Service lets a newcomer start without a code. */
  claim?: typeof FREE_CLAIM_PATH;
  minAppVersion?: string;
  available?: boolean;
  reason?: "daily_cap" | "paused";
  resumesAt?: string;
}

/** The only claim route this build knows how to call (Service SPEC §1.2). */
export const FREE_CLAIM_PATH = "/v1/free/claim";
/** Same bound as the Service (`VERSION_RE` in lib/trial-funnel.ts). Releases are calendar versions (`2026.1017.0`). */
const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,5}(?:-[0-9A-Za-z.]{1,16})?$/;

/** Upper bounds that keep a broken Service answer from printing nonsense. */
const MAX_HOURS = 24 * 90;
const MAX_REQUESTS = 100000;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function parseTrialOffer(input: unknown): TrialOffer | null {
  if (!isRecord(input) || (input.entry !== "code" && input.entry !== "open")) return null;
  const hours = input.duration_hours, limit = input.request_limit;
  const hoursOk = typeof hours === "number" && Number.isFinite(hours) && hours > 0 && hours <= MAX_HOURS && Math.round(hours * 60) >= 1;
  const limitOk = typeof limit === "number" && Number.isSafeInteger(limit) && limit > 0 && limit <= MAX_REQUESTS;
  // The allowance is shown only as a pair; one bad number drops both, never the entry mode.
  const offer: TrialOffer = hoursOk && limitOk ? { entry: input.entry, durationHours: hours as number, requestLimit: limit as number } : { entry: input.entry };
  if (input.unit === "turn" || input.unit === "request") offer.unit = input.unit;
  if (input.claim === FREE_CLAIM_PATH) offer.claim = FREE_CLAIM_PATH;
  if (typeof input.min_app_version === "string" && VERSION_RE.test(input.min_app_version)) offer.minAppVersion = input.min_app_version;
  if (typeof input.available === "boolean") offer.available = input.available;
  if (input.reason === "daily_cap" || input.reason === "paused") offer.reason = input.reason;
  if (typeof input.resumes_at === "string" && input.resumes_at.length <= 40 && !Number.isNaN(Date.parse(input.resumes_at))) offer.resumesAt = input.resumes_at;
  return offer;
}

/**
 * Free start is on only when the Service advertises all of it: open entry, the claim route this
 * build knows, and whether it is available today. Anything less keeps today's start page.
 */
export function freeStartAdvertised(offer: TrialOffer | null | undefined): boolean {
  return !!offer && offer.entry === "open" && offer.claim === FREE_CLAIM_PATH && typeof offer.available === "boolean";
}

/** One unauthenticated read. Unreachable, unconfigured or malformed → `null` (not advertised). */
export async function fetchTrialOffer(proxyUrl: string, fetchImpl: typeof fetch = fetch): Promise<TrialOffer | null> {
  try {
    const r = await fetchImpl(`${proxyUrl.replace(/\/+$/, "")}/trial/offer`, { headers: { accept: "application/json" } });
    return r.ok ? parseTrialOffer(await r.json()) : null;
  } catch { return null; }
}
