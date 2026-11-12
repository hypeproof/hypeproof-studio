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
