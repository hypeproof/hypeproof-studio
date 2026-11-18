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

The first hosted run resolved the iOS SDK and passed the Release device build,
but the Debug test build failed; the native client connected to the server,
physical iPhone speaker/Bluetooth, Korean naturalness, AEC/false interruptions
and installed-app acceptance remain NOT RUN. The correction awaits a new run. The launcher has now run on Darwin
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
helper now allows that bounded cleanup before killing its process group. Its
original `InterruptedError` was swallowed by Python selectors during pipe reads;
an actual nested cancellation exposed that failure. A dedicated interruption
exception and bounded child cleanup passed TERM, INT and timeout controls while
preserving the original failure and a sanitized host preparation receipt.

The actual workflow shell ran against synthetic Git/receipt fixtures: eleven
controls passed, including refusal to produce acceptance when the new parallel
voice job is missing, queued, failed, cancelled or skipped in selected scope.
The original iOS/Android join and test suite were preserved.

- `lab-handoff-v9.json`: `9233269f3b9a127aaeac450192e54d45539ddc8eb446b6d3a03d23fc41d88723`
- `native-ci-handoff-v3.json`: `cb6600a75e6254f5397bb44976fcf9cf7f133beea04b1804ce16181722138420`

- `lab-handoff-v10.json`: `cbdc0402a6f297b4023c5318cc73391f834e29dcf6d1ef4dee208d4e74a2696e`

The outer runner also preserves cleanup across consecutive INT/TERM signals.
Its actual main path failed the old-source control and passed after the change.
These are process lifetime controls; they do not prove native audio behavior.

- `native-cancellation-handoff-v6.json`: `f20253b96a115e5d2d0649c8af54d01f8ad0db60df4e7f6fae733708849654ea`

## First hosted native execution and corrections

Run `43849037836/1` tested source `944ea3f1641d7d16d7ddcedf39b94e8ec4536fe9`
at PR merge `25bea5b4fb14d575beef1ee0d07f7982a4a713d4`. It failed and is
preserved as a failed run. Android passed 44 emulator cases, and the ordinary
iOS job passed 87 core controls and the Release device build. Its Debug build
requested x86_64 while the resolved LiveKit module was built for arm64, so the
37 UI cases did not execute. The correction sets `ONLY_ACTIVE_ARCH=YES` for
Debug only; parsed-project comparison confirms Release, package pins, target
dependencies and source membership are unchanged.

The separate voice job timed out at its first CoreSimulator runtime query
(15 seconds), before app compilation or RTC setup. The exact service cause was
not observed. The correction gives that one readiness query 60 seconds within
the unchanged 1,050-second total bound, without retry. Steps now retain elapsed
time/effective timeout and fixed precredential diagnostic markers rather than
raw logs or paths. An injected-clock old-source control failed; eleven corrected
controls passed, including a 20-second enumeration, timeout before app setup and
clipping to the remaining global budget. This is control-logic evidence, not an
actual cold simulator or native transport pass.

- `hosted-pr4306/terminal-review.json`: `8569ddc0ae1808fd52d10dd95648bfaafc895448e07a716917424f0555ea6c5b`
- `native-ci-corrections-handoff-v1.json`: `2f5d067e511d0c486e14244b11c99da6d977421b6f076192af3b3f9940cb387b`

## Native transport failure and retained diagnostics

Run `43853610332/1` tested source `f9863aa8b756a1e72fa9ce10008b3d3eb2dedd2c`
at merge `c6c99463150960427e678c96a51cc7b19212163d`. The actual runtime query
passed in 51.303 seconds; Debug SDK compilation, signing and installation passed.
Pinned Darwin server preparation also passed. Native transport then failed with
`evaluator_exited_early`, without a validated PCM, interruption or Stop receipt.
That failure remains preserved; the original receipt did not distinguish the
configuration wait from the native-result wait, so its cause is unresolved.

