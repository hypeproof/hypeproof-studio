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
| MVOICE-T02 | MVOICE-02 | Start through the conversation microphone without a recurring app confirmation sheet. Deny OS permission, change account/conversation or expire access before completion; preserve unsent text and send no request. Existing AI/storage consent remains required. |
| MVOICE-T03 | MVOICE-03 | Speech followed by silence sends once; duplicate finals and stale callbacks cannot submit twice. Only the matching reply may resume capture in the still-active foreground conversation. Stop, background or identity change prevents reopening. Observe five actual Korean turns on each phone without manual end/next-turn taps. |
| MVOICE-T04 | MVOICE-04 | Deny actual OS microphone permission, background capture, change project, stop while waiting/read-aloud, and inject late callback; partial words survive and no capture/transfer resumes. Physical route changes remain a separate hardware check. |
| MVOICE-T05 | MVOICE-05 | Unsupported recognition/voice returns to text. Observe recognition with network disabled on a supported physical Korean device; reconnection never replays automatically. Fixtures cannot prove offline ASR. |

MVOICE-T02/T03 use the current MFR interaction target. Android tests that expect
a confirmation sheet or manual next-turn tap prove only the previous behavior
and cannot satisfy these revised cases. Android alignment remains open under
#3687. The iPhone legacy notebook uses shared automatic controls but needs its
own revised journey verification; the account-conversation journeys below do
not establish that acceptance. No native or physical pass is recorded here.

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


## Account-owned reflection acceptance (Studio #3725)

Use the existing Studio desktop RC plus the native iPhone candidate and deployed Service reflection-api@1 / migration 0073. The older selected-build-task checks above remain separate.

1. MPER-01 / MPER-04: Sign into the same account with an active entitlement. iPhone offers an everyday question; no age/job form or manual computer pairing step appears. Consent discloses server storage and AI processing.
2. MPER-02: With the desktop closed, send a personal experience by text; confirm one Service answer. Open the existing desktop, select “나의 질문”, and observe the same original message IDs in its normal task store.
3. MPER-02 / MPER-05: Switch to a build task and back using “나의 질문”. Select “만들기로 이어가기”, review the user-authored intention, and observe one ordinary task with only that unsent draft. No copied private transcript, duplicate reflection task or SDK tool execution. Cancel/account change creates no task; a failed save reopens the exact reviewed words and preserves the original conversation.
4. MPER-03: Disconnect after send, then retry/reconnect: words remain, the same ID is reconciled and no extra AI call is made. Modify the account during a pending response: old output is never imported.
5. MPER-03 / MPER-04: Stop an active response: late output is fenced; submitted words remain. Explain that already-dispatched processing can cost money. Actual microphone/voice checks remain physical-device gates.
6. MPER-03 / MPER-04: Read a stale or malformed snapshot, including duplicate IDs: retain original history and draft. Export/erasure includes server-stored personal reflection.

Source checks: `test:personal-reflection`, `test:mobile-conversation`, Swift `ConversationSyncTests`, `StudioShellTests`, Service `test:conversation-sync`. Type/build/fixture success is not a judgment of question quality or installed-device acceptance. Local iOS verification on 2026-11-11 is BLOCKED by missing Xcode; use the repository's native macOS CI and retain that run's exact source identity.

## iPhone interrupted refresh (MIRS-01, Studio #3736)

`AccountCredentialTests` exercises legacy decode, persisted pending-state reload, no request after failed intent storage, valid save-before-dispatch ordering, unchanged account/session checks, final-write failure and malformed credentials. URLProtocol fixtures check inactive and mismatched `/v1/me` identities without production traffic. `AccountKeychain.verifyNativeStorage` also writes and reloads an encoded pending credential through an isolated actual Keychain item; its existing simulator UI assertion must pass. That probe proves Keychain storage, not physical process-kill or real refresh acceptance.

Signed acceptance: open the existing iPhone personal conversation, preserve a draft, refresh a valid expired session and confirm the same account messages. Interrupt after refresh dispatch; relaunch must request fresh login without losing the draft or replaying the old token. Reauthenticate and verify that the existing desktop still sees the same account conversation. Physical interruption, live authentication, TestFlight and two-device observations remain NOT RUN until exact package evidence exists.

### Disposable emulator readiness evidence

Run43137056162/1 failed all9 Android UI tests while the captured foreground was `Application Not Responding: com.google.android.apps.nexuslauncher`; the original PNG showed the Pixel Launcher ANR dialog, with the emulator awake and unlocked. This evidence identifies the foreground obstruction, not a passing app test or a proven emulator root cause. Preserve that failed run.

