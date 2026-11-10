# HP Studio native mobile preview

Native SwiftUI iOS and Android View applications for standalone observation, AI questioning, and human-confirmed intent revisions. No WebView, browser entry, or desktop pairing is required. This is the native correction to the web-only prototype in #3650; it does not replace the separate desktop companion work (#3298).

## Requirement: ST-REQ-NATIVE-MOBILE

A person records an observation, optionally connects free AI after age and transmission consent, and confirms/revises their intention in their own words. Project-local drafts and revision history survive restart. Export and explicit deletion are available. AI may suggest a next question; it cannot create confirmed human intent. Recent 20 messages plus the latest confirmed intent are sent for only the selected project.

Philosophy → Product Intent → behavior: introspection, multiple perspectives and practice inform the prompt and the observation/reflection flow (ST-INT-NATIVE). These are design hypotheses, not established growth outcomes, diagnoses or personality/fate scores. Foundry execution and economic dashboards are future work.

## Boundary and costs

Native filesystem, share sheet, and application lifecycle belong to the App layer. HypeProof Service owns admission, model routing, policy, metering and monetary ceilings. The client uses `/v1/free/claim` and `/v1/messages`, the `hypeproof-fast` alias, low effort and at most 2,048 output tokens. No provider secret is shipped. Installation ID remains stable when records are deleted; bearer grant stays in process memory. Reconnect renews access under the same server allowance, not a new free identity. Exact monetary allowance is Service-owned and must not be inferred from token count. CI is manual/change-triggered, capped at 25 macOS and 20 Linux job minutes; no recurring job.

Records stay in app-private storage; iOS uses file protection and excludes notebook backup; Android disables app backup. Sending to AI is opt-in per app session. Local deletion does not delete data already sent to the Service. Exports contain conversations and intentions; only an explicit share action exports them. This preview has no account sync, independent speech recognition, handwriting, push notifications, Foundry deployment, or financial telemetry.

## Build and evidence

- iOS: `bash apps/studio-native/scripts/ios-verify.sh` on a Mac with Xcode 26+ and a matching iOS Simulator. CI pins Xcode 26.3 and selects the matching SDK runtime. [Apple upload requirements](https://developer.apple.com/news/upcoming-requirements/) require Xcode 26 / iOS 26 SDK or later. Builds an **unsigned device app** and runs an actual native simulator capture/confirmation/relaunch test. Local Command Line Tools alone are insufficient.
- Core controls: `swift test --package-path apps/studio-native/ios`.
- Android: JDK 17, Android SDK 35, Gradle 8.9. In `android`, `gradle --no-daemon :app:testDebugUnitTest :app:assembleDebug :app:lintDebug`. Debug APK installs independently; release signing/Play distribution remains separate.
- CI: `.github/workflows/studio-native-mobile.yml`; artifacts identify exact source SHA. Fixture/unit/simulator evidence is never physical-device acceptance.

## iPhone installation gate

Apple Developer membership and iOS signing are currently unavailable. TestFlight upload and physical iPhone installation are **BLOCKED** pending enrollment/signing. A simulator app or unsigned device app is not an installable iPhone deliverable. Free Personal Team installation is also possible with Xcode, an Apple Account and the connected iPhone, but must be re-provisioned after seven days. The current Mac has no Xcode installation.

After membership is ready: select the enrolled team in `ios/HPStudio.xcodeproj`, provision `ai.hypeproof.studio.mobile`, archive the Release scheme, upload via Xcode Organizer, complete App Store Connect processing and invite the test account through TestFlight. Do not commit certificates, provisioning profiles or private keys. App Store icon/privacy/store metadata and a signed archive must be verified before upload.

Human device acceptance: launch from the home screen → create observation → force quit/reopen → confirm/revise intention → opt in to AI → observe a real question or accurate refusal → share/export and delete. No Safari work surface should appear. Do not close the physical acceptance gate from CI alone.