The helper now records fixed phases, elapsed time, evaluator exit and remaining
configuration lifetime, with allowlisted partial receipts before owned cleanup.
Credential-bearing files, raw logs, URLs, room/session identifiers and arbitrary
error messages are excluded. Malformed or unavailable diagnostic data cannot
replace the primary failure. Two old-source controls failed as intended; fifteen
corrected controls passed, including real early-exit child processes, malformed
data, privacy sentinels and a diagnostic-reader failure. Previously executed real
nested TERM/INT/timeout controls remain source-bound to unchanged cancellation
functions; no repeated native acceptance is inferred from these controls.

Owned app termination/container preparation now precede starting the evaluator
and issuing its 75-second configuration. Previously those permitted cold-command
delays could consume the fresh lifetime. A virtual-clock control proves the
ordering correction, without extending TTL, changing acceptance or adding a
retry. This source-level hazard is not proof of the historical failure's cause.
Corrected native execution and physical audio remain unverified.

The ordinary iOS job from the same run was cancelled at its 45-minute bound.
Its actual log contains 87 passing core controls, 37 passing UI cases (1,573.012
seconds) and `TEST SUCCEEDED` at 44m53s into the build/test step. Cancellation
arrived twelve seconds later while evidence finalization was still incomplete.
The archive lacks the final native/sign-in receipts and cleanup proof; therefore
the overall job remains cancelled, not accepted. No UI failure or hang was observed.
The prior qualified main run `43842465814/1` took 42m09s for the iOS job, showing
that the old bound had little finalization margin even before this change.

Increase only the workflow iOS job bound to 55 minutes, updating its stale
31-case comment to 37. The entire `ios-verify.sh`, individual test allowances,
test assertions/count, acceptance join and release gates remain unchanged.
This provides finalization/upload time without treating missing receipts as a
pass. It does not attribute every elapsed delay to the SDK or prove the corrected
run will qualify; that requires a fresh complete execution.

- `hosted-pr4306-f986/voice-failure-review.json`: `32c9a7c60e649c2997f4862f913b5beedfc98c12fa824250b21b71091e398ebd`
- `native-failure-observability-handoff-v2.json`: `a1bf7b663ea731a8812be7202a5f28c84b57bc6e9f72e7d156b802d8a4ff20c4`

## Subsequent cold-runtime timeout and bounded readiness

Run `43862198817/1` tested source `5e3223fb1c12dd121e789df0d18e15482b9e04a5`
at merge `a5f94ede1f4abf970a1d7b3e31024d6e5c04f326`. The separate voice
job failed during its first `simctl list runtimes --json` query after 60.043
seconds (exit 124, no stdout/stderr). Xcode/SDK inspection had succeeded. No
simulator creation, app build, credentials or media stage executed, so this run
does not exercise the new native failure diagnostics. The daemon cause remains
unknown. Android passed 44 emulator cases. Ordinary iOS later passed 87 core
controls and 36/37 UI cases, then failed the question-card case after a partial
keyboard dismissal. Its cleanup completed with original exit 65. Those results
cannot make the failed voice job pass. The separately reviewed native-readiness
change in #4311 preserves the original assertions and completes the single
keyboard gesture; it does not retroactively qualify this failed execution.

The three voice attempts used the same hosted image `20261104.0514.1` with
Xcode 26.3: the initial query timed out at 15 seconds, completed in 51.303
seconds, then timed out at 60.043 seconds. This evidence supports allowing more
cold preparation time, but not a proven diagnosis or guaranteed duration. Give
that single query at most 180 seconds, clipped by the unchanged remaining
1,050-second execution-stage budget. Do not add a second query, warmup, retry,
component installation, daemon restart or SDK change. Existing process-reaping
and final-cleanup grace remain separately bounded.

Capture only validated ImageVersion, ImageOS and RUNNER_ARCH fields. After a
runtime timeout, use at most two seconds plus one second for reaping an owned
read-only process snapshot, clipped to remaining execution time. Publish only
counts of known CoreSimulatorService and simdiskimaged names. Skip that snapshot
when insufficient time remains; diagnostic failure cannot replace the original
timeout. No raw process names, paths, arguments, credentials or arbitrary logs
are uploaded.

