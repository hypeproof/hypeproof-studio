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
| PRA-09 | Releases can be macOS only (`config/release-platforms.json`). Where a Windows install asks for the latest release (`install-win.ps1`, `install.ps1`, `make-class-kit.sh` without `--version`), it uses `/releases/latest` when that release has the Windows installer, and otherwise the newest published release (no drafts, no prereleases, by `created_at`) that has it. A pinned version installs exactly that release and fails when it has no Windows installer. No release with a Windows installer is a clear error, never a silent success. macOS keeps resolving to the latest release. |

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

PRA-08 controls: `scripts/test-installer-kit.sh` (macOS: kit built and installed
without GitHub, damaged kits refused) and `scripts/tests/install-kit-fixture.ps1`
(Windows PowerShell 5.1 job: kit functions, a failed setup refused, the seeder's
output kept off the return value, old optional tools reported). The Lab
participation-code bootstrap is covered on the Lab side.

PRA-09 controls: `scripts/tests/install-win-fixture.ps1` and
`scripts/tests/bootstrap-win-private-fixture.ps1` with the shared release answers in
`scripts/tests/win-release-set.ps1` (Windows PowerShell 5.1 job): latest has Windows
(the release list is never read), latest is macOS only (falls back past a newer draft
and prerelease, in `created_at` order), the fallback reads a second page, a pin, a
missing pin; negative controls for no Windows release anywhere and a pinned macOS-only
release. `scripts/test-installer-kit.sh` section 5 covers the kit builder with the
script's own jq filter. The Lab download and participation-code kit are covered on
the Lab side.
