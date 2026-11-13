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
  --expected-script-sha256 ANDROID_RECIPE_SHA256
```

Placeholders must be replaced with verified values. Active product targets are `ios` and `android`. The recipe retains its historical
`macos` identifier for old receipt compatibility, but that identifier described
the retired Mac Catalyst preview and must not be admitted for new work. The
current Xcode project disables Catalyst. Existing desktop Studio uses its own
extension checks and RC pipeline, not this mobile recipe. No arbitrary command
or artifact path is accepted. The
recipe invokes only the existing platform verification entrypoint. Android uses
`android-emulator.py`, which owns its private ADB server and disposable emulator
then calls `android-verify.sh`; other platform commands are unchanged. The caller
owns the required `hype-resource local_heavy` slot; the recipe never nests one.
Android requires a Linux runner with procfs and an installed API35 Google APIs
x86_64 SDK. It creates its own disposable emulator; it never attaches a caller's
running device. iOS requires full
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

The existing `android-emulator.py` owns one foreground ADB server and emulator.
CI and this adapter use that same lifecycle. Set `ANDROID_SDK_ROOT` (or
`ANDROID_HOME`) to the installed SDK. The adapter retains the existing Java and
Gradle environment. `ANDROID_SERIAL` selects only the new emulator's port
(default `emulator-5554`), not a device to reuse. Busy emulator or ADB ports are
refused without stopping their owner. The default private ADB port is5047; use
matching `ADB_SERVER_SOCKET=tcp:127.0.0.1:PORT` and
`ANDROID_ADB_SERVER_PORT=PORT` to select another. Direct bootstrap callers can
use `--adb-port`. Port5037, remote/unsupported routes and conflicting values are
refused; there is no fallback to a shared daemon.

The bootstrap starts `adb -L tcp:PORT nodaemon server`, proves that exact PID
owns the loopback-only listening socket through Linux procfs, and supplies both
client socket and emulator port variables. The numeric loopback client route
prevents missing-server auto-start in the validated SDK; preserve the actual
installed-tool negative control when changing SDK versions. Tool versions and
executable hashes, endpoint, PID, recipe hashes and owned cleanup appear in
`evidence/android/bootstrap/receipt.json`. Only invocation-owned process groups
are stopped, including remaining children after their leader exits.

For Android, `--expected-script-sha256` now pins the `recipe_record` digest of
three ordered file records (bootstrap, verifier, readiness classifier), encoded
as sorted-key compact JSON and hashed with SHA256. Register all three files in
the trusted profile. An old verifier-only digest fails closed. Candidate and
full-index patch checks remain unchanged; recipe changes still require separate
infrastructure admission before app-feature patches can consume them.

`verification.json` separates build, readiness, instrumentation and artifact
phases. The bootstrap finalizes its aggregate only after cleanup; exception,
timeout, interruption or cleanup failure cannot inherit an earlier PASS. The
adapter requires both receipts' phases to pass as well as its original source
and artifact checks. These receipts cover only the lifecycle these scripts own.
A failed enclosing resource/SSH/copy operation remains a separate failed or
unknown result; these files cannot certify that caller. No failed native journey
is replayed automatically. Original launcher failures and historical product
runs remain separate evidence; this change does not complete #3693 admission.

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
