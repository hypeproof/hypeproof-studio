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

Placeholders must be replaced with verified values. Platforms are exactly `ios`,
`android`, and `macos`; no arbitrary command or artifact path is accepted. The
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

The existing macOS script requires a committed clean checkout. Consequently a
staged reviewed-patch candidate fails that script honestly. Use an approved
committed candidate with an empty patch for Mac, or separately review a change
to the existing script; this recipe never creates commits or bypasses the gate.

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
