# HP Studio native mobile preview

Native SwiftUI iOS, Mac Catalyst macOS, and Android View applications for standalone observation, AI questioning, and human-confirmed intent revisions. No WebView, browser entry, or desktop pairing is required. This is the native correction to the web-only prototype in #3650; it does not replace the separate desktop companion work (#3298).

## Requirement: ST-REQ-NATIVE-MOBILE

A person records an observation, optionally connects free AI after age and transmission consent, and confirms/revises their intention in their own words. Project-local drafts and revision history survive restart. Export and explicit deletion are available. AI may suggest a next question; it cannot create confirmed human intent. Recent 20 messages plus the latest confirmed intent are sent for only the selected project.

Philosophy → Product Intent → behavior: introspection, multiple perspectives and practice inform the prompt and the observation/reflection flow (ST-INT-NATIVE). These are design hypotheses, not established growth outcomes, diagnoses or personality/fate scores. Foundry execution and economic dashboards are future work.

## Boundary and costs

Native filesystem, share sheet, and application lifecycle belong to the App layer. HypeProof Service owns admission, model routing, policy, metering and monetary ceilings. The client uses `/v1/free/claim` and `/v1/messages`, the `hypeproof-fast` alias, low effort and at most 2,048 output tokens. No provider secret is shipped. Installation ID remains stable when records are deleted; bearer grant stays in process memory. Reconnect renews access under the same server allowance, not a new free identity. Exact monetary allowance is Service-owned and must not be inferred from token count. CI is manual/change-triggered, capped at 25 macOS and 20 Linux job minutes; no recurring job.

Records stay in app-private storage; iOS uses file protection and excludes notebook backup; Android disables app backup. Sending to AI is opt-in per app session. Local deletion does not delete data already sent to the Service. Exports contain conversations and intentions; only an explicit share action exports them. This preview has no account sync, independent speech recognition engine, handwriting, push notifications, Foundry deployment, or financial telemetry.

## Native voice and acceptance

The next candidate adds two explicit modes on iOS and Android. **말로 적기**
appends recognized Korean to an editable project draft without sending. **음성
대화** discloses final-transcript auto-send and read-aloud before starting. It
requires current AI consent/access and no unsent draft. After a reply is read,
**다시 말하기** starts the next turn; the microphone never reopens automatically.
Stop, background, project switch and audio interruption end the local turn and
fence stale callbacks. Recognition failures preserve partial draft text.

Only platform on-device recognition is used. iOS checks both
[supportsOnDeviceRecognition](https://developer.apple.com/documentation/Speech/SFSpeechRecognizer/supportsOnDeviceRecognition)
and requires it on the request. Android uses
[createOnDeviceSpeechRecognizer](https://developer.android.com/reference/android/speech/SpeechRecognizer#createOnDeviceSpeechRecognizer(android.content.Context))
where available. Missing Korean assets/engine or denied permission returns to
text. There is no cloud recognizer fallback, paid speech provider or raw audio
upload/storage in the app. Read-aloud uses installed OS Korean voices; Android
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

The current Mac has Command Line Tools but no full Xcode installation. Native iOS/Catalyst build and UI validation use the pinned GitHub macOS runner. Signing certificates, provisioning profiles and API keys stay in the Apple release environment; never commit them. The Catalyst preview and existing desktop IDE RC remain different apps. Subsequent source changes require fresh verification and a separately identified testing build.

The next vertical slice and dependent work are recorded in [mobile growth roadmap](../../docs/requirements/mobile-growth-roadmap.md). Reflection notes stay local and separate from automatically transmitted context and confirmed intentions.

Human device acceptance: launch from the home screen → create observation → force quit/reopen → confirm/revise intention → opt in to AI → observe a real question or accurate refusal → share/export and delete. No Safari work surface should appear. Do not close the physical acceptance gate from CI alone.

## macOS preview and Apple distribution

The 2026-11-10 scope includes both iOS and macOS under the explicit bundle ID
`ai.hypeproof.studio.mobile`. The Mac Catalyst build shares the observation,
questioning, human confirmation and local-record contracts with iOS. It is a
separate installed macOS binary, with App Sandbox and outbound networking; it
does not depend on a browser or an existing desktop Studio process.

`bash apps/studio-native/scripts/macos-verify.sh` builds the Mac app with Xcode
26.3 and records its source, executable architecture and bundle identity. This
unsigned build check does not establish installed-Mac or TestFlight acceptance.
The privacy manifest declares only the app's UserDefaults required-reason API
use, for its stable installation identity. Service data handling and App Store
privacy answers are separate from that API declaration.

App Store Connect access is active as of 2026-11-10; both platform records,
signing credentials, archive validation, upload and installed-device verification
must be observed independently. No private signing key belongs in this repository.

### Signed TestFlight pipeline

`.github/workflows/studio-apple-testflight.yml` archives iOS and Mac Catalyst on
separate disposable macOS runners, validates each package with Apple's upload
tool, then uploads to App Store Connect. Both jobs are capped at 25 minutes.
The initial preview branch triggers uploads only when the deployment workflow or
script changes; subsequent runs can be dispatched once the workflow is on main.
This pipeline distributes the native preview, not the existing VSCodium desktop.

The `apple-native-preview` GitHub Environment must restrict deployment branches
to the preview branch and `main`. It requires variables `APP_STORE_CONNECT_KEY_ID`,
`APP_STORE_CONNECT_ISSUER_ID`, `APPLE_DEVELOPER_TEAM_ID`, and secrets
`APP_STORE_CONNECT_PRIVATE_KEY`, `APPLE_DISTRIBUTION_P12`,
`APPLE_DISTRIBUTION_PASSWORD`, `APPLE_MAC_INSTALLER_P12`,
`APPLE_MAC_INSTALLER_PASSWORD`, `APPLE_IOS_PROFILE`, `APPLE_MACOS_PROFILE`.
P12 and provisioning profile secrets are base64; the API key is PEM text.
The Mac profile must have API type `MAC_CATALYST_APP_STORE`; `MAC_APP_STORE`
can archive this target but Apple rejects it during export.
The runner uses a temporary keychain and deletes its signing material on exit.
Only packages, public identity metadata and build/upload evidence are retained.
The app uses operating-system HTTPS, not custom or non-exempt encryption.

An upload success is not tester availability. Verify Apple's processing status,
attach each valid build to an internal TestFlight group, and observe test account
access separately. Internal-only builds do not require public App Store release.
