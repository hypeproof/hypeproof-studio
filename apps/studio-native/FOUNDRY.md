# Native acceptance recipe for Foundry

Requirement: `ST-REQ-MOBILE-FOUNDRY-ADAPTER`, Studio #3693. This is the first
bounded recipe around the existing native verification scripts. It is not a new
runner, signing path, deployment service or complete implementation of #3693.
Actual Foundry execution remains **NOT_RUN** until the existing owner admits a
profile and the existing runner produces its durable receipt.

## Invocation and evidence

On a fresh isolated candidate checkout, invoke:

```sh
python3 /trusted/pinned/foundry-native-acceptance.py \
  --workspace /absolute/candidate --platform android \
  --expected-source-sha FULL_BASE_COMMIT \
  --expected-patch-sha256 FULL_INDEX_BINARY_PATCH_SHA256 \
  --expected-script-sha256 ANDROID_VERIFY_SCRIPT_SHA256
```

Placeholders must be replaced with verified values. Active product targets are `ios` and `android`. The recipe retains its historical
`macos` identifier for old receipt compatibility, but that identifier described
the retired Mac Catalyst preview and must not be admitted for new work. The
current Xcode project disables Catalyst. Existing desktop Studio uses its own
extension checks and RC pipeline, not this mobile recipe. No arbitrary command
or artifact path is accepted. The
recipe invokes only the corresponding existing `scripts/*-verify.sh`. The caller
owns the required `hype-resource local_heavy` slot; the recipe never nests one.
Android requires an explicitly selected disposable emulator. iOS requires full
Xcode and the matching simulator. No build or device test runs in unit tests.

The candidate must have no untracked or unstaged source. A staged reviewed patch
requires its SHA256 from `git diff --cached --full-index --binary HEAD`; changes
are restricted to iOS App/Sources/Tests/UITests and Android app/src. Recipe,
workflow, build-configuration and credential-file changes are rejected, as are
changed source symlinks. Admit such infrastructure changes separately before
running an app-feature candidate. Receipt source identity records HEAD,
candidate index tree, full-index patch digest, dirty status and changed paths.
Source/recipe changes during verification fail. Existing outputs are refused,
never deleted or reused. Each attempt needs a fresh candidate checkout.

The receipt is written once at
`apps/studio-native/evidence/foundry/PLATFORM/foundry-native-acceptance.json`, with
the command exit/timeout and exact log/artifact SHA256s and sizes. Required empty,
missing, symlinked or nonregular outputs fail; source-pin mismatches stop before
the native command. Failure evidence remains in the same directory. Whole app
directories are inventories of actual file bytes, not a claim based on a small
manifest's hash alone. External/physical-device, human, upload, deployment and
tester-availability evidence remain NOT_RUN. macOS PASS means an unsigned build;
iOS/Android simulator/emulator checks never establish physical-device acceptance.

Historical `macos` receipts are build-only evidence for the discontinued preview;
they never establish acceptance of the existing desktop Studio. Do not use that
recipe to deliver or replace the desktop product.

## Registration with the existing runtime

The original Foundry owner registers a `reviewed_patch` profile binding the
tenant/project/product, exact source, task digest, allowed native paths, reviewed
patch, current model-boundary probe and approved budget. Register the actual
Python executable, this recipe and the platform verification script as trusted
files with hashes. The acceptance argv contains `{workspace}` and the expected
source/patch/script pins. The recipe itself should be the external pinned copy,
outside builder-editable paths. Register this relative `artifact_paths` entry:

```text
apps/studio-native/evidence/foundry/android/foundry-native-acceptance.json
```

Use the appropriate platform directory. The existing runner includes this file's
exact bytes in its final receipt and artifact digest, together with immutable
engine/policy/adapter versions, run ID, manifest digest, candidate patch and its
independent verifier verdict. Those outer fields are the execution binding. The
recipe leaves `foundry_binding.versions` null and `actual_foundry_execution`
NOT_RUN; it cannot self-attest that a Foundry claim happened or invent version
pins. A standalone invocation stays standalone even when its native checks pass.
Only a verified outer receipt establishes actual Foundry consumption, and READY
still does not mean deployed or released. Unknown monetary cost stays UNKNOWN.

No live config, existing product pins, credentials, worker ownership or deployment
policy is changed by these files. Onboarding and profile admission remain with
the existing Foundry owner. Do not restart or replace that worker to run this.

## Measuring native verification latency

