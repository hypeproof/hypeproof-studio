# Voice evaluation evidence — #4300

Status: partial development evaluation, 2026-11-16. No production provider or
new TestFlight voice feature was enabled. Parent #898 remains open. This report
is not physical voice, learner-growth or full requirement acceptance.

## Executed controls

- Linux host `snts`, official Swift 6.2.3: six actual `VoiceEvaluationSessionTests`
  passed (`swift test --filter VoiceEvaluationSessionTests`, exit 0). The shared
  Python/Swift wire fixture and admission identity/SID guards are included.
- Cancellation-aware permission source compiled with Swift 5 language mode and
  complete strict concurrency; its executable controls passed (exit 0). The OS
  permission callback is controlled; this does not claim real iOS permission UI.
- LiveKit RTC Python 1.2.1 / server 1.13.11: three protocol controls and seven
  actual loopback media controls passed. The 17.923-second media execution
  received decoded synthetic PCM, interrupted output by actual incoming energy,
  cleared the real SDK queue and removed its publication. Stop, late/stale
  messages, foreign sender, disconnect, injected acknowledgement failure and
  controlled queue overflow were exercised. Owned listeners were loopback-only;
  the child server was reaped. There was no STT/LLM/TTS provider call.
- Playback queue examples were 0.206 seconds to zero on onset and 0.215 seconds
  to zero on Stop. These are SDK queue observations, not acoustic latency or
  evidence of what a human heard. Decoded tracks contained 149, 43 and 12 frames.

## Preserved failures and remaining gates

The first Mac attempt failed before source checking because installed CLT/SDK
components disagreed (SwiftBridging redefinition and PackageDescription link
failure). No system toolchain files were modified. The isolated Linux toolchain
archive was checked against the official Swift signature using a task-local keyring.

Media attempts v2/v3 exposed the first-message admission race: the reliable
packet arrived while the evaluator had no resolved sender. The identity guard
correctly refused it. The correction requires the exact evaluator to advertise
this connection's participant SID before mic publication or Start. No sender is
inferred from JSON and the first Start is not blindly retried. A v4 launcher
variable collision failed before server creation; v5 corrected it. Failed logs
remain separate from the corrected execution.

Native iOS SDK resolution/build, the native client connected to the server,
physical iPhone speaker/Bluetooth, Korean naturalness, AEC/false interruptions
and installed-app acceptance are NOT RUN. The launcher currently runs on Linux
loopback; an iPhone's loopback does not connect to a Mac. The development screen
cannot yet be presented as an end-to-end native acceptance result. Production
account/coach integration and continuous audio cost controls remain separate.

## Source and receipt bindings

The lab source originated at `2a3749ccebeffc5c84e07e9c5f621cf49452af02`;
its seven file hashes match the integrated source. Native adapter source came
from `7156b84f5d309a4c37bbdee9f73c7041fa6ab8eb` with admission correction
`a48461e6d864f317be098bfdba06d17bbf4195cd`. Root core/test working bytes were
bound by the Swift run's input manifest rather than represented as an all-HEAD pass.

- `apps/studio-native/ios/Sources/StudioCore/VoiceEvaluationSession.swift`: `977867b88a976ace81553dc2edbe4d194a9c1a31376b2593cf2ff639886fb7b1`
- `apps/studio-native/ios/Tests/StudioCoreTests/VoiceEvaluationSessionTests.swift`: `369ad546a34ed2df8331ac1d2a829c028e7a0cdaa12a40384fa0281859596068`
- `apps/studio-native/ios/App/LiveKitEvaluationController.swift`: `ccaaafdd1c6ebb10f40b1e8944cd19e2b06fdab850809e3e805b2b22fef13f1c`
- `apps/studio-native/ios/App/LiveKitEvaluationPermission.swift`: `8d612a419c5bbef1945f8ef46ab4ec1c8e577af06c30d69b322285f21e66b9cd`

Local evidence bundle: `artifacts/studio-livekit-implementation-20261116/` in the delivery workspace. It includes the original failures, source manifests and command logs. Receipt digests:

- `lab-handoff-v5.json`: `936a95b459921ce773298a430b5691e1f00111e186876a76badad9f0f33d3d0f`
- `swift-ubuntu-probe-v1/summary.json`: `34600b2439df3d5ccc1ad10a25b6fb80ebacec361b32b67d1cc47e956d9d32cd`
- `swift-ubuntu-probe-v1/result.json`: `75be744068e42887be87a10916334e1df460c885cc22f24acf230ef38bb589d5`
- `lab-evidence-v5/media/result.json`: `d32bd1101f54af3888d54e8e4c48cc9970cf02e63da9df2bf46d4b93ca71b9bb`
