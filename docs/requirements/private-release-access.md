# Private organization release access

Owner decision: 2026-10-10, hypeproof/hypeproof-harness#287; implementation #1584.
The source and release repositories remain private on GitHub Free. Installers
and update checks are available to members with repository read access.
People outside the organization install from a class kit (PRA-08, #1617).

## Requirements

| ID | Acceptance |
|---|---|
| PRA-01 | Resolve release metadata and assets with the member GitHub CLI login or explicit GH_TOKEN/GITHUB_TOKEN. The updater and app-only installers also accept HPS_RELEASE_TOKEN. Never embed or persist shared credentials. |
| PRA-02 | Authenticate only the exact organization release API. Updater asset redirects receive no Authorization header and must target a known GitHub asset host. |
| PRA-03 | Preserve updater byte count, SHA-256, timeout, partial-file cleanup and existing-file guards. Missing credentials/digest and denied API access fail explicitly. |
| PRA-04 | Private source and SDK seed scripts use the member GitHub CLI login; custom script mirrors receive no repository credential. |
| PRA-05 | Windows/macOS bootstrap scripts require GitHub CLI and verify SHA-256 before installing. Preserve platform restrictions. |
| PRA-06 | The requirement workflow supplies a Contents-read credential to the private Harness checkout without widening its normal workflow token. |
| PRA-07 | Service development packages and deployment source remain private. Authenticate immutable release acquisition with existing Contents-read access, verify SHA-256 before installing, and stage artifacts only in ignored local/CI cache. No Service package tarball or source snapshot is committed to Studio or copied into Studio releases. Bundled packages preserve canonical implementation bytes and existing authorization behavior. |
| PRA-08 | A person outside the organization installs from a class kit: the release's archive, `install.sh` or `install.ps1` and SDK seeder in one folder with `kit-info.txt` and `SHA256SUMS` (`install.sh --kit`, `install.ps1 -KitDir`). Every kit file is checked against `SHA256SUMS` before use; kit mode makes no GitHub call and asks for no login; dependency installs, app copy, SDK seed and doctor are the member steps. A kit comes from `scripts/make-class-kit.sh` (instructor hand-off) or from the Lab site's participation-code install, which checks the code with the Service and assembles the kit from release assets. `mirror-release` attaches the tag's installers and seeders to every release for that purpose. `SHA256SUMS` detects damage; it does not authenticate who handed the folder over. |
| PRA-11 | The macOS installer (`install.sh` on darwin) fails closed on a missing SDK seed, as `install.ps1` does: when the seeder cannot be obtained, exits non-zero, or leaves no `claude.verified.json`, the doctor exits non-zero with a Korean stop message naming the stage (fetch, run with exit code, or marker) and the recovery command (the kit's own `install.sh --kit` in kit mode, the member one-liner otherwise). Members and class kits behave the same. On Linux, where `install.sh` installs no Studio app and the doctor has no SDK check, a missing seed stays a warning and no installer text says the install will stop. No installer text promises that Studio repairs the SDK on first launch while the app has no in-app fetch. |

## Validation

The update checker, transport, orchestration, runtime and installer smoke suites
exercise success and negative controls. Transport controls cover foreign origins,
foreign redirects, stripped CDN credentials, corrupt/truncated bytes and timeouts.
The Windows workflow runs the installer fixture on PowerShell 5.1 with successful
login, denied API access, bad digest and unsafe filename scenarios.

A live authenticated release download with SHA-256 verification is distinct from
launching a rebuilt app. Source merge and installer publication do not claim that
existing release binaries contain the new updater. A new release must be built
and pass the existing release gates before the updated app is distributed.

PRA-07 controls: `npm run test:private-service-packages`, preserved App/Service
measurement checks, and Chalk instructor authorization checks. The bootstrap
uses `config/service-packages.json` and the existing `HYPEPROOF_READ_TOKEN`;
missing access or changed bytes block acquisition. A successful staged local
install is separate from authenticated remote CI access and runtime publication.

PRA-11 controls: `scripts/test-installer-sdk-seed.sh` (no network: on macOS a seeder
stubbed to fail, to be unavailable and to succeed without a marker, each for a member
and/or a kit, must stop the doctor with the stage and recovery command; a seeder that
writes the marker must pass with exit 0. On Linux a failed or marker-less seed must
leave the doctor at exit 0 with no stop message and no "the install will stop" warning).

PRA-08 controls: `scripts/test-installer-kit.sh` (macOS: kit built and installed
without GitHub, damaged kits refused) and `scripts/tests/install-kit-fixture.ps1`
(Windows PowerShell 5.1 job: kit functions, a failed setup refused, the seeder's
output kept off the return value, old optional tools reported). The Lab
participation-code bootstrap is covered on the Lab side.
