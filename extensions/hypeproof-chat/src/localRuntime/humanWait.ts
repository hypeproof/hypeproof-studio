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
