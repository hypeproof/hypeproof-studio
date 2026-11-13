// CGP-VOICE-R-007 / CGP-VOICE-D-006 (REQ-CGPV-08 / DES-CGPV-08, VO-18 / VO-20): the agent-status
// line of the voice panel.
//
// Every line comes from one host event that actually arrived on the chat channel: a tool line the host
// posted (`toolLog`, keyed by the SDK's tool_use id), the approval wait (`approvalWait`) and the turn's
// own start, stop, end and error. The coach's prose (`streamChunk`) is never read: a reply that says
// "파일을 저장했어요" with no tool result makes no line. `끝났어요` is written only for a tool whose
// result event (`toolLog` state `done`) arrived. A tool still running when the turn ends is dropped,
// never called finished. Nothing estimates time or predicts what comes next.
//
// The words are the chat header's coach run state (coachRunState.ts) plus the host's own tool label
// (toolLineLabel.ts); no new state vocabulary. Pure and DOM-free.
import { COACH_RUN_STATES, toolLineRunState, type CoachRunIcon, type CoachRunState } from "./coachRunState.ts";
import { AGENT_TOOL_DONE } from "./voiceCopy.ts";

export type AgentStatusKind = CoachRunState | "done";

export interface AgentStatusLine {
  kind: AgentStatusKind;
  icon: CoachRunIcon;
  /** The full line. The view may clamp it; the whole text stays in its tooltip and accessible name. */
  text: string;
  /** The host event the line is derived from: the tool_use id for a tool line, else null. */
  eventId: string | null;
  /**
   * A start or finish (tool start, tool result or failure, approval waiting, stop, turn error): these
   * are announced and may be read aloud. A step update of a running tool is shown but not announced.
   */
  announce: boolean;
  /** Grows by one with every announced change, so the same words twice are still two announcements. */
  seq: number;
}

interface RunningTool { id: string; icon: string; label: string }

export interface AgentStatusState {
  /** The turn this line follows. Lines of another stream are ignored. */
  streamId: string | null;
  running: readonly RunningTool[];
  approval: boolean;
  line: AgentStatusLine | null;
  seq: number;
}

export const initialAgentStatus = (): AgentStatusState => ({ streamId: null, running: [], approval: false, line: null, seq: 0 });

/** The host messages this reads. Any other message (prose chunks included) leaves the state as it is. */
export type AgentStatusEvent =
  | { type: "streamStart"; streamId: string }
  | { type: "streamChunk"; streamId: string; delta: string }
  | { type: "toolLog"; streamId: string; id: string; icon: string; label: string; state: "running" | "done" | "error" }
  | { type: "approvalWait"; waiting: boolean }
  | { type: "streamEnd"; streamId: string; failed?: true }
  | { type: "streamStopped"; streamId: string }
  | { type: "streamError"; streamId: string }
  | { type: string; [key: string]: unknown };

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function runState(kind: CoachRunState, eventId: string | null, announce: boolean, seq: number, detail?: string): AgentStatusLine {
  const { label, icon } = COACH_RUN_STATES[kind];
  return { kind, icon, text: detail ? `${label} · ${detail}` : label, eventId, announce, seq };
}

function runningLine(tool: RunningTool, announce: boolean, seq: number): AgentStatusLine {
  return runState(toolLineRunState(tool), tool.id, announce, seq, tool.label.trim() || undefined);
}

/** After an approval is answered: the newest tool still running, else the open turn's 생각 중. */
function resumeLine(s: AgentStatusState): AgentStatusLine | null {
  const newest = s.running[s.running.length - 1];
  if (newest) return runningLine(newest, false, s.seq);
  return s.streamId ? runState("thinking", null, false, s.seq) : s.line;
}

const otherStream = (s: AgentStatusState, streamId: unknown) => s.streamId !== null && typeof streamId === "string" && streamId !== s.streamId;

export function agentStatusTransition(s: AgentStatusState, event: AgentStatusEvent): AgentStatusState {
  switch (event.type) {
    case "streamStart": {
      // A stream is open and no tool has started: the header's 생각 중, shown but not announced.
      const streamId = str(event.streamId) || null;
      return { streamId, running: [], approval: false, seq: s.seq, line: runState("thinking", null, false, s.seq) };
    }
    case "toolLog": {
      if (otherStream(s, event.streamId)) return s;
      const id = str(event.id), icon = str(event.icon), label = str(event.label);
      if (!id) return s;
      const streamId = s.streamId ?? (str(event.streamId) || null);
      const known = s.running.some((t) => t.id === id);
      if (event.state === "running") {
        const tool = { id, icon, label };
        if (known) {
          // The same call again (a step update): new words, no new announcement.
          const running = s.running.map((t) => (t.id === id ? tool : t));
          const shown = s.line?.eventId === id && !s.approval;
          return { ...s, streamId, running, line: shown ? runningLine(tool, false, s.seq) : s.line };
        }
        const seq = s.seq + 1;
        const running = [...s.running, tool];
        // An open approval keeps its line: the learner's answer is what the coach waits for.
        return { ...s, streamId, running, seq, line: s.approval ? s.line : runningLine(tool, true, seq) };
      }
      if (event.state === "done" || event.state === "error") {
        const running = s.running.filter((t) => t.id !== id);
        const seq = s.seq + 1;
        const detail = label.trim();
        const line: AgentStatusLine = event.state === "done"
          ? { kind: "done", icon: "check", text: detail ? `${detail} ${AGENT_TOOL_DONE}` : AGENT_TOOL_DONE, eventId: id, announce: true, seq }
          : runState("error", id, true, seq, detail || undefined);
        return { ...s, streamId, running, seq, line: s.approval ? s.line : line };
      }
      return s;
    }
    case "approvalWait": {
      if (event.waiting === true) {
        if (s.approval) return s;
        const seq = s.seq + 1;
        return { ...s, approval: true, seq, line: runState("approval", null, true, seq) };
      }
      if (!s.approval) return s;
      const next = { ...s, approval: false };
      return { ...next, line: resumeLine(next) };
    }
    case "streamStopped": {
      if (otherStream(s, event.streamId)) return s;
      // VO-18: a stop is not an undo. Tools that were running are dropped, never called finished.
      const seq = s.seq + 1;
      return { streamId: null, running: [], approval: false, seq, line: runState("paused", null, true, seq) };
    }
    case "streamError": {
      if (otherStream(s, event.streamId)) return s;
      const seq = s.seq + 1;
      return { streamId: null, running: [], approval: false, seq, line: runState("error", null, true, seq) };
    }
    case "streamEnd": {
      if (otherStream(s, event.streamId)) return s;
      if (event.failed === true) {
        const seq = s.seq + 1;
        return { streamId: null, running: [], approval: false, seq, line: runState("error", null, true, seq) };
      }
      // The turn ended. A tool with no result event is not called finished: its line goes; the
      // last tool result (or failure) stays as it was said.
      const keep = s.line && (s.line.kind === "done" || s.line.kind === "error") ? { ...s.line, announce: false } : null;
      return { streamId: null, running: [], approval: false, seq: s.seq, line: keep ?? runState("ready", null, false, s.seq) };
    }
    default:
      // streamChunk and everything else: prose and unrelated messages never make a status.
      return s;
  }
}
