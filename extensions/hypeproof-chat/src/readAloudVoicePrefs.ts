// Read-aloud voice choice, the host half (Jay, 2026-11-16). Kept per computer in globalState, like the microphone
// choice: the voiceURI read with last time (a tie-breaker among equally good voices) and whether the one-time macOS
// "better Korean voice" hint was shown. Voice names and URIs are the operating system's, never a person's. Pure.

export const READ_ALOUD_VOICE_KEY = "hypeproofChat.readAloudVoice";
export const READ_ALOUD_VOICE_HINT_KEY = "hypeproofChat.readAloudVoiceHint";
const TIERS = new Set(["premium", "enhanced", "compact", "other", "novelty"]);
const URI_MAX = 256, NAME_MAX = 80;

/** Control, bidi and line separators never reach a stored value or the log. */
function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const s = value.normalize("NFC").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2028\u2029\u2066-\u2069\ufeff]/g, " ").replace(/\s+/g, " ").trim();
  return s && s.length <= max ? s : null;
}

export function readStoredVoiceUri(stored: unknown): string | null { return clean(stored, URI_MAX); }

export interface VoicePickReport { uri: string | null; name: string; tier: string; candidates: number }
/** A webview report, checked; null when it is not one (nothing is stored or logged then). */
export function acceptVoicePick(msg: { uri?: unknown; name?: unknown; tier?: unknown; candidates?: unknown }): VoicePickReport | null {
  const tier = typeof msg.tier === "string" && TIERS.has(msg.tier) ? msg.tier : msg.tier === null ? "none" : null;
  const candidates = typeof msg.candidates === "number" && Number.isInteger(msg.candidates) && msg.candidates >= 0 && msg.candidates <= 500 ? msg.candidates : null;
  if (!tier || candidates === null) return null;
  return { uri: msg.uri === null ? null : clean(msg.uri, URI_MAX), name: clean(msg.name, NAME_MAX) ?? "", tier, candidates };
}

/** The one read-only diagnostic line (kept for a problem report): the picked voice and how many Korean voices exist. */
export function voicePickLine(r: VoicePickReport): string {
  return r.tier === "none"
    ? `[voice] read-aloud: no Korean voice on this device (0 of ${r.candidates})`
    : `[voice] read-aloud voice: ${r.tier} "${r.name || "?"}", ${r.candidates} Korean voice${r.candidates === 1 ? "" : "s"} on this device`;
}
