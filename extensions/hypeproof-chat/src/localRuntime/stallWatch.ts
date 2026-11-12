// #3601 — no-progress stall watch for the local runner turn. It replaces the fixed 180 s turn budget.
// The same rule as the SDK path (sdkCoachHelpers.ts consumeSdkStream): progress = any model stream line
// and tool start/end. Paused = a person is being asked (approval, mail question, Chalk humanWait) or a tool
// ran within one budget. After a pause ends there is one more budget of grace (sawPause).
// The stall message is the SDK's stallNotice, so a stall reads the same on both paths.
import { stallNotice } from "../coachIdentity.ts";

/** Default when the setting is missing: the same value as the SDK path (sdkCoachHelpers SDK_STREAM_STALL_MS). */
export const LOCAL_DEFAULT_STALL_MS = 240_000;
/** A tick gap larger than this is read as the machine sleeping: no judgment on that tick. */
export const LOCAL_SLEEP_GAP_MS = 90_000;

/** The error the turn ends with after a stall. `name` is what chatPanelHelpers classifies as "stall". */
export class CoachStallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoachStallError";
  }
}

let stallProvider: () => unknown = () => LOCAL_DEFAULT_STALL_MS;

/** Set once by the extension: reads hypeproofChat.sdkStallTimeoutMs (the same setting for both paths). */
export function setLocalStallTimeoutProvider(read: () => unknown): void {
  stallProvider = read;
}

/** The current stall budget in ms. 0 = off. A missing or invalid value uses the default. */
export function localStallTimeoutMs(): number {
  const value = stallProvider();
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : LOCAL_DEFAULT_STALL_MS;
}

export interface StallClock {
  now(): number;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}

export interface StallWatch {
  /** Aborts when the turn stalls. Its reason is a CoachStallError. */
  readonly signal: AbortSignal;
  /** A model stream line or any other visible progress. */
  progress(): void;
  /** A tool call started. It counts as paused for one budget. */
  toolStarted(): void;
  /** A tool call ended. Counts as progress. */
  toolEnded(): void;
  stalled(): boolean;
  dispose(): void;
}

const systemClock: StallClock = {
  now: () => Date.now(),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
};

export function createStallWatch(opts: {
  stallMs: number;
  /** True while a person is being asked (approval, mail question, Chalk humanWait). */
  isPaused: () => boolean;
  clock?: StallClock;
  message?: string;
}): StallWatch {
  const controller = new AbortController();
  const clock = opts.clock ?? systemClock;
  const stallMs = opts.stallMs;
  let stalledNow = false;
  let progressAt = clock.now();
  let lastTick = clock.now();
  let lastToolAt: number | undefined;
  // True from the last tick that saw a pause until the first tick after it. That first tick starts the grace.
  let wasBlocked = false;
  let timer: unknown;

  const blocked = (now: number): boolean =>
    opts.isPaused() || (lastToolAt !== undefined && now - lastToolAt < stallMs);

  const tick = (): void => {
    if (stalledNow || controller.signal.aborted) return;
    const now = clock.now();
    const gap = now - lastTick;
    lastTick = now;
    if (gap > LOCAL_SLEEP_GAP_MS) {
      // The machine slept or the host stalled: refresh the clock, judge nothing on this tick.
      progressAt = now;
      return;
    }
    if (blocked(now)) {
      wasBlocked = true;
      progressAt = now;
      return;
    }
    if (wasBlocked) {
      // The pause has just ended: one full budget of grace counts from this moment.
      wasBlocked = false;
      progressAt = now;
    }
    if (now - progressAt < stallMs) return;
    stalledNow = true;
    controller.abort(new CoachStallError(opts.message ?? stallNotice()));
  };

  if (stallMs > 0) {
    const interval = Math.min(1000, Math.max(1, Math.floor(stallMs / 10)));
    timer = clock.setInterval(tick, interval);
  }

  return {
    signal: controller.signal,
    progress() {
      progressAt = clock.now();
    },
    toolStarted() {
      lastToolAt = clock.now();
      progressAt = clock.now();
    },
    toolEnded() {
      progressAt = clock.now();
    },
    stalled: () => stalledNow,
    dispose() {
      if (timer !== undefined) clock.clearInterval(timer);
      timer = undefined;
    },
  };
}
