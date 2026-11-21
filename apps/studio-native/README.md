# HP Studio native mobile preview

Native SwiftUI iPhone and Android clients for HP Studio. The desktop product is the existing HypeProof Studio application and its RC pipeline. A separate mobile-derived Mac Catalyst application is no longer built or distributed.

The current iPhone and Android candidate starts with an everyday question in an account-owned personal reflection conversation, including when the desktop is closed. The existing desktop opens the same personal conversation in its task UI. Host-owned build tasks retain their desktop execution boundary; making requests lead to the existing desktop's reviewed task flow. Existing local notebooks remain in **기기 메모** on iPhone and **기기 기록** on Android. Service owns questioning and model admission; no separate mobile prompt or provider bypass is introduced. This source is a candidate, not evidence of a deployed sync service or physical-device acceptance.

## Requirement: ST-REQ-NATIVE-MOBILE

In the separate local notebook, a person records an observation, optionally connects free AI after age and transmission consent, and confirms/revises their intention in their own words. Project-local drafts and revision history survive restart. Export and explicit deletion are available. AI may suggest a next question; it cannot create confirmed human intent. Recent 20 messages plus the latest confirmed intent are sent for only the selected project.

Philosophy → Product Intent → behavior: introspection, multiple perspectives and practice inform the prompt and the observation/reflection flow (ST-INT-NATIVE). These are design hypotheses, not established growth outcomes, diagnoses or personality/fate scores. Foundry execution and economic dashboards are future work.

## Boundary and costs

Native filesystem, share sheet, and application lifecycle belong to the App layer. HypeProof Service owns admission, model routing, policy, metering and monetary ceilings. The primary personal conversation uses account-scoped `/v1/me/reflection` and `/v1/me/reflection/turns`, protected account credentials and durable request IDs. It does not use a legacy notebook grant as an account-access fallback.

The legacy notebook client uses `/v1/free/claim` and `/v1/messages`, the `hypeproof-fast` alias, low effort and at most 2,048 output tokens. No provider secret is shipped. Its installation ID remains stable when records are deleted; its bearer grant stays in process memory. Reconnect renews access under the same server allowance, not a new free identity. Exact monetary allowance is Service-owned and must not be inferred from token count. CI is manual/change-triggered, capped at 25 macOS and 20 Linux job minutes; no recurring job.

Records stay in app-private storage; iOS uses file protection and excludes notebook backup; Android disables app backup. Sending to AI is opt-in per app session. Local deletion does not delete data already sent to the Service. Exports contain conversations and intentions; only an explicit share action exports them. The local notebook remains device-local. The linked iPhone surface adds explicit opt-in account sync of selected personal conversation text, with a protected local cache and durable request IDs. Files, tool output, temporary chats and classroom records are excluded. Account data is stored through HypeProof Service over TLS; this is not end-to-end encryption. Handwriting, push notifications, Foundry deployment and financial telemetry remain outside this candidate.

## Native voice and acceptance

**말로 적기** appends recognized Korean to an editable draft without sending;
explicit Send requests an answer. The iPhone and Android account-conversation candidates start
voice through one deliberate microphone action after required OS permissions and
existing AI/storage consent. Stable speech and silence finalize once; its own
reply is read before listening resumes in the active foreground conversation.
No recurring confirmation sheet, end-speech or next-turn tap is required.
Stop, background, account/conversation change and audio interruption end the
interaction and fence stale callbacks. Returning to the app does not restart
capture. Recognition failures preserve partial draft text.

Android personal questions and local notebooks use the same automatic controller.
Android waits for the recognizer's final result; end-of-speech starts a bounded
8-second final wait. Listening has up to 60 seconds to reach that endpoint,
followed by at most eight seconds for the final result. Optional
RMS callbacks are not a prerequisite, and a timeout never sends aged partial text.
The iPhone legacy notebook still requires its own revised journey and physical verification. Existing
source and tests do not establish acceptance of continuous conversation. The
revised shared requirements and first iPhone journeys are in the mobile roadmap and
`docs/testing/native-mobile-growth.md` (MVOICE-02/03 and MFR-03/04).

