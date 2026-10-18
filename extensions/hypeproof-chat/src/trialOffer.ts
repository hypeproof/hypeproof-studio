/**
 * What the Service advertises about the personal trial before anyone enters (TUX-SP-12).
 * Pure: no VS Code API, no DOM. The host reads it; the start page renders the note.
 *
 * Contract: `GET {proxyUrl}/trial/offer`, unauthenticated, like `/purchase/products`.
 *   { entry: "code" | "open", duration_hours?: number, request_limit?: number }
 * The read carries no credential, so it can never start a trial clock or spend an attempt.
 *
 * This build implements only code entry: after "AI 체험하기" the screen asks for a code. So the
 * code line is shown whatever `entry` says, including `"open"`. Hiding it here would make the
 * card promise no code while the next screen still demands one, and every installed copy of
 * this build would keep doing that once the Service flips. The PR that ships the open-entry
 * path removes the code line in the same build. Studio never prints an allowance it did not read.
 */

export interface TrialOffer {
  entry: "code" | "open";
  durationHours?: number;
  requestLimit?: number;
}

/** The note under the "AI 체험하기" choice. The allowance is present only when the Service advertised it. */
export interface TrialEntryNote {
  code?: string;
  allowance?: string;
}

export const TRIAL_CODE_LINE = "지금은 발급받은 체험 코드가 있어야 시작할 수 있습니다.";

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
  return hoursOk && limitOk ? { entry: input.entry, durationHours: hours as number, requestLimit: limit as number } : { entry: input.entry };
}

function durationText(hours: number): string {
  const minutes = Math.round(hours * 60);
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)}일`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h && m ? `${h}시간 ${m}분` : h ? `${h}시간` : `${m}분`;
}

export function trialEntryNote(offer: TrialOffer | null | undefined): TrialEntryNote {
  // Always: this client has only the code path, so `entry: "open"` does not change the card (see header).
  const note: TrialEntryNote = { code: TRIAL_CODE_LINE };
  if (offer?.durationHours && offer.requestLimit) note.allowance = `체험 ${durationText(offer.durationHours)} · AI 요청 ${offer.requestLimit.toLocaleString("ko-KR")}번`;
  return note;
}

/** One unauthenticated read. Unreachable, unconfigured or malformed → `null` (not advertised). */
export async function fetchTrialOffer(proxyUrl: string, fetchImpl: typeof fetch = fetch): Promise<TrialOffer | null> {
  try {
    const r = await fetchImpl(`${proxyUrl.replace(/\/+$/, "")}/trial/offer`, { headers: { accept: "application/json" } });
    return r.ok ? parseTrialOffer(await r.json()) : null;
  } catch { return null; }
}
