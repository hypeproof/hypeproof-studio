// Host half of dictation: the one place that sends audio to the Service. The chat webview's CSP allows
// no network, so the webview hands a finished clip here and gets text (or a calm refusal) back.
//
// The audio lives in this function's arguments and nowhere else: it is not written to disk, not put in
// a log line, not kept after the answer. What this file reports onward is metadata only (a result kind
// and an HTTP status), never audio, never transcript. Pure of vscode so the tests can run it.
import { SERVICE_MAX_BYTES, SERVICE_MAX_SECONDS } from "./voiceDictation.ts";
import { CLASS_OFF, GENERIC_UNAVAILABLE, NETWORK, SOFT_UNREADABLE, TOO_LARGE, UNSUPPORTED } from "./voiceCopy.ts";

/** What the webview may ask for. Anything else is refused before a request is built. */
export interface TranscribeRequest { mime: unknown; seconds: unknown; audio: unknown }

export type TranscribeKind =
  | "cap"          // a spend cap: calm, no retry, text keeps working
  | "busy"         // another clip of this seat is in flight
  | "class_off"    // the class has voice off or no consent: the webview shows the D-018 state
  | "unavailable"  // kill switch, provider down, endpoint absent
  | "unreadable"   // the Service could not read the clip, or it held no words
  | "too_long" | "too_large" | "unsupported"
  | "network"
  | "auth"
  | "other";

export type TranscribeResult =
  | { ok: true; text: string }
  | { ok: false; kind: TranscribeKind; message: string; retry: boolean };

const MIMES: Record<string, true> = { "audio/webm": true, "audio/ogg": true };

function fail(kind: TranscribeKind, message: string, retry = false): TranscribeResult { return { ok: false, kind, message, retry }; }

/** A Service refusal body, `{ error: { type: "voice", code, message } }`, or null when it is anything else. */
function refusalOf(body: unknown): { code: string; message: string; retry: boolean } | null {
  const error = typeof body === "object" && body !== null ? (body as { error?: unknown }).error : null;
  if (typeof error !== "object" || error === null) return null;
  const { code, message, retry } = error as { code?: unknown; message?: unknown; retry?: unknown };
  if (typeof code !== "string" || !/^[a-z_]{1,48}$/.test(code)) return null;
  return { code, message: typeof message === "string" ? message.slice(0, 300) : "", retry: retry !== false };
}

/**
 * POST one clip to `<proxy>/voice/transcribe` as the seat. The Service's calm Korean refusals are
 * passed through as written (cap, busy, too long); a clip it cannot read, or that held no words, gets a
 * softer line of ours. Never throws.
 */
