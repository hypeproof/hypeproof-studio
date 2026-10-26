// REQ-STUDIO-COACH-RUN-STATE (CGP-LEARN-R-016, design CGP-LEARN-D-016, PI#2).
// The chat header shows exactly one coach run state from a fixed set. It is derived from what
// the webview already holds: the send that has not opened its stream yet, the open stream, the
// approval prompts the host raised (REQ-E1), the error banner, the last terminal outcome of
// this view's turn (taskRunState.ts) and the running tool lines of the current turn in the
// unified timeline (REQ-C17). Nothing is inferred beyond those: a running tool line the
// classifier does not know reads as 생각 중, never as 찾는 중 or 만드는 중.
// Pure and vscode-free.

import type { TaskTurnOutcome } from "./taskRunState.ts";

export type CoachRunState = "ready" | "thinking" | "searching" | "creating" | "approval" | "paused" | "error";

/** The stroke icons (webview ChatIcon kinds) the run state draws. Static, never animated. */
export type CoachRunIcon = "check" | "thought" | "search" | "pencil" | "hand" | "stop" | "alert";

/** The fixed set, in the order the requirement lists it. The words are always drawn. */
export const COACH_RUN_STATES: Record<CoachRunState, { label: string; icon: CoachRunIcon }> = {
  ready: { label: "준비됨", icon: "check" },
  thinking: { label: "생각 중", icon: "thought" },
  searching: { label: "찾는 중", icon: "search" },
  creating: { label: "만드는 중", icon: "pencil" },
  approval: { label: "확인이 필요해요", icon: "hand" },
  paused: { label: "멈춤", icon: "stop" },
  error: { label: "문제가 생겼어요", icon: "alert" },
};

export interface RunStateLine {
  role: string;
  content?: string;
  tool?: { state?: string; icon?: string; label?: string };
}

/**
 * Tool-line icons the host draws (toolLineLabel.ts, toolActivity.ts workPhrase, the browser
 * loop's browserToolLogLine) that mean the coach is looking something up: reading a file,
 * finding files, the web, reading or capturing a page, opening an address.
 */
const SEARCH_ICONS = new Set(["📖", "🔍", "🌐", "👀", "📸", "🔗", "🖥️"]);
/**
 * Icons that mean the coach is changing the learner's files. A command run (⌨️) or an install (📦) may
 * only read, so it is not claimed as making.
 */
const CREATE_ICONS = new Set(["✍️", "✏️", "📝"]);

/** What one running tool line says the coach is doing. Unknown lines are thinking. */
export function toolLineRunState(tool: { icon?: string; label?: string }): "thinking" | "searching" | "creating" {
  const icon = typeof tool.icon === "string" ? tool.icon.trim() : "";
  const label = typeof tool.label === "string" ? tool.label : "";
  if (SEARCH_ICONS.has(icon)) return "searching";
  // 📝 is both "agent.md에 정리하는 중" (a write) and TodoWrite's "할 일 정리" (planning, no file).
  if (icon === "📝" && label.startsWith("할 일")) return "thinking";
  if (CREATE_ICONS.has(icon)) return "creating";
  return "thinking";
}

/**
 * The newest running tool line of the current turn, read back from the end of the timeline. The
 * walk stops at the learner's message (an earlier turn's line is never current) and at text the
 * coach wrote after it (the coach is answering again, so an older line no longer describes it). A
 * steer line mid-turn also ends the walk: the conservative reading is 생각 중 until the next tool line.
 */
export function currentToolActivity(messages: readonly RunStateLine[]): "thinking" | "searching" | "creating" {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) continue;
    if (m.role === "user") break;
    if (m.role === "assistant" && typeof m.content === "string" && m.content.trim()) break;
    if (m.role === "tool" && m.tool?.state === "running") return toolLineRunState(m.tool);
  }
  return "thinking";
}

export interface CoachRunInputs {
  /** A send left the composer and the host has not opened its stream yet. */
  preparing: boolean;
  /** A turn is streaming. */
  running: boolean;
  /** Any approval prompt the host raised is open (approvalWait or one of the approval dialogs). */
  approvalPending: boolean;
  /** The panel shows an error for the last turn. */
  error: boolean;
  /** The coach cannot take a request now: offline, or the activity is unavailable, frozen or unverified. */
  unavailable?: boolean;
  /** How this view's last turn ended; `null` when no turn ended in this view yet. */
  lastOutcome: TaskTurnOutcome;
  messages: readonly RunStateLine[];
}

/** Precedence: approval > running > preparing > error banner or unavailable > last outcome > ready. */
export function deriveCoachRunState(input: CoachRunInputs): CoachRunState {
  if (input.approvalPending) return "approval";
  if (input.running) return currentToolActivity(input.messages);
  if (input.preparing) return "thinking";
  if (input.error || input.unavailable) return "error";
  if (input.lastOutcome === "error") return "error";
  if (input.lastOutcome === "stopped") return "paused";
  return "ready";
}
