# Existing Studio updater: Developer ID verification

[Issue #3811](https://github.com/hypeproof/hypeproof-studio/issues/3811) extends
REQ-I13 in [Studio requirements](../studio-requirements.md). The existing updater,
private/public release selection, HTTPS redirects, archive size/SHA-256 checks,
class holds, quit handling and same-volume rollback remain in place.

The trust anchor is compiled into `updateCheckerHelpers.ts`: Apple Developer ID
Application, team `RZBNT9ZB67` (release-owner verified), bundle and signing identifier
`ai.hypeproof.studio`. It is not read from the download receipt, release metadata,
an environment variable or the old app's local signature. The outer requirement
uses [Apple TN3127](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements).
Nested code is verified deeply and strictly across all architectures; the outer
identifier is checked separately because helpers have different identifiers.
Gatekeeper must succeed and identify the authority as `Notarized Developer ID`.
Apple tools use fixed system paths. The updater needs no Xcode/Command Line Tools.

The extracted app is checked before staging or offering a restart. After quit,
the installer checks the final copy beside the existing app, immediately before
backup and replacement. A rejected signature, wrong team/identifier, failed or
disabled assessment, or changed copy leaves the old app untouched. Quarantine is
preserved throughout; there is no bypass switch. Existing rollback handles a
failed replacement. No user-data directory is moved or deleted.

The old app must still have the expected bundle identifier. Its local/self-signed
identity is not evidence of Developer ID signing or notarization and is not used
to choose the new signer. This permits an updater containing this pinned policy
to transition to an official signed candidate. Already-distributed old updater
binaries do not gain this verification retroactively: bootstrap them by installing
the first approved Developer ID/notarized release through the existing distribution
channel. Never describe that old-to-first-signed bootstrap as this updater's
verified N-1→N acceptance or promise unchanged macOS permission grants.

Focused controls are `update-stage-host.smoke.mjs` (actual orchestration with OS
command stubs) and `update-installer.smoke.mjs` (real bash swap/rollback on disposable
directories, mocked Apple tools). Transport and public-source controls retain the
access and SHA/TLS contract. These tests do not establish Apple acceptance of a
real signed package. Installed signed N-1→N update, Gatekeeper, launch, permissions
and recovery remain release gates; no deployment follows from these local checks.
