# Existing Studio: Developer ID and notarized direct distribution

Source issue: [hypeproof/hypeproof-studio#620](https://github.com/hypeproof/hypeproof-studio/issues/620).
This implements the signing portion of `REQ-STUDIO-RELEASE` for the existing
`ai.hypeproof.studio` app, existing ZIP download and existing automatic updater.
It is not a Mac App Store build or a second desktop app. A passing mocked test
does not establish an Apple-signed release, installation, update or launch.

## Build and publication boundary

Both full and repack builds use `.github/workflows/build-mac.yml`. Credentials
are checked before either expensive build. After extension/vendor injection,
version/source stamping and branding checks, `scripts/release/macos-sign.py`:

1. Requires one explicit valid **Developer ID Application** SHA-1 and Apple
   Team ID in an isolated keychain. Self-signed, ad-hoc, Apple Distribution,
   Developer ID Installer and a different team fail closed. No App Store
   provisioning profile is used. Each resulting code object also verifies
   Apple's Developer ID Application certificate requirement (TN3127), so a
   trusted certificate merely named Developer ID cannot pass.
2. Enumerates every Mach-O, including Electron helpers/frameworks, `.node`
   modules and extension-vendored native CLIs. Signs children before parents,
   outer app last, with hardened runtime and secure timestamp. `--deep` is
   used only for verification, never to select code for signing. External or
   absolute bundle symlinks are rejected. Java bytecode is not mistaken for
   a universal Mach-O. Existing signatures are replaced only in the build copy.
3. Verifies all architectures, Apple chain/Team ID, runtime and timestamp.
   Creates the submission ZIP with `ditto`, records its SHA-256, submits once
   with `notarytool`, and records the returned submission ID before waiting.
4. Requires `Accepted`; staples the app; runs `stapler validate`, codesign and
   Gatekeeper assessment requiring `Notarized Developer ID`. Only then creates
   the final ZIP. Extracts and rechecks that exact ZIP, including bytes, modes,
   symlinks, ticket, code seal and Gatekeeper, before writing its receipt.
5. Uploads the ZIP and receipt together to the existing draft/acceptance lane.
   This grants no promotion, release approval, customer access or live rollout.

Do not mutate the app after signing or replace a release asset in place. A new
candidate needs a new build identity and receipt. The shared base cache remains
unsigned; both paths sign only after all candidate mutations. `sign-mac.sh`
and `REPACK_SIGN=1` remain explicit local development/test tools and do not
produce the official signing receipt. They cannot satisfy a release gate.

## Entitlement review

The policy is stored in `scripts/release/macos-entitlements/`, independent of
the full-build source tree so repack uses exactly the same policy. It follows
the existing VSCodium `build/osx/prepare_assets.sh` → VS Code
`build/darwin/sign.ts` role split, without importing its older credential
handling or post-stamp privacy-string mutations. Reference inspected:
VSCodium `59e579274e3a32fbb93bd10b38bfe071da043cce`, VS Code
`560a9dba96f961efea7b1612916f89e5d5d4d679`,
`build/azure-pipelines/darwin/*-entitlements.plist`.

| Code role | Entitlements | Reason |
|---|---|---|
| Main app | JIT, audio input, camera, Apple events | Existing upstream Electron/VS Code capabilities; does not grant user consent or change usage descriptions |
| Helpers and vendored runtime executables | JIT | V8/JSC execution; GPU/renderer helpers retain the upstream JIT-only policy |
| Electron Plugin helper only | JIT, unsigned executable memory, disable library validation | Existing upstream extension/plugin-host compatibility exceptions, not granted to the whole app |
| Native modules, dynamic libraries, framework code | No entitlement injection | Code is re-signed by the same team; avoid inheriting process exceptions into libraries |

No `get-task-allow`, app sandbox, production secret-storage bypass, global
library-validation disable or quarantine removal is added. Entitlement policy
hashes and the explicit signed-object inventory are retained in `signed.json`.
Actual Electron launch, extension-host native modules, vendored CLI JIT and
update tests on a signed candidate remain release acceptance requirements;
the mock controls cannot establish runtime compatibility.

## Credentials: provisioned by the release owner

The workflow uses the `macos-direct-release` GitHub Environment, restricted to main and v* release tags. It uses **new** names and never overwrites/reuses the old
`MACOS_CERT_P12` self-signed secret. The certificate/private key must belong to
the same Apple Developer team used by notarization. A Mac Installer or App
Store Distribution certificate cannot replace Developer ID Application.

| GitHub configuration | Contents |
|---|---|
| Secret `MACOS_DEVELOPER_ID_P12` | Base64 PKCS#12 containing Developer ID Application certificate, private key and its required intermediate chain |
| Secret `MACOS_DEVELOPER_ID_PASSWORD` | Nonempty PKCS#12 export password |
| Variable `MACOS_DEVELOPER_ID_SHA1` | Exact 40-hex certificate fingerprint, not a display-name prefix |
| Variable `MACOS_TEAM_ID` | Expected ten-character team ID |
| Secret `MACOS_NOTARY_KEY_P8` | App Store Connect **team** API private key authorized for notarization; raw PEM, not base64 |
| Variable `MACOS_NOTARY_KEY_ID` | API key ID |
| Variable `MACOS_NOTARY_ISSUER_ID` | Team API issuer UUID |

`import-macos-signing.sh` creates only
`$RUNNER_TEMP/hps-developer-id.keychain-db`, fails if it already exists, and
passes that keychain explicitly to Apple tools. It does not change login
keychain trust, the user's search list or existing signing identities. Temporary
P12/P8 files use mode 0600 and are removed on success/failure; shell tracing is
disabled. `security` requires import/keychain passwords as local process
arguments, so use only the isolated hosted release runner; never enable shell
trace. The workflow deletes its temporary keychain in an `always()` step. No
credential material is included in the receipt or signing evidence upload.

A missing/expired/untrusted identity, wrong team or invalid notary credential
stops before building. Install the correct Apple intermediate chain if
`security find-identity -v` does not consider the identity valid; do not grant
arbitrary trust or weaken the check. Creating a certificate, choosing API key
access and setting repository secrets are separate release-owner operations.

For an explicitly approved local candidate, provision a dedicated keychain and
notary profile separately, then run the same helper under the resource wrapper:

```bash
export HPS_DEVELOPER_ID_SHA1=<40-hex-fingerprint>
export HPS_APPLE_TEAM_ID=<team-id>
export HPS_SIGNING_KEYCHAIN=/absolute/path/to/isolated.keychain-db
export HPS_NOTARY_PROFILE=<stored-profile-name>
python3 scripts/release/macos-sign.py preflight
python3 scripts/release/macos-sign.py release \
  --app '/isolated/build/HypeProof Studio.app' --source-sha <full-source-sha> \
  --output /isolated/dist --evidence /isolated/signing-evidence
```

No local call manufactures GitHub run provenance: its receipt has
`release_eligible: false`, `provenance.kind: local`, and null run identifiers.
Neither this document nor the helper authorizes a submission or release.

## Immutable receipt and consumer contract

Final asset names remain `HypeProof-Studio-darwin-arm64.zip` plus
`HypeProof-Studio-darwin-arm64.signing.json`. The receipt schema is
`hps-macos-release-signing/v1` and contains:

- `repository: hypeproof/hypeproof-studio`, `source_sha` (40 lowercase hex),
  `platform: darwin-arm64`, `bundle_id: ai.hypeproof.studio`, `bundle_version`,
  expected `team_id`, and `certificate_sha1` (40 uppercase hex).
- `provenance`: `workflow: .github/workflows/build-mac.yml`,
  `kind: github-actions`, actual positive integer `run_id` and `run_attempt`.
  CI checks `GITHUB_REPOSITORY` and `GITHUB_WORKFLOW_REF`; local results are
  explicitly ineligible. Consumers independently check the actual trusted
  GitHub run/artifact/source identity. A self-asserted receipt is not authority.
- `signing`: `type: Developer ID Application`, `hardened_runtime: true`,
  `secure_timestamp: true`; `notarization`: Apple's `submission_id`,
  `status: Accepted`, `submitted_archive_sha256`.
- `verification`: `codesign`, `stapler`, `gatekeeper` all true only after the
  checks ran successfully; `artifact`: final ZIP `name`, `sha256` and `bytes`.

The submitted ZIP digest and final ZIP digest are intentionally distinct:
stapling changes the app before the final ZIP is made. Consumers must verify
the final artifact digest/length/name and expected source/team/bundle against
trusted run provenance before publishing, mirroring or updating. Transfer the
same ZIP bytes; do not rezip or strip quarantine as a substitute for validation.

### Initial installation

The current authenticated `scripts/install-mac.sh` bootstrap accepts only the
fixed Developer ID Application team `RZBNT9ZB67` and bundle
`ai.hypeproof.studio`, with deep/strict signature verification and Gatekeeper's
`Notarized Developer ID` result. It checks the extracted app and the final staged
copy before moving the existing installation; a failed swap restores the old app.
It uses the existing mirror access and SHA-256 checks, without Node or Xcode on
the learner's Mac. It does not remove quarantine attributes.

Per-tag installers bake the same requirement from the candidate source's
`config/macos-distribution.json` using `signingPolicy(sourceSha)`. Missing Git
source is an error. A readable historical candidate without that policy retains
its legacy classification; already-published tagged installers are unchanged.
The current bootstrap intentionally refuses those unsigned legacy packages.
The tagged installer preserves SDK seeding, profile/layout selection and rollback.
Portable installer fixtures exercise refusal, staged-copy tampering and rollback;
they do not establish actual Apple signing or installed-app acceptance.
Existing updater rollback and release freeze/approval policy still apply.

Checkpoints are exclusive-create files. A wait timeout resumes with the same
app/source/run/evidence and submission ID, without signing/uploading again.
Changed app bytes or submitted ZIP bytes block resume. A network failure during
initial submission before an ID is received leaves `submission-started.json`
and error evidence and **blocks automatic resubmission**. The owner must reconcile
Apple history before a new attempt. A crash during stapling before its checkpoint
or after final ZIP creation but before receipt also blocks automatic overwrite;
retain the failed bytes for diagnosis. A receipt never overwrites an earlier one.

## Acceptance and current evidence boundary

Portable controls: `python3 scripts/release/test/test_macos_sign.py` (also in
`pr-ci.yml`) executes mocked Apple tool processes and validates ordering,
identity/team/runtime/chain rejection, notarization failures, interrupted wait,
ambiguous upload, tamper detection, final ZIP round-trip and receipt immutability.
The release workflow retains checkpoint JSON; the final receipt accompanies
the published candidate. Neither makes acceptance human-approved.

Before the first official release, require actual Developer ID signing and
Apple `Accepted` evidence, a stapled final ZIP accepted by Gatekeeper on a
clean Mac, launch/chat/native SDK checks, and an update from the current
self-signed installation with rollback/account-data preservation. Credentials,
real Apple submission, clean-machine installation and real update are **NOT
RUN** by these mock controls. No signed release availability is claimed here.

Primary references: [Apple notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution),
[custom workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow),
[TN2206 nested signing](https://developer.apple.com/library/archive/technotes/tn2206/_index.html),
[TN3127 requirements](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements),
[hardened runtime](https://developer.apple.com/documentation/security/hardened-runtime),
and [Electron notarize](https://github.com/electron/notarize).

## Promotion and download consumers

The small `hypeproof-studio-macos-signing-receipt` Actions artifact contains only
the final signing JSON. It is uploaded immutably with 90-day retention; missing
or expired proof is unqualified, never silently trusted. Harness and Lab compare
its exact bytes with the release receipt and verify the actual successful workflow
run/attempt, source, artifact digest and final ZIP identity.

`config/macos-distribution.json` at the candidate commit declares the official
requirement. Older source commits remain explicitly legacy. New candidates fail
publication when proof is missing, local-only, stale or mismatched. Unified Mac
acceptance verifies this proof and OS signature/Gatekeeper before launching the
app. Promotion retains the signing JSON byte for byte with the accepted ZIP;
publication and mirroring recheck it through `check-unified-release.mjs`.

The first Developer ID certificate was provisioned by the Account Holder; secret
material is outside Git. Actual candidate signing, notarization and installed
N-1 to N behavior are still separate release evidence, not inferred from issuance.