The native Android script now records bounded read-only window/power observations after installation and before instrumentation. Missing state, sleep, keyguard or a foreground ANR/error dialog cannot start UI tests. Failure capture adds a machine-readable diagnosis and input hashes while retaining the original nonzero exit code, logs and screenshot. Studio ANRs remain distinct from foreign ANRs. No dialogs are dismissed, failed tests skipped, or acceptance rules relaxed. Readiness permits starting tests only; full native test completion is still required. Actual Foundry profile adoption remains separately NOT RUN.

## Required first-person iPhone journeys — MFR-T01–T06 / Studio #3771

The reported installed-app failures were indefinite account checking, dictated
words producing no reply, and repeated voice consent/end-of-speech controls.
A build and the previous Keychain/local-notebook tests did not cover those
journeys. Preserve those failures as the regression baseline; do not describe
the new fixtures as a successful physical retest.

| Contract | Required observation | Failure that must remain visible |
| --- | --- | --- |
| MFR-T01 | From an isolated fresh app, press account start, complete the same-device browser callback and real PKCE/account adoption path, send one thought and see its answer with no desktop request. | Expired/cancelled login ends in an actionable state; no indefinite checking. Login success is not AI eligibility: an AI admission 403 remains visible after successful history refresh and relaunch, with the unsent request intact and no free-access fallback. |
| MFR-T02 | Dictation appends to an existing draft without sending; explicit Send creates one personal-reflection request and displays its answer without a running desktop. | A cleared composer or locally recorded text is not an AI answer. |
| MFR-T03 | Start voice once, receive a reply and resume capture for the next turn without a recurring consent sheet or pressing an end-of-speech button. | Silence/no transcript cannot create an empty send. Stop cancels the held next capture and retains its partial draft; no second request. |
| MFR-T03-queued | During a delayed history refresh, finish a voice turn; after refresh, send exactly once, show its reply and resume listening. The trace must prove speech ended while that history read was pending. | A queued local request must retain its voice continuation; no lost reply, duplicate POST or manual retry to make the test pass. |
| MFR-T04 | Background during a partial capture, return and relaunch; microphone stays stopped and unsent words remain. Explicit Send can then obtain an answer. | Returning to foreground must not silently restart recording or send the draft. |
| MFR-T05 | First POST fails; retry remains available with the original words. Relaunch and explicitly retry: the same request ID and text are reused and accepted once. | No automatic resend, lost outbox or duplicate accepted turn. |
| MFR-T06 | Collect actual native build/test exits and exact log hashes. All eight named simulator cases execute once and pass. | Missing, skipped, duplicate, incomplete or failed cases never count as passed because the build succeeded. Original failed evidence is immutable. |

`StudioJourneyTests` in the existing Xcode-wired `StudioShellTests.swift` covers
these cases. `NativeJourneyFixture` replaces only external transport and supplies
structured trace plus screenshot attachments; account adoption, persistence,
UI actions and voice-turn handling remain real. Its empty desktop list and
rejected desktop request routes prove that these simulated personal turns do
not depend on desktop work. Its eligible account is synthetic; current Service
admission policy is not changed or accepted by a successful login fixture.

After the actual native commands finish, the iOS script invokes:

```sh
python3 apps/studio-native/scripts/collect-native-journeys.py \
  --source-sha FULL_SOURCE_SHA \
  --build-log apps/studio-native/evidence/device-build.log --build-exit 0 \
  --simulator-log apps/studio-native/evidence/simulator-test.log --test-exit 0 \
  --output apps/studio-native/evidence/native-journeys.json
```

Replace both exit arguments with the observed command statuses, including
failures. The collector's unit tests validate refusal and evidence retention;
they do not execute simulator journeys. Run through the existing resource
wrapper. Keep native CI/Foundry provenance and source binding outside the
collector; it cannot invent trusted execution from a supplied log.

Evidence has four distinct levels: compile/build, simulator journeys, signed
upload/Apple processing, and installed-device observations. The simulator
receipt always records physical device, real authentication and live ASR as
NOT_RUN. That absence does not block distribution of a test candidate. It does
not permit a claim that the user experience works on an installed iPhone.

For a physical test candidate, record source, exact TestFlight build, iPhone/iOS,
account admission state (no token or personal transcript), and the outcome of
first login → first question, desktop-off dictation → answer, hands-free next
turn, Stop, background/relaunch and one recoverable failure/retry. Attach bounded
redacted observations. When a user reports a failure, preserve the original
build and observation, add a reproducing journey or state control, fix the
smallest boundary, run exact-source simulator/native checks, distribute a test
candidate, then ask for the specific installed retest. Do not close physical or
live-provider acceptance from mocked transport, CI or upload success alone.
