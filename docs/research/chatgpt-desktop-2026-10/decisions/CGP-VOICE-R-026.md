| DEC | Choice | Why | Default state | Confirmed by Jay |
|---|---|---|---|---|
| CGP-VOICE-R-026 (minor voice default, #3976) | Minor seats keep automatic voice send as #3976 built it: after one explicit start, each finished utterance goes through the normal composer send, with #3976's start-control copy and no re-acknowledgement for a user who already acknowledged the voice notice. Push-to-talk is not the minor default. CGP-VOICE-R-026 (optional push-to-talk mode) stays an open row, without a minor-default part | Jay 2026-11-14, AskUserQuestion: "자동전송하자" | Follows #3976 (served voice profile only, no new flag). #3976 merged into the stacked branch `feat/cgp-voice-r007`, which reached `main` through #3928 (squash 1fe3261d6, 2026-11-13) | yes (2026-11-14) |

## CGP-VOICE-R-026 / R-027: push-to-talk and the detector fallback (2026-11-16, plan approved by the coordinator)

- **Where.** In the shipped voice conversation (`VoiceConversationControl` / `voiceConversation.ts`), not the unmounted VoicePanel.
- **Default.** Automatic end of speech stays the default for every seat, minors included (Jay, 2026-11-14, "자동전송하자"). Push-to-talk is an optional mode the learner turns on with a checkbox. It is kept per computer in globalState `hypeproofChat.voiceConversationMode`, the same store as the microphone choice (coordinator). A running session keeps its mode.
- **A hold** opens the microphone for one turn, and the release ends and sends it. Detected silence never ends a held turn. After the answer is read there is no automatic reopen.
  - A release while the microphone is still opening ends the turn as soon as it opens. That clip is then too short, which is a retry.
  - A hold past the recorder's 58 s ceiling is not sent and is also a retry.
- **What ends a hold** (coordinator): a release anywhere (pointer capture plus a window `pointerup`/`pointercancel` listener), Space up on the button, the window `blur`, and a hide. A hide stops the whole session, as before.
- **Space** holds only while the hold button has focus. There it is consumed (preventDefault), so it never types a space. In the text box Space is an ordinary space; a draft still stops the loop, as before.
- **R-027 fallback.** If `observe` throws in automatic mode, the opened tracks are stopped and that session switches to push-to-talk with the line `자동 말끝 감지를 쓸 수 없어 눌러서 말하기로 바꿨어요`.
  - It is for that session only (coordinator). The loop has no way to write the stored mode, and the next ordinary start is automatic again.
  - Push-to-talk itself needs no detector, so an `observe` failure in push-to-talk is ignored.
- **Not built.** The Chalk class default (REQ-CGPV-38 "Chalk can make PTT the class default"): nothing serves it.
- **After verify-4244 (fix).** Focus leaving the hold button (Tab, a click elsewhere) ends a Space or toggle hold, so no microphone stays open. While Space is still down after such a move, its repeats are swallowed in the capture phase until keyup, so no space reaches the next field.
- **After verify-4244 (agent choice: keyboard and assistive technology).** Enter, or an assistive-technology click (a click with no pointer, `detail` 0), toggles: the first press starts the turn and the second sends it. `aria-pressed` reflects it, and window `pointerup` does not end a toggle. Space keeps hold-to-talk, and a pointer's own click is ignored because the pointer holds instead.
- **After verify-4288 (fix).** A take that ends without a release (the 58 s ceiling, an error, a stop) clears any hold or toggle, so the button never says pressed with nothing listening and the next Enter starts a new take. While a keyboard or assistive-technology toggle is listening, the status reads `듣고 있어요. 다시 누르면 보내요.`; a pointer or Space hold keeps `듣고 있어요. 손을 떼면 보내요.` (coordinator copy).
- **After verify-4244 (agent choice: pointercancel).** A platform `pointercancel` (a palm, a scroll gesture, the OS taking the pointer) discards the turn. The microphone closes, nothing is sent, and no extra line is shown; the session waits for the next hold.
- **Unchanged.** No flag, policy, Service or minor-seat change; no audio stored or logged.
- **Not covered.** Real microphones and a real-device hold: NOT RUN (#3626).
- Confirmed by Jay: no (the automatic default is Jay's; the rest is agent choice).
