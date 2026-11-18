# Native mobile growth verification contract

These are acceptance definitions, not completed test receipts. Source/unit,
simulator/emulator, signed delivery and physical-device observations are separate.
User growth and financial capability require separate research and cannot be
inferred from UI use or passing these tests.

| Test ID | Targets | Scenario and oracle |
|---|---|---|
| MREF-T01 | MREF-01 | Native optional notebook opens from a project; edit any field/order, leave other fields blank and retain human control. Its title, return, history and menu remain visible and non-overlapping; inspect the actual screenshot and native frames, then return without sending or copying either draft. |
| MREF-T02 | MREF-02 | Decode old v1 data; restart restores notes; failed-save edits remain in the next successful save and exported visible snapshot. |
| MREF-T03 | MREF-03 | Capture selected-project request context and confirmed revisions; optional notes and unrelated projects must not leak into either. |
| MREF-T04 | MREF-04 | Locate a reflection-only project by its own display title/search; export round-trips unsaved visible text. |
| MREF-T05 | MREF-05 | Native keyboard, large text, screen reader and light/dark controls remain operable on each physical platform; successful CI alone is insufficient. |
| MVOICE-T01 | MVOICE-01 | Dictation preserves pre-existing draft prefix, persists partial/final words, and creates no AI request or intent confirmation. Native transcript fixtures prove storage only. |
| MVOICE-T02 | MVOICE-02 | Start through the conversation microphone without a recurring app confirmation sheet. Deny OS permission, change account/conversation or expire access before completion; preserve unsent text and send no request. Existing AI/storage consent remains required. |
| MVOICE-T03 | MVOICE-03 | Speech followed by silence sends once; duplicate finals and stale callbacks cannot submit twice. Only the matching reply may resume capture in the still-active foreground conversation. Stop, background or identity change prevents reopening. Observe five actual Korean turns on each phone without manual end/next-turn taps. |
| MVOICE-T04 | MVOICE-04 | Deny actual OS microphone permission, background capture, change project, stop while waiting/read-aloud, and inject late callback; partial words survive and no capture/transfer resumes. Physical route changes remain a separate hardware check. |
| MVOICE-T05 | MVOICE-05 | Unsupported recognition/voice returns to text. Observe recognition with network disabled on a supported physical Korean device; reconnection never replays automatically. Fixtures cannot prove offline ASR. |

For #4307, exercise MVOICE-T03/T05 against an adversarial installed-voice catalog:
basic Korean precedes enhanced Korean, and premium English must not beat Korean.
Installed premium Korean wins; equal-quality ties remain stable. Default-only,
unknown-quality and empty catalogs preserve conservative output or text fallback.
An installed premium novelty or personal voice cannot displace a standard-purpose
Korean voice; no eligible Korean voice keeps the existing text fallback.
The original first-match policy is a negative control for basic-before-enhanced.

Extend the existing `testRealKoreanPlaybackCompletionReachesNextCaptureBoundary`
journey to observe the requested voice quality against the actual available
inventory, the accessibility-preference option, real OS synthesis start/finish
and the next capture boundary. Do not skip this journey because premium assets
are absent, replace synthesis callbacks with a timer, or report requested voice as
the effective accessibility output. Native execution is required; portable policy
checks alone do not prove App integration.

Physical listening remains a separate acceptance step: compare the same Korean
sentences, numbers and proper names before/after on the exact installed build,
record available voice quality and active accessibility settings locally, then
exercise five turns using speaker and headset. Report the person's preference,
unwanted cutoffs, Stop and resumed listening. Source quality selection and simulator
callbacks do not prove perceived naturalness, acoustic echo cancellation or barge-in.

For #4259, the existing iPhone dictation and empty-recognition journeys first
require an enabled, hittable, fully onscreen target of at least 44×44pt. They
record its frame and touch coordinate, then tap once at 15% of each dimension,
inside the padding outside the old icon. The original draft preservation,
visible reply, unique submissions, retry budget and Stop assertions remain.
No second tap, longer answer timeout or direct handler invocation can substitute
for that input. Synthetic speech verifies the native input/controller path;
physical Korean recognition remains a separate device check.

