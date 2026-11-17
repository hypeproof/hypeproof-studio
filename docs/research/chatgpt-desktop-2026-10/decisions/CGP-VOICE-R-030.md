## CGP-VOICE-R-030: voice session marker in the task rail (2026-11-14, agent-selected)

Confirmed by Jay: no. These are agent choices within REQ-CGPV-43. The coordinator set the constraints: the shipping VoiceConversationControl path, no marker when voice is not served, and #3976's minor path untouched.

- **Source (coordinator).** The marker follows the shipping VoiceConversationControl's live VoiceConversation phase, not the unmounted VoicePanel. The control publishes the active task id to a window-local store (`src/voiceLiveTask.ts`) from its `changed` callback while the phase is active and voice is served, and null otherwise or on unmount. The conversation logic is unchanged.
- **What "live" covers (agent reading).** The marker covers the whole session, starting through speaking, including the transcribing and answering gaps between capture and playback. Showing it only during capture and playback would make it blink on and off every turn. It is removed at `stopped`, which `stop()` sets only after `recorder.cancel()` has stopped the tracks: that is the release confirmation.
- **Look (agent choice; revised after verify-3928).** A status, not a control: a static `level` icon (the read-aloud "now reading" mark) and the words "음성 대화 중" at 14px, under the row title, with no fill and no hover. The words keep the row's own text colour and only the icon carries the accent, because the accent link colour on the selected row is 3.85:1 in Dark+ and 4.36:1 in 2026 Light. In forced colours there is no rule: the UA forces the row's button to ButtonText on ButtonFace and the marker inherits it, which the per-theme smoke measures. The row's existing accessible name gains ", 음성 대화 중".
- **Scope.** Only the active task can be marked, because the conversation stops on any task switch. Dictation alone and a manual read-aloud are not a voice session and do not mark the row.
- **Not covered:** a real installed App, a real microphone and a real screen reader.

