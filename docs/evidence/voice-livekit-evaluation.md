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
and installed-app acceptance are NOT RUN. The launcher has now run on Darwin
loopback too; an iPhone's loopback still does not connect to a Mac. The development screen
cannot yet be presented as an end-to-end native acceptance result. Production
account/coach integration and continuous audio cost controls remain separate.

## Earlier source and receipt bindings

These bind the earlier Linux/core run. The new native CI extension and Darwin
source-build work have separate manifests and are not covered by an earlier
adapter source PASS.

The lab source originated at `2a3749ccebeffc5c84e07e9c5f621cf49452af02` with
cleanup/observer correction `f014c45a0a550034c372b01c37e6510f0456c5ea`;
all eight v6 source hashes matched the integration at the v6 checkpoint. Native adapter source came
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

## Darwin and native CI extension

Darwin v9 executed the exact server source commit
`385aa40f9292fe1db8caad87301e4b285b7c198a` with SHA-verified Go 1.26.11 and the
existing Apple clang 17 / SDK 26.2. Host preparation passed in 87.887 seconds;
nine host/cleanup/protocol controls, eight actual loopback controls and one
same-room client Stop/disconnect session passed. Owned servers were reaped and
all observed server sockets were loopback. Native iOS execution remains pending.

V7 failed before compilation on an overly strict archive directory check. V8
failed at Darwin source compilation with CGO disabled: the pinned CPU dependency
requires Darwin cgo. V9 used the existing compiler, without changing upstream
source, module files or system tools. These failed runs remain separate.

The new native CI observer's first version filtered counts by session state,
which could falsely hide post-fence callbacks. Independent review rejected it.
The correction retains the actual registered observer and counts raw callbacks
under a lock, independent of session state. Five receipt-gate controls and two
owned-runner controls passed; Ubuntu Swift syntax parsing passed. These do not
constitute iOS semantic compilation or native RTC acceptance.

The nested host-preparation cancellation path was subsequently corrected: an
actual old-source SIGTERM run left its child alive, while corrected SIGTERM and
SIGINT controls reaped the child and retained a failed receipt. The outer native
helper must allow that bounded cleanup before killing its process group.

The actual workflow shell ran against synthetic Git/receipt fixtures: eleven
controls passed, including refusal to produce acceptance when the new parallel
voice job is missing, queued, failed, cancelled or skipped in selected scope.
The original iOS/Android join and test suite were preserved.

- `lab-handoff-v9.json`: `9233269f3b9a127aaeac450192e54d45539ddc8eb446b6d3a03d23fc41d88723`
- `native-ci-handoff-v3.json`: `cb6600a75e6254f5397bb44976fcf9cf7f133beea04b1804ce16181722138420`

- `lab-handoff-v10.json`: `cbdc0402a6f297b4023c5318cc73391f834e29dcf6d1ef4dee208d4e74a2696e`
