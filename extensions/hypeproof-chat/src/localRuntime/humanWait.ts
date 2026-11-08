// Time spent waiting for a person (an approval, a confirmation) does not spend the turn budget (#3582).
// The wait is tracked where the question is asked, so every approval and confirmation path uses one counter.

export interface HumanWait {
  /** Runs one wait for a person. It counts as waiting until the wait settles. */
  track<T>(run: () => T | Promise<T>): Promise<T>;
  /** True while at least one person is being asked. */
  active(): boolean;
}

export function createHumanWait(): HumanWait {
  let open = 0;
  return {
    async track<T>(run: () => T | Promise<T>): Promise<T> {
      open++;
      try {
        return await run();
      } finally {
        open--;
      }
    },
    active: () => open > 0,
  };
}

/**
 * Resolves with the answer, or with `denied` as soon as the turn ends. A late answer after the turn
 * has ended is therefore never acted on: the caller gets `denied` (#3582).
 */
export function answerUnlessTurnEnds<T>(answer: Promise<T>, signal: AbortSignal, denied: T): Promise<T> {
  if (signal.aborted) return Promise.resolve(denied);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => resolve(denied);
    signal.addEventListener("abort", onAbort, { once: true });
    answer.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(signal.aborted ? denied : value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * A yes/no confirmation dialog. It is true only when the person picks `yes` while the turn is still
 * running; a dialog answered after the turn ended is false, so the write it guards cannot run (#3582).
 */
export async function confirmUnlessTurnEnds(dialog: Promise<string | undefined>, signal: AbortSignal, yes: string): Promise<boolean> {
  const answer = await answerUnlessTurnEnds(dialog, signal, undefined);
  return answer === yes && !signal.aborted;
}

// ─── #3601: waits announced by Chalk (hypeproof.runtime.humanWait) ──────────────────────────────
// Chalk tells Studio when it waits for a person. Each wait has an id from Chalk, so a late end
// or keepalive for a wait that already ended is ignored. Keepalives keep a wait alive; a wait with
// no keepalive for HUMAN_WAIT_LIVENESS_MS ends by itself, so a dead Chalk cannot pause the stall watch forever.

/** Concurrent waits per turn. A fifth start is refused with `limit`. */
export const HUMAN_WAIT_MAX_CONCURRENT = 4;
/** Chalk sends a keepalive this often while a wait is open (Chalk side, same value). */
export const HUMAN_WAIT_KEEPALIVE_MS = 30_000;
/** A wait with no keepalive for this long ends (Studio side). Three keepalive intervals. */
export const HUMAN_WAIT_LIVENESS_MS = 90_000;

export type WaitSignalReason = "limit" | "stale";
export type WaitSignalResult = { ok: true } | { ok: false; reason: WaitSignalReason };

export interface ContractWaits extends HumanWait {
  start(waitId: string): WaitSignalResult;
  keepalive(waitId: string): WaitSignalResult;
  end(waitId: string): WaitSignalResult;
  /** Ends every open wait (turn closed, deactivated, cancelled). */
  endAll(): void;
  /** Number of waits currently counted. */
  open(): number;
}

export function createContractWaits(clock: { now(): number } = { now: () => Date.now() }): ContractWaits {
  const waits = new Map<string, number>(); // waitId -> last signal time
  let lastSweep = clock.now();

  // Judges liveness on the caller's clock. A clock that jumped (sleep) is refreshed, not judged.
  const sweep = (): void => {
    const now = clock.now();
    if (now - lastSweep > LIVENESS_SLEEP_GAP_MS) {
      for (const id of waits.keys()) waits.set(id, now);
    } else {
      for (const [id, last] of waits) if (now - last > HUMAN_WAIT_LIVENESS_MS) waits.delete(id);
    }
    lastSweep = now;
  };

  const ended = (): WaitSignalResult => ({ ok: false, reason: "stale" });

  return {
    async track<T>(run: () => T | Promise<T>): Promise<T> {
      const id = `track-${Math.random()}`;
      waits.set(id, clock.now());
      try {
        return await run();
      } finally {
        waits.delete(id);
      }
    },
    active() {
      sweep();
      return waits.size > 0;
    },
    start(waitId) {
      sweep();
      const now = clock.now();
      if (waits.has(waitId)) { waits.set(waitId, now); return { ok: true }; }
      if (waits.size >= HUMAN_WAIT_MAX_CONCURRENT) return { ok: false, reason: "limit" };
      waits.set(waitId, now);
      return { ok: true };
    },
    keepalive(waitId) {
      sweep();
      if (!waits.has(waitId)) return ended();
      waits.set(waitId, clock.now());
      return { ok: true };
    },
    end(waitId) {
      sweep();
      if (!waits.delete(waitId)) return ended();
      return { ok: true };
    },
    endAll() {
      waits.clear();
    },
    open() {
      sweep();
      return waits.size;
    },
  };
}

// A clock gap this large means the machine slept (same rule as the stall watch).
const LIVENESS_SLEEP_GAP_MS = 90_000;
