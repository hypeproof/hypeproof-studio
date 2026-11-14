// CGP-VOICE-R-007 / CGP-VOICE-D-006 (REQ-CGPV-08 / DES-CGPV-08): the agent-status line under the
// voice panel's state label.
//
// The line is derived by `agentStatusTransition` from host messages only (src/voiceAgentStatus.ts). The
// view adds three things:
//   - pacing: the visible line changes at most once per `intervalMs` (1 s); the newest event wins;
//   - announcing: one polite status region, filled only for a start or a finish, once per change;
//   - reading aloud: the same start or finish goes to the window's read-aloud hub, which the panel's
//     owner passes only when the Service serves read-aloud (useServedReadAloud), never while 소리 끄기 is on, and never over an answer the learner is
//     listening to. A failed reading is said on its own line, apart from any tool failure (VO-20).
// The icon is static in every motion mode (no spinner), as the header's run state is.
import { useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { ChatIcon } from "./ChatDetails";
import { onHostMessage } from "./vscode";
import { agentStatusTransition, initialAgentStatus, type AgentStatusEvent, type AgentStatusLine } from "../../src/voiceAgentStatus";
import { AGENT_STATUS_LABEL, AGENT_STATUS_SPEECH_FAILED } from "../../src/voiceCopy";
import type { OutputMute } from "../../src/voiceOutputMute";
import type { ReadAloud } from "../../src/voiceReadAloud";

/** The hub id status readings use, so an answer's button never thinks it is the one playing. */
export const AGENT_STATUS_SPEECH_ID = "voice-agent-status";

export type AgentEventSource = (listener: (event: AgentStatusEvent) => void) => () => void;

/** The chat channel the host posts on: the same messages ChatPanel draws the timeline from. */
export const hostAgentEvents: AgentEventSource = (listener) => onHostMessage((m) => listener(m as AgentStatusEvent));

const IDLE = { kind: "idle" } as const;
const idleStore = { subscribe: () => () => {}, getStatus: () => IDLE };

/** The reducer state follows every host event; `shown` follows it at most once per interval. */
export function useAgentStatus(source: AgentEventSource, intervalMs: number): AgentStatusLine | null {
  const [state, dispatch] = useReducer(agentStatusTransition, undefined, initialAgentStatus);
  useEffect(() => source(dispatch), [source]);
  const [shown, setShown] = useState<AgentStatusLine | null>(null);
  const lastAt = useRef(-Infinity);
  useEffect(() => {
    const line = state.line;
    if (line === shown) return;
    const wait = lastAt.current + intervalMs - Date.now();
    const show = () => { lastAt.current = Date.now(); setShown(line); };
    if (wait <= 0) { show(); return; }
    const timer = setTimeout(show, wait);
    return () => clearTimeout(timer);
  }, [state.line, shown, intervalMs]);
  return shown;
}

/**
 * Announcing and reading aloud, owned by the panel (not by the drawn line) so collapsing or expanding
 * the panel never repeats an announcement or a reading.
 */
export function useAgentStatusVoice(line: AgentStatusLine | null, output: OutputMute, hub: ReadAloud | null): { announced: string; speechFailed: boolean } {
  const store = hub ?? idleStore;
  const status = useSyncExternalStore(store.subscribe, store.getStatus, store.getStatus);
  // A refused start (autoplay `blocked`, CGP-VOICE-R-028) is a failed reading too: the status was not heard (VO-20).
  const speechFailed = (status.kind === "error" || status.kind === "blocked") && status.id === AGENT_STATUS_SPEECH_ID;

  const [announced, setAnnounced] = useState("");
  const lastSeq = useRef<number | null>(null);
  useEffect(() => {
    if (!line || !line.announce || line.seq === lastSeq.current) return;
    lastSeq.current = line.seq;
    setAnnounced(line.text);
    if (!hub || output.getMuted()) return;
    const now = hub.getStatus();
    // The learner chose to hear an answer: a status never cuts it off. Nor does it replace a blocked
    // answer: play() would stop the hub and drop the unheard chunks its 소리 켜기 reads (CGP-VOICE-R-028).
    if ((now.kind === "playing" || now.kind === "blocked") && now.id !== AGENT_STATUS_SPEECH_ID) return;
    hub.play(AGENT_STATUS_SPEECH_ID, line.text);
  }, [line, hub, output]);
  // A reading still going when the panel leaves is stopped with it.
  useEffect(() => () => { const s = hub?.getStatus(); if (hub && s?.kind === "playing" && s.id === AGENT_STATUS_SPEECH_ID) hub.stop(); }, [hub]);
  return { announced, speechFailed };
}

/** The drawn line: icon and words, clamped to two lines on screen; the DOM and the tooltip hold the whole text. */
export function VoiceAgentStatusLine({ line }: { line: AgentStatusLine | null }) {
  if (!line) return null;
  return (
    <p className="hps-voice-agent-status" data-agent-status={line.kind} data-hp-tooltip={line.text}>
      <ChatIcon kind={line.icon} size={16} />
      <span className="hps-sr-only">{AGENT_STATUS_LABEL}: </span>
      <span className="hps-voice-agent-status-text">{line.text}</span>
    </p>
  );
}

/** One polite region for starts and finishes, and the separate line for a failed reading. */
export function VoiceAgentStatusAnnouncer({ announced, speechFailed }: { announced: string; speechFailed: boolean }) {
  return (
    <>
      {speechFailed && <p className="hps-voice-agent-speech-failed" role="status">{AGENT_STATUS_SPEECH_FAILED}</p>}
      <span className="hps-sr-only" role="status" data-agent-status-announcer="">{announced}</span>
    </>
  );
}
