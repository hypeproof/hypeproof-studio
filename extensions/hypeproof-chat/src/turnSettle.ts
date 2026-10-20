// CGP-CHAT-R-012 (REQ-STUDIO-STEER-NOW) — a stopped turn says so at once (`streamStopped`), but it
// keeps the work-folder lock until its own cleanup ends: saving the partial answer, observation
// writes and the folder scan. A send that follows a Stop at machine speed ("지금 방향 바꾸기", or a
// quick Stop then Send) would hit that lock and be refused as "다른 창에서 이 폴더를 사용 중입니다".
// The host therefore starts each turn only after the previous one settled, waiting at most
// TURN_SETTLE_WAIT_MS. If the previous turn is still settling after that, a turn that needs the folder
// lock is refused with TURN_SETTLING_REFUSAL (the lock would refuse it as "another window", which is
// false: it is this window's own stopped turn).
//
// No vscode import: test/steer-settle.smoke.mjs drives it directly and through the provider.

export const TURN_SETTLE_WAIT_MS = 15_000;

/** Learner-facing (Korean is the product): the same sentence task switching uses for this window. */
export const TURN_SETTLING_REFUSAL = "중단한 응답을 정리하고 있어요. 잠시 후 다시 시도해 주세요. 작성 중인 내용은 유지됩니다.";

/**
 * Resolves when `previous` settles (either way) or after `ms`, whichever comes first: true when the
 * previous turn settled, false when the wait ran out.
 */
export function waitAtMost(previous: Promise<unknown> | undefined, ms = TURN_SETTLE_WAIT_MS): Promise<boolean> {
  if (!previous) return Promise.resolve(true);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const capped = new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), ms); });
  return Promise.race([previous.then(() => true, () => true), capped]).finally(() => clearTimeout(timer));
}

/** One turn's settle signal: `settled` resolves it; calling it again is harmless. */
export function turnSettleSignal(): { promise: Promise<void>; settled: () => void } {
  let settled = () => {};
  const promise = new Promise<void>((resolve) => { settled = resolve; });
  return { promise, settled };
}
