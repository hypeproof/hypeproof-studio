// CGP-VOICE-R-018 (REQ-CGPV-22 / VO-26): the learner's 시작·끝 소리 switch, short sounds when dictation or the voice
// conversation starts and ends. Off by default.
//
// A personal sensory preference, not a property of the computer (the microphone choice is hardware, so that one is
// per computer). Classroom PCs are shared, so it is kept per seat, with the same seat id as 팁 보기 (CGP-SHELL-R-019,
// `collapseSeat`): the host's globalState holds the seats that turned the sounds on. A seat not on the list has them
// off, so a new learner on the same window always starts silent. An empty seat (no seat known yet) keeps its choice
// in memory only, for this window. Never synced, logged or sent to the Service. Pure and vscode-free.

/** globalState key. Its value is `{ on: string[] }`: the seats that turned the sounds on, newest last. */
export const VOICE_SOUNDS_KEY = "hypeproofChat.voiceSounds";
/** At most this many seats are remembered; the oldest drops first (it is then off again). */
export const VOICE_SOUNDS_SEATS_MAX = 200;

export interface VoiceSoundsStore { on: string[] }

/** The stored list, read back defensively: strings only, bounded, de-duplicated. Anything else is empty (all off). */
export function voiceSoundsStore(stored: unknown): VoiceSoundsStore {
  const raw = stored && typeof stored === "object" && Array.isArray((stored as { on?: unknown }).on) ? (stored as { on: unknown[] }).on : [];
  const on = [...new Set(raw.filter((s): s is string => typeof s === "string" && s.length > 0 && s.length <= 256))];
  return { on: on.slice(-VOICE_SOUNDS_SEATS_MAX) };
}

/** Sounds are off for a seat unless that seat turned them on. An empty seat reads `memoryOn` instead. */
export function voiceSoundsOn(stored: unknown, seat: string, memoryOn = false): boolean {
  if (!seat) return memoryOn;
  return voiceSoundsStore(stored).on.includes(seat);
}

/** The new stored value after `seat` turns the sounds on or off. Never called for an empty seat (memory only). */
export function withVoiceSounds(stored: unknown, seat: string, on: boolean): VoiceSoundsStore {
  const list = voiceSoundsStore(stored).on.filter((s) => s !== seat);
  if (on) list.push(seat);
  return { on: list.slice(-VOICE_SOUNDS_SEATS_MAX) };
}

/** The host's view of the switch, like LessonTipsPreference: `forSeat` on every config build, `on`, `write`. */
export class VoiceSoundsPreference {
  private seat = "";
  private memoryOn = false;
  get currentSeat(): string { return this.seat; }
  /** A different seat starts with its own stored choice; an in-memory choice never carries over. */
  forSeat(seat: string): void {
    if (seat !== this.seat) { this.seat = seat; this.memoryOn = false; }
  }
  on(stored: unknown): boolean { return voiceSoundsOn(stored, this.seat, this.memoryOn); }
  /** The value to store for this seat, or undefined when nothing may be stored (an empty seat: memory only). */
  write(stored: unknown, on: boolean): VoiceSoundsStore | undefined {
    if (!this.seat) { this.memoryOn = on; return undefined; }
    return withVoiceSounds(stored, this.seat, on);
  }
}

// Learner-facing copy (agent-written, decisions/CGP-VOICE-R-018.md).
export const VOICE_SOUNDS_SETTING = "시작·끝 소리 내기";
export const VOICE_SOUNDS_SETTING_HINT = "받아쓰기와 음성 대화가 시작하고 끝날 때 짧은 소리를 내요.";
