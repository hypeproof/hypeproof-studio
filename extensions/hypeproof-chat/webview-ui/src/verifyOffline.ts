import { OFFLINE_HELD_NOTES } from './connectivity';

/**
 * CGP-SHELL-R-011 N1 — the product test (내 제품 테스트) when the network is gone. The host records
 * the criteria (or the fix request) before it hands the turn back. A turn the webview cannot send
 * is parked on the host (`verifyPark`), so no unrelated message carries its context. The learner's
 * next press of the same button resumes it (`verifyResume`) without recording anything again; any
 * other press starts fresh. Press keys are `start:<criteria JSON>` and `fix:<[id, text] JSON>`.
 */
export function verifyPressAction(parkedKey: string | null, pressKey: string): 'resume' | 'fresh' {
  return parkedKey !== null && parkedKey === pressKey ? 'resume' : 'fresh';
}

/** The panel's message slot: the held note while held, otherwise the host's own error. */
export function verifyNote(held: boolean, hostError: string | null): string | null {
  return held ? OFFLINE_HELD_NOTES.press : hostError;
}
