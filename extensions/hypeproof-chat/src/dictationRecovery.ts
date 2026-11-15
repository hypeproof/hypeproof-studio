// CGP-VOICE-R-015 / CGP-VOICE-D-012 (REQ-CGPV-18 / DES-CGPV-18): every dictation failure gets one recovery
// action, chosen by its cause, never by its words (the Service's sentences are shown as written).
//
// - resend ("다시 보내기"): the same clip again. Only for a failure the host marked retryable, and only while
//   the clip is still held in memory (policy 3: memory only, dropped after transcription, on dismiss, on a
//   task or seat switch, on window hide or after 10 minutes; never on disk).
// - speak_again ("다시 말하기"): a new recording. For a cause the learner can fix by speaking again.
// - type ("글로 쓰기"): close and go to the composer. For a cause speaking again will not fix.
// The permission card (denied) keeps its own settings action and is not listed here. Pure, DOM-free.

export type DictationRecovery = "resend" | "speak_again" | "type";

/**
 * A problem with the recording itself (silent, unreadable, too short, too big, too long). Sending the same clip
 * again fails the same way and spends hosted transcription each time, so only a new recording helps, even when
 * the host marks the failure retryable (it does for unreadable / voice_empty / voice_type_mismatch).
 */
const CLIP_PROBLEM = new Set(["unreadable", "too_short", "too_large", "too_long"]);
/** The microphone or the recorder: a new recording (there is no kept clip for these on the webview side). */
const SPEAK_AGAIN = new Set(["no_mic", "busy", "failed"]);

/**
 * The recovery for a cause. `retry` is the host's flag; `clipKept` whether the clip is still in memory. A clip
 * problem always asks for a new recording; otherwise a retryable failure with its clip kept resends it. An
 * unknown cause falls back to writing, which never needs the microphone or the network.
 */
export function recoveryFor(cause: string, retry: boolean, clipKept: boolean): DictationRecovery {
  if (CLIP_PROBLEM.has(cause)) return "speak_again";
  if (retry && clipKept) return "resend";
  if (SPEAK_AGAIN.has(cause)) return "speak_again";
  return "type";
}

/** DES-CGPV-18: only "too short" goes away on its own, after 8 s; every other line stays until the learner acts. */
export const TOO_SHORT_DISMISS_MS = 8_000;
export function autoDismissMs(cause: string): number | null {
  return cause === "too_short" ? TOO_SHORT_DISMISS_MS : null;
}
