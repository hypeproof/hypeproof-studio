// REQ-STUDIO-CONTEXT-TRIM-MARKER (CGP-CHAT-R-010 / CGP-CHAT-D-010) — the transcript says so when
// older turns stop going to the model. Pure, shared by the host and the webview.
//
// Two real events, and nothing else, produce the line:
//   1. The history clamp. Every model call takes
//      modelHistory(clampTimeline(modelConversation(conversation), HISTORY_MAX))
//      (chatPanelProvider), so spoken messages older than the last HISTORY_MAX are not sent.
//      The HOST computes the boundary from the saved history it actually sends (trimBoundaryId)
//      and posts only the id; the webview places the line before that id. The webview list cannot
//      be used: it also holds failed prompts that were never saved, so it counts one too many.
//      Nothing is stored. When the conversation grows the boundary moves; there is one marker.
//   2. An agent SDK `system/compact_boundary` event inside a coach turn (the CLI summarized
//      earlier context). It is recorded as one tool line per turn (compactionLineId), the same
//      timeline data every tool line already uses; modelHistory never sends tool lines.

import type { ChatMessage } from "./protocol";
import { clampTimeline, HISTORY_MAX, modelHistory } from "./chatTimeline.ts";
import { currentVersions } from "./editResend.ts";

/** Clamp marker copy: calm, honest, no blame, no token numbers (CGP-CHAT-R16). */
export const CONTEXT_TRIM_NOTE = "대화가 길어져서 이 줄 위의 대화는 AI가 기억하지 못해요. 중요한 건 다시 말해 주세요.";
/** Compaction line copy. */
export const CONTEXT_COMPACT_NOTE = "대화가 길어져서 AI가 앞 대화를 짧게 줄여서 기억하고 있어요. 중요한 건 다시 말해 주세요.";

const COMPACTION_LINE_PREFIX = "context-compact-";

/** One id per turn: a second compaction in the same turn replaces the line instead of stacking. */
export const compactionLineId = (streamId: string): string => `${COMPACTION_LINE_PREFIX}${streamId}`;

export const isCompactionLine = (m: Pick<ChatMessage, "id" | "role">): boolean =>
  m.role === "tool" && m.id.startsWith(COMPACTION_LINE_PREFIX);

/**
 * The first spoken message the next model call still receives, when older spoken messages are left
 * out by the clamp; null when nothing is left out. Mirrors the host's model path exactly: superseded
 * versions and tool lines are not sent, so they never count.
 */
export function trimBoundaryId(messages: readonly ChatMessage[], max: number = HISTORY_MAX): string | null {
  const conversation = currentVersions(messages);
  const sent = modelHistory(clampTimeline(conversation, max));
  if (sent.length === 0 || sent.length === modelHistory(conversation).length) return null;
  return sent[0].id;
}

/** Where the marker goes in the drawn list: right before the host's boundary id; -1 when it is not drawn. */
export function trimMarkerIndex(drawn: readonly Pick<ChatMessage, "id">[], boundaryId: string | null | undefined): number {
  return boundaryId ? drawn.findIndex((m) => m.id === boundaryId) : -1;
}
