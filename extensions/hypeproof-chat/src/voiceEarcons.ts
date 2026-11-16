// CGP-VOICE-R-018 (REQ-CGPV-22 / VO-26): when the start and end sounds play. Pure and DOM-free.
//
// Two sources only: dictation (recording, from DictationControl) and the automatic voice conversation (its live
// session, windowVoiceLiveTask from CGP-VOICE-R-030). The coach's read-aloud is not a source: its start and end
// never make a sound. A sound only ever adds to the visual and screen-reader state; nothing depends on it.
//
// Rules: a start sounds when a source goes live, and its end sounds only after a start that sounded, so every
// session gives at most one start and one end, however fast it flaps. Nothing sounds while the switch is off or
// while the window's sound is off (소리 끄기, voiceOutputMute); an end whose start was silent stays silent.

export type EarconSource = "dictation" | "conversation";
export type Earcon = "start" | "stop";

/** One short glide per sound: start rises, end falls. Quiet, about 120 ms. */
export const EARCON_TONES: Record<Earcon, { from: number; to: number; ms: number }> = {
  start: { from: 660, to: 880, ms: 120 },
  stop: { from: 880, to: 587, ms: 120 },
};
export const EARCON_GAIN = 0.08;

export class EarconPairs {
  private readonly live = new Map<EarconSource, boolean>();
  private readonly sounded = new Map<EarconSource, boolean>();
  /** The sound to play for a change, or null. `allowed`: the switch is on and the window's sound is not off. */
  change(source: EarconSource, live: boolean, allowed: boolean): Earcon | null {
    const was = this.live.get(source) === true;
    if (live === was) return null;
    this.live.set(source, live);
    if (live) {
      this.sounded.set(source, allowed);
      return allowed ? "start" : null;
    }
    const pair = this.sounded.get(source) === true;
    this.sounded.set(source, false);
    return pair && allowed ? "stop" : null;
  }
}

/** A boolean fact of one window, memory only (like VoiceLiveTask). */
export class WindowFlag {
  private value = false;
  private readonly listeners = new Set<() => void>();
  get = (): boolean => this.value;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  set(value: boolean): void {
    if (value === this.value) return;
    this.value = value;
    for (const listener of [...this.listeners]) listener();
  }
}

/** This window's dictation: true while it records (DictationRecorder `recording`). */
export const windowDictationRecording = new WindowFlag();
