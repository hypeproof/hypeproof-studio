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


## Integrated desktop/iPhone acceptance

Use the existing desktop RC and iPhone candidate, not the discontinued Catalyst
app. Record exact Service/desktop/iOS source, package/version and account roles.

1. Desktop: select one personal task, consent to text sharing. Phone: authorize
   its own device session on the same account and open that conversation.
2. Existing desktop history appears with original message IDs. Send once on the
   phone; observe the same user/assistant messages in both surfaces and one model
   execution. Desktop next turn appears on phone. No tools/private files leaked.
3. Disconnect network after request storage; retry uses the same ID. Stop host or
   switch task: pending remains, draft persists, no background cloud execution.
   Crash after claim: unknown is explicit and never reexecuted automatically.
4. Voice: dictate, edit, send; explicit voice conversation; same-request completed
   reply only. Call interruption, headphone removal and background stop audio.
   Optional own-voice review stays local and can be erased. Verify Korean on a
   real iPhone; simulator fixtures do not satisfy ASR/TTS acceptance.
5. Skip a question, edit personal context, request a next perspective or small
   experiment. Context is shared only after reviewing/sending the visible draft.
6. Switch account/revoke phone: no cross-account reads or claims. Revoked pending
   origin is cancelled by host so later authorized requests can proceed.
7. Stop sharing/delete server copy preserves original task; local-forget explains
   server copy remains. Disk save failure preserves visible edits for export.
8. On computer continue the same intention into the existing MVP execution flow.
   Record actual artifact outcome separately from conversation-only mobile turns.

Source controls: `npm run test:mobile-conversation --prefix extensions/hypeproof-chat`,
provider tests and opt-in `test:mobile-conversation-service` against exact Service
source; Swift ConversationSyncTests; native UI tests. The Service must publish
account-api@2 before the desktop release dependency gate admits the new RC.
