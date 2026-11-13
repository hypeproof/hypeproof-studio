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
| MFR-T03-queued | During a delayed history refresh, finish a voice turn; after refresh, send exactly once, show its reply and resume listening. The trace must prove speech ended while that history read was pending. | A queued local request must retain its voice continuation; no lost reply, duplicate POST or manual retry to make the test pass. |
| MFR-T04 | Background during a partial capture, return and relaunch; microphone stays stopped and unsent words remain. Explicit Send can then obtain an answer. | Returning to foreground must not silently restart recording or send the draft. |
| MFR-T05 | First POST fails; retry remains available with the original words. Relaunch and explicitly retry: the same request ID and text are reused and accepted once. | No automatic resend, lost outbox or duplicate accepted turn. |
| MFR-T05-recorded | A Service-shaped failed turn leaves its user event and terminal ID after the first POST. Relaunch, explicitly restore into an empty composer, relaunch again, then explicitly Send. | Restore/relaunch creates no POST; only Send creates a distinct ID at the reconciled revision. The original failed event remains. |
| MFR-T05-collision | After a recorded failure, write a different draft and relaunch. | Restore stays disabled and preserves the draft. Pure controls also cover unsaved overlays, whitespace and all non-failed states. |
| MPER-T03-history | Reopen an 80-message cached conversation, switch away while reading an equal-count cached conversation, and change synthetic account. | The correct latest answer is inside the actual viewport; history navigation creates no AI request and cannot retain the other account's messages. |
| MPER-T03-following | Advance a real App's HTTP snapshot beyond 80 messages without growing its window. At the bottom, follow the new tail; while reading old text, preserve a visible passage until explicit latest or Send. | The catch-up control is at least 44pt. Keyboard input remains reachable; only explicit Send creates the one new request. |
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

Focused command: `node scripts/run-tsx-tests.mjs personal-reflection-entry` from
`extensions/hypeproof-chat`. Relevant existing controls are initial-surface,
activity-resume, studio-folder-navigation, account-start-entry and
mobile-conversation-host. Evidence must name the exact source, Node/OS, command and
exit code. Simulator/native tests, physical iPhone, actual Google/account admission,
installed desktop focus/navigation and live model quality remain **NOT_RUN** unless
separately observed. A prepared runner or green build is not that observation.

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

New App journeys and changed AX diagnostics require actual hosted Xcode execution.
Source/parser checks are not App, installed-device, live-auth or physical-ASR PASS.
