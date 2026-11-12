# HP Studio native mobile preview

Native SwiftUI iPhone and Android clients for HP Studio. The desktop product is the existing HypeProof Studio application and its RC pipeline. A separate mobile-derived Mac Catalyst application is no longer built or distributed.

The current iPhone candidate starts an account-owned personal reflection conversation, including when the desktop is closed. The existing desktop opens the same personal conversation in its task UI. Host-owned build tasks retain their desktop execution boundary. Existing local notebooks remain in **기기 메모**. Service owns questioning and model admission; no separate mobile prompt or provider bypass is introduced. This source is a candidate, not evidence of a deployed sync service or physical-device acceptance.

## Requirement: ST-REQ-NATIVE-MOBILE

A person records an observation, optionally connects free AI after age and transmission consent, and confirms/revises their intention in their own words. Project-local drafts and revision history survive restart. Export and explicit deletion are available. AI may suggest a next question; it cannot create confirmed human intent. Recent 20 messages plus the latest confirmed intent are sent for only the selected project.

Philosophy → Product Intent → behavior: introspection, multiple perspectives and practice inform the prompt and the observation/reflection flow (ST-INT-NATIVE). These are design hypotheses, not established growth outcomes, diagnoses or personality/fate scores. Foundry execution and economic dashboards are future work.

## Boundary and costs

Native filesystem, share sheet, and application lifecycle belong to the App layer. HypeProof Service owns admission, model routing, policy, metering and monetary ceilings. The primary personal conversation uses account-scoped `/v1/me/reflection` and `/v1/me/reflection/turns`, protected account credentials and durable request IDs. It does not use a legacy notebook grant as an account-access fallback.

The legacy notebook client uses `/v1/free/claim` and `/v1/messages`, the `hypeproof-fast` alias, low effort and at most 2,048 output tokens. No provider secret is shipped. Its installation ID remains stable when records are deleted; its bearer grant stays in process memory. Reconnect renews access under the same server allowance, not a new free identity. Exact monetary allowance is Service-owned and must not be inferred from token count. CI is manual/change-triggered, capped at 25 macOS and 20 Linux job minutes; no recurring job.

Records stay in app-private storage; iOS uses file protection and excludes notebook backup; Android disables app backup. Sending to AI is opt-in per app session. Local deletion does not delete data already sent to the Service. Exports contain conversations and intentions; only an explicit share action exports them. The local notebook remains device-local. The linked iPhone surface adds explicit opt-in account sync of selected personal conversation text, with a protected local cache and durable request IDs. Files, tool output, temporary chats and classroom records are excluded. Account data is stored through HypeProof Service over TLS; this is not end-to-end encryption. Handwriting, push notifications, Foundry deployment and financial telemetry remain outside this candidate.

## Native voice and acceptance

**말로 적기** appends recognized Korean to an editable draft without sending;
explicit Send requests an answer. The iPhone account-conversation candidate starts
voice through one deliberate microphone action after required OS permissions and
existing AI/storage consent. Stable speech and silence finalize once; its own
reply is read before listening resumes in the active foreground conversation.
No recurring confirmation sheet, end-speech or next-turn tap is required.
Stop, background, account/conversation change and audio interruption end the
interaction and fence stale callbacks. Returning to the app does not restart
capture. Recognition failures preserve partial draft text.

Android voice still contains the older manual controls; alignment remains open
under #3687. The iPhone legacy notebook uses the shared automatic voice controls
but still requires its own revised journey and physical verification. Existing
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

- iOS: `bash apps/studio-native/scripts/ios-verify.sh` on a Mac with Xcode 26+ and a matching iOS Simulator. CI pins Xcode 26.3 and selects the matching SDK runtime. [Apple upload requirements](https://developer.apple.com/news/upcoming-requirements/) require Xcode 26 / iOS 26 SDK or later. Builds an **unsigned device app** and runs an actual native simulator capture/confirmation/relaunch test. Local Command Line Tools alone are insufficient.
- Core controls: `swift test --package-path apps/studio-native/ios`.
- Android: JDK 17, Android SDK 35, Gradle 8.9. In `android`, `gradle --no-daemon :app:testDebugUnitTest :app:assembleDebug :app:lintDebug`. Debug APK installs independently; release signing/Play distribution remains separate.
- CI: `.github/workflows/studio-native-mobile.yml`; artifacts identify exact source SHA. Fixture/unit/simulator evidence is never physical-device acceptance.

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
