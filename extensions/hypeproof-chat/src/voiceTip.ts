// CGP-VOICE-R-029 (REQ-CGPV-42 / DES-CGPV-42) — the voice discoverability tip, at most once per seat.
//
// Classroom PCs are shared, so "once" belongs to a seat, not to the computer: the host's globalState keeps
// the seats that have already been shown the tip (the same seat id as 팁 보기, CGP-SHELL-R-019). A seat
// that turned tips off never sees it, an empty seat (no seat known yet) never sees it, and it is never
// shown mid-task: only while the current task has no messages. Pure and vscode-free.

/** globalState key. Its value is `{ seen: string[] }`: the seats already shown the tip, newest last. */
export const VOICE_TIP_KEY = "hypeproofChat.voiceTip";
/** At most this many seats are remembered; the oldest drops first. */
export const VOICE_TIP_SEATS_MAX = 200;

export interface VoiceTipStore { seen: string[] }

/** The stored list, read back defensively: strings only, bounded, de-duplicated. Anything else is empty. */
export function voiceTipStore(stored: unknown): VoiceTipStore {
  const raw = stored && typeof stored === "object" && Array.isArray((stored as { seen?: unknown }).seen) ? (stored as { seen: unknown[] }).seen : [];
  const seen = [...new Set(raw.filter((s): s is string => typeof s === "string" && s.length > 0 && s.length <= 256))];
  return { seen: seen.slice(-VOICE_TIP_SEATS_MAX) };
}

/**
 * Is the tip due for this seat now? Only a known seat, with tips on, at the start of a task, never for an
 * instructor; and either not yet shown, or shown in this window and not closed yet (`openSeat`: a panel remount
 * in the same window keeps an open tip, like 새로운 기능).
 */
export function voiceTipDue(stored: unknown, input: { seat: string; tipsOn: boolean; taskEmpty: boolean; instructor: boolean; openSeat?: string }): boolean {
  if (!input.seat || !input.tipsOn || !input.taskEmpty || input.instructor) return false;
  return input.openSeat === input.seat || !voiceTipStore(stored).seen.includes(input.seat);
}

/** The new stored value once `seat` has been shown the tip (or closed it). Never called for an empty seat. */
export function withVoiceTipSeen(stored: unknown, seat: string): VoiceTipStore {
  const seen = voiceTipStore(stored).seen.filter((s) => s !== seat);
  seen.push(seat);
  return { seen: seen.slice(-VOICE_TIP_SEATS_MAX) };
}

// Learner-facing copy (agent-written, decisions/CGP-VOICE-R-029.md). At most two lines at 320px.
export const VOICE_TIP_TEXT = "음성 대화를 누르면 말로 코치와 이야기할 수 있어요.";
export const VOICE_TIP_CLOSE = "음성 대화 팁 닫기";
