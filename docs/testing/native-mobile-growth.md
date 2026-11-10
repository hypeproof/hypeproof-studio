# Native mobile growth verification contract

These are acceptance definitions, not completed test receipts. Source/unit,
simulator/emulator, signed delivery and physical-device observations are separate.
User growth and financial capability require separate research and cannot be
inferred from UI use or passing these tests.

| Test ID | Targets | Scenario and oracle |
|---|---|---|
| MREF-T01 | MREF-01 | Native optional notebook opens from a project; edit any field/order, leave other fields blank and retain human control. |
| MREF-T02 | MREF-02 | Decode old v1 data; restart restores notes; failed-save edits remain in the next successful save and exported visible snapshot. |
| MREF-T03 | MREF-03 | Capture selected-project request context and confirmed revisions; optional notes and unrelated projects must not leak into either. |
| MREF-T04 | MREF-04 | Locate a reflection-only project by its own display title/search; export round-trips unsaved visible text. |
| MREF-T05 | MREF-05 | Native keyboard, large text, screen reader and light/dark controls remain operable on each physical platform; successful CI alone is insufficient. |
| MVOICE-T01 | MVOICE-01 | Dictation preserves pre-existing draft prefix, persists partial/final words, and creates no AI request or intent confirmation. Native transcript fixtures prove storage only. |
| MVOICE-T02 | MVOICE-02 | Decline voice auto-send consent; change project or expire access before completion; preserve unsent text and send no request. |
| MVOICE-T03 | MVOICE-03 | Duplicate final and stale callback produce at most one send; read-aloud finishes with microphone off. Then observe five actual Korean spoken turns on each phone. |
| MVOICE-T04 | MVOICE-04 | Deny actual OS microphone permission, background capture, change project, stop while waiting/read-aloud, and inject late callback; partial words survive and no capture/transfer resumes. Physical route changes remain a separate hardware check. |
| MVOICE-T05 | MVOICE-05 | Unsupported recognition/voice returns to text. Observe recognition with network disabled on a supported physical Korean device; reconnection never replays automatically. Fixtures cannot prove offline ASR. |

Implementation tests: `IntentTests.swift`, `VoiceTurnTests.swift`,
`StudioShellTests.swift`, `StudioStateTest.java`, `VoiceSessionTest.java` and
`StudioJourneyTest.java` under `apps/studio-native`. Each result must bind the
actual source/package, command, OS/device and whether recognizer/service data was
injected. Preserve failed attempts. A state machine simulating five turns is not
a five-turn spoken conversation or evidence of reply quality.

For a device testing candidate, confirm the same source passed native CI, the
signed artifact processed successfully, and the tester can install that exact
version. Record actual microphone permission, Korean language asset availability,
recognition, read-aloud, interruption, text recovery and selected-project behavior.
Human-confirmed intention must remain a separate explicit action throughout.
