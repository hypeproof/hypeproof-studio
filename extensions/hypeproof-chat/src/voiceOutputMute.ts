// CGP-VOICE-R-002 (REQ-CGPV-02): speaker/output mute, a switch of its own.
//
// Microphone mute is a session fact (`voiceSessionHelpers` `mute` closes capture). Speaker mute is a
// separate fact about what this window may play: the voice panel's `소리 끄기` sets it, every output
// in the window obeys it (read-aloud today; the voice conversation's reply when it ships). The two
// never write each other: muting sound does not close the microphone, and muting the microphone
// does not change this switch.
//
// Memory only, one per window (webview): it is never stored, logged or sent to the host. Pure and
// DOM-free so the host-side tests and the webview share it.

export class OutputMute {
  private muted = false;
  private readonly listeners = new Set<() => void>();

  getMuted = (): boolean => this.muted;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** Listeners run synchronously, so an output stops in the same press that muted it. */
  set(muted: boolean): void {
    if (muted === this.muted) return;
    this.muted = muted;
    for (const listener of [...this.listeners]) listener();
  }

  toggle(): boolean {
    this.set(!this.muted);
    return this.muted;
  }
}

/** This window's switch. Survives the panel collapsing and expanding; reset when the conversation ends. */
export const windowOutputMute = new OutputMute();
