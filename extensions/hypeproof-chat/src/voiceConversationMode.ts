// CGP-VOICE-R-026 (REQ-CGPV-38): the voice conversation's capture mode, kept per computer in the host's globalState like
// the microphone choice (micInput.ts). Automatic end of speech is the default for every seat, minors included (Jay,
// 2026-11-14); only an explicit learner choice stores `push_to_talk`. R-027's fallback never writes here: it lasts for
// the session that needed it. Pure: no vscode.

export const VOICE_CONVERSATION_MODE_KEY = "hypeproofChat.voiceConversationMode";
export type StoredConversationMode = "push_to_talk";

/** The stored mode, or null for the default (automatic). Anything else reads as the default. */
export function readConversationMode(stored: unknown): StoredConversationMode | null {
  return stored === "push_to_talk" ? "push_to_talk" : null;
}

/** What the host writes for a request: "push_to_talk", null for the default, undefined when refused (nothing changes). */
export function writeConversationMode(input: unknown): StoredConversationMode | null | undefined {
  if (input === "push_to_talk") return "push_to_talk";
  if (input === "auto") return null;
  return undefined;
}