Only platform on-device recognition is used. iOS checks both
[supportsOnDeviceRecognition](https://developer.apple.com/documentation/Speech/SFSpeechRecognizer/supportsOnDeviceRecognition)
and requires it on the request. Android uses
[createOnDeviceSpeechRecognizer](https://developer.android.com/reference/android/speech/SpeechRecognizer#createOnDeviceSpeechRecognizer(android.content.Context))
where available. Missing Korean assets/engine or denied permission returns to
text. There is no cloud recognizer fallback, paid speech provider or raw audio
upload. The linked iPhone surface optionally keeps up to 30 seconds of in-memory
local audio for self-listening. It is off by default and removed on stop, navigation,
background or next capture; explicit deletion is also available. Read-aloud uses installed OS Korean voices; Android
rejects network-required voices. Physical offline behavior still needs observation.

Unit tests exercise stale/duplicate turn fences; native UI tests cover record
persistence, consent, draft recovery and permission/error paths. Fixtures do not
prove microphone quality, Korean ASR, natural-language policy or learning. Actual
five-turn spoken sessions on iPhone and Android remain separate acceptance.
Question policy/measurement are shared Service work, not a mobile prompt fork.

Run `bash apps/studio-native/scripts/android-verify.sh` with JDK 17, SDK 35,
Gradle 8.9 and `ANDROID_SERIAL` set to a **disposable emulator**. It rejects
physical devices before instrumentation replaces local preview records.
Screenshots/logs go to `apps/studio-native/evidence/android/`. The detailed
requirements and physical acceptance are in the [mobile roadmap](../../docs/requirements/mobile-growth-roadmap.md#native-voice-client-slice--3687).

## Build and evidence

- iOS: `bash apps/studio-native/scripts/ios-verify.sh` on a Mac with Xcode 27+ and a matching iOS Simulator. CI pins Xcode 27.2 on the standard `xcode-27` image and selects an iPhone explicitly supported by its matching runtime. The upload lane enforces iOS 27+ before materializing signing credentials and records the actual toolchain/SDK versions. This addresses Apple ITMS-90725 ahead of its April 2027 requirement; the earlier 18.1 upload remains historical 26.2 SDK evidence. Builds an **unsigned device app** and runs an actual native simulator capture/confirmation/relaunch test. Local Command Line Tools alone are insufficient.
- Core controls: `swift test --package-path apps/studio-native/ios`.
- Android: JDK 17, Android SDK 35, Gradle 8.9. In `android`, `gradle --no-daemon :app:testDebugUnitTest :app:assembleDebug :app:lintDebug`. Debug APK installs independently; release signing/Play distribution remains separate.
- CI: `.github/workflows/studio-native-mobile.yml`; artifacts identify exact source SHA. Fixture/unit/simulator evidence is never physical-device acceptance.
- iOS CI runs in three stages. `iOS build` runs `ios-verify.sh build`: core tests, the device build and one simulator `build-for-testing`, plus a shard plan from `scripts/ios-ui-shards.py`. Each `iOS UI shard <i>` job runs `ios-verify.sh shard <i>` (`test-without-building`) on its own simulator. The `ios` job runs `ios-collect.sh`: it merges the shard logs and attachments into the single `evidence/` layout and writes `native-journeys.json` and `signin-journey.json` once. It fails unless the build and every shard succeeded and every planned case started in exactly its own shard (`evidence/ios-ui-shards.json`). The last shard skips the other shards' cases instead of listing its own, so a case the plan parser misses still runs. To add capacity, raise `IOS_UI_SHARDS` and the `ios-ui` matrix together; do not raise a timeout.

### Check the iOS approval push without a phone

1. On a Studio PR, open **Checks** and select **iOS approval push simulator** for the current commit.
2. In the workflow run's **Artifacts**, download `studio-ios-approval-push-<run>-<attempt>`. Open `approval-push-system-notification.png` and `approval-push-matching-read-only-detail.png` on any computer. A successful job has both images.
3. The passing test injects an iOS system notification, taps its Home banner, opens the matching test card directly, and verifies that the approve, hold and explanation-request buttons are absent. It uses a simulated account and card. No phone, TestFlight install, or production credentials are needed.
4. If the job fails, read `build.log`, `xcodebuild.log`, `simulator-steps.jsonl` (each simctl call, its limit and its duration) and the simulator notification log when present. A `simctl-hang-<step>.txt` file means a simctl call did not return within its limit; it records the runner's simulator processes, load, samples of the stuck call and of CoreSimulatorService, and the host CoreSimulator log. For a runner timeout, contributors with repository write access can rerun just this job for the same commit. [GitHub job rerun instructions](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs#re-running-a-specific-job-in-a-workflow)

To run the focused check locally on a Mac with Xcode and its matching iOS Simulator, run from the repository root:

```sh
export HP_APPROVAL_PUSH_EVIDENCE="$(mktemp -d)"
python3 apps/studio-native/scripts/verify-approval-push-simulator.py
printf '%s\n' "$HP_APPROVAL_PUSH_EVIDENCE"
```

With no argument the script runs its four CI steps in order: `build`, `boot`, `run`, `cleanup`. It creates its own temporary simulator and prints the result. The logs, Xcode result bundle, and PNGs are written to the chosen evidence directory.

## iPhone installation gate

Apple enrollment and App Store Connect access were confirmed on 2026-11-10. The signed iOS and Mac Catalyst **0.1.1 (2.1)** packages from `11154686e881033ca49cdced974d4399fb4cbd41` passed Apple processing and became available to internal TestFlight testers in [run 42800520204](https://github.com/hypeproof/hypeproof-studio/actions/runs/42800520204). The user reported successful phone use; the Mac copy was installed and launched with an App Store receipt. This is a bounded baseline observation, not full acceptance of every feature or a public App Store release.

The current Mac has Command Line Tools but no full Xcode installation. Native iOS build and UI validation use the pinned GitHub macOS runner. Signing certificates, provisioning profiles and API keys stay in the Apple release environment; never commit them. The historical Catalyst preview was an incorrect product split; its data is preserved, but it is not the desktop delivery path. Subsequent source changes require fresh verification and a separately identified testing build.

The next vertical slice and dependent work are recorded in [mobile growth roadmap](../../docs/requirements/mobile-growth-roadmap.md). Reflection notes stay local and separate from automatically transmitted context and confirmed intentions.

Human device acceptance: launch from the home screen → create observation → force quit/reopen → confirm/revise intention → opt in to AI → observe a real question or accurate refusal → share/export and delete. No Safari work surface should appear. Do not close the physical acceptance gate from CI alone.

## Personal reflection and optional desktop task sharing

The primary personal reflection conversation belongs to the account and runs
through Service with the desktop closed. Signing into the same account on the
existing desktop opens that conversation; it is not created by pairing a phone
to a running task. The following host-owned path is optional and applies only
to a desktop task deliberately shared with the phone.

On the existing desktop, select a personal task and run **iPhone과 이 대화 연결**.
The disclosure asks before its user/assistant text is uploaded. Sign in to the
same account on iPhone through the native browser sign-in flow, then open that
shared task. Authentication may open the browser; conversation stays native.

For a shared desktop task, desktop remains the execution host. Its selected task, existing history and coach
are reused. The phone's durable outbox has one stable request ID. Service claims
are atomic; a reconnect is a status check, never permission to replay a turn.
When the computer is asleep or another task is selected, that task's request waits;
the account-owned personal reflection conversation remains independent.
The phone explains pending/running/completed/unknown states. Unknown outcomes
require checking the computer; they are not automatically retried as new turns.

The iPhone offers dictation, explicit voice conversation, read-aloud and editable
next-question/skip/small-experiment starters. A person can refuse a question;
there is no background microphone or endless automatic AI questioning.
Account tokens use this-device-only Keychain storage. Local notebook and shared
cache are separated by account. Logout/revocation stop access; cached data deletion,
server sharing deletion and original desktop task deletion remain distinct.

## Signed iPhone delivery

Harness may supply all three optional workflow-dispatch strings: `expected_sha`
(40 lowercase hex characters), `operation_id` (1–100 ASCII letters, digits,
periods, underscores or hyphens), and `request_digest` (64 lowercase hex
characters). The digest is supplied by Harness, not generated by Studio.
Partial/malformed inputs or a source different from the trigger/checkout stop
before signing. Existing no-input manual dispatch and release-branch push remain
supported. Correlated run names are `studio-testflight:<operation_id>:<request_digest>`.

The native gate artifact includes `deployment_request`, `release_run_id` and
`release_run_attempt`. The upload downloads that exact attempt's gate artifact
and checks its source, run/attempt, request and native CI identity before signing
and again before recording a receipt. A failed-job-only rerun cannot reuse an
older successful gate: rerun all jobs to produce a fresh gate. After successful
archive, export, validation and upload,
the existing Apple artifact contains `upload-receipt.json` (`hps-native-upload-receipt/1`):
source/run/attempt, optional request, verified `native_gate` identity,
bundle/version/build, IPA SHA-256/size and
each command's `exit_code`. Its `state: uploaded` records command completion;
`apple_processing` and `tester_availability` remain `NOT_OBSERVED`. It does not
authorize a retry, prove Apple processing or mark the app available. A failed or
uncertain command produces no success receipt; consumers must reconcile the
original run/attempt instead of dispatching another upload. No credentials or
signing material are included. Gate/preflight resolution uses the script's
repository root, independently of the caller's working directory.

`.github/workflows/studio-native-mobile.yml` checks native source and iOS/Android.
`.github/workflows/studio-apple-testflight.yml` archives **iOS only** after the
source-matched native CI gate. Its dedicated `release/studio-unified-preview`
branch is advanced only after the integrated Service/desktop candidate is verified.
Ordinary feature-branch pushes do not distribute an unready integration.

The `apple-native-preview` environment must allow that release branch and main.
It uses `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`,
`APPLE_DEVELOPER_TEAM_ID`, `APP_STORE_CONNECT_PRIVATE_KEY`,
`APPLE_DISTRIBUTION_P12`, `APPLE_DISTRIBUTION_PASSWORD`, and `APPLE_IOS_PROFILE`.
Signing material is ephemeral. Only packages, public identities and evidence are
retained. Existing desktop delivery continues through `build-mac.yml` and the
managed RC/repack process; mobile signing credentials are not a desktop RC substitute.

Acceptance requires actual desktop -> iPhone -> desktop round-trip, preserved
message identities, voice/skip behavior, offline recovery without duplicate model
execution, account revoke and local draft preservation. Source tests, simulator
checks and upload success must be reported separately from this observation.


## Android account questions (#3733)

The launcher remains in the existing Android package. Browser approval includes
the exact existing device code in the trusted URL; the person does not copy a
code between devices. Authentication is checked against `/v1/me`, then account
credentials are encrypted by Android Keystore and stored in no-backup storage.
A refresh token is marked spent before dispatch; uncertain rotation requires
fresh sign-in instead of replaying a one-use token.

The account-scoped cache saves words and a stable outbox ID/revision before
sending. Reconnection checks the shared conversation. Failed saves, stale replies
and account changes preserve the committed state; malformed files stay read-only
and can be exported verbatim. Dictation and explicit voice conversation reuse
the native on-device implementation. Only the initiating request's answer may
be read aloud. Polling pauses in the background; voice stops on navigation or
background. A matching completed reply resumes capture only in the same deliberate
foreground session with an unchanged credential and empty draft. Credential
rotation or approaching expiry stops this voice session; the existing account
refresh protocol remains available through normal explicit account actions.

These questions use existing account AI entitlements and Service cost limits.
The free local notebook connection is separate; it does not grant a signed-in AI
allowance. No Android desktop task list, new Mac application, handwriting, push,
automatic Foundry execution or philosophical growth outcome is claimed here.