The shared iPhone sign-in journey also uses one padded-corner touch on the login
pill, then retains the original visible account-opening and completed-login
assertions (#4236). No handler invocation, second touch or extended login wait is
allowed. The preserved failed center touch did not enter the login action; a
passing corner-touch check establishes the full-pill interaction contract, not
the unproved cause of that earlier event loss.

MVOICE-T02/T03 use the current MFR interaction target. Android tests that expect
a confirmation sheet or manual next-turn tap prove only the previous behavior
and cannot satisfy these revised cases. Android alignment remains open under
#3687. Account-conversation journeys own automatic voice acceptance. Under #3985,
the secondary notebook instead verifies local-only dictation, preserved v1 data,
reflection/intent/draft recovery, search/export and deliberate return without
copying a local draft or dispatching an account question. Assertions for its
removed anonymous AI onboarding are retired, not counted as passed voice tests.
No native or physical pass is recorded here.

Implementation tests: `IntentTests.swift`, `VoiceTurnTests.swift`,
`StudioShellTests.swift`, `StudioStateTest.java`, `VoiceSessionTest.java` and
`StudioJourneyTest.java` under `apps/studio-native`. Each result must bind the
actual source/package, command, OS/device and whether recognizer/service data was
injected. Preserve failed attempts. A state machine simulating five turns is not
a five-turn spoken conversation or evidence of reply quality.

### iPhone playback-to-listening boundary — Studio #4024

MVOICE-T03/T04 and MFR-T03 keep three different proofs separate. The existing
hands-free fixture still substitutes a 400 ms completion. The condition-driven
`testPlaybackDelegateResumesCaptureOnceAndLateCompletionCannotUndoStop` instead
enters the actual synthesizer delegate with a retained utterance, then checks
exactly one next capture and refusal of a late completion after Stop.
Before completing playback, it opens Settings and dismisses it with both Close
and a swipe; neither dismissal may stop the live turn or dispatch another action.
`testPlaybackEndPreservesTypedDraftAndExplainsWhyListeningStopped` checks that
writing during playback prevents another capture, retains the draft and explains
why the automatic continuation stopped. These use synthetic playback/capture.

`testRealKoreanPlaybackCompletionReachesNextCaptureBoundary` opts into a real
Korean `AVSpeechSynthesizer` utterance and its OS start/finish callbacks. It has no
400 ms or English-voice fallback. Missing Korean voice or completion fails the
case; it cannot become a skipped PASS. Service and the next microphone backend
remain synthetic, so this does not prove `.playback` to `.record`, AVAudioEngine
restart, hardware input or on-device Korean ASR. The collector requires all three
cases and reports OS playback separately from `live_asr=NOT_RUN`.

Already granted permissions use their current status without requesting them
again. Unknown permissions retain the existing OS request and generation fences.
An in-memory ring records only enum events, phases and relative milliseconds;
manual Settings sharing exports that record, never text, audio, account/request
identifiers or credentials. It is not an automatic telemetry upload. The record
separates a missing playback callback, a blocked continuation and a failed new
capture. It is not evidence that the physical incident was reproduced or fixed.

For physical acceptance, bind the installed build and iOS/audio route, complete
5–10 Korean turns with one start, and observe the system microphone indicator
return after each spoken reply. Include Stop, background and route interruption;
none may restart automatically. Preserve any failed trace without collecting
conversation content. Local unsupported CLT checks and simulator evidence cannot
replace this gate. This hardening adds no provider/model call or permission grant;
existing inference and CI costs remain in their existing lanes.

#### iPhone microphone routes — Studio #4107

MVOICE-T02/T03/T04 and MFR-T03 use the real `AVAudioSession`/`AVAudioEngine`
capture path for route acceptance. Verify `.record`/`.measurement` with
`allowBluetoothHFP` on the existing iOS 17 deployment target and current SDK.
No preferred-input override, A2DP input assumption or simultaneous recording
during reply playback is introduced. Inspect preparation before engine start,
then listening only after a current input, finite positive sample rate, nonzero
channel count and successful engine start. A missing input or setup failure must
clean up the engine tap and recognition request while retaining editable words.

Use built-in, wired and HFP microphones separately on a physical iPhone; record
OS/build and only the anonymized route category. Complete five Korean turns,
including reply playback followed by capture, and repeat disconnect, Stop and
background boundaries. No invalidated session may reopen capture or send again.
Keep current useful-partial, empty-result retry limits and exactly-once request
checks. Inspect the bounded manual timeline for `inputBuiltIn`, `inputWired`,
`inputBluetoothHFP`, `inputOther` or `inputUnavailable`; never collect device names,
identifiers, raw audio or conversation text for this diagnostic record.

The existing synthetic capture fixtures bypass real audio-session setup. Their
PASS cannot validate the HFP option, engine format or headphone switching. Native
SDK compile/configuration and physical route acceptance must be reported
separately; no pure option-equality assertion substitutes for those checks.

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
3. MPER-02 / MPER-05: Switch to a build task and back using “나의 질문”. With the status bar hidden, select the visible “만들기로 이어가기” action in the question conversation, review the user-authored intention, and observe one ordinary task with only that unsent draft. No copied private transcript, duplicate reflection task or SDK tool execution. Cancel/account change creates no task; a failed save reopens the exact reviewed words and preserves the original conversation. Ordinary/classroom tasks do not expose this action; stale task/activity messages cannot open its review.
4. MPER-03: Disconnect after send, then retry/reconnect: words remain, the same ID is reconciled and no extra AI call is made. Modify the account during a pending response: old output is never imported.
5. MPER-03 / MPER-04: Stop an active response: late output is fenced; submitted words remain. Explain that already-dispatched processing can cost money. Actual microphone/voice checks remain physical-device gates.
6. MPER-03 / MPER-04: Read a stale or malformed snapshot, including duplicate IDs: retain original history and draft. Export/erasure includes server-stored personal reflection.

Source checks: `test:personal-reflection`, `test:mobile-conversation`, Swift `ConversationSyncTests`, `StudioShellTests`, Service `test:conversation-sync`. Type/build/fixture success is not a judgment of question quality or installed-device acceptance. Local iOS verification on 2026-11-11 is BLOCKED by missing Xcode; use the repository's native macOS CI and retain that run's exact source identity.

The #3940 `personal-making-entry.test.tsx` control renders the actual App and uses
the existing account/reflection host and disk task store. The original source
must fail at the missing visible action. It checks reviewed words in the visible
unsent composer and reopened store, unchanged source history, no Service/tool
dispatch, repeated clicks, cancellation and stale/classroom refusals. Existing
`mobile-conversation-host.test.mjs` retains account-change and failed-save controls.
HTTP and VS Code presentation remain fixtures; actual Electron layout/focus and
release-pinned phone/desktop acceptance are separate observations.

### Android same-account question parity (MADR-01–05, #3733)

Run `:app:testDebugUnitTest :app:assembleDebug :app:lintDebug
:app:assembleDebugAndroidTest` and the existing disposable-emulator
`scripts/android-verify.sh`. Keep the exact source/tree, APK hash, host and exit.

- `ReflectionStateTest` / `ReflectionModelTest`: persistence-before-send, uncertain
  retry identity/revision, rejected stale/duplicate history, corrupt-cache
  read-only behavior, failed-save drafts, account-switch fencing and spent refresh.
- `NativeDeviceSignInTest` / `DeviceSignInHttpTest` / `NativeHttpDeadlineTest`:
  actual loopback HTTP serialization/redirect refusal/invalid UTF-8, bounded drip
  and cancellation; exact browser URL, expiry, throttling and matching `/me`.
- `DeviceSignInHttpTest` also passes typed monthly-limit and temporary-admission
  errors through the real transport/model. Only the monthly code promises a
  monthly reset; generic 429 and 403 retain their existing meaning. Rejected sends
  preserve credentials, durable request ID/text and a concurrently edited draft;
  a history GET returning 401 still clears login while keeping the account's
  records (#3963).
- `QuestionJourneyTest`: real Android launcher and consent UI, account draft
  recreation and voice Stop, actual Keystore ciphertext roundtrip,
  spent refresh and tamper rejection. Network is an in-process fixture restricted
  to a debug app, never a live account or Korean recognition claim.
- `QuestionJourneyTest` drives the actual NativeVoice listener → Host → durable
  ReflectionModel send → matching Service fixture reply → TTS callback → capture
  path for five synthetic turns from one visible tap, without RMS/end/next input.
  Reject duplicate finals, wrong/stale TTS IDs, expired/replaced credentials and
  post-background callbacks; preserve a draft edited during read-aloud.
- `voiceAdmissionDenialKeepsServiceReasonAndStopsWithoutReplay` sends through the
  actual NativeVoice listener and QuestionActivity Host into ReflectionModel.
  A persisted failed-turn fixture returns the monthly-limit error; stopping voice
  must retain that actionable explanation, the saved request ID/text and login.
  Late recognizer callbacks cannot send again or start playback/capture (#3971).
  This checks the failed-send transition, not error persistence across refresh or
  restart, live admission, physical speech or installed-device acceptance.
- Native end-of-speech waits at most eight seconds for a final result; duplicate
  endpoints cannot extend it. No endpoint within 60 seconds, no final within
  the following eight seconds, or empty speech preserves partial words and
  never auto-sends or retries.
- `StudioJourneyTest` retains notebook consent/storage controls and exercises
  editable final dictation plus grant expiry before final delivery. Audio ports
  are synthetic per controller instance; microphone, acoustic endpoint quality,
  installed Korean TTS and five physical spoken turns remain NOT RUN here.

After Service rollout, on a physical Android device sign in through the normal
browser, send with the desktop closed, then observe identical message IDs on
existing desktop and iPhone. Interrupt network after submission, reconnect and
confirm one answer. Confirm Korean recognition/reading, permission denial,
background/account changes, headphones, offline draft and same-account relaunch.
Review a making request in the existing desktop. Record real AI cost and any
entitlement failure rather than bypassing it. Do not publish an APK as live-ready
before these Service and installed-device checks.

Storage/HTTP design references: Android [Keystore](https://developer.android.com/privacy-and-security/keystore)
and [AtomicFile](https://developer.android.com/reference/android/util/AtomicFile).

## iPhone interrupted refresh (MIRS-01, Studio #3736)

`AccountCredentialTests` exercises legacy decode, persisted pending-state reload, no request after failed intent storage, valid save-before-dispatch ordering, unchanged account/session checks, final-write failure and malformed credentials. URLProtocol fixtures check inactive and mismatched `/v1/me` identities without production traffic. `AccountKeychain.verifyNativeStorage` also writes and reloads an encoded pending credential through an isolated actual Keychain item; its existing simulator UI assertion must pass. That probe proves Keychain storage, not physical process-kill or real refresh acceptance.

Signed acceptance: open the existing iPhone personal conversation, preserve a draft, refresh a valid expired session and confirm the same account messages. Interrupt after refresh dispatch; relaunch must request fresh login without losing the draft or replaying the old token. Reauthenticate and verify that the existing desktop still sees the same account conversation. Physical interruption, live authentication, TestFlight and two-device observations remain NOT RUN until exact package evidence exists.

### Disposable emulator readiness evidence

Run43137056162/1 failed all9 Android UI tests while the captured foreground was `Application Not Responding: com.google.android.apps.nexuslauncher`; the original PNG showed the Pixel Launcher ANR dialog, with the emulator awake and unlocked. This evidence identifies the foreground obstruction, not a passing app test or a proven emulator root cause. Preserve that failed run.

The native Android script now records bounded read-only window/power observations after installation and before instrumentation. Missing state, sleep, keyguard or a foreground ANR/error dialog cannot start UI tests. Failure capture adds a machine-readable diagnosis and input hashes while retaining the original nonzero exit code, logs and screenshot. Studio ANRs remain distinct from foreign ANRs. No dialogs are dismissed, failed tests skipped, or acceptance rules relaxed. Readiness permits starting tests only; full native test completion is still required. Actual Foundry profile adoption remains separately NOT RUN.

Runs43253872173/1 and43321849035/1 retained the same launcher input-dispatch ANR before the Studio script began. In both, the pinned emulator action sent MENU immediately after `sys.boot_completed`; the window manager recorded a missing focused window during that command. This identifies a repeatable startup boundary, not a proven emulator-internal cause. CI now uses `scripts/android-emulator.py` to own one fresh AVD, omit MENU, and require three consecutive stable awake/unlocked focus observations before invoking the unchanged native verifier once. API35, Google APIs x86_64, Pixel6 and KVM remain the same. The 180-second boot/focus and 600-second test deadlines fit the existing 20-minute job cap. Actual Android completion after this correction remains NOT RUN until a fresh source-bound CI receipt exists.

The bootstrap preserves per-observation hashes, emulator output/configuration and failure window/activity/input/logcat/screenshot evidence. ANRs fail before preparation; absent focus, child exit or timeout cannot start tests. Only its own process groups are terminated and waited for on success, failure or interruption; occupied ports and foreign AVD identities are refused. Stateful SDK-boundary subprocess tests exercise these controls, failure propagation and TERM with a surviving peer. These controls are not real Android or physical-device acceptance.

## Required first-person iPhone journeys — MFR-T01–T06 / Studio #3771

The reported installed-app failures were indefinite account checking, dictated
words producing no reply, and repeated voice consent/end-of-speech controls.
A build and the previous Keychain/local-notebook tests did not cover those
journeys. Preserve those failures as the regression baseline; do not describe
the new fixtures as a successful physical retest.

| Contract | Required observation | Failure that must remain visible |
| --- | --- | --- |
| MFR-T01 | From an isolated fresh app, press account start, complete the same-device browser callback and real PKCE/account adoption path, send one thought and see its answer with no desktop request. | Expired/cancelled login ends in an actionable state; no indefinite checking. Login success is not AI eligibility: an AI admission 403 remains visible after successful history refresh and relaunch, with the recorded failed user event/request intact and no free-access fallback. Explicit restore only creates a local draft, never an automatic retry or new login. |
| MFR-T02 | Dictation appends to an existing draft without sending; explicit Send creates one personal-reflection request and displays its answer without a running desktop. | A cleared composer or locally recorded text is not an AI answer. |
| MFR-T03 | Start voice once, receive a reply and resume capture for the next turn without a recurring consent sheet or pressing an end-of-speech button. | Silence/no transcript cannot create an empty send. Stop cancels the held next capture and retains its partial draft; no second request. |
| MFR-T03-queued | Open the native Settings sheet and tap its enabled, hittable Refresh action (at least 44pt). During the delayed history refresh, require Settings to dismiss and a usable voice target while the read remains held. Tap once and require actual voice-handler entry/capture before waiting for the reply. Finish a voice turn; after refresh, send exactly once, show its reply and resume listening. The trace must prove speech ended while that history read was pending. | A queued local request must retain its voice continuation; no lost reply, duplicate POST, fixture timeout release or manual retry to make the test pass. An open settings surface is a failure, never dismissed by a test-only extra tap. |
| MFR-T03-empty | Deliver a useful partial followed by an empty final, then an empty post-playback capture, useful recovered speech and repeated empty captures through the real controller. Stop during the scheduled recapture delay. | Each retained phrase sends once; empty captures send nothing; at most two automatic retries precede a pause. Explicit restart resets the budget. A real elapsed wait after controller Stop proves no recapture or POST. Synthetic ASR and deterministic controller Stop do not establish physical recognition or a user-tap result; the separate UI Stop journey remains required. |
| MFR-T04 | Background during a partial capture, return and relaunch; microphone stays stopped and unsent words remain. Explicit Send can then obtain an answer. | Returning to foreground must not silently restart recording or send the draft. |
| MFR-T03-stop-denial | Stop races a recorded admission failure; the original POST delivers its typed403 after the snapshot already says failed. Relaunch. | Preserve the exact refusal reason and human words; no fake cancellation, extra POST or voice continuation. |
| MFR-T03-response-stop | A real native voice turn leaves its POST pending while a Service-shaped running row exists. Explicitly stop; the original POST returns its late error before cancel acknowledgment, then relaunch with a separate draft. | The >=44pt action is usable during POST; only exact terminal acknowledgment shows stopped. Same human words/ID remain; no automatic replay, extra capture, reply or draft loss. Synthetic transport; physical/live voice remains separate. |
| MFR-T05 | First POST fails; retry remains available with the original words. Relaunch and explicitly retry: the same request ID and text are reused and accepted once. | No automatic resend, lost outbox or duplicate accepted turn. |
| MFR-T05-recorded | A Service-shaped failed turn leaves its user event and terminal ID after the first POST. Relaunch, explicitly restore into an empty composer, relaunch again, then explicitly Send. | Restore/relaunch creates no POST; only Send creates a distinct ID at the reconciled revision. The original failed event remains. |
| MFR-T05-collision | After a recorded failure, write a different draft and relaunch. | Restore stays disabled and preserves the draft. Pure controls also cover unsaved overlays, whitespace and all non-failed states. |
| MPER-T03-history | Reopen an 80-message cached conversation, switch away while reading an equal-count cached conversation, and change synthetic account. | The correct latest answer is inside the actual viewport; history navigation creates no AI request and cannot retain the other account's messages. |
| MPER-T03-logout | Hold a real history GET through the isolated HTTP fixture, queue one ordinary Send and tap Logout once while the read remains held. Release only that transport, then relaunch and switch accounts. | Logout waits for existing credential/read work, revokes once and never dispatches queued words. The other account cannot import them; returning to the original account restores the same durable local request ID without replay. Pending logout blocks new context edits; uncertain failure requires an explicit retry. This is simulator account/persistence evidence, not live authentication. |
| MPER-T03-following | Advance a real App's HTTP snapshot beyond 80 messages without growing its window. At the bottom, follow the new tail; while reading old text, preserve a visible passage until explicit latest or Send. | The catch-up control is at least 44pt. Keyboard input remains reachable; only explicit Send creates the one new request. |
| MFR-T01-network | Compare a state-validated callback carrying `login_expired` with a separate browser transport timeout. | Both end waiting and retain the draft without exchange or POST; only the verified expiry displays the expired-login copy. Production callback verification and one-use exchange remain active. |
| MFR-T02-readiness | Hold the desktop-list GET after personal history succeeds, then type and explicitly Send once. | Checking ends while desktop discovery is still held; the composer remains usable and exactly one personal POST answers. The test must observe the hold before asserting readiness. |
| MFR-T02-timeout | Fail the first personal history read with a transport timeout, keep a guest draft through login, wait beyond one ordinary polling interval, then tap Retry. | The account/draft remain, no automatic second GET or POST occurs, Retry performs one successful read, and relaunch retains the words. A separate continuing-body URLSession test proves elapsed deadline and cancellation; injected error is not physical-network evidence. |
| MFR-T02-cancel | Cancel the first personal history transport, then observe the next ordinary poll. | Cancellation does not latch permanent failure; the next GET succeeds without relogin, a false expiry error, or POST. This is transport-cancellation coverage, not a physical background/foreground timing claim. |
| MFR-T06 | Collect actual native build/test exits and exact log hashes. Every named required simulator case executes once and passes. | Missing, skipped, duplicate, incomplete or failed cases never count as passed because the build succeeded. Original failed evidence is immutable. |
| MPER-T01-cancel | Type a first thought before login, cancel the real model's pending login, relaunch and read the same words. | No browser callback, credential exchange or AI turn; cancellation cannot consume the guest draft. |
| MPER-T03-collision | Sign in with an existing account draft and a different guest draft. Keep the account words; relaunch; explicitly empty that draft and restore guest words. | No overwrite, auto-restore on cold launch or automatic AI request. Guest/account persistence failures preserve the original copy. |
| MPER-T01-layout | In dark mode with accessibility XXXL text, type five lines with the keyboard visible. Composer and login remain reachable above the keyboard and below navigation. | Native screenshots of first use and keyboard state are retained. They do not prove physical-device accessibility or VoiceOver quality. |

For Studio #3937, MFR-T01 starts by typing before authentication and proves zero
network paths before login and zero AI turns after account adoption until explicit
Send. Its failure case verifies the same draft survives relaunch. Local notebook
capture/relaunch is still exercised through the secondary menu. Message roles
remain in accessibility labels even when visible role headings are removed.
`ios-verify.sh` exports the actual XCTest attachments under `journey-attachments/`
for visual review; the unrelated post-suite launch screenshot cannot substitute
for those journey states. GuestDraft unit controls exercise persisted reload,
draft/outbox collision, account-write failure, guest-cleanup failure and unreadable
files. These are test definitions, not completed native or physical acceptance.

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

## TestFlight request and receipt — MTF-T01

For MTF-01 / Studio #3768, run `python3 -m unittest discover -s
apps/studio-native/tests -p 'test_*.py' -v`. Deployment contract controls check
legacy input, every partial request, malformed/newline values, SHA movement,
gate artifact binding, invocation outside the checkout, and the real shell's
pre-signing refusal. A gate from another release attempt must stop the actual
upload shell before signing configuration and cannot be relabeled by receipt
emission. Matching correlated and no-input gates remain valid; source, native
identity and request mismatches are refused. The archive/export/validation/upload tail executes with
synthetic tools: any nonzero phase stops before a success receipt; a complete
run binds package bytes and app/run identity without claiming availability.
Existing native-gate controls still reject stale or mismatched CI artifacts.
These controls perform no signing, Apple call or workflow dispatch.

For Studio #4233 / MENT-05, `ios-verify.sh` also runs
`check-ios-push-metadata.py` against the actual unsigned device app: its push
metadata must be present and disabled, with the existing bundle/display/usage
metadata retained. Three tiny real Xcode C app controls use the tracked input
plist to distinguish missing custom-key generation from explicit enabled and
disabled values. Each build has a three-minute bound; any failure stops the
recipe and preserves `push-metadata.json` and its available probe logs. A host
without Xcode cannot establish this evidence. The existing signed IPA guard
still qualifies the actual enabled release before upload. Portable upload tests
remove the source input/key, inject signature/entitlement/profile failures and
check fixed phase/check diagnostics without private values. Neither these
controls nor the tiny native app proves physical delivery or identifies the
unretained historical failed IPA's exact exception.

For Studio #3866, `test_native_workflow_source.py` adds two-source contract and
real CLI/shell controls. A candidate containing an obsolete helper must use the
separate trusted control checkout. Main may advance normally without changing
app identity; mismatched workflow/ref/event, partial v2 inputs, unrelated ancestry,
dirty/wrong checkout and stale v1/attempt/workflow gate documents refuse. The
actual upload shell re-reads ancestry before any signing material. Original
exact-head CI and upload failure controls remain unchanged. v2 gate/upload
receipts name `workflow_source_sha`; their app source fields still name the
candidate. An actual v2 signed upload and Harness reconciliation remain required
before claiming live compatibility.

Signed-in journey and audience gate (Studio #3697, #3693; Lab #1669 escape). The
simulator case `StudioSignInBoundaryTests.testSystemBrowserOpensLiveSignInPageAndCancelReturnsToApp`
uses the real Service sign-in start and the real system browser session against the
live Lab URL, then cancels. It verifies only: Service start returns a Lab URL, the
system browser session loads the sign-in page, and cancelling returns to the app.
`scripts/collect-signin-journey.py` records those three hops per source SHA and
lists three hops as NOT_RUN because a hosted runner has no account: the Lab form
POST through the proxy (the seam that broke), the callback from Lab, and the code
exchange. The record is therefore PARTIAL, never PASS. `verify-native-candidate.py`
reads the record of the exact run attempt; a missing record is NOT_RUN. The
`distribution_audience` input defaults to `internal`: internal upload proceeds on
PARTIAL or NOT_RUN and the receipt's `distribution` block says so and keeps
`testFlightInternalTestingOnly` true. `external` is refused before signing unless
the record is PASS; FAIL blocks both audiences. PASS needs an owner-provided test
account and a Lab test-login path; neither exists, so external distribution stays
blocked until then. Controls: `test_verify_native_candidate.py`
(`SignedInJourneyDistribution`, `SigninCollector`).

Authorized deployment acceptance: supply one Harness request, verify the run
name and gate `deployment_request` match its exact digest/source, then inspect
that run attempt's `upload-receipt.json` and IPA digest. A missing receipt stays
uncertain until the original provider operation is reconciled. Observe Apple
processing/tester availability separately and record the exact installed version.
The existing no-input manual path emits `deployment_request: null`; Harness
must not attach that uncorrelated receipt to one of its own operations.


## Desktop visible question entry (#3798)

`personal-reflection-entry.test.tsx` renders the actual StartPage and sends its typed
messages to the actual StartPage host, AccountSession, ActivityConnections,
ensureWorkspace and reflection/task-store implementation. The fixture supplies
VS Code services, presentation/configuration lifecycle seams and synthetic HTTP
responses; first entry has no seeded account
credential, activity binding, task or history. The source proof is separate from the
installed desktop and real Service/Google acceptance below.

- Start with default hidden status/activity bars. Press **나의 질문**, finish the
  existing browser account flow and eligible grant, confirm storage disclosure, then
  observe original same-account message IDs in the existing task. No AI POST/tool
  dispatch is an entry side effect.
- With a normal account pass, the existing **이 이용권으로 시작하기** choice retains
  question intent. Missing access or a refused activation shows the account/pass
  reason; no automatic purchase/free fallback or workspace replacement occurs.
- Cancel login, leave the account screen, switch accounts during activation, or press
  entry repeatedly while a snapshot is pending. No late redirect, second reflection
  task, extra AI turn or foreign-account transcript may appear.
- Change task/activity while the first snapshot is pending. The selected work and
  admitted activity remain connected after the stale response is refused. A negative
  control that restores the old post-admission rollback must fail this assertion.
- Begin with no active folder and allow the actual workspace router to switch to its
  prepared folder. Recreate the host, consume the real activity-resume marker, and
  revalidate account/session. Exactly one continuation is allowed; a second launch,
  stale/mismatched marker or different account must not revive it.
- From a restored personal task, use the visible rail action to reuse reflection.
  Preserve existing draft/active stream refusal. Concurrent config reads must wait
  for the real durable store initialization rather than reading an empty half-ready
  store; a negative control that removes the shared wait must fail.
- Account-owned seat (#4179). Serve the profile as production does, `activity_kind:
  "trial"` with no `seat_owner`, then again with `seat_owner: "account"` and a seat
  credential carrying this account's `personal_account` / `account_session`. First
  entry opens the question on the activated seat, and a second press from another task
  reuses the saved `trial` record without a new activation. Refused without activation
  or a question read: a `trial` record bound to another session or naming another
  account (“이 개인 활동의 계정이 달라요…”), a lesson (“수업은 그대로 유지했어요…”) and
  a code-issued trial without an account (“현재 활동은 그대로 유지했어요…”). The
  anonymous free seat still goes to sign-in and then the pass chooser. The decision
  table, including credential claims and `seat_owner`, is in
  `test/reflection-seat.smoke.mjs`. A run of the new cases against the old gate must
  fail.

Focused command: `node scripts/run-tsx-tests.mjs personal-reflection-entry` from
`extensions/hypeproof-chat`. Relevant existing controls are initial-surface,
activity-resume, studio-folder-navigation, account-start-entry and
mobile-conversation-host. Evidence must name the exact source, Node/OS, command and
exit code. Simulator/native tests, physical iPhone, actual Google/account admission,
installed desktop focus/navigation and live model quality remain **NOT_RUN** unless
separately observed. A prepared runner or green build is not that observation.


### Android first-use draft — Studio #3946

- 실제 `ReflectionModel` + 기존 device sign-in protocol 제어: 로그인 전 글의 정확한 저장/재열기, 취소·거절·늦은 완료, 빈 계정 초안으로만 이동, 충돌 후 명시 복원, 계정 저장/게스트 삭제 실패의 원본 보존과 전송 0회를 확인한다 (`GuestDraftTest`).
- 실제 `QuestionActivity` / `AtomicFile` / Keystore 제어: 첫 화면 입력, 동의 취소, 앱 재실행, 로그인 성공/거절, 충돌·복원과 손상 파일 보존을 확인한다. 음성 입력만 합성하고 실제 Host/model/file 경로에서 로그인 전 받아쓰기·백그라운드 중단·늦은 콜백 거부를 확인한다 (`QuestionJourneyTest`).
- 충돌 후 명시 복원은 실제 DOWN → 기존 모델 저장·화면 갱신 → UP 한 번으로 확인한다 (Studio #4190). 원래 버튼이 분리되어 탭을 잃는 대조군과, 복원 글·계정/게스트 파일·전송 0회를 확인하는 수정본을 구분한다. 실패 시 synthetic 초안/저장 상태와 버튼 부착 여부를 종료 전에 보존하며 자격 증명은 기록하지 않는다.
- 실제 소프트웨어 키보드를 연 뒤 다섯 줄의 전체 값, 입력창·로그인 버튼이 화면과 키보드 위에 남는지 확인한다. 별도 소유 에뮬레이터에서 시스템 큰 글자/다크 모드로 같은 화면을 기록한다. 기존 기기 기록은 메뉴에서 접근한다.
- 원래 `QuestionActivity`를 복원하면 로그인 전 입력창 표시 검증이 실패해야 한다. 에뮬레이터의 합성 로그인/음성은 실제 Galaxy 로그인·마이크·접근성 서비스·배포 증거가 아니다. 실행 결과와 패키지 identity는 별도로 기록한다.

### Conversation position and diagnostic geometry — Studio #3962

Native following uses selected-conversation identity, actual layout and the last
message identity, not only count. Initial cached history and account/conversation
entry position at the latest exchange. Keyboard or font size changes follow the
bottom only while the person is already following. Manual reading pauses following;
a native latest-message action resumes it. Automatic following is instant; the
explicit action respects Reduce Motion. The desktop already owns equivalent
useChatViewport behavior and is not reimplemented in this slice.

All DEBUG fixture JSON and theme diagnostics are out-of-flow 1pt accessibility
elements with explicit values. The central XCTest reader checks their bounds and
parses those values; screenshots no longer use a large inline JSON transcript.
The theme assertion still observes the actual SwiftUI environment. The long-history
revision barrier reads the actual applied model cache, not a transport completion
guess. These seams compile out of Release. The existing admission-denied journey
now models Service persistence before 403 and retains the failed user event, reason
and identity; its former pre-persistence local-retry shortcut is not evidence.
The same admission journey arms a real periodic history GET before one explicit
failed-draft restore. The response releases only after the account-cache write
succeeds; assertions observe its later application, retained draft on relaunch,
and unchanged submitted IDs. The original `!syncing` eligibility must fail this
held-read control. This is a deterministic regression contract, not proof that a
historical tap failed for that reason; the old run had no handler-entry trace.

New App journeys and changed AX diagnostics require actual hosted Xcode execution.
Source/parser checks are not App, installed-device, live-auth or physical-ASR PASS.
# Account question entry verification — #4111

| Test ID | Targets | Required observation |
|---|---|---|
| MENT-T01 | MENT-01, MENT-02 | Existing desktop StartPage displays the own-account greeting, safe question text and enrolled approval entry. A question action is distinct from an approval; logout and late replies clear private state. |
| MENT-T02 | MENT-01, MENT-02 | Existing iOS/Android account screens expose the same contracts; a controlled real Activity/HTTP/persistence journey preserves the conversation draft through question use and relaunch. Native iOS and actual account acceptance remain separate. |
| MENT-T03 | MENT-03 | Unknown trigger response followed by restart reuses the durable ID and choice; storage failure blocks POST and a mismatched/incomplete receipt cannot clear pending intent. |
| MENT-T04 | MENT-04 | No observations before opt-in; failed opt-out remains locally paused; immutable queued records retry safely and account switches fence pending sends. Raw-content/unknown fields fail at server admission. |
| MENT-T05 | MENT-05 | Register, rotate, revoke and open a generic notice using a current account/device generation. Controlled provider calls do not count as a received device notification. |
| MENT-T06 | MENT-06 | Pin app/source/platform evidence and check actual login, voice re-listening and approval authority before marking the affected release available/accepted. |

`MENT-T05-push-idle` is a required iOS App journey. It holds the actual authenticated
registration request, delivers a synthetic notification while registration is busy,
and releases the response only after the view observes that pending reference.
The question must open without a second tap, with one registration and one opened
receipt, and no automatic question answer or conversation send. Missing or skipped
execution blocks the native candidate. The transport and APNs notification are
synthetic; a passing journey does not establish physical push delivery.

The native CI contract job also runs the existing release casebook selection and
publish-gate controls before either platform build. A newly required journey must
appear in its release case, and the active iOS P0 selection must agree. A missing
mapping stops before provisioning the Android emulator or starting the Mac job;
it does not change any journey, approval, or physical-device acceptance requirement.

Desktop controls: `account-cards.smoke.mjs`, `team-product-loop.smoke.mjs`,
`account-question-entry.test.tsx`, and existing personal-reflection/member-approval host/UI controls.
Native controls: `AccountQuestionTests.swift`, `TeamEntryUITests.swift`,
`NativeTeamModelTest.java`, `TeamEntryJourneyTest.java`, `AccountPushTests.swift`,
`NativePushTest.java`. A fixture name or compiled APK alone is not
an executed native journey. Report the actual run and any missing physical/provider evidence.

For #4236, extend the existing MENT-T01/T02 question-answer journeys through the
confirmed receipt: observe the visible next-question action, record unchanged GET,
answer and trigger counts before the tap, tap once, then observe one new card GET
and either a different card or the empty-inbox choices. Retain before/after screenshots
and verify the original conversation draft after Close. The bounded fixtures consume
the answered card rather than returning it forever. Controller controls cover read
failure, uncertain answer, duplicate in-flight reads and identity invalidation; none
may retransmit the answer. A successful skip remains distinct from a confirmed answer.
Desktop render/host controls and native simulator/emulator execution are separate;
unexecuted native journeys and physical/live-account acceptance remain NOT RUN.

Capability controls must exercise unavailable/error/account-switch metadata as
well as available-but-declined consent. Both the visible choice and controller
submission boundary must agree; no trigger is sent for an unavailable capability,
and an existing pending intent is retained. Consent menu checks use one real tap
and observe the window rather than retrying a lost interaction into a pass.

Push controls must cover logout and off/on during permission/token work, stale
receipts, and opening a notice with current authorization. The default unconfigured
build never substitutes a token or reports delivery. Use `apps/studio-native/PUSH.md`
for the provisioning boundary; source review and local transport do not qualify
APNs/FCM acceptance or a physical notification.
`test_apple_push_config.py` executes the fixed release helper and controlled actual
upload shell path. A wrong profile, disabled exported flag, wrong signed app/team,
non-production APNs entitlement or unsafe/ambiguous IPA must stop before upload.
The old upload script is a negative control; mocked signing commands are not
Apple signature or device evidence. Existing deployment and two-source gate tests
retain their assertions, and the new tests run in the existing native contract CI.

For MFR-03/04 and MVOICE-03/04, automatic personal-history reads keep a cached ready conversation
visually quiet. `testSecondSpokenTurnSendsThroughQuietPeriodicHistoryAndStopKeepsTheNextDraft`
holds an actual model history GET while a second final event produces a distinct accepted request,
then verifies a third capture and Stop preserving its partial draft. Injected recognizer events and
synthetic playback do not establish physical Korean ASR or acoustic turn-taking.

### iOS product feedback verification

`TeamEntryUITests.testSettingsLoginShowsActualAccountAndLogoutClearsIdentity`
covers the settings login entry, exact synthetic account ID, authenticated state,
and identity removal after logout using the existing member-inbox fixture.
Swift syntax parsing passed locally; simulator execution is pending. This is
not evidence of real account sign-in, session restoration or TestFlight readiness.
The fixture performs no live support report submission.

Remaining environment gates (2026-11-18):
- Local scheduling: app automation/project tools return request errors; no
  Mac-bound schedule has been established. Keep the hosted schedule paused.
- App verification: use the existing ios-verify recipe in an authorized Xcode
  environment; current session restrictions still prevent full execution.
- Guarded PR: canonical Harness is absent; connected GitHub contents lookup for
  its policy returned 404 (unavailable to this connection, not proof of deletion).
- TestFlight: verify protected environment configuration, distribution profile,
  App Store Connect access and internal testers after exact-source CI passes.
  Workflow declarations alone do not prove that credentials or permissions exist.
- Product loop: separately verify support receipt, GitHub issue creation and push
  delivery; no end-to-end completion is claimed from local controller tests.

Environment follow-up (2026-11-18): the Mac checkout is accessible again. The
previous 126-test native contract run ended with eight failures and two errors,
all in Android environment/emulator tests; two errors explicitly report denied
`ps` execution. Do not attribute these failures to iOS feedback behavior or mark
the full suite passing. The isolated `test_apple_push_config.py` suite was rerun:
10 tests passed in 62.648s, using synthetic Apple tools, with no real upload.
Log: `/tmp/hps-apple-boundaries.log`.

SwiftPM was retried with writable module caches but manifest execution still
fails with `sandbox_apply: Operation not permitted`; see
`/tmp/hps-ios-core-recheck.log`. Local automation inspection through the app tool
also failed, so Mac-bound scheduling remains unverified and the hosted task
remains paused. Neither limitation is fixed by changing product source.

Resume in an authorized local terminal or the existing CI runner with
`bash apps/studio-native/scripts/ios-verify.sh` from the repository root. This
runs Core tests, the unsigned device build, simulator journeys and evidence
collection without uploading a release. Inspect its results before guarded PR
preparation. Do not disable sandbox protections or substitute these synthetic
Apple-tool tests for this full app verification.

`ProductFeedbackTests` exercises the production controller with injected transport
and persistence: payload allowlist, save-before-send failure, concurrent taps,
receipt persistence/reopen, malformed/failed responses, corrupt storage, receipt
save failure, timeout and input bounds. No production report is sent.

With Xcode, run the StudioCore test suite. On a Command Line Tools-only Mac the
same feedback scenarios can be compiled directly (XCTest is not available):

```sh
swiftc -module-cache-path /tmp/hps-swift-cache -parse-as-library apps/studio-native/ios/Sources/StudioCore/*.swift apps/studio-native/ios/Tests/StudioCoreTests/ProductFeedbackTests.swift -o /tmp/hps-feedback-smoke
/tmp/hps-feedback-smoke
```

Before TestFlight: build the iOS target; on simulator and physical iPhone verify
settings → feedback before login, keyboard/Dynamic Type, close/reopen persistence,
separate account drafts, cancellation without a POST, export, and VoiceOver.
With an authorized staging transport, verify receipt and disconnect/relaunch
behavior. Then verify the existing support service contract and triage destination
before a deliberately labeled live internal report. Do not claim GitHub issue
creation or push delivery from a support receipt alone.

Local 2026-11-17 update: Xcode 27.2 (27B52) is installed and
`xcodebuild -checkFirstLaunchStatus` succeeds. The simulator Debug build reached
compilation but failed: `sandbox-exec: sandbox_apply: Operation not permitted`
prevents the SwiftUI State macro plugin from running. Missing projected State
bindings in that log are downstream diagnostics, not verified source defects.
CoreSimulator also cannot connect to its runtime-image service in this execution
environment. Build log: `/tmp/hps-ios-account-build.log` (local, temporary).

SwiftPM tests initially failed on the default module-cache write location.
Relocating the caches to `/tmp` resolved that error, but manifest execution then
failed on the same sandbox restriction (`/tmp/hps-ios-core-tests.log`). Do not
disable sandbox protection to obtain a passing result. The direct feedback
scenario executable was rebuilt with the installed Xcode compiler and passed.
Project plist validation and `git diff --check` also passed.

Next: run the app build and full StudioCore suite in an authorized Xcode/CI
environment, then verify settings login, account ID, session restore, logout and
feedback draft isolation on simulator and physical iPhone. Preserve the existing
working changes. Recheck guarded Harness access before PR preparation; earlier
CLI authentication/private Harness failures are historical, not a fresh auth
check. App build, full XCTest, UI/device tests, guarded PR creation, CI and
TestFlight release remain pending. No live report or release was performed.

Local verification passed: compiled every StudioCore Swift source with the feedback
scenario executable and ran it successfully; parsed the changed SwiftUI sources;
validated the Xcode project plist and `git diff --check`. SwiftUI parsing is not an
iOS typecheck/build and these results do not substitute for the device checks above.

### Authorized local Xcode recheck — 2026-11-18

Host `Jays-MacBook-Pro-M6.local`, macOS Darwin 27.2 arm64, Xcode 27.2 (27B52),
base `50f141915281619915f9c837c9a9f434e54ee523` plus the preserved uncommitted
feedback/account changes. The prior sandbox and CoreSimulator connection failures
did not recur in this session; no sandbox protections were disabled.

`bash apps/studio-native/scripts/ios-verify.sh`, through the shared `local_heavy`
queue, passed all 85 Swift core tests, the unsigned Release iPhone build and the
actual-app/three-control push metadata checks. The first attempt then failed
with CoreSimulator `Incompatible device` (exit 147): selecting the last matching
27.2 runtime chose the iPhone Duo-only runtime for iPhone 16 Pro. The recipe now
requires the requested device in the runtime's `supportedDeviceTypes`. Nine shell
contract tests pass with an incompatible same-version runtime last; the original
selector fails that control as expected.

The corrected recipe created and booted its own iPhone 16 Pro on
`com.apple.CoreSimulator.SimRuntime.iOS-27-2`, compiled the simulator app and ran
all 38 UI tests: **37 passed, 1 failed; recipe exit 65**. The new
`testSettingsLoginShowsActualAccountAndLogoutClearsIdentity` passed.
`testExperienceConsentUsesExplicitSettingsAndDecliningKeepsQuestionEntry` failed
at `TeamEntryUITests.swift:174` because the expected settings button was not found.
The captured accessibility hierarchy shows an open settings sheet; the cause of
the missing button remains unresolved. This is not an Xcode environment failure.
No test was skipped or retried into a pass. The collector retains overall FAIL.
The owned simulator was shut down and deleted successfully.

Evidence: `apps/studio-native/evidence/{swift-tests.log,device-build.log,
push-metadata.json,simulator-test.log,Studio.xcresult,journey-attachments/,
native-journeys.json,signin-journey.json,simulator-cleanup.log}`. The original
failed attempt and initial working-file hashes are under
`/tmp/hps-xcode-env-01a1ec6e/`; these are local artifacts, not CI receipts.
Physical iPhone, completed live authentication, live support submission and
TestFlight remain NOT_RUN. Environment execution is restored; full app acceptance
is still FAIL pending investigation of the settings journey.


### Internal feedback candidate — Studio #4337

`testFeedbackDraftIsolationCancelAndReceiptSurviveReopen` exercises the actual
settings and feedback Form, real per-scope local files, guest restart recovery,
confirmation cancellation with zero requests, guest/account draft separation,
and a synthetic receipt surviving restart without replay.
`testUncertainFeedbackRestartsWithoutResending` injects a transport timeout and
requires preserved text, no receipt, no Send action and zero new requests after
restart. The DEBUG-only transport replaces all report requests during native
journeys; it never contacts the operating support endpoint. Its files use the
existing journey namespace to prevent contamination between runs.

The experience-consent journey must scroll the real settings list until its
existing control is hittable, tap it, and retain both grant/decline and the
subsequent question-entry assertions. A missing or unreachable control still
fails after bounded scrolling. The inherited failure stays in the original
2026-11-18 evidence; new runs use separate result bundles.

These checks do not establish real-account sign-in, server receipt, physical
iPhone accessibility, TestFlight processing, installation or reporter acceptance.

| Test ID | Targets | Required evidence |
|---|---|---|
| MFB-T01 | MFB-01, MFB-02 | Settings account journey and guest/account draft reopen journey, with zero requests after cancellation. |
| MFB-T02 | MFB-03 | Core persistence/failure controls and native receipt/timeout restart journeys; positive request-count control before restart. |
| MFB-T03 | MFB-04 | UTF-16 boundary controls, retained text/receipt on persistence failure, native experience settings grant/decline and physical export/accessibility verification. |

### Internal request and discussion client (Studio #4340)

| Test ID | Targets | Required evidence |
|---|---|---|
| MTR-T01 | MTR-01, MTR-02 | Core account-switch/late-receipt tests and storage-failure controls; native draft reopen and permission denial. |
| MTR-T02 | MTR-03 | Persist-before-POST, timeout/restart/recovery without a new POST, mismatched receipt rejection and same-key manual retry. |
| MTR-T03 | MTR-04, MTR-05 | Actual native composer cancel/send, request detail, comment cancel/send and receipt/recovery screenshots; pagination and service permission tests are separately owned by Service. |

`TeamRequestTests` uses synthetic identities and injected transport/storage.
`TeamEntryUITests.testInternalRequestCancelReceiptAndDiscussion` and
`testInternalRequestUnknownResultRecoversWithoutReplay` use the real UI and
account model with the DEBUG-only TeamEntry transport. They never contact the
operating internal request API. Their results do not establish live Lab/D1
membership, production retention, real-account discussion or installed-iPhone
acceptance. TestFlight and physical accessibility remain separate acceptance.

### Internal triage client — Studio #4342

| Test ID | Targets | Required evidence |
|---|---|---|
| MTR-T04 | MTR-06, MTR-07 | Native request detail to triage, cancel preserving exact text, explicit save receipt and refreshed history. Read-only authority must prevent writes and member-picker reads. |
| MTR-T05 | MTR-08 | Durable unknown outcome with same-key manual retry, storage failure before dispatch, revision conflict requiring refresh/rebase and first-attempt assignee denial versus uncertain retry. |

`TeamWorkflowTests` covers six injected Core scenarios. The actual simulator
`testInternalWorkflowCancelSaveAndHistory` uses DEBUG-only synthetic transport;
it does not prove deployed API integration or installed-device acceptance.
Service owns the insert/read revocation and product membership controls.

### Internal GitHub association client — Studio #4349

Core `TeamGitHubTests` covers durable uncertain-before-send, restart without replay,
explicit same-key recovery, read-only access, disk failure, refresh-before-rebase,
late account reply rejection, complete lineage input, foreign URLs and ordered history.
Actual native `TeamEntryUITests` covers cancel with zero synthetic posts, explicit
save with one event, refreshed metadata, read-only access and unsaved export/exit guard.
The DEBUG fixture never contacts GitHub or the production Service and contains no
provider credentials. Its counters distinguish requests from stored associations.

Focused local validation: seven Core tests passed in
`artifacts/m1/github-core-3.log`; three native simulator journeys passed in
`artifacts/m1/github-ui-4.log`. Earlier failed UI attempts remain in
`github-ui-1.log` (SwiftUI declaration), `github-ui-2.log` (offscreen receipt)
and `github-ui-3.log` (history accessibility identity). Final UI assertions
use bounded real scrolling and confirm one stored event, cancellation with
zero POSTs, and two explicit same-key POSTs with one event after an unknown result. These fixtures do not prove deployed Service #567 integration,
actual operator grants, Apple processing, TestFlight availability, installation
or reporter confirmation. Those gates remain NOT RUN.


CI run `44298015149` at `558498e3` completed 47 UI cases with one failure:
repeated downward swipes dismissed the GitHub association sheet before reading
its counters. The regression now stops scrolling when that row is reachable;
cancel/save/history and unknown-result recovery retain their original assertions.
The same job hit its 45-minute execution limit after approximately 34 minutes of
UI tests plus build/setup overhead. Its bounded limit is now 55 minutes to allow
result finalization, cleanup and artifact upload. This raises the worst-case
runner allocation by ten minutes per iOS job, with no added jobs or automatic
retry; individual case limits remain unchanged. Neither change makes the failed
run passing. A new exact-source remote run is required.

Both affected simulator journeys passed on 2026-11-18 (2 tests, 0 failures;
`/tmp/ios-4361-github-regression.xcresult`, log of the same basename).
This is focused synthetic verification, not a full-suite or installed-device pass.


Conversation status simplification (2026-11-18): the existing
`testPersonalQuestionReadyAndSendWhileDesktopListIsHeld` journey now verifies
that a successful answer does not display the completed saved caption, routine
same-account notice, or main syncing spinner while its transport counters still
prove a real send during a held background request. Existing timeout/retry and
logout journeys retain their actionable-state assertions. Focused simulator validation passed: both this journey and
`testHistoryTimeoutWaitsForExplicitRetryAndPreservesDraft` completed with zero
failures (`/tmp/ios-quiet-conversation.log`, `/tmp/ios-quiet-conversation.xcresult`).
The resource-wrapped runner exited 0; its dedicated simulator was removed.
This is local synthetic UI evidence, not a new shipped TestFlight build.

### Read-only delivery evidence — Studio #4364

`TeamDeliveryTests` checks the exact freshness boundary, rejection of foreign
request/repository and malformed/overclaimed evidence, account changes during
both successful and failed reads, and unavailable-server clearing/retry. The
screen recomputes freshness each second; it does not poll or mutate the server.
`TeamEntryUITests` opens the real request detail and delivery screen against a
DEBUG-only transport, checking exact version/build, unobserved personal states,
stale observation wording and unavailable-endpoint handling. These tests do not
prove production activation, Apple state, installation or reporter resolution.

Local evidence (2026-11-18): six focused Core cases passed, including repeated
account-boundary invalidation of a retained navigation controller
(`/tmp/ios4364-core-final-lifetime.log`). Two real simulator journeys passed with
owned-device cleanup exit 0 (`/tmp/ios4364-delivery-ui-reviewed.xcresult`); their
rendered screenshot was inspected. Those UI runs preceded the final weak-registry
retention correction, which is covered by the final Core case. Full-suite CI,
production Service integration, signed delivery and physical-device acceptance
remain NOT RUN for this slice. No hosted model call, automatic server polling,
operator mutation or additional cloud service is introduced.


### Reporter outcome confirmation — Studio #4366

Focused Core cases cover persisted-before-send explicit action, exact build,
expired/unavailable evidence reopening, required reason, unknown restart and
same-key replay against newer history, late account success/failure, storage
failure export, readonly and revision conflicts, refresh-before-next response,
retention capability compatibility, forged receipts, and latest/prior build
selection without mutating uncertain drafts. Native UI journeys exercise
cancel/resolve/refresh/reopen, unknown navigation and explicit deduplication,
and readonly/storage-failure behavior through DEBUG-only transport.

Core: nine cases PASS (`/tmp/ios4366-core-build-choice.log`). Initial native
attempts failed during compilation (State declaration and Section overload);
those failures are retained. Three native journeys subsequently passed: readonly/
storage export in `/tmp/ios4366-outcome-ui-3.xcresult`, uncertain navigation/
same-key recovery in `/tmp/ios4366-outcome-ui-4.xcresult`, and cancel/resolve/
refresh/reopen in `/tmp/ios4366-outcome-ui-5.xcresult` (runner exit 0). Earlier
scroll-window assertion failures remain in v3/v4; only failed cases were retried
with bounded reveals and the original assertions. The server-scoped retention
copy changed before v5; other product source is identical across these passing
cases. The v5 screenshot was inspected for readable version/build and self-report
wording. Dedicated simulators were cleaned up. Full-suite, production API, signed
TestFlight and physical-device acceptance are NOT RUN.


Follow-up visual review of the v5 screenshot found stale resolved history still
labelled latest after a successful reopening. The corrected controller reads
current history automatically after persisting the receipt, with account and
revision guards; a failed read preserves acknowledgement and labels history as
previously loaded. Eleven Core cases pass (`/tmp/ios4366-core-refresh.log`),
including immediate resolve/reopen, read failure, stale read, account change
while refreshing, and older receipt replay against newer current history.
The affected native journey passed with runner/cleanup exit 0 in
`/tmp/ios4366-outcome-ui-6.xcresult`. The inspected screenshot shows the reopened
result as current immediately, matching its saved draft and reason. Prior v3/v4
UI passes predate this automatic-read change and are not exact-source evidence
for it. No broad or unrelated test rerun was performed.


### Durable retry target regression — 2026-11-18

CI run44310462168 at359cb613 failed the single retry after relaunch: one initial
POST, no second POST, and a visible 20.3pt retry target. The old trace cannot
distinguish a missed touch from an admission race; it does not prove either.
The retry now has a >=44pt label hit area. DEBUG-only stage diagnostics contain
no user text and distinguish actual touch, admission and POST entry. The same
single normal tap, exact request ID/words and visible reply assertions remain.
Focused simulator validation passed in `/tmp/ios-release-failure-focused.xcresult`:
the target was102x58pt, stages touch/attempt/admitted/post, the same ID submitted
twice and one accepted turn. No retry semantics, delays or timeout budgets changed.
This is local synthetic evidence; remote CI and physical-device acceptance remain
separate. The prior failing CI evidence is retained.


### Held history without removed status UI — 2026-11-18

CI run44310557985 at2e7de2dc exposed an obsolete positive assertion for the
removed `sharedSyncing` element. The queued-voice journey now waits for the
fixture's actual active-history-read barrier and asserts that the removed UI
stays absent. Existing held-read, voice capture, send-once, reply and resumed
listening checks remain. Both this case and durable retry passed together in
`/tmp/ios-release-failure-focused.xcresult` (2 cases, runner/cleanup exit0).
All remaining references to the removed saved/account/sync labels in native
journeys were checked; they assert absence, not stale positive visibility.


### Team inbox and explicit subscriptions — Studio #4368

Core controls cover explicit stable-key subscription recovery, request mute,
late account replies, fresh detail plus read acknowledgement, bounded/malformed
pages and revisions, source freshness, typed opened destination identity, and
legacy versus transient capability discovery. Final Core15 PASS (Inbox9 plus
existing Push6), runner exit0: `/tmp/ios4368-core-final.log`. A recognized
`team_subscription_conflict` during recovery becomes a durable conflict requiring
fresh read and explicit new choice; unknown409 remains uncertain. Valid480+50
filtered rows retain the first500 with read state and stop further pagination.
Independent source re-review accepted both corrections.

Native evidence is deliberately separate from those final Core-only changes:
- Denied OS permission, explicit opt-in, inbox/request detail, per-request
  settings link and original draft preservation PASS30.254s in
  `/tmp/ios4368-inbox-ui-4.xcresult`.
- Warm/cold authorized push, occupied context-sheet deferral, retained context
  text and main draft, and detail back-to-inbox closure PASS51.328s in
  `/tmp/ios4368-inbox-ui-6.xcresult`, runner and owned-simulator cleanup exit0.
  This verified the one-shot initial push route correction: returning from detail
  must not replay initial navigation. Screenshot inspected at
  `/tmp/ios4368-inbox-ui-6-attachments/FC3530F9-3676-4BF8-B86A-71622E05A46D.png`.

Earlier native attempts remain failed evidence: v1 lacked the fixture launch
argument, v2 exposed an actor-isolation compile error, v3 awaited an offscreen
lazy settings row, v4 selected an underlying navigation bar, and v5 exposed the
initial-route replay. Each was corrected; only affected flows were repeated.
The denied-permission pass precedes the route-only fix; both native passes
precede the final conflict/cumulative-cap Core fixes, which passed focused Core
regressions. No blanket exact-final native-suite pass is claimed.

Fixture transport, OS permission result and notification envelope are synthetic;
the actual account, model, protected preferences, navigation and screens remain.
No production subscription, provider send or installed-device receipt is claimed.


### Explicit question and reply authoring — Studio #4370

Focused Core controls cover old JSON draft recovery with exact v1 payload/key,
v2 intent/target freezing through serialization, same-request target selection,
authoring discovery and malformed metadata, specific definitive conflict versus
unknown409, and matching acknowledged server tombstones versus uncertain text.
Core12 (Discussion5 plus existing Request7) passed in
`/tmp/ios4370-core-final.log`. After the final target-selection guard, focused
Discussion5 passed in `/tmp/ios4370-core-target-guard.log`. The existing Request7
pass precedes that isolated guard; it was not unnecessarily repeated.

Native v2 question unknown-result recovery followed by a selected-comment reply
passed48.996s in `/tmp/ios4370-discussion-ui-2.xcresult`, runner/cleanup exit0.
Final expanded journey PASS59.040s in `/tmp/ios4370-discussion-ui-4.xcresult`,
runner and owned-simulator cleanup exit0: both home entries are visible/hittable
and opened; question recovery retains one event; definitive target409 permits
explicit fresh choice; words remain and send stays disabled until a replacement
target is selected; the chosen reply is stored and rendered descriptively.
The final native source includes the pre-dispatch epoch fence. Inspected image:
`/tmp/ios4370-discussion-ui-4-attachments/A826EC23-AEA3-49B0-AF3E-DDEEAFECF15F.png`.

Preserved failures: first runner attempt exited2 before build because an external
checkout switched away from a selector script; the script is now pinned locally
from exact2c6d0f83. Native v1 exposed the parent inbox toolbar regression: multiple
buttons in a single ToolbarItem hid the existing team-request entry. A scoped
ToolbarItemGroup correction retains both entries rather than removing assertions.
Native v3 remains FAIL: both home entries passed, then the focused editor kept
the target selection from taking effect. Dismissing editor focus at send/new
choice corrected that flow with one ordinary target tap; no assertion or wait
budget was weakened. Toolbar correction is isolated in69abb919 for parent4368.
Fixture HTTP responses remain synthetic; no production send or phone acceptance.

Retention limitation: discovery exposes supported schemas, not current thread
writability. A stored content-expired draft stays unavailable/exportable; an old
purge mark does not prove current write permission after a later reopening.
That reactivation needs a separately defined current writable contract. The
client does not infer it or automatically retry an expired send.

4370 retention review correction: comment pages now share one purge generation.
A changed purge revision clears accumulated rows before a read-only first-page
refetch; an older refetch cannot restore them. Acknowledged local content stays
hidden until fresh matching account/key/receipt content is reconciled. Uncertain
and unsent drafts are not removed. The pre-purge page1/post-purge page2 regression
and the existing Discussion controls passed together (Core6) in
`/tmp/ios4370-core-retention-pages.log`, exit0. The actual simulator-target App
build passed in `/tmp/ios4370-retention-app-build.log`, exit0. Native v4 evidence
above predates this pagination correction; it was not relabeled as a final-head
UI rerun.

### Stopped voice response draft input boundary — CI #4361

Run44326288656 on0ea2078b restored `Keep my separate` after the stop-response
journey immediately terminated following `typeText("Keep my separate draft")`.
The original recording at
`/tmp/ios4361-stop-full/A9397026-6036-45C3-9082-4E3D51828601.mp4` does not establish
complete input before termination: sampled frames show `Ke`, then termination,
then the partial restored text. This is not proof of a persistence defect.

The journey now requires exact full input before terminating and exact full
restoration afterwards, each using the existing10s wait. It keeps one typeText,
no retyping, original cancellation/send-once/no-restart assertions, and records
each boundary. An incomplete precondition fails the test before termination.
Independent source review accepted the stronger assertion and failure guard.

Focused native PASS31.469s (Executed1), runner and owned-simulator cleanup exit0:
`/tmp/ios4361-stop-input-boundary-2.xcresult`. Both equality predicates passed.
The earlier `/tmp/ios4361-stop-input-boundary.xcresult` selected the wrong class
and executed0 tests despite exit0; it is NOT validation. Captured AX descriptions
truncate long values, so the final diagnostic attachment additionally records raw
`input.value`; that diagnostic-only addition followed the passing run and was not
claimed as a rerun. Product runtime code is unchanged; remote CI remains separate.


### Current GitHub observations — Studio #4373

Core4 PASS in `/tmp/ios4373-core.log`, resource wrapper exit0: device expiry and
provider failure remain distinct; recorded-run source claims are validated;
association cursor409 clears old rows before fresh reload; account/session
changes clear late responses and repeated registry invalidation survives reopen.
The native acceptance journey preserves an association draft across current,
expired/provider-failed and unavailable reads, then returns without a write.
Native v3 PASS39.150s (Executed1), `/tmp/ios4373-observations-ui-3.xcresult`,
runner and owned-simulator cleanup exit0. It preserves draft issue77 after
current→expired/provider-failed→503 reads and back, with zero association POSTs.
Inspected stale/error screenshot:
`/tmp/ios4373-observations-ui-3-attachments/2247375E-83CD-44D4-9275-10B0350688F5.png`.
Independent source review and root read-through PASS; root also inspected the
current-state screenshot. Requirement integrity PASS743; this is not whole-product
acceptance. No source changes followed the passing native run, only this record.

Initial native build failed before test execution because the new App file
imported StudioCore even though this Xcode target compiles Core sources directly.
Removing that import follows the existing App file pattern. Original evidence:
`/tmp/ios4373-observations-ui-1.log`, wrapper exit65, zero executed UI tests.
No Service deployment, provider reconciliation, TestFlight upload or installed
user acceptance is claimed. Integrated stop-input boundary test evidence above
remains independent of this readonly feature.

Native v2 failed after rendering current evidence: the parent VStack accessibility
identifier overrode the nested source-mismatch identifier. The actual recording
frame `/tmp/ios4373-failed-frame.png` visibly shows the complete mismatch warning.
Removed the unused container identifier to preserve child identifiers; the exact
child assertion remains. Original v2 result is retained at
`/tmp/ios4373-observations-ui-2.xcresult` (one executed failure, wrapper exit65).


### Explicit related requests — Studio #4375

Focused Core4 PASS in `/tmp/ios4375-core-2.log`, resource wrapper exit0: a committed
unknown link recovers the same key and can later be explicitly withdrawn; a
recognized conflict preserves words/key until fresh history and deliberate choice;
readonly inspection does not change its draft or send; foreign/malformed pairs
and receipt identity mismatches are rejected. Initial test-fixture compilation
failure in `/tmp/ios4375-core.log` is preserved (mixed String/NSNull inference,
corrected with explicit Any; no runtime workaround).

Core5 including late-account and failed-persistence controls passed in
`/tmp/ios4375-core-3.log`, wrapper exit0. Independent review found that original
navigation could discard an in-memory draft after storage failure; both original
links now share the busy/storage guard. Native savefailure navigation/export
control passed22.024s in `/tmp/ios4375-related-ui-2.xcresult`.

At that point the other two native journeys required concrete corrections. v1
failed before tests because @State declarations cannot share multiple variable
names; splitting the declaration fixes the actual build error. v2 failed after
unknown recovery and original navigation passed: an unlink action assertion was
queried after its row scrolled offscreen; the unchanged assertion now runs before
reason typing, after bounded reveal. Readonly history exposed a product bug:
NavigationLink and history Button shared an automatic List row, so the history
tap also navigated. `/tmp/ios4375-readonly-frame.png` shows the wrong destination.
The two actions now occupy separate rows. Failed evidence is preserved in
`/tmp/ios4375-related-ui-1.log` and `ios4375-related-ui-2.xcresult`; affected
two-case retry followed, without repeating the unrelated passing savefailure
journey. These fixtures
are not actual Service deployment or installed-device acceptance. Broad hidden
content/local acknowledged-cache compatibility is a separate required integration
before rollout. Source does not grant operators or activate production state.

Native v3 passed the full cancel/unknown-recovery/original-navigation/unlink case
in47.925s. Its readonly case passed history inspection, then the final draft hit
check was blocked by the simulator's first-use keyboard tip. The actual frame
`/tmp/ios4375-return-frame.png` shows the complete preserved comment beneath
"Speed up your typing… Continue". The retry recognizes only that exact system-tip
prefix and dismisses Continue once; original hittable and exact draft assertions
remain unchanged. `/tmp/ios4375-related-ui-3.xcresult` retains both the passing
case and this failure. No product source changes followed v3; only readonly-test
handling of the system tip and documentation changed.

Native v4 dismissed the recognized keyboard tip, but the restored editor focus
then placed the keyboard over its retained input. Actual frame:
`/tmp/ios4375-return4-frame.png`; the failure is retained in
`/tmp/ios4375-related-ui-4.xcresult`. Clearing only comment focus on detail
disappearance was attempted without changing the draft.
That callback alone did not fix the interaction; prior passes are not relabeled.

Final Core6 PASS in `/tmp/ios4375-core-final.log`, wrapper exit0, adds a durable
received-receipt floor and exact receipt ID at equal revision. Stale history
cannot enable a new action; a coherent explicit refresh can. Pagination cannot
roll back the currently loaded same-pair history. This does not claim a general
cross-refresh maximum-revision cache. Independent final source review PASS for
these guards, protected navigation and focus clearing. Native link/unlink v3 and
savefailure v2 evidence above predates the final receipt guard/focus correction.

Native v5 still showed the restored keyboard covering the editor
(`/tmp/ios4375-return5-frame.png`). Focus resignation on disappearance was too
late for navigation's focus capture. The related entry now uses an explicit
state-driven transition: clear focus, capture product, then present on the next
main turn only if the source generation/storage/busy guards still hold. There
is no arbitrary sleep or automatic request. The affected test additionally
requires keyboard absence before its original hittable/exact-draft assertions.
Original v5 failure is retained. V6 passed31.713s (Executed1) in
`/tmp/ios4375-related-ui-6.xcresult`, resource runner and owned-simulator cleanup
exit0. It verifies readonly history, no mutation, absent keyboard and exact
preserved editable comment text. Inspected restored screenshot:
`/tmp/ios4375-related-ui-6-attachments/AE57CF32-6D18-40A6-8075-386FEA7CCC97.png`.
The link/unlink screenshot from passing v3 was also inspected:
`/tmp/ios4375-link-3-attachments/DD9767A4-503D-4D1C-917A-33B914864F5B.png`.
Final targeted focus/navigation source review PASS. Requirement integrity PASS746.
No product source changed after v6; only this evidence record was completed.


### Full related-request suite budget — 2026-11-19

Run44352970455 attempt3 atcae1f21b passed147Core and59UI tests (2410.189seconds
forUI), but its iOS job was cancelled after reaching the55-minute fulljob cap.
Android instrumentation did not start because Google Messaging showed a foreign
ANR; keep that environment failure separate. Increase only the outer iOS cap
to65minutes, retaining individual test limits, assertions, failure handling and
strict same-attempt acceptance. This permits at most ten additional hosted Mac
minutes per job and adds no model calls. A fresh full run is still required.