export async function transcribeClip(
  args: { proxyUrl: string; token: string; request: TranscribeRequest; fetchImpl?: typeof fetch },
): Promise<TranscribeResult> {
  const { mime, seconds, audio } = args.request;
  if (typeof mime !== "string" || !MIMES[mime]) return fail("unsupported", UNSUPPORTED);
  if (typeof seconds !== "number" || !Number.isInteger(seconds) || seconds < 1 || seconds > SERVICE_MAX_SECONDS) return fail("too_long", "한 번에 1분까지만 말할 수 있어요.");
  if (typeof audio !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) return fail("unreadable", SOFT_UNREADABLE, true);
  // base64 length bounds the decoded size before anything is allocated.
  if (Math.floor(audio.length * 3 / 4) > SERVICE_MAX_BYTES + 3) return fail("too_large", TOO_LARGE);
  const bytes = Buffer.from(audio, "base64");
  if (bytes.length === 0) return fail("unreadable", SOFT_UNREADABLE, true);
  if (bytes.length > SERVICE_MAX_BYTES) return fail("too_large", TOO_LARGE);

  let response: Response;
  try {
    response = await (args.fetchImpl ?? fetch)(args.proxyUrl.replace(/\/$/, "") + "/voice/transcribe", {
      method: "POST",
      headers: { authorization: `Bearer ${args.token}`, "content-type": mime, "x-hps-audio-seconds": String(seconds) },
      body: bytes,
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    return fail("network", NETWORK, true);
  }

  let body: unknown = null;
  try { body = await response.json(); } catch { /* not JSON: handled by status below */ }

  if (response.ok) {
    const text = typeof body === "object" && body !== null ? (body as { text?: unknown }).text : undefined;
    if (typeof text !== "string") return fail("other", GENERIC_UNAVAILABLE, true);
    // A silent clip comes back as no words at all.
    if (!text.trim()) return fail("unreadable", SOFT_UNREADABLE, true);
    return { ok: true, text: text.trim() };
  }

  if (response.status === 401) return fail("auth", "연결이 끊어졌어요. 다시 로그인한 뒤 해 보세요. 글로는 계속 이야기할 수 있어요.");
  const refusal = refusalOf(body);
  if (!refusal) return fail("other", GENERIC_UNAVAILABLE, response.status >= 500);
  switch (refusal.code) {
    case "voice_cap_reached": return fail("cap", refusal.message || "오늘 쓸 수 있는 음성 받아쓰기를 다 썼어요. 글로는 계속 이야기할 수 있어요.");
    case "voice_busy": return fail("busy", refusal.message || "지금 다른 받아쓰기가 끝나길 기다리고 있어요. 잠시 뒤에 다시 해 주세요.");
    case "voice_off": case "voice_consent_required": return fail("class_off", refusal.message || CLASS_OFF);
    case "voice_minors_disabled": case "voice_disabled": case "voice_provider_not_configured": case "voice_unavailable": case "not_found":
      return fail("unavailable", refusal.message || GENERIC_UNAVAILABLE);
    case "voice_unreadable": case "voice_empty": case "voice_type_mismatch": return fail("unreadable", SOFT_UNREADABLE, true);
    case "voice_too_long": return fail("too_long", refusal.message || "한 번에 1분까지만 말할 수 있어요.");
    case "voice_too_large": return fail("too_large", refusal.message || TOO_LARGE);
    case "voice_unsupported_type": return fail("unsupported", refusal.message || UNSUPPORTED);
    case "voice_provider_unavailable": return fail("unavailable", refusal.message || GENERIC_UNAVAILABLE, true);
    default: return fail("other", GENERIC_UNAVAILABLE, response.status >= 500);
  }
}

/**
 * The OS privacy pane for the microphone. The URI is chosen here from the platform; nothing from the
 * webview ever reaches it (CGP-VOICE-R-003). Null where Studio does not know the pane.
 */
export function micSettingsUri(platform: string): string | null {
  if (platform === "darwin") return "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";
  if (platform === "win32") return "ms-settings:privacy-microphone";
  return null;
}

/**
 * Which policy versions each seat has read the disclosure for (policy 5: once per account and policy version).
 * One record keyed by the seat's own scope (the activity connection plus profile id), so on a shared laptop each
 * child's seat sees the sheet once. Metadata only: a seat key and version strings, never audio or text.
 */
export const VOICE_DISCLOSURE_KEY = "hps.voice.disclosure.bySeat";
const VERSION = /^[a-z0-9-]+\/[0-9]+$/;
const SEAT_MAX = 64;
export function seatKeyOf(scope: unknown, profileId: unknown): string {
  return `${typeof scope === "string" ? scope : ""}|${typeof profileId === "string" ? profileId : ""}`.slice(0, 200);
}
function recordOf(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, SEAT_MAX)) {
    if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === "string" && VERSION.test(x)).slice(0, 20);
  }
  return out;
}
export function readAcknowledged(raw: unknown, seat: string): string[] { return recordOf(raw)[seat] ?? []; }
export function withAcknowledged(raw: unknown, seat: string, version: string): Record<string, string[]> {
  const rec = recordOf(raw);
  const list = rec[seat] ?? [];
  delete rec[seat]; // re-inserted last, so the oldest seats fall off first
  rec[seat] = list.includes(version) ? list : [...list, version].slice(-20);
  const keys = Object.keys(rec);
  for (const k of keys.slice(0, Math.max(0, keys.length - SEAT_MAX))) delete rec[k];
  return rec;
}
