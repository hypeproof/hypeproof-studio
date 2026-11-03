// CGP-CHAT-R-012 (REQ-STUDIO-STEER-NOW) — "지금 방향 바꾸기": the learner has parked a message while
// the AI is answering (#416) and wants it to go now. Neither the proxy nor the Agent SDK path takes
// input into a running turn, so steering is: stop the current turn through the existing Stop path
// (cancelStream; the host aborts and posts streamStopped, so the partial answer stays on screen and
// the turn counts as stopped, including for the finish notice), then send the parked text as the
// next turn from the same stream-end edge that already sends parked messages.
//
// The press itself never sends. Sending happens only on the streaming → idle edge, which fires
// once per turn, so a natural end racing the press still sends exactly once: whichever way the
// turn ends, the same edge sends the parked text and clears it.
//
// DOM-free and vscode-free: imported by ChatPanel.tsx and by test/steer-now.test.tsx.

/** Learner-facing copy (Korean is the product; see CLAUDE.md §Language). */
export const STEER_LABEL = "지금 방향 바꾸기";
/** The button while the stop is on its way. */
export const STEER_STOPPING_LABEL = "멈추는 중…";
/** The stopped marker drawn after the partial answer once the parked message went out. */
export const STEER_STOPPED_MARK = "여기서 답변을 멈추고 새 메시지를 보냈어요.";
/** Offline at the press: nothing is stopped and nothing is sent; the parked message stays. */
export const STEER_OFFLINE_NOTE = "지금은 인터넷이 끊겨서 답변을 멈추지 않았어요. 다음에 보낼 메시지는 그대로 있어요.";
/** The stop did not land in time: the parked message stays and still goes when the turn ends. */
export const STEER_STOP_FAILED_NOTE = "답변을 멈추지 못했어요. 다음에 보낼 메시지는 그대로 있고, 답변이 끝나면 보내요.";

/** How long a pending steer waits for the stream to end before it gives up (the queue stays). */
export const STEER_STOP_TIMEOUT_MS = 15_000;

export type SteerOfferArgs = {
  streaming: boolean;
  /** The parked message (#416), if any. */
  queued: string | null;
  /** A paused item ("보관한 메시지") was refused before; it is not a live parked message. */
  queuedPaused: boolean;
  /** A product test holds the tab, or the panel cannot send at all. */
  sendLocked?: boolean;
  unavailable?: boolean;
};

/** The action exists only on a live parked message while a turn is streaming. */
export function steerOffered(args: SteerOfferArgs): boolean {
  return args.streaming && !!args.queued?.trim() && !args.queuedPaused && !args.sendLocked && !args.unavailable;
}

export type SteerPress = "stop" | "hold" | "ignore";

/**
 * What a press does. Offline it holds (no stop, no send) so the learner does not lose the running
 * answer for a message that could not go anyway. A second press while a stop is pending is ignored.
 */
export function steerPress(args: { offered: boolean; online: boolean; pending: boolean }): SteerPress {
  if (!args.offered || args.pending) return "ignore";
  return args.online ? "stop" : "hold";
}

export type SteerEnd = {
  /**
   * The value the existing queue rules (sendQueue.ts shouldFlushQueue / shouldRestoreQueue) get as
   * `cutOff`. The learner's own stop for a steer is not a cut-off: the parked text is sent. A failed
   * turn still is: the text goes back to the draft, as it does today.
   */
  cutOff: boolean;
  /** The turn ended by the stop (not naturally, not failed): mark the partial answer as stopped. */
  stoppedHere: boolean;
};

/**
 * On the streaming → idle edge with a steer pending, how the queue rules should treat this end.
 * Null when it is not that edge or no steer is pending: the queue rules apply unchanged.
 */
export function steerAtEnd(
  prevStreaming: boolean,
  streaming: boolean,
  pending: boolean,
  stopped: boolean,
  failed: boolean,
): SteerEnd | null {
  if (!pending || !prevStreaming || streaming) return null;
  return { cutOff: failed, stoppedHere: stopped && !failed };
}

/** Shown after the partial answer while the parked text is on its way and the host has not taken it yet. */
export const STEER_SENDING_MARK = "여기서 답변을 멈췄어요. 새 메시지를 보내는 중이에요.";

/**
 * The stopped marker of one steered turn. `sent` turns true only when the host starts the turn that
 * answers the steered request itself (its `streamStart` names that request's `userMessageId`), never
 * when the webview posts it and never on another turn's start (an app reply): a refused send
 * (inputRejected, an error before the turn starts) must not leave "보냈어요" on screen.
 */
export type SteerMark = {
  /** The item the marker follows. */
  id: string;
  sent: boolean;
  /** Transcript length when the steered text went out: its own user line is the first one from here. */
  from: number;
};

type Item = { id: string; role: string };

/**
 * Which item the marker follows: the last item of the stopped turn. None when the stop landed before
 * any answer, so the last item is the learner's own line.
 */
export function steerMarkTarget(items: ReadonlyArray<Item>): string | undefined {
  const last = items.at(-1);
  return last && last.role !== "user" ? last.id : undefined;
}

/** A turn started for request `startedFor`: mark sent only the markers whose own steered request it is. */
export function steerMarksAccept(marks: SteerMark[], items: ReadonlyArray<Item>, startedFor: string | null | undefined): SteerMark[] {
  if (!startedFor || !marks.some((m) => !m.sent)) return marks;
  let changed = false;
  const next = marks.map((m) => {
    if (m.sent || items.slice(m.from).find((it) => it.role === "user")?.id !== startedFor) return m;
    changed = true;
    return { ...m, sent: true };
  });
  return changed ? next : marks;
}

/** The host turned a send away: drop every marker not yet confirmed. */
export function steerMarksRefuse(marks: SteerMark[]): SteerMark[] {
  return marks.some((m) => !m.sent) ? marks.filter((m) => m.sent) : marks;
}
