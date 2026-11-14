// CGP-SHELL-R-019 (REQ-SHELL-19): the learner's "팁 보기" switch for lesson tips (CGP-CHAT-R-021).
//
// One device preference in the host's globalState, like the chat text size: per learner on this
// computer, never synced, logged or sent to the Service. Off hides only the lesson tip row above the
// composer; the lesson's steps, instructions, mission header and the rail's 힌트 보기 stay as they are.
// Pure and vscode-free, so the start page's 팁 보기 row (CGP-SHELL-R-014) reads the same key.

export const LESSON_TIPS_KEY = "hypeproofChat.lessonTips";

/** Tips are on unless the learner turned them off: only a stored `false` is off. */
export function lessonTipsOn(stored: unknown): boolean {
  return stored !== false;
}

// Learner-facing copy (agent-written, decisions.md CGP-SHELL-R-019).
export const LESSON_TIPS_STOP = "팁 그만 보기";
export const LESSON_TIPS_OFF = "팁을 껐어요. 다시 보려면 다시 켜기를 눌러 주세요.";
export const LESSON_TIPS_RESUME = "다시 켜기";
export const LESSON_TIPS_ON = "팁을 다시 켰어요.";
