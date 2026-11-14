// CGP-SHELL-R-019 (REQ-SHELL-19): the learner's "팁 보기" switch for lesson tips (CGP-CHAT-R-021).
//
// A preference of one learner, not of the computer. Classroom PCs are shared, so it is kept per seat:
// the host's globalState holds the list of seats that turned tips off on this computer (the same seat id
// as the collapsed learning blocks, `collapseSeat` in lessonFocus.ts). A seat not on the list sees
// tips, so a new learner on the same window always starts with tips on. An empty seat (a local or dev
// runtime, or an instructor profile without a seat id) is not one learner: its choice lives in memory
// only. Never synced, logged or sent to the Service.
//
// Off hides only the lesson tip row above the composer; the lesson's steps, instructions, mission header
// and the rail's 힌트 보기 stay as they are. Pure and vscode-free, so the start page's 팁 보기 row
// (CGP-SHELL-R-014) uses the same key and helpers.

/** globalState key. Its value is `{ off: string[] }`: the seats that turned tips off, newest last. */
export const LESSON_TIPS_KEY = "hypeproofChat.lessonTips";
/** At most this many seats are remembered; the oldest drops first (it then sees tips again). */
export const LESSON_TIPS_SEATS_MAX = 200;

export interface LessonTipsStore { off: string[] }

/** The stored list, read back defensively: strings only, bounded, de-duplicated. Anything else is empty. */
export function lessonTipsStore(stored: unknown): LessonTipsStore {
  const raw = stored && typeof stored === "object" && Array.isArray((stored as { off?: unknown }).off) ? (stored as { off: unknown[] }).off : [];
  const off = [...new Set(raw.filter((s): s is string => typeof s === "string" && s.length > 0 && s.length <= 256))];
  return { off: off.slice(-LESSON_TIPS_SEATS_MAX) };
}

/** Tips are on for a seat unless that seat turned them off. An empty seat reads `memoryOff` instead. */
export function lessonTipsOn(stored: unknown, seat: string, memoryOff = false): boolean {
  if (!seat) return !memoryOff;
  return !lessonTipsStore(stored).off.includes(seat);
}

/** The new stored value after `seat` turns tips on or off. Never called for an empty seat (memory only). */
export function withLessonTips(stored: unknown, seat: string, on: boolean): LessonTipsStore {
  const off = lessonTipsStore(stored).off.filter((s) => s !== seat);
  if (!on) off.push(seat);
  return { off: off.slice(-LESSON_TIPS_SEATS_MAX) };
}

/**
 * The host's view of the switch: which seat the current chat belongs to and an empty seat's in-memory choice.
 * The provider calls `forSeat` on every config build, `on` for the config and `write` for a learner's press.
 */
export class LessonTipsPreference {
  private seat = "";
  private memoryOff = false;
  /** The seat the last config was built for ("" when none is known). */
  get currentSeat(): string { return this.seat; }
  /** A different seat starts with its own stored choice; an in-memory choice never carries over. */
  forSeat(seat: string): void {
    if (seat !== this.seat) { this.seat = seat; this.memoryOff = false; }
  }
  on(stored: unknown): boolean { return lessonTipsOn(stored, this.seat, this.memoryOff); }
  /** The value to store for this seat, or undefined when nothing may be stored (an empty seat: memory only). */
  write(stored: unknown, on: boolean): LessonTipsStore | undefined {
    if (!this.seat) { this.memoryOff = !on; return undefined; }
    return withLessonTips(stored, this.seat, on);
  }
}

// Learner-facing copy (agent-written, decisions.md CGP-SHELL-R-019).
export const LESSON_TIPS_STOP = "팁 그만 보기";
export const LESSON_TIPS_OFF = "팁을 껐어요. 다시 보려면 다시 켜기를 눌러 주세요.";
export const LESSON_TIPS_RESUME = "다시 켜기";