Preserve source, runner, test inventory and final receipts when comparing duration.
Main run `43842465814/1` completed the iOS recipe in 42m09s; run
`43853610332/1` passed the same 37 UI cases but was cancelled during finalization.
Its UI suite was faster while build/startup was slower. Neither a cancelled job
nor `TEST SUCCEEDED` alone qualifies a package, and a longer job allowance is not
a speed improvement.

Studio #4310 removes redundant existence polling only when a fresh query already
finds the supported text field/text view or diagnostic node. If absent, the
original bounded fallback and assertions remain. No element is cached across
launches; late-event/no-repoll observation windows and all 37 journeys remain.
Report the actual new helper waits, suite duration and full-recipe result before
claiming a speedup. The source change and equivalence review do not establish
native execution or faster CI by themselves.

### Observe readiness before injecting speech or judging a gesture

Main `53ac57f4` run `43866573322/1` retained an Android 43/44 failure:
the endpoint-timeout case injected partial speech before capture had started.
With this fixture, listener registration is synchronous. The missing listener
does not distinguish an undelivered tap from a refused start. Wait for observable
foreground, account, window and target readiness, perform exactly one real click,
then require one capture start and listening state before injecting speech.
Retain the original timeout, late-result, no-submit, draft and relaunch checks.
On failure, capture allowlisted touch/state data and the screen before teardown
under the existing `evidence/failures` collection path. A later launcher screenshot
cannot explain the failed user action. Never directly start the controller or
retry the click to manufacture acceptance.

Run `43862198817/1` retained a separate iOS 36/37 failure: a keyboard dismissal
drag stopped at 90% of the window, leaving a visible prediction bar and keyboard
tail with the draft still focused. The team-entry case now completes the same
single drag at the last in-window point and verifies that its endpoint passes
the keyboard's lower edge. The original five-second disappearance assertion and
draft/card/answer/next-question checks remain. Corrected gesture geometry is a
source correction, not proof that the new native execution passes.

Keep failures, platform/source identity and full-suite results separate. These
test preparation changes do not establish a product root cause, physical voice
quality, a new release, or a completed Foundry runtime.

## Focused synthetic controls

```sh
python3 -m unittest discover -s apps/studio-native/tests -p 'test_foundry_native_acceptance.py' -v
```

Run through the caller's resource wrapper. Tests use synthetic files and mocked
native subprocess execution, explicitly checking identity refusal, byte hashes,
failed/missing/unsafe outputs, stale evidence, source mutation and duplicate
invocation. They establish the recipe contract only, not native UI quality,
Foundry runtime admission, signing or release readiness.

## Android runner routing