Three focused controls passed: virtual 90/179-second completions reach the
subsequent injected create failure; 181-second preparation and five-second
remaining budget fail before creating a simulator; diagnostic-reader failure
retains the primary timeout. Metadata/process sentinels and owned snapshot
reaping were checked. Both slow-completion controls fail against the prior
60-second implementation. These controls validate budget/error behavior, not
CoreSimulator readiness or native audio. Previously executed cancellation
controls are reused only for byte/AST-identical functions; actual new-source
native execution and physical audio remain NOT_RUN.

- `hosted-pr4306-5e3223fb/voice-failure-review.json`: `b2a846de41755743cf0ba363a40d24d5a8073cf7d3fb3ac2060ab699e4aa09a6`
- `cold-simulator-readiness-research/recommendation.json`: `a09e4c9b381aa41f91945b36830f2c4ec94de3c4507be6e5dbb62e21b796ffc6`
- `native-cold-readiness-handoff-v2.json`: `60874005c5aa11fd6219bcd9de810891f7d62210d12e16f972266fd551b297a3`

## Terminal acknowledgement and atomic private publication

Source review also found two independent hazards; neither is established as the
historical `evaluator_exited_early` cause. A visible configuration path could
contain partial JSON before the writer finished, and a fixed 200ms Stop grace
could end without observing the evaluator acknowledgement.

Publish complete, fsynced 0600 JSON through a same-directory no-clobber hard link,
then remove the temporary name. Existing receipts are never overwritten. The
actual-filesystem controls hold a partial write and inject a write failure; both
expose the prior writer's unsafe readiness boundary. The prepared host Python
runs these controls before issuing any 75-second credential.

On Stop, fence local capture and playback immediately and retain terminal
session state. Within the existing cleanup allowance, wait at most one second
for the exact previous Room, evaluator SID, session, turn and generation's
`stopped` acknowledgement before disconnecting. A missing acknowledgement is
not success. Only an actually accepted callback emits the fixed, content-free
`stop_acknowledged` event; both native and helper receipts require that event.
It grants no playback authority and cannot restart a stopped or later session.

Portable checks exercise the actual Swift acknowledgement matcher separately
from the native SDK. Python RTC strategy observations do not qualify Swift
teardown or reproduce historical server-disconnect ordering. Failed controls
and the unsupported whole-Linux-Core/CryptoKit attempt remain preserved; only
source-identical evidence is reused. New hosted native execution, physical
audio, naturalness and production integration remain NOT_RUN. Credential TTL,
the overall execution allowance and all existing PCM/cleanup assertions remain
unchanged.

## Precredential contract integration

Run `43882717145/1`, source `3d623ed4724784e8746f5ab472e25691e70301fa`,
failed before native execution. Of 146 contract methods, one existing method's
three subcases rejected the new publication check because its command double
treated that command as a simulator action and asserted a fixed three-command
prefix. iOS, Android and actual voice evaluation were skipped; the strict join
correctly failed. This is not a native SDK result or evidence of the historical
evaluator failure's cause.

Change only the tests: classify publication and simulator commands explicitly,
reject unknown commands, and require all relevant preparation to precede the
single credential issuance. Retain fresh-lifetime, original failure, diagnostic
privacy and no-replay assertions. A failed-publication control observes that
neither a scenario nor an evaluator process starts; it does not infer this from
files absent after cleanup. The final exact-source Ubuntu contract execution at
`f81daa6de9a04a555cca99b5d0498cdda1de0050` passed all 147 methods in
72.403 seconds. The original ordering oracle fails against the unchanged helper
as expected. Product, native adapter, helper and workflow code are unchanged by
this correction. New hosted/native execution remains pending.

- `publication-contract-v2/handoff.json`: `6c7694e47e11e8f05cf35ae6acd279ef277befc2e5039b4561b6cb257d7eb85a`
- `hosted-pr4306-3d623ed4/independent-review.json`: `9f51a75a37affb1b041832bd062eebd761903a5125450be1f07b9da9a5cd9a0b`
