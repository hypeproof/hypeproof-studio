// CGP-VOICE-R-030 (REQ-CGPV-43, VO-40): which task has a live voice conversation, for the task rail's marker.
//
// The voice conversation (VoiceConversationControl → voiceConversation.ts) is scoped to the active task and stops on any
// task, account, activity or served-voice change. It publishes the task id here while a session is active and voice is
// served, and null once it has stopped: `stop()` releases the microphone (recorder.cancel stops the tracks) before the
// phase becomes `stopped`, so null comes after the release. Memory only, one per window; never stored, logged or sent.
// Pure and DOM-free so the webview and the tests share it.

export class VoiceLiveTask {
  private taskId: string | null = null;
  private readonly listeners = new Set<() => void>();

  get = (): string | null => this.taskId;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  set(taskId: string | null): void {
    const next = typeof taskId === "string" && taskId.length > 0 ? taskId : null;
    if (next === this.taskId) return;
    this.taskId = next;
    for (const listener of [...this.listeners]) listener();
  }
}

/** The screen-reader and visible words of the marker. */
export const VOICE_LIVE_TASK_TEXT = "음성 대화 중";

/** The rail row's accessible name: the title, the run state label when there is one, and the voice marker when live. */
export function voiceTaskAccessibleName(runName: string | undefined, title: string, live: boolean): string | undefined {
  if (!live) return runName;
  return `${runName ?? title}, ${VOICE_LIVE_TASK_TEXT}`;
}

/** This window's live voice task. */
export const windowVoiceLiveTask = new VoiceLiveTask();