The caller must own the selected disposable emulator and ADB server. The recipe
preserves `ANDROID_SERIAL`, `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `JAVA_HOME` and
`GRADLE_USER_HOME`, which the existing Android recipe/build tools consume.
Explicit `ADB_SERVER_SOCKET` supports only `tcp:127.0.0.1:PORT` or
`tcp:localhost:PORT`; `ANDROID_ADB_SERVER_PORT` accepts ports 1–65535. Both can be
set only with matching ports. Malformed, nonloopback and unsupported socket
forms, and `ANDROID_ADB_SERVER_ADDRESS`, are refused before subprocess execution;
explicit routing is never silently dropped in favor of port 5037. Without either
routing variable, ADB retains its ordinary default, so the runner must provision
and own that default server or supply its dedicated endpoint. Loopback validation
alone does not establish ownership. No emulator or server is started by this
adapter. Tests of propagation/refusal use mocked subprocesses only.

Source binding also rejects Git assume-unchanged and skip-worktree flags. It
compares actual tracked native input bytes and executable mode directly with the
index; Git diff cleanliness alone is insufficient. Ignored files under the native
workspace are rejected too, except enumerated generated build/evidence and Python
cache directories. Use SDK environment variables instead of an ignored
`android/local.properties`. Tracked native symlinks are refused. This byte check
is explicitly scoped to `apps/studio-native`; the receipt retains the whole
candidate tree identity separately. Real temporary Git negative fixtures cover
hidden tracked edits, ignored compiler inputs and disabled Git mode checking;
their files remain synthetic, not application build evidence.

All enumerated generated build roots must be absent before any platform command
runs, including `ios/DerivedData-macos`, `android/app/build`, `android/build` and
`android/.gradle`. This shared list also defines the post-build source-check
exemption, so ignored outputs cannot become a preexisting trusted build cache.
Existing trees or symlink ancestors are refused without cleanup or execution.
Real-Git fixtures cover every listed root on each platform with an external
symlink beneath the ignored tree and assert that the native command never starts.

## First-person iPhone regression journeys — Studio #3771

A shell launch, Keychain probe, build or local-note screenshot does not establish
that someone can sign in and receive a question. The existing iOS verification
entrypoint must run `StudioJourneyTests` and collect the actual XCTest log with
`scripts/collect-native-journeys.py`. Eight required cases exercise the real app
account continuation, view actions, cache/outbox and voice state machine while
external Service, browser callback and recognizer transports are synthetic.

The DEBUG-only `NativeJourneyFixture` is selected by `--native-journey`, a known
`HP_NATIVE_JOURNEY` scenario and a unique `HP_NATIVE_JOURNEY_ID`. It uses a private
URLSession protocol that refuses unknown routes without a network fallback,
validates the actual PKCE exchange and namespaces its synthetic Keychain/cache
and server snapshot. It never presets `signedIn`, replaces the app's send action,
uses live credentials or grants a real account AI eligibility. The synthetic
trace and screenshots are XCTest attachments. This seam has no Release code.

The queued-voice case delays only the fixture history GET for two seconds and
requires trace evidence that speech actually ended during that read, then one
POST, a visible reply and resumed listening. A delay alone cannot pass the case.

The collector separates device build, simulator journey and physical evidence.
Missing/skipped/duplicate/incomplete required cases, a nonzero native command or
any failed attempt cannot become PASS even if a later retry succeeds. Keep the
original log and result bundle; fix the underlying failure instead of rerunning
until a green summary hides it. The collector writes once and hashes the exact
logs. A new attempt needs fresh evidence paths.

`physical_device: NOT_RUN`, real authentication, real Korean ASR and Apple
processing remain separate. Missing physical evidence does **not** block an
otherwise validated test candidate from reaching the user for testing; it does
block any claim that the installed experience has been accepted. See the
MFR-T01–T06 protocol in `docs/testing/native-mobile-growth.md`.

This infrastructure change must be committed/reviewed before the existing
Foundry recipe consumes it. The reviewed-patch path for app features does not
admit changed recipe, verification script or workflow files. A standalone
collector invocation still does not prove actual Foundry execution.


## Real media interruption evaluation — Studio #4300

The development-only LiveKit path has a reusable local media recipe in
`voice-evaluation/README.md` and a shared wire fixture consumed by Python and
Swift controls. It does not replace the account journeys above. The recipe
records exact server/SDK/source revisions, actual decoded synthetic PCM, source
queue cancellation, publication removal, admission and session fences, and owned
process cleanup. It retains failed attempts and refuses to label transport
receipt or queue drain as acoustic playback.

Keep source controls, actual transport, native SDK compilation, simulator UI and
physical iPhone/Korean voice acceptance as separate results. `Room.connect` is
not remote participant admission: the sender must wait for the exact evaluator's
SID-bound readiness before opening its microphone or sending Start. Original
failures, including unresolved sender identity, remain evidence.

This recipe is a development evaluation, not an installed release gate or a
production provider. Public ingress, account authorization, continuous audio
metering and paid voice activation remain Service integration work. The existing
mobile recipe and its failing-journey gate remain authoritative for releases.

The native counterpart is `scripts/ios-livekit-verify.py`: a separate bounded
Mac job builds the existing Debug app, owns one simulator and calls the pinned
local server recipe. It runs in parallel with the unchanged ordinary UI suite.
`native / acceptance` refuses a non-successful selected voice job. Private room
credentials stay in temporary files/app storage; only allowlisted observations
are uploaded. Raw callback counts remain independent of the session fence so
cancellation cannot manufacture a passing observation. Nested preparation and
server cancellation must reap every owned child before an execution is accepted.

When preparation or receipt helpers change, run the complete affected native
contract recipe before pushing, not just the newly added test module:
`python3 -m unittest discover -s apps/studio-native/tests -p 'test_*.py' -v`
from the repository root, under the shared resource allocation. Use semantic
ordering assertions: preparation must finish before credential issuance, failure
must not start a scenario, and a failed attempt must not be replayed. An exact
prefix of internal command names can reject a harmless additional preflight
step without detecting a product defect. Command doubles must still reject
unknown commands; checking for absent files after cleanup is not evidence that
credentials were never issued. Preserve failed source/run evidence and bind the
full contract result to the tested inputs. Contract success does not replace the
actual native SDK and media recipe.
