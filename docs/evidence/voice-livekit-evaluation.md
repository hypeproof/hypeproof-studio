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
- LiveKit RTC Python 1.2.1 / server 1.13.11: three protocol controls passed.
  The corrected v6 media run passed eight controls over actual loopback RTC in
  17.897 seconds. It received decoded synthetic PCM, interrupted output on actual
  incoming energy, cleared the SDK queue and removed its publication. Admission,
  foreign/duplicate sender, Stop, stale/late events, disconnect, acknowledgement
  failure and queue overflow were exercised. Owned listeners remained loopback-only;
  the child server was reaped. No STT/LLM/TTS provider was called.
- Four cleanup controls passed on the candidate. Three serve/scenario controls
  applied to the actual old base exposed one failure and two errors: cleanup could skip room
  disconnect and mask the primary exception. The old failures remain evidence.
- The old generation's receiver now closes at interruption/unpublication. Its
  final 87-frame receipt stays unchanged through the next generation (21 frames)
  and Stop. This proves receiver attribution isolation, not physical silence or
  the size of an unobserved RTP/hardware tail. Those ranges remain unknown.

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

Independent review revoked v5 media acceptance: its receiver stayed alive and
attributed the next generation's 43 frames to the old receipt (106 became 149).
The original v5 result is preserved, not relabeled as passing. V6 closes the old
AudioStream and rechecks its final receipt after the later generation and Stop.
A first v6 driver setup failed before remote execution; that log is also retained.
Cleanup now attempts every owned receiver/source/evaluator/room/private-file release
independently, preserving the body failure or first cleanup failure.

Native iOS SDK resolution/build, the native client connected to the server,
physical iPhone speaker/Bluetooth, Korean naturalness, AEC/false interruptions
and installed-app acceptance are NOT RUN. The launcher currently runs on Linux
loopback; an iPhone's loopback does not connect to a Mac. The development screen
cannot yet be presented as an end-to-end native acceptance result. Production
account/coach integration and continuous audio cost controls remain separate.

## Source and receipt bindings

The lab source originated at `2a3749ccebeffc5c84e07e9c5f621cf49452af02` with
cleanup/observer correction `f014c45a0a550034c372b01c37e6510f0456c5ea`;
all eight v6 source hashes match the integrated source. Native adapter source came
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

- `lab-handoff-v6.json`: `6473b7aab68702c4220d43f737a244cfc9c1de1da83b4a9a1c19a2387503093a`
- `lab-evidence-v6/media/result.json`: `880822399fefe6aed3b6c38cf49b56d6dd291c3f11dc62c1c499d94e473cb91d`
- `lab-evidence-v6/execution.json`: `5480813a88941cd859e65339b5c5565b91bff92dc5f125bb176a5d1dd68979ec`
